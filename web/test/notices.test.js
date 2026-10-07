// Notice templates, confidence labels, and applying an approved plan to the twin. Port of
// tests/test_notices.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as notices from "../src/engine/notices.js";
import { createRng } from "../src/engine/rng.js";
import { FarmState } from "../src/engine/state.js";

const freshState = (seed = 0) => new FarmState({ seed, rng: createRng(seed) });
const near = (a, b, tol) => Math.abs(a - b) < tol;

function makeReady(state, ...fields) {
  for (const f of fields) state.fields[f].daysToHarvest = 0;
}

const bundle = (...proposals) => ({ id: 1, tick: 0, planFor: "Mon 6 Jul", proposals, status: "approved" });
const p = (field, actions, confidence = 0.8) => ({ field, actions, rationale: "test", confidence, risks: [] });

test("confidence labels", () => {
  assert.equal(notices.confidenceLabel(0.7), "high");
  assert.equal(notices.confidenceLabel(0.69), "medium");
  assert.equal(notices.confidenceLabel(0.4), "medium");
  assert.equal(notices.confidenceLabel(0.39), "low");
});

test("every template", () => {
  const state = freshState();
  const b = bundle(
    p("West", [{ type: "harvest", confidence: 0.85 }]),
    p("River", [{ type: "spray", product: "fungicide" }, { type: "irrigate", mm: 25.0 }, { type: "fertilize" }]),
    p("North", [{ type: "sow_cover_crop" }, { type: "scout" }, { type: "defer_task" }]),
    p("North", [
      { type: "borrow_combine", farm: "Gut Rohrdommelsee", confidence: 0.5 },
      { type: "deliver_to", farm: "Gut Rohrdommelsee", tonnes: 114.6 },
    ]),
  );
  const byText = Object.fromEntries(notices.generate(b, state).map((n) => [n.text, n.audience]));
  assert.deepEqual(byText, {
    "Rapeseed harvest on West field today — about 116 t expected. Confidence: high.": "Buyers",
    "Fungicide spraying on River field today — please keep hives and walkers away from the field edge.":
      "Beekeepers & neighbours",
    "Irrigation running on River field today (25 mm) — the field track may be wet.": "Neighbours",
    "Fertilizer spreading on River field today.": "Neighbours",
    "Cover crop sown on North field after the wheat harvest.": "Neighbours",
    "Winter wheat harvest on North field today — about 328 t expected. Confidence: medium.": "Buyers",
    "Gut Rohrdommelsee: thanks for lending your combine for our North field (winter wheat) today.": "Gut Rohrdommelsee",
    "Gut Rohrdommelsee: expect about 115 t of winter wheat for storage today.": "Gut Rohrdommelsee",
  });
});

test("a spray without a product is 'Crop protection'", () => {
  const state = freshState();
  const [n] = notices.generate(bundle(p("River", [{ type: "spray" }])), state);
  assert.equal(n.text, "Crop protection spraying on River field today — please keep hives and walkers away from the field edge.");
});

test("notices keep the last 30", () => {
  const state = freshState();
  for (let i = 0; i < 35; i++) state.addNotice("Buyers", `n${i}`);
  assert.equal(state.notices.length, 30);
  assert.equal(state.notices[0].text, "n5");
  assert.equal(state.notices.at(-1).text, "n34");
  assert.deepEqual(Object.keys(state.notices.at(-1)).sort(), ["audience", "date", "text", "tick"]);
});

// -- applyBundle ---------------------------------------------------------------------------------
test("apply irrigate and spray", () => {
  const state = freshState();
  const river = state.fields.River;
  river.soilMoisture = 80;
  river.disease = 0.6;
  state.applyBundle(bundle(p("River", [{ type: "irrigate", mm: 25.0 }, { type: "spray", product: "fungicide" }])));
  assert.equal(river.soilMoisture, 100); // capped
  assert.equal(river.lastIrrigatedTick, 0);
  assert.equal(river.lastSprayedTick, 0);
  assert.ok(near(river.disease, 0.2, 1e-9));
  assert.equal(state.history.River.at(-1).irrigationMm, 25.0);
  assert.equal(state.history.River.at(-1).soilMoisturePct, 100);
  assert.deepEqual(state.recentActions, [
    { field: "River", kind: "irrigate" },
    { field: "River", kind: "spray" },
  ]);
});

test("apply spray: disease never drops below 0.05", () => {
  const state = freshState();
  state.fields.River.disease = 0.3;
  state.applyBundle(bundle(p("River", [{ type: "spray" }])));
  assert.equal(state.fields.River.disease, 0.05);
});

test("apply harvest fills the silo and delivers the surplus", () => {
  const state = freshState();
  makeReady(state, "North", "West");
  const northT = state.fields.North.yieldEstimateT;
  const westT = state.fields.West.yieldEstimateT;
  const surplus = northT + westT - 330;
  const rohrBefore = state.neighbours["Gut Rohrdommelsee"].storageUsedT;
  state.applyBundle(
    bundle(
      // deliver_to listed first on purpose: it's applied after every harvest
      p("West", [{ type: "deliver_to", farm: "Gut Rohrdommelsee", tonnes: Math.round(surplus * 10) / 10 }]),
      p("North", [{ type: "harvest" }]),
      p("West", [{ type: "borrow_combine", farm: "Gut Rohrdommelsee" }]),
    ),
  );
  assert.equal(state.fields.North.harvested, true);
  assert.equal(state.fields.North.stage, "harvested");
  assert.equal(state.fields.North.yieldEstimateT, northT);
  assert.equal(state.storageUsedT, 450);
  assert.equal(state.storageFreeT, 0);
  const moved = state.neighbours["Gut Rohrdommelsee"].storageUsedT - rohrBefore;
  assert.ok(near(moved, surplus, 0.06));
  assert.equal(state.pendingSurplusT, 0);
  assert.ok(!state.log.some((e) => e.text.startsWith("sold")));
  assert.equal(state.ownCombineBusy, true);
  assert.equal(state.resourcesSnapshot().combine, 0);
  assert.deepEqual(state.recentActions, [
    { field: "North", kind: "harvest" },
    { field: "West", kind: "harvest", farm: "Gut Rohrdommelsee" },
    { field: "West", kind: "deliver", farm: "Gut Rohrdommelsee" },
  ]);
  // today's farm-history rows follow the approved plan (the neighbour chart matches the snapshot)
  assert.equal(state.farmHistory["Hof Lerchenbruch"].at(-1).storageFreeT, 0);
  assert.equal(state.farmHistory["Hof Lerchenbruch"].at(-1).combineAvailable, 0);
  const n = state.neighbours["Gut Rohrdommelsee"];
  assert.equal(state.farmHistory["Gut Rohrdommelsee"].at(-1).storageFreeT, Math.round((n.storageCapacityT - n.storageUsedT) * 10) / 10);
  assert.equal(state.farmHistory["Gut Rohrdommelsee"].length, 1); // rewritten, not appended
});

test("an undelivered surplus is sold to the co-op", () => {
  const state = freshState();
  makeReady(state, "North");
  state.storageUsedT = 400;
  state.applyBundle(bundle(p("North", [{ type: "harvest" }])));
  assert.equal(state.storageFreeT, 0);
  assert.deepEqual(state.log.at(-1), {
    tick: 0,
    date: "Mon 6 Jul",
    actor: "Farm",
    text: "sold 278 t directly to the co-op at the harvest spot price", // 327.6 - 50
    level: "info",
  });
  assert.equal(state.pendingSurplusT, 0);
});

test("apply cover crop and fertilize", () => {
  const state = freshState();
  state.fields.North.harvested = true;
  const h = state.fields.River.health;
  state.applyBundle(bundle(p("North", [{ type: "sow_cover_crop" }]), p("River", [{ type: "fertilize" }, { type: "scout" }])));
  assert.equal(state.fields.North.coverCrop, true);
  assert.equal(state.fields.North.stage, "cover crop");
  assert.ok(near(state.fields.River.health, Math.min(0.95, h + 0.02), 1e-9));
});

test("a cover crop never lands on a standing crop", () => {
  const state = freshState();
  state.applyBundle(bundle(p("North", [{ type: "sow_cover_crop" }])));
  assert.equal(state.fields.North.coverCrop, false);
  assert.equal(state.fields.North.stage, "ripening");
});

test("the delivery notice reports what actually moved", () => {
  // The plan said 200 t, but only 77.6 t of North's harvest didn't fit in our silo.
  const state = freshState();
  makeReady(state, "North");
  state.storageUsedT = 200; // 250 t free
  const b = bundle(p("North", [{ type: "harvest" }, { type: "deliver_to", farm: "Gut Rohrdommelsee", tonnes: 200.0 }]));
  state.applyBundle(b);
  assert.ok(near(state.neighbours["Gut Rohrdommelsee"].storageUsedT - 380, 77.6, 1e-6));
  assert.equal(b.proposals[0].actions[1].movedT, 77.6);
  const texts = notices.generate(b, state).map((n) => n.text);
  assert.ok(texts.includes("Gut Rohrdommelsee: expect about 78 t of winter wheat for storage today."));
});

test("a delivery of nothing sends no notice and no animation", () => {
  const state = freshState();
  const b = bundle(p("River", [{ type: "deliver_to", farm: "Gut Rohrdommelsee", tonnes: 200.0 }]));
  state.applyBundle(b);
  assert.equal(state.neighbours["Gut Rohrdommelsee"].storageUsedT, 380);
  assert.deepEqual(notices.generate(b, state), []);
  assert.deepEqual(state.recentActions, []);
});

test("a delivery to an unknown farm moves nothing", () => {
  const state = freshState();
  makeReady(state, "North");
  state.storageUsedT = 400;
  state.applyBundle(bundle(p("North", [{ type: "harvest" }, { type: "deliver_to", farm: "Hof Nirgendwo", tonnes: 100 }])));
  assert.ok(state.log.at(-1).text.startsWith("sold 278 t"));
});
