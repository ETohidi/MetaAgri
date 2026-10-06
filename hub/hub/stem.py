"""Stem: rule-based bundling of the field agents' proposals into one plan for the day
(the Coordinator), including machine-conflict resolution and the Machinery ring's
neighbour-help suggestions (borrow a combine, deliver surplus grain)."""
from typing import Dict, List, Tuple

from hub import thorn
from hub.clock import date_label
from hub.schemas import Action, Proposal
from hub.state import CROPS, FIELD_AGENT_NAME, FIELD_DISPLAY_NAME, OWN_FARM_NAME, HubState

MACHINE_FOR_ACTION = {"harvest": "combine", "spray": "sprayer"}  # one of each on our farm
SURPLUS_MIN_T = 0.5  # below this, a silo overflow is rounding noise, not worth a trip


def _join(names: List[str]) -> str:
    """['a'] -> 'a', ['a', 'b'] -> 'a and b', ['a', 'b', 'c'] -> 'a, b and c'."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _euro_k(value: float) -> str:
    return f"€{value / 1000:.0f}k"


def _value_at_risk(state: HubState, field: str, action_type: str) -> float:
    f = state.fields[field]
    value = f.yield_estimate_t * CROPS[f.crop]["price_eur_t"]
    if action_type == "spray":
        value *= f.disease  # what the disease could take
    return value


def _resolve_conflicts(state: HubState, proposals: List[Proposal]) -> Tuple[List[Proposal], List[str]]:
    """More than one field wants the combine (harvest) or the sprayer (spray) today ->
    keep the field with the most value at risk, drop the others. Returns the resolved
    proposals and the fields that lost the combine (candidates for a borrowed one).
    Only work that could pass the safety check competes: an unripe harvest or a spray
    inside the pre-harvest interval stays in its proposal for the safety check to block,
    and never takes the machine from a field that could use it."""
    result = [p.model_copy(deep=True) for p in proposals]
    unmet_harvest: List[str] = []

    for action_type, machine in MACHINE_FOR_ACTION.items():
        wanting: List[str] = []
        for p in result:
            if p.field not in wanting and any(a.type == action_type and thorn.passes_alone(p, a, state) for a in p.actions):
                wanting.append(p.field)
        if len(wanting) <= 1:
            continue

        values = {f: _value_at_risk(state, f, action_type) for f in wanting}
        winner = max(wanting, key=lambda f: values[f])
        losers = [f for f in wanting if f != winner]
        for p in result:
            if p.field in losers:
                p.actions = [a for a in p.actions if a.type != action_type]
        if action_type == "harvest":
            unmet_harvest.extend(losers)

        loser_names = [FIELD_DISPLAY_NAME[f] for f in losers]
        state.add_log(
            actor="Coordinator",
            level="info",
            text=(
                f"conflict: the {machine} was requested by {_join([FIELD_DISPLAY_NAME[f] for f in wanting])}; "
                f"kept {FIELD_DISPLAY_NAME[winner]} ({_euro_k(values[winner])} at risk vs "
                f"{', '.join(_euro_k(values[f]) for f in losers)}), "
                f"{_join(loser_names)} {'waits' if len(losers) == 1 else 'wait'}"
            ),
        )

    return result, unmet_harvest


def _what(state: HubState, field: str, action: Action) -> str:
    f = state.fields[field]
    t = action.type
    if t == "irrigate":
        return f"Irrigate {action.mm or 0:g} mm"
    if t == "harvest":
        return f"Harvest ~{f.yield_estimate_t:.0f} t"
    if t == "borrow_combine":
        return f"Harvest with {action.farm}'s combine (~{f.yield_estimate_t:.0f} t)"
    if t == "deliver_to":
        return f"Deliver {action.tonnes or 0:.0f} t to {action.farm}"
    if t == "spray":
        return f"Spray {action.product or 'crop protection'}"
    if t == "fertilize":
        return f"Fertilize {action.kg_n_ha:g} kg N/ha" if action.kg_n_ha else "Fertilize"
    if t == "scout":
        return "Scout field"
    if t == "sow_cover_crop":
        return "Sow cover crop"
    return "Wait"  # defer_task


def _resources_text(state: HubState, field: str, action: Action) -> str:
    t = action.type
    if t == "irrigate":
        return f"{thorn.water_m3(action, state.fields[field].area_ha):,.0f} m³ water · 1 worker"
    if t == "harvest":
        return "combine · 2 workers"
    if t == "borrow_combine":
        return f"{action.farm}'s combine · 1 worker"
    if t == "spray":
        return "sprayer · 1 worker"
    if t in ("fertilize", "sow_cover_crop"):
        return "1 worker"
    return "—"


def _plan_row(state: HubState, field: str, action: Action, proposal: Proposal) -> dict:
    return {
        "field": field,
        "crop": state.fields[field].crop,
        "action_type": action.type,
        "what": _what(state, field, action),
        "resources": _resources_text(state, field, action),
        "confidence": action.confidence if action.confidence is not None else proposal.confidence,
        "reason": action.reason or proposal.rationale,
    }


def _best_neighbour(farm_capacity: dict, remaining: dict, key: str, needed: float) -> str | None:
    """Highest-confidence neighbour (never our own farm) with at least `needed` of `key`
    still left in `remaining`; ties go to the one with the most storage to spare."""
    candidates = [name for name in remaining if name != OWN_FARM_NAME and remaining[name].get(key, 0) >= needed]
    if not candidates:
        return None
    return max(candidates, key=lambda name: (farm_capacity[name]["confidence"], remaining[name].get("storage_t", 0)))


def _suggest_neighbour_help(
    state: HubState, filtered_proposals: List[Proposal], farm_capacity: dict, unmet_harvest: List[str]
) -> List[Proposal]:
    """(a) a ripe field that lost the combine conflict gets a borrowed neighbour combine;
    (b) grain that won't fit in our silo gets deliver_to actions to neighbours with space.
    Everything starts from what the field agents' own cleared actions already use (a
    field agent may have borrowed a combine or sent grain to a neighbour itself), and
    capacity is decremented locally as it's allocated, so one neighbour is never
    over-subscribed; the safety check independently re-verifies against what each farm
    actually reported."""
    usage = thorn.usage_of(filtered_proposals, state)
    remaining = {name: dict(cap.get("can_share", {})) for name, cap in farm_capacity.items() if name != OWN_FARM_NAME}
    for name, share in remaining.items():
        share["combine"] = share.get("combine", 0) - usage["neighbour_combine"].get(name, 0)
        share["storage_t"] = share.get("storage_t", 0) - usage["neighbour_storage_t"].get(name, 0.0)
    actions_by_field: Dict[str, List[Action]] = {}
    borrowed: List[str] = []

    for field in unmet_harvest:
        if not state.fields[field].harvest_ready or field in usage["harvested_fields"]:
            continue
        name = _best_neighbour(farm_capacity, remaining, "combine", 1)
        if name is None:
            state.add_log(
                actor="Machinery ring",
                level="warn",
                text=f"no neighbour combine free today; {FIELD_DISPLAY_NAME[field]} waits",
            )
            continue
        remaining[name]["combine"] -= 1
        confidence = farm_capacity[name]["confidence"]
        actions_by_field.setdefault(field, []).append(
            Action(
                type="borrow_combine",
                farm=name,
                confidence=confidence,
                reason=(
                    f"Our combine is busy elsewhere and the {state.fields[field].short_crop} is ripe; "
                    f"{name} can lend theirs today (confidence {confidence:.2f})."
                ),
            )
        )
        borrowed.append(field)

    # Size the surplus only on borrows the safety check will clear (the same check pass 2
    # runs: harvests and borrows go first, from the same usage), so a blocked borrow never
    # leaves a delivery of grain that is still on the field.
    if borrowed:
        borrow_proposals = [
            Proposal(field=f, actions=actions_by_field[f], rationale="Machinery ring", confidence=1.0) for f in borrowed
        ]
        _, cleared, _, _ = thorn.evaluate(borrow_proposals, state, starting_usage=usage)
        usage = thorn.usage_of(filtered_proposals + cleared, state)
        borrowed = [p.field for p in cleared if p.actions]

    expected_t = usage["harvest_t"]
    free = state.storage_free_t
    surplus = expected_t - free - usage["deliver_t"]
    if surplus > SURPLUS_MIN_T:
        grain_field = borrowed[-1] if borrowed else usage["harvested_fields"][-1]
        left = surplus
        # Stop once what's left isn't worth a trailer trip (no "Deliver 0 t to ..." rows); a
        # small remainder is sold with the rest at the spot price.
        while left > SURPLUS_MIN_T:
            name = _best_neighbour(farm_capacity, remaining, "storage_t", SURPLUS_MIN_T)
            if name is None:
                break
            tonnes = min(round(left, 1), remaining[name]["storage_t"])
            remaining[name]["storage_t"] -= tonnes
            left -= tonnes
            confidence = farm_capacity[name]["confidence"]
            actions_by_field.setdefault(grain_field, []).append(
                Action(
                    type="deliver_to",
                    farm=name,
                    tonnes=tonnes,
                    confidence=confidence,
                    reason=(
                        f"~{expected_t:.0f} t coming in today but only {free:.0f} t free in our silo; "
                        f"{name} reports {farm_capacity[name]['can_share'].get('storage_t', 0):.0f} t spare storage."
                    ),
                )
            )
        if left > SURPLUS_MIN_T:
            state.add_log(
                actor="Machinery ring",
                level="warn",
                text=f"neighbours can't store all of it; about {left:.0f} t would be sold directly at the harvest spot price",
            )

    proposals = []
    for field, actions in actions_by_field.items():
        parts = []
        for a in actions:
            if a.type == "borrow_combine":
                parts.append(f"borrow {a.farm}'s combine for {FIELD_DISPLAY_NAME[field]}")
            else:
                parts.append(f"send {a.tonnes:.0f} t surplus to {a.farm}")
        risks = []
        if any(a.type == "borrow_combine" for a in actions):
            risks.append("the neighbour's combine may arrive late")
        if any(a.type == "deliver_to" for a in actions):
            risks.append("trailer trips to the neighbour's silo")
        proposals.append(
            Proposal(
                field=field,
                actions=actions,
                rationale=f"Machinery ring: {'; '.join(parts)}.",
                confidence=min(a.confidence for a in actions),
                risks=risks,
            )
        )
    return proposals


def _log_blocks(state: HubState, entries: List[dict]) -> None:
    for e in entries:
        if e["blocked"]:
            state.add_log(
                actor="Safety check",
                level="block",
                text=f"blocked {e['action'].get('type')} for {FIELD_DISPLAY_NAME.get(e['field'], e['field'])}: {e['rule']}",
            )


def build_bundle(state: HubState, proposals: List[Proposal], farm_capacity: dict) -> dict:
    for p in proposals:
        state.add_log(
            actor=FIELD_AGENT_NAME.get(p.field, p.field),
            level="info",
            text=f"proposed {len(p.actions)} action(s): {p.rationale}",
        )

    # Machinery ring: record today's spare-capacity answers before any safety check runs,
    # so a borrow_combine / deliver_to - whether a field agent proposed it itself (pass 1)
    # or the ring suggests it (pass 2) - is verified against what farms reported today,
    # not against yesterday's answers.
    state.nearby_capacity = farm_capacity

    proposals, unmet_harvest = _resolve_conflicts(state, proposals)
    thorn_entries, filtered_proposals, before, after = thorn.evaluate(proposals, state)
    _log_blocks(state, thorn_entries)

    for name, cap in farm_capacity.items():
        share = cap["can_share"]
        state.add_log(
            actor=name,
            level="info",
            text=(
                f"can share {share.get('combine', 0):.0f} combine / {share.get('storage_t', 0):.0f} t storage "
                f"until {cap['valid_until']} (confidence {cap['confidence']:.2f}). {cap.get('note', '')}"
            ).strip(),
        )
    state.add_log(actor="Machinery ring", level="info", text=f"compiled spare capacity from {len(farm_capacity)} farms")

    ring_proposals = _suggest_neighbour_help(state, filtered_proposals, farm_capacity, unmet_harvest)
    if ring_proposals:
        ring_entries, ring_filtered, _, after = thorn.evaluate(
            ring_proposals, state, starting_usage=thorn.usage_of(filtered_proposals, state)
        )
        thorn_entries += ring_entries
        _log_blocks(state, ring_entries)
        filtered_proposals = filtered_proposals + [p for p in ring_filtered if p.actions]

    n_total = len(thorn_entries)
    n_blocked = sum(1 for e in thorn_entries if e["blocked"])
    plan_for = date_label(state.tick)
    summary = (
        f"{plan_for}: {len(filtered_proposals)} proposals, "
        f"{n_total - n_blocked}/{n_total} actions cleared by the safety check"
    )

    plan_rows = [_plan_row(state, p.field, a, p) for p in filtered_proposals for a in p.actions]
    overall_confidence = min((r["confidence"] for r in plan_rows), default=None)

    bundle = {
        "bundle_id": state.next_bundle_id,
        "tick": state.tick,
        "plan_for": plan_for,
        "summary": summary,
        "proposals": [p.model_dump(exclude_none=True) for p in filtered_proposals],
        "thorn": thorn_entries,
        "plan_rows": plan_rows,
        "overall_confidence": overall_confidence,
        "nearby_capacity": list(farm_capacity.values()),
        "resources_before": before,
        "resources_after": after,
        "status": "pending",
        "reason": None,
    }
    state.next_bundle_id += 1
    state.bundles.append(bundle)
    state.add_log(actor="Coordinator", level="info", text=summary)
    return bundle
