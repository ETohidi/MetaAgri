"""Thorn: deterministic, LLM-free agronomic and legal safety rules for proposed actions."""
import copy
from typing import List, Optional, Tuple

from hub.schemas import Action, Proposal
from hub.state import COMBINES, M3_PER_MM_HA, OWN_FARM_NAME, SPRAYERS, WORKERS, HubState

RULE_PROPOSAL_SHAPE = "Every proposal needs a non-empty rationale and 0 <= confidence <= 1."
RULE_WATER_PERMIT = "Irrigation must stay within today's water permit."
RULE_NOT_IRRIGABLE = "Only fields with irrigation equipment can be irrigated."
RULE_SPRAY_WEATHER = "No spraying when wind > 5 m/s or > 5 mm rain is forecast for tomorrow."
RULE_PRE_HARVEST = "No spraying within 14 days of harvest (pre-harvest interval)."
RULE_HARVEST = "Harvest only ripe, unharvested crops on a dry day (< 2 mm rain)."
RULE_MACHINE = "Each machine can work one field per day."
RULE_WORKERS = "Never plan more work than workers available today."
RULE_FERTILIZE = "No fertilizing on waterlogged soil (> 90%), before heavy rain (> 10 mm tomorrow), or on harvested fields."
RULE_NEIGHBOUR_FARM = "borrow_combine and deliver_to need a named neighbour farm."
RULE_NEIGHBOUR_CAPACITY = "Blocked: that farm reports no spare capacity for this."
RULE_COVER_CROP = "Cover crops can only be sown on a harvested field without one."
RULE_DELIVER_SURPLUS = "deliver_to can only move grain that won't fit in our silo today."
RULE_ACTION_PARAMS = "irrigate needs mm > 0, fertilize needs kg_n_ha > 0, deliver_to needs tonnes > 0."

SPRAY_MAX_WIND_MS = 5.0
SPRAY_MAX_RAIN_TOMORROW_MM = 5.0
PRE_HARVEST_DAYS = 14
HARVEST_MAX_RAIN_MM = 2.0
FERTILIZE_MAX_MOISTURE = 90
FERTILIZE_MAX_RAIN_TOMORROW_MM = 10

# Resource cost per action (DESIGN.md section 6). Machines and water are booked in _book.
WORKERS_PER_ACTION = {
    "harvest": 2,
    "borrow_combine": 1,  # our grain cart; the neighbour brings the combine and its driver
    "spray": 1,
    "irrigate": 1,
    "fertilize": 1,
    "sow_cover_crop": 1,
}
# Evaluation order: the most valuable / most time-critical work claims resources first.
PRIORITY = {"harvest": 0, "borrow_combine": 0, "irrigate": 1, "spray": 2, "fertilize": 3, "sow_cover_crop": 4}
# The amount an action is about; a model that leaves it out (or sends 0) would otherwise get
# "Irrigate 0 mm" cleared, costing a worker and telling the neighbours about it.
REQUIRED_AMOUNT = {"irrigate": "mm", "fertilize": "kg_n_ha", "deliver_to": "tonnes"}
EPSILON = 1e-6  # float slack for summed tonnes / m³
DELIVER_ROUNDING_T = 0.05  # the Machinery ring rounds deliver_to tonnes to 0.1 t


def empty_usage() -> dict:
    return {
        "water_m3": 0.0,
        "workers": 0,
        "combine": 0,
        "sprayer": 0,
        "harvest_t": 0.0,
        "deliver_t": 0.0,
        "harvested_fields": [],
        "neighbour_combine": {},  # farm -> combines borrowed
        "neighbour_storage_t": {},  # farm -> tonnes delivered
    }


def water_m3(action: Action, area_ha: float) -> float:
    return (action.mm or 0.0) * area_ha * M3_PER_MM_HA


def _book(usage: dict, field: str, action: Action, state: HubState) -> None:
    """Add an allowed action's resource use to `usage`."""
    f = state.fields[field]
    usage["workers"] += WORKERS_PER_ACTION.get(action.type, 0)
    if action.type == "irrigate":
        usage["water_m3"] += water_m3(action, f.area_ha)
    elif action.type == "spray":
        usage["sprayer"] += 1
    elif action.type in ("harvest", "borrow_combine"):
        if action.type == "harvest":
            usage["combine"] += 1
        else:
            usage["neighbour_combine"][action.farm] = usage["neighbour_combine"].get(action.farm, 0) + 1
        usage["harvest_t"] += f.yield_estimate_t
        usage["harvested_fields"].append(field)
    elif action.type == "deliver_to":
        tonnes = action.tonnes or 0.0
        usage["deliver_t"] += tonnes
        usage["neighbour_storage_t"][action.farm] = usage["neighbour_storage_t"].get(action.farm, 0.0) + tonnes


def usage_of(proposals: List[Proposal], state: HubState) -> dict:
    """Resource use of already-cleared proposals, so a second pass (the Machinery ring's
    suggestions) can continue from where the first pass left off."""
    usage = empty_usage()
    for p in proposals:
        for a in p.actions:
            _book(usage, p.field, a, state)
    return usage


def _neighbour_share(state: HubState, farm: Optional[str], key: str) -> float:
    """What a farm reported it can share; our own farm or an unknown one counts as zero."""
    if not farm or farm == OWN_FARM_NAME:
        return 0.0
    return float(state.nearby_capacity.get(farm, {}).get("can_share", {}).get(key, 0) or 0)


def _broken_rule(action: Action, field: str, state: HubState, usage: dict) -> Optional[str]:
    """The rule this action would break given what is already booked, or None."""
    f = state.fields[field]
    today, tomorrow = state.weather_today, state.forecast[0]
    t = action.type

    if t in REQUIRED_AMOUNT and not (getattr(action, REQUIRED_AMOUNT[t]) or 0) > 0:
        return RULE_ACTION_PARAMS
    if t in ("borrow_combine", "deliver_to") and not action.farm:
        return RULE_NEIGHBOUR_FARM
    if t in ("harvest", "borrow_combine"):
        if not f.harvest_ready or field in usage["harvested_fields"] or today["rain_mm"] >= HARVEST_MAX_RAIN_MM:
            return RULE_HARVEST
        if t == "harvest" and usage["combine"] + 1 > COMBINES:
            return RULE_MACHINE
        if t == "borrow_combine":
            borrowed = usage["neighbour_combine"].get(action.farm, 0)
            if borrowed + 1 > _neighbour_share(state, action.farm, "combine"):
                return RULE_NEIGHBOUR_CAPACITY
    elif t == "irrigate":
        if not f.irrigable:
            return RULE_NOT_IRRIGABLE
        if usage["water_m3"] + water_m3(action, f.area_ha) > state.water_permit_m3 + EPSILON:
            return RULE_WATER_PERMIT
    elif t == "spray":
        if today["wind_ms"] > SPRAY_MAX_WIND_MS or tomorrow["rain_mm"] > SPRAY_MAX_RAIN_TOMORROW_MM:
            return RULE_SPRAY_WEATHER
        if not f.harvested and f.days_to_harvest <= PRE_HARVEST_DAYS:
            return RULE_PRE_HARVEST
        if usage["sprayer"] + 1 > SPRAYERS:
            return RULE_MACHINE
    elif t == "fertilize":
        if f.harvested or f.soil_moisture > FERTILIZE_MAX_MOISTURE or tomorrow["rain_mm"] > FERTILIZE_MAX_RAIN_TOMORROW_MM:
            return RULE_FERTILIZE
    elif t == "deliver_to":
        capacity = _neighbour_share(state, action.farm, "storage_t")
        delivered = usage["neighbour_storage_t"].get(action.farm, 0.0)
        if capacity <= 0 or delivered + (action.tonnes or 0.0) > capacity + EPSILON:
            return RULE_NEIGHBOUR_CAPACITY
        # Only the part of today's cleared harvests that doesn't fit in our silo can go to a
        # neighbour (harvests are checked first, see PRIORITY), minus what's already sent.
        surplus_left = max(0.0, usage["harvest_t"] - state.storage_free_t - usage["deliver_t"])
        if (action.tonnes or 0.0) > surplus_left + DELIVER_ROUNDING_T + EPSILON:
            return RULE_DELIVER_SURPLUS
    elif t == "sow_cover_crop":
        if not f.harvested or f.cover_crop:
            return RULE_COVER_CROP
    # scout, defer_task: nothing to check beyond workers (they need none)

    if usage["workers"] + WORKERS_PER_ACTION.get(t, 0) > WORKERS:
        return RULE_WORKERS
    return None


def _shape_ok(p: Proposal) -> bool:
    return bool(p.rationale.strip()) and 0.0 <= p.confidence <= 1.0


def passes_alone(p: Proposal, action: Action, state: HubState) -> bool:
    """Would this action clear the safety check if it were the only work planned today?
    The Coordinator asks before a harvest or spray competes for a machine, so an action
    that will be blocked anyway (crop not ripe, pre-harvest interval, ...) can't win it."""
    return _shape_ok(p) and _broken_rule(action, p.field, state, empty_usage()) is None


def _entry(field: str, action: Action, blocked: bool, rule: Optional[str]) -> dict:
    return {"field": field, "action": action.model_dump(exclude_none=True), "blocked": blocked, "rule": rule}


def resources_before(state: HubState) -> dict:
    return {
        "water_m3": float(state.water_permit_m3),
        "workers": WORKERS,
        "combine": COMBINES,
        "sprayer": SPRAYERS,
        "storage_free_t": round(state.storage_free_t, 1),
    }


def evaluate(
    proposals: List[Proposal], state: HubState, starting_usage: Optional[dict] = None
) -> Tuple[List[dict], List[Proposal], dict, dict]:
    """starting_usage lets a second pass (the Machinery ring's suggestions, evaluated after
    the field agents' own proposals) continue from the first pass's resource use instead
    of starting from a fresh day. The returned `before` is always today's availability."""
    usage = copy.deepcopy(starting_usage) if starting_usage is not None else empty_usage()
    thorn_entries: List[dict] = []

    valid_proposals: List[Proposal] = []
    for p in proposals:
        if not _shape_ok(p):
            for a in p.actions:
                thorn_entries.append(_entry(p.field, a, True, RULE_PROPOSAL_SHAPE))
            continue
        valid_proposals.append(p)

    def priority(ij: Tuple[int, int]) -> tuple:
        i, j = ij
        p, a = valid_proposals[i], valid_proposals[i].actions[j]
        group = PRIORITY.get(a.type, 5)
        # irrigation: the driest field (relative to its stress threshold) first
        dryness = state.fields[p.field].soil_moisture - state.fields[p.field].stress_threshold if a.type == "irrigate" else 0
        return (group, dryness, i, j)

    order = sorted(((i, j) for i, p in enumerate(valid_proposals) for j in range(len(p.actions))), key=priority)

    allowed: set[Tuple[int, int]] = set()
    for i, j in order:
        p, a = valid_proposals[i], valid_proposals[i].actions[j]
        rule = _broken_rule(a, p.field, state, usage)
        if rule is None:
            _book(usage, p.field, a, state)
            allowed.add((i, j))
        thorn_entries.append(_entry(p.field, a, rule is not None, rule))

    filtered_proposals = [
        p.model_copy(update={"actions": [a for j, a in enumerate(p.actions) if (i, j) in allowed]})
        for i, p in enumerate(valid_proposals)
    ]

    before = resources_before(state)
    free = before["storage_free_t"]
    # Harvests fill the silo first; deliver_to only ever moves the part that didn't fit,
    # so it relieves the surplus but never frees our own storage (same as apply_bundle).
    surplus = max(0.0, usage["harvest_t"] - free)
    after = {
        "water_m3": before["water_m3"] - usage["water_m3"],
        "workers": before["workers"] - usage["workers"],
        "combine": before["combine"] - usage["combine"],
        "sprayer": before["sprayer"] - usage["sprayer"],
        "storage_free_t": round(max(0.0, free - usage["harvest_t"] + min(usage["deliver_t"], surplus)), 1),
    }
    return thorn_entries, filtered_proposals, before, after
