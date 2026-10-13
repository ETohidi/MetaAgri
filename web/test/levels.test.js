// The level model (src/ui/levels.js): every level fills every field, with a legal basis for what
// it shares up, with peers and never; the channels name real levels; the UI shows level names,
// never level numbers or km/ha scales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNEL_ORDER, CHANNELS, LEVEL_FIELDS, LEVEL_ORDER, LEVELS, levelsPanel } from "../src/ui/levels.js";
import { ladderSteps } from "../src/ui/shell.js";
import { FIELDS, FIELD_IDS, OWN_FARM } from "../src/data/places.js";

const NUMBERED = /\bL[0-7]\b|Level [0-9]/;
const SCALE = /\d\s*(km|ha)\b/;

test("the ladder is World, EU, Country, Land, District, Farm, Field, and nothing else is defined", () => {
  assert.deepEqual(LEVEL_ORDER, ["world", "eu", "country", "land", "district", "farm", "field"]);
  assert.deepEqual(Object.keys(LEVELS).sort(), [...LEVEL_ORDER].sort());
});

for (const key of LEVEL_ORDER) {
  test(`level "${key}" has every field and a legal basis`, () => {
    const L = LEVELS[key];
    for (const f of LEVEL_FIELDS) assert.ok(typeof L[f] === "string" && L[f].trim().length > 0, `${key}.${f}`);
    for (const f of ["upBasis", "peersBasis", "neverBasis"]) assert.ok(L[f].length >= 4, `${key}.${f} is a real basis`);
    assert.ok(Array.isArray(L.kpis) && L.kpis.length >= 1 && L.kpis.length <= 5, `${key}.kpis: 1-5 tiles`);
    for (const k of L.kpis) assert.ok(typeof k === "string" && k.trim().length > 0, `${key}.kpis has a label`);
    assert.ok("route" in L, `${key}.route is declared (a token or null)`);
  });
}

test("EU and Land are ladder only (no page yet) and say so; every other level has a page", () => {
  for (const key of LEVEL_ORDER) {
    if (key === "eu" || key === "land") {
      assert.equal(LEVELS[key].route, null, key);
      assert.ok(LEVELS[key].pending?.length > 10, `${key} explains why it has no page`);
    } else {
      assert.match(LEVELS[key].route, /^[a-z0-9._~-]+$/, `${key} has a plain hash token`);
    }
  }
  assert.match(LEVELS.land.pending, /v2\.1/);
});

test("every channel has a name, a basis and a chain of real levels from the farm upward", () => {
  assert.deepEqual(Object.keys(CHANNELS).sort(), [...CHANNEL_ORDER].sort());
  for (const c of CHANNEL_ORDER) {
    const ch = CHANNELS[c];
    assert.ok(ch.name && ch.basis.length >= 4, c);
    assert.equal(ch.chain[0][1], "farm", `${c} starts at the farm`);
    let last = -Infinity;
    for (const [who, lv] of ch.chain) {
      assert.ok(who.trim().length > 0, `${c}: hop has a name`);
      const i = LEVEL_ORDER.indexOf(lv);
      assert.ok(i >= 0, `${c}: ${lv} is a level`);
      assert.ok(LEVEL_ORDER.length - i > last, `${c}: the chain runs upward`);
      last = LEVEL_ORDER.length - i;
    }
  }
});

test("a level's channel notes name only channels whose chain passes through that level", () => {
  let withChannels = 0;
  for (const key of LEVEL_ORDER) {
    const notes = LEVELS[key].channels ?? {};
    for (const [c, text] of Object.entries(notes)) {
      assert.ok(CHANNELS[c], `${key}: unknown channel ${c}`);
      assert.ok(CHANNELS[c].chain.some(([, lv]) => lv === key), `${key}: ${c} does not pass through it`);
      assert.ok(typeof text === "string" && text.trim().length > 0, `${key}.channels.${c}`);
    }
    if (Object.keys(notes).length) withChannels++;
  }
  // every channel shows up at the farm, where it starts
  assert.deepEqual(Object.keys(LEVELS.farm.channels).sort(), [...CHANNEL_ORDER].sort());
  assert.ok(withChannels >= 4);
});

test("the panel names levels, never numbers, and marks the current one", () => {
  for (const key of LEVEL_ORDER) {
    const out = String(levelsPanel(key, { place: "Test" }));
    assert.doesNotMatch(out, NUMBERED, key);
    assert.match(out, new RegExp(`aria-current="step" class="is-here">${LEVELS[key].name}<`), key);
    assert.match(out, /Never leaves/);
    assert.match(out, /Basis: |levels-basis/);
    for (const k of LEVEL_ORDER) assert.ok(out.includes(`>${LEVELS[k].name}<`), `${key} ladder shows ${k}`);
  }
});

test("the panel shows the channels where they matter, with this level's hop marked", () => {
  const district = String(levelsPanel("district"));
  assert.match(district, /Channels through this level/);
  assert.match(district, /<li class="is-here">District vet office<\/li>/);
  assert.match(district, /Voluntary sharing/);
  assert.doesNotMatch(String(levelsPanel("field")), /Channels through this level/);
});

test("ladder-only levels are not links; the others link to their page or to a given token", () => {
  const out = String(levelsPanel("country", { links: { farm: "oderblick" } }));
  assert.doesNotMatch(out, /href="#null"/);
  assert.match(out, /<li class="is-soon" title="[^"]+">EU<\/li>/);
  assert.match(out, /<li class="is-soon" title="[^"]+">Land<\/li>/);
  assert.match(out, /href="#oderbruch">District</);
  assert.match(out, /href="#oderblick">Farm</);
});

test("with a role, the panel says what that role sees at this level", () => {
  assert.match(String(levelsPanel("farm", { role: "ministry" })), /Viewing as Federal ministry: sees nothing of this level/);
  assert.match(String(levelsPanel("farm", { role: "farm" })), /Viewing as Farm manager: sees this level in full/);
  assert.doesNotMatch(String(levelsPanel("farm", { role: "nobody" })), /Viewing as/);
});

test("an unknown level renders nothing", () => {
  assert.equal(levelsPanel("galaxy"), "");
});

// The app bar's breadcrumb (src/ui/shell.js): places with their level name, never a number or km/ha.
const routes = {
  world: "world",
  germany: "germany",
  oderbruch: "oderbruch",
  farm: (id) => id,
  field: (f) => `${OWN_FARM.id}.${FIELD_IDS[f]}`,
};

test("the breadcrumb shows every level by name, with EU and Land greyed and no km or ha", () => {
  const routeList = [
    { level: "world" },
    { level: "country" },
    { level: "district" },
    { level: "farm", farmId: OWN_FARM.id },
    { level: "farm", farmId: "oderblick" },
    ...FIELDS.map((f) => ({ level: "field", farmId: OWN_FARM.id, field: f })),
  ];
  for (const route of routeList) {
    const steps = ladderSteps(route, routes);
    assert.deepEqual(
      steps.map((s) => s.key),
      LEVEL_ORDER,
      "one step per level, in ladder order",
    );
    for (const s of steps) {
      assert.doesNotMatch(`${s.name} ${s.scale}`, NUMBERED);
      assert.doesNotMatch(`${s.name} ${s.scale}`, SCALE);
      assert.ok(s.scale === s.name || s.scale.startsWith(LEVELS[s.key].name) || s.pending, `${s.key}: level name under the place`);
    }
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    assert.ok(byKey.eu.soon && !byKey.eu.token, "EU is ladder only");
    assert.ok(byKey.land.soon && !byKey.land.token, "Land is ladder only");
    assert.equal(byKey.land.name, "Brandenburg");
    assert.match(byKey.land.scale, /coming in v2\.1/);
    assert.equal(byKey.country.name, "Germany");
    assert.equal(byKey.district.name, "Oderbruch");
  }
});

test("the breadcrumb names the chosen farm and field, and marks the rest as not chosen", () => {
  const atCountry = ladderSteps({ level: "country" }, routes);
  assert.ok(atCountry[5].pending && atCountry[6].pending);
  const atField = ladderSteps({ level: "field", farmId: OWN_FARM.id, field: "River" }, routes);
  assert.equal(atField[5].name, OWN_FARM.name);
  assert.equal(atField[5].token, OWN_FARM.id);
  assert.equal(atField[6].name, "River field");
  assert.equal(atField[6].token, `${OWN_FARM.id}.river`);
  const neighbour = ladderSteps({ level: "farm", farmId: "rohrdommelsee" }, routes);
  assert.match(neighbour[6].pending, /own farm/);
  assert.equal(neighbour[6].token, undefined);
});
