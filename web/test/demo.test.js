// The three designed demo moments (DESIGN.md section 9, DEMO.md), driven through the Twin
// exactly like the page does: first as a sweep over seeds 0..29 (each moment must happen in
// at least 80% of them; the rates are printed), then the default seed's walkthrough, pinned
// number by number so the docs can quote it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEED, Twin } from "../src/engine/twin.js";
import { RULE_WATER_PERMIT } from "../src/engine/safety.js";

const SEEDS = Array.from({ length: 30 }, (_, i) => i);
const MIN_RATE = 0.8;
const REJECT_REASON = "Wait for better weather";
const RIVER_AREA_HA = 24;
const ROHRDOMMELSEE = "Gut Rohrdommelsee";

const MOMENTS = [
  "A  normal day: River irrigates 25 mm (6,000 m³), allowed, approved",
  "B1 heatwave: River's irrigation blocked by the water permit",
  "B2 after the rejection: River irrigates within the cut permit, noting the rejection",
  "C1 hail warning: combine conflict logged, North field kept",
  "C2 North field harvest allowed",
  "C3 West field borrows Gut Rohrdommelsee's combine, allowed",
  "C4 deliver_to for the silo surplus allowed",
  "C5 approved: notices for Buyers + Gut Rohrdommelsee, silo and neighbour storage updated",
];

const entry = (bundle, field, type) => bundle.safety.find((e) => e.field === field && e.action.type === type);
const allowed = (e) => e !== undefined && !e.blocked;
const storageUsed = (snap) => Object.fromEntries(snap.farms.map((f) => [f.name, f.storageCapacityT - f.storageFreeT]));

/** Acts 1 and 2: the opening plan, then a heatwave, a rejection and the re-plan. */
function momentsAB(seed) {
  const out = {};
  const t = new Twin({ seed });
  let bundle = t.snapshot().pendingBundle;
  let irrigate = entry(bundle, "River", "irrigate");
  const approved = t.decide(bundle.id, "approve").status === "approved";
  out[MOMENTS[0]] =
    allowed(irrigate) && irrigate.action.mm === 25 && irrigate.action.mm * RIVER_AREA_HA * 10 === 6000 && approved;

  t.heatwave();
  let blocked = null;
  for (let i = 0; i < 3; i++) {
    bundle = t.tick();
    irrigate = entry(bundle, "River", "irrigate");
    if (irrigate?.blocked && irrigate.rule === RULE_WATER_PERMIT) {
      blocked = bundle;
      break;
    }
    t.decide(bundle.id, "approve");
  }
  out[MOMENTS[1]] = blocked !== null;
  if (blocked === null) {
    out[MOMENTS[2]] = false;
    return out;
  }
  t.decide(blocked.id, "reject", REJECT_REASON);
  bundle = t.tick();
  irrigate = entry(bundle, "River", "irrigate");
  const river = bundle.proposals.find((p) => p.field === "River");
  const permit = t.snapshot().resources.waterPermitM3;
  out[MOMENTS[2]] =
    allowed(irrigate) &&
    permit === 3600 &&
    irrigate.action.mm * RIVER_AREA_HA * 10 <= 3600 &&
    river.rationale.includes(`(Noting recent rejection: ${REJECT_REASON})`);
  return out;
}

/** Act 3, after a restart: approve the opening plan, hail warning, the next day's plan. */
function momentC(seed) {
  const out = {};
  const t = new Twin({ seed });
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.hail();
  const bundle = t.tick();
  const coordinator = t.log().filter((e) => e.actor === "Coordinator" && e.tick === bundle.tick).map((e) => e.text);
  out[MOMENTS[3]] = coordinator.some((x) =>
    x.startsWith("conflict: the combine was requested by North field and West field; kept North field"),
  );
  out[MOMENTS[4]] = allowed(entry(bundle, "North", "harvest"));
  const borrow = entry(bundle, "West", "borrow_combine");
  out[MOMENTS[5]] = allowed(borrow) && borrow.action.farm === ROHRDOMMELSEE;
  const delivers = bundle.safety.filter((e) => e.action.type === "deliver_to" && !e.blocked);
  out[MOMENTS[6]] = delivers.length > 0;

  const before = t.snapshot();
  t.decide(bundle.id, "approve");
  const after = t.snapshot();
  const audiences = new Set(t.notices().filter((n) => n.tick === bundle.tick).map((n) => n.audience));
  const delivered = {};
  for (const e of delivers) delivered[e.action.farm] = (delivered[e.action.farm] ?? 0) + e.action.tonnes;
  const usedBefore = storageUsed(before);
  const usedAfter = storageUsed(after);
  const neighboursUpdated =
    delivers.length > 0 &&
    Object.entries(delivered).every(([farm, tonnes]) => Math.abs(usedAfter[farm] - usedBefore[farm] - tonnes) < 0.2);
  out[MOMENTS[7]] =
    audiences.has("Buyers") &&
    audiences.has(ROHRDOMMELSEE) &&
    after.resources.storageFreeT === 0 &&
    after.resources.storageUsedT > before.resources.storageUsedT &&
    after.fields.North.harvested &&
    after.fields.West.harvested &&
    neighboursUpdated;
  return out;
}

const results = Object.fromEntries(SEEDS.map((seed) => [seed, { ...momentsAB(seed), ...momentC(seed) }]));
const rate = (moment) => SEEDS.filter((seed) => results[seed][moment]).length / SEEDS.length;

test("the demo moments over seeds 0..29 (rates)", (t) => {
  t.diagnostic(`Demo moments over seeds ${SEEDS[0]}..${SEEDS.at(-1)}:`);
  for (const moment of MOMENTS) {
    const misses = SEEDS.filter((seed) => !results[seed][moment]);
    const missText = misses.length ? `  (missed: seeds ${misses.join(", ")})` : "";
    t.diagnostic(`${String(Math.round(rate(moment) * 100)).padStart(4)}%  ${moment}${missText}`);
  }
  for (const seed of SEEDS) assert.deepEqual(Object.keys(results[seed]), MOMENTS);
});

for (const moment of MOMENTS) {
  test(`demo moment is reliable: ${moment}`, () => {
    assert.ok(rate(moment) >= MIN_RATE, `${Math.round(rate(moment) * 100)}%`);
  });
}

test("the default seed shows every moment", () => {
  const all = { ...momentsAB(DEFAULT_SEED), ...momentC(DEFAULT_SEED) };
  assert.deepEqual(
    Object.entries(all).filter(([, ok]) => !ok).map(([m]) => m),
    [],
  );
});

// -- the default-seed walkthrough, pinned ------------------------------------------------------
const rows = (bundle) => bundle.planRows.map((r) => [r.field, r.what, r.resources, r.confidence, r.reason]);
const logOf = (t, tick) => t.log().filter((e) => e.tick === tick).reverse();
const texts = (entries, actor) => entries.filter((e) => actor === undefined || e.actor === actor).map((e) => e.text);

test("default-seed walkthrough, acts 1 and 2: normal day, heatwave block, permit-fitted re-plan", () => {
  const t = new Twin();
  assert.equal(DEFAULT_SEED, 20260707);

  // Act 1: the page opens on Monday 6 July with the plan for that day.
  let s = t.snapshot();
  assert.equal(s.longDate, "Monday 6 July");
  assert.deepEqual(
    [s.weatherToday.tempMaxC, s.weatherToday.rainMm, s.weatherToday.windMs, s.weatherToday.et0Mm],
    [25, 0, 3.2, 4.2],
  );
  assert.deepEqual(s.forecast.map((w) => [w.date, w.rainMm]), [["Tue 7 Jul", 7.5], ["Wed 8 Jul", 0], ["Thu 9 Jul", 3.3]]);
  let plan = s.pendingBundle;
  assert.equal(plan.summary, "Mon 6 Jul: 3 proposals, 2/2 actions cleared by the safety check");
  assert.equal(plan.overallConfidence, 0.7);
  assert.deepEqual(rows(plan), [
    ["West", "Scout field", "—", 0.7, "rapeseed ripening, 3 days to harvest; checking seed moisture."],
    [
      "River",
      "Irrigate 25 mm",
      "6,000 m³ water · 1 worker",
      0.8,
      "Soil moisture 62%; forecast 10.3 mm crop water use vs 7.5 mm rain over 2 days (heading for ~59%, stress below 60%).",
    ],
  ]);
  assert.deepEqual(plan.resourcesBefore, { waterM3: 6500, workers: 5, combine: 1, sprayer: 1, storageFreeT: 330 });
  assert.deepEqual(plan.resourcesAfter, { waterM3: 500, workers: 4, combine: 1, sprayer: 1, storageFreeT: 330 });
  assert.deepEqual(texts(logOf(t, 0), "River field agent"), [
    "proposed 1 action(s): Soil at 62%, heading for ~59% over the next 2 days; irrigating 25 mm (6,000 m³).",
  ]);
  t.decide(plan.id, "approve");
  s = t.snapshot();
  assert.equal(s.fields.River.soilMoisturePct, 87);
  assert.deepEqual(s.recentActions, [{ field: "River", kind: "irrigate" }]);
  assert.deepEqual(t.notices().map((n) => `${n.audience}: ${n.text}`), [
    "Neighbours: Irrigation running on River field today (25 mm) — the field track may be wet.",
  ]);

  // Act 2: heatwave. The permit is cut at once, today and the next three days turn hot.
  assert.deepEqual(t.heatwave(), { scenario: "heatwave: water permit cut to 3,600 m³/day" });
  s = t.snapshot();
  assert.deepEqual([s.weatherToday.tempMaxC, s.weatherToday.et0Mm, s.resources.waterPermitM3], [34.2, 7.2, 3600]);
  assert.deepEqual(s.forecast.map((w) => w.note), ["heatwave", "heatwave", "heatwave"]);
  assert.equal(t.log()[0].text, "Heatwave for 4 days: the water authority cut the permit to 3,600 m³/day");

  plan = t.tick(); // Tue 7 Jul
  s = t.snapshot();
  assert.equal(s.fields.River.soilMoisturePct, 78.9);
  assert.deepEqual([s.fields.North.daysToHarvest, s.fields.West.daysToHarvest], [2, 1]); // ripening twice as fast
  assert.equal(plan.summary, "Tue 7 Jul: 3 proposals, 2/3 actions cleared by the safety check");
  assert.deepEqual(
    plan.safety.filter((e) => e.blocked).map((e) => [e.field, e.action.type, e.action.mm, e.rule]),
    [["River", "irrigate", 25, RULE_WATER_PERMIT]],
  );
  assert.equal(
    entry(plan, "River", "irrigate").action.reason,
    "Soil moisture 79%; forecast 16.6 mm crop water use vs 0.0 mm rain over 2 days (heading for ~62%, stress below 60%).",
  );
  assert.deepEqual(rows(plan).map((r) => [r[0], r[1]]), [["North", "Scout field"], ["West", "Scout field"]]);
  assert.deepEqual(texts(logOf(t, 1), "Safety check"), [
    "blocked irrigate for River field: Irrigation must stay within today's water permit.",
  ]);
  t.decide(plan.id, "reject", REJECT_REASON);
  assert.equal(t.log()[0].text, "rejected the Tue 7 Jul plan: Wait for better weather");

  plan = t.tick(); // Wed 8 Jul
  assert.equal(plan.summary, "Wed 8 Jul: 4 proposals, 4/4 actions cleared by the safety check");
  const river = plan.planRows.find((r) => r.field === "River");
  assert.deepEqual([river.what, river.resources, river.confidence], ["Irrigate 15 mm", "3,600 m³ water · 1 worker", 0.75]);
  assert.equal(
    plan.proposals.find((p) => p.field === "River").rationale,
    "Soil at 70%, heading for ~58% over the next 2 days; irrigating 15 mm (3,600 m³), fitted to today's 3,600 m³ " +
      "water permit. (Noting recent rejection: Wait for better weather)",
  );
  // The heat also ripened both cereals at once: the combine conflict is already here.
  assert.deepEqual(texts(logOf(t, 2), "Coordinator")[0],
    "conflict: the combine was requested by North field and West field; kept North field (€71k at risk vs €53k), West field waits");
  assert.deepEqual(rows(plan).map((r) => r[1]), [
    "Harvest ~324 t",
    "Irrigate 15 mm",
    "Harvest with Gut Rohrdommelsee's combine (~114 t)",
    "Deliver 109 t to Gut Rohrdommelsee",
  ]);
  assert.deepEqual(plan.resourcesAfter, { waterM3: 0, workers: 1, combine: 0, sprayer: 1, storageFreeT: 0 });
});

test("default-seed walkthrough, act 3: after a restart, hail warning, conflict, Machinery ring, notices", () => {
  const t = new Twin();
  const opening = t.snapshot();
  t.decide(opening.pendingBundle.id, "approve"); // acts 1 and 2, as above
  t.heatwave();
  t.decide(t.tick().id, "reject", REJECT_REASON);
  t.tick();
  t.reset(); // Restart season: the same Monday and the same opening plan
  assert.deepEqual(t.snapshot(), opening);
  t.decide(t.snapshot().pendingBundle.id, "approve");
  assert.deepEqual(t.hail(), { scenario: "hail warning: severe hail expected Wed 8 Jul" });
  let s = t.snapshot();
  assert.equal(s.hailDate, "Wed 8 Jul");
  assert.deepEqual(s.forecast.map((w) => [w.date, w.rainMm, w.windMs, w.hail]), [
    ["Tue 7 Jul", 0, 2.6, false],
    ["Wed 8 Jul", 24, 13.7, true],
    ["Thu 9 Jul", 3.3, 3.1, false],
  ]);
  assert.deepEqual([s.fields.North.daysToHarvest, s.fields.West.daysToHarvest], [1, 1]);
  assert.equal(
    t.log()[0].text,
    "Hail warning: severe hail expected Wed 8 Jul; Tue 7 Jul stays dry, so the ripening wheat and rapeseed can come in early",
  );

  const plan = t.tick(); // Tue 7 Jul
  s = t.snapshot();
  assert.equal(plan.summary, "Tue 7 Jul: 4 proposals, 3/3 actions cleared by the safety check");
  assert.equal(plan.overallConfidence, 0.5);
  const day = logOf(t, 1);
  assert.deepEqual(texts(day, "Coordinator")[0],
    "conflict: the combine was requested by North field and West field; kept North field (€71k at risk vs €52k), West field waits");
  assert.deepEqual(rows(plan), [
    ["North", "Harvest ~324 t", "combine · 2 workers", 0.85, "Hail expected Wed 8 Jul; harvesting ripe wheat now."],
    [
      "West",
      "Harvest with Gut Rohrdommelsee's combine (~114 t)",
      "Gut Rohrdommelsee's combine · 1 worker",
      0.5,
      "Our combine is busy elsewhere and the rapeseed is ripe; Gut Rohrdommelsee can lend theirs today (confidence 0.50).",
    ],
    [
      "West",
      "Deliver 108 t to Gut Rohrdommelsee",
      "—",
      0.5,
      "~438 t coming in today but only 330 t free in our silo; Gut Rohrdommelsee reports 228 t spare storage.",
    ],
  ]);
  assert.equal(plan.proposals.at(-1).actions[1].tonnes, 108.2);
  assert.equal(
    plan.proposals.at(-1).rationale,
    "Machinery ring: borrow Gut Rohrdommelsee's combine for West field; send 108 t surplus to Gut Rohrdommelsee.",
  );
  assert.deepEqual(plan.nearbyCapacity.map((c) => [c.farm, c.canShare.combine, c.canShare.storageT, c.confidence]), [
    ["Hof Lerchenbruch", 0, 140, 0.5],
    ["Gut Rohrdommelsee", 1, 228, 0.5],
    ["Agrarhof Oderblick", 0, 53, 0.5],
  ]);
  assert.deepEqual(texts(day, ROHRDOMMELSEE), [
    "can share 1 combine / 228 t storage until Wed 8 Jul (confidence 0.50). combine free, 507 t silo space; " +
      "keeping a reserve while the weather warning lasts",
  ]);
  assert.deepEqual(plan.resourcesAfter, { waterM3: 6500, workers: 2, combine: 0, sprayer: 1, storageFreeT: 0 });
  assert.ok(!plan.safety.some((e) => e.blocked));
  assert.equal(s.farms[1].storageFreeT, 507.1);

  t.decide(plan.id, "approve");
  s = t.snapshot();
  assert.deepEqual([s.resources.storageFreeT, s.resources.storageUsedT, s.resources.combine], [0, 450, 0]);
  assert.deepEqual(s.farms.map((f) => [f.name, f.storageFreeT, f.status]), [
    ["Hof Lerchenbruch", 0, "crit"],
    ["Gut Rohrdommelsee", 398.9, "ok"],
    ["Agrarhof Oderblick", 156.6, "warn"],
  ]);
  assert.deepEqual([s.fields.North.yieldEstimateT, s.fields.West.yieldEstimateT], [324.3, 113.9]);
  assert.deepEqual(s.recentActions, [
    { field: "North", kind: "harvest" },
    { field: "West", kind: "harvest", farm: ROHRDOMMELSEE },
    { field: "West", kind: "deliver", farm: ROHRDOMMELSEE },
  ]);
  assert.deepEqual(t.notices().filter((n) => n.date === "Tue 7 Jul").reverse().map((n) => `${n.audience}: ${n.text}`), [
    "Buyers: Winter wheat harvest on North field today — about 324 t expected. Confidence: high.",
    "Buyers: Rapeseed harvest on West field today — about 114 t expected. Confidence: medium.",
    "Gut Rohrdommelsee: Gut Rohrdommelsee: thanks for lending your combine for our West field (rapeseed) today.",
    "Gut Rohrdommelsee: Gut Rohrdommelsee: expect about 108 t of rapeseed for storage today.",
  ]);
  assert.ok(!t.log().some((e) => e.text.startsWith("sold"))); // the whole surplus found a silo

  // The storm: only River's potatoes are still standing.
  const hailDay = t.tick(); // Wed 8 Jul
  s = t.snapshot();
  assert.deepEqual([s.weatherToday.rainMm, s.weatherToday.hail], [24, true]);
  assert.deepEqual(texts(logOf(t, 2)).filter((x) => x.startsWith("Hail hit")), [
    "Hail hit River field: potato leaves shredded, crop health down 0.08",
  ]);
  assert.equal(s.fields.River.cropHealth, 0.828); // from 0.904
  assert.deepEqual(rows(hailDay).map((r) => [r[0], r[1], r[4]]), [
    ["North", "Wait", "Wheat stubble too wet after 24.0 mm rain; drilling the cover crop once the soil dries."],
    ["West", "Wait", "Rapeseed stubble too wet after 24.0 mm rain; drilling the cover crop once the soil dries."],
  ]);
  t.decide(hailDay.id, "approve");
  const next = t.tick(); // Thu 9 Jul, 3.3 mm
  assert.deepEqual(rows(next).map((r) => [r[0], r[1]]), [["North", "Sow cover crop"], ["West", "Sow cover crop"]]);
  t.decide(next.id, "approve");
  s = t.snapshot();
  assert.deepEqual([s.fields.North.stage, s.fields.West.stage], ["cover crop", "cover crop"]);
  assert.deepEqual(t.notices().slice(0, 2).map((n) => n.text).sort(), [
    "Cover crop sown on North field after the wheat harvest.",
    "Cover crop sown on West field after the rapeseed harvest.",
  ]);
});

test("default-seed walkthrough, the counterfactual: reject the hail plan and the storm takes 40%", () => {
  const t = new Twin();
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.hail();
  const plan = t.tick();
  t.decide(plan.id, "reject", "A neighbour farm should help with this");
  assert.ok(t.census("West").hint.startsWith("The farm manager suggested a neighbour farm could help"));
  const hailDay = t.tick();
  const s = t.snapshot();
  assert.deepEqual(texts(logOf(t, 2)).filter((x) => x.startsWith("Hail hit")), [
    "Hail hit North field: winter wheat lost 40%",
    "Hail hit West field: rapeseed lost 40%",
    "Hail hit River field: potato leaves shredded, crop health down 0.08",
  ]);
  assert.deepEqual([s.fields.North.yieldEstimateT, s.fields.West.yieldEstimateT], [192.6, 67.3]); // from 324.3 / 113.9
  assert.deepEqual(rows(hailDay).map((r) => [r[0], r[1], r[4]]), [
    ["North", "Wait", "wheat ripe but 24.0 mm rain today - too wet to harvest."],
    ["West", "Wait", "rapeseed ripe but 24.0 mm rain today - too wet to harvest."],
  ]);
});
