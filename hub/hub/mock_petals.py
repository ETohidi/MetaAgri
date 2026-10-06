"""Canned but sensible proposals per field, used when PETAL_MODE=mock (and as the
flower/grid fallback when a field agent doesn't answer in time)."""
import math

from hub.schemas import Action, FieldCensus, Proposal
from hub.state import CROPS, FIELD_DISPLAY_NAME, M3_PER_MM_HA, HubState
from hub.thorn import HARVEST_MAX_RAIN_MM

IRRIGATION_TARGET_PCT = 90  # refill towards this
IRRIGATION_TRIGGER_MARGIN = 10  # irrigate if heading within this of the stress threshold
IRRIGATION_MIN_MM, IRRIGATION_MAX_MM = 10, 25
IRRIGATION_USEFUL_MM = 5  # below this a pass isn't worth running the reel
LOOKAHEAD_DAYS = 2
SPRAY_DISEASE_PRESSURE = 0.6
SPRAY_INTERVAL_DAYS = 7
SCOUT_DAYS = 3
COVER_CROP_MAX_RAIN_MM = 10  # nobody drills into waterlogged stubble (or in a hail storm)


def _with_rejection_note(rationale: str, recent_rejections: list[str]) -> str:
    if recent_rejections:
        return f"{rationale} (Noting recent rejection: {recent_rejections[-1]})"
    return rationale


def _round_to_5(x: float) -> int:
    return int(5 * round(x / 5))


def _plural_days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def _harvested(census: FieldCensus) -> tuple[list[Action], str, float]:
    if not census.cover_crop:
        crop = census.crop.split()[-1]
        rain = census.weather_today.rain_mm
        if census.weather_today.hail or rain >= COVER_CROP_MAX_RAIN_MM:
            reason = f"{crop.capitalize()} stubble too wet after {rain:.1f} mm rain; drilling the cover crop once the soil dries."
            return [Action(type="defer_task", confidence=0.7, reason=reason)], "Field harvested; waiting for the soil to dry before sowing a cover crop.", 0.7
        reason = f"{crop.capitalize()} is off the field; a cover crop protects the soil and holds nitrogen."
        return [Action(type="sow_cover_crop", confidence=0.8, reason=reason)], "Field harvested; sowing a cover crop.", 0.8
    return [], "Field harvested and cover crop established; no action needed.", 0.6


def _ripe_cereal(census: FieldCensus) -> tuple[list[Action], str, float]:
    crop = census.crop.split()[-1]
    rain = census.weather_today.rain_mm
    hail_day = next((w for w in census.forecast if w.hail), None)
    dry = rain < HARVEST_MAX_RAIN_MM
    if dry or hail_day is not None:
        confidence = 0.85 if dry else 0.5
        if hail_day is not None:
            reason = f"Hail expected {hail_day.date}; harvesting ripe {crop} now."
        else:
            reason = f"{crop} ripe; dry day, ~{census.yield_estimate_t:.0f} t expected."
        action = Action(type="harvest", confidence=confidence, reason=reason)
        return [action], f"{crop.capitalize()} is ripe; harvesting today (~{census.yield_estimate_t:.0f} t).", confidence
    reason = f"{crop} ripe but {rain:.1f} mm rain today - too wet to harvest."
    return [Action(type="defer_task", confidence=0.7, reason=reason)], f"{crop.capitalize()} ripe but too wet; waiting for a dry day.", 0.7


def _moisture_word(crop: str) -> str:
    """Rapeseed is an oilseed: its harvest moisture is seed moisture, not grain moisture."""
    return "seed" if crop == "rapeseed" else "grain"


def _ripening_cereal(census: FieldCensus) -> tuple[list[Action], str, float]:
    crop = census.crop.split()[-1]
    days = _plural_days(census.days_to_harvest)
    reason = f"{crop} ripening, {days} to harvest; checking {_moisture_word(census.crop)} moisture."
    return [Action(type="scout", confidence=0.7, reason=reason)], f"{crop.capitalize()} close to ripe ({days}); scouting.", 0.7


def _irrigable(census: FieldCensus) -> tuple[list[Action], str, float]:
    kc = CROPS[census.crop]["kc"]
    next_days = census.forecast[:LOOKAHEAD_DAYS]
    water_use = sum(w.et0_mm * kc for w in next_days)
    rain = sum(w.rain_mm for w in next_days)
    projected = census.soil_moisture_pct - water_use + rain
    threshold = census.stress_threshold_pct
    permit = census.resources.water_permit_m3

    actions: list[Action] = []
    notes: list[str] = []
    if projected < threshold + IRRIGATION_TRIGGER_MARGIN:
        mm = max(IRRIGATION_MIN_MM, min(IRRIGATION_MAX_MM, _round_to_5(IRRIGATION_TARGET_PCT - projected)))
        fit_to_permit = bool(census.recent_rejections)
        if fit_to_permit:
            # After pushback from the farm manager: stay inside today's permit.
            mm = min(mm, math.floor(permit / (census.area_ha * M3_PER_MM_HA)))
        if mm >= IRRIGATION_USEFUL_MM:
            reason = (
                f"Soil moisture {census.soil_moisture_pct:.0f}%; forecast {water_use:.1f} mm crop water use vs "
                f"{rain:.1f} mm rain over {LOOKAHEAD_DAYS} days (heading for ~{projected:.0f}%, stress below {threshold:.0f}%)."
            )
            actions.append(Action(type="irrigate", mm=mm, confidence=0.75 if fit_to_permit else 0.8, reason=reason))
            note = f"irrigating {mm:g} mm ({mm * census.area_ha * M3_PER_MM_HA:,.0f} m³)"
            if fit_to_permit:
                note += f", fitted to today's {permit:,} m³ water permit"
            notes.append(note)
        else:
            notes.append(f"soil drying but today's {permit:,} m³ permit is too small for a useful pass")

    recently_sprayed = census.days_since_sprayed is not None and census.days_since_sprayed <= SPRAY_INTERVAL_DAYS
    if census.disease_pressure >= SPRAY_DISEASE_PRESSURE and not recently_sprayed:
        reason = f"Blight pressure {census.disease_pressure:.2f} and no spray in the last {SPRAY_INTERVAL_DAYS} days."
        actions.append(Action(type="spray", product="fungicide", confidence=0.7, reason=reason))
        notes.append("spraying fungicide against blight")

    if not notes:
        return [], "Crop within normal range; no action needed.", 0.6
    head = f"Soil at {census.soil_moisture_pct:.0f}%, heading for ~{projected:.0f}% over the next {LOOKAHEAD_DAYS} days"
    rationale = f"{head}; {' and '.join(notes)}."
    confidence = min((a.confidence for a in actions), default=0.6)
    return actions, rationale, confidence


def generate(field: str, state: HubState) -> Proposal:
    census = state.census(field)
    cereal = CROPS[census.crop]["cereal"]
    if census.harvested:
        actions, rationale, confidence = _harvested(census)
    elif cereal and census.harvest_ready:
        actions, rationale, confidence = _ripe_cereal(census)
    elif cereal and 1 <= census.days_to_harvest <= SCOUT_DAYS:
        actions, rationale, confidence = _ripening_cereal(census)
    elif census.irrigable:
        actions, rationale, confidence = _irrigable(census)
    else:
        actions, rationale, confidence = [], "Crop within normal range; no action needed.", 0.6

    risks = []
    if any(a.type == "harvest" for a in actions):
        risks.append(f"{_moisture_word(census.crop)} moisture may need drying")
    if any(a.type == "irrigate" for a in actions):
        risks.append(f"{FIELD_DISPLAY_NAME[field]} water use competes with the permit")
    return Proposal(
        field=field,
        actions=actions,
        rationale=_with_rejection_note(rationale, census.recent_rejections),
        confidence=confidence,
        risks=risks,
    )
