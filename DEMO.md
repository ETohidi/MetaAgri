# MetaAgri demo (5 minutes)

## Start

```bash
METAAGRI_SEED=0 scripts/demo.sh mock   # or: scripts/demo.sh grid
```

This starts the farm twin (`hub/`, `PETAL_MODE` set from the argument) and the Streamlit
dashboard, and prints their URLs (hub: http://127.0.0.1:8100, dashboard:
http://127.0.0.1:8601, our farm directly: http://127.0.0.1:8601/?farm=lerchenbruch). Open the
dashboard. `METAAGRI_SEED=0` makes the season reproducible: every **🔄 Restart season** reuses
seed 0, so the numbers below are exactly what you will see. Without it every season is random,
and the story still happens in most of them (see "Verified").

The dashboard shows human-friendly names straight from the hub: "Coordinator" and "Safety
check" are what the code calls Stem and Thorn; "North/West/River field agent" is a field's
petal; "Farm" is the hub itself; "Machinery ring" is the neighbour-help step; the "Farm
manager" is you; a "plan" is a bundle. One step is one day and the season starts Monday 6 July
2026; the internal tick counter is never shown, only dates.

In `grid` mode the "synthetic data" badge stays, but the top bar's "Agents:" badge reads
"Flower SuperGrid" instead of "simulated", and a blue **"🧠 Field agents are thinking… (n/3
done)"** banner appears (and **⏭ Next day** is disabled) while a day waits on the real agent
subprocesses, up to 90 s per agent if one doesn't answer.

## Choreography

Each step names the dashboard action and, in `()`, the equivalent curl call if you're driving
the hub directly instead (`H=http://127.0.0.1:8100`).

**Zoom in (levels 1-4).** The dashboard opens on 🌍 Earth. Click **Go to Germany ➜** (the
Oderbruch dot in Brandenburg), then **Go to Oderbruch ➜**: three farms coloured by status
(silo fill, soil moisture), tooltips with silo free · combine · soil moisture. Click **Hof
Lerchenbruch** (a map dot or the card button below the map). (`curl $H/state`)

### Act 1: a normal day

1. **⏭ Next day** (`curl -X POST $H/tick`). The Inbox shows **🧭 Plan for Tue 7 Jul** with the
   resource line "Water 6,500→500 m³ · Workers 5→4 · Combine 1→1 · Silo free 330→330 t" and
   three rows: North and West "Scout field" (the wheat and the rapeseed are 2-3 days from ripe), River
   "Irrigate 25 mm · 6,000 m³ water · 1 worker", confidence 0.80, reason *"Soil moisture 59%;
   forecast 10.6 mm crop water use vs 0.0 mm rain over 2 days (heading for ~49%, stress below
   60%)."* 6,000 m³ fits the 6,500 m³ permit, so the Safety check lets it through. Click
   **✅ Approve** (`curl -X POST $H/decide -H 'content-type: application/json' -d
   '{"bundle_id": 1, "decision": "approve"}'`). A 💧 falls onto the River petal, River's soil
   moisture jumps to 84%, and **📣 What buyers & neighbours see** gets "Irrigation running on
   River field today (25 mm) — the field track may be wet."

### Act 2: heatwave

2. **🔥 Heatwave** (`curl -X POST $H/scenario/heatwave`). A red banner: "Heatwave: water
   permit cut to 3,600 m³/day". The water-permit card turns red ("cut from 6,500 m³"), the
   next three forecast days turn 🔥 (33-37 °C, no rain, ET₀ 6.8-7.8 mm a day).
   (If you press it while a plan is still in the Inbox, **✅ Approve** on that plan is refused
   with a yellow note: "plan no longer passes the safety check: irrigate for River field:
   Irrigation must stay within today's water permit. Reject it so the field agents re-plan."
   The permit cut applies at once, so a plan cleared against yesterday's permit can't slip through.)

3. **⏭ Next day** (`curl -X POST $H/tick`). **Plan for Wed 8 Jul**: River asks for 25 mm
   again (6,000 m³), but the permit is now 3,600 m³. The plan card lists **"🛡️ Safety check
   blocked: River field · Irrigate 25 mm: Irrigation must stay within today's water permit."**
   The same line shows in Team conversation in red, and the hero flower's stem grows a red
   thorn. The heat also ripened the wheat and rapeseed twice as fast, so the plan has West "Harvest ~114 t".
   Click **❌ Reject** with reason **"Wait for better weather"** (`curl -X POST $H/decide -H
   'content-type: application/json' -d '{"bundle_id": 2, "decision": "reject", "reason": "Wait
   for better weather"}'`). The caption under the dropdown reads "Your reason is sent back to
   the field agents and shapes their next plan." Team conversation: "❌ Farm manager: rejected
   the Wed 8 Jul plan: Wait for better weather".

4. **⏭ Next day** (`curl -X POST $H/tick`). **Plan for Thu 9 Jul**: River now asks for
   **15 mm = 3,600 m³**, which fits the cut permit and is allowed. Its rationale says why:
   *"Soil at 68%, heading for ~55% over the next 2 days; irrigating 15 mm (3,600 m³), fitted to
   today's 3,600 m³ water permit. (Noting recent rejection: Wait for better weather)"*. The heat
   has also made North and West ripe on the same day, so this plan already has a combine
   conflict. That is Act 3's story, and a hail warning tells it better. Leave the plan and go on.

### Act 3: hail warning

5. **🔄 Restart season** (`curl -X POST "$H/reset?seed=0"`), **⏭ Next day**, **✅ Approve**:
   the same baseline plan as step 1 (River 25 mm), so the crops ripen at normal speed again.

6. **⛈️ Hail warning** (`curl -X POST $H/scenario/hail`). An amber banner: "Hail warning:
   severe hail expected Thu 9 Jul — harvest ripe crops before it hits". The Thu 9 Jul weather
   card turns red with a HAIL chip (21 mm rain, 15 m/s wind), tomorrow is made dry and calm, and
   the North and West petals start shaking: both are now due tomorrow ("harvest early before
   the hail").

7. **⏭ Next day** (`curl -X POST $H/tick`). **Plan for Wed 8 Jul**. The wheat and the rapeseed
   both want the one combine, and the Coordinator keeps the one with the most value at risk. Team conversation:
   "🧭 Coordinator: conflict: the combine was requested by North field and West field; kept North
   field (€71k at risk vs €53k), West field waits". Then the three farm agents report what they
   can share, and the Machinery ring fills the gap. The plan table:
   - North · Harvest ~324 t · combine · 2 workers · 0.85 · *"Hail expected Thu 9 Jul; harvesting ripe wheat now."*
   - West · Harvest with Gut Rohrdommelsee's combine (~114 t) · Gut Rohrdommelsee's combine · 1 worker · 0.50
   - West · Deliver 109 t to Gut Rohrdommelsee · — · 0.50 · *"~439 t coming in today but only 330 t free in our silo; Gut Rohrdommelsee reports 227 t spare storage."*

   The card grows a **🚜 Neighbour help** section with each farm's report (Gut Rohrdommelsee: 1
   combine / 227 t; Agrarhof Oderblick: 0 combine / 42 t, since a cereal farm needs its own combine
   before the storm).
   Resource line: "Water 6,500→6,500 m³ · Workers 5→2 · Combine 1→0 · Silo free 330→0 t".
   Click **✅ Approve**. North and West turn golden, grain dots fly into the centre (the silo)
   and one leaves to the right (the delivery). The silo card reads 0 t free, Hof Lerchenbruch's
   dot turns red, Gut Rohrdommelsee's silo drops from 505 to 396 t free, and the notices read
   "Winter wheat harvest on North field today — about 324 t expected. Confidence: high.", the
   same for rapeseed on West (confidence medium), "Gut Rohrdommelsee: thanks for lending your
   combine for our West field (rapeseed) today." and "Gut Rohrdommelsee: expect about 109 t of
   rapeseed for storage today."

8. **⏭ Next day** (`curl -X POST $H/tick`). The hail hits: "Hail hit River field: potato
   leaves shredded, crop health down 0.08". The only crop still standing is River's potatoes,
   and its health drops from 0.89 to 0.81. The new plan has North and West waiting to drill
   their cover crops: "Wheat stubble too wet after 21.1 mm rain; drilling the cover crop once the
   soil dries." One more **⏭ Next day** (Fri 10 Jul, 3.6 mm) and both sow them.
   *If you had rejected step 7's plan* (try reason **"A neighbour farm should help with this"**),
   the storm takes 40% of both crops ("Hail hit North field: winter wheat lost 40%": 324 →
   193 t, West 114 → 67 t), and that reason also puts a `hint` into the next field censuses
   ("propose the harvest as usual; the Machinery ring will line up a neighbour's combine or silo
   space if ours can't cope").

**Drill down (level 5).** Click a hero petal, a field on the map, or pick it in the "Field
detail (or click a petal / field)" selectbox: the soil-moisture chart with rain and irrigation
bars, the dashed 3-day projection (no irrigation) and the dashed stress line, plus crop
health, disease, yield and the field's last 3 plans. **← Back to Oderbruch** → **Gut
Rohrdommelsee** opens the neighbour view: silo, combine, soil moisture, a history chart since Mon
6 Jul, and the last 3 reports from its farm agent.

## What this demonstrates

- **Coordinator**: bundles three field agents' proposals into one plan for the day, with a
  before/after resource line and a field-level table, and settles machine conflicts by value at
  risk (€71k of wheat beats €53k of rapeseed for the one combine).
- **Safety check**: a deterministic, non-LLM safety net. The same 25 mm irrigation was allowed
  in Act 1 (6,000 ≤ 6,500 m³) and blocked in Act 2 (6,000 > 3,600 m³) by the same rule. 14
  rules cover water permit, irrigation equipment, spray weather, pre-harvest interval, dry-day
  harvest, one field per machine, workers, fertilizing, cover crops only on stubble, deliveries
  only of real surplus, required amounts (mm, kg N/ha, tonnes), and neighbour name/capacity. A
  pending plan is checked again when you approve it, so a scenario in between can't sneak an
  illegal action through, and only one change (a day, a scenario, a decision) runs at a time.
- **Human-in-the-loop**: a rejection is a softer layer on top of the safety check, and its
  reason goes back to the field agents (mock River then fits the permit and says so; a real
  model reads the reason in its prompt). The reason is one of 6 plain-language options (or free
  text), never a rule name.
- **Confidence**: every action has its own confidence and a crop/soil/weather reason. The
  plan's overall confidence is the minimum across rows, flagged amber below 0.5.
- **What buyers & neighbours see**: only approved plans ever produce notices.
- **Neighbouring farms as agents**: every day each farm, ours included, has a farm agent answer
  "what can you share today?" (in grid mode in parallel with the field agents). The Machinery ring turns the
  answers into `borrow_combine` / `deliver_to` without over-booking a neighbour. The safety
  check then re-checks both against what that farm reported (`RULE_NEIGHBOUR_CAPACITY`, second
  pass continuing from the first pass's resource use).
- **A twin that evolves**: regional weather with a 3-day forecast that is what then happens, a
  daily soil water balance, ripening that doubles in a heatwave, ripe grain losing yield while it
  waits, and hail that takes 40% of any ripe wheat or rapeseed left standing.
- **Multi-level navigation**: Earth → Germany → Oderbruch → Farm → Field, all shareable URLs.

## Verified (mock mode)

Drove the choreography above via curl against a live mock-mode hub on :8100
(`PETAL_MODE=mock uv run uvicorn hub.main:app --port 8100`, then `POST /reset?seed=0`),
deciding each plan before advancing. Every tick took a few milliseconds (rule-based agents, no
model calls). Real outputs:

1. `POST /tick` → bundle 1, "Tue 7 Jul: 3 proposals, 3/3 actions cleared by the safety check";
   River `Irrigate 25 mm` / `6,000 m³ water · 1 worker` / 0.8; `resources_after.water_m3` 500.
   Approved → notice `Neighbours: Irrigation running on River field today (25 mm) — the field
   track may be wet.`; River soil moisture 84.2, `recent_actions` `[{"field": "River", "kind":
   "irrigate"}]`.
2. `POST /scenario/heatwave` → `{"ok": true, "scenario": "heatwave: water permit cut to 3,600
   m³/day"}`; `water_permit_m3` 3600, `heatwave_days_remaining` 4, today 36.5 °C / ET₀ 7.6.
3. `POST /tick` → bundle 2, "Wed 8 Jul: 3 proposals, 2/3 actions cleared by the safety check";
   blocked `{"field": "River", "action": {"type": "irrigate", "mm": 25.0, ...}, "rule":
   "Irrigation must stay within today's water permit."}`; allowed West `Harvest ~114 t`. Rejected
   with "Wait for better weather" → `/census/River.recent_rejections` `["Wait for better weather"]`.
4. `POST /tick` → bundle 3, "Thu 9 Jul: 4 proposals, 4/4 actions cleared by the safety check":
   River `Irrigate 15 mm` / `3,600 m³ water · 1 worker` / 0.75, with the rationale quoted in step 4
   (all three field rationales end "(Noting recent rejection: Wait for better weather)"). The
   same plan also shows the heat-driven conflict ("kept North field (€71k at risk vs €52k)") plus
   `borrow_combine` and "Deliver 107 t to Gut Rohrdommelsee". That is why the choreography restarts
   before Act 3.
5. `POST /reset?seed=0`, tick, approve, `POST /scenario/hail` → `"hail warning: severe hail
   expected Thu 9 Jul"`; forecast Wed 8 Jul 0.0 mm / 3.7 m/s, Thu 9 Jul 21.1 mm / 15.2 m/s
   `hail: true`; North and West `days_to_harvest` 1.
6. `POST /tick` → bundle 2, "Wed 8 Jul: 4 proposals, 3/3 actions cleared by the safety check",
   overall confidence 0.5: North harvest, West `borrow_combine` Gut Rohrdommelsee, `deliver_to` Gut
   Rohrdommelsee 108.7 t; no blocks. `nearby_capacity`: Hof Lerchenbruch 0 combine / 140 t (own farm,
   never borrowed from), Gut Rohrdommelsee 1 / 227 t, Agrarhof Oderblick 0 / 42 t, all at confidence
   0.5 (weather warning active).
7. Approved → silo `storage_used_t` 120 → 450 (0 t free), Gut Rohrdommelsee free 504.7 → 396.0 t,
   North 324.3 t and West 114.4 t harvested, no co-op sale needed; `recent_actions` harvest North,
   harvest West (`farm` Gut Rohrdommelsee), deliver West; 4 notices (2 × Buyers, 2 × Gut Rohrdommelsee).
8. `POST /tick` (Thu 9 Jul, 21.1 mm hail storm) → `Farm | warn | Hail hit River field: potato
   leaves shredded, crop health down 0.08` (River health 0.887 → 0.811); plan "Wait" for North and
   West ("… stubble too wet after 21.1 mm rain; drilling the cover crop once the soil dries."), then
   Fri 10 Jul "Sow cover crop" for both. Counterfactual run (same seed, step 7 rejected with "A neighbour farm should
   help with this"): `hint` set on `/census/West`, then "Hail hit North field: winter wheat lost
   40%" (324.3 → 192.6 t) and "Hail hit West field: rapeseed lost 40%" (114.4 → 67.4 t); that
   day's plan was "Wait" for both, since 21.1 mm of rain is too wet to harvest.

**How reliable the story is without a fixed seed**: `cd hub && uv run pytest -q` drives the same
three moments through the HTTP API for seeds 0..29 (163 passed): the normal-day irrigation in
97% of seeds (seed 20: a rainy forecast makes River ask for 20 mm instead of 25), the heatwave
block and the permit-fitted re-plan in 100%, the hail conflict with North kept in 100%, and West
borrowing Gut Rohrdommelsee's combine plus the `deliver_to` in 93%. In seeds 9 and 22 Gut
Rohrdommelsee's own combine is busy (its 10% chance), and Team conversation then reads "🚜 Machinery
ring: no neighbour combine free today; West field waits". This is honest behaviour, not a bug:
the ring never invents capacity.

**Dashboard**: the same states rendered through `streamlit.testing.v1.AppTest` against the live
hub. 12 routes (levels 1-3, `?farm=lerchenbruch` with and without `field=North|West|River`,
`?farm=rohrdommelsee|oderblick`, plus bad values) × 9 hub states (fresh, pending plan, approved
irrigation, heatwave block pending, rejected plan, hail plan pending, hail plan approved, hail
day, expired plan + cover crops) = 108 renders, plus all 12 routes with the hub down (built-in
mock day, warning banner): zero exceptions. `cd ui && uv run pytest -q` (14 passed) clicks the
buttons against a fake hub: a reject with "Other" and an empty box sends nothing, the typed or
listed reason is sent, the four day/scenario buttons are disabled while a day is being planned,
and a hub refusal (e.g. the 409 above) shows in the hub's own words.

## Grid mode

Same choreography, `scripts/demo.sh grid`. It needs `uv run flwr login supergrid` once (from
`agents/petal/`); no `FLWR_MODEL_API_KEY` is required, unlike local `flower` mode. Each day then
launches 6 agents in parallel on Flower SuperGrid (North, West and River field agents plus the
farm agents of Hof Lerchenbruch, Gut Rohrdommelsee and Agrarhof Oderblick), each with its census
inlined as `agent.census`. The hub reads each agent's answer from the last JSON object on its
stdout. If an agent doesn't answer within 90 s, Team conversation shows a warning and that
agent falls back to its mock for the day, so the demo never stalls.

**Honest status: this has NOT been run live on SuperGrid for MetaAgri yet.** It uses the same
plumbing as MetaHospital's Python twin, and that plumbing was verified live there
(`git -C ../MetaHospital show 0f842b7:DEMO.md`, "Verified (grid mode, real SuperGrid)": 3 ticks of
59 / 91 / 75 s, 6 agents in parallel, zero mock fallbacks). For MetaAgri it was verified only
without SuperGrid. The hub's grid launcher builds `agent.unit` / `agent.farm` / `agent.census`
run-configs that Flower 1.37's own parser (`parse_config_args` + `get_fused_config_from_dir`,
which rejects unknown keys) accepts. The inlined census round-trips exactly, including an
apostrophe from a free-text rejection, `m³` and `·`. The real petal `main()` runs on that
run-config with a stubbed model stream, and the hub's `_extract_last_json_object` recovers the
petal's final stdout line from noisy `flwr --stream`-style output for every field and farm
agent. The petal's `Action` / `Proposal` / `FarmCapacity` schemas match the hub's (identical
JSON schema, and 94 sample payloads accepted and rejected identically). How well the real model
follows the prompts is untested. Expect richer, less predictable proposals than the mock's, and
rationales that paraphrase a rejection instead of echoing "(Noting recent rejection: ...)".

To run it live:

```bash
cd agents/petal && uv run flwr login supergrid && cd ../..   # once
scripts/demo.sh grid                                         # hub :8100 + dashboard :8601

# or one agent by hand, against a running hub (see agents/petal/README.md):
cd agents/petal
CENSUS=$(curl -s http://127.0.0.1:8100/census/River | sed "s/'/\\\\u0027/g")
uv run flwr run . supergrid --stream --run-config "agent.unit=\"River\" agent.census='$CENSUS'"
```

Local SuperLink instead of SuperGrid (field agents run one at a time and POST back to the hub;
needs your own model key):

```bash
cd hub && FLWR_MODEL_API_KEY=... PETAL_MODE=flower uv run uvicorn hub.main:app --port 8100
```

Worth checking on the first live run: the tick time (6 agents in parallel, 90 s timeout each);
that no "falling back to mock" / "using a conservative estimate" warnings appear in Team
conversation. Each agent's answer is pinned to the field / farm it was asked about (the petal
overwrites whatever name the model wrote), and the hub logs a warning if one still arrives under
another name.
