"""Rule-based farm agents for the Machinery ring, used in simulated (mock/flower) mode,
and as the grid-mode fallback if a farm agent doesn't respond in time. Our own farm
answers too (from its real state), but the Machinery ring never borrows from itself."""
import math

from hub.clock import date_label

STORAGE_HOLDBACK_T = 50  # keep this much of the silo free for yourself
VALID_FOR_DAYS = 1


def generate(farm_name: str, state) -> dict:
    census = state.farm_census(farm_name)
    scenario = census.scenario

    combine = 1 if census.combine_available and census.ripe_backlog_ha == 0 else 0
    storage = max(0.0, census.storage_free_t - STORAGE_HOLDBACK_T)
    if scenario:
        # A weather warning over the whole region: hold back harder.
        storage = float(math.floor(storage / 2))
    else:
        storage = round(storage, 1)

    if combine:
        machine = "combine free"
    elif census.combine_available:
        machine = f"combine needed for our own {census.ripe_backlog_ha:.0f} ha of ripe crop"
    else:
        machine = "combine busy"
    note = f"{machine}, {census.storage_free_t:.0f} t silo space"
    if scenario:
        note += "; keeping a reserve while the weather warning lasts"

    return {
        "farm": farm_name,
        "can_share": {"combine": combine, "storage_t": storage},
        "valid_until": date_label(state.tick + VALID_FOR_DAYS),
        "confidence": 0.5 if scenario else 0.85,
        "note": note,
    }
