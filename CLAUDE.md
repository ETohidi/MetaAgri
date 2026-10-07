# MetaAgri – multi-level farm digital twin (static web MVP)

A browser-only digital twin of a small arable farm in the Oderbruch (Brandenburg) and its
two neighbours, viewed at five levels: Earth > Germany > Oderbruch > farm > field. The
simulation and the rule-based planning layer (field agents, farm agents, Coordinator, Safety
check, Machinery ring, farm-manager approve/reject, notices to buyers and neighbours) run
entirely in the browser. There is no backend and no model call. The earlier Python/Flower
version (FastAPI hub, Streamlit dashboard, Flower AgentApp) lives in git history at commit
`a6c825d`. Sibling project and architectural reference: `../MetaHospital` (read-only from here).

## Repo layout
- web/                 the whole MVP (static site, no build step)
  - index.html         page shell; loads d3 + topojson from cdnjs, then src/main.js
  - src/main.js        router (hash tokens), zoom ladder, simulation controls, render loop
  - src/engine/        the twin: seeded sim, weather, field agents (planners.js), farm agents
                       (farms.js), coordinator (+ Machinery ring), safety, notices; twin.js is the facade
  - src/engine/types.js  the data contract between engine and views - keep it in sync
  - src/ui/            views: maps.js (levels 1-3), farm.js (level 4), field.js (level 5), dom.js helpers
  - src/data/          places.js (fictional farms, our fields) and simplified geo data
  - styles/            base.css (design tokens + shared components) and one stylesheet per view
  - test/              node:test suite for the engine (demo.test.js pins the default-seed demo)
  - tools/             serve.mjs (local server), make-artifact.mjs (claude.ai artifact build)
- .github/workflows/pages.yml  tests + deploys web/ to GitHub Pages on every push to main
- README.md, DEMO.md (5-minute walkthrough), DESIGN.md (rules, numbers, texts)

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
- Keep the human-facing names: "Coordinator", "Safety check", "Machinery ring", "Farm
  manager", "North/West/River field agent", "Farm". The tick counter is never shown, only dates.
- Farm names are fictional on purpose (Hof Lerchenbruch, Gut Rohrdommelsee, Agrarhof
  Oderblick); never use a real farm's or company's name with simulated numbers.
- No author or owner name and no email address anywhere in the repo's files (code, docs, page).
- If the default-seed numbers change, update DEMO.md and test/demo.test.js together.

## Commands (from web/)
- `npm test`           run the engine tests
- `npm run serve`      serve the site at http://127.0.0.1:8090
- `npm run artifact`   write dist/artifact.html for publishing as a claude.ai artifact

## Working style
- Small steps, ask before large refactors.
- Prefer simple code over clever code.
