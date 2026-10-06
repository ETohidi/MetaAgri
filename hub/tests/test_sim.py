"""Daily simulation: water balance, ripening, health, disease, scenarios, neighbours,
plan expiry, reproducibility and the weather generator."""
import random

import pytest

from hub import sim, weather
from hub.clock import date_label, long_date
from hub.state import KC_COVER_CROP, KC_HARVESTED, WATER_PERMIT_HEATWAVE_M3, WATER_PERMIT_NORMAL_M3, HubState

from helpers import fresh_state


def _pin_tomorrow(state, **values) -> dict:
    """Pin the day the next step() makes 'today'."""
    day = {"date": date_label(state.tick + 1), "temp_max_c": 25.0, "rain_mm": 0.0, "wind_ms": 3.0,
           "et0_mm": 4.0, "humidity_pct": 60, "hail": False, "note": ""}
    day.update(values)
    state.forecast[0] = day
    return day


# -- clock -------------------------------------------------------------------------
def test_clock_labels():
    assert date_label(0) == "Mon 6 Jul"
    assert date_label(2) == "Wed 8 Jul"
    assert date_label(26) == "Sat 1 Aug"
    assert long_date(0) == "Monday 6 July"


# -- water balance -----------------------------------------------------------------
def test_water_balance_uses_rain_minus_et0_times_kc(state):
    _pin_tomorrow(state, rain_mm=3.0, et0_mm=5.0)
    before = {name: f.soil_moisture for name, f in state.fields.items()}
    sim.step(state)
    assert state.fields["North"].soil_moisture == pytest.approx(before["North"] + 3.0 - 5.0 * 0.45)
    assert state.fields["West"].soil_moisture == pytest.approx(before["West"] + 3.0 - 5.0 * 0.40)
    assert state.fields["River"].soil_moisture == pytest.approx(before["River"] + 3.0 - 5.0 * 1.10)
    assert state.history["River"][-1]["soil_moisture_pct"] == round(state.fields["River"].soil_moisture, 1)
    assert state.history["River"][-1]["rain_mm"] == 3.0


def test_water_balance_harvested_and_cover_crop_kc(state):
    state.fields["North"].harvested = True
    state.fields["West"].harvested = True
    state.fields["West"].cover_crop = True
    _pin_tomorrow(state, et0_mm=5.0)
    sim.step(state)
    assert state.fields["North"].soil_moisture == pytest.approx(48 - 5.0 * KC_HARVESTED)
    assert state.fields["West"].soil_moisture == pytest.approx(44 - 5.0 * KC_COVER_CROP)


def test_water_balance_clamped(state):
    state.fields["River"].soil_moisture = 99
    state.fields["North"].soil_moisture = 1
    _pin_tomorrow(state, rain_mm=30.0, et0_mm=2.0)
    sim.step(state)
    assert state.fields["River"].soil_moisture == 100
    _pin_tomorrow(state, rain_mm=0.0, et0_mm=7.0)
    state.fields["North"].soil_moisture = 1
    sim.step(state)
    assert state.fields["North"].soil_moisture == 0


def test_projection_is_three_days_of_forecast_without_irrigation(state):
    rows = state.projection("River")
    assert [r["date"] for r in rows] == ["Tue 7 Jul", "Wed 8 Jul", "Thu 9 Jul"]
    m = state.fields["River"].soil_moisture
    for w, r in zip(state.forecast, rows):
        m = max(0, min(100, m + w["rain_mm"] - w["et0_mm"] * 1.10))
        assert r["projected_moisture_pct"] == round(m, 1)


# -- ripening, health, disease -------------------------------------------------------
def test_ripening_and_losses_while_waiting(state):
    west = state.fields["West"]
    for _ in range(3):
        sim.step(state)
    assert west.days_to_harvest == 0 and west.harvest_ready and west.stage == "harvest-ready"
    assert west.harvest_waiting_days == 1
    yield_before = west.yield_t_ha
    sim.step(state)
    assert west.harvest_waiting_days == 2
    assert west.yield_t_ha == pytest.approx(yield_before * 0.98)
    assert state.fields["River"].days_to_harvest == 44 and state.fields["River"].stage == "tuber bulking"
    assert state.fields["North"].stage == "harvest-ready"


def test_stage_labels(state):
    north, river = state.fields["North"], state.fields["River"]
    assert north.stage == "ripening"
    north.days_to_harvest = 9
    assert north.stage == "grain fill"
    river.days_to_harvest = 14
    assert river.stage == "maturing"
    north.harvested = True
    assert north.stage == "harvested"
    north.cover_crop = True
    assert north.stage == "cover crop"


def test_yield_estimate_formula(state):
    assert state.fields["North"].yield_estimate_t == 327.6  # 42 x 7.8, health above 0.85
    assert state.fields["West"].yield_estimate_t == round(30 * 3.9 * 0.84 / 0.85, 1)
    assert state.fields["River"].yield_estimate_t == 1008.0


def test_health_stress_and_recovery(state):
    north, river = state.fields["North"], state.fields["River"]
    river.soil_moisture = 45  # threshold 60 -> 15 points under after today's balance ...
    _pin_tomorrow(state, rain_mm=0.0, et0_mm=0.0)
    h_river, h_north = river.health, north.health
    sim.step(state)
    assert river.health == pytest.approx(h_river - (0.015 + 0.003 * 15))
    assert north.health == pytest.approx(min(0.95, h_north + 0.004))


def test_health_disease_penalty_and_clamp(state):
    river = state.fields["River"]
    river.disease = 0.8
    river.soil_moisture = 80
    _pin_tomorrow(state, et0_mm=0.0, temp_max_c=25.0, humidity_pct=60)
    h = river.health
    sim.step(state)
    assert river.health == pytest.approx(h + 0.004 - 0.02)
    river.health = 0.21
    river.soil_moisture = 0
    _pin_tomorrow(state, et0_mm=0.0)
    sim.step(state)
    assert river.health == 0.2


def test_potato_disease_rises_when_wet_and_less_after_spraying(state):
    river = state.fields["River"]
    _pin_tomorrow(state, rain_mm=4.0, humidity_pct=70)
    d = river.disease
    sim.step(state)
    assert river.disease == pytest.approx(d + 0.07)
    river.last_sprayed_tick = state.tick
    _pin_tomorrow(state, rain_mm=0.0, humidity_pct=85)
    d = river.disease
    sim.step(state)
    assert river.disease == pytest.approx(d + 0.07 * 0.3)


def test_potato_disease_falls_when_hot_and_dry(state):
    river = state.fields["River"]
    _pin_tomorrow(state, rain_mm=0.0, temp_max_c=34.0, humidity_pct=40)
    d = river.disease
    sim.step(state)
    assert river.disease == pytest.approx(d - 0.02)


def test_cereal_disease_is_small_noise(state):
    d = state.fields["North"].disease
    for _ in range(3):
        sim.step(state)
    assert abs(state.fields["North"].disease - d) <= 0.03 + 1e-9


# -- heatwave ----------------------------------------------------------------------
def test_heatwave_cuts_permit_and_turns_the_next_days_hot(state):
    message = sim.start_heatwave(state)
    assert message == "heatwave: water permit cut to 3,600 m³/day"
    assert state.water_permit_m3 == WATER_PERMIT_HEATWAVE_M3
    assert state.weather_today["note"] == "heatwave"
    assert all(w["note"] == "heatwave" and w["rain_mm"] == 0 for w in state.forecast)
    assert all(33 <= w["temp_max_c"] <= 37 and 6.8 <= w["et0_mm"] <= 7.8 for w in [state.weather_today, *state.forecast])
    assert state.scenario == message
    assert state.log[-1]["actor"] == "Farm" and state.log[-1]["level"] == "warn"


def test_heatwave_lasts_four_days_then_permit_returns(state):
    sim.start_heatwave(state)
    for day in range(1, 4):
        sim.step(state)
        assert state.weather_today["note"] == "heatwave", day
        assert state.water_permit_m3 == WATER_PERMIT_HEATWAVE_M3
    assert state.forecast[-1]["note"] == ""  # generated beyond the heatwave
    sim.step(state)
    assert state.heatwave_days_remaining == 0
    assert state.weather_today["note"] == ""
    assert state.water_permit_m3 == WATER_PERMIT_NORMAL_M3
    assert state.scenario is None
    assert any(e["text"] == "heatwave over: water permit back to 6,500 m³/day" for e in state.log)


def test_heatwave_doubles_ripening(state):
    sim.start_heatwave(state)
    sim.step(state)
    assert state.fields["North"].days_to_harvest == 2
    assert state.fields["River"].days_to_harvest == 47  # potatoes: one day only


# -- hail --------------------------------------------------------------------------
def test_hail_warning_sets_up_a_dry_day_then_the_storm(state):
    message = sim.hail_warning(state)
    assert message == "hail warning: severe hail expected Wed 8 Jul"
    assert state.hail_tick == 2
    assert state.forecast[0]["rain_mm"] == 0 and 2 <= state.forecast[0]["wind_ms"] <= 4
    storm = state.forecast[1]
    assert storm["hail"] is True and storm["note"] == "hail storm" and 18 <= storm["rain_mm"] <= 30
    assert storm["temp_max_c"] == 27 and storm["et0_mm"] == 3.0 and storm["humidity_pct"] == 90
    assert state.fields["North"].days_to_harvest == 1 and state.fields["West"].days_to_harvest == 1
    assert state.fields["River"].days_to_harvest == 48
    assert state.to_dict()["hail_date"] == "Wed 8 Jul"
    # rapeseed is an oilseed, not a cereal
    assert state.log[-1]["text"] == (
        "Hail warning: severe hail expected Wed 8 Jul; Tue 7 Jul stays dry, "
        "so the ripening wheat and rapeseed can come in early"
    )


def test_hail_warning_twice_is_a_no_op(state):
    first = sim.hail_warning(state)
    forecast = [dict(w) for w in state.forecast]
    n_log = len(state.log)
    assert sim.hail_warning(state) == first
    assert state.forecast == forecast and len(state.log) == n_log


def test_hail_damage_on_the_hail_day(state):
    sim.hail_warning(state)
    sim.step(state)  # dry day: both cereals ripe, nobody harvests
    north, west, river = state.fields["North"], state.fields["West"], state.fields["River"]
    assert north.harvest_ready and west.harvest_ready
    yields = {name: f.yield_t_ha for name, f in state.fields.items()}
    river_health = river.health
    sim.step(state)  # the hail day
    assert state.weather_today["hail"] is True
    assert north.yield_t_ha == pytest.approx(yields["North"] * 0.99 * 0.6)
    assert west.yield_t_ha == pytest.approx(yields["West"] * 0.98 * 0.6)
    assert river.health < river_health  # -0.08 on top of the day's health change
    warns = [e["text"] for e in state.log if e["level"] == "warn" and e["text"].startswith("Hail hit")]
    assert "Hail hit West field: rapeseed lost 40%" in warns
    assert "Hail hit North field: winter wheat lost 40%" in warns
    assert "Hail hit River field: potato leaves shredded, crop health down 0.08" in warns
    assert state.hail_tick is None and state.scenario is None


def test_hail_spares_harvested_fields(state):
    sim.hail_warning(state)
    sim.step(state)
    state.fields["North"].harvested = True
    state.fields["North"].harvested_t = 320.0
    sim.step(state)
    assert state.fields["North"].yield_estimate_t == 320.0
    assert not any("North field" in e["text"] for e in state.log if e["text"].startswith("Hail hit"))


def test_both_scenarios_at_once(state):
    sim.hail_warning(state)
    sim.start_heatwave(state)
    assert state.forecast[1]["hail"] is True  # the heatwave doesn't overwrite the storm
    assert state.forecast[0]["note"] == "heatwave" and state.forecast[2]["note"] == "heatwave"
    assert state.scenario == "heatwave: water permit cut to 3,600 m³/day · hail warning: severe hail expected Wed 8 Jul"
    assert state.scenario_messages() == state.scenario.split(" · ")


# -- neighbours, expiry, history ---------------------------------------------------
def test_neighbour_drift_stays_in_bounds(state):
    for _ in range(40):
        sim.step(state)
        for n in state.neighbours.values():
            assert 0 <= n["storage_used_t"] <= n["storage_capacity_t"]
            assert n["combine_available"] in (0, 1)
            assert 10 <= n["avg_soil_moisture"] <= 95
    assert state.neighbours["Agrarhof Oderblick"]["storage_used_t"] > 420


def test_cereal_heavy_neighbour_combine_busy_during_hail_warning(state):
    sim.hail_warning(state)
    for _ in range(20):
        state.hail_tick = state.tick + 2  # keep the warning active
        sim.step(state)
        assert state.neighbours["Agrarhof Oderblick"]["combine_available"] == 0


def test_pending_plan_expires_on_the_next_day(state):
    state.bundles.append({"bundle_id": 1, "tick": 0, "plan_for": "Mon 6 Jul", "status": "pending"})
    state.bundles.append({"bundle_id": 2, "tick": 0, "plan_for": "Mon 6 Jul", "status": "approved"})
    sim.step(state)
    assert state.bundles[0]["status"] == "expired"
    assert state.bundles[1]["status"] == "approved"
    assert any(e["actor"] == "Farm" and e["text"] == "the Mon 6 Jul plan expired undecided" for e in state.log)


def test_step_records_field_and_farm_history(state):
    sim.step(state)
    sim.step(state)
    assert [h["date"] for h in state.history["North"]] == ["Mon 6 Jul", "Tue 7 Jul", "Wed 8 Jul"]
    assert set(state.history["North"][0]) == {
        "tick", "date", "soil_moisture_pct", "crop_health", "rain_mm", "irrigation_mm", "yield_estimate_t"}
    for rows in state.farm_history.values():
        assert len(rows) == 3
        assert set(rows[0]) == {"tick", "date", "storage_free_t", "avg_soil_moisture_pct", "combine_available"}


def test_step_rolls_the_forecast_forward(state):
    tomorrow = dict(state.forecast[0])
    sim.step(state)
    assert state.weather_today == tomorrow
    assert len(state.forecast) == 3
    assert [w["date"] for w in state.forecast] == ["Wed 8 Jul", "Thu 9 Jul", "Fri 10 Jul"]


# -- reproducibility ---------------------------------------------------------------
def _fingerprint(state: HubState) -> tuple:
    return (state.weather_today, state.forecast, {n: v["combine_available"] for n, v in state.neighbours.items()})


def test_reset_with_seed_is_reproducible():
    a = fresh_state(seed=7)
    for _ in range(5):
        sim.step(a)
    b = fresh_state(seed=7)
    for _ in range(5):
        sim.step(b)
    assert _fingerprint(a) == _fingerprint(b)
    assert {n: f.soil_moisture for n, f in a.fields.items()} == {n: f.soil_moisture for n, f in b.fields.items()}
    c = fresh_state(seed=8)
    assert _fingerprint(c) != _fingerprint(fresh_state(seed=7))


def test_metaagri_seed_env(monkeypatch):
    monkeypatch.setenv("METAAGRI_SEED", "11")
    a, b = HubState(), HubState()
    assert a.seed == 11 and _fingerprint(a) == _fingerprint(b)
    monkeypatch.delenv("METAAGRI_SEED")
    random.seed(0)
    assert HubState().seed is None


# -- weather generator -------------------------------------------------------------
def test_normal_weather_ranges():
    random.seed(1)
    days = [weather.normal_day(t) for t in range(500)]
    for d in days:
        assert 21 <= d["temp_max_c"] <= 29
        assert 1 <= d["wind_ms"] <= 8
        assert 2.0 <= d["et0_mm"] <= 5.5
        assert 50 <= d["humidity_pct"] <= 95
        assert d["hail"] is False and d["note"] == ""
        assert d["rain_mm"] == 0 or 0.5 <= d["rain_mm"] <= 14
    dry_share = sum(d["rain_mm"] == 0 for d in days) / len(days)
    assert 0.55 < dry_share < 0.75
    assert sum(d["rain_mm"] >= 5 for d in days) / len(days) < 0.25
