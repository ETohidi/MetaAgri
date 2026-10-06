"""Plain-Python daily simulation: weather roll, soil water balance, ripening, crop health,
disease, the heatwave / hail scenarios and neighbour-farm drift. One step = one day."""
import random

from hub import weather
from hub.clock import date_label
from hub.state import CROPS, FIELD_DISPLAY_NAME, WATER_PERMIT_HEATWAVE_M3, WATER_PERMIT_NORMAL_M3

# crop health
STRESS_BASE_LOSS = 0.015
STRESS_LOSS_PER_PCT = 0.003  # per % point of soil moisture below the stress threshold
HEALTH_RECOVERY = 0.004
DISEASE_DAMAGE_THRESHOLD = 0.7
DISEASE_HEALTH_LOSS = 0.02
HEALTH_MIN, HEALTH_MAX = 0.2, 0.95

# disease (potato blight likes it wet and humid, dislikes it hot and dry)
BLIGHT_RISE = 0.07
BLIGHT_RAIN_MM = 3
BLIGHT_HUMIDITY_PCT = 80
HOT_DRY_DECLINE = 0.02
HOT_DRY_TEMP_C = 30
SPRAY_PROTECTION_DAYS = 7
SPRAY_PROTECTION_FACTOR = 0.3  # a recent spray cuts the daily rise to 30%
CEREAL_DISEASE_NOISE = 0.01

# scenarios
HEATWAVE_DAYS = 4  # today + the 3 forecast days
HAIL_LEAD_DAYS = 2  # the storm hits the day after tomorrow
HAIL_EARLY_HARVEST_DAYS = 4  # cereals this close to ripe get rushed / get hit
HAIL_CEREAL_LOSS = 0.4
HAIL_POTATO_HEALTH_LOSS = 0.08

# neighbour drift
NEIGHBOUR_STORAGE_FILL_MAX_T = 25
NEIGHBOUR_ET_FACTOR = 0.9
NEIGHBOUR_MOISTURE_REFILL = 2  # their own irrigation / groundwater, per day
NEIGHBOUR_MOISTURE_MIN, NEIGHBOUR_MOISTURE_MAX = 10, 95


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _update_field(state, f, today: dict, heatwave_active: bool) -> None:
    # 1. soil water balance (irrigation is added at approval time, not here)
    et = today["et0_mm"] * f.kc
    f.soil_moisture = _clamp(f.soil_moisture + today["rain_mm"] - et, 0, 100)
    if f.harvested:
        return

    # 2. ripening
    info = CROPS[f.crop]
    if info["cereal"]:
        f.days_to_harvest -= 2 if heatwave_active else 1
        if f.harvest_ready:
            f.harvest_waiting_days += 1
            f.yield_t_ha *= 1 - info["daily_ripe_loss"]
    else:
        f.days_to_harvest -= 1

    # 3. health
    threshold = info["stress_threshold"]
    if f.soil_moisture < threshold:
        f.health -= STRESS_BASE_LOSS + STRESS_LOSS_PER_PCT * (threshold - f.soil_moisture)
    else:
        f.health += HEALTH_RECOVERY
    if f.disease > DISEASE_DAMAGE_THRESHOLD:
        f.health -= DISEASE_HEALTH_LOSS
    f.health = _clamp(f.health, HEALTH_MIN, HEALTH_MAX)

    # 4. disease
    if info["cereal"]:
        f.disease += random.uniform(-CEREAL_DISEASE_NOISE, CEREAL_DISEASE_NOISE)
    else:
        rise = 0.0
        if today["rain_mm"] >= BLIGHT_RAIN_MM or today["humidity_pct"] >= BLIGHT_HUMIDITY_PCT:
            rise += BLIGHT_RISE
            recently_sprayed = f.last_sprayed_tick is not None and state.tick - f.last_sprayed_tick <= SPRAY_PROTECTION_DAYS
            if recently_sprayed:
                rise *= SPRAY_PROTECTION_FACTOR
        if today["temp_max_c"] >= HOT_DRY_TEMP_C and today["rain_mm"] == 0:
            rise -= HOT_DRY_DECLINE
        f.disease += rise
    f.disease = _clamp(f.disease, 0, 1)
    # 5./6. yield estimate and stage are derived from the above (FieldState properties)


def _hail_strikes(state) -> None:
    for name, f in state.fields.items():
        if f.harvested:
            continue
        if f.cereal and f.days_to_harvest <= HAIL_EARLY_HARVEST_DAYS:
            f.yield_t_ha *= 1 - HAIL_CEREAL_LOSS
            state.add_log(
                actor="Farm",
                level="warn",
                text=f"Hail hit {FIELD_DISPLAY_NAME[name]}: {f.crop} lost {HAIL_CEREAL_LOSS:.0%}",
            )
        elif not f.cereal:
            f.health = max(HEALTH_MIN, f.health - HAIL_POTATO_HEALTH_LOSS)
            state.add_log(
                actor="Farm",
                level="warn",
                text=f"Hail hit {FIELD_DISPLAY_NAME[name]}: {f.short_crop.removesuffix('es')} leaves shredded, crop health down {HAIL_POTATO_HEALTH_LOSS:.2f}",
            )
    state.hail_tick = None


def _drift_neighbours(state, today: dict) -> None:
    for n in state.neighbours.values():
        n["storage_used_t"] = min(n["storage_capacity_t"], n["storage_used_t"] + random.uniform(0, NEIGHBOUR_STORAGE_FILL_MAX_T))
        n["combine_available"] = 1 if random.random() > n["combine_busy_prob"] else 0
        if state.hail_warning_active and n["cereal_heavy"]:
            n["combine_available"] = 0  # busy getting their own ripe crop in before the storm
        n["avg_soil_moisture"] = _clamp(
            n["avg_soil_moisture"] + today["rain_mm"] - today["et0_mm"] * NEIGHBOUR_ET_FACTOR + NEIGHBOUR_MOISTURE_REFILL,
            NEIGHBOUR_MOISTURE_MIN,
            NEIGHBOUR_MOISTURE_MAX,
        )


def _expire_stale_plans(state) -> None:
    for b in state.bundles:
        if b["status"] == "pending" and b["tick"] < state.tick:
            b["status"] = "expired"
            state.add_log(actor="Farm", level="info", text=f"the {b['plan_for']} plan expired undecided")


def step(state) -> None:
    state.tick += 1
    tick = state.tick
    state.own_combine_busy = False

    # Heatwave countdown first, so the day appended to the forecast below already knows
    # whether the heatwave still covers it.
    if state.heatwave_days_remaining > 0:
        state.heatwave_days_remaining -= 1
        if state.heatwave_days_remaining == 0:
            state.water_permit_m3 = WATER_PERMIT_NORMAL_M3
            state.add_log(
                actor="Farm",
                level="info",
                text=f"heatwave over: water permit back to {WATER_PERMIT_NORMAL_M3:,} m³/day",
            )

    state.weather_today = state.forecast.pop(0)
    state.forecast.append(weather.day_for(state, tick + weather.FORECAST_DAYS))
    today = state.weather_today

    heatwave_active = state.heatwave_days_remaining > 0
    for f in state.fields.values():
        _update_field(state, f, today, heatwave_active)

    if state.hail_tick is not None and tick == state.hail_tick:
        _hail_strikes(state)

    _drift_neighbours(state, today)
    _expire_stale_plans(state)
    state.recent_actions = []
    state.record_history()
    state.record_farm_history()


def start_heatwave(state) -> str:
    state.heatwave_days_remaining = HEATWAVE_DAYS
    state.water_permit_m3 = WATER_PERMIT_HEATWAVE_M3
    if not state.weather_today["hail"]:
        state.weather_today = weather.heatwave_day(state.tick)
    for i in range(len(state.forecast)):
        day_tick = state.tick + 1 + i
        if day_tick < state.tick + HEATWAVE_DAYS and day_tick != state.hail_tick:
            state.forecast[i] = weather.heatwave_day(day_tick)
    state.add_log(
        actor="Farm",
        level="warn",
        text=f"Heatwave for {HEATWAVE_DAYS} days: the water authority cut the permit to {WATER_PERMIT_HEATWAVE_M3:,} m³/day",
    )
    return state.heatwave_message()


def hail_warning(state) -> str:
    if state.hail_warning_active:
        return state.hail_message()
    state.hail_tick = state.tick + HAIL_LEAD_DAYS
    state.forecast[0] = weather.calm_dry(state.forecast[0])
    state.forecast[1] = weather.hail_day(state.hail_tick)
    for f in state.fields.values():
        if f.cereal and not f.harvested and 0 < f.days_to_harvest <= HAIL_EARLY_HARVEST_DAYS:
            f.days_to_harvest = 1  # harvest early before the hail: ready tomorrow
    state.add_log(
        actor="Farm",
        level="warn",
        text=(
            f"Hail warning: severe hail expected {date_label(state.hail_tick)}; "
            f"{date_label(state.tick + 1)} stays dry, so the ripening wheat and rapeseed can come in early"
        ),
    )
    return state.hail_message()
