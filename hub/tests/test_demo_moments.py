"""The three designed demo moments (DESIGN.md section 9), driven through the real HTTP
API exactly like the dashboard would, for seeds 0..29. Each moment must occur in at
least 80% of the seeds; the actual rates are printed (even under `pytest -q`)."""
import pytest
from fastapi.testclient import TestClient

from hub import main, thorn
from hub.state import M3_PER_MM_HA, SEED_FIELDS, WATER_PERMIT_HEATWAVE_M3

SEEDS = range(30)
MIN_RATE = 0.8
FIXED_SEED = 0
REJECT_REASON = "Irrigation must fit the cut water permit"
RIVER_AREA_HA = SEED_FIELDS["River"]["area_ha"]
ROHRDOMMELSEE = "Gut Rohrdommelsee"

MOMENTS = [
    "A  normal day: River irrigates 25 mm (6,000 m³), allowed, approved",
    "B1 heatwave: River's irrigation blocked by the water permit",
    "B2 after the rejection: River irrigates within the cut permit, noting the rejection",
    "C1 hail warning: combine conflict logged, North field kept",
    "C2 North field harvest allowed",
    "C3 West field borrows Gut Rohrdommelsee's combine, allowed",
    "C4 deliver_to for the silo surplus allowed",
    "C5 approved: notices for Buyers + Gut Rohrdommelsee, silo and neighbour storage updated",
]


def _tick(client) -> dict:
    return client.post("/tick").json()


def _decide(client, bundle: dict, decision: str, reason: str | None = None) -> dict:
    return client.post("/decide", json={"bundle_id": bundle["bundle_id"], "decision": decision, "reason": reason}).json()


def _entry(bundle: dict, field: str, action_type: str) -> dict | None:
    return next((e for e in bundle["thorn"] if e["field"] == field and e["action"]["type"] == action_type), None)


def _allowed(entry: dict | None) -> bool:
    return entry is not None and not entry["blocked"]


def _storage_used(state: dict) -> dict:
    return {f["farm"]: f["storage_capacity_t"] - f["storage_free_t"] for f in state["farms"]}


def _moments_a_and_b(client, seed: int) -> dict:
    out = {}
    client.post("/reset", params={"seed": seed})

    # A: reset -> tick -> River irrigates 25 mm, allowed -> approve
    bundle = _tick(client)
    irrigate = _entry(bundle, "River", "irrigate")
    approved = _decide(client, bundle, "approve")["status"] == "approved"
    out[MOMENTS[0]] = (
        _allowed(irrigate)
        and irrigate["action"]["mm"] == 25
        and irrigate["action"]["mm"] * RIVER_AREA_HA * M3_PER_MM_HA == 6000
        and approved
    )

    # B: heatwave -> tick (approve and tick again, up to 3 ticks) until River is blocked
    client.post("/scenario/heatwave")
    blocked = None
    for _ in range(3):
        bundle = _tick(client)
        irrigate = _entry(bundle, "River", "irrigate")
        if irrigate is not None and irrigate["blocked"] and irrigate["rule"] == thorn.RULE_WATER_PERMIT:
            blocked = bundle
            break
        _decide(client, bundle, "approve")
    out[MOMENTS[1]] = blocked is not None
    if blocked is None:
        out[MOMENTS[2]] = False
        return out

    # ... reject with a reason -> tick -> River fits the cut permit and says why
    _decide(client, blocked, "reject", REJECT_REASON)
    bundle = _tick(client)
    irrigate = _entry(bundle, "River", "irrigate")
    river = next(p for p in bundle["proposals"] if p["field"] == "River")
    permit = client.get("/state").json()["resources"]["water_permit_m3"]
    out[MOMENTS[2]] = (
        _allowed(irrigate)
        and permit == WATER_PERMIT_HEATWAVE_M3
        and irrigate["action"]["mm"] * RIVER_AREA_HA * M3_PER_MM_HA <= WATER_PERMIT_HEATWAVE_M3
        and f"(Noting recent rejection: {REJECT_REASON})" in river["rationale"]
    )
    return out


def _moment_c(client, seed: int) -> dict:
    out = {}
    # C: fresh reset -> tick -> approve -> hail -> tick
    client.post("/reset", params={"seed": seed})
    _decide(client, _tick(client), "approve")
    client.post("/scenario/hail")
    bundle = _tick(client)

    coordinator = [e["text"] for e in client.get("/log").json() if e["actor"] == "Coordinator" and e["tick"] == bundle["tick"]]
    out[MOMENTS[3]] = any(
        t.startswith("conflict: the combine was requested by North field and West field; kept North field") for t in coordinator
    )
    out[MOMENTS[4]] = _allowed(_entry(bundle, "North", "harvest"))
    borrow = _entry(bundle, "West", "borrow_combine")
    out[MOMENTS[5]] = _allowed(borrow) and borrow["action"]["farm"] == ROHRDOMMELSEE
    delivers = [e for e in bundle["thorn"] if e["action"]["type"] == "deliver_to" and not e["blocked"]]
    out[MOMENTS[6]] = bool(delivers)

    # ... approve -> notices for Buyers and Gut Rohrdommelsee, silo + neighbour storage updated
    before = client.get("/state").json()
    _decide(client, bundle, "approve")
    after = client.get("/state").json()
    audiences = {n["audience"] for n in client.get("/notices").json() if n["tick"] == bundle["tick"]}
    delivered = {}
    for e in delivers:
        delivered[e["action"]["farm"]] = delivered.get(e["action"]["farm"], 0) + e["action"]["tonnes"]
    used_before, used_after = _storage_used(before), _storage_used(after)
    neighbours_updated = bool(delivered) and all(
        abs(used_after[farm] - used_before[farm] - tonnes) < 0.2 for farm, tonnes in delivered.items()
    )
    out[MOMENTS[7]] = (
        {"Buyers", ROHRDOMMELSEE} <= audiences
        and after["resources"]["storage_free_t"] == 0
        and after["resources"]["storage_used_t"] > before["resources"]["storage_used_t"]
        and all(after["fields"][f]["harvested"] for f in ("North", "West"))
        and neighbours_updated
    )
    return out


@pytest.fixture(scope="module")
def results() -> dict:
    saved_mode = main.PETAL_MODE
    main.PETAL_MODE = "mock"
    try:
        client = TestClient(main.app)
        return {seed: {**_moments_a_and_b(client, seed), **_moment_c(client, seed)} for seed in SEEDS}
    finally:
        main.PETAL_MODE = saved_mode


def _rate(results: dict, moment: str) -> float:
    return sum(r[moment] for r in results.values()) / len(results)


def test_print_demo_moment_rates(results, capsys):
    with capsys.disabled():
        print(f"\nDemo moments over seeds {SEEDS.start}..{SEEDS.stop - 1}:")
        for moment in MOMENTS:
            misses = [seed for seed, r in results.items() if not r[moment]]
            miss_text = f"  (missed: seeds {misses})" if misses else ""
            print(f"  {_rate(results, moment):6.0%}  {moment}{miss_text}")
    assert set(results[FIXED_SEED]) == set(MOMENTS)


@pytest.mark.parametrize("moment", MOMENTS)
def test_demo_moment_is_reliable(results, moment):
    assert _rate(results, moment) >= MIN_RATE


def test_fixed_seed_shows_every_moment(results):
    assert all(results[FIXED_SEED].values()), {m: ok for m, ok in results[FIXED_SEED].items() if not ok}
