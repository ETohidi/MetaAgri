// The daily simulation: weather roll, soil water balance, ripening, crop health, disease,
// the heatwave / hail scenarios and neighbour-farm drift. One step = one day.

import { dateLabel } from "./clock.js";
import { clamp, fixed, pct0, thousands } from "./format.js";
import { FIELD_NAMES } from "../data/places.js";
import { CROPS, WATER_PERMIT_HEATWAVE_M3, WATER_PERMIT_NORMAL_M3 } from "./state.js";
import * as weather from "./weather.js";

// crop health
export const STRESS_BASE_LOSS = 0.015;
export const STRESS_LOSS_PER_PCT = 0.003; // per % point of soil moisture below the stress threshold
export const HEALTH_RECOVERY = 0.004;
export const DISEASE_DAMAGE_THRESHOLD = 0.7;
export const DISEASE_HEALTH_LOSS = 0.02;
export const HEALTH_MIN = 0.2;
export const HEALTH_MAX = 0.95;

// disease (potato blight likes it wet and humid, dislikes it hot and dry)
export const BLIGHT_RISE = 0.07;
export const BLIGHT_RAIN_MM = 3;
export const BLIGHT_HUMIDITY_PCT = 80;
export const HOT_DRY_DECLINE = 0.02;
export const HOT_DRY_TEMP_C = 30;
export const SPRAY_PROTECTION_DAYS = 7;
export const SPRAY_PROTECTION_FACTOR = 0.3; // a recent spray cuts the daily rise to 30%
export const CEREAL_DISEASE_NOISE = 0.01;

// scenarios
export const HEATWAVE_DAYS = 4; // today + the 3 forecast days
export const HAIL_LEAD_DAYS = 2; // the storm hits the day after tomorrow
export const HAIL_EARLY_HARVEST_DAYS = 4; // cereals this close to ripe get rushed / get hit
export const HAIL_CEREAL_LOSS = 0.4;
export const HAIL_POTATO_HEALTH_LOSS = 0.08;

// neighbour drift
export const NEIGHBOUR_STORAGE_FILL_MAX_T = 25;
export const NEIGHBOUR_ET_FACTOR = 0.9;
export const NEIGHBOUR_MOISTURE_REFILL = 2; // their own irrigation / groundwater, per day
export const NEIGHBOUR_MOISTURE_MIN = 10;
export const NEIGHBOUR_MOISTURE_MAX = 95;

function updateField(state, f, today, heatwaveActive) {
  // 1. soil water balance (irrigation is added at approval time, not here)
  const et = today.et0Mm * f.kc;
  f.soilMoisture = clamp(f.soilMoisture + today.rainMm - et, 0, 100);
  if (f.harvested) return;

  // 2. ripening
  const info = CROPS[f.crop];
  if (info.cereal) {
    f.daysToHarvest -= heatwaveActive ? 2 : 1;
    if (f.harvestReady) {
      f.harvestWaitingDays += 1;
      f.yieldTHa *= 1 - info.dailyRipeLoss;
    }
  } else {
    f.daysToHarvest -= 1;
  }

  // 3. health
  const threshold = info.stressThreshold;
  if (f.soilMoisture < threshold) {
    f.health -= STRESS_BASE_LOSS + STRESS_LOSS_PER_PCT * (threshold - f.soilMoisture);
  } else {
    f.health += HEALTH_RECOVERY;
  }
  if (f.disease > DISEASE_DAMAGE_THRESHOLD) f.health -= DISEASE_HEALTH_LOSS;
  f.health = clamp(f.health, HEALTH_MIN, HEALTH_MAX);

  // 4. disease
  if (info.cereal) {
    f.disease += state.rng.uniform(-CEREAL_DISEASE_NOISE, CEREAL_DISEASE_NOISE);
  } else {
    let rise = 0;
    if (today.rainMm >= BLIGHT_RAIN_MM || today.humidityPct >= BLIGHT_HUMIDITY_PCT) {
      rise += BLIGHT_RISE;
      const recentlySprayed = f.lastSprayedTick !== null && state.tick - f.lastSprayedTick <= SPRAY_PROTECTION_DAYS;
      if (recentlySprayed) rise *= SPRAY_PROTECTION_FACTOR;
    }
    if (today.tempMaxC >= HOT_DRY_TEMP_C && today.rainMm === 0) rise -= HOT_DRY_DECLINE;
    f.disease += rise;
  }
  f.disease = clamp(f.disease, 0, 1);
  // 5./6. yield estimate and stage are derived from the above (FieldState getters)
}

function hailStrikes(state) {
  for (const [name, f] of Object.entries(state.fields)) {
    if (f.harvested) continue;
    if (f.cereal && f.daysToHarvest <= HAIL_EARLY_HARVEST_DAYS) {
      f.yieldTHa *= 1 - HAIL_CEREAL_LOSS;
      state.addLog("Farm", "warn", `Hail hit ${FIELD_NAMES[name]}: ${f.crop} lost ${pct0(HAIL_CEREAL_LOSS)}`);
    } else if (!f.cereal) {
      f.health = Math.max(HEALTH_MIN, f.health - HAIL_POTATO_HEALTH_LOSS);
      const plant = f.shortCrop.endsWith("es") ? f.shortCrop.slice(0, -2) : f.shortCrop;
      state.addLog(
        "Farm",
        "warn",
        `Hail hit ${FIELD_NAMES[name]}: ${plant} leaves shredded, crop health down ${fixed(HAIL_POTATO_HEALTH_LOSS, 2)}`,
      );
    }
  }
  state.hailTick = null;
}

function driftNeighbours(state, today) {
  for (const n of Object.values(state.neighbours)) {
    n.storageUsedT = Math.min(n.storageCapacityT, n.storageUsedT + state.rng.uniform(0, NEIGHBOUR_STORAGE_FILL_MAX_T));
    n.combineAvailable = state.rng.random() > n.combineBusyProb ? 1 : 0;
    if (state.hailWarningActive && n.cerealHeavy) n.combineAvailable = 0; // busy with their own ripe crop
    n.avgSoilMoisture = clamp(
      n.avgSoilMoisture + today.rainMm - today.et0Mm * NEIGHBOUR_ET_FACTOR + NEIGHBOUR_MOISTURE_REFILL,
      NEIGHBOUR_MOISTURE_MIN,
      NEIGHBOUR_MOISTURE_MAX,
    );
  }
}

function expireStalePlans(state) {
  for (const b of state.bundles) {
    if (b.status === "pending" && b.tick < state.tick) {
      b.status = "expired";
      state.addLog("Farm", "info", `the ${b.planFor} plan expired undecided`);
    }
  }
}

/** Advance the twin one day. */
export function step(state) {
  state.tick += 1;
  const tick = state.tick;
  state.ownCombineBusy = false;

  // Heatwave countdown first, so the day appended to the forecast below already knows
  // whether the heatwave still covers it.
  if (state.heatwaveDaysRemaining > 0) {
    state.heatwaveDaysRemaining -= 1;
    if (state.heatwaveDaysRemaining === 0) {
      state.waterPermitM3 = WATER_PERMIT_NORMAL_M3;
      state.addLog("Farm", "info", `heatwave over: water permit back to ${thousands(WATER_PERMIT_NORMAL_M3)} m³/day`);
    }
  }

  state.weatherToday = state.forecast.shift();
  state.forecast.push(weather.dayFor(state, tick + weather.FORECAST_DAYS));
  const today = state.weatherToday;

  const heatwaveActive = state.heatwaveDaysRemaining > 0;
  for (const f of Object.values(state.fields)) updateField(state, f, today, heatwaveActive);

  if (state.hailTick !== null && tick === state.hailTick) hailStrikes(state);

  driftNeighbours(state, today);
  expireStalePlans(state);
  state.recentActions = [];
  state.recordHistory();
  state.recordFarmHistory();
}

/** The water authority cuts the permit at once; today and the next 3 days turn hot. */
export function startHeatwave(state) {
  state.heatwaveDaysRemaining = HEATWAVE_DAYS;
  state.waterPermitM3 = WATER_PERMIT_HEATWAVE_M3;
  if (!state.weatherToday.hail) state.weatherToday = weather.heatwaveDay(state.rng, state.tick);
  for (let i = 0; i < state.forecast.length; i++) {
    const dayTick = state.tick + 1 + i;
    if (dayTick < state.tick + HEATWAVE_DAYS && dayTick !== state.hailTick) {
      state.forecast[i] = weather.heatwaveDay(state.rng, dayTick);
    }
  }
  state.addLog(
    "Farm",
    "warn",
    `Heatwave for ${HEATWAVE_DAYS} days: the water authority cut the permit to ${thousands(WATER_PERMIT_HEATWAVE_M3)} m³/day`,
  );
  return state.heatwaveMessage();
}

/** Severe hail the day after tomorrow; tomorrow stays dry so ripening cereals can come in early. */
export function hailWarning(state) {
  if (state.hailWarningActive) return state.hailMessage();
  state.hailTick = state.tick + HAIL_LEAD_DAYS;
  state.forecast[0] = weather.calmDry(state.rng, state.forecast[0]);
  state.forecast[1] = weather.hailDay(state.rng, state.hailTick);
  for (const f of Object.values(state.fields)) {
    if (f.cereal && !f.harvested && f.daysToHarvest > 0 && f.daysToHarvest <= HAIL_EARLY_HARVEST_DAYS) {
      f.daysToHarvest = 1; // harvest early before the hail: ready tomorrow
    }
  }
  state.addLog(
    "Farm",
    "warn",
    `Hail warning: severe hail expected ${dateLabel(state.hailTick)}; ` +
      `${dateLabel(state.tick + 1)} stays dry, so the ripening wheat and rapeseed can come in early`,
  );
  return state.hailMessage();
}
