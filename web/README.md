# MetaAgri web MVP

How farm information moves, at seven levels: World, EU, Country (Germany), Land
(Brandenburg), District (Märkisch-Oderland, the Oderbruch), Farm and Field. World, Country
and District show real published figures (`data/real.json`); the farm and field levels run
the seeded simulation on three fictional farms (Hof Lerchenbruch and two neighbours). EU and
Land are in the breadcrumb but have no page yet. It is a static site: the simulation and the
planning layer run in the browser, with no backend, no model calls and no build step.

**Live:** https://etohidi.github.io/MetaAgri/

## Run it

```bash
npm run serve   # http://127.0.0.1:8092
npm test        # engine, level-model, role and real-data tests (Node 20+)
```

Any static file server works too; the page only needs to be served over HTTP, because ES
modules and `data/real.json` don't load from `file://`. d3 and topojson come from cdnjs, so
the maps need a network connection.

## How it fits together

```
index.html ─ src/main.js ─┬─ src/ui/shell.js      app bar: breadcrumb, Viewing as, Simulation drawer
                          ├─ src/data/real.js     loads data/real.json (real figures, with provenance)
                          ├─ src/engine/twin.js   the twin (state, daily loop, queries)
                          ├─ src/ui/world.js      World: farms, farm sizes, irrigation (FAO, FTW)
                          ├─ src/ui/country.js    Country: Germany and the Länder, Brandenburg card
                          ├─ src/ui/district.js   District: the Oderbruch, the three farms, requests and offers
                          ├─ src/ui/farm.js       Farm: our farm (plan, approve / reject) or a neighbour
                          └─ src/ui/field.js      Field: soil moisture day by day, what the field agent reads
   shared by every view:  src/ui/page.js   (provenance badge, status pill, page head, 5 KPI slots, sources)
                          src/ui/levels.js (who uses each level, what crosses its boundary, the channels)
                          src/ui/roles.js  (the "Viewing as" lens: roles, access per level, Not shown)
                          src/ui/status.js (one status vocabulary: crop condition, drought, farm operations)
                          src/ui/dom.js    (html`` escaping and small helpers)
data/real.json ────────── the curated real figures; data/LICENSES.md lists their licences
```

`main.js` owns routing, the role lens, the simulation actions and the render loop. Every view
exports `render(container, ctx, { routeChanged })`, where `ctx` is `{ twin, snap, route,
routes, go, ui, toast, rerender, data, dataState, role, setRole }`: the twin's snapshot, the
real data (`data`, with `dataState` "loading", "ready" or "error"), and the current role.
`src/engine/types.js` documents every shape the engine hands out.

Routes are plain hash tokens: `#world`, `#germany`, `#oderbruch`, a farm (`#lerchenbruch`,
`#rohrdommelsee`, `#oderblick`) and a field of our farm (`#lerchenbruch.north`,
`#lerchenbruch.west`, `#lerchenbruch.river`). The old `#earth` redirects to `#world`; an empty
or unknown hash opens the current role's home (Germany for the default Federal ministry lens).
The role is remembered in this browser only.

Each simulated day (`twin.tick()`):

1. **Simulation** (`sim.js`, `weather.js`): the regional weather (a 3-day forecast that is
   what then happens), the soil water balance, ripening, crop health, potato blight, the
   heatwave and hail scenarios, and the neighbour farms drifting.
2. **Field agents** (`planners.js`): the North, West and River field agents each propose the
   day's work from their field's readings (irrigate, spray, harvest, scout, sow a cover
   crop, wait).
3. **Sharing network** (`farms.js`): every farm agent, ours included, reports what it can lend
   today (a combine, silo space). The engine still calls it the Machinery ring; the pages say
   "sharing network".
4. **Coordinator** (`coordinator.js`): bundles the proposals into one plan, settles combine and
   sprayer conflicts by value at risk, runs the **safety rules** (`safety.js`, deterministic
   agronomic and legal rules), and adds neighbour help: borrow a combine, deliver surplus grain.
5. The plan waits for the **farm manager** (`twin.decide()`). Approving applies it and sends
   notices to buyers and neighbours (`notices.js`); rejecting sends the reason back to the
   field agents, who take it into account in their next plan. An undecided plan expires when
   the next day starts.

**Heatwave** cuts today's water permit at once and doubles ripening for four days; **Hail
warning** announces severe hail in two days and makes cereals that are nearly ripe ready
tomorrow. Both buttons appear only on District, Farm and Field. The engine is deterministic:
all randomness comes from a seeded generator (`rng.js`), so a seed replays the same season
every time; the default seed is 20260707. `test/demo.test.js` pins the default season's demo
numbers, which `../DEMO.md` walks through, and `../DESIGN.md` lists the levels, roles, rules,
numbers and texts.

## Publish

- **GitHub Pages:** every push to `main` runs the tests and then deploys `index.html`, `src/`,
  `styles/` and `data/` (see `../.github/workflows/pages.yml`; it can also be started by hand
  from the Actions tab). One-time setup: in the repository's Settings → Pages, set the source
  to "GitHub Actions". Any other static host works too: serve this folder as is; all paths
  are relative.
- **claude.ai artifact:** `npm run artifact` writes `dist/artifact.html` (the page without its
  document skeleton, which the artifact host adds). Publish that file with `styles/**`
  (including `styles/fonts/`), `src/**` and `data/real.json` as supporting files at the same
  paths.

## Data

Real figures: `data/real.json`, hand-curated for v2.0 and checked against each source on
13 October 2026. Every value carries `{value, unit, label, kind, source, url, licence, asOf,
note}`, and `kind` is Official (a published statistic) or Estimated (a machine-learning output
or our own calculation from open data). `data/LICENSES.md` lists each source's licence;
`test/data.test.js` checks that the file has exactly the keys in `src/data/real.js` and a full
provenance record for each. A scheduled refresh (`tools/build-data.mjs`) is planned for v2.1.

Simulated data: the three farms, their names, fields and shapes, and every number about them
are fictional.

Map data: Natural Earth 1:110m countries (public domain) via world-atlas and German states
from deutschlandGeoJSON (Unlicense), both simplified for size; the Oder river and the
Oderbruch outline are simplified by hand. Font: Inter (SIL OFL), self-hosted in
`styles/fonts/`.
