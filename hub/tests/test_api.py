"""Every HTTP endpoint (FastAPI TestClient against the real app, mock mode)."""
import threading

from hub import main
from hub.schemas import Bundle, FarmCensus, FieldCensus, Weather
from hub.state import NEIGHBOUR_HINT

WEATHER_KEYS = set(Weather.model_fields)
FIELD_KEYS = {
    "name", "crop", "emoji", "area_ha", "stage", "days_to_harvest", "harvest_ready", "harvested", "cover_crop",
    "soil_moisture_pct", "stress_threshold_pct", "irrigable", "crop_health", "disease_pressure", "yield_estimate_t",
    "harvest_waiting_days", "last_irrigated_date", "last_sprayed_date", "recent_rejections", "polygon",
}
FARM_ROW_KEYS = {
    "farm", "id", "is_own", "lat", "lon", "crops", "area_ha", "storage_capacity_t", "storage_free_t",
    "combine_available", "avg_soil_moisture_pct",
}


def _tick(client) -> dict:
    response = client.post("/tick")
    assert response.status_code == 200
    return response.json()


def _decide(client, bundle_id, decision, reason=None):
    return client.post("/decide", json={"bundle_id": bundle_id, "decision": decision, "reason": reason})


# -- /state, /status ---------------------------------------------------------------
def test_state_shape(client):
    s = client.get("/state").json()
    assert set(s) == {
        "tick", "date", "long_date", "farm", "region", "fields", "weather_today", "forecast", "resources",
        "scenario", "heatwave_days_remaining", "hail_date", "farms", "farmyard", "nearby_capacity",
        "recent_actions", "recent_proposals", "bundle_count",
    }
    assert (s["tick"], s["date"], s["long_date"]) == (0, "Mon 6 Jul", "Monday 6 July")
    assert (s["farm"], s["region"]) == ("Hof Lerchenbruch", "Oderbruch")
    assert list(s["fields"]) == ["North", "West", "River"]
    north = s["fields"]["North"]
    assert set(north) == FIELD_KEYS
    assert (north["name"], north["crop"], north["emoji"], north["stage"]) == ("North field", "winter wheat", "🌾", "ripening")
    assert (north["yield_estimate_t"], north["soil_moisture_pct"], north["stress_threshold_pct"]) == (327.6, 48.0, 35)
    assert north["polygon"][0] == [14.295, 52.6575] and north["polygon"][0] == north["polygon"][-1]
    assert set(s["weather_today"]) == WEATHER_KEYS and len(s["forecast"]) == 3
    assert s["resources"] == {
        "water_permit_m3": 6500, "water_permit_normal_m3": 6500, "workers": 5, "combine": 1, "sprayer": 1,
        "storage_capacity_t": 450, "storage_used_t": 120.0, "storage_free_t": 330.0,
    }
    assert s["scenario"] is None and s["heatwave_days_remaining"] == 0 and s["hail_date"] is None
    assert [f["farm"] for f in s["farms"]] == ["Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"]
    assert all(set(f) == FARM_ROW_KEYS for f in s["farms"])
    own = s["farms"][0]
    assert (own["id"], own["is_own"], own["crops"], own["area_ha"]) == ("lerchenbruch", True, "wheat, rapeseed, potatoes", 96)
    assert (own["lat"], own["lon"]) == (52.655, 14.3)
    assert s["farmyard"] == [52.6545, 14.299]
    assert s["nearby_capacity"] == {} and s["recent_actions"] == [] and s["bundle_count"] == 0


def test_status(client):
    assert client.get("/status").json() == {"tick_in_progress": False, "mode": "mock"}


# -- censuses ----------------------------------------------------------------------
def test_census_shape_and_404(client):
    body = client.get("/census/River").json()
    census = FieldCensus(**body)
    assert census.field == "River" and census.irrigable and len(census.forecast) == 3
    assert census.resources.water_permit_m3 == 6500 and census.resources.storage_free_t == 330
    assert census.days_since_irrigated is None and census.hint is None
    assert client.get("/census/South").status_code == 404


def test_census_hint_after_neighbour_farm_rejection(client):
    bundle = _tick(client)
    _decide(client, bundle["bundle_id"], "reject", "A neighbour farm should help with this")
    census = client.get("/census/West").json()
    assert census["recent_rejections"] == ["A neighbour farm should help with this"]
    assert census["hint"] == NEIGHBOUR_HINT
    # The field census carries no neighbour capacity, so the hint must not send the agent
    # looking for it; the Machinery ring does the neighbour matching.
    assert "check what the Machinery ring reports" not in census["hint"]


def test_farm_census_shape_404_and_id_alias(client):
    body = client.get("/farms/Gut%20Rohrdommelsee/census").json()
    census = FarmCensus(**body)
    assert census.farm == "Gut Rohrdommelsee" and census.date == "Mon 6 Jul" and census.storage_free_t == 520
    assert client.get("/farms/rohrdommelsee/census").json() == body
    own = client.get("/farms/Hof%20Lerchenbruch/census").json()
    assert own["storage_free_t"] == 330 and own["ripe_backlog_ha"] == 0
    assert client.get("/farms/Hof%20Nirgendwo/census").status_code == 404


# -- agent submissions ---------------------------------------------------------------
def test_post_proposal_stores_and_logs(client):
    payload = {"field": "River", "actions": [{"type": "irrigate", "mm": 15}], "rationale": "dry soil", "confidence": 0.7}
    response = client.post("/proposals", json=payload)
    assert response.status_code == 201 and response.json() == {"ok": True}
    assert main.STATE.pending_flower_proposals["River"]["actions"] == [{"type": "irrigate", "mm": 15.0}]
    log = client.get("/log").json()[0]
    assert (log["actor"], log["text"]) == ("River field agent", "proposal received: dry soil")


def test_post_proposal_validation(client):
    assert client.post("/proposals", json={"field": "South", "rationale": "x", "confidence": 0.5}).status_code == 422
    assert client.post("/proposals", json={"field": "North", "rationale": "", "confidence": 0.5}).status_code == 422
    bad_action = {"field": "North", "actions": [{"type": "plough"}], "rationale": "x", "confidence": 0.5}
    assert client.post("/proposals", json=bad_action).status_code == 422
    assert client.post("/proposals", json={"field": "North", "rationale": "x", "confidence": 1.5}).status_code == 422


def test_post_farm_capacity(client):
    payload = {"farm": "Gut Rohrdommelsee", "can_share": {"combine": 1, "storage_t": 300}, "valid_until": "Tue 7 Jul",
               "confidence": 0.8, "note": "ok"}
    response = client.post("/farm-capacity", json=payload)
    assert response.status_code == 201 and response.json() == {"ok": True}
    assert main.STATE.pending_farm_capacity["Gut Rohrdommelsee"]["can_share"] == {"combine": 1.0, "storage_t": 300.0}
    assert client.post("/farm-capacity", json={**payload, "confidence": 2}).status_code == 422


# -- tick / inbox / decide -----------------------------------------------------------
def test_tick_returns_a_valid_bundle(client):
    bundle = _tick(client)
    Bundle(**bundle)
    assert bundle["tick"] == 1 and bundle["plan_for"] == "Tue 7 Jul" and bundle["status"] == "pending"
    assert set(bundle["resources_before"]) == {"water_m3", "workers", "combine", "sprayer", "storage_free_t"}
    assert set(bundle["resources_after"]) == set(bundle["resources_before"])
    assert [c["farm"] for c in bundle["nearby_capacity"]] == ["Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"]
    s = client.get("/state").json()
    assert s["tick"] == 1 and s["bundle_count"] == 1 and s["recent_proposals"] == ["North", "West", "River"]
    assert set(s["nearby_capacity"]) == {"Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"}
    assert client.get("/inbox").json() == [bundle]


def test_decide_approve(client):
    bundle = _tick(client)
    response = _decide(client, bundle["bundle_id"], "approve")
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert client.get("/inbox").json() == []
    log = client.get("/log").json()[0]
    assert (log["actor"], log["level"], log["text"]) == ("Farm manager", "decision", "approved the Tue 7 Jul plan")


def test_decide_reject_with_reason(client):
    bundle = _tick(client)
    response = _decide(client, bundle["bundle_id"], "reject", "Wait for better weather")
    body = response.json()
    assert body["status"] == "rejected" and body["reason"] == "Wait for better weather"
    fields = client.get("/state").json()["fields"]
    assert all(f["recent_rejections"] == ["Wait for better weather"] for f in fields.values())
    assert client.get("/log").json()[0]["text"] == "rejected the Tue 7 Jul plan: Wait for better weather"


def test_decide_reject_keeps_last_five_reasons(client):
    for i in range(7):
        bundle = _tick(client)
        _decide(client, bundle["bundle_id"], "reject", f"reason {i}")
    assert main.STATE.fields["North"].recent_rejections == [f"reason {i}" for i in range(2, 7)]


def test_decide_errors(client):
    bundle = _tick(client)
    assert _decide(client, 999, "approve").status_code == 404
    assert _decide(client, bundle["bundle_id"], "approve").status_code == 200
    again = _decide(client, bundle["bundle_id"], "reject", "changed my mind")
    assert again.status_code == 400
    assert client.post("/decide", json={"bundle_id": bundle["bundle_id"], "decision": "maybe"}).status_code == 422


def test_undecided_plan_expires_and_cannot_be_decided(client):
    first = _tick(client)
    _tick(client)
    plans = client.get("/plans/North").json()
    assert plans[1] == {"bundle_id": first["bundle_id"], "plan_for": "Tue 7 Jul", "status": "expired",
                        "confidence": plans[1]["confidence"]}
    response = _decide(client, first["bundle_id"], "approve")
    assert response.status_code == 400 and "expired" in response.json()["detail"]
    assert any(e["text"] == "the Tue 7 Jul plan expired undecided" for e in client.get("/log").json())


# -- notices only from approved plans ------------------------------------------------
def test_notices_only_from_approved_plans(client):
    rejected = _tick(client)
    assert any(r["action_type"] == "irrigate" for r in rejected["plan_rows"])  # River irrigates on day one
    _decide(client, rejected["bundle_id"], "reject", "Not enough workers for this")
    assert client.get("/notices").json() == []
    _tick(client)  # expires undecided
    expired_then = _tick(client)
    assert client.get("/notices").json() == []
    _decide(client, expired_then["bundle_id"], "approve")
    notices = client.get("/notices").json()
    assert notices and all(set(n) == {"tick", "date", "audience", "text"} for n in notices)
    assert all(n["date"] == expired_then["plan_for"] for n in notices)


# -- scenarios -----------------------------------------------------------------------
def test_scenario_endpoints(client):
    heat = client.post("/scenario/heatwave").json()
    assert heat == {"ok": True, "scenario": "heatwave: water permit cut to 3,600 m³/day"}
    hail = client.post("/scenario/hail").json()
    assert hail == {"ok": True, "scenario": "hail warning: severe hail expected Wed 8 Jul"}
    s = client.get("/state").json()
    assert s["scenario"] == f"{heat['scenario']} · {hail['scenario']}"
    assert s["heatwave_days_remaining"] == 4 and s["hail_date"] == "Wed 8 Jul"
    assert s["resources"]["water_permit_m3"] == 3600
    assert client.post("/scenario/hail").json() == hail  # already active: no-op


# -- log / history / plans / farm reports -------------------------------------------
def test_log_newest_first(client):
    _tick(client)
    log = client.get("/log").json()
    assert all(set(e) == {"tick", "date", "actor", "text", "level"} for e in log)
    assert log[-1]["text"] == "season reset / seeded (seed 0)"
    assert log[0]["actor"] == "Coordinator" and log[0]["tick"] == 1
    assert {e["level"] for e in log} <= {"info", "warn", "block", "decision"}


def test_history_and_projection(client):
    bundle = _tick(client)
    _decide(client, bundle["bundle_id"], "approve")
    body = client.get("/history/River").json()
    assert set(body) == {"history", "projection", "stress_threshold_pct"}
    assert body["stress_threshold_pct"] == 60
    assert [h["date"] for h in body["history"]] == ["Mon 6 Jul", "Tue 7 Jul"]
    assert set(body["history"][0]) == {
        "tick", "date", "soil_moisture_pct", "crop_health", "rain_mm", "irrigation_mm", "yield_estimate_t"}
    assert body["history"][-1]["irrigation_mm"] == 25.0
    assert [p["date"] for p in body["projection"]] == ["Wed 8 Jul", "Thu 9 Jul", "Fri 10 Jul"]
    assert set(body["projection"][0]) == {"tick", "date", "projected_moisture_pct"}
    assert client.get("/history/South").status_code == 404


def test_plans_for_field(client):
    for _ in range(4):
        _tick(client)
    plans = client.get("/plans/River").json()
    assert len(plans) == 3
    assert [p["plan_for"] for p in plans] == ["Fri 10 Jul", "Thu 9 Jul", "Wed 8 Jul"]
    assert set(plans[0]) == {"bundle_id", "plan_for", "status", "confidence"}
    assert plans[0]["status"] == "pending" and plans[1]["status"] == "expired"
    assert client.get("/plans/South").status_code == 404


def test_farm_history(client):
    _tick(client)
    body = client.get("/history/farm/Gut%20Rohrdommelsee").json()
    assert [h["date"] for h in body["history"]] == ["Mon 6 Jul", "Tue 7 Jul"]
    assert set(body["history"][0]) == {"tick", "date", "storage_free_t", "avg_soil_moisture_pct", "combine_available"}
    assert body["history"][0]["storage_free_t"] == 520
    assert client.get("/history/farm/oderblick").status_code == 200
    assert client.get("/history/farm/Nowhere").status_code == 404


def test_farm_reports(client):
    for _ in range(4):
        _tick(client)
    reports = client.get("/farm-reports/Gut%20Rohrdommelsee").json()
    assert len(reports) == 3
    assert [r["plan_for"] for r in reports] == ["Fri 10 Jul", "Thu 9 Jul", "Wed 8 Jul"]
    assert set(reports[0]) == {"plan_for", "can_share", "confidence", "note"}
    assert set(reports[0]["can_share"]) == {"combine", "storage_t"}
    assert client.get("/farm-reports/Nowhere").status_code == 404


# -- reset ---------------------------------------------------------------------------
def test_reset_with_seed_is_reproducible(client):
    _tick(client)
    assert client.post("/reset", params={"seed": 4}).json() == {"ok": True}
    first = client.get("/state").json()
    _tick(client)
    client.post("/reset", params={"seed": 4})
    again = client.get("/state").json()
    assert first == again
    assert first["tick"] == 0 and first["bundle_count"] == 0
    assert client.get("/notices").json() == [] and client.get("/inbox").json() == []
    assert client.post("/reset").json() == {"ok": True}


# -- one change at a time --------------------------------------------------------------
def test_nothing_lands_in_the_middle_of_a_tick(client, monkeypatch):
    """A grid tick takes up to 90 s; a second tick, a reset, a scenario or a decision must
    not interleave with it (two plans for one day, a stale plan in a fresh season)."""
    release, entered = threading.Event(), threading.Event()
    real_collect = main._collect_tick_data

    def slow_collect(state):
        entered.set()
        release.wait(5)
        return real_collect(state)

    first = _tick(client)
    monkeypatch.setattr(main, "_collect_tick_data", slow_collect)
    worker = threading.Thread(target=lambda: client.post("/tick"))
    worker.start()
    try:
        assert entered.wait(5)
        assert client.get("/status").json()["tick_in_progress"] is True
        for method, path, body in (
            ("post", "/tick", None),
            ("post", "/reset", None),
            ("post", "/scenario/heatwave", None),
            ("post", "/scenario/hail", None),
            ("post", "/decide", {"bundle_id": first["bundle_id"], "decision": "approve"}),
        ):
            response = getattr(client, method)(path, json=body)
            assert response.status_code == 409, path
    finally:
        release.set()
        worker.join(10)
    assert client.get("/status").json()["tick_in_progress"] is False
    plans = [(b["plan_for"], b["status"]) for b in main.STATE.bundles]
    assert plans == [("Tue 7 Jul", "expired"), ("Wed 8 Jul", "pending")]


def test_approve_rechecks_the_safety_check_after_a_heatwave(client):
    """The plan was cleared against the normal permit; the heatwave cuts it at once."""
    bundle = _tick(client)
    river = next(p for p in bundle["proposals"] if p["field"] == "River")
    assert river["actions"][0] == {**river["actions"][0], "type": "irrigate", "mm": 25.0}
    moisture = main.STATE.fields["River"].soil_moisture
    client.post("/scenario/heatwave")

    response = _decide(client, bundle["bundle_id"], "approve")
    assert response.status_code == 409
    assert "irrigate for River field: Irrigation must stay within today's water permit. Reject it" in response.json()["detail"]
    assert main.STATE.fields["River"].soil_moisture == moisture  # nothing applied
    assert client.get("/notices").json() == []
    assert client.get("/inbox").json()[0]["bundle_id"] == bundle["bundle_id"]  # still pending
    assert _decide(client, bundle["bundle_id"], "reject", "Wait for better weather").status_code == 200
