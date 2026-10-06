"""Regional weather for the Oderbruch (the same sky over all three farms).

Days are generated ahead: `state.forecast` holds the next FORECAST_DAYS days and is
exactly what then happens (no forecast error in this MVP), so the field agents can plan
against it. Every day is a plain dict with the Weather schema's keys.
"""
import random

from hub.clock import date_label

FORECAST_DAYS = 3


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _day(tick: int, temp: float, rain: float, wind: float, et0: float, humidity: float,
         hail: bool = False, note: str = "") -> dict:
    return {
        "date": date_label(tick),
        "temp_max_c": round(temp, 1),
        "rain_mm": round(rain, 1),
        "wind_ms": round(wind, 1),
        "et0_mm": round(et0, 1),
        "humidity_pct": int(round(humidity)),
        "hail": hail,
        "note": note,
    }


def normal_day(tick: int) -> dict:
    temp = random.uniform(21, 29)
    r = random.random()
    if r < 0.65:
        rain = 0.0
    elif r < 0.85:
        rain = random.uniform(0.5, 4)
    else:
        rain = random.uniform(5, 14)
    wind = random.triangular(1, 8, 3)  # (low, high, mode): mostly light, occasionally gusty
    et0 = _clamp(3.0 + (temp - 20) * 0.25 - rain * 0.05, 2.0, 5.5)
    humidity = random.uniform(50, 85) + (10 if rain > 0 else 0)
    return _day(tick, temp, rain, wind, et0, min(95, humidity))


def heatwave_day(tick: int) -> dict:
    return _day(
        tick,
        temp=random.uniform(33, 37),
        rain=0.0,
        wind=random.uniform(1.5, 4),
        et0=random.uniform(6.8, 7.8),
        humidity=random.uniform(30, 45),
        note="heatwave",
    )


def hail_day(tick: int) -> dict:
    return _day(
        tick,
        temp=27,
        rain=random.uniform(18, 30),
        wind=random.uniform(12, 16),
        et0=3.0,
        humidity=90,
        hail=True,
        note="hail storm",
    )


def calm_dry(day: dict) -> dict:
    """The same day made harvestable: no rain, light wind (the calm before the hail)."""
    return {**day, "rain_mm": 0.0, "wind_ms": round(random.uniform(2, 4), 1)}


def day_for(state, tick: int) -> dict:
    """Generate the weather for a (future) day, honouring active scenarios: the hail day
    wins over a heatwave; `heatwave_days_remaining` counts today as the first day."""
    if state.hail_tick is not None and tick == state.hail_tick:
        return hail_day(tick)
    if tick < state.tick + state.heatwave_days_remaining:
        return heatwave_day(tick)
    return normal_day(tick)
