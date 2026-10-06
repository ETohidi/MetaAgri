"""Coordinator: conflict resolution, the Machinery ring's suggestions, Thorn pass 2,
plan rows and the bundle shape."""
from hub import notices, stem, thorn
from hub.schemas import Action, Bundle
from hub.state import FARM_NAMES, OWN_FARM_NAME

from helpers import capacity, entry_for, make_ready, proposal, set_weather

ROHRDOMMELSEE, ODERBLICK = "Gut Rohrdommelsee", "Agrarhof Oderblick"


def _capacities(rohrdommelsee: dict | None = None, oderblick: dict | None = None) -> dict:
    return {
        OWN_FARM_NAME: capacity(OWN_FARM_NAME, combine=0, storage_t=100),
        ROHRDOMMELSEE: rohrdommelsee or capacity(ROHRDOMMELSEE, combine=1, storage_t=235, confidence=0.85),
        ODERBLICK: oderblick or capacity(ODERBLICK, combine=0, storage_t=50, confidence=0.85),
    }


def _log_texts(state, actor=None):
    return [e["text"] for e in state.log if actor is None or e["actor"] == actor]


def _ring(bundle) -> list[dict]:
    return [p for p in bundle["proposals"] if p["rationale"].startswith("Machinery ring:")]


def _actions(bundle, action_type) -> list[dict]:
    return [a for p in bundle["proposals"] for a in p["actions"] if a["type"] == action_type]


def _approve(state, bundle) -> list[str]:
    """What /decide does on approve: apply the plan, then the notices it produces."""
    state.apply_bundle(bundle)
    return [n["text"] for n in notices.generate(bundle, state)]


def _both_ripe(state):
    set_weather(state)
    make_ready(state, "North", "West")
    return [
        proposal("North", Action(type="harvest", confidence=0.85)),
        proposal("West", Action(type="harvest", confidence=0.85)),
        proposal("River", Action(type="irrigate", mm=20, confidence=0.8)),
    ]


# -- conflict resolution -----------------------------------------------------------
def test_combine_conflict_keeps_most_value_at_risk(state):
    resolved, unmet = stem._resolve_conflicts(state, _both_ripe(state))
    assert [a.type for a in resolved[0].actions] == ["harvest"]
    assert resolved[1].actions == []
    assert unmet == ["West"]
    text = _log_texts(state, "Coordinator")[-1]
    # North: 327.6 t x €220 = €72k; West: 115.6 t x €460 = €53k
    assert text == (
        "conflict: the combine was requested by North field and West field; "
        "kept North field (€72k at risk vs €53k), West field waits"
    )


def test_combine_conflict_follows_the_value(state):
    proposals = _both_ripe(state)
    state.fields["West"].yield_t_ha = 8.0  # 30 ha x 8 t x €460 = €110k > North's €72k
    resolved, unmet = stem._resolve_conflicts(state, proposals)
    assert resolved[0].actions == [] and [a.type for a in resolved[1].actions] == ["harvest"]
    assert unmet == ["North"]


def test_sprayer_conflict_keeps_most_disease_value_at_risk(state):
    set_weather(state)
    state.fields["North"].harvested = True
    state.fields["North"].harvested_t = 300
    state.fields["North"].disease = 0.2  # 0.2 x 300 t x €220 = €13k
    state.fields["River"].disease = 0.7  # 0.7 x 1008 t x €160 = €113k
    proposals = [
        proposal("North", Action(type="spray", product="herbicide")),
        proposal("River", Action(type="spray", product="fungicide"), Action(type="irrigate", mm=10)),
    ]
    resolved, unmet = stem._resolve_conflicts(state, proposals)
    assert resolved[0].actions == []
    assert [a.type for a in resolved[1].actions] == ["spray", "irrigate"]
    assert unmet == []  # losing the sprayer doesn't make a borrow_combine candidate
    assert _log_texts(state, "Coordinator")[-1].startswith("conflict: the sprayer was requested by North field and River field")


def test_no_conflict_when_one_field_wants_the_combine(state):
    set_weather(state)
    make_ready(state, "North")
    resolved, unmet = stem._resolve_conflicts(state, [proposal("North", Action(type="harvest"))])
    assert resolved[0].actions[0].type == "harvest" and unmet == []
    assert not any("conflict" in t for t in _log_texts(state))


def _unripe_north_ripe_west(state):
    set_weather(state)
    state.fields["North"].days_to_harvest = 1  # one day short of ripe
    make_ready(state, "West")
    return [
        proposal("North", Action(type="harvest")),
        proposal("West", Action(type="harvest")),
        proposal("River"),
    ]


def test_unripe_harvest_does_not_take_the_combine_from_a_ripe_field(state):
    """North (more € at risk, but not ripe) must not win our combine and leave the ripe
    West field waiting - or borrowing a neighbour's combine while ours stands idle."""
    caps = {name: capacity(name, combine=1, storage_t=200) for name in FARM_NAMES}
    bundle = stem.build_bundle(state, _unripe_north_ripe_west(state), caps)
    assert not any(t.startswith("conflict:") for t in _log_texts(state, "Coordinator"))
    assert entry_for(bundle["thorn"], "North", "harvest")["rule"] == thorn.RULE_HARVEST
    assert entry_for(bundle["thorn"], "West", "harvest")["blocked"] is False
    assert _actions(bundle, "borrow_combine") == []
    assert bundle["resources_after"]["combine"] == 0  # our own combine does the work
    assert [(r["field"], r["action_type"]) for r in bundle["plan_rows"]] == [("West", "harvest")]


def test_unripe_harvest_conflict_without_neighbour_combines(state):
    caps = {name: capacity(name, combine=0, storage_t=200) for name in FARM_NAMES}
    bundle = stem.build_bundle(state, _unripe_north_ripe_west(state), caps)
    assert entry_for(bundle["thorn"], "West", "harvest")["blocked"] is False
    assert not any("no neighbour combine free" in t for t in _log_texts(state, "Machinery ring"))
    assert bundle["resources_after"]["combine"] == 0


def test_spray_inside_pre_harvest_interval_does_not_take_the_sprayer(state):
    set_weather(state)
    state.fields["North"].disease = 0.9  # €65k at risk vs River's €56k, but 4 days from harvest
    proposals = [
        proposal("North", Action(type="spray", product="fungicide")),
        proposal("West"),
        proposal("River", Action(type="spray", product="fungicide")),
    ]
    bundle = stem.build_bundle(state, proposals, _capacities())
    assert not any(t.startswith("conflict:") for t in _log_texts(state, "Coordinator"))
    assert entry_for(bundle["thorn"], "North", "spray")["rule"] == thorn.RULE_PRE_HARVEST
    assert entry_for(bundle["thorn"], "River", "spray")["blocked"] is False
    assert bundle["resources_after"]["sprayer"] == 0


# -- Machinery ring ----------------------------------------------------------------
def test_ring_borrows_combine_and_delivers_surplus(state):
    bundle = stem.build_bundle(state, _both_ripe(state), _capacities())
    ring = [p for p in bundle["proposals"] if p["rationale"].startswith("Machinery ring:")]
    assert len(ring) == 1 and ring[0]["field"] == "West"
    borrow, deliver = ring[0]["actions"]
    assert borrow["type"] == "borrow_combine" and borrow["farm"] == ROHRDOMMELSEE
    assert deliver["type"] == "deliver_to" and deliver["farm"] == ROHRDOMMELSEE
    expected_surplus = state.fields["North"].yield_estimate_t + state.fields["West"].yield_estimate_t - 330
    assert abs(deliver["tonnes"] - expected_surplus) < 0.06
    assert ring[0]["confidence"] == 0.85
    assert not any(e["blocked"] for e in bundle["thorn"])
    assert bundle["resources_after"]["storage_free_t"] == 0
    assert bundle["resources_after"]["workers"] == 5 - 2 - 1 - 1  # harvest, irrigate, grain cart
    assert "compiled spare capacity from 3 farms" in _log_texts(state, "Machinery ring")


def test_ring_never_borrows_from_own_farm_and_picks_highest_confidence(state):
    caps = _capacities(
        rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=235, confidence=0.5),
        oderblick=capacity(ODERBLICK, combine=1, storage_t=200, confidence=0.9),
    )
    caps[OWN_FARM_NAME] = capacity(OWN_FARM_NAME, combine=1, storage_t=500, confidence=1.0)
    bundle = stem.build_bundle(state, _both_ripe(state), caps)
    ring = next(p for p in bundle["proposals"] if p["rationale"].startswith("Machinery ring:"))
    assert ring["actions"][0]["farm"] == ODERBLICK
    assert all(a["farm"] != OWN_FARM_NAME for a in ring["actions"])


def test_ring_splits_surplus_over_neighbours(state):
    caps = _capacities(
        rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=60, confidence=0.85),
        oderblick=capacity(ODERBLICK, combine=0, storage_t=200, confidence=0.5),
    )
    bundle = stem.build_bundle(state, _both_ripe(state), caps)
    ring = next(p for p in bundle["proposals"] if p["rationale"].startswith("Machinery ring:"))
    delivers = [a for a in ring["actions"] if a["type"] == "deliver_to"]
    assert [(a["farm"], a["tonnes"]) for a in delivers][0] == (ROHRDOMMELSEE, 60)
    assert delivers[1]["farm"] == ODERBLICK
    assert abs(sum(a["tonnes"] for a in delivers) - (443.2 - 330)) < 0.1
    assert ring["confidence"] == 0.5  # min over its actions


def test_ring_warns_when_no_neighbour_combine_is_free(state):
    caps = _capacities(rohrdommelsee=capacity(ROHRDOMMELSEE, combine=0, storage_t=235))
    bundle = stem.build_bundle(state, _both_ripe(state), caps)
    assert "no neighbour combine free today; West field waits" in _log_texts(state, "Machinery ring")
    assert not any(a["type"] == "borrow_combine" for p in bundle["proposals"] for a in p["actions"])
    # Only North's 327.6 t comes in, which fits in the 330 t free: no deliver_to either.
    assert not any(a["type"] == "deliver_to" for p in bundle["proposals"] for a in p["actions"])


def test_ring_deliver_to_without_borrow_goes_on_the_harvest_field(state):
    set_weather(state)
    make_ready(state, "North")
    state.storage_used_t = 400  # only 50 t free
    caps = _capacities(rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=300))
    bundle = stem.build_bundle(state, [proposal("North", Action(type="harvest"))], caps)
    ring = next(p for p in bundle["proposals"] if p["rationale"].startswith("Machinery ring:"))
    assert ring["field"] == "North"
    assert ring["actions"] == [
        {
            "type": "deliver_to",
            "tonnes": 277.6,
            "farm": ROHRDOMMELSEE,
            "confidence": 0.85,
            "reason": ring["actions"][0]["reason"],
        }
    ]


# -- Thorn pass 2 ------------------------------------------------------------------
def test_pass_two_continues_from_pass_one_usage(state):
    """Pass 1 books all 5 workers, so the ring's borrow_combine (1 worker) is blocked in
    pass 2 - and no deliver_to is suggested for grain that then stays on the field."""
    set_weather(state)
    make_ready(state, "North", "West")
    proposals = [
        proposal("North", Action(type="harvest")),  # 2
        proposal("West", Action(type="harvest")),  # loses the combine conflict
        proposal(
            "River",
            Action(type="irrigate", mm=10),  # 1
            Action(type="spray", product="fungicide"),  # 1
            Action(type="fertilize", kg_n_ha=20),  # 1
        ),
    ]
    bundle = stem.build_bundle(state, proposals, _capacities())
    assert entry_for(bundle["thorn"], "West", "borrow_combine")["rule"] == thorn.RULE_WORKERS
    assert "blocked borrow_combine for West field: " + thorn.RULE_WORKERS in _log_texts(state, "Safety check")
    assert not any(e["action"]["type"] == "deliver_to" for e in bundle["thorn"])
    assert not any(r["action_type"] == "deliver_to" for r in bundle["plan_rows"])
    rohrdommelsee_before = state.neighbours[ROHRDOMMELSEE]["storage_used_t"]
    texts = _approve(state, bundle)
    assert not state.fields["West"].harvested
    assert state.neighbours[ROHRDOMMELSEE]["storage_used_t"] == rohrdommelsee_before
    assert not any("expect about" in t for t in texts)
    assert not any(a["kind"] == "deliver" for a in state.recent_actions)


# -- the ring counts what the field agents already arranged themselves -----------
def test_ring_delivers_the_surplus_of_a_field_agents_own_borrow(state):
    set_weather(state)
    make_ready(state, "North", "West")
    proposals = [
        proposal("North", Action(type="harvest")),
        proposal("West", Action(type="borrow_combine", farm=ROHRDOMMELSEE)),
    ]
    bundle = stem.build_bundle(state, proposals, _capacities())
    assert not any(e["blocked"] for e in bundle["thorn"])
    (deliver,) = _actions(bundle, "deliver_to")
    assert deliver["farm"] == ROHRDOMMELSEE and abs(deliver["tonnes"] - 113.2) < 0.06
    assert _ring(bundle)[0]["field"] == "West"
    rohrdommelsee_before = state.neighbours[ROHRDOMMELSEE]["storage_used_t"]
    _approve(state, bundle)
    assert abs(state.neighbours[ROHRDOMMELSEE]["storage_used_t"] - rohrdommelsee_before - 113.2) < 0.06
    assert not any(t.startswith("sold") for t in _log_texts(state, "Farm"))


def test_ring_counts_a_field_agents_own_delivery(state):
    """North sends its own 77.6 t overflow to Gut Rohrdommelsee; the ring then only moves
    West's 115.6 t, and from what Gut Rohrdommelsee has left (not 193.2 t on top)."""
    set_weather(state)
    make_ready(state, "North", "West")
    state.storage_used_t = 200  # 250 t free
    proposals = [
        proposal("North", Action(type="harvest"), Action(type="deliver_to", farm=ROHRDOMMELSEE, tonnes=77.6)),
        proposal("West", Action(type="harvest")),  # loses the combine, borrows one
    ]
    caps = _capacities(rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=235))
    bundle = stem.build_bundle(state, proposals, caps)
    assert not any(e["blocked"] for e in bundle["thorn"])
    ring_delivers = [a for p in _ring(bundle) for a in p["actions"] if a["type"] == "deliver_to"]
    assert [(a["farm"], a["tonnes"]) for a in ring_delivers] == [(ROHRDOMMELSEE, 115.6)]
    rohrdommelsee_before = state.neighbours[ROHRDOMMELSEE]["storage_used_t"]
    texts = _approve(state, bundle)
    assert abs(state.neighbours[ROHRDOMMELSEE]["storage_used_t"] - rohrdommelsee_before - 193.2) < 0.06
    assert state.storage_free_t == 0 and not any(t.startswith("sold") for t in _log_texts(state, "Farm"))
    assert sorted(t for t in texts if "expect about" in t) == [
        "Gut Rohrdommelsee: expect about 116 t of rapeseed for storage today.",
        "Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today.",
    ]


def test_no_ring_delivery_when_the_field_agent_already_sent_the_surplus(state):
    set_weather(state)
    make_ready(state, "North")
    state.storage_used_t = 200  # 250 t free -> 77.6 t overflow
    proposals = [proposal("North", Action(type="harvest"), Action(type="deliver_to", farm=ROHRDOMMELSEE, tonnes=77.6))]
    bundle = stem.build_bundle(state, proposals, _capacities())
    assert _ring(bundle) == [] and len(_actions(bundle, "deliver_to")) == 1
    texts = _approve(state, bundle)
    assert [t for t in texts if "expect about" in t] == ["Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today."]


def test_ring_skips_a_field_already_harvested_with_its_own_borrow(state):
    """West loses the combine conflict but has borrowed a combine itself: no second
    borrow from the ring, so no spurious safety-check block."""
    proposals = _both_ripe(state)
    proposals[1].actions.append(Action(type="borrow_combine", farm=ROHRDOMMELSEE))
    bundle = stem.build_bundle(state, proposals, _capacities())
    assert not any(e["blocked"] for e in bundle["thorn"])
    assert not any(t.startswith("blocked") for t in _log_texts(state, "Safety check"))
    assert len(_actions(bundle, "borrow_combine")) == 1
    (deliver,) = _actions(bundle, "deliver_to")
    assert abs(deliver["tonnes"] - 113.2) < 0.06


# -- a neighbour's agent over-reports its silo space -------------------------------
def test_over_reported_neighbour_storage_keeps_the_mass_balance(state):
    """Agrarhof Oderblick really has 20 t free but its agent says 300 t: only 20 t go
    there, the rest is sold (and logged), and its notice says 20 t, not 113 t."""
    state.neighbours[ODERBLICK]["storage_used_t"] = 580  # of 600
    caps = _capacities(
        rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=0),
        oderblick=capacity(ODERBLICK, combine=0, storage_t=300, confidence=0.9),
    )
    bundle = stem.build_bundle(state, _both_ripe(state), caps)
    (deliver,) = _actions(bundle, "deliver_to")
    assert deliver["farm"] == ODERBLICK and abs(deliver["tonnes"] - 113.2) < 0.06
    own_before = state.storage_used_t
    harvested_t = state.fields["North"].yield_estimate_t + state.fields["West"].yield_estimate_t
    texts = _approve(state, bundle)
    own_in = state.storage_used_t - own_before
    neighbour_in = state.neighbours[ODERBLICK]["storage_used_t"] - 580
    assert own_in == 330 and neighbour_in == 20
    # everything that fit nowhere is sold - and logged - rather than vanishing
    sold = [e["text"] for e in state.log if e["actor"] == "Farm" and e["text"].startswith("sold")]
    assert sold == [f"sold {harvested_t - own_in - neighbour_in:.0f} t directly to the co-op at the harvest spot price"]
    assert sold == ["sold 93 t directly to the co-op at the harvest spot price"]
    assert "Agrarhof Oderblick: expect about 20 t of rapeseed for storage today." in texts


def test_field_agent_divert_to_zero_capacity_farm_blocked(state):
    """borrow_combine naming a farm that reports zero spare capacity."""
    set_weather(state)
    make_ready(state, "West")
    proposals = [proposal("West", Action(type="borrow_combine", farm=ODERBLICK, confidence=0.6))]
    bundle = stem.build_bundle(state, proposals, _capacities())
    e = entry_for(bundle["thorn"], "West", "borrow_combine")
    assert e["blocked"] is True and e["rule"] == thorn.RULE_NEIGHBOUR_CAPACITY
    assert bundle["plan_rows"] == [] and bundle["overall_confidence"] is None


# -- plan rows / bundle ------------------------------------------------------------
def test_plan_rows_and_summary(state):
    bundle = stem.build_bundle(state, _both_ripe(state), _capacities())
    rows = {(r["field"], r["action_type"]): r for r in bundle["plan_rows"]}
    north = state.fields["North"].yield_estimate_t
    assert rows[("North", "harvest")]["what"] == f"Harvest ~{north:.0f} t"
    assert rows[("North", "harvest")]["resources"] == "combine · 2 workers"
    assert rows[("River", "irrigate")]["what"] == "Irrigate 20 mm"
    assert rows[("River", "irrigate")]["resources"] == "4,800 m³ water · 1 worker"
    assert rows[("West", "borrow_combine")]["what"].startswith("Harvest with Gut Rohrdommelsee's combine (~")
    assert rows[("West", "borrow_combine")]["resources"] == "Gut Rohrdommelsee's combine · 1 worker"
    assert rows[("West", "deliver_to")]["what"].startswith("Deliver ") and rows[("West", "deliver_to")]["what"].endswith(" t to Gut Rohrdommelsee")
    assert rows[("West", "deliver_to")]["resources"] == "—"
    assert bundle["summary"] == "Mon 6 Jul: 4 proposals, 4/4 actions cleared by the safety check"
    assert bundle["overall_confidence"] == 0.8
    assert bundle["plan_for"] == "Mon 6 Jul" and bundle["status"] == "pending"
    Bundle(**bundle)  # the stored dict matches the frozen schema
    assert _log_texts(state, "Coordinator")[-1] == bundle["summary"]


def test_every_proposal_logged_by_its_field_agent(state):
    stem.build_bundle(state, _both_ripe(state), _capacities())
    assert _log_texts(state, "River field agent")[-1] == "proposed 1 action(s): test"
    assert _log_texts(state, "North field agent")[-1] == "proposed 1 action(s): test"


def test_bundle_ids_increment_and_capacity_is_recorded(state):
    caps = _capacities()
    first = stem.build_bundle(state, [proposal("North", Action(type="scout"))], caps)
    second = stem.build_bundle(state, [proposal("North", Action(type="scout"))], caps)
    assert second["bundle_id"] == first["bundle_id"] + 1
    assert state.nearby_capacity is caps
    assert [c["farm"] for c in first["nearby_capacity"]] == [OWN_FARM_NAME, ROHRDOMMELSEE, ODERBLICK]


def test_ring_does_not_split_off_a_trivial_remainder(state):
    """The first neighbour takes all but 0.2 t: no 'Deliver 0 t' trailer trip for the rest."""
    proposals = _both_ripe(state)
    surplus = state.fields["North"].yield_estimate_t + state.fields["West"].yield_estimate_t - state.storage_free_t
    caps = _capacities(
        rohrdommelsee=capacity(ROHRDOMMELSEE, combine=1, storage_t=round(surplus - 0.2, 1), confidence=0.85),
        oderblick=capacity(ODERBLICK, combine=0, storage_t=250, confidence=0.5),
    )
    bundle = stem.build_bundle(state, proposals, caps)
    delivers = _actions(bundle, "deliver_to")
    assert [a["farm"] for a in delivers] == [ROHRDOMMELSEE]
    assert not any(r["what"].startswith("Deliver 0 t") for r in bundle["plan_rows"])
    notice_texts = _approve(state, bundle)
    assert not any("about 0 t" in t for t in notice_texts)
    assert not any(t.startswith("sold 0 t") for t in _log_texts(state, "Farm"))
