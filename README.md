# MetaAgri

A multi-agent **digital twin of farms**: MetaHospital's architecture moved from a hospital to
arable farming in the Oderbruch (Brandenburg, Germany). It is a port of MetaHospital's Python
twin (FastAPI hub + Streamlit dashboard + Flower petals: the git history of `../MetaHospital`
at commit `0f842b7`; that repo has since moved to a static web version). Every simulated day,
one AI agent per field proposes the day's work (irrigate, spray, harvest, ...), a Coordinator
bundles the proposals into one plan, a deterministic Safety check blocks anything unsafe or
illegal, neighbouring farms report what they can lend (a Machinery ring), and the **farm
manager** approves or rejects the plan. A rejection reason goes back to the field agents and
shapes their next plan; only approved plans produce notices for buyers and neighbours.

Hackathon MVP (Flower Collaborative Agent Hackathon). All data is synthetic.

## MetaHospital → MetaAgri

| MetaHospital                                | MetaAgri                                                        |
|---------------------------------------------|------------------------------------------------------------------|
| Earth → Germany → Berlin → Hospital → Unit  | Earth → Germany → Oderbruch → Farm → Field                        |
| Klinikum Kreuzberg (ours)                   | Hof Lerchenbruch (ours)                                            |
| Neighbour hospitals                         | Neighbour farms Gut Rohrdommelsee, Agrarhof Oderblick               |
| Units ED / ICU / Ward (petals)              | Fields North (wheat) / West (rapeseed) / River (potatoes)         |
| Patients (condition, acuity)                | Crops (stage, soil moisture, health, disease, yield)              |
| Beds staffed / occupied                     | Water permit, workers, combine, sprayer, silo                     |
| Unit agent ("ICU agent")                    | Field agent ("River field agent")                                |
| Coordinator (Stem)                          | Coordinator (Stem): resolves combine / sprayer conflicts          |
| Safety check (Thorn)                        | Safety check (Thorn): 11 agronomic and legal hard rules            |
| Regional coordinator, `divert_to`           | Machinery ring, `borrow_combine` / `deliver_to`                    |
| Charge nurse                                | Farm manager                                                      |
| Emergency: bus accident                     | 🔥 Heatwave (water permit cut) and ⛈️ Hail warning                 |
| What families see                           | What buyers & neighbours see                                      |
| 1 tick = 1 hour                             | 1 tick = 1 day, season starts Monday 6 July 2026                  |
| hub :8000, ui :8501                         | hub :8100, ui :8601 (both twins can run side by side)             |

## Architecture

```
  ui/  Streamlit dashboard :8601
  +-------------------------------------------------------------------------+
  | Earth > Germany > Oderbruch > Hof Lerchenbruch > North / West / River     |
  | Next day | Heatwave | Hail warning | Restart | Approve / Reject + reason |
  +------------------------------------+------------------------------------+
                                       |  HTTP: GET /state /inbox /log /notices /history ...
                                       |        POST /tick /decide /scenario/* /reset
  hub/  FastAPI farm twin :8100        v
  +-------------------------------------------------------------------------+
  | weather.py + sim.py  regional weather, soil water balance, ripening,    |
  |                      crop health, blight, heatwave / hail scenarios     |
  | state.py             fields, silo, water permit, neighbour farms,       |
  |                      history, apply an approved plan                    |
  | stem.py              Coordinator: bundle proposals, resolve conflicts   |
  |                      Machinery ring: borrow_combine / deliver_to        |
  | thorn.py             Safety check: deterministic rules, no LLM          |
  | notices.py           what buyers & neighbours see (approved plans only) |
  +-----------+-----------------------------------------------+-------------+
              | field census -> Proposal                       | farm census -> FarmCapacity
              v                                                v
  +---------------------------+              +-------------------------------------+
  | field agents (petals)     |              | farm agents (Machinery ring input)  |
  | North, West, River        |              | Hof Lerchenbruch, Gut Rohrdommelsee,     |
  | agents/petal              |              | Agrarhof Oderblick                  |
  | agent.unit="North" ...    |              | agent.unit="FARM" agent.farm="..."  |
  +---------------------------+              +-------------------------------------+

  PETAL_MODE=mock    rule-based agents in hub/mock_petals.py + mock_farms.py (default, no model)
  PETAL_MODE=flower  local SuperLink, one field agent at a time, the petal POSTs back to the hub
  PETAL_MODE=grid    Flower SuperGrid, all 6 agents in parallel, census inlined as agent.census,
                     the hub parses each agent's last stdout JSON; 90 s timeout -> mock fallback
```

One day (`POST /tick`): the sim advances a day (weather, soil moisture, ripening, disease,
scenarios, neighbour drift; an undecided plan from yesterday expires) → the three field agents
propose → the Coordinator keeps the field with the most value at risk when two want the same
machine → Safety check pass 1 → the three farm agents report spare combine / silo space →
the Machinery ring suggests a borrowed combine and deliveries of surplus grain → Safety check
pass 2 → the plan lands in the Inbox. Approve applies it (irrigation, harvest into the silo,
deliveries to neighbours, cover crops) and writes the notices; Reject stores the reason on
every field in the plan.

## Navigation levels

| Level | URL                                   | What you see                                                   |
|-------|---------------------------------------|----------------------------------------------------------------|
| 1     | `?level=1`                            | 🌍 Earth: world map with the Germany outline                    |
| 2     | `?level=2`                            | 🇩🇪 Germany: the Oderbruch dot in Brandenburg                   |
| 3     | `?level=3`                            | 🌾 Oderbruch: the three farms, coloured by status               |
| 4     | `?farm=lerchenbruch`                    | Hof Lerchenbruch's full dashboard (neighbours: `?farm=rohrdommelsee`, `?farm=oderblick`) |
| 5     | `?farm=lerchenbruch&field=River`        | Field detail: soil moisture chart, projection, last plans      |

## Quick start

```bash
scripts/demo.sh mock            # hub on :8100 + dashboard on :8601, Ctrl+C stops both
METAAGRI_SEED=0 scripts/demo.sh mock   # reproducible season (the numbers in DEMO.md)
```

Open http://127.0.0.1:8601 (or straight to the farm: http://127.0.0.1:8601/?farm=lerchenbruch)
and follow [DEMO.md](DEMO.md). The hub's API docs are at http://127.0.0.1:8100/docs.

Needs [uv](https://docs.astral.sh/uv/) (Python 3.14 is what uv picks; `uv run` syncs each
project on first use). Checks:

```bash
cd hub && uv run pytest -q                 # 163 tests, incl. a 30-seed demo-moment sweep
cd ui && uv run pytest -q                  # 14 dashboard tests (AppTest against a fake hub)
cd agents/petal && uv run flwr build       # builds the agri-petal FAB (delete the .fab after)
```

The dashboard is checked with Streamlit's `AppTest` against a live hub and with the hub down
(see [ui/README.md](ui/README.md#check)). What was verified, with real outputs, is in
[DEMO.md](DEMO.md#verified-mock-mode).

`scripts/demo.sh grid` uses real model-backed agents on Flower SuperGrid; it needs
`uv run flwr login supergrid` once from `agents/petal/` and has **not** been run live for
MetaAgri yet (see [DEMO.md](DEMO.md#grid-mode)).

## Repo layout

```
MetaAgri/
  README.md  DEMO.md  DESIGN.md  CLAUDE.md
  scripts/demo.sh         start hub + dashboard ([mock|grid])
  hub/                    FastAPI farm twin (uv project, package "hub"), tests/ with pytest
  ui/                     Streamlit dashboard (app.py, .streamlit/config.toml)
  agents/petal/           Flower AgentApp "agri-petal": field agent or farm agent
  agents/agent/           untouched Flower agent template
```

## More

- [DEMO.md](DEMO.md): the 5-minute demo, button by button, with curl equivalents and verified output
- [DESIGN.md](DESIGN.md): the contract between hub, petal and ui (schemas, rules, endpoints, numbers)
- [hub/README.md](hub/README.md): endpoints, agent modes, a full curl round trip, tests
- [ui/README.md](ui/README.md): every view and widget of the dashboard
- [agents/petal/README.md](agents/petal/README.md): the Flower AgentApp, run config, SuperGrid commands
- [CLAUDE.md](CLAUDE.md): Flower rules and working style for this repo
