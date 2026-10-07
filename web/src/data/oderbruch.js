// The Oderbruch at map scale for level 3: the Oder along the Polish border and the outline of
// the lowland west of it. HAND-DRAWN, SIMPLIFIED AND APPROXIMATE: a few dozen points traced to
// orient a viewer, not survey or administrative data. The river keeps to the vertices of the
// Brandenburg border in germany.js (which follows the Oder here) so the two line up on the map;
// the points between them only add a little bend. The Polish side of the old Oderbruch is left out.
// All coordinates are [lon, lat].

/** The Oder from north to south, about 52.98N 14.17E to 52.35N 14.56E. */
export const ODER = [
  [14.178, 52.98],
  [14.142, 52.961],
  [14.152, 52.934],
  [14.161, 52.906],
  [14.156, 52.88],
  [14.137, 52.858], // [5] the lowland's northern tip, near Hohensaaten
  [14.121, 52.84],
  [14.163, 52.826],
  [14.214, 52.804],
  [14.262, 52.789],
  [14.306, 52.772],
  [14.341, 52.759],
  [14.369, 52.735],
  [14.404, 52.708],
  [14.433, 52.686],
  [14.466, 52.657],
  [14.508, 52.638],
  [14.553, 52.615],
  [14.598, 52.6],
  [14.639, 52.58], // near Küstrin, where the Warta joins from the east
  [14.618, 52.556],
  [14.601, 52.533],
  [14.62, 52.514],
  [14.631, 52.499],
  [14.607, 52.467],
  [14.581, 52.442],
  [14.556, 52.418], // [26] the lowland's southern tip, near Lebus
  [14.529, 52.396],
  [14.546, 52.372],
  [14.56, 52.35],
];

const NORTH_TIP = 5;
const SOUTH_TIP = 26;

/** The lowland's western edge, where the plateaus rise, from the southern tip back north. */
const WEST_EDGE = [
  [14.52, 52.428],
  [14.481, 52.448],
  [14.446, 52.471],
  [14.415, 52.496],
  [14.389, 52.521],
  [14.355, 52.545],
  [14.315, 52.567],
  [14.276, 52.59],
  [14.24, 52.615],
  [14.205, 52.645],
  [14.17, 52.676],
  [14.135, 52.704],
  [14.104, 52.725],
  [14.069, 52.746],
  [14.036, 52.771],
  [14.021, 52.801],
  [14.031, 52.83],
  [14.052, 52.854],
  [14.092, 52.864],
];

/**
 * The Oderbruch as one closed ring: down the Oder from the northern tip, then back north
 * along the western edge. Clockwise on a north-up map, as d3-geo expects for a small polygon.
 */
export const OUTLINE = [...ODER.slice(NORTH_TIP, SOUTH_TIP + 1), ...WEST_EDGE, ODER[NORTH_TIP]];

/** The real lowland is about 60 km long and 12-20 km wide. */
export const LENGTH_KM = 60;

/**
 * Where the map may write the names of the places around the farms, in order of preference
 * (a name is left out when all its spots are taken by pins or labels).
 */
export const PLACE_LABELS = [
  { id: "oderbruch", text: "Oderbruch", kind: "region", spots: [[14.13, 52.79], [14.22, 52.74], [14.47, 52.5]] },
  { id: "oder", text: "Oder", kind: "river", spots: [[14.3, 52.795], [14.53, 52.655], [14.66, 52.53]] },
  { id: "poland", text: "Poland", kind: "country", spots: [[14.66, 52.72], [14.7, 52.64], [14.72, 52.48]] },
  { id: "brandenburg", text: "Brandenburg", kind: "country", spots: [[13.98, 52.6], [14.05, 52.52], [14.0, 52.68]] },
];
