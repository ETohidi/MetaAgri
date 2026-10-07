// The Twin facade: snapshot shape (types.js), queries, commands, decide (approve / reject /
// expire / errors / the safety re-check), notices only from approved plans, subscriptions,
// copies and determinism. Port of tests/test_api.py without the HTTP layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEED, Twin } from "../src/engine/twin.js";
import { farmStatus, NEIGHBOUR_HINT } from "../src/engine/state.js";

const FIELDS = ["North", "West", "River"];
const FARMS = ["Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"];
const sorted = (o) => Object.keys(o).sort();

const SNAPSHOT_KEYS = [
  "bundleCount", "date", "farm", "farms", "fields", "forecast", "hailDate", "heatwaveDaysRemaining", "longDate",
  "nearbyCapacity", "pendingBundle", "recentActions", "recentProposals", "resources", "scenarios", "seed", "tick",
  "weatherToday",
];
const FIELD_KEYS = [
  "areaHa", "coverCrop", "crop", "cropHealth", "daysToHarvest", "diseasePressure", "emoji", "harvestReady",
  "harvestWaitingDays", "harvested", "id", "irrigable", "lastIrrigatedDate", "lastSprayedDate", "name", "polygon",
  "recentRejections", "routeId", "soilMoisturePct", "stage", "stressThresholdPct", "yieldEstimateT",
];
const WEATHER_KEYS = ["date", "et0Mm", "hail", "humidityPct", "note", "rainMm", "tempMaxC", "windMs"];
const FARM_ROW_KEYS = [
  "areaHa", "avgSoilMoisturePct", "combineAvailable", "crops", "id", "isOwn", "lat", "lon", "name", "status",
  "storageCapacityT", "storageFreeT",
];
const BUNDLE_KEYS = [
  "id", "nearbyCapacity", "overallConfidence", "planFor", "planRows", "proposals", "reason", "resourcesAfter",
  "resourcesBefore", "safety", "status", "summary", "tick",
];
const RESOURCE_LINE_KEYS = ["combine", "sprayer", "storageFreeT", "waterM3", "workers"];

// -- snapshot ------------------------------------------------------------------------------
test("the snapshot's shape and opening values", () => {
  const t = new Twin({ seed: 0 });
  const s = t.snapshot();
  assert.deepEqual(sorted(s), SNAPSHOT_KEYS);
  assert.deepEqual([s.tick, s.date, s.longDate, s.seed, s.farm], [0, "Mon 6 Jul", "Monday 6 July", 0, "Hof Lerchenbruch"]);
  assert.deepEqual(Object.keys(s.fields), FIELDS);
  const north = s.fields.North;
  assert.deepEqual(sorted(north), FIELD_KEYS);
  assert.deepEqual(
    [north.id, north.routeId, north.name, north.crop, north.emoji, north.stage],
    ["North", "north", "North field", "winter wheat", "🌾", "ripening"],
  );
  assert.deepEqual([north.yieldEstimateT, north.soilMoisturePct, north.stressThresholdPct], [327.6, 48, 35]);
  assert.deepEqual([north.areaHa, north.daysToHarvest, north.harvestReady, north.harvested, north.coverCrop], [42, 4, false, false, false]);
  assert.deepEqual([north.cropHealth, north.diseasePressure, north.harvestWaitingDays, north.irrigable], [0.86, 0.15, 0, false]);
  assert.deepEqual([north.lastIrrigatedDate, north.lastSprayedDate, north.recentRejections], [null, null, []]);
  assert.deepEqual(north.polygon[0], [14.295, 52.6575]);
  assert.deepEqual(north.polygon[0], north.polygon.at(-1));
  assert.deepEqual([s.fields.West.emoji, s.fields.River.emoji, s.fields.River.stage], ["🌼", "🥔", "tuber bulking"]);
  assert.deepEqual(sorted(s.weatherToday), WEATHER_KEYS);
  assert.equal(s.weatherToday.date, "Mon 6 Jul");
  assert.equal(s.forecast.length, 3);
  assert.deepEqual(s.forecast.map((w) => w.date), ["Tue 7 Jul", "Wed 8 Jul", "Thu 9 Jul"]);
  assert.deepEqual(s.resources, {
    waterPermitM3: 6500,
    waterPermitNormalM3: 6500,
    workers: 5,
    combine: 1,
    sprayer: 1,
    storageCapacityT: 450,
    storageUsedT: 120,
    storageFreeT: 330,
  });
  assert.deepEqual([s.scenarios, s.heatwaveDaysRemaining, s.hailDate], [[], 0, null]);
  assert.deepEqual(s.farms.map((f) => f.name), FARMS);
  for (const f of s.farms) assert.deepEqual(sorted(f), FARM_ROW_KEYS);
  const own = s.farms[0];
  assert.deepEqual(
    [own.id, own.isOwn, own.crops, own.areaHa, own.lat, own.lon, own.storageFreeT, own.storageCapacityT],
    ["lerchenbruch", true, "wheat, rapeseed, potatoes", 96, 52.655, 14.3, 330, 450],
  );
  assert.equal(own.avgSoilMoisturePct, 50.2); // (48 x 42 + 44 x 30 + 62 x 24) / 96
  assert.deepEqual(s.farms.slice(1).map((f) => [f.id, f.isOwn, f.storageFreeT]), [
    ["rohrdommelsee", false, 520],
    ["oderblick", false, 180],
  ]);
  // firstPlan: the plan for Mon 6 Jul is waiting, and today's farm answers are in
  assert.deepEqual(sorted(s.pendingBundle), BUNDLE_KEYS);
  assert.equal(s.pendingBundle.planFor, "Mon 6 Jul");
  assert.equal(s.pendingBundle.id, 1);
  assert.equal(s.bundleCount, 1);
  assert.deepEqual(s.recentProposals, FIELDS);
  assert.deepEqual(Object.keys(s.nearbyCapacity), FARMS);
  assert.deepEqual(sorted(s.nearbyCapacity["Gut Rohrdommelsee"]), ["canShare", "confidence", "farm", "note", "validUntil"]);
  assert.deepEqual(s.recentActions, []);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s); // JSON-safe
});

test("without firstPlan the season opens with no plan", () => {
  const s = new Twin({ seed: 0, firstPlan: false }).snapshot();
  assert.equal(s.pendingBundle, null);
  assert.equal(s.bundleCount, 0);
  assert.deepEqual(s.nearbyCapacity, {});
  assert.deepEqual(s.recentProposals, []);
});

test("the default seed", () => {
  const t = new Twin();
  assert.equal(t.seed, DEFAULT_SEED);
  assert.equal(t.snapshot().seed, DEFAULT_SEED);
  assert.equal(t.log().at(-1).text, `season reset / seeded (seed ${DEFAULT_SEED})`);
});

test("farm status: crit / warn / ok from soil moisture and silo fill", () => {
  assert.equal(farmStatus(50, 300, 450), "ok");
  assert.equal(farmStatus(44.9, 300, 450), "warn");
  assert.equal(farmStatus(34.9, 300, 450), "crit");
  assert.equal(farmStatus(50, 60, 450), "warn"); // 86.7 % full
  assert.equal(farmStatus(50, 20, 450), "crit"); // 95.6 % full
  assert.equal(farmStatus(50, 0, 0), "ok");
});

// -- censuses ------------------------------------------------------------------------------
test("field census: what a field agent sees", () => {
  const t = new Twin({ seed: 0 });
  const c = t.census("River");
  assert.deepEqual(sorted(c), [
    "areaHa", "coverCrop", "crop", "cropHealth", "date", "daysSinceIrrigated", "daysSinceSprayed", "daysToHarvest",
    "diseasePressure", "field", "forecast", "harvestReady", "harvested", "hint", "irrigable", "recentRejections",
    "resources", "scenario", "soilMoisturePct", "stage", "stressThresholdPct", "tick", "weatherToday", "yieldEstimateT",
  ]);
  assert.equal(c.field, "River");
  assert.equal(c.irrigable, true);
  assert.equal(c.forecast.length, 3);
  assert.deepEqual(c.resources, { waterPermitM3: 6500, workers: 5, combine: 1, sprayer: 1, storageFreeT: 330 });
  assert.deepEqual([c.daysSinceIrrigated, c.hint, c.scenario], [null, null, null]);
  assert.deepEqual(t.census("river"), c); // the route id works too
  assert.throws(() => t.census("South"), /Unknown field South/);
});

test("a 'neighbour farm' rejection puts the hint into the next census", () => {
  const t = new Twin({ seed: 0 });
  t.decide(t.snapshot().pendingBundle.id, "reject", "A neighbour farm should help with this");
  const c = t.census("West");
  assert.deepEqual(c.recentRejections, ["A neighbour farm should help with this"]);
  assert.equal(c.hint, NEIGHBOUR_HINT);
  assert.ok(!c.hint.includes("check what the Machinery ring reports"));
});

test("farm census: what a farm agent sees, by name or id", () => {
  const t = new Twin({ seed: 0 });
  const c = t.farmCensus("Gut Rohrdommelsee");
  assert.deepEqual(c, {
    farm: "Gut Rohrdommelsee",
    date: "Mon 6 Jul",
    storageFreeT: 520,
    combineAvailable: c.combineAvailable,
    ripeBacklogHa: 0,
    avgSoilMoisturePct: 52,
    scenario: null,
  });
  assert.deepEqual(t.farmCensus("rohrdommelsee"), c);
  const own = t.farmCensus("Hof Lerchenbruch");
  assert.equal(own.storageFreeT, 330);
  assert.equal(own.ripeBacklogHa, 0);
  assert.throws(() => t.farmCensus("Hof Nirgendwo"), /Unknown farm Hof Nirgendwo/);
});

// -- tick / inbox / decide -------------------------------------------------------------------
test("tick advances a day, expires the open plan and returns the new one", () => {
  const t = new Twin({ seed: 0 });
  const first = t.snapshot().pendingBundle;
  const bundle = t.tick();
  assert.deepEqual(sorted(bundle), BUNDLE_KEYS);
  assert.deepEqual([bundle.id, bundle.tick, bundle.planFor, bundle.status], [2, 1, "Tue 7 Jul", "pending"]);
  assert.deepEqual(sorted(bundle.resourcesBefore), RESOURCE_LINE_KEYS);
  assert.deepEqual(sorted(bundle.resourcesAfter), RESOURCE_LINE_KEYS);
  assert.deepEqual(bundle.nearbyCapacity.map((c) => c.farm), FARMS);
  const s = t.snapshot();
  assert.deepEqual([s.tick, s.date, s.bundleCount], [1, "Tue 7 Jul", 2]);
  assert.deepEqual(s.recentProposals, FIELDS);
  assert.deepEqual(Object.keys(s.nearbyCapacity), FARMS);
  assert.deepEqual(t.inbox(), [bundle]);
  assert.deepEqual(s.pendingBundle, bundle);
  assert.equal(t.bundles().find((b) => b.id === first.id).status, "expired");
  assert.ok(t.log().some((e) => e.actor === "Farm" && e.text === "the Mon 6 Jul plan expired undecided"));
});

test("approve applies the plan and logs the decision", () => {
  const t = new Twin({ seed: 0 });
  const plan = t.snapshot().pendingBundle;
  assert.ok(plan.planRows.some((r) => r.field === "River" && r.what === "Irrigate 25 mm"));
  const before = t.snapshot().fields.River.soilMoisturePct;
  const decided = t.decide(plan.id, "approve");
  assert.equal(decided.status, "approved");
  assert.deepEqual(t.inbox(), []);
  const s = t.snapshot();
  assert.equal(s.pendingBundle, null);
  assert.equal(s.fields.River.soilMoisturePct, before + 25);
  assert.equal(s.fields.River.lastIrrigatedDate, "Mon 6 Jul");
  assert.deepEqual(s.recentActions, [{ field: "River", kind: "irrigate" }]);
  const log = t.log()[0];
  assert.deepEqual([log.actor, log.level, log.text], ["Farm manager", "decision", "approved the Mon 6 Jul plan"]);
  assert.deepEqual(t.notices(), [
    {
      tick: 0,
      date: "Mon 6 Jul",
      audience: "Neighbours",
      text: "Irrigation running on River field today (25 mm) — the field track may be wet.",
    },
  ]);
  t.tick();
  assert.deepEqual(t.snapshot().recentActions, []); // the animation is over the next day
});

test("reject stores the reason and sends it back to every field that proposed", () => {
  const t = new Twin({ seed: 0 });
  const plan = t.snapshot().pendingBundle;
  const body = t.decide(plan.id, "reject", "Wait for better weather");
  assert.equal(body.status, "rejected");
  assert.equal(body.reason, "Wait for better weather");
  const fields = t.snapshot().fields;
  for (const f of FIELDS) assert.deepEqual(fields[f].recentRejections, ["Wait for better weather"]);
  assert.equal(t.log()[0].text, "rejected the Mon 6 Jul plan: Wait for better weather");
  assert.deepEqual(t.notices(), []);
});

test("reject without a reason", () => {
  const t = new Twin({ seed: 0 });
  const body = t.decide(t.snapshot().pendingBundle.id, "reject");
  assert.equal(body.reason, null);
  assert.equal(t.log()[0].text, "rejected the Mon 6 Jul plan");
  assert.deepEqual(t.snapshot().fields.North.recentRejections, ["rejected"]);
});

test("reject keeps the last five reasons", () => {
  const t = new Twin({ seed: 0, firstPlan: false });
  for (let i = 0; i < 7; i++) t.decide(t.tick().id, "reject", `reason ${i}`);
  assert.deepEqual(t.snapshot().fields.North.recentRejections, [2, 3, 4, 5, 6].map((i) => `reason ${i}`));
});

test("decide errors: unknown plan, already decided, expired, unknown decision", () => {
  const t = new Twin({ seed: 0 });
  const plan = t.snapshot().pendingBundle;
  assert.throws(() => t.decide(999, "approve"), { message: "Plan not found" });
  assert.throws(() => t.decide(plan.id, "maybe"), { message: "Unknown decision maybe" });
  t.decide(plan.id, "approve");
  assert.throws(() => t.decide(plan.id, "reject", "changed my mind"), { message: "Plan already approved" });
  const next = t.tick();
  t.tick();
  assert.throws(() => t.decide(next.id, "approve"), { message: "Plan already expired" });
});

test("an undecided plan expires and shows so in the field's plans", () => {
  const t = new Twin({ seed: 0, firstPlan: false });
  const first = t.tick();
  t.tick();
  const plans = t.fieldPlans("North");
  assert.deepEqual(plans[1], { bundleId: first.id, planFor: "Tue 7 Jul", status: "expired", confidence: plans[1].confidence });
  assert.throws(() => t.decide(first.id, "approve"), /expired/);
  assert.ok(t.log().some((e) => e.text === "the Tue 7 Jul plan expired undecided"));
});

// -- the safety re-check on approve -------------------------------------------------------------
test("approve re-checks the plan: a heatwave since it was built makes it illegal", () => {
  const t = new Twin({ seed: 0 });
  const plan = t.snapshot().pendingBundle;
  const river = plan.proposals.find((p) => p.field === "River");
  assert.equal(river.actions[0].type, "irrigate");
  assert.equal(river.actions[0].mm, 25);
  const moisture = t.snapshot().fields.River.soilMoisturePct;
  t.heatwave();
  assert.throws(() => t.decide(plan.id, "approve"), {
    message:
      "This plan no longer passes the safety check: irrigate for River field: Irrigation must stay within " +
      "today's water permit. Reject it so the field agents re-plan.",
  });
  assert.equal(t.snapshot().fields.River.soilMoisturePct, moisture); // nothing applied
  assert.deepEqual(t.notices(), []);
  assert.equal(t.inbox()[0].id, plan.id); // still pending
  const log = t.log()[0];
  assert.deepEqual([log.actor, log.level], ["Safety check", "block"]);
  assert.equal(
    log.text,
    "the Mon 6 Jul plan no longer passes (irrigate for River field: Irrigation must stay within today's water permit); " +
      "reject it so the field agents re-plan",
  );
  assert.equal(t.decide(plan.id, "reject", "Wait for better weather").status, "rejected");
});

test("an unchanged plan passes the re-check exactly as it was built (incl. the Machinery ring)", () => {
  const t = new Twin({ seed: 0 });
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.hail();
  const plan = t.tick();
  assert.ok(plan.proposals.some((p) => p.rationale.startsWith("Machinery ring:")));
  assert.equal(t.decide(plan.id, "approve").status, "approved");
});

// -- notices only from approved plans -------------------------------------------------------
test("notices only come from approved plans", () => {
  const t = new Twin({ seed: 0 });
  const rejected = t.snapshot().pendingBundle;
  assert.ok(rejected.planRows.some((r) => r.actionType === "irrigate")); // River irrigates on day one
  t.decide(rejected.id, "reject", "Not enough workers for this");
  assert.deepEqual(t.notices(), []);
  t.tick(); // expires undecided
  const later = t.tick();
  assert.deepEqual(t.notices(), []);
  t.decide(later.id, "approve");
  const notices = t.notices();
  assert.ok(notices.length > 0);
  for (const n of notices) {
    assert.deepEqual(sorted(n), ["audience", "date", "text", "tick"]);
    assert.equal(n.date, later.planFor);
  }
});

// -- scenarios -----------------------------------------------------------------------------------
test("heatwave and hail: messages, snapshot and no-op repeats", () => {
  const t = new Twin({ seed: 0 });
  assert.deepEqual(t.heatwave(), { scenario: "heatwave: water permit cut to 3,600 m³/day" });
  assert.deepEqual(t.hail(), { scenario: "hail warning: severe hail expected Wed 8 Jul" });
  let s = t.snapshot();
  assert.deepEqual(s.scenarios, ["heatwave: water permit cut to 3,600 m³/day", "hail warning: severe hail expected Wed 8 Jul"]);
  assert.deepEqual([s.heatwaveDaysRemaining, s.hailDate, s.resources.waterPermitM3], [4, "Wed 8 Jul", 3600]);
  const logLength = t.log().length;
  assert.deepEqual(t.hail(), { scenario: "hail warning: severe hail expected Wed 8 Jul" });
  t.tick();
  assert.equal(t.snapshot().heatwaveDaysRemaining, 3);
  const afterTick = t.log().length;
  assert.deepEqual(t.heatwave(), { scenario: "heatwave: water permit cut to 3,600 m³/day" }); // already on
  s = t.snapshot();
  assert.equal(s.heatwaveDaysRemaining, 3);
  assert.equal(t.log().length, afterTick);
  assert.ok(afterTick > logLength);
  assert.equal(t.census("River").scenario, s.scenarios.join(" · "));
});

// -- log / history / plans / farm reports --------------------------------------------------------
test("the log is newest first", () => {
  const t = new Twin({ seed: 0 });
  t.tick();
  const log = t.log();
  for (const e of log) assert.deepEqual(sorted(e), ["actor", "date", "level", "text", "tick"]);
  assert.equal(log.at(-1).text, "season reset / seeded (seed 0)");
  assert.equal(log[0].actor, "Coordinator");
  assert.equal(log[0].tick, 1);
  assert.ok(log.every((e) => ["info", "warn", "block", "decision"].includes(e.level)));
});

test("field history and the 3-day projection", () => {
  const t = new Twin({ seed: 0 });
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.tick();
  const body = t.fieldHistory("River");
  assert.deepEqual(sorted(body), ["history", "projection", "stressThresholdPct"]);
  assert.equal(body.stressThresholdPct, 60);
  assert.deepEqual(body.history.map((h) => h.date), ["Mon 6 Jul", "Tue 7 Jul"]);
  assert.deepEqual(sorted(body.history[0]), [
    "cropHealth", "date", "irrigationMm", "rainMm", "soilMoisturePct", "tick", "yieldEstimateT",
  ]);
  assert.equal(body.history[0].irrigationMm, 25);
  assert.equal(body.history[1].irrigationMm, 0);
  assert.deepEqual(body.projection.map((p) => p.date), ["Wed 8 Jul", "Thu 9 Jul", "Fri 10 Jul"]);
  assert.deepEqual(sorted(body.projection[0]), ["date", "projectedMoisturePct", "tick"]);
  assert.deepEqual(t.fieldHistory("river"), body);
  assert.throws(() => t.fieldHistory("South"), /Unknown field/);
});

test("a field's latest plans, newest first", () => {
  const t = new Twin({ seed: 0, firstPlan: false });
  for (let i = 0; i < 4; i++) t.tick();
  const plans = t.fieldPlans("River");
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map((p) => p.planFor), ["Fri 10 Jul", "Thu 9 Jul", "Wed 8 Jul"]);
  assert.deepEqual(sorted(plans[0]), ["bundleId", "confidence", "planFor", "status"]);
  assert.deepEqual([plans[0].status, plans[1].status], ["pending", "expired"]);
  assert.equal(t.fieldPlans("River", 5).length, 4);
  assert.throws(() => t.fieldPlans("South"), /Unknown field/);
});

test("a farm's history", () => {
  const t = new Twin({ seed: 0 });
  t.tick();
  const rows = t.farmHistory("Gut Rohrdommelsee");
  assert.deepEqual(rows.map((h) => h.date), ["Mon 6 Jul", "Tue 7 Jul"]);
  assert.deepEqual(sorted(rows[0]), ["avgSoilMoisturePct", "combineAvailable", "date", "storageFreeT", "tick"]);
  assert.equal(rows[0].storageFreeT, 520);
  assert.equal(t.farmHistory("oderblick").length, 2);
  assert.throws(() => t.farmHistory("Nowhere"), /Unknown farm Nowhere/);
});

test("a farm agent's latest reports, newest first", () => {
  const t = new Twin({ seed: 0, firstPlan: false });
  for (let i = 0; i < 4; i++) t.tick();
  const reports = t.farmReports("Gut Rohrdommelsee");
  assert.equal(reports.length, 3);
  assert.deepEqual(reports.map((r) => r.planFor), ["Fri 10 Jul", "Thu 9 Jul", "Wed 8 Jul"]);
  assert.deepEqual(sorted(reports[0]), ["canShare", "confidence", "note", "planFor"]);
  assert.deepEqual(sorted(reports[0].canShare), ["combine", "storageT"]);
  assert.deepEqual(t.farmReports("rohrdommelsee", 1), reports.slice(0, 1));
  assert.throws(() => t.farmReports("Nowhere"), /Unknown farm/);
});

test("bundles() and inbox()", () => {
  const t = new Twin({ seed: 0 });
  t.tick();
  t.tick();
  const all = t.bundles();
  assert.deepEqual(all.map((b) => b.planFor), ["Wed 8 Jul", "Tue 7 Jul", "Mon 6 Jul"]);
  assert.deepEqual(all.map((b) => b.status), ["pending", "expired", "expired"]);
  assert.deepEqual(t.inbox(), [all[0]]);
});

// -- reset ---------------------------------------------------------------------------------------
test("reset restarts the season; a seed replays it exactly", () => {
  const t = new Twin({ seed: 4 });
  const first = t.snapshot();
  const firstLog = t.log();
  t.decide(first.pendingBundle.id, "approve");
  t.tick();
  t.heatwave();
  t.reset();
  assert.deepEqual(t.snapshot(), first);
  assert.deepEqual(t.log(), firstLog);
  assert.deepEqual(t.notices(), []);
  t.reset({ seed: 5 });
  assert.equal(t.seed, 5);
  assert.notDeepEqual(t.snapshot().weatherToday, first.weatherToday);
  t.reset();
  assert.equal(t.seed, 5);
});

// -- subscriptions and copies ------------------------------------------------------------------
test("subscribers hear every change; unsubscribe stops it", () => {
  const t = new Twin({ seed: 0 });
  let calls = 0;
  const unsubscribe = t.subscribe(() => {
    calls += 1;
  });
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.tick();
  t.heatwave();
  t.hail();
  t.reset();
  assert.equal(calls, 5);
  t.snapshot();
  t.log();
  assert.equal(calls, 5); // queries don't notify
  unsubscribe();
  t.tick();
  assert.equal(calls, 5);
});

test("returned objects are copies", () => {
  const t = new Twin({ seed: 0 });
  const s = t.snapshot();
  s.fields.North.soilMoisturePct = 1;
  s.pendingBundle.status = "approved";
  s.forecast.length = 0;
  const b = t.inbox()[0];
  b.proposals.length = 0;
  t.census("North").forecast.length = 0;
  t.log().length = 0;
  const again = t.snapshot();
  assert.equal(again.fields.North.soilMoisturePct, 48);
  assert.equal(again.pendingBundle.status, "pending");
  assert.equal(again.forecast.length, 3);
  assert.ok(t.inbox()[0].proposals.length > 0);
  assert.ok(t.log().length > 0);
});

// -- determinism -----------------------------------------------------------------------------------
function season(t) {
  t.decide(t.snapshot().pendingBundle.id, "approve");
  t.heatwave();
  for (let i = 0; i < 6; i++) {
    const b = t.tick();
    if (i % 3 === 1) t.decide(b.id, "reject", "Wait for better weather");
    else t.decide(b.id, "approve");
  }
  t.hail();
  for (let i = 0; i < 6; i++) t.decide(t.tick().id, "approve");
  return { snapshot: t.snapshot(), log: t.log(), notices: t.notices(), bundles: t.bundles() };
}

test("a seed always replays the same season", () => {
  assert.deepEqual(season(new Twin({ seed: 11 })), season(new Twin({ seed: 11 })));
  assert.notDeepEqual(season(new Twin({ seed: 11 })).snapshot, season(new Twin({ seed: 12 })).snapshot);
});

test("the engine never touches Math.random or Date", () => {
  const realRandom = Math.random;
  const RealDate = globalThis.Date;
  Math.random = () => {
    throw new Error("Math.random used");
  };
  globalThis.Date = class {
    constructor() {
      throw new Error("Date used");
    }
    static now() {
      throw new Error("Date.now used");
    }
  };
  try {
    const t = new Twin({ seed: 3 });
    season(t);
    t.fieldHistory("River");
    t.farmHistory("Gut Rohrdommelsee");
    t.reset();
  } finally {
    Math.random = realRandom;
    globalThis.Date = RealDate;
  }
});
