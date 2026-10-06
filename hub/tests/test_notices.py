"""Notice templates, confidence labels, and applying an approved plan to the twin."""
from hub import notices

from helpers import make_ready


def _bundle(*proposals) -> dict:
    return {"bundle_id": 1, "tick": 0, "plan_for": "Mon 6 Jul", "proposals": list(proposals), "status": "approved"}


def _p(field, *actions, confidence=0.8):
    return {"field": field, "actions": list(actions), "rationale": "test", "confidence": confidence, "risks": []}


def test_confidence_labels():
    assert notices.confidence_label(0.7) == "high"
    assert notices.confidence_label(0.69) == "medium"
    assert notices.confidence_label(0.4) == "medium"
    assert notices.confidence_label(0.39) == "low"


def test_every_template(state):
    bundle = _bundle(
        _p("West", {"type": "harvest", "confidence": 0.85}),
        _p("River", {"type": "spray", "product": "fungicide"}, {"type": "irrigate", "mm": 25.0}, {"type": "fertilize"}),
        _p("North", {"type": "sow_cover_crop"}, {"type": "scout"}, {"type": "defer_task"}),
        _p(
            "North",
            {"type": "borrow_combine", "farm": "Gut Rohrdommelsee", "confidence": 0.5},
            {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": 114.6},
        ),
    )
    by_text = {n["text"]: n["audience"] for n in notices.generate(bundle, state)}
    west_t = f"{state.fields['West'].yield_estimate_t:.0f}"
    north_t = f"{state.fields['North'].yield_estimate_t:.0f}"
    assert by_text == {
        f"Rapeseed harvest on West field today — about {west_t} t expected. Confidence: high.": "Buyers",
        "Fungicide spraying on River field today — please keep hives and walkers away from the field edge.": "Beekeepers & neighbours",
        "Irrigation running on River field today (25 mm) — the field track may be wet.": "Neighbours",
        "Fertilizer spreading on River field today.": "Neighbours",
        "Cover crop sown on North field after the wheat harvest.": "Neighbours",
        f"Winter wheat harvest on North field today — about {north_t} t expected. Confidence: medium.": "Buyers",
        "Gut Rohrdommelsee: thanks for lending your combine for our North field (winter wheat) today.": "Gut Rohrdommelsee",
        "Gut Rohrdommelsee: expect about 115 t of winter wheat for storage today.": "Gut Rohrdommelsee",
    }


def test_notices_keep_the_last_30(state):
    for i in range(35):
        state.add_notice("Buyers", f"n{i}")
    assert len(state.notices) == 30
    assert state.notices[0]["text"] == "n5" and state.notices[-1]["text"] == "n34"
    assert set(state.notices[-1]) == {"tick", "date", "audience", "text"}


# -- apply_bundle ------------------------------------------------------------------
def test_apply_irrigate_and_spray(state):
    river = state.fields["River"]
    river.soil_moisture = 80
    river.disease = 0.6
    state.apply_bundle(_bundle(_p("River", {"type": "irrigate", "mm": 25.0}, {"type": "spray", "product": "fungicide"})))
    assert river.soil_moisture == 100  # capped
    assert river.last_irrigated_tick == 0 and river.last_sprayed_tick == 0
    assert abs(river.disease - 0.2) < 1e-9
    assert state.history["River"][-1]["irrigation_mm"] == 25.0
    assert state.recent_actions == [{"field": "River", "kind": "irrigate"}, {"field": "River", "kind": "spray"}]


def test_apply_spray_disease_floor(state):
    state.fields["River"].disease = 0.3
    state.apply_bundle(_bundle(_p("River", {"type": "spray"})))
    assert state.fields["River"].disease == 0.05


def test_apply_harvest_fills_silo_and_delivers_surplus(state):
    make_ready(state, "North", "West")
    north_t = state.fields["North"].yield_estimate_t
    west_t = state.fields["West"].yield_estimate_t
    surplus = north_t + west_t - 330
    rohrdommelsee_before = state.neighbours["Gut Rohrdommelsee"]["storage_used_t"]
    state.apply_bundle(
        _bundle(
            # deliver_to listed first on purpose: it's applied after every harvest
            _p("West", {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": round(surplus, 1)}),
            _p("North", {"type": "harvest"}),
            _p("West", {"type": "borrow_combine", "farm": "Gut Rohrdommelsee"}),
        )
    )
    assert state.fields["North"].harvested and state.fields["North"].stage == "harvested"
    assert state.fields["North"].yield_estimate_t == north_t
    assert state.storage_used_t == 450 and state.storage_free_t == 0
    moved = state.neighbours["Gut Rohrdommelsee"]["storage_used_t"] - rohrdommelsee_before
    assert abs(moved - surplus) < 0.06
    assert state.pending_surplus_t == 0
    assert not any(e["text"].startswith("sold") for e in state.log)
    assert state.own_combine_busy and state.to_dict()["resources"]["combine"] == 0
    assert {"field": "West", "kind": "deliver", "farm": "Gut Rohrdommelsee"} in state.recent_actions
    assert {"field": "West", "kind": "harvest", "farm": "Gut Rohrdommelsee"} in state.recent_actions
    # today's farm-history rows follow the approved plan (the neighbour chart matches /state)
    assert state.farm_history["Hof Lerchenbruch"][-1]["storage_free_t"] == 0
    assert state.farm_history["Hof Lerchenbruch"][-1]["combine_available"] == 0
    rohrdommelsee_free = state.neighbours["Gut Rohrdommelsee"]["storage_capacity_t"] - state.neighbours["Gut Rohrdommelsee"]["storage_used_t"]
    assert state.farm_history["Gut Rohrdommelsee"][-1]["storage_free_t"] == round(rohrdommelsee_free, 1)
    assert len(state.farm_history["Gut Rohrdommelsee"]) == 1  # rewritten, not appended


def test_apply_undelivered_surplus_is_sold(state):
    make_ready(state, "North")
    state.storage_used_t = 400
    state.apply_bundle(_bundle(_p("North", {"type": "harvest"})))
    assert state.storage_free_t == 0
    assert state.log[-1]["text"] == f"sold {327.6 - 50:.0f} t directly to the co-op at the harvest spot price"
    assert state.pending_surplus_t == 0


def test_apply_cover_crop_and_fertilize(state):
    state.fields["North"].harvested = True
    h = state.fields["River"].health
    state.apply_bundle(_bundle(_p("North", {"type": "sow_cover_crop"}), _p("River", {"type": "fertilize"}, {"type": "scout"})))
    assert state.fields["North"].cover_crop and state.fields["North"].stage == "cover crop"
    assert abs(state.fields["River"].health - min(0.95, h + 0.02)) < 1e-9


def test_apply_cover_crop_never_lands_on_a_standing_crop(state):
    state.apply_bundle(_bundle(_p("North", {"type": "sow_cover_crop"})))
    assert not state.fields["North"].cover_crop and state.fields["North"].stage == "ripening"


def test_delivery_notice_reports_what_actually_moved(state):
    """The plan said 200 t, but only 77.6 t of North's harvest didn't fit in our silo."""
    make_ready(state, "North")
    state.storage_used_t = 200  # 250 t free
    bundle = _bundle(_p("North", {"type": "harvest"}, {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": 200.0}))
    state.apply_bundle(bundle)
    assert abs(state.neighbours["Gut Rohrdommelsee"]["storage_used_t"] - 380 - 77.6) < 1e-6
    texts = [n["text"] for n in notices.generate(bundle, state)]
    assert "Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today." in texts


def test_delivery_of_nothing_sends_no_notice_and_no_animation(state):
    bundle = _bundle(_p("River", {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": 200.0}))
    state.apply_bundle(bundle)
    assert state.neighbours["Gut Rohrdommelsee"]["storage_used_t"] == 380
    assert notices.generate(bundle, state) == []
    assert state.recent_actions == []
