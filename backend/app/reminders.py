"""Reminding people about a meeting shortly before it starts.

Who: the attendees, plus the creator. Deliberately NOT everyone who can see the
meeting - the whole org can read the leadership sync, but only the people in it
want their phone buzzing about it. Being able to see a meeting and being
expected at it are different facts, and `attendees` is the one that means "you
are expected".

When: inside the LEAD_MINUTES window before the start, which is a window rather
than an instant on purpose. Firing only at exactly T-30 would mean a container
that happened to be restarting at that moment silently skips the meeting, and
nobody ever finds out - the failure looks identical to "no meeting scheduled".
Instead any tick inside the window sends, and the per-(meeting, date, user)
dedupe key is what makes that exactly-once. The email states the real remaining
minutes, so a late tick is honest rather than wrong.

Only meetings with a `start_time` are eligible. That is also what stops the
recurrence work from retroactively mailing everyone about a year of past
standups: legacy meetings have no time, so they recur onto the calendar (which
is what their Schedule label always claimed) but never remind.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from .attendees import Attendee
from .attendees import resolve as resolve_attendees
from .deps import can_view_item
from .models import Meeting, Organization, TeamMember, User
from .notify_service import Outbox, Recipient, queue_channels
from .prefs import prefs_for_many
from .recurrence import occurrence_strings
from .routers.notifications import notify
from .tz import safe_zone

logger = logging.getLogger("uvicorn.error")

LEAD_MINUTES = 30


@dataclass
class Reminder:
    """One meeting occurrence that is due, and who to tell."""

    meeting: Meeting
    occurrence: date
    minutes_until: int


def _starts_at(meeting: Meeting, day: date, tz) -> datetime | None:
    """The aware datetime `meeting` starts at on `day`, or None if it has no
    usable start time."""
    try:
        hour, minute = (int(p) for p in meeting.start_time.split(":"))
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
    except (ValueError, AttributeError):
        # Validated at the API boundary; this is for rows written before it, and
        # must not take the whole run down.
        return None


def due_reminders(db: Session, org: Organization, now_utc: datetime) -> list[Reminder]:
    """Every occurrence in `org` starting within the next LEAD_MINUTES."""
    tz = safe_zone(org.timezone)
    local_now = now_utc.astimezone(tz)
    horizon = local_now + timedelta(minutes=LEAD_MINUTES)
    # A meeting later today, or just after midnight tonight - the window can
    # straddle the date boundary, so both days have to be considered.
    days = {local_now.date(), horizon.date()}

    out: list[Reminder] = []
    meetings = (
        db.query(Meeting)
        .filter(Meeting.organization_id == org.id, Meeting.start_time != "")
        .all()
    )
    for m in meetings:
        for day in days:
            if not occurrence_strings(m.date, m.schedule, day, day):
                continue
            starts = _starts_at(m, day, tz)
            if starts is None:
                continue
            seconds = (starts - local_now).total_seconds()
            # Strictly after now: a meeting that already started is not
            # something to warn anyone about 30 minutes ahead of.
            if 0 < seconds <= LEAD_MINUTES * 60:
                out.append(
                    Reminder(meeting=m, occurrence=day, minutes_until=round(seconds / 60))
                )
    return out


def recipients(db: Session, org: Organization, meeting: Meeting) -> list[Attendee]:
    """Who to remind: the attendees, plus the creator.

    The creator is included even when they didn't add themselves as an attendee -
    they scheduled it, they're expected at it. Everyone is re-checked against
    can_view_item rather than trusted from write time: audiences and rosters move
    between the save and the meeting, and this is the last gate before an email
    leaves the building.
    """
    # No `require`: someone who has left the org is dropped, not raised over. A
    # 422 here would abort this org's entire reminder run.
    people = list(resolve_attendees(db, org, list(meeting.attendees or [])))
    seen = {a.user.id for a in people if a.user}

    creator = db.get(User, meeting.user_id) if meeting.user_id else None
    if creator is not None and creator.id not in seen:
        member = (
            db.query(TeamMember)
            .filter(
                TeamMember.organization_id == org.id,
                TeamMember.email == creator.email,
                TeamMember.status != "Invited",
            )
            .first()
        )
        # Still in the org? Owning it counts: the owner needn't have a TeamMember
        # row at all (see notify_service._roster). Checked because can_view_item
        # would wave the creator through on their own meeting forever - so a
        # creator who has since left would keep getting reminders for a meeting
        # they can no longer open.
        if member is not None or org.owner_id == creator.id:
            people.append(Attendee(member=member, user=creator))

    return [a for a in people if a.user and can_view_item(meeting, a.user, a.member)]


def _subject(meeting: Meeting, minutes: int) -> str:
    if minutes <= 1:
        return f"Starting now: {meeting.name}"
    return f"In {minutes} minutes: {meeting.name}"


def build(db: Session, org: Organization, now_utc: datetime) -> Outbox:
    """Everything due in `org` right now, queued for delivery.

    Writes the bell rows as a side effect; the caller commits. The bell row IS
    the dedupe: `notify()` refuses a second row for the same
    `reminder:<meeting>:<date>:<user>` key, and we only send to a channel when
    it reports the row as newly created. That's what makes a 60-second tick
    inside a 30-minute window send exactly one email rather than thirty."""
    outbox = Outbox()

    for r in due_reminders(db, org, now_utc):
        people = recipients(db, org, r.meeting)
        if not people:
            continue
        prefs = prefs_for_many(db, [a.user.id for a in people])
        link = f"/meeting?id={r.meeting.id}"
        message = (
            f"{r.meeting.name} starts at {r.meeting.start_time}"
            if r.minutes_until > 1
            else f"{r.meeting.name} is starting now"
        )
        for a in people:
            p = prefs[a.user.id]
            if not p.wants("reminder"):
                continue
            result = notify(
                db,
                a.user.id,
                message,
                type="reminder",
                link=link,
                organization_id=org.id,
                # The occurrence date, not just the meeting: a weekly standup
                # must remind every week, but only once each week.
                dedupe_key=f"reminder:{r.meeting.id}:{r.occurrence.isoformat()}:{a.user.id}",
            )
            if not result.created:
                continue  # already reminded on this occurrence
            queue_channels(
                db,
                outbox,
                Recipient(user=a.user, member=a.member, prefs=p),
                message,
                link,
                # No meeting name: a push lands on a screen we can't assume is
                # the recipient's, and the name of a private meeting is exactly
                # the kind of thing that shouldn't surface on a locked phone.
                # The subject line and the bell row carry it; the push doesn't.
                f"A meeting starts in {r.minutes_until} minutes"
                if r.minutes_until > 1
                else "A meeting is starting now",
                subject=_subject(r.meeting, r.minutes_until),
            )
    return outbox
