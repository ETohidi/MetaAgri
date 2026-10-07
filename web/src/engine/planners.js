// The field agents: canned but sensible proposals per field, from the field's census only
// (what a real agent would be shown). Port of the Python hub's mock_petals.py.

import { FIELD_NAMES } from "../data/places.js";
import { capitalize, fixed, g, thousands } from "./format.js";
import { HARVEST_MAX_RAIN_MM } from "./safety.js";
import { CROPS, M3_PER_MM_HA } from "./state.js";

export const IRRIGATION_TARGET_PCT = 90; // refill towards this
export const IRRIGATION_TRIGGER_MARGIN = 10; // irrigate if heading within this of the stress threshold
export const IRRIGATION_MIN_MM = 10;
export const IRRIGATION_MAX_MM = 25;
export const IRRIGATION_USEFUL_MM = 5; // below this a pass isn't worth running the reel
export const LOOKAHEAD_DAYS = 2;
export const SPRAY_DISEASE_PRESSURE = 0.6;
export const SPRAY_INTERVAL_DAYS = 7;
export const SCOUT_DAYS = 3;
export const COVER_CROP_MAX_RAIN_MM = 10; // nobody drills into waterlogged stubble (or in a hail storm)

const NO_ACTION = "Crop within normal range; no action needed.";

function withRejectionNote(rationale, recentRejections) {
  if (recentRejections.length) return `${rationale} (Noting recent rejection: ${recentRejections[recentRejections.length - 1]})`;
  return rationale;
}

/** Python's int(5 * round(x / 5)): round half to even. */
function roundTo5(x) {
  return 5 * Number(fixed(x / 5, 0));
}

const pluralDays = (n) => (n === 1 ? `${n} day` : `${n} days`);
const lastWord = (crop) => crop.split(" ").pop();

/** Rapeseed is an oilseed: its harvest moisture is seed moisture, not grain moisture. */
const moistureWord = (crop) => (crop === "rapeseed" ? "seed" : "grain");

function harvested(census) {
  if (!census.coverCrop) {
    const crop = lastWord(census.crop);
    const rain = census.weatherToday.rainMm;
    if (census.weatherToday.hail || rain >= COVER_CROP_MAX_RAIN_MM) {
      const reason = `${capitalize(crop)} stubble too wet after ${fixed(rain, 1)} mm rain; drilling the cover crop once the soil dries.`;
      return {
        actions: [{ type: "defer_task", confidence: 0.7, reason }],
        rationale: "Field harvested; waiting for the soil to dry before sowing a cover crop.",
        confidence: 0.7,
      };
    }
    const reason = `${capitalize(crop)} is off the field; a cover crop protects the soil and holds nitrogen.`;
    return {
      actions: [{ type: "sow_cover_crop", confidence: 0.8, reason }],
      rationale: "Field harvested; sowing a cover crop.",
      confidence: 0.8,
    };
  }
  return { actions: [], rationale: "Field harvested and cover crop established; no action needed.", confidence: 0.6 };
}

function ripeCereal(census) {
  const crop = lastWord(census.crop);
  const rain = census.weatherToday.rainMm;
  const hailDay = census.forecast.find((w) => w.hail) ?? null;
  const dry = rain < HARVEST_MAX_RAIN_MM;
  const tonnes = fixed(census.yieldEstimateT, 0);
  if (dry || hailDay !== null) {
    const confidence = dry ? 0.85 : 0.5;
    const reason =
      hailDay !== null ? `Hail expected ${hailDay.date}; harvesting ripe ${crop} now.` : `${crop} ripe; dry day, ~${tonnes} t expected.`;
    return {
      actions: [{ type: "harvest", confidence, reason }],
      rationale: `${capitalize(crop)} is ripe; harvesting today (~${tonnes} t).`,
      confidence,
    };
  }
  const reason = `${crop} ripe but ${fixed(rain, 1)} mm rain today - too wet to harvest.`;
  return {
    actions: [{ type: "defer_task", confidence: 0.7, reason }],
    rationale: `${capitalize(crop)} ripe but too wet; waiting for a dry day.`,
    confidence: 0.7,
  };
}

function ripeningCereal(census) {
  const crop = lastWord(census.crop);
  const days = pluralDays(census.daysToHarvest);
  const reason = `${crop} ripening, ${days} to harvest; checking ${moistureWord(census.crop)} moisture.`;
  return {
    actions: [{ type: "scout", confidence: 0.7, reason }],
    rationale: `${capitalize(crop)} close to ripe (${days}); scouting.`,
    confidence: 0.7,
  };
}

function irrigable(census) {
  const kc = CROPS[census.crop].kc;
  const nextDays = census.forecast.slice(0, LOOKAHEAD_DAYS);
  const waterUse = nextDays.reduce((sum, w) => sum + w.et0Mm * kc, 0);
  const rain = nextDays.reduce((sum, w) => sum + w.rainMm, 0);
  const projected = census.soilMoisturePct - waterUse + rain;
  const threshold = census.stressThresholdPct;
  const permit = census.resources.waterPermitM3;

  const actions = [];
  const notes = [];
  if (projected < threshold + IRRIGATION_TRIGGER_MARGIN) {
    let mm = Math.max(IRRIGATION_MIN_MM, Math.min(IRRIGATION_MAX_MM, roundTo5(IRRIGATION_TARGET_PCT - projected)));
    const fitToPermit = census.recentRejections.length > 0;
    if (fitToPermit) {
      // After pushback from the farm manager: stay inside today's permit.
      mm = Math.min(mm, Math.floor(permit / (census.areaHa * M3_PER_MM_HA)));
    }
    if (mm >= IRRIGATION_USEFUL_MM) {
      const reason =
        `Soil moisture ${fixed(census.soilMoisturePct, 0)}%; forecast ${fixed(waterUse, 1)} mm crop water use vs ` +
        `${fixed(rain, 1)} mm rain over ${LOOKAHEAD_DAYS} days (heading for ~${fixed(projected, 0)}%, ` +
        `stress below ${fixed(threshold, 0)}%).`;
      actions.push({ type: "irrigate", mm, confidence: fitToPermit ? 0.75 : 0.8, reason });
      let note = `irrigating ${g(mm)} mm (${thousands(mm * census.areaHa * M3_PER_MM_HA)} m³)`;
      if (fitToPermit) note += `, fitted to today's ${thousands(permit)} m³ water permit`;
      notes.push(note);
    } else {
      notes.push(`soil drying but today's ${thousands(permit)} m³ permit is too small for a useful pass`);
    }
  }

  const recentlySprayed = census.daysSinceSprayed !== null && census.daysSinceSprayed <= SPRAY_INTERVAL_DAYS;
  if (census.diseasePressure >= SPRAY_DISEASE_PRESSURE && !recentlySprayed) {
    const reason = `Blight pressure ${fixed(census.diseasePressure, 2)} and no spray in the last ${SPRAY_INTERVAL_DAYS} days.`;
    actions.push({ type: "spray", product: "fungicide", confidence: 0.7, reason });
    notes.push("spraying fungicide against blight");
  }

  if (!notes.length) return { actions: [], rationale: NO_ACTION, confidence: 0.6 };
  const head = `Soil at ${fixed(census.soilMoisturePct, 0)}%, heading for ~${fixed(projected, 0)}% over the next ${LOOKAHEAD_DAYS} days`;
  return {
    actions,
    rationale: `${head}; ${notes.join(" and ")}.`,
    confidence: actions.length ? Math.min(...actions.map((a) => a.confidence)) : 0.6,
  };
}

/** One field agent's proposal for today. */
export function generate(field, state) {
  const census = state.census(field);
  const cereal = CROPS[census.crop].cereal;
  let plan;
  if (census.harvested) plan = harvested(census);
  else if (cereal && census.harvestReady) plan = ripeCereal(census);
  else if (cereal && census.daysToHarvest >= 1 && census.daysToHarvest <= SCOUT_DAYS) plan = ripeningCereal(census);
  else if (census.irrigable) plan = irrigable(census);
  else plan = { actions: [], rationale: NO_ACTION, confidence: 0.6 };

  const risks = [];
  if (plan.actions.some((a) => a.type === "harvest")) risks.push(`${moistureWord(census.crop)} moisture may need drying`);
  if (plan.actions.some((a) => a.type === "irrigate")) risks.push(`${FIELD_NAMES[field]} water use competes with the permit`);
  return {
    field,
    actions: plan.actions,
    rationale: withRejectionNote(plan.rationale, census.recentRejections),
    confidence: plan.confidence,
    risks,
  };
}
