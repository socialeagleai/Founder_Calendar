"""Unit tests for recurrence expansion. Pure functions - no server, no DB.

    cd backend && .venv/Scripts/python.exe -m pytest test_recurrence.py -q
"""

from datetime import date

from app.recurrence import MAX_OCCURRENCES, occurrence_strings, occurrences

D = date.fromisoformat


def test_once_returns_only_the_anchor():
    assert occurrences(D("2026-07-16"), "Once", D("2026-01-01"), D("2027-01-01")) == [
        D("2026-07-16")
    ]


def test_weekly_steps_by_seven_from_the_anchor():
    got = occurrences(D("2026-07-16"), "Weekly", D("2026-07-01"), D("2026-08-10"))
    assert got == [D("2026-07-16"), D("2026-07-23"), D("2026-07-30"), D("2026-08-06")]


def test_biweekly_steps_by_fourteen():
    got = occurrences(D("2026-07-16"), "Biweekly", D("2026-07-01"), D("2026-08-30"))
    assert got == [D("2026-07-16"), D("2026-07-30"), D("2026-08-13"), D("2026-08-27")]


def test_daily_covers_every_day_in_window():
    got = occurrences(D("2026-07-16"), "Daily", D("2026-07-16"), D("2026-07-20"))
    assert got == [D(f"2026-07-{d}") for d in (16, 17, 18, 19, 20)]


def test_never_returns_dates_before_the_anchor():
    # The window opens well before the meeting was ever scheduled.
    got = occurrences(D("2026-07-16"), "Daily", D("2026-01-01"), D("2026-07-18"))
    assert got == [D("2026-07-16"), D("2026-07-17"), D("2026-07-18")]


def test_anchor_after_window_yields_nothing():
    assert occurrences(D("2026-09-01"), "Weekly", D("2026-07-01"), D("2026-08-01")) == []


def test_interval_window_starting_mid_series_stays_on_the_anchor_cadence():
    # A weekly meeting anchored on a Thursday must still land on Thursdays when
    # the window opens months later - the fast-forward must not shift the phase.
    got = occurrences(D("2026-01-01"), "Weekly", D("2026-07-01"), D("2026-07-31"))
    assert got == [D("2026-07-02"), D("2026-07-09"), D("2026-07-16"), D("2026-07-23"), D("2026-07-30")]
    assert all(d.weekday() == D("2026-01-01").weekday() for d in got)


def test_monthly_clamps_from_the_anchor_not_the_previous_occurrence():
    # The one that every naive implementation gets wrong: Jan 31 -> Feb 28 ->
    # *Mar 31*. Walking from the clamped Feb 28 would give Mar 28 and the series
    # would never see the 31st again.
    got = occurrences(D("2026-01-31"), "Monthly", D("2026-01-01"), D("2026-05-01"))
    assert got == [D("2026-01-31"), D("2026-02-28"), D("2026-03-31"), D("2026-04-30")]


def test_monthly_crosses_the_year_boundary():
    got = occurrences(D("2026-11-15"), "Monthly", D("2026-11-01"), D("2027-02-01"))
    assert got == [D("2026-11-15"), D("2026-12-15"), D("2027-01-15")]


def test_yearly_leap_day_falls_back_to_feb_28():
    got = occurrences(D("2024-02-29"), "Yearly", D("2024-01-01"), D("2028-12-31"))
    assert got == [
        D("2024-02-29"),
        D("2025-02-28"),
        D("2026-02-28"),
        D("2027-02-28"),
        D("2028-02-29"),  # leap again - the anchor day comes back
    ]


def test_occurrence_cap_is_enforced():
    # Ten years of a daily meeting is ~3650 dates; the cap must hold.
    got = occurrences(D("2026-01-01"), "Daily", D("2026-01-01"), D("2036-01-01"))
    assert len(got) == MAX_OCCURRENCES


def test_unknown_schedule_degrades_to_once_rather_than_raising():
    # Runs inside a feed and a background thread: one bad string in one row must
    # not take out the calendar or stop everyone's reminders.
    assert occurrences(D("2026-07-16"), "Fortnightly?", D("2026-01-01"), D("2027-01-01")) == [
        D("2026-07-16")
    ]


def test_string_wrapper_round_trips():
    assert occurrence_strings("2026-07-16", "Weekly", D("2026-07-16"), D("2026-07-24")) == [
        "2026-07-16",
        "2026-07-23",
    ]


def test_legacy_rows_with_no_date_recur_nowhere():
    # Meetings created before meetings had dates. They must not appear anywhere,
    # and must never be reminded about.
    assert occurrence_strings("", "Weekly", D("2026-01-01"), D("2027-01-01")) == []


def test_unparseable_date_yields_nothing_rather_than_raising():
    assert occurrence_strings("not-a-date", "Weekly", D("2026-01-01"), D("2027-01-01")) == []
