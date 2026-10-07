// Level 4: one farm. Our own farm gets the full dashboard: today's weather and resources,
// the hero flower (one petal per field) beside the field map, the field tiles, the plan for
// the day, the team conversation and what buyers & neighbours see. A neighbouring farm shows
// what it reports to the Machinery ring.

import {
  FARM_BY_ID,
  FARM_NAMES,
  FARMYARD,
  FIELD_AGENT_NAMES,
  FIELD_IDS,
  FIELD_NAMES,
  FIELD_POLYGONS,
  FIELDS,
  OWN_FARM,
  REGION,
} from "../data/places.js";
import { chip, confBar, html, pct, plural, raw, utilTone } from "./dom.js";

const OTHER_REASON = "Other (type a reason)";
const REJECT_REASONS = [
  "Not enough workers for this",
  "Soil too wet to drive on",
  "Wait for better weather",
  "Wrong priority order",
  "A neighbour farm should help with this",
  OTHER_REASON,
];

const STATUS_TONE = { approved: "ok", rejected: "crit", expired: "" };
const STATUS_LABEL = { approved: "Approved", rejected: "Rejected", expired: "Expired", pending: "Waiting" };
const FARM_TONE_LABEL = { ok: "Normal", warn: "Watch", crit: "Critical" };
const FARM_TONE_RULE = "Critical: soil moisture below 35% or silo over 95% full. Watch: below 45% or over 85%.";

const LOG_LIMIT = 120;
const CEREALS = new Set(["winter wheat", "rapeseed"]); // ripen and need the combine; what a hail storm ruins
const HAIL_RISK_DAYS = 4; // unharvested cereals this close to harvest lose 40% when the hail hits
const NEAR_MARGIN = 10; // "near" the stress line = less than this many points above it
const RING_ACTIONS = new Set(["borrow_combine", "deliver_to"]);
const AGENT_NAMES = new Set(Object.values(FIELD_AGENT_NAMES));
const FALLBACK_EMOJI = { "winter wheat": "🌾", rapeseed: "🌼", potatoes: "🥔" };

// Animation lengths, matching farm.css. Infinite animations start at the current phase so a
// re-render (every simulated day) does not restart them.
const PULSE_MS = 1300;
const SHAKE_MS = 500;
const PROPOSE_MS = 2400;
const GRAIN_MS = 1400;
const DROP_MS = 1200;
const MIST_MS = 1400;
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`;

// -- formatting ---------------------------------------------------------------------
const NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
/** Thousands separators; whole numbers without decimals, others with one ("108.5"). */
function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return NUM.format(Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) + 0 : n);
}
/** Tonnes are shown whole: "~324 t", "330 t free". */
const tonnes = (v) => (Number.isFinite(Number(v)) ? fmt(Math.round(Number(v))) : "—");
const pct0 = (v) => `${Math.round(Number(v) || 0)}%`;
const fixed = (v, digits = 1) => (Number(v) || 0).toFixed(digits);
const f1 = (n) => Math.round(n * 10) / 10;
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// -- routes (plain hash tokens) -------------------------------------------------------
function regionToken(ctx) {
  const r = ctx.routes ?? {};
  if (typeof r.oderbruch === "string") return r.oderbruch;
  if (typeof r.region === "string") return r.region;
  return REGION.id;
}
const farmToken = (ctx, id) => (typeof ctx.routes?.farm === "function" ? ctx.routes.farm(id) : id);
const fieldToken = (field) => `${OWN_FARM.id}.${FIELD_IDS[field] ?? String(field).toLowerCase()}`;

// -- icons (16 x 16, currentColor; .farm-ic-cut strokes take the surface colour) --------
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
  rain: '<path d="M4.6 9.2h7a2.6 2.6 0 0 0 .2-5.2A3.6 3.6 0 0 0 4.9 4.6a2.3 2.3 0 0 0-.3 4.6z" fill="currentColor"/><path d="M5.6 11.2l-.8 2.3M8.6 11.2l-.8 2.3M11.6 11.2l-.8 2.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  heat: '<path d="M6.6 9.3V3a1.4 1.4 0 0 1 2.8 0v6.3a3 3 0 1 1-2.8 0z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="11.8" r="1.6" fill="currentColor"/><path d="M8 11V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  sun: '<circle cx="8" cy="8" r="3.1" fill="currentColor"/><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M3.3 12.7l1.3-1.3M11.4 4.6l1.3-1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  cloudsun:
    '<path d="M5.4 1.2v1.3M1.2 5.4h1.3M2.4 2.4l.9.9M8.4 2.4l-.9.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="5.4" cy="5.4" r="2.2" fill="currentColor" opacity="0.55"/><path d="M5.6 13.2h6.2a2.4 2.4 0 0 0 .1-4.8 3.3 3.3 0 0 0-6.1.7 2.1 2.1 0 0 0-.2 4.1z" fill="currentColor"/>',
  person: '<circle cx="8" cy="4.6" r="2.7" fill="currentColor"/><path d="M2.6 14.6a5.4 5.4 0 0 1 10.8 0z" fill="currentColor"/>',
  barn: '<path d="M1.8 7.4L8 2.4l6.2 5V14.6H1.8z" fill="currentColor"/><path class="farm-ic-cut" d="M6 14.6v-4.2h4v4.2" fill="none" stroke-width="1.3"/>',
  leaf: '<path d="M8 15V8.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.8C8 5.2 10.4 3 14 3c0 3.6-2.4 5.8-6 5.8zM8 10.4C8 7.6 6 5.8 2.4 5.8c0 2.8 2 4.6 5.6 4.6z" fill="currentColor"/>',
  alert:
    '<path d="M8 1.5l7 12.6H1z" fill="currentColor"/><path class="farm-ic-cut" d="M8 6v3.6M8 11.6v.3" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
  spray:
    '<path d="M2.5 7.2h5.2V15H2.5z" fill="currentColor"/><path d="M5.1 7.2V4.4h3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><g fill="currentColor"><circle cx="10.8" cy="3.4" r="0.95"/><circle cx="13.4" cy="4.9" r="0.95"/><circle cx="11.2" cy="6.4" r="0.95"/><circle cx="13.8" cy="8" r="0.95"/></g>',
  silo: '<path d="M3.4 6.6C3.4 4 5.4 2 8 2s4.6 2 4.6 4.6V15H3.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.4 9.6h9.2M3.4 12.4h9.2" stroke="currentColor" stroke-width="1.2"/>',
};

function icon(name, extra = "") {
  return raw(
    `<svg class="farm-ic farm-ic-${name}${extra ? ` ${extra}` : ""}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${
      ICON_PATHS[name] ?? ""
    }</svg>`,
  );
}

// -- entry point ----------------------------------------------------------------
export function render(container, ctx, { routeChanged = false } = {}) {
  const farm = FARM_BY_ID[ctx.route.farmId];
  ctx.ui.farm ??= { showTable: false, error: null };
  ctx.ui.drafts ??= {};
  if (routeChanged) ctx.ui.farm.error = null;
  if (!farm) {
    container.innerHTML = String(html`<div class="card"><p>This farm is not part of the twin.</p>
      <p><a href="#${regionToken(ctx)}" data-focus-key="back-region">Back to ${REGION.name}</a></p></div>`);
    return;
  }
  if (farm.isOwn) renderOwn(container, ctx);
  else renderNeighbour(container, ctx, farm);
}

// -- field state ------------------------------------------------------------------------
/** "stress" | "near" | "ok" | "harvested" | "cover": the colour of a petal, a field and its bar. */
function fieldState(f) {
  if (f.coverCrop) return "cover";
  if (f.harvested) return "harvested";
  if (f.soilMoisturePct < f.stressThresholdPct) return "stress";
  if (f.soilMoisturePct < f.stressThresholdPct + NEAR_MARGIN) return "near";
  return "ok";
}

const STATE_LEGEND = {
  stress: "Soil below the stress line",
  near: "Near it",
  ok: "Comfortable",
  harvested: "Harvested",
  cover: "Cover crop",
};

const isStressed = (f) => !f.harvested && f.soilMoisturePct < f.stressThresholdPct;

/** A ripe (or nearly ripe) cereal still standing: exactly what the hail will hit. */
function hailAtRisk(f) {
  if (f.harvested) return false;
  if (f.harvestReady) return true;
  return CEREALS.has(f.crop) && f.daysToHarvest <= HAIL_RISK_DAYS;
}

function fieldStatusText(f) {
  if (f.coverCrop) return "harvested, cover crop sown";
  if (f.harvested) return "harvested";
  return `soil moisture ${pct0(f.soilMoisturePct)} (stress below ${pct0(f.stressThresholdPct)}), health ${fixed(f.cropHealth, 2)}`;
}

function fieldSummary(f, atRisk) {
  return `${f.name}: ${f.crop}, ${fmt(f.areaHa)} ha, ${fieldStatusText(f)}${atRisk ? ", ripe crop at risk from the hail" : ""}`;
}

function ownFields(snap) {
  return FIELDS.map((id) => snap.fields?.[id]).filter(Boolean);
}

function farmTone(row) {
  if (row.status) return row.status;
  const fill = row.storageCapacityT ? 1 - row.storageFreeT / row.storageCapacityT : 0;
  if (row.avgSoilMoisturePct < 35 || fill > 0.95) return "crit";
  if (row.avgSoilMoisturePct < 45 || fill > 0.85) return "warn";
  return "ok";
}

function fillBar(fraction, label) {
  const f = Math.max(0, Math.min(1, fraction));
  const value = Math.round(fraction * 100);
  return html`<div class="meter is-${utilTone(fraction)} farm-fill" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(
    100,
    Math.max(0, value),
  )}" aria-valuetext="${value}% full" aria-label="${label}"><span style="width:${(f * 100).toFixed(1)}%"></span></div>`;
}

// =====================================================================================
// Own farm
// =====================================================================================
function renderOwn(container, ctx) {
  const { snap, twin } = ctx;
  const log = twin.log();
  const blocksToday = log.filter((e) => e.level === "block" && e.tick === snap.tick).length;
  const bundle = snap.pendingBundle;

  container.innerHTML = String(html`
    ${ownHead(snap)}
    <div class="layout">
      <section class="stage farm-stage" aria-label="The farm today">
        <h2 class="sr-only">Weather</h2>
        ${weatherStrip(snap)}
        <h2 class="sr-only">Resources today</h2>
        ${resourceStrip(snap.resources)}
        ${heroCard(ctx, blocksToday)}
        <section class="farm-section" aria-labelledby="farm-fields-title">
          <div class="farm-section-head">
            <h2 id="farm-fields-title">Fields</h2>
            <p class="muted">Soil moisture against each crop's stress line, crop health and the harvest.</p>
          </div>
          <div class="farm-fields">${ownFields(snap).map((f) => fieldTile(f, snap))}</div>
        </section>
        <section class="farm-section" aria-labelledby="farm-peers-title">
          <div class="farm-section-head">
            <h2 id="farm-peers-title">Farms in the machinery ring</h2>
            <p class="muted">What each farm reports today.</p>
          </div>
          <div class="farm-peers">${snap.farms.map((row) => farmCard(row, ctx))}</div>
        </section>
      </section>
      <aside class="panel" aria-label="Plan, conversation and notices">
        ${bundle ? planCard(ctx, bundle) : noPlanCard(twin)}
        ${conversationCard(log)}
        ${noticesCard(twin.notices())}
      </aside>
    </div>
  `);

  container.onclick = (event) => onOwnClick(event, ctx);
  container.onchange = (event) => onDraftEdit(event, ctx);
  container.oninput = (event) => onDraftEdit(event, ctx);
  container.onsubmit = (event) => onRejectSubmit(event, ctx);
}

function ownHead(snap) {
  const own = snap.farms.find((r) => r.isOwn) ?? null;
  const tone = own ? farmTone(own) : "ok";
  const res = snap.resources;
  const used = res.storageCapacityT ? (res.storageUsedT ?? res.storageCapacityT - res.storageFreeT) / res.storageCapacityT : 0;
  const heatwave = snap.heatwaveDaysRemaining > 0;
  const heatMsg = (snap.scenarios ?? []).find((s) => s.toLowerCase().startsWith("heatwave")) ?? "Heatwave: water permit cut";
  const hailMsg = (snap.scenarios ?? []).find((s) => s.toLowerCase().startsWith("hail")) ?? `Hail expected ${snap.hailDate}`;
  return html`
    <div class="view-head">
      <div>
        <div class="eyebrow">Farm · ${REGION.name}, ${REGION.state}</div>
        <h1>${OWN_FARM.name}</h1>
        <p>Today's weather and resources, the field agents' plan for the day and what everyone said about it.</p>
      </div>
      <div class="row farm-chips">
        ${own ? chip(`${FARM_TONE_LABEL[tone]} · soil ${pct0(own.avgSoilMoisturePct)} · silo ${pct(used)} full`, tone, { title: FARM_TONE_RULE }) : ""}
        ${heatwave ? chip(`Heatwave · ${plural(snap.heatwaveDaysRemaining, "day")} left`, "crit", { title: capitalise(heatMsg) }) : ""}
        ${snap.hailDate ? chip(`Hail expected ${snap.hailDate}`, "crit", { title: `${capitalise(hailMsg)}. Harvest ripe crops before it hits.` }) : ""}
        ${
          snap.pendingBundle
            ? html`<button type="button" class="btn farm-jump" data-action="jump-plan" data-focus-key="jump-plan">Plan for ${snap.pendingBundle.planFor} is waiting ↓</button>`
            : ""
        }
      </div>
    </div>
  `;
}

// -- weather -----------------------------------------------------------------------------
const WEATHER = {
  hail: { icon: "hail", label: "Hail storm" },
  heat: { icon: "sun", label: "Hot" },
  rain: { icon: "rain", label: "Rain" },
  cloud: { icon: "cloudsun", label: "Humid, some cloud" },
  sun: { icon: "sun", label: "Sunny" },
};

function weatherKind(w) {
  if (w.hail) return "hail";
  if (w.note === "heatwave" || w.tempMaxC >= 33) return "heat";
  if (w.rainMm >= 0.5) return "rain";
  if (w.humidityPct >= 70) return "cloud";
  return "sun";
}

function weatherCard(w, when, snap) {
  const hail = Boolean(w.hail || (snap.hailDate && w.date === snap.hailDate));
  const kind = hail ? "hail" : weatherKind(w);
  const note = hail
    ? chip("Hail storm", "crit")
    : w.note === "heatwave"
      ? chip("Heatwave", "warn")
      : w.note
        ? chip(capitalise(w.note), "", { plain: true })
        : "";
  return html`
    <article class="card farm-wx${hail ? " is-hail" : ""}">
      <header class="farm-wx-head"><span class="eyebrow">${when}</span><span class="farm-wx-date">${w.date}</span></header>
      <div class="farm-wx-main">
        ${icon(WEATHER[kind].icon, `farm-wx-ic is-${kind}`)}
        <span class="sr-only">${WEATHER[kind].label}, up to</span>
        <span class="farm-wx-temp">${Math.round(w.tempMaxC)} °C</span>
      </div>
      <p class="farm-wx-sub">
        <span>Rain ${fixed(w.rainMm)} mm</span>
        <span>Wind ${fixed(w.windMs)} m/s</span>
        <span title="Reference evapotranspiration: the water a crop can lose in a day">ET₀ ${fixed(w.et0Mm)} mm</span>
      </p>
      ${note ? html`<div class="farm-wx-note">${note}</div>` : ""}
    </article>
  `;
}

function weatherStrip(snap) {
  const days = [["Today", snap.weatherToday], ...(snap.forecast ?? []).slice(0, 3).map((w, i) => [i === 0 ? "Tomorrow" : "Forecast", w])].filter(
    ([, w]) => w,
  );
  if (!days.length) return html`<p class="muted">No weather data yet.</p>`;
  return html`<div class="farm-wx-strip">${days.map(([when, w]) => weatherCard(w, when, snap))}</div>`;
}

// -- resources -------------------------------------------------------------------------------
function resCard({ name, label, value, sub, tone = "", extra = "", wide = false }) {
  return html`
    <div class="card farm-res-card${tone ? ` is-${tone}` : ""}${wide ? " is-wide" : ""}" role="listitem">
      <div class="farm-res-label">${icon(name)}<span>${label}</span></div>
      <div class="farm-res-value">${value}</div>
      ${extra}
      <div class="farm-res-sub">${sub}</div>
    </div>
  `;
}

function resourceStrip(res) {
  const cut = res.waterPermitM3 < res.waterPermitNormalM3;
  const cap = res.storageCapacityT;
  const used = res.storageUsedT ?? cap - res.storageFreeT;
  const fill = cap > 0 ? used / cap : 1;
  return html`
    <div class="farm-res" role="list" aria-label="Resources today">
      ${resCard({
        name: "drop",
        label: "Water permit today",
        value: `${fmt(res.waterPermitM3)} m³`,
        sub: cut ? `Cut from ${fmt(res.waterPermitNormalM3)} m³` : "Normal daily permit",
        tone: cut ? "crit" : "",
      })}
      ${resCard({ name: "person", label: "Workers", value: fmt(res.workers), sub: "People for field work today" })}
      ${resCard({
        name: "tractor",
        label: "Combine",
        value: res.combine > 0 ? `${fmt(res.combine)} free` : "In use",
        sub: res.combine > 0 ? "One field per day" : "It harvested a field today",
      })}
      ${resCard({
        name: "spray",
        label: "Sprayer",
        value: res.sprayer > 0 ? `${fmt(res.sprayer)} free` : "In use",
        sub: "One field per day",
      })}
      ${resCard({
        name: "silo",
        label: "Silo",
        value: `${tonnes(res.storageFreeT)} t free`,
        sub: `${tonnes(used)} of ${tonnes(cap)} t used`,
        extra: fillBar(fill, `Silo ${pct(fill)} full`),
        wide: true,
      })}
    </div>
  `;
}

// -- hero: flower + field map ------------------------------------------------------------------
function heroCard(ctx, blocksToday) {
  const { snap } = ctx;
  const approved = approvedToday(snap.recentActions ?? []);
  return html`
    <section class="card farm-hero-card" aria-labelledby="farm-hero-title">
      <div class="farm-hero-head">
        <h2 id="farm-hero-title">The farm today</h2>
        <p class="muted">One petal per field, sized by its area and coloured by soil moisture against the crop's stress line. Select a petal or a field to open it.</p>
      </div>
      <div class="farm-hero-grid">
        <figure class="farm-hero">
          ${heroSvg(snap, blocksToday)}
          <figcaption class="farm-caption">
            ${approved ? html`<span>Approved today: ${approved}.</span>` : html`<span>Nothing approved yet today.</span>`}
            ${
              blocksToday
                ? html`<span>The Safety check blocked ${plural(blocksToday, "action")} today: one thorn each.</span>`
                : html`<span>No Safety check blocks today.</span>`
            }
          </figcaption>
        </figure>
        <figure class="farm-map">
          ${fieldMap(snap)}
          <figcaption class="farm-caption">Field map with the farmyard and the tracks to each field.</figcaption>
        </figure>
      </div>
      ${heroLegend(snap)}
    </section>
  `;
}

function approvedToday(actions) {
  const seen = new Set();
  const parts = [];
  for (const a of actions) {
    const where = FIELD_NAMES[a.field] ?? a.field;
    const text =
      a.kind === "harvest"
        ? `harvest on ${where}`
        : a.kind === "irrigate"
          ? `irrigation on ${where}`
          : a.kind === "spray"
            ? `spraying on ${where}`
            : a.kind === "deliver"
              ? `grain to ${a.farm ?? "a neighbour farm"}`
              : "";
    if (text && !seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join(", ");
}

function heroLegend(snap) {
  return html`
    <div class="legend farm-legend" role="list" aria-label="Colour key">
      ${["stress", "near", "ok", "harvested", "cover"].map(
        (s) => html`<span role="listitem"><i class="swatch farm-sw is-${s}" aria-hidden="true"></i>${STATE_LEGEND[s]}</span>`,
      )}
      <span role="listitem"><i class="farm-sw-thorn" aria-hidden="true"></i>Safety check block today</span>
      ${snap.hailDate ? html`<span role="listitem"><i class="swatch farm-sw is-hail" aria-hidden="true"></i>Ripe crop at risk from the hail</span>` : ""}
    </div>
  `;
}

// Flower geometry in viewBox units (0..260): petal size grows with the square root of the area.
const HERO = { w: 260, h: 260, cx: 130, cy: 112, r: 34, len: [44, 72], wid: [28, 42], stemBottom: 240, maxThorns: 6, deliverX: 252 };
const PETAL_ANGLE = { North: 0, River: 120, West: 240 }; // degrees clockwise from up, as on the map

function petalGeometry(field, area, maxArea) {
  const k = maxArea > 0 ? Math.sqrt(Math.max(0, area) / maxArea) : 0;
  const len = HERO.len[0] + (HERO.len[1] - HERO.len[0]) * k;
  const wid = HERO.wid[0] + (HERO.wid[1] - HERO.wid[0]) * k;
  const dist = HERO.r * 0.55 + len / 2;
  const angle = PETAL_ANGLE[field] ?? 0;
  const a = (angle * Math.PI) / 180;
  // SVG rotate(a) turns the local "up" vector (0, -1) into (sin a, -cos a).
  return { len, wid, dist, angle, cx: HERO.cx + Math.sin(a) * dist, cy: HERO.cy - Math.cos(a) * dist };
}

/** Stubble rows (harvested) or seedling dots (cover crop) inside a petal, in its local frame. */
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

function petalSvg(f, g, { hail, proposed }) {
  const state = fieldState(f);
  const stressed = isStressed(f);
  const atRisk = hail && hailAtRisk(f);
  const isProposed = !stressed && proposed.has(f.id);
  const summary = fieldSummary(f, atRisk);
  const value = state === "harvested" ? "harvested" : state === "cover" ? "cover crop" : pct0(f.soilMoisturePct);
  const ellipse = { cx: 0, cy: f1(-g.dist), rx: f1(g.wid / 2), ry: f1(g.len / 2) };
  return html`
    <a class="farm-petal-link" href="#${fieldToken(f.id)}" aria-label="${summary}. Open the field." data-focus-key="petal-${FIELD_IDS[f.id]}">
      <title>${summary}</title>
      <g class="farm-petal-g${atRisk ? " is-shaking" : ""}"${atRisk ? raw(` style="${phase(SHAKE_MS)}"`) : ""}>
        <g transform="translate(${HERO.cx},${HERO.cy}) rotate(${g.angle})">
          ${
            stressed
              ? html`<ellipse class="farm-petal-halo" cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" style="${phase(PULSE_MS)}"></ellipse>`
              : ""
          }
          <ellipse class="farm-petal is-${state}${atRisk ? " is-hail-risk" : ""}${isProposed ? " is-proposed" : ""}" cx="${ellipse.cx}" cy="${ellipse.cy}"
            rx="${ellipse.rx}" ry="${ellipse.ry}"${isProposed ? raw(` style="${phase(PROPOSE_MS)}"`) : ""}></ellipse>
          ${petalTexture(state, g)}
        </g>
        <text class="farm-petal-emoji" x="${f1(g.cx)}" y="${f1(g.cy - 4)}" text-anchor="middle">${f.emoji || FALLBACK_EMOJI[f.crop] || ""}</text>
        <text class="farm-petal-name on-${state}" x="${f1(g.cx)}" y="${f1(g.cy + 7)}" text-anchor="middle">${f.id}</text>
        <text class="farm-petal-val on-${state}${state === "harvested" || state === "cover" ? " is-small" : ""}" x="${f1(g.cx)}" y="${f1(
          g.cy + 17,
        )}" text-anchor="middle">${value}</text>
      </g>
    </a>
  `;
}

function thornsSvg(count) {
  if (!count) return "";
  const shown = Math.min(count, HERO.maxThorns);
  const top = HERO.cy + HERO.r;
  const thorns = [];
  for (let i = 0; i < shown; i++) {
    const y = top + 14 + i * 12;
    if (y > HERO.stemBottom - 6) break;
    const tip = HERO.cx + (i % 2 === 0 ? 11 : -11);
    thorns.push(html`<polygon class="farm-thorn" points="${HERO.cx},${y - 4} ${tip},${y} ${HERO.cx},${y + 4}"></polygon>`);
  }
  const extra = count - thorns.length;
  return html`<g class="farm-thorns" role="img" aria-label="${plural(count, "action")} blocked by the Safety check today">
    <title>${plural(count, "action")} blocked by the Safety check today</title>
    ${thorns}
    ${extra > 0 ? html`<text class="farm-thorn-more" x="${HERO.cx}" y="${HERO.stemBottom + 14}" text-anchor="middle">+${extra} more</text>` : ""}
  </g>`;
}

function cornerFlag(name, x, label) {
  return html`<svg class="farm-hero-flag is-${name}" x="${x}" y="8" width="24" height="24" viewBox="0 0 16 16" role="img" aria-label="${label}"><title>${label}</title>${raw(
    ICON_PATHS[name],
  )}</svg>`;
}

/** CSS-only movement for today's approved work: grain to the silo, a falling drop, spray mist, grain leaving. */
function actionMarks(actions, geo) {
  return actions.slice(0, 6).map((a) => {
    const g = geo[a.field];
    if (a.kind === "harvest" && g) {
      return html`<circle class="farm-grain" cx="${f1(g.cx)}" cy="${f1(g.cy)}" r="4" style="--dx:${f1(HERO.cx - g.cx)}px;--dy:${f1(
        HERO.cy - g.cy,
      )}px;${phase(GRAIN_MS)}"></circle>`;
    }
    if (a.kind === "irrigate" && g) {
      return html`<g transform="translate(${f1(g.cx)},${f1(g.cy - 30)})"><path class="farm-drop" style="${phase(
        DROP_MS,
      )}" d="M0 -7C-2 -3.6 -4.5 -1 -4.5 2a4.5 4.5 0 0 0 9 0C4.5 -1 2 -3.6 0 -7z"></path></g>`;
    }
    if (a.kind === "spray" && g) {
      return html`<circle class="farm-mist" cx="${f1(g.cx)}" cy="${f1(g.cy)}" r="18" style="${phase(MIST_MS)}"></circle>`;
    }
    if (a.kind === "deliver") {
      return html`<circle class="farm-grain" cx="${HERO.cx}" cy="${HERO.cy}" r="4" style="--dx:${HERO.deliverX - HERO.cx}px;--dy:0px;${phase(GRAIN_MS)}"></circle>`;
    }
    return "";
  });
}

function heroSvg(snap, blocksToday) {
  const fields = ownFields(snap);
  const maxArea = Math.max(1, ...fields.map((f) => f.areaHa || 0));
  const geo = Object.fromEntries(fields.map((f) => [f.id, petalGeometry(f.id, f.areaHa, maxArea)]));
  const hail = Boolean(snap.hailDate);
  const proposed = new Set(snap.pendingBundle ? (snap.recentProposals ?? []) : []);
  const [dayName = "", ...rest] = String(snap.date ?? "").split(" ");
  return html`
    <svg class="farm-hero-svg" viewBox="0 0 ${HERO.w} ${HERO.h}" role="group" aria-label="Hero flower of ${OWN_FARM.name}: one petal per field">
      ${snap.heatwaveDaysRemaining > 0 ? cornerFlag("heat", 8, "Heatwave: the water permit is cut") : ""}
      ${hail ? cornerFlag("hail", HERO.w - 32, `Hail expected ${snap.hailDate}`) : ""}
      <line class="farm-stem" x1="${HERO.cx}" y1="${HERO.cy + HERO.r}" x2="${HERO.cx}" y2="${HERO.stemBottom}" aria-hidden="true"></line>
      <path class="farm-ground" d="M${HERO.cx - 44} ${HERO.stemBottom}H${HERO.cx + 44}" aria-hidden="true"></path>
      ${thornsSvg(blocksToday)}
      ${fields.map((f) => petalSvg(f, geo[f.id], { hail, proposed }))}
      <g class="farm-centre" aria-hidden="true">
        <circle class="farm-centre-disc" cx="${HERO.cx}" cy="${HERO.cy}" r="${HERO.r}"></circle>
        <text class="farm-centre-day" x="${HERO.cx}" y="${HERO.cy - 12}" text-anchor="middle">${dayName}</text>
        <text class="farm-centre-date" x="${HERO.cx}" y="${HERO.cy + 4}" text-anchor="middle">${rest.join(" ")}</text>
        <svg class="farm-centre-person" x="${HERO.cx - 7}" y="${HERO.cy + 9}" width="14" height="14" viewBox="0 0 16 16">${raw(ICON_PATHS.person)}</svg>
      </g>
      <g class="farm-actions" aria-hidden="true">${actionMarks(snap.recentActions ?? [], geo)}</g>
    </svg>
  `;
}

// Field map: the three field polygons and the farmyard, projected with d3 (Mercator fitted to them).
// The fields span about 1.7 x 1.7 km, so a square map gives River field (440 m wide) room for its labels.
const MAP = { w: 360, h: 360, pad: 20 };

function validRing(ring) {
  if (!Array.isArray(ring)) return null;
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return pts.length >= 3 ? pts : null;
}

function closed(pts) {
  const [a, b] = [pts[0], pts.at(-1)];
  return a[0] === b[0] && a[1] === b[1] ? pts : [...pts, a];
}

/** [lon, lat] -> [x, y] in the map viewBox. Without d3 (the CDN did not load) an equirectangular fit, which looks the same at field scale. */
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

/** Where a horizontal line at y crosses a closed ring: [x0, x1] pairs inside it. */
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
    const summary = fieldSummary(f, atRisk);
    const second = state === "harvested" ? "harvested" : state === "cover" ? "cover crop" : `${pct0(f.soilMoisturePct)} moisture`;
    const third = f.harvested ? "" : `~${tonnes(f.yieldEstimateT)} t`;
    const d = `M${corners.map((p) => `${f1(p[0])},${f1(p[1])}`).join("L")}Z`;
    return {
      cx,
      cy,
      markup: html`
        <a class="farm-plot-link" href="#${fieldToken(f.id)}" aria-label="${summary}. Open the field." data-focus-key="plot-${FIELD_IDS[f.id]}">
          <title>${summary}</title>
          <path class="farm-plot is-${state}${atRisk ? " is-hail-risk" : ""}" d="${d}"></path>
          ${plotTexture(state, ring)}
          <text class="farm-plot-name on-${state}" x="${f1(cx)}" y="${f1(cy - (third ? 8 : 2))}" text-anchor="middle">${f.emoji || FALLBACK_EMOJI[f.crop] || ""} ${f.id}</text>
          <text class="farm-plot-val on-${state}" x="${f1(cx)}" y="${f1(cy + (third ? 7 : 12))}" text-anchor="middle">${second}</text>
          ${third ? html`<text class="farm-plot-val on-${state}" x="${f1(cx)}" y="${f1(cy + 20)}" text-anchor="middle">${third}</text>` : ""}
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
    <svg class="farm-map-svg" viewBox="0 0 ${MAP.w} ${MAP.h}" role="group" aria-label="Field map of ${OWN_FARM.name}">
      <rect class="farm-map-bg" width="${MAP.w}" height="${MAP.h}"></rect>
      <g class="farm-tracks" aria-hidden="true">
        ${plots.map((p) => html`<path d="M${f1(yx)} ${f1(yy)}L${f1(p.cx)} ${f1(p.cy)}"></path>`)}
      </g>
      ${plots.map((p) => p.markup)}
      <g class="farm-yard" role="img" aria-label="Farmyard">
        <title>Farmyard</title>
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

// -- field tiles ----------------------------------------------------------------------------
function moistureBar(f, state) {
  const m = Math.max(0, Math.min(100, f.soilMoisturePct));
  const t = Math.max(0, Math.min(100, f.stressThresholdPct));
  return html`<div class="farm-moist" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m)}"
    aria-valuetext="${pct0(f.soilMoisturePct)} soil moisture, stress below ${pct0(f.stressThresholdPct)}" aria-label="${f.name} soil moisture">
    <span class="farm-moist-fill is-${state}" style="width:${m.toFixed(1)}%"></span>
    <span class="farm-moist-tick" style="left:${t.toFixed(1)}%" title="Stress below ${pct0(f.stressThresholdPct)}"></span>
  </div>`;
}

function harvestLine(f) {
  if (f.coverCrop) return "Harvested · cover crop sown";
  if (f.harvested) return "Harvested · no cover crop yet";
  if (f.harvestReady) {
    const waiting = f.harvestWaitingDays > 0 ? ` · waiting ${plural(f.harvestWaitingDays, "day")}` : "";
    return html`<b>Ready to harvest</b>${waiting}`;
  }
  return `${plural(Math.max(0, Math.round(f.daysToHarvest)), "day")} to harvest`;
}

const diseaseLabel = (p) => (p >= 0.6 ? "high" : p >= 0.3 ? "medium" : "low");

function fieldTile(f, snap) {
  const state = fieldState(f);
  const stressed = isStressed(f);
  const atRisk = Boolean(snap.hailDate) && hailAtRisk(f);
  const href = `#${fieldToken(f.id)}`;
  const key = FIELD_IDS[f.id];
  const remembers = f.recentRejections?.at(-1);
  return html`
    <article class="card farm-field${stressed ? " is-stressed" : ""}${atRisk ? " is-hail-risk" : ""}" aria-labelledby="farm-field-${key}"${
      stressed ? raw(` style="${phase(PULSE_MS)}"`) : ""
    }>
      <header class="farm-field-head">
        <h3 id="farm-field-${key}"><span class="farm-emoji" aria-hidden="true">${f.emoji || FALLBACK_EMOJI[f.crop] || ""}</span>
          <a href="${href}" data-focus-key="field-${key}">${f.name}</a></h3>
        ${chip(f.stage, "", { plain: true })}
      </header>
      <p class="farm-field-crop">${f.crop} · ${fmt(f.areaHa)} ha ${f.irrigable ? chip("Irrigable", "accent", { plain: true, title: "This field has irrigation equipment" }) : ""}</p>
      ${moistureBar(f, state)}
      <p class="farm-field-moist">
        <span title="Plant-available water in the root zone"><b>Soil moisture ${pct0(f.soilMoisturePct)}</b></span>
        <span title="Below this the crop is water-stressed">stress below ${pct0(f.stressThresholdPct)}</span>
        ${stressed ? chip("Below the stress line", "crit") : ""}
      </p>
      <dl class="farm-facts">
        <div><dt>Health</dt><dd>${fixed(f.cropHealth, 2)}</dd></div>
        <div><dt>Disease</dt><dd>${fixed(f.diseasePressure, 2)} · ${diseaseLabel(f.diseasePressure)}</dd></div>
        <div><dt>Yield estimate</dt><dd>~${tonnes(f.yieldEstimateT)} t</dd></div>
      </dl>
      <p class="farm-field-harvest">${harvestLine(f)}</p>
      ${atRisk ? html`<p class="farm-field-risk">${icon("hail")}Hail expected ${snap.hailDate}: harvest this ripe crop before it hits.</p>` : ""}
      ${remembers ? html`<p class="farm-remembers">${FIELD_AGENT_NAMES[f.id] ?? "Field agent"} remembers: “${remembers}”</p>` : ""}
      <a class="btn btn-ghost farm-field-open" href="${href}" aria-label="Open ${f.name}" data-focus-key="open-${key}">Open ${f.name} ›</a>
    </article>
  `;
}

// -- farms strip -------------------------------------------------------------------------------
function farmCard(row, ctx) {
  const tone = farmTone(row);
  const fill = row.storageCapacityT ? 1 - row.storageFreeT / row.storageCapacityT : 0;
  const name = row.isOwn
    ? html`<span>${row.name}</span>`
    : html`<a href="#${farmToken(ctx, row.id)}" data-focus-key="peer-${row.id}">${row.name}</a>`;
  return html`
    <article class="card farm-peer is-${tone}">
      <div class="farm-peer-head">
        <h3>${name}</h3>
        ${row.isOwn ? chip("This farm", "accent", { plain: true }) : ""}
      </div>
      <p class="farm-peer-crops">${row.crops} · ${fmt(row.areaHa)} ha</p>
      <dl class="farm-facts">
        <div><dt>Silo free</dt><dd>${tonnes(row.storageFreeT)} t</dd></div>
        <div><dt>Combine</dt><dd>${row.combineAvailable > 0 ? "free" : "busy"}</dd></div>
        <div><dt>Soil moisture</dt><dd>${pct0(row.avgSoilMoisturePct)}</dd></div>
      </dl>
      ${fillBar(fill, `${row.name}: silo ${pct(fill)} full`)}
      <div class="farm-peer-foot">
        ${chip(FARM_TONE_LABEL[tone], tone, { title: FARM_TONE_RULE })}
        <span class="faint">Updated ${ctx.snap.date}</span>
      </div>
    </article>
  `;
}

// -- plan card ------------------------------------------------------------------------------------
function draftFor(ctx, bundleId) {
  return ctx.ui.drafts[bundleId] ?? { choice: REJECT_REASONS[0], custom: "" };
}

function reasonOf(draft) {
  return draft.choice === OTHER_REASON ? draft.custom.trim() : draft.choice;
}

/** Plain words for an action the Safety check blocked (blocked actions have no plan row). */
function actionLabel(a) {
  const farm = a?.farm;
  switch (a?.type) {
    case "irrigate":
      return a.mm != null ? `Irrigate ${fmt(a.mm)} mm` : "Irrigate";
    case "spray":
      return a.product ? `Spray ${a.product}` : "Spray";
    case "fertilize":
      return a.kgNHa != null ? `Fertilize ${fmt(a.kgNHa)} kg N/ha` : "Fertilize";
    case "borrow_combine":
      return farm ? `Harvest with ${farm}'s combine` : "Borrow a neighbour's combine";
    case "deliver_to":
      return `Deliver ${tonnes(a.tonnes)} t to ${farm || "a neighbour"}`;
    case "harvest":
      return "Harvest";
    case "scout":
      return "Scout field";
    case "defer_task":
      return "Wait";
    case "sow_cover_crop":
      return "Sow cover crop";
    default:
      return capitalise(String(a?.type ?? "action").replaceAll("_", " "));
  }
}

const RES_LINE = [
  { key: "waterM3", label: "Water", unit: " m³" },
  { key: "workers", label: "Workers", unit: "" },
  { key: "combine", label: "Combine", unit: "" },
  { key: "sprayer", label: "Sprayer", unit: "" },
  { key: "storageFreeT", label: "Silo free", unit: " t" },
];

function resourceDelta(b) {
  const before = b.resourcesBefore ?? {};
  const after = b.resourcesAfter ?? {};
  // The sprayer only shows up when the plan actually uses it.
  const items = RES_LINE.filter(({ key }) => Number.isFinite(before[key])).filter(
    ({ key }) => key !== "sprayer" || (after[key] ?? before[key]) !== before[key],
  );
  if (!items.length) return "";
  return html`
    <div class="farm-delta-wrap">
      <p class="faint farm-caption">Available today → left if you approve</p>
      <dl class="farm-delta">
        ${items.map(({ key, label, unit }) => {
          const now = before[key];
          const then = Number.isFinite(after[key]) ? after[key] : now;
          const d = then - now;
          const show = key === "storageFreeT" ? tonnes : fmt;
          const sign = show(Math.abs(d)) === "0" ? "±0" : d > 0 ? `+${show(d)}` : `−${show(-d)}`;
          return html`<div${d < -0.05 ? raw(' class="is-used"') : ""}><dt>${label}</dt><dd><span class="mono">${show(now)} → ${show(then)}${unit}</span> <span class="faint mono">${sign}</span></dd></div>`;
        })}
      </dl>
    </div>
  `;
}

function planTable(rows, snap) {
  if (!rows?.length) return html`<p class="muted">No field work planned for this day.</p>`;
  const emoji = Object.fromEntries(ownFields(snap).map((f) => [f.crop, f.emoji]));
  return html`
    <div class="farm-plan-table-wrap">
      <table class="table farm-plan-table" role="table">
        <caption class="sr-only">Proposed field work, one row per action</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">Field</th>
            <th scope="col" role="columnheader">Crop</th>
            <th scope="col" role="columnheader">Action</th>
            <th scope="col" role="columnheader">Resources</th>
            <th scope="col" role="columnheader">Confidence</th>
            <th scope="col" role="columnheader">Reason</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          ${rows.map((r) => {
            const ring = RING_ACTIONS.has(r.actionType);
            return html`<tr role="row"${ring ? raw(' class="is-ring"') : ""}>
              <th scope="row" role="rowheader" class="farm-pt-field">${FIELD_NAMES[r.field] ?? r.field}</th>
              <td role="cell" class="farm-pt-crop">${emoji[r.crop] || FALLBACK_EMOJI[r.crop] || ""} ${r.crop}</td>
              <td role="cell" class="farm-pt-what">${r.what}${ring ? html` ${chip("Machinery ring", "accent", { plain: true })}` : ""}</td>
              <td role="cell" class="farm-pt-res" data-label="Uses">${r.resources || "—"}</td>
              <td role="cell" class="farm-pt-conf">${confBar(r.confidence)}</td>
              <td role="cell" class="farm-pt-reason">${r.reason}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function blockedList(safety) {
  const blocked = (safety ?? []).filter((s) => s.blocked);
  if (!blocked.length) return "";
  return html`
    <div class="farm-blocked">
      <h4>Safety check blocked</h4>
      <ul>
        ${blocked.map(
          (s) => html`<li>${icon("shield")}<div><b>${FIELD_NAMES[s.field] ?? s.field}</b>: ${actionLabel(s.action)}<br /><span class="farm-rule">${
            s.rule ?? "Blocked by a safety rule."
          }</span></div></li>`,
        )}
      </ul>
    </div>
  `;
}

function hasNeighbourHelp(b) {
  if ((b.planRows ?? []).some((r) => RING_ACTIONS.has(r.actionType))) return true;
  return (b.proposals ?? []).some((p) => (p.actions ?? []).some((a) => RING_ACTIONS.has(a.type)));
}

function neighbourHelp(capacity) {
  // Our own farm answers the Machinery ring too, but it never borrows from itself.
  const rows = (capacity ?? []).filter((c) => c.farm !== OWN_FARM.name);
  if (!rows.length) return "";
  return html`
    <div class="farm-help">
      <h4>Neighbour help</h4>
      <p class="faint farm-caption">What the neighbour farms told the Machinery ring they can share.</p>
      <ul>
        ${rows.map(
          (c) => html`<li>
            <div class="farm-help-top"><span>${icon("tractor")}<b>${c.farm}</b></span> ${confBar(c.confidence)}</div>
            <div>Can share <b>${fmt(c.canShare?.combine)} combine</b> and <b>${tonnes(c.canShare?.storageT)} t</b> of storage until ${c.validUntil}</div>
            ${c.note ? html`<div class="muted">${c.note}</div>` : ""}
          </li>`,
        )}
      </ul>
    </div>
  `;
}

function planCard(ctx, b) {
  const draft = draftFor(ctx, b.id);
  const reason = reasonOf(draft);
  const other = draft.choice === OTHER_REASON;
  const conf = b.overallConfidence;
  const error = ctx.ui.farm.error?.bundleId === b.id ? ctx.ui.farm.error.message : "";
  return html`
    <section class="card farm-plan" aria-labelledby="farm-plan-title">
      <div class="eyebrow">Plan for the day</div>
      <h3 id="farm-plan-title" tabindex="-1">Plan for ${b.planFor}</h3>
      ${resourceDelta(b)}
      ${planTable(b.planRows, ctx.snap)}
      ${
        conf === null || conf === undefined
          ? ""
          : html`<div class="row farm-conf">
              <span>Overall confidence</span> ${confBar(conf)}
              ${conf < 0.5 ? chip("Low confidence: review carefully", "warn", { title: "The least certain action is below 0.50" }) : ""}
            </div>`
      }
      <p class="farm-summary"><span class="actor">Coordinator:</span> ${b.summary}</p>
      ${blockedList(b.safety)}
      ${hasNeighbourHelp(b) ? neighbourHelp(b.nearbyCapacity) : ""}
      <div class="farm-decide">
        ${error ? html`<p class="farm-plan-error">${icon("shield")}<span>${error}</span></p>` : ""}
        <button type="button" class="btn btn-ok" data-action="approve" data-bundle="${b.id}" data-focus-key="approve-${b.id}">Approve plan</button>
        <form class="farm-reject" data-reject="${b.id}">
          <label class="farm-label" for="farm-reject-reason-${b.id}">If you reject, why?</label>
          <select class="select" id="farm-reject-reason-${b.id}" data-draft="choice" data-bundle="${b.id}" data-focus-key="reason-${b.id}">
            ${REJECT_REASONS.map((r) => html`<option value="${r}"${r === draft.choice ? raw(" selected") : ""}>${r}</option>`)}
          </select>
          <input class="input" id="farm-reject-custom-${b.id}" data-draft="custom" data-bundle="${b.id}" data-focus-key="custom-${b.id}" type="text"
            maxlength="200" autocomplete="off" placeholder="Type a reason" aria-label="Your reason"
            value="${draft.custom}"${other ? "" : raw(" hidden")} />
          <button type="submit" class="btn btn-danger" data-focus-key="reject-${b.id}"${reason ? "" : raw(" disabled")}>Reject plan</button>
        </form>
        <p class="faint farm-caption">Your reason is sent back to the field agents and shapes their next plan.</p>
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
    <section class="card farm-plan" aria-labelledby="farm-plan-title">
      <div class="eyebrow">Plan for the day</div>
      <h3 id="farm-plan-title" tabindex="-1">No plan is waiting</h3>
      <p class="muted">Press Next day and the field agents will propose the work for that day.</p>
      ${
        decided.length
          ? html`<h4 class="farm-subhead">Recent plans</h4>
            <ul class="farm-history">
              ${decided.map(
                (b) => html`<li>
                  <span class="mono">${b.planFor}</span>
                  ${chip(STATUS_LABEL[b.status] ?? b.status, STATUS_TONE[b.status] ?? "")}
                  ${b.status === "rejected" && b.reason ? html`<span class="farm-history-reason">“${b.reason}”</span>` : ""}
                </li>`,
              )}
            </ul>`
          : ""
      }
    </section>
  `;
}

// -- team conversation and notices ------------------------------------------------------------------
function logTone(e) {
  if (e.level === "block") return "block";
  if (e.level === "decision") return e.text.startsWith("rejected") ? "rejected" : "approved";
  if (e.level === "warn") return "warn";
  return "info";
}

/** An icon for a conversation line, from its level, actor and words (there is no icon field). */
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
  if (AGENT_NAMES.has(e.actor)) return "leaf";
  if (e.level === "warn") return "alert";
  if (e.actor === "Farm") return "barn";
  if (e.actor === "Farm manager") return "person";
  return "";
}

/** Newest-first entries grouped by day, keeping the order. */
function byDay(entries) {
  const groups = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups;
}

function conversationCard(log) {
  const lines = log.slice(0, LOG_LIMIT);
  return html`
    <section class="card" aria-labelledby="farm-log-title">
      <h3 id="farm-log-title">Team conversation</h3>
      <p class="faint farm-caption">Newest first. The field agents, the Coordinator, the Safety check, the Machinery ring, the farm and you.</p>
      <div class="farm-scroll" data-keep-scroll="log" tabindex="0" role="region" aria-label="Team conversation, newest first">
        ${
          lines.length
            ? html`<ol class="farm-log">
                ${byDay(lines).map(
                  (g) => html`<li class="farm-log-day">
                    <h4 class="farm-log-date"><time>${g.date}</time></h4>
                    <ol class="feed farm-log-list">
                      ${g.items.map((e) => {
                        const name = logIcon(e);
                        return html`<li class="farm-log-${logTone(e)}">
                          ${name ? icon(name) : html`<span class="farm-ic" aria-hidden="true"></span>`}
                          <div><span class="actor">${e.actor}</span> ${e.text}</div>
                        </li>`;
                      })}
                    </ol>
                  </li>`,
                )}
              </ol>`
            : html`<p class="muted">Nobody has said anything yet.</p>`
        }
      </div>
    </section>
  `;
}

const AUDIENCE_TONE = { Buyers: "accent", "Beekeepers & neighbours": "warn" };

function noticesCard(notices) {
  return html`
    <section class="card" aria-labelledby="farm-notices-title">
      <h3 id="farm-notices-title">What buyers &amp; neighbours see</h3>
      ${
        notices.length
          ? html`<div class="farm-scroll farm-scroll-short" data-keep-scroll="notices" tabindex="0" role="region" aria-label="Notices, newest first">
              <ol class="farm-bubbles">
                ${notices.map((n) => {
                  const audience = n.audience || "Everyone";
                  const prefix = `${audience}: `;
                  const text = n.text.startsWith(prefix) ? n.text.slice(prefix.length) : n.text; // the chip already says who
                  return html`<li>
                    <div class="farm-bubble-head">${chip(audience, AUDIENCE_TONE[audience] ?? "", { plain: !AUDIENCE_TONE[audience] })}<time>${n.date}</time></div>
                    <p>${text}</p>
                  </li>`;
                })}
              </ol>
            </div>`
          : html`<p class="muted">Buyers and neighbours only hear about approved plans. Nothing approved yet.</p>`
      }
    </section>
  `;
}

// -- handlers --------------------------------------------------------------------------------
function onOwnClick(event, ctx) {
  const target = event.target;
  const approve = target.closest("[data-action='approve']");
  if (approve) {
    approvePlan(ctx, Number(approve.dataset.bundle));
    return;
  }
  if (target.closest("[data-action='jump-plan']")) {
    const title = event.currentTarget.querySelector("#farm-plan-title");
    if (!title) return;
    title.scrollIntoView({ block: "start" });
    title.focus({ preventScroll: true });
  }
}

/** The message of whatever decide() threw, in plain words (never a stack trace). */
function errorText(err) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || "The plan could not be decided. Please try again.";
}

function showDecideError(ctx, bundleId, err) {
  const message = errorText(err);
  ctx.ui.farm.error = { bundleId, message };
  ctx.toast(message);
  ctx.rerender();
}

function approvePlan(ctx, bundleId) {
  const { twin } = ctx;
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
  ctx.ui.farm.error = null;
  // Notices are stamped with the day of the approval, which is the plan's day.
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
  if (twin.bundles().find((b) => b.id === bundleId)?.status !== "expired") return false;
  const draft = ctx.ui.drafts[bundleId];
  delete ctx.ui.drafts[bundleId];
  if (ctx.ui.farm.error?.bundleId === bundleId) ctx.ui.farm.error = null;
  const next = twin.snapshot().pendingBundle;
  const keep = draft && reasonOf(draft);
  if (keep && next && !ctx.ui.drafts[next.id]) ctx.ui.drafts[next.id] = draft;
  ctx.toast(
    keep
      ? "This plan expired before you decided. Your reason is kept for the next plan."
      : "This plan expired before you decided.",
  );
  ctx.rerender();
  return true;
}

function onRejectSubmit(event, ctx) {
  const form = event.target.closest("form[data-reject]");
  if (!form) return;
  event.preventDefault();
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
  ctx.ui.farm.error = null;
  // Enter in the reason box submits with the focus still in it, and re-renders wait while a
  // text box has focus: hand the focus to the Reject button so the decided plan can go.
  const submit = form.querySelector?.("button[type='submit']");
  if (submit && form.contains?.(form.ownerDocument?.activeElement)) submit.focus();
  ctx.toast(`Plan rejected: ${reason}`);
}

// =====================================================================================
// Neighbour farm
// =====================================================================================
function renderNeighbour(container, ctx, farm) {
  const { snap, twin } = ctx;
  const row = snap.farms.find((r) => r.id === farm.id) ?? null;
  const history = twin.farmHistory(farm.name);
  const reports = twin.farmReports(farm.name);
  const latest = snap.nearbyCapacity?.[farm.name] ?? null;
  const showTable = ctx.ui.farm.showTable;
  const tone = row ? farmTone(row) : "ok";
  const capacity = row?.storageCapacityT ?? 0;
  const since = history.length ? history[0].date : "the start of the season";

  container.innerHTML = String(html`
    <div class="view-head">
      <div>
        <div class="eyebrow">Neighbour farm · ${REGION.name} machinery ring</div>
        <h1>${farm.name}</h1>
        <p>${row?.crops ?? farm.crops} · ${fmt(row?.areaHa ?? farm.areaHa)} ha. Reports its spare combine and silo space to the Machinery ring every day. Detailed twin available for ${OWN_FARM.name}.</p>
      </div>
      <div class="row farm-chips">
        ${row ? chip(`${FARM_TONE_LABEL[tone]} · soil ${pct0(row.avgSoilMoisturePct)}`, tone, { title: FARM_TONE_RULE }) : ""}
      </div>
    </div>
    <div class="layout">
      <section class="stage stack" aria-label="What ${farm.name} reports">
        ${row ? neighbourTiles(row) : html`<p class="muted">No report from this farm yet.</p>`}
        <section class="card farm-chart-card" aria-labelledby="farm-chart-title">
          <div class="farm-chart-head">
            <div>
              <h3 id="farm-chart-title">Silo space and soil moisture since ${since}</h3>
              <p class="faint farm-caption">One point per day, as reported to the Machinery ring.</p>
            </div>
            <div class="legend farm-chart-legend">
              <span><i class="farm-key is-silo"></i>Silo space free</span>
              <span><i class="farm-key is-soil"></i>Soil moisture</span>
              <span><i class="farm-dot-key is-free"></i>Combine free</span>
              <span><i class="farm-dot-key is-busy"></i>Combine busy</span>
            </div>
          </div>
          <div class="farm-chart" data-farm-chart>${historyChart(history, capacity, chartWidth(container))}</div>
          ${
            history.length
              ? html`<button type="button" class="btn btn-ghost farm-table-toggle" data-action="toggle-table" data-focus-key="toggle-table" aria-expanded="${showTable}" aria-controls="farm-history-table">
                  ${showTable ? "Hide the numbers" : "Show the numbers"}
                </button>`
              : ""
          }
          ${showTable ? historyTable(history) : ""}
        </section>
      </section>
      <aside class="panel" aria-label="Reports">
        <section class="card" aria-labelledby="farm-reports-title">
          <h3 id="farm-reports-title">Latest reports</h3>
          <p class="faint farm-caption">What this farm's agent told the Machinery ring it can share.</p>
          ${
            reports.length
              ? html`<ol class="farm-reports">
                  ${reports.slice(0, 3).map(
                    (r) => html`<li>
                      <div class="farm-report-top"><span class="mono">${r.planFor}</span> ${confBar(r.confidence)}</div>
                      <div>Can share <b>${fmt(r.canShare?.combine)} combine</b> and <b>${tonnes(r.canShare?.storageT)} t</b> of storage</div>
                      ${r.note ? html`<div class="muted">${r.note}</div>` : ""}
                    </li>`,
                  )}
                </ol>`
              : html`<p class="muted">No reports yet this season. The first one comes with the next plan.</p>`
          }
          ${
            latest
              ? html`<dl class="kv farm-latest">
                  <dt>Offer valid until</dt><dd class="mono">${latest.validUntil}</dd>
                </dl>`
              : ""
          }
        </section>
        <p class="faint farm-caption farm-note">Detailed twin available for ${OWN_FARM.name}: fields, plans and the team conversation.</p>
        <div class="row">
          <a class="btn" href="#${regionToken(ctx)}" data-focus-key="back-region">‹ Back to ${REGION.name}</a>
          <a class="btn btn-ghost" href="#${farmToken(ctx, OWN_FARM.id)}" data-focus-key="open-own">Open ${OWN_FARM.name}</a>
        </div>
      </aside>
    </div>
  `);

  container.onchange = container.oninput = container.onsubmit = null;
  container.onclick = (event) => {
    if (!event.target.closest("[data-action='toggle-table']")) return;
    ctx.ui.farm.showTable = !ctx.ui.farm.showTable;
    ctx.rerender();
  };
}

function neighbourTiles(row) {
  const cap = row.storageCapacityT;
  const fill = cap ? 1 - row.storageFreeT / cap : 0;
  const combineFree = row.combineAvailable > 0;
  return html`
    <div class="farm-tiles">
      <div class="card farm-tile">
        <div class="farm-res-label">${icon("silo")}<span>Silo space free</span></div>
        <div class="stat"><span class="stat-value">${tonnes(row.storageFreeT)} t</span><span class="stat-label">of ${tonnes(cap)} t capacity</span></div>
        ${fillBar(fill, `Silo ${pct(fill)} full`)}
      </div>
      <div class="card farm-tile">
        <div class="farm-res-label">${icon("tractor")}<span>Combine</span></div>
        <div class="stat"><span class="stat-value">${combineFree ? "Free today" : "Busy today"}</span><span class="stat-label">One machine</span></div>
        ${chip(combineFree ? "Can lend it" : "Not available", combineFree ? "ok" : "", { plain: !combineFree })}
      </div>
      <div class="card farm-tile">
        <div class="farm-res-label">${icon("drop")}<span>Soil moisture</span></div>
        <div class="stat"><span class="stat-value">${pct0(row.avgSoilMoisturePct)}</span><span class="stat-label">Farm average</span></div>
      </div>
      <div class="card farm-tile">
        <div class="farm-res-label">${icon("leaf")}<span>Crops</span></div>
        <div class="stat"><span class="stat-value farm-tile-crops">${row.crops}</span><span class="stat-label">${fmt(row.areaHa)} ha</span></div>
      </div>
    </div>
  `;
}

// -- neighbour history chart: two small multiples on one day axis ---------------------------------
/** Draw at the chart's real pixel width so labels stay 11px on a phone and on a wide screen. */
function chartWidth(container) {
  const existing = container.querySelector?.("[data-farm-chart]");
  if (existing?.clientWidth) return clampWidth(existing.clientWidth);
  const page = container.clientWidth;
  if (!page) return 640;
  const inner = page - 40; // .page padding
  return clampWidth(inner > 940 ? inner - 380 - 16 - 34 : inner - 34); // minus the panel and card padding
}

const clampWidth = (w) => Math.max(300, Math.min(960, Math.round(w)));

/** Round axis ticks: 0, step, 2*step ... covering [lo, hi]. */
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
  const m = { l: 58, r: 34 }; // room for the "Combine" row label and a centred last date
  const pw = W - m.l - m.r;
  const silo = { top: 26, h: 92 };
  const soil = { top: 152, h: 92 };
  const combineY = 266;
  const H = 300;
  const f = (v) => v.toFixed(1);
  const x = (i) => m.l + (i / (n - 1)) * pw;

  const siloTicks = niceTicks(0, Math.max(1, capacity || 0, ...history.map((h) => h.storageFreeT)), 3);
  const siloHi = siloTicks.at(-1);
  const ySilo = (v) => silo.top + silo.h - (Math.max(0, Math.min(siloHi, v)) / siloHi) * silo.h;
  const ySoil = (v) => soil.top + soil.h - (Math.max(0, Math.min(100, v)) / 100) * soil.h;
  const last = history.at(-1);

  // Label every k-th day, counted back from the latest so today is always labelled.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 76))));
  const xLabels = history.map((h, i) => ((n - 1 - i) % every === 0 ? { i, date: h.date } : null)).filter(Boolean);

  const colW = pw / (n - 1);
  const columns = history.map((h, i) => {
    const tip = `${h.date}: ${tonnes(h.storageFreeT)} t silo space free, soil moisture ${pct0(h.avgSoilMoisturePct)}, combine ${
      h.combineAvailable > 0 ? "free" : "busy"
    }`;
    const x0 = Math.max(m.l - 4, x(i) - colW / 2);
    const x1 = Math.min(W - m.r + 4, x(i) + colW / 2);
    return html`<g class="farm-col"><title>${tip}</title>
      <rect x="${f(x0)}" y="${silo.top - 4}" width="${f(Math.max(1, x1 - x0))}" height="${combineY + 10 - silo.top}"></rect>
      <line x1="${f(x(i))}" x2="${f(x(i))}" y1="${silo.top}" y2="${combineY + 6}"></line></g>`;
  });

  const series = (cls, y, value) => {
    const pts = history.map((h, i) => `${f(x(i))},${f(y(value(h)))}`).join(" ");
    return html`<g class="farm-series ${cls}">
      <polyline points="${pts}" fill="none"></polyline>
      <circle cx="${f(x(n - 1))}" cy="${f(y(value(last)))}" r="4"></circle>
    </g>`;
  };

  const summary = `${history[0].date} to ${last.date}. Silo space free now ${tonnes(last.storageFreeT)} t of ${tonnes(
    capacity,
  )} t, soil moisture now ${pct0(last.avgSoilMoisturePct)}, combine ${last.combineAvailable > 0 ? "free" : "busy"} today.`;

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
      <text class="farm-chart-title" x="${m.l}" y="${soil.top - 12}">Soil moisture (%) · now ${pct0(last.avgSoilMoisturePct)}</text>
      <g class="farm-grid">
        ${[0, 50, 100].map(
          (t) => html`<line x1="${m.l}" x2="${W - m.r}" y1="${f(ySoil(t))}" y2="${f(ySoil(t))}"${t === 0 ? raw(' class="is-zero"') : ""}></line>
            <text x="${m.l - 6}" y="${f(ySoil(t) + 4)}" text-anchor="end">${t}%</text>`,
        )}
      </g>
      <g class="farm-ref"><line x1="${m.l}" x2="${W - m.r}" y1="${f(ySoil(35))}" y2="${f(ySoil(35))}"></line>
        <text x="${W - m.r}" y="${f(ySoil(35) - 4)}" text-anchor="end">critical below 35%</text></g>
      <g class="farm-combine-row">
        <text class="farm-chart-axis" x="${m.l - 6}" y="${combineY + 4}" text-anchor="end">Combine</text>
        ${history.map(
          (h, i) => html`<circle class="${h.combineAvailable > 0 ? "is-free" : "is-busy"}" cx="${f(x(i))}" cy="${combineY}" r="4"></circle>`,
        )}
      </g>
      <g class="farm-xaxis">
        ${xLabels.map((l) => html`<text x="${f(x(l.i))}" y="${H - 6}" text-anchor="middle">${l.date}</text>`)}
      </g>
      <g class="farm-cols">${columns}</g>
      ${series("is-silo", ySilo, (h) => h.storageFreeT)}
      ${series("is-soil", ySoil, (h) => h.avgSoilMoisturePct)}
    </svg>
  `;
}

function historyTable(history) {
  return html`
    <div class="table-wrap farm-history-table" id="farm-history-table" data-keep-scroll="farm-history" role="region" aria-label="Daily reports, newest first" tabindex="0">
      <table class="table">
        <thead><tr><th>Day</th><th class="num">Silo free (t)</th><th class="num">Soil moisture</th><th>Combine</th></tr></thead>
        <tbody>
          ${[...history]
            .reverse()
            .map(
              (h) =>
                html`<tr><td class="mono">${h.date}</td><td class="num">${tonnes(h.storageFreeT)}</td><td class="num">${pct0(h.avgSoilMoisturePct)}</td><td>${
                  h.combineAvailable > 0 ? "free" : "busy"
                }</td></tr>`,
            )}
        </tbody>
      </table>
    </div>
  `;
}
