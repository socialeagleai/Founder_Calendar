"""Resolving an IANA timezone name without ever raising.

Both callers are background threads walking every row on a tick - the digest
over users' zones, the reminder loop over orgs' - so a zone that can't be
constructed has to degrade rather than take the whole run down where nobody
would see the traceback. Zones are validated at the API boundary
(schemas._check_timezone), making this the second line of defence, not the
first: it exists for rows written before that validation, and for a container
that somehow ships without tzdata.
"""

from datetime import timezone
from datetime import tzinfo as tzinfo_t
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Kolkata"


def safe_zone(name: str, fallback: str = DEFAULT_TIMEZONE) -> tzinfo_t:
    """`name` as a tzinfo, falling back to `fallback` and then to UTC.

    UTC is the last resort precisely because it needs no tzdata at all, so this
    still returns something usable even if the package is missing entirely -
    which is exactly the situation that would make the fallback zone fail too.
    """
    for key in (name, fallback):
        if not key:
            continue
        try:
            return ZoneInfo(key)
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            continue
    return timezone.utc
