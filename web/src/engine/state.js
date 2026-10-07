// In-memory farm twin state: our three fields, the regional weather, today's resources,
// the neighbour farms, plans, log, notices and history. Port of the Python hub's state.py.

import {
  FARMS,
  FIELD_IDS,
  FIELD_NAMES,
  FIELD_POLYGONS,
  FIELDS,
  OWN_FARM,
} from "../data/places.js";
import { dateLabel, longDate } from "./clock.js";
import { fixed, pyRound, thousands } from "./format.js";
import * as weather from "./weather.js";

export { FIELDS };
export const OWN_FARM_NAME = OWN_FARM.name;
export const FARM_NAMES = FARMS.map((f) => f.name);
const FARM_BY_NAME = Object.fromEntries(FARMS.map((f) => [f.name, f]));

// kc = crop coefficient while growing; price for value-at-risk; cereal = combinable crop
// (ripens and needs the combine).
export const CROPS = {
  "winter wheat": { kc: 0.45, stressThreshold: 35, priceEurT: 220, cereal: true, dailyRipeLoss: 0.01, emoji: "🌾" },
  rapeseed: { kc: 0.4, stressThreshold: 30, priceEurT: 460, cereal: true, dailyRipeLoss: 0.02, emoji: "🌼" },
  potatoes: { kc: 1.1, stressThreshold: 60, priceEurT: 160, cereal: false, dailyRipeLoss: 0.0, emoji: "🥔" },
};
export const KC_HARVESTED = 0.2; // bare stubble
export const KC_COVER_CROP = 0.5;

export const SEED_FIELDS = {
  North: { crop: "winter wheat", areaHa: 42, daysToHarvest: 4, soilMoisture: 48, irrigable: false, yieldTHa: 7.8, health: 0.86, disease: 0.15 },
  West: { crop: "rapeseed", areaHa: 30, daysToHarvest: 3, soilMoisture: 44, irrigable: false, yieldTHa: 3.9, health: 0.84, disease: 0.1 },
  River: { crop: "potatoes", areaHa: 24, daysToHarvest: 48, soilMoisture: 62, irrigable: true, yieldTHa: 42.0, health: 0.9, disease: 0.35 },
};

export const NEIGHBOUR_FARM_SEEDS = {
  "Gut Rohrdommelsee": { storageCapacityT: 900, storageUsedT: 380, combineBusyProb: 0.1, cerealHeavy: false, avgSoilMoisture: 52 },
  "Agrarhof Oderblick": { storageCapacityT: 600, storageUsedT: 420, combineBusyProb: 0.6, cerealHeavy: true, avgSoilMoisture: 45 },
};

export const WATER_PERMIT_NORMAL_M3 = 6500; // daily abstraction permit
export const WATER_PERMIT_HEATWAVE_M3 = 3600; // the authority cuts it during a heatwave
export const COMBINES = 1;
export const SPRAYERS = 1;
export const WORKERS = 5;
export const STORAGE_CAPACITY_T = 450;
export const STORAGE_SEED_USED_T = 120;
export const M3_PER_MM_HA = 10; // 1 mm on 1 ha = 10 m³

// A cereal-heavy neighbour rushes its own ripe crop in before a hail storm.
export const NEIGHBOUR_HAIL_BACKLOG_SHARE = 0.25;
export const SURPLUS_NOISE_T = 0.5; // less than this isn't a sale or a trailer trip
export const NEIGHBOUR_HINT =
  "The farm manager suggested a neighbour farm could help - propose the harvest as usual; " +
  "the Machinery ring will line up a neighbour's combine or silo space if ours can't cope.";

const MAX_REJECTIONS = 5;
const NOTICE_LIMIT = 30;
const LOG_LIMIT = 2000;

// Farm map status: crit below 35 % soil moisture or a silo over 95 % full, warn below 45 % / over 85 %.
export function farmStatus(avgSoilMoisturePct, storageFreeT, storageCapacityT) {
  const fill = storageCapacityT ? 1 - storageFreeT / storageCapacityT : 0;
  if (avgSoilMoisturePct < 35 || fill > 0.95) return "crit";
  if (avgSoilMoisturePct < 45 || fill > 0.85) return "warn";
  return "ok";
}

export class FieldState {
  constructor(name, cfg) {
    this.name = name;
    this.crop = cfg.crop;
    this.areaHa = cfg.areaHa;
    this.daysToHarvest = cfg.daysToHarvest;
    this.soilMoisture = cfg.soilMoisture;
    this.irrigable = cfg.irrigable;
    this.yieldTHa = cfg.yieldTHa;
    this.health = cfg.health;
    this.disease = cfg.disease;
    this.harvested = false;
    this.coverCrop = false;
    this.harvestedT = 0;
    this.harvestWaitingDays = 0;
    this.lastIrrigatedTick = null;
    this.lastSprayedTick = null;
    this.recentRejections = [];
  }

  get cereal() {
    return CROPS[this.crop].cereal;
  }

  get stressThreshold() {
    return CROPS[this.crop].stressThreshold;
  }

  /** "winter wheat" -> "wheat", for plain-language text. */
  get shortCrop() {
    return this.crop.split(" ").pop();
  }

  get harvestReady() {
    return !this.harvested && this.daysToHarvest <= 0;
  }

  get kc() {
    if (this.harvested) return this.coverCrop ? KC_COVER_CROP : KC_HARVESTED;
    return CROPS[this.crop].kc;
  }

  /** Standing crop estimate; once harvested, what actually came off the field. */
  get yieldEstimateT() {
    if (this.harvested) return this.harvestedT;
    return pyRound(this.areaHa * this.yieldTHa * Math.min(1.0, this.health / 0.85), 1);
  }

  get stage() {
    if (this.harvested) return this.coverCrop ? "cover crop" : "harvested";
    if (this.cereal) {
      if (this.daysToHarvest <= 0) return "harvest-ready";
      return this.daysToHarvest <= 7 ? "ripening" : "grain fill";
    }
    return this.daysToHarvest > 14 ? "tuber bulking" : "maturing";
  }
}

export class FarmState {
  /** A fresh season: tick 0 is Monday 6 July. `rng` is the twin's seeded generator. */
  constructor({ seed, rng }) {
    this.seed = seed;
    this.rng = rng;
    this.tick = 0;
    this.nextBundleId = 1;
    this.fields = Object.fromEntries(FIELDS.map((name) => [name, new FieldState(name, SEED_FIELDS[name])]));
    this.waterPermitM3 = WATER_PERMIT_NORMAL_M3;
    this.storageUsedT = STORAGE_SEED_USED_T;
    // Grain an approved plan harvested beyond the silo's free space, waiting for a
    // deliver_to in the same plan (else sold directly to the co-op).
    this.pendingSurplusT = 0;
    this.ownCombineBusy = false; // our combine already worked a field today
    this.heatwaveDaysRemaining = 0; // counts today as the first remaining day
    this.hailTick = null;

    this.weatherToday = weather.normalDay(rng, 0);
    this.forecast = [];
    for (let t = 1; t <= weather.FORECAST_DAYS; t++) this.forecast.push(weather.normalDay(rng, t));

    this.neighbours = Object.fromEntries(
      Object.entries(NEIGHBOUR_FARM_SEEDS).map(([name, cfg]) => [
        name,
        {
          ...cfg,
          crops: FARM_BY_NAME[name].crops,
          areaHa: FARM_BY_NAME[name].areaHa,
          combineAvailable: rng.random() > cfg.combineBusyProb ? 1 : 0,
        },
      ]),
    );

    this.bundles = [];
    this.log = [];
    this.notices = [];
    // Last known answer from each farm agent (ours included), refreshed by the Machinery
    // ring every day. Keyed by farm name.
    this.nearbyCapacity = {};
    this.history = Object.fromEntries(FIELDS.map((f) => [f, []]));
    this.farmHistory = Object.fromEntries(FARM_NAMES.map((n) => [n, []]));
    // Today's approved work, for the hero animations; cleared by the next day.
    this.recentActions = [];
    this.recentProposals = [];

    this.recordHistory();
    this.recordFarmHistory();
    this.addLog("Farm", "info", `season reset / seeded (seed ${seed})`);
  }

  // -- helpers ---------------------------------------------------------------------
  date() {
    return dateLabel(this.tick);
  }

  longDate() {
    return longDate(this.tick);
  }

  get storageFreeT() {
    return Math.max(0, STORAGE_CAPACITY_T - this.storageUsedT);
  }

  get hailWarningActive() {
    return this.hailTick !== null;
  }

  heatwaveMessage() {
    return `heatwave: water permit cut to ${thousands(WATER_PERMIT_HEATWAVE_M3)} m³/day`;
  }

  hailMessage() {
    return `hail warning: severe hail expected ${dateLabel(this.hailTick)}`;
  }

  scenarioMessages() {
    const messages = [];
    if (this.heatwaveDaysRemaining > 0) messages.push(this.heatwaveMessage());
    if (this.hailWarningActive) messages.push(this.hailMessage());
    return messages;
  }

  /** All active scenario messages joined, or null. */
  get scenario() {
    const messages = this.scenarioMessages();
    return messages.length ? messages.join(" · ") : null;
  }

  addLog(actor, level, text) {
    this.log.push({ tick: this.tick, date: this.date(), actor, text, level });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  addNotice(audience, text) {
    this.notices.push({ tick: this.tick, date: this.date(), audience, text });
    this.notices = this.notices.slice(-NOTICE_LIMIT);
  }

  addRejection(field, text) {
    const f = this.fields[field];
    f.recentRejections = [...f.recentRejections, text].slice(-MAX_REJECTIONS);
  }

  ownAvgSoilMoisture() {
    const fields = Object.values(this.fields);
    const totalArea = fields.reduce((sum, f) => sum + f.areaHa, 0);
    return pyRound(fields.reduce((sum, f) => sum + f.soilMoisture * f.areaHa, 0) / totalArea, 1);
  }

  ownCombineAvailable() {
    return this.ownCombineBusy ? 0 : COMBINES;
  }

  neighbourStorageFreeT(name) {
    const n = this.neighbours[name];
    return Math.max(0, n.storageCapacityT - n.storageUsedT);
  }

  // -- field census, for a field agent ------------------------------------------------
  resources() {
    return {
      waterPermitM3: this.waterPermitM3,
      workers: WORKERS,
      combine: COMBINES,
      sprayer: SPRAYERS,
      storageFreeT: pyRound(this.storageFreeT, 1),
    };
  }

  census(name) {
    const f = this.fields[name];
    const hint = f.recentRejections.some((r) => r.toLowerCase().includes("neighbour farm")) ? NEIGHBOUR_HINT : null;
    return {
      tick: this.tick,
      date: this.date(),
      field: name,
      crop: f.crop,
      areaHa: f.areaHa,
      stage: f.stage,
      daysToHarvest: f.daysToHarvest,
      harvestReady: f.harvestReady,
      harvested: f.harvested,
      coverCrop: f.coverCrop,
      irrigable: f.irrigable,
      soilMoisturePct: pyRound(f.soilMoisture, 1),
      stressThresholdPct: f.stressThreshold,
      cropHealth: pyRound(f.health, 3),
      diseasePressure: pyRound(f.disease, 3),
      yieldEstimateT: f.yieldEstimateT,
      daysSinceSprayed: f.lastSprayedTick === null ? null : this.tick - f.lastSprayedTick,
      daysSinceIrrigated: f.lastIrrigatedTick === null ? null : this.tick - f.lastIrrigatedTick,
      weatherToday: { ...this.weatherToday },
      forecast: this.forecast.map((w) => ({ ...w })),
      resources: this.resources(),
      recentRejections: [...f.recentRejections],
      scenario: this.scenario,
      hint,
    };
  }

  // -- farm-level census, for a farm agent (ours or a neighbour's) ----------------------
  farmCensus(farmName) {
    let storageFree;
    let combine;
    let backlog;
    let moisture;
    if (farmName === OWN_FARM_NAME) {
      storageFree = this.storageFreeT;
      combine = this.ownCombineAvailable();
      backlog = Object.values(this.fields)
        .filter((f) => f.harvestReady)
        .reduce((sum, f) => sum + f.areaHa, 0);
      moisture = this.ownAvgSoilMoisture();
    } else {
      const n = this.neighbours[farmName];
      storageFree = this.neighbourStorageFreeT(farmName);
      combine = n.combineAvailable;
      // No per-field model for neighbours: a cereal-heavy farm has ripe crop of its own to
      // get in before a hail storm, otherwise no backlog.
      backlog = n.cerealHeavy && this.hailWarningActive ? n.areaHa * NEIGHBOUR_HAIL_BACKLOG_SHARE : 0;
      moisture = n.avgSoilMoisture;
    }
    return {
      farm: farmName,
      date: this.date(),
      storageFreeT: pyRound(storageFree, 1),
      combineAvailable: combine,
      ripeBacklogHa: pyRound(backlog, 1),
      avgSoilMoisturePct: pyRound(moisture, 1),
      scenario: this.scenario,
    };
  }

  /** One row per farm (ours first), for the maps and the farm strip. */
  farmsSummary() {
    return FARMS.map((farm) => {
      let row;
      if (farm.isOwn) {
        row = {
          crops: Object.values(this.fields)
            .map((f) => f.shortCrop)
            .join(", "),
          areaHa: Object.values(this.fields).reduce((sum, f) => sum + f.areaHa, 0),
          storageCapacityT: STORAGE_CAPACITY_T,
          storageFreeT: pyRound(this.storageFreeT, 1),
          combineAvailable: this.ownCombineAvailable(),
          avgSoilMoisturePct: this.ownAvgSoilMoisture(),
        };
      } else {
        const n = this.neighbours[farm.name];
        row = {
          crops: n.crops,
          areaHa: n.areaHa,
          storageCapacityT: n.storageCapacityT,
          storageFreeT: pyRound(this.neighbourStorageFreeT(farm.name), 1),
          combineAvailable: n.combineAvailable,
          avgSoilMoisturePct: pyRound(n.avgSoilMoisture, 1),
        };
      }
      return {
        id: farm.id,
        name: farm.name,
        isOwn: farm.isOwn,
        lat: farm.lat,
        lon: farm.lon,
        ...row,
        status: farmStatus(row.avgSoilMoisturePct, row.storageFreeT, row.storageCapacityT),
      };
    });
  }

  // -- history and projection, for the detail views --------------------------------------
  recordHistory() {
    for (const [name, f] of Object.entries(this.fields)) {
      this.history[name].push({
        tick: this.tick,
        date: this.date(),
        soilMoisturePct: pyRound(f.soilMoisture, 1),
        cropHealth: pyRound(f.health, 3),
        rainMm: this.weatherToday.rainMm,
        irrigationMm: 0,
        yieldEstimateT: f.yieldEstimateT,
      });
    }
  }

  #farmHistoryRow(row) {
    return {
      tick: this.tick,
      date: this.date(),
      storageFreeT: row.storageFreeT,
      avgSoilMoisturePct: row.avgSoilMoisturePct,
      combineAvailable: row.combineAvailable,
    };
  }

  recordFarmHistory() {
    for (const row of this.farmsSummary()) this.farmHistory[row.name].push(this.#farmHistoryRow(row));
  }

  /**
   * An approved plan changes silo space and combines the same day (our harvest, a delivery
   * to a neighbour's silo): rewrite today's rows so the charts match the snapshot.
   */
  refreshTodayFarmHistory() {
    for (const row of this.farmsSummary()) {
      const rows = this.farmHistory[row.name];
      if (rows.length && rows[rows.length - 1].tick === this.tick) rows[rows.length - 1] = this.#farmHistoryRow(row);
    }
  }

  /** Soil moisture over the forecast days if nobody irrigates. */
  projection(name) {
    const f = this.fields[name];
    let moisture = f.soilMoisture;
    return this.forecast.map((w, i) => {
      moisture = Math.max(0, Math.min(100, moisture + w.rainMm - w.et0Mm * f.kc));
      return { tick: this.tick + i + 1, date: dateLabel(this.tick + i + 1), projectedMoisturePct: pyRound(moisture, 1) };
    });
  }

  // -- applying an approved plan ------------------------------------------------------------
  applyAction(name, action) {
    const f = this.fields[name];
    switch (action.type) {
      case "irrigate": {
        const mm = action.mm || 0;
        f.soilMoisture = Math.min(100, f.soilMoisture + mm);
        f.lastIrrigatedTick = this.tick;
        const today = this.history[name][this.history[name].length - 1];
        today.irrigationMm = pyRound(today.irrigationMm + mm, 1);
        today.soilMoisturePct = pyRound(f.soilMoisture, 1);
        this.recentActions.push({ field: name, kind: "irrigate" });
        break;
      }
      case "spray":
        f.lastSprayedTick = this.tick;
        f.disease = Math.max(0.05, f.disease - 0.4);
        this.recentActions.push({ field: name, kind: "spray" });
        break;
      case "harvest":
      case "borrow_combine": {
        if (f.harvested) return;
        const tonnes = f.yieldEstimateT;
        f.harvested = true;
        f.harvestedT = tonnes;
        const stored = Math.min(tonnes, this.storageFreeT);
        this.storageUsedT += stored;
        this.pendingSurplusT += tonnes - stored;
        if (action.type === "harvest") {
          this.ownCombineBusy = true;
          this.recentActions.push({ field: name, kind: "harvest" });
        } else {
          this.recentActions.push({ field: name, kind: "harvest", farm: action.farm });
        }
        break;
      }
      case "deliver_to": {
        const n = Object.hasOwn(this.neighbours, action.farm ?? "") ? this.neighbours[action.farm] : null;
        if (n === null) return;
        // Never more than the plan's leftover grain, nor more than really fits in the
        // neighbour's silo (a farm agent may over-report); the rest is sold below.
        const fit = Math.max(0, n.storageCapacityT - n.storageUsedT);
        const moved = Math.min(action.tonnes || 0, this.pendingSurplusT, fit);
        n.storageUsedT += moved;
        this.pendingSurplusT -= moved;
        action.movedT = pyRound(moved, 1); // what the neighbour's notice reports
        if (moved >= SURPLUS_NOISE_T) this.recentActions.push({ field: name, kind: "deliver", farm: action.farm });
        break;
      }
      case "sow_cover_crop":
        if (f.harvested) f.coverCrop = true; // a cover crop only goes on stubble
        break;
      case "fertilize":
        f.health = Math.min(0.95, f.health + 0.02);
        break;
      default:
      // scout, defer_task: logged only, no state change
    }
  }

  applyBundle(bundle) {
    this.recentActions = [];
    // deliver_to last, so it can move whatever the plan's harvests left over.
    const steps = bundle.proposals.flatMap((p) => p.actions.map((a) => [p.field, a]));
    for (const [name, a] of steps) if (a.type !== "deliver_to") this.applyAction(name, a);
    for (const [name, a] of steps) if (a.type === "deliver_to") this.applyAction(name, a);
    if (this.pendingSurplusT >= SURPLUS_NOISE_T) {
      this.addLog("Farm", "info", `sold ${fixed(this.pendingSurplusT, 0)} t directly to the co-op at the harvest spot price`);
    }
    this.pendingSurplusT = 0;
    this.refreshTodayFarmHistory();
  }

  // -- views ----------------------------------------------------------------------------------
  fieldSnapshot(name) {
    const f = this.fields[name];
    return {
      id: name,
      routeId: FIELD_IDS[name],
      name: FIELD_NAMES[name],
      crop: f.crop,
      emoji: CROPS[f.crop].emoji,
      areaHa: f.areaHa,
      stage: f.stage,
      daysToHarvest: f.daysToHarvest,
      harvestReady: f.harvestReady,
      harvested: f.harvested,
      coverCrop: f.coverCrop,
      soilMoisturePct: pyRound(f.soilMoisture, 1),
      stressThresholdPct: f.stressThreshold,
      irrigable: f.irrigable,
      cropHealth: pyRound(f.health, 3),
      diseasePressure: pyRound(f.disease, 3),
      yieldEstimateT: f.yieldEstimateT,
      harvestWaitingDays: f.harvestWaitingDays,
      lastIrrigatedDate: f.lastIrrigatedTick === null ? null : dateLabel(f.lastIrrigatedTick),
      lastSprayedDate: f.lastSprayedTick === null ? null : dateLabel(f.lastSprayedTick),
      recentRejections: [...f.recentRejections],
      polygon: FIELD_POLYGONS[name],
    };
  }

  resourcesSnapshot() {
    return {
      waterPermitM3: this.waterPermitM3,
      waterPermitNormalM3: WATER_PERMIT_NORMAL_M3,
      workers: WORKERS,
      combine: this.ownCombineAvailable(),
      sprayer: SPRAYERS,
      storageCapacityT: STORAGE_CAPACITY_T,
      storageUsedT: pyRound(this.storageUsedT, 1),
      storageFreeT: pyRound(this.storageFreeT, 1),
    };
  }
}
