"""Working out who to notify about an item, and telling them.

The one rule this module exists to enforce: **a notification may never reach
someone who cannot open the thing it is about.** Rather than write a reverse
audience query (given an item, who can see it?) that would have to be kept in
step with the read path by hand, this resolves recipients by calling the very
same `can_view_item()` the read path uses, for each member of the org. It is a
loop instead of a clever query, at a team's scale that is nothing, and it makes
the two structurally incapable of disagreeing.

Two traps this handles that a naive member loop does not:
  - The org OWNER may have no TeamMember row at all (see deps.page_access_level),
    so iterating team_members alone would silently never notify them - forever.
  - Audience lists hold TeamMember ids, but notifications key off User ids, and
    the only bridge between them is the email address. Members who were invited
    but never signed up have no User row and are skipped: they are not users yet,
    and mailing org content to an unverified address is not ours to do.
"""

from dataclasses import dataclass, field

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from .config import settings
from .deps import can_view_item
from .email import notification_email, send_bulk
from .mentions import extract_handles
from .models import Organization, TeamMember, User
from .prefs import Prefs, prefs_for, prefs_for_many
from .push import PushMessage, build_messages, send_push
from .routers.notifications import notify

# (to, subject, html, text) - deliberately plain strings. These are handed to a
# FastAPI BackgroundTask, which runs after the response and after dependency
# teardown: by then the request's DB session is closed, so passing an ORM object
# or the session itself would blow up on attribute access.
EmailMessage = tuple[str, str, str, str]


@dataclass
class Outbox:
    """Off-app deliveries queued during a request, sent once it has committed.

    Collected rather than sent inline because both channels are blocking network
    calls (SMTP handshakes, HTTP to push services) that have no business sitting
    between the user and their response."""

    emails: list[EmailMessage] = field(default_factory=list)
    pushes: list[PushMessage] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.emails or self.pushes)


def send_later(background: BackgroundTasks, outbox: Outbox) -> None:
    """Hand queued deliveries to background tasks. Call only AFTER a successful
    commit - if the write rolled back, nobody should be told it happened."""
    if outbox.emails:
        background.add_task(send_bulk, outbox.emails)
    if outbox.pushes:
        background.add_task(send_push, outbox.pushes)


def _queue_channels(
    db: Session,
    outbox: Outbox | None,
    recipient: "Recipient",
    message: str,
    link: str,
    push_body: str,
) -> None:
    """Queue the off-app channels this recipient has switched on.

    `message` is the full bell text (titles, never content). `push_body` is a
    deliberately vaguer version: a push renders unprompted on a screen that may
    be locked, in a cafe, or shared - and unlike the bell and the inbox, we can't
    assume the person in front of it is the recipient. So push says come and
    look, and the specifics live behind the click."""
    if outbox is None:
        return
    if recipient.prefs.email_enabled:
        url = (
            f"{settings.app_base_url.rstrip('/')}{link}" if link else settings.app_base_url
        )
        html, text = notification_email(recipient.user.name, message, url)
        outbox.emails.append((recipient.user.email, message, html, text))
    if recipient.prefs.push_enabled:
        outbox.pushes.extend(
            build_messages(db, recipient.user.id, "Founder Calendar", push_body, link)
        )


@dataclass(frozen=True)
class Recipient:
    """Someone who can see an item, and how they want to hear about it."""

    user: User
    member: TeamMember | None  # None for an owner with no TeamMember row
    prefs: Prefs


@dataclass(frozen=True)
class MentionResult:
    """What happened when we resolved the @mentions in a piece of text."""

    # Handles naming a real teammate who can't see the item - report these to the
    # author so the mention doesn't fail silently.
    unreachable: list[str]
    # User ids actually pinged. The caller suppresses its generic "shared with
    # you" fan-out for these people: being mentioned is the stronger signal, and
    # two rows about one note reads as spam.
    notified: set[str]


def _roster(db: Session, org: Organization) -> list[tuple[User, TeamMember | None]]:
    """Everyone in the org who has an account, paired with their TeamMember row.

    Includes the owner even when they have no TeamMember row, and skips invited
    people who never signed up (no User row to notify)."""
    members = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.status != "Invited")
        .all()
    )
    emails = [m.email for m in members]
    # One query for the whole roster - the obvious version is a query per member,
    # on every single write.
    users = {
        u.email: u
        for u in (db.query(User).filter(User.email.in_(emails)).all() if emails else [])
    }

    out: list[tuple[User, TeamMember | None]] = []
    seen: set[str] = set()
    for m in members:
        u = users.get(m.email)
        if u is None:
            continue  # invited but never signed up
        out.append((u, m))
        seen.add(u.id)

    owner = db.get(User, org.owner_id)
    if owner is not None and owner.id not in seen:
        # The owner needn't have a TeamMember row. can_view_item(item, owner, None)
        # then denies them "members"-scoped items - which is exactly what the read
        # path does too, so their bell matches what they can actually open.
        out.append((owner, None))
    return out


def recipients_for(
    db: Session,
    org: Organization,
    item,
    category: str,
    *,
    exclude_user_ids: set[str],
) -> list[Recipient]:
    """Everyone who may see `item`, wants `category`, and isn't excluded."""
    roster = [(u, m) for u, m in _roster(db, org) if u.id not in exclude_user_ids]
    if not roster:
        return []
    prefs = prefs_for_many(db, [u.id for u, _ in roster])
    return [
        Recipient(user=u, member=m, prefs=prefs[u.id])
        for u, m in roster
        if can_view_item(item, u, m) and prefs[u.id].wants(category)
    ]


def fanout(
    db: Session,
    org: Organization,
    item,
    *,
    actor: User,
    category: str,
    message: str,
    link: str,
    dedupe_key: str | None = None,
    also_exclude: set[str] | None = None,
    outbox: Outbox | None = None,
) -> int:
    """Notify everyone who can see `item` about it. Returns how many were queued.

    Never notifies the actor (you know what you just did) nor the item's creator
    when they are someone else - "activity on your board" is handled by its own
    call with its own audience. `also_exclude` is for people already told about
    this item by a stronger signal: someone @mentioned in a note shouldn't also
    get "a note was shared with you" about the same note. The caller commits.

    `dedupe_key` is completed per-recipient: the same event fanning out to five
    people must produce five rows, so the recipient has to be part of the key."""
    exclude = {actor.id} | (also_exclude or set())
    if getattr(item, "user_id", None):
        exclude.add(item.user_id)
    sent = 0
    for r in recipients_for(db, org, item, category, exclude_user_ids=exclude):
        result = notify(
            db,
            r.user.id,
            message,
            type=category,
            link=link,
            organization_id=org.id,
            dedupe_key=f"{dedupe_key}:{r.user.id}" if dedupe_key else None,
        )
        # Email only a genuinely new row. A coalesced one already emailed when it
        # was first created; a skipped one was dismissed. Either way, sending
        # again would mean one bell row and N emails.
        if result.created:
            _queue_channels(
                db, outbox, r, message, link, f"New activity from {actor.name}"
            )
            sent += 1
    return sent


def notify_mentions(
    db: Session,
    org: Organization,
    item,
    *,
    actor: User,
    text: str,
    message: str,
    link: str,
    item_kind: str,
    item_id: str,
    outbox: Outbox | None = None,
) -> MentionResult:
    """Notify everyone @mentioned in `text` who can see `item`.

    Reports back the handles that name a real teammate who *cannot* see the item,
    so the caller can tell the author "Priya can't see this note" instead of
    failing silently - a mention that quietly does nothing is worse than none.

    Two things this deliberately does NOT do:
      - Widen the audience. Adding the mentioned person to visible_members would
        make a text field an access-control field: type "@priya" into a private
        note and it silently stops being private. Mentions obey the audience;
        they don't edit it.
      - Report people who muted mentions. They're a normal recipient who opted
        out - saying "they can't see this" would both be false and leak their
        settings. They just don't get pinged, which is what muting means.

    Dedupe has no time component: `mention:note:abc:<user>` means once per item
    per person, ever, so re-saving the same text never re-pings anyone."""
    handles = extract_handles(text)
    if not handles:
        return MentionResult([], set())

    members = (
        db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.handle.in_(handles))
        .all()
    )
    if not members:
        return MentionResult([], set())

    users = {
        u.email: u
        for u in db.query(User).filter(User.email.in_([m.email for m in members])).all()
    }

    unreachable: list[str] = []
    notified: set[str] = set()
    for m in members:
        user = users.get(m.email)
        # No account yet (invited, never signed up), or the audience hides it.
        if user is None or not can_view_item(item, user, m):
            unreachable.append(m.handle)
            continue
        if user.id == actor.id:
            continue  # mentioning yourself is not an event
        prefs = prefs_for(db, user.id)
        if not prefs.wants("mention"):
            # Muted: skip quietly, and don't report it to the author - that would
            # be false ("they can't see it") and would leak their settings. Still
            # counts as handled, so they don't get the generic fan-out instead.
            notified.add(user.id)
            continue
        result = notify(
            db,
            user.id,
            message,
            type="mention",
            link=link,
            organization_id=org.id,
            dedupe_key=f"mention:{item_kind}:{item_id}:{user.id}",
        )
        if result.created:
            # A mention is directed at you by name, so saying so reveals nothing
            # the fact of the push doesn't already.
            _queue_channels(
                db,
                outbox,
                Recipient(user=user, member=m, prefs=prefs),
                message,
                link,
                f"{actor.name} mentioned you",
            )
        notified.add(user.id)
    return MentionResult(unreachable, notified)


def notify_owner(
    db: Session,
    org: Organization,
    item,
    *,
    actor: User,
    category: str,
    message: str,
    link: str,
    dedupe_key: str | None = None,
    outbox: Outbox | None = None,
) -> bool:
    """Tell the item's creator that someone else touched their thing.

    Checked against can_view_item like everyone else rather than assumed: an
    owner-scoped notification still has to obey the item's audience, and a
    creator always passes it - so this is a guard, not a formality."""
    creator_id = getattr(item, "user_id", None)
    if not creator_id or creator_id == actor.id:
        return False
    recipients = recipients_for(
        db, org, item, category, exclude_user_ids={actor.id}
    )
    target = next((r for r in recipients if r.user.id == creator_id), None)
    if target is None:
        return False
    result = notify(
        db,
        target.user.id,
        message,
        type=category,
        link=link,
        organization_id=org.id,
        dedupe_key=f"{dedupe_key}:{target.user.id}" if dedupe_key else None,
    )
    if result.created:
        _queue_channels(
            db, outbox, target, message, link, f"New activity from {actor.name}"
        )
    return result.created
