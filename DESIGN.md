# MetaAgri — design contract (MVP)

MetaAgri is a multi-agent **digital twin of farms**, ported from MetaHospital's Python/Flower
twin (git history of `../MetaHospital`, commit `0f842b7`; its working tree is now a web MVP). Same
architecture, same multi-level navigation, same human-in-the-loop story — agriculture domain.
This file is the contract between `hub/`, `agents/petal/` and `ui/`. If code and this file
disagree, fix the code (or update this file deliberately and say so).

## 1. Concept mapping

| MetaHospital                              | MetaAgri                                                   |
|-------------------------------------------|------------------------------------------------------------|
| Earth → Germany → Berlin → Hospital → Unit | Earth → Germany → Oderbruch (Brandenburg) → Farm → Field  |
| Hospital "Klinikum Kreuzberg" (ours)      | Farm "Hof Lerchenbruch" (ours)                               |
| Neighbour hospitals                       | Neighbour farms "Gut Rohrdommelsee", "Agrarhof Oderblick"     |
| Units ED / ICU / Ward (petals)            | Fields North / West / River (petals)                       |
| Patients (condition, acuity)              | Crops (crop, stage, soil moisture, health, disease)        |
| Beds staffed/occupied                     | Daily resources: water permit, workers, combine, sprayer, silo |
| Unit agent ("ICU agent")                  | Field agent ("River field agent")                          |
| Coordinator (Stem)                        | Coordinator (Stem) — resolves machine conflicts             |
| Safety check (Thorn)                      | Safety check (Thorn) — agronomic & legal hard rules         |
| Regional coordinator                      | Machinery ring (Maschinenring-style co-op)                 |
| divert_to <hospital>                      | borrow_combine <farm>, deliver_to <farm>                   |
| Charge nurse                              | Farm manager                                               |
| Emergency: bus accident                   | 🔥 Heatwave (water permit cut) and ⛈️ Hail warning          |
| What families see                         | What buyers & neighbours see (notices)                     |
| 1 tick = 1 hour, day starts 08:00         | 1 tick = 1 day, season starts Monday 6 July 2026            |
| hub :8000, ui :8501                       | hub :8100, ui :8601                                         |

Human-facing names (log actors, UI) vs code names: "Coordinator" = `hub/stem.py`, "Safety
check" = `hub/thorn.py`, "North/West/River field agent" = `agents/petal/`, "Farm" = the hub
itself, "Machinery ring" = the neighbour-help step in `hub/stem.py`, "Farm manager" = the human.
A "plan" is a bundle. The tick counter is never shown to a human — always the date label.

## 2. Layout

```
MetaAgri/
  CLAUDE.md  DESIGN.md  README.md  DEMO.md  .gitignore
  scripts/demo.sh            # [mock|grid]; starts hub :8100 + ui :8601
  agents/agent/              # untouched Flower template (copied from MetaHospital)
  agents/petal/              # Flower AgentApp: field agent or farm agent
    pyproject.toml           # [project] name = "agri-petal", package dir petal/
    petal/agent_app.py  petal/schemas.py  petal/__init__.py  README.md  LICENSE  .gitignore
  hub/                       # FastAPI twin (uv project, package "hub")
    pyproject.toml README.md
    hub/__init__.py clock.py schemas.py weather.py sim.py state.py thorn.py stem.py
        mock_petals.py mock_farms.py notices.py main.py
    tests/                   # pytest + fastapi TestClient (dev deps: pytest, httpx)
  ui/                        # Streamlit (uv project, package = false)
    pyproject.toml README.md app.py .streamlit/config.toml
```

Python 3.14 via uv (`requires-python = ">=3.11,<4.0"` like MetaHospital). Use `uv add` / `uv add
--dev`, never pip. Hub deps: fastapi, uvicorn[standard], pydantic, requests (+ dev: pytest,
httpx). UI deps: streamlit, streamlit-autorefresh, requests, pydeck. Petal deps: flwr>=1.35,<2,
openai>=2.16,<3, pydantic, requests (copy the shape of `0f842b7:agents/petal/pyproject.toml`).

## 3. Clock (`hub/clock.py`)

- `SEASON_START = date(2026, 7, 6)` (a Monday). tick 0 = that day. One tick = one day.
- `date_label(tick) -> "Mon 6 Jul"` (build it as `f"{d:%a} {d.day} {d:%b}"`, no `%-d`).
- `long_date(tick) -> "Monday 6 July"`.
- A plan made at tick t is the plan **for that day**: `plan_for = date_label(t)`.

## 4. Domain constants (`hub/state.py` unless noted)

```python
FIELDS = ["North", "West", "River"]
FIELD_AGENT_NAME = {"North": "North field agent", "West": "West field agent", "River": "River field agent"}
FIELD_DISPLAY_NAME = {"North": "North field", "West": "West field", "River": "River field"}

CROPS = {  # kc = crop coefficient while growing; price for value-at-risk; cereal = combinable crop (ripens, needs the combine)
    "winter wheat": {"kc": 0.45, "stress_threshold": 35, "price_eur_t": 220, "cereal": True,  "daily_ripe_loss": 0.01, "emoji": "🌾"},
    "rapeseed":     {"kc": 0.40, "stress_threshold": 30, "price_eur_t": 460, "cereal": True,  "daily_ripe_loss": 0.02, "emoji": "🌼"},
    "potatoes":     {"kc": 1.10, "stress_threshold": 60, "price_eur_t": 160, "cereal": False, "daily_ripe_loss": 0.0,  "emoji": "🥔"},
}
KC_HARVESTED = 0.2      # bare stubble
KC_COVER_CROP = 0.5

SEED_FIELDS = {
    "North": {"crop": "winter wheat", "area_ha": 42, "days_to_harvest": 4,  "soil_moisture": 48, "irrigable": False, "yield_t_ha": 7.8,  "health": 0.86, "disease": 0.15},
    "West":  {"crop": "rapeseed",     "area_ha": 30, "days_to_harvest": 3,  "soil_moisture": 44, "irrigable": False, "yield_t_ha": 3.9,  "health": 0.84, "disease": 0.10},
    "River": {"crop": "potatoes",     "area_ha": 24, "days_to_harvest": 48, "soil_moisture": 62, "irrigable": True,  "yield_t_ha": 42.0, "health": 0.90, "disease": 0.35},
}

OWN_FARM_NAME = "Hof Lerchenbruch"
NEIGHBOUR_FARM_SEEDS = {
    "Gut Rohrdommelsee":     {"storage_capacity_t": 900, "storage_used_t": 380, "combine_busy_prob": 0.10, "cereal_heavy": False,
                           "avg_soil_moisture": 52, "crops": "maize, sugar beet", "area_ha": 310},
    "Agrarhof Oderblick": {"storage_capacity_t": 600, "storage_used_t": 420, "combine_busy_prob": 0.60, "cereal_heavy": True,
                           "avg_soil_moisture": 45, "crops": "wheat, rapeseed, barley", "area_ha": 240},
}
FARM_NAMES = [OWN_FARM_NAME, *NEIGHBOUR_FARM_SEEDS]
FARM_IDS = {"lerchenbruch": "Hof Lerchenbruch", "rohrdommelsee": "Gut Rohrdommelsee", "oderblick": "Agrarhof Oderblick"}
FARM_COORDS = {"Hof Lerchenbruch": (52.655, 14.300), "Gut Rohrdommelsee": (52.712, 14.170), "Agrarhof Oderblick": (52.585, 14.455)}  # (lat, lon)
REGION_NAME = "Oderbruch"; REGION_COORD = (52.64, 14.30)
FARMYARD_COORD = (52.6545, 14.2990)
FIELD_POLYGONS = {  # closed rings of [lon, lat]; areas ≈ area_ha
    "North": [[14.2950, 52.6575], [14.3045, 52.6575], [14.3045, 52.6635], [14.2950, 52.6635], [14.2950, 52.6575]],
    "West":  [[14.2860, 52.6505], [14.2935, 52.6505], [14.2935, 52.6560], [14.2860, 52.6560], [14.2860, 52.6505]],
    "River": [[14.3040, 52.6480], [14.3105, 52.6480], [14.3105, 52.6530], [14.3040, 52.6530], [14.3040, 52.6480]],
}

WATER_PERMIT_NORMAL_M3 = 6500     # daily abstraction permit
WATER_PERMIT_HEATWAVE_M3 = 3600   # authority cuts it during a heatwave
COMBINES, SPRAYERS, WORKERS = 1, 1, 5
STORAGE_CAPACITY_T, STORAGE_SEED_USED_T = 450, 120
M3_PER_MM_HA = 10                 # 1 mm on 1 ha = 10 m³
```

`HubState.reset(seed: int | None = None)` — if a seed is given (or env `METAAGRI_SEED`), call
`random.seed(seed)` first, so tests and demos are reproducible.

## 5. Weather & crop simulation (`hub/weather.py`, `hub/sim.py`)

**Weather** is regional (same for all three farms). `state.weather_today` plus
`state.forecast` = the next 3 days, generated ahead so the forecast is what actually happens.
`sim.step` pops `forecast[0]` into today and appends a freshly generated day.

- Normal day: `temp_max_c` U(21, 29); rain: 65% 0 mm, 20% U(0.5, 4), 15% U(5, 14); `wind_ms`
  triangular(1, 8, 3); `et0_mm` = clamp(3.0 + (temp−20)·0.25 − rain·0.05, 2.0, 5.5);
  `humidity_pct` U(50, 85) (+10 if rain > 0, max 95). Round to 1 decimal (humidity int).
- Heatwave day: temp U(33, 37), rain 0, wind U(1.5, 4), et0 U(6.8, 7.8), humidity U(30, 45), note "heatwave".
- Hail day: temp 27, rain U(18, 30), wind U(12, 16), et0 3.0, humidity 90, `hail=True`, note "hail storm".

**Daily field update** (`sim.step`, after tick += 1 and weather roll):
1. ET = et0 × kc (KC_HARVESTED if harvested and no cover crop, KC_COVER_CROP if cover crop).
   `soil_moisture = clamp(soil_moisture + rain_mm − ET, 0, 100)` (% of plant-available water;
   with 100 mm PAW, 1 mm = 1 %). Irrigation is added at approval time, not here.
2. Ripening (unharvested cereals only): `days_to_harvest −= 1`, and −1 more while a heatwave
   is active. `harvest_ready = days_to_harvest <= 0`. While ready and unharvested:
   `harvest_waiting_days += 1`, `yield_t_ha *= (1 − daily_ripe_loss)`. Potatoes: dth −= 1 only.
3. Health (unharvested): if moisture < stress_threshold: `health −= 0.015 + 0.003·(threshold − moisture)`,
   else `health += 0.004`. If disease > 0.7: `health −= 0.02`. Clamp to [0.2, 0.95].
4. Disease: potatoes `+0.07` if rain ≥ 3 or humidity ≥ 80, `−0.02` if temp ≥ 30 and rain = 0;
   rise ×0.3 if sprayed within the last 7 days. Cereals ±0.01 noise. Clamp [0, 1].
5. `yield_estimate_t = round(area_ha · yield_t_ha · min(1.0, health / 0.85), 1)`.
6. Stage label: harvested → "harvested" / "cover crop"; cereals: dth ≤ 0 "harvest-ready",
   dth ≤ 7 "ripening", else "grain fill"; potatoes: dth > 14 "tuber bulking" else "maturing".
7. Scenarios: heatwave countdown (on end: permit back to normal, log "Farm" info); if today is
   the hail day: every unharvested cereal with dth ≤ 4 loses 40 % (`yield_t_ha *= 0.6`),
   potatoes `health −= 0.08`; log warn per field ("Hail hit West field: rapeseed lost 40%");
   clear the hail warning.
8. Neighbour drift: each neighbour `storage_used_t += U(0, 25)` (cap at capacity);
   `combine_available = 1 if random() > busy_prob else 0` — during a hail warning a
   `cereal_heavy` farm's combine is always busy (they harvest their own); avg soil moisture
   `+= rain − et0·0.9 + 2` clamp [10, 95].
9. Any still-pending bundle from an earlier day → status "expired" (log "Farm": "the Mon 6 Jul
   plan expired undecided"). `recent_actions = []`. Record field + farm history.

**Scenarios** (`POST /scenario/heatwave`, `POST /scenario/hail`), both may be active at once:
- Heatwave: `heatwave_days_remaining = 4`; today and the next 3 forecast days become heatwave
  days; `water_permit_m3 = WATER_PERMIT_HEATWAVE_M3` immediately. Message
  `"heatwave: water permit cut to 3,600 m³/day"`. Log warn "Farm".
- Hail warning: `hail_tick = tick + 2`; `forecast[1]` becomes a hail day, `forecast[0]` becomes
  dry and calm (rain 0, wind U(2, 4)) so tomorrow is harvestable. Every unharvested cereal with
  `0 < days_to_harvest <= 4` → `days_to_harvest = 1` ("harvest early before the hail"; next
  step makes it ready). Message `"hail warning: severe hail expected Wed 8 Jul"` (date of
  hail_tick). Log warn "Farm". No-op (return current message) if a hail warning is already active.
- `state.scenario_messages()` → list of active messages; `/state.scenario` = `" · ".join(...)` or None.

## 6. Schemas (`hub/schemas.py`; `agents/petal/petal/schemas.py` is a standalone copy of the
Action/Proposal/FarmCapacity part — petal must never import hub)

```python
FIELD = Literal["North", "West", "River"]
ACTION_TYPES = ("irrigate", "spray", "fertilize", "harvest", "scout", "defer_task",
                "sow_cover_crop", "borrow_combine", "deliver_to")

class Weather(BaseModel):
    date: str; temp_max_c: float; rain_mm: float; wind_ms: float; et0_mm: float
    humidity_pct: int; hail: bool = False; note: str = ""

class Resources(BaseModel):          # today's availability, as a field agent sees it
    water_permit_m3: int; workers: int; combine: int; sprayer: int; storage_free_t: float

class FieldCensus(BaseModel):
    tick: int; date: str; field: FIELD; crop: str; area_ha: float; stage: str
    days_to_harvest: int; harvest_ready: bool; harvested: bool; cover_crop: bool; irrigable: bool
    soil_moisture_pct: float; stress_threshold_pct: float; crop_health: float
    disease_pressure: float; yield_estimate_t: float
    days_since_sprayed: Optional[int] = None; days_since_irrigated: Optional[int] = None
    weather_today: Weather; forecast: List[Weather] = []
    resources: Resources
    recent_rejections: List[str] = []; scenario: Optional[str] = None; hint: Optional[str] = None

class Action(BaseModel):
    type: Literal[*ACTION_TYPES]            # spell the literal out
    mm: Optional[float] = Field(None, ge=0)          # irrigate depth
    product: Optional[str] = None                     # spray: fungicide | insecticide | herbicide
    kg_n_ha: Optional[float] = Field(None, ge=0)     # fertilize
    tonnes: Optional[float] = Field(None, ge=0)      # deliver_to
    farm: Optional[str] = None                        # borrow_combine / deliver_to: neighbour's exact name
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    reason: Optional[str] = None

class Proposal(BaseModel):
    field: FIELD; actions: List[Action] = []
    rationale: str = Field(min_length=1); confidence: float = Field(ge=0.0, le=1.0); risks: List[str] = []

class ThornEntry(BaseModel):
    field: str; action: dict; blocked: bool; rule: Optional[str] = None

class PlanRow(BaseModel):
    field: FIELD; crop: str; action_type: str
    what: str        # "Irrigate 25 mm" · "Harvest ~328 t" · "Harvest with Gut Rohrdommelsee's combine (~117 t)"
                     # · "Deliver 115 t to Gut Rohrdommelsee" · "Spray fungicide" · "Scout field" · "Sow cover crop" · "Wait"
    resources: str   # "6,000 m³ water · 1 worker" · "combine · 2 workers" · "—"
    confidence: float = Field(ge=0.0, le=1.0); reason: str

class FarmCensus(BaseModel):         # what a farm agent (ours or a neighbour's) is asked
    farm: str; date: str; storage_free_t: float; combine_available: int
    ripe_backlog_ha: float; avg_soil_moisture_pct: float; scenario: Optional[str] = None

class FarmCapacity(BaseModel):       # a farm agent's answer
    farm: str; can_share: Dict[str, float]   # {"combine": 0|1, "storage_t": n}
    valid_until: str; confidence: float = Field(ge=0.0, le=1.0); note: str = ""

class Bundle(BaseModel):
    bundle_id: int; tick: int; plan_for: str; summary: str
    proposals: List[Proposal]; thorn: List[ThornEntry]; plan_rows: List[PlanRow]
    overall_confidence: Optional[float] = None
    nearby_capacity: List[FarmCapacity] = []
    resources_before: Dict[str, float]   # {"water_m3","workers","combine","sprayer","storage_free_t"} available
    resources_after: Dict[str, float]    # same keys, remaining if the plan is approved
    status: Literal["pending", "approved", "rejected", "expired"] = "pending"
    reason: Optional[str] = None

class DecideRequest(BaseModel):
    bundle_id: int; decision: Literal["approve", "reject"]; reason: Optional[str] = None
```

Resource cost per action (used by Thorn and plan rows): harvest = combine 1 + workers 2;
borrow_combine = neighbour combine 1 + workers 1 (our grain cart) and it *is* a harvest of that
field; spray = sprayer 1 + workers 1; irrigate = workers 1 + water `mm·area_ha·10` m³;
fertilize = workers 1; sow_cover_crop = workers 1; scout / defer_task / deliver_to = nothing.

## 7. Safety check (`hub/thorn.py`) — pure Python, no LLM

Exact rule strings (constants):
```python
RULE_PROPOSAL_SHAPE   = "Every proposal needs a non-empty rationale and 0 <= confidence <= 1."
RULE_WATER_PERMIT     = "Irrigation must stay within today's water permit."
RULE_NOT_IRRIGABLE    = "Only fields with irrigation equipment can be irrigated."
RULE_SPRAY_WEATHER    = "No spraying when wind > 5 m/s or > 5 mm rain is forecast for tomorrow."
RULE_PRE_HARVEST      = "No spraying within 14 days of harvest (pre-harvest interval)."
RULE_HARVEST          = "Harvest only ripe, unharvested crops on a dry day (< 2 mm rain)."
RULE_MACHINE          = "Each machine can work one field per day."
RULE_WORKERS          = "Never plan more work than workers available today."
RULE_FERTILIZE        = "No fertilizing on waterlogged soil (> 90%), before heavy rain (> 10 mm tomorrow), or on harvested fields."
RULE_NEIGHBOUR_FARM   = "borrow_combine and deliver_to need a named neighbour farm."
RULE_NEIGHBOUR_CAPACITY = "Blocked: that farm reports no spare capacity for this."
RULE_COVER_CROP       = "Cover crops can only be sown on a harvested field without one."
RULE_DELIVER_SURPLUS  = "deliver_to can only move grain that won't fit in our silo today."
RULE_ACTION_PARAMS    = "irrigate needs mm > 0, fertilize needs kg_n_ha > 0, deliver_to needs tonnes > 0."
SPRAY_MAX_WIND_MS = 5.0; SPRAY_MAX_RAIN_TOMORROW_MM = 5.0; PRE_HARVEST_DAYS = 14
HARVEST_MAX_RAIN_MM = 2.0; FERTILIZE_MAX_MOISTURE = 90; FERTILIZE_MAX_RAIN_TOMORROW_MM = 10
```
`evaluate(proposals, state, starting_usage=None) -> (entries, filtered_proposals, resources_before, resources_after)`
- Shape check first (invalid proposal → every action blocked with RULE_PROPOSAL_SHAPE).
- Walk actions in a fixed priority order: harvest/borrow_combine, then irrigate (fields with the
  lowest moisture-minus-threshold first), then spray, fertilize, sow_cover_crop, the rest.
  Usage accumulates (`water_m3`, `workers`, `combine`, `sprayer`, per-neighbour `combine` and
  `storage_t`); an action that would exceed a limit is blocked with the matching rule and does
  not consume anything. Storage is *not* a Thorn rule (surplus is handled by deliver_to or sold).
- `starting_usage` lets the Machinery-ring pass continue from the first pass's usage (like
  MetaHospital's `starting_occupied`). `resources_before` = today's availability;
  `resources_after` = remaining after allowed actions, `storage_free_t` reduced by the allowed
  harvests' `yield_estimate_t` (floored at 0) and increased by allowed deliver_to tonnes' surplus relief.
- Neighbour checks read `state.nearby_capacity[farm]["can_share"]`; a farm not in it, or the
  own farm, counts as zero capacity. A `deliver_to` may only move what today's cleared harvests
  leave over after our silo (`harvest_t − storage_free_t − already delivered`, 0.05 t rounding slack).
- `passes_alone(proposal, action, state)`: would this action clear the check if it were the only
  work today? The Coordinator uses it so only feasible work competes for a machine.

## 8. Coordinator + Machinery ring (`hub/stem.py`)

`build_bundle(state, proposals, farm_capacity) -> dict`:
1. Log each proposal (actor = field agent name, "proposed N action(s): <rationale>").
2. `_resolve_conflicts`: if more than one field wants the combine (harvest) or the sprayer
   (spray) today — counting only actions that `thorn.passes_alone` (an unripe harvest or a spray
   inside the pre-harvest interval stays in its proposal for Thorn to block, and never takes the
   machine from a field that could use it) — keep the one with the most **value at risk** (`yield_estimate_t × price_eur_t`
   for harvest; `disease_pressure × yield_estimate_t × price_eur_t` for spray); drop the others.
   Log (actor "Coordinator"): `"conflict: the combine was requested by North field and West
   field; kept North field (€72k at risk vs €54k), West field waits"`. Remember the harvest
   losers in `unmet_harvest` for step 5.
3. Thorn pass 1 on the unit proposals; log each block (actor "Safety check", level "block",
   `"blocked <type> for <Field> field: <rule>"`).
4. `state.nearby_capacity = farm_capacity`; log one line per farm (actor = farm name, "can share
   1 combine / 235 t storage until Wed 8 Jul (confidence 0.85). <note>"), then actor "Machinery
   ring": "compiled spare capacity from 3 farms".
5. `_suggest_neighbour_help` starts from what the field agents' own cleared actions already
   use (their own borrows/deliveries, harvested fields, per-farm tallies). (a) every `unmet_harvest` field that is harvest-ready → a
   `borrow_combine` action naming the best neighbour (never the own farm) with a spare combine
   (highest confidence, then most storage), decrementing a local `remaining` tally; (b) storage:
   `expected_t` = sum of `yield_estimate_t` of the allowed harvests + suggested borrow_combine
   fields; `surplus = expected_t − storage_free_t`; if surplus > 0.5 → `deliver_to` actions
   splitting the surplus over neighbours with `storage_t` left (highest confidence first,
   `tonnes` rounded to 0.1, no split smaller than 0.5 t; the surplus is sized only on borrows
   Thorn will clear, so a blocked borrow never leaves a delivery of grain still on the field). Attach the suggestions to one Proposal per field (the field whose
   grain it is — the borrowed field, else the last allowed harvest field), rationale
   `"Machinery ring: ..."`, confidence = min of its actions. Thorn pass 2 with `starting_usage`
   from pass 1; log blocks. If a harvest-ready unmet field gets no combine, log (actor
   "Machinery ring", warn) `"no neighbour combine free today; West field waits"`.
6. Plan rows (one per allowed action; `confidence` = action's or proposal's; `reason` =
   action's or rationale), `overall_confidence` = min over rows (None if no rows), summary
   `"Mon 6 Jul: 3 proposals, 4/5 actions cleared by the safety check"`, store the bundle, log
   actor "Coordinator" with the summary. Bundle `nearby_capacity` = list of the FarmCapacity dicts.

## 9. Mocks

`hub/mock_petals.py` (`PETAL_MODE=mock`, also the grid/flower fallback). Rationale gets
`" (Noting recent rejection: <last>)"` appended when `recent_rejections` is non-empty.
- Harvested: no cover crop → `sow_cover_crop` (0.8), but on a hail day or ≥ 10 mm rain →
  `defer_task` (0.7, "Wheat stubble too wet after 21.1 mm rain; drilling the cover crop once the soil dries."); else no action.
- Harvest-ready cereal: rain today < 2 mm **or** a hail warning is active → `harvest`
  (0.85 dry / 0.5 wet, reason "rapeseed ripe; dry day, ~117 t expected." / "Hail expected Wed
  8 Jul; harvesting ripe wheat now."); else `defer_task` (0.7, "wheat ripe but 6.2 mm rain
  today - too wet to harvest.").
- Cereal with 1 ≤ dth ≤ 3 → `scout` (0.7, "wheat ripening, 2 days to harvest; checking grain moisture.").
- Irrigable (potatoes): `projected = moisture − Σ(et0·kc) + Σ rain` over forecast[0:2]; if
  `projected < stress_threshold + 10`: `mm = clamp(round_to_5(90 − projected), 10, 25)`; if
  there are recent rejections ("fit to permit" mode): `mm = min(mm, floor(permit / (area·10)))`,
  skip if < 5. Reason mentions moisture and forecast. Also, if `disease_pressure ≥ 0.6` and not
  sprayed in the last 7 days → `spray` fungicide (0.7; Thorn may block it for weather).
- Nothing to do → no actions, rationale "Crop within normal range; no action needed." (0.6).

Designed demo moments (verify them!): normal day, River irrigates 25 mm = 6,000 m³ ≤ 6,500 →
allowed. During a heatwave it asks 25 mm again → 6,000 > 3,600 → **blocked** (RULE_WATER_PERMIT);
after a rejection it fits the permit (15 mm = 3,600 m³) → allowed. Hail warning → North and
West both ready next day → combine conflict → North kept, West gets `borrow_combine` from Gut
Rohrdommelsee, and the ~115 t storage surplus gets `deliver_to`.

`hub/mock_farms.py`: `can_share.combine = 1` if that farm's combine is available and it has no
ripe backlog, else 0; `can_share.storage_t = max(0, storage_free − 50)`, halved (floor) while a
scenario is active; confidence 0.85 (0.5 during a scenario); `valid_until = date_label(tick+1)`;
note e.g. "combine free, 470 t silo space". The own farm answers too (from its real state) but
the Machinery ring never borrows from itself.

## 10. Notices (`hub/notices.py`) — only from APPROVED plans

`generate(bundle, state) -> list[dict(audience, text)]`, stored as `{tick, date, audience, text}`
(newest last in state, `/notices` returns newest first, keep 30). Confidence label: ≥0.7 high,
≥0.4 medium, else low.
- harvest → Buyers: "Rapeseed harvest on West field today — about 117 t expected. Confidence: high."
- borrow_combine → <farm>: "Gut Rohrdommelsee: thanks for lending your combine for our West field (rapeseed) today."
- deliver_to → <farm>: "Gut Rohrdommelsee: expect about 115 t of rapeseed for storage today."
- spray → Beekeepers & neighbours: "Fungicide spraying on River field today — please keep hives and walkers away from the field edge."
- irrigate → Neighbours: "Irrigation running on River field today (25 mm) — the field track may be wet."
- sow_cover_crop → Neighbours: "Cover crop sown on North field after the wheat harvest."
- fertilize → Neighbours: "Fertilizer spreading on River field today."

## 11. Applying an approved plan (`HubState.apply_bundle`)

- irrigate: `soil_moisture = min(100, + mm)`, `last_irrigated_tick = tick`, history irrigation_mm.
- spray: `last_sprayed_tick = tick`, `disease = max(0.05, disease − 0.4)`.
- harvest / borrow_combine: `harvested = True`, stage "harvested", tonnes = yield_estimate_t;
  `stored = min(tonnes, storage_free)`; `storage_used += stored`; `pending_surplus_t += tonnes − stored`.
- deliver_to: `moved = min(tonnes, pending_surplus_t)`; neighbour `storage_used_t += moved`;
  `pending_surplus_t −= moved`. After all actions, any `pending_surplus_t` left → log "Farm":
  "sold 12 t directly to the co-op at the harvest spot price", reset to 0.
- sow_cover_crop: `cover_crop = True`, stage "cover crop". fertilize: `health += 0.02`.
  scout / defer_task: nothing.
- `recent_actions` = `[{"field", "kind": "harvest"|"irrigate"|"spray"|"deliver", "farm"?}]` for the UI animations.
- Reject: bundle status "rejected", reason stored; append the reason (or "rejected") to every
  field in the bundle's `recent_rejections` (keep 5). Log actor "Farm manager", level
  "decision": "approved the Mon 6 Jul plan" / "rejected the Mon 6 Jul plan: <reason>".
- `hint` on `/census/{field}` when any recent rejection mentions "neighbour farm":
  "The farm manager suggested a neighbour farm could help - propose the harvest as usual; the
  Machinery ring will line up a neighbour's combine or silo space if ours can't cope."

## 12. HTTP API (`hub/main.py`, FastAPI app title "MetaAgri Hub", port 8100)

| Method | Path | Returns |
|---|---|---|
| GET | /state | full twin state (below) |
| GET | /status | `{"tick_in_progress": bool, "mode": "mock"\|"flower"\|"grid"}` |
| GET | /census/{field} | FieldCensus (404 unknown field) |
| GET | /farms/{name}/census | FarmCensus (404 unknown farm) |
| POST | /proposals | 201 `{"ok": true}`; stores into `pending_flower_proposals[field]`; logs "proposal received: …" |
| POST | /farm-capacity | 201 `{"ok": true}`; stores into `pending_farm_capacity[farm]` |
| POST | /tick | advance one day, collect proposals + farm capacity, build the plan → bundle |
| POST | /scenario/heatwave | `{"ok": true, "scenario": <message>}` |
| POST | /scenario/hail | `{"ok": true, "scenario": <message>}` |
| GET | /inbox | pending bundles |
| POST | /decide | the updated bundle (404 unknown, 400 already decided/expired, 409 if an approved plan no longer passes the Safety check, e.g. after a heatwave cut the permit; the detail says why) |
| GET | /log | log entries newest first: `{tick, date, actor, text, level}` (level info\|warn\|block\|decision) |
| GET | /notices | notices newest first: `{tick, date, audience, text}` |
| GET | /history/{field} | `{"history": [{tick, date, soil_moisture_pct, crop_health, rain_mm, irrigation_mm, yield_estimate_t}], "projection": [{tick, date, projected_moisture_pct}] (3 days, forecast weather, no irrigation), "stress_threshold_pct": n}` |
| GET | /plans/{field} | last 3 plans touching the field: `[{bundle_id, plan_for, status, confidence}]` |
| GET | /history/farm/{name} | `{"history": [{tick, date, storage_free_t, avg_soil_moisture_pct, combine_available}]}` |
| GET | /farm-reports/{name} | last 3 reports: `[{plan_for, can_share, confidence, note}]` |
| POST | /reset | `{"ok": true}` — restart the season (optional `?seed=N`) |

One change at a time: `/tick`, `/reset`, `/scenario/*` and `/decide` share one lock and return
409 ("a day is already being planned; try again in a moment") while another holds it — a grid
tick runs for up to 90 s. `/proposals` and `/farm-capacity` stay unlocked (agents self-POST during a tick).

`GET /state`:
```json
{
  "tick": 0, "date": "Mon 6 Jul", "long_date": "Monday 6 July", "farm": "Hof Lerchenbruch", "region": "Oderbruch",
  "fields": {"North": {"name": "North field", "crop": "winter wheat", "emoji": "🌾", "area_ha": 42, "stage": "ripening",
             "days_to_harvest": 4, "harvest_ready": false, "harvested": false, "cover_crop": false,
             "soil_moisture_pct": 48.0, "stress_threshold_pct": 35, "irrigable": false, "crop_health": 0.86,
             "disease_pressure": 0.15, "yield_estimate_t": 327.6, "harvest_waiting_days": 0,
             "last_irrigated_date": null, "last_sprayed_date": null, "recent_rejections": [],
             "polygon": [[14.295, 52.6575], "..."]}, "West": {}, "River": {}},
  "weather_today": {"date": "Mon 6 Jul", "temp_max_c": 25.1, "rain_mm": 0.0, "wind_ms": 3.2, "et0_mm": 4.3, "humidity_pct": 62, "hail": false, "note": ""},
  "forecast": ["3 x Weather"],
  "resources": {"water_permit_m3": 6500, "water_permit_normal_m3": 6500, "workers": 5, "combine": 1, "sprayer": 1,
                "storage_capacity_t": 450, "storage_used_t": 120.0, "storage_free_t": 330.0},
  "scenario": null, "heatwave_days_remaining": 0, "hail_date": null,
  "farms": [{"farm": "Hof Lerchenbruch", "id": "lerchenbruch", "is_own": true, "lat": 52.655, "lon": 14.3,
             "crops": "wheat, rapeseed, potatoes", "area_ha": 96, "storage_capacity_t": 450, "storage_free_t": 330.0,
             "combine_available": 1, "avg_soil_moisture_pct": 50.5}, "... neighbours"],
  "farmyard": [52.6545, 14.299],
  "nearby_capacity": {"<farm>": {"FarmCapacity dict"}},
  "recent_actions": [{"field": "River", "kind": "irrigate"}], "recent_proposals": ["North", "West", "River"],
  "bundle_count": 0
}
```

**Agent modes** — copy the mechanics of `0f842b7:hub/hub/main.py` exactly, renamed:
`PETAL_MODE` = `mock` (default) | `flower` (sequential local SuperLink, petal self-POSTs to
`HUB_SELF_URL`, default `http://127.0.0.1:8100`) | `grid` (all 3 field agents + all 3 farm agents
concurrently in one ThreadPoolExecutor, `uv run flwr run . supergrid --stream --run-config ...`
in `agents/petal/` with the census inlined as `agent.census`, parse the last JSON object from
stdout, self-POST, 90 s timeout per agent, `start_new_session=True` + `os.killpg` on timeout,
fall back to the mock with a warn log — also when the launch itself fails, or the answer comes
back under another field/farm name; on a timeout the whole process group is killed and any answer
already printed is still used). `TICK_IN_PROGRESS` flag for `/status`.

## 13. Flower agent (`agents/petal/`)

Copy `0f842b7:agents/petal` and adapt; keep the exact Flower rules in CLAUDE.md (OpenAI
SDK with `FLWR_RUNTIME_BASE_URL`/`FLWR_RUNTIME_API_KEY`, `max_retries=0`, `client.responses.create(..., stream=True)`,
emit every event via `agent.events.emit(event.to_dict())`, MODEL = "openai/gpt-5.6-sol").
Run config: `agent.unit` = "North" | "West" | "River" | "FARM" (default "River"),
`agent.farm` (required for FARM), `agent.census` (inline JSON, SuperGrid path), `hub.url`
(default `http://127.0.0.1:8100`). Field mode fetches `/census/{field}` and posts `/proposals`;
FARM mode fetches `/farms/{farm}/census` and posts `/farm-capacity`. System prompts explain
the census, the action types, the resource costs (1 mm on 1 ha = 10 m³), and the Safety check
rules in plain words, ask for ONE JSON object, and include recent rejections. Parse failures →
a conservative empty Proposal / zero-capacity FarmCapacity (confidence 0.1). The answer's
`field` / `farm` is always set to the one that was asked, whatever the model wrote. Print the final
JSON as the last stdout line. `[project] name = "agri-petal"` (distinct FAB name from MetaHospital's petal).

## 14. Dashboard (`ui/app.py`, Streamlit, port 8601, `HUB_URL` default http://127.0.0.1:8100)

Port of `0f842b7:ui/app.py` (read it first; keep its structure, CSS approach, mock
fallback, 2 s autorefresh, fire-and-forget `/tick`). Dark theme, green/earth palette.
Pure SVG/HTML charts only (no altair / st.*_chart — broken on Python 3.14). pydeck maps.

Routing via query params:
- no `farm` → map page `?level=1|2|3`: 1 🌍 Earth (world, Germany outline), 2 🇩🇪 Germany
  (Oderbruch dot in Brandenburg), 3 🌾 Oderbruch (the 3 farms as points coloured by status,
  tooltip: storage free · combine · soil moisture; click or card button → farm). Breadcrumb
  buttons, "Go to Germany ➜" / "Go to Oderbruch ➜", smooth `transition_duration`.
- `?farm=lerchenbruch` → full farm dashboard; `?farm=rohrdommelsee|oderblick` → lighter neighbour view.
- `?field=North|West|River` (inside the own farm) → field detail.

Status colour for a farm (map dot, strip card): red if avg soil moisture < 35 or storage > 95 %
full, amber if < 45 or > 85 %, else green.

**Farm dashboard** (own farm):
- Top bar: "🌾 MetaAgri · Hof Lerchenbruch", date metric (long_date), ⏭ Next day, 🔥 Heatwave,
  ⛈️ Hail warning, 🔄 Restart season, badges "synthetic data" + "Agents: Flower SuperGrid|simulated".
- Banners: "🧠 Field agents are thinking… (n/3 done)" while a tick runs; one red/amber banner per
  active scenario. "← Back to Oderbruch".
- Weather strip: today + 3-day forecast cards (icon ☀️/🌤️/🌧️/⛈️/🔥, temp, rain, wind; hail
  day highlighted red).
- Resource strip: Water permit today (m³, red if cut), Workers, Combine, Sprayer, Silo (free / capacity bar).
- Hero row, two columns: (a) **hero flower** SVG (port `build_hero_svg`): one petal per field,
  size ∝ √area, colour by soil moisture vs stress threshold (rust < threshold, amber near,
  green comfortable), golden if harvested, light green if cover crop; pulse when below the
  stress threshold; shake when a hail warning is active and the field is ripe & unharvested;
  centre shows the date and 🧑‍🌾; stem grows a red thorn per Safety-check block today;
  animations from `recent_actions`: grain dot travels petal → centre (silo) for a harvest,
  💧 falls onto the petal for irrigation; petal click → `?field=X`. (b) **field map**: pydeck
  PolygonLayer of the three `polygon`s, same colours, tooltip (crop, stage, moisture, yield),
  farmyard point; click a field → `?field=X`.
- Farm strip: one card per farm (own first) — dot, name, storage free, combine free/busy, moisture.
- Field detail (selectbox "Field detail (or click a petal / field)" fallback + `?field`):
  SVG chart of soil moisture history + dashed 3-day projection + dashed stress-threshold line;
  crop health / disease / yield estimate; last 3 plans for the field.
- Three columns: **Fields** tiles (emoji, crop, stage, moisture bar with threshold tick, health,
  disease, "ready to harvest" / "N days to harvest", yield estimate) · **Team conversation**
  (log, newest first, icons: 🛡️ block, ✅ approved, ❌ rejected, 🧭 Coordinator, 🚜 Machinery
  ring / farm names, 💧 irrigation, 🌾 harvest) · **Inbox** plan cards ("🧭 Plan for Tue 7 Jul",
  resource line "Water 6,500→500 m³ · Workers 5→2 · Combine 1→0 · Silo free 330→2 t", plan table
  Field | Crop | Action | Resources | Confidence bar | Reason, overall confidence with amber
  "low confidence — review carefully" < 0.5, summary, "🛡️ Safety check blocked:" lines,
  "🚜 Neighbour help" section listing each farm's can_share when the plan has borrow_combine
  or deliver_to, ✅ Approve / ❌ Reject with reason dropdown).
- Reject reasons: "Not enough workers for this", "Soil too wet to drive on", "Wait for better
  weather", "Wrong priority order", "A neighbour farm should help with this", "Other (type a
  reason)" + caption "Your reason is sent back to the field agents and shapes their next plan."
- Bottom: "📣 What buyers & neighbours see" expander, notice cards with audience chip and date.

**Neighbour farm view**: ← Back to Oderbruch, tiles (storage free / capacity, combine, soil
moisture, crops), SVG chart of storage free + soil moisture since Mon 6 Jul, last 3 reports from
its agent, caption "Detailed twin available for Hof Lerchenbruch in this demo."

If the hub is unreachable, render with built-in mock data and a warning banner — never crash.

## 15. Verification bar

- `cd hub && uv run pytest -q` green: every Thorn rule (allowed and blocked case), conflict
  resolution, Machinery-ring suggestions + Thorn pass 2, water balance, scenarios, decide
  approve/reject/expired, all endpoints (TestClient), and the three designed demo moments
  above with fixed seeds (and a sweep over ≥ 20 seeds reporting how often each moment occurs).
- `cd ui && uv run python -c "from streamlit.testing.v1 import AppTest; ..."` renders every
  route without exceptions, both with the hub up and down.
- `cd agents/petal && uv run flwr build` succeeds; parsing helpers tested on sample model output.
- Real SuperGrid runs are **not** part of automated verification (they need the user's login).

## 16. Deliberate deviations (recorded at integration)

Where the code knowingly differs from sections 1-15 above. Everything else matches this file.

**hub/**
- `stem.build_bundle` sets `state.nearby_capacity = farm_capacity` *before* conflict resolution
  and Thorn pass 1, not at step 4. Otherwise a field agent's own `borrow_combine` / `deliver_to`
  (e.g. from a real model in grid mode) would be checked against yesterday's answers, or none on
  day one. MetaHospital has the same latent ordering bug. The log order is unchanged (proposals,
  conflict, pass-1 blocks, farm capacity lines, Machinery ring).
- `sim.step` runs the heatwave countdown right after `tick += 1`, before the weather roll (not in
  step 7), so the day appended to the forecast knows whether the heatwave still covers it.
  Outcome as specified: heatwave days t0..t0+3, permit back and "heatwave over" logged on t0+4,
  double ripening only on heatwave days. The hail check stays after the field update.
- Grid mode inlines the census as a single-quoted TOML literal, and Flower's parser
  (`'[^']*'`) cannot carry a `'`, so any apostrophe (a free-text rejection reason) is sent as the
  JSON escape `'`, which the petal's `json.loads` decodes. Farm capacities come back in
  `FARM_NAMES` order (own farm first), not thread-completion order, so logs are deterministic.
- An approved `borrow_combine` also produces the Buyers harvest notice (section 6: it *is* a
  harvest of that field), in addition to the "<farm>: thanks for lending your combine..." notice.
- `harvest_ready` = `days_to_harvest <= 0 and not harvested`. `fertilize` on approval: health
  +0.02, clamped to the sim's 0.95 maximum.
- `/farms/{name}/census`, `/history/farm/{name}` and `/farm-reports/{name}` accept the farm id
  (`lerchenbruch` / `rohrdommelsee` / `oderblick`) as well as the full name. Unknown names still 404.
- Details section 5/9/11 leave open: a neighbour's `ripe_backlog_ha` is 0, except a
  `cereal_heavy` farm during a hail warning (`area_ha × 0.25`). Our own combine shows busy (0) in
  `/state` and `FarmCensus` after an approved harvest that day. A leftover `pending_surplus_t`
  below 0.5 t is rounding noise, not a sale (same threshold as the ring's smallest delivery). A reject without a reason logs "rejected the ...
  plan" (no ": None"). The Machinery ring warns when neighbours can't store the whole surplus.
  The mock River irrigate confidence is 0.8 (0.75 when fitted to the permit). Potato hail damage
  is logged as "Hail hit River field: potato leaves shredded, crop health down 0.08".

**agents/petal/**
- `_parse_capacity`'s conservative fallback uses `valid_until` = the next day's label (computed
  from the census `date`, `_next_date_label`), and the farm prompt gives the model that exact
  label. The petal hardcodes the three farm names for its prompt, since it must not import the hub
  and `FieldCensus` carries no neighbour names.
- The field prompt tells the model to leave `borrow_combine` / `deliver_to` to the Machinery ring,
  even when the census `hint` mentions neighbour help (the hint says to propose the harvest as
  usual). Field agents never see farm capacity; if a model proposes neighbour actions anyway, the
  hub counts them (the ring starts from their usage) and Thorn checks them like any other.

**ui/**
- The hero panel renders with `st.iframe` (falling back to `components.html` on older
  Streamlit; 1.64 deprecates the latter). The petal click creates and clicks a link in the parent
  document, because the iframe sandbox has no `allow-top-navigation` and setting
  `window.parent.location` throws.
- The level-3 map is centred on the midpoint of the three farms (zoom 10.1) rather than
  `REGION_COORD`, which stays the level-2 Oderbruch dot, so no farm sits on the map edge.
- The hero animates all four `recent_actions` kinds (harvest, irrigate, spray: mist ring,
  deliver: grain dot leaving to the right). UI-only extras: a grey Berlin reference dot on level
  2, our field polygons on level 3, a colour legend, rain/irrigation bars and a shaded stress band
  in the moisture chart, a combine dot per day in the neighbour chart. In mock mode (hub down) the
  field-detail and neighbour views render mock history/plans/reports of the same shapes.

**Demo choreography (DEMO.md)**: the three section-9 moments are run as three acts with a
🔄 Restart season before the hail act. In one continuous season the heatwave's double ripening
makes North and West ripe together two days after the heatwave starts, so the combine conflict
would appear without any hail warning. Pressing the hail warning before River's permit-fitted
re-plan instead removes River's need to irrigate (the forecast hail-day rain). The test suite
(`tests/test_demo_moments.py`) runs the moments the same way, with a reset before the hail.

**After the review round** (adversarial review of hub logic, Flower/grid plumbing with realistic
LLM output, the live dashboard, and demo/docs/domain credibility; every change has a regression
test): feasibility-aware conflict resolution, the neighbour-help pass counting the field agents'
own neighbour actions, the three new rules above, the one-change-at-a-time lock, a Safety-check
re-run on approve, a delivery never moving more than the neighbour's real free space (the rest is
sold and logged), launch-failure / timeout / wrong-name fallbacks in grid mode, a string-aware
JSON extractor, and the dashboard fixes (reject "Other" without text sends nothing, all four
day/scenario buttons disabled while a day is planned, two-row top bar, distinct harvested colour,
hub refusals shown in plain words). Farm names were changed to fictional ones (the original two
belonged to real businesses).
