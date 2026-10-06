"""Calendar for the sim. The season starts Monday 6 July 2026; one tick = one day.

The tick counter stays internal to the sim (ripening, spray intervals, plan expiry etc.
all still work in ticks) - this module is the single place that maps a tick to
something a human should actually see.
"""
from datetime import date, timedelta

SEASON_START = date(2026, 7, 6)  # a Monday


def tick_to_date(tick: int) -> date:
    return SEASON_START + timedelta(days=tick)


def date_label(tick: int) -> str:
    """'Mon 6 Jul' (built by hand: %-d isn't portable)."""
    d = tick_to_date(tick)
    return f"{d:%a} {d.day} {d:%b}"


def long_date(tick: int) -> str:
    """'Monday 6 July'"""
    d = tick_to_date(tick)
    return f"{d:%A} {d.day} {d:%B}"
