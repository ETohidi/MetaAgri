# Data licences

`real.json` in this folder is hand-curated for v2.0 (from v2.1, `tools/build-data.mjs` refreshes
it). Every value in it carries its own provenance record
`{value, unit, label, kind, source, url, licence, asOf, note}`, so each number on a page can name
its source. `kind` is `Official` (published by the source) or `Estimated` (our own calculation
from open data, or a machine-learning estimate). Simulated numbers about the fictional demo farms
never enter this file. The data keeps the licence of its source; MetaAgri is a non-commercial
demo, and two sources below allow only non-commercial use.

All values were checked against their sources on 13 October 2026.

| Values (`real.json` keys) | Source | Licence | Attribution |
|---|---|---|---|
| `world.farms`, `world.smallFarmsShare`, `world.smallFarmsLandShare` | FAO Agricultural Development Economics Working Paper 25-14 (2025), A global update on the number of farms, farm size and farmland distribution, background paper for The State of Food and Agriculture 2025. https://openknowledge.fao.org/handle/20.500.14283/cd7373en | CC BY 4.0 | Lowder, S.K., Arslan, A., Cabrera Cevallos, E., O'Neill, M. and De La O Campos, A.P. 2025. FAO, Rome. |
| `world.irrigatedCroplandShare`, `world.irrigatedFoodShare` | FAO: The State of the World's Land and Water Resources for Food and Agriculture 2021, synthesis report. https://doi.org/10.4060/cb7654en | CC BY-NC-SA 3.0 IGO (non-commercial) | FAO. 2021. The State of the World's Land and Water Resources for Food and Agriculture: Systems at breaking point. Synthesis report 2021. Rome. |
| `world.fields2025` | Fields of The World (FTW), global field boundaries 2024-2025, on Source Cooperative. https://source.coop/ftw/global-data | CC BY 4.0 | Fields of The World, sponsored by Taylor Geospatial, with Microsoft AI for Good, ASU, WashU in St. Louis, Oregon State and Clark. Machine-learning output (alpha). |
| `eu.farms`, `eu.meanSizeHa`, `eu.largeFarmsLandShare` | Eurostat Statistics Explained: Farms and farmland in the European Union - statistics (farm structure survey 2023). https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Farms_and_farmland_in_the_European_Union_-_statistics | CC BY 4.0 (Eurostat copyright notice: reuse authorised with the source acknowledged) | © European Union, Eurostat. |
| `de.farms`, `de.meanSizeHa`, `de.uaaHa`, `bb.farms`, `bb.meanSizeHa`, `bb.uaaHa`, `bb.largeFarmsLandShare` | Eurostat dataset `ef_m_farmleg` (farm indicators by legal status, area, type, economic size and NUTS 2 region), year 2023, regions DE and DE40. https://ec.europa.eu/eurostat/databrowser/view/ef_m_farmleg/default/table | CC BY 4.0 (Eurostat copyright notice) | © European Union, Eurostat. Mean sizes and shares are farmland divided by farms (or by all farmland) from the same table. |
| `de.irrigatedShare` | Destatis press release 186 of 10 May 2024. https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/05/PD24_186_41.html | dl-de/by-2.0 | © Statistisches Bundesamt (Destatis), 2024. |
| `de.wheatYield` (and the Germany rapeseed yield quoted in a note) | Destatis: hectare yields of selected crops over time, as of 24 September 2026. https://www.destatis.de/DE/Themen/Branchen-Unternehmen/Landwirtschaft-Forstwirtschaft-Fischerei/Feldfruechte-Gruenland/Tabellen/liste-feldfruechte-zeitreihe.html | dl-de/by-2.0 | © Statistisches Bundesamt (Destatis), 2026. |
| `bb.wheatYield`, `bb.rapeseedYield` | Amt für Statistik Berlin-Brandenburg: Statistischer Bericht C II 2 - j/25 (harvest 2025, published January 2026). https://download.statistik-berlin-brandenburg.de/2ab9491d4ad6b87d/98cade627095/SB_C02-02-00_2025j01_BB.pdf | CC BY 3.0 DE | Amt für Statistik Berlin-Brandenburg, Potsdam, 2026. |
| `bb.irrigatedHa` | Amt für Statistik Berlin-Brandenburg: press release 71/2024 of 27 May 2024. https://www.statistik-berlin-brandenburg.de/071-2024 | CC BY 3.0 DE | Amt für Statistik Berlin-Brandenburg, 2024. |
| `mol.farms`, `mol.uaaHa` | Landkreis Märkisch-Oderland, agriculture office: presentation "Landwirtschaft MOL 2025" of 3 February 2026, on maerkisch-oderland.de | No licence stated; figures cited with attribution | Landkreis Märkisch-Oderland. |
| `mol.surfaceWaterBan` | Landkreis Märkisch-Oderland: general order under water law of July 2020 (until revoked), confirmed in force by press release 38/2026 of 16 July 2026. https://www.maerkisch-oderland.de/ | Official public notice; no licence stated | Landkreis Märkisch-Oderland, Der Landrat. |
| `oderbruch.waterBalanceMm` | Our calculation from the Open-Meteo historical weather API, default 'best_match' model (a blend of ERA5, ERA5-Land and IFS), daily rain and reference evapotranspiration at the grid point nearest 52.65 N, 14.35 E, 1991-2020. https://open-meteo.com/en/docs/historical-weather-api | CC BY 4.0; the free Open-Meteo API is for non-commercial use | Weather data by Open-Meteo.com; contains modified Copernicus Climate Change Service information. |
| `oderbruch.medianFieldHa` | Our calculation from the Brandenburg IACS (subsidy-system) parcels 2026, as harmonised by Fields of The World. https://source.coop/ftw/harmonized-field-data/de_bb | dl-de/by-2.0 | © Land Brandenburg (data provider named in the FTW catalogue), via Fields of The World. Median of the 4,784 cropped parcels in 14.15-14.65 E, 52.45-52.85 N. |
| `prices.wheatEurT`, `prices.rapeseedEurT` | European Commission agri-food data portal, cereal and oilseed price APIs, Germany, week of 28 September 2026. https://agridata.ec.europa.eu/extensions/DataPortal/home.html | Reuse authorised with the source acknowledged (Commission Decision 2011/833/EU) | © European Union. |

Facts cited in the page text, not stored as values (each shown with its source):

| Fact | Source |
|---|---|
| Foot-and-mouth disease in water buffaloes in Märkisch-Oderland on 10 January 2025; several non-EU countries stopped some imports; WOAH reinstated Germany's status "free from foot-and-mouth disease without vaccination" on 14 April 2025 | Federal ministry BMLEH, https://www.bmleh.de/EN/topics/animals/animal-health/foot-and-mouth-disease.html |

Map geometry (in `src/data/`): world countries from Natural Earth 1:110m via the world-atlas
package (Natural Earth is public domain; world-atlas is ISC); German states from
isellsoap/deutschlandGeoJSON (Unlicense, data from DIVA-GIS), simplified; the Oder and the
Oderbruch outline are hand-drawn and approximate. The maps are for orientation and imply no
position on any border.

Fonts (in `styles/fonts/`): Inter by The Inter Project Authors, SIL Open Font License 1.1
(`OFL.txt`). Self-hosted; no third-party font host is used.
