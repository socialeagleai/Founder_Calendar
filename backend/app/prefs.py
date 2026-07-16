"""Per-user notification preferences.

Deliberately read-only-safe: most users never change a setting, so most users
have no row. `prefs_for()` resolves a frozen default in code instead of lazily
INSERTing one - a get-or-create here would mean a write (and a row lock) on every
read path including the bell poll, and two concurrent requests racing to insert
the same user would make one of them 500.

A row is written only when the user actually PATCHes something, and the PATCH
writes every field from the merged result - so the column defaults on the model
are DDL sugar, and these values are the single source of truth.
"""

from dataclasses import dataclass, fields, replace
from datetime import tzinfo as tzinfo_t

from sqlalchemy.orm import Session

from .models import NotificationPreference
from .tz import DEFAULT_TIMEZONE, safe_zone

# Categories a notification can belong to, mapped to the pref that gates it.
# "system" (leave requests, org events) is deliberately absent: it's always on,
# because it's about the user's own membership rather than content.
CATEGORY_PREF = {
    "shared": "shared_with_me",
    "activity": "activity",
    "mention": "mentions",
    "digest": "daily_agenda",
    "invite": "meeting_invites",
    "reminder": "meeting_reminders",
}


@dataclass(frozen=True)
class Prefs:
    """A user's effective notification settings."""

    # What to notify about. Activity defaults off - it's the chattiest feed and
    # the one most likely to make someone mute everything.
    shared_with_me: bool = True
    activity: bool = False
    mentions: bool = True
    daily_agenda: bool = True
    # Both default on: unlike the feeds above, these are about a commitment the
    # person has been given. Missing a meeting you were put in costs more than
    # an unwanted email.
    meeting_invites: bool = True
    meeting_reminders: bool = True
    # Channel master switches. The bell is always on; it *is* the app.
    email_enabled: bool = True
    push_enabled: bool = False
    # Digest send time: local hour (0-23) in the user's IANA timezone.
    digest_hour: int = 8
    timezone: str = DEFAULT_TIMEZONE

    def wants(self, category: str) -> bool:
        """Whether this user wants notifications of the given category at all."""
        field = CATEGORY_PREF.get(category)
        return True if field is None else bool(getattr(self, field))

    def tzinfo(self) -> tzinfo_t:
        """The user's timezone, resolved without ever raising (see tz.safe_zone).
        The digest scheduler calls this for every user on a tick."""
        return safe_zone(self.timezone)


# Every stored setting. The dataclass fields and the model columns are named
# identically on purpose, so this list is the only place that has to know them
# and adding a setting can't half-land in one direction.
_FIELDS = tuple(f.name for f in fields(Prefs))


def _from_row(row: NotificationPreference | None) -> Prefs:
    """A saved row as Prefs, or the defaults when there's no row."""
    if row is None:
        return Prefs()
    return Prefs(**{f: getattr(row, f) for f in _FIELDS})


def prefs_for(db: Session, user_id: str) -> Prefs:
    """A user's settings - their saved row, or the defaults if they have none.
    Pure: never writes."""
    return _from_row(
        db.query(NotificationPreference)
        .filter(NotificationPreference.user_id == user_id)
        .first()
    )


def prefs_for_many(db: Session, user_ids: list[str]) -> dict[str, Prefs]:
    """prefs_for() across many users in one query. Fan-out checks the preference
    of every recipient, so the per-user version would be a query per member."""
    if not user_ids:
        return {}
    rows = {
        r.user_id: r
        for r in db.query(NotificationPreference)
        .filter(NotificationPreference.user_id.in_(user_ids))
        .all()
    }
    return {uid: _from_row(rows.get(uid)) for uid in user_ids}


def save_prefs(db: Session, user_id: str, patch: dict) -> Prefs:
    """Apply a partial update and persist it, creating the row on first write.
    Returns the merged result. The caller commits."""
    merged = replace(prefs_for(db, user_id), **patch)
    row = (
        db.query(NotificationPreference)
        .filter(NotificationPreference.user_id == user_id)
        .first()
    )
    if row is None:
        row = NotificationPreference(user_id=user_id)
        db.add(row)
    # Write every field, not just the patched ones: on first write the row is
    # brand new and the unpatched fields must land as the defaults above.
    for f in _FIELDS:
        setattr(row, f, getattr(merged, f))
    return merged
