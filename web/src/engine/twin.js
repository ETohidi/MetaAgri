// The Twin: the one object views talk to. It owns the farm state and the seeded rng, runs
// the daily loop (simulate -> field agents propose -> farm agents report -> Coordinator and
// Safety check -> wait for the farm manager), and hands out JSON-safe copies so views can't
// change the simulation by accident.

import { FARM_BY_ID, FIELD_BY_ID, FIELD_NAMES } from "../data/places.js";
import { dateLabel } from "./clock.js";
import * as coordinator from "./coordinator.js";
import * as farms from "./farms.js";
import * as notices from "./notices.js";
import * as planners from "./planners.js";
import { createRng } from "./rng.js";
import * as safety from "./safety.js";
import * as sim from "./sim.js";
import { FARM_NAMES, FarmState, FIELDS, OWN_FARM_NAME } from "./state.js";

/** The default season: its first plan, heatwave and hail warning show every designed moment. */
export const DEFAULT_SEED = 20260707;

const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** "North" or its route id "north" -> "North". */
function fieldKey(field) {
  if (FIELDS.includes(field)) return field;
  if (Object.hasOwn(FIELD_BY_ID, String(field))) return FIELD_BY_ID[field];
  throw new Error(`Unknown field ${field}`);
}

/** "Gut Rohrdommelsee" or its id "rohrdommelsee" -> "Gut Rohrdommelsee". */
function farmKey(farm) {
  if (FARM_NAMES.includes(farm)) return farm;
  if (Object.hasOwn(FARM_BY_ID, String(farm))) return FARM_BY_ID[farm].name;
  throw new Error(`Unknown farm ${farm}`);
}

export class Twin {
  #options;
  #listeners = new Set();

  constructor({ seed = DEFAULT_SEED, firstPlan = true } = {}) {
    this.#options = { firstPlan };
    this.#init(seed);
  }

  #init(seed) {
    this.seed = seed;
    this.rng = createRng(seed);
    /** Internal; exposed for tests. Views use snapshot() and the query methods. */
    this.state = new FarmState({ seed, rng: this.rng });
    if (this.#options.firstPlan) this.#plan();
  }

  // -- subscriptions ---------------------------------------------------------------------
  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify() {
    for (const fn of [...this.#listeners]) fn();
  }

  // -- commands --------------------------------------------------------------------------
  /** Today's plan: every field agent proposes, every farm agent reports, the Coordinator bundles. */
  #plan() {
    const state = this.state;
    const proposals = FIELDS.map((f) => planners.generate(f, state));
    const capacity = Object.fromEntries(FARM_NAMES.map((name) => [name, farms.generate(name, state)]));
    state.recentProposals = proposals.map((p) => p.field);
    return coordinator.buildBundle(state, proposals, capacity);
  }

  /** Advance one day (an undecided plan expires) and make that day's plan. */
  tick() {
    sim.step(this.state);
    const bundle = this.#plan();
    this.#notify();
    return copy(bundle);
  }

  /** The water authority cuts the permit at once; a no-op while a heatwave is on. */
  heatwave() {
    const state = this.state;
    const scenario = state.heatwaveDaysRemaining > 0 ? state.heatwaveMessage() : sim.startHeatwave(state);
    this.#notify();
    return { scenario };
  }

  /** Severe hail in two days; a no-op while a hail warning is active. */
  hail() {
    const scenario = sim.hailWarning(this.state);
    this.#notify();
    return { scenario };
  }

  /**
   * The farm manager approves or rejects a pending plan. Returns the updated plan. Throws
   * for an unknown or already-decided plan, and on approve when the plan no longer passes
   * the safety check (a scenario since it was built can make it illegal).
   */
  decide(bundleId, decision, reason) {
    const state = this.state;
    const bundle = state.bundles.find((b) => b.id === Number(bundleId));
    if (!bundle) throw new Error("Plan not found");
    if (bundle.status !== "pending") throw new Error(`Plan already ${bundle.status}`);
    if (decision !== "approve" && decision !== "reject") throw new Error(`Unknown decision ${decision}`);

    if (decision === "approve") {
      const blocked = this.#blockedNow(bundle);
      if (blocked.length) {
        const what = blocked
          .map((e) => `${e.action.type} for ${FIELD_NAMES[e.field] ?? e.field}: ${e.rule.replace(/\.+$/, "")}`)
          .join("; ");
        state.addLog(
          "Safety check",
          "block",
          `the ${bundle.planFor} plan no longer passes (${what}); reject it so the field agents re-plan`,
        );
        this.#notify();
        throw new Error(`This plan no longer passes the safety check: ${what}. Reject it so the field agents re-plan.`);
      }
      state.applyBundle(bundle);
      bundle.status = "approved";
      for (const n of notices.generate(bundle, state)) state.addNotice(n.audience, n.text);
      state.addLog("Farm manager", "decision", `approved the ${bundle.planFor} plan`);
    } else {
      bundle.status = "rejected";
      bundle.reason = reason ?? null;
      for (const field of new Set(bundle.proposals.map((p) => p.field))) state.addRejection(field, reason || "rejected");
      state.addLog("Farm manager", "decision", `rejected the ${bundle.planFor} plan${reason ? `: ${reason}` : ""}`);
    }
    this.#notify();
    return copy(bundle);
  }

  /**
   * Re-run the safety check on a pending plan against the twin as it is now. While nothing
   * has changed, one pass over the whole plan clears exactly what the two build passes
   * cleared (harvests and borrows are still booked before any delivery, and the field
   * agents' actions before the Machinery ring's).
   */
  #blockedNow(bundle) {
    return safety.evaluate(structuredClone(bundle.proposals), this.state).entries.filter((e) => e.blocked);
  }

  /** Restart the season (same seed unless given). */
  reset({ seed } = {}) {
    this.#init(seed ?? this.seed);
    this.#notify();
  }

  // -- queries (all return copies) ----------------------------------------------------------
  snapshot() {
    const s = this.state;
    return copy({
      tick: s.tick,
      date: s.date(),
      longDate: s.longDate(),
      seed: this.seed,
      farm: OWN_FARM_NAME,
      fields: Object.fromEntries(FIELDS.map((f) => [f, s.fieldSnapshot(f)])),
      weatherToday: s.weatherToday,
      forecast: s.forecast,
      resources: s.resourcesSnapshot(),
      scenarios: s.scenarioMessages(),
      heatwaveDaysRemaining: s.heatwaveDaysRemaining,
      hailDate: s.hailWarningActive ? dateLabel(s.hailTick) : null,
      farms: s.farmsSummary(),
      nearbyCapacity: s.nearbyCapacity,
      recentActions: s.recentActions,
      recentProposals: s.recentProposals,
      pendingBundle: s.bundles.find((b) => b.status === "pending") ?? null,
      bundleCount: s.bundles.length,
    });
  }

  /** What a field agent sees. */
  census(field) {
    return copy(this.state.census(fieldKey(field)));
  }

  /** What a farm agent sees. */
  farmCensus(farmName) {
    return copy(this.state.farmCensus(farmKey(farmName)));
  }

  fieldHistory(field) {
    const f = fieldKey(field);
    return copy({
      history: this.state.history[f],
      projection: this.state.projection(f),
      stressThresholdPct: this.state.fields[f].stressThreshold,
    });
  }

  /** The latest plans this field's agent proposed in, newest first. */
  fieldPlans(field, limit = 3) {
    const f = fieldKey(field);
    const matches = [];
    for (const b of [...this.state.bundles].reverse()) {
      const proposal = b.proposals.find((p) => p.field === f);
      if (!proposal) continue;
      matches.push({ bundleId: b.id, planFor: b.planFor, status: b.status, confidence: proposal.confidence });
      if (matches.length >= limit) break;
    }
    return matches;
  }

  farmHistory(farmName) {
    return copy(this.state.farmHistory[farmKey(farmName)]);
  }

  /** The farm agent's latest answers to the Machinery ring, newest first. */
  farmReports(farmName, limit = 3) {
    const name = farmKey(farmName);
    const matches = [];
    for (const b of [...this.state.bundles].reverse()) {
      const report = b.nearbyCapacity.find((r) => r.farm === name);
      if (!report) continue;
      matches.push({ planFor: b.planFor, canShare: { ...report.canShare }, confidence: report.confidence, note: report.note ?? "" });
      if (matches.length >= limit) break;
    }
    return matches;
  }

  inbox() {
    return copy(this.state.bundles.filter((b) => b.status === "pending"));
  }

  bundles() {
    return copy([...this.state.bundles].reverse());
  }

  log() {
    return copy([...this.state.log].reverse());
  }

  notices() {
    return copy([...this.state.notices].reverse());
  }
}
