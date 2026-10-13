# Shared design spec: MetaAgri and MetaHospital

Both twins are the same kind of thing: a browser-only, multi-level view of how information
moves between real decision-makers, with real open data at the top and a seeded simulation of
fictional sites at the bottom. This spec is the part they share, so a visitor who knows one
can read the other. Concept background: [CONCEPT-v2.md](CONCEPT-v2.md).

Status per item: **Shared** = both twins implement it the same way; **MetaAgri first** = built
in MetaAgri v2.0, proposed for MetaHospital; **Differs** = deliberately different.

## 1. Page anatomy (Shared)

Every level page has the same skeleton, built from `web/src/ui/page.js` (identical in both):

1. **Page head** (`pageHead`): level pill and place; an H1 that is the *question the page
   answers*; one line "May see: …"; on the right one status pill and the data freshness.
2. **KPI strip** (`kpiStrip`): exactly five slots, so nothing shifts between levels. Every tile
   has a provenance badge. Fewer tiles leave empty slots.
3. **Stage + rail**: the stage holds the map, tiles or table; the rail holds *Needs attention*,
   *Shared with me* and *Shared by me*.
4. **Levels panel** (`levelsPanel` in `levels.js`): "Who uses this level, and what crosses its
   boundary".
5. **Sources footer** (`sourcesFooter`): every dataset or rule on the page, with its badge.

## 2. Provenance badges (Shared)

Every number carries one badge (`prov(kind)`): **Live**, **Official**, **Estimated**,
**Simulated**, **Illustrative**, **Not shown**, **Unknown**, **Stale**.

- **Unknown is never shown as 0.**
- Real and simulated numbers never share a tile.
- Real organisation names appear only next to Live or Official values. Estimated or Simulated
  values appear only on the fictional demo sites, or on anonymous totals at district/city level
  or above. The demo sites never change a real total.

## 3. The level model (Shared fields; Differs in the ladder)

`levels.js` fills the same fields for every level, and a test fails if one is missing:
`name, user, decides, up, upBasis, peers, peersBasis, never, neverBasis, cadence` plus 1-5
`kpis`. Every "shares up / with peers / never" has a real legal basis.

| | MetaHospital | MetaAgri |
|---|---|---|
| Ladder | World · EU · Country · Land·City · Hospital · Unit | World · EU · Country · Land · District · Farm · Field |
| Why | Berlin is a city-state: Land and city are one authority | In Brandenburg the Land (paying agency, plant protection, main rivers) and the district (water bans, disease zones) hold different powers |
| Ladder-only levels | EU | EU, Land (page in v2.1) |

The UI shows level **names**, never numbers or km/ha scales.

## 4. Real data files (Shared format)

Real figures live in `web/data/*.json`; every value (or the file's `meta`) keeps
`{kind, source, url, licence, asOf}`, and `web/data/LICENSES.md` records each source's licence
and attribution. MetaHospital builds its files with `tools/build-data.mjs` and a daily refresh;
MetaAgri v2.0 uses one hand-curated `real.json` and adds the build script in v2.1.

## 5. App bar (Shared, with one addition)

A breadcrumb of places with the level name under each, and a collapsible **Simulation** drawer
for the demo controls (next step, play, speed, scenarios, restart, seed). Scenario buttons
appear only on the levels the scenario affects. **MetaAgri first:** a "Viewing as" role button
in the bar.

## 6. "Viewing as" lens (MetaAgri first)

A role is a **lens, not a login**: on a static site everything sent to the browser is public, so
a role presets its home level and, per level, shows everything, totals only, or a **Not shown**
placeholder that says why and who does see it. The placeholders are how the sharing hierarchy
becomes visible. Never call it access control. MetaAgri's roles: global crop analyst (World),
federal ministry (Country, the default), district & sharing network (District), farm manager
(Farm). MetaHospital equivalents: WHO analyst, federal ministry, Land/city health authority,
hospital director.

## 7. Sharing channels (MetaAgri first)

Data does not travel up one pipe: each channel has its own chain of authorities and legal basis
(MetaAgri: subsidies, water, animal health, plant health, statistics and markets, voluntary
sharing). `levels.js` holds them as `CHANNELS`, shown in the levels panel with this level's hop
highlighted. MetaHospital equivalents: ICU register (DIVI), notifiable diseases (IfSG),
hospital planning (KHG), Kleeblatt patient transfer, statistics.

## 8. Status vocabulary (MetaAgri first)

Shape + word + colour, never colour alone (`pill(text, tone)`, tones ok · warn · crit · mute).
MetaAgri uses published scales where they exist: GEOGLAM crop condition (Exceptional ·
Favourable · Watch · Poor · Out of season · No data), the European Drought Observatory (Watch ·
Warning · Alert), and for operations On track · Needs decision · Blocked by safety rules
(`web/src/ui/status.js`). MetaHospital's equivalent today: Normal · Busy/Watch · Critical by
utilisation band.

## 9. Engineering rules (Shared)

- Vanilla ES modules, no build step, no npm runtime dependencies; d3 + topojson from cdnjs.
- The engine never touches the DOM, `Math.random` or `Date`; a seed replays the same run.
- Markup only through `html`\`\` (escapes everything); colours only through CSS tokens (light and
  dark).
- Hash-token routes (the claude.ai artifact viewer drops anything else).
- Self-hosted fonts (Inter, SIL OFL); no third-party font hosts.
- `main` deploys to GitHub Pages on every push: develop on a branch, merge when verified.
- No real person's name or e-mail anywhere in the repos; organisation and site names of the demo
  are fictional.
