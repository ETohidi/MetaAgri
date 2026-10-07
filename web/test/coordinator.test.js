// The Coordinator: conflict resolution, the Machinery ring's suggestions, the Safety
// check's second pass, plan rows and the bundle shape. Port of tests/test_stem.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as coordinator from "../src/engine/coordinator.js";
import * as notices from "../src/engine/notices.js";
import { createRng } from "../src/engine/rng.js";
import * as safety from "../src/engine/safety.js";
import { FARM_NAMES, FarmState, OWN_FARM_NAME } from "../src/engine/state.js";

const ROHRDOMMELSEE = "Gut Rohrdommelsee";
const ODERBLICK = "Agrarhof Oderblick";

// -- helpers ---------------------------------------------------------------------------
const freshState = (seed = 0) => new FarmState({ seed, rng: createRng(seed) });

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

const capacities = ({ rohrdommelsee, oderblick } = {}) => ({
  [OWN_FARM_NAME]: capacity(OWN_FARM_NAME, { combine: 0, storageT: 100 }),
  [ROHRDOMMELSEE]: rohrdommelsee ?? capacity(ROHRDOMMELSEE, { combine: 1, storageT: 235, confidence: 0.85 }),
  [ODERBLICK]: oderblick ?? capacity(ODERBLICK, { combine: 0, storageT: 50, confidence: 0.85 }),
});

const entryFor = (entries, field, type) => entries.find((e) => e.field === field && e.action.type === type);
const logTexts = (state, actor) => state.log.filter((e) => actor === undefined || e.actor === actor).map((e) => e.text);
const ring = (bundle) => bundle.proposals.filter((p) => p.rationale.startsWith("Machinery ring:"));
const actionsOf = (bundle, type) => bundle.proposals.flatMap((p) => p.actions.filter((a) => a.type === type));
const near = (a, b, tol) => Math.abs(a - b) < tol;

/** What Twin.decide does on approve: apply the plan, then the notices it produces. */
function approve(state, bundle) {
  state.applyBundle(bundle);
  return notices.generate(bundle, state).map((n) => n.text);
}

function bothRipe(state) {
  setWeather(state);
  makeReady(state, "North", "West");
  return [
    proposal("North", [{ type: "harvest", confidence: 0.85 }]),
    proposal("West", [{ type: "harvest", confidence: 0.85 }]),
    proposal("River", [{ type: "irrigate", mm: 20, confidence: 0.8 }]),
  ];
}

// -- conflict resolution ---------------------------------------------------------------------
test("combine conflict: the field with the most value at risk keeps the combine", () => {
  const state = freshState();
  const { proposals, unmetHarvest } = coordinator.resolveConflicts(state, bothRipe(state));
  assert.deepEqual(proposals[0].actions.map((a) => a.type), ["harvest"]);
  assert.deepEqual(proposals[1].actions, []);
  assert.deepEqual(unmetHarvest, ["West"]);
  // North: 327.6 t x €220 = €72k; West: 115.6 t x €460 = €53k
  assert.equal(
    logTexts(state, "Coordinator").at(-1),
    "conflict: the combine was requested by North field and West field; kept North field (€72k at risk vs €53k), West field waits",
  );
});

test("combine conflict follows the value", () => {
  const state = freshState();
  const proposals = bothRipe(state);
  state.fields.West.yieldTHa = 8.0; // 30 ha x 8 t x €460 = €110k > North's €72k
  const resolved = coordinator.resolveConflicts(state, proposals);
  assert.deepEqual(resolved.proposals[0].actions, []);
  assert.deepEqual(resolved.proposals[1].actions.map((a) => a.type), ["harvest"]);
  assert.deepEqual(resolved.unmetHarvest, ["North"]);
});

test("conflict resolution works on copies of the proposals", () => {
  const state = freshState();
  const proposals = bothRipe(state);
  coordinator.resolveConflicts(state, proposals);
  assert.equal(proposals[1].actions.length, 1);
});

test("sprayer conflict: the most disease value at risk wins, and is no borrow candidate", () => {
  const state = freshState();
  setWeather(state);
  state.fields.North.harvested = true;
  state.fields.North.harvestedT = 300;
  state.fields.North.disease = 0.2; // 0.2 x 300 t x €220 = €13k
  state.fields.River.disease = 0.7; // 0.7 x 1008 t x €160 = €113k
  const { proposals, unmetHarvest } = coordinator.resolveConflicts(state, [
    proposal("North", [{ type: "spray", product: "herbicide" }]),
    proposal("River", [{ type: "spray", product: "fungicide" }, { type: "irrigate", mm: 10 }]),
  ]);
  assert.deepEqual(proposals[0].actions, []);
  assert.deepEqual(proposals[1].actions.map((a) => a.type), ["spray", "irrigate"]);
  assert.deepEqual(unmetHarvest, []);
  assert.ok(logTexts(state, "Coordinator").at(-1).startsWith("conflict: the sprayer was requested by North field and River field"));
});

test("no conflict when one field wants the combine", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  const { proposals, unmetHarvest } = coordinator.resolveConflicts(state, [proposal("North", [{ type: "harvest" }])]);
  assert.equal(proposals[0].actions[0].type, "harvest");
  assert.deepEqual(unmetHarvest, []);
  assert.ok(!logTexts(state).some((t) => t.includes("conflict")));
});

function unripeNorthRipeWest(state) {
  setWeather(state);
  state.fields.North.daysToHarvest = 1; // one day short of ripe
  makeReady(state, "West");
  return [proposal("North", [{ type: "harvest" }]), proposal("West", [{ type: "harvest" }]), proposal("River")];
}

test("an unripe harvest does not take the combine from a ripe field", () => {
  // North (more € at risk, but not ripe) must not win our combine and leave the ripe West
  // field waiting - or borrowing a neighbour's combine while ours stands idle.
  const state = freshState();
  const caps = Object.fromEntries(FARM_NAMES.map((n) => [n, capacity(n, { combine: 1, storageT: 200 })]));
  const bundle = coordinator.buildBundle(state, unripeNorthRipeWest(state), caps);
  assert.ok(!logTexts(state, "Coordinator").some((t) => t.startsWith("conflict:")));
  assert.equal(entryFor(bundle.safety, "North", "harvest").rule, safety.RULE_HARVEST);
  assert.equal(entryFor(bundle.safety, "West", "harvest").blocked, false);
  assert.deepEqual(actionsOf(bundle, "borrow_combine"), []);
  assert.equal(bundle.resourcesAfter.combine, 0); // our own combine does the work
  assert.deepEqual(bundle.planRows.map((r) => [r.field, r.actionType]), [["West", "harvest"]]);
});

test("an unripe harvest without neighbour combines: no 'no combine free' warning", () => {
  const state = freshState();
  const caps = Object.fromEntries(FARM_NAMES.map((n) => [n, capacity(n, { combine: 0, storageT: 200 })]));
  const bundle = coordinator.buildBundle(state, unripeNorthRipeWest(state), caps);
  assert.equal(entryFor(bundle.safety, "West", "harvest").blocked, false);
  assert.ok(!logTexts(state, "Machinery ring").some((t) => t.includes("no neighbour combine free")));
  assert.equal(bundle.resourcesAfter.combine, 0);
});

test("a spray inside the pre-harvest interval does not take the sprayer", () => {
  const state = freshState();
  setWeather(state);
  state.fields.North.disease = 0.9; // €65k at risk vs River's €56k, but 4 days from harvest
  const bundle = coordinator.buildBundle(
    state,
    [
      proposal("North", [{ type: "spray", product: "fungicide" }]),
      proposal("West"),
      proposal("River", [{ type: "spray", product: "fungicide" }]),
    ],
    capacities(),
  );
  assert.ok(!logTexts(state, "Coordinator").some((t) => t.startsWith("conflict:")));
  assert.equal(entryFor(bundle.safety, "North", "spray").rule, safety.RULE_PRE_HARVEST);
  assert.equal(entryFor(bundle.safety, "River", "spray").blocked, false);
  assert.equal(bundle.resourcesAfter.sprayer, 0);
});

// -- Machinery ring -------------------------------------------------------------------------------
test("ring: the losing field borrows a combine and the surplus is delivered", () => {
  const state = freshState();
  const bundle = coordinator.buildBundle(state, bothRipe(state), capacities());
  const r = ring(bundle);
  assert.equal(r.length, 1);
  assert.equal(r[0].field, "West");
  const [borrow, deliver] = r[0].actions;
  assert.equal(borrow.type, "borrow_combine");
  assert.equal(borrow.farm, ROHRDOMMELSEE);
  assert.equal(deliver.type, "deliver_to");
  assert.equal(deliver.farm, ROHRDOMMELSEE);
  const expectedSurplus = state.fields.North.yieldEstimateT + state.fields.West.yieldEstimateT - 330;
  assert.ok(near(deliver.tonnes, expectedSurplus, 0.06));
  assert.equal(r[0].confidence, 0.85);
  assert.equal(
    r[0].rationale,
    "Machinery ring: borrow Gut Rohrdommelsee's combine for West field; send 113 t surplus to Gut Rohrdommelsee.",
  );
  assert.deepEqual(r[0].risks, ["the neighbour's combine may arrive late", "trailer trips to the neighbour's silo"]);
  assert.ok(!bundle.safety.some((e) => e.blocked));
  assert.equal(bundle.resourcesAfter.storageFreeT, 0);
  assert.equal(bundle.resourcesAfter.workers, 5 - 2 - 1 - 1); // harvest, irrigate, grain cart
  assert.ok(logTexts(state, "Machinery ring").includes("compiled spare capacity from 3 farms"));
  assert.equal(
    borrow.reason,
    "Our combine is busy elsewhere and the rapeseed is ripe; Gut Rohrdommelsee can lend theirs today (confidence 0.85).",
  );
  assert.equal(
    deliver.reason,
    "~443 t coming in today but only 330 t free in our silo; Gut Rohrdommelsee reports 235 t spare storage.",
  );
});

test("ring: never borrows from our own farm, picks the highest confidence", () => {
  const state = freshState();
  const caps = capacities({
    rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 235, confidence: 0.5 }),
    oderblick: capacity(ODERBLICK, { combine: 1, storageT: 200, confidence: 0.9 }),
  });
  caps[OWN_FARM_NAME] = capacity(OWN_FARM_NAME, { combine: 1, storageT: 500, confidence: 1.0 });
  const bundle = coordinator.buildBundle(state, bothRipe(state), caps);
  const r = ring(bundle)[0];
  assert.equal(r.actions[0].farm, ODERBLICK);
  assert.ok(r.actions.every((a) => a.farm !== OWN_FARM_NAME));
});

test("ring: on equal confidence, the neighbour with more storage to spare lends", () => {
  const state = freshState();
  const caps = capacities({
    rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 100 }),
    oderblick: capacity(ODERBLICK, { combine: 1, storageT: 300 }),
  });
  const bundle = coordinator.buildBundle(state, bothRipe(state), caps);
  assert.equal(actionsOf(bundle, "borrow_combine")[0].farm, ODERBLICK);
});

test("ring: the surplus is split over neighbours", () => {
  const state = freshState();
  const caps = capacities({
    rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 60, confidence: 0.85 }),
    oderblick: capacity(ODERBLICK, { combine: 0, storageT: 200, confidence: 0.5 }),
  });
  const bundle = coordinator.buildBundle(state, bothRipe(state), caps);
  const delivers = ring(bundle)[0].actions.filter((a) => a.type === "deliver_to");
  assert.deepEqual([delivers[0].farm, delivers[0].tonnes], [ROHRDOMMELSEE, 60]);
  assert.equal(delivers[1].farm, ODERBLICK);
  assert.ok(near(delivers.reduce((s, a) => s + a.tonnes, 0), 443.2 - 330, 0.1));
  assert.equal(ring(bundle)[0].confidence, 0.5); // min over its actions
});

test("ring: warns when no neighbour combine is free", () => {
  const state = freshState();
  const bundle = coordinator.buildBundle(
    state,
    bothRipe(state),
    capacities({ rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 0, storageT: 235 }) }),
  );
  assert.ok(logTexts(state, "Machinery ring").includes("no neighbour combine free today; West field waits"));
  assert.ok(state.log.some((e) => e.actor === "Machinery ring" && e.level === "warn"));
  assert.deepEqual(actionsOf(bundle, "borrow_combine"), []);
  // Only North's 327.6 t comes in, which fits in the 330 t free: no deliver_to either.
  assert.deepEqual(actionsOf(bundle, "deliver_to"), []);
});

test("ring: a delivery without a borrow goes on the harvested field", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  state.storageUsedT = 400; // only 50 t free
  const caps = capacities({ rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 300 }) });
  const bundle = coordinator.buildBundle(state, [proposal("North", [{ type: "harvest" }])], caps);
  const r = ring(bundle)[0];
  assert.equal(r.field, "North");
  assert.deepEqual(r.actions, [
    { type: "deliver_to", tonnes: 277.6, farm: ROHRDOMMELSEE, confidence: 0.85, reason: r.actions[0].reason },
  ]);
});

test("ring: warns when neighbours can't store all of the surplus", () => {
  const state = freshState();
  const caps = capacities({
    rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 40 }),
    oderblick: capacity(ODERBLICK, { combine: 0, storageT: 30 }),
  });
  const bundle = coordinator.buildBundle(state, bothRipe(state), caps);
  assert.deepEqual(actionsOf(bundle, "deliver_to").map((a) => a.tonnes), [40, 30]);
  assert.ok(
    logTexts(state, "Machinery ring").includes(
      "neighbours can't store all of it; about 43 t would be sold directly at the harvest spot price",
    ),
  );
});

// -- the Safety check's second pass ---------------------------------------------------------------
test("pass two continues from pass one's usage", () => {
  // Pass 1 books all 5 workers, so the ring's borrow_combine (1 worker) is blocked in pass 2 -
  // and no deliver_to is suggested for grain that then stays on the field.
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  const bundle = coordinator.buildBundle(
    state,
    [
      proposal("North", [{ type: "harvest" }]), // 2
      proposal("West", [{ type: "harvest" }]), // loses the combine conflict
      proposal("River", [
        { type: "irrigate", mm: 10 }, // 1
        { type: "spray", product: "fungicide" }, // 1
        { type: "fertilize", kgNHa: 20 }, // 1
      ]),
    ],
    capacities(),
  );
  assert.equal(entryFor(bundle.safety, "West", "borrow_combine").rule, safety.RULE_WORKERS);
  assert.ok(logTexts(state, "Safety check").includes(`blocked borrow_combine for West field: ${safety.RULE_WORKERS}`));
  assert.ok(!bundle.safety.some((e) => e.action.type === "deliver_to"));
  assert.ok(!bundle.planRows.some((r) => r.actionType === "deliver_to"));
  const before = state.neighbours[ROHRDOMMELSEE].storageUsedT;
  const texts = approve(state, bundle);
  assert.equal(state.fields.West.harvested, false);
  assert.equal(state.neighbours[ROHRDOMMELSEE].storageUsedT, before);
  assert.ok(!texts.some((t) => t.includes("expect about")));
  assert.ok(!state.recentActions.some((a) => a.kind === "deliver"));
});

// -- the ring counts what the field agents already arranged themselves ---------------------------
test("ring delivers the surplus of a field agent's own borrow", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  const bundle = coordinator.buildBundle(
    state,
    [proposal("North", [{ type: "harvest" }]), proposal("West", [{ type: "borrow_combine", farm: ROHRDOMMELSEE }])],
    capacities(),
  );
  assert.ok(!bundle.safety.some((e) => e.blocked));
  const delivers = actionsOf(bundle, "deliver_to");
  assert.equal(delivers.length, 1);
  assert.equal(delivers[0].farm, ROHRDOMMELSEE);
  assert.ok(near(delivers[0].tonnes, 113.2, 0.06));
  assert.equal(ring(bundle)[0].field, "West");
  const before = state.neighbours[ROHRDOMMELSEE].storageUsedT;
  approve(state, bundle);
  assert.ok(near(state.neighbours[ROHRDOMMELSEE].storageUsedT - before, 113.2, 0.06));
  assert.ok(!logTexts(state, "Farm").some((t) => t.startsWith("sold")));
});

test("ring counts a field agent's own delivery", () => {
  // North sends its own 77.6 t overflow to Gut Rohrdommelsee; the ring then only moves West's
  // 115.6 t, and from what Gut Rohrdommelsee has left (not 193.2 t on top).
  const state = freshState();
  setWeather(state);
  makeReady(state, "North", "West");
  state.storageUsedT = 200; // 250 t free
  const bundle = coordinator.buildBundle(
    state,
    [
      proposal("North", [{ type: "harvest" }, { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 77.6 }]),
      proposal("West", [{ type: "harvest" }]), // loses the combine, borrows one
    ],
    capacities({ rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 235 }) }),
  );
  assert.ok(!bundle.safety.some((e) => e.blocked));
  const ringDelivers = ring(bundle).flatMap((p) => p.actions.filter((a) => a.type === "deliver_to"));
  assert.deepEqual(ringDelivers.map((a) => [a.farm, a.tonnes]), [[ROHRDOMMELSEE, 115.6]]);
  const before = state.neighbours[ROHRDOMMELSEE].storageUsedT;
  const texts = approve(state, bundle);
  assert.ok(near(state.neighbours[ROHRDOMMELSEE].storageUsedT - before, 193.2, 0.06));
  assert.equal(state.storageFreeT, 0);
  assert.ok(!logTexts(state, "Farm").some((t) => t.startsWith("sold")));
  assert.deepEqual(texts.filter((t) => t.includes("expect about")).sort(), [
    "Gut Rohrdommelsee: expect about 116 t of rapeseed for storage today.",
    "Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today.",
  ]);
});

test("no ring delivery when the field agent already sent the surplus", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "North");
  state.storageUsedT = 200; // 250 t free -> 77.6 t overflow
  const bundle = coordinator.buildBundle(
    state,
    [proposal("North", [{ type: "harvest" }, { type: "deliver_to", farm: ROHRDOMMELSEE, tonnes: 77.6 }])],
    capacities(),
  );
  assert.deepEqual(ring(bundle), []);
  assert.equal(actionsOf(bundle, "deliver_to").length, 1);
  const texts = approve(state, bundle);
  assert.deepEqual(texts.filter((t) => t.includes("expect about")), [
    "Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today.",
  ]);
});

test("ring skips a field already harvested with its own borrow", () => {
  // West loses the combine conflict but has borrowed a combine itself: no second borrow from
  // the ring, so no spurious safety-check block.
  const state = freshState();
  const proposals = bothRipe(state);
  proposals[1].actions.push({ type: "borrow_combine", farm: ROHRDOMMELSEE });
  const bundle = coordinator.buildBundle(state, proposals, capacities());
  assert.ok(!bundle.safety.some((e) => e.blocked));
  assert.ok(!logTexts(state, "Safety check").some((t) => t.startsWith("blocked")));
  assert.equal(actionsOf(bundle, "borrow_combine").length, 1);
  const delivers = actionsOf(bundle, "deliver_to");
  assert.equal(delivers.length, 1);
  assert.ok(near(delivers[0].tonnes, 113.2, 0.06));
});

// -- a neighbour's agent over-reports its silo space ----------------------------------------------
test("over-reported neighbour storage keeps the mass balance", () => {
  // Agrarhof Oderblick really has 20 t free but its agent says 300 t: only 20 t go there, the
  // rest is sold (and logged), and its notice says 20 t, not 113 t.
  const state = freshState();
  state.neighbours[ODERBLICK].storageUsedT = 580; // of 600
  const bundle = coordinator.buildBundle(
    state,
    bothRipe(state),
    capacities({
      rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: 0 }),
      oderblick: capacity(ODERBLICK, { combine: 0, storageT: 300, confidence: 0.9 }),
    }),
  );
  const delivers = actionsOf(bundle, "deliver_to");
  assert.equal(delivers.length, 1);
  assert.equal(delivers[0].farm, ODERBLICK);
  assert.ok(near(delivers[0].tonnes, 113.2, 0.06));
  const ownBefore = state.storageUsedT;
  const harvestedT = state.fields.North.yieldEstimateT + state.fields.West.yieldEstimateT;
  const texts = approve(state, bundle);
  const ownIn = state.storageUsedT - ownBefore;
  const neighbourIn = state.neighbours[ODERBLICK].storageUsedT - 580;
  assert.equal(ownIn, 330);
  assert.equal(neighbourIn, 20);
  // everything that fit nowhere is sold - and logged - rather than vanishing
  const sold = state.log.filter((e) => e.actor === "Farm" && e.text.startsWith("sold")).map((e) => e.text);
  assert.ok(near(harvestedT - ownIn - neighbourIn, 93.2, 1e-9));
  assert.deepEqual(sold, ["sold 93 t directly to the co-op at the harvest spot price"]);
  assert.ok(texts.includes("Agrarhof Oderblick: expect about 20 t of rapeseed for storage today."));
  assert.equal(bundle.proposals.at(-1).actions.find((a) => a.type === "deliver_to").movedT, 20);
});

test("a field agent's borrow from a farm with no spare combine is blocked", () => {
  const state = freshState();
  setWeather(state);
  makeReady(state, "West");
  const bundle = coordinator.buildBundle(
    state,
    [proposal("West", [{ type: "borrow_combine", farm: ODERBLICK, confidence: 0.6 }])],
    capacities(),
  );
  const e = entryFor(bundle.safety, "West", "borrow_combine");
  assert.equal(e.blocked, true);
  assert.equal(e.rule, safety.RULE_NEIGHBOUR_CAPACITY);
  assert.deepEqual(bundle.planRows, []);
  assert.equal(bundle.overallConfidence, null);
});

// -- plan rows / bundle ------------------------------------------------------------------------------
test("plan rows, summary and the bundle's shape", () => {
  const state = freshState();
  const bundle = coordinator.buildBundle(state, bothRipe(state), capacities());
  const rows = Object.fromEntries(bundle.planRows.map((r) => [`${r.field}/${r.actionType}`, r]));
  assert.equal(rows["North/harvest"].what, `Harvest ~${Math.round(state.fields.North.yieldEstimateT)} t`);
  assert.equal(rows["North/harvest"].what, "Harvest ~328 t");
  assert.equal(rows["North/harvest"].resources, "combine · 2 workers");
  assert.equal(rows["River/irrigate"].what, "Irrigate 20 mm");
  assert.equal(rows["River/irrigate"].resources, "4,800 m³ water · 1 worker");
  assert.equal(rows["West/borrow_combine"].what, "Harvest with Gut Rohrdommelsee's combine (~116 t)");
  assert.equal(rows["West/borrow_combine"].resources, "Gut Rohrdommelsee's combine · 1 worker");
  assert.equal(rows["West/deliver_to"].what, "Deliver 113 t to Gut Rohrdommelsee");
  assert.equal(rows["West/deliver_to"].resources, "—");
  assert.equal(rows["North/harvest"].crop, "winter wheat");
  assert.equal(rows["North/harvest"].reason, "test"); // the action has no reason: the rationale
  assert.equal(bundle.summary, "Mon 6 Jul: 4 proposals, 4/4 actions cleared by the safety check");
  assert.equal(bundle.overallConfidence, 0.8);
  assert.equal(bundle.planFor, "Mon 6 Jul");
  assert.equal(bundle.status, "pending");
  assert.equal(bundle.reason, null);
  assert.deepEqual(Object.keys(bundle).sort(), [
    "id", "nearbyCapacity", "overallConfidence", "planFor", "planRows", "proposals", "reason",
    "resourcesAfter", "resourcesBefore", "safety", "status", "summary", "tick",
  ]);
  for (const key of ["resourcesBefore", "resourcesAfter"]) {
    assert.deepEqual(Object.keys(bundle[key]).sort(), ["combine", "sprayer", "storageFreeT", "waterM3", "workers"]);
  }
  assert.deepEqual(Object.keys(bundle.planRows[0]).sort(), ["actionType", "confidence", "crop", "field", "reason", "resources", "what"]);
  assert.equal(logTexts(state, "Coordinator").at(-1), bundle.summary);
});

test("plan row texts for every action type", () => {
  const state = freshState();
  setWeather(state);
  state.fields.North.harvested = true;
  state.nearbyCapacity = {};
  const bundle = coordinator.buildBundle(
    state,
    [
      proposal("River", [{ type: "spray" }, { type: "fertilize", kgNHa: 40 }, { type: "irrigate", mm: 12.5 }]),
      proposal("North", [{ type: "sow_cover_crop", reason: "own reason" }, { type: "scout" }, { type: "defer_task" }]),
      proposal("West", [{ type: "fertilize", kgNHa: 0 }]),
    ],
    capacities(),
  );
  const whats = bundle.planRows.map((r) => [r.what, r.resources]);
  assert.deepEqual(whats, [
    // rows keep each proposal's own order (the check itself ran irrigate first)
    ["Spray crop protection", "sprayer · 1 worker"],
    ["Fertilize 40 kg N/ha", "1 worker"],
    ["Irrigate 12.5 mm", "3,000 m³ water · 1 worker"],
    ["Sow cover crop", "1 worker"],
    ["Scout field", "—"],
    ["Wait", "—"],
  ]);
  assert.equal(bundle.planRows[3].reason, "own reason");
  assert.equal(entryFor(bundle.safety, "West", "fertilize").rule, safety.RULE_ACTION_PARAMS);
});

test("every proposal is logged by its field agent", () => {
  const state = freshState();
  coordinator.buildBundle(state, bothRipe(state), capacities());
  assert.equal(logTexts(state, "River field agent").at(-1), "proposed 1 action(s): test");
  assert.equal(logTexts(state, "North field agent").at(-1), "proposed 1 action(s): test");
});

test("each farm's answer is logged, then the Machinery ring's summary", () => {
  const state = freshState();
  coordinator.buildBundle(state, [proposal("North", [{ type: "scout" }])], capacities());
  assert.deepEqual(logTexts(state, ROHRDOMMELSEE), [
    "can share 1 combine / 235 t storage until Tue 7 Jul (confidence 0.85). test",
  ]);
  const actors = state.log.map((e) => e.actor);
  assert.ok(actors.indexOf(ODERBLICK) < actors.indexOf("Machinery ring"));
});

test("bundle ids increment and today's capacity is recorded", () => {
  const state = freshState();
  const caps = capacities();
  const first = coordinator.buildBundle(state, [proposal("North", [{ type: "scout" }])], caps);
  const second = coordinator.buildBundle(state, [proposal("North", [{ type: "scout" }])], caps);
  assert.equal(second.id, first.id + 1);
  assert.deepEqual(state.nearbyCapacity, caps);
  assert.deepEqual(first.nearbyCapacity.map((c) => c.farm), [OWN_FARM_NAME, ROHRDOMMELSEE, ODERBLICK]);
});

test("the ring does not split off a trivial remainder", () => {
  // The first neighbour takes all but 0.2 t: no 'Deliver 0 t' trailer trip for the rest.
  const state = freshState();
  const proposals = bothRipe(state);
  const surplus = state.fields.North.yieldEstimateT + state.fields.West.yieldEstimateT - state.storageFreeT;
  const bundle = coordinator.buildBundle(
    state,
    proposals,
    capacities({
      rohrdommelsee: capacity(ROHRDOMMELSEE, { combine: 1, storageT: Math.round((surplus - 0.2) * 10) / 10 }),
      oderblick: capacity(ODERBLICK, { combine: 0, storageT: 250, confidence: 0.5 }),
    }),
  );
  assert.deepEqual(actionsOf(bundle, "deliver_to").map((a) => a.farm), [ROHRDOMMELSEE]);
  assert.ok(!bundle.planRows.some((r) => r.what.startsWith("Deliver 0 t")));
  const texts = approve(state, bundle);
  assert.ok(!texts.some((t) => t.includes("about 0 t")));
  assert.ok(!logTexts(state, "Farm").some((t) => t.startsWith("sold 0 t")));
});

test("the bundle keeps its own copies: applying it never changes the safety entries", () => {
  const state = freshState();
  const bundle = coordinator.buildBundle(state, bothRipe(state), capacities());
  approve(state, bundle);
  const deliverEntry = entryFor(bundle.safety, "West", "deliver_to");
  assert.equal(deliverEntry.action.movedT, undefined);
  assert.ok(near(actionsOf(bundle, "deliver_to")[0].movedT, 113.2, 0.06));
});
