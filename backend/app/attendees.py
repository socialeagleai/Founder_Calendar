"""Resolving a meeting's attendee list, and refusing to let it widen access.

`Meeting.attendees` holds TeamMember ids - the same id space as
`visible_members`, bridged to `User` by email exactly like the rest of the
notification path (see notify_service).

The rule this module exists to enforce: **naming someone as an attendee never
grants them access.** An attendee the meeting's audience hides is a 422 that
names them, not a silent `visible_members.append()`. Auto-widening would make
the attendee picker an access-control surface: add a colleague to a private
1:1 and it stops being private, with nothing on screen saying so. Rejecting
puts the choice back where it belongs - the author either widens the audience
on purpose, or drops the attendee.
"""

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .deps import can_view_item
from .models import Meeting, Organization, TeamMember, User


@dataclass(frozen=True)
class Attendee:
    """Someone expected at a meeting."""

    member: TeamMember
    # None when they haven't accepted their invitation to this org yet. They stay
    # a valid attendee - they're on the roster and will be notified once they
    # join - but nothing is sent to them meanwhile: they can't open the meeting,
    # so telling them about it would leak the org's content outside the org.
    user: User | None

    @property
    def reachable(self) -> bool:
        return self.user is not None


def resolve(
    db: Session, org: Organization, ids: list[str], *, require: list[str] | None = None
) -> list[Attendee]:
    """Attendee rows for `ids`, in the order given, de-duplicated.

    Ids that aren't members of this org are dropped, EXCEPT those listed in
    `require`, which raise 422 instead. That split matters:

      - Dropping is right for an id already stored on the meeting. People leave
        orgs; `remove_member` doesn't rewrite every meeting they were in. Raising
        would make a departed teammate brick the meeting - every later edit, even
        a rename, would 422 with no way to reach the stale id, since the picker
        can only tick members who still exist.
      - Raising is right for an id being ADDED now, which is the author asserting
        this person exists. Silently dropping that would save a different list to
        the one they were looking at.

    `require` is therefore the newly-added ids at a write, and empty everywhere
    else - including the reminder loop, where raising would abort a whole org's
    run and there is nobody to show an error to anyway.
    """
    wanted = list(dict.fromkeys(ids))  # de-dupe, keep order
    if not wanted:
        return []

    members = {
        m.id: m
        for m in db.query(TeamMember)
        .filter(TeamMember.organization_id == org.id, TeamMember.id.in_(wanted))
        .all()
    }
    missing = [i for i in (require or []) if i not in members]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Some attendees are no longer members of this organization.",
        )
    wanted = [i for i in wanted if i in members]
    if not wanted:
        return []

    # Only members who have ACCEPTED get bridged to a User. An invited-but-never
    # -joined member may well have an account already (they could own another
    # org), but they are not in this org yet: mailing them its meeting would leak
    # org content to someone who can't even open it. Same rule, same reason, as
    # notify_service._roster.
    emails = [members[i].email for i in wanted if members[i].status != "Invited"]
    users = (
        {u.email: u for u in db.query(User).filter(User.email.in_(emails)).all()}
        if emails
        else {}
    )
    return [Attendee(member=members[i], user=users.get(members[i].email)) for i in wanted]


def ensure_can_attend(meeting: Meeting, attendees: list[Attendee]) -> None:
    """Raise 422 naming anyone who couldn't see `meeting`.

    Call this with the audience ALREADY applied to `meeting`: attendees and
    audience are validated together, so narrowing the audience on a meeting that
    has attendees fails the same way adding an unreachable attendee does. Either
    edit alone is fine; the combination is what's incoherent."""
    blocked = [
        a.member.name or a.member.email
        for a in attendees
        if not can_view_item(meeting, a.user, a.member)
    ]
    if not blocked:
        return
    names = ", ".join(blocked)
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        f"{names} can't see this meeting. Change who can see it, or remove them "
        f"as {'an attendee' if len(blocked) == 1 else 'attendees'}.",
    )


def validated(
    db: Session, org: Organization, meeting: Meeting, ids: list[str]
) -> list[Attendee]:
    """resolve() + ensure_can_attend() for a brand-new meeting.

    Every id is `require`d here: on a create there is no stored list yet, so all
    of them are being added right now."""
    attendees = resolve(db, org, ids, require=ids)
    ensure_can_attend(meeting, attendees)
    return attendees
