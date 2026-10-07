# MetaAgri

A digital twin of a small arable farm in the Oderbruch (Brandenburg, Germany) and its two
neighbours, which you can zoom through at five levels: Earth, Germany, the Oderbruch, a farm,
and one of its fields.

**Live:** https://etohidi.github.io/MetaAgri/

Every simulated day, a field agent for each of our three fields (North: winter wheat, West:
rapeseed, River: potatoes) proposes the day's work: irrigate, spray, harvest, scout, sow a
cover crop or wait. A Coordinator bundles the proposals into one plan and settles who gets
the one combine. A Safety check blocks anything unsafe or illegal, such as irrigating beyond
the water permit or harvesting in the rain. The Machinery ring asks every farm what it can
share and borrows a neighbour's combine or sends surplus grain to a neighbour's silo. Nothing
changes until the farm manager (you) approves the plan. A rejection reason goes back to the
field agents and shapes their next plan, and buyers and neighbours only hear about approved
work.

Everything runs in the browser. The farms, fields, weather and numbers are simulated, and the
farm names (Hof Lerchenbruch, Gut Rohrdommelsee, Agrarhof Oderblick) are fictional.

## Try it

Open the live page and follow [DEMO.md](DEMO.md) for a five-minute walkthrough: approve a
plan, start a heatwave and watch the Safety check stop an irrigation the cut water permit
can't cover, then issue a hail warning and watch the Machinery ring borrow a neighbour's
combine to get both crops in before the storm.

To run it locally you need Node.js 20 or newer; there is nothing to install:

```bash
git clone https://github.com/ETohidi/MetaAgri.git
cd MetaAgri/web
npm run serve   # http://127.0.0.1:8090
npm test        # engine tests
```

## How it fits together

A static site with no build step, no backend and no model calls: vanilla JavaScript modules,
with d3 and topojson from cdnjs for the maps.

```
web/index.html ─ src/main.js ─┬─ src/engine/twin.js   the twin: seeded simulation, field agents,
                              │                       Machinery ring, Coordinator, Safety check
                              ├─ src/ui/maps.js       levels 1-3: Earth, Germany, Oderbruch
                              ├─ src/ui/farm.js       level 4: a farm (plan, approve / reject)
                              └─ src/ui/field.js      level 5: one field (soil moisture, census)
```

The engine is deterministic for a given seed, so the default season replays the same way
every time. [web/README.md](web/README.md) describes the daily loop and the files;
[DESIGN.md](DESIGN.md) has the rules and numbers; `web/src/engine/types.js` is the data
contract between the engine and the views.

## MetaHospital → MetaAgri

MetaAgri is the sibling of MetaHospital (a digital twin of a Berlin hospital network) and
uses the same architecture, moved from a hospital to a farm.

| MetaHospital                                | MetaAgri                                                    |
|---------------------------------------------|-------------------------------------------------------------|
| Earth → Germany → Berlin → hospital → unit  | Earth → Germany → Oderbruch → farm → field                   |
| Klinikum Kreuzberg (ours)                   | Hof Lerchenbruch (ours)                                      |
| Neighbour hospitals                         | Neighbour farms Gut Rohrdommelsee, Agrarhof Oderblick         |
| Units: ED, ICU, Ward                        | Fields: North (wheat), West (rapeseed), River (potatoes)     |
| Patients (condition, acuity)                | Crops (stage, soil moisture, health, disease, yield)         |
| Beds, staffed and occupied                  | Water permit, workers, combine, sprayer, silo                |
| Unit planners                               | Field agents                                                 |
| Coordinator                                 | Coordinator: settles combine and sprayer conflicts           |
| Safety check                                | Safety check: agronomic and legal hard rules                 |
| Regional coordinator, divert to a neighbour | Machinery ring: borrow a combine, deliver surplus grain       |
| Charge nurse                                | Farm manager                                                 |
| Bus accident                                | Heatwave (water permit cut) and hail warning                 |
| What families see                           | What buyers & neighbours see                                 |
| One step = one hour                         | One step = one day; the season starts Monday 6 July 2026     |

## Publishing

Every push to `main` runs the engine tests and publishes `web/index.html`, `web/src` and
`web/styles` to GitHub Pages (`.github/workflows/pages.yml`). The repository's Settings →
Pages → Source must be set to "GitHub Actions" once.

## The Python/Flower version

MetaAgri started as a Python app: a FastAPI farm twin (`hub/`), a Streamlit dashboard
(`ui/`) and a Flower AgentApp (`agents/petal/`) that could run the field and farm agents as
model-backed agents on Flower SuperGrid. It lives in git history at commit `a6c825d`
(`git checkout a6c825d`, or `git show a6c825d:hub/hub/thorn.py` for one file). The browser
engine is a port of its rule-based mode with the same rules and numbers; see
[DESIGN.md](DESIGN.md#deliberate-deviations-from-the-python-version) for the differences.

## Map data

Natural Earth 1:110m countries (public domain) via world-atlas; German states from
deutschlandGeoJSON (Unlicense); both simplified for size. The Oder river and the Oderbruch
outline are simplified by hand.
