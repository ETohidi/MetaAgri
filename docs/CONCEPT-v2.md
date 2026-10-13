# MetaAgri v2: concept proposal

> Figures here are as researched on 7 Oct 2026. The checked figures the site shows are in
> `web/data/real.json`; some were updated since (e.g. FAO's 2025 update counts about 579 M farms
> worldwide, not 608 M).

*This proposal is for you to read and decide on. Nothing is built yet. It combines four research tracks run on 2026-10-07: data, hierarchy, scale and UI. All four reported, so nothing is missing. No files in either repo were changed. Labels used below: **[derived]** means our own calculation from the linked open data. **(estimate)** means an educated guess. Any number with neither label comes from the linked source.*

---

## 1. The idea in five sentences

1. MetaAgri v2 is a digital twin of how farm information really moves, from one field in the Oderbruch up to a global crop monitor. Each level shows only what its real decision-maker needs.
2. It serves eight roles, from a global crop analyst (the farming counterpart of WHO) through a federal ministry, a state ministry, the district authorities and a machinery-sharing network, down to the farm manager. A "Viewing as" switch changes what each level shows.
3. Above the farm, it shows real, cited statistics: farm counts, yields, drought, crop mix and river levels. At farm and field level it keeps today's seeded simulation on fictional farms. Every number carries a badge (Official, Estimated, Simulated, Unknown and so on), and the two kinds are never mixed.
4. Every boundary between levels shows its sharing rule: what goes up, what comes down, what peers see and what never leaves, each with its legal basis. Data travels through six real **channels**, each with its own chain of authorities: subsidies, water, animal health, plant health, statistics and markets, and voluntary sharing.
5. "All farms of the world" works in three tiers, so it stays a free static site on GitHub Pages:
   - real statistics for every country;
   - real anonymous field outlines where they are open;
   - made-up ("synthetic") farms, generated from a fixed seed only when the user zooms in.

---

## 2. The levels

**Recommendation: seven levels.** EU sits in the ladder but has no page yet, which is exactly what MetaHospital does. MetaHospital's current ladder is `world, eu, country, city, hospital, unit` (`MetaHospital/web/src/ui/levels.js`, `LEVEL_ORDER`).

The one deliberate difference is that MetaHospital's "city" level becomes two levels here, **Land** and **District**:
- Berlin is a city-state, so in the hospital twin the state and the city are one authority.
- In Brandenburg they are separate. The **Land** (state) pays the EU subsidies, runs the plant-protection service and manages the main rivers and dikes. The **District** (Landkreis Märkisch-Oderland) issues water bans and animal-disease zones and processes subsidy applications.

| Level (route) | Real-world meaning | Owner / user | Key decisions | Shared up | Shared down | With peers | Headline indicators (≤5) | Real example alert | Hospital analogue |
|---|---|---|---|---|---|---|---|---|---|
| **World** `#world` | ~200 countries; global food security | FAO, AMIS (G20 market-information system), GEOGLAM crop-monitor analyst [L1] | Crisis policy coordination (AMIS Rapid Response Forum); export bans must be notified to the WTO [L2] | nothing (top level) | Public reports: AMIS Market Monitor, Crop Monitor (monthly) | UN agencies; all members see one agreed assessment | Crop condition per country × crop; price anomalies; stocks; farms ≈608 M | Germany lost its WOAH "foot-and-mouth-free" status on 10 Jan 2025, and many non-EU countries stopped importing [L3] | WHO |
| **EU** (ladder only) | EU-27, CAP, single market | DG AGRI, JRC MARS (crop monitoring), DG SANTE | Crisis payments from the agricultural reserve (≥€450 M/yr); African swine fever zones (Reg. 2023/594); yield forecasts [L4] | to FAO, AMIS, WOAH | Zoning acts, MARS bulletins, drought maps | Non-EU partners in the EU food-crisis expert group (EFSCM) | MARS yield vs 5-yr average; European Drought Observatory Watch/Warning/Alert | Drought indicator "Alert" over a region [L5] | Health Security Committee / EU early-warning system |
| **Country** `#germany` | Germany, 16 Länder | Federal ministry BMLEH (called BMEL until May 2025), FLI (animal health), JKI (plant health), Destatis [L6] | Aid programmes (2018 drought aid €340 M) [L7]; national disease reporting | Eurostat, FAO, AMIS, EU animal-disease system ADIS | Federal law, aid frameworks | Other countries' aggregates only | 255,010 farms; drought per Land; wheat vs 5-yr average; harvest progress | First African swine fever case, 10 Sep 2020, district Spree-Neiße [L8] | Federal health ministry / RKI, ICU bed register |
| **Land** `#brandenburg` (new) | Brandenburg: 5,370 farms on 1.30 M ha | State ministry MLEUV, EU paying agency Brandenburg-Berlin, LELF (state agriculture office), LfU (state environment office) [L9] | Pays and checks CAP subsidies; pest warnings; flood alarm levels on main rivers | Statistics tables to Destatis and the federal ministry | Subsidy rules, pest and flood warnings | Other Länder via the conference of agriculture ministers | Farms and mean size (242 ha); yield vs Germany; districts in drought; irrigated share | Oder flood: alarm level 4 at Ratzdorf, Sep 2024 [L10] | "Land" half of MetaHospital's city level |
| **District** `#oderbruch` | Landkreis Märkisch-Oderland (MOL), including the Oderbruch polder | District water authority, vet office and agriculture office; water and dike association GEDO; machinery-sharing network | Bans on taking water; disease zones; pump water out or hold it; processes subsidy applications; brokers machines | Per-farm data only inside each channel (permits, herds, applications) | Public orders | Neighbouring districts, Berlin, the Polish side | 441 farms, 123,700 ha (2025); ban status; Oder gauge level; combines and silo space offered; drought cell | MOL ban on taking surface water since 2020 [L11]; foot-and-mouth zones near Hönow, Jan 2025 [L3] | "City" half (emergency coordination, ambulance dispatch) |
| **Farm** `#lerchenbruch` | One fictional farm | Farm manager | Crop plan; subsidy application; spray records (electronic from 2026, paper allowed until 1 Jan 2027) [L12]; approve or reject the daily plan | To each authority only what its channel needs | The approved plan | Only offers that expire ("combine free Tue", "280 t silo space") | Fields at risk; water used vs permit; harvest progress; silo space free; help needed | The Safety check blocks the plan (already in the twin) | Hospital director / bed manager |
| **Field** `#lerchenbruch.north` | One subsidy-system (IACS) parcel | Agronomist, field agent | Irrigate, spray, harvest, sow | Everything to its own farm | n/a | n/a | Soil moisture vs stress line; days to harvest; disease risk; yield estimate | Potato blight risk (already in the twin) | Unit / charge nurse |

Sources for the table:
- [L1] https://en.wikipedia.org/wiki/Agricultural_Market_Information_System · https://www.cropmonitor.org/crop-conditions
- [L2] https://www.wto.org/english/res_e/booksp_e/analytic_index_e/agriculture_02_e.htm
- [L3] https://www.berlin.de/aktuelles/9404482-958092-maul-und-klauenseuche-in-brandenburg-ber.html
- [L4] https://eur-lex.europa.eu/eli/reg_impl/2023/594/oj · https://joint-research-centre.ec.europa.eu/monitoring-agricultural-resources-mars_en
- [L5] https://drought.emergency.copernicus.eu/data/factsheets/factsheet_combinedDroughtIndicator.pdf
- [L6] https://www.bundesregierung.de/breg-de/bundesregierung/bundesministerien/bundeslandwirtschaftsministerium-aufgaben-kontakt
- [L7] https://www.topagrar.com/management-und-politik/news/bmel-bilanziert-starke-nachfrage-nach-duerrehilfen-10133006.html
- [L8] https://msgiv.brandenburg.de/sixcms/media.php/9/422_20_MSGIV_Nonnemacher_Afrikanische_Schweinepest_Ausbruch_20200910.pdf
- [L9] https://mleuv.brandenburg.de/mleuv/de/ · https://bravors.brandenburg.de/vertraege/lwstv
- [L10] https://www.nordkurier.de/regional/brandenburg/oder-hochwasser-landkreis-ruft-hoechste-alarmstufe-aus-2925900
- [L11] https://www.zfk.de/wasser-abwasser/wasser/wasserknappheit-entnahme-seit-jahren-verboten-thueringen-brandenburg-baden
- [L12] https://eur-lex.europa.eu/eli/reg_impl/2023/564/oj
- MOL figures: [district presentation, Feb 2026](https://www.maerkisch-oderland.de/_Resources/Persistent/7/7/4/a/774adc0271f57a9c05b8d91af81af69085d4e140/Pr%C3%A4sentation%20-%2003.02.2026%20-%20Landwirtschaft%20MOL%202025%20f%C3%BCr%20Internet%20-%20.pdf)

**Channels: data does not travel up one pipe.** In the levels panel, show each channel's chain from farm upward:

| Channel | Chain, farm upward | Legal basis |
|---|---|---|
| Subsidies and compliance | farm → district office → paying agency → federal ministry → DG AGRI | Recipients above €1,250 are published with their municipality ([Reg. 2021/2116 Art. 98](https://gesetze.legal/eu/vo_eu_2021_2116/98)) |
| Water | farm → district water authority + water board → state environment office | Federal and state water law |
| Animal health | farm → district vet office → state ministry → FLI → EU ADIS → WOAH | [ADIS](https://food.ec.europa.eu/animals/animal-diseases/animal-disease-information-system-adis_en); WOAH 24-hour notification rule |
| Plant health | farm → state plant-protection service → JKI → European Commission | [Reg. 2024/3115](https://eur-lex.europa.eu/eli/reg/2024/3115/oj) |
| Statistics and markets | farm → state statistics office → Destatis → Eurostat → FAO / AMIS | Only tables leave the statistics offices (statistical confidentiality law) |
| Voluntary sharing | farm ↔ machinery-sharing network, neighbours, buyers | [EU Code of Conduct on agricultural data sharing](https://www.cema-agri.org/publication/news/46-code-of-conduct-on-agricultural-data-sharing-sets-the-scene-for-digital-farming); EU Data Act, in force since 12 Sep 2025 |

**Suppression rule for the twin (estimate):** above District level, hide any aggregate built from fewer than 3 farms. This copies the minimum-case practice in German official statistics ([BA rules](https://statistik.arbeitsagentur.de/DE/Navigation/Grundlagen/Rechtsgrundlagen/Statistische-Geheimhaltung/Statistische-Geheimhaltung-Nav.html)). For agricultural statistics specifically, only the general confidentiality law was confirmed.

---

## 3. Users and what each sees

Roles are a **lens, not a login**. On a static site everything sent to the browser is public, so a role is a viewing preset. Anything outside the lens shows a "Not shown" placeholder that says why, and those placeholders are how the sharing hierarchy becomes visible. Real enforcement would need a backend (section 5).

| Role ("Viewing as") | Home level | Can drill into | Sees only aggregated | Cannot see |
|---|---|---|---|---|
| Global crop analyst (FAO / AMIS / GEOGLAM type) | World | Country | Country totals and condition classes | Anything below country level except public alerts |
| EU analyst (DG AGRI / JRC) | EU (shown on Country until EU has a page) | Member states, NUTS-2 regions | Regions | Farms |
| Federal ministry (BMLEH) | Country | Land; district disease map | Land and district totals; other countries' aggregates | Individual farms and fields |
| State ministry and paying agency (MLEUV) | Land | Districts; subsidy parcels, for payment and checks only | Districts | Farm finances, private machine data |
| District authority (water, vet, agriculture office) | District | Per-farm permits, water taken, herds, within its own channel only | Everything else | Crop plans, prices, finances |
| Water board (GEDO type) | District | Ditch and pump levels | n/a | Farm business data |
| Machinery-sharing network | District | Members' offers | n/a | Yields, finances |
| Farm manager (fictional farm) | Farm | Own fields and raw data | Neighbours' offers; public orders and warnings | Neighbours' internal data |

For v2.0 the switch can start with four of these: Global analyst, Federal ministry, District and sharing network, and Farm manager.

---

## 4. Data

### 4.1 Real sources per level

"Live" means a browser on GitHub Pages can fetch it (CORS was tested). "Build" means it is snapshotted to JSON by a scheduled GitHub Action.

| Level | Real sources (licence · grain · access) | Synthetic or educated guess |
|---|---|---|
| World | [FAOSTAT](https://www.fao.org/faostat/en/#data/QCL) (CC BY 4.0 · country × year · Build: the API needs a token and the bulk ZIP has no CORS) · [World Bank WDI](https://data.worldbank.org/indicator/AG.YLD.CREL.KG) (CC BY 4.0 · Live) · [OWID farm size and count](https://ourworldindata.org/grapher/number-of-farms) (CSV · Live) · [GEOGLAM Crop Monitor](https://cropmonitor.org/) (monthly, sub-national classes · Build; licence not verified) | A country with no data shows "Unknown", never 0 |
| EU | [Eurostat API](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ef_m_farmleg?geo=DE40&geo=DE&geo=EU27_2020&time=2023&farmtype=TOTAL&so_eur=TOTAL&leg_form=TOTAL) (NUTS-2 · Live) · [GISCO NUTS boundaries](https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2021_4326_LEVL_3.geojson) (Live; commercial use needs a EuroGeographics licence) · [JRC MARS](https://agri4cast.jrc.ec.europa.eu) (PDF · Build) · [Drought Observatory CDI](https://drought.emergency.copernicus.eu/) (~5 km, 10-daily; WMS returned 502 at test time) · [EU agri-food prices](https://agridata.ec.europa.eu/Extensions/DataPortal/API_Documentation.html) (CORS header empty · Build) | none |
| Country | [Destatis GENESIS](https://destatis.de/EN/Service/OpenData/api-webservice.html) and Regionalstatistik (DL-DE BY 2.0 · token kept as a CI secret · Build) · [DWD CDC](https://opendata.dwd.de/climate_environment/CDC/Terms_of_use.pdf) (CC BY 4.0, 1 km grids · Build; [Bright Sky](https://api.brightsky.dev/weather?lat=52.6&lon=14.4&date=2025-06-01) proxy is Live) · [UFZ Drought Monitor](https://www.ufz.de/index.php?en=37937) (data licence unclear) | "Requests from Länder" panel = Illustrative |
| Land | [Statistik Berlin-Brandenburg](https://www.statistik-berlin-brandenburg.de/c-ii-2-j) (yields, farm structure · Build) · [geobasis-bb IACS 2026 parcels](https://data.geobasis-bb.de/geofachdaten/Landwirtschaft/) (288,938 records, **no farm ID**, DL-DE BY 2.0 · Live) · [harmonised PMTiles](https://data.source.coop/ftw/harmonized-field-data/de_bb/README.md) (290,688 fields, 53.5 MB · Live, range requests work) · erosion, peat and drainage-ditch layers (same portal) | none |
| District | [DFBK field blocks](https://data.geobasis-bb.de/geofachdaten/Landwirtschaft/dfbk.zip) (district totals) · [PEGELONLINE Oder gauges](https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=ODER) (Kietz, Kienitz, Hohensaaten · DL-DE Zero · Live) · [Open-Meteo ERA5](https://open-meteo.com/en/docs/historical-weather-api) (CC BY 4.0; the free tier is **non-commercial** · Live) · [SoilGrids](https://rest.isric.org/soilgrids/v2.0/properties/query?lon=14.35&lat=52.65&property=clay&property=sand&property=soc&property=phh2o&depth=0-5cm&depth=30-60cm&value=mean) (250 m, slow) · [Sentinel-2 L2A](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a) (10 m · Live, range requests) | Water-board pump status = Simulated |
| Farm / Field | **No open data exists.** Farm identity and finances are confidential: the [EU farm accounts network (FADN)](https://agridata.ec.europa.eu/extensions/FarmEconomyFocus/FADNDatabase.html) publishes only group averages, and the IACS file has no holder | Everything is Simulated, but calibrated on real figures: state yields, [LELF production costs](https://lelf.brandenburg.de/sixcms/media.php/9/Datensammlung-2021-web.pdf), [combine cost €213/ha (KTBL)](https://www.topagrar.com/betriebsleitung/news/die-kosten-fur-den-mahdrusch-senken-20025139.html) |

### 4.2 Real headline numbers

| Scope | Figure | Source |
|---|---|---|
| World farms | More than 608 M; 84 % are under 2 ha and farm ~12 % of farmland; the largest 1 % run more than 70 %. An alternative count is 656 M (2020) | [FAO / Lowder 2021](https://www.fao.org/agrifood-economics/publications/detail/en/c/1252236/) · [CGIAR](https://www.cgiar.org/research/publication/farms-worldwide-2020-and-2030-outlook) |
| World fields | ~1.55 bn field outlines for 2025 and ~1.62 bn for 2024 (~3.2 bn across both years), 219-241 countries, CC BY 4.0, machine-learning output | [FTW](https://source.coop/ftw/global-data/predictions/vectors/llms.txt) |
| World irrigation | ~20 % of cropland is irrigated and gives ~40 % of food | [FAO](https://www.fao.org/fileadmin/user_upload/faowater/docs/FAOWfactsheet.pdf) |
| EU 2023 | 8.8 M holdings, 156.2 Mha, mean 17.8 ha; 7.6 % of farms (≥50 ha) hold 68.3 % of the land | [Eurostat](https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Farms_and_farmland_in_the_European_Union_-_statistics) |
| Germany 2023 | 255,010 holdings, 16.59 Mha, mean 65 ha | [Eurostat API](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ef_m_farmleg?geo=DE40&geo=DE&geo=EU27_2020&time=2023&farmtype=TOTAL&so_eur=TOTAL&leg_form=TOTAL) |
| Brandenburg 2023 | 5,370 holdings, 1,297,550 ha, **mean 241.6 ha**; farms of 100 ha or more are 39.5 % of holdings and hold 93.3 % of the land | same |
| Brandenburg yields 2025 (dt/ha) | Wheat 63.2 (Germany 78.3) · rye 41.9 · winter barley 63.0 · rapeseed 27.6 · grain maize 77.9. Germany's 2025 figures are still provisional | [Statistik BB](https://download.statistik-berlin-brandenburg.de/2ab9491d4ad6b87d/98cade627095/SB_C02-02-00_2025j01_BB.pdf) |
| Prices, week of 28 Sep 2026 | Milling wheat €210-235/t; rapeseed ≈€519/t (ex-silo wholesale, not farm-gate) | [EU agri-food API](https://api.tech.ec.europa.eu/agrifood/api/cereal/prices?memberStateCodes=DE&beginDate=01/07/2026&endDate=06/10/2026) |
| Irrigation 2022 | Brandenburg 30,900 ha (≈2.4 % of farmland **[derived]**); Germany 554,000 ha (3.3 %) | [Destatis](https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/05/PD24_186_41.html) |
| Oderbruch crop mix 2026 **[derived]** | Wheat 23.1 %, winter barley 12.5 %, silage maize 12.2 %, rapeseed 8.4 %, grain maize 7.3 %; **potatoes ≈0.3 %** | [IACS parquet](https://data.source.coop/ftw/harmonized-field-data/de_bb/year=2026/de_bb.parquet), box 14.15-14.65 E / 52.45-52.85 N (larger than the Oderbruch itself) |
| Oderbruch fields **[derived]** | Median 6.3 ha, mean 13.7 ha. So a 242 ha farm has roughly 18-28 fields | same |
| Oderbruch climate 1991-2020 **[derived]** | 587 mm rain vs 747 mm reference evapotranspiration, a deficit of about 160 mm/yr; 2018: about 450 mm | [Open-Meteo query](https://archive-api.open-meteo.com/v1/archive?latitude=52.65&longitude=14.35&start_date=1991-01-01&end_date=2025-12-31&daily=precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean&timezone=Europe/Berlin) |

### 4.3 Honesty notes

- **Real parcels and simulated numbers do not mix.** The IACS parcel file is anonymised, but CAP recipients above €1,250 are published with their municipality ([Art. 98](https://gesetze.legal/eu/vo_eu_2021_2116/98)). Simulated numbers drawn on real parcels could therefore read as claims about real farmers who can be found. Real parcels should carry only their official attributes (crop and area). Simulated values stay on fictional shapes.
- **The demo is not typical of the region:**
  - Hof Lerchenbruch is 96 ha in 3 fields, while the real Brandenburg mean is 242 ha in about 18-28 fields **(estimate)**.
  - Its River field grows potatoes, which cover only ~0.3 % of the Oderbruch.
  - No Brandenburg Maschinenring (machinery ring) could be verified. The federal figures are 230 rings, 178,000 member farms and 40 % of German farmland ([maschinenring.de](https://www.maschinenring.de/ueber-uns)); my own search found nothing for Brandenburg either. Contractors may matter more in the east **(estimate)**.
- **Conflicts between sources, left unresolved on purpose:**
  - Oderbruch area: 780 km² ([de.wikipedia](https://de.wikipedia.org/wiki/Oderbruch)) vs ~920 km² ([en.wikipedia](https://en.wikipedia.org/wiki/Oderbruch)). The UI track's 640 km² is unsupported and dropped.
  - Brandenburg farms: 5,370 (Eurostat 2023) vs ~5,400 (state statistics office) vs 5,200 (2025 press release, survey unclear).
  - Machinery-ring membership: 178k vs 183k vs 200k vs "about 60 % of farmers", depending on the source.
- **Unverified:**
  - GEDO's "35 pumping stations" (only seen in a search snippet).
  - Licences for SoilGrids, the Drought Observatory, GEOGLAM, OWID and the UFZ data.
  - The 2026 organisation of LELF and the paying agency after the Brandenburg reorganisation.
- **Licences that restrict commercial use:** FAO GAEZ (non-commercial), the Open-Meteo free tier (non-commercial), and GISCO (commercial use needs a EuroGeographics licence).
- **Outdated names to fix:** BMEL is now BMLEH, and Brandenburg's MLUK is now MLEUV.

---

## 5. "All farms of the world"

**Why one record per farm will not work:**
- 608 M farms at ~100 bytes each is ≈61 GB **(estimate)**. GitHub Pages allows a 1 GB site and about 100 GB of traffic a month ([GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
- No global farm register exists, and farm identity is confidential even where field outlines are open.

**Recommended architecture: three tiers.**

| Tier | What is shown | Where | Data | Hosting |
|---|---|---|---|---|
| 1. Real statistics | Farm counts, size classes, yields, condition class | Every country and region | FAOSTAT / agricultural censuses, Eurostat, OWID | Under 1 MB of JSON in the repo, written at build time |
| 2. Real anonymous fields | Field outlines with their official crop | Brandenburg first; other places where data is open; optional worldwide machine-learning layer | IACS via FTW (53.5 MB PMTiles); FTW global (268 GB PMTiles) | Streamed from source.coop (CORS and range requests verified), never copied into the repo |
| 3. Synthetic farms | Seeded farms per map tile or H3 hexagon, matching the real size classes and adding up exactly to the real totals | Generated when the user zooms in | Tier-1 statistics plus cropland density | Generated in the browser, nothing stored |

**What is drawn at each zoom, and how detailed the simulation is:**

| Zoom | What is drawn | Simulation |
|---|---|---|
| 0-3 | Countries coloured by crop-condition class | Monthly classes (like GEOGLAM) |
| 4-6 | NUTS-2 regions | 10-day steps (like FAO's ASIS drought system) |
| 7-9 | 25 km grid cells or H3 cells with farm counts | Daily soil-water bucket per cell (like JRC MARS) |
| 10-12 | Real parcels plus synthetic farm points, only when fewer than ~2,000 are in view | Light state for visible synthetic farms |
| 13+ | Farm and field pages | Full engine for the farm in focus |

**Switch to grouped cells by farm density, not only by zoom.** Brandenburg has 242 ha per farm, India [1.08 ha per farm](https://affairscloud.com/10th-edition-of-agriculture-census-data-for-2015-16-released-by-agriculture-ministry). The same 50 km view would hold ~500 synthetic farms in Brandenburg but ~100,000 in India **(estimate)**.

**How it stays deterministic:** randomness is keyed by `(seed, entity, day)`. A farm is created lazily: opening it on day 60 replays 60 cheap daily steps. Visited farms are kept in a size-limited cache.

**Hosting options:**

| | A. Pure static (Pages + open APIs) | B. Static + Cloudflare Worker / R2 storage | C. Small backend (VPS + PostGIS) |
|---|---|---|---|
| Cost and operations | €0, nothing to run | €0 on the [free tier](https://developers.cloudflare.com/workers/platform/limits/) (100k requests/day, R2 10 GB) | A few €/month, plus patching and GDPR duties |
| All farms of the world | Yes, via the three tiers | Yes, plus our own tiles | Yes |
| Secrets (FAOSTAT token, LLM key) | No (the build-time Action holds tokens) | Yes | Yes |
| Shared state (approvals seen by several people) | No | Yes | Yes |
| **Enforced** roles | **No, roles are presets only** | Basic | Full |

**Recommendation: A now.** Route every data access through one `data/` module, so B can be swapped in later without touching the views. Choose C only if roles must really be enforced.

**Pitfalls (verified):**
- The Brandenburg tiles drop fields at zoom 4-9, so region totals must be computed offline, never by counting fields in tiles.
- GitHub Pages gzips `.pmtiles` files. It still works because browsers send `Accept-Encoding: identity` with range requests, but this must be tested in every browser.
- source.coop is a third party with no service guarantee, and the FTW data is an early ("alpha") machine-learning output.
- The claude.ai artifact build probably cannot fetch from source.coop or Eurostat, so it would need an embedded offline subset.

---

## 6. UI direction

### Main problems

Measured on the live site at 1440×900 and 390×844.

1. **Structure (the root cause).** The five levels zoom through the geography of one farm's story; they are not levels for different decision-makers.
   - Earth and Germany give a visitor nothing to act on.
   - Germany shows "2 of 3 combines free" at national scale.
2. **Overload.**
   - The farm page has 785 words and about 22 cards.
   - On a phone it is 5,101 px tall (6 screens), with the Approve button about 4,080 px down.
   - The sticky top bar takes 185-212 px, which is 22-25 % of the phone screen.
3. **Repetition and contradiction.**
   - Each field's soil moisture is shown 3 times.
   - During the heatwave, the heatwave is shown 4 times, and Germany says "All 3 farms normal" next to a red "permit cut".
   - One farm shows 330 t of silo space free on the map but 280 t in its card. The 50 t reserve is never explained.
4. **Engine-speak.** "ET₀ 4.2 mm", an unlabelled "0.85", "Health 0.86", "census", "proposed 1 action(s)". The developer chips ("seed 20260707") and red scenario buttons appear at every level, Earth included.
5. **Mixed status colours.** Normal/Watch/Critical combines soil moisture with silo fill. "Ring" means both the legend's highlight ring and the Machinery ring.

**Keep:** the earthy colour tokens, dark mode, plan rows in plain English, before-to-after deltas, approve or reject with a reason, and the structure of the field page.

### Target layout

Every level uses the same page anatomy, matching MetaHospital's `page.js` and `levels.js`:
1. **Top bar:** ladder with level names (not km), "Viewing as", demo day and a Scenarios menu.
2. **Page head:** level pill, place, an H1 that is the **question the page answers**, a "May see / Never" line, one status pill, and provenance with freshness.
3. **Five KPI tiles,** each with a badge (Live, Official, Estimated, Simulated, Illustrative, Not shown, Unknown, Stale).
4. **Stage plus rail.** The stage toggles map, tiles or table. The rail holds Needs attention, Shared with me and Shared by me.
5. **Collapsible panels:** "Who uses this level and what crosses its boundary" (with channels and legal basis), then Sources.

**Status vocabulary (shape + word + colour, never colour alone):**

| Used for | Vocabulary | Source |
|---|---|---|
| Crop condition, World to District | Exceptional / Favourable / Watch / Poor, plus Out of season and No data; drivers Dry, Wet, Hot, Cold | [GEOGLAM](https://www.cropmonitor.org/global-classification-system) |
| Drought | Watch / Warning / Alert | [Drought Observatory](https://drought.emergency.copernicus.eu/data/factsheets/factsheet_combinedDroughtIndicator.pdf) |
| Farm operations | On track / Needs decision / Blocked by safety rules | new |

### Wireframes

**W1. Country page, federal-ministry lens, with the role menu open**
```
+------------------------------------------------------------------------------------+
| MetaAgri  World > [EU] > Germany > Brandenburg > Oderbruch > Farm > Field          |
|           Viewing as [Federal ministry v]          Demo day Mon 6 Jul [>] [Scenarios v]
+------------------------------------------------------------------------------------+
| COUNTRY . Germany                                (!) 1 Land: Warning  Official . Sep|
| Are soils and crops OK across the Lander, and where may we need to step in?        |
| May see: Land totals, district bands.  Never: single farms or fields.              |
+-----------+-----------+-----------+-----------+-----------+------------------------+
| Topsoil   | Wheat vs  | Harvest   | Farms     | Requests  | NEEDS ATTENTION        |
| drought   | 5-yr avg  | progress  | 255,010   | from      |  Brandenburg . Warning |
| n % area  | n %       | n %       | (2023)    | Lander: n |  . Dry -> open         |
| Official  | Estimated | Official  | Official  | Illustr.  | SHARED WITH ME         |
+-----------+-----------+-----------+-----------+-----------+  PL Watch.Dry  CZ Fav. |
|   16 Lander tile grid, colour = drought band     [Tiles|Map|Table] | SHARED BY ME  |
|                                                                    |  Eurostat, FAO|
| > Who uses this level and what crosses its boundary   > Sources                    |
+------------------------------------------------------------------------------------+
 Viewing as v   ( ) Global crop analyst  home: World
                (*) Federal ministry     home: Germany
                ( ) District & sharing network home: Oderbruch
                ( ) Farm manager (fictional farm) home: Farm
                A lens for the demo, not a login.
```

**W2. District page: Oderbruch, district and sharing-network lens**
```
| DISTRICT . Markisch-Oderland / Oderbruch . Viewing as: District & network  Sim+Official|
| Which farms need help today, and who can lend it?                                    |
| May see: each farm's status and voluntary offers.  Never: fields, finances.          |
+------------+------------+------------+------------+------------+-------------------+
| Farms need | Combines   | Silo space | Water ban  | Oder at    | REQUESTS & OFFERS |
| help 1 / 3 | free 2 / 3 | 1,030 t    | in force   | Kienitz    |  Hof L. needs a   |
| Simulated  | Simulated  | Simulated  | Simulated  | Official*  |  combine Tue      |
+------------+------------+------------+------------+------------+  Gut R. offers    |
| Map: Oderbruch outline, Oder, 3 fictional farm pins; real parcels |  combine + 470 t  |
| as grey background coloured by OFFICIAL crop only (v2.2)          | SHARED UP         |
| Farm (fictional)  Status          Can lend        Needs           |  status bands ->  |
| Hof L.            Needs decision  280 t (50 t kept back) combine  |  Land             |
```
*Snapshot from PEGELONLINE in v2.1.

**W3. Farm page, farm-manager lens (decision first), with the phone version**
```
| FARM . Hof Lerchenbruch (fictional) . Viewing as: Farm manager   Simulated . Mon 6 Jul|
| What should we do today?          Today 25 C dry . Tue 7.5 mm . Wed 27 C          |
+---------+---------+---------+---------+---------+---------------------------------+
| Fields  | Water   | Harvest | Silo    | Help    | PLAN FOR MON 6 JUL [Needs you]  |
| at risk | 6,000 / | 0 of 3  | 330 t   | none    | 1 Irrigate River 25 mm          |
| 1 of 3  | 6,500 m3| fields  | free    | needed  |   6,000 m3 . confidence high    |
+---------+---------+---------+---------+---------+ 2 Scout West (rapeseed ripe)    |
| Field map (fictional shapes) + field list:     | Safety rules: 2 of 2 OK         |
| crop . moisture vs stress line . days to harvest| [Approve] [Reject: reason v]    |
| > Why this plan  > Team log  > Notices          | Will be told: neighbours (1)    |

Phone 390 px:  [< Oderbruch  Hof L.  ...]  (one row, ~56 px)
               question . KPIs 2 per row . field list
               [ Plan waiting . 2 actions  > ]  (sticky bottom sheet)
```

### Quick wins (hours to 1-2 days each, no engine change)

| # | Change | Where |
|---|---|---|
| 1 | Put the scenarios in a neutral "Scenarios" menu shown only at District, Farm and Field. Move the seed and "Rule-based agents" into an "About this demo" popover | `web/src/main.js` top bar |
| 2 | Show level names under each breadcrumb place instead of km and ha | `main.js`, `maps.js` |
| 3 | Make every H1 the question its level answers; add the "May see" line; show one status pill per page (remove the duplicate chips) | `maps.js`, `farm.js`, `field.js` |
| 4 | Plain language: confidence as high/medium/low, "Crop health good (86/100)", "Crop water use 4.2 mm/day" with a glossary tip, a plain team log | `farm.js`, `field.js` |
| 5 | Drop the "flower" or put it behind a toggle (it repeats the map and the cards); shrink the weather to one line | `farm.js` |
| 6 | Explain "330 t free, 280 t can share (50 t kept back)"; rename the "Ring" legend | `maps.js` |
| 7 | Fix label collisions: the Oderbruch callout on the Germany map, the stress-line label on the field chart | `maps.js`, `field.js` |
| 8 | Phone: one-row sticky bar and a "Plan waiting" bottom sheet | `styles/` |

---

## 7. Phased plan

| Version | Scope | What it proves |
|---|---|---|
| **v2.0** (3-5 days; GitHub Pages; no new libraries; the artifact build still works) | Quick wins 1-8. New ladder World · EU (greyed) · Country · Land (greyed, "coming in v2.1") · District · Farm · Field, with `#earth` redirecting to `#world`. The page anatomy from section 6. A `levels.js` with **the same fields as MetaHospital's** (user, decides, up/peers/never plus legal basis, cadence, kpis) and a test that every level fills every field. Provenance badges. Status vocabulary. "Viewing as" with 4 roles and "Not shown" placeholders. A hand-curated `data/real.json` with about 20 headline numbers from section 4.2, each stamped with source, retrieval date and licence | The sharing hierarchy is understandable in 10 seconds. Real and simulated numbers are visibly separated. The UI no longer "looks bad" |
| **v2.1** (1-2 weeks) | `tools/build-data.mjs` plus a monthly GitHub Action that writes stamped JSON snapshots. World: choropleth plus table (condition class or yield anomaly). Germany: a 16-Länder tile grid (drought, yield). A new `#brandenburg` page with a district map. District: Oder gauge, crop mix computed offline from IACS, climate water balance. The channels in the levels panel. Rule-based Vet office and Water board notices. Demo realism: replace potatoes, give the farm a realistic size (3 focus fields plus "other fields" as one aggregate), rename the ring to "machinery-sharing network" | Real data above the farm, with freshness and "Unknown, never 0". The channel model works. The demo matches the real region |
| **v2.2** (2-3 weeks) | MapLibre (~249 KB gzipped) and pmtiles (8 KB), loaded only at District zoom. Real Brandenburg parcels coloured by official crop only. `engine/synth.js` with seeded synthetic farms per tile, plus tests that totals match Eurostat size classes and that the same seed gives the same farms. A 25 km grid bucket model at Land level in a Web Worker. An optional FTW world-fields toggle. Performance budget: LCP ≤2.5 s, ≤500 KB per zoom change, ≤50 ms per simulated day ([web.dev](https://web.dev/articles/vitals)) | "All farms of the world" works without a backend |
| Later, only if needed | A Cloudflare Worker for secrets, LLM-written explanations (the Safety check stays the gate) or shared approvals. A backend only for enforced roles | n/a |

---

## 8. Decisions needed from you

| # | Decision | Recommended default |
|---|---|---|
| 1 | **Ladder:** 7 levels with District separate, or 6 levels to match MetaHospital's merged city level? | **7 levels.** In Brandenburg the Land and the district hold different real powers. EU stays ladder-only, as in MetaHospital |
| 2 | **Roles and landing page:** a "Viewing as" lens or real logins? Open on Germany (ministry) or on the farm? | **A lens, no login**, because the site is static. **Open on Germany with the ministry lens**, as MetaHospital does, with a visible "Follow the farm manager" entry for the demo story |
| 3 | **Real parcels and demo realism:** show real IACS parcels? Change the demo farm? | Show real parcels **only with their official crop and area, never with simulated numbers**; the demo farm's fields stay fictional shapes. Replace potatoes with grain maize; scale the farm to Brandenburg size (3 focus fields plus an aggregate); rename the ring to "machinery-sharing network" |
| 4 | **Data refresh and licences:** does a scheduled GitHub Action that snapshots data still count as "no backend"? Is commercial use ever planned? | **Yes**, a monthly snapshot Action is acceptable. Live APIs only behind a "Live data" switch, so a seed still replays the same day. **Assume non-commercial use** (Open-Meteo free tier, GAEZ, GISCO) and revisit before any commercial use |
| 5 | **Libraries and artifact build:** allow MapLibre and pmtiles as a third library? | **Yes, from v2.2**, loaded only at District zoom (pmtiles comes from jsDelivr, not cdnjs). The claude.ai artifact build stays an offline subset without the parcel layer |
| 6 | **Alignment with MetaHospital:** share code or a written spec? | **A written spec now**: page anatomy, badges, the level-model fields and the role switcher, designed once for both twins. Share code only after MetaHospital's redesign settles (its `real.js` is still missing and some colour tokens are undefined) |
