// The daily simulation: water balance, ripening, health, disease, scenarios, neighbours,
// plan expiry, reproducibility and the weather generator. Port of tests/test_sim.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateLabel } from "../src/engine/clock.js";
import { createRng } from "../src/engine/rng.js";
import * as sim from "../src/engine/sim.js";
import {
  FarmState,
  KC_COVER_CROP,
  KC_HARVESTED,
  WATER_PERMIT_HEATWAVE_M3,
  WATER_PERMIT_NORMAL_M3,
} from "../src/engine/state.js";
import * as weather from "../src/engine/weather.js";

const freshState = (seed = 0) => new FarmState({ seed, rng: createRng(seed) });
const approx = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not ~${expected}`);

/** Pin the day the next step() makes 'today'. */
function pinTomorrow(state, values = {}) {
  const day = {
    date: dateLabel(state.tick + 1),
    tempMaxC: 25.0,
    rainMm: 0.0,
    windMs: 3.0,
    et0Mm: 4.0,
    humidityPct: 60,
    hail: false,
    note: "",
    ...values,
  };
  state.forecast[0] = day;
  return day;
}

// -- water balance -------------------------------------------------------------------------
test("water balance: rain minus et0 x kc", () => {
  const state = freshState();
  pinTomorrow(state, { rainMm: 3.0, et0Mm: 5.0 });
  const before = Object.fromEntries(Object.entries(state.fields).map(([n, f]) => [n, f.soilMoisture]));
  sim.step(state);
  approx(state.fields.North.soilMoisture, before.North + 3.0 - 5.0 * 0.45);
  approx(state.fields.West.soilMoisture, before.West + 3.0 - 5.0 * 0.4);
  approx(state.fields.River.soilMoisture, before.River + 3.0 - 5.0 * 1.1);
  assert.equal(state.history.River.at(-1).soilMoisturePct, Math.round(state.fields.River.soilMoisture * 10) / 10);
  assert.equal(state.history.River.at(-1).rainMm, 3.0);
});

test("water balance: harvested and cover-crop fields use their own kc", () => {
  const state = freshState();
  state.fields.North.harvested = true;
  state.fields.West.harvested = true;
  state.fields.West.coverCrop = true;
  pinTomorrow(state, { et0Mm: 5.0 });
  sim.step(state);
  approx(state.fields.North.soilMoisture, 48 - 5.0 * KC_HARVESTED);
  approx(state.fields.West.soilMoisture, 44 - 5.0 * KC_COVER_CROP);
});

test("water balance is clamped to 0..100", () => {
  const state = freshState();
  state.fields.River.soilMoisture = 99;
  state.fields.North.soilMoisture = 1;
  pinTomorrow(state, { rainMm: 30.0, et0Mm: 2.0 });
  sim.step(state);
  assert.equal(state.fields.River.soilMoisture, 100);
  pinTomorrow(state, { rainMm: 0.0, et0Mm: 7.0 });
  state.fields.North.soilMoisture = 1;
  sim.step(state);
  assert.equal(state.fields.North.soilMoisture, 0);
});

test("projection: three days of forecast weather without irrigation", () => {
  const state = freshState();
  const rows = state.projection("River");
  assert.deepEqual(rows.map((r) => r.date), ["Tue 7 Jul", "Wed 8 Jul", "Thu 9 Jul"]);
  let m = state.fields.River.soilMoisture;
  state.forecast.forEach((w, i) => {
    m = Math.max(0, Math.min(100, m + w.rainMm - w.et0Mm * 1.1));
    assert.equal(rows[i].projectedMoisturePct, Math.round(m * 10) / 10);
    assert.equal(rows[i].tick, i + 1);
  });
});

// -- ripening, health, disease --------------------------------------------------------------
test("ripening, and losses while a ripe crop waits", () => {
  const state = freshState();
  const west = state.fields.West;
  for (let i = 0; i < 3; i++) sim.step(state);
  assert.equal(west.daysToHarvest, 0);
  assert.equal(west.harvestReady, true);
  assert.equal(west.stage, "harvest-ready");
  assert.equal(west.harvestWaitingDays, 1);
  const before = west.yieldTHa;
  sim.step(state);
  assert.equal(west.harvestWaitingDays, 2);
  approx(west.yieldTHa, before * 0.98);
  assert.equal(state.fields.River.daysToHarvest, 44);
  assert.equal(state.fields.River.stage, "tuber bulking");
  assert.equal(state.fields.North.stage, "harvest-ready");
});

test("stage labels", () => {
  const state = freshState();
  const { North: north, River: river } = state.fields;
  assert.equal(north.stage, "ripening");
  north.daysToHarvest = 9;
  assert.equal(north.stage, "grain fill");
  river.daysToHarvest = 14;
  assert.equal(river.stage, "maturing");
  north.harvested = true;
  assert.equal(north.stage, "harvested");
  north.coverCrop = true;
  assert.equal(north.stage, "cover crop");
});

test("yield estimate formula", () => {
  const state = freshState();
  assert.equal(state.fields.North.yieldEstimateT, 327.6); // 42 x 7.8, health above 0.85
  assert.equal(state.fields.West.yieldEstimateT, 115.6); // 30 x 3.9 x 0.84 / 0.85
  assert.equal(state.fields.River.yieldEstimateT, 1008.0);
  state.fields.North.harvested = true;
  state.fields.North.harvestedT = 300.4;
  assert.equal(state.fields.North.yieldEstimateT, 300.4);
});

test("health: stress below the threshold, recovery above it", () => {
  const state = freshState();
  const { North: north, River: river } = state.fields;
  river.soilMoisture = 45; // threshold 60 -> 15 points under
  pinTomorrow(state, { rainMm: 0.0, et0Mm: 0.0 });
  const hRiver = river.health;
  const hNorth = north.health;
  sim.step(state);
  approx(river.health, hRiver - (0.015 + 0.003 * 15));
  approx(north.health, Math.min(0.95, hNorth + 0.004));
});

test("health: disease penalty and the clamp", () => {
  const state = freshState();
  const river = state.fields.River;
  river.disease = 0.8;
  river.soilMoisture = 80;
  pinTomorrow(state, { et0Mm: 0.0, tempMaxC: 25.0, humidityPct: 60 });
  const h = river.health;
  sim.step(state);
  approx(river.health, h + 0.004 - 0.02);
  river.health = 0.21;
  river.soilMoisture = 0;
  pinTomorrow(state, { et0Mm: 0.0 });
  sim.step(state);
  assert.equal(river.health, 0.2);
});

test("potato blight rises when wet, less after spraying", () => {
  const state = freshState();
  const river = state.fields.River;
  pinTomorrow(state, { rainMm: 4.0, humidityPct: 70 });
  let d = river.disease;
  sim.step(state);
  approx(river.disease, d + 0.07);
  river.lastSprayedTick = state.tick;
  pinTomorrow(state, { rainMm: 0.0, humidityPct: 85 });
  d = river.disease;
  sim.step(state);
  approx(river.disease, d + 0.07 * 0.3);
});

test("potato blight falls when hot and dry", () => {
  const state = freshState();
  const river = state.fields.River;
  pinTomorrow(state, { rainMm: 0.0, tempMaxC: 34.0, humidityPct: 40 });
  const d = river.disease;
  sim.step(state);
  approx(river.disease, d - 0.02);
});

test("cereal disease is small noise", () => {
  const state = freshState();
  const d = state.fields.North.disease;
  for (let i = 0; i < 3; i++) sim.step(state);
  assert.ok(Math.abs(state.fields.North.disease - d) <= 0.03 + 1e-9);
});

// -- heatwave -----------------------------------------------------------------------------------
test("heatwave: cuts the permit and turns today and the next days hot", () => {
  const state = freshState();
  const message = sim.startHeatwave(state);
  assert.equal(message, "heatwave: water permit cut to 3,600 m³/day");
  assert.equal(state.waterPermitM3, WATER_PERMIT_HEATWAVE_M3);
  assert.equal(state.weatherToday.note, "heatwave");
  assert.ok(state.forecast.every((w) => w.note === "heatwave" && w.rainMm === 0));
  for (const w of [state.weatherToday, ...state.forecast]) {
    assert.ok(w.tempMaxC >= 33 && w.tempMaxC <= 37 && w.et0Mm >= 6.8 && w.et0Mm <= 7.8);
  }
  assert.equal(state.scenario, message);
  assert.deepEqual(state.log.at(-1), {
    tick: 0,
    date: "Mon 6 Jul",
    actor: "Farm",
    level: "warn",
    text: "Heatwave for 4 days: the water authority cut the permit to 3,600 m³/day",
  });
});

test("heatwave lasts four days, then the permit returns", () => {
  const state = freshState();
  sim.startHeatwave(state);
  for (let day = 1; day <= 3; day++) {
    sim.step(state);
    assert.equal(state.weatherToday.note, "heatwave", `day ${day}`);
    assert.equal(state.waterPermitM3, WATER_PERMIT_HEATWAVE_M3);
  }
  assert.equal(state.forecast.at(-1).note, ""); // generated beyond the heatwave
  sim.step(state);
  assert.equal(state.heatwaveDaysRemaining, 0);
  assert.equal(state.weatherToday.note, "");
  assert.equal(state.waterPermitM3, WATER_PERMIT_NORMAL_M3);
  assert.equal(state.scenario, null);
  assert.ok(state.log.some((e) => e.text === "heatwave over: water permit back to 6,500 m³/day"));
});

test("heatwave doubles cereal ripening", () => {
  const state = freshState();
  sim.startHeatwave(state);
  sim.step(state);
  assert.equal(state.fields.North.daysToHarvest, 2);
  assert.equal(state.fields.River.daysToHarvest, 47); // potatoes: one day only
});

// -- hail ---------------------------------------------------------------------------------------
test("hail warning: a dry day, then the storm; ripening cereals are due tomorrow", () => {
  const state = freshState();
  const message = sim.hailWarning(state);
  assert.equal(message, "hail warning: severe hail expected Wed 8 Jul");
  assert.equal(state.hailTick, 2);
  assert.equal(state.forecast[0].rainMm, 0);
  assert.ok(state.forecast[0].windMs >= 2 && state.forecast[0].windMs <= 4);
  const storm = state.forecast[1];
  assert.equal(storm.hail, true);
  assert.equal(storm.note, "hail storm");
  assert.ok(storm.rainMm >= 18 && storm.rainMm <= 30);
  assert.equal(storm.tempMaxC, 27);
  assert.equal(storm.et0Mm, 3.0);
  assert.equal(storm.humidityPct, 90);
  assert.equal(state.fields.North.daysToHarvest, 1);
  assert.equal(state.fields.West.daysToHarvest, 1);
  assert.equal(state.fields.River.daysToHarvest, 48);
  // rapeseed is an oilseed, not a cereal
  assert.equal(
    state.log.at(-1).text,
    "Hail warning: severe hail expected Wed 8 Jul; Tue 7 Jul stays dry, so the ripening wheat and rapeseed can come in early",
  );
});

test("a second hail warning is a no-op", () => {
  const state = freshState();
  const first = sim.hailWarning(state);
  const forecast = structuredClone(state.forecast);
  const nLog = state.log.length;
  assert.equal(sim.hailWarning(state), first);
  assert.deepEqual(state.forecast, forecast);
  assert.equal(state.log.length, nLog);
});

test("hail damage on the hail day", () => {
  const state = freshState();
  sim.hailWarning(state);
  sim.step(state); // dry day: both cereals ripe, nobody harvests
  const { North: north, West: west, River: river } = state.fields;
  assert.ok(north.harvestReady && west.harvestReady);
  const yields = { North: north.yieldTHa, West: west.yieldTHa };
  const riverHealth = river.health;
  sim.step(state); // the hail day
  assert.equal(state.weatherToday.hail, true);
  approx(north.yieldTHa, yields.North * 0.99 * 0.6);
  approx(west.yieldTHa, yields.West * 0.98 * 0.6);
  assert.ok(river.health < riverHealth); // -0.08 on top of the day's health change
  const warns = state.log.filter((e) => e.level === "warn" && e.text.startsWith("Hail hit")).map((e) => e.text);
  assert.ok(warns.includes("Hail hit West field: rapeseed lost 40%"));
  assert.ok(warns.includes("Hail hit North field: winter wheat lost 40%"));
  assert.ok(warns.includes("Hail hit River field: potato leaves shredded, crop health down 0.08"));
  assert.equal(state.hailTick, null);
  assert.equal(state.scenario, null);
});

test("hail spares harvested fields", () => {
  const state = freshState();
  sim.hailWarning(state);
  sim.step(state);
  state.fields.North.harvested = true;
  state.fields.North.harvestedT = 320.0;
  sim.step(state);
  assert.equal(state.fields.North.yieldEstimateT, 320.0);
  assert.ok(!state.log.some((e) => e.text.startsWith("Hail hit") && e.text.includes("North field")));
});

test("both scenarios at once: the heatwave doesn't overwrite the storm", () => {
  const state = freshState();
  sim.hailWarning(state);
  sim.startHeatwave(state);
  assert.equal(state.forecast[1].hail, true);
  assert.equal(state.forecast[0].note, "heatwave");
  assert.equal(state.forecast[2].note, "heatwave");
  assert.equal(state.scenario, "heatwave: water permit cut to 3,600 m³/day · hail warning: severe hail expected Wed 8 Jul");
  assert.deepEqual(state.scenarioMessages(), state.scenario.split(" · "));
});

// -- neighbours, expiry, history ------------------------------------------------------------
test("neighbour drift stays in bounds", () => {
  const state = freshState();
  for (let i = 0; i < 40; i++) {
    sim.step(state);
    for (const n of Object.values(state.neighbours)) {
      assert.ok(n.storageUsedT >= 0 && n.storageUsedT <= n.storageCapacityT);
      assert.ok(n.combineAvailable === 0 || n.combineAvailable === 1);
      assert.ok(n.avgSoilMoisture >= 10 && n.avgSoilMoisture <= 95);
    }
  }
  assert.ok(state.neighbours["Agrarhof Oderblick"].storageUsedT > 420);
});

test("a cereal-heavy neighbour's combine is busy during a hail warning", () => {
  const state = freshState();
  sim.hailWarning(state);
  for (let i = 0; i < 20; i++) {
    state.hailTick = state.tick + 2; // keep the warning active
    sim.step(state);
    assert.equal(state.neighbours["Agrarhof Oderblick"].combineAvailable, 0);
  }
});

test("a pending plan expires on the next day", () => {
  const state = freshState();
  state.bundles.push({ id: 1, tick: 0, planFor: "Mon 6 Jul", status: "pending" });
  state.bundles.push({ id: 2, tick: 0, planFor: "Mon 6 Jul", status: "approved" });
  sim.step(state);
  assert.equal(state.bundles[0].status, "expired");
  assert.equal(state.bundles[1].status, "approved");
  assert.ok(state.log.some((e) => e.actor === "Farm" && e.text === "the Mon 6 Jul plan expired undecided"));
});

test("each step records field and farm history", () => {
  const state = freshState();
  sim.step(state);
  sim.step(state);
  assert.deepEqual(state.history.North.map((h) => h.date), ["Mon 6 Jul", "Tue 7 Jul", "Wed 8 Jul"]);
  assert.deepEqual(Object.keys(state.history.North[0]).sort(), [
    "cropHealth", "date", "irrigationMm", "rainMm", "soilMoisturePct", "tick", "yieldEstimateT",
  ]);
  for (const rows of Object.values(state.farmHistory)) {
    assert.equal(rows.length, 3);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["avgSoilMoisturePct", "combineAvailable", "date", "storageFreeT", "tick"]);
  }
});

test("each step rolls the forecast forward", () => {
  const state = freshState();
  const tomorrow = { ...state.forecast[0] };
  sim.step(state);
  assert.deepEqual(state.weatherToday, tomorrow);
  assert.equal(state.forecast.length, 3);
  assert.deepEqual(state.forecast.map((w) => w.date), ["Wed 8 Jul", "Thu 9 Jul", "Fri 10 Jul"]);
});

test("the combine is free again the next day", () => {
  const state = freshState();
  state.ownCombineBusy = true;
  sim.step(state);
  assert.equal(state.ownCombineBusy, false);
});

// -- reproducibility ----------------------------------------------------------------------------
const fingerprint = (s) =>
  JSON.stringify([
    s.weatherToday,
    s.forecast,
    Object.fromEntries(Object.entries(s.neighbours).map(([n, v]) => [n, v.combineAvailable])),
    Object.fromEntries(Object.entries(s.fields).map(([n, f]) => [n, f.soilMoisture])),
  ]);

test("a seed replays the same season; another seed doesn't", () => {
  const a = freshState(7);
  const b = freshState(7);
  for (let i = 0; i < 5; i++) {
    sim.step(a);
    sim.step(b);
  }
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(freshState(8)), fingerprint(freshState(7)));
});

// -- weather generator ----------------------------------------------------------------------------
test("normal weather stays in its ranges", () => {
  const rng = createRng(1);
  const days = Array.from({ length: 500 }, (_, t) => weather.normalDay(rng, t));
  for (const d of days) {
    assert.ok(d.tempMaxC >= 21 && d.tempMaxC <= 29);
    assert.ok(d.windMs >= 1 && d.windMs <= 8);
    assert.ok(d.et0Mm >= 2.0 && d.et0Mm <= 5.5);
    assert.ok(d.humidityPct >= 50 && d.humidityPct <= 95 && Number.isInteger(d.humidityPct));
    assert.equal(d.hail, false);
    assert.equal(d.note, "");
    assert.ok(d.rainMm === 0 || (d.rainMm >= 0.5 && d.rainMm <= 14));
  }
  const dryShare = days.filter((d) => d.rainMm === 0).length / days.length;
  assert.ok(dryShare > 0.55 && dryShare < 0.75, `dry share ${dryShare}`);
  assert.ok(days.filter((d) => d.rainMm >= 5).length / days.length < 0.25);
});

test("triangular wind is mostly light (mode 3 m/s)", () => {
  const rng = createRng(2);
  const xs = Array.from({ length: 5000 }, () => weather.triangular(rng, 1, 8, 3));
  assert.ok(xs.every((x) => x >= 1 && x <= 8));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 4) < 0.1, `mean ${mean}`); // (1 + 8 + 3) / 3
});
