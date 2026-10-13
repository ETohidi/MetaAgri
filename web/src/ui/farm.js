// Farm level. Our own farm, seen through the farm manager's lens, opens decision first
// (concept W3): the page head asks "What should we do today?" with the weather in one line,
// five KPI tiles, the plan card at the top of the rail (approve it, or reject it with a
// reason), the field map with a compact field list, then "Why this plan", "Team log" and
// "What buyers & neighbours see" folded away. The hero flower waits behind "Show the flower".
// On a phone the plan is a bottom sheet behind a sticky "Plan waiting" bar.
//
// Every other lens sees only the farm's public status and offers; the plan, the fields and the
// log are Not shown (roles.js). A neighbouring farm shows its public status, its offers to the
// sharing network and their history. Every number here is Simulated: the farms are fictional.
//
// The page anatomy comes from page.js and the level model from levels.js, as on every level.
// district.js and field.js reuse the helpers exported in the first section.

import { FARM_BY_ID, FARM_NAMES, FARMYARD, FIELD_AGENT_NAMES, FIELD_IDS, FIELD_NAMES, FIELD_POLYGONS, FIELDS, OWN_FARM, REGION } from "../data/places.js";
import { realValue } from "../data/real.js";
import { STORAGE_HOLDBACK_T } from "../engine/farms.js";
import { html, plural, raw, utilTone } from "./dom.js";
import { levelsPanel } from "./levels.js";
import { kpiStrip, pageHead, pill, prov, sourcesFooter } from "./page.js";
import { access, DEFAULT_ROLE, notShown, notShownReason, ROLES, roleOf } from "./roles.js";
import { confidenceWord, CROP_CONDITION, fieldCondition, OPS } from "./status.js";

// =====================================================================================
// Shared helpers (also used by district.js and field.js)
// =====================================================================================

/** Route tokens (plain hash tokens, see main.js): the farm is its id, a field "<farmId>.<fieldId>". */
export const T = {
  world: "world",
  germany: "germany",
  oderbruch: REGION.id,
  farm: (id) => id,
  field: (name) => `${OWN_FARM.id}.${FIELD_IDS[name] ?? String(name).toLowerCase()}`,
};

const NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
/** Thousands separators; whole numbers without decimals, others with one ("108.5"); "–" when unknown. */
export function fmt(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "–";
  return NUM.format(Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) + 0 : n).replace("-", "−");
}
/** Tonnes are shown whole: "~324 t", "330 t free". */
export const tonnes = (v) => (Number.isFinite(Number(v)) && v !== null ? fmt(Math.round(Number(v))) : "–");
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const pct0 = (v) => `${Math.round(Number(v) || 0)}%`;
const f1 = (n) => Math.round(n * 10) / 10;
const sum = (xs, fn) => xs.reduce((n, x) => n + fn(x), 0);
const short = (name) => String(name).split(" ").slice(-1)[0];

/** The lens in use: a ROLES id (the default role while main.js has none). */
export function roleId(ctx) {
  return Object.hasOwn(ROLES, String(ctx?.role ?? "")) ? ctx.role : DEFAULT_ROLE;
}

/** The Simulated badge of the demo farms, with the seed in its tooltip. */
export function simProv(snap, label = "Simulated") {
  return prov("simulated", {
    label,
    title: `Seeded simulation of fictional demo farms (seed ${snap?.seed ?? "?"}); the same seed replays the same season.`,
  });
}

/** Badge for a real value from data/real.json: Official or Estimated, Loading or Unknown when missing. */
export function realBadge(rv, ctx) {
  if (!rv) {
    if (ctx?.dataState === "loading") return prov("unknown", { label: "Loading", title: "The statistics file is still loading" });
    return prov("unknown", { title: "Not in the loaded statistics. Shown as Unknown, never as 0" });
  }
  const kind = String(rv.kind ?? "").toLowerCase() === "estimated" ? "estimated" : "official";
  const title = [rv.source, rv.licence, rv.asOf ? `as of ${asOfText(rv.asOf)}` : ""].filter(Boolean).join(" · ");
  return prov(kind, { title });
}

/** The figure of a real value as text ("441", "123,700", "In force"); "–" when missing. */
export function realText(rv) {
  if (!rv) return "–";
  const v = rv.value;
  if (typeof v === "number") return fmt(v);
  if (typeof v === "boolean") return v ? "In force" : "Not in force";
  return cap(String(v ?? "–"));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-07-16" -> "16 Jul 2026"; years and ranges ("2025", "1991-2020") stay as they are. */
export function asOfText(asOf) {
  const m = String(asOf ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(asOf ?? "");
}

/** A sources-footer line for a real value: label, linked source, licence and date. */
export function realSource(rv) {
  const src = rv.url ? html`<a href="${rv.url}" target="_blank" rel="noopener noreferrer">${rv.source}</a>` : rv.source;
  return html`${rv.label ?? "Value"}: ${src}${rv.licence ? `, ${rv.licence}` : ""}${rv.asOf ? `, ${asOfText(rv.asOf)}` : ""}.${rv.note ? ` ${rv.note}` : ""}`;
}

/** Confidence in a word, the score in the tooltip (never a bare 0.85 on the page). */
export function confWord(c) {
  if (c === null || c === undefined || !Number.isFinite(Number(c))) return "";
  return html`<span class="farm-confword is-${confidenceWord(c)}" title="Confidence score ${Math.round(c * 100)} of 100">confidence ${confidenceWord(c)}</span>`;
}

/** Crop condition of a whole farm (GEOGLAM words), from its average soil moisture only. */
export function cropOf(row) {
  const m = Number(row?.avgSoilMoisturePct);
  if (!row || !Number.isFinite(m)) return { ...CROP_CONDITION.nodata, driver: "" };
  if (m < 35) return { ...CROP_CONDITION.poor, driver: "Dry" };
  if (m < 45) return { ...CROP_CONDITION.watch, driver: "Dry" };
  return { ...CROP_CONDITION.favourable, driver: "" };
}
export const CROP_RULE = "Crop condition from the farm's average soil moisture: Poor below 35%, Watch below 45%.";
export const conditionText = (c) => (c.driver ? `${c.label} · ${c.driver}` : c.label);

/** Our farm's operations status (OPS): blocked actions, a plan waiting, or on track. */
export function farmOps(snap) {
  const b = snap?.pendingBundle;
  if (!b) return { ...OPS.ontrack, title: "No plan is waiting for a decision" };
  const blocked = (b.safety ?? []).filter((s) => s.blocked).length;
  if (blocked) {
    return { ...OPS.blocked, title: `The safety rules blocked ${plural(blocked, "action")} in the plan for ${b.planFor}; the rest waits for the farm manager.` };
  }
  return { ...OPS.decision, title: `The plan for ${b.planFor} waits for the farm manager.` };
}

/** A farm's offer to the sharing network today, with the silo space it keeps back. */
export function offerOf(snap, name) {
  const c = snap?.nearbyCapacity?.[name];
  if (!c) return null;
  const row = (snap.farms ?? []).find((r) => r.name === name);
  const offeredT = Number(c.canShare?.storageT) || 0;
  const freeT = Number.isFinite(row?.storageFreeT) ? row.storageFreeT : offeredT;
  // The offer is the morning's report. If an approved harvest or delivery has filled the silo
  // since, only the space that is free now can be lent (never "0 t free, 140 t offered").
  const storageT = Math.max(0, Math.min(offeredT, freeT));
  return {
    combine: Number(c.canShare?.combine) || 0,
    storageT,
    offeredT,
    filledSince: storageT < offeredT,
    freeT,
    heldT: Math.max(0, freeT - storageT),
    validUntil: c.validUntil,
    confidence: c.confidence,
    note: c.note ?? "",
  };
}
/** "280 t (50 t kept back)": the offer and the reserve behind it, in one place. */
export const keptBackText = (o) =>
  o.filledSince
    ? `${tonnes(o.storageT)} t (${tonnes(o.offeredT)} t this morning, before the silo filled)`
    : `${tonnes(o.storageT)} t (${tonnes(o.heldT)} t kept back)`;
export const HOLDBACK = STORAGE_HOLDBACK_T;
export const HOLDBACK_NOTE = `Every farm keeps ${STORAGE_HOLDBACK_T} t of its free silo space for its own harvest, and half of the rest while a weather warning lasts.`;

const RING_ACTIONS = new Set(["borrow_combine", "deliver_to"]);

/** What the plan waiting for a decision asks of each neighbour, by farm name. */
export function helpAsked(snap) {
  const help = {};
  for (const p of snap?.pendingBundle?.proposals ?? []) {
    for (const a of p.actions ?? []) {
      if (!a.farm || !RING_ACTIONS.has(a.type)) continue;
      const h = (help[a.farm] ??= { borrowFor: [], deliverT: 0 });
      if (a.type === "borrow_combine") h.borrowFor.push(p.field);
      else h.deliverT += a.tonnes ?? 0;
    }
  }
  return help;
}
const fieldList = (fields) => fields.map((f) => FIELD_NAMES[f] ?? f).join(" and ");
/** "Gut Rohrdommelsee's combine for West field", "109 t into Gut Rohrdommelsee's silo". */
export function helpLines(name, h) {
  const out = [];
  if (h.borrowFor.length) out.push(`${name}'s combine for ${fieldList(h.borrowFor)}`);
  if (h.deliverT > 0) out.push(`${tonnes(h.deliverT)} t into ${name}'s silo`);
  return out;
}

/** Soil, health, disease and hail reasons a field is at risk today ([] when it is fine). */
const NEAR = 10;
const CEREALS = new Set(["winter wheat", "rapeseed"]);
const HAIL_RISK_DAYS = 4;
export function hailAtRisk(f) {
  if (f.harvested) return false;
  if (f.harvestReady) return true;
  return CEREALS.has(f.crop) && f.daysToHarvest <= HAIL_RISK_DAYS;
}
export function fieldRisks(f, snap) {
  if (!f || f.harvested) return [];
  const out = [];
  if (f.soilMoisturePct < f.stressThresholdPct) out.push("soil below the stress line");
  else if (f.soilMoisturePct < f.stressThresholdPct + NEAR) out.push("soil near the stress line");
  if (f.diseasePressure >= 0.6) out.push("high disease risk");
  if (f.cropHealth < 0.6) out.push("crop health poor");
  if (snap?.hailDate && hailAtRisk(f)) out.push(`ripe crop, hail expected ${snap.hailDate}`);
  return out;
}
export function harvestShort(f) {
  if (f.coverCrop) return "Harvested, cover crop sown";
  if (f.harvested) return "Harvested";
  if (f.harvestReady) return f.harvestWaitingDays > 0 ? `Ready, waiting ${plural(f.harvestWaitingDays, "day")}` : "Ready today";
  return `In ${plural(Math.max(0, Math.round(f.daysToHarvest)), "day")}`;
}

const GERUND = {
  irrigate: "irrigating",
  spray: "spraying",
  fertilize: "fertilizing",
  harvest: "harvesting",
  scout: "scouting",
  defer_task: "waiting on",
  sow_cover_crop: "sowing a cover crop on",
  borrow_combine: "borrowing a combine for",
  deliver_to: "delivering grain from",
};
/** Engine action names in a sentence ("irrigate for River field") as plain words. */
function plainActions(text) {
  return String(text).replace(/\b(irrigate|spray|fertilize|harvest|scout|defer_task|sow_cover_crop|borrow_combine|deliver_to) for /g, (m, t) => `${GERUND[t]} `);
}
/** A decide() error in plain words (never a stack trace). */
export function plainError(err) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const text = plainActions(message.trim()).replace(/the safety check/g, "the safety rules");
  return text || "The plan could not be decided. Please try again.";
}

/** Disease risk in a word (the twin's 0..1 pressure, also used on the field page). */
export function diseaseWord(p) {
  if (p >= 0.6) return { word: "high", tone: "crit" };
  if (p >= 0.3) return { word: "medium", tone: "warn" };
  return { word: "low", tone: "ok" };
}

/** An agent's reason in plain words: "Blight risk high (64/100)", "confidence high". */
export function plainReason(text) {
  return String(text ?? "")
    .replace(/Blight pressure (\d(?:\.\d+)?)/g, (m, p) => `Blight risk ${diseaseWord(Number(p)).word} (${Math.round(Number(p) * 100)}/100)`)
    .replace(/crop health down (\d(?:\.\d+)?)/g, (m, d) => `crop health down ${Math.round(Number(d) * 100)} points (of 100)`)
    .replace(/\(confidence ([\d.]+)\)/g, (m, c) => `(confidence ${confidenceWord(Number(c))})`);
}

/** One line of the team log in plain words: no "action(s)", no bare confidence numbers. */
const ACTOR = { "Machinery ring": "Sharing network" };
export function plainLog(e) {
  let t = String(e?.text ?? "");
  t = t.replace(/^proposed (\d+) action\(s\): /, (m, n) => (n === "0" ? "proposes nothing: " : `proposes ${plural(Number(n), "action")}: `));
  t = t.replace(
    /^can share (\d+) combine \/ ([\d.,]+) t storage until ([^()]+?) \(confidence ([\d.]+)\)\.\s*(.*)$/,
    (m, c, s, until, conf, rest) =>
      `can lend ${c === "0" ? "no combine" : "its combine"} and ${s} t of silo space until ${until} (confidence ${confidenceWord(Number(conf))}).${rest ? ` ${cap(rest)}.` : ""}`,
  );
  t = t.replace(/^compiled spare capacity from (\d+) farms$/, "collected what $1 farms can lend today");
  t = t.replace(/^(.+?): (\d+) proposals, (\d+)\/(\d+) actions cleared by the safety check$/, (m, d, p, a, b) => `plan for ${d}: ${p} field agents reported; ${a} of ${b} actions passed the safety rules`);
  t = t.replace(/ \(Noting recent rejection: (.+)\)$/, " (remembers your reason: “$1”)");
  t = t.replace(/^season reset \/ seeded \(seed \d+\)$/, "the season starts");
  t = t.replace(/\(confidence ([\d.]+)\)/g, (m, c) => `(confidence ${confidenceWord(Number(c))})`);
  t = plainActions(plainReason(t)).replace(/the safety check/g, "the safety rules");
  return t;
}
export const plainActor = (actor) => ACTOR[actor] ?? actor;

/** "Follow the farm manager": the visible entry into the farm story from any other lens. */
export function asFarmerButton(label = "Follow the farm manager") {
  return html`<button type="button" class="btn btn-primary farm-asfarm" data-action="as-farm" data-focus-key="as-farm">${label}</button>`;
}
/** Handles the "Follow the farm manager" button; true if the click was it. */
export function handleLensClick(event, ctx) {
  if (!event.target.closest?.("[data-action='as-farm']")) return false;
  if (typeof ctx.setRole === "function") ctx.setRole("farm");
  else ctx.toast?.("Choose Farm manager under Viewing as.");
  return true;
}

/** A Not shown KPI tile for a level outside the lens. */
export function hiddenTile(label, levelKey) {
  return { label, value: "–", detail: "Not shown to this role", badge: prov("notshown", { title: notShownReason(levelKey) }) };
}

// =====================================================================================
// Icons (16 x 16, currentColor; .farm-ic-cut strokes take the surface colour)
// =====================================================================================
const ICON_PATHS = {
  shield:
    '<path d="M8 1.2l5.6 2v4.3c0 3.4-2.3 6.1-5.6 7.3-3.3-1.2-5.6-3.9-5.6-7.3V3.2z" fill="currentColor"/><path class="farm-ic-cut" d="M6 6l4 4M10 6l-4 4" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
  check:
    '<circle cx="8" cy="8" r="7" fill="currentColor"/><path class="farm-ic-cut" d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  cross:
    '<circle cx="8" cy="8" r="7" fill="currentColor"/><path class="farm-ic-cut" d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" fill="none" stroke-width="1.7" stroke-linecap="round"/>',
  compass:
    '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.9 5.1L9.1 9.1 5.1 10.9 6.9 6.9z" fill="currentColor"/>',
  tractor:
    '<path d="M2.4 10.4V7.3h5.4V3.4h4.4v3.9h1.6v3.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="5" cy="11.6" r="2.7" fill="currentColor"/><circle cx="12.3" cy="12.4" r="1.9" fill="currentColor"/>',
  drop: '<path d="M8 1.5C6.3 4.4 3.8 7.2 3.8 10a4.2 4.2 0 0 0 8.4 0c0-2.8-2.5-5.6-4.2-8.5z" fill="currentColor"/>',
  wheat:
    '<path d="M8 15V4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><g fill="currentColor"><ellipse cx="8" cy="3.1" rx="1.2" ry="2"/><ellipse cx="6.2" cy="6.2" rx="1.1" ry="2" transform="rotate(-35 6.2 6.2)"/><ellipse cx="9.8" cy="6.2" rx="1.1" ry="2" transform="rotate(35 9.8 6.2)"/><ellipse cx="6.2" cy="9.6" rx="1.1" ry="2" transform="rotate(-35 6.2 9.6)"/><ellipse cx="9.8" cy="9.6" rx="1.1" ry="2" transform="rotate(35 9.8 9.6)"/></g>',
  hail: '<path d="M4.6 9.4h7a2.6 2.6 0 0 0 .2-5.2A3.6 3.6 0 0 0 4.9 4.8a2.3 2.3 0 0 0-.3 4.6z" fill="currentColor"/><g fill="currentColor"><circle cx="5.4" cy="12" r="1.1"/><circle cx="8.4" cy="13.6" r="1.1"/><circle cx="11.2" cy="11.8" r="1.1"/></g>',
  heat: '<path d="M6.6 9.3V3a1.4 1.4 0 0 1 2.8 0v6.3a3 3 0 1 1-2.8 0z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="11.8" r="1.6" fill="currentColor"/><path d="M8 11V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  person: '<circle cx="8" cy="4.6" r="2.7" fill="currentColor"/><path d="M2.6 14.6a5.4 5.4 0 0 1 10.8 0z" fill="currentColor"/>',
  barn: '<path d="M1.8 7.4L8 2.4l6.2 5V14.6H1.8z" fill="currentColor"/><path class="farm-ic-cut" d="M6 14.6v-4.2h4v4.2" fill="none" stroke-width="1.3"/>',
  leaf: '<path d="M8 15V8.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.8C8 5.2 10.4 3 14 3c0 3.6-2.4 5.8-6 5.8zM8 10.4C8 7.6 6 5.8 2.4 5.8c0 2.8 2 4.6 5.6 4.6z" fill="currentColor"/>',
  alert:
    '<path d="M8 1.5l7 12.6H1z" fill="currentColor"/><path class="farm-ic-cut" d="M8 6v3.6M8 11.6v.3" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
};

function icon(name, extra = "") {
  return raw(
    `<svg class="farm-ic farm-ic-${name}${extra ? ` ${extra}` : ""}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ""}</svg>`,
  );
}

// =====================================================================================
// Entry point
// =====================================================================================
/** Per-viewer state of the farm page. */
function farmState(ctx) {
  ctx.ui.drafts ??= {};
  ctx.ui.farm ??= {};
  const st = ctx.ui.farm;
  st.open ??= {};
  st.error ??= null;
  st.showTable ??= false;
  st.showFlower ??= false;
  st.sheetOpen ??= false;
  return st;
}

function routeFarm(route) {
  const id = route?.farmId ?? String(route?.token ?? "").split(".")[0];
  return Object.hasOwn(FARM_BY_ID, String(id)) ? FARM_BY_ID[id] : null;
}

export function render(container, ctx, { routeChanged = false } = {}) {
  const st = farmState(ctx);
  if (routeChanged) {
    st.error = null;
    st.sheetOpen = false;
  }
  const farm = routeFarm(ctx.route);
  if (!farm) {
    container.innerHTML = String(html`<div class="pg"><div class="pane"><div class="pane-body"><p>This farm is not part of the twin.</p>
      <p><a href="#${T.oderbruch}" data-focus-key="back-region">Back to the ${REGION.name}</a></p></div></div></div>`);
    container.onclick = null;
    return;
  }
  const role = roleId(ctx);
  const level = access(role, "farm");
  if (level === "none") renderHidden(container, ctx, farm);
  else if (!farm.isOwn) renderNeighbour(container, ctx, farm);
  else if (level === "full") renderOwn(container, ctx);
  else renderOwnPublic(container, ctx);
}

// =====================================================================================
// Own farm, farm manager's lens: decision first
// =====================================================================================
const ownFields = (snap) => FIELDS.map((id) => snap.fields?.[id]).filter(Boolean);

function dayWeather(w, label, snap) {
  const hail = Boolean(w.hail || (snap.hailDate && w.date === snap.hailDate));
  const what = hail ? "hail storm" : w.note === "heatwave" ? "heatwave" : w.rainMm >= 0.5 ? `${fmt(w.rainMm)} mm rain` : "dry";
  return `${label} ${Math.round(w.tempMaxC)} °C, ${what}`;
}

/** "Today 25 °C, dry · Tue 28 °C, 7.5 mm rain · Wed 27 °C, dry". */
export function weatherLine(snap) {
  const days = [["Today", snap.weatherToday], ...(snap.forecast ?? []).slice(0, 2).map((w) => [String(w.date ?? "").split(" ")[0], w])];
  return days
    .filter(([, w]) => w)
    .map(([label, w]) => dayWeather(w, label, snap))
    .join(" · ");
}

/** Water the waiting plan would use today, or what today's approved plan used. */
function waterToday(ctx) {
  const { snap, twin } = ctx;
  const used = (b) => Math.max(0, (b.resourcesBefore?.waterM3 ?? 0) - (b.resourcesAfter?.waterM3 ?? 0));
  if (snap.pendingBundle) return { m3: used(snap.pendingBundle), text: `In the plan for ${snap.pendingBundle.planFor}` };
  const approved = twin.bundles().find((b) => b.tick === snap.tick && b.status === "approved");
  if (approved) return { m3: used(approved), text: `Approved for ${approved.planFor}` };
  return { m3: 0, text: "No irrigation planned today" };
}

function fillBar(fraction, label) {
  const f = Math.max(0, Math.min(1, fraction));
  const value = Math.round(fraction * 100);
  return html`<div class="meter is-${utilTone(fraction)} farm-fill" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.max(0, value))}"
    aria-valuetext="${value}% full" aria-label="${label}"><span style="width:${(f * 100).toFixed(1)}%"></span></div>`;
}

function helpTile(snap, sim, { inside = true } = {}) {
  const asks = Object.entries(helpAsked(snap));
  if (!asks.length) {
    const detail = !inside ? "No request to the sharing network" : snap.pendingBundle ? "The plan needs nothing from the neighbours" : "No plan waiting";
    return { label: "Help needed", value: "None", detail, badge: sim };
  }
  const combine = asks.some(([, h]) => h.borrowFor.length);
  const silo = asks.some(([, h]) => h.deliverT > 0);
  return {
    label: "Help needed",
    value: combine && silo ? "Combine + silo" : combine ? "A combine" : "Silo space",
    detail: asks.flatMap(([name, h]) => helpLines(name, h)).join(" · "),
    badge: sim,
  };
}

function ownKpis(ctx) {
  const { snap } = ctx;
  const sim = simProv(snap);
  const fields = ownFields(snap);
  const risky = fields.map((f) => ({ f, why: fieldRisks(f, snap) })).filter((x) => x.why.length);
  const res = snap.resources;
  const water = waterToday(ctx);
  const cut = res.waterPermitM3 < res.waterPermitNormalM3;
  const harvested = fields.filter((f) => f.harvested).length;
  const next = fields
    .filter((f) => !f.harvested)
    .sort((a, b) => Number(b.harvestReady) - Number(a.harvestReady) || a.daysToHarvest - b.daysToHarvest)[0];
  const offer = offerOf(snap, OWN_FARM.name);
  const fill = res.storageCapacityT ? (res.storageCapacityT - res.storageFreeT) / res.storageCapacityT : 0;
  return kpiStrip(
    [
      {
        label: "Fields at risk",
        value: risky.length,
        unit: `of ${fields.length}`,
        detail: risky.length ? risky.map((x) => `${x.f.id}: ${x.why[0]}`).join(" · ") : "All fields comfortable",
        badge: sim,
        alert: risky.some((x) => x.f.soilMoisturePct < x.f.stressThresholdPct || x.f.cropHealth < 0.6),
      },
      {
        label: "Water today vs permit",
        value: fmt(water.m3),
        unit: `of ${fmt(res.waterPermitM3)} m³`,
        detail: `${water.text}${cut ? ` · permit cut from ${fmt(res.waterPermitNormalM3)} m³ in the heatwave` : ""}`,
        badge: sim,
        alert: cut,
      },
      {
        label: "Harvest progress",
        value: harvested,
        unit: `of ${plural(fields.length, "field")}`,
        detail: next ? `Next: ${next.name}, ${harvestShort(next).toLowerCase()}` : "All fields harvested",
        badge: sim,
      },
      {
        label: "Silo free",
        value: tonnes(res.storageFreeT),
        unit: `of ${tonnes(res.storageCapacityT)} t`,
        detail: !offer
          ? "No offer to the neighbours yet"
          : offer.filledSince
            ? `Can lend ${tonnes(offer.storageT)} t now; this morning's offer was ${tonnes(offer.offeredT)} t`
            : `${keptBackText(offer)} offered to neighbours`,
        badge: sim,
        alert: fill > 0.95,
        extra: fillBar(fill, `Silo ${Math.round(fill * 100)}% full`),
      },
      helpTile(snap, sim),
    ],
    { label: `Key figures for ${OWN_FARM.name}` },
  );
}

function renderOwn(container, ctx) {
  const { snap, twin } = ctx;
  const st = farmState(ctx);
  const b = snap.pendingBundle;
  const ops = farmOps(snap);
  const sheet = Boolean(b);
  const open = sheet && st.sheetOpen;
  container.innerHTML = String(html`
    <div class="pg farm-pg${sheet ? " has-sheet" : ""}${open ? " is-sheet-open" : ""}">
      ${pageHead({
        level: "Farm",
        place: `${OWN_FARM.name} (fictional) · ${REGION.name} · viewing as ${roleOf("farm").name}`,
        title: "What should we do today?",
        question: weatherLine(snap),
        sees: "every field, plan and log on this farm; the neighbours only as their offers. Never leaves the farm: finances, prices, raw field and machine data.",
        status: { text: ops.label, tone: ops.tone, title: ops.title },
        fresh: { badge: simProv(snap), text: `Demo day ${snap.date}` },
      })}
      ${ownKpis(ctx)}
      <div class="pg-grid">
        <div class="pg-main">
          ${fieldsPane(ctx)}
          ${whyFold(ctx, b)}
          ${logFold(ctx, twin.log())}
          ${noticesFold(ctx, twin.notices())}
        </div>
        <aside class="pg-rail" aria-label="Plan and sharing">
          ${b ? planCard(ctx, b) : noPlanCard(twin)}
          ${sharedWithMe(ctx)}
          ${sharedByMe(ctx)}
        </aside>
      </div>
      ${levelsPanel("farm", { place: OWN_FARM.name, links: levelLinks(), role: roleId(ctx) })}
      ${ownSources(ctx)}
      ${open ? html`<div class="farm-sheet-backdrop" data-action="sheet-close" aria-hidden="true"></div>` : ""}
      ${sheet && !open ? sheetBar(b) : ""}
    </div>
  `);

  container.onclick = (event) => onOwnClick(event, ctx, container);
  container.onchange = (event) => onDraftEdit(event, ctx);
  container.oninput = (event) => onDraftEdit(event, ctx);
  container.onsubmit = (event) => onRejectSubmit(event, ctx);
  container.onkeydown = (event) => {
    if (event.key === "Escape" && farmState(ctx).sheetOpen) closeSheet(ctx, container);
  };
}

const levelLinks = () => ({ district: T.oderbruch, farm: T.farm(OWN_FARM.id), field: T.field(FIELDS[0]) });

// -- the fields: map, list and (on request) the flower ----------------------------------------
function fieldsPane(ctx) {
  const { snap } = ctx;
  const st = farmState(ctx);
  return html`
    <section class="pane farm-fields" aria-labelledby="farm-fields-title">
      <header class="pane-head">
        <div>
          <h2 id="farm-fields-title">Fields today</h2>
          <p>Fictional field shapes. Colour: soil moisture against each crop's stress line. Select a field to open it.</p>
        </div>
        <div class="farm-head-side">
          <button type="button" class="btn btn-ghost farm-flower-toggle" data-action="toggle-flower" data-focus-key="toggle-flower" aria-pressed="${st.showFlower}">
            ${st.showFlower ? "Hide the flower" : "Show the flower"}
          </button>
          ${simProv(snap)}
        </div>
      </header>
      <div class="pane-body farm-fields-body${st.showFlower ? " with-flower" : ""}">
        <figure class="farm-map">${fieldMap(snap)}</figure>
        ${st.showFlower ? html`<figure class="farm-hero">${heroSvg(ctx)}<figcaption class="farm-caption">${heroCaption(ctx)}</figcaption></figure>` : ""}
        <div class="farm-flist-wrap table-wrap">${fieldTable(snap)}</div>
      </div>
      <footer class="pane-foot">${fieldLegend(snap, st.showFlower)}</footer>
    </section>
  `;
}

function fieldState(f) {
  if (f.coverCrop) return "cover";
  if (f.harvested) return "harvested";
  if (f.soilMoisturePct < f.stressThresholdPct) return "stress";
  if (f.soilMoisturePct < f.stressThresholdPct + NEAR) return "near";
  return "ok";
}

const STATE_LEGEND = { stress: "Below the stress line", near: "Near it", ok: "Comfortable", harvested: "Harvested", cover: "Cover crop" };

function fieldLegend(snap, flower) {
  return html`<div class="legend farm-legend" role="list" aria-label="Colour key">
    ${["stress", "near", "ok", "harvested", "cover"].map(
      (s) => html`<span role="listitem"><i class="swatch farm-sw is-${s}" aria-hidden="true"></i>${STATE_LEGEND[s]}</span>`,
    )}
    ${snap.hailDate ? html`<span role="listitem"><i class="swatch farm-sw is-hail" aria-hidden="true"></i>Ripe crop at risk from the hail</span>` : ""}
    ${flower ? html`<span role="listitem"><i class="farm-sw-thorn" aria-hidden="true"></i>Thorn: an action the safety rules blocked today</span>` : ""}
  </div>`;
}

function fieldSummary(f, snap) {
  const status = f.coverCrop ? "harvested, cover crop sown" : f.harvested ? "harvested" : `soil moisture ${pct0(f.soilMoisturePct)}, stress below ${pct0(f.stressThresholdPct)}`;
  const risk = snap.hailDate && hailAtRisk(f) ? ", ripe crop at risk from the hail" : "";
  return `${f.name}: ${f.crop}, ${fmt(f.areaHa)} ha, ${status}${risk}`;
}

function moistureBar(f) {
  const state = fieldState(f);
  const m = Math.max(0, Math.min(100, f.soilMoisturePct));
  const t = Math.max(0, Math.min(100, f.stressThresholdPct));
  return html`<div class="farm-moist" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m)}"
    aria-valuetext="${pct0(f.soilMoisturePct)} soil moisture, stress below ${pct0(f.stressThresholdPct)}" aria-label="${f.name} soil moisture">
    <span class="farm-moist-fill is-${state}" style="width:${m.toFixed(1)}%"></span>
    <span class="farm-moist-tick" style="left:${t.toFixed(1)}%"></span>
  </div>`;
}

function fieldTable(snap) {
  return html`<table class="t farm-flist">
    <caption class="sr-only">Our fields: crop, soil moisture against the stress line, harvest and condition</caption>
    <thead><tr>
      <th scope="col">Field</th><th scope="col">Soil moisture vs stress line</th><th scope="col" class="hide-s">Harvest</th><th scope="col" class="stcol">Condition</th>
    </tr></thead>
    <tbody>
      ${ownFields(snap).map((f) => {
        const c = fieldCondition(f);
        const why = fieldRisks(f, snap);
        const key = FIELD_IDS[f.id];
        const condition = pill(c.label, c.tone, { title: why.length ? cap(why.join(", ")) : "No risk today" });
        return html`<tr data-go="${T.field(f.id)}">
          <td class="farm-fl-name"><a href="#${T.field(f.id)}" data-focus-key="field-${key}">${f.name}</a>
            <small>${f.crop} · ${fmt(f.areaHa)} ha</small><span class="show-s"><small>Harvest: ${harvestShort(f).toLowerCase()}</small>${condition}</span></td>
          <td class="farm-fl-moist">${
            f.harvested
              ? html`<span class="faint">${f.coverCrop ? "Cover crop sown" : "Off the field"}</span>`
              : html`${moistureBar(f)}<small><b>${pct0(f.soilMoisturePct)}</b> · stress below ${pct0(f.stressThresholdPct)}</small>`
          }</td>
          <td class="farm-fl-harvest hide-s">${harvestShort(f)}</td>
          <td class="stcol">${condition}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

// Field map: the three field polygons and the farmyard, projected with d3 (Mercator fitted to them).
const MAP = { w: 360, h: 300, pad: 20 };

function validRing(ring) {
  if (!Array.isArray(ring)) return null;
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return pts.length >= 3 ? pts : null;
}
function closed(pts) {
  const [a, b] = [pts[0], pts.at(-1)];
  return a[0] === b[0] && a[1] === b[1] ? pts : [...pts, a];
}

/** [lon, lat] -> [x, y]. Without d3 (the CDN did not load) an equirectangular fit, the same at field scale. */
function mapProjection(points) {
  const extent = [
    [MAP.pad, MAP.pad],
    [MAP.w - MAP.pad, MAP.h - MAP.pad],
  ];
  const d3 = globalThis.d3;
  if (d3 && typeof d3.geoMercator === "function") {
    const projection = d3.geoMercator().fitExtent(extent, { type: "MultiPoint", coordinates: points });
    return (lonLat) => projection(lonLat);
  }
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[0] * kx);
  const ys = points.map((p) => -p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((extent[1][0] - extent[0][0]) / (x1 - x0 || 1), (extent[1][1] - extent[0][1]) / (y1 - y0 || 1));
  const ox = (MAP.w - (x1 - x0) * s) / 2;
  const oy = (MAP.h - (y1 - y0) * s) / 2;
  return ([lon, lat]) => [ox + (lon * kx - x0) * s, oy + (-lat - y0) * s];
}

function scanSegments(ring, y) {
  const xs = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i], xs[i + 1]]);
  return segs;
}

/** Stubble rows (harvested) or seedling dots (cover crop), so those states never rely on colour. */
function plotTexture(state, ring) {
  if (state !== "harvested" && state !== "cover") return "";
  const ys = ring.map((p) => p[1]);
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const step = state === "harvested" ? 6 : 8;
  let d = "";
  for (let y = top + step / 2; y < bottom - 2; y += step) {
    for (const [a, b] of scanSegments(ring, y)) {
      if (state === "harvested") {
        if (b - a > 6) d += `M${f1(a + 3)} ${f1(y)}H${f1(b - 3)}`;
      } else {
        for (let x = a + 4; x < b - 3; x += step) d += `M${f1(x)} ${f1(y)}h0.01`;
      }
    }
  }
  return d ? html`<path class="farm-texture is-${state}" d="${d}"></path>` : "";
}

function fieldMap(snap) {
  const fields = ownFields(snap);
  const rings = Object.fromEntries(fields.map((f) => [f.id, closed(validRing(f.polygon) ?? FIELD_POLYGONS[f.id])]));
  const yardLonLat = [FARMYARD.lon, FARMYARD.lat];
  const project = mapProjection([...Object.values(rings).flat(), yardLonLat]);
  const [yx, yy] = project(yardLonLat);
  const hail = Boolean(snap.hailDate);

  const plots = fields.map((f) => {
    const ring = rings[f.id].map(project);
    const corners = ring.slice(0, -1);
    const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
    const state = fieldState(f);
    const atRisk = hail && hailAtRisk(f);
    const second = state === "harvested" ? "harvested" : state === "cover" ? "cover crop" : pct0(f.soilMoisturePct);
    const d = `M${corners.map((p) => `${f1(p[0])},${f1(p[1])}`).join("L")}Z`;
    return {
      cx,
      cy,
      markup: html`
        <a class="farm-plot-link" href="#${T.field(f.id)}" aria-label="${fieldSummary(f, snap)}. Open the field." data-focus-key="plot-${FIELD_IDS[f.id]}">
          <title>${fieldSummary(f, snap)}</title>
          <path class="farm-plot is-${state}${atRisk ? " is-hail-risk" : ""}" d="${d}"></path>
          ${plotTexture(state, ring)}
          <text class="farm-plot-name on-${state}" x="${f1(cx)}" y="${f1(cy - 2)}" text-anchor="middle">${f.id}</text>
          <text class="farm-plot-val on-${state}" x="${f1(cx)}" y="${f1(cy + 12)}" text-anchor="middle">${second}</text>
        </a>
      `,
    };
  });

  // 500 m scale bar along the parallel through the farmyard.
  const dLon = 0.5 / (111.32 * Math.cos((FARMYARD.lat * Math.PI) / 180));
  const barLen = project([FARMYARD.lon + dLon, FARMYARD.lat])[0] - yx;
  const bx = MAP.pad - 10;
  const by = MAP.h - 10;

  return html`
    <svg class="farm-map-svg" viewBox="0 0 ${MAP.w} ${MAP.h}" role="group" aria-label="Field map of ${OWN_FARM.name} (fictional shapes)">
      <rect class="farm-map-bg" width="${MAP.w}" height="${MAP.h}"></rect>
      <g class="farm-tracks" aria-hidden="true">${plots.map((p) => html`<path d="M${f1(yx)} ${f1(yy)}L${f1(p.cx)} ${f1(p.cy)}"></path>`)}</g>
      ${plots.map((p) => p.markup)}
      <g class="farm-yard" role="img" aria-label="Farmyard and silo">
        <title>Farmyard and silo</title>
        <path class="farm-yard-mark" d="M${f1(yx - 7)} ${f1(yy + 6)}V${f1(yy - 1)}L${f1(yx)} ${f1(yy - 8)}L${f1(yx + 7)} ${f1(yy - 1)}V${f1(yy + 6)}Z"></path>
        <text class="farm-map-label" x="${f1(yx)}" y="${f1(yy + 20)}" text-anchor="middle">Farmyard</text>
      </g>
      <g class="farm-scale" aria-hidden="true">
        <path d="M${f1(bx)} ${f1(by - 5)}V${f1(by)}H${f1(bx + barLen)}V${f1(by - 5)}" fill="none"></path>
        <text x="${f1(bx)}" y="${f1(by - 9)}">500 m</text>
      </g>
      <g class="farm-north" aria-hidden="true">
        <path d="M${MAP.w - 18} 10l6 14-6-3.5-6 3.5z"></path>
        <text x="${MAP.w - 18}" y="38" text-anchor="middle">N</text>
      </g>
    </svg>
  `;
}

// -- the hero flower (behind "Show the flower"): one petal per field --------------------------
const PULSE_MS = 1300;
const SHAKE_MS = 500;
const PROPOSE_MS = 2400;
const GRAIN_MS = 1400;
const DROP_MS = 1200;
const MIST_MS = 1400;
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`;
const HERO = { w: 260, h: 260, cx: 130, cy: 112, r: 34, len: [44, 72], wid: [28, 42], stemBottom: 240, maxThorns: 6, deliverX: 252 };
const PETAL_ANGLE = { North: 0, River: 120, West: 240 }; // degrees clockwise from up, as on the map
const FALLBACK_EMOJI = { "winter wheat": "🌾", rapeseed: "🌼", potatoes: "🥔" };

function blocksToday(ctx) {
  return ctx.twin.log().filter((e) => e.level === "block" && e.tick === ctx.snap.tick).length;
}

function heroCaption(ctx) {
  const approved = approvedToday(ctx.snap.recentActions ?? []);
  const blocks = blocksToday(ctx);
  return html`<span>${approved ? `Approved today: ${approved}.` : "Nothing approved yet today."}</span>
    <span>${blocks ? `The safety rules blocked ${plural(blocks, "action")} today: one thorn each.` : "No safety-rule blocks today."}</span>`;
}

function approvedToday(actions) {
  const seen = new Set();
  for (const a of actions) {
    const where = FIELD_NAMES[a.field] ?? a.field;
    const text = { harvest: `harvest on ${where}`, irrigate: `irrigation on ${where}`, spray: `spraying on ${where}`, deliver: `grain to ${a.farm ?? "a neighbour"}` }[a.kind];
    if (text) seen.add(text);
  }
  return [...seen].join(", ");
}

function petalGeometry(field, area, maxArea) {
  const k = maxArea > 0 ? Math.sqrt(Math.max(0, area) / maxArea) : 0;
  const len = HERO.len[0] + (HERO.len[1] - HERO.len[0]) * k;
  const wid = HERO.wid[0] + (HERO.wid[1] - HERO.wid[0]) * k;
  const dist = HERO.r * 0.55 + len / 2;
  const angle = PETAL_ANGLE[field] ?? 0;
  const a = (angle * Math.PI) / 180;
  return { len, wid, dist, angle, cx: HERO.cx + Math.sin(a) * dist, cy: HERO.cy - Math.cos(a) * dist };
}

function petalTexture(state, g) {
  const rx = g.wid / 2 - 3;
  const ry = g.len / 2 - 3;
  const halfWidth = (dy) => rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2));
  let d = "";
  if (state === "harvested") {
    for (let dy = -ry + 4; dy <= ry - 4; dy += 5.5) {
      const hw = halfWidth(dy) - 1;
      if (hw > 2) d += `M${f1(-hw)} ${f1(-g.dist + dy)}H${f1(hw)}`;
    }
  } else if (state === "cover") {
    for (let dy = -ry + 4; dy <= ry - 4; dy += 6) {
      const hw = halfWidth(dy) - 2;
      for (let dx = -Math.floor(hw / 6) * 6; dx <= hw; dx += 6) d += `M${f1(dx)} ${f1(-g.dist + dy)}h0.01`;
    }
  }
  return d ? html`<path class="farm-texture is-${state}" d="${d}"></path>` : "";
}

function petalSvg(f, g, snap, proposed) {
  const state = fieldState(f);
  const stressed = state === "stress";
  const atRisk = Boolean(snap.hailDate) && hailAtRisk(f);
  const isProposed = !stressed && proposed.has(f.id);
  const value = state === "harvested" ? "harvested" : state === "cover" ? "cover crop" : pct0(f.soilMoisturePct);
  const e = { cy: f1(-g.dist), rx: f1(g.wid / 2), ry: f1(g.len / 2) };
  return html`
    <a class="farm-petal-link" href="#${T.field(f.id)}" aria-label="${fieldSummary(f, snap)}. Open the field." data-focus-key="petal-${FIELD_IDS[f.id]}">
      <title>${fieldSummary(f, snap)}</title>
      <g class="farm-petal-g${atRisk ? " is-shaking" : ""}"${atRisk ? raw(` style="${phase(SHAKE_MS)}"`) : ""}>
        <g transform="translate(${HERO.cx},${HERO.cy}) rotate(${g.angle})">
          ${stressed ? html`<ellipse class="farm-petal-halo" cx="0" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" style="${phase(PULSE_MS)}"></ellipse>` : ""}
          <ellipse class="farm-petal is-${state}${atRisk ? " is-hail-risk" : ""}${isProposed ? " is-proposed" : ""}" cx="0" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}"${
            isProposed ? raw(` style="${phase(PROPOSE_MS)}"`) : ""
          }></ellipse>
          ${petalTexture(state, g)}
        </g>
        <text class="farm-petal-emoji" x="${f1(g.cx)}" y="${f1(g.cy - 4)}" text-anchor="middle">${f.emoji || FALLBACK_EMOJI[f.crop] || ""}</text>
        <text class="farm-petal-name on-${state}" x="${f1(g.cx)}" y="${f1(g.cy + 7)}" text-anchor="middle">${f.id}</text>
        <text class="farm-petal-val on-${state}${state === "harvested" || state === "cover" ? " is-small" : ""}" x="${f1(g.cx)}" y="${f1(g.cy + 17)}" text-anchor="middle">${value}</text>
      </g>
    </a>
  `;
}

function thornsSvg(count) {
  if (!count) return "";
  const thorns = [];
  for (let i = 0; i < Math.min(count, HERO.maxThorns); i++) {
    const y = HERO.cy + HERO.r + 14 + i * 12;
    if (y > HERO.stemBottom - 6) break;
    const tip = HERO.cx + (i % 2 === 0 ? 11 : -11);
    thorns.push(html`<polygon class="farm-thorn" points="${HERO.cx},${y - 4} ${tip},${y} ${HERO.cx},${y + 4}"></polygon>`);
  }
  const extra = count - thorns.length;
  return html`<g class="farm-thorns" role="img" aria-label="${plural(count, "action")} blocked by the safety rules today">
    <title>${plural(count, "action")} blocked by the safety rules today</title>
    ${thorns}
    ${extra > 0 ? html`<text class="farm-thorn-more" x="${HERO.cx}" y="${HERO.stemBottom + 14}" text-anchor="middle">+${extra} more</text>` : ""}
  </g>`;
}

function actionMarks(actions, geo) {
  return actions.slice(0, 6).map((a) => {
    const g = geo[a.field];
    if (a.kind === "harvest" && g) {
      return html`<circle class="farm-grain" cx="${f1(g.cx)}" cy="${f1(g.cy)}" r="4" style="--dx:${f1(HERO.cx - g.cx)}px;--dy:${f1(HERO.cy - g.cy)}px;${phase(GRAIN_MS)}"></circle>`;
    }
    if (a.kind === "irrigate" && g) {
      return html`<g transform="translate(${f1(g.cx)},${f1(g.cy - 30)})"><path class="farm-drop" style="${phase(DROP_MS)}" d="M0 -7C-2 -3.6 -4.5 -1 -4.5 2a4.5 4.5 0 0 0 9 0C4.5 -1 2 -3.6 0 -7z"></path></g>`;
    }
    if (a.kind === "spray" && g) return html`<circle class="farm-mist" cx="${f1(g.cx)}" cy="${f1(g.cy)}" r="18" style="${phase(MIST_MS)}"></circle>`;
    if (a.kind === "deliver") {
      return html`<circle class="farm-grain" cx="${HERO.cx}" cy="${HERO.cy}" r="4" style="--dx:${HERO.deliverX - HERO.cx}px;--dy:0px;${phase(GRAIN_MS)}"></circle>`;
    }
    return "";
  });
}

function heroSvg(ctx) {
  const { snap } = ctx;
  const fields = ownFields(snap);
  const maxArea = Math.max(1, ...fields.map((f) => f.areaHa || 0));
  const geo = Object.fromEntries(fields.map((f) => [f.id, petalGeometry(f.id, f.areaHa, maxArea)]));
  const proposed = new Set(snap.pendingBundle ? (snap.recentProposals ?? []) : []);
  const [dayName = "", ...rest] = String(snap.date ?? "").split(" ");
  return html`
    <svg class="farm-hero-svg" viewBox="0 0 ${HERO.w} ${HERO.h}" role="group" aria-label="The farm as a flower: one petal per field">
      <line class="farm-stem" x1="${HERO.cx}" y1="${HERO.cy + HERO.r}" x2="${HERO.cx}" y2="${HERO.stemBottom}" aria-hidden="true"></line>
      <path class="farm-ground" d="M${HERO.cx - 44} ${HERO.stemBottom}H${HERO.cx + 44}" aria-hidden="true"></path>
      ${thornsSvg(blocksToday(ctx))}
      ${fields.map((f) => petalSvg(f, geo[f.id], snap, proposed))}
      <g class="farm-centre" aria-hidden="true">
        <circle class="farm-centre-disc" cx="${HERO.cx}" cy="${HERO.cy}" r="${HERO.r}"></circle>
        <text class="farm-centre-day" x="${HERO.cx}" y="${HERO.cy - 6}" text-anchor="middle">${dayName}</text>
        <text class="farm-centre-date" x="${HERO.cx}" y="${HERO.cy + 10}" text-anchor="middle">${rest.join(" ")}</text>
      </g>
      <g class="farm-actions" aria-hidden="true">${actionMarks(snap.recentActions ?? [], geo)}</g>
    </svg>
  `;
}

// -- plan card (top of the rail): decision first ------------------------------------------------
const OTHER_REASON = "Other (type a reason)";
const REJECT_REASONS = [
  "Not enough workers for this",
  "Soil too wet to drive on",
  "Wait for better weather",
  "Wrong priority order",
  "A neighbour farm should help with this",
  OTHER_REASON,
];
const STATUS_TONE = { approved: "ok", rejected: "crit", expired: "mute", pending: "warn" };
const STATUS_LABEL = { approved: "Approved", rejected: "Rejected", expired: "Expired", pending: "Waiting" };

function draftFor(ctx, bundleId) {
  return ctx.ui.drafts[bundleId] ?? { choice: REJECT_REASONS[0], custom: "" };
}
function reasonOf(draft) {
  return draft.choice === OTHER_REASON ? draft.custom.trim() : draft.choice;
}

/** Plain words for an action the safety rules blocked (blocked actions have no plan row). */
function actionLabel(a) {
  switch (a?.type) {
    case "irrigate":
      return a.mm != null ? `Irrigate ${fmt(a.mm)} mm` : "Irrigate";
    case "spray":
      return a.product ? `Spray ${a.product}` : "Spray";
    case "fertilize":
      return a.kgNHa != null ? `Fertilize ${fmt(a.kgNHa)} kg N/ha` : "Fertilize";
    case "borrow_combine":
      return a.farm ? `Harvest with ${a.farm}'s combine` : "Borrow a neighbour's combine";
    case "deliver_to":
      return `Deliver ${tonnes(a.tonnes)} t to ${a.farm || "a neighbour"}`;
    case "harvest":
      return "Harvest";
    case "scout":
      return "Scout";
    case "defer_task":
      return "Wait";
    case "sow_cover_crop":
      return "Sow a cover crop";
    default:
      return cap(String(a?.type ?? "action").replaceAll("_", " "));
  }
}

/** Who hears about the plan if it is approved, per audience (as the twin's notices do). */
function audiences(b) {
  const counts = new Map();
  const add = (who) => counts.set(who, (counts.get(who) ?? 0) + 1);
  for (const p of b.proposals ?? []) {
    for (const a of p.actions ?? []) {
      if (a.type === "harvest") add("buyers");
      else if (a.type === "borrow_combine") {
        add("buyers");
        if (a.farm) add(a.farm);
      } else if (a.type === "deliver_to" && a.farm) add(a.farm);
      else if (a.type === "spray") add("beekeepers & neighbours");
      else if (["irrigate", "sow_cover_crop", "fertilize"].includes(a.type)) add("neighbours");
    }
  }
  return [...counts].map(([who, n]) => `${who} (${n})`).join(", ");
}

/**
 * What a field agent took on board, in its own words: a water amount fitted to a cut permit, and
 * the farm manager's last rejection reason. This is the visible proof that feedback changes the plan.
 */
function agentNotes(b, field) {
  const notes = [];
  for (const p of b?.proposals ?? []) {
    if (p.field !== field) continue;
    const text = String(p.rationale ?? "");
    const fit = text.match(/fitted to (today's [\d,.]+ m³ water permit)/);
    if (fit) notes.push(`Fitted to ${fit[1]}.`);
    const rej = text.match(/\(Noting recent rejection: (.+)\)$/);
    if (rej) notes.push(`Remembers your reason: “${rej[1]}”.`);
  }
  return [...new Set(notes)].join(" ");
}

function planRow(b, r, i) {
  const ring = RING_ACTIONS.has(r.actionType);
  const what = r.what === "Scout field" ? "Scout" : r.what;
  const uses = r.resources && r.resources !== "—" ? r.resources : "";
  const notes = ring ? "" : agentNotes(b, r.field);
  return html`<li class="farm-pa${ring ? " is-ring" : ""}" title="${plainReason(r.reason)}">
    <span class="farm-pa-n" aria-hidden="true">${i + 1}</span>
    <div>
      <div class="farm-pa-top"><b>${what}</b> <span class="farm-pa-where">${FIELD_NAMES[r.field] ?? r.field}</span>${ring ? html` <span class="farm-pa-tag">sharing network</span>` : ""}</div>
      <div class="farm-pa-sub">${uses ? html`<span>${uses}</span> · ` : ""}${confWord(r.confidence)}</div>
      ${notes ? html`<div class="farm-pa-note">${notes}</div>` : ""}
    </div>
  </li>`;
}

function resourceDelta(b) {
  const before = b.resourcesBefore ?? {};
  const after = b.resourcesAfter ?? {};
  const items = [
    { key: "waterM3", label: "Water", unit: " m³" },
    { key: "workers", label: "Workers", unit: "" },
    { key: "combine", label: "Combine", unit: "" },
    { key: "sprayer", label: "Sprayer", unit: "" },
    { key: "storageFreeT", label: "Silo free", unit: " t" },
  ].filter(({ key }) => Number.isFinite(before[key]) && Number.isFinite(after[key]) && Math.abs(after[key] - before[key]) >= 0.05);
  if (!items.length) return html`<p class="farm-delta-none">Uses no water, workers or machines.</p>`;
  return html`<dl class="farm-delta" aria-label="Available today, and what is left if you approve">
    ${items.map(({ key, label, unit }) => {
      const show = key === "storageFreeT" ? tonnes : fmt;
      return html`<div><dt>${label}</dt><dd><span class="num">${show(before[key])} → ${show(after[key])}${unit}</span></dd></div>`;
    })}
  </dl>`;
}

function blockedLines(blocked) {
  return html`<ul class="farm-blocked">
    ${blocked.map(
      (s) => html`<li>${icon("shield")}<div><b>${actionLabel(s.action)}</b> on ${FIELD_NAMES[s.field] ?? s.field}<br /><span class="farm-rule">${s.rule ?? "Blocked by a safety rule."}</span></div></li>`,
    )}
  </ul>`;
}

function planCard(ctx, b) {
  const st = farmState(ctx);
  const draft = draftFor(ctx, b.id);
  const reason = reasonOf(draft);
  const other = draft.choice === OTHER_REASON;
  const safety = b.safety ?? [];
  const blocked = safety.filter((s) => s.blocked);
  const error = st.error?.bundleId === b.id ? st.error.message : "";
  const rows = b.planRows ?? [];
  const told = audiences(b);
  const conf = b.overallConfidence;
  const safetyText = !safety.length
    ? "Safety rules: nothing to check"
    : blocked.length
      ? `Safety rules: ${safety.length - blocked.length} of ${safety.length} OK, ${blocked.length} blocked`
      : `Safety rules: ${safety.length} of ${safety.length} OK`;
  return html`
    <section class="pane pane-req farm-plan is-sheet" id="requests" aria-labelledby="farm-plan-title">
      <header class="pane-head">
        <div>
          <h2 id="farm-plan-title" tabindex="-1">Plan for ${b.planFor}</h2>
          <p>From the field agents and the Coordinator: ${rows.length ? plural(rows.length, "action") : "no field work"}</p>
        </div>
        <div class="farm-head-side">
          ${simProv(ctx.snap)}
          ${pill("Needs you", "warn", { title: "Approve or reject before the next day starts" })}
          <button type="button" class="btn btn-ghost farm-sheet-close" data-action="sheet-close" data-focus-key="sheet-close" aria-label="Close the plan">Close</button>
        </div>
      </header>
      <div class="pane-body farm-plan-body">
        ${rows.length ? html`<ol class="farm-pa-list" aria-label="Proposed actions">${rows.map((r, i) => planRow(b, r, i))}</ol>` : html`<p class="muted">No field work proposed for this day.</p>`}
        <p class="farm-safety${blocked.length ? " is-blocked" : ""}">${icon(blocked.length ? "shield" : "check")}<span>${safetyText}</span></p>
        ${blocked.length ? blockedLines(blocked) : ""}
        ${resourceDelta(b)}
        ${conf !== null && conf !== undefined && conf < 0.5 ? html`<p class="farm-review">${icon("alert")}<span>Low confidence in at least one action: review carefully.</span></p>` : ""}
        <div class="farm-decide">
          ${error ? html`<p class="farm-plan-error" role="alert">${icon("shield")}<span>${error}</span></p>` : ""}
          <button type="button" class="btn btn-primary farm-approve" data-action="approve" data-bundle="${b.id}" data-focus-key="approve-${b.id}">Approve plan</button>
          <form class="farm-reject" data-reject="${b.id}">
            <label class="farm-label" for="farm-reject-reason-${b.id}">Or reject, with a reason for the field agents</label>
            <select class="select" id="farm-reject-reason-${b.id}" data-draft="choice" data-bundle="${b.id}" data-focus-key="reason-${b.id}">
              ${REJECT_REASONS.map((r) => html`<option value="${r}"${r === draft.choice ? raw(" selected") : ""}>${r}</option>`)}
            </select>
            <button type="submit" class="btn btn-danger" data-focus-key="reject-${b.id}"${reason ? "" : raw(" disabled")}>Reject</button>
            <input class="input" id="farm-reject-custom-${b.id}" data-draft="custom" data-bundle="${b.id}" data-focus-key="custom-${b.id}" type="text"
              maxlength="200" autocomplete="off" placeholder="Type a reason" aria-label="Your reason"
              value="${draft.custom}"${other ? "" : raw(" hidden")} />
          </form>
        </div>
        <p class="farm-told">${told ? `If you approve, they are told: ${told}.` : "If you approve, nobody outside the farm needs to be told."}</p>
      </div>
    </section>
  `;
}

function noPlanCard(twin) {
  const decided = twin
    .bundles()
    .filter((b) => b.status !== "pending")
    .slice(0, 3);
  return html`
    <section class="pane pane-req farm-plan" id="requests" aria-labelledby="farm-plan-title">
      <header class="pane-head">
        <div><h2 id="farm-plan-title" tabindex="-1">No plan is waiting</h2><p>The field agents propose the next one when the next day starts.</p></div>
        ${pill(OPS.ontrack.label, OPS.ontrack.tone)}
      </header>
      ${
        decided.length
          ? html`<div class="pane-body"><h3 class="farm-subhead">Recent plans</h3><ul class="farm-history">
              ${decided.map(
                (b) => html`<li>
                  <span class="num">${b.planFor}</span>
                  ${pill(STATUS_LABEL[b.status] ?? b.status, STATUS_TONE[b.status] ?? "mute")}
                  ${b.status === "rejected" && b.reason ? html`<span class="farm-history-reason">“${b.reason}”</span>` : ""}
                </li>`,
              )}
            </ul></div>`
          : ""
      }
    </section>
  `;
}

function sheetBar(b) {
  const n = (b.planRows ?? []).length;
  return html`<button type="button" class="farm-sheetbar" data-action="sheet-open" data-focus-key="sheet-open" aria-controls="requests" aria-expanded="false">
    <span class="farm-sheetbar-dot" aria-hidden="true"></span>
    <span class="farm-sheetbar-text">Plan waiting · ${n ? plural(n, "action") : "no actions"}</span>
    <span class="farm-sheetbar-go" aria-hidden="true">›</span>
  </button>`;
}

// -- folded panes: why, team log, notices ---------------------------------------------------------
function fold(ctx, key, { title, sub, badge = "", body }) {
  const open = Boolean(farmState(ctx).open[key]);
  return html`
    <details class="pane farm-fold"${open ? raw(" open") : ""}>
      <summary class="pane-head farm-fold-sum" data-action="fold" data-fold="${key}" data-focus-key="fold-${key}">
        <div><h2>${title}</h2><p>${sub}</p></div>
        <span class="farm-fold-side">${badge}<span class="farm-fold-chev" aria-hidden="true"></span></span>
      </summary>
      <div class="pane-body">${body}</div>
    </details>
  `;
}

/** The Coordinator's summary in plain words. */
function plainSummary(summary) {
  return String(summary ?? "").replace(/^(.+?): (\d+) proposals, (\d+)\/(\d+) actions cleared by the safety check$/, (m, d, p, a, n) => `${p} field agents reported; ${a} of ${n} actions passed the safety rules.`);
}

function whyFold(ctx, b) {
  const { snap } = ctx;
  if (!b) {
    return fold(ctx, "why", { title: "Why this plan", sub: "No plan is waiting today", badge: html`<span class="prov is-rule">Rule</span>`, body: html`<p class="muted">The reasons appear here with the next plan.</p>` });
  }
  const rows = b.planRows ?? [];
  const quiet = (b.proposals ?? []).filter((p) => !(p.actions ?? []).length && !rows.some((r) => r.field === p.field));
  const asks = Object.entries(helpAsked(snap));
  const offers = (b.nearbyCapacity ?? []).filter((c) => c.farm !== OWN_FARM.name);
  return fold(ctx, "why", {
    title: "Why this plan",
    sub: "Each field agent's reason, the Coordinator's summary and the neighbours' offers",
    badge: html`<span class="prov is-rule" title="Rule-based field agents, Coordinator and safety rules; a person approves every plan">Rule</span>`,
    body: html`
      <ol class="farm-why">
        ${rows.map(
          (r) => {
            const notes = RING_ACTIONS.has(r.actionType) ? "" : agentNotes(b, r.field);
            return html`<li><div class="farm-why-top"><b>${FIELD_NAMES[r.field] ?? r.field}</b> · ${r.what === "Scout field" ? "Scout" : r.what} ${confWord(r.confidence)}</div><p>${plainReason(r.reason)}</p>${notes ? html`<p class="farm-why-note">${notes}</p>` : ""}</li>`;
          },
        )}
        ${quiet.map((p) => html`<li><div class="farm-why-top"><b>${FIELD_NAMES[p.field] ?? p.field}</b> · nothing to do</div><p>${plainReason(p.rationale)}</p></li>`)}
      </ol>
      <p class="farm-why-sum"><span class="actor">Coordinator:</span> ${plainSummary(b.summary)}</p>
      ${
        asks.length && offers.length
          ? html`<div class="farm-why-offers"><h3 class="farm-subhead">What the neighbours offered</h3>
              <ul>${offers.map((c) => html`<li><b>${c.farm}</b>: ${c.canShare?.combine ? "its combine and " : "no combine, "}${tonnes(c.canShare?.storageT)} t of silo space until ${c.validUntil} ${confWord(c.confidence)}</li>`)}</ul></div>`
          : ""
      }
    `,
  });
}

function logTone(e) {
  if (e.level === "block") return "block";
  if (e.level === "decision") return e.text.startsWith("rejected") ? "rejected" : "approved";
  if (e.level === "warn") return "warn";
  return "info";
}

function logIcon(e) {
  const text = String(e.text ?? "").toLowerCase();
  if (e.level === "block") return "shield";
  if (e.level === "decision") return text.startsWith("rejected") ? "cross" : "check";
  if (e.actor === "Coordinator") return "compass";
  if (e.actor === "Machinery ring" || FARM_NAMES.includes(e.actor)) return "tractor";
  if (text.includes("irrigat")) return "drop";
  if (text.includes("harvest")) return "wheat";
  if (text.includes("hail")) return "hail";
  if (text.includes("heatwave")) return "heat";
  if (Object.values(FIELD_AGENT_NAMES).includes(e.actor)) return "leaf";
  if (e.level === "warn") return "alert";
  if (e.actor === "Farm") return "barn";
  if (e.actor === "Farm manager") return "person";
  return "";
}

function byDay(entries) {
  const groups = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups;
}

const LOG_LIMIT = 80;

function logFold(ctx, log) {
  const lines = log.slice(0, LOG_LIMIT);
  return fold(ctx, "log", {
    title: "Team log",
    sub: "Newest first: the field agents, the Coordinator, the safety rules, the sharing network and you",
    badge: simProv(ctx.snap),
    body: lines.length
      ? html`<div class="farm-scroll" data-keep-scroll="log" tabindex="0" role="region" aria-label="Team log, newest first">
          <ol class="farm-log">
            ${byDay(lines).map(
              (g) => html`<li class="farm-log-day">
                <h3 class="farm-log-date"><time>${g.date}</time></h3>
                <ol class="farm-log-list">
                  ${g.items.map((e) => {
                    const name = logIcon(e);
                    return html`<li class="farm-log-${logTone(e)}">${name ? icon(name) : html`<span class="farm-ic" aria-hidden="true"></span>`}
                      <div><span class="actor">${plainActor(e.actor)}</span> ${plainLog(e)}</div></li>`;
                  })}
                </ol>
              </li>`,
            )}
          </ol>
        </div>`
      : html`<p class="muted">Nobody has said anything yet.</p>`,
  });
}

function noticeList(notices) {
  return html`<ol class="farm-bubbles">
    ${notices.map((n) => {
      const audience = n.audience || "Everyone";
      const prefix = `${audience}: `;
      const text = n.text.startsWith(prefix) ? n.text.slice(prefix.length) : n.text;
      return html`<li><div class="farm-bubble-head"><span class="farm-aud">${audience}</span><time>${n.date}</time></div><p>${text}</p></li>`;
    })}
  </ol>`;
}

function noticesFold(ctx, notices) {
  return fold(ctx, "notices", {
    title: "What buyers & neighbours see",
    sub: "Only approved plans, in plain words",
    badge: simProv(ctx.snap),
    body: notices.length
      ? html`<div class="farm-scroll farm-scroll-short" data-keep-scroll="notices" tabindex="0" role="region" aria-label="Notices, newest first">${noticeList(notices.slice(0, 40))}</div>`
      : html`<p class="muted">Buyers and neighbours only hear about approved plans. Nothing approved yet.</p>`,
  });
}

// -- rail: shared with me, shared by me -------------------------------------------------------------
/** Public orders and warnings: the real surface-water ban (Official) and the simulated scenarios. */
function ordersList(ctx) {
  const { snap } = ctx;
  const ban = realValue(ctx.data, "mol.surfaceWaterBan");
  const items = [
    html`<li><div class="farm-sw-top"><span>District water authority · public order</span>${realBadge(ban, ctx)}</div>
      <div class="farm-sw-what">Surface-water ban: ${ban ? realText(ban) : "unknown"}</div>
      <p class="farm-sw-why">Taking water from rivers and ditches is banned district-wide; our irrigation runs on its own permit.</p></li>`,
  ];
  for (const msg of snap.scenarios ?? []) {
    const heat = /^heatwave/i.test(msg);
    items.push(html`<li><div class="farm-sw-top"><span>${heat ? "Water authority · order" : "Weather service · warning"}</span>${simProv(snap)}</div>
      <div class="farm-sw-what">${cap(msg)}${heat && snap.heatwaveDaysRemaining ? ` (${plural(snap.heatwaveDaysRemaining, "day")} left)` : ""}</div></li>`);
  }
  return items;
}

function sharedWithMe(ctx) {
  const { snap } = ctx;
  const offers = (snap.farms ?? []).filter((r) => !r.isOwn).map((r) => ({ r, o: offerOf(snap, r.name) }));
  return html`
    <section class="pane" aria-labelledby="farm-with-title">
      <header class="pane-head"><div><h2 id="farm-with-title">Shared with me</h2><p>Neighbours' offers, public orders and warnings</p></div></header>
      <ul class="farm-sw-list">
        ${offers.map(
          ({ r, o }) => html`<li><div class="farm-sw-top"><a href="#${T.farm(r.id)}" data-focus-key="peer-${r.id}">${r.name}</a>${simProv(snap)}</div>
            ${
              o
                ? html`<div class="farm-sw-what">${o.combine ? "Combine free" : "No combine"} · ${keptBackText(o)}</div>
                  <p class="farm-sw-why">Until ${o.validUntil}, ${confWord(o.confidence)}</p>`
                : html`<div class="farm-sw-what faint">No offer yet</div>`
            }</li>`,
        )}
        ${ordersList(ctx)}
      </ul>
    </section>
  `;
}

function sharedByMe(ctx) {
  const { snap } = ctx;
  const o = offerOf(snap, OWN_FARM.name);
  const res = snap.resources;
  return html`
    <section class="pane" aria-labelledby="farm-by-title">
      <header class="pane-head"><div><h2 id="farm-by-title">Shared by me</h2><p>Each channel gets only what it needs</p></div></header>
      <div class="pane-body">
        <dl class="kv">
          <dt>Sharing network: combine and silo space, daily</dt><dd>${o ? html`${o.combine ? "Combine · " : ""}${tonnes(o.storageT)} t ${simProv(snap)}` : "No offer today"}</dd>
          <dt>District water authority: water taken vs permit</dt><dd>${fmt(res.waterPermitM3)} m³ permit ${simProv(snap)}</dd>
          <dt>Paying agency: crops and areas, yearly</dt><dd>${prov("illustrative")}</dd>
          <dt>Statistics office: yields, yearly</dt><dd>${prov("illustrative")}</dd>
        </dl>
        <p class="pane-note">${HOLDBACK_NOTE}</p>
        <div class="never"><b>Never leaves the farm:</b> finances, prices, raw field and machine data.</div>
      </div>
    </section>
  `;
}

function ownSources(ctx) {
  const { snap } = ctx;
  const ban = realValue(ctx.data, "mol.surfaceWaterBan");
  return sourcesFooter([
    {
      badge: simProv(snap),
      text: `Every number for ${OWN_FARM.name} and its neighbours comes from the seeded simulation (seed ${snap.seed}). The farms, their fields and their shapes are fictional; the demo farm is smaller than a real Oderbruch farm (96 ha in 3 fields, against a Brandenburg mean of about 242 ha).`,
    },
    { badge: html`<span class="prov is-rule">Rule</span>`, text: "Field agents, the Coordinator, the safety rules and the sharing network are rule-based; the farm manager approves every plan. No language model is involved." },
    ban ? { badge: realBadge(ban, ctx), text: realSource(ban) } : { badge: realBadge(null, ctx), text: "Surface-water ban (Märkisch-Oderland): not loaded. Shown as Unknown, never as 0." },
    { badge: prov("illustrative"), text: "The channels in Shared by me show how a real farm reports; nothing is sent anywhere." },
  ]);
}

// -- handlers ------------------------------------------------------------------------------------------
function onOwnClick(event, ctx, container) {
  const target = event.target;
  if (handleLensClick(event, ctx)) return;
  const approve = target.closest("[data-action='approve']");
  if (approve) {
    approvePlan(ctx, Number(approve.dataset.bundle));
    return;
  }
  const sum = target.closest("[data-action='fold']");
  if (sum) {
    // The click comes before the browser toggles <details>, so the new state is the opposite.
    farmState(ctx).open[sum.dataset.fold] = !sum.parentElement.open;
    return;
  }
  if (target.closest("[data-action='toggle-flower']")) {
    const st = farmState(ctx);
    st.showFlower = !st.showFlower;
    ctx.rerender();
    return;
  }
  if (target.closest("[data-action='sheet-open']")) {
    farmState(ctx).sheetOpen = true;
    ctx.rerender();
    container.querySelector?.("#farm-plan-title")?.focus({ preventScroll: true });
    return;
  }
  if (target.closest("[data-action='sheet-close']")) closeSheet(ctx, container);
}

function closeSheet(ctx, container) {
  farmState(ctx).sheetOpen = false;
  ctx.rerender();
  container.querySelector?.("[data-action='sheet-open']")?.focus({ preventScroll: true });
}

function showDecideError(ctx, bundleId, err) {
  const message = plainError(err);
  farmState(ctx).error = { bundleId, message };
  ctx.toast(message);
  ctx.rerender();
}

function approvePlan(ctx, bundleId) {
  const { twin } = ctx;
  const st = farmState(ctx);
  const tick = ctx.snap.pendingBundle?.id === bundleId ? ctx.snap.pendingBundle.tick : ctx.snap.tick;
  const atTick = (t) => twin.notices().filter((n) => n.tick === t).length;
  const before = atTick(tick);
  let bundle;
  try {
    bundle = twin.decide(bundleId, "approve");
  } catch (err) {
    if (!onExpired(ctx, bundleId)) showDecideError(ctx, bundleId, err);
    return;
  }
  delete ctx.ui.drafts[bundleId];
  st.error = null;
  st.sheetOpen = false;
  const sent = Math.max(0, atTick(bundle?.tick ?? tick) - before);
  ctx.toast(sent ? `Plan approved. ${plural(sent, "notice")} went out to buyers and neighbours.` : "Plan approved.");
}

/** Keep the rejection draft in ctx.ui and update the form in place (re-renders wait while a field has focus). */
function onDraftEdit(event, ctx) {
  const field = event.target.closest("[data-draft]");
  if (!field) return;
  const id = Number(field.dataset.bundle);
  const draft = { ...draftFor(ctx, id) };
  if (field.dataset.draft === "choice") draft.choice = field.value;
  else draft.custom = field.value;
  ctx.ui.drafts[id] = draft;

  const form = field.closest("form");
  if (!form) return;
  const custom = form.querySelector("[data-draft='custom']");
  const submit = form.querySelector("button[type='submit']");
  const other = draft.choice === OTHER_REASON;
  if (custom) {
    custom.hidden = !other;
    if (other && field.dataset.draft === "choice" && event.type === "change") custom.focus();
  }
  if (submit) submit.disabled = !reasonOf(draft);
}

/**
 * The plan expired (the next day started) before the viewer decided: say so and carry a typed
 * rejection reason over to the plan that is waiting now. False if it didn't expire.
 */
function onExpired(ctx, bundleId) {
  const { twin } = ctx;
  const st = farmState(ctx);
  if (twin.bundles().find((b) => b.id === bundleId)?.status !== "expired") return false;
  const draft = ctx.ui.drafts[bundleId];
  delete ctx.ui.drafts[bundleId];
  if (st.error?.bundleId === bundleId) st.error = null;
  const next = twin.snapshot().pendingBundle;
  const keep = draft && reasonOf(draft);
  if (keep && next && !ctx.ui.drafts[next.id]) ctx.ui.drafts[next.id] = draft;
  ctx.toast(keep ? "This plan expired before you decided. Your reason is kept for the next plan." : "This plan expired before you decided.");
  ctx.rerender();
  return true;
}

function onRejectSubmit(event, ctx) {
  const form = event.target.closest("form[data-reject]");
  if (!form) return;
  event.preventDefault();
  const st = farmState(ctx);
  const id = Number(form.dataset.reject);
  const reason = reasonOf(draftFor(ctx, id));
  if (!reason) {
    // "Other" with an empty box must not send the option label to the field agents.
    ctx.toast("Type a reason first, so the field agents know what to change.");
    return;
  }
  try {
    ctx.twin.decide(id, "reject", reason);
  } catch (err) {
    if (!onExpired(ctx, id)) showDecideError(ctx, id, err);
    return;
  }
  delete ctx.ui.drafts[id];
  st.error = null;
  st.sheetOpen = false;
  // Enter in the reason box submits with the focus still in it, and re-renders wait while a
  // text box has focus: hand the focus to the Reject button so the decided plan can go.
  const submit = form.querySelector?.("button[type='submit']");
  if (submit && form.contains?.(form.ownerDocument?.activeElement)) submit.focus();
  ctx.toast(`Plan rejected: ${reason}`);
}

// =====================================================================================
// Own farm, district & sharing-network lens: public status and offers only
// =====================================================================================
function renderOwnPublic(container, ctx) {
  const { snap, twin } = ctx;
  const sim = simProv(snap);
  const ops = farmOps(snap);
  const own = (snap.farms ?? []).find((r) => r.isOwn);
  const crop = cropOf(own);
  const offer = offerOf(snap, OWN_FARM.name);
  const res = snap.resources;
  const reports = twin.farmReports(OWN_FARM.name);
  container.innerHTML = String(html`
    <div class="pg farm-pg">
      ${pageHead({
        level: "Farm",
        place: `${OWN_FARM.name} (fictional) · ${REGION.name} · viewing as ${roleOf(roleId(ctx)).name}`,
        title: `What does ${OWN_FARM.name} share today?`,
        question: "Its status and voluntary offers to the sharing network. The plan, the fields and the team log stay with the farm.",
        sees: "the farm's status, its offers, its water permit and its public notices. Never: fields, crop plans, finances.",
        status: { text: ops.label, tone: ops.tone, title: ops.title },
        fresh: { badge: sim, text: `Demo day ${snap.date}` },
      })}
      ${kpiStrip([
        hiddenTile("Fields at risk", "field"),
        { label: "Water permit today", value: fmt(res.waterPermitM3), unit: "m³", detail: res.waterPermitM3 < res.waterPermitNormalM3 ? `Cut from ${fmt(res.waterPermitNormalM3)} m³ in the heatwave` : "Issued by the district water authority", badge: sim },
        hiddenTile("Harvest progress", "farm"),
        { label: "Silo space offered", value: offer ? tonnes(offer.storageT) : "–", unit: "t", detail: offer ? `${tonnes(offer.freeT)} t free, ${tonnes(offer.heldT)} t kept back` : "No offer yet", badge: offer ? sim : prov("unknown") },
        helpTile(snap, sim, { inside: false }),
      ])}
      <div class="pg-grid">
        <div class="pg-main">
          <section class="pane" aria-labelledby="farm-public-title">
            <header class="pane-head"><div><h2 id="farm-public-title">Public status</h2><p>What the district and the sharing network see of this farm</p></div>${sim}</header>
            <div class="pane-body">
              <dl class="kv">
                <dt>Operations</dt><dd>${pill(ops.label, ops.tone, { title: ops.title })}</dd>
                <dt>Crop condition (farm average)</dt><dd>${pill(conditionText(crop), crop.tone, { title: CROP_RULE })}</dd>
                <dt>Combine to lend</dt><dd>${offer ? (offer.combine ? "Yes, today" : "No") : "–"}</dd>
                <dt>Silo space to lend</dt><dd>${offer ? keptBackText(offer) : "–"}</dd>
                <dt>Offer valid until</dt><dd>${offer?.validUntil ?? "–"}</dd>
              </dl>
              <p class="pane-note">${HOLDBACK_NOTE}</p>
            </div>
          </section>
          <section class="pane" aria-labelledby="farm-hidden-title">
            <header class="pane-head"><div><h2 id="farm-hidden-title">Plan, fields and team log</h2><p>Kept on the farm</p></div></header>
            <div class="pane-body farm-hidden-body">
              ${notShown("farm", { what: "Everything inside the farm (the plan, the fields, the team log)", seenBy: roleOf("farm").name })}
              <div class="row">${asFarmerButton()}</div>
            </div>
          </section>
          ${noticesFold(ctx, twin.notices())}
        </div>
        <aside class="pg-rail" aria-label="Offers">
          ${offersPane(ctx, OWN_FARM, reports)}
        </aside>
      </div>
      ${levelsPanel("farm", { place: OWN_FARM.name, links: levelLinks(), role: roleId(ctx) })}
      ${sourcesFooter([
        { badge: sim, text: `Every number for ${OWN_FARM.name} comes from the seeded simulation (seed ${snap.seed}); the farm is fictional.` },
        { badge: prov("notshown"), text: "The plan, the fields and the team log exist in the twin but stay with the farm manager." },
      ])}
    </div>
  `);
  container.onclick = (event) => {
    if (handleLensClick(event, ctx)) return;
    const sum = event.target.closest("[data-action='fold']");
    if (sum) farmState(ctx).open[sum.dataset.fold] = !sum.parentElement.open;
  };
  container.onchange = container.oninput = container.onsubmit = container.onkeydown = null;
}

function offersPane(ctx, farm, reports) {
  const { snap } = ctx;
  return html`
    <section class="pane pane-req" id="requests" aria-labelledby="farm-offers-title">
      <header class="pane-head"><div><h2 id="farm-offers-title">Offers to the sharing network</h2><p>What ${farm.name} said it can lend, newest first</p></div>${simProv(snap)}</header>
      ${
        reports.length
          ? html`<ul class="req-list">
              ${reports.map(
                (r) => html`<li class="req">
                  <div class="req-top"><span class="req-from num">For ${r.planFor}</span>${confWord(r.confidence)}</div>
                  <div class="req-what">${r.canShare?.combine ? "Combine and " : "No combine, "}${tonnes(r.canShare?.storageT)} t of silo space</div>
                  ${r.note ? html`<p class="req-why">${cap(r.note)}.</p>` : ""}
                </li>`,
              )}
            </ul>`
          : html`<div class="pane-body"><p class="muted">No offers yet. The first one comes with the next plan.</p></div>`
      }
      <footer class="pane-foot">
        <a href="#${T.oderbruch}" data-focus-key="back-region">‹ Back to the ${REGION.name}</a>
        ${farm.isOwn ? "" : html`<a href="#${T.farm(OWN_FARM.id)}" data-focus-key="open-own">Open ${OWN_FARM.name}</a>`}
      </footer>
    </section>
  `;
}

// =====================================================================================
// Lenses that see no single farm (federal ministry, global analyst)
// =====================================================================================
function renderHidden(container, ctx, farm) {
  const { snap } = ctx;
  const role = roleOf(roleId(ctx));
  const level = "farm";
  container.innerHTML = String(html`
    <div class="pg farm-pg">
      ${pageHead({
        level: "Farm",
        place: `${farm.name} (fictional) · ${REGION.name} · viewing as ${role.name}`,
        title: "What does this farm share, and with whom?",
        question: `As ${role.name}, you see farms only inside district and Land totals.`,
        sees: "nothing farm by farm. National and global views hold totals only.",
        status: null,
        fresh: { badge: prov("notshown"), text: `Demo day ${snap.date}` },
      })}
      ${kpiStrip([
        hiddenTile("Fields at risk", level),
        hiddenTile("Water today vs permit", level),
        hiddenTile("Harvest progress", level),
        hiddenTile("Silo free", level),
        hiddenTile("Help needed", level),
      ])}
      <section class="pane" aria-labelledby="farm-hidden-title">
        <header class="pane-head"><div><h2 id="farm-hidden-title">This farm's page</h2><p>Who sees what of a single farm</p></div></header>
        <div class="pane-body farm-hidden-body">
          ${notShown("farm", { what: "Everything on this farm page", seenBy: `${roleOf("farm").name}; its offers also ${roleOf("district").name}` })}
          <dl class="kv farm-reach">
            <dt>Reaches you as part of</dt><dd>District and Land totals</dd>
            <dt>Through</dt><dd>The statistics channel, as tables only</dd>
          </dl>
          <div class="row">${asFarmerButton()}<a class="btn" href="#${T.oderbruch}" data-focus-key="back-region">Open the ${REGION.name}</a></div>
        </div>
      </section>
      ${levelsPanel("farm", { place: farm.name, links: levelLinks(), role: roleId(ctx) })}
      ${sourcesFooter([{ badge: prov("notshown"), text: "The farm's numbers exist in the twin (Simulated, fictional farms) but are outside this lens." }])}
    </div>
  `);
  container.onclick = (event) => handleLensClick(event, ctx);
  container.onchange = container.oninput = container.onsubmit = container.onkeydown = null;
}

// =====================================================================================
// Neighbour farm: public status, offers and their history
// =====================================================================================
function renderNeighbour(container, ctx, farm) {
  const { snap, twin } = ctx;
  const st = farmState(ctx);
  const role = roleId(ctx);
  const sim = simProv(snap);
  const row = (snap.farms ?? []).find((r) => r.id === farm.id) ?? null;
  const offer = offerOf(snap, farm.name);
  const history = twin.farmHistory(farm.name) ?? [];
  const reports = twin.farmReports(farm.name);
  // The district sees each farm's status band; to a fellow farm a neighbour's soil is internal.
  const seesStatus = access(role, "district") === "full";
  const crop = cropOf(row);
  const freeDays = history.filter((h) => h.combineAvailable > 0).length;
  const capacity = row?.storageCapacityT ?? 0;
  container.innerHTML = String(html`
    <div class="pg farm-pg">
      ${pageHead({
        level: "Farm",
        place: `${farm.name} (fictional) · neighbour of ${OWN_FARM.name} · viewing as ${roleOf(role).name}`,
        title: `What does ${farm.name} offer the network today?`,
        question: `${cap(row?.crops ?? farm.crops)} on ${fmt(row?.areaHa ?? farm.areaHa)} ha. It tells the sharing network every day what it can lend.`,
        sees: seesStatus
          ? "its status band and its voluntary offers. Never: its fields, plans or finances."
          : "its voluntary offers. Never: its soil, fields, plans or finances.",
        status: seesStatus ? { text: conditionText(crop), tone: crop.tone, title: CROP_RULE } : null,
        fresh: { badge: sim, text: `Demo day ${snap.date}` },
      })}
      ${kpiStrip([
        { label: "Combine to lend", value: offer ? (offer.combine ? "Yes" : "No") : "–", detail: offer ? (offer.combine ? "Free today" : row?.combineAvailable ? "Needed for its own ripe crop" : "Busy today") : "No offer yet", badge: offer ? sim : prov("unknown") },
        { label: "Silo space to lend", value: offer ? tonnes(offer.storageT) : "–", unit: "t", detail: offer ? `${tonnes(offer.freeT)} t free, ${tonnes(offer.heldT)} t kept back` : "No offer yet", badge: offer ? sim : prov("unknown") },
        { label: "Offer valid until", value: offer?.validUntil ?? "–", detail: offer ? html`${confWord(offer.confidence)}` : "", badge: offer ? sim : prov("unknown") },
        seesStatus
          ? { label: "Crop condition", value: crop.label, detail: crop.driver ? `${crop.driver} · farm average` : "Farm average", badge: sim, alert: crop.tone === "crit" }
          : hiddenTile("Crop condition", "farm"),
        { label: "Days with a free combine", value: freeDays, unit: `of ${plural(history.length, "day")}`, detail: "This season so far", badge: sim },
      ])}
      <div class="pg-grid">
        <div class="pg-main">
          <section class="pane" aria-labelledby="farm-chart-title">
            <header class="pane-head">
              <div><h2 id="farm-chart-title">Silo space and combine since ${history.length ? history[0].date : "the start of the season"}</h2>
                <p>One point per day, as reported to the sharing network.</p></div>
              ${sim}
            </header>
            <div class="pane-body farm-chart-card">
              <div class="legend farm-chart-legend">
                <span><i class="farm-key is-silo"></i>Silo space free</span>
                <span><i class="farm-dot-key is-free"></i>Combine free</span>
                <span><i class="farm-dot-key is-busy"></i>Combine busy</span>
              </div>
              <div class="farm-chart" data-farm-chart>${historyChart(history, capacity, chartWidth(container))}</div>
              ${
                history.length
                  ? html`<button type="button" class="btn btn-ghost farm-table-toggle" data-action="toggle-table" data-focus-key="toggle-table" aria-expanded="${st.showTable}" aria-controls="farm-history-table">
                      ${st.showTable ? "Hide the numbers" : "Show the numbers"}
                    </button>`
                  : ""
              }
              ${st.showTable ? historyTable(history) : ""}
            </div>
          </section>
          <section class="pane" aria-labelledby="farm-hidden-title">
            <header class="pane-head"><div><h2 id="farm-hidden-title">Fields, plans and soil readings</h2><p>Kept on ${farm.name}</p></div></header>
            <div class="pane-body">${notShown("farm", { what: `Everything inside ${farm.name} (fields, plans, soil readings)`, seenBy: `its own farm manager (the twin models only ${OWN_FARM.name} in that detail)` })}</div>
          </section>
        </div>
        <aside class="pg-rail" aria-label="Offers">${offersPane(ctx, farm, reports)}</aside>
      </div>
      ${levelsPanel("farm", { place: farm.name, links: levelLinks(), role: role === "farm" ? "" : role })}
      ${sourcesFooter([
        { badge: sim, text: `Every number for ${farm.name} comes from the seeded simulation (seed ${snap.seed}); the farm is fictional.` },
        { badge: prov("illustrative"), text: `Offers to the sharing network show how a real request and offer flow would work. ${HOLDBACK_NOTE}` },
      ])}
    </div>
  `);

  container.onchange = container.oninput = container.onsubmit = container.onkeydown = null;
  container.onclick = (event) => {
    if (handleLensClick(event, ctx)) return;
    if (!event.target.closest("[data-action='toggle-table']")) return;
    st.showTable = !st.showTable;
    ctx.rerender();
  };
}

// -- neighbour history chart: silo space free and the combine on one day axis ---------------------
/** Draw at the chart's real pixel width so labels stay 11px on a phone and on a wide screen. */
function chartWidth(container) {
  const existing = container.querySelector?.("[data-farm-chart]");
  if (existing?.clientWidth) return clampWidth(existing.clientWidth);
  const page = container.clientWidth;
  if (!page) return 640;
  const vw = globalThis.innerWidth ?? page;
  const inner = page - (vw <= 640 ? 32 : 40);
  return clampWidth(vw > 1180 ? inner - 360 - 20 - 34 : inner - 34);
}
const clampWidth = (w) => Math.max(300, Math.min(960, Math.round(w)));

function niceTicks(lo, hi, target = 4) {
  const span = Math.max(1, hi - lo);
  const raw10 = 10 ** Math.floor(Math.log10(span / target));
  const step = [1, 2, 5, 10].map((m) => m * raw10).find((s) => span / s <= target) ?? 10 * raw10;
  const niceStep = Math.max(1, step);
  const start = Math.floor(lo / niceStep) * niceStep;
  const end = Math.ceil(hi / niceStep) * niceStep;
  const ticks = [];
  for (let v = start; v <= end; v += niceStep) ticks.push(v);
  return ticks;
}

function historyChart(history, capacity, width) {
  const n = history.length;
  if (n < 2) return html`<p class="muted">The chart starts with the second daily report.</p>`;
  const W = width;
  const m = { l: 58, r: 34 };
  const pw = W - m.l - m.r;
  const silo = { top: 26, h: 110 };
  const combineY = 166;
  const H = 196;
  const f = (v) => v.toFixed(1);
  const x = (i) => m.l + (i / (n - 1)) * pw;
  const siloTicks = niceTicks(0, Math.max(1, capacity || 0, ...history.map((h) => h.storageFreeT)), 3);
  const siloHi = siloTicks.at(-1);
  const ySilo = (v) => silo.top + silo.h - (Math.max(0, Math.min(siloHi, v)) / siloHi) * silo.h;
  const last = history.at(-1);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 76))));
  const xLabels = history.map((h, i) => ((n - 1 - i) % every === 0 ? { i, date: h.date } : null)).filter(Boolean);
  const colW = pw / (n - 1);
  const columns = history.map((h, i) => {
    const tip = `${h.date}: ${tonnes(h.storageFreeT)} t silo space free, combine ${h.combineAvailable > 0 ? "free" : "busy"}`;
    const x0 = Math.max(m.l - 4, x(i) - colW / 2);
    const x1 = Math.min(W - m.r + 4, x(i) + colW / 2);
    return html`<g class="farm-col"><title>${tip}</title>
      <rect x="${f(x0)}" y="${silo.top - 4}" width="${f(Math.max(1, x1 - x0))}" height="${combineY + 10 - silo.top}"></rect>
      <line x1="${f(x(i))}" x2="${f(x(i))}" y1="${silo.top}" y2="${combineY + 6}"></line></g>`;
  });
  const pts = history.map((h, i) => `${f(x(i))},${f(ySilo(h.storageFreeT))}`).join(" ");
  const summary = `${history[0].date} to ${last.date}. Silo space free now ${tonnes(last.storageFreeT)} t of ${tonnes(capacity)} t; combine ${last.combineAvailable > 0 ? "free" : "busy"} today.`;
  return html`
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${summary}" preserveAspectRatio="xMinYMin meet">
      <text class="farm-chart-title" x="${m.l}" y="${silo.top - 12}">Silo space free (t) · now ${tonnes(last.storageFreeT)} t</text>
      <g class="farm-grid">
        ${siloTicks.map(
          (t) => html`<line x1="${m.l}" x2="${W - m.r}" y1="${f(ySilo(t))}" y2="${f(ySilo(t))}"${t === 0 ? raw(' class="is-zero"') : ""}></line>
            <text x="${m.l - 6}" y="${f(ySilo(t) + 4)}" text-anchor="end">${fmt(t)}</text>`,
        )}
      </g>
      ${
        capacity > 0
          ? html`<g class="farm-ref"><line x1="${m.l}" x2="${W - m.r}" y1="${f(ySilo(capacity))}" y2="${f(ySilo(capacity))}"></line>
              <text x="${W - m.r}" y="${f(ySilo(capacity) - 4)}" text-anchor="end">capacity ${tonnes(capacity)} t</text></g>`
          : ""
      }
      <g class="farm-combine-row">
        <text class="farm-chart-axis" x="${m.l - 6}" y="${combineY + 4}" text-anchor="end">Combine</text>
        ${history.map((h, i) => html`<circle class="${h.combineAvailable > 0 ? "is-free" : "is-busy"}" cx="${f(x(i))}" cy="${combineY}" r="4"></circle>`)}
      </g>
      <g class="farm-xaxis">${xLabels.map((l) => html`<text x="${f(x(l.i))}" y="${H - 6}" text-anchor="middle">${l.date}</text>`)}</g>
      <g class="farm-cols">${columns}</g>
      <g class="farm-series is-silo">
        <polyline points="${pts}" fill="none"></polyline>
        <circle cx="${f(x(n - 1))}" cy="${f(ySilo(last.storageFreeT))}" r="4"></circle>
      </g>
    </svg>
  `;
}

function historyTable(history) {
  return html`
    <div class="table-wrap farm-history-table" id="farm-history-table" data-keep-scroll="farm-history" role="region" aria-label="Daily reports, newest first" tabindex="0">
      <table class="t">
        <thead><tr><th scope="col">Day</th><th scope="col" class="n">Silo free (t)</th><th scope="col">Combine</th></tr></thead>
        <tbody>
          ${[...history].reverse().map((h) => html`<tr><td class="num">${h.date}</td><td class="n">${tonnes(h.storageFreeT)}</td><td>${h.combineAvailable > 0 ? "free" : "busy"}</td></tr>`)}
        </tbody>
      </table>
    </div>
  `;
}

export { short as shortName, sum as sumOf };
