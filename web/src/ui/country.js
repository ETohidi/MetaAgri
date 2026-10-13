// The Country screen (level "country", route "germany"): the federal ministry's desk, where the
// site opens. Real, cited figures only (data/real.json via ctx.data): farms, mean size, farmland,
// irrigated share and wheat yield, each against Brandenburg. A map of the 16 Länder with
// Brandenburg highlighted as the Land (its page comes in v2.1) and the Oderbruch pin that opens
// the District. The rail holds Needs attention, Shared with me (the EU's figures and prices) and
// Shared by me. A clear "Follow the farm manager" entry starts the demo story on the fictional farm.
// Real and simulated numbers never mix: the demo farms appear only as a badged pointer.
// d3 is a global from index.html.

import germanyGeo from "../data/germany.js";
import { BERLIN, FARMS, OWN_FARM, REGION } from "../data/places.js";
import { realValue } from "../data/real.js";
import { html, plural } from "./dom.js";
import { LEVELS, levelsPanel } from "./levels.js";
import { kpiStrip, pageHead, pill, prov, simBadge, sourcesFooter } from "./page.js";
import { access, notShown, ROLES, roleOf } from "./roles.js";
import { DROUGHT } from "./status.js";
import {
  fmtDate,
  fmtNumber,
  realBadge,
  realCell,
  realFigure,
  realFreshness,
  realInline,
  realSources,
  realTile,
  scenarioKinds,
  unknownText,
} from "./world.js";

const VIEW_W = 640;
const VIEW_H = 760;
const LAND_ID = "DE-BB";
const KEYS = [
  "de.farms",
  "de.meanSizeHa",
  "de.uaaHa",
  "de.irrigatedShare",
  "de.wheatYield",
  "bb.farms",
  "bb.meanSizeHa",
  "bb.uaaHa",
  "bb.largeFarmsLandShare",
  "bb.wheatYield",
  "bb.rapeseedYield",
  "bb.irrigatedHa",
  "mol.farms",
  "mol.surfaceWaterBan",
  "eu.farms",
  "eu.meanSizeHa",
  "eu.largeFarmsLandShare",
  "prices.wheatEurT",
  "prices.rapeseedEurT",
];

const f1 = (n) => Math.round(n * 10) / 10;
const num = (rv) => (rv && typeof rv.value === "number" && Number.isFinite(rv.value) ? rv.value : null);
const get = (ctx, key) => realValue(ctx.data, key);

function libsReady() {
  const { d3 } = globalThis;
  return Boolean(d3 && typeof d3.geoPath === "function" && typeof d3.geoConicConformal === "function");
}

// -- the Länder map, projected once (ported from the earlier Germany level) ------------------------
let base = null;

function buildMap() {
  const { d3 } = globalThis;
  // Lambert conformal conic with Germany's usual standard parallels: north stays up and the
  // country keeps its familiar shape.
  const projection = d3
    .geoConicConformal()
    .parallels([48.67, 53.67])
    .rotate([-10.45, 0])
    .fitExtent(
      [
        [24, 24],
        [VIEW_W - 24, VIEW_H - 24],
      ],
      germanyGeo,
    );
  const path = d3.geoPath(projection);
  if (typeof path.digits === "function") path.digits(1);
  // Brandenburg last, so its highlighted outline is not covered by a neighbour's; Berlin (inside
  // it) after Brandenburg, so it stays selectable.
  const order = (f) => (f.properties.id === LAND_ID ? 1 : f.properties.id === "DE-BE" ? 2 : 0);
  const states = [...germanyGeo.features]
    .sort((a, b) => order(a) - order(b))
    .map((f) => ({ id: f.properties.id, name: f.properties.name, d: path(f) }));
  const [bx, by] = projection([BERLIN.lon, BERLIN.lat]);
  const [rx, ry] = projection([REGION.lon, REGION.lat]);
  // 100 km along the parallel at 51.2 N, for the scale bar.
  const dLon = 100 / (111.32 * Math.cos((51.2 * Math.PI) / 180));
  const bar = projection([10.45 + dLon, 51.2])[0] - projection([10.45, 51.2])[0];
  // The region's label goes below its ring, right-aligned so it stays inside the map: Poland is
  // right next to it and Berlin's label to its left.
  return { states, berlin: [bx, by], region: [rx, ry], bar, label: { x: Math.min(VIEW_W - 24, rx + 70), y: ry + 54 } };
}

function svgText(cls, x, y, anchor, spans) {
  const tx = f1(x);
  return html`<text class="${cls}" text-anchor="${anchor}" x="${tx}" y="${f1(y)}">${spans
    .filter(Boolean)
    .map((s) => html`<tspan class="${s.cls}" x="${tx}" dy="${s.dy}">${s.text}</tspan>`)}</text>`;
}

function mapSvg(ctx, ui) {
  base ??= buildMap();
  const [rx, ry] = base.region;
  const [bx, by] = base.berlin;
  const districtOpen = access(ctx.role, "district") !== "none";
  const mol = get(ctx, "mol.farms");
  const pinDetail = districtOpen && mol ? `${realFigure(mol)} farms in the district (${mol.asOf})` : "Märkisch-Oderland";
  const scenario = scenarioKinds(ctx.snap).length > 0;
  const states = base.states.map((s) => {
    const isLand = s.id === LAND_ID;
    const sel = s.id === ui.selected;
    const cls = ["cty-state", isLand && "is-land", sel && "is-sel"].filter(Boolean).join(" ");
    return html`<path class="${cls}" d="${s.d}" data-state="${s.id}" role="button" tabindex="0" aria-pressed="${sel}"
      data-focus-key="state-${s.id}" aria-label="${s.name}${isLand ? ", the Land of the worked example" : ""}: show its figures">
      <title>${s.name}</title></path>`;
  });
  const h = VIEW_H - 24;
  return html`<svg class="cty-map" viewBox="0 0 ${VIEW_W} ${VIEW_H}" role="group"
      aria-label="Map of Germany's 16 Länder. Brandenburg is highlighted as the Land; the Oderbruch pin opens the District. Select a Land for its figures.">
    <rect class="cty-water" x="0" y="0" width="${VIEW_W}" height="${VIEW_H}"></rect>
    <g class="cty-states">${states}</g>
    <g class="cty-city" aria-hidden="true"><title>Berlin, for orientation</title>
      <circle class="cty-city-dot" cx="${f1(bx)}" cy="${f1(by)}" r="3.5"></circle>
      <text class="cty-city-label" text-anchor="end" x="${f1(bx - 7)}" y="${f1(by)}" dy="0.35em">Berlin</text>
    </g>
    <g class="cty-pin" data-go="${ctx.routes?.oderbruch ?? "oderbruch"}" role="link" tabindex="0" data-focus-key="germany-oderbruch"
      aria-label="Oderbruch, District of Märkisch-Oderland${districtOpen && mol ? `: ${realFigure(mol)} farms` : ""}. Open the District page.">
      <title>Oderbruch: open the District page</title>
      <circle class="cty-hit" cx="${f1(rx)}" cy="${f1(ry)}" r="34"></circle>
      ${scenario ? html`<circle class="cty-pulse" cx="${f1(rx)}" cy="${f1(ry)}" r="20"></circle>` : ""}
      <circle class="cty-ring" cx="${f1(rx)}" cy="${f1(ry)}" r="24"></circle>
      <circle class="cty-focus" cx="${f1(rx)}" cy="${f1(ry)}" r="30"></circle>
      <circle class="cty-marker" cx="${f1(rx)}" cy="${f1(ry)}" r="4"></circle>
      ${svgText("cty-label", base.label.x, base.label.y, "end", [
        { cls: "cty-label-name", dy: "0", text: "Oderbruch" },
        { cls: "cty-label-detail", dy: "1.35em", text: "District · open it" },
        { cls: "cty-label-detail", dy: "1.25em", text: pinDetail },
      ])}
    </g>
    <g class="cty-scale" aria-hidden="true">
      <path class="cty-scale-bar" fill="none" d="M24 ${h - 5}V${h}H${f1(24 + base.bar)}V${h - 5}"></path>
      <text class="cty-scale-label" x="24" y="${h - 9}">100 km</text>
    </g>
  </svg>`;
}

// -- the Land card: Brandenburg in figures, or Unknown for the other Länder ------------------------
function compareRow(ctx, label, bbKey, deKey, { pctOf } = {}) {
  const bb = get(ctx, bbKey);
  const de = get(ctx, deKey);
  let bbText = realInline(bb, ctx, { compact: num(bb) >= 1e6 });
  if (pctOf) {
    // Irrigated hectares as a share of the Land's farmland, rounded like the source does.
    const share = num(bb) !== null && num(get(ctx, pctOf)) ? (100 * num(bb)) / num(get(ctx, pctOf)) : null;
    if (share !== null) bbText = `${bbText} (about ${fmtNumber(Math.round(share * 10) / 10)} %)`;
  }
  return html`<tr>
    <th scope="row">${label}</th>
    <td class="n">${bb ? html`${bbText} ${realBadge(bb, ctx)}` : realBadge(null, ctx)}</td>
    <td class="n">${realCell(de, ctx, { compact: num(de) >= 1e6 })}</td>
  </tr>`;
}

function landCard(ctx, ui) {
  const state = base?.states.find((s) => s.id === ui.selected) ?? null;
  const name = state?.name ?? (ui.selected === LAND_ID ? "Brandenburg" : "This Land");
  if (ui.selected !== LAND_ID) {
    return html`<div class="cty-land" aria-live="polite">
      <div class="cty-land-h"><h3>${name}</h3>${prov("unknown", { title: "No per-Land figures in v2.0" })}</div>
      <p><span class="real-unknown">Unknown</span>: per-Land tables for every Land come with the data refresh in v2.1. Until then this Land shows no figures, never 0.</p>
      <button type="button" class="btn" data-state="${LAND_ID}" data-focus-key="land-back">Show Brandenburg</button>
    </div>`;
  }
  const big = get(ctx, "bb.largeFarmsLandShare");
  const farms = get(ctx, "bb.farms");
  return html`<div class="cty-land" aria-live="polite">
    <div class="cty-land-h">
      <div><span class="cty-land-lvl">Land</span><h3>Brandenburg</h3></div>
      ${pill("Page coming in v2.1", "mute", { title: LEVELS.land.pending ?? "" })}
    </div>
    <p class="cty-land-lede">The Land of the worked example: it pays the EU subsidies, runs the plant-protection service and the main rivers and dikes.</p>
    <div class="cty-land-big">
      <span class="cty-land-v">${farms ? realFigure(farms) : unknownText(ctx)}</span>
      <span class="cty-land-l">farms ${farms ? `(${farms.asOf})` : ""} ${realBadge(farms, ctx)}</span>
      <span class="cty-land-v">${big ? `${realFigure(big)} %` : unknownText(ctx)}</span>
      <span class="cty-land-l">of the farmland is on farms of 100 ha or more ${realBadge(big, ctx)}</span>
    </div>
    <table class="t cty-cmp">
      <caption class="sr-only">Brandenburg compared with Germany</caption>
      <thead><tr><th scope="col"></th><th scope="col" class="n">Brandenburg</th><th scope="col" class="n">Germany</th></tr></thead>
      <tbody>
        ${compareRow(ctx, "Mean farm size", "bb.meanSizeHa", "de.meanSizeHa")}
        ${compareRow(ctx, "Farmland", "bb.uaaHa", "de.uaaHa")}
        ${compareRow(ctx, "Wheat yield, 2025", "bb.wheatYield", "de.wheatYield")}
        ${compareRow(ctx, "Irrigated, 2022", "bb.irrigatedHa", "de.irrigatedShare", { pctOf: "bb.uaaHa" })}
      </tbody>
    </table>
    <p class="cty-land-extra">Rapeseed yield, 2025: <b>${realCell(get(ctx, "bb.rapeseedYield"), ctx)}</b></p>
    <p class="pane-note">Yields in dt/ha: 10 dt/ha is one tonne per hectare.</p>
  </div>`;
}

function mapCard(ctx, ui) {
  const body = libsReady()
    ? mapSvg(ctx, ui)
    : html`<p class="cty-empty" role="alert">The map library didn't load. The figures and the Land card still work.</p>`;
  return html`<section class="pane cty-mapcard" aria-labelledby="cty-map-title">
    <header class="pane-head">
      <div>
        <h2 id="cty-map-title">Länder</h2>
        <p>Brandenburg is the Land of the worked example; the Oderbruch pin opens the District. Select a Land for its figures.</p>
      </div>
      ${prov("official", { label: "Map", title: "German states from deutschlandGeoJSON (Unlicense), simplified; for orientation only" })}
    </header>
    <div class="cty-two">
      <div class="cty-map-wrap">${body}</div>
      ${landCard(ctx, ui)}
    </div>
    <footer class="pane-foot cty-legend" aria-label="Legend">
      <span><i class="cty-sw cty-sw-land"></i>Brandenburg: the Land (page in v2.1)</span>
      <span><i class="cty-sw cty-sw-pin"></i>Oderbruch: the District, with ${plural(FARMS.length, "fictional demo farm")}</span>
      <span><i class="cty-sw cty-sw-state"></i>Other Länder: no figures loaded yet (Unknown)</span>
    </footer>
  </section>`;
}

/** The demo story's way in: switch the lens to the farm manager and open our fictional farm. */
function followCard(ctx) {
  const isFarm = roleOf(ctx.role).id === "farm";
  return html`<section class="pane cty-follow" aria-labelledby="cty-follow-title">
    <div class="cty-follow-body">
      <div>
        <h2 id="cty-follow-title">Follow the farm manager</h2>
        <p>
          Below the District, MetaAgri simulates ${plural(FARMS.length, "fictional farm")} day by day. Follow the manager of
          ${OWN_FARM.name} through the season: approve or reject the daily plan, borrow a combine, and see what each
          level above learns, and what it never does.
        </p>
      </div>
      <div class="cty-follow-act">
        <button type="button" class="btn btn-primary" data-follow-farm data-focus-key="follow-farm">
          ${isFarm ? `Open ${OWN_FARM.name}` : "Follow the farm manager"}<span aria-hidden="true"> →</span>
        </button>
        <span class="cty-follow-note">${simBadge(ctx.snap)} Everything on the farm is simulated; its name is fictional.</span>
      </div>
    </div>
  </section>`;
}

// -- rail ------------------------------------------------------------------------------------------
function attentionCard(ctx) {
  const ban = get(ctx, "mol.surfaceWaterBan");
  const kinds = scenarioKinds(ctx.snap);
  const items = [
    html`<li class="req">
      <div class="req-top"><span class="req-from">District Märkisch-Oderland · public order</span>${
        ban ? pill(String(ban.value), "warn", { title: "A general order under water law, until revoked" }) : realBadge(ban, ctx)
      }</div>
      <div class="req-what">Ban on taking surface water${ban ? "" : html`: ${unknownText(ctx)}`}</div>
      ${ban ? html`<p class="req-why">${ban.note}</p><p class="req-why">${realBadge(ban, ctx)} In force since 2020; confirmed ${fmtDate(ban.asOf)}.</p>` : ""}
    </li>`,
    ...kinds.map(
      (k) => html`<li class="req">
        <div class="req-top"><span class="req-from">Demo · Oderbruch, fictional farms</span>${simBadge(ctx.snap)}</div>
        <div class="req-what">A simulated ${k.toLowerCase()} is running</div>
        <p class="req-why">Not a real event: no real figure on this page changes. Only the District and the farm see what it does to the farms.</p>
      </li>`,
    ),
    html`<li class="req">
      <div class="req-top"><span class="req-from">Drought per Land</span>${prov("unknown", { title: "No drought feed in v2.0" })}</div>
      <div class="req-what">No drought data loaded yet</div>
      <p class="req-why">The European Drought Observatory's bands per Land (${[DROUGHT.watch, DROUGHT.warning, DROUGHT.alert].map((d) => d.label.replace(/^Drought /, "")).join(", ")}) arrive with the data refresh in v2.1. Until then: Unknown, never "${DROUGHT.none.label.toLowerCase()}".</p>
    </li>`,
  ];
  const open = (ban ? 1 : 0) + kinds.length;
  return html`<section class="pane pane-req" aria-labelledby="cty-att-title">
    <header class="pane-head">
      <div>
        <h2 id="cty-att-title">Needs attention${open ? html` <span class="pane-count">${open}</span>` : ""}</h2>
        <p>Public orders from the Länder and districts, and the demo's scenario</p>
      </div>
    </header>
    <ul class="req-list">${items}</ul>
  </section>`;
}

function kvRow(ctx, key, text, { compact = false, extra = "" } = {}) {
  const rv = get(ctx, key);
  return html`<dt>${text}${extra ? html` <span class="real-asof">${extra}</span>` : ""}</dt>
    <dd>${realCell(rv, ctx, { compact })}</dd>`;
}

function sharedWithCard(ctx, sees) {
  const price = get(ctx, "prices.wheatEurT");
  const week = price?.asOf ? `week of ${fmtDate(price.asOf)}` : "";
  return html`<section class="pane" aria-labelledby="cty-with-title">
    <header class="pane-head">
      <div>
        <h2 id="cty-with-title">Shared with me</h2>
        <p>From the EU: farm structure and this week's market prices</p>
      </div>
    </header>
    <div class="pane-body">
      <dl class="kv">
        ${kvRow(ctx, "eu.farms", "Farms in the EU", { compact: true, extra: "(2023)" })}
        ${kvRow(ctx, "eu.meanSizeHa", "Mean farm size, EU")}
        ${kvRow(ctx, "eu.largeFarmsLandShare", "EU land on farms of 50 ha or more")}
        ${kvRow(ctx, "prices.wheatEurT", "Milling wheat", { extra: week })}
        ${kvRow(ctx, "prices.rapeseedEurT", "Rapeseed", { extra: week ? "same week" : "" })}
      </dl>
      <p class="pane-note">Prices are wholesale, leaving the silo; a farm is paid less.</p>
      ${
        sees === "full"
          ? html`<p class="pane-note">${prov("illustrative")} The Länder also send per-district animal-disease reports; none is open in this demo, and there is no real feed.</p>`
          : notShown("country", { what: "The feed of per-district animal-disease reports", seenBy: ROLES.ministry.name })
      }
    </div>
  </section>`;
}

function sharedByCard(ctx) {
  const farms = get(ctx, "de.farms");
  return html`<section class="pane" aria-labelledby="cty-by-title">
    <header class="pane-head">
      <div>
        <h2 id="cty-by-title">Shared by me</h2>
        <p>What Germany passes on, and how often</p>
      </div>
    </header>
    <div class="pane-body">
      <dl class="kv">
        <dt>To everyone: national totals (${farms ? `${realFigure(farms)} farms` : "farms"})</dt><dd>As published ${realBadge(farms, ctx)}</dd>
        <dt>To Eurostat: farm structure tables</dt><dd>Every 3 years ${prov("illustrative")}</dd>
        <dt>To the EU animal-disease system: outbreaks</dt><dd>Within 24 h ${prov("illustrative")}</dd>
        <dt>To FAO and AMIS: crop and market data</dt><dd>Monthly to yearly ${prov("illustrative")}</dd>
      </dl>
      <div class="never"><b>Never shared:</b> single farms or fields. The federal level holds statistics tables and district disease reports, never a holder's own data.</div>
    </div>
  </section>`;
}

// -- head, KPIs, sources -----------------------------------------------------------------------------
const SEES = {
  full: "Land and district totals, district disease reports, other countries' totals. Never a single farm or field.",
  aggregate: "national and Land totals, as published. Never a single farm or field.",
  none: "nothing of this level beyond what is public.",
};

function head(ctx, sees) {
  const r = roleOf(ctx.role);
  return pageHead({
    level: "Country",
    place: `Germany · viewing as ${r.name}`,
    title: "How big are Germany's farms, how much land is watered, and how does Brandenburg compare?",
    question:
      "Real published statistics, each with its source and date. The fictional demo farms start at the Oderbruch pin; their simulated numbers never change these totals.",
    sees: SEES[sees],
    status: {
      text: "Drought per Land: no data yet",
      tone: "mute",
      title: "The European Drought Observatory's Watch, Warning and Alert per Land come with the data refresh in v2.1",
    },
    fresh: realFreshness(ctx, "Eurostat, Destatis, state statistics"),
  });
}

/** "Brandenburg 241.6 ha, 3.7 times as much" style comparisons for the KPI details. */
function vsLand(ctx, deRv, bbKey, words) {
  const bb = get(ctx, bbKey);
  const year = deRv.asOf;
  if (!bb) return `${year} · Brandenburg: Unknown`;
  return `${year} · Brandenburg ${realInline(bb, ctx, { compact: num(bb) >= 1e6 })}${words ? words(num(deRv), num(bb)) : ""}`;
}

function kpis(ctx) {
  const [farms, mean, land, irrigated, wheat] = LEVELS.country.kpis;
  const bbUaa = num(get(ctx, "bb.uaaHa"));
  return kpiStrip(
    [
      realTile(ctx, "de.farms", { label: farms, detail: (rv) => vsLand(ctx, rv, "bb.farms") }),
      realTile(ctx, "de.meanSizeHa", {
        label: mean,
        detail: (rv) =>
          vsLand(ctx, rv, "bb.meanSizeHa", (de, bb) => (de && bb ? `, ${fmtNumber(Math.round((bb / de) * 10) / 10)} times as big` : "")),
      }),
      realTile(ctx, "de.uaaHa", { label: land, compact: true, detail: (rv) => vsLand(ctx, rv, "bb.uaaHa") }),
      realTile(ctx, "de.irrigatedShare", {
        label: irrigated,
        detail: (rv) => {
          const bb = get(ctx, "bb.irrigatedHa");
          const share = num(bb) !== null && bbUaa ? ` (about ${fmtNumber(Math.round((1000 * num(bb)) / bbUaa) / 10)} %)` : "";
          return `${rv.asOf}, a dry year · Brandenburg ${bb ? `${realInline(bb, ctx)}${share}` : "Unknown"}`;
        },
      }),
      realTile(ctx, "de.wheatYield", {
        label: wheat,
        detail: (rv) =>
          vsLand(ctx, rv, "bb.wheatYield", (de, bb) => (de && bb ? `, ${fmtNumber(Math.round((100 * (de - bb)) / de))} % less` : "")),
      }),
    ],
    { label: "Key figures for Germany", busy: ctx.dataState === "loading" },
  );
}

function sources(ctx) {
  return sourcesFooter([
    ...realSources(ctx, KEYS),
    {
      badge: prov("official", { label: "Map" }),
      text: "Länder: isellsoap/deutschlandGeoJSON (Unlicense, data from DIVA-GIS), simplified. For orientation; Berlin is shown only to find your way.",
    },
    {
      badge: simBadge(ctx.snap),
      text: `The Oderbruch pin and "Follow the farm manager" lead to ${plural(FARMS.length, "fictional demo farm")}; everything about them is simulated (seed ${ctx.snap?.seed ?? "?"}) and never added to a real figure.`,
    },
    {
      badge: prov("illustrative"),
      text: "Shared by me and the disease-report line describe the real reporting rules; this demo has no feed behind them.",
    },
  ]);
}

// -- entry point ---------------------------------------------------------------------------------------
let lastKey = "";

function uiState(ctx) {
  ctx.ui.country ??= { selected: LAND_ID };
  return ctx.ui.country;
}

function select(ctx, ui, id) {
  if (!id || id === ui.selected) return;
  ui.selected = id;
  ctx.rerender();
}

function follow(ctx) {
  ctx.setRole?.("farm");
  ctx.go?.(ctx.routes?.farm ? ctx.routes.farm(OWN_FARM.id) : OWN_FARM.id);
}

export function render(container, ctx, { routeChanged = false } = {}) {
  const ui = uiState(ctx);
  const sees = access(ctx.role, "country");
  // The page reacts to the data, the lens, the selected Land and the demo's scenario, not to
  // every simulated day: skip identical re-renders so focus and hover survive the twin's ticks.
  const key = [ctx.dataState, ctx.data ? 1 : 0, ctx.role, ui.selected, scenarioKinds(ctx.snap).join(","), ctx.snap?.seed, libsReady()].join("|");
  if (routeChanged || key !== lastKey || !container.querySelector(":scope > .country")) {
    lastKey = key;
    container.innerHTML = String(html`<div class="pg country">
      ${head(ctx, sees)}
      ${kpis(ctx)}
      <div class="pg-grid">
        <div class="pg-main">
          ${mapCard(ctx, ui)}
          ${followCard(ctx)}
        </div>
        <aside class="pg-rail" aria-label="Alerts and sharing">
          ${attentionCard(ctx)}
          ${sharedWithCard(ctx, sees)}
          ${sharedByCard(ctx)}
        </aside>
      </div>
      ${levelsPanel("country", { place: "Germany", role: ctx.role })}
      ${sources(ctx)}
    </div>`);
  }

  // main.js clears the view's handlers before every render, so they are set every time.
  container.onclick = (event) => {
    if (event.target.closest("[data-follow-farm]")) {
      follow(ctx);
      return;
    }
    const state = event.target.closest("[data-state]");
    if (state) select(ctx, ui, state.dataset.state);
  };
  container.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const state = event.target.closest?.("path[data-state]");
    if (!state) return;
    event.preventDefault();
    select(ctx, ui, state.dataset.state);
  };
}
