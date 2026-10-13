// Real open data for the levels above the farm (docs/CONCEPT-v2.md section 4). v2.0 reads one
// hand-curated file, web/data/real.json; v2.1 adds tools/build-data.mjs and a scheduled refresh.
// Every value keeps where it came from, so every number on the page can carry its badge.
//
// real.json: { meta: {curatedAt, note}, values: { <key>: RealValue } }
//
// @typedef {Object} RealValue
// @property {number|string} value    the figure (a number where it is one)
// @property {string} [unit]          "farms", "ha", "%", "dt/ha", "EUR/t", "mm/yr", ...
// @property {string} label           short label for a KPI tile, e.g. "Farms worldwide"
// @property {"Official"|"Estimated"} kind   Official = published statistic; Estimated = our own
//                                    calculation from open data, or an educated guess
// @property {string} source          publisher and dataset
// @property {string} url             a link a reader can open
// @property {string} licence         e.g. "CC BY 4.0", "dl-de/by-2.0", "unknown"
// @property {string} asOf            the year or date the figure describes, e.g. "2023"
// @property {string} [note]          caveats, e.g. "provisional", "derived from the IACS parcels"
//
// Views read values by key with realValue(data, key); a missing key or file is "Unknown", never 0.

const BASE = new URL("../../data/", import.meta.url);

/** The keys the pages use. tools and tests check that real.json has exactly these. */
export const REAL_KEYS = [
  // World
  "world.farms", // farms worldwide (FAO 2025: about 579 M)
  "world.smallFarmsShare", // share of farms under 2 ha (85 %)
  "world.smallFarmsLandShare", // share of farmland those small farms work (~9 %)
  "world.irrigatedCroplandShare", // share of cropland irrigated (~20 %)
  "world.irrigatedFoodShare", // share of food from irrigated land (~40 %)
  "world.fields2025", // field outlines mapped for 2025 (FTW, ~1.58 bn)
  // EU
  "eu.farms", // EU-27 holdings 2023 (8.8 M)
  "eu.meanSizeHa", // mean holding size (17.8 ha)
  "eu.largeFarmsLandShare", // land held by farms of 50 ha or more (68.3 %)
  // Germany
  "de.farms", // holdings 2023 (255,010)
  "de.meanSizeHa", // mean size (65 ha)
  "de.uaaHa", // utilised agricultural area (16.59 M ha)
  "de.irrigatedShare", // irrigated share of farmland 2022 (3.3 %)
  "de.wheatYield", // wheat (all kinds) yield 2025 (78.3 dt/ha)
  // Brandenburg
  "bb.farms", // holdings 2023 (5,370)
  "bb.meanSizeHa", // mean size (241.6 ha)
  "bb.uaaHa", // utilised agricultural area (1,297,550 ha)
  "bb.largeFarmsLandShare", // land held by farms of 100 ha or more (93.3 %)
  "bb.wheatYield", // wheat (all kinds) yield 2025 (62.7 dt/ha)
  "bb.rapeseedYield", // rapeseed and turnip rape yield 2025 (27.5 dt/ha)
  "bb.irrigatedHa", // irrigated area 2022 (30,900 ha)
  // District: Märkisch-Oderland / Oderbruch
  "mol.farms", // farms 2025 (441)
  "mol.uaaHa", // farmland 2025 (123,700 ha)
  "mol.surfaceWaterBan", // general ban on taking surface water (in force since 2020)
  "oderbruch.waterBalanceMm", // rain minus reference evapotranspiration 1991-2020 (~ -160 mm/yr, Estimated)
  "oderbruch.medianFieldHa", // median cropped field (6.5 ha, Estimated from the IACS parcels)
  // Markets
  "prices.wheatEurT", // milling wheat, Germany, week of 28 Sep 2026 (EUR 210-235/t)
  "prices.rapeseedEurT", // rapeseed, Germany, same week (~EUR 519/t)
];

/**
 * @returns {Promise<{real: {meta: object, values: Object<string, RealValue>}|null, errors: Object<string, Error>}>}
 *   resolves even when the file fails (real: null, errors.real set).
 */
export async function loadRealData() {
  try {
    const res = await fetch(new URL("real.json", BASE), { cache: "no-cache" });
    if (!res.ok) throw new Error(`real.json: HTTP ${res.status}`);
    return { real: await res.json(), errors: {} };
  } catch (err) {
    return { real: null, errors: { real: err } };
  }
}

/** The RealValue for a key, or null (show "Unknown", never 0). */
export function realValue(data, key) {
  return data?.real?.values?.[key] ?? null;
}
