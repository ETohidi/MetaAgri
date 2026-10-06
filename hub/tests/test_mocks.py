"""The rule-based field agents (mock_petals) and farm agents (mock_farms)."""
from hub import mock_farms, mock_petals, sim
from hub.state import OWN_FARM_NAME, WATER_PERMIT_HEATWAVE_M3

from helpers import make_ready, set_weather


def _types(p):
    return [a.type for a in p.actions]


# -- field agents ------------------------------------------------------------------
def test_harvested_field_sows_cover_crop_then_rests(state):
    set_weather(state)
    state.fields["North"].harvested = True
    p = mock_petals.generate("North", state)
    assert _types(p) == ["sow_cover_crop"] and p.actions[0].confidence == 0.8
    state.fields["North"].cover_crop = True
    assert _types(mock_petals.generate("North", state)) == []


def test_harvested_field_waits_to_sow_on_a_wet_or_hail_day(state):
    state.fields["North"].harvested = True
    for rain, hail in ((12.0, False), (0.0, True)):
        set_weather(state, rain_today=rain)
        state.weather_today["hail"] = hail
        p = mock_petals.generate("North", state)
        assert _types(p) == ["defer_task"], (rain, hail)
        assert "too wet" in p.actions[0].reason


def test_ripe_cereal_harvests_on_a_dry_day(state):
    set_weather(state, rain_today=0.0)
    make_ready(state, "West")
    p = mock_petals.generate("West", state)
    assert _types(p) == ["harvest"]
    assert p.actions[0].confidence == 0.85
    assert p.actions[0].reason == f"rapeseed ripe; dry day, ~{state.fields['West'].yield_estimate_t:.0f} t expected."
    assert p.risks == ["seed moisture may need drying"]


def test_ripe_cereal_waits_on_a_wet_day(state):
    set_weather(state, rain_today=6.2)
    make_ready(state, "North")
    p = mock_petals.generate("North", state)
    assert _types(p) == ["defer_task"]
    assert p.actions[0].confidence == 0.7
    assert p.actions[0].reason == "wheat ripe but 6.2 mm rain today - too wet to harvest."


def test_ripe_cereal_harvests_before_hail_even_when_wet(state):
    sim.hail_warning(state)
    set_weather(state, rain_today=3.0)
    state.forecast[1]["hail"] = True
    make_ready(state, "North")
    p = mock_petals.generate("North", state)
    assert _types(p) == ["harvest"]
    assert p.actions[0].confidence == 0.5
    assert p.actions[0].reason == "Hail expected Wed 8 Jul; harvesting ripe wheat now."


def test_ripening_cereal_scouts(state):
    state.fields["North"].days_to_harvest = 2
    p = mock_petals.generate("North", state)
    assert _types(p) == ["scout"]
    assert p.actions[0].reason == "wheat ripening, 2 days to harvest; checking grain moisture."
    state.fields["West"].days_to_harvest = 1
    rapeseed = mock_petals.generate("West", state)
    assert rapeseed.actions[0].reason == "rapeseed ripening, 1 day to harvest; checking seed moisture."  # an oilseed
    state.fields["North"].days_to_harvest = 5
    assert _types(mock_petals.generate("North", state)) == []
    assert mock_petals.generate("North", state).rationale == "Crop within normal range; no action needed."


def test_river_irrigates_up_to_25_mm(state):
    state.fields["River"].soil_moisture = 50
    p = mock_petals.generate("River", state)
    assert _types(p) == ["irrigate"] and p.actions[0].mm == 25
    assert "Soil moisture 50%" in p.actions[0].reason and "over 2 days" in p.actions[0].reason


def test_river_irrigation_depth_follows_the_projection(state):
    for w in state.forecast:
        w.update(rain_mm=0.0, et0_mm=4.0)  # 2 days x 4.4 mm crop water use
    state.fields["River"].soil_moisture = 76.8  # -> projected 68 -> 90-68 = 22 -> 20 mm
    assert mock_petals.generate("River", state).actions[0].mm == 20
    state.fields["River"].soil_moisture = 88.8  # projected 80 >= 60 + 10: no irrigation
    assert _types(mock_petals.generate("River", state)) == []


def test_river_fits_the_permit_after_a_rejection(state):
    state.fields["River"].soil_moisture = 50
    state.water_permit_m3 = WATER_PERMIT_HEATWAVE_M3
    assert mock_petals.generate("River", state).actions[0].mm == 25  # asks for too much at first
    state.fields["River"].recent_rejections = ["Stay within the water permit"]
    p = mock_petals.generate("River", state)
    assert p.actions[0].mm == 15  # floor(3600 / 240)
    assert "fitted to today's 3,600 m³ water permit" in p.rationale
    assert p.rationale.endswith("(Noting recent rejection: Stay within the water permit)")


def test_river_skips_a_pass_too_small_for_the_permit(state):
    state.fields["River"].soil_moisture = 50
    state.water_permit_m3 = 1000  # floor(1000 / 240) = 4 mm < 5
    state.fields["River"].recent_rejections = ["too much water"]
    p = mock_petals.generate("River", state)
    assert _types(p) == []
    assert "too small for a useful pass" in p.rationale


def test_river_sprays_under_blight_pressure(state):
    state.fields["River"].disease = 0.65
    state.fields["River"].soil_moisture = 95
    p = mock_petals.generate("River", state)
    assert _types(p) == ["spray"] and p.actions[0].product == "fungicide" and p.actions[0].confidence == 0.7
    state.fields["River"].last_sprayed_tick = state.tick - 3
    assert _types(mock_petals.generate("River", state)) == []


def test_rejection_note_on_every_rationale(state):
    state.fields["North"].recent_rejections = ["first", "Wait for better weather"]
    p = mock_petals.generate("North", state)
    assert p.rationale.endswith(" (Noting recent rejection: Wait for better weather)")


# -- farm agents -------------------------------------------------------------------
def test_neighbour_shares_combine_and_storage(state):
    n = state.neighbours["Gut Rohrdommelsee"]
    n["combine_available"] = 1
    n["storage_used_t"] = 380
    cap = mock_farms.generate("Gut Rohrdommelsee", state)
    assert cap["farm"] == "Gut Rohrdommelsee"
    assert cap["can_share"] == {"combine": 1, "storage_t": 470.0}
    assert cap["confidence"] == 0.85
    assert cap["valid_until"] == "Tue 7 Jul"
    assert cap["note"] == "combine free, 520 t silo space"


def test_neighbour_busy_combine_and_scenario_holdback(state):
    n = state.neighbours["Gut Rohrdommelsee"]
    n["combine_available"] = 0
    n["storage_used_t"] = 380.4
    sim.start_heatwave(state)
    cap = mock_farms.generate("Gut Rohrdommelsee", state)
    assert cap["can_share"] == {"combine": 0, "storage_t": 234.0}  # floor((519.6 - 50) / 2)
    assert cap["confidence"] == 0.5
    assert cap["note"].startswith("combine busy")


def test_cereal_heavy_neighbour_keeps_its_combine_before_hail(state):
    state.neighbours["Agrarhof Oderblick"]["combine_available"] = 1
    sim.hail_warning(state)
    census = state.farm_census("Agrarhof Oderblick")
    assert census.ripe_backlog_ha == 60
    assert mock_farms.generate("Agrarhof Oderblick", state)["can_share"]["combine"] == 0


def test_own_farm_answers_from_its_real_state(state):
    cap = mock_farms.generate(OWN_FARM_NAME, state)
    assert cap["can_share"] == {"combine": 1, "storage_t": 280.0}  # 330 free - 50
    make_ready(state, "North")
    census = state.farm_census(OWN_FARM_NAME)
    assert census.ripe_backlog_ha == 42
    assert mock_farms.generate(OWN_FARM_NAME, state)["can_share"]["combine"] == 0
