"""Headless dashboard checks: Streamlit AppTest against an in-memory fake hub, plus the pure
helpers. Run: cd ui && uv run pytest -q"""
import copy
import itertools
import math
import re
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

import pytest
import requests
from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / "app.py"


def _load_helpers() -> dict:
    """app.py is a Streamlit script, so importing it would render the page and call the hub.
    Everything above `st.set_page_config(` is constants, mock data and pure helpers: run only that."""
    head, found, _ = APP.read_text().partition("\nst.set_page_config(")
    assert found, "app.py's page code no longer starts at st.set_page_config("
    namespace = {"__name__": "ui_app_helpers"}
    exec(compile(head, str(APP), "exec"), namespace)
    return namespace


APP_HELPERS = _load_helpers()
BUNDLE_ID = APP_HELPERS["MOCK_INBOX"][0]["bundle_id"]
SCENARIO_BUTTONS = ["⏭ Next day", "🔥 Heatwave", "⛈️ Hail warning", "🔄 Restart season"]


class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload, self.status_code = payload, status_code

    def json(self):
        return copy.deepcopy(self._payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} from the fake hub")


class FakeHub:
    """Just enough of the hub for the farm dashboard (the ui's own mock day), recording every POST."""

    def __init__(self, tick_in_progress: bool = False, up: bool = True):
        self.inbox = copy.deepcopy(APP_HELPERS["MOCK_INBOX"])
        self.tick_in_progress, self.up = tick_in_progress, up
        self.posts = []
        self.refuse = {}  # path -> the hub's 409 detail

    def get(self, url, **kwargs):
        if not self.up:
            raise requests.ConnectionError("fake hub is down")
        path = urlsplit(url).path
        last = path.rsplit("/", 1)[-1]
        if path.startswith("/history/"):
            return FakeResponse(APP_HELPERS["MOCK_HISTORY"].get(last, {}))
        if path.startswith("/plans/"):
            return FakeResponse(APP_HELPERS["MOCK_PLANS"].get(last, []))
        routes = {
            "/state": APP_HELPERS["MOCK_STATE"],
            "/log": APP_HELPERS["MOCK_LOG"],
            "/inbox": self.inbox,
            "/notices": [],
            "/status": {"tick_in_progress": self.tick_in_progress, "mode": "grid"},
        }
        return FakeResponse(routes[path]) if path in routes else FakeResponse({"detail": "not found"}, 404)

    def post(self, url, json=None, **kwargs):
        if not self.up:
            raise requests.ConnectionError("fake hub is down")
        path = urlsplit(url).path
        self.posts.append((path, json))
        if self.refuse.get(path):
            return FakeResponse({"detail": self.refuse[path]}, 409)
        if path == "/decide":
            self.inbox = [b for b in self.inbox if b["bundle_id"] != json["bundle_id"]]
        return FakeResponse({"ok": True})


def run(at: AppTest, hub: FakeHub) -> AppTest:
    with mock.patch("requests.get", hub.get), mock.patch("requests.post", hub.post):
        at.run()
    assert not at.exception, [e.value for e in at.exception]
    return at


def farm_page(hub: FakeHub, **params) -> AppTest:
    at = AppTest.from_file(str(APP), default_timeout=60)
    for key, value in {"farm": "lerchenbruch", **params}.items():
        at.query_params[key] = value
    return run(at, hub)


def decide_posts(hub: FakeHub) -> list:
    return [payload for path, payload in hub.posts if path == "/decide"]


# -- ui-1: "Other (type a reason)" with an empty box ---------------------------------------
def test_reject_other_with_empty_reason_sends_nothing():
    hub = FakeHub()
    at = farm_page(hub)
    at.selectbox(key=f"reason-{BUNDLE_ID}").select(APP_HELPERS["REJECT_REASON_OTHER"])
    run(at, hub)
    assert at.text_input(key=f"reason-other-{BUNDLE_ID}").value == ""

    at.button(key=f"reject-{BUNDLE_ID}").click()
    run(at, hub)
    assert decide_posts(hub) == []
    assert "Type a reason first." in [w.value for w in at.warning]
    assert [b["bundle_id"] for b in hub.inbox] == [BUNDLE_ID]  # still pending

    run(at, hub)  # the 2 s autorefresh keeps the warning up
    assert "Type a reason first." in [w.value for w in at.warning]


def test_reject_other_sends_the_typed_reason_stripped():
    hub = FakeHub()
    at = farm_page(hub)
    at.selectbox(key=f"reason-{BUNDLE_ID}").select(APP_HELPERS["REJECT_REASON_OTHER"])
    run(at, hub)
    at.text_input(key=f"reason-other-{BUNDLE_ID}").input("  soil compacted ")
    at.button(key=f"reject-{BUNDLE_ID}").click()
    run(at, hub)
    assert decide_posts(hub) == [{"bundle_id": BUNDLE_ID, "decision": "reject", "reason": "soil compacted"}]


def test_reject_with_a_listed_reason_sends_it():
    hub = FakeHub()
    at = farm_page(hub)
    at.selectbox(key=f"reason-{BUNDLE_ID}").select("Wait for better weather")
    at.button(key=f"reject-{BUNDLE_ID}").click()
    run(at, hub)
    assert decide_posts(hub) == [{"bundle_id": BUNDLE_ID, "decision": "reject", "reason": "Wait for better weather"}]


# -- ui-2: nothing that changes the twin while a day is being planned ------------------------
def scenario_buttons(at: AppTest) -> dict:
    return {b.label: b.disabled for b in at.button if b.label in SCENARIO_BUTTONS}


@pytest.mark.parametrize(
    ("hub", "disabled"),
    [(FakeHub(tick_in_progress=True), True), (FakeHub(), False), (FakeHub(up=False), True)],
    ids=["tick-running", "idle", "hub-down"],
)
def test_scenario_buttons_disabled_while_a_tick_runs_or_the_hub_is_down(hub, disabled):
    at = farm_page(hub)
    assert scenario_buttons(at) == dict.fromkeys(SCENARIO_BUTTONS, disabled)


def test_thinking_banner_while_a_tick_runs():
    at = farm_page(FakeHub(tick_in_progress=True))
    assert any("Field agents are thinking" in m.value for m in at.markdown)


# -- ui-5: the field map forgets its selection when the selectbox changes the field ----------
def test_map_field_to_open():
    pick = APP_HELPERS["map_field_to_open"]
    assert pick("River", None) == "River"  # a new pick opens the field
    assert pick("River", "West") == "River"
    assert pick("River", "River") is None  # the old selection, carried across reruns
    assert pick(None, "River") is None  # a deselect (or a click on empty map) opens nothing
    assert pick("nope", None) is None


def test_selectbox_change_remounts_the_field_map():
    hub = FakeHub()
    at = farm_page(hub, field="River")
    selectbox_key = APP_HELPERS["FIELD_SELECTBOX_KEY"]
    gen_key, pick_key = APP_HELPERS["FIELD_MAP_GEN_KEY"], APP_HELPERS["FIELD_MAP_PICK_KEY"]
    assert at.selectbox(key=selectbox_key).value == "River"
    gen_before = at.session_state[gen_key] if gen_key in at.session_state else 0

    at.selectbox(key=selectbox_key).select(APP_HELPERS["FIELD_DETAIL_NONE"])
    run(at, hub)
    assert "field" not in at.query_params
    assert at.session_state[gen_key] == gen_before + 1
    assert at.session_state[pick_key] is None


# -- ui-7: every legend colour can be told apart ---------------------------------------------
def _lab(hex_color: str) -> tuple:
    rgb = [int(hex_color.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    r, g, b = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    fx, fy, fz = [t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116 for t in (x, y, z)]
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e_2000(hex_a: str, hex_b: str) -> float:
    """CIEDE2000 colour difference (D65, kL = kC = kH = 1)."""
    (l1, a1, b1), (l2, a2, b2) = _lab(hex_a), _lab(hex_b)
    c_bar = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    g = 0.5 * (1 - math.sqrt(c_bar ** 7 / (c_bar ** 7 + 25 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p, h2p = math.degrees(math.atan2(b1, a1p)) % 360, math.degrees(math.atan2(b2, a2p)) % 360
    dh = 0.0 if c1p * c2p == 0 else (h2p - h1p + 180) % 360 - 180
    d_l, d_c = l2 - l1, c2p - c1p
    d_h = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh / 2))
    l_bar, cp_bar = (l1 + l2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0:
        h_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        h_bar = (h1p + h2p) / 2
    else:
        h_bar = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    t = (1 - 0.17 * math.cos(math.radians(h_bar - 30)) + 0.24 * math.cos(math.radians(2 * h_bar))
         + 0.32 * math.cos(math.radians(3 * h_bar + 6)) - 0.20 * math.cos(math.radians(4 * h_bar - 63)))
    s_l = 1 + 0.015 * (l_bar - 50) ** 2 / math.sqrt(20 + (l_bar - 50) ** 2)
    s_c, s_h = 1 + 0.045 * cp_bar, 1 + 0.015 * cp_bar * t
    r_t = (-math.sin(math.radians(60 * math.exp(-((h_bar - 275) / 25) ** 2)))
           * 2 * math.sqrt(cp_bar ** 7 / (cp_bar ** 7 + 25 ** 7)))
    return math.sqrt((d_l / s_l) ** 2 + (d_c / s_c) ** 2 + (d_h / s_h) ** 2 + r_t * (d_c / s_c) * (d_h / s_h))


def test_delta_e_2000_reference_pair():
    # Sharma et al. (2005) test data, pair 1: Lab (50, 2.6772, -79.7751) vs (50, 0, -82.7485) = 2.0425.
    # Checked here through sRGB instead: identical colours are 0 and black/white is ~100.
    assert delta_e_2000("#6fae4a", "#6fae4a") == 0
    assert 99 < delta_e_2000("#000000", "#ffffff") < 101


def test_legend_colours_are_distinguishable():
    legend = APP_HELPERS["hero_legend_html"]()
    swatches = dict(zip(re.findall(r"</span>([^<]+)", legend), re.findall(r"background:(#[0-9a-fA-F]{6})", legend)))
    assert list(swatches) == ["below stress line", "near it", "comfortable", "harvested", "cover crop"]
    assert delta_e_2000(swatches["near it"], swatches["harvested"]) >= 20
    # The closest pair is the two greens (comfortable vs cover crop, ~13.9), told apart by lightness.
    for (label_a, a), (label_b, b) in itertools.combinations(swatches.items(), 2):
        assert delta_e_2000(a, b) >= 12, (label_a, label_b)


# -- a refusal from the hub is shown in its own words, and survives the rerun -----------------
def test_hub_refusal_shows_the_hubs_reason():
    hub = FakeHub()
    detail = "plan no longer passes the safety check: irrigate for River field: Irrigation must stay within today's water permit."
    hub.refuse["/decide"] = detail
    at = farm_page(hub)
    at.button(key=f"approve-{BUNDLE_ID}").click()
    run(at, hub)
    assert [b["bundle_id"] for b in hub.inbox] == [BUNDLE_ID]  # still pending
    assert any(detail in w.value for w in at.warning)
    assert not at.error  # no raw "409 Client Error" text
    run(at, hub)  # the 2 s autorefresh keeps it up for a few seconds
    assert any(detail in w.value for w in at.warning)


def test_disease_metric_has_no_trend_arrow():
    at = farm_page(FakeHub(), field="River")
    disease = next(m for m in at.metric if m.label == "Disease pressure")
    assert "·" in disease.value and not disease.delta


def test_notice_text_does_not_repeat_the_farm_name():
    card = APP_HELPERS["notice_card_html"](
        {"audience": "Gut Rohrdommelsee", "date": "Wed 8 Jul", "text": "Gut Rohrdommelsee: expect about 109 t of rapeseed for storage today."}
    )
    assert card.count("Gut Rohrdommelsee") == 1 and "expect about 109 t" in card
