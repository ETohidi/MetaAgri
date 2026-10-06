# hub

MetaAgri hub: the FastAPI farm digital twin (fields, regional weather, crop sim, proposals, the
safety check, the Machinery ring, notices for buyers and neighbours). "Farm", "Coordinator",
"Safety check", "Machinery ring" and "North/West/River field agent" are the names shown to a human
(`/log` actor values, plan/notice text); the modules behind them keep their code names
(`hub/stem.py`, `hub/thorn.py`, `agents/petal/`) since those aren't user-visible. `../DESIGN.md` is
the contract this package implements.

## Run

```
cd hub
uv sync
uv run uvicorn hub.main:app --reload --port 8100
```

Port 8100 (not MetaHospital's 8000), so both twins can run side by side.

`PETAL_MODE` env var controls where proposals for `/tick` come from:

- `mock` (default): canned but sensible proposals from `hub/mock_petals.py`, farm capacity from
  `hub/mock_farms.py`. No model, no network.
- `flower`: for each field, sequentially, launches `uv run flwr run .` (local SuperLink) in
  `agents/petal/` as a subprocess (`agent.unit` set per field, `hub.url` set to `HUB_SELF_URL`),
  and waits up to 90s for that field agent to `POST /proposals` itself. Local SuperLink needs a
  model key: `FLWR_MODEL_API_KEY` must be set, or the model call fails and the field falls back
  to mock after the timeout. Farm capacity comes from the mock farm agents in this mode.
- `grid`: the real-model path that doesn't need `FLWR_MODEL_API_KEY`. All three field agents
  **and** all three farm agents run **concurrently** in one `ThreadPoolExecutor` (6 workers),
  each launching `uv run flwr run . supergrid --stream` in `agents/petal/` with its census
  fetched by the hub and inlined as `agent.census` (field agents: `agent.unit="North"|"West"|"River"`;
  farm agents: `agent.unit="FARM" agent.farm="<name>"`). SuperGrid workers can't reach `hub.url`,
  so the hub itself parses the last JSON object out of the subprocess's stdout and POSTs it to its
  own `/proposals` or `/farm-capacity`. Requires `uv run flwr login supergrid` once, from
  `agents/petal/`. Each agent gets its own 90s timeout and falls back to the mock (with a warn in
  `/log`) independently, so one slow/failing agent never blocks the others.

  Each `flwr run` subprocess runs in its own session (`start_new_session=True`) so a timeout can
  kill its whole process tree via `os.killpg` — `uv run` doesn't forward signals to the actual
  submission process it spawns. The inlined census is a single-quoted run-config value, which
  Flower's parser can't carry a `'` in, so any apostrophe (e.g. in a farm manager's free-text
  rejection reason) is sent as the JSON escape `\u0027`, which the petal's `json.loads` turns
  back into `'`.

`HUB_SELF_URL` (default `http://127.0.0.1:8100`) is the URL the hub tells petal subprocesses to
call back — set it if you run the hub on a different host/port.

`METAAGRI_SEED` (optional int) seeds the random generator on every reset, so a demo or a test run
is reproducible; `POST /reset?seed=N` does the same for one reset.

```
PETAL_MODE=mock uv run uvicorn hub.main:app --reload --port 8100
# reproducible demo:
METAAGRI_SEED=0 uv run uvicorn hub.main:app --port 8100
# local SuperLink, needs your own model key:
FLWR_MODEL_API_KEY=... PETAL_MODE=flower uv run uvicorn hub.main:app --reload --port 8100
# real SuperGrid, needs `flwr login supergrid` first:
PETAL_MODE=grid uv run uvicorn hub.main:app --reload --port 8100
```

`GET /status` returns `{"tick_in_progress": bool, "mode": str}` — the dashboard polls this to
show a "Field agents are thinking…" banner and disable the Next day button while a
`flower`/`grid` tick is still waiting on subprocesses.

## Endpoints

| Method | Path                       | Purpose                                         |
|--------|----------------------------|--------------------------------------------------|
| GET    | /state                     | Full twin state: fields (incl. map polygons), weather + 3-day forecast, resources, scenario, farms, nearby capacity, recent actions (date labels, never a bare tick for display) |
| GET    | /status                    | `{tick_in_progress, mode}` — poll while a tick runs |
| GET    | /census/{field}            | FieldCensus for a field agent (North, West, River), incl. `hint` when a recent rejection should steer the next plan |
| GET    | /farms/{name}/census       | FarmCensus for a farm agent (own farm or a neighbour; name or id like `rohrdommelsee`) |
| POST   | /proposals                 | Submit a Proposal (schema-validated, 422 on error) → 201 `{"ok": true}` |
| POST   | /farm-capacity             | Submit a FarmCapacity answer (schema-validated, 422 on error) → 201 `{"ok": true}` |
| POST   | /tick                      | Advance one day, run field + farm agents, build the day's plan (Coordinator + Machinery ring) checked by the safety check; returns the plan |
| POST   | /scenario/heatwave         | 🔥 4-day heatwave: water permit cut to 3,600 m³/day |
| POST   | /scenario/hail             | ⛈️ Hail warning: storm the day after tomorrow, tomorrow dry — the ripening wheat and rapeseed come in early |
| GET    | /inbox                     | Pending plans                                    |
| POST   | /decide                    | Approve/reject a plan (reject takes a plain-language `reason`, fed back to the field agents); 404 unknown, 400 already decided or expired, 409 if the plan no longer passes the safety check (e.g. a heatwave cut the permit since it was built) |
| GET    | /log                       | Team conversation log, newest first (`level` info\|warn\|block\|decision) |
| GET    | /notices                   | What buyers & neighbours see, newest first (only from approved plans) |
| GET    | /history/{field}           | Daily soil moisture / crop health / rain / irrigation / yield history + 3-day no-irrigation projection + stress threshold |
| GET    | /plans/{field}             | Last 3 plans that touched this field             |
| GET    | /history/farm/{name}       | Daily storage free / soil moisture / combine history for a farm |
| GET    | /farm-reports/{name}       | Last 3 spare-capacity reports from that farm's agent |
| POST   | /reset                     | Restart the season (back to seed state; optional `?seed=N`) |

## Full round trip (curl)

```bash
# 1. Look at the seeded state
curl -s localhost:8100/state | jq

# 2. Advance one day -> field agents propose, Coordinator builds a plan, safety check reviews it
curl -s -X POST localhost:8100/tick | jq

# 3. See what's waiting for the farm manager
curl -s localhost:8100/inbox | jq

# 4. Approve the first pending plan (replace 1 with the real bundle_id)
curl -s -X POST localhost:8100/decide \
  -H 'content-type: application/json' \
  -d '{"bundle_id": 1, "decision": "approve"}' | jq

# 5. Notices appear for the approved actions
curl -s localhost:8100/notices | jq

# Heatwave: River's usual 25 mm (6,000 m³) no longer fits the 3,600 m³ permit
curl -s -X POST localhost:8100/scenario/heatwave | jq
curl -s -X POST localhost:8100/tick | jq '.thorn[] | select(.blocked)'

# Reject example, with a reason -> next day River fits the cut permit (15 mm)
curl -s -X POST localhost:8100/decide \
  -H 'content-type: application/json' \
  -d '{"bundle_id": 2, "decision": "reject", "reason": "Stay within the water permit"}' | jq

# Hail warning: North and West ripe together -> combine conflict -> Machinery ring
curl -s -X POST localhost:8100/scenario/hail | jq

# A neighbour's view
curl -s localhost:8100/farms/Gut%20Rohrdommelsee/census | jq
curl -s localhost:8100/history/farm/Gut%20Rohrdommelsee | jq
curl -s localhost:8100/farm-reports/Gut%20Rohrdommelsee | jq

# Team conversation log
curl -s localhost:8100/log | jq

# Start the season over (reproducibly)
curl -s -X POST 'localhost:8100/reset?seed=0' | jq
```

## Tests

```
cd hub
uv run pytest -q
```

Covers every safety-check rule (an allowed and a blocked case each), combine/sprayer conflict
resolution, the Machinery ring's `borrow_combine` / `deliver_to` suggestions and Thorn pass 2,
the water balance, both scenarios (incl. hail damage on the hail day), approve / reject / expired
plans, notices only from approved plans, every endpoint's shape, the flower/grid launch commands,
stdout parsing and fallbacks (with fake subprocesses — real SuperGrid runs need a login and are not
part of the test suite), and `tests/test_demo_moments.py`: the three designed demo moments from
`DESIGN.md` section 9, driven through the HTTP API for seeds 0..29, each required in ≥ 80% of seeds.
The actual rates are printed even under `-q`.

## Notes

- Fully in-memory, no database, no auth. State resets on process restart or `POST /reset`.
- One internal tick = one simulated day; the season starts Monday 6 July 2026 (`hub/clock.py`). The
  tick counter itself is never shown — every endpoint exposes date labels instead (`date`,
  `long_date`, `plan_for`, `valid_until`). A plan made on a day is the plan for that day; if it
  is still undecided when the next day starts it expires.
- Weather is regional (the same for all three farms) and generated 3 days ahead, so the forecast
  the field agents plan against is exactly what happens. Daily soil water balance:
  `moisture += rain − et0 × kc` (100 mm plant-available water, so 1 mm = 1 %); irrigation is added
  when a plan is approved, at 1 mm on 1 ha = 10 m³.
- The safety check (`hub/thorn.py`) is pure Python, no LLM calls — 14 deterministic rules
  (water permit, irrigation equipment, spray weather, pre-harvest interval, dry-day harvest, one
  field per machine per day, workers, fertilizing conditions, cover crops only on stubble,
  deliveries only of real surplus, required amounts, neighbour name / capacity, proposal shape).
  It runs again on approve, so a plan built before a heatwave can't irrigate past the cut permit.
- One change at a time: `/tick`, `/reset`, `/scenario/*` and `/decide` share a lock and answer
  409 while another one runs (a grid tick takes up to 90 s). Actions are checked in a fixed priority order (harvests, then irrigation driest field
  first, then spraying, fertilizing, cover crops, the rest) and a blocked action consumes nothing.
- Each proposed action carries its own `confidence`/`reason`; `hub/stem.py` flattens them into
  `plan_rows` (one row per allowed action, with a plain-language "what" and "resources" column)
  and an `overall_confidence` (the minimum across rows) on each plan, plus `resources_before` /
  `resources_after` (water, workers, combine, sprayer, silo space).
- Neighbouring farms (`Gut Rohrdommelsee`, `Agrarhof Oderblick`, plus the hub's own `Hof
  Lerchenbruch`) run as agents too, `agent.unit="FARM"` / `agent.farm="<name>"` in `agents/petal/`.
  In `mock`/`flower` mode their answers come from `hub/mock_farms.py` (lend the combine if it's
  free and there's no ripe backlog of your own; share silo space minus a 50 t reserve, halved while
  a weather warning is active). The Coordinator gives our single combine to the ripe field with
  the most value at risk; the Machinery ring then suggests a `borrow_combine` from the best
  neighbour for the field that lost out, and `deliver_to` actions for grain that won't fit in our
  silo, decrementing a local tally so one neighbour is never over-subscribed. `hub/thorn.py`
  independently re-checks every `borrow_combine` / `deliver_to` against the capacity each farm
  actually reported today (`RULE_NEIGHBOUR_CAPACITY`, own farm or unknown farm = zero), in a second
  pass that continues from the first pass's resource use — so a field agent's own neighbour action
  (e.g. from a real LLM in `grid` mode) and the ring's suggestion can't double-book a neighbour.
- Grain an approved plan harvests beyond the silo's free space is moved by that plan's
  `deliver_to` actions; anything left over is sold directly to the co-op (logged by "Farm").
- Rejecting a plan takes a plain-language `reason` (the dashboard offers 5 canned options plus
  free text); it's stored on every field in the plan and, if it mentions "neighbour farm",
  surfaces as a `hint` on that field's next `/census/{field}` response so the next plan visibly
  reacts to it. The mock River field agent answers any rejection by fitting its irrigation to
  today's water permit.
