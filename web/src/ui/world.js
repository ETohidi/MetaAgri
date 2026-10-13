// The World screen (level "world", route "world"): the global crop analyst's desk. Real, cited
// headline figures only (data/real.json via ctx.data, Official or Estimated): how many farms there
// are, how the farmland is shared and how much food depends on irrigation. A world map with
// Germany highlighted and the Oderbruch marked, where the fictional demo farms are. Countries
// without figures are Unknown, never 0. d3 and topojson are globals from index.html.
//
// The small real-data helpers at the top (badge, figure, KPI tile, sources rows) are exported for
// the Country page (country.js), so both pages show real values the same way.

import { FARMS, REGION } from "../data/places.js";
import { realValue } from "../data/real.js";
import worldTopo from "../data/world.js";
import { html, plural } from "./dom.js";
import { LEVELS, levelsPanel } from "./levels.js";
import { kpiStrip, pageHead, pill, prov, simBadge, sourcesFooter } from "./page.js";
import { access, notShown, ROLES, roleOf } from "./roles.js";
import { CROP_CONDITION } from "./status.js";

// =====================================================================================
// Real values (shared with country.js)
// =====================================================================================
const LOCALE = "en-GB";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNIT_TEXT = { farms: "farms", "EUR/t": "€/t", "mm/yr": "mm a year", "field outlines": "field outlines" };

/** "13 Oct 2026" from "2026-10-13"; anything else is returned as it is. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** 255,010 · 241.6 · −160; compact: 579 M, 1.58 bn, 16.6 M. */
export function fmtNumber(v, { compact = false } = {}) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const sig = (x) => x.toLocaleString(LOCALE, { maximumSignificantDigits: 3 });
  if (compact && a >= 1e9) return `${sign}${sig(a / 1e9)} bn`;
  if (compact && a >= 1e6) return `${sign}${sig(a / 1e6)} M`;
  return `${sign}${a.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}`;
}

/** The figure of a real value as text ("255,010", "In force", "210–240"); null when missing. */
export function realFigure(rv, opts = {}) {
  if (!rv) return null;
  return typeof rv.value === "number" ? fmtNumber(rv.value, opts) : String(rv.value);
}

/** A real value's unit in plain words ("ha", "%", "€/t"). */
export function unitText(rv) {
  return rv?.unit ? (UNIT_TEXT[rv.unit] ?? rv.unit) : "";
}

/** "Destatis … · as of 2022 · dl-de/by-2.0 · note": the tooltip of a real value's badge. */
export function provTitle(rv) {
  return [rv.source, rv.asOf ? `as of ${fmtDate(rv.asOf)}` : "", rv.licence, rv.note].filter(Boolean).join(" · ");
}

/** Badge of a real value: Official or Estimated; Loading or Unknown when it is missing. */
export function realBadge(rv, ctx) {
  if (!rv) {
    if (ctx?.dataState === "loading") return prov("unknown", { label: "Loading", title: "The statistics file is still loading" });
    return prov("unknown", { title: "Not in the loaded statistics. Shown as Unknown, never as 0" });
  }
  return prov(rv.kind === "Estimated" ? "estimated" : "official", { title: provTitle(rv) });
}

/** "Unknown" (or "…" while loading) in place of a missing figure: never 0. */
export function unknownText(ctx) {
  return ctx?.dataState === "loading"
    ? html`<span class="real-loading" aria-label="Loading">…</span>`
    : html`<span class="real-unknown">Unknown</span>`;
}

/** A figure with its unit for running text: "5,370 farms", or "Unknown". */
export function realInline(rv, ctx, opts = {}) {
  if (!rv) return unknownText(ctx);
  const unit = unitText(rv);
  return `${realFigure(rv, opts)}${unit ? (unit === "%" ? " %" : ` ${unit}`) : ""}`;
}

/** A figure, its unit and its badge for a table cell; only the badge (Unknown or Loading) when missing. */
export function realCell(rv, ctx, opts = {}) {
  return rv ? html`${realInline(rv, ctx, opts)} ${realBadge(rv, ctx)}` : realBadge(null, ctx);
}

/** Why a figure is missing, in words: still loading, the file failed, or the key is not in it. */
export function missingWhy(ctx) {
  if (ctx?.dataState === "loading") return "Loading the statistics…";
  if (!ctx?.data?.real) return "The statistics file did not load: Unknown, never 0";
  return "Not in the loaded statistics: Unknown, never 0";
}

/**
 * A KPI tile (page.js kpiStrip) for one real value.
 * @param {object} ctx
 * @param {string} key  a REAL_KEYS key
 * @param {{label?: string, compact?: boolean, detail?: (rv) => any, alert?: boolean}} opts
 */
export function realTile(ctx, key, { label, compact = false, detail, alert = false } = {}) {
  const rv = realValue(ctx.data, key);
  if (!rv) {
    return {
      label: label ?? key,
      value: unknownText(ctx),
      detail: missingWhy(ctx),
      badge: realBadge(null, ctx),
    };
  }
  return {
    label: label ?? rv.label,
    value: realFigure(rv, { compact }),
    unit: unitText(rv),
    detail: detail ? detail(rv) : `${fmtDate(rv.asOf)}`,
    badge: realBadge(rv, ctx),
    alert,
  };
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Sources footer rows for real values, one row per source link, with the labels it backs. */
export function realSources(ctx, keys) {
  const groups = new Map();
  for (const key of keys) {
    const rv = realValue(ctx.data, key);
    if (!rv) continue;
    const g = groups.get(rv.url) ?? { rv, labels: [] };
    if (!g.labels.includes(rv.label)) g.labels.push(rv.label);
    groups.set(rv.url, g);
  }
  if (!groups.size) {
    return [
      {
        badge: realBadge(null, ctx),
        text:
          ctx.dataState === "loading"
            ? "The statistics file (data/real.json) is loading."
            : "The statistics file (data/real.json) did not load: its figures show Unknown, never 0.",
      },
    ];
  }
  return [...groups.values()].map(({ rv, labels }) => ({
    badge: realBadge(rv, ctx),
    text: html`<b>${labels.join(", ")}</b>: ${rv.source}, ${fmtDate(rv.asOf)}. Licence: ${rv.licence}.
      <a href="${rv.url}" target="_blank" rel="noopener noreferrer">${hostOf(rv.url)}</a>`,
  }));
}

/** The curation stamp for the page head: {badge, text}. */
export function realFreshness(ctx, what) {
  const meta = ctx.data?.real?.meta;
  if (ctx.dataState === "loading") return { badge: realBadge(null, ctx), text: `Loading ${what}…` };
  if (!ctx.data?.real) return { badge: prov("unknown"), text: `${what}: did not load` };
  return {
    badge: prov("official", { title: meta?.note ?? "" }),
    text: `${what} · checked ${fmtDate(meta?.curatedAt ?? "")}`,
  };
}

/** The demo scenarios as plain kinds ("Heatwave", "Hail warning"), without any farm's numbers. */
export function scenarioKinds(snap) {
  return (snap?.scenarios ?? []).map((s) => (/^heat/i.test(s) ? "Heatwave" : /^hail/i.test(s) ? "Hail warning" : "Weather event"));
}

const LINK = (url, text) => html`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;

// =====================================================================================
// The World page
// =====================================================================================
const VIEW_W = 960;
const VIEW_H = 480;
const PULSE_MS = 2400;
const BMLEH_FMD = "https://www.bmleh.de/EN/topics/animals/animal-health/foot-and-mouth-disease.html";
const WORLD_ATLAS = "https://github.com/topojson/world-atlas";
const KEYS = [
  "world.farms",
  "world.smallFarmsShare",
  "world.smallFarmsLandShare",
  "world.irrigatedCroplandShare",
  "world.irrigatedFoodShare",
  "world.fields2025",
  "de.farms",
  "eu.farms",
  "eu.meanSizeHa",
];

const f1 = (n) => Math.round(n * 10) / 10;
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`;

function libsReady() {
  const { d3, topojson } = globalThis;
  return Boolean(d3 && typeof d3.geoEqualEarth === "function" && topojson && typeof topojson.feature === "function");
}

// -- the base map, projected once (ported from the earlier Earth level) ------------------------
let base = null;

function buildMap() {
  const { d3, topojson } = globalThis;
  const sphere = { type: "Sphere" };
  const projection = d3.geoEqualEarth().fitExtent(
    [
      [10, 10],
      [VIEW_W - 10, VIEW_H - 10],
    ],
    sphere,
  );
  const path = d3.geoPath(projection);
  if (typeof path.digits === "function") path.digits(1);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);
  const de = countries.features.find((f) => String(f.id) === "276");
  // Merged land plus a border mesh is about half the markup of 177 country outlines.
  const land = topojson.feature(worldTopo, worldTopo.objects.land);
  const borders = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
  return {
    sphere: path(sphere),
    graticule: path(d3.geoGraticule().step([20, 20])()),
    land: path(land),
    borders: path(borders),
    germany: path(de),
    centroid: path.centroid(de),
    region: projection([REGION.lon, REGION.lat]),
  };
}

/** An SVG label of stacked lines; no whitespace between the tspans. */
function svgText(cls, x, y, anchor, spans) {
  const tx = f1(x);
  return html`<text class="${cls}" text-anchor="${anchor}" x="${tx}" y="${f1(y)}">${spans
    .filter(Boolean)
    .map((s) => html`<tspan class="${s.cls}" x="${tx}" dy="${s.dy}">${s.text}</tspan>`)}</text>`;
}

function mapSvg(ctx) {
  base ??= buildMap();
  const [rx, ry] = base.region;
  const [cx, cy] = base.centroid;
  const de = realValue(ctx.data, "de.farms");
  const detail = de ? `${realFigure(de)} farms (${de.asOf})` : "Open the Country page";
  const scenario = scenarioKinds(ctx.snap).length > 0;
  return html`<svg class="w-map" viewBox="0 0 ${VIEW_W} ${VIEW_H}" role="group"
      aria-label="World map. Germany is highlighted and the Oderbruch marked; select Germany to open the Country page.">
    <path class="w-sphere" d="${base.sphere}"></path>
    <path class="w-graticule" fill="none" d="${base.graticule}"></path>
    <path class="w-land" d="${base.land}"></path>
    <path class="w-borders" fill="none" d="${base.borders}"></path>
    <g class="w-de" data-go="${ctx.routes?.germany ?? "germany"}" role="link" tabindex="0" data-focus-key="world-germany"
      aria-label="Germany: ${detail}. The Oderbruch, where the fictional demo farms are, is marked. Open the Country page.">
      <title>Germany: open the Country page</title>
      <circle class="w-hit" cx="${f1(cx)}" cy="${f1(cy)}" r="36"></circle>
      <circle class="w-focus" cx="${f1(cx)}" cy="${f1(cy)}" r="26"></circle>
      <circle class="w-target" cx="${f1(cx)}" cy="${f1(cy)}" r="19"></circle>
      <path class="w-de-shape" d="${base.germany}"></path>
      <path class="w-leader" fill="none" d="M${f1(rx + 5)} ${f1(ry)}H${f1(rx + 27)}"></path>
      ${scenario ? html`<circle class="w-pulse" cx="${f1(rx)}" cy="${f1(ry)}" r="6" style="${phase(PULSE_MS)}"></circle>` : ""}
      <circle class="w-marker" cx="${f1(rx)}" cy="${f1(ry)}" r="3"></circle>
      ${svgText("w-label", rx + 32, ry, "start", [
        { cls: "w-label-name", dy: "-0.15em", text: "Germany" },
        { cls: "w-label-detail", dy: "1.3em", text: detail },
        { cls: "w-label-detail w-label-demo", dy: "1.25em", text: "Oderbruch: the demo farms" },
      ])}
    </g>
  </svg>`;
}

function mapCard(ctx) {
  const body = libsReady()
    ? mapSvg(ctx)
    : html`<p class="w-empty" role="alert">The map library didn't load. Every figure on this page still works.</p>`;
  return html`<section class="pane w-mapcard" aria-labelledby="w-map-title">
    <header class="pane-head">
      <div>
        <h2 id="w-map-title">Where this twin is connected</h2>
        <p>Germany has a Country page; inside it, the Oderbruch is where the fictional demo farms are.</p>
      </div>
      ${prov("official", { label: "Map", title: "Natural Earth 1:110m via world-atlas (public domain, ISC); for orientation only" })}
    </header>
    <div class="w-map-wrap">${body}</div>
    <footer class="pane-foot w-legend" aria-label="Legend">
      <span><i class="w-sw w-sw-de"></i>Germany: open the Country page</span>
      <span><i class="w-sw w-sw-marker"></i>Oderbruch: ${plural(FARMS.length, "fictional farm")}, ${simBadge(ctx.snap, "Simulated")}</span>
      <span><i class="w-sw w-sw-land"></i>Other countries: no figures loaded yet (Unknown, not 0)</span>
      ${scenarioKinds(ctx.snap).length ? html`<span><i class="w-sw w-sw-pulse"></i>Pulsing: a simulated scenario runs at the demo farms</span>` : ""}
    </footer>
  </section>`;
}

/** A 100 % bar split in two, with the split's own words: "85 % under 2 ha | 15 % 2 ha or more". */
function splitBar(ctx, key, { title, part, rest, tone }) {
  const rv = realValue(ctx.data, key);
  if (!rv || typeof rv.value !== "number") {
    return html`<div class="w-split">
      <div class="w-split-h"><span>${title}</span>${realBadge(rv, ctx)}</div>
      <p class="w-split-none">${unknownText(ctx)}</p>
    </div>`;
  }
  const p = Math.max(0, Math.min(100, rv.value));
  const r = Math.round((100 - p) * 10) / 10;
  const label = `${title}: ${fmtNumber(p)} % ${part}, ${fmtNumber(r)} % ${rest}`;
  return html`<div class="w-split">
    <div class="w-split-h"><span>${title}</span>${realBadge(rv, ctx)}</div>
    <div class="w-split-bar" role="img" aria-label="${label}">
      <i class="w-seg is-${tone}" style="width:${p.toFixed(1)}%"></i><i class="w-seg is-rest" style="width:${(100 - p).toFixed(1)}%"></i>
    </div>
    <div class="w-split-l"><span><b>${fmtNumber(p)} %</b> ${part}</span><span><b>${fmtNumber(r)} %</b> ${rest}</span></div>
  </div>`;
}

function sharesCard(ctx) {
  const fields = realValue(ctx.data, "world.fields2025");
  const big = realValue(ctx.data, "world.smallFarmsLandShare");
  return html`<section class="pane" aria-labelledby="w-shares-title">
    <header class="pane-head">
      <div>
        <h2 id="w-shares-title">How the world's farmland and food are shared</h2>
        <p>Farms against farmland, cropland against food: each bar is one published share and the rest.</p>
      </div>
    </header>
    <div class="pane-body w-shares">
      <div class="w-pair">
        ${splitBar(ctx, "world.smallFarmsShare", { title: "Farms", part: "under 2 ha", rest: "2 ha or more", tone: "a" })}
        ${splitBar(ctx, "world.smallFarmsLandShare", { title: "Farmland", part: "on farms under 2 ha", rest: "on larger farms", tone: "a" })}
      </div>
      <div class="w-pair">
        ${splitBar(ctx, "world.irrigatedCroplandShare", { title: "Cropland", part: "irrigated", rest: "rain-fed", tone: "b" })}
        ${splitBar(ctx, "world.irrigatedFoodShare", { title: "Food", part: "from irrigated land", rest: "from rain-fed land", tone: "b" })}
      </div>
      ${big?.note ? html`<p class="pane-note">${big.note}</p>` : ""}
    </div>
    <footer class="pane-foot">
      <span class="w-fields">${realBadge(fields, ctx)} <b>${fields ? realFigure(fields, { compact: true }) : unknownText(ctx)}</b>
        field outlines mapped for 2025 by a machine-learning model from satellite images: a count of fields, not of farms.</span>
    </footer>
  </section>`;
}

// -- rail ------------------------------------------------------------------------------------------
function attentionCard(ctx) {
  const kinds = scenarioKinds(ctx.snap);
  const items = kinds.map(
    (k) => html`<li class="req">
      <div class="req-top"><span class="req-from">Demo · Oderbruch, fictional farms</span>${simBadge(ctx.snap)}</div>
      <div class="req-what">A simulated ${k.toLowerCase()} is running</div>
      <p class="req-why">Not a real event: it changes no real figure on this page. The farms' own numbers stay with the farms.</p>
    </li>`,
  );
  items.push(html`<li class="req">
    <div class="req-top"><span class="req-from">Crop condition and market alerts</span>${prov("unknown", { title: "No live feed in v2.0" })}</div>
    <div class="req-what">No live alert feed at this level yet</div>
    <p class="req-why">The monthly crop-condition classes (${CROP_CONDITION.favourable.label}, ${CROP_CONDITION.watch.label}, ${CROP_CONDITION.poor.label}) and market alerts arrive with the data refresh in v2.1. Until then: Unknown, never "all clear".</p>
  </li>`);
  items.push(html`<li class="req">
    <div class="req-top"><span class="req-from">Animal health · a real example from 2025</span>${pill("Resolved", "ok")}</div>
    <div class="req-what">Foot-and-mouth disease in Märkisch-Oderland</div>
    <p class="req-why">Found in water buffaloes on 10 Jan 2025. Several countries outside the EU stopped some imports from Germany; WOAH gave back Germany's status "free from foot-and-mouth disease without vaccination" on 14 Apr 2025. The report went farm, district vet office, Land, FLI, EU, WOAH.</p>
    <p class="req-why">${prov("official", { title: "Federal ministry BMLEH" })} ${LINK(BMLEH_FMD, "Federal ministry (BMLEH)")}</p>
  </li>`);
  return html`<section class="pane pane-req" aria-labelledby="w-att-title">
    <header class="pane-head">
      <div>
        <h2 id="w-att-title">Needs attention${kinds.length ? html` <span class="pane-count">${kinds.length}</span>` : ""}</h2>
        <p>Public alerts and the demo's scenario, each with its badge</p>
      </div>
    </header>
    <ul class="req-list">${items}</ul>
  </section>`;
}

function kvRow(ctx, key, text, { compact = false } = {}) {
  const rv = realValue(ctx.data, key);
  return html`<dt>${text}${rv?.asOf ? html` <span class="real-asof">(${fmtDate(rv.asOf)})</span>` : ""}</dt>
    <dd>${realCell(rv, ctx, { compact })}</dd>`;
}

function sharedWithCard(ctx, sees) {
  return html`<section class="pane" aria-labelledby="w-with-title">
    <header class="pane-head">
      <div>
        <h2 id="w-with-title">Shared with me</h2>
        <p>National and EU totals, as the levels below publish them</p>
      </div>
    </header>
    <div class="pane-body">
      <dl class="kv">
        ${kvRow(ctx, "de.farms", "Germany: farms")}
        ${kvRow(ctx, "eu.farms", "EU: farms", { compact: true })}
        ${kvRow(ctx, "eu.meanSizeHa", "EU: mean farm size")}
        <dt>Crop condition per country <span class="real-asof">(from v2.1)</span></dt><dd>${prov("unknown", { title: "Comes with the data refresh in v2.1" })}</dd>
      </dl>
      ${
        sees === "full"
          ? html`<p class="pane-note">${prov("illustrative")} Partners' draft crop assessments reach this desk before the monthly release; this demo has no such feed.</p>`
          : notShown("world", { what: "The partners' draft crop assessment", seenBy: ROLES.analyst.name })
      }
    </div>
  </section>`;
}

function sharedByCard() {
  return html`<section class="pane" aria-labelledby="w-by-title">
    <header class="pane-head">
      <div>
        <h2 id="w-by-title">Shared by me</h2>
        <p>What the world level publishes, for everyone</p>
      </div>
      ${prov("illustrative", { title: "Describes the real publications; no feed behind them in this demo" })}
    </header>
    <div class="pane-body">
      <dl class="kv">
        <dt>Crop Monitor: crop condition per country and crop</dt><dd>Monthly</dd>
        <dt>AMIS Market Monitor: wheat, maize, rice, soybeans</dt><dd>Ten times a year</dd>
        <dt>FAOSTAT: farms, areas and yields per country</dt><dd>Yearly</dd>
      </dl>
      <div class="never"><b>Never shared:</b> any farm or field. This level holds country totals and condition classes only.</div>
    </div>
  </section>`;
}

// -- head, KPIs, sources -----------------------------------------------------------------------------
const SEES = {
  full: "country totals, crop-condition classes and public alerts. Never a farm or a field.",
  aggregate: "world and country totals, as published. Never a farm or a field.",
  none: "nothing of this level beyond what is public.",
};

function head(ctx, sees) {
  const r = roleOf(ctx.role);
  return pageHead({
    level: "World",
    place: `All countries · viewing as ${r.name}`,
    title: "How many farms feed the world, how is the land shared, and how much depends on irrigation?",
    question: "Real published estimates, each with its source and date. This level holds country totals only, never a farm or a field.",
    sees: SEES[sees],
    status: {
      text: `Crop condition: ${CROP_CONDITION.nodata.label}`,
      tone: "mute",
      title: "The monthly crop-condition classes per country come with the data refresh in v2.1",
    },
    fresh: realFreshness(ctx, "FAO, Eurostat, FTW"),
  });
}

function kpis(ctx) {
  const [farms, small, smallLand, irrigated, food] = LEVELS.world.kpis;
  return kpiStrip(
    [
      realTile(ctx, "world.farms", {
        label: farms,
        compact: true,
        detail: (rv) => `About ${fmtNumber(rv.value / 1e6)} million in ${rv.asOf}: FAO's estimate from 152 countries' farm censuses`,
      }),
      realTile(ctx, "world.smallFarmsShare", { label: small, detail: (rv) => `of all farms are smaller than 2 hectares (${rv.asOf})` }),
      realTile(ctx, "world.smallFarmsLandShare", { label: smallLand, detail: () => "of all farmland; farms over 50 ha (under 1 % of farms) work about 75 %" }),
      realTile(ctx, "world.irrigatedCroplandShare", { label: irrigated, detail: (rv) => `of the cultivated land, rounded (FAO, ${rv.asOf})` }),
      realTile(ctx, "world.irrigatedFoodShare", { label: food, detail: () => "of the world's food grows on that irrigated land" }),
    ],
    { label: "Key figures for the world", busy: ctx.dataState === "loading" },
  );
}

function sources(ctx) {
  return sourcesFooter([
    ...realSources(ctx, KEYS),
    {
      badge: prov("official"),
      text: html`Foot-and-mouth example: ${LINK(BMLEH_FMD, "Federal ministry BMLEH, foot-and-mouth disease")}.`,
    },
    {
      badge: prov("official", { label: "Map" }),
      text: html`Boundaries: Natural Earth 1:110m via ${LINK(WORLD_ATLAS, "world-atlas")} (public domain, ISC). For orientation; they imply no position on any border.`,
    },
    {
      badge: simBadge(ctx.snap),
      text: `The Oderbruch marker shows where the ${plural(FARMS.length, "fictional demo farm")} are; everything about them is simulated (seed ${ctx.snap?.seed ?? "?"}) and never added to a real figure.`,
    },
    {
      badge: prov("illustrative"),
      text: "Shared by me describes the real publications of FAO, AMIS and the Crop Monitor; this demo has no live feed from them.",
    },
  ]);
}

// -- entry point ---------------------------------------------------------------------------------------
let lastKey = "";

export function render(container, ctx, { routeChanged = false } = {}) {
  const sees = access(ctx.role, "world");
  // The page reacts to the data, the lens and the demo's scenario, not to every simulated day:
  // skip identical re-renders so focus and hover survive the twin's ticks.
  const key = [ctx.dataState, ctx.data ? 1 : 0, ctx.role, scenarioKinds(ctx.snap).join(","), ctx.snap?.seed, libsReady()].join("|");
  if (routeChanged || key !== lastKey || !container.querySelector(":scope > .world")) {
    lastKey = key;
    container.innerHTML = String(html`<div class="pg world">
      ${head(ctx, sees)}
      ${kpis(ctx)}
      <div class="pg-grid">
        <div class="pg-main">
          ${mapCard(ctx)}
          ${sharesCard(ctx)}
        </div>
        <aside class="pg-rail" aria-label="Alerts and sharing">
          ${attentionCard(ctx)}
          ${sharedWithCard(ctx, sees)}
          ${sharedByCard()}
        </aside>
      </div>
      ${levelsPanel("world", { place: "All countries", role: ctx.role })}
      ${sources(ctx)}
    </div>`);
  }
  // No handlers of its own: the Germany link uses data-go, which main.js handles page-wide.
}
