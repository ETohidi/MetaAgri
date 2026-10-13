# MetaAgri demo (5 minutes)

MetaAgri shows how farm information moves, from the whole world down to one field. It has
seven levels: World, EU, Country, Land, District, Farm and Field. EU and Land are in the
breadcrumb but have no page yet; the Land page comes in v2.1. Above the farm every number
is a real, published figure with its source and date. The farms are fictional, and
everything about them is simulated. A badge on each number (Official, Estimated, Simulated,
Not shown, Unknown) says which kind it is, and the two kinds never share a tile.

## Start

Open https://etohidi.github.io/MetaAgri/, or run it locally:

```bash
cd web && npm run serve
```

Then open http://127.0.0.1:8092. The page opens on **Germany**, viewed as the **Federal
ministry**. The season always starts the same way (seed 20260707): Monday 6 July, with the
first plan already waiting for the farm manager. Every number below is what that seed
shows. **Simulation → Restart season** replays it.

"Viewing as" is a lens, not a login. A static site cannot hide anything from a browser, so a
role only chooses the home page and what each level shows: everything, totals only, or a
"Not shown" box that says why. Those boxes are how the sharing rules become visible.

## 1. The ministry's view (real data)

1. **Germany, as the Federal ministry.** The heading is the question the page answers: "How
   big are Germany's farms, how much land is watered, and how does Brandenburg compare?".
   The line below it says these are real published statistics and that the demo farms never
   change them. The five tiles are all **Official**: 255,010 farms, a mean farm size of
   65 ha, 16.6 M ha of farmland, 3.3 % irrigated (2022) and a wheat yield of 78.3 dt/ha
   (2025). Each tile compares with Brandenburg, for example 241.6 ha mean size, 3.7 times
   as big.
2. **The map.** Brandenburg is highlighted. Its card shows 5,370 farms, with 93.3 % of the
   farmland on farms of 100 ha or more, and "Page coming in v2.1". Click any other Land: it
   shows **Unknown**, never 0, because per-Land tables arrive with the v2.1 data refresh.
3. **Needs attention** lists a real public order: the district's ban on taking surface
   water, in force since 2020. Drought per Land is **Unknown** until v2.1.
4. Scroll to the bottom. **Who uses this level, and what crosses its boundary** names the
   users, what goes up, to peers and never, each with its legal basis, and the channels that
   pass through this level (subsidies, animal health, plant health, statistics). **Data &
   sources** lists every figure with its licence and link.

## 2. Switch lenses

5. **Click the Oderbruch pin.** The District page opens, still as the ministry. The ministry
   sees only totals: 0 of 3 demo farms need help, 2 of 3 combines are free to lend and 880 t
   of silo space is offered (all **Simulated**), next to the real ban (In force) and the
   district's 441 farms on 123,700 ha (**Official**). The farm-by-farm table is **Not
   shown**, with the reason.
6. **Viewing as → District & sharing network.** Now the table appears. Hof Lerchenbruch:
   Favourable, Needs decision, can lend its combine and "280 t (50 t kept back)", with 330 t
   free. Gut Rohrdommelsee: its combine and 470 t. Agrarhof Oderblick: no combine, 130 t.
   The 50 t each farm keeps for its own harvest is now explained, not hidden.
7. Optional: **Viewing as → Global crop analyst** opens the World page with five Official
   tiles (about 579 M farms, 85 % under 2 ha, 9 % of farmland on those small farms,
   20 % of cropland irrigated and 40 % of food grown on it).

## 3. Follow the farm manager (simulated)

8. Click **Follow the farm manager** in the app bar (or on the Country page). The lens
   switches to Farm manager and Hof Lerchenbruch opens: "What should we do today?", with
   the weather on one line (today 25 °C and dry, Tue 7.5 mm rain). All five tiles are
   **Simulated**: 1 of 3 fields at risk (River, near its stress line), 6,000 of 6,500 m³
   water in the plan, 0 of 3 fields harvested, 330 of 450 t silo free, no help needed.

Open **Simulation** in the app bar for Next day, Play, Heatwave, Hail warning and Restart
season. The scenario buttons appear only on District, Farm and Field.

### Act 1: a normal day

9. The **Plan for Mon 6 Jul** sits at the top of the right column: Scout West field, and
   Irrigate 25 mm on River field (6,000 m³ water, 1 worker), both with high confidence.
   "Safety rules: 2 of 2 OK"; Water 6,500 → 500 m³, Workers 5 → 4. Click **Approve plan**.
   The toast reads "Plan approved. 1 notice went out to buyers and neighbours." River goes
   from 62 % to 87 %, and **What buyers & neighbours see** has "Irrigation running on River
   field today (25 mm) — the field track may be wet."

### Act 2: heatwave

10. **Simulation → Heatwave.** A strip marked Simulated reads "Heatwave: water permit cut to
    3,600 m³/day, 4 days left".
11. **Next day.** The page head now says **Blocked by safety rules**. The Plan for Tue 7 Jul
    only scouts North and West; "Safety rules: 2 of 3 OK, 1 blocked" lists "Irrigate 25 mm
    on River field: Irrigation must stay within today's water permit." Choose **Wait for
    better weather** and click **Reject**.
12. **Next day.** In the Plan for Wed 8 Jul, River asks for **Irrigate 15 mm** (3,600 m³), and
    the row says why: "Fitted to today's 3,600 m³ water permit. Remembers your reason: “Wait
    for better weather”." The heat has also ripened the wheat and the rapeseed, so the plan
    harvests too. Act 3 tells that part better.

### Act 3: hail warning

13. **Restart season**, then **Approve plan** (the same Monday as step 9).
14. **Simulation → Hail warning.** The strip reads "Hail warning: severe hail expected Wed
    8 Jul. Harvest ripe crops before it hits." The weather line now ends "Wed 27 °C, hail
    storm".
15. **Next day.** Fields at risk: 2 of 3 (North and West: ripe crop, hail expected). The Plan
    for Tue 7 Jul has three actions:
    - Harvest ~324 t on North field, with our combine and 2 workers (high confidence);
    - Harvest West field with Gut Rohrdommelsee's combine (~114 t), through the sharing
      network (medium confidence);
    - Deliver 108 t to Gut Rohrdommelsee, because ~438 t is coming in and only 330 t is free.

    Workers 5 → 2, Combine 1 → 0, Silo free 330 → 0 t. "If you approve, they are told:
    buyers (2), Gut Rohrdommelsee (2)." The Team log shows why: "conflict: the combine was
    requested by North field and West field; kept North field (€71k at risk vs €52k), West
    field waits". Click **Approve plan**: "Plan approved. 4 notices went out to buyers and
    neighbours." The silo is full (0 of 450 t; the tile says it can lend 0 t now, against
    this morning's offer of 140 t), and on the District page Gut Rohrdommelsee's free space
    drops from 507 t to 399 t.
16. **Next day.** The hail hits on Wed 8 Jul: "Hail hit River field: potato leaves shredded,
    crop health down 8 points (of 100)". The wheat and rapeseed are safe in the silo; both
    agents wait: "Wheat stubble too wet after 24.0 mm rain; drilling the cover crop once the
    soil dries."

## 4. Down to a field, across to a neighbour

17. Click **River field** in the field list. "What does this field need next?": soil
    moisture day by day with a 3-day projection against the stress line, crop health "Good
    (90/100)", disease risk, harvest and yield estimate, all Simulated. "What the field agent
    reads" shows the exact inputs its agent sees.
18. Open **Gut Rohrdommelsee** from the District page. As the farm manager you see only its
    offers and their history; its soil and status are its own. Under the Federal ministry
    lens the District page has no farm pins at all, and a farm page opened by its address
    (`#rohrdommelsee`) shows every tile as **Not shown**, with a "Follow the farm manager"
    button.

**Play** advances the season by itself (1×, 2× or 4×). It holds while you type a rejection
reason. A plan nobody decides on expires when the next day starts.

## What this demonstrates

- **Seven levels, one anatomy.** Every page has the same head (the question it answers, what
  this role may see, one status pill), five tiles, a main column and rail, the levels panel
  and the sources.
- **Real and simulated, never mixed.** Real figures above the farm carry Official or
  Estimated with source, date and licence; the fictional farms carry Simulated. A missing
  figure is Unknown, never 0.
- **The sharing rules are visible.** Each lens shows what that role may see; the rest is a
  "Not shown" box that says why, and the levels panel names each channel and its legal
  basis.
- **Agents propose, a person decides.** Rule-based field agents propose the day's work, the
  Coordinator bundles it, the safety rules block what is unsafe or illegal, the sharing
  network lines up a neighbour's combine or silo, and nothing changes until the farm manager
  approves.
- **Feedback changes the plan.** A rejection reason goes back to the field agents, and the
  next plan says so.
