// District level: Märkisch-Oderland and the Oderbruch polder (concept W2). The district
// authorities and the machinery-sharing network ask "Which farms need help today, and who can
// lend it?": page head, five KPI tiles (three from the fictional demo farms, Simulated; two
// official district statistics), the Oderbruch map with the three farm pins, a farm table, and
// the rail with requests & offers and what the district shares up. Real and simulated numbers
// never mix: Official and Estimated values come from data/real.json, everything about the farms
// is Simulated, and real field parcels are not drawn yet (they come later, with their official
// crop only, never with a simulated number).
//
// The lens (roles.js) decides how much of it shows: the district and sharing network see every
// farm's status and offers; a farm manager sees the neighbours' offers and only its own status;
// the federal ministry sees totals; the global analyst sees public orders and statistics only.
// d3 is a global from index.html; the projected base map is built once and cached.

import germanyGeo from "../data/germany.js";
import { ODER, OUTLINE, PLACE_LABELS } from "../data/oderbruch.js";
import { BERLIN, FARMS, FARMYARD, FIELD_IDS, FIELD_NAMES, FIELD_POLYGONS, FIELDS, OWN_FARM, REGION } from "../data/places.js";
import { realValue } from "../data/real.js";
import { esc, html, plural, raw } from "./dom.js";
import {
  asFarmerButton,
  asOfText,
  conditionText,
  confWord,
  CROP_RULE,
  cropOf,
  farmOps,
  fmt,
  handleLensClick,
  helpAsked,
  helpLines,
  hiddenTile,
  HOLDBACK,
  HOLDBACK_NOTE,
  keptBackText,
  offerOf,
  realBadge,
  realSource,
  realText,
  roleId,
  simProv,
  T,
  tonnes,
} from "./farm.js";
import { levelsPanel } from "./levels.js";
import { kpiStrip, pageHead, pill, prov, sourcesFooter } from "./page.js";
import { access, notShown, roleOf } from "./roles.js";

const VIEWBOX = [960, 720];
const PULSE_MS = 2400;
const FLOW_MS = 1200;
const PIN_R_MAX = 14;
const EARTH_RADIUS_KM = 6371;
// Label sizes in viewBox units; district.css enlarges them on narrow maps, so the layout reserves
// room for labels this much bigger than the base size.
const FS = { pinName: 15, pinDetail: 13, link: 12.5, place: 12 };
const RESERVE = 1.3;
// The inset with our farm's fields sits in the empty bottom-left corner of the map.
const INSET = { x: 16, y: VIEWBOX[1] - 16 - 250, w: 260, h: 250 };
const NEAR = 10;

const f1 = (n) => Math.round(n * 10) / 10;
const sum = (xs, fn) => xs.reduce((n, x) => n + fn(x), 0);
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`;

// =====================================================================================
// The lens and the numbers
// =====================================================================================
/** How much of the district this role sees. */
function lensOf(ctx) {
  const role = roleId(ctx);
  const level = access(role, "district");
  const peer = level === "aggregate" && role === "farm";
  return {
    role,
    level,
    totals: level !== "none", // district totals of the demo farms
    perFarm: level === "full" || peer, // farm pins, names and offers
    status: level === "full", // every farm's status and needs
    own: role === "farm", // a farm manager sees its own farm in full
    fields: access(role, "field") === "full", // our farm's field shapes
  };
}

const SEES = {
  full: "each farm's status and voluntary offers, and the district's public orders. Never: fields, crop plans, finances.",
  peer: "the neighbours' voluntary offers, your own farm's status and the district's public orders. Never: another farm's soil, fields, plans or finances.",
  aggregate: "district totals and public orders. Never: single farms or fields.",
  none: "public orders and official district statistics only. Global views hold country aggregates.",
};

/** One row per demo farm: offer, crop condition, silo fill and what it needs today. */
function farmRows(snap) {
  const help = helpAsked(snap);
  return (snap.farms ?? []).map((row) => {
    const offer = offerOf(snap, row.name);
    const crop = cropOf(row);
    const fill = row.storageCapacityT ? 1 - row.storageFreeT / row.storageCapacityT : 0;
    const needs = [];
    if (row.isOwn) {
      for (const [name, h] of Object.entries(help)) {
        if (h.borrowFor.length) needs.push({ text: `A combine for ${h.borrowFor.map((f) => FIELD_NAMES[f] ?? f).join(" and ")}`, short: "a combine", from: name, request: true });
        if (h.deliverT > 0) needs.push({ text: `Space for ${tonnes(h.deliverT)} t of grain`, short: "silo space", from: name, request: true });
      }
    }
    if (crop.tone === "crit") needs.push({ text: "Water: the soil is dry", short: "dry soil", urgent: true });
    if (fill > 0.95) needs.push({ text: "Silo space: the silo is almost full", short: "silo almost full", urgent: true });
    return { ...row, offer, crop, fill, needs, index: FARMS.findIndex((f) => f.id === row.id) };
  });
}

function districtKpis(ctx, rows, lens) {
  const { snap } = ctx;
  const sim = simProv(snap);
  const tiles = [];
  if (lens.totals) {
    const needing = rows.filter((r) => r.needs.length);
    const offers = rows.filter((r) => r.offer);
    const lenders = offers.filter((r) => r.offer.combine > 0);
    const silo = sum(offers, (r) => r.offer.storageT);
    const free = sum(rows, (r) => r.storageFreeT ?? 0);
    const needDetail = !needing.length
      ? "None today"
      : lens.status
        ? needing.map((r) => `${r.name}: ${r.needs[0].short}`).join(" · ")
        : lens.own && needing.some((r) => r.isOwn)
          ? `${OWN_FARM.name}: ${needing.find((r) => r.isOwn).needs[0].short}${needing.length > 1 ? `; ${plural(needing.length - 1, "other farm")}` : ""}`
          : `${plural(needing.length, "demo farm")}; who and why stays with the district`;
    tiles.push(
      { label: "Farms needing help", value: needing.length, unit: `of ${rows.length}`, detail: needDetail, badge: sim, alert: needing.some((r) => r.needs.some((n) => n.urgent)) },
      {
        label: "Combines free to lend",
        value: lenders.length,
        unit: `of ${rows.length}`,
        detail: lenders.length ? (lens.perFarm ? lenders.map((r) => r.name).join(", ") : "Offered to the sharing network today") : "No combine offered today",
        badge: sim,
      },
      {
        label: "Silo space offered",
        value: tonnes(silo),
        unit: "t",
        detail: `of ${tonnes(free)} t free; ${tonnes(Math.max(0, free - silo))} t kept back (at least ${HOLDBACK} t a farm)`,
        badge: sim,
      },
    );
  } else {
    tiles.push(hiddenTile("Farms needing help", "district"), hiddenTile("Combines free to lend", "district"), hiddenTile("Silo space offered", "district"));
  }
  const ban = realValue(ctx.data, "mol.surfaceWaterBan");
  tiles.push({
    label: "Surface-water ban",
    value: realText(ban),
    detail: ban ? `District-wide, rivers, ditches and lakes${ban.asOf ? ` · as of ${asOfText(ban.asOf)}` : ""}` : missing(ctx),
    badge: realBadge(ban, ctx),
  });
  const farms = realValue(ctx.data, "mol.farms");
  const uaa = realValue(ctx.data, "mol.uaaHa");
  tiles.push({
    label: "Farms in the district",
    value: realText(farms),
    unit: farms ? "farms" : "",
    detail: farms ? `${uaa ? `on ${realText(uaa)} ha of farmland` : "farmland unknown"} · ${asOfText(farms.asOf)}` : missing(ctx),
    badge: realBadge(farms, ctx),
  });
  return kpiStrip(tiles, { label: "Key figures for the district", busy: ctx.dataState === "loading" });
}

const missing = (ctx) => (ctx.dataState === "loading" ? "Loading the district statistics…" : "Not available: shown as Unknown, never as 0");

// =====================================================================================
// The Oderbruch map (port of the earlier level-3 map): lowland, Oder, farm pins, our fields
// =====================================================================================
function libsReady() {
  const { d3 } = globalThis;
  return Boolean(d3 && typeof d3.geoPath === "function" && typeof d3.geoConicConformal === "function");
}

function geoPath(projection) {
  const path = globalThis.d3.geoPath(projection);
  if (typeof path.digits === "function") path.digits(1);
  return path;
}

/** A Polygon feature for a closed [lon, lat] ring, wound clockwise as d3-geo expects. */
function polygon(ring, properties = {}) {
  const feature = { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
  if (globalThis.d3.geoArea(feature) > 2 * Math.PI) feature.geometry.coordinates = [[...ring].reverse()];
  return feature;
}

function distanceKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function kmToUnits(projection, lon, lat, km) {
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return projection([lon + dLon, lat])[0] - projection([lon, lat])[0];
}

function scaleBar(x, y, length, label) {
  return `<g class="ds-map-scale" aria-hidden="true">
    <path class="ds-map-scale-bar" fill="none" d="M${f1(x)} ${f1(y - 5)}V${f1(y)}H${f1(x + length)}V${f1(y - 5)}"/>
    <text class="ds-map-scale-label" x="${f1(x)}" y="${f1(y - 9)}">${label}</text>
  </g>`;
}

const overlaps = (a, b, pad = 3) => a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;
const fits = (b, [w, h]) => b.x0 >= 6 && b.y0 >= 6 && b.x1 <= w - 6 && b.y1 <= h - 6;
const textW = (text, fs, k = 0.57) => text.length * fs * k;

function anchoredBox(ax, anchor, width, y0, y1) {
  if (anchor === "end") return { x0: ax - width, x1: ax, y0, y1 };
  if (anchor === "middle") return { x0: ax - width / 2, x1: ax + width / 2, y0, y1 };
  return { x0: ax, x1: ax + width, y0, y1 };
}

/** A name whose baseline sits 0.15em above ay, then `details` lines 1.25em apart below it. */
function labelBox(ax, ay, anchor, name, details, fsName, fsDetail) {
  const width = Math.max(textW(name, fsName, 0.62), ...details.map((d) => textW(d, fsDetail)));
  const base = ay - 0.15 * fsName;
  return anchoredBox(ax, anchor, width, base - 0.8 * fsName, base + (details.length * 1.25 + 0.3) * fsDetail);
}

let cached = null;

function baseMap() {
  cached ??= buildMap();
  return cached;
}

function buildMap() {
  const { d3 } = globalThis;
  const [w, h] = VIEWBOX;
  const lowland = polygon(OUTLINE, { name: "Oderbruch" });
  const projection = d3
    .geoConicConformal()
    .parallels([52.3, 53])
    .rotate([-14.3, 0])
    .fitExtent(
      [
        [20, 20],
        [w - 20, h - 20],
      ],
      lowland,
    );
  projection.clipExtent([
    [0, 0],
    [w, h],
  ]);
  const path = geoPath(projection);
  const reservedBig = [];
  const reservedBase = [];
  const reserve = (box) => {
    reservedBig.push(box);
    reservedBase.push(box);
  };
  const isFree = (box, reserved) => fits(box, [w, h]) && !reserved.some((b) => overlaps(box, b));

  // The German states clipped to the view (only Brandenburg reaches it); outside them, Poland.
  const states = (germanyGeo?.features ?? [])
    .map((f) => ({ f, d: path(f) }))
    .filter((s) => s.d)
    .map((s) => `<path class="ds-map-state" d="${s.d}"><title>${esc(s.f.properties?.name ?? "")}</title></path>`)
    .join("");
  const river = path({ type: "LineString", coordinates: ODER });

  // Our farm's fields, magnified in an inset: at this scale all three fit under the farm's pin.
  reserve({ x0: INSET.x, x1: INSET.x + INSET.w, y0: INSET.y, y1: INSET.y + INSET.h });
  const fieldFeatures = FIELDS.map((f) => polygon(FIELD_POLYGONS[f], { field: f }));
  const insetProjection = d3
    .geoConicConformal()
    .parallels([52.3, 53])
    .rotate([-14.3, 0])
    .fitExtent(
      [
        [INSET.x + 16, INSET.y + 34],
        [INSET.x + INSET.w - 16, INSET.y + INSET.h - 14],
      ],
      { type: "FeatureCollection", features: fieldFeatures },
    );
  const insetPath = geoPath(insetProjection);
  const fields = fieldFeatures.map((feature) => {
    const [cx, cy] = insetPath.centroid(feature);
    return { field: feature.properties.field, d: insetPath(feature), cx, cy };
  });
  const yard = insetProjection([FARMYARD.lon, FARMYARD.lat]);

  // Scale bar bottom right, over Poland.
  const barLen = kmToUnits(projection, 14.6, 52.45, 10);
  reserve({ x0: w - 24 - barLen - 4, x1: w - 16, y0: h - 46, y1: h - 12 });

  // Pins: radius by farm area (area-true); the farm the demo follows gets an outline.
  const maxArea = Math.max(...FARMS.map((f) => f.areaHa));
  const pins = FARMS.map((f, index) => {
    const [px, py] = projection([f.lon, f.lat]);
    const r = PIN_R_MAX * Math.sqrt(f.areaHa / maxArea);
    const ring = f.isOwn ? r + 6 : r + 4;
    reserve({ x0: px - ring, x1: px + ring, y0: py - ring, y1: py + ring });
    return { ...f, index, x: px, y: py, r };
  });

  // Berlin is off the map to the west: an arrow on the left edge, on the line from our farm.
  const own = pins.find((p) => p.isOwn);
  const [bx, by] = projection([BERLIN.lon, BERLIN.lat]);
  const edgeX = 20;
  const tRay = (own.x - edgeX) / (own.x - bx);
  const pointer = {
    x: edgeX,
    y: Math.max(40, Math.min(INSET.y - 30, own.y + (by - own.y) * tRay)),
    angle: (Math.atan2(by - own.y, bx - own.x) * 180) / Math.PI,
    km: Math.round(distanceKm([OWN_FARM.lon, OWN_FARM.lat], [BERLIN.lon, BERLIN.lat])),
  };
  reserve({ x0: edgeX - 4, x1: edgeX + 16 + textW(`Berlin ${pointer.km} km`, FS.place * RESERVE), y0: pointer.y - 12, y1: pointer.y + 12 });

  // Pin labels: a name and two detail lines, beside the pin if there is room, else above or below.
  const meanX = sum(pins, (p) => p.x) / pins.length;
  const details = ["9,999 t silo space to lend", "combine busy · Favourable"];
  for (const p of pins) {
    const box = (anchor, x, y, k) => labelBox(x, y, anchor, p.name, details, FS.pinName * k, FS.pinDetail * k);
    const gap = p.r + (p.isOwn ? 10 : 8);
    const below = FS.pinName * RESERVE;
    const above = (details.length * 1.25 + 0.3) * FS.pinDetail * RESERVE - 0.15 * FS.pinName * RESERVE;
    const spots = [
      { anchor: "start", x: p.x + gap, y: p.y },
      { anchor: "end", x: p.x - gap, y: p.y },
      { anchor: "middle", x: p.x, y: p.y - gap - above },
      { anchor: "middle", x: p.x, y: p.y + gap + below },
    ];
    if (p.x < meanX) [spots[0], spots[1]] = [spots[1], spots[0]];
    const options = spots.map((s) => ({ ...s, big: box(s.anchor, s.x, s.y, RESERVE), small: box(s.anchor, s.x, s.y, 1) }));
    const pick = options.find((o) => isFree(o.big, reservedBig)) ?? options.find((o) => isFree(o.small, reservedBase)) ?? options[0];
    p.label = { anchor: pick.anchor, x: pick.x, y: pick.y };
    reservedBig.push(pick.big);
    reservedBase.push(pick.small);
  }

  // Arcs from our farm to each neighbour, drawn when the waiting plan asks for help: a borrowed
  // combine comes to us along one, our grain goes out along the other.
  const links = pins
    .filter((p) => !p.isOwn)
    .map((n) => {
      const dx = n.x - own.x;
      const dy = n.y - own.y;
      const len = Math.hypot(dx, dy) || 1;
      const bulge = Math.min(40, len * 0.3);
      const mx = (own.x + n.x) / 2;
      const my = (own.y + n.y) / 2;
      const options = [1, -1].map((sign) => {
        const nx = (-dy / len) * sign;
        const ny = (dx / len) * sign;
        const c = [mx + nx * bulge, my + ny * bulge];
        const back = [mx - nx * bulge, my - ny * bulge];
        const lx = mx + nx * (bulge / 2 + 10);
        const ly = my + ny * (bulge / 2 + 10);
        const anchor = Math.abs(nx) < 0.25 ? "middle" : nx > 0 ? "start" : "end";
        const box = (k) => {
          const fs = FS.link * k;
          const width = textW("borrow combine · deliver 9,999 t", fs);
          const top = ny < 0 ? ly - 1.2 * fs : ly - 0.5 * fs;
          return anchoredBox(lx, anchor, width, top, top + 1.6 * fs);
        };
        return { c, back, anchor, lx, ly, big: box(RESERVE), small: box(1) };
      });
      const pick = options.find((o) => isFree(o.big, reservedBig)) ?? options.find((o) => isFree(o.small, reservedBase)) ?? options[0];
      reservedBig.push(pick.big);
      reservedBase.push(pick.small);
      const end = (p, towards) => {
        const ex = towards[0] - p.x;
        const ey = towards[1] - p.y;
        const el = Math.hypot(ex, ey) || 1;
        const gap = p.r + (p.isOwn ? 9 : 5);
        return [p.x + (ex / el) * gap, p.y + (ey / el) * gap];
      };
      const arc = (from, to, c) => {
        const [x0, y0] = end(from, c);
        const [x1, y1] = end(to, c);
        return `M${f1(x0)} ${f1(y0)}Q${f1(c[0])} ${f1(c[1])} ${f1(x1)} ${f1(y1)}`;
      };
      return { id: n.id, name: n.name, toOwn: arc(n, own, pick.c), fromOwn: arc(own, n, pick.back), label: { anchor: pick.anchor, x: pick.lx, y: pick.ly } };
    });

  // Place names last: each takes the first of its spots that is still free, or stays off.
  const places = PLACE_LABELS.map((l) => {
    const fs = l.kind === "river" ? FS.place + 1 : FS.place;
    const k = l.kind === "river" ? 0.5 : 0.82;
    for (const [lon, lat] of l.spots) {
      const [x, y] = projection([lon, lat]);
      const width = textW(l.text, fs, k) + 8;
      const box = { x0: x - width / 2, x1: x + width / 2, y0: y - fs * 0.75, y1: y + fs * 0.45 };
      if (isFree(box, reservedBase)) {
        reservedBase.push(box);
        return `<text class="ds-map-place ds-map-place-${l.kind}" text-anchor="middle" x="${f1(x)}" y="${f1(y)}">${esc(l.text)}</text>`;
      }
    }
    return "";
  }).join("");

  const base = `
    <rect class="ds-map-abroad" x="0" y="0" width="${w}" height="${h}"/>
    ${states}
    <path class="ds-map-lowland" d="${path(lowland)}"><title>Oderbruch polder (outline approximate)</title></path>
    <path class="ds-map-river-bank" fill="none" d="${river}"/>
    <path class="ds-map-river" fill="none" d="${river}"><title>Oder</title></path>
    ${places}
    <g class="ds-map-pointer"><title>Berlin is ${pointer.km} km west of ${esc(OWN_FARM.name)}</title>
      <path class="ds-map-pointer-arrow" d="M8 -5L0 0L8 5" transform="translate(${f1(pointer.x)} ${f1(pointer.y)}) rotate(${f1(pointer.angle - 180)})"/>
      <text class="ds-map-pointer-label" x="${f1(pointer.x + 14)}" y="${f1(pointer.y)}" dy="0.35em">Berlin ${pointer.km} km</text>
    </g>
    ${scaleBar(w - 24 - barLen, h - 20, barLen, "10 km")}`;
  return { base, pins, links, fields, yard };
}

/** An SVG label of stacked lines. No whitespace between the tspans, so end-anchored text lines up. */
function svgText(cls, x, y, anchor, spans) {
  const tx = f1(x);
  const inner = spans.filter(Boolean).map((s) => html`<tspan${s.cls ? raw(` class="${s.cls}"`) : ""} x="${tx}" dy="${s.dy}">${s.text}</tspan>`);
  return html`<text class="${cls}" text-anchor="${anchor}" x="${tx}" y="${f1(y)}">${inner}</text>`;
}

function fieldTone(f) {
  if (f.coverCrop) return "cover";
  if (f.harvested) return "harvested";
  if (f.soilMoisturePct < f.stressThresholdPct) return "crit";
  if (f.soilMoisturePct < f.stressThresholdPct + NEAR) return "warn";
  return "ok";
}

function fieldShape(f, s) {
  const tone = fieldTone(s);
  const m = Math.round(s.soilMoisturePct);
  const name = FIELD_NAMES[f.field] ?? f.field;
  const status = tone === "harvested" ? "harvested" : tone === "cover" ? "cover crop sown" : `soil moisture ${m}%, stress below ${s.stressThresholdPct}%`;
  const summary = `${name}, ${s.crop} (${s.areaHa} ha): ${status}.`;
  const detail = tone === "harvested" ? "harvested" : tone === "cover" ? "cover crop" : `${m}%`;
  return html`<a class="ds-map-field is-${tone}" href="#${T.field(f.field)}" data-focus-key="ds-field-${FIELD_IDS[f.field]}" aria-label="${summary} Open the field.">
    <title>${summary}</title>
    <path class="ds-map-field-shape" d="${f.d}"/>
    ${svgText("ds-map-field-label", f.cx, f.cy, "middle", [
      { cls: "ds-map-field-name", dy: "-0.2em", text: f.field },
      { cls: "ds-map-field-detail", dy: "1.2em", text: detail },
    ])}
  </a>`;
}

function fieldInset(snap, m, lens) {
  const frame = html`<rect class="ds-map-inset-frame" x="${INSET.x}" y="${INSET.y}" width="${INSET.w}" height="${INSET.h}" rx="8"/>`;
  const title = (text) => html`<text class="ds-map-inset-title" x="${INSET.x + 14}" y="${INSET.y + 22}">${text}</text>`;
  if (!lens.fields) {
    const cx = INSET.x + INSET.w / 2;
    const cy = INSET.y + INSET.h / 2;
    return html`<g class="ds-map-inset is-hidden" role="note" aria-label="${OWN_FARM.name}'s fields are not shown to this role.">
      ${frame}${title(`${OWN_FARM.name}'s fields`)}
      ${svgText("ds-map-inset-note", cx, cy, "middle", [
        { cls: "ds-map-inset-big", dy: "-0.6em", text: "Not shown" },
        { dy: "1.6em", text: "Field data stays with the farm" },
        { dy: "1.25em", text: "(Farm manager only)" },
      ])}
    </g>`;
  }
  const shapes = m.fields.filter((f) => snap.fields?.[f.field]).map((f) => fieldShape(f, snap.fields[f.field]));
  const [yx, yy] = m.yard;
  return html`<g class="ds-map-inset" role="group" aria-label="Our three fields at ${OWN_FARM.name} (fictional shapes)">
    ${frame}${title("Our fields")}
    <text class="ds-map-inset-farm" text-anchor="end" x="${INSET.x + INSET.w - 14}" y="${INSET.y + 22}">fictional shapes</text>
    ${shapes}
    <rect class="ds-map-yard" x="${f1(yx - 4)}" y="${f1(yy - 4)}" width="8" height="8" rx="1.5"><title>Farmyard and silo</title></rect>
  </g>`;
}

/** The pin's colour: its crop condition where the lens sees it, else neutral. */
function pinTone(r, lens) {
  if (lens.status || (lens.own && r.isOwn)) return r.crop.tone;
  return "mute";
}

function helpText(h) {
  const parts = [];
  if (h.borrowFor.length) parts.push("borrow combine");
  if (h.deliverT > 0) parts.push(`deliver ${tonnes(h.deliverT)} t`);
  return parts.join(" · ");
}

function districtMap(ctx, rows, lens) {
  if (!libsReady()) {
    return html`<div class="pane ds-map-missing" role="alert"><p>The map library didn't load. Check your connection and reload.</p></div>`;
  }
  const { snap } = ctx;
  const m = baseMap();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const help = lens.perFarm ? helpAsked(snap) : {};
  const weather = (snap.scenarios ?? []).length ? ((snap.scenarios ?? []).some((s) => /^heatwave/i.test(s)) ? "crit" : "warn") : "";

  const links = m.links
    .filter((l) => help[l.name])
    .map((l) => {
      const h = help[l.name];
      const borrow = h.borrowFor.length > 0;
      const deliver = h.deliverT > 0;
      return html`<g class="ds-map-link-group">
        ${borrow ? html`<path class="ds-map-link is-flow" fill="none" d="${l.toOwn}" style="${phase(FLOW_MS)}"><title>${l.name}'s combine comes to ${OWN_FARM.name}</title></path>` : ""}
        ${deliver ? html`<path class="ds-map-link is-flow is-grain" fill="none" d="${l.fromOwn}" style="${phase(FLOW_MS)}"><title>Grain from ${OWN_FARM.name} goes to ${l.name}'s silo</title></path>` : ""}
        ${svgText("ds-map-link-label", l.label.x, l.label.y, l.label.anchor, [{ dy: "0.35em", text: helpText(h) }])}
      </g>`;
    });

  const pins = lens.perFarm
    ? m.pins.map((p) => {
        const r = byId[p.id];
        if (!r) return "";
        const tone = pinTone(r, lens);
        const o = r.offer;
        const lend = o ? `${tonnes(o.storageT)} t silo space to lend` : "no offer yet";
        const combine = o?.combine ? "combine free" : "no combine";
        const condition = tone === "mute" ? "" : ` · ${r.crop.label}`;
        const summary = `${r.name} (fictional): ${lend}, ${combine}${tone === "mute" ? "" : `, crop condition ${conditionText(r.crop)}`}. Open the farm.`;
        const { anchor, x, y } = p.label;
        return html`<a class="ds-map-pin ds-map-pin-${p.index}${p.isOwn ? " is-own" : ""}" href="#${T.farm(p.id)}" data-focus-key="ds-pin-${p.id}" aria-label="${summary}">
          <title>${summary}</title>
          <circle class="ds-map-hit-area" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 10)}"/>
          ${p.isOwn && weather ? html`<circle class="ds-map-pulse is-${weather}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 3)}" style="${phase(PULSE_MS)}"/>` : ""}
          <circle class="ds-map-focus" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + (p.isOwn ? 10 : 6))}"/>
          ${p.isOwn ? html`<circle class="ds-map-pin-own" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 4.5)}"/>` : ""}
          <circle class="ds-map-pin-dot is-${tone}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r)}"/>
          ${svgText("ds-map-label", x, y, anchor, [
            { cls: "ds-map-pin-name", dy: "-0.15em", text: p.name },
            { cls: "ds-map-pin-detail", dy: "1.25em", text: lend },
            { cls: "ds-map-pin-detail", dy: "1.25em", text: `${combine}${condition}` },
          ])}
        </a>`;
      })
    : [];

  const tones = new Set(rows.map((r) => pinTone(r, lens)));
  const helping = links.length > 0;
  const label = lens.perFarm
    ? "Map of the Oderbruch with the three fictional demo farms. Select a farm to open it."
    : "Map of the Oderbruch. Single farms are not shown to this role.";
  return html`<div class="pane ds-map-card">
    <svg class="ds-map-svg" viewBox="0 0 ${VIEWBOX[0]} ${VIEWBOX[1]}" role="group" aria-label="${label}">${raw(m.base)}${links}${pins}${fieldInset(snap, m, lens)}</svg>
    <div class="ds-map-foot">
      <div class="legend">
        ${
          lens.perFarm
            ? html`${tones.has("ok") ? html`<span><i class="swatch ds-sw-tone is-ok"></i>Favourable</span>` : ""}
              ${tones.has("warn") ? html`<span><i class="swatch ds-sw-tone is-warn"></i>Watch · dry</span>` : ""}
              ${tones.has("crit") ? html`<span><i class="swatch ds-sw-tone is-crit"></i>Poor · dry</span>` : ""}
              ${tones.has("mute") ? html`<span><i class="swatch ds-sw-tone is-mute"></i>Condition not shown</span>` : ""}
              <span><i class="swatch ds-sw-own"></i>Outlined: ${OWN_FARM.name}, the farm the demo follows</span>
              ${helping ? html`<span><i class="swatch ds-sw-flow"></i>Help in the waiting plan</span>` : ""}`
            : html`<span>${prov("notshown")} Farm pins: national and global views hold totals only</span>`
        }
        <span><i class="swatch ds-sw-lowland"></i>Oderbruch polder</span>
      </div>
      <span class="faint">${
        lens.perFarm
          ? "Fictional farms on a hand-drawn outline. Pin size: farm area; colour: crop condition from soil moisture."
          : "Hand-drawn outline of the polder and the Oder."
      } Real field parcels come later, coloured by their official crop only.</span>
    </div>
  </div>`;
}

// =====================================================================================
// Farm table, totals, rail
// =====================================================================================
function needsCell(r, lens) {
  if (!lens.status && !(lens.own && r.isOwn)) return html`<span class="faint">${prov("notshown", { title: "A farm's needs are shared with the district and the sharing network" })}</span>`;
  if (!r.needs.length) return html`<span class="faint">Nothing today</span>`;
  return html`<ul class="ds-needs">${r.needs.map((n) => html`<li>${n.text}${n.from ? html`<small>asked of ${n.from}</small>` : ""}</li>`)}</ul>`;
}

function statusCell(r, lens, snap) {
  if (!lens.status && !(lens.own && r.isOwn)) return prov("notshown", { title: "A farm's status is shared with the district, not with other farms" });
  const ops = r.isOwn ? farmOps(snap) : null;
  return html`<span class="ds-status">${pill(conditionText(r.crop), r.crop.tone, { title: CROP_RULE })}${ops ? pill(ops.label, ops.tone, { title: ops.title }) : ""}</span>`;
}

function lendCell(r) {
  const o = r.offer;
  if (!o) return html`<span class="faint">No offer yet</span>`;
  return html`<span class="ds-lend"><b>${o.combine ? "Combine" : "No combine"}</b> · ${keptBackText(o)}<small>${tonnes(o.freeT)} t free · until ${o.validUntil}</small></span>`;
}

/** " So Hof Lerchenbruch's 330 t free means 280 t to lend." from today's numbers. */
function keptBackExample(rows) {
  const r = rows.find((x) => x.isOwn && x.offer) ?? rows.find((x) => x.offer);
  return r ? ` So ${r.name}'s ${tonnes(r.offer.freeT)} t free means ${tonnes(r.offer.storageT)} t to lend.` : "";
}

function farmTable(ctx, rows, lens) {
  const { snap } = ctx;
  const sim = simProv(snap);
  if (!lens.perFarm) {
    const bands = ["favourable", "watch", "poor"].map((k) => ({ k, n: rows.filter((r) => r.crop.label.toLowerCase() === k).length })).filter((b) => b.n);
    return html`<section class="pane" aria-labelledby="ds-farms-title">
      <header class="pane-head"><div><h2 id="ds-farms-title">Demo farms in the sharing network</h2><p>As district totals</p></div>${lens.totals ? sim : prov("notshown")}</header>
      <div class="pane-body ds-totals">
        ${
          lens.totals
            ? html`<dl class="kv">
                <dt>Demo farms</dt><dd>${rows.length}</dd>
                <dt>Crop condition</dt><dd>${bands.map((b) => `${b.n} ${b.k}`).join(" · ") || "–"}</dd>
                <dt>Farmland of the demo farms</dt><dd>${fmt(sum(rows, (r) => r.areaHa ?? 0))} ha</dd>
              </dl>`
            : ""
        }
        ${notShown("district", { what: "The farm-by-farm table", seenBy: roleOf("district").name })}
        <div class="row">${asFarmerButton()}</div>
      </div>
    </section>`;
  }
  return html`<section class="pane ds-farms" aria-labelledby="ds-farms-title">
    <header class="pane-head">
      <div><h2 id="ds-farms-title">Farms in the sharing network</h2><p>Three fictional demo farms. Select one to open it.</p></div>
      ${sim}
    </header>
    <div class="table-wrap">
      <table class="t ds-table">
        <caption class="sr-only">Demo farms: status, what each can lend and what each needs today</caption>
        <thead><tr><th scope="col">Farm (fictional)</th><th scope="col" class="stcol">Status</th><th scope="col">Can lend</th><th scope="col">Needs</th></tr></thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr data-go="${T.farm(r.id)}" class="ds-row-${r.index}${r.isOwn ? " is-own" : ""}">
              <td class="ds-name"><a href="#${T.farm(r.id)}" data-focus-key="ds-row-${r.id}">${r.name}</a>
                <small>${r.crops} · ${fmt(r.areaHa)} ha${r.isOwn ? " · the farm the demo follows" : ""}</small>
                <span class="show-s">${statusCell(r, lens, snap)}</span></td>
              <td class="stcol">${statusCell(r, lens, snap)}</td>
              <td>${lendCell(r)}</td>
              <td>${needsCell(r, lens)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <footer class="pane-foot"><span>Can lend: what each farm offered the sharing network today. ${HOLDBACK_NOTE}${keptBackExample(rows)}</span></footer>
  </section>`;
}

/** Public orders: the real surface-water ban (Official) and the simulated scenario orders. */
function orderItems(ctx) {
  const { snap } = ctx;
  const ban = realValue(ctx.data, "mol.surfaceWaterBan");
  const items = [
    html`<li class="req">
      <div class="req-top"><span class="req-from">District water authority · public order</span>${realBadge(ban, ctx)}</div>
      <div class="req-what">Surface-water ban: ${ban ? realText(ban) : "unknown"}</div>
      <p class="req-why">No water may be taken from rivers, ditches or lakes without a permit of its own.${ban?.asOf ? ` As of ${asOfText(ban.asOf)}.` : ""}</p>
    </li>`,
  ];
  for (const msg of snap.scenarios ?? []) {
    const heat = /^heatwave/i.test(msg);
    items.push(html`<li class="req">
      <div class="req-top"><span class="req-from">${heat ? "District water authority · order" : "Weather service · warning"}</span>${simProv(snap)}</div>
      <div class="req-what">${msg[0].toUpperCase()}${msg.slice(1)}</div>
      ${heat && snap.heatwaveDaysRemaining ? html`<p class="req-why">${plural(snap.heatwaveDaysRemaining, "day")} left. Applies to the demo farms only.</p>` : ""}
    </li>`);
  }
  return items;
}

function requestsCard(ctx, rows, lens) {
  const { snap } = ctx;
  const sim = simProv(snap);
  const help = Object.entries(helpAsked(snap));
  const items = [...orderItems(ctx)];
  const offers = rows.filter((r) => r.offer && (r.offer.combine > 0 || r.offer.storageT > 0));
  if (lens.perFarm) {
    for (const [name, h] of help) {
      for (const line of helpLines(name, h)) {
        items.push(html`<li class="req is-ask">
          <div class="req-top"><span class="req-from">${OWN_FARM.name} · request</span>${pill("Asks for help", "warn")}</div>
          <div class="req-what">${line}</div>
          <p class="req-why">In the plan for ${snap.pendingBundle?.planFor ?? "today"}, waiting for the farm manager's decision.</p>
        </li>`);
      }
    }
    for (const r of offers) {
      items.push(html`<li class="req">
        <div class="req-top"><span class="req-from">${r.name} · offer</span>${sim}</div>
        <div class="req-what">${r.offer.combine ? "Its combine and " : ""}${keptBackText(r.offer)}</div>
        <p class="req-why">Until ${r.offer.validUntil}, ${confWord(r.offer.confidence)}.</p>
      </li>`);
    }
  } else if (lens.totals) {
    const asks = help.reduce((n, [name, h]) => n + helpLines(name, h).length, 0);
    items.push(html`<li class="req">
      <div class="req-top"><span class="req-from">Sharing network · totals</span>${sim}</div>
      <div class="req-what">${plural(asks, "open request")} · ${plural(offers.length, "offer")}</div>
      <p class="req-why">${plural(offers.filter((r) => r.offer.combine > 0).length, "combine")} and ${tonnes(sum(offers, (r) => r.offer.storageT))} t of silo space offered. Who asks whom stays in the district.</p>
    </li>`);
  }
  const count = lens.perFarm ? help.length : 0;
  return html`<section class="pane pane-req" id="requests" aria-labelledby="ds-req-title">
    <header class="pane-head">
      <div><h2 id="ds-req-title">Requests &amp; offers${count ? html` <span class="pane-count">${count}</span>` : ""}</h2><p>Public orders, the farms' requests and what they offer</p></div>
    </header>
    <ul class="req-list">${items}</ul>
    ${lens.totals ? "" : html`<div class="pane-body">${notShown("district", { what: "The list of requests and offers between farms", seenBy: roleOf("district").name })}</div>`}
  </section>`;
}

function sharedUpCard(ctx, rows, lens) {
  const bands = ["Favourable", "Watch", "Poor"].map((k) => `${rows.filter((r) => r.crop.label === k).length} ${k.toLowerCase()}`).join(" · ");
  return html`<section class="pane" aria-labelledby="ds-up-title">
    <header class="pane-head"><div><h2 id="ds-up-title">Shared up</h2><p>What the district passes on, channel by channel</p></div>${prov("illustrative")}</header>
    <div class="pane-body">
      <dl class="kv">
        <dt>To the Land: crop condition bands of the farms</dt><dd>${lens.totals ? bands : "–"}</dd>
        <dt>To the state environment office: water taken against permits</dt><dd>Weekly</dd>
        <dt>To the paying agency: checked subsidy applications</dt><dd>Yearly</dd>
        <dt>To the state vet office: animal-disease zones</dt><dd>Within 24 h</dd>
      </dl>
      <div class="never"><b>Never leaves the district:</b> single farms' crop plans, prices and finances.</div>
    </div>
  </section>`;
}

/** Real context in its own strip, never mixed with the simulated farms. */
function contextStrip(ctx) {
  const keys = [
    ["bb.farms", "Brandenburg farms"],
    ["bb.meanSizeHa", "Mean farm size", "ha"],
    ["oderbruch.medianFieldHa", "Median field", "ha"],
    ["oderbruch.waterBalanceMm", "Rain minus crop water use", "mm a year"],
  ];
  const items = keys.map(([key, label, unit]) => {
    const rv = realValue(ctx.data, key);
    return html`<span class="ds-ctx-item">${label} <b>${realText(rv)}</b>${rv && unit ? ` ${unit}` : ""}${rv?.asOf ? html` <span class="faint">(${asOfText(rv.asOf)})</span>` : ""} ${realBadge(rv, ctx)}</span>`;
  });
  return html`<div class="ds-ctx" aria-label="Real context">
    <span class="ds-ctx-k">Real context</span>
    ${items}
    <span class="faint ds-ctx-note">The demo farms are smaller: ${OWN_FARM.name} farms ${fmt(OWN_FARM.areaHa)} ha in ${FIELDS.length} fields.</span>
  </div>`;
}

function districtSources(ctx) {
  const { snap } = ctx;
  const keys = ["mol.surfaceWaterBan", "mol.farms", "mol.uaaHa", "bb.farms", "bb.meanSizeHa", "oderbruch.medianFieldHa", "oderbruch.waterBalanceMm"];
  const real = keys.map((k) => realValue(ctx.data, k)).filter(Boolean);
  return sourcesFooter([
    { badge: simProv(snap), text: `Demo farms: three fictional farms, their offers and requests, simulated with seed ${snap.seed}. Their positions on the map are illustrative.` },
    ...(real.length
      ? real.map((rv) => ({ badge: realBadge(rv, ctx), text: realSource(rv) }))
      : [{ badge: realBadge(null, ctx), text: "District statistics (data/real.json): not loaded. Shown as Unknown, never as 0." }]),
    { badge: prov("notshown"), text: "Real field parcels (IACS, geobasis-bb, dl-de/by-2.0): open data, not drawn yet. They come later with their official crop and area only, never with a simulated number." },
    { badge: prov("illustrative"), text: "Shared up and the channels show how a real district reports; nothing is sent anywhere. Map: the Oderbruch outline and the Oder simplified by hand; German states from deutschlandGeoJSON (Unlicense)." },
  ]);
}

// =====================================================================================
// Entry point
// =====================================================================================
export function render(container, ctx) {
  const { snap } = ctx;
  const lens = lensOf(ctx);
  const rows = farmRows(snap);
  const needing = rows.filter((r) => r.needs.length);
  const status = !lens.totals
    ? null
    : needing.length
      ? { text: `${plural(needing.length, "farm")} need${needing.length === 1 ? "s" : ""} help`, tone: needing.some((r) => r.needs.some((n) => n.urgent)) ? "crit" : "warn", title: "A request to the sharing network, dry soil or a full silo" }
      : { text: "No farm needs help", tone: "ok" };
  const key = focusedKey(container);
  container.innerHTML = String(html`
    <div class="pg ds-pg">
      ${pageHead({
        level: "District",
        place: `Märkisch-Oderland · ${REGION.name} · viewing as ${roleOf(lens.role).name}`,
        title: "Which farms need help today, and who can lend it?",
        question: "The district authorities and the machinery-sharing network see each farm's status and offers; the farms keep their fields to themselves.",
        sees: lens.level === "full" ? SEES.full : lens.perFarm ? SEES.peer : lens.totals ? SEES.aggregate : SEES.none,
        status,
        fresh: { badge: simProv(snap), text: `Demo day ${snap.date}${statsYear(ctx)}` },
      })}
      ${districtKpis(ctx, rows, lens)}
      ${contextStrip(ctx)}
      <div class="pg-grid">
        <div class="pg-main">
          ${districtMap(ctx, rows, lens)}
          ${farmTable(ctx, rows, lens)}
        </div>
        <aside class="pg-rail" aria-label="Requests, offers and sharing">
          ${requestsCard(ctx, rows, lens)}
          ${sharedUpCard(ctx, rows, lens)}
        </aside>
      </div>
      ${levelsPanel("district", { place: REGION.name, links: { farm: T.farm(OWN_FARM.id), field: T.field(FIELDS[0]) }, role: roleId(ctx) })}
      ${districtSources(ctx)}
    </div>
  `);
  restoreFocus(container, key);
  container.onclick = (event) => handleLensClick(event, ctx);
  container.onchange = container.oninput = container.onsubmit = container.onkeydown = null;
}

function statsYear(ctx) {
  const rv = realValue(ctx.data, "mol.farms");
  return rv?.asOf ? ` · district statistics ${asOfText(rv.asOf)}` : "";
}

// -- focus: a re-render every simulated day must not throw the keyboard user out ---------------
function focusedKey(container) {
  if (typeof document === "undefined" || typeof container.contains !== "function") return null;
  const el = document.activeElement;
  return el && container.contains(el) ? el.getAttribute("data-focus-key") : null;
}

function restoreFocus(container, key) {
  if (!key || typeof container.querySelector !== "function") return;
  const el = container.querySelector(`[data-focus-key="${key}"]`);
  if (el) el.focus({ preventScroll: true });
}
