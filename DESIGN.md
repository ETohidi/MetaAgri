# MetaAgri design

How the twin works: the concept, the five levels, and the engine's rules, numbers and texts.
The code is the source of truth (`web/src/engine/`); this file is its summary. If they
disagree, fix one of them deliberately.

## 1. Concept

A digital twin of one arable farm, **Hof Lerchenbruch**, in the Oderbruch (Brandenburg), and
its two neighbours, **Gut Rohrdommelsee** and **Agrarhof Oderblick**. All three names are
fictional; every number is simulated. It is MetaHospital's architecture moved to a farm (see
the mapping table in README.md).

One step is one day. The season starts on Monday 6 July 2026. Each day:

1. The **simulation** rolls the weather and updates every field and neighbour farm.
2. The **North, West and River field agents** each propose the day's work from their field's
   census.
3. Every **farm agent** (ours included) tells the **Machinery ring** what it can share today.
4. The **Coordinator** bundles the proposals into one plan, settles machine conflicts, runs
   the **Safety check**, and adds the Machinery ring's neighbour help.
5. The plan waits for the **Farm manager** (the person using the page). Approving applies it
   and sends notices to buyers and neighbours; rejecting sends the reason back to the field
   agents. An undecided plan expires when the next day starts.

All agents are rule-based and deterministic; there is no model call. Human-facing names in
the log and the views: "Farm" (the twin itself), "North field agent", "West field agent",
"River field agent", "Coordinator", "Safety check", "Machinery ring", "Farm manager" and the
farm names. A "plan" is a bundle. The tick counter is never shown to a person, only dates
("Mon 6 Jul", "Monday 6 July").

## 2. Levels and routes

Routes are plain hash tokens, because the claude.ai artifact viewer drops anything else.
Unknown tokens fall back to Earth.

| Level | Route | View | What it shows |
|---|---|---|---|
| 1 | `#earth` | `maps.js` | World map; Germany highlighted, a pin at the Oderbruch |
| 2 | `#germany` | `maps.js` | German states, Brandenburg highlighted, the Oderbruch pin, Berlin for orientation |
| 3 | `#oderbruch` | `maps.js` | The three farms (pins by area and status), the Machinery-ring reports on dashed lines, borrow / deliver flows while a plan asks for them, our fields in an inset, one card per farm |
| 4 | `#lerchenbruch` | `farm.js` | Our farm: weather and forecast, resources, the flower (one petal per field), field map, field tiles, the plan with Approve / Reject, team conversation, notices |
| 4 | `#rohrdommelsee`, `#oderblick` | `farm.js` | A neighbour: silo, combine, soil moisture, history chart, its latest reports |
| 5 | `#lerchenbruch.north` / `.west` / `.river` | `field.js` | One field: soil-moisture chart with a 3-day projection, the crop now, map, recent plans, rejections, the agent's census |

Only our own farm has fields. Farm status (map pins, cards): **Critical** below 35% average
soil moisture or a silo more than 95% full, **Watch** below 45% or more than 85% full, else
**Normal**.

## 3. The farm

| Field | Crop | Area | Days to harvest | Soil moisture | Irrigable | Yield | Health | Disease |
|---|---|---|---|---|---|---|---|---|
| North | winter wheat 🌾 | 42 ha | 4 | 48% | no | 7.8 t/ha | 0.86 | 0.15 |
| West | rapeseed 🌼 | 30 ha | 3 | 44% | no | 3.9 t/ha | 0.84 | 0.10 |
| River | potatoes 🥔 | 24 ha | 48 | 62% | yes | 42 t/ha | 0.90 | 0.35 |

| Crop | Crop coefficient kc | Stress below | Price | Combinable | Yield loss per day ripe and standing |
|---|---|---|---|---|---|
| winter wheat | 0.45 | 35% | €220/t | yes | 1% |
| rapeseed | 0.40 | 30% | €460/t | yes | 2% |
| potatoes | 1.10 | 60% | €160/t | no | 0% |

kc is 0.2 on bare stubble and 0.5 under a cover crop. Soil moisture is % of plant-available
water (100 mm, so 1 mm of rain or irrigation = 1%).

Our resources each day: water permit 6,500 m³ (3,600 m³ during a heatwave), 5 workers, 1
combine, 1 sprayer, a 450 t silo (120 t used at the start). 1 mm on 1 ha = 10 m³.

Neighbours: Gut Rohrdommelsee (maize, sugar beet, 310 ha, 900 t silo with 380 t used, combine
busy 10% of days, 52% soil moisture) and Agrarhof Oderblick (wheat, rapeseed, barley, 240 ha,
600 t silo with 420 t used, combine busy 60% of days, cereal-heavy, 45% soil moisture).

## 4. Simulation (`sim.js`, `weather.js`)

**Weather** is the same for all three farms. A 3-day forecast is generated ahead and is
exactly what then happens.

- Normal day: 21-29 °C; rain 0 mm (65%), 0.5-4 mm (20%) or 5-14 mm (15%); wind triangular
  1-8 m/s (mode 3); ET₀ = clamp(3.0 + (temp − 20) × 0.25 − rain × 0.05, 2.0, 5.5); humidity
  50-85% (+10 on a rainy day, max 95).
- Heatwave day: 33-37 °C, no rain, wind 1.5-4 m/s, ET₀ 6.8-7.8 mm, humidity 30-45%.
- Hail day: 27 °C, 18-30 mm rain, wind 12-16 m/s, ET₀ 3.0, humidity 90%.

**Each day**, for every field:
1. Soil moisture += rain − ET₀ × kc, clamped to 0-100. Irrigation is added when a plan is
   approved.
2. Ripening (unharvested): days to harvest −1, or −2 for cereals during a heatwave. A ripe
   cereal left standing loses its daily yield loss.
3. Health: below the stress line −(0.015 + 0.003 per point below), else +0.004; −0.02 more
   while disease > 0.7; clamped to 0.2-0.95.
4. Disease: potato blight +0.07 on a day with ≥ 3 mm rain or ≥ 80% humidity (×0.3 within 7
   days of a spray), −0.02 on a hot (≥ 30 °C) dry day; cereals ±0.01 noise.
5. Yield estimate = area × yield per ha × min(1, health / 0.85). Stage: "grain fill",
   "ripening" (≤ 7 days), "harvest-ready", "harvested", "cover crop" for cereals; "tuber
   bulking" or "maturing" (≤ 14 days) for potatoes.

Neighbours drift: silo use +0-25 t a day, the combine is busy with the farm's own
probability (always busy for the cereal-heavy farm during a hail warning), soil moisture +=
rain − ET₀ × 0.9 + 2, clamped to 10-95.

**Heatwave** (`twin.heatwave()`): the permit drops to 3,600 m³ at once, today and the next 3
days become heatwave days, and cereals ripen twice as fast while it lasts. Log: "Heatwave for
4 days: the water authority cut the permit to 3,600 m³/day". On day 5 the permit returns.

**Hail warning** (`twin.hail()`): severe hail the day after tomorrow; tomorrow is made dry and
calm, and every unharvested cereal within 4 days of harvest becomes ripe tomorrow. On the hail
day every standing cereal within 4 days of harvest loses 40% ("Hail hit North field: winter
wheat lost 40%") and the potatoes lose 0.08 health ("Hail hit River field: potato leaves
shredded, crop health down 0.08").

Both scenarios can be active at once; pressing one again while it is active changes nothing.

## 5. Field agents (`planners.js`)

Each field agent sees only its census (`twin.census(field)`): the field, today's weather, the
forecast, today's resources, the farm manager's last rejections and an optional hint. In
order:

- **Harvested, no cover crop:** sow one (0.8), unless today has hail or ≥ 10 mm rain: then
  wait ("Wheat stubble too wet after 24.0 mm rain; drilling the cover crop once the soil
  dries.", 0.7).
- **Ripe cereal:** harvest if today is dry (< 2 mm, 0.85) or hail is forecast (0.5); else wait
  ("wheat ripe but 24.0 mm rain today - too wet to harvest.", 0.7).
- **Cereal 1-3 days from ripe:** scout ("rapeseed ripening, 3 days to harvest; checking seed
  moisture.", 0.7).
- **Irrigable field (River):** project soil moisture 2 days ahead without irrigation. If it
  heads within 10 points of the stress line, irrigate towards 90%: rounded to 5 mm, 10-25 mm
  (0.8). After any recent rejection the agent fits the depth to today's permit (0.75) and
  skips passes under 5 mm. It also proposes a fungicide spray at disease ≥ 0.6 with no spray
  in the last 7 days (0.7).
- Otherwise: "Crop within normal range; no action needed." (0.6).

A rationale ends with "(Noting recent rejection: <last reason>)" while the field has recent
rejections (the last 5 are kept). A rejection that mentions "neighbour farm" adds a hint to
the census that the Machinery ring can line up a neighbour's combine or silo space.

## 6. Farm agents (`farms.js`)

Every farm answers from its own census: it can share its combine if the combine is free and
it has no ripe crop of its own waiting, and its free silo space minus a 50 t reserve (halved
while a scenario is active). Confidence 0.85, or 0.5 during a scenario; valid until tomorrow.
Note, e.g. "combine free, 520 t silo space". The Machinery ring never borrows from our own
farm.

## 7. Coordinator and Machinery ring (`coordinator.js`)

1. Log each proposal ("proposed 1 action(s): ...").
2. **Conflicts:** when more than one field wants the combine (harvest) or the sprayer (spray)
   and could pass the Safety check alone, keep the field with the most value at risk (yield ×
   price; × disease pressure for a spray) and drop the others: "conflict: the combine was
   requested by North field and West field; kept North field (€71k at risk vs €52k), West
   field waits".
3. **Safety check, pass 1** on the field agents' actions; every block is logged.
4. Record each farm's answer ("can share 1 combine / 470 t storage until Tue 7 Jul
   (confidence 0.85). ...") and "compiled spare capacity from 3 farms".
5. **Machinery ring:** a ripe field that lost the combine gets `borrow_combine` from the
   neighbour with a free combine (highest confidence, then most storage); if not, "no
   neighbour combine free today; West field waits". Grain that won't fit in our silo today
   gets `deliver_to` actions to neighbours with space (rounded to 0.1 t, none under 0.5 t);
   if they can't take all of it, "neighbours can't store all of it; about N t would be sold
   directly at the harvest spot price". The ring's actions go in one proposal whose rationale
   starts "Machinery ring:", and through **Safety check pass 2**.
6. One plan row per cleared action, overall confidence = the lowest row's (the plan card
   warns below 0.5), resources before and after, and the summary "Tue 7 Jul: 4 proposals,
   3/3 actions cleared by the safety check".

## 8. Safety check (`safety.js`)

Deterministic; checked in a fixed order (harvests and borrowed combines first, then
irrigation for the driest field first, spraying, fertilizing, cover crops, the rest). Usage
accumulates; an action that would exceed a limit is blocked and uses nothing. The rule texts:

- "Every proposal needs a non-empty rationale and 0 <= confidence <= 1."
- "irrigate needs mm > 0, fertilize needs kg_n_ha > 0, deliver_to needs tonnes > 0."
- "Irrigation must stay within today's water permit."
- "Only fields with irrigation equipment can be irrigated."
- "No spraying when wind > 5 m/s or > 5 mm rain is forecast for tomorrow."
- "No spraying within 14 days of harvest (pre-harvest interval)."
- "Harvest only ripe, unharvested crops on a dry day (< 2 mm rain)."
- "Each machine can work one field per day."
- "Never plan more work than workers available today."
- "No fertilizing on waterlogged soil (> 90%), before heavy rain (> 10 mm tomorrow), or on harvested fields."
- "borrow_combine and deliver_to need a named neighbour farm."
- "Blocked: that farm reports no spare capacity for this."
- "Cover crops can only be sown on a harvested field without one."
- "deliver_to can only move grain that won't fit in our silo today."

Costs: harvest = combine + 2 workers; borrow_combine = the neighbour's combine + 1 worker;
spray = sprayer + 1 worker; irrigate = 1 worker + mm × area × 10 m³; fertilize and
sow_cover_crop = 1 worker; scout, wait and deliver_to cost nothing.

Approving re-runs the check against the farm as it is now. If a scenario made the plan
illegal since it was built, the approval is refused: "This plan no longer passes the safety
check: irrigate for River field: Irrigation must stay within today's water permit. Reject it
so the field agents re-plan."

## 9. Approving, rejecting and notices (`twin.js`, `state.js`, `notices.js`)

Approve: irrigation adds its millimetres to soil moisture; a harvest (own or borrowed
combine) fills our silo and any surplus waits for the plan's deliveries, which move it to the
neighbour's silo; what is still left is "sold N t directly to the co-op at the harvest spot
price". A spray cuts disease by 0.4; a cover crop is sown; our combine is busy for the rest
of the day after a harvest. Log: "Farm manager: approved the Mon 6 Jul plan".

Notices (approved plans only; the last 30 are kept; confidence high ≥ 0.7, medium ≥ 0.4):
- Buyers: "Winter wheat harvest on North field today — about 324 t expected. Confidence: high."
- <neighbour>: "Gut Rohrdommelsee: thanks for lending your combine for our West field (rapeseed) today."
- <neighbour>: "Gut Rohrdommelsee: expect about 108 t of rapeseed for storage today."
- Beekeepers & neighbours: "Fungicide spraying on River field today — please keep hives and walkers away from the field edge."
- Neighbours: "Irrigation running on River field today (25 mm) — the field track may be wet."
- Neighbours: "Cover crop sown on North field after the wheat harvest."
- Neighbours: "Fertilizer spreading on River field today."

Reject: the reason (or "rejected") goes to every field in the plan. Log: "Farm manager:
rejected the Tue 7 Jul plan: Wait for better weather". The six reasons on the page: "Not
enough workers for this", "Soil too wet to drive on", "Wait for better weather", "Wrong
priority order", "A neighbour farm should help with this", "Other (type a reason)".

## 10. Twin API

`web/src/engine/types.js` documents every shape and the Twin API: `new Twin({ seed,
firstPlan })`, `tick()`, `heatwave()`, `hail()`, `decide(id, "approve" | "reject", reason)`,
`reset()`, `snapshot()` and the queries (`census`, `farmCensus`, `fieldHistory`,
`fieldPlans`, `farmHistory`, `farmReports`, `inbox`, `bundles`, `log`, `notices`). Views only
read the snapshot and the queries and change the twin only through the commands. The default
seed is 20260707.

## Deliberate deviations from the Python version

The engine is a port of the Python hub at commit `a6c825d` (`hub/hub/*.py`). Replaying the
hub with the browser rng's random stream gives identical results (snapshot, plans, log,
notices, histories) for 43 seeds over a 97-step script. Where it differs on purpose:

- **Random numbers:** a seeded mulberry32 generator instead of Python's `random`, so a given
  seed is a different season than in Python. Python's rounding (half to even) is kept.
- **First plan at load:** the plan for Monday 6 July exists when the page opens
  (`firstPlan`), so every date in the demo is one day earlier than in the Python DEMO.md.
- **Heatwave while one is on** changes nothing; Python restarted the 4-day countdown.
- **Log** keeps the last 2,000 entries (Python's was unbounded).
- **No HTTP layer:** no endpoints, no request validation and no one-change-at-a-time lock
  (the browser engine runs in one thread). `decide` throws an `Error` with the hub's messages
  instead of HTTP 404/400/409.
- **No model-backed agents:** the field and farm agents are the hub's rule-based mock agents;
  the Flower "flower" and "grid" modes are gone. Field and farm arguments also accept route
  ids (`north`, `rohrdommelsee`).
