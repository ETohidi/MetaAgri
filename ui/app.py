"""MetaAgri dashboard: a Streamlit view onto the hub farm digital twin."""
import html
import math
import os
import threading
import time
from urllib.parse import quote

import pydeck as pdk
import requests
import streamlit as st
import streamlit.components.v1 as components
from streamlit_autorefresh import st_autorefresh

HUB_URL = os.environ.get("HUB_URL", "http://127.0.0.1:8100")
REQUEST_TIMEOUT = 3
TICK_TIMEOUT = 120  # a tick can run petal subprocesses (up to 90s each/in parallel) in flower/grid mode
FIELDS = ["North", "West", "River"]
REJECT_REASONS = [
    "Not enough workers for this",
    "Soil too wet to drive on",
    "Wait for better weather",
    "Wrong priority order",
    "A neighbour farm should help with this",
    "Other (type a reason)",
]
REJECT_REASON_OTHER = "Other (type a reason)"

# The hub sends friendly actor names directly in /log ("North field agent", "Coordinator",
# "Safety check", "Farm", ...) - these mappings are only for places that still work from a
# raw field code (Proposal.field / ThornEntry.field / PlanRow.field stay "North"/"West"/"River" -
# that's the physical field, not the AI proposing on its behalf).
FIELD_AGENT_LABEL = {"North": "North field agent", "West": "West field agent", "River": "River field agent"}
FIELD_BY_AGENT_NAME = {v: k for k, v in FIELD_AGENT_LABEL.items()}
FIELD_DISPLAY_NAME = {"North": "North field", "West": "West field", "River": "River field"}
CROP_EMOJI = {"winter wheat": "🌾", "rapeseed": "🌼", "potatoes": "🥔"}
CEREAL_CROPS = {"winter wheat", "rapeseed"}  # ripen and need a combine - the ones a hail storm ruins
HAIL_RISK_DAYS = 4  # hub/sim.py: unharvested cereals this close to harvest lose 40% when the hail hits
MOISTURE_NEAR_MARGIN = 10  # "near" the stress threshold = less than this many points above it
OWN_FARM_NAME = "Hof Lerchenbruch"
MACHINERY_RING = "Machinery ring"

# -- colours ------------------------------------------------------------------
MOISTURE_STRESS_COLOR = "#b5542c"  # rust: below the crop's stress threshold
MOISTURE_NEAR_COLOR = "#e0a526"  # amber: close to it
MOISTURE_OK_COLOR = "#6fae4a"  # field green: comfortable
HARVESTED_COLOR = "#c8c2a8"  # pale straw stubble: a gold would be hard to tell from the amber "near"
COVER_CROP_COLOR = "#b5d98a"  # light green cover crop
STATUS_RED, STATUS_AMBER, STATUS_GREEN = "#ef4444", "#f59e0b", "#22c55e"

# -- landing page / navigation -----------------------------------------------
# ?level=1|2|3 (Earth / Germany / Oderbruch) when no farm is chosen; ?farm=<id> opens a
# farm view instead (our own dashboard, or a lighter neighbour view); ?field=<field>
# inside our own farm opens the field detail.
FARM_IDS = {
    "lerchenbruch": "Hof Lerchenbruch",
    "rohrdommelsee": "Gut Rohrdommelsee",
    "oderblick": "Agrarhof Oderblick",
}
FARM_ID_BY_NAME = {v: k for k, v in FARM_IDS.items()}
FARM_NAMES = list(FARM_IDS.values())
OWN_FARM_ID = "lerchenbruch"
FARM_COORDS = {  # id -> (lat, lon); /state's farms[].lat/lon win when the hub sends them
    "lerchenbruch": (52.655, 14.300),
    "rohrdommelsee": (52.712, 14.170),
    "oderblick": (52.585, 14.455),
}
REGION_NAME = "Oderbruch"
REGION_COORD = (52.64, 14.30)
BERLIN_COORD = (52.520, 13.405)
GERMANY_COORD = (51.1657, 10.4515)
FARMYARD_COORD = (52.6545, 14.2990)
FIELD_POLYGONS = {  # closed rings of [lon, lat] - fallback when /state's fields carry no polygon
    "North": [[14.2950, 52.6575], [14.3045, 52.6575], [14.3045, 52.6635], [14.2950, 52.6635], [14.2950, 52.6575]],
    "West": [[14.2860, 52.6505], [14.2935, 52.6505], [14.2935, 52.6560], [14.2860, 52.6560], [14.2860, 52.6505]],
    "River": [[14.3040, 52.6480], [14.3105, 52.6480], [14.3105, 52.6530], [14.3040, 52.6530], [14.3040, 52.6480]],
}
FIELD_MAP_VIEW = (52.6555, 14.2983, 12.6)  # lat, lon, zoom: all three fields fit a 276 px high map
FARMS_VIEW = (52.6485, 14.3125, 10.1)  # lat, lon, zoom: midpoint of the three farms, all in view
MAP_TRANSITION_MS = 1200
FIELD_SELECTBOX_KEY = "field_detail_selectbox"
FIELD_DETAIL_NONE = "(none)"
FIELD_MAP_PICK_KEY = "ma_field_map_pick"  # the field the map last reported as selected
FIELD_MAP_GEN_KEY = "ma_field_map_gen"  # bumped to remount the field map with no selection
FLASH_KEY = "ma_flash"  # (message, monotonic time) of the hub's last refusal, shown for a few seconds
FLASH_SECONDS = 8

# -- hero flower geometry ---------------------------------------------------
HERO_HEIGHT = 260
HERO_FIELD_ANGLES = {"North": 0, "River": 120, "West": 240}  # degrees, 0 = up, clockwise (SVG rotate)
HERO_CX, HERO_CY = 130, 112
HERO_CENTER_R = 34
HERO_PETAL_LEN_RANGE = (44, 72)
HERO_PETAL_WIDTH_RANGE = (28, 42)
HERO_STEM_TOP = HERO_CY + HERO_CENTER_R
HERO_STEM_BOTTOM = 240
HERO_MAX_THORNS = 6
HERO_DELIVERY_X = 252  # grain for a neighbour leaves the flower towards the right edge

# -- mock data (hub unreachable) ----------------------------------------------
# One coherent synthetic day: on Tue 7 Jul the farm manager left the plan undecided and
# pressed Heatwave + Hail warning; this is Wed 8 Jul, the morning after. The pending plan
# has a combine conflict (North kept), a Machinery-ring borrow_combine + deliver_to for West,
# and River's 25 mm irrigation blocked by the cut water permit - so every widget has
# something to show.
MOCK_STATE = {
    "tick": 2,
    "date": "Wed 8 Jul",
    "long_date": "Wednesday 8 July",
    "farm": "Hof Lerchenbruch",
    "region": "Oderbruch",
    "fields": {
        "North": {
            "name": "North field", "crop": "winter wheat", "emoji": "🌾", "area_ha": 42, "stage": "harvest-ready",
            "days_to_harvest": -1, "harvest_ready": True, "harvested": False, "cover_crop": False,
            "soil_moisture_pct": 42.8, "stress_threshold_pct": 35, "irrigable": False, "crop_health": 0.868,
            "disease_pressure": 0.16, "yield_estimate_t": 324.2, "harvest_waiting_days": 1,
            "last_irrigated_date": None, "last_sprayed_date": None, "recent_rejections": [],
            "polygon": FIELD_POLYGONS["North"],
        },
        "West": {
            "name": "West field", "crop": "rapeseed", "emoji": "🌼", "area_ha": 30, "stage": "harvest-ready",
            "days_to_harvest": -1, "harvest_ready": True, "harvested": False, "cover_crop": False,
            "soil_moisture_pct": 39.4, "stress_threshold_pct": 30, "irrigable": False, "crop_health": 0.848,
            "disease_pressure": 0.11, "yield_estimate_t": 114.3, "harvest_waiting_days": 1,
            "last_irrigated_date": None, "last_sprayed_date": None, "recent_rejections": [],
            "polygon": FIELD_POLYGONS["West"],
        },
        "River": {
            "name": "River field", "crop": "potatoes", "emoji": "🥔", "area_ha": 24, "stage": "tuber bulking",
            "days_to_harvest": 46, "harvest_ready": False, "harvested": False, "cover_crop": False,
            "soil_moisture_pct": 49.4, "stress_threshold_pct": 60, "irrigable": True, "crop_health": 0.83,
            "disease_pressure": 0.33, "yield_estimate_t": 984.2, "harvest_waiting_days": 0,
            "last_irrigated_date": None, "last_sprayed_date": None, "recent_rejections": [],
            "polygon": FIELD_POLYGONS["River"],
        },
    },
    "weather_today": {"date": "Wed 8 Jul", "temp_max_c": 35.2, "rain_mm": 0.0, "wind_ms": 2.6, "et0_mm": 7.3, "humidity_pct": 38, "hail": False, "note": "heatwave"},
    "forecast": [
        {"date": "Thu 9 Jul", "temp_max_c": 27.0, "rain_mm": 24.5, "wind_ms": 14.2, "et0_mm": 3.0, "humidity_pct": 90, "hail": True, "note": "hail storm"},
        {"date": "Fri 10 Jul", "temp_max_c": 34.8, "rain_mm": 0.0, "wind_ms": 3.1, "et0_mm": 7.1, "humidity_pct": 36, "hail": False, "note": "heatwave"},
        {"date": "Sat 11 Jul", "temp_max_c": 27.4, "rain_mm": 0.0, "wind_ms": 3.4, "et0_mm": 4.8, "humidity_pct": 58, "hail": False, "note": ""},
    ],
    "resources": {
        "water_permit_m3": 3600, "water_permit_normal_m3": 6500, "workers": 5, "combine": 1, "sprayer": 1,
        "storage_capacity_t": 450, "storage_used_t": 120.0, "storage_free_t": 330.0,
    },
    "scenario": "heatwave: water permit cut to 3,600 m³/day · hail warning: severe hail expected Thu 9 Jul",
    "heatwave_days_remaining": 3,
    "hail_date": "Thu 9 Jul",
    "farms": [
        {"farm": "Hof Lerchenbruch", "id": "lerchenbruch", "is_own": True, "lat": 52.655, "lon": 14.3,
         "crops": "wheat, rapeseed, potatoes", "area_ha": 96, "storage_capacity_t": 450, "storage_free_t": 330.0,
         "combine_available": 1, "avg_soil_moisture_pct": 43.9},
        {"farm": "Gut Rohrdommelsee", "id": "rohrdommelsee", "is_own": False, "lat": 52.712, "lon": 14.17,
         "crops": "maize, sugar beet", "area_ha": 310, "storage_capacity_t": 900, "storage_free_t": 492.6,
         "combine_available": 1, "avg_soil_moisture_pct": 45.6},
        {"farm": "Agrarhof Oderblick", "id": "oderblick", "is_own": False, "lat": 52.585, "lon": 14.455,
         "crops": "wheat, rapeseed, barley", "area_ha": 240, "storage_capacity_t": 600, "storage_free_t": 151.3,
         "combine_available": 0, "avg_soil_moisture_pct": 34.2},
    ],
    "farmyard": [52.6545, 14.299],
    "nearby_capacity": {
        "Hof Lerchenbruch": {"farm": "Hof Lerchenbruch", "can_share": {"combine": 0, "storage_t": 140}, "valid_until": "Thu 9 Jul", "confidence": 0.5, "note": "combine needed for our own 72 ha of ripe crop, 330 t silo space; keeping a reserve while the weather warning lasts"},
        "Gut Rohrdommelsee": {"farm": "Gut Rohrdommelsee", "can_share": {"combine": 1, "storage_t": 221}, "valid_until": "Thu 9 Jul", "confidence": 0.5, "note": "combine free, 493 t silo space; keeping a reserve while the weather warning lasts"},
        "Agrarhof Oderblick": {"farm": "Agrarhof Oderblick", "can_share": {"combine": 0, "storage_t": 50}, "valid_until": "Thu 9 Jul", "confidence": 0.5, "note": "combine busy, 151 t silo space; keeping a reserve while the weather warning lasts"},
    },
    "recent_actions": [],
    "recent_proposals": ["North", "West", "River"],
    "bundle_count": 2,
}


def _mock_log_entry(tick: int, actor: str, text: str, level: str = "info") -> dict:
    dates = {0: "Mon 6 Jul", 1: "Tue 7 Jul", 2: "Wed 8 Jul"}
    return {"tick": tick, "date": dates[tick], "actor": actor, "text": text, "level": level}


MOCK_LOG = [  # written oldest first for readability, served newest first like /log
    _mock_log_entry(0, "Farm", "season reset / seeded (mock data — farm hub unreachable)"),
    _mock_log_entry(1, "North field agent", "proposed 1 action(s): wheat ripening, 3 days to harvest; checking grain moisture."),
    _mock_log_entry(1, "West field agent", "proposed 1 action(s): rapeseed ripening, 2 days to harvest; checking grain moisture."),
    _mock_log_entry(1, "River field agent", "proposed 1 action(s): Soil moisture 57% (stress below 60%), about 9 mm crop water use in the next 2 days; irrigating 25 mm."),
    _mock_log_entry(1, "Hof Lerchenbruch", "can share 1 combine / 280 t storage until Wed 8 Jul (confidence 0.85). combine free, 330 t silo space"),
    _mock_log_entry(1, "Gut Rohrdommelsee", "can share 1 combine / 457 t storage until Wed 8 Jul (confidence 0.85). combine free, 507 t silo space"),
    _mock_log_entry(1, "Agrarhof Oderblick", "can share 0 combine / 116 t storage until Wed 8 Jul (confidence 0.85). combine busy, 166 t silo space"),
    _mock_log_entry(1, MACHINERY_RING, "compiled spare capacity from 3 farms"),
    _mock_log_entry(1, "Coordinator", "Tue 7 Jul: 3 proposals, 3/3 actions cleared by the safety check"),
    _mock_log_entry(1, "Farm", "Heatwave for 4 days: the water authority cut the permit to 3,600 m³/day", "warn"),
    _mock_log_entry(1, "Farm", "Hail warning: severe hail expected Thu 9 Jul; Wed 8 Jul stays dry, so the ripening wheat and rapeseed can come in early", "warn"),
    _mock_log_entry(2, "Farm", "the Tue 7 Jul plan expired undecided"),
    _mock_log_entry(2, "North field agent", "proposed 1 action(s): Hail expected Thu 9 Jul; harvesting ripe wheat now."),
    _mock_log_entry(2, "West field agent", "proposed 1 action(s): Hail expected Thu 9 Jul; harvesting ripe rapeseed now."),
    _mock_log_entry(2, "River field agent", "proposed 1 action(s): Soil moisture 49% in the heatwave (stress below 60%); irrigating 25 mm."),
    _mock_log_entry(2, "Coordinator", "conflict: the combine was requested by North field and West field; kept North field (€71k at risk vs €53k), West field waits"),
    _mock_log_entry(2, "Safety check", "blocked irrigate for River field: Irrigation must stay within today's water permit.", "block"),
    _mock_log_entry(2, "Hof Lerchenbruch", "can share 0 combine / 140 t storage until Thu 9 Jul (confidence 0.50). combine needed for our own 72 ha of ripe crop, 330 t silo space; keeping a reserve while the weather warning lasts"),
    _mock_log_entry(2, "Gut Rohrdommelsee", "can share 1 combine / 221 t storage until Thu 9 Jul (confidence 0.50). combine free, 493 t silo space; keeping a reserve while the weather warning lasts"),
    _mock_log_entry(2, "Agrarhof Oderblick", "can share 0 combine / 50 t storage until Thu 9 Jul (confidence 0.50). combine busy, 151 t silo space; keeping a reserve while the weather warning lasts"),
    _mock_log_entry(2, MACHINERY_RING, "compiled spare capacity from 3 farms"),
    _mock_log_entry(2, "Coordinator", "Wed 8 Jul: 4 proposals, 3/4 actions cleared by the safety check"),
][::-1]
MOCK_INBOX = [
    {
        "bundle_id": 1,
        "tick": 2,
        "plan_for": "Wed 8 Jul",
        "summary": "Wed 8 Jul: 4 proposals, 3/4 actions cleared by the safety check (mock — farm hub unreachable)",
        "proposals": [
            {"field": "North", "actions": [{"type": "harvest", "confidence": 0.85, "reason": "Hail expected Thu 9 Jul; harvesting ripe wheat now."}],
             "rationale": "Hail expected Thu 9 Jul; harvesting ripe wheat now.", "confidence": 0.85, "risks": ["hail on Thu 9 Jul"]},
            {"field": "West", "actions": [{"type": "harvest", "confidence": 0.85, "reason": "Hail expected Thu 9 Jul; harvesting ripe rapeseed now."}],
             "rationale": "Hail expected Thu 9 Jul; harvesting ripe rapeseed now.", "confidence": 0.85, "risks": ["hail on Thu 9 Jul"]},
            {"field": "River", "actions": [{"type": "irrigate", "mm": 25, "confidence": 0.75, "reason": "Soil moisture 49% in the heatwave (stress below 60%); irrigating 25 mm."}],
             "rationale": "Soil moisture 49% in the heatwave (stress below 60%); irrigating 25 mm.", "confidence": 0.75, "risks": []},
            {"field": "West", "actions": [
                {"type": "borrow_combine", "farm": "Gut Rohrdommelsee", "confidence": 0.5, "reason": "Our combine is busy elsewhere and the rapeseed is ripe; Gut Rohrdommelsee can lend theirs today (confidence 0.50)."},
                {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": 108.5, "confidence": 0.45, "reason": "~438 t coming in today but only 330 t free in our silo; Gut Rohrdommelsee reports 221 t spare storage."},
            ], "rationale": "Machinery ring: borrow Gut Rohrdommelsee's combine for West field; send 108 t surplus to Gut Rohrdommelsee.", "confidence": 0.45, "risks": []},
        ],
        "thorn": [
            {"field": "North", "action": {"type": "harvest", "confidence": 0.85}, "blocked": False, "rule": None},
            {"field": "River", "action": {"type": "irrigate", "mm": 25, "confidence": 0.75}, "blocked": True,
             "rule": "Irrigation must stay within today's water permit."},
            {"field": "West", "action": {"type": "borrow_combine", "farm": "Gut Rohrdommelsee", "confidence": 0.5}, "blocked": False, "rule": None},
            {"field": "West", "action": {"type": "deliver_to", "farm": "Gut Rohrdommelsee", "tonnes": 108.5, "confidence": 0.45}, "blocked": False, "rule": None},
        ],
        "plan_rows": [
            {"field": "North", "crop": "winter wheat", "action_type": "harvest", "what": "Harvest ~324 t",
             "resources": "combine · 2 workers", "confidence": 0.85, "reason": "Hail expected Thu 9 Jul; harvesting ripe wheat now."},
            {"field": "West", "crop": "rapeseed", "action_type": "borrow_combine", "what": "Harvest with Gut Rohrdommelsee's combine (~114 t)",
             "resources": "Gut Rohrdommelsee's combine · 1 worker", "confidence": 0.5, "reason": "Our combine is busy elsewhere and the rapeseed is ripe; Gut Rohrdommelsee can lend theirs today (confidence 0.50)."},
            {"field": "West", "crop": "rapeseed", "action_type": "deliver_to", "what": "Deliver 108 t to Gut Rohrdommelsee",
             "resources": "—", "confidence": 0.45, "reason": "~438 t coming in today but only 330 t free in our silo; Gut Rohrdommelsee reports 221 t spare storage."},
        ],
        "overall_confidence": 0.45,
        "nearby_capacity": list(MOCK_STATE["nearby_capacity"].values()),
        "resources_before": {"water_m3": 3600, "workers": 5, "combine": 1, "sprayer": 1, "storage_free_t": 330.0},
        "resources_after": {"water_m3": 3600, "workers": 2, "combine": 0, "sprayer": 1, "storage_free_t": 0.0},
        "status": "pending",
        "reason": None,
    }
]
MOCK_NOTICES = [
    {"tick": 2, "date": "Wed 8 Jul", "audience": "Buyers", "text": "Example: Winter wheat harvest on North field today — about 324 t expected. Confidence: high. (mock data)"},
    {"tick": 2, "date": "Wed 8 Jul", "audience": "Gut Rohrdommelsee", "text": "Example: Gut Rohrdommelsee: thanks for lending your combine for our West field (rapeseed) today. (mock data)"},
    {"tick": 1, "date": "Tue 7 Jul", "audience": "Neighbours", "text": "Example: Irrigation running on River field today (25 mm) — the field track may be wet. (mock data)"},
]


def _mock_field_history(moisture: list, health: list, yields: list, projected: list, threshold: float) -> dict:
    dates = ["Mon 6 Jul", "Tue 7 Jul", "Wed 8 Jul"]
    rain = [2.4, 0.0, 0.0]  # regional weather: a shower on Mon, then the heatwave
    history = [
        {"tick": i, "date": d, "soil_moisture_pct": m, "crop_health": h, "rain_mm": r, "irrigation_mm": 0.0, "yield_estimate_t": y}
        for i, (d, m, h, r, y) in enumerate(zip(dates, moisture, health, rain, yields))
    ]
    projection = [
        {"tick": 3 + i, "date": d, "projected_moisture_pct": p}
        for i, (d, p) in enumerate(zip(["Thu 9 Jul", "Fri 10 Jul", "Sat 11 Jul"], projected))
    ]
    return {"history": history, "projection": projection, "stress_threshold_pct": threshold}


MOCK_HISTORY = {  # same shape as /history/{field}
    "North": _mock_field_history([48.0, 46.1, 42.8], [0.86, 0.864, 0.868], [327.6, 326.0, 324.2], [65.9, 62.7, 60.5], 35),
    "West": _mock_field_history([44.0, 42.3, 39.4], [0.84, 0.844, 0.848], [115.6, 115.0, 114.3], [62.7, 59.9, 58.0], 30),
    "River": _mock_field_history([62.0, 57.4, 49.4], [0.90, 0.877, 0.83], [1008.0, 1008.0, 984.2], [70.6, 62.8, 57.5], 60),
}
MOCK_PLANS = {  # same shape as /plans/{field}
    field: [
        {"bundle_id": 1, "plan_for": "Wed 8 Jul", "status": "pending", "confidence": 0.45},
        {"bundle_id": 0, "plan_for": "Tue 7 Jul", "status": "expired", "confidence": 0.7},
    ]
    for field in FIELDS
}


def _mock_farm_history(storage_free: list, moisture: list, combine: list) -> dict:
    dates = ["Mon 6 Jul", "Tue 7 Jul", "Wed 8 Jul"]
    return {
        "history": [
            {"tick": i, "date": d, "storage_free_t": s, "avg_soil_moisture_pct": m, "combine_available": c}
            for i, (d, s, m, c) in enumerate(zip(dates, storage_free, moisture, combine))
        ]
    }


MOCK_FARM_HISTORY = {  # same shape as /history/farm/{name}
    "Hof Lerchenbruch": _mock_farm_history([330.0, 330.0, 330.0], [51.3, 48.6, 43.9], [1, 1, 1]),
    "Gut Rohrdommelsee": _mock_farm_history([520.0, 507.4, 492.6], [52.0, 50.2, 45.6], [1, 1, 1]),
    "Agrarhof Oderblick": _mock_farm_history([180.0, 166.0, 151.3], [42.0, 38.8, 34.2], [1, 0, 0]),
}
MOCK_FARM_REPORTS = {  # same shape as /farm-reports/{name}
    "Hof Lerchenbruch": [
        {"plan_for": "Wed 8 Jul", "can_share": {"combine": 0, "storage_t": 140}, "confidence": 0.5, "note": "combine needed for our own 72 ha of ripe crop, 330 t silo space; keeping a reserve while the weather warning lasts"},
        {"plan_for": "Tue 7 Jul", "can_share": {"combine": 1, "storage_t": 280}, "confidence": 0.85, "note": "combine free, 330 t silo space"},
    ],
    "Gut Rohrdommelsee": [
        {"plan_for": "Wed 8 Jul", "can_share": {"combine": 1, "storage_t": 221}, "confidence": 0.5, "note": "combine free, 493 t silo space; keeping a reserve while the weather warning lasts"},
        {"plan_for": "Tue 7 Jul", "can_share": {"combine": 1, "storage_t": 457}, "confidence": 0.85, "note": "combine free, 507 t silo space"},
    ],
    "Agrarhof Oderblick": [
        {"plan_for": "Wed 8 Jul", "can_share": {"combine": 0, "storage_t": 50}, "confidence": 0.5, "note": "combine busy, 151 t silo space; keeping a reserve while the weather warning lasts"},
        {"plan_for": "Tue 7 Jul", "can_share": {"combine": 0, "storage_t": 116}, "confidence": 0.85, "note": "combine busy, 166 t silo space"},
    ],
}


# -- small defensive helpers ----------------------------------------------------
def esc(value) -> str:
    return html.escape(str(value))


def compact_html(markup: str) -> str:
    """Drop blank lines and indentation from an HTML/SVG block before st.markdown: in
    Markdown a blank line ends an HTML block (an empty interpolation like "no rain bars"
    would leave one), and the rest of the SVG then leaks out as plain text."""
    return "\n".join(line.strip() for line in markup.splitlines() if line.strip())


def as_dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def as_list(value) -> list:
    return value if isinstance(value, list) else []


def num(value, default: float = 0.0) -> float:
    """A number from hub JSON, or `default` when it's missing/null/not numeric."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


def fmt_num(value, default: str = "—") -> str:
    """Thousands separators; whole numbers without decimals, others with one ("108.5")."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if abs(value - round(value)) < 0.05:
        return f"{round(value):,}"
    return f"{value:,.1f}"


def date_parts(label: str) -> tuple[str, str]:
    """"Wed 8 Jul" -> ("Wed", "8 Jul") for the two-line date in the hero centre."""
    head, _, rest = str(label or "").partition(" ")
    return head, rest


def _hex_to_rgb(hex_color: str) -> list:
    h = hex_color.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def moisture_color(moisture: float, threshold: float) -> str:
    if moisture < threshold:
        return MOISTURE_STRESS_COLOR
    if moisture < threshold + MOISTURE_NEAR_MARGIN:
        return MOISTURE_NEAR_COLOR
    return MOISTURE_OK_COLOR


def field_color(field_state: dict) -> str:
    """Petal / map colour: cover crop, harvested stubble, else soil moisture vs the crop's
    stress threshold (rust below it, amber close to it, green comfortable)."""
    if field_state.get("cover_crop"):
        return COVER_CROP_COLOR
    if field_state.get("harvested"):
        return HARVESTED_COLOR
    return moisture_color(num(field_state.get("soil_moisture_pct")), num(field_state.get("stress_threshold_pct")))


def is_stressed(field_state: dict) -> bool:
    return not field_state.get("harvested") and num(field_state.get("soil_moisture_pct")) < num(field_state.get("stress_threshold_pct"))


def hail_at_risk(field_state: dict) -> bool:
    """A ripe (or nearly ripe) cereal still standing - exactly what the hail will hit."""
    if field_state.get("harvested"):
        return False
    if field_state.get("harvest_ready"):
        return True
    return field_state.get("crop") in CEREAL_CROPS and num(field_state.get("days_to_harvest"), 99) <= HAIL_RISK_DAYS


def disease_label(pressure: float) -> str:
    return "high" if pressure >= 0.6 else ("medium" if pressure >= 0.3 else "low")


def scenario_messages(state: dict) -> list:
    """/state.scenario is the active scenario messages joined with " · " (or null)."""
    scenario = state.get("scenario")
    if not isinstance(scenario, str):
        return []
    return [m.strip() for m in scenario.split(" · ") if m.strip()]


def confidence_color(confidence: float) -> str:
    """Red (low) -> amber -> green (high) traffic-light scale."""
    c = max(0.0, min(1.0, confidence))
    red, amber, green = (239, 68, 68), (245, 158, 11), (34, 197, 94)
    lo, hi, t = (red, amber, c / 0.5) if c < 0.5 else (amber, green, (c - 0.5) / 0.5)
    r, g, b = (round(lo[i] + (hi[i] - lo[i]) * t) for i in range(3))
    return f"rgb({r},{g},{b})"


def confidence_bar_html(confidence) -> str:
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return '<span class="ma-conf-label">—</span>'
    pct = max(0.0, min(1.0, confidence)) * 100
    color = confidence_color(confidence)
    return (
        f'<div class="ma-conf-outer"><div class="ma-conf-inner" style="width:{pct:.0f}%;background:{color};"></div></div>'
        f'<span class="ma-conf-label">{confidence:.2f}</span>'
    )


def farm_status_color(farm: dict) -> str:
    """red / amber / green from the farm's average soil moisture and how full its silo is."""
    moisture = num(farm.get("avg_soil_moisture_pct"), 50.0)
    capacity = num(farm.get("storage_capacity_t"))
    fill = 1 - num(farm.get("storage_free_t"), capacity) / capacity if capacity else 0.0
    if moisture < 35 or fill > 0.95:
        return STATUS_RED
    if moisture < 45 or fill > 0.85:
        return STATUS_AMBER
    return STATUS_GREEN


def action_label(action: dict) -> str:
    """Plain words for a raw Action dict (used where there's no PlanRow.what, e.g. blocks)."""
    kind = str(action.get("type") or "")
    farm = action.get("farm")
    if kind == "irrigate":
        return f"Irrigate {fmt_num(action.get('mm'))} mm" if action.get("mm") is not None else "Irrigate"
    if kind == "spray":
        return f"Spray {action['product']}" if action.get("product") else "Spray"
    if kind == "fertilize":
        return f"Fertilize {fmt_num(action.get('kg_n_ha'))} kg N/ha" if action.get("kg_n_ha") is not None else "Fertilize"
    if kind == "borrow_combine":
        return f"Harvest with {farm}'s combine" if farm else "Borrow a neighbour's combine"
    if kind == "deliver_to":
        return f"Deliver {fmt_num(action.get('tonnes'))} t to {farm or 'a neighbour'}"
    simple = {"harvest": "Harvest", "scout": "Scout field", "defer_task": "Wait", "sow_cover_crop": "Sow cover crop"}
    return simple.get(kind, kind.replace("_", " ").capitalize())


def plan_has_neighbour_help(bundle: dict) -> bool:
    kinds = {r.get("action_type") for r in as_list(bundle.get("plan_rows")) if isinstance(r, dict)}
    for p in as_list(bundle.get("proposals")):
        kinds |= {a.get("type") for a in as_list(as_dict(p).get("actions")) if isinstance(a, dict)}
    return bool(kinds & {"borrow_combine", "deliver_to"})


# -- HTML building blocks ---------------------------------------------------------
def farm_strip_html(farms: list, last_update: str) -> str:
    rows = [f for f in farms if isinstance(f, dict)]
    rows.sort(key=lambda f: not f.get("is_own"))  # own farm first
    cards = []
    for f in rows:
        color = farm_status_color(f)
        own_badge = ' <span class="ma-badge">ours</span>' if f.get("is_own") else ""
        combine = "free" if num(f.get("combine_available")) > 0 else "busy"
        cards.append(
            f'<div class="ma-farm-card">'
            f'<div><span class="ma-dot" style="background:{color};"></span>'
            f'<span class="ma-farm-name">{esc(f.get("farm", "?"))}</span>{own_badge}</div>'
            f'<div class="ma-farm-line">Silo free: {fmt_num(f.get("storage_free_t"))} t &middot; Combine: {combine} '
            f'&middot; Soil moisture: {num(f.get("avg_soil_moisture_pct")):.0f}%</div>'
            f'<div class="ma-farm-updated">Updated {esc(last_update)}</div>'
            f"</div>"
        )
    if not cards:
        return '<div class="ma-tile-stats">No farm data yet.</div>'
    return f'<div class="ma-strip">{"".join(cards)}</div>'


def neighbour_help_html(rows: list) -> str:
    items = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        share = as_dict(r.get("can_share"))
        ours = " (ours)" if r.get("farm") == OWN_FARM_NAME else ""
        note = f' — <i>{esc(r["note"])}</i>' if r.get("note") else ""
        items.append(
            f'<div class="ma-nearby-row">🚜 <b>{esc(r.get("farm", "?"))}</b>{ours}: can share '
            f'{fmt_num(num(share.get("combine")))} combine / {fmt_num(num(share.get("storage_t")))} t storage '
            f'until {esc(r.get("valid_until", "?"))} (confidence {num(r.get("confidence")):.2f}){note}</div>'
        )
    if not items:
        return ""
    return f'<div class="ma-nearby"><div class="ma-nearby-title">🚜 Neighbour help</div>{"".join(items)}</div>'


def plan_table_html(rows: list) -> str:
    rows = [r for r in rows if isinstance(r, dict)]
    if not rows:
        return '<div class="ma-tile-stats">No field work planned for this day.</div>'
    header = "<tr><th>Field</th><th>Crop</th><th>Action</th><th>Resources</th><th>Confidence</th><th>Reason</th></tr>"
    body = "".join(
        "<tr>"
        f"<td>{esc(FIELD_DISPLAY_NAME.get(r.get('field'), r.get('field', '?')))}</td>"
        f"<td>{CROP_EMOJI.get(r.get('crop'), '')} {esc(r.get('crop', ''))}</td>"
        f"<td>{esc(r.get('what') or r.get('action_type', ''))}</td>"
        f"<td>{esc(r.get('resources', '—'))}</td>"
        f"<td>{confidence_bar_html(r.get('confidence'))}</td>"
        f"<td>{esc(r.get('reason', ''))}</td>"
        "</tr>"
        for r in rows
    )
    return f'<table class="ma-plan-table">{header}{body}</table>'


RESOURCE_LINE_ITEMS = [  # (key in resources_before/after, label, unit)
    ("water_m3", "Water", " m³"),
    ("workers", "Workers", ""),
    ("combine", "Combine", ""),
    ("sprayer", "Sprayer", ""),
    ("storage_free_t", "Silo free", " t"),
]


def resource_delta_html(before: dict, after: dict) -> str:
    """"Water 6,500→500 m³ · Workers 5→2 · Combine 1→0 · Silo free 330→2 t" - the
    sprayer only shows up when the plan actually uses it."""
    parts = []
    for key, label, unit in RESOURCE_LINE_ITEMS:
        if key not in before:
            continue
        b, a = before.get(key), after.get(key, before.get(key))
        if key == "sprayer" and num(a) == num(b):
            continue
        parts.append(esc(f"{label} {fmt_num(b)}→{fmt_num(a)}{unit}"))
    return " &middot; ".join(parts)


def conversation_icon(entry: dict) -> str:
    """Best-effort icon for a team-conversation line, inferred from its level/actor/text
    (there's no dedicated icon field, so this is pattern-matching)."""
    level = entry.get("level")
    text = str(entry.get("text") or "").lower()
    actor = entry.get("actor")
    if level == "block":
        return "🛡️"
    if level == "decision":
        if "approved" in text:
            return "✅"
        if "rejected" in text:
            return "❌"
    if actor == "Coordinator":
        return "🧭"
    if actor == MACHINERY_RING or actor in FARM_NAMES:
        return "🚜"
    if "irrigat" in text:
        return "💧"
    if "harvest" in text:
        return "🌾"
    if "hail" in text:
        return "⛈️"
    if "heatwave" in text:
        return "🔥"
    return ""


def weather_icon(w: dict) -> str:
    if w.get("hail"):
        return "⛈️"
    if w.get("note") == "heatwave" or num(w.get("temp_max_c")) >= 33:
        return "🔥"
    if num(w.get("rain_mm")) >= 0.5:
        return "🌧️"
    if num(w.get("humidity_pct")) >= 70:
        return "🌤️"
    return "☀️"


def weather_strip_html(state: dict) -> str:
    days = [("Today", as_dict(state.get("weather_today")))]
    days += [(None, as_dict(w)) for w in as_list(state.get("forecast"))[:3]]
    cards = []
    for label, w in days:
        if not w:
            continue
        hail = bool(w.get("hail"))
        heading = f"{label} · {w.get('date', '')}" if label else str(w.get("date", ""))
        chip = '<span class="ma-hail-chip">HAIL</span>' if hail else ""
        note = f'<div class="ma-card-sub">{esc(w["note"])}</div>' if w.get("note") else ""
        cards.append(
            f'<div class="ma-card{" ma-card-hail" if hail else ""}">'
            f'<div class="ma-card-label">{esc(heading)}{chip}</div>'
            f'<div class="ma-weather-row"><span class="ma-weather-icon">{weather_icon(w)}</span>'
            f'<span class="ma-card-value">{num(w.get("temp_max_c")):.0f} °C</span></div>'
            f'<div class="ma-card-sub">🌧️ {num(w.get("rain_mm")):.1f} mm &middot; 💨 {num(w.get("wind_ms")):.1f} m/s '
            f'&middot; ET₀ {num(w.get("et0_mm")):.1f} mm</div>{note}'
            f"</div>"
        )
    if not cards:
        return '<div class="ma-tile-stats">No weather data yet.</div>'
    return f'<div class="ma-strip">{"".join(cards)}</div>'


def resource_strip_html(state: dict) -> str:
    res = as_dict(state.get("resources"))
    permit = num(res.get("water_permit_m3"))
    normal = num(res.get("water_permit_normal_m3"), permit)
    cut = permit < normal
    water_sub = f"cut from {fmt_num(normal)} m³" if cut else "normal daily permit"
    capacity = num(res.get("storage_capacity_t"))
    free = num(res.get("storage_free_t"))
    used = num(res.get("storage_used_t"), capacity - free)
    fill = max(0.0, min(1.0, used / capacity)) if capacity else 0.0
    silo_color = STATUS_RED if fill > 0.95 else (STATUS_AMBER if fill > 0.85 else MOISTURE_OK_COLOR)

    def card(label: str, value: str, sub: str, extra_class: str = "", extra_html: str = "") -> str:
        return (
            f'<div class="ma-card {extra_class}"><div class="ma-card-label">{esc(label)}</div>'
            f'<div class="ma-card-value">{esc(value)}</div>{extra_html}<div class="ma-card-sub">{esc(sub)}</div></div>'
        )

    silo_bar = (
        f'<div class="ma-progress-outer"><div class="ma-progress-inner" '
        f'style="width:{fill * 100:.0f}%;background:{silo_color};"></div></div>'
    )
    return (
        '<div class="ma-strip">'
        + card("💧 Water permit today", f"{fmt_num(permit)} m³", water_sub, "ma-card-alert" if cut else "")
        + card("🧑‍🌾 Workers", fmt_num(res.get("workers")), "people for field work today")
        + card("🚜 Combine", fmt_num(res.get("combine")), "one field per day")
        + card("💨 Sprayer", fmt_num(res.get("sprayer")), "one field per day")
        + card("🏚️ Silo", f"{fmt_num(free)} t free", f"{fmt_num(used)} of {fmt_num(capacity)} t used", "", silo_bar)
        + "</div>"
    )


def field_tile_html(field: str, f: dict, hail_active: bool) -> str:
    moisture = num(f.get("soil_moisture_pct"))
    threshold = num(f.get("stress_threshold_pct"))
    color = field_color(f)
    crop = f.get("crop", "?")
    emoji = f.get("emoji") or CROP_EMOJI.get(crop, "")
    at_risk = hail_active and hail_at_risk(f)
    if is_stressed(f):
        border_class, border_style = "ma-tile-pulse", ""
    elif at_risk:
        border_class, border_style = "", "border:2px solid #ef4444;"
    else:
        border_class, border_style = "", "border:1px solid #2a3326;"
    hail_badge = " ⛈️" if at_risk else ""
    irrigable = ' <span class="ma-badge">💧 irrigable</span>' if f.get("irrigable") else ""

    if f.get("cover_crop"):
        harvest_line = "✅ Harvested &middot; 🌱 cover crop sown"
    elif f.get("harvested"):
        harvest_line = "✅ Harvested"
    elif f.get("harvest_ready"):
        waiting = int(num(f.get("harvest_waiting_days")))
        harvest_line = "🌾 <b>Ready to harvest</b>" + (f" &middot; waiting {waiting} day{'s' if waiting != 1 else ''}" if waiting else "")
    else:
        days = int(num(f.get("days_to_harvest")))
        harvest_line = f"{days} day{'s' if days != 1 else ''} to harvest"

    disease = num(f.get("disease_pressure"))
    return compact_html(f"""
    <div class="ma-tile {border_class}" style="{border_style}">
      <div class="ma-tile-header">{emoji} {esc(FIELD_DISPLAY_NAME.get(field, field))}{hail_badge}
        <span class="ma-stage">{esc(f.get("stage", ""))}</span></div>
      <div class="ma-tile-stats">{esc(crop)} &middot; {fmt_num(f.get("area_ha"))} ha{irrigable}</div>
      <div class="ma-progress-outer" title="Soil moisture {moisture:.0f}% - stress below {threshold:.0f}%">
        <div class="ma-progress-inner" style="width:{max(0.0, min(moisture, 100.0)):.0f}%; background:{color};"></div>
        <div class="ma-threshold-tick" style="left:{max(0.0, min(threshold, 100.0)):.0f}%;"></div>
      </div>
      <div class="ma-tile-stats">
        <span title="Plant-available water in the root zone">Soil moisture {moisture:.0f}%<span class="ma-tooltip">❓</span></span>
        &middot; <span title="Below this the crop is water-stressed">stress below {threshold:.0f}%<span class="ma-tooltip">❓</span></span>
      </div>
      <div class="ma-tile-stats">Health {num(f.get("crop_health")):.2f} &middot; Disease {disease:.2f} ({disease_label(disease)})</div>
      <div class="ma-tile-stats">{harvest_line} &middot; Yield estimate ~{fmt_num(f.get("yield_estimate_t"))} t</div>
    </div>
    """)


def notice_card_html(notice: dict) -> str:
    audience = str(notice.get("audience") or "Everyone")
    chip_colors = {"Buyers": "#d9b44a", "Neighbours": "#6fae4a", "Beekeepers & neighbours": "#f59e0b"}
    chip = chip_colors.get(audience, "#38bdf8")  # a neighbour farm by name
    text = str(notice.get("text", ""))
    text = text.removeprefix(f"{audience}: ")  # "Gut X: thanks..." - the chip already says who
    return (
        f'<div class="ma-notice" style="border-left-color:{chip};">'
        f'<span class="ma-chip" style="color:{chip};border-color:{chip};">{esc(audience)}</span>'
        f'<span class="ma-notice-date">{esc(notice.get("date", ""))}</span>'
        f'<div>🔔 {esc(text)}</div></div>'
    )


# -- hero flower --------------------------------------------------------------------
def _petal_geometry(field: str, area: float, max_area: float) -> dict:
    size_frac = math.sqrt(area / max_area) if max_area else 0
    len_lo, len_hi = HERO_PETAL_LEN_RANGE
    w_lo, w_hi = HERO_PETAL_WIDTH_RANGE
    length = len_lo + (len_hi - len_lo) * size_frac
    width = w_lo + (w_hi - w_lo) * size_frac
    dist = HERO_CENTER_R * 0.55 + length / 2
    angle_rad = math.radians(HERO_FIELD_ANGLES[field])
    # SVG rotate(a) turns the local "up" vector (0, -1) into (sin a, -cos a)
    ux, uy = math.sin(angle_rad), -math.cos(angle_rad)
    return {
        "length": length,
        "width": width,
        "dist": dist,
        "cx": HERO_CX + ux * dist,  # centre of the petal ellipse
        "cy": HERO_CY + uy * dist,
    }


def _hero_petal_svg(field: str, f: dict, geometry: dict, hail_active: bool, propose_pulse: bool) -> str:
    moisture = num(f.get("soil_moisture_pct"))
    threshold = num(f.get("stress_threshold_pct"))
    color = field_color(f)
    length, width, dist = geometry["length"], geometry["width"], geometry["dist"]
    angle = HERO_FIELD_ANGLES[field]

    pulse_class = "hero-pulse" if is_stressed(f) else ("hero-propose-pulse" if propose_pulse else "")
    shake_class = "hero-shake" if (hail_active and hail_at_risk(f)) else ""
    crop = f.get("crop", "?")
    emoji = f.get("emoji") or CROP_EMOJI.get(crop, "")
    if f.get("cover_crop"):
        status = "cover crop sown"
    elif f.get("harvested"):
        status = "harvested"
    else:
        status = f"moisture {moisture:.0f}% (stress below {threshold:.0f}%) · health {num(f.get('crop_health')):.2f}"
    tooltip = f"{FIELD_DISPLAY_NAME.get(field, field)}: {crop}, {fmt_num(f.get('area_ha'))} ha · {status}"

    return f"""
      <g class="{shake_class}" onclick="maSelectField('{field}')" style="cursor:pointer;">
        <g transform="translate({HERO_CX},{HERO_CY}) rotate({angle})">
          <ellipse class="{pulse_class}" cx="0" cy="-{dist:.1f}" rx="{width / 2:.1f}" ry="{length / 2:.1f}"
                   fill="{color}" stroke="#0f1410" stroke-width="2"></ellipse>
        </g>
        <text x="{geometry['cx']:.1f}" y="{geometry['cy'] + 1:.1f}" text-anchor="middle" font-size="15">{emoji}</text>
        <text class="hero-petal-label" x="{geometry['cx']:.1f}" y="{geometry['cy'] + 15:.1f}" text-anchor="middle"
              font-size="9" font-weight="700">{esc(field)}</text>
        <title>{esc(tooltip)}</title>
      </g>
    """


def _hero_action_svg(recent_actions: list, geometry_by_field: dict) -> str:
    """CSS-only movement for the actions of the plan approved today: a grain dot travels
    petal -> centre (the silo) per harvest, a 💧 falls onto the petal per irrigation, a
    mist ring spreads over a sprayed petal, and a grain dot leaves the flower to the right
    per delivery to a neighbour farm."""
    items = []
    for a in [a for a in recent_actions if isinstance(a, dict)][:6]:
        kind = a.get("kind")
        g = geometry_by_field.get(a.get("field"))
        if kind == "harvest" and g:
            dx, dy = HERO_CX - g["cx"], HERO_CY - g["cy"]
            items.append(
                f'<circle class="hero-grain-dot" cx="{g["cx"]:.1f}" cy="{g["cy"]:.1f}" r="4" fill="#facc15" '
                f'style="--dx:{dx:.1f}px;--dy:{dy:.1f}px;"></circle>'
            )
        elif kind == "irrigate" and g:
            items.append(
                f'<text class="hero-drop" x="{g["cx"]:.1f}" y="{g["cy"] - 30:.1f}" font-size="14" text-anchor="middle">💧</text>'
            )
        elif kind == "spray" and g:
            items.append(
                f'<circle class="hero-mist" cx="{g["cx"]:.1f}" cy="{g["cy"]:.1f}" r="18" fill="none" '
                f'stroke="#e2e8f0" stroke-width="2" stroke-dasharray="3,3"></circle>'
            )
        elif kind == "deliver":
            farm = esc(a.get("farm") or "a neighbour farm")
            items.append(
                f'<circle class="hero-grain-dot" cx="{HERO_CX}" cy="{HERO_CY}" r="4" fill="#facc15" '
                f'style="--dx:{HERO_DELIVERY_X - HERO_CX}px;--dy:0px;"><title>Grain to {farm}</title></circle>'
            )
    return "".join(items)


def _hero_thorns_svg(thorn_count: int) -> str:
    shown = min(thorn_count, HERO_MAX_THORNS)
    thorns = []
    for i in range(shown):
        y = HERO_STEM_TOP + 14 + i * 12
        if y > HERO_STEM_BOTTOM - 6:
            break
        side = 1 if i % 2 == 0 else -1
        tip_x = HERO_CX + side * 11
        thorns.append(f'<polygon points="{HERO_CX},{y - 4} {tip_x},{y} {HERO_CX},{y + 4}" fill="#ef4444"></polygon>')
    extra = thorn_count - shown
    if extra > 0:
        thorns.append(
            f'<text x="{HERO_CX}" y="{HERO_STEM_BOTTOM + 14}" text-anchor="middle" font-size="10" '
            f'fill="#ef4444">+{extra} more</text>'
        )
    return "".join(thorns)


def build_hero_svg(state: dict, log: list) -> str:
    """Pure HTML/SVG hero panel: a flower with one petal per field, rendered via
    render_html_panel (a same-origin iframe). Petal size = sqrt(area), colour = soil moisture vs the crop's
    stress threshold (pale straw once harvested, light green with a cover crop), pulsing below
    the threshold. Centre = today's date + the farm manager. The stem grows a red thorn per
    safety-check block today. 🔥 / ⛈️ flag an active heatwave / hail warning, and ripe
    cereals still standing shake while the hail is coming. Today's approved actions are
    animated (see _hero_action_svg), and a petal pulses gently when its agent just proposed.
    Clicking a petal sets ?field=X on the parent page (best-effort - the selectbox in the
    main layout is the reliable fallback)."""
    fields = as_dict(state.get("fields"))
    field_states = {f: as_dict(fields.get(f)) for f in FIELDS}
    tick = state.get("tick")
    hail_active = bool(state.get("hail_date"))
    heatwave_active = num(state.get("heatwave_days_remaining")) > 0
    thorn_count = sum(1 for e in log if isinstance(e, dict) and e.get("level") == "block" and e.get("tick") == tick)
    max_area = max((num(field_states[f].get("area_ha")) for f in FIELDS), default=1) or 1

    geometry_by_field = {f: _petal_geometry(f, num(field_states[f].get("area_ha")), max_area) for f in FIELDS}
    recent_proposals = set(as_list(state.get("recent_proposals")))
    petals = "".join(
        _hero_petal_svg(f, field_states[f], geometry_by_field[f], hail_active, f in recent_proposals) for f in FIELDS
    )
    thorns = _hero_thorns_svg(thorn_count)
    action_marks = _hero_action_svg(as_list(state.get("recent_actions")), geometry_by_field)
    scenario_icons = ""
    if heatwave_active:
        scenario_icons += '<text x="22" y="26" text-anchor="middle" font-size="20">🔥<title>Heatwave: water permit cut</title></text>'
    if hail_active:
        scenario_icons += (
            f'<text x="238" y="26" text-anchor="middle" font-size="20">⛈️'
            f'<title>Hail expected {esc(state.get("hail_date"))}</title></text>'
        )
    day_name, day_rest = date_parts(state.get("date", ""))

    return f"""
    <div style="background:#0f1410;border-radius:12px;padding:4px 0;">
    <script>
      function maSelectField(field) {{
        try {{
          const url = new URL(window.parent.location.href);
          url.searchParams.set('field', field);
          url.hash = 'field-detail';  // the detail heading scrolls itself into view
          // The iframe's sandbox has no allow-top-navigation, so setting
          // window.parent.location throws; a link clicked in the parent document
          // navigates the parent from itself, which the sandbox allows.
          const doc = window.parent.document;
          const link = doc.createElement('a');
          link.href = url.toString();
          link.target = '_self';
          doc.body.appendChild(link);
          link.click();
          link.remove();
        }} catch (e) {{ /* cross-origin/sandboxed - the selectbox fallback still works */ }}
      }}
    </script>
    <style>
      @keyframes ma-hero-pulse {{
        0%, 100% {{ filter: drop-shadow(0 0 0 rgba(239,68,68,0)); }}
        50% {{ filter: drop-shadow(0 0 7px rgba(239,68,68,0.85)); }}
      }}
      .hero-pulse {{ animation: ma-hero-pulse 1.3s ease-in-out infinite; }}
      @keyframes ma-hero-propose {{
        0%, 100% {{ opacity:1; }}
        50% {{ opacity:0.6; }}
      }}
      .hero-propose-pulse {{ animation: ma-hero-propose 1.2s ease-in-out infinite; }}
      @keyframes ma-hero-shake {{
        0%, 100% {{ transform: translate(0,0); }}
        25% {{ transform: translate(-2px,1px); }}
        75% {{ transform: translate(2px,-1px); }}
      }}
      .hero-shake {{ animation: ma-hero-shake 0.5s ease-in-out infinite; }}
      @keyframes ma-hero-grain {{
        0% {{ transform: translate(0,0); opacity:0; }}
        15% {{ opacity:1; }}
        85% {{ opacity:1; }}
        100% {{ transform: translate(var(--dx), var(--dy)); opacity:0; }}
      }}
      .hero-grain-dot {{ animation: ma-hero-grain 1.4s ease-in-out infinite; }}
      @keyframes ma-hero-drop {{
        0% {{ transform: translateY(0); opacity:0; }}
        20% {{ opacity:1; }}
        85% {{ opacity:1; }}
        100% {{ transform: translateY(26px); opacity:0; }}
      }}
      .hero-drop {{ animation: ma-hero-drop 1.2s ease-in infinite; }}
      @keyframes ma-hero-mist {{
        0% {{ transform: scale(0.5); opacity:0.8; }}
        100% {{ transform: scale(1.5); opacity:0; }}
      }}
      .hero-mist {{ transform-box: fill-box; transform-origin: center; animation: ma-hero-mist 1.4s ease-out infinite; }}
      text {{ font-family: -apple-system, "Segoe UI", sans-serif; fill: #e8e6dc; }}
      .hero-petal-label {{ fill: #0f1410; }}
    </style>
    <svg viewBox="0 0 260 260" width="100%" height="{HERO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      {scenario_icons}
      <line x1="{HERO_CX}" y1="{HERO_STEM_TOP}" x2="{HERO_CX}" y2="{HERO_STEM_BOTTOM}"
            stroke="#4d7c0f" stroke-width="4" stroke-linecap="round"></line>
      {thorns}
      {petals}
      <circle cx="{HERO_CX}" cy="{HERO_CY}" r="{HERO_CENTER_R}" fill="#1a2219" stroke="#2c3a28" stroke-width="2"></circle>
      <text x="{HERO_CX}" y="{HERO_CY - 13}" text-anchor="middle" font-size="10" fill="#a3a89a">{esc(day_name)}</text>
      <text x="{HERO_CX}" y="{HERO_CY + 3}" text-anchor="middle" font-size="14" font-weight="700">{esc(day_rest)}</text>
      <text x="{HERO_CX}" y="{HERO_CY + 22}" text-anchor="middle" font-size="14">🧑‍🌾</text>
      {action_marks}
    </svg>
    </div>
    """


def render_html_panel(markup: str, height: int) -> None:
    """Render a self-contained HTML/SVG panel (with its own <script>) in a same-origin
    iframe, so the petal click can still reach window.parent. st.iframe replaces the
    deprecated st.components.v1.html on newer Streamlit; older ones only have the latter."""
    if hasattr(st, "iframe"):
        st.iframe(markup, height=height)
    else:
        components.html(markup, height=height, scrolling=False)


def hero_legend_html() -> str:
    swatches = [
        (MOISTURE_STRESS_COLOR, "below stress line"),
        (MOISTURE_NEAR_COLOR, "near it"),
        (MOISTURE_OK_COLOR, "comfortable"),
        (HARVESTED_COLOR, "harvested"),
        (COVER_CROP_COLOR, "cover crop"),
    ]
    items = "".join(f'<span class="ma-legend-swatch" style="background:{c};"></span>{esc(label)}' for c, label in swatches)
    return f'<div class="ma-legend">{items}</div>'


# -- hub access -----------------------------------------------------------------------
def api_get(path: str):
    try:
        response = requests.get(f"{HUB_URL}{path}", timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def api_post(path: str, payload: dict | None = None):
    try:
        response = requests.post(f"{HUB_URL}{path}", json=payload, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        st.error(f"Request to {path} failed: {exc}")
        return None
    if response.status_code >= 400:
        # The hub explains itself in plain words (e.g. a plan that no longer passes the safety
        # check after a heatwave, or a day that's still being planned) - show that, not a code.
        try:
            detail = response.json().get("detail")
        except (ValueError, AttributeError):
            detail = None
        st.session_state[FLASH_KEY] = (str(detail or f"The farm couldn't do that ({response.status_code})."), time.monotonic())
        return None
    try:
        return response.json()
    except ValueError:
        return None


def fire_and_forget_post(path: str, payload: dict | None = None, timeout: int = TICK_TIMEOUT) -> None:
    """Start a slow POST (e.g. /tick in flower/grid mode) in the background so the
    Streamlit script doesn't block; /status polling on the next autorefresh reflects progress."""

    def _run():
        try:
            requests.post(f"{HUB_URL}{path}", json=payload, timeout=timeout)
        except requests.RequestException:
            pass

    threading.Thread(target=_run, daemon=True).start()


def hub_get(path: str, hub_up: bool, mock):
    """Live hub data, or the built-in mock while the hub is unreachable."""
    return api_get(path) if hub_up else mock


def fields_done_this_tick(log: list, current_tick) -> int:
    """Infer how many of the 3 field agents have resolved (real proposal received, or
    the farm gave up and fell back to mock) for the in-flight tick, purely from
    /log - no dedicated progress field on the backend."""
    resolved = set()
    for e in log:
        if not isinstance(e, dict) or e.get("tick") != current_tick:
            continue
        text = str(e.get("text") or "")
        actor = e.get("actor")
        if actor in FIELD_BY_AGENT_NAME and text.startswith("proposal received:"):
            resolved.add(FIELD_BY_AGENT_NAME[actor])
        if actor == "Farm" and "falling back to mock" in text:
            for field, agent_name in FIELD_AGENT_LABEL.items():
                if agent_name in text:
                    resolved.add(field)
    return len(resolved)


# -- charts (hand-rolled SVG) -----------------------------------------------------------
def field_moisture_chart_svg(history: list, projection: list, threshold: float) -> str:
    """Pure SVG line chart: soil moisture (solid) + a dashed 3-day projection (forecast
    weather, no irrigation) + a dashed stress-threshold line, with daily rain / irrigation
    as bars on the same axis (1 mm on the field = 1 % plant-available water).
    Hand-rolled rather than st.line_chart/st.altair_chart - both transitively import
    the `altair` package, which is broken under this environment's Python version
    (altair's own schema module uses TypedDict(closed=True), unsupported here)."""
    history = [h for h in history if isinstance(h, dict)]
    projection = [r for r in projection if isinstance(r, dict)]
    width, height = 560, 210
    pad_l, pad_r, pad_t, pad_b = 34, 12, 20, 22
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b

    dates = [h.get("date", "") for h in history] + [r.get("date", "") for r in projection]
    n = len(dates)
    if not history or n < 2:
        return '<div class="ma-tile-stats">Not enough history yet.</div>'

    def xy(i: int, value: float) -> tuple[float, float]:
        x = pad_l + (i / (n - 1)) * plot_w
        y = pad_t + plot_h - (max(0.0, min(value, 100.0)) / 100) * plot_h
        return x, y

    def polyline(indexed_values: list) -> str:
        return " ".join(f"{xy(i, v)[0]:.1f},{xy(i, v)[1]:.1f}" for i, v in indexed_values)

    moisture_pts = polyline([(i, num(h.get("soil_moisture_pct"))) for i, h in enumerate(history)])
    proj_series = [(len(history) - 1, num(history[-1].get("soil_moisture_pct")))]
    proj_series += [(len(history) + j, num(r.get("projected_moisture_pct"))) for j, r in enumerate(projection)]
    proj_pts = polyline(proj_series)

    bar_w = min(14.0, plot_w / n * 0.45)
    bars = []
    for i, h in enumerate(history):
        rain, irrigation = num(h.get("rain_mm")), num(h.get("irrigation_mm"))
        x = xy(i, 0)[0] - bar_w / 2
        base_y = pad_t + plot_h
        rain_h = min(rain, 100.0) / 100 * plot_h
        irr_h = min(irrigation, 100.0) / 100 * plot_h
        if rain_h > 0:
            bars.append(f'<rect x="{x:.1f}" y="{base_y - rain_h:.1f}" width="{bar_w:.1f}" height="{rain_h:.1f}" fill="#60a5fa" opacity="0.7"><title>{esc(h.get("date", ""))}: {rain:.1f} mm rain</title></rect>')
        if irr_h > 0:
            bars.append(f'<rect x="{x:.1f}" y="{base_y - rain_h - irr_h:.1f}" width="{bar_w:.1f}" height="{irr_h:.1f}" fill="#22d3ee" opacity="0.8"><title>{esc(h.get("date", ""))}: {irrigation:.0f} mm irrigation</title></rect>')

    thr_y = xy(0, threshold)[1]
    today_x = xy(len(history) - 1, 0)[0]
    label_step = max(1, n // 7)
    labels = "".join(
        f'<text x="{xy(i, 0)[0]:.1f}" y="{height - 4}" font-size="9" text-anchor="middle" fill="#a3a89a">{esc(d)}</text>'
        for i, d in enumerate(dates)
        if i % label_step == 0
    )
    y_ticks = "".join(
        f'<text x="{pad_l - 4}" y="{xy(0, v)[1] + 3:.1f}" font-size="9" text-anchor="end" fill="#6f7768">{v}%</text>'
        for v in (0, 50, 100)
    )

    return compact_html(f"""
    <svg viewBox="0 0 {width} {height}" width="100%" height="210" xmlns="http://www.w3.org/2000/svg">
      <rect x="{pad_l}" y="{thr_y:.1f}" width="{plot_w}" height="{pad_t + plot_h - thr_y:.1f}" fill="{MOISTURE_STRESS_COLOR}" opacity="0.10"></rect>
      <line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" stroke="#2a3326"></line>
      <line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{width - pad_r}" y2="{pad_t + plot_h}" stroke="#2a3326"></line>
      <line x1="{today_x:.1f}" y1="{pad_t}" x2="{today_x:.1f}" y2="{pad_t + plot_h}" stroke="#2a3326" stroke-dasharray="2,3"></line>
      {"".join(bars)}
      <line x1="{pad_l}" y1="{thr_y:.1f}" x2="{width - pad_r}" y2="{thr_y:.1f}" stroke="{MOISTURE_STRESS_COLOR}" stroke-width="1.5" stroke-dasharray="6,4"></line>
      <text x="{width - pad_r}" y="{thr_y - 4:.1f}" font-size="9" text-anchor="end" fill="{MOISTURE_STRESS_COLOR}">stress below {threshold:.0f}%</text>
      <polyline points="{moisture_pts}" fill="none" stroke="{MOISTURE_OK_COLOR}" stroke-width="2.5"></polyline>
      <polyline points="{proj_pts}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5,4"></polyline>
      {y_ticks}
      {labels}
      <text x="{pad_l}" y="12" font-size="9" fill="{MOISTURE_OK_COLOR}">— Soil moisture</text>
      <text x="{pad_l + 86}" y="12" font-size="9" fill="#94a3b8">- - Projected (no irrigation)</text>
      <text x="{pad_l + 226}" y="12" font-size="9" fill="{MOISTURE_STRESS_COLOR}">- - Stress threshold</text>
      <text x="{pad_l + 330}" y="12" font-size="9" fill="#60a5fa">▮ Rain</text>
      <text x="{pad_l + 368}" y="12" font-size="9" fill="#22d3ee">▮ Irrigation (mm)</text>
    </svg>
    """)


def farm_history_chart_svg(history: list, capacity: float) -> str:
    """Pure SVG line chart for a neighbour farm: free silo space (t, left axis) and average
    soil moisture (%, right axis) since the season started, plus one dot per day for its
    combine (green = free, grey = busy) - see field_moisture_chart_svg for why not st.line_chart."""
    history = [h for h in history if isinstance(h, dict)]
    width, height = 560, 210
    pad_l, pad_r, pad_t, pad_b = 40, 36, 20, 34
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b
    n = len(history)
    if n < 2:
        return '<div class="ma-tile-stats">Not enough history yet.</div>'

    max_t = max([capacity] + [num(h.get("storage_free_t")) for h in history]) or 1

    def x_at(i: int) -> float:
        return pad_l + (i / (n - 1)) * plot_w

    def y_at(value: float, top: float) -> float:
        return pad_t + plot_h - (max(0.0, min(value, top)) / top) * plot_h

    storage_pts = " ".join(f"{x_at(i):.1f},{y_at(num(h.get('storage_free_t')), max_t):.1f}" for i, h in enumerate(history))
    moisture_pts = " ".join(f"{x_at(i):.1f},{y_at(num(h.get('avg_soil_moisture_pct')), 100):.1f}" for i, h in enumerate(history))
    combine_dots = "".join(
        f'<circle cx="{x_at(i):.1f}" cy="{pad_t + plot_h + 10}" r="3" '
        f'fill="{STATUS_GREEN if num(h.get("combine_available")) > 0 else "#4b5563"}">'
        f'<title>{esc(h.get("date", ""))}: combine {"free" if num(h.get("combine_available")) > 0 else "busy"}</title></circle>'
        for i, h in enumerate(history)
    )
    label_step = max(1, n // 7)
    labels = "".join(
        f'<text x="{x_at(i):.1f}" y="{height - 4}" font-size="9" text-anchor="middle" fill="#a3a89a">{esc(h.get("date", ""))}</text>'
        for i, h in enumerate(history)
        if i % label_step == 0
    )
    left_ticks = "".join(
        f'<text x="{pad_l - 4}" y="{y_at(v, max_t) + 3:.1f}" font-size="9" text-anchor="end" fill="#d9b44a">{fmt_num(v)}</text>'
        for v in (0, max_t / 2, max_t)
    )
    right_ticks = "".join(
        f'<text x="{width - pad_r + 4}" y="{y_at(v, 100) + 3:.1f}" font-size="9" fill="#6fae4a">{v}%</text>'
        for v in (0, 50, 100)
    )

    return compact_html(f"""
    <svg viewBox="0 0 {width} {height}" width="100%" height="210" xmlns="http://www.w3.org/2000/svg">
      <line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" stroke="#2a3326"></line>
      <line x1="{width - pad_r}" y1="{pad_t}" x2="{width - pad_r}" y2="{pad_t + plot_h}" stroke="#2a3326"></line>
      <line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{width - pad_r}" y2="{pad_t + plot_h}" stroke="#2a3326"></line>
      <polyline points="{storage_pts}" fill="none" stroke="#d9b44a" stroke-width="2"></polyline>
      <polyline points="{moisture_pts}" fill="none" stroke="#6fae4a" stroke-width="2"></polyline>
      {combine_dots}
      {left_ticks}
      {right_ticks}
      {labels}
      <text x="{pad_l}" y="12" font-size="9" fill="#d9b44a">— Silo space free (t)</text>
      <text x="{pad_l + 110}" y="12" font-size="9" fill="#6fae4a">— Avg soil moisture (%)</text>
      <text x="{pad_l + 232}" y="12" font-size="9" fill="#a3a89a">● Combine free / busy</text>
    </svg>
    """)


# -- field detail ------------------------------------------------------------------------
def render_field_detail(field: str, state: dict, hub_up: bool) -> None:
    f = as_dict(as_dict(state.get("fields")).get(field))
    crop = f.get("crop", "?")
    emoji = f.get("emoji") or CROP_EMOJI.get(crop, "")
    st.subheader(f"🔍 {FIELD_DISPLAY_NAME.get(field, field)} detail — {emoji} {crop}", anchor="field-detail")

    data = as_dict(hub_get(f"/history/{field}", hub_up, MOCK_HISTORY.get(field)))
    history, projection = as_list(data.get("history")), as_list(data.get("projection"))
    threshold = num(data.get("stress_threshold_pct"), num(f.get("stress_threshold_pct")))
    if history:
        st.markdown(field_moisture_chart_svg(history, projection, threshold), unsafe_allow_html=True)
    else:
        st.caption("No history yet for this field.")

    moisture = num(f.get("soil_moisture_pct"))
    disease = num(f.get("disease_pressure"))
    m_col, h_col, d_col, y_col = st.columns(4)
    with m_col:
        st.metric("Soil moisture", f"{moisture:.0f}%", f"{moisture - threshold:+.0f} pts vs stress line")
    with h_col:
        st.metric("Crop health", f"{num(f.get('crop_health')):.2f}")
    with d_col:
        st.metric("Disease pressure", f"{disease:.2f} · {disease_label(disease)}")
    with y_col:
        st.metric("Yield estimate", f"~{fmt_num(f.get('yield_estimate_t'))} t")

    if f.get("harvested"):
        st.caption("✅ Harvested" + (" · 🌱 cover crop sown" if f.get("cover_crop") else " · no cover crop yet"))
    elif f.get("harvest_ready"):
        st.caption(f"🌾 Ready to harvest · waiting {int(num(f.get('harvest_waiting_days')))} day(s) — ripe grain loses yield every day it stands.")
    else:
        days = int(num(f.get("days_to_harvest")))
        st.caption(f"{days} day{'s' if days != 1 else ''} to harvest · stage: {esc(f.get('stage', '?'))}")
    extras = []
    if f.get("last_irrigated_date"):
        extras.append(f"last irrigated {esc(f['last_irrigated_date'])}")
    if f.get("last_sprayed_date"):
        extras.append(f"last sprayed {esc(f['last_sprayed_date'])}")
    rejections = as_list(f.get("recent_rejections"))
    if rejections:
        extras.append(f"last rejection: “{esc(rejections[-1])}”")
    if extras:
        st.caption(" · ".join(extras))

    st.markdown("**Last plans touching this field**")
    plans = [p for p in as_list(hub_get(f"/plans/{field}", hub_up, MOCK_PLANS.get(field))) if isinstance(p, dict)]
    status_icons = {"approved": "✅", "rejected": "❌", "expired": "⌛", "pending": "⏳"}
    if plans:
        for p in plans[:3]:
            conf = p.get("confidence")
            conf_text = f"confidence {conf:.2f}" if isinstance(conf, (int, float)) else "no actions"
            st.markdown(
                f"- {status_icons.get(p.get('status'), '•')} {esc(p.get('plan_for', '?'))} "
                f"({esc(p.get('status', '?'))}) — {conf_text}"
            )
    else:
        st.caption("No plans yet for this field.")


def _on_field_detail_change() -> None:
    choice = st.session_state.get(FIELD_SELECTBOX_KEY)
    if choice in FIELDS:
        st.query_params["field"] = choice
    elif "field" in st.query_params:
        del st.query_params["field"]
    # The map keeps its own selection, so a click on the field it still has selected would
    # only deselect it. A new key remounts the map with nothing selected, and the next click
    # on any field opens it.
    st.session_state[FIELD_MAP_GEN_KEY] = st.session_state.get(FIELD_MAP_GEN_KEY, 0) + 1
    st.session_state[FIELD_MAP_PICK_KEY] = None


def render_field_detail_picker(state: dict, hub_up: bool) -> None:
    # Clicking a petal in the hero SVG reloads the page with ?field=X (best-effort - iframe
    # sandboxing may block it in some setups), clicking a field on the map sets ?field=X
    # directly, and the selectbox below is the reliable fallback. The query param is the
    # single source of truth: it's copied into the selectbox before it renders, and the
    # selectbox writes back to it through on_change.
    query_field = st.query_params.get("field")
    if query_field is not None and query_field not in FIELDS:
        del st.query_params["field"]
        query_field = None
    wanted = query_field or FIELD_DETAIL_NONE
    if st.session_state.get(FIELD_SELECTBOX_KEY) != wanted:
        st.session_state[FIELD_SELECTBOX_KEY] = wanted
    chosen = st.selectbox(
        "Field detail (or click a petal / field)",
        [FIELD_DETAIL_NONE] + FIELDS,
        key=FIELD_SELECTBOX_KEY,
        on_change=_on_field_detail_change,
        format_func=lambda f: FIELD_DISPLAY_NAME.get(f, f),
    )
    if chosen in FIELDS:
        render_field_detail(chosen, state, hub_up)


# -- maps ------------------------------------------------------------------------------------
def germany_geojson() -> dict:
    """Simplified inline outline of Germany (not survey-accurate, just recognizable)."""
    ring = [
        [8.5, 54.9], [11.0, 54.5], [14.0, 53.9], [14.6, 52.9], [14.7, 51.0],
        [12.5, 50.3], [13.8, 48.8], [12.9, 47.5], [10.2, 47.3], [8.6, 47.6],
        [7.6, 47.6], [7.6, 49.0], [6.1, 49.5], [6.0, 50.8], [6.1, 51.8],
        [7.0, 53.3], [8.5, 54.9],
    ]
    return {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"name": "Germany"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}],
    }


def polygon_ring(value, fallback: list) -> list:
    """A usable [[lon, lat], ...] ring from hub JSON, or `fallback` if it's malformed."""
    ring = [
        [float(p[0]), float(p[1])]
        for p in as_list(value)
        if isinstance(p, (list, tuple)) and len(p) >= 2
        and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in p[:2])
    ]
    return ring if len(ring) >= 3 else fallback


def field_polygon_rows(state: dict) -> list:
    """One PolygonLayer row per field of our farm, coloured like its hero petal."""
    fields = as_dict(state.get("fields"))
    rows = []
    for field in FIELDS:
        f = as_dict(fields.get(field))
        polygon = polygon_ring(f.get("polygon"), FIELD_POLYGONS[field])
        rgb = _hex_to_rgb(field_color(f))
        corners = polygon[:-1] if polygon[0] == polygon[-1] else polygon  # a closed ring repeats its first point
        centre = [sum(p[0] for p in corners) / len(corners), sum(p[1] for p in corners) / len(corners)]
        rows.append(
            {
                "field": field,
                "name": FIELD_DISPLAY_NAME[field],
                "polygon": polygon,
                "centre": centre,
                "crop": esc(f.get("crop", "?")),
                "stage": esc(f.get("stage", "")),
                "moisture": f"{num(f.get('soil_moisture_pct')):.0f}",
                "threshold": f"{num(f.get('stress_threshold_pct')):.0f}",
                "yield": fmt_num(f.get("yield_estimate_t")),
                "fill": rgb + [150],
                "line": rgb + [255],
            }
        )
    return rows


def map_field_to_open(selected, previous_pick):
    """The field a map click should open, or None. The chart keeps its selection across
    reruns, so only a *new* pick counts - otherwise choosing "(none)" in the selectbox would
    be overridden by the old map selection. A deselect (None) opens nothing."""
    return selected if selected in FIELDS and selected != previous_pick else None


def render_field_map(state: dict) -> None:
    rows = field_polygon_rows(state)
    farmyard = as_list(state.get("farmyard"))
    yard_lat = num(farmyard[0], FARMYARD_COORD[0]) if len(farmyard) == 2 else FARMYARD_COORD[0]
    yard_lon = num(farmyard[1], FARMYARD_COORD[1]) if len(farmyard) == 2 else FARMYARD_COORD[1]
    yard = [{"position": [yard_lon, yard_lat], "text": "Farmyard"}]

    polygons = pdk.Layer(
        "PolygonLayer", data=rows, id="field-polygons", get_polygon="polygon", get_fill_color="fill",
        get_line_color="line", line_width_min_pixels=2, stroked=True, filled=True, pickable=True, auto_highlight=True,
    )
    field_labels = pdk.Layer(
        "TextLayer", data=[{"position": r["centre"], "text": r["field"]} for r in rows], get_position="position",
        get_text="text", get_size=13, get_color=[15, 20, 16, 255], pickable=False,
    )
    yard_dot = pdk.Layer(
        "ScatterplotLayer", data=yard, get_position="position", get_radius=45, radius_min_pixels=5,
        get_fill_color=[161, 98, 7, 240], pickable=False,
    )
    yard_label = pdk.Layer(
        "TextLayer", data=yard, get_position="position", get_text="text", get_size=11,
        get_color=[232, 230, 220, 230], get_pixel_offset=[0, -14], pickable=False,
    )
    lat, lon, zoom = FIELD_MAP_VIEW
    view_state = pdk.ViewState(latitude=lat, longitude=lon, zoom=zoom, pitch=0, bearing=0)
    tooltip = {"html": "<b>{name}</b><br/>{crop} &middot; {stage}<br/>Soil moisture {moisture}% (stress below {threshold}%)<br/>Yield estimate ~{yield} t"}
    deck = pdk.Deck(layers=[polygons, field_labels, yard_dot, yard_label], initial_view_state=view_state,
                    map_style=pdk.map_styles.CARTO_DARK, tooltip=tooltip)
    map_key = f"ma-field-map-{st.session_state.get(FIELD_MAP_GEN_KEY, 0)}"
    event = st.pydeck_chart(deck, height=HERO_HEIGHT + 16, on_select="rerun", selection_mode="single-object", key=map_key)
    selected = None
    try:
        selected_objects = event.selection.objects.get("field-polygons", [])
        if selected_objects:
            selected = selected_objects[0].get("field")
    except Exception:
        selected = None
    previous = st.session_state.get(FIELD_MAP_PICK_KEY)
    st.session_state[FIELD_MAP_PICK_KEY] = selected
    field = map_field_to_open(selected, previous)
    if field:
        st.query_params["field"] = field
        st.rerun()



def farm_map_points(state: dict) -> list:
    """One point per farm for the level-3 map: position, silo space, combine, soil
    moisture, and a green/amber/red colour from farm_status_color()."""
    rows = {r.get("farm"): r for r in as_list(state.get("farms")) if isinstance(r, dict)}
    points = []
    for farm_id, (lat, lon) in FARM_COORDS.items():
        name = FARM_IDS[farm_id]
        row = as_dict(rows.get(name))
        color = _hex_to_rgb(farm_status_color(row)) if row else [107, 114, 128]
        points.append(
            {
                "id": farm_id,
                "name": name,
                "position": [num(row.get("lon"), lon), num(row.get("lat"), lat)],
                "storage_free": fmt_num(row.get("storage_free_t")),
                "combine": "free" if num(row.get("combine_available")) > 0 else "busy",
                "moisture": f"{num(row.get('avg_soil_moisture_pct')):.0f}",
                "crops": esc(row.get("crops", "")),
                "updated": esc(state.get("date", "")),
                "color": color + [230],
                "glow_color": color + [70],
            }
        )
    return points


def render_breadcrumb(level: int) -> None:
    labels = [("1", "🌍 Earth"), ("2", "🇩🇪 Germany"), ("3", "🌾 Oderbruch")]
    cols = st.columns([1, 0.2, 1, 0.2, 1, 5])
    for i, (lvl, label) in enumerate(labels):
        with cols[i * 2]:
            if st.button(label, key=f"breadcrumb-{lvl}", disabled=(str(level) == lvl), use_container_width=True):
                st.query_params["level"] = lvl
                for param in ("farm", "field"):
                    if param in st.query_params:
                        del st.query_params[param]
                st.rerun()
        if i < 2:
            with cols[i * 2 + 1]:
                st.markdown("<div style='padding-top:8px;'>›</div>", unsafe_allow_html=True)


def render_map_page(level: int, state: dict, hub_up: bool) -> None:
    render_breadcrumb(level)

    geo_layer = pdk.Layer(
        "GeoJsonLayer",
        data=germany_geojson(),
        get_fill_color=[106, 153, 78, 110],
        get_line_color=[106, 153, 78, 255],
        line_width_min_pixels=2,
        pickable=False,
    )

    if level == 1:
        view_state = pdk.ViewState(latitude=15, longitude=10, zoom=1.2, pitch=0, bearing=0, transition_duration=MAP_TRANSITION_MS)
        tooltip = {"html": "<b>{name}</b>"}
        deck = pdk.Deck(layers=[geo_layer], initial_view_state=view_state, map_style=pdk.map_styles.CARTO_DARK, tooltip=tooltip)
        st.pydeck_chart(deck, height=520, key="ma-map")
        st.write("")
        if st.button("Go to Germany ➜"):
            st.query_params["level"] = "2"
            st.rerun()

    elif level == 2:
        region = [{"name": f"{REGION_NAME} (Brandenburg) — 3 farms in this twin", "position": [REGION_COORD[1], REGION_COORD[0]]}]
        berlin = [{"name": "Berlin", "position": [BERLIN_COORD[1], BERLIN_COORD[0]]}]
        glow = pdk.Layer("ScatterplotLayer", data=region, get_position="position", get_radius=25000,
                         radius_min_pixels=10, get_fill_color=[106, 153, 78, 70], pickable=False)
        core = pdk.Layer("ScatterplotLayer", data=region, get_position="position", get_radius=9000,
                         radius_min_pixels=6, get_fill_color=[163, 230, 53, 235], pickable=True)
        city = pdk.Layer("ScatterplotLayer", data=berlin, get_position="position", get_radius=5000,
                         radius_min_pixels=3, get_fill_color=[156, 163, 175, 200], pickable=True)
        view_state = pdk.ViewState(latitude=GERMANY_COORD[0], longitude=GERMANY_COORD[1], zoom=5.5, pitch=0, bearing=0, transition_duration=MAP_TRANSITION_MS)
        tooltip = {"html": "<b>{name}</b>"}
        deck = pdk.Deck(layers=[geo_layer, glow, core, city], initial_view_state=view_state, map_style=pdk.map_styles.CARTO_DARK, tooltip=tooltip)
        st.pydeck_chart(deck, height=520, key="ma-map")
        st.write("")
        if st.button("Go to Oderbruch ➜"):
            st.query_params["level"] = "3"
            st.rerun()

    else:
        points = farm_map_points(state)
        own_fields = pdk.Layer(
            "PolygonLayer", data=field_polygon_rows(state), get_polygon="polygon", get_fill_color="fill",
            get_line_color="line", line_width_min_pixels=1, stroked=True, filled=True, pickable=False,
        )
        glow = pdk.Layer("ScatterplotLayer", data=points, get_position="position", get_radius=1400,
                         radius_min_pixels=16, get_fill_color="glow_color", pickable=False)
        core = pdk.Layer("ScatterplotLayer", data=points, get_position="position", get_radius=500,
                         radius_min_pixels=7, get_fill_color="color", pickable=True, id="farm-points",
                         auto_highlight=True)
        lat, lon, zoom = FARMS_VIEW
        view_state = pdk.ViewState(latitude=lat, longitude=lon, zoom=zoom, pitch=0, bearing=0, transition_duration=MAP_TRANSITION_MS)
        tooltip = {"html": "<b>{name}</b><br/>{crops}<br/>Silo free: {storage_free} t &middot; Combine: {combine} &middot; Soil moisture: {moisture}%<br/>Updated {updated}"}
        deck = pdk.Deck(layers=[own_fields, glow, core], initial_view_state=view_state, map_style=pdk.map_styles.CARTO_DARK, tooltip=tooltip)
        event = st.pydeck_chart(deck, height=520, on_select="rerun", selection_mode="single-object", key="ma-map")
        selected = None
        try:
            selected_objects = event.selection.objects.get("farm-points", [])
            if selected_objects:
                selected = selected_objects[0].get("id")
        except Exception:
            selected = None
        if selected in FARM_IDS:
            st.query_params["farm"] = selected
            st.rerun()

        st.write("")
        card_cols = st.columns(3)
        for col, p in zip(card_cols, points):
            with col:
                own_badge = " (ours)" if p["id"] == OWN_FARM_ID else ""
                color = f"rgb({p['color'][0]},{p['color'][1]},{p['color'][2]})"
                st.markdown(
                    f'<div class="ma-farm-card"><span class="ma-dot" style="background:{color};"></span>'
                    f'<span class="ma-farm-name">{esc(p["name"])}{own_badge}</span>'
                    f'<div class="ma-farm-line">{p["crops"]}</div>'
                    f'<div class="ma-farm-line">Silo free: {p["storage_free"]} t &middot; Combine: {p["combine"]} '
                    f'&middot; Soil moisture: {p["moisture"]}%</div>'
                    f'<div class="ma-farm-updated">Updated {p["updated"]}</div></div>',
                    unsafe_allow_html=True,
                )
                if st.button(p["name"], key=f"map-card-{p['id']}", use_container_width=True):
                    st.query_params["farm"] = p["id"]
                    st.rerun()

        combines_free = sum(1 for p in points if p["combine"] == "free")
        st.caption(f"{combines_free} of {len(points)} farms have a combine free today.")


# -- page sections --------------------------------------------------------------------------
def render_back_to_region() -> None:
    if st.button("← Back to Oderbruch"):
        st.query_params["level"] = "3"
        for param in ("farm", "field"):
            if param in st.query_params:
                del st.query_params[param]
        st.rerun()


def render_neighbour_view(farm_name: str, state: dict, hub_up: bool) -> None:
    render_back_to_region()
    row = next((r for r in as_list(state.get("farms")) if isinstance(r, dict) and r.get("farm") == farm_name), {})
    st.markdown(f"## 🚜 {esc(farm_name)}")
    st.caption(f"Neighbour farm in the {REGION_NAME} machinery ring · {esc(row.get('crops', '?'))} · {fmt_num(row.get('area_ha'))} ha")

    capacity = num(row.get("storage_capacity_t"))
    free = num(row.get("storage_free_t"))
    combine_free = num(row.get("combine_available")) > 0
    moisture = num(row.get("avg_soil_moisture_pct"))
    tiles = [
        ("🏚️ Silo space free", f"{fmt_num(free)} t", f"of {fmt_num(capacity)} t capacity"),
        ("🚜 Combine", "free today" if combine_free else "busy today", "one machine"),
        ("💧 Soil moisture", f"{moisture:.0f}%", "farm average"),
        ("🌱 Crops", str(row.get("crops", "?")), f"{fmt_num(row.get('area_ha'))} ha"),
    ]
    tile_cols = st.columns(4)
    for col, (label, value, sub) in zip(tile_cols, tiles):
        with col:
            st.markdown(
                f'<div class="ma-card"><div class="ma-card-label">{esc(label)}</div>'
                f'<div class="ma-card-value">{esc(value)}</div><div class="ma-card-sub">{esc(sub)}</div></div>',
                unsafe_allow_html=True,
            )

    st.markdown("### Silo space and soil moisture since Mon 6 Jul")
    history_data = as_dict(hub_get(f"/history/farm/{quote(farm_name)}", hub_up, MOCK_FARM_HISTORY.get(farm_name)))
    history = as_list(history_data.get("history"))
    if len(history) >= 2:
        st.markdown(farm_history_chart_svg(history, capacity), unsafe_allow_html=True)
    else:
        st.caption("Not enough history yet.")

    st.markdown("### Last reports from this farm's agent")
    reports = [r for r in as_list(hub_get(f"/farm-reports/{quote(farm_name)}", hub_up, MOCK_FARM_REPORTS.get(farm_name))) if isinstance(r, dict)]
    if reports:
        for r in reports[:3]:
            share = as_dict(r.get("can_share"))
            st.markdown(
                f"- **{esc(r.get('plan_for', '?'))}** — can share {fmt_num(num(share.get('combine')))} combine / "
                f"{fmt_num(num(share.get('storage_t')))} t storage (confidence {num(r.get('confidence')):.2f})"
                + (f" — _{esc(r['note'])}_" if r.get("note") else "")
            )
    else:
        st.caption("No reports yet this season.")

    st.caption("Detailed twin available for Hof Lerchenbruch in this demo.")


def render_badges(agents_label: str) -> None:
    st.markdown(
        f'<span class="ma-badge">synthetic data</span>'
        f'<span class="ma-badge">Agents: {esc(agents_label)}</span>',
        unsafe_allow_html=True,
    )


def render_minimal_topbar(state: dict, agents_label: str) -> None:
    title_col, date_col, badge_col = st.columns([4, 1.8, 2.5])
    with title_col:
        st.markdown('<div class="ma-title">🌾 MetaAgri</div>', unsafe_allow_html=True)
    with date_col:
        st.metric("Date", state.get("long_date") or state.get("date", ""))
    with badge_col:
        st.write("")
        render_badges(agents_label)


def render_full_topbar(state: dict, hub_up: bool, tick_in_progress: bool, agents_label: str) -> None:
    # Two rows, so the title, date and button labels are never cut off below ~1440 px.
    title_col, date_col, badge_col = st.columns([3, 2, 1.6])
    with title_col:
        farm = state.get("farm") or OWN_FARM_NAME
        st.markdown(
            f'<div class="ma-title">🌾 MetaAgri <span class="ma-title-farm">· {esc(farm)}</span></div>',
            unsafe_allow_html=True,
        )
    with date_col:
        st.metric("Date", state.get("long_date") or state.get("date", ""))
    with badge_col:
        st.write("")
        render_badges(agents_label)
    # All four stay disabled while a day is being planned: a reset or scenario mid-tick would
    # land in the middle of that day's census / plan.
    busy = not hub_up or tick_in_progress
    tick_btn, heat_btn, hail_btn, reset_btn = st.columns(4)
    with tick_btn:
        if st.button("⏭ Next day", use_container_width=True, disabled=busy):
            fire_and_forget_post("/tick")
            st.rerun()
    with heat_btn:
        if st.button("🔥 Heatwave", use_container_width=True, disabled=busy):
            api_post("/scenario/heatwave")
            st.rerun()
    with hail_btn:
        if st.button("⛈️ Hail warning", use_container_width=True, disabled=busy):
            api_post("/scenario/hail")
            st.rerun()
    with reset_btn:
        if st.button("🔄 Restart season", use_container_width=True, disabled=busy):
            api_post("/reset")
            st.rerun()


def render_banners(state: dict, log: list, tick_in_progress: bool) -> None:
    flash = st.session_state.get(FLASH_KEY)
    if flash and time.monotonic() - flash[1] < FLASH_SECONDS:
        st.warning(f"⚠️ {flash[0]}")
    if tick_in_progress:
        n_done = fields_done_this_tick(log, state.get("tick"))
        st.markdown(
            f'<div class="ma-thinking-banner">🧠 Field agents are thinking… ({n_done}/3 done)</div>',
            unsafe_allow_html=True,
        )
    for msg in scenario_messages(state):
        text = msg[:1].upper() + msg[1:]
        if msg.lower().startswith("heatwave"):
            days_left = int(num(state.get("heatwave_days_remaining")))
            suffix = f" · {days_left} day{'s' if days_left != 1 else ''} left" if days_left else ""
            st.markdown(f'<div class="ma-scenario-red">🔥 {esc(text + suffix)}</div>', unsafe_allow_html=True)
        elif msg.lower().startswith("hail"):
            st.markdown(f'<div class="ma-scenario-amber">⛈️ {esc(text)} — harvest ripe crops before it hits</div>', unsafe_allow_html=True)
        else:
            st.markdown(f'<div class="ma-scenario-red">⚠️ {esc(text)}</div>', unsafe_allow_html=True)


def render_plan_card(bundle: dict, hub_up: bool, index: int) -> None:
    bundle_id = bundle.get("bundle_id")
    wkey = bundle_id if bundle_id is not None else f"i{index}"  # widget keys must stay unique
    with st.container(border=True):
        st.markdown(f"**🧭 Plan for {esc(bundle.get('plan_for', '?'))}**")

        deltas = resource_delta_html(as_dict(bundle.get("resources_before")), as_dict(bundle.get("resources_after")))
        if deltas:
            st.markdown(f'<div class="ma-tile-stats">{deltas}</div>', unsafe_allow_html=True)

        st.markdown(plan_table_html(as_list(bundle.get("plan_rows"))), unsafe_allow_html=True)

        overall = bundle.get("overall_confidence")
        if isinstance(overall, (int, float)):
            low_flag = (
                '<span class="ma-low-confidence">⚠ low confidence — review carefully</span>'
                if overall < 0.5
                else ""
            )
            st.markdown(f"Overall plan confidence: **{overall:.2f}** {low_flag}", unsafe_allow_html=True)

        if bundle.get("summary"):
            st.markdown(esc(bundle["summary"]))

        blocked = [e for e in as_list(bundle.get("thorn")) if isinstance(e, dict) and e.get("blocked")]
        if blocked:
            st.markdown("**🛡️ Safety check blocked:**")
            for e in blocked:
                field_label = FIELD_DISPLAY_NAME.get(e.get("field"), e.get("field", "?"))
                st.markdown(
                    f'<div class="ma-blocked">🛡️ {esc(field_label)} · {esc(action_label(as_dict(e.get("action"))))}: '
                    f'{esc(e.get("rule") or "blocked")}</div>',
                    unsafe_allow_html=True,
                )

        if plan_has_neighbour_help(bundle):
            help_html = neighbour_help_html(as_list(bundle.get("nearby_capacity")))
            if help_html:
                st.markdown(help_html, unsafe_allow_html=True)

        # The reason gets the card's full width (half a narrow Inbox column cut the options off).
        reason_choice = st.selectbox("If you reject, why?", REJECT_REASONS, key=f"reason-{wkey}")
        if reason_choice == REJECT_REASON_OTHER:
            reason = st.text_input(
                "Custom reason",
                key=f"reason-other-{wkey}",
                label_visibility="collapsed",
                placeholder="Type a reason…",
            ).strip()
        else:
            reason = reason_choice
        st.caption("Your reason is sent back to the field agents and shapes their next plan.")
        # "Other" with an empty box must not send the option label to the field agents as
        # feedback; the flag keeps the warning up across the 2 s autorefresh.
        missing_key = f"reason-missing-{wkey}"
        approve_col, reject_col = st.columns(2)
        with approve_col:
            if st.button("✅ Approve", key=f"approve-{wkey}", use_container_width=True, disabled=not hub_up):
                api_post("/decide", {"bundle_id": bundle_id, "decision": "approve"})
                st.rerun()
        with reject_col:
            if st.button("❌ Reject", key=f"reject-{wkey}", use_container_width=True, disabled=not hub_up):
                if reason:
                    api_post("/decide", {"bundle_id": bundle_id, "decision": "reject", "reason": reason})
                    st.rerun()
                st.session_state[missing_key] = True
        if reason:
            st.session_state.pop(missing_key, None)
        elif st.session_state.get(missing_key):
            st.warning("Type a reason first.")


def render_our_farm_dashboard(state: dict, hub_up: bool, log: list, inbox: list, notices: list) -> None:
    fields = as_dict(state.get("fields"))
    hail_active = bool(state.get("hail_date"))

    # -- weather + resources -------------------------------------------------------------
    st.markdown(weather_strip_html(state), unsafe_allow_html=True)
    st.markdown(resource_strip_html(state), unsafe_allow_html=True)

    # -- hero row: flower + field map ------------------------------------------------------
    flower_col, map_col = st.columns([1, 1.4])
    with flower_col:
        render_html_panel(build_hero_svg(state, log), height=HERO_HEIGHT + 16)
        st.markdown(hero_legend_html(), unsafe_allow_html=True)
        st.caption("Petal size = field area · click a petal to open that field.")
    with map_col:
        render_field_map(state)
        st.caption("Click a field on the map to open its detail.")

    # -- farms strip ---------------------------------------------------------------------------
    st.markdown(farm_strip_html(as_list(state.get("farms")), state.get("date", "")), unsafe_allow_html=True)

    # -- field detail view -----------------------------------------------------------------------
    render_field_detail_picker(state, hub_up)

    # -- main layout ------------------------------------------------------------------------------
    left, centre, right = st.columns([0.30, 0.33, 0.37])

    with left:
        st.markdown("### Fields")
        for field in FIELDS:
            st.markdown(field_tile_html(field, as_dict(fields.get(field)), hail_active), unsafe_allow_html=True)

    with centre:
        st.markdown("### Team conversation")
        level_colors = {"info": "#a3a89a", "warn": "#f59e0b", "block": "#ef4444", "decision": "#22c55e"}
        lines = []
        for e in [e for e in log if isinstance(e, dict)][:200]:
            icon = conversation_icon(e)
            icon_prefix = f"{icon} " if icon else ""
            lines.append(
                f'<div class="ma-logline" style="color:{level_colors.get(e.get("level"), "#a3a89a")};">'
                f'[{esc(e.get("date", ""))}] {icon_prefix}{esc(e.get("actor", ""))}: {esc(e.get("text", ""))}</div>'
            )
        st.markdown(f'<div class="ma-log-container">{"".join(lines) or "<em>No conversation yet.</em>"}</div>', unsafe_allow_html=True)

    with right:
        st.markdown("### Inbox")
        plans = [b for b in inbox if isinstance(b, dict)]
        if not plans:
            st.info("No plan waiting for a decision — press ⏭ Next day.")
        for i, bundle in enumerate(plans):
            render_plan_card(bundle, hub_up, i)

    # -- what buyers & neighbours see -----------------------------------------------------------------
    with st.expander("📣 What buyers & neighbours see", expanded=False):
        cards = [n for n in notices if isinstance(n, dict)]
        if not cards:
            st.caption("No notices yet — they appear when a plan is approved.")
        for notice in cards:
            st.markdown(notice_card_html(notice), unsafe_allow_html=True)


st.set_page_config(page_title="MetaAgri", layout="wide", page_icon="🌾")
st_autorefresh(interval=2000, key="autorefresh")

st.markdown(
    """
    <style>
    [data-testid="stMetricValue"] { font-size:1.45rem; }  /* "Wednesday 8 July" fits the top bar */
    .ma-title { font-size:1.45rem; font-weight:700; padding-top:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ma-title-farm { color:#a3b18a; font-weight:600; }
    .ma-badge { background:#1a2219; color:#a3a89a; padding:2px 10px; border-radius:999px;
                font-size:0.75rem; border:1px solid #2c3a28; margin-right:6px; white-space:nowrap; }
    .ma-scenario-red { background:#3f1d17; color:#fca5a5; border:1px solid #ef4444; border-radius:6px;
                       padding:8px 12px; margin-bottom:10px; font-weight:600; }
    .ma-scenario-amber { background:#3a2a0a; color:#fcd34d; border:1px solid #f59e0b; border-radius:6px;
                         padding:8px 12px; margin-bottom:10px; font-weight:600; }
    .ma-thinking-banner { background:#132a3f; color:#7dd3fc; border:1px solid #0ea5e9; border-radius:6px;
                          padding:8px 12px; margin-bottom:10px; font-weight:600; }
    .ma-strip { display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
    .ma-card { flex:1; min-width:140px; background:#161d15; border-radius:10px; padding:10px 12px;
               border:1px solid #2a3326; }
    .ma-card-label { font-size:0.72rem; color:#a3a89a; text-transform:uppercase; letter-spacing:0.04em; }
    .ma-card-value { font-size:1.2rem; font-weight:700; margin:2px 0; }
    .ma-card-sub { font-size:0.74rem; color:#a3a89a; }
    .ma-card-alert { border-color:#ef4444; background:#2a1614; }
    .ma-card-alert .ma-card-value, .ma-card-alert .ma-card-sub { color:#fca5a5; }
    .ma-card-hail { border:2px solid #ef4444; background:#2a1614; }
    .ma-hail-chip { background:#ef4444; color:#fff; border-radius:4px; padding:0 5px; margin-left:6px;
                    font-size:0.66rem; font-weight:700; letter-spacing:0.03em; }
    .ma-weather-row { display:flex; align-items:center; gap:8px; }
    .ma-weather-icon { font-size:1.6rem; }
    .ma-tile { background:#161d15; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
    .ma-tile-header { font-weight:700; font-size:1.02rem; margin-bottom:4px; }
    .ma-stage { float:right; font-weight:500; font-size:0.72rem; color:#a3a89a; background:#1a2219;
                border:1px solid #2c3a28; border-radius:999px; padding:1px 8px; }
    .ma-progress-outer { position:relative; background:#2a3326; border-radius:6px; height:10px; margin:6px 0; }
    .ma-progress-inner { height:100%; border-radius:6px; }
    .ma-threshold-tick { position:absolute; top:-3px; width:2px; height:16px; background:#fef3c7; border-radius:1px; }
    .ma-tile-stats { font-size:0.82rem; color:#a3a89a; margin-bottom:2px; }
    .ma-tooltip { cursor:help; opacity:0.65; font-size:0.75em; margin-left:1px; }
    .ma-log-container { max-height:640px; overflow-y:auto; background:#0b0f0a; border-radius:8px; padding:10px; }
    .ma-logline { font-family: "SFMono-Regular", Consolas, monospace; font-size:0.78rem;
                  white-space:pre-wrap; margin-bottom:2px; }
    .ma-notice { background:#161d15; border-radius:14px; padding:10px 14px; margin-bottom:8px;
                 border-left:4px solid #6a994e; }
    .ma-chip { display:inline-block; border:1px solid; border-radius:999px; padding:0 8px; font-size:0.72rem;
               font-weight:600; margin-right:8px; }
    .ma-notice-date { font-size:0.72rem; color:#a3a89a; }
    @keyframes ma-pulse {
      0%, 100% { border-color:#b5542c; box-shadow:0 0 0 0 rgba(181,84,44,0.55); }
      50% { border-color:#f0a36e; box-shadow:0 0 10px 2px rgba(181,84,44,0.45); }
    }
    .ma-tile-pulse { border-width:2px !important; border-style:solid; animation:ma-pulse 1.4s ease-in-out infinite; }
    .ma-plan-table { width:100%; border-collapse:collapse; font-size:0.78rem; margin:8px 0; }
    .ma-plan-table th { text-align:left; color:#a3a89a; font-weight:600; padding:4px 6px;
                        border-bottom:1px solid #2a3326; }
    .ma-plan-table td { padding:4px 6px; border-bottom:1px solid #1a2219; vertical-align:top; }
    .ma-conf-outer { display:inline-block; width:50px; height:8px; background:#2a3326; border-radius:4px;
                     overflow:hidden; vertical-align:middle; margin-right:4px; }
    .ma-conf-inner { height:100%; }
    .ma-conf-label { font-size:0.72rem; color:#a3a89a; }
    .ma-low-confidence { background:#3f2d0a; color:#fbbf24; border:1px solid #f59e0b; border-radius:6px;
                         padding:2px 8px; font-weight:600; margin-left:6px; }
    .ma-blocked { color:#ef4444; font-size:0.85rem; margin-bottom:2px; }
    .ma-farm-card { flex:1; background:#161d15; border-radius:10px; padding:10px 12px; border:1px solid #2a3326; }
    .ma-dot { width:9px; height:9px; border-radius:50%; display:inline-block; margin-right:6px; }
    .ma-farm-name { font-weight:600; font-size:0.88rem; }
    .ma-farm-line { font-size:0.78rem; color:#a3a89a; margin-top:4px; }
    .ma-farm-updated { font-size:0.7rem; color:#a3a89a; margin-top:2px; }
    .ma-nearby { background:#161d15; border-radius:10px; padding:8px 10px; margin:8px 0; }
    .ma-nearby-title { font-weight:600; font-size:0.82rem; margin-bottom:4px; }
    .ma-nearby-row { font-size:0.78rem; color:#d6d3c4; margin-bottom:2px; }
    .ma-legend { font-size:0.72rem; color:#a3a89a; margin-top:2px; }
    .ma-legend-swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin:0 4px 0 10px;
                        vertical-align:middle; }
    </style>
    """,
    unsafe_allow_html=True,
)

state = api_get("/state")
hub_up = isinstance(state, dict)
if hub_up:
    log = as_list(api_get("/log"))
    inbox = as_list(api_get("/inbox"))
    notices = as_list(api_get("/notices"))
    status = as_dict(api_get("/status"))
else:
    st.warning(f"⚠️ Farm hub unreachable at {HUB_URL} — showing mock/synthetic data.")
    state, log, inbox, notices = MOCK_STATE, MOCK_LOG, MOCK_INBOX, MOCK_NOTICES
    status = {}

tick_in_progress = bool(status.get("tick_in_progress"))
agent_mode = status.get("mode", "")
agents_label = "Flower SuperGrid" if agent_mode == "grid" else "simulated"

# -- routing: ?farm=<id> opens a farm view, else the pydeck map at ?level=1|2|3 --
_level_param = st.query_params.get("level", "1")
try:
    _level = int(_level_param)
except (TypeError, ValueError):
    _level = 1
if _level not in (1, 2, 3):
    _level = 1
_farm_id = st.query_params.get("farm")

if _farm_id == OWN_FARM_ID:
    render_full_topbar(state, hub_up, tick_in_progress, agents_label)
    render_banners(state, log, tick_in_progress)
    render_back_to_region()
    render_our_farm_dashboard(state, hub_up, log, inbox, notices)
elif _farm_id in FARM_IDS:
    render_minimal_topbar(state, agents_label)
    render_banners(state, log, tick_in_progress)
    render_neighbour_view(FARM_IDS[_farm_id], state, hub_up)
else:
    render_minimal_topbar(state, agents_label)
    render_banners(state, log, tick_in_progress)
    render_map_page(_level, state, hub_up)
