# MetaAgri – multi-level farm digital twin (static web MVP)

A browser-only, multi-level view of how farm information moves: World > EU > Country > Land >
District > Farm > Field. Each level has a real-world user (global crop analyst, federal
ministry, state ministry and paying agency, district authorities and the machinery-sharing
network, farm manager) and clear rules for what it shares upward, with peers and never. The
levels above the farm show real published figures (FAO, Eurostat, Destatis, the
Berlin-Brandenburg statistics office, Märkisch-Oderland); the farm and field levels run the
seeded simulation on three fictional farms in the Oderbruch, with the rule-based planning
layer (field agents, Coordinator, safety rules, sharing network, farm-manager approve/reject,
notices to buyers and neighbours). A "Viewing as" lens (4 roles) chooses what each level
shows. There is no backend and no model call. The concept is docs/CONCEPT-v2.md (v2.0 =
section 7). The earlier Python/Flower version lives in git history at commit `a6c825d`.
Sibling project and architectural reference: `../MetaHospital` (read-only from here).

## Repo layout
- web/                 the whole MVP (static site, no build step)
  - index.html         page shell; loads d3 + topojson from cdnjs, then src/main.js
  - src/main.js        router (hash tokens), role lens, simulation actions, render loop
  - src/engine/        the twin: seeded sim, weather, field agents (planners.js), farm agents
                       (farms.js), coordinator (+ Machinery ring), safety, notices; twin.js is the facade
  - src/engine/types.js  the data contract between engine and views - keep it in sync
  - src/ui/            views and shared pieces:
    - shell.js         app bar: breadcrumb of places (level names), Viewing as, Simulation drawer
    - page.js          shared page anatomy: provenance badge, status pill, page head, 5-slot KPI strip, sources footer
    - levels.js        the level model (user, decides, shares up / peers / never with legal basis, cadence, KPI tiles, channels) and its panel
    - roles.js         the "Viewing as" lens: roles, access per level, Not shown placeholders
    - status.js        one status vocabulary: crop condition, drought, farm operations
    - world.js (World), country.js (Country), district.js (District), farm.js (Farm), field.js (Field), dom.js helpers
  - src/data/          places.js (fictional farms, our fields), real.js (loads web/data), simplified geo data
  - data/              real.json (hand-curated real figures, each with its provenance), LICENSES.md
  - styles/            base.css (tokens, app bar, shared components), page.css (page anatomy), one stylesheet per view, fonts/ (Inter woff2 + OFL)
  - test/              node:test suite: engine (demo.test.js pins the default-seed demo), level model, roles, real data
  - tools/             serve.mjs (local server), make-artifact.mjs (claude.ai artifact build)
- .github/workflows/pages.yml  tests + deploys web/ (index.html, src, styles, data) to GitHub Pages on every push to main
- README.md, DEMO.md (5-minute walkthrough), DESIGN.md (levels, roles, sharing; engine rules, numbers, texts)
- docs/                CONCEPT-v2.md (the v2 concept), SHARED-SPEC.md (what MetaAgri and MetaHospital share)

## Rules
- Vanilla ES modules only. No bundler, no npm runtime dependencies. d3 and topojson are the
  only libraries, loaded as UMD globals from cdnjs (the claude.ai artifact CSP allows cdnjs).
- The engine never touches the DOM, Math.random or Date: all randomness goes through the
  Twin's seeded rng, so a seed always replays the same season.
- Views only read `twin.snapshot()` and the Twin's query methods, and change the twin only
  through `tick()`, `heatwave()`, `hail()`, `decide()` and `reset()`.
- Build markup with the `html` tagged template from dom.js (it escapes everything); colours
  only through the tokens in base.css so light and dark themes both work.
- Routes are plain hash tokens (`#oderbruch`, `#lerchenbruch.river`) because the artifact
  viewer drops anything else.
- Every number carries a provenance badge: Live, Official, Estimated, Simulated, Illustrative,
  Not shown or Unknown. Unknown is never shown as 0.
- Real and simulated numbers never share a tile. Real farm or company names appear only next
  to Official values (the pages show none). Estimated or Simulated values appear only on the
  fictional farms or on anonymous totals at District level or above. Real parcels may carry
  only their official attributes (crop and area), never a simulated number. The demo farms
  never change a real total.
- Farm names are fictional on purpose (Hof Lerchenbruch, Gut Rohrdommelsee, Agrarhof
  Oderblick); never use a real farm's or company's name with simulated numbers.
- Real data comes from open sources with their licence recorded (web/data/LICENSES.md); every
  value keeps {kind, source, url, licence, asOf}. Assume non-commercial use.
- "Viewing as" is a lens, not a login: a role presets the home level and what each level
  shows (in full, totals only, or Not shown with the reason). Never call it access control.
- Fonts are self-hosted (Inter, SIL OFL). No Google Fonts or other third-party font hosts.
- Show level names in the UI (World, EU, Country, Land, District, Farm, Field), never level
  numbers, and never km or ha scales in the breadcrumb.
- Plain language in the UI: no "census", "ET0" or bare decimals like "0.85"; confidence as
  high / medium / low; scores as "n/100". The views reword engine texts (plainLog/plainReason
  in farm.js); the engine's own texts stay as they are.
- Human-facing names: "Coordinator", "safety rules" (the log actor is "Safety check"),
  "sharing network" (the engine's "Machinery ring"), "Farm manager", "North/West/River field
  agent". The tick counter is never shown, only dates.
- No author or owner name and no email address anywhere in the repo's files (code, docs, page).
- If the default-seed numbers change, update DEMO.md and test/demo.test.js together.
- `main` deploys to the live site on every push: develop on a branch and merge to `main` only
  when it's verified (tests green, every route and role checked in a browser, light and dark,
  desktop and phone).

## Commands (from web/)
- `npm test`           run the engine, level-model, role and real-data tests
- `npm run serve`      serve the site at http://127.0.0.1:8092
- `npm run artifact`   write dist/artifact.html for publishing as a claude.ai artifact

## Working style
- Small steps, ask before large refactors.
- Prefer simple code over clever code.
