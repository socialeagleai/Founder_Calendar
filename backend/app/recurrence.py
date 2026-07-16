"""Expanding a meeting's Schedule label into the dates it actually happens on.

`Meeting.date` is the ANCHOR - the first occurrence - and `Meeting.schedule`
says how it repeats after that. Occurrences are computed here on every read
rather than materialised as rows, which means:

  - no horizon to keep extending with a cron job, and no backfill migration
  - editing a series is still editing exactly one row
  - turning recurrence on for meetings that pre-date it costs nothing

The price is that every read of a date range pays this expansion, which is a
few hundred date additions - nothing next to the query that fetched the rows.

This module is the single source of truth for the rule. It is deliberately
pure (dates in, dates out, no session, no models) so it can be tested directly.
"""

from calendar import monthrange
from datetime import date, timedelta

# The furthest we will ever expand a single meeting in one window. A Daily
# meeting over the standard window is ~545 dates; this is a backstop against a
# pathological window, not a product limit.
MAX_OCCURRENCES = 600

# How far the shared calendar feed expands around today. The feed is fetched
# once at bootstrap with no month parameter, so this is generous on purpose:
# the alternative is refetching every time someone pages the calendar. Back far
# enough to see the recent past, forward far enough to plan a year.
WINDOW_BACK_DAYS = 180
WINDOW_FORWARD_DAYS = 365

# Fixed-interval schedules are just repeated addition.
_INTERVAL_DAYS = {"Daily": 1, "Weekly": 7, "Biweekly": 14}
# Everything that repeats at all. Anything else (including "Once", and any
# label a future version adds) happens exactly once, on its anchor.
_RECURRING = set(_INTERVAL_DAYS) | {"Monthly", "Yearly"}


def _add_months(anchor: date, months: int) -> date:
    """`anchor` shifted by whole months, clamped to the target month's length.

    Clamping is computed from the ANCHOR's day every time, never from the
    previous occurrence. Anchor Jan 31 gives Feb 28 and then **Mar 31** - walking
    forward from the clamped Feb 28 instead would give Mar 28, and the series
    would silently spend the rest of its life on the 28th.
    """
    total = anchor.month - 1 + months
    year = anchor.year + total // 12
    month = total % 12 + 1
    return date(year, month, min(anchor.day, monthrange(year, month)[1]))


def _add_years(anchor: date, years: int) -> date:
    """`anchor` shifted by whole years. A Feb 29 anchor lands on Feb 28 in the
    three years out of four that have no Feb 29."""
    year = anchor.year + years
    return date(year, anchor.month, min(anchor.day, monthrange(year, anchor.month)[1]))


def occurrences(anchor: date, schedule: str, start: date, end: date) -> list[date]:
    """The dates `anchor`/`schedule` falls on within [start, end] inclusive.

    Never returns anything before the anchor: a meeting created on the 10th did
    not also happen on the 3rd, whatever its schedule says.

    An unknown schedule is treated as "Once" rather than raising - this runs
    inside a feed and a background thread, and one bad string in one row must
    not take out the calendar or stop everyone's reminders.
    """
    if anchor > end:
        return []
    lo = max(anchor, start)

    if schedule not in _RECURRING:
        return [anchor] if lo <= anchor <= end else []

    out: list[date] = []
    if schedule in _INTERVAL_DAYS:
        step = _INTERVAL_DAYS[schedule]
        # Jump straight to the first occurrence at or after `start` instead of
        # walking from the anchor: a Daily meeting anchored two years ago would
        # otherwise cost 700 iterations to produce a 30-day window.
        skipped = max(0, (lo - anchor).days // step)
        current = anchor + timedelta(days=skipped * step)
        while current < lo:
            current += timedelta(days=step)
        while current <= end and len(out) < MAX_OCCURRENCES:
            out.append(current)
            current += timedelta(days=step)
        return out

    step_fn = _add_months if schedule == "Monthly" else _add_years
    # Months and years aren't a fixed number of days, so these can't be jumped
    # to arithmetically the way the interval schedules are. The counts are small
    # (a year is 12 months), so walking is fine.
    n = 0
    while len(out) < MAX_OCCURRENCES:
        current = step_fn(anchor, n)
        if current > end:
            break
        if current >= lo:
            out.append(current)
        n += 1
    return out


def default_window(today: date) -> tuple[date, date]:
    """The date range the shared calendar feed expands over, around `today`."""
    return (
        today - timedelta(days=WINDOW_BACK_DAYS),
        today + timedelta(days=WINDOW_FORWARD_DAYS),
    )


def occurrence_strings(anchor: str, schedule: str, start: date, end: date) -> list[str]:
    """`occurrences()` over the "YYYY-MM-DD" strings the DB and API speak.

    An empty or unparseable anchor yields no dates: legacy meetings pre-date
    dates entirely, and a meeting that isn't on a day can't recur onto one.
    """
    if not anchor:
        return []
    try:
        parsed = date.fromisoformat(anchor)
    except ValueError:
        return []
    return [d.isoformat() for d in occurrences(parsed, schedule, start, end)]
