// The Coordinator: bundles the field agents' proposals into one plan for the day, settles
// machine conflicts by value at risk, runs the Safety check, and adds the Machinery ring's
// neighbour help (borrow a combine, deliver surplus grain). Port of the Python hub's stem.py.

import { FIELD_AGENT_NAMES, FIELD_NAMES } from "../data/places.js";
import { dateLabel } from "./clock.js";
import { fixed, g, joinAnd, pyRound, thousands } from "./format.js";
import * as safety from "./safety.js";
import { CROPS, OWN_FARM_NAME } from "./state.js";

export const MACHINE_FOR_ACTION = { harvest: "combine", spray: "sprayer" }; // one of each on our farm
export const SURPLUS_MIN_T = 0.5; // below this, a silo overflow is rounding noise, not worth a trip
export const RING_RATIONALE_PREFIX = "Machinery ring:";

const fieldName = (field) => FIELD_NAMES[field] ?? field;
const euroK = (value) => `€${fixed(value / 1000, 0)}k`;

/** The first element with the largest key (like Python's max(..., key=...)). */
function maxBy(items, key) {
  let best;
  let bestKey;
  for (const item of items) {
    const k = key(item);
    if (best === undefined || compareKeys(k, bestKey) > 0) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

function compareKeys(a, b) {
  const as = Array.isArray(a) ? a : [a];
  const bs = Array.isArray(b) ? b : [b];
  for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  return 0;
}

function valueAtRisk(state, field, actionType) {
  const f = state.fields[field];
  let value = f.yieldEstimateT * CROPS[f.crop].priceEurT;
  if (actionType === "spray") value *= f.disease; // what the disease could take
  return value;
}

/**
 * More than one field wants the combine (harvest) or the sprayer (spray) today -> keep the
 * field with the most value at risk, drop the others. Returns the resolved proposals and
 * the fields that lost the combine (candidates for a borrowed one). Only work that could
 * pass the safety check competes: an unripe harvest or a spray inside the pre-harvest
 * interval stays in its proposal for the safety check to block, and never takes the
 * machine from a field that could use it.
 */
export function resolveConflicts(state, proposals) {
  const result = structuredClone(proposals);
  const unmetHarvest = [];

  for (const [actionType, machine] of Object.entries(MACHINE_FOR_ACTION)) {
    const wanting = [];
    for (const p of result) {
      if (
        !wanting.includes(p.field) &&
        p.actions.some((a) => a.type === actionType && safety.passesAlone(p, a, state))
      ) {
        wanting.push(p.field);
      }
    }
    if (wanting.length <= 1) continue;

    const values = Object.fromEntries(wanting.map((f) => [f, valueAtRisk(state, f, actionType)]));
    const winner = maxBy(wanting, (f) => values[f]);
    const losers = wanting.filter((f) => f !== winner);
    for (const p of result) {
      if (losers.includes(p.field)) p.actions = p.actions.filter((a) => a.type !== actionType);
    }
    if (actionType === "harvest") unmetHarvest.push(...losers);

    state.addLog(
      "Coordinator",
      "info",
      `conflict: the ${machine} was requested by ${joinAnd(wanting.map(fieldName))}; ` +
        `kept ${fieldName(winner)} (${euroK(values[winner])} at risk vs ` +
        `${losers.map((f) => euroK(values[f])).join(", ")}), ` +
        `${joinAnd(losers.map(fieldName))} ${losers.length === 1 ? "waits" : "wait"}`,
    );
  }

  return { proposals: result, unmetHarvest };
}

function what(state, field, a) {
  const f = state.fields[field];
  switch (a.type) {
    case "irrigate":
      return `Irrigate ${g(a.mm || 0)} mm`;
    case "harvest":
      return `Harvest ~${fixed(f.yieldEstimateT, 0)} t`;
    case "borrow_combine":
      return `Harvest with ${a.farm}'s combine (~${fixed(f.yieldEstimateT, 0)} t)`;
    case "deliver_to":
      return `Deliver ${fixed(a.tonnes || 0, 0)} t to ${a.farm}`;
    case "spray":
      return `Spray ${a.product || "crop protection"}`;
    case "fertilize":
      return a.kgNHa ? `Fertilize ${g(a.kgNHa)} kg N/ha` : "Fertilize";
    case "scout":
      return "Scout field";
    case "sow_cover_crop":
      return "Sow cover crop";
    default:
      return "Wait"; // defer_task
  }
}

function resourcesText(state, field, a) {
  switch (a.type) {
    case "irrigate":
      return `${thousands(safety.waterM3(a, state.fields[field].areaHa))} m³ water · 1 worker`;
    case "harvest":
      return "combine · 2 workers";
    case "borrow_combine":
      return `${a.farm}'s combine · 1 worker`;
    case "spray":
      return "sprayer · 1 worker";
    case "fertilize":
    case "sow_cover_crop":
      return "1 worker";
    default:
      return "—";
  }
}

function planRow(state, field, a, p) {
  return {
    field,
    crop: state.fields[field].crop,
    actionType: a.type,
    what: what(state, field, a),
    resources: resourcesText(state, field, a),
    confidence: a.confidence ?? p.confidence,
    reason: a.reason || p.rationale,
  };
}

/**
 * Highest-confidence neighbour (never our own farm) with at least `needed` of `key` still
 * left in `remaining`; ties go to the one with the most storage to spare.
 */
function bestNeighbour(farmCapacity, remaining, key, needed) {
  const candidates = Object.keys(remaining).filter(
    (name) => name !== OWN_FARM_NAME && (remaining[name][key] ?? 0) >= needed,
  );
  if (!candidates.length) return null;
  return maxBy(candidates, (name) => [farmCapacity[name].confidence, remaining[name].storageT ?? 0]);
}

/**
 * (a) a ripe field that lost the combine conflict gets a borrowed neighbour combine;
 * (b) grain that won't fit in our silo gets deliver_to actions to neighbours with space.
 * Everything starts from what the field agents' own cleared actions already use (a field
 * agent may have borrowed a combine or sent grain to a neighbour itself), and capacity is
 * decremented locally as it's allocated, so one neighbour is never over-subscribed; the
 * safety check independently re-verifies against what each farm actually reported.
 */
export function suggestNeighbourHelp(state, filteredProposals, farmCapacity, unmetHarvest) {
  let usage = safety.usageOf(filteredProposals, state);
  const remaining = {};
  for (const [name, cap] of Object.entries(farmCapacity)) {
    if (name === OWN_FARM_NAME) continue;
    const share = { ...(cap.canShare ?? {}) };
    share.combine = (share.combine ?? 0) - (usage.neighbourCombine[name] ?? 0);
    share.storageT = (share.storageT ?? 0) - (usage.neighbourStorageT[name] ?? 0);
    remaining[name] = share;
  }
  const actionsByField = new Map();
  const addAction = (field, action) => {
    if (!actionsByField.has(field)) actionsByField.set(field, []);
    actionsByField.get(field).push(action);
  };
  let borrowed = [];

  for (const field of unmetHarvest) {
    const f = state.fields[field];
    if (!f.harvestReady || usage.harvestedFields.includes(field)) continue;
    const name = bestNeighbour(farmCapacity, remaining, "combine", 1);
    if (name === null) {
      state.addLog("Machinery ring", "warn", `no neighbour combine free today; ${fieldName(field)} waits`);
      continue;
    }
    remaining[name].combine -= 1;
    const confidence = farmCapacity[name].confidence;
    addAction(field, {
      type: "borrow_combine",
      farm: name,
      confidence,
      reason:
        `Our combine is busy elsewhere and the ${f.shortCrop} is ripe; ` +
        `${name} can lend theirs today (confidence ${fixed(confidence, 2)}).`,
    });
    borrowed.push(field);
  }

  // Size the surplus only on borrows the safety check will clear (the same check pass 2
  // runs: harvests and borrows go first, from the same usage), so a blocked borrow never
  // leaves a delivery of grain that is still on the field.
  if (borrowed.length) {
    const borrowProposals = borrowed.map((field) => ({
      field,
      actions: actionsByField.get(field),
      rationale: "Machinery ring",
      confidence: 1.0,
      risks: [],
    }));
    const cleared = safety.evaluate(borrowProposals, state, usage).proposals;
    usage = safety.usageOf([...filteredProposals, ...cleared], state);
    borrowed = cleared.filter((p) => p.actions.length).map((p) => p.field);
  }

  const expectedT = usage.harvestT;
  const free = state.storageFreeT;
  const surplus = expectedT - free - usage.deliverT;
  if (surplus > SURPLUS_MIN_T) {
    const grainField = borrowed.length ? borrowed[borrowed.length - 1] : usage.harvestedFields[usage.harvestedFields.length - 1];
    let left = surplus;
    // Stop once what's left isn't worth a trailer trip (no "Deliver 0 t to ..." rows); a
    // small remainder is sold with the rest at the spot price.
    while (left > SURPLUS_MIN_T) {
      const name = bestNeighbour(farmCapacity, remaining, "storageT", SURPLUS_MIN_T);
      if (name === null) break;
      const tonnes = Math.min(pyRound(left, 1), remaining[name].storageT);
      remaining[name].storageT -= tonnes;
      left -= tonnes;
      const confidence = farmCapacity[name].confidence;
      addAction(grainField, {
        type: "deliver_to",
        tonnes,
        farm: name,
        confidence,
        reason:
          `~${fixed(expectedT, 0)} t coming in today but only ${fixed(free, 0)} t free in our silo; ` +
          `${name} reports ${fixed(farmCapacity[name].canShare?.storageT ?? 0, 0)} t spare storage.`,
      });
    }
    if (left > SURPLUS_MIN_T) {
      state.addLog(
        "Machinery ring",
        "warn",
        `neighbours can't store all of it; about ${fixed(left, 0)} t would be sold directly at the harvest spot price`,
      );
    }
  }

  const proposals = [];
  for (const [field, actions] of actionsByField) {
    const parts = actions.map((a) =>
      a.type === "borrow_combine"
        ? `borrow ${a.farm}'s combine for ${fieldName(field)}`
        : `send ${fixed(a.tonnes, 0)} t surplus to ${a.farm}`,
    );
    const risks = [];
    if (actions.some((a) => a.type === "borrow_combine")) risks.push("the neighbour's combine may arrive late");
    if (actions.some((a) => a.type === "deliver_to")) risks.push("trailer trips to the neighbour's silo");
    proposals.push({
      field,
      actions,
      rationale: `${RING_RATIONALE_PREFIX} ${parts.join("; ")}.`,
      confidence: Math.min(...actions.map((a) => a.confidence)),
      risks,
    });
  }
  return proposals;
}

function logBlocks(state, entries) {
  for (const e of entries) {
    if (e.blocked) state.addLog("Safety check", "block", `blocked ${e.action.type} for ${fieldName(e.field)}: ${e.rule}`);
  }
}

/** The day's plan from the field agents' proposals and the farm agents' capacity answers. */
export function buildBundle(state, proposals, farmCapacity) {
  for (const p of proposals) {
    state.addLog(
      FIELD_AGENT_NAMES[p.field] ?? p.field,
      "info",
      `proposed ${p.actions.length} action(s): ${p.rationale}`,
    );
  }

  // Machinery ring: record today's spare-capacity answers before any safety check runs, so
  // a borrow_combine / deliver_to - whether a field agent proposed it itself (pass 1) or the
  // ring suggests it (pass 2) - is verified against what farms reported today, not
  // against yesterday's answers.
  state.nearbyCapacity = farmCapacity;

  const resolved = resolveConflicts(state, proposals);
  const pass1 = safety.evaluate(resolved.proposals, state);
  const entries = [...pass1.entries];
  let filtered = pass1.proposals;
  let after = pass1.after;
  const before = pass1.before;
  logBlocks(state, pass1.entries);

  for (const [name, cap] of Object.entries(farmCapacity)) {
    const share = cap.canShare ?? {};
    state.addLog(
      name,
      "info",
      (
        `can share ${fixed(share.combine ?? 0, 0)} combine / ${fixed(share.storageT ?? 0, 0)} t storage ` +
        `until ${cap.validUntil} (confidence ${fixed(cap.confidence, 2)}). ${cap.note ?? ""}`
      ).trim(),
    );
  }
  state.addLog("Machinery ring", "info", `compiled spare capacity from ${Object.keys(farmCapacity).length} farms`);

  const ring = suggestNeighbourHelp(state, filtered, farmCapacity, resolved.unmetHarvest);
  if (ring.length) {
    const pass2 = safety.evaluate(ring, state, safety.usageOf(filtered, state));
    entries.push(...pass2.entries);
    logBlocks(state, pass2.entries);
    filtered = [...filtered, ...pass2.proposals.filter((p) => p.actions.length)];
    after = pass2.after;
  }

  const nTotal = entries.length;
  const nBlocked = entries.filter((e) => e.blocked).length;
  const planFor = dateLabel(state.tick);
  const summary =
    `${planFor}: ${filtered.length} proposals, ` + `${nTotal - nBlocked}/${nTotal} actions cleared by the safety check`;

  const planRows = filtered.flatMap((p) => p.actions.map((a) => planRow(state, p.field, a, p)));
  const overallConfidence = planRows.length ? Math.min(...planRows.map((r) => r.confidence)) : null;

  const bundle = {
    id: state.nextBundleId,
    tick: state.tick,
    planFor,
    summary,
    proposals: structuredClone(filtered),
    safety: entries,
    planRows,
    overallConfidence,
    nearbyCapacity: structuredClone(Object.values(farmCapacity)),
    resourcesBefore: before,
    resourcesAfter: after,
    status: "pending",
    reason: null,
  };
  state.nextBundleId += 1;
  state.bundles.push(bundle);
  state.addLog("Coordinator", "info", summary);
  return bundle;
}
