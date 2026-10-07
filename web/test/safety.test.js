// Every Safety-check rule: one allowed and one blocked case each, plus ordering and
// resource accounting. Port of the Python hub's tests/test_thorn.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../src/engine/rng.js";
import * as safety from "../src/engine/safety.js";
import { FarmState, OWN_FARM_NAME, WATER_PERMIT_HEATWAVE_M3 } from "../src/engine/state.js";

const ROHRDOMMELSEE = "Gut Rohrdommelsee";
const ODERBLICK = "Agrarhof Oderblick";

// -- helpers ---------------------------------------------------------------------------
const freshState = (seed = 0) => new FarmState({ seed, rng: createRng(seed) });

/** Pin today's and tomorrow's weather so a rule test doesn't depend on the dice. */
function setWeather(state, { rainToday = 0, wind = 2, rainTomorrow = 0 } = {}) {
  Object.assign(state.weatherToday, { rainMm: rainToday, windMs: wind, hail: false, note: "" });
  Object.assign(state.forecast[0], { rainMm: rainTomorrow, hail: false, note: "" });
}

function makeReady(state, ...fields) {
  for (const f of fields) state.fields[f].daysToHarvest = 0;
}

const proposal = (field, actions = [], { rationale = "test", confidence = 0.8 } = {}) => ({
  field,
  actions,
  rationale,
  confidence,
  risks: [],
});

const capacity = (farm, { combine = 1, storageT = 200, confidence = 0.85 } = {}) => ({
  farm,
  canShare: { combine, storageT },
  validUntil: "Tue 7 Jul",
  confidence,
  note: "test",
});

const entryFor = (entries, field, type) => entries.find((e) => e.field === field && e.action.type === type);
const evaluate = (state, ...proposals) => safety.evaluate(proposals, state);

// -- RULE_PROPOSAL_SHAPE --------------------------------------------------------------------
test("shape: a valid proposal is checked action by action", () => {
  const state = freshState();
  const { entries, proposals } = evaluate(state, proposal("North", [{ type: "scout" }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(proposals[0].actions[0].type, "scout");
});

test("shape: a blank rationale blocks every action", () => {
  const state = freshState();
  const p = proposal("River", [{ type: "scout" }, { type: "irrigate", mm: 10 }], { rationale: "   " });
  const { entries, proposals } = evaluate(state, p);
  assert.deepEqual(entries.map((e) => e.rule), [safety.RULE_PROPOSAL_SHAPE, safety.RULE_PROPOSAL_SHAPE]);
  assert.ok(entries.every((e) => e.blocked));
  assert.deepEqual(proposals, []);
});

test("shape: confidence out of range is blocked", () => {
  const state = freshState();
  for (const confidence of [1.4, -0.1, Number.NaN]) {
    const { entries } = evaluate(state, proposal("North", [{ type: "scout" }], { confidence }));
    assert.equal(entries[0].rule, safety.RULE_PROPOSAL_SHAPE, String(confidence));
  }
});

// -- RULE_WATER_PERMIT -----------------------------------------------------------------------
test("water permit: 25 mm (6,000 m³) fits the normal 6,500 m³ permit", () => {
  const state = freshState();
  const { entries, before, after } = evaluate(state, proposal("River", [{ type: "irrigate", mm: 25 }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(before.waterM3, 6500);
  assert.equal(after.waterM3, 500); // 25 mm x 24 ha x 10 = 6,000 m³
});

test("water permit: 25 mm is blocked in a heatwave, and a blocked action consumes nothing", () => {
  const state = freshState();
  state.waterPermitM3 = WATER_PERMIT_HEATWAVE_M3;
  const { entries, proposals, after } = evaluate(state, proposal("River", [{ type: "irrigate", mm: 25 }]));
  assert.equal(entries[0].rule, safety.RULE_WATER_PERMIT);
  assert.deepEqual(proposals[0].actions, []);
  assert.equal(after.waterM3, WATER_PERMIT_HEATWAVE_M3);
  assert.equal(after.workers, 5);
});

test("water permit: exactly the cut permit (15 mm = 3,600 m³) is allowed", () => {
  const state = freshState();
  state.waterPermitM3 = WATER_PERMIT_HEATWAVE_M3;
  const { entries, after } = evaluate(state, proposal("River", [{ type: "irrigate", mm: 15 }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(after.waterM3, 0);
});

// -- RULE_NOT_IRRIGABLE ----------------------------------------------------------------------
test("not irrigable: North has no irrigation equipment, River has", () => {
  const state = freshState();
  assert.equal(evaluate(state, proposal("North", [{ type: "irrigate", mm: 10 }])).entries[0].rule, safety.RULE_NOT_IRRIGABLE);
  assert.equal(evaluate(state, proposal("River", [{ type: "irrigate", mm: 10 }])).entries[0].blocked, false);
});

// -- RULE_SPRAY_WEATHER / RULE_PRE_HARVEST ---------------------------------------------------
test("spray: allowed on a calm dry day, using the sprayer", () => {
  const state = freshState();
  setWeather(state, { wind: 3 });
  const { entries, after } = evaluate(state, proposal("River", [{ type: "spray", product: "fungicide" }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(after.sprayer, 0);
});

test("spray: blocked by wind over 5 m/s or more than 5 mm rain tomorrow", () => {
  const state = freshState();
  setWeather(state, { wind: 6 });
  assert.equal(evaluate(state, proposal("River", [{ type: "spray", product: "fungicide" }])).entries[0].rule, safety.RULE_SPRAY_WEATHER);
  setWeather(state, { wind: 2, rainTomorrow: 6 });
  assert.equal(evaluate(state, proposal("River", [{ type: "spray", product: "fungicide" }])).entries[0].rule, safety.RULE_SPRAY_WEATHER);
  setWeather(state, { wind: 5, rainTomorrow: 5 }); // the limits themselves are fine
  assert.equal(evaluate(state, proposal("River", [{ type: "spray", product: "fungicide" }])).entries[0].blocked, false);
});

test("spray: blocked within 14 days of harvest, allowed on stubble", () => {
  const state = freshState();
  setWeather(state);
  assert.ok(state.fields.North.daysToHarvest <= safety.PRE_HARVEST_DAYS);
  assert.equal(evaluate(state, proposal("North", [{ type: "spray", product: "fungicide" }])).entries[0].rule, safety.RULE_PRE_HARVEST);
  state.fields.North.harvested = true;
  assert.equal(evaluate(state, proposal("North", [{ type: "spray", product: "herbicide" }])).entries[0].blocked, false);
});

// -- RULE_HARVEST ------------------------------------------------------------------------------
test("harvest: ripe and dry is allowed and books the combine, 2 workers and the silo", () => {
  const state = freshState();
  setWeather(state, { rainToday: 1.5 });
  makeReady(state, "North");
  const { entries, before, after } = evaluate(state, proposal("North", [{ type: "harvest" }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(after.combine, 0);
  assert.equal(after.workers, 3);
  const expectedFree = Math.max(0, before.storageFreeT - state.fields.North.yieldEstimateT);
  assert.equal(after.storageFreeT, Math.round(expectedFree * 10) / 10);
});

test("harvest: blocked when not ripe, on a wet day, or already harvested", () => {
  const state = freshState();
  setWeather(state);
  assert.equal(evaluate(state, proposal("North", [{ type: "harvest" }])).entries[0].rule, safety.RULE_HARVEST);
  makeReady(state, "North");
  setWeather(state, { rainToday: 2.0 });
  assert.equal(evaluate(state, proposal("North", [{ type: "harvest" }])).entries[0].rule, safety.RULE_HARVEST);
  setWeather(state);
  state.fields.North.harvested = true;
  assert.equal(evaluate(state, proposal("North", [{ type: "harvest" }])).entries[0].rule, safety.RULE_HARVEST);
});

test("harvest: the same field cannot be harvested twice in one plan", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE) };
  const { entries } = evaluate(state, proposal("West", [{ type: "harvest" }, { type: "borrow_combine", farm: ROHRDOMMELSEE }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(entries[1].rule, safety.RULE_HARVEST);
});

// -- RULE_MACHINE ------------------------------------------------------------------------------
test("machine: a second harvest with our one combine is blocked", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  const { entries } = evaluate(state, proposal("North", [{ type: "harvest" }]), proposal("West", [{ type: "harvest" }]));
  assert.equal(entryFor(entries, "North", "harvest").blocked, false);
  assert.equal(entryFor(entries, "West", "harvest").rule, safety.RULE_MACHINE);
});

test("machine: a second spray with our one sprayer is blocked", () => {
  const state = freshState();
  setWeather(state);
  state.fields.North.harvested = true; // stubble: no pre-harvest interval
  const { entries } = evaluate(
    state,
    proposal("River", [{ type: "spray", product: "fungicide" }]),
    proposal("North", [{ type: "spray", product: "herbicide" }]),
  );
  assert.equal(entryFor(entries, "River", "spray").blocked, false);
  assert.equal(entryFor(entries, "North", "spray").rule, safety.RULE_MACHINE);
});

// -- RULE_WORKERS ------------------------------------------------------------------------------
test("workers: exactly five allowed, the sixth blocked", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  state.fields.West.harvested = true; // bare stubble: the cover crop itself is fine
  const { entries, after } = evaluate(
    state,
    proposal("North", [{ type: "harvest" }]), // 2 workers
    proposal("River", [
      { type: "irrigate", mm: 10 }, // 1
      { type: "spray", product: "fungicide" }, // 1
      { type: "fertilize", kgNHa: 30 }, // 1
    ]),
    proposal("West", [{ type: "sow_cover_crop" }]), // the 6th worker
  );
  assert.deepEqual(entries.filter((e) => e.field !== "West").map((e) => e.blocked), [false, false, false, false]);
  assert.equal(entryFor(entries, "West", "sow_cover_crop").rule, safety.RULE_WORKERS);
  assert.equal(after.workers, 0);
});

// -- RULE_FERTILIZE ----------------------------------------------------------------------------
test("fertilize: allowed normally, blocked on waterlogged soil, before heavy rain, or on stubble", () => {
  const state = freshState();
  setWeather(state, { rainTomorrow: 4 });
  const fert = () => evaluate(state, proposal("River", [{ type: "fertilize", kgNHa: 40 }])).entries[0];
  assert.equal(fert().blocked, false);
  state.fields.River.soilMoisture = 95;
  assert.equal(fert().rule, safety.RULE_FERTILIZE);
  state.fields.River.soilMoisture = 62;
  setWeather(state, { rainTomorrow: 12 });
  assert.equal(fert().rule, safety.RULE_FERTILIZE);
  setWeather(state);
  state.fields.North.harvested = true;
  assert.equal(evaluate(state, proposal("North", [{ type: "fertilize", kgNHa: 40 }])).entries[0].rule, safety.RULE_FERTILIZE);
});

// -- RULE_NEIGHBOUR_FARM -----------------------------------------------------------------------
test("neighbour farm: borrow_combine and deliver_to without a farm are blocked", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  const { entries } = evaluate(state, proposal("West", [{ type: "borrow_combine" }, { type: "deliver_to", tonnes: 10 }]));
  assert.deepEqual(entries.map((e) => e.rule), [safety.RULE_NEIGHBOUR_FARM, safety.RULE_NEIGHBOUR_FARM]);
});

test("neighbour farm: a named neighbour with capacity is allowed; our combine stays free", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  state.storageUsedT = 400; // 50 t free, so ~66 t of West's rapeseed won't fit
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE) };
  const { entries, after } = evaluate(
    state,
    proposal("West", [
      { type: "borrow_combine", farm: ROHRDOMMELSEE },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 50 },
    ]),
  );
  assert.deepEqual(entries.map((e) => e.blocked), [false, false]);
  assert.equal(after.combine, 1);
  assert.equal(after.workers, 4); // our grain cart
});

// -- RULE_NEIGHBOUR_CAPACITY -------------------------------------------------------------------
test("neighbour capacity: a farm with no spare combine blocks the borrow", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  state.nearbyCapacity = { [ODERBLICK]: capacity(ODERBLICK, { combine: 0 }) };
  const { entries } = evaluate(state, proposal("West", [{ type: "borrow_combine", farm: ODERBLICK }]));
  assert.equal(entries[0].rule, safety.RULE_NEIGHBOUR_CAPACITY);
});

test("neighbour capacity: our own farm or an unknown farm counts as zero", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  state.nearbyCapacity = { [OWN_FARM_NAME]: capacity(OWN_FARM_NAME, { combine: 1, storageT: 300 }) };
  for (const farm of [OWN_FARM_NAME, "Hof Nirgendwo", "constructor"]) {
    const { entries } = evaluate(
      state,
      proposal("West", [{ type: "borrow_combine", farm }, { type: "deliver_to", farm, tonnes: 5 }]),
    );
    assert.deepEqual(entries.map((e) => e.rule), [safety.RULE_NEIGHBOUR_CAPACITY, safety.RULE_NEIGHBOUR_CAPACITY], farm);
  }
});

test("neighbour capacity: deliveries add up against what the farm reported", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  state.storageUsedT = 450; // silo full: all of North's 327.6 t is surplus
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE, { storageT: 100 }) };
  const { entries } = evaluate(
    state,
    proposal("North", [
      { type: "harvest" },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 80 },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 30 }, // 110 > 100
    ]),
  );
  assert.deepEqual(entries.slice(0, 2).map((e) => e.blocked), [false, false]);
  assert.equal(entries[2].rule, safety.RULE_NEIGHBOUR_CAPACITY);
});

test("neighbour capacity: one spare combine lends to one field only", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE, { combine: 1 }) };
  const { entries } = evaluate(
    state,
    proposal("North", [{ type: "borrow_combine", farm: ROHRDOMMELSEE }]),
    proposal("West", [{ type: "borrow_combine", farm: ROHRDOMMELSEE }]),
  );
  assert.equal(entryFor(entries, "North", "borrow_combine").blocked, false);
  assert.equal(entryFor(entries, "West", "borrow_combine").rule, safety.RULE_NEIGHBOUR_CAPACITY);
});

// -- ordering and accounting ------------------------------------------------------------------
test("priority: harvest before irrigate before spray before the rest", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  const { entries } = evaluate(
    state,
    proposal("River", [{ type: "spray", product: "fungicide" }, { type: "irrigate", mm: 10 }]),
    proposal("North", [{ type: "scout" }, { type: "harvest" }]),
  );
  assert.deepEqual(entries.map((e) => e.action.type), ["harvest", "irrigate", "spray", "scout"]);
});

test("starting usage continues from the first pass and is not mutated", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE) };
  const first = [proposal("North", [{ type: "harvest" }]), proposal("River", [{ type: "irrigate", mm: 20 }])];
  const usage = safety.usageOf(safety.evaluate(first, state).proposals, state);
  assert.equal(usage.workers, 3);
  assert.equal(usage.combine, 1);
  assert.equal(usage.waterM3, 4800);
  // Second pass: our combine is taken, so a local harvest is blocked; a borrowed one is fine.
  const { entries, after } = safety.evaluate(
    [proposal("West", [{ type: "harvest" }, { type: "borrow_combine", farm: ROHRDOMMELSEE }])],
    state,
    usage,
  );
  assert.equal(entries[0].rule, safety.RULE_MACHINE);
  assert.equal(entries[1].blocked, false);
  assert.equal(after.workers, 1);
  assert.equal(after.waterM3, 1700);
  assert.equal(after.combine, 0);
  assert.equal(usage.workers, 3); // the caller's usage is not mutated
  assert.deepEqual(usage.neighbourCombine, {});
});

test("storage after floors at zero, and a delivery never frees our own silo", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE, { storageT: 300 }) };
  const { before, after } = evaluate(
    state,
    proposal("North", [{ type: "harvest" }]),
    proposal("West", [
      { type: "borrow_combine", farm: ROHRDOMMELSEE },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 113.2 }, // 443.2 - 330: the whole surplus
    ]),
  );
  assert.equal(before.storageFreeT, 330);
  assert.equal(after.storageFreeT, 0);
});

test("entries carry copies of the actions", () => {
  const state = freshState();
  const action = { type: "irrigate", mm: 10, confidence: 0.8 };
  const { entries } = evaluate(state, proposal("River", [action]));
  assert.deepEqual(entries[0], { field: "River", action, blocked: false, rule: null });
  assert.notEqual(entries[0].action, action);
});

// -- RULE_COVER_CROP -----------------------------------------------------------------------------
test("cover crop: allowed on a harvested bare field", () => {
  const state = freshState();
  state.fields.North.harvested = true;
  const { entries, after } = evaluate(state, proposal("North", [{ type: "sow_cover_crop" }]));
  assert.equal(entries[0].blocked, false);
  assert.equal(after.workers, 4);
});

test("cover crop: blocked on a standing crop and where one is already sown", () => {
  const state = freshState();
  makeReady(state, "North"); // ripe but still on the field
  for (const field of ["North", "River"]) {
    const { entries, after } = evaluate(state, proposal(field, [{ type: "sow_cover_crop" }]));
    assert.equal(entries[0].rule, safety.RULE_COVER_CROP, field);
    assert.equal(after.workers, 5);
  }
  state.fields.North.harvested = true;
  state.fields.North.coverCrop = true;
  assert.equal(evaluate(state, proposal("North", [{ type: "sow_cover_crop" }])).entries[0].rule, safety.RULE_COVER_CROP);
});

// -- RULE_DELIVER_SURPLUS --------------------------------------------------------------------------
test("deliver surplus: nothing harvested means nothing to deliver", () => {
  const state = freshState();
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE, { storageT: 300 }) };
  const { entries, proposals } = evaluate(state, proposal("River", [{ type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 200 }]));
  assert.equal(entries[0].rule, safety.RULE_DELIVER_SURPLUS);
  assert.deepEqual(proposals[0].actions, []);
});

test("deliver surplus: only up to what doesn't fit in our silo", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  state.storageUsedT = 400; // 50 t free -> 277.6 t of North's wheat won't fit
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE, { storageT: 500 }) };
  const { entries } = evaluate(
    state,
    proposal("North", [
      { type: "harvest" },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 200 },
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 77.6 }, // exactly the rest
      { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 10 }, // nothing left to move
    ]),
  );
  assert.deepEqual(entries.map((e) => e.blocked), [false, false, false, true]);
  assert.equal(entries[3].rule, safety.RULE_DELIVER_SURPLUS);
});

test("passesAlone: would the action clear the check as the only work today?", () => {
  const state = freshState();
  setWeather(state);
  const north = proposal("North", [{ type: "harvest" }]);
  assert.equal(safety.passesAlone(north, north.actions[0], state), false); // 4 days from ripe
  makeReady(state, "North");
  assert.equal(safety.passesAlone(north, north.actions[0], state), true);
  const spray = proposal("North", [{ type: "spray", product: "fungicide" }]);
  assert.equal(safety.passesAlone(spray, spray.actions[0], state), false); // pre-harvest interval
  const badShape = proposal("North", [{ type: "harvest" }], { rationale: "" });
  assert.equal(safety.passesAlone(badShape, badShape.actions[0], state), false);
});

// -- RULE_ACTION_PARAMS -------------------------------------------------------------------------------
test("action amounts are required: mm, kgNHa, tonnes", () => {
  const state = freshState();
  setWeather(state);
  state.nearbyCapacity = { [ROHRDOMMELSEE]: capacity(ROHRDOMMELSEE) };
  for (const action of [
    { type: "irrigate" },
    { type: "irrigate", mm: 0 },
    { type: "fertilize" },
    { type: "deliver_to", farm: ROHRDOMMELSEE },
    { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 0 },
  ]) {
    const { entries, after } = evaluate(state, proposal("River", [action]));
    assert.equal(entries[0].rule, safety.RULE_ACTION_PARAMS, JSON.stringify(action));
    assert.equal(after.workers, 5); // a blocked action costs nothing
  }
  assert.equal(evaluate(state, proposal("River", [{ type: "fertilize", kgNHa: 40 }])).entries[0].blocked, false);
});

test("the fourteen rule texts are the hub's, word for word", () => {
  const rules = Object.entries(safety).filter(([k]) => k.startsWith("RULE_"));
  assert.equal(rules.length, 14);
  assert.equal(safety.RULE_WATER_PERMIT, "Irrigation must stay within today's water permit.");
  assert.equal(safety.RULE_ACTION_PARAMS, "irrigate needs mm > 0, fertilize needs kg_n_ha > 0, deliver_to needs tonnes > 0.");
});
