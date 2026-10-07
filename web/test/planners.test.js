// The rule-based field agents (planners.js) and farm agents (farms.js). Port of
// tests/test_mocks.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as farms from "../src/engine/farms.js";
import * as planners from "../src/engine/planners.js";
import { createRng } from "../src/engine/rng.js";
import * as sim from "../src/engine/sim.js";
import { FarmState, NEIGHBOUR_HINT, OWN_FARM_NAME, WATER_PERMIT_HEATWAVE_M3 } from "../src/engine/state.js";

const freshState = (seed = 0) => new FarmState({ seed, rng: createRng(seed) });
const types = (p) => p.actions.map((a) => a.type);

function setWeather(state, { rainToday = 0, wind = 2, rainTomorrow = 0 } = {}) {
  Object.assign(state.weatherToday, { rainMm: rainToday, windMs: wind, hail: false, note: "" });
  Object.assign(state.forecast[0], { rainMm: rainTomorrow, hail: false, note: "" });
}

function makeReady(state, ...fields) {
  for (const f of fields) state.fields[f].daysToHarvest = 0;
}

// -- field agents -------------------------------------------------------------------------------
test("a harvested field sows a cover crop, then rests", () => {
  const state = freshState();
  setWeather(state);
  state.fields.North.harvested = true;
  const p = planners.generate("North", state);
  assert.deepEqual(types(p), ["sow_cover_crop"]);
  assert.equal(p.actions[0].confidence, 0.8);
  assert.equal(p.actions[0].reason, "Wheat is off the field; a cover crop protects the soil and holds nitrogen.");
  assert.equal(p.rationale, "Field harvested; sowing a cover crop.");
  state.fields.North.coverCrop = true;
  const rest = planners.generate("North", state);
  assert.deepEqual(types(rest), []);
  assert.equal(rest.rationale, "Field harvested and cover crop established; no action needed.");
  assert.equal(rest.confidence, 0.6);
});

test("a harvested field waits to sow on a wet or hail day", () => {
  const state = freshState();
  state.fields.North.harvested = true;
  for (const [rain, hail] of [[12.0, false], [0.0, true]]) {
    setWeather(state, { rainToday: rain });
    state.weatherToday.hail = hail;
    const p = planners.generate("North", state);
    assert.deepEqual(types(p), ["defer_task"], `${rain} ${hail}`);
    assert.ok(p.actions[0].reason.includes("too wet"));
  }
  setWeather(state, { rainToday: 21.1 });
  assert.equal(
    planners.generate("North", state).actions[0].reason,
    "Wheat stubble too wet after 21.1 mm rain; drilling the cover crop once the soil dries.",
  );
});

test("a ripe cereal harvests on a dry day", () => {
  const state = freshState();
  setWeather(state, { rainToday: 0 });
  makeReady(state, "West");
  const p = planners.generate("West", state);
  assert.deepEqual(types(p), ["harvest"]);
  assert.equal(p.actions[0].confidence, 0.85);
  assert.equal(p.actions[0].reason, "rapeseed ripe; dry day, ~116 t expected.");
  assert.equal(p.rationale, "Rapeseed is ripe; harvesting today (~116 t).");
  assert.deepEqual(p.risks, ["seed moisture may need drying"]);
});

test("a ripe cereal waits on a wet day", () => {
  const state = freshState();
  setWeather(state, { rainToday: 6.2 });
  makeReady(state, "North");
  const p = planners.generate("North", state);
  assert.deepEqual(types(p), ["defer_task"]);
  assert.equal(p.actions[0].confidence, 0.7);
  assert.equal(p.actions[0].reason, "wheat ripe but 6.2 mm rain today - too wet to harvest.");
});

test("a ripe cereal harvests before hail, even when wet", () => {
  const state = freshState();
  sim.hailWarning(state);
  setWeather(state, { rainToday: 3.0 });
  state.forecast[1].hail = true;
  makeReady(state, "North");
  const p = planners.generate("North", state);
  assert.deepEqual(types(p), ["harvest"]);
  assert.equal(p.actions[0].confidence, 0.5);
  assert.equal(p.actions[0].reason, "Hail expected Wed 8 Jul; harvesting ripe wheat now.");
  assert.deepEqual(p.risks, ["grain moisture may need drying"]);
});

test("a ripening cereal scouts (grain for wheat, seed for rapeseed)", () => {
  const state = freshState();
  state.fields.North.daysToHarvest = 2;
  const p = planners.generate("North", state);
  assert.deepEqual(types(p), ["scout"]);
  assert.equal(p.actions[0].reason, "wheat ripening, 2 days to harvest; checking grain moisture.");
  assert.equal(p.rationale, "Wheat close to ripe (2 days); scouting.");
  state.fields.West.daysToHarvest = 1;
  assert.equal(
    planners.generate("West", state).actions[0].reason,
    "rapeseed ripening, 1 day to harvest; checking seed moisture.", // an oilseed
  );
  state.fields.North.daysToHarvest = 5;
  const none = planners.generate("North", state);
  assert.deepEqual(types(none), []);
  assert.equal(none.rationale, "Crop within normal range; no action needed.");
});

test("River irrigates up to 25 mm", () => {
  const state = freshState();
  state.fields.River.soilMoisture = 50;
  const p = planners.generate("River", state);
  assert.deepEqual(types(p), ["irrigate"]);
  assert.equal(p.actions[0].mm, 25);
  assert.equal(p.actions[0].confidence, 0.8);
  assert.ok(p.actions[0].reason.includes("Soil moisture 50%") && p.actions[0].reason.includes("over 2 days"));
  assert.ok(p.rationale.includes("irrigating 25 mm (6,000 m³)"));
  assert.deepEqual(p.risks, ["River field water use competes with the permit"]);
});

test("River's irrigation depth follows the projection", () => {
  const state = freshState();
  for (const w of state.forecast) Object.assign(w, { rainMm: 0.0, et0Mm: 4.0 }); // 2 days x 4.4 mm crop water use
  state.fields.River.soilMoisture = 76.8; // -> projected 68 -> 90 - 68 = 22 -> 20 mm
  const p = planners.generate("River", state);
  assert.equal(p.actions[0].mm, 20);
  assert.equal(
    p.actions[0].reason,
    "Soil moisture 77%; forecast 8.8 mm crop water use vs 0.0 mm rain over 2 days (heading for ~68%, stress below 60%).",
  );
  assert.equal(p.rationale, "Soil at 77%, heading for ~68% over the next 2 days; irrigating 20 mm (4,800 m³).");
  state.fields.River.soilMoisture = 88.8; // projected 80 >= 60 + 10: no irrigation
  assert.deepEqual(types(planners.generate("River", state)), []);
});

test("River fits the permit after a rejection", () => {
  const state = freshState();
  state.fields.River.soilMoisture = 50;
  state.waterPermitM3 = WATER_PERMIT_HEATWAVE_M3;
  assert.equal(planners.generate("River", state).actions[0].mm, 25); // asks for too much at first
  state.fields.River.recentRejections = ["Stay within the water permit"];
  const p = planners.generate("River", state);
  assert.equal(p.actions[0].mm, 15); // floor(3600 / 240)
  assert.equal(p.actions[0].confidence, 0.75);
  assert.ok(p.rationale.includes("irrigating 15 mm (3,600 m³), fitted to today's 3,600 m³ water permit"));
  assert.ok(p.rationale.endsWith("(Noting recent rejection: Stay within the water permit)"));
});

test("River skips a pass too small for the permit", () => {
  const state = freshState();
  state.fields.River.soilMoisture = 50;
  state.waterPermitM3 = 1000; // floor(1000 / 240) = 4 mm < 5
  state.fields.River.recentRejections = ["too much water"];
  const p = planners.generate("River", state);
  assert.deepEqual(types(p), []);
  assert.ok(p.rationale.includes("soil drying but today's 1,000 m³ permit is too small for a useful pass"));
  assert.equal(p.confidence, 0.6);
});

test("River sprays fungicide under blight pressure, not again within 7 days", () => {
  const state = freshState();
  state.fields.River.disease = 0.65;
  state.fields.River.soilMoisture = 95;
  const p = planners.generate("River", state);
  assert.deepEqual(types(p), ["spray"]);
  assert.equal(p.actions[0].product, "fungicide");
  assert.equal(p.actions[0].confidence, 0.7);
  assert.equal(p.actions[0].reason, "Blight pressure 0.65 and no spray in the last 7 days.");
  assert.ok(p.rationale.endsWith("; spraying fungicide against blight."));
  state.fields.River.lastSprayedTick = state.tick - 3;
  assert.deepEqual(types(planners.generate("River", state)), []);
});

test("River can irrigate and spray in one proposal", () => {
  const state = freshState();
  state.fields.River.soilMoisture = 50;
  state.fields.River.disease = 0.7;
  const p = planners.generate("River", state);
  assert.deepEqual(types(p), ["irrigate", "spray"]);
  assert.equal(p.confidence, 0.7); // min over its actions
  assert.ok(p.rationale.includes("irrigating 25 mm (6,000 m³) and spraying fungicide against blight."));
});

test("the last rejection is noted on every rationale", () => {
  const state = freshState();
  state.fields.North.recentRejections = ["first", "Wait for better weather"];
  const p = planners.generate("North", state);
  assert.ok(p.rationale.endsWith(" (Noting recent rejection: Wait for better weather)"));
});

test("a 'neighbour farm' rejection adds the hint to the field census", () => {
  const state = freshState();
  assert.equal(state.census("West").hint, null);
  state.fields.West.recentRejections = ["A neighbour farm should help with this"];
  assert.equal(state.census("West").hint, NEIGHBOUR_HINT);
  assert.ok(!NEIGHBOUR_HINT.includes("check what the Machinery ring reports"));
});

// -- farm agents ------------------------------------------------------------------------------
test("a neighbour shares its free combine and silo space above a 50 t holdback", () => {
  const state = freshState();
  const n = state.neighbours["Gut Rohrdommelsee"];
  n.combineAvailable = 1;
  n.storageUsedT = 380;
  assert.deepEqual(farms.generate("Gut Rohrdommelsee", state), {
    farm: "Gut Rohrdommelsee",
    canShare: { combine: 1, storageT: 470 },
    validUntil: "Tue 7 Jul",
    confidence: 0.85,
    note: "combine free, 520 t silo space",
  });
});

test("a busy combine, and holding back harder during a scenario", () => {
  const state = freshState();
  const n = state.neighbours["Gut Rohrdommelsee"];
  n.combineAvailable = 0;
  n.storageUsedT = 380.4;
  sim.startHeatwave(state);
  const cap = farms.generate("Gut Rohrdommelsee", state);
  assert.deepEqual(cap.canShare, { combine: 0, storageT: 234 }); // floor((519.6 - 50) / 2)
  assert.equal(cap.confidence, 0.5);
  assert.equal(cap.note, "combine busy, 520 t silo space; keeping a reserve while the weather warning lasts");
});

test("a cereal-heavy neighbour keeps its combine before hail", () => {
  const state = freshState();
  state.neighbours["Agrarhof Oderblick"].combineAvailable = 1;
  sim.hailWarning(state);
  assert.equal(state.farmCensus("Agrarhof Oderblick").ripeBacklogHa, 60);
  const cap = farms.generate("Agrarhof Oderblick", state);
  assert.equal(cap.canShare.combine, 0);
  assert.ok(cap.note.startsWith("combine needed for our own 60 ha of ripe crop"));
});

test("our own farm answers from its real state", () => {
  const state = freshState();
  assert.deepEqual(farms.generate(OWN_FARM_NAME, state).canShare, { combine: 1, storageT: 280 }); // 330 free - 50
  makeReady(state, "North");
  assert.equal(state.farmCensus(OWN_FARM_NAME).ripeBacklogHa, 42);
  assert.equal(farms.generate(OWN_FARM_NAME, state).canShare.combine, 0);
  state.storageUsedT = 420; // 30 t free: nothing above the holdback
  assert.equal(farms.generate(OWN_FARM_NAME, state).canShare.storageT, 0);
});
