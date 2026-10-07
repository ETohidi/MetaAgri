// The Safety check: deterministic agronomic and legal rules for proposed actions (no model,
// no randomness). Port of the Python hub's thorn.py.

import { COMBINES, M3_PER_MM_HA, OWN_FARM_NAME, SPRAYERS, WORKERS } from "./state.js";
import { pyRound } from "./format.js";

export const RULE_PROPOSAL_SHAPE = "Every proposal needs a non-empty rationale and 0 <= confidence <= 1.";
export const RULE_WATER_PERMIT = "Irrigation must stay within today's water permit.";
export const RULE_NOT_IRRIGABLE = "Only fields with irrigation equipment can be irrigated.";
export const RULE_SPRAY_WEATHER = "No spraying when wind > 5 m/s or > 5 mm rain is forecast for tomorrow.";
export const RULE_PRE_HARVEST = "No spraying within 14 days of harvest (pre-harvest interval).";
export const RULE_HARVEST = "Harvest only ripe, unharvested crops on a dry day (< 2 mm rain).";
export const RULE_MACHINE = "Each machine can work one field per day.";
export const RULE_WORKERS = "Never plan more work than workers available today.";
export const RULE_FERTILIZE =
  "No fertilizing on waterlogged soil (> 90%), before heavy rain (> 10 mm tomorrow), or on harvested fields.";
export const RULE_NEIGHBOUR_FARM = "borrow_combine and deliver_to need a named neighbour farm.";
export const RULE_NEIGHBOUR_CAPACITY = "Blocked: that farm reports no spare capacity for this.";
export const RULE_COVER_CROP = "Cover crops can only be sown on a harvested field without one.";
export const RULE_DELIVER_SURPLUS = "deliver_to can only move grain that won't fit in our silo today.";
export const RULE_ACTION_PARAMS = "irrigate needs mm > 0, fertilize needs kg_n_ha > 0, deliver_to needs tonnes > 0.";

export const SPRAY_MAX_WIND_MS = 5.0;
export const SPRAY_MAX_RAIN_TOMORROW_MM = 5.0;
export const PRE_HARVEST_DAYS = 14;
export const HARVEST_MAX_RAIN_MM = 2.0;
export const FERTILIZE_MAX_MOISTURE = 90;
export const FERTILIZE_MAX_RAIN_TOMORROW_MM = 10;

// Resource cost per action. Machines and water are booked in book().
export const WORKERS_PER_ACTION = {
  harvest: 2,
  borrow_combine: 1, // our grain cart; the neighbour brings the combine and its driver
  spray: 1,
  irrigate: 1,
  fertilize: 1,
  sow_cover_crop: 1,
};
// Evaluation order: the most valuable / most time-critical work claims resources first.
export const PRIORITY = { harvest: 0, borrow_combine: 0, irrigate: 1, spray: 2, fertilize: 3, sow_cover_crop: 4 };
// The amount an action is about; an agent that leaves it out (or sends 0) would otherwise
// get "Irrigate 0 mm" cleared, costing a worker and telling the neighbours about it.
export const REQUIRED_AMOUNT = { irrigate: "mm", fertilize: "kgNHa", deliver_to: "tonnes" };
const EPSILON = 1e-6; // float slack for summed tonnes / m³
const DELIVER_ROUNDING_T = 0.05; // the Machinery ring rounds deliver_to tonnes to 0.1 t

const own = (obj, key) => (key !== undefined && key !== null && Object.hasOwn(obj, key) ? obj[key] : undefined);
const workersFor = (type) => own(WORKERS_PER_ACTION, type) ?? 0;

export function emptyUsage() {
  return {
    waterM3: 0,
    workers: 0,
    combine: 0,
    sprayer: 0,
    harvestT: 0,
    deliverT: 0,
    harvestedFields: [],
    neighbourCombine: {}, // farm -> combines borrowed
    neighbourStorageT: {}, // farm -> tonnes delivered
  };
}

function cloneUsage(u) {
  return {
    ...u,
    harvestedFields: [...u.harvestedFields],
    neighbourCombine: { ...u.neighbourCombine },
    neighbourStorageT: { ...u.neighbourStorageT },
  };
}

export function waterM3(action, areaHa) {
  return (action.mm || 0) * areaHa * M3_PER_MM_HA;
}

/** Add an allowed action's resource use to `usage`. */
function book(usage, field, action, state) {
  const f = state.fields[field];
  usage.workers += workersFor(action.type);
  if (action.type === "irrigate") {
    usage.waterM3 += waterM3(action, f.areaHa);
  } else if (action.type === "spray") {
    usage.sprayer += 1;
  } else if (action.type === "harvest" || action.type === "borrow_combine") {
    if (action.type === "harvest") usage.combine += 1;
    else usage.neighbourCombine[action.farm] = (own(usage.neighbourCombine, action.farm) ?? 0) + 1;
    usage.harvestT += f.yieldEstimateT;
    usage.harvestedFields.push(field);
  } else if (action.type === "deliver_to") {
    const tonnes = action.tonnes || 0;
    usage.deliverT += tonnes;
    usage.neighbourStorageT[action.farm] = (own(usage.neighbourStorageT, action.farm) ?? 0) + tonnes;
  }
}

/**
 * Resource use of already-cleared proposals, so a second pass (the Machinery ring's
 * suggestions) can continue from where the first pass left off.
 */
export function usageOf(proposals, state) {
  const usage = emptyUsage();
  for (const p of proposals) for (const a of p.actions) book(usage, p.field, a, state);
  return usage;
}

/** What a farm reported it can share; our own farm or an unknown one counts as zero. */
function neighbourShare(state, farm, key) {
  if (!farm || farm === OWN_FARM_NAME) return 0;
  const reported = own(state.nearbyCapacity, farm)?.canShare?.[key];
  return Number(reported ?? 0) || 0;
}

/** The rule this action would break given what is already booked, or null. */
function brokenRule(action, field, state, usage) {
  const f = state.fields[field];
  const today = state.weatherToday;
  const tomorrow = state.forecast[0];
  const t = action.type;

  const amountKey = own(REQUIRED_AMOUNT, t);
  if (amountKey && !((action[amountKey] || 0) > 0)) return RULE_ACTION_PARAMS;
  if ((t === "borrow_combine" || t === "deliver_to") && !action.farm) return RULE_NEIGHBOUR_FARM;
  if (t === "harvest" || t === "borrow_combine") {
    if (!f.harvestReady || usage.harvestedFields.includes(field) || today.rainMm >= HARVEST_MAX_RAIN_MM) {
      return RULE_HARVEST;
    }
    if (t === "harvest" && usage.combine + 1 > COMBINES) return RULE_MACHINE;
    if (t === "borrow_combine") {
      const borrowed = own(usage.neighbourCombine, action.farm) ?? 0;
      if (borrowed + 1 > neighbourShare(state, action.farm, "combine")) return RULE_NEIGHBOUR_CAPACITY;
    }
  } else if (t === "irrigate") {
    if (!f.irrigable) return RULE_NOT_IRRIGABLE;
    if (usage.waterM3 + waterM3(action, f.areaHa) > state.waterPermitM3 + EPSILON) return RULE_WATER_PERMIT;
  } else if (t === "spray") {
    if (today.windMs > SPRAY_MAX_WIND_MS || tomorrow.rainMm > SPRAY_MAX_RAIN_TOMORROW_MM) return RULE_SPRAY_WEATHER;
    if (!f.harvested && f.daysToHarvest <= PRE_HARVEST_DAYS) return RULE_PRE_HARVEST;
    if (usage.sprayer + 1 > SPRAYERS) return RULE_MACHINE;
  } else if (t === "fertilize") {
    if (f.harvested || f.soilMoisture > FERTILIZE_MAX_MOISTURE || tomorrow.rainMm > FERTILIZE_MAX_RAIN_TOMORROW_MM) {
      return RULE_FERTILIZE;
    }
  } else if (t === "deliver_to") {
    const capacity = neighbourShare(state, action.farm, "storageT");
    const delivered = own(usage.neighbourStorageT, action.farm) ?? 0;
    if (capacity <= 0 || delivered + (action.tonnes || 0) > capacity + EPSILON) return RULE_NEIGHBOUR_CAPACITY;
    // Only the part of today's cleared harvests that doesn't fit in our silo can go to a
    // neighbour (harvests are checked first, see PRIORITY), minus what's already sent.
    const surplusLeft = Math.max(0, usage.harvestT - state.storageFreeT - usage.deliverT);
    if ((action.tonnes || 0) > surplusLeft + DELIVER_ROUNDING_T + EPSILON) return RULE_DELIVER_SURPLUS;
  } else if (t === "sow_cover_crop") {
    if (!f.harvested || f.coverCrop) return RULE_COVER_CROP;
  }
  // scout, defer_task: nothing to check beyond workers (they need none)

  if (usage.workers + workersFor(t) > WORKERS) return RULE_WORKERS;
  return null;
}

function shapeOk(p) {
  return (
    typeof p.rationale === "string" &&
    p.rationale.trim() !== "" &&
    typeof p.confidence === "number" &&
    p.confidence >= 0 &&
    p.confidence <= 1
  );
}

/**
 * Would this action clear the safety check if it were the only work planned today? The
 * Coordinator asks before a harvest or spray competes for a machine, so an action that will
 * be blocked anyway (crop not ripe, pre-harvest interval, ...) can't win it.
 */
export function passesAlone(p, action, state) {
  return shapeOk(p) && brokenRule(action, p.field, state, emptyUsage()) === null;
}

function entry(field, action, blocked, rule) {
  return { field, action: { ...action }, blocked, rule };
}

export function resourcesBefore(state) {
  return {
    waterM3: state.waterPermitM3,
    workers: WORKERS,
    combine: COMBINES,
    sprayer: SPRAYERS,
    storageFreeT: pyRound(state.storageFreeT, 1),
  };
}

function compareTuples(a, b) {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  return 0;
}

/**
 * Check every action of every proposal, in priority order, booking what each allowed
 * action uses. startingUsage lets a second pass (the Machinery ring's suggestions,
 * evaluated after the field agents' own proposals) continue from the first pass's resource
 * use instead of starting from a fresh day; `before` is always today's availability.
 * Returns {entries, proposals (allowed actions only), before, after}.
 */
export function evaluate(proposals, state, startingUsage = null) {
  const usage = startingUsage ? cloneUsage(startingUsage) : emptyUsage();
  const entries = [];

  const valid = [];
  for (const p of proposals) {
    if (!shapeOk(p)) {
      for (const a of p.actions) entries.push(entry(p.field, a, true, RULE_PROPOSAL_SHAPE));
      continue;
    }
    valid.push(p);
  }

  const priority = ([i, j]) => {
    const p = valid[i];
    const a = p.actions[j];
    const group = own(PRIORITY, a.type) ?? 5;
    // irrigation: the driest field (relative to its stress threshold) first
    const f = state.fields[p.field];
    const dryness = a.type === "irrigate" ? f.soilMoisture - f.stressThreshold : 0;
    return [group, dryness, i, j];
  };
  const order = valid
    .flatMap((p, i) => p.actions.map((_, j) => [i, j]))
    .map((ij) => ({ ij, key: priority(ij) }))
    .sort((x, y) => compareTuples(x.key, y.key))
    .map((x) => x.ij);

  const allowed = new Set();
  for (const [i, j] of order) {
    const p = valid[i];
    const a = p.actions[j];
    const rule = brokenRule(a, p.field, state, usage);
    if (rule === null) {
      book(usage, p.field, a, state);
      allowed.add(`${i}:${j}`);
    }
    entries.push(entry(p.field, a, rule !== null, rule));
  }

  const filtered = valid.map((p, i) => ({ ...p, actions: p.actions.filter((_, j) => allowed.has(`${i}:${j}`)) }));

  const before = resourcesBefore(state);
  const free = before.storageFreeT;
  // Harvests fill the silo first; deliver_to only ever moves the part that didn't fit, so
  // it relieves the surplus but never frees our own storage (same as applyBundle).
  const surplus = Math.max(0, usage.harvestT - free);
  const after = {
    waterM3: before.waterM3 - usage.waterM3,
    workers: before.workers - usage.workers,
    combine: before.combine - usage.combine,
    sprayer: before.sprayer - usage.sprayer,
    storageFreeT: pyRound(Math.max(0, free - usage.harvestT + Math.min(usage.deliverT, surplus)), 1),
  };
  return { entries, proposals: filtered, before, after, usage };
}
