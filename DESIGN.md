# MetaAgri design

How the twin works: the levels, the roles and what crosses each boundary, how a page is put
together, then the engine's rules, numbers and texts. The code is the source of truth
(`web/src/ui/levels.js` and `roles.js` for the level model and the lens, `web/src/engine/`
for the simulation); this file is its summary, and [docs/CONCEPT-v2.md](docs/CONCEPT-v2.md)
is the concept it implements (v2.0 in section 7, the owner's decisions in section 8). If code
and docs disagree, fix one of them deliberately.

## 1. Concept

MetaAgri is a twin of how farm information moves, from the world down to one field. Each
level has a real-world user, and the page at that level shows only what that user needs and
may see. Above the farm the numbers are real published figures (`web/data/real.json`); at the
farm and field they come from the seeded simulation of three fictional farms in the Oderbruch:
**Hof Lerchenbruch** (the farm the demo follows), **Gut Rohrdommelsee** and **Agrarhof
Oderblick**. The two kinds never share a tile, every number carries a provenance badge, and
no simulated number is drawn on a real parcel or next to a real farm's or company's name.

It is MetaHospital's design moved to farms; [docs/SHARED-SPEC.md](docs/SHARED-SPEC.md) is the
written spec both twins follow, and README.md has the mapping table.

## 2. Levels and routes

Seven levels (`LEVEL_ORDER` in `levels.js`). The UI shows level names, never numbers or map
scales. Routes are plain hash tokens, because the claude.ai artifact viewer drops anything
else.

| Level | Route | View | The question the page answers | Numbers |
|---|---|---|---|---|
| World | `#world` (`#earth` redirects) | `world.js` | How many farms feed the world, how is the land shared, and how much depends on irrigation? | Official, Estimated |
| EU | none yet | (breadcrumb only) | Its figures appear on the Country page | Official |
| Country | `#germany` | `country.js` | How big are Germany's farms, how much land is watered, and how does Brandenburg compare? | Official |
| Land | none yet ("coming in v2.1") | (breadcrumb, and the Brandenburg card on Country) | | Official |
| District | `#oderbruch` | `district.js` | Which farms need help today, and who can lend it? | Simulated (the demo farms), plus Official and Estimated in their own tiles and "Real context" strip |
| Farm | `#lerchenbruch`, `#rohrdommelsee`, `#oderblick` | `farm.js` | What should we do today? (our farm) / What does this farm offer the network today? (a neighbour) | Simulated |
| Field | `#lerchenbruch.north`, `.west`, `.river` | `field.js` | What does this field need next? | Simulated |

An empty or unknown hash opens the current role's home (Germany for the default Federal
ministry lens). Only our own farm has fields. Each level's KPI labels come from
`LEVELS[key].kpis`, so the tiles and the level model cannot drift apart.

## 3. Who uses each level, and what crosses its boundary

`levels.js` holds one record per level with the same fields as MetaHospital's: `name`,
`user`, `decides`, `up` + `upBasis`, `peers` + `peersBasis`, `never` + `neverBasis`,
`cadence` and `kpis` (1 to 5 tile labels). `test/levels.test.js` fails if a level misses a
field or a legal basis. EU and Land have `route: null` and a `pending` reason.

Farm data does not travel up one pipe. `CHANNELS` lists the six real channels, each a chain
of authorities from the farm upward with its legal basis: subsidies and compliance, water,
animal health, plant health, statistics and markets, and voluntary sharing (with neighbours,
the machinery-sharing network and buyers). Each level notes what the channels passing through
it carry. The panel "Who uses this level, and what crosses its boundary" at the foot of every
page shows the level's record, its ladder, and its channels with this level's hop
highlighted. The legal bases were written from the concept and from memory; the owner should
spot-check them before relying on them.

## 4. "Viewing as": the role lens

A static site cannot enforce access, so a role is a lens, not a login (`roles.js`). Four
roles for v2.0, each with a home level:

| Role | Home | World | Country | District | Farm | Field |
|---|---|---|---|---|---|---|
| Global crop analyst (FAO · AMIS · GEOGLAM) | World | full | totals | not shown | not shown | not shown |
| Federal ministry (BMLEH, the default) | Country | totals | full | totals | not shown | not shown |
| District & sharing network | District | totals | totals | full | totals | not shown |
| Farm manager (Hof Lerchenbruch) | Farm | totals | totals | totals | full | full |

"Totals" means aggregates, status bands, public orders and voluntary offers only. What a lens
may not see is replaced by a "Not shown" box (`notShown()`) that says why and who would see
it; those boxes are how the sharing hierarchy becomes visible. Examples: the ministry sees the
District's totals but not the farm-by-farm table or the farm pins; the district role sees our
farm's public status, offers, water permit and notices but not its plan, fields or log; the
farm manager sees a neighbour only through its offers. "Follow the farm manager" (in the
Viewing as menu, in the app bar on wide screens, and on the Country, District and hidden
farm pages) switches to the farm lens and opens Hof Lerchenbruch. The chosen role is kept in
this browser's storage only.

## 5. Page anatomy, badges and status words

Every page is built from `page.js` in the same order: page head (level and place, the
question as the H1, a line on what it shows, "May see", one status pill, provenance and
freshness), five KPI slots, a main column and a rail (Needs attention or the plan, Shared
with me, Shared by me), the levels panel, and **Data & sources**. The app bar (`shell.js`)
carries the breadcrumb of places with the level name under each, "Viewing as", and the
Simulation drawer (Next day, Play, speed, Restart season; Heatwave and Hail warning only on
District, Farm and Field; "About this demo" with the seed and the data state). An active
scenario shows once, as a strip marked Simulated under the app bar, on District, Farm and
Field only.

Badges (`prov()`): **Live** (not used yet), **Official** (a published statistic),
**Estimated** (a machine-learning output or our own calculation from open data),
**Simulated** (the seeded twin, fictional farms only), **Illustrative** (what a flow would
look like; nothing behind it), **Not shown** (exists, but not for this lens), **Unknown** (no
data; never shown as 0), plus **Rule** for the rule-based agents.

Status words (`status.js`), always as shape + word + colour: crop condition from GEOGLAM
(Exceptional, Favourable, Watch, Poor, Out of season, No data), drought from the European
Drought Observatory (Watch, Warning, Alert), and farm operations (On track, Needs decision,
Blocked by safety rules). A farm's crop condition comes from its average soil moisture (Poor
below 35 %, Watch below 45 %); a field's from its own stress line, health and disease risk
(`fieldCondition()`). Confidence is shown as high (0.7 or more), medium (0.4 or more) or low,
with the score in a tooltip.

## 6. Real data

`web/data/real.json` holds the hand-curated figures for v2.0, one record per key of
`REAL_KEYS` in `src/data/real.js`: `{value, unit, label, kind, source, url, licence, asOf,
note}`, checked against each source on 13 October 2026. Views read them with `realValue()`; a
missing key or file shows Unknown, never 0, and the pages render first and fill in the real
figures once the file has loaded. `web/data/LICENSES.md` lists every source's licence; the
FAO SOLAW report and the Open-Meteo free tier are non-commercial. A scheduled refresh
(`tools/build-data.mjs`) is planned for v2.1.

## 7. How the pages word the engine

The engine's texts are unchanged from v1; the views rewrite them into plain words
(`plainLog()`, `plainReason()` and `plainActor()` in `farm.js`):

| Engine | Page |
|---|---|
| `proposed 2 action(s): ...` | proposes 2 actions: ... |
| `(confidence 0.85)` | (confidence high) |
| `Blight pressure 0.64` | Blight risk high (64/100) |
| `crop health down 0.08` | crop health down 8 points (of 100) |
| `(Noting recent rejection: Wait for better weather)` | Remembers your reason: “Wait for better weather” |
| `fitted to today's 3,600 m³ water permit` | Fitted to today's 3,600 m³ water permit. (under the plan row) |
| actor `Machinery ring` | Sharing network |
| `cleared by the safety check` | passed the safety rules |
| ET₀ (reference evapotranspiration, in the field state) | crop water use in mm/day, with a glossary tip |

A farm's silo offer is the morning's report. When an approved harvest has filled the silo
since, the pages show only what is free now ("Can lend 0 t now; this morning's offer was
140 t"), never more on offer than is free.

## 8. The farm

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

## 9. Simulation (`sim.js`, `weather.js`)

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

## 10. Field agents (`planners.js`)

Each field agent sees only its field's readings (`twin.census(field)`): the field, today's
weather, the forecast, today's resources, the farm manager's last rejections and an optional
hint. In order:

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
the readings that the Machinery ring can line up a neighbour's combine or silo space.

## 11. Farm agents (`farms.js`)

Every farm answers from its own readings (`twin.farmCensus(farm)`): it can share its combine
if the combine is free and it has no ripe crop of its own waiting, and its free silo space
minus a 50 t reserve (halved while a scenario is active). Confidence 0.85, or 0.5 during a scenario; valid until tomorrow.
Note, e.g. "combine free, 520 t silo space". The Machinery ring never borrows from our own
farm.

## 12. Coordinator and Machinery ring (`coordinator.js`)

The engine's name is "Machinery ring"; the pages call it the sharing network (section 7).

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

## 13. Safety check (`safety.js`)

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

## 14. Approving, rejecting and notices (`twin.js`, `state.js`, `notices.js`)

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

## 15. Twin API

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
