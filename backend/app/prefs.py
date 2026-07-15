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

from dataclasses import dataclass, replace
from datetime import timezone
from datetime import tzinfo as tzinfo_t
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from .models import NotificationPreference

# Categories a notification can belong to, mapped to the pref that gates it.
# "system" (leave requests, org events) is deliberately absent: it's always on,
# because it's about the user's own membership rather than content.
CATEGORY_PREF = {
    "shared": "shared_with_me",
    "activity": "activity",
    "mention": "mentions",
    "digest": "daily_agenda",
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
    # Channel master switches. The bell is always on; it *is* the app.
    email_enabled: bool = True
    push_enabled: bool = False
    # Digest send time: local hour (0-23) in the user's IANA timezone.
    digest_hour: int = 8
    timezone: str = "Asia/Kolkata"

    def wants(self, category: str) -> bool:
        """Whether this user wants notifications of the given category at all."""
        field = CATEGORY_PREF.get(category)
        return True if field is None else bool(getattr(self, field))

    def tzinfo(self) -> tzinfo_t:
        """The user's timezone. Never raises: the digest scheduler calls this for
        every user on a tick, in a background thread, so an unresolvable zone must
        degrade rather than take the whole run down with it.

        Falls back to the default zone, then to UTC - which needs no tzdata at all
        and so still works if the package is somehow missing."""
        for key in (self.timezone, Prefs.timezone):
            try:
                return ZoneInfo(key)
            except (ZoneInfoNotFoundError, ValueError, KeyError):
                continue
        return timezone.utc


def prefs_for(db: Session, user_id: str) -> Prefs:
    """A user's settings - their saved row, or the defaults if they have none.
    Pure: never writes."""
    row = (
        db.query(NotificationPreference)
        .filter(NotificationPreference.user_id == user_id)
        .first()
    )
    if row is None:
        return Prefs()
    return Prefs(
        shared_with_me=row.shared_with_me,
        activity=row.activity,
        mentions=row.mentions,
        daily_agenda=row.daily_agenda,
        email_enabled=row.email_enabled,
        push_enabled=row.push_enabled,
        digest_hour=row.digest_hour,
        timezone=row.timezone,
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
    out: dict[str, Prefs] = {}
    for uid in user_ids:
        row = rows.get(uid)
        out[uid] = (
            Prefs()
            if row is None
            else Prefs(
                shared_with_me=row.shared_with_me,
                activity=row.activity,
                mentions=row.mentions,
                daily_agenda=row.daily_agenda,
                email_enabled=row.email_enabled,
                push_enabled=row.push_enabled,
                digest_hour=row.digest_hour,
                timezone=row.timezone,
            )
        )
    return out


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
    row.shared_with_me = merged.shared_with_me
    row.activity = merged.activity
    row.mentions = merged.mentions
    row.daily_agenda = merged.daily_agenda
    row.email_enabled = merged.email_enabled
    row.push_enabled = merged.push_enabled
    row.digest_hour = merged.digest_hour
    row.timezone = merged.timezone
    return merged
