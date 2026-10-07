// The places of the twin: the Oderbruch region, its three (fictional) farms and our three
// fields. Farm names are fictional on purpose; every number in the twin is simulated.

export const BERLIN = { name: "Berlin", lat: 52.52, lon: 13.405 };

export const REGION = {
  id: "oderbruch",
  name: "Oderbruch",
  state: "Brandenburg",
  lat: 52.64,
  lon: 14.3,
};

export const FARMS = [
  {
    id: "lerchenbruch",
    name: "Hof Lerchenbruch",
    isOwn: true,
    lat: 52.655,
    lon: 14.3,
    crops: "wheat, rapeseed, potatoes",
    areaHa: 96,
  },
  {
    id: "rohrdommelsee",
    name: "Gut Rohrdommelsee",
    isOwn: false,
    lat: 52.712,
    lon: 14.17,
    crops: "maize, sugar beet",
    areaHa: 310,
  },
  {
    id: "oderblick",
    name: "Agrarhof Oderblick",
    isOwn: false,
    lat: 52.585,
    lon: 14.455,
    crops: "wheat, rapeseed, barley",
    areaHa: 240,
  },
];

export const OWN_FARM = FARMS[0];
export const FARM_BY_ID = Object.fromEntries(FARMS.map((f) => [f.id, f]));
export const FARM_BY_NAME = Object.fromEntries(FARMS.map((f) => [f.name, f]));
export const FARM_NAMES = FARMS.map((f) => f.name);

/** Our fields, in display order. Engine keys are these names; routes use FIELD_IDS. */
export const FIELDS = ["North", "West", "River"];
export const FIELD_IDS = { North: "north", West: "west", River: "river" };
export const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [FIELD_IDS[f], f]));
export const FIELD_NAMES = { North: "North field", West: "West field", River: "River field" };
export const FIELD_AGENT_NAMES = { North: "North field agent", West: "West field agent", River: "River field agent" };

export const FARMYARD = { lat: 52.6545, lon: 14.299 };

/** Closed rings of [lon, lat]; their areas are about each field's area_ha. */
export const FIELD_POLYGONS = {
  North: [[14.295, 52.6575], [14.3045, 52.6575], [14.3045, 52.6635], [14.295, 52.6635], [14.295, 52.6575]],
  West: [[14.286, 52.6505], [14.2935, 52.6505], [14.2935, 52.656], [14.286, 52.656], [14.286, 52.6505]],
  River: [[14.304, 52.648], [14.3105, 52.648], [14.3105, 52.653], [14.304, 52.653], [14.304, 52.648]],
};
