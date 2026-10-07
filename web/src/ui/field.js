// Level 5: one field of our own farm (North, West or River) - its soil moisture over the
// season with the next 3 days projected, the crop's numbers, where the field lies, the plans
// that touched it, what the farm manager said about them, and what its field agent sees.

import { FARMYARD, FIELDS, FIELD_AGENT_NAMES, FIELD_NAMES, FIELD_POLYGONS, OWN_FARM } from "../data/places.js";
import { chip, confBar, html, plural, raw } from "./dom.js";

const HISTORY_WINDOW = 28; // days of history drawn; older days scroll off the left
const TIP_CHAR_W = 6.6; // rough width of one 11px mono character, for sizing tooltip boxes
const NEAR_MARGIN = 10; // "close to" the stress line: less than this many points above it
const CEREALS = new Set(["winter wheat", "rapeseed"]); // ripen, need the combine, and are what hail ruins
const HAIL_RISK_DAYS = 4; // a standing cereal this close to harvest loses 40 % when the hail hits
const FULL_HEALTH = 0.85; // the yield estimate scales with health up to this, then stays at 100 %

const PLAN_TONE = { approved: "ok", rejected: "crit", expired: "warn", pending: "accent" };
const MOISTURE_LABEL = { ok: "Comfortable", warn: "Close to the stress line", crit: "Below the stress line" };
const DISEASE_TONE = { low: "ok", medium: "warn", high: "crit" };

// -- small helpers --------------------------------------------------------------------
const f1 = (n) => n.toFixed(1);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/** 1,234 for whole numbers (within 0.05), 12.3 otherwise. */
function fmt(value) {
  const v = Number(value) || 0;
  if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v).toLocaleString("en-US");
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Tonnes: whole tonnes from 100 t up ("~328 t"), else one decimal. */
const tonnes = (t) => (Math.abs(t) >= 100 ? Math.round(t).toLocaleString("en-US") : fmt(t));

/** "Tue 7 Jul" -> "7 Jul", for axis labels. */
const shortDate = (label) => String(label ?? "").split(" ").slice(1).join(" ") || String(label ?? "");

function moistureTone(f) {
  if (f.soilMoisturePct < f.stressThresholdPct) return "crit";
  if (f.soilMoisturePct < f.stressThresholdPct + NEAR_MARGIN) return "warn";
  return "ok";
}

/** Map / tab colour: cover crop, harvested stubble, else soil moisture against the stress line. */
function fieldFill(f) {
  if (f.coverCrop) return "var(--cover-crop)";
  if (f.harvested) return "var(--harvested)";
  return `var(--${moistureTone(f)})`;
}

const diseaseLabel = (p) => (p >= 0.6 ? "high" : p >= 0.3 ? "medium" : "low");

/** A ripe (or nearly ripe) cereal still standing: exactly what a hail storm hits. */
function hailAtRisk(f) {
  if (f.harvested) return false;
  if (f.harvestReady) return true;
  return CEREALS.has(f.crop) && f.daysToHarvest <= HAIL_RISK_DAYS;
}

function harvestText(f) {
  if (f.coverCrop) return "Harvested, cover crop sown";
  if (f.harvested) return "Harvested, no cover crop yet";
  if (f.harvestReady && CEREALS.has(f.crop)) return `Ready to harvest, waiting ${plural(f.harvestWaitingDays, "day")}`;
  if (f.harvestReady) return "Ready to harvest";
  return `${plural(f.daysToHarvest, "day")} to harvest`;
}

/** One sentence on where the crop stands, under the heading. */
function fieldStory(f) {
  const water = f.irrigable
    ? "irrigated from the farm's daily water permit"
    : "rain-fed, with no irrigation equipment";
  let now;
  if (f.coverCrop) now = `Harvested (${tonnes(f.yieldEstimateT)} t); a cover crop now protects the soil.`;
  else if (f.harvested) now = `Harvested (${tonnes(f.yieldEstimateT)} t); the stubble waits for a cover crop.`;
  else if (f.harvestReady && CEREALS.has(f.crop)) now = "Ripe and still standing: ripe grain loses yield every day it waits.";
  else if (f.harvestReady) now = "Mature and ready to harvest.";
  else now = `${plural(f.daysToHarvest, "day")} to harvest.`;
  return `${cap(f.crop)} on ${fmt(f.areaHa)} ha, ${water}. ${now}`;
}

// -- chart helpers --------------------------------------------------------------------------
/** Width to draw the chart at: the previous render's chart width, else a guess from the page. */
function chartWidth(container) {
  let w = container.querySelector?.(".fd-chart-box")?.clientWidth;
  const page = container.clientWidth;
  // page padding, panel and gap on wide screens, then the card's own padding
  if (!w && page) w = page > 980 ? page - 40 - 380 - 16 - 34 : page - 32 - 34;
  return Math.round(Math.max(280, Math.min(780, w || 720)));
}

/** One slot per day, from the first history day to the last projected one. */
function timeAxis(rows, projection, width) {
  const m = { top: 30, right: 48, bottom: 30, left: 44 };
  const t0 = rows[0].tick;
  const tNow = rows.at(-1).tick;
  const tEnd = projection.length ? projection.at(-1).tick : tNow;
  const plotRight = width - m.right;
  const slotW = (plotRight - m.left) / (tEnd - t0 + 1);
  const x = (t) => m.left + (t - t0 + 0.5) * slotW;
  // Label every n days, counted back from today, so labels ("13 Jul", ~40px) stay ~56px apart.
  const every = [1, 2, 3, 7, 14].find((n) => n * slotW >= 56) ?? 28;
  // A label centred too close to the left edge would run into the y axis's "0%".
  const labelled = [];
  for (let t = t0; t <= tEnd; t++) if ((tNow - t) % every === 0 && x(t) - 20 >= m.left - 6) labelled.push(t);
  return { m, t0, tNow, tEnd, x, slotW, labelled, width, plotRight };
}

/** A column with a 4px rounded data-end and a square foot on the baseline. */
function barPath(x0, w, yTop, yBase) {
  const r = Math.max(0, Math.min(4, w / 2, yBase - yTop));
  return `M${f1(x0)},${f1(yBase)} V${f1(yTop + r)} Q${f1(x0)},${f1(yTop)} ${f1(x0 + r)},${f1(yTop)} H${f1(x0 + w - r)} Q${f1(
    x0 + w,
  )},${f1(yTop)} ${f1(x0 + w)},${f1(yTop + r)} V${f1(yBase)} Z`;
}

/** Rain at the bottom, irrigation stacked on top; the rounded end sits on the top segment. */
function waterBar(x0, w, rain, irrigation, y, base) {
  const parts = [];
  const rainTop = y(rain);
  if (rain >= 0.05) {
    parts.push(
      irrigation >= 0.05
        ? html`<rect x="${f1(x0)}" y="${f1(rainTop)}" width="${f1(w)}" height="${f1(base - rainTop)}" fill="var(--rain)" />`
        : html`<path d="${barPath(x0, w, rainTop, base)}" fill="var(--rain)" />`,
    );
  }
  if (irrigation >= 0.05) {
    const bottom = rain >= 0.05 ? rainTop - 1 : base;
    parts.push(html`<path d="${barPath(x0, w, y(rain + irrigation), bottom)}" fill="var(--irrigation)" />`);
  }
  return parts;
}

/** Hover layer: one invisible column per day that reveals a guide line and a small label box. */
function hoverColumns(axis, top, bottom, linesFor) {
  const half = Math.max(4, axis.slotW / 2);
  const cols = [];
  for (let t = axis.t0; t <= axis.tEnd; t++) {
    const cx = axis.x(t);
    const lines = linesFor(t);
    const boxW = Math.ceil(Math.max(...lines.map((l) => l.length)) * TIP_CHAR_W + 16);
    const boxH = lines.length * 15 + 10;
    const boxX = cx + 8 + boxW > axis.width - 2 ? cx - 8 - boxW : cx + 8;
    cols.push(html`<g class="fd-hit">
      <rect class="fd-hit-area" x="${f1(cx - half)}" y="${top}" width="${f1(half * 2)}" height="${bottom - top}" fill="transparent" />
      <g class="fd-tip" aria-hidden="true">
        <line x1="${f1(cx)}" x2="${f1(cx)}" y1="${top}" y2="${bottom}" stroke="var(--ink-3)" stroke-width="1" />
        <rect x="${f1(boxX)}" y="${top + 2}" width="${boxW}" height="${boxH}" rx="5" fill="var(--surface)" stroke="var(--line)" />
        ${lines.map(
          (l, i) =>
            html`<text class="${i === 0 ? "fd-tip-time" : "fd-tip-text"}" x="${f1(boxX + 8)}" y="${top + 19 + i * 15}">${l}</text>`,
        )}
      </g>
    </g>`);
  }
  return cols;
}

/** Rough box of an 11-12px mono label, for keeping direct labels apart. */
function labelBox(x, y, text, anchor = "start") {
  const w = String(text).length * TIP_CHAR_W;
  const x0 = anchor === "end" ? x - w : x;
  return { x0, x1: x0 + w, y0: y - 11, y1: y + 3 };
}
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function lineKey(stroke, { dashed = false, width = 2 } = {}) {
  return raw(
    `<svg class="fd-key" viewBox="0 0 22 10" width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${
      dashed ? ' stroke-dasharray="5 4"' : ""
    }/></svg>`,
  );
}

// -- the soil-moisture chart ---------------------------------------------------------------
function chartData(twin, field, f, snap) {
  const { history = [], projection = [], stressThresholdPct } = twin.fieldHistory(field) ?? {};
  const rows = history.slice(-HISTORY_WINDOW).map((r) => ({ ...r }));
  // Today's row is the live value the rest of the page shows (an approved irrigation adds to it).
  if (rows.length) rows.at(-1).soilMoisturePct = f.soilMoisturePct;
  const forecast = new Map((snap.forecast ?? []).map((w) => [w.date, w]));
  return { rows, projection, forecast, threshold: stressThresholdPct ?? f.stressThresholdPct };
}

function moistureChart(data, width, field) {
  const { rows, projection, forecast, threshold } = data;
  const axis = timeAxis(rows, projection, width);
  const { m, x, tNow, tEnd, plotRight, slotW } = axis;
  const H = 280;
  const plotBottom = H - m.bottom;
  const y = (v) => m.top + (plotBottom - m.top) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const dateOf = new Map([...rows.map((r) => [r.tick, r.date]), ...projection.map((p) => [p.tick, p.date])]);

  const nowX = x(tNow);
  const nowV = rows.at(-1).soilMoisturePct;
  const nowY = y(nowV);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${f1(x(r.tick))},${f1(y(r.soilMoisturePct))}`).join(" ");
  const projPath = [`M${f1(nowX)},${f1(nowY)}`, ...projection.map((p) => `L${f1(x(p.tick))},${f1(y(p.projectedMoisturePct))}`)].join(" ");
  const projEnd = projection.at(-1);

  // Rain and irrigation share the moisture axis: 1 mm of water is 1 % of plant-available water.
  const barW = Math.max(2, Math.min(14, slotW * 0.5));
  const bars = rows.map((r) => waterBar(x(r.tick) - barW / 2, barW, r.rainMm ?? 0, r.irrigationMm ?? 0, y, plotBottom));
  const forecastBars = projection.map((p) => {
    const rain = forecast.get(p.date)?.rainMm ?? 0;
    return rain >= 0.05
      ? html`<path d="${barPath(x(p.tick) - barW / 2, barW, y(rain), plotBottom)}" fill="var(--rain)" fill-opacity="0.4" />`
      : "";
  });

  const gridValues = [0, 25, 50, 75, 100];
  const grid = gridValues.map(
    (v) => html`<line class="fd-grid" x1="${m.left}" x2="${plotRight}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="var(--line)" />
      <text class="fd-axis" x="${m.left - 8}" y="${f1(y(v) + 4)}" text-anchor="end">${v}%</text>`,
  );
  const xLabels = axis.labelled.map(
    (t) => html`<line class="fd-tick" x1="${f1(x(t))}" x2="${f1(x(t))}" y1="${plotBottom}" y2="${plotBottom + 4}" stroke="var(--line)" />
      <text class="fd-axis" x="${f1(x(t))}" y="${plotBottom + 17}" text-anchor="middle">${shortDate(dateOf.get(t))}</text>`,
  );

  // Direct labels: today's value at the dot, the projection's end at the right edge, and
  // "today" with the projected region's name above the plot.
  // Today's value goes above its dot, or below it when above would sit on the stress line or
  // leave the plot.
  const thrY = y(threshold);
  const onStressLine = (ly) => thrY >= ly - 13 && thrY <= ly + 5;
  const fitsPlot = (ly) => ly - 11 >= m.top + 4 && ly <= plotBottom - 2;
  const dotLabelY =
    [nowY - 12, nowY + 20].find((ly) => fitsPlot(ly) && !onStressLine(ly)) ?? (nowY - 12 < m.top + 4 ? nowY + 20 : nowY - 12);
  const roomLeft = nowX - m.left >= 70;
  const roomRight = width - 2 - (nowX + 6);
  const regionText = [`next ${projection.length} days, projected`, `+${projection.length} days`].find(
    (t) => t.length * TIP_CHAR_W <= roomRight,
  );
  const showRegionLabel = projection.length && roomLeft && regionText;
  // The stress line's label: above it at the left, else below it, else at the right end -
  // wherever it clears today's value and the projection's end label.
  const stressText = `stress below ${fmt(threshold)}%`;
  const nowText = `${Math.round(nowV)}%`;
  const taken = [labelBox(roomLeft ? nowX - 8 : nowX + 8, dotLabelY, nowText, roomLeft ? "end" : "start"), labelBox(nowX - 6, nowY + 6, "  ")];
  if (projEnd) taken.push(labelBox(x(projEnd.tick) + 8, y(projEnd.projectedMoisturePct) + 4, `~${Math.round(projEnd.projectedMoisturePct)}%`));
  const spots = [
    [m.left + 6, thrY - 6, "start"],
    [m.left + 6, thrY + 15, "start"],
    [plotRight - 4, thrY - 6, "end"],
    [plotRight - 4, thrY + 15, "end"],
  ].filter(([, ly]) => ly - 11 >= m.top && ly <= plotBottom - 2);
  const [stressX, stressY, stressAnchor] =
    spots.find(([lx, ly, anchor]) => !taken.some((b) => overlaps(b, labelBox(lx, ly, stressText, anchor)))) ?? spots[0] ?? [m.left + 6, thrY - 6, "start"];

  const byTick = new Map(rows.map((r) => [r.tick, r]));
  const projByTick = new Map(projection.map((p) => [p.tick, p]));
  const tip = (t) => {
    const r = byTick.get(t);
    if (r) {
      const lines = [t === tNow ? `${r.date} (today)` : r.date, `soil ${fmt(r.soilMoisturePct)}%`, `rain ${fmt(r.rainMm ?? 0)} mm`];
      if ((r.irrigationMm ?? 0) > 0) lines.push(`irrigation ${fmt(r.irrigationMm)} mm`);
      if (typeof r.cropHealth === "number") lines.push(`health ${r.cropHealth.toFixed(2)}`);
      return lines;
    }
    const p = projByTick.get(t);
    const rain = forecast.get(p.date)?.rainMm;
    const lines = [`${p.date} (projected)`, `soil ~${fmt(p.projectedMoisturePct)}%`, "if nobody irrigates"];
    if (rain !== undefined) lines.push(`forecast rain ${fmt(rain)} mm`);
    return lines;
  };

  const label = `${FIELD_NAMES[field]}: soil moisture from ${rows[0].date} to today, now ${fmt(nowV)}%, stress below ${fmt(threshold)}%. ${
    projEnd ? `Without irrigation, projected ${fmt(projEnd.projectedMoisturePct)}% on ${projEnd.date}.` : ""
  }`;

  return html`<svg class="fd-chart" viewBox="0 0 ${width} ${H}" width="100%" role="img" aria-label="${label}">
    ${
      projection.length
        ? html`<rect class="fd-ahead" x="${f1(nowX + slotW / 2)}" y="${m.top}" width="${f1(plotRight - nowX - slotW / 2)}" height="${plotBottom - m.top}" fill="var(--surface-2)" />`
        : ""
    }
    <rect class="fd-stress-band" x="${m.left}" y="${f1(thrY)}" width="${f1(plotRight - m.left)}" height="${f1(plotBottom - thrY)}" fill="var(--crit)" />
    ${grid}
    ${bars}
    ${forecastBars}
    <line class="fd-baseline" x1="${m.left}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}" stroke="var(--ink-3)" />
    ${xLabels}
    <line x1="${m.left}" x2="${plotRight}" y1="${f1(thrY)}" y2="${f1(thrY)}" stroke="var(--crit)" stroke-width="1.5" stroke-dasharray="6 4" />
    <path d="${projPath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round" />
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <text class="fd-stress" x="${f1(stressX)}" y="${f1(stressY)}" text-anchor="${stressAnchor}">${stressText}</text>
    <line x1="${f1(nowX)}" x2="${f1(nowX)}" y1="${m.top - 6}" y2="${plotBottom}" stroke="var(--ink-2)" stroke-width="1" />
    <text class="fd-now" x="${f1(roomLeft ? nowX - 5 : nowX + 5)}" y="${m.top - 12}" text-anchor="${roomLeft ? "end" : "start"}">today ${shortDate(
      rows.at(-1).date,
    )}</text>
    ${showRegionLabel ? html`<text class="fd-axis" x="${f1(nowX + 6)}" y="${m.top - 12}">${regionText}</text>` : ""}
    ${
      projEnd
        ? html`<text class="fd-value fd-value-soft" x="${f1(x(projEnd.tick) + 8)}" y="${f1(y(projEnd.projectedMoisturePct) + 4)}">~${Math.round(
            projEnd.projectedMoisturePct,
          )}%</text>`
        : ""
    }
    <circle cx="${f1(nowX)}" cy="${f1(nowY)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
    <text class="fd-value" x="${f1(roomLeft ? nowX - 8 : nowX + 8)}" y="${f1(dotLabelY)}" text-anchor="${roomLeft ? "end" : "start"}">${nowText}</text>
    ${hoverColumns(axis, m.top, plotBottom, tip)}
  </svg>`;
}

function dailyTable(data, show) {
  const { rows, projection, forecast } = data;
  const button = html`<button type="button" class="btn btn-ghost fd-toggle" data-action="toggle-days" data-focus-key="fd-toggle-days" aria-expanded="${show}" aria-controls="fd-days">
    ${show ? "Hide the daily numbers" : "Show the daily numbers"}
  </button>`;
  if (!show) return button;
  return html`${button}
    <div class="table-wrap fd-scroll" id="fd-days" data-keep-scroll="fd-days" role="region" aria-label="Daily numbers" tabindex="0">
      <table class="table">
        <thead><tr><th>Day</th><th>Soil moisture</th><th>Rain</th><th>Irrigation</th><th>Crop health</th><th>Yield estimate</th></tr></thead>
        <tbody>
          ${[...projection].reverse().map((p) => {
            const rain = forecast.get(p.date)?.rainMm;
            return html`<tr class="fd-row-ahead">
              <td class="mono">${p.date} <span class="faint">projected</span></td>
              <td class="num">~${fmt(p.projectedMoisturePct)}%</td>
              <td class="num">${rain === undefined ? html`<span class="faint">—</span>` : html`${fmt(rain)} mm <span class="faint">forecast</span>`}</td>
              <td class="faint">—</td><td class="faint">—</td><td class="faint">—</td>
            </tr>`;
          })}
          ${[...rows].reverse().map(
            (r, i) => html`<tr>
              <td class="mono">${r.date}${i === 0 ? html` <span class="faint">today</span>` : ""}</td>
              <td class="num">${fmt(r.soilMoisturePct)}%</td>
              <td class="num">${fmt(r.rainMm ?? 0)} mm</td>
              <td class="num">${(r.irrigationMm ?? 0) > 0 ? `${fmt(r.irrigationMm)} mm` : html`<span class="faint">—</span>`}</td>
              <td class="num">${typeof r.cropHealth === "number" ? r.cropHealth.toFixed(2) : "—"}</td>
              <td class="num">${typeof r.yieldEstimateT === "number" ? `~${tonnes(r.yieldEstimateT)} t` : "—"}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

function chartCard(data, field, width, showDays) {
  const days = data.projection.length;
  return html`<div class="card fd-card">
    <div class="fd-card-head">
      <div>
        <h3>Soil moisture</h3>
        <p class="muted">Plant-available water in the root zone, day by day since ${data.rows[0].date}, then the next ${plural(
          days,
          "day",
        )} projected from the forecast if nobody irrigates. Rain and irrigation share the scale: 1 mm of water is 1 % of soil moisture.</p>
      </div>
      <div class="legend" aria-hidden="true">
        <span>${lineKey("var(--accent)", { width: 2.5 })} Soil moisture</span>
        <span>${lineKey("var(--accent)", { dashed: true })} Projected</span>
        <span>${lineKey("var(--crit)", { dashed: true, width: 1.5 })} Stress line</span>
        <span><i class="swatch" style="background: var(--rain)"></i> Rain</span>
        <span><i class="swatch fd-swatch-soft" style="background: var(--rain)"></i> Forecast rain</span>
        <span><i class="swatch" style="background: var(--irrigation)"></i> Irrigation</span>
      </div>
    </div>
    <div class="fd-chart-box">${moistureChart(data, width, field)}</div>
    <div class="fd-days">${dailyTable(data, showDays)}</div>
  </div>`;
}

/** The census as the agent gets it, minus the internal day counter (people only ever see dates). */
function censusText(twin, field) {
  const { tick, ...census } = twin.census(field) ?? {};
  return JSON.stringify(census, null, 2);
}

function censusCard(twin, field, show) {
  const agent = FIELD_AGENT_NAMES[field];
  const button = html`<button type="button" class="btn btn-ghost fd-toggle" data-action="toggle-census" data-focus-key="fd-toggle-census" aria-expanded="${show}" aria-controls="fd-census">
    ${show ? "Hide the census" : "Show the census"}
  </button>`;
  return html`<div class="card fd-card">
    <div class="fd-card-head">
      <div>
        <h3>What the field agent sees</h3>
        <p class="muted">The census the ${agent} reads before it proposes the day's work: this field, today's weather and the forecast, the farm's resources and the farm manager's recent rejections.</p>
      </div>
    </div>
    <div class="fd-days">
      ${button}
      ${
        show
          ? html`<pre class="fd-census" id="fd-census" data-keep-scroll="fd-census" tabindex="0" role="region" aria-label="Census of the ${agent}">${censusText(twin, field)}</pre>`
          : ""
      }
    </div>
  </div>`;
}

// -- panel sections -----------------------------------------------------------------------------
function cropCard(f) {
  const tone = moistureTone(f);
  const diff = f.soilMoisturePct - f.stressThresholdPct;
  const disease = diseaseLabel(f.diseasePressure);
  const healthShare = Math.min(1, f.cropHealth / FULL_HEALTH);
  const moisture = Math.max(0, Math.min(100, f.soilMoisturePct));
  const threshold = Math.max(0, Math.min(100, f.stressThresholdPct));
  return html`<div class="card">
    <h3>The crop right now</h3>
    <div class="fd-stats">
      <div class="stat">
        <span class="stat-value">${Math.round(f.soilMoisturePct)}%</span>
        <span class="stat-label">soil moisture</span>
        <span class="fd-stat-sub">${
          f.harvested ? "the crop is off the field" : `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))} pts vs the stress line`
        }</span>
      </div>
      <div class="stat">
        <span class="stat-value">${f.cropHealth.toFixed(2)}</span>
        <span class="stat-label">crop health</span>
        <span class="fd-stat-sub">${healthShare >= 1 ? "full yield potential" : `yield held to ${Math.round(healthShare * 100)}%`}</span>
      </div>
      <div class="stat">
        <span class="stat-value">${f.diseasePressure.toFixed(2)}</span>
        <span class="stat-label">disease pressure</span>
        <span class="fd-stat-sub">${chip(disease, DISEASE_TONE[disease])}</span>
      </div>
      <div class="stat">
        <span class="stat-value">${f.harvested ? "" : "~"}${tonnes(f.yieldEstimateT)} t</span>
        <span class="stat-label">${f.harvested ? "harvested" : "yield estimate"}</span>
        <span class="fd-stat-sub">${fmt(f.areaHa ? f.yieldEstimateT / f.areaHa : 0)} t/ha</span>
      </div>
    </div>
    <div class="fd-moist">
      <div class="fd-moist-track" role="img" aria-label="Soil moisture ${fmt(f.soilMoisturePct)}%, stress below ${fmt(f.stressThresholdPct)}%">
        <span class="fd-moist-fill is-${f.harvested ? "done" : tone}" style="width: ${f1(moisture)}%"></span>
        <span class="fd-moist-tick" style="left: ${f1(threshold)}%"></span>
      </div>
      <span class="faint">${f.harvested ? "Soil moisture" : MOISTURE_LABEL[tone]} · stress below ${fmt(f.stressThresholdPct)}%</span>
    </div>
    <dl class="kv">
      <dt>Harvest</dt>
      <dd>${harvestText(f)}</dd>
      <dt>Stage</dt>
      <dd>${f.stage}</dd>
      <dt>Area</dt>
      <dd>${fmt(f.areaHa)} ha</dd>
      <dt>Irrigation</dt>
      <dd>${f.irrigable ? "equipped" : "none, rain-fed"}</dd>
      <dt>Last irrigated</dt>
      <dd>${f.lastIrrigatedDate ?? "—"}</dd>
      <dt>Last sprayed</dt>
      <dd>${f.lastSprayedDate ?? "—"}</dd>
    </dl>
  </div>`;
}

/** The farm's three fields at their real shape and position; this one in focus. */
function fieldMap(snap, current, routes) {
  const W = 340;
  const H = 230;
  const pad = 22;
  const rings = Object.fromEntries(FIELDS.map((f) => [f, snap.fields[f]?.polygon?.length >= 3 ? snap.fields[f].polygon : FIELD_POLYGONS[f]]));
  const points = [...Object.values(rings).flat(), [FARMYARD.lon, FARMYARD.lat]];
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180); // a degree of longitude is shorter up here
  const scale = Math.min((W - 2 * pad) / ((maxLon - minLon) * k), (H - 2 * pad) / (maxLat - minLat));
  const offX = (W - (maxLon - minLon) * k * scale) / 2;
  const offY = (H - (maxLat - minLat) * scale) / 2;
  const px = ([lon, lat]) => [offX + (lon - minLon) * k * scale, offY + (maxLat - lat) * scale];

  const fields = FIELDS.map((name) => {
    const f = snap.fields[name];
    const ring = rings[name].map(px);
    const corners = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
    const cx = corners.reduce((n, p) => n + p[0], 0) / corners.length;
    const cy = corners.reduce((n, p) => n + p[1], 0) / corners.length;
    const d = `M${corners.map((p) => `${f1(p[0])},${f1(p[1])}`).join(" L")} Z`;
    const isCurrent = name === current;
    const said = f ? `${f.crop}, ${f.harvested ? f.stage : `soil moisture ${Math.round(f.soilMoisturePct)}%`}` : "";
    return html`<a class="fd-map-field${isCurrent ? " is-current" : ""}" href="#${routes.field(name)}" data-focus-key="fd-map-${name}"${
      isCurrent ? raw(' aria-current="page"') : ""
    } aria-label="${FIELD_NAMES[name]}: ${said}">
      <path d="${d}" fill="${f ? fieldFill(f) : "var(--map-muted)"}" />
      <text class="fd-map-label" x="${f1(cx)}" y="${f1(cy + 4)}" text-anchor="middle">${name}</text>
    </a>`;
  });

  const [yx, yy] = px([FARMYARD.lon, FARMYARD.lat]);
  // 500 m scale bar: at this scale one metre is scale / 111,320 px in both directions.
  const bar = (500 * scale) / 111320;
  return html`<svg class="fd-map" viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="Fields of ${OWN_FARM.name}">
    <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="var(--map-land)" />
    ${fields}
    <circle cx="${f1(yx)}" cy="${f1(yy)}" r="4" fill="var(--ink-2)" stroke="var(--surface)" stroke-width="1.5" />
    <text class="fd-map-yard" x="${f1(yx)}" y="${f1(yy + 16)}" text-anchor="middle">Farmyard</text>
    <g aria-hidden="true">
      <line x1="12" x2="${f1(12 + bar)}" y1="${H - 14}" y2="${H - 14}" stroke="var(--ink-2)" stroke-width="2" />
      <text class="fd-map-yard" x="${f1(16 + bar)}" y="${H - 10}">500 m</text>
    </g>
  </svg>`;
}

function mapCard(snap, field, routes) {
  return html`<div class="card">
    <h3>Where the field lies</h3>
    <div class="fd-map-box">${fieldMap(snap, field, routes)}</div>
    <div class="legend fd-map-legend">
      <span><i class="swatch" style="background: var(--ok)"></i> Comfortable</span>
      <span><i class="swatch" style="background: var(--warn)"></i> Close to the stress line</span>
      <span><i class="swatch" style="background: var(--crit)"></i> Below it</span>
      <span><i class="swatch" style="background: var(--harvested)"></i> Harvested</span>
      <span><i class="swatch" style="background: var(--cover-crop)"></i> Cover crop</span>
    </div>
    <p class="faint fd-note">Colour: soil moisture against each crop's stress line. Select a field to open it.</p>
  </div>`;
}

function plansCard(plans, routes) {
  return html`<div class="card">
    <h3>Recent plans for this field</h3>
    ${
      plans.length
        ? html`<ul class="fd-list">
            ${plans.map(
              (p) => html`<li class="fd-plan">
                <span class="mono">${p.planFor}</span>
                ${chip(p.status, PLAN_TONE[p.status] ?? "")}
                <span class="fd-plan-conf">${
                  typeof p.confidence === "number"
                    ? html`<span class="faint">confidence</span> ${confBar(p.confidence)}`
                    : html`<span class="faint">no actions</span>`
                }</span>
              </li>`,
            )}
          </ul>
          ${
            plans.some((p) => p.status === "pending")
              ? html`<p class="fd-note"><a href="#${routes.farm(OWN_FARM.id)}" data-focus-key="fd-decide">Decide on the waiting plan at the farm</a></p>`
              : ""
          }`
        : html`<p class="muted">No plans for this field yet.</p>`
    }
  </div>`;
}

function rejectionsCard(f, field) {
  const said = [...(f.recentRejections ?? [])].reverse();
  return html`<div class="card">
    <h3>What the farm manager said recently</h3>
    ${
      said.length
        ? html`<div class="stack">
            ${said.map((text) =>
              text === "rejected"
                ? html`<p class="muted fd-quote">Rejected a plan without giving a reason.</p>`
                : html`<blockquote class="fd-quote">“${text}”</blockquote>`,
            )}
          </div>
          <p class="faint fd-note">The ${FIELD_AGENT_NAMES[field]} keeps these in mind for its next plans.</p>`
        : html`<p class="muted">No recent rejections.</p>`
    }
  </div>`;
}

// -- head ------------------------------------------------------------------------------------
function headChips(snap, f) {
  const chips = [];
  if (!f.harvested) {
    const tone = moistureTone(f);
    chips.push(chip(`${MOISTURE_LABEL[tone]} · ${Math.round(f.soilMoisturePct)}% soil moisture`, tone));
  }
  chips.push(chip(harvestText(f), f.harvestReady ? "warn" : f.harvested ? "ok" : ""));
  if (snap.hailDate && hailAtRisk(f)) chips.push(chip(`Hail expected ${snap.hailDate}: ripe crop at risk`, "crit"));
  if (snap.heatwaveDaysRemaining > 0 && !f.harvested) {
    if (f.irrigable) chips.push(chip(`Heatwave: water permit cut to ${fmt(snap.resources?.waterPermitM3)} m³`, "warn"));
    else if (CEREALS.has(f.crop)) chips.push(chip("Heatwave: ripening twice as fast", "warn"));
  }
  return chips;
}

function fieldTabs(snap, current, routes) {
  return html`<nav class="fd-tabs" aria-label="Fields of ${OWN_FARM.name}">
    ${FIELDS.map((name) => {
      const f = snap.fields[name];
      if (!f) return "";
      return html`<a class="fd-tab" href="#${routes.field(name)}" data-focus-key="fd-tab-${name}"${name === current ? raw(' aria-current="page"') : ""}>
        <span class="fd-tab-dot" style="background: ${fieldFill(f)}" aria-hidden="true"></span>
        <span class="fd-tab-name">${name}</span>
        <span class="fd-tab-meta mono">${f.harvested ? f.stage : `${Math.round(f.soilMoisturePct)}%`}</span>
      </a>`;
    })}
  </nav>`;
}

// -- view ------------------------------------------------------------------------------------
let lastRerender = null;
let resizeTimer = null;
if (typeof window !== "undefined") {
  // The chart is drawn at its real width so text stays readable; redraw after a resize.
  // Only a width change matters: phones fire resize when the address bar shows or hides.
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastRerender && document.querySelector(".fd-chart-box")) lastRerender();
    }, 200);
  });
}

export function render(container, ctx) {
  const { twin, snap, route, routes } = ctx;
  const field = route.field;
  const f = snap.fields?.[field];
  lastRerender = ctx.rerender;
  if (!f) {
    container.innerHTML = String(html`<p class="muted">This field is not part of the twin.</p>`);
    return;
  }
  const state = (ctx.ui.fieldView ??= { showDays: false, showCensus: false });
  const data = chartData(twin, field, f, snap);
  const width = chartWidth(container);

  container.innerHTML = String(html`
    <div class="view-head">
      <div class="fd-title">
        <span class="fd-emoji" aria-hidden="true">${f.emoji}</span>
        <div>
          <div class="eyebrow">${OWN_FARM.name} · Field</div>
          <h1>${FIELD_NAMES[field]}</h1>
          <p class="fd-facts">${cap(f.crop)} · ${fmt(f.areaHa)} ha · ${f.stage}</p>
          <p>${fieldStory(f)}</p>
        </div>
      </div>
      <div class="row">${headChips(snap, f)}</div>
    </div>
    ${fieldTabs(snap, field, routes)}
    <div class="layout">
      <section class="stage fd-stage" aria-label="${FIELD_NAMES[field]} over the season">
        ${
          data.rows.length
            ? chartCard(data, field, width, state.showDays)
            : html`<div class="card"><h3>Soil moisture</h3><p class="muted">No history yet for this field.</p></div>`
        }
        ${censusCard(twin, field, state.showCensus)}
      </section>
      <aside class="panel" aria-label="${FIELD_NAMES[field]} summary">
        ${cropCard(f)}
        ${mapCard(snap, field, routes)}
        ${plansCard(twin.fieldPlans(field) ?? [], routes)}
        ${rejectionsCard(f, field)}
        <a class="btn fd-back" href="#${routes.farm(OWN_FARM.id)}" data-focus-key="fd-back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>
          Back to ${OWN_FARM.name}
        </a>
      </aside>
    </div>
  `);

  container.onclick = (event) => {
    const btn = event.target.closest("[data-action='toggle-days'], [data-action='toggle-census']");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "toggle-days") state.showDays = !state.showDays;
    else state.showCensus = !state.showCensus;
    ctx.rerender();
    // The button was rebuilt by the re-render; keep keyboard focus on it.
    container.querySelector?.(`[data-action='${action}']`)?.focus();
  };
}
