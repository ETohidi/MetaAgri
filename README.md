# MetaAgri

How farm information moves, from the whole world down to one field. MetaAgri is a digital
twin with seven levels, each with a real-world user and clear rules for what it shares
upward, with peers and never:

| Level | Page | Who uses it (the worked example) |
|---|---|---|
| World | `#world` | Global crop analysts (FAO, AMIS, GEOGLAM) |
| EU | in the breadcrumb only | DG AGRI, JRC crop monitoring |
| Country | `#germany` | The federal agriculture ministry (BMLEH), FLI, JKI, Destatis |
| Land | in the breadcrumb, page in v2.1 | Brandenburg's ministry and EU paying agency |
| District | `#oderbruch` | Märkisch-Oderland's water, vet and agriculture offices; the machinery-sharing network |
| Farm | `#lerchenbruch`, `#rohrdommelsee`, `#oderblick` | The farm manager |
| Field | `#lerchenbruch.north`, `.west`, `.river` | The farm's agronomist and field agents |

**Live:** https://etohidi.github.io/MetaAgri/

**Real above the farm, simulated below, never mixed.** World, Country and District show real
published statistics (FAO, Eurostat, Destatis, the Berlin-Brandenburg statistics office, the
district of Märkisch-Oderland), each with its source, date and licence. The three farms are
fictional (Hof Lerchenbruch, Gut Rohrdommelsee, Agrarhof Oderblick), and everything about
them comes from a seeded simulation. Every number carries a badge: **Official**,
**Estimated**, **Simulated**, **Illustrative**, **Not shown** or **Unknown**. A missing figure
is Unknown, never 0, and no simulated number is ever drawn on a real parcel or next to a real
farm's name.

**"Viewing as" is a lens, not a login.** Four roles (Global crop analyst, Federal ministry,
District & sharing network, Farm manager) each open on their own level and see each level in
full, as totals only, or as a "Not shown" box that says why. The site opens on Germany as the
Federal ministry; **Follow the farm manager** switches to the farm story. A static site cannot
enforce access, so this shows the sharing rules rather than enforcing them.

**On the farm, agents propose and a person decides.** Every simulated day, a field agent for
each of the three fields proposes the day's work (irrigate, spray, harvest, scout, sow a cover
crop or wait). A Coordinator bundles the proposals into one plan, the safety rules block
anything unsafe or illegal (irrigating beyond the water permit, harvesting in the rain), and
the machinery-sharing network borrows a neighbour's combine or sends surplus grain to a
neighbour's silo. Nothing changes until the farm manager approves. A rejection reason goes
back to the field agents and shapes their next plan. All agents are rule-based; there is no
model call.

## Try it

Open the live page and follow [DEMO.md](DEMO.md), a five-minute walkthrough: Germany as the
ministry, switching lenses on the District, then the farm demo (approve a plan, a heatwave
that blocks an irrigation, a hail warning that borrows a neighbour's combine).

To run it locally you need Node.js 20 or newer; there is nothing to install:

```bash
git clone https://github.com/ETohidi/MetaAgri.git
cd MetaAgri/web
npm run serve   # http://127.0.0.1:8092
npm test        # engine, level-model, role and real-data tests
```

## How it's built

A static site with no build step and no backend: vanilla JavaScript modules, with d3 and
topojson from cdnjs for the maps and the Inter font self-hosted. The real figures are a
hand-curated snapshot, `web/data/real.json`, with each value's source, date and licence
(`web/data/LICENSES.md`). The simulation engine is deterministic for a given seed, so the
default season replays the same way every time.

- [web/README.md](web/README.md): the files, the daily loop and how to publish.
- [DESIGN.md](DESIGN.md): levels, roles and sharing, then the engine's rules, numbers and texts.
- [docs/CONCEPT-v2.md](docs/CONCEPT-v2.md): the v2 concept (levels, roles, data, UI, phases).
- [docs/SHARED-SPEC.md](docs/SHARED-SPEC.md): the page anatomy, badges, level model and role
  lens shared with the sibling project MetaHospital.

Every push to `main` runs the tests and publishes `web/index.html`, `web/src`, `web/styles`
and `web/data` to GitHub Pages (`.github/workflows/pages.yml`).

## What is real and what is not

- **Real:** the figures on World, Country and District and in the District's "Real context"
  strip, as listed in each page's **Data & sources** footer. Three are badged **Estimated**:
  the number of field outlines mapped worldwide (a machine-learning output), and two of our
  own calculations from open data, the Oderbruch water balance (rain minus crop water demand,
  1991-2020) and its median field size.
- **Not yet:** crop condition and drought per country and per Land, the Land page and live
  feeds come in v2.1; until then they show **Unknown**.
- **Fictional:** the three farms, their fields and shapes, and every number about them. The
  demo farm is smaller than a real Oderbruch farm (96 ha in 3 fields, against a Brandenburg
  mean of about 242 ha), and its River field grows potatoes, which are rare in the
  Oderbruch.

This is a non-commercial demo. Some sources (for example the Open-Meteo free tier used for
the water balance) allow non-commercial use only.

## MetaHospital and MetaAgri

MetaAgri is the sibling of MetaHospital, a twin of hospital capacity from the world down to
one hospital unit. Both follow the same written spec ([docs/SHARED-SPEC.md](docs/SHARED-SPEC.md)).

| MetaHospital | MetaAgri |
|---|---|
| World → EU → Country → Land · City (Berlin, one authority) → Hospital → Unit | World → EU → Country → Land → District → Farm → Field |
| Real DIVI-Intensivregister and World Bank data | Real FAO, Eurostat, Destatis and district figures |
| Three fictional demo-twin hospitals | Three fictional farms |
| Unit planners, Coordinator, Safety check | Field agents, Coordinator, safety rules |
| Regional coordinator, divert to a neighbour | Sharing network: borrow a combine, deliver surplus grain |
| Charge nurse approves | Farm manager approves |
| Bus accident | Heatwave (water permit cut) and hail warning |
| What families see | What buyers & neighbours see |
| One step = one hour | One step = one day; the season starts Monday 6 July 2026 |

## The Python/Flower version

MetaAgri started as a Python app: a FastAPI farm twin, a Streamlit dashboard and a Flower
AgentApp that could run the field and farm agents as model-backed agents. It lives in git
history at commit `a6c825d`. The browser engine is a port of its rule-based mode with the
same rules and numbers; see [DESIGN.md](DESIGN.md#deliberate-deviations-from-the-python-version).

## Data and map licences

The real figures keep their source licences, listed in
[web/data/LICENSES.md](web/data/LICENSES.md). Map data: Natural Earth 1:110m countries
(public domain) via world-atlas, German states from deutschlandGeoJSON (Unlicense), both
simplified for size; the Oder river and the Oderbruch outline are simplified by hand. Font:
Inter (SIL OFL), self-hosted.
