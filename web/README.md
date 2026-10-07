# MetaAgri web MVP

A multi-level digital twin of a small arable farm in the Oderbruch (Brandenburg, Germany),
Hof Lerchenbruch, and its two neighbours, from the whole planet down to a single field. It is
a static site: the farm simulation and the planning layer run in the browser, with no
backend, no model calls and no build step.

**Live:** https://etohidi.github.io/MetaAgri/

## Run it

```bash
npm run serve   # http://127.0.0.1:8090
npm test        # engine tests (Node 20+)
```

Any static file server works too; the page only needs to be served over HTTP, because ES
modules don't load from `file://`. d3 and topojson come from cdnjs, so the maps need a
network connection.

## How it fits together

```
index.html ─ src/main.js ─┬─ src/engine/twin.js   the twin (state, daily loop, queries)
                          ├─ src/ui/maps.js       Earth / Germany / Oderbruch
                          ├─ src/ui/farm.js       a farm: fields, weather, resources, plan, conversation
                          └─ src/ui/field.js      one field: soil moisture, crop, plans, census
```

`main.js` owns routing, the zoom ladder, the simulation controls and the render loop. Every
view exports `render(container, ctx, { routeChanged })` and rebuilds its markup from
`twin.snapshot()` each time the twin changes. `src/engine/types.js` documents every shape the
engine hands out. Routes are plain hash tokens: `#earth`, `#germany`, `#oderbruch`, a farm
(`#lerchenbruch`, `#rohrdommelsee`, `#oderblick`) and a field of our farm
(`#lerchenbruch.north`, `#lerchenbruch.west`, `#lerchenbruch.river`).

Each simulated day (`twin.tick()`):

1. **Simulation** (`sim.js`, `weather.js`): the regional weather (a 3-day forecast that is
   what then happens), the soil water balance, ripening, crop health, potato blight, the
   heatwave and hail scenarios, and the neighbour farms drifting.
2. **Field agents** (`planners.js`): the North, West and River field agents each propose the
   day's work from their field's census (irrigate, spray, harvest, scout, sow a cover crop, wait).
3. **Machinery ring** (`farms.js`): every farm agent, ours included, reports what it can share
   today (a combine, silo space).
4. **Coordinator** (`coordinator.js`): bundles the proposals into one plan, settles combine and
   sprayer conflicts by value at risk, runs the **Safety check** (`safety.js`, deterministic
   agronomic and legal rules), and adds neighbour help: borrow a combine, deliver surplus grain.
5. The plan waits for the **farm manager** (`twin.decide()`). Approving applies it and sends
   notices to buyers and neighbours (`notices.js`); rejecting sends the reason back to the
   field agents, who take it into account in their next plan. An undecided plan expires when
   the next day starts.

**Heatwave** cuts today's water permit at once and doubles ripening for four days; **Hail
warning** announces severe hail in two days and makes cereals that are nearly ripe ready
tomorrow. The engine is deterministic: all randomness comes from a seeded generator
(`rng.js`), so a seed replays the same season every time; the default seed is 20260707.
`test/demo.test.js` pins the default season's demo numbers, which `../DEMO.md` walks
through, and `../DESIGN.md` lists the rules, numbers and texts.

## Publish

- **GitHub Pages:** every push to `main` runs the engine tests and then deploys `index.html`,
  `src/` and `styles/` (see `../.github/workflows/pages.yml`; it can also be started by hand
  from the Actions tab). One-time setup: in the repository's Settings → Pages, set the source
  to "GitHub Actions". The site is then live at https://etohidi.github.io/MetaAgri/.
  Any other static host works too: serve this folder as is; all paths are relative.
- **claude.ai artifact:** `npm run artifact` writes `dist/artifact.html` (the page without
  its document skeleton, which the artifact host adds). Publish that file with `styles/**`
  and `src/**` as supporting files at the same paths.

## Data

Farm names are fictional on purpose and every number is simulated. Map data: Natural Earth
1:110m countries (public domain) via world-atlas, German states from deutschlandGeoJSON
(Unlicense), both simplified for size; the Oder river and the Oderbruch outline are
simplified by hand.
