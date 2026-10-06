"""Every Safety-check rule: one allowed and one blocked case each, plus ordering and
resource accounting."""
from hub import thorn
from hub.schemas import Action, Proposal
from hub.state import OWN_FARM_NAME, WATER_PERMIT_HEATWAVE_M3

from helpers import capacity, entry_for, make_ready, proposal, set_weather


def _evaluate(state, *proposals, starting_usage=None):
    return thorn.evaluate(list(proposals), state, starting_usage=starting_usage)


# -- RULE_PROPOSAL_SHAPE ---------------------------------------------------------
def test_shape_allowed(state):
    entries, filtered, _, _ = _evaluate(state, proposal("North", Action(type="scout")))
    assert entries[0]["blocked"] is False
    assert filtered[0].actions[0].type == "scout"


def test_shape_blank_rationale_blocks_every_action(state):
    p = proposal("River", Action(type="scout"), Action(type="irrigate", mm=10), rationale="   ")
    entries, filtered, _, _ = _evaluate(state, p)
    assert [e["rule"] for e in entries] == [thorn.RULE_PROPOSAL_SHAPE] * 2
    assert all(e["blocked"] for e in entries)
    assert filtered == []


def test_shape_confidence_out_of_range_blocked(state):
    p = Proposal.model_construct(field="North", actions=[Action(type="scout")], rationale="ok", confidence=1.4, risks=[])
    entries, _, _, _ = _evaluate(state, p)
    assert entries[0]["rule"] == thorn.RULE_PROPOSAL_SHAPE


# -- RULE_WATER_PERMIT -----------------------------------------------------------
def test_water_permit_allowed_normal_day(state):
    entries, _, before, after = _evaluate(state, proposal("River", Action(type="irrigate", mm=25)))
    assert entries[0]["blocked"] is False
    assert before["water_m3"] == 6500
    assert after["water_m3"] == 500  # 25 mm x 24 ha x 10 = 6,000 m³


def test_water_permit_blocked_in_heatwave(state):
    state.water_permit_m3 = WATER_PERMIT_HEATWAVE_M3
    entries, filtered, _, after = _evaluate(state, proposal("River", Action(type="irrigate", mm=25)))
    assert entries[0]["rule"] == thorn.RULE_WATER_PERMIT
    assert filtered[0].actions == []
    assert after["water_m3"] == WATER_PERMIT_HEATWAVE_M3  # a blocked action consumes nothing
    assert after["workers"] == 5


def test_water_permit_exactly_at_the_cut_permit_allowed(state):
    state.water_permit_m3 = WATER_PERMIT_HEATWAVE_M3
    entries, _, _, after = _evaluate(state, proposal("River", Action(type="irrigate", mm=15)))
    assert entries[0]["blocked"] is False
    assert after["water_m3"] == 0


# -- RULE_NOT_IRRIGABLE ----------------------------------------------------------
def test_not_irrigable_blocked(state):
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="irrigate", mm=10)))
    assert entries[0]["rule"] == thorn.RULE_NOT_IRRIGABLE


def test_irrigable_field_allowed(state):
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="irrigate", mm=10)))
    assert entries[0]["blocked"] is False


# -- RULE_SPRAY_WEATHER / RULE_PRE_HARVEST ---------------------------------------
def test_spray_allowed_on_calm_dry_day(state):
    set_weather(state, wind=3.0, rain_tomorrow=0.0)
    entries, _, _, after = _evaluate(state, proposal("River", Action(type="spray", product="fungicide")))
    assert entries[0]["blocked"] is False
    assert after["sprayer"] == 0


def test_spray_blocked_by_wind(state):
    set_weather(state, wind=6.0)
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="spray", product="fungicide")))
    assert entries[0]["rule"] == thorn.RULE_SPRAY_WEATHER


def test_spray_blocked_by_rain_tomorrow(state):
    set_weather(state, wind=2.0, rain_tomorrow=6.0)
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="spray", product="fungicide")))
    assert entries[0]["rule"] == thorn.RULE_SPRAY_WEATHER


def test_spray_blocked_by_pre_harvest_interval(state):
    set_weather(state)
    assert state.fields["North"].days_to_harvest <= thorn.PRE_HARVEST_DAYS
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="spray", product="fungicide")))
    assert entries[0]["rule"] == thorn.RULE_PRE_HARVEST


def test_spray_after_harvest_allowed(state):
    set_weather(state)
    state.fields["North"].harvested = True
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="spray", product="herbicide")))
    assert entries[0]["blocked"] is False


# -- RULE_HARVEST ----------------------------------------------------------------
def test_harvest_allowed_ripe_and_dry(state):
    set_weather(state, rain_today=1.5)
    make_ready(state, "North")
    entries, _, before, after = _evaluate(state, proposal("North", Action(type="harvest")))
    assert entries[0]["blocked"] is False
    assert after["combine"] == 0 and after["workers"] == 3
    expected_free = max(0.0, before["storage_free_t"] - state.fields["North"].yield_estimate_t)
    assert after["storage_free_t"] == round(expected_free, 1)


def test_harvest_blocked_not_ripe(state):
    set_weather(state)
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="harvest")))
    assert entries[0]["rule"] == thorn.RULE_HARVEST


def test_harvest_blocked_on_wet_day(state):
    set_weather(state, rain_today=2.0)
    make_ready(state, "North")
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="harvest")))
    assert entries[0]["rule"] == thorn.RULE_HARVEST


def test_harvest_blocked_when_already_harvested(state):
    set_weather(state)
    make_ready(state, "North")
    state.fields["North"].harvested = True
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="harvest")))
    assert entries[0]["rule"] == thorn.RULE_HARVEST


def test_same_field_cannot_be_harvested_twice_in_one_plan(state):
    set_weather(state)
    make_ready(state, "West")
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee")}
    entries, _, _, _ = _evaluate(
        state, proposal("West", Action(type="harvest"), Action(type="borrow_combine", farm="Gut Rohrdommelsee"))
    )
    assert entries[0]["blocked"] is False
    assert entries[1]["rule"] == thorn.RULE_HARVEST


# -- RULE_MACHINE ----------------------------------------------------------------
def test_machine_second_harvest_blocked(state):
    set_weather(state)
    make_ready(state, "North", "West")
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="harvest")), proposal("West", Action(type="harvest")))
    assert entry_for(entries, "North", "harvest")["blocked"] is False
    assert entry_for(entries, "West", "harvest")["rule"] == thorn.RULE_MACHINE


def test_machine_second_spray_blocked(state):
    set_weather(state)
    state.fields["North"].harvested = True  # stubble: no pre-harvest interval
    entries, _, _, _ = _evaluate(
        state,
        proposal("River", Action(type="spray", product="fungicide")),
        proposal("North", Action(type="spray", product="herbicide")),
    )
    assert entry_for(entries, "River", "spray")["blocked"] is False
    assert entry_for(entries, "North", "spray")["rule"] == thorn.RULE_MACHINE


# -- RULE_WORKERS ----------------------------------------------------------------
def test_workers_exactly_five_allowed_sixth_blocked(state):
    set_weather(state)
    make_ready(state, "North")
    state.fields["West"].harvested = True  # bare stubble: the cover crop itself is fine
    entries, _, _, after = _evaluate(
        state,
        proposal("North", Action(type="harvest")),  # 2 workers
        proposal(
            "River",
            Action(type="irrigate", mm=10),  # 1
            Action(type="spray", product="fungicide"),  # 1
            Action(type="fertilize", kg_n_ha=30),  # 1
        ),
        proposal("West", Action(type="sow_cover_crop")),  # 1 -> the 6th worker
    )
    assert [e["blocked"] for e in entries if e["field"] != "West"] == [False] * 4
    assert entry_for(entries, "West", "sow_cover_crop")["rule"] == thorn.RULE_WORKERS
    assert after["workers"] == 0


# -- RULE_FERTILIZE --------------------------------------------------------------
def test_fertilize_allowed(state):
    set_weather(state, rain_tomorrow=4.0)
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="fertilize", kg_n_ha=40)))
    assert entries[0]["blocked"] is False


def test_fertilize_blocked_waterlogged(state):
    set_weather(state)
    state.fields["River"].soil_moisture = 95
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="fertilize", kg_n_ha=40)))
    assert entries[0]["rule"] == thorn.RULE_FERTILIZE


def test_fertilize_blocked_before_heavy_rain(state):
    set_weather(state, rain_tomorrow=12.0)
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="fertilize", kg_n_ha=40)))
    assert entries[0]["rule"] == thorn.RULE_FERTILIZE


def test_fertilize_blocked_on_harvested_field(state):
    set_weather(state)
    state.fields["North"].harvested = True
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="fertilize", kg_n_ha=40)))
    assert entries[0]["rule"] == thorn.RULE_FERTILIZE


# -- RULE_NEIGHBOUR_FARM ---------------------------------------------------------
def test_neighbour_farm_missing_blocked(state):
    set_weather(state)
    make_ready(state, "West")
    entries, _, _, _ = _evaluate(
        state, proposal("West", Action(type="borrow_combine"), Action(type="deliver_to", tonnes=10))
    )
    assert [e["rule"] for e in entries] == [thorn.RULE_NEIGHBOUR_FARM] * 2


def test_neighbour_farm_named_allowed(state):
    set_weather(state)
    make_ready(state, "West")
    state.storage_used_t = 400  # 50 t free, so ~66 t of West's rapeseed won't fit
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee")}
    entries, _, _, after = _evaluate(
        state,
        proposal(
            "West",
            Action(type="borrow_combine", farm="Gut Rohrdommelsee"),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=50),
        ),
    )
    assert [e["blocked"] for e in entries] == [False, False]
    assert after["combine"] == 1  # our own combine stays free
    assert after["workers"] == 4  # our grain cart


# -- RULE_NEIGHBOUR_CAPACITY -----------------------------------------------------
def test_neighbour_capacity_zero_combine_blocked(state):
    set_weather(state)
    make_ready(state, "West")
    state.nearby_capacity = {"Agrarhof Oderblick": capacity("Agrarhof Oderblick", combine=0)}
    entries, _, _, _ = _evaluate(state, proposal("West", Action(type="borrow_combine", farm="Agrarhof Oderblick")))
    assert entries[0]["rule"] == thorn.RULE_NEIGHBOUR_CAPACITY


def test_neighbour_capacity_own_or_unknown_farm_counts_as_zero(state):
    set_weather(state)
    make_ready(state, "West")
    state.nearby_capacity = {OWN_FARM_NAME: capacity(OWN_FARM_NAME, combine=1, storage_t=300)}
    for farm in (OWN_FARM_NAME, "Hof Nirgendwo"):
        entries, _, _, _ = _evaluate(
            state,
            proposal("West", Action(type="borrow_combine", farm=farm), Action(type="deliver_to", farm=farm, tonnes=5)),
        )
        assert [e["rule"] for e in entries] == [thorn.RULE_NEIGHBOUR_CAPACITY] * 2


def test_neighbour_capacity_storage_exceeded_blocked_within_allowed(state):
    set_weather(state)
    make_ready(state, "North")
    state.storage_used_t = 450  # silo full: all of North's 327.6 t is surplus
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee", storage_t=100)}
    entries, _, _, _ = _evaluate(
        state,
        proposal(
            "North",
            Action(type="harvest"),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=80),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=30),  # 110 > 100
        ),
    )
    assert [e["blocked"] for e in entries[:2]] == [False, False]
    assert entries[2]["rule"] == thorn.RULE_NEIGHBOUR_CAPACITY


def test_neighbour_capacity_one_combine_lends_to_one_field(state):
    set_weather(state)
    make_ready(state, "North", "West")
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee", combine=1)}
    entries, _, _, _ = _evaluate(
        state,
        proposal("North", Action(type="borrow_combine", farm="Gut Rohrdommelsee")),
        proposal("West", Action(type="borrow_combine", farm="Gut Rohrdommelsee")),
    )
    assert entry_for(entries, "North", "borrow_combine")["blocked"] is False
    assert entry_for(entries, "West", "borrow_combine")["rule"] == thorn.RULE_NEIGHBOUR_CAPACITY


# -- ordering and accounting -------------------------------------------------------
def test_priority_harvest_before_irrigate_before_spray(state):
    set_weather(state)
    make_ready(state, "North")
    p_river = proposal("River", Action(type="spray", product="fungicide"), Action(type="irrigate", mm=10))
    p_north = proposal("North", Action(type="scout"), Action(type="harvest"))
    entries, _, _, _ = _evaluate(state, p_river, p_north)
    assert [e["action"]["type"] for e in entries] == ["harvest", "irrigate", "spray", "scout"]


def test_starting_usage_continues_from_first_pass(state):
    set_weather(state)
    make_ready(state, "North", "West")
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee")}
    first = [proposal("North", Action(type="harvest")), proposal("River", Action(type="irrigate", mm=20))]
    _, filtered, _, _ = thorn.evaluate(first, state)
    usage = thorn.usage_of(filtered, state)
    assert usage["workers"] == 3 and usage["combine"] == 1 and usage["water_m3"] == 4800
    # Second pass: our combine is taken, so a local harvest is blocked; a borrowed one is fine.
    entries, _, _, after = thorn.evaluate(
        [proposal("West", Action(type="harvest"), Action(type="borrow_combine", farm="Gut Rohrdommelsee"))],
        state,
        starting_usage=usage,
    )
    assert entries[0]["rule"] == thorn.RULE_MACHINE
    assert entries[1]["blocked"] is False
    assert after["workers"] == 1 and after["water_m3"] == 1700 and after["combine"] == 0
    assert usage["workers"] == 3  # the caller's usage dict is not mutated


def test_storage_after_floors_at_zero_and_deliver_never_frees_own_silo(state):
    set_weather(state)
    make_ready(state, "North", "West")
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee", storage_t=300)}
    _, _, before, after = _evaluate(
        state,
        proposal("North", Action(type="harvest")),
        proposal(
            "West",
            Action(type="borrow_combine", farm="Gut Rohrdommelsee"),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=113.2),  # 443.2 - 330: the whole surplus
        ),
    )
    assert before["storage_free_t"] == 330
    assert after["storage_free_t"] == 0


# -- RULE_COVER_CROP -------------------------------------------------------------
def test_cover_crop_allowed_on_harvested_bare_field(state):
    state.fields["North"].harvested = True
    entries, _, _, after = _evaluate(state, proposal("North", Action(type="sow_cover_crop")))
    assert entries[0]["blocked"] is False
    assert after["workers"] == 4


def test_cover_crop_blocked_on_standing_crop(state):
    make_ready(state, "North")  # ripe but still on the field
    for field in ("North", "River"):  # River: potatoes 48 days from harvest
        entries, _, _, after = _evaluate(state, proposal(field, Action(type="sow_cover_crop")))
        assert entries[0]["rule"] == thorn.RULE_COVER_CROP
        assert after["workers"] == 5


def test_cover_crop_blocked_when_one_is_already_sown(state):
    state.fields["North"].harvested = True
    state.fields["North"].cover_crop = True
    entries, _, _, _ = _evaluate(state, proposal("North", Action(type="sow_cover_crop")))
    assert entries[0]["rule"] == thorn.RULE_COVER_CROP


# -- RULE_DELIVER_SURPLUS --------------------------------------------------------
def test_deliver_to_blocked_without_surplus(state):
    """River has nothing to harvest; a hint-driven deliver_to would tell a neighbour to
    expect 200 t that never come."""
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee", storage_t=300)}
    entries, filtered, _, _ = _evaluate(
        state, proposal("River", Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=200))
    )
    assert entries[0]["rule"] == thorn.RULE_DELIVER_SURPLUS
    assert filtered[0].actions == []


def test_deliver_to_only_up_to_what_does_not_fit(state):
    set_weather(state)
    make_ready(state, "North")
    state.storage_used_t = 400  # 50 t free -> 277.6 t of North's wheat won't fit
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee", storage_t=500)}
    entries, _, _, _ = _evaluate(
        state,
        proposal(
            "North",
            Action(type="harvest"),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=200),
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=77.6),  # exactly the rest
            Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=10),  # nothing left to move
        ),
    )
    assert [e["blocked"] for e in entries] == [False, False, False, True]
    assert entries[3]["rule"] == thorn.RULE_DELIVER_SURPLUS


def test_passes_alone(state):
    set_weather(state)
    north = proposal("North", Action(type="harvest"))
    assert thorn.passes_alone(north, north.actions[0], state) is False  # 4 days from ripe
    make_ready(state, "North")
    assert thorn.passes_alone(north, north.actions[0], state) is True
    spray = proposal("North", Action(type="spray", product="fungicide"))
    assert thorn.passes_alone(spray, spray.actions[0], state) is False  # pre-harvest interval


# -- RULE_ACTION_PARAMS -------------------------------------------------------------
def test_action_amounts_are_required(state):
    set_weather(state)
    state.nearby_capacity = {"Gut Rohrdommelsee": capacity("Gut Rohrdommelsee")}
    for action in (
        Action(type="irrigate"),
        Action(type="irrigate", mm=0),
        Action(type="fertilize"),
        Action(type="deliver_to", farm="Gut Rohrdommelsee"),
        Action(type="deliver_to", farm="Gut Rohrdommelsee", tonnes=0),
    ):
        entries, _, _, after = _evaluate(state, proposal("River", action))
        assert entries[0]["rule"] == thorn.RULE_ACTION_PARAMS, action
        assert after["workers"] == 5  # a blocked action costs nothing
    entries, _, _, _ = _evaluate(state, proposal("River", Action(type="fertilize", kg_n_ha=40)))
    assert entries[0]["blocked"] is False
