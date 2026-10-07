// The three map levels of the twin: Earth (1), Germany (2) and the Oderbruch (3).
// d3 and topojson are globals from index.html. The projected base maps are built once per
// level and cached; each render only redraws the live overlays (pins, rings, numbers, flows).

import germanyGeo from "../data/germany.js";
import { LENGTH_KM, ODER, OUTLINE, PLACE_LABELS } from "../data/oderbruch.js";
import {
  BERLIN,
  FARM_BY_ID,
  FARMS,
  FARMYARD,
  FIELD_IDS,
  FIELD_NAMES,
  FIELD_POLYGONS,
  FIELDS,
  OWN_FARM,
  REGION,
} from "../data/places.js";
import worldTopo from "../data/world.js";
import { chip, confBar, esc, html, meter, pct, plural, raw } from "./dom.js";

// Equal Earth is about 2.05:1, so the world viewBox is a little flatter than 16:9.
const VIEWBOX = { 1: [960, 480], 2: [640, 760], 3: [960, 720] };
const EARTH_KM = "12,742 km";
const GERMANY_KM = "876 km north–south";
const EARTH_RADIUS_KM = 6371;
const PULSE_MS = 2400;
const FLOW_MS = 1200;
const PIN_R_MAX = 14;

// Label sizes in viewBox units; maps.css enlarges them on narrow maps, so the Oderbruch
// layout reserves room for labels this much bigger than the base size.
const FS = { pinName: 15, pinDetail: 13, link: 12.5, place: 12 };
const RESERVE = 1.3;

// The inset with our three fields sits in the empty bottom-left corner of the Oderbruch map.
const INSET = { x: 16, y: VIEWBOX[3][1] - 16 - 250, w: 260, h: 250 };

/** Farm status (FarmSummary.status): soil moisture and silo fill, see types.js. */
const STATUS_LABEL = { ok: "Normal", warn: "Watch", crit: "Critical" };
const TONE_RANK = { ok: 0, warn: 1, crit: 2 };
/** A field is "close to stress" this many points above its crop's stress threshold. */
const MOISTURE_NEAR = 10;
const FIELD_TONE_LABEL = {
  ok: "soil moisture comfortable",
  warn: "soil moisture close to the stress level",
  crit: "soil moisture below the stress level",
  harvested: "harvested",
  cover: "cover crop sown",
};

const f1 = (n) => Math.round(n * 10) / 10;
const int = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const sum = (xs, fn) => xs.reduce((n, x) => n + fn(x), 0);
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
// Keep animations continuous across re-renders: start each one at the current phase.
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`;

// -- routes -------------------------------------------------------------------------
// Plain hash tokens: "earth", "germany", "oderbruch", "<farmId>", "<farmId>.<fieldId>".
// ctx.routes comes from main.js; the fallbacks keep the maps working if one is missing.
function routeTokens(ctx) {
  const r = ctx.routes ?? {};
  return {
    earth: r.earth ?? "earth",
    germany: r.germany ?? "germany",
    oderbruch: r.oderbruch ?? REGION.id,
    farm: (id) => (typeof r.farm === "function" ? r.farm(id) : id),
    field: (field) => (typeof r.field === "function" ? r.field(field) : `${OWN_FARM.id}.${FIELD_IDS[field]}`),
  };
}

// -- numbers ------------------------------------------------------------------------
function statusOf(moisture, fill) {
  if (moisture < 35 || fill > 0.95) return "crit";
  if (moisture < 45 || fill > 0.85) return "warn";
  return "ok";
}

function farmStats(f) {
  const capacity = f.storageCapacityT ?? 0;
  const fill = capacity > 0 ? Math.min(1, Math.max(0, 1 - f.storageFreeT / capacity)) : 0;
  const moisture = f.avgSoilMoisturePct ?? 0;
  const tone = f.status in TONE_RANK ? f.status : statusOf(moisture, fill);
  const reasons = [];
  if (moisture < 45) reasons.push(`soil moisture ${Math.round(moisture)}%`);
  if (fill > 0.85) reasons.push(`silo ${pct(fill)} full`);
  return {
    ...f,
    place: FARM_BY_ID[f.id] ?? null,
    index: FARMS.findIndex((x) => x.id === f.id),
    fill,
    moisture: Math.round(moisture),
    combineFree: f.combineAvailable > 0,
    tone,
    reasons,
  };
}

function regionStats(snap) {
  const farms = (snap.farms ?? []).map(farmStats);
  // The first farm with the worst status (our own farm comes first, so it wins a tie).
  const worst = farms.reduce((a, b) => (a && TONE_RANK[a.tone] >= TONE_RANK[b.tone] ? a : b), null);
  return {
    farms,
    own: farms.find((f) => f.isOwn) ?? null,
    count: farms.length,
    areaHa: sum(farms, (f) => f.areaHa ?? 0),
    siloFree: sum(farms, (f) => f.storageFreeT ?? 0),
    combinesFree: farms.filter((f) => f.combineFree).length,
    worst,
    worstTone: worst ? worst.tone : "ok",
  };
}

/** What the plan waiting for a decision asks of each neighbour, by farm name. */
function ringHelp(snap) {
  const help = {};
  for (const p of snap.pendingBundle?.proposals ?? []) {
    for (const a of p.actions ?? []) {
      if (!a.farm || (a.type !== "borrow_combine" && a.type !== "deliver_to")) continue;
      const h = (help[a.farm] ??= { borrowFor: [], deliverT: 0 });
      if (a.type === "borrow_combine") h.borrowFor.push(p.field);
      else h.deliverT += a.tonnes ?? 0;
    }
  }
  return help;
}

const fieldList = (fields) => fields.map((f) => FIELD_NAMES[f] ?? f).join(" and ");

/** "borrow combine · deliver 109 t": what the waiting plan asks of one neighbour. */
function helpText(h) {
  const parts = [];
  if (h.borrowFor.length) parts.push("borrow combine");
  if (h.deliverT > 0) parts.push(`deliver ${int(h.deliverT)} t`);
  return parts.join(" · ");
}

/** The same as a sentence fragment: "borrow Gut Rohrdommelsee's combine for West field and ...". */
function helpSentence(name, h) {
  const parts = [];
  if (h.borrowFor.length) parts.push(`borrow ${name}'s combine for ${fieldList(h.borrowFor)}`);
  if (h.deliverT > 0) parts.push(`deliver ${int(h.deliverT)} t of our grain to ${name}`);
  return parts.join(" and ");
}

const shareText = (report) =>
  report ? `can share ${plural(report.canShare.combine, "combine")} · ${int(report.canShare.storageT)} t` : "no report yet";

function fieldTone(f) {
  if (f.coverCrop) return "cover";
  if (f.harvested) return "harvested";
  if (f.soilMoisturePct < f.stressThresholdPct) return "crit";
  if (f.soilMoisturePct < f.stressThresholdPct + MOISTURE_NEAR) return "warn";
  return "ok";
}

// -- shared bits ----------------------------------------------------------------------
function scenarioChips(snap) {
  return (snap.scenarios ?? []).map((s) => {
    const heat = /^heatwave/i.test(s);
    const days = heat ? snap.heatwaveDaysRemaining : 0;
    return chip(`${upperFirst(s)}${days ? ` · ${plural(days, "day")} left` : ""}`, heat ? "crit" : "warn");
  });
}

/** "crit" while a heatwave runs, "warn" for a hail warning alone, "" when the weather is calm. */
function alertTone(snap) {
  const s = snap.scenarios ?? [];
  if (!s.length) return "";
  return s.some((x) => /^heatwave/i.test(x)) ? "crit" : "warn";
}

function planChip(snap, t, focusKey) {
  const plan = snap.pendingBundle;
  if (!plan) return chip("No plan waiting", "", { plain: true });
  return html`<a class="chip chip-accent" href="#${t.farm(OWN_FARM.id)}" data-focus-key="${focusKey}">Plan for ${plan.planFor} waiting</a>`;
}

function worstChip(net) {
  const f = net.worst;
  if (!f) return "";
  if (f.tone === "ok") return chip(`All ${plural(net.count, "farm")} normal`, "ok", { title: "Soil moisture and silo fill" });
  return chip(`${STATUS_LABEL[f.tone]}: ${f.name}, ${f.reasons.join(", ")}`, f.tone, {
    title: "The farm with the driest soil or the fullest silo",
  });
}

function stat(value, label) {
  return html`<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function head({ eyebrow, title, lede, chips }) {
  return html`<div class="view-head">
    <div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${lede}</p></div>
    <div class="row">${chips}</div>
  </div>`;
}

function libsReady(level) {
  const { d3, topojson } = globalThis;
  if (!d3 || typeof d3.geoPath !== "function") return false;
  return level !== 1 || Boolean(topojson && typeof topojson.feature === "function");
}

function geoPath(projection) {
  const path = globalThis.d3.geoPath(projection);
  if (typeof path.digits === "function") path.digits(1);
  return path;
}

/** A Polygon feature for a closed [lon, lat] ring, wound clockwise as d3-geo expects. */
function polygon(ring, properties = {}) {
  const feature = { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
  // Wound the other way, d3 would read the ring as "the whole globe except this field".
  if (globalThis.d3.geoArea(feature) > 2 * Math.PI) feature.geometry.coordinates = [[...ring].reverse()];
  return feature;
}

/** Great-circle distance between two [lon, lat] points (haversine; works without d3). */
function distanceKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Screen length of `km` kilometres along the parallel at `lat` (for scale bars). */
function kmToUnits(projection, lon, lat, km) {
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return projection([lon + dLon, lat])[0] - projection([lon, lat])[0];
}

function scaleBar(x, y, length, label) {
  return `<g class="map-scale" aria-hidden="true">
    <path class="map-scale-bar" fill="none" d="M${f1(x)} ${f1(y - 5)}V${f1(y)}H${f1(x + length)}V${f1(y - 5)}"/>
    <text class="map-scale-label" x="${f1(x)}" y="${f1(y - 9)}">${label}</text>
  </g>`;
}

// -- label layout (Oderbruch) ----------------------------------------------------------
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

// -- base maps (cached per level) ----------------------------------------------------------
const cache = new Map();

function baseMap(level) {
  if (!cache.has(level)) cache.set(level, BUILDERS[level]());
  return cache.get(level);
}

function buildEarth() {
  const { d3, topojson } = globalThis;
  const [w, h] = VIEWBOX[1];
  const sphere = { type: "Sphere" };
  const projection = d3.geoEqualEarth().fitExtent(
    [
      [10, 10],
      [w - 10, h - 10],
    ],
    sphere,
  );
  const path = geoPath(projection);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);
  const de = countries.features.find((f) => String(f.id) === "276");
  // Merged land plus a border mesh is about half the markup of 177 country outlines.
  const land = topojson.feature(worldTopo, worldTopo.objects.land);
  const borders = topojson.mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
  const graticule = d3.geoGraticule().step([20, 20]);
  const base = `
    <path class="map-sphere" d="${path(sphere)}"/>
    <path class="map-graticule" fill="none" d="${path(graticule())}"/>
    <path class="map-land" d="${path(land)}"/>
    <path class="map-borders" fill="none" d="${path(borders)}"/>`;
  return { base, germany: path(de), centroid: path.centroid(de), region: projection([REGION.lon, REGION.lat]) };
}

function buildGermany() {
  const { d3 } = globalThis;
  const [w, h] = VIEWBOX[2];
  // Lambert conformal conic with Germany's usual standard parallels: north stays up and the
  // country keeps its familiar shape.
  const projection = d3
    .geoConicConformal()
    .parallels([48.67, 53.67])
    .rotate([-10.45, 0])
    .fitExtent(
      [
        [24, 24],
        [w - 24, h - 24],
      ],
      germanyGeo,
    );
  const path = geoPath(projection);
  const bb = germanyGeo.features.find((f) => f.properties.id === "DE-BB");
  const states = germanyGeo.features
    .filter((f) => f !== bb)
    .map((f) => `<path class="map-state" d="${path(f)}"><title>${esc(f.properties.name)}</title></path>`)
    .join("");
  const [bx, by] = projection([BERLIN.lon, BERLIN.lat]);
  const [rx, ry] = projection([REGION.lon, REGION.lat]);
  // Berlin sits just west of the Oderbruch, so its name goes on its far side.
  const berlinRef = `<g class="map-city"><title>Berlin, for orientation: not part of the twin</title>
      <circle class="map-city-dot" cx="${f1(bx)}" cy="${f1(by)}" r="3.5"/>
      <text class="map-city-label" text-anchor="end" x="${f1(bx - 7)}" y="${f1(by)}" dy="0.35em">Berlin</text></g>`;
  const bar = kmToUnits(projection, 10.45, 51.2, 100);
  const base = `
    <rect class="map-water" x="0" y="0" width="${w}" height="${h}"/>
    ${states}
    ${scaleBar(24, h - 24, bar, "100 km")}`;
  // The region's label goes below its ring, right-aligned so it stays inside the map: Poland
  // is right next to it and Berlin's label to its left.
  const label = { x: Math.min(w - 24, rx + 70), y: ry + 52 };
  return { base, brandenburg: path(bb), region: [rx, ry], berlinRef, label };
}

function buildOderbruch() {
  const { d3 } = globalThis;
  const [w, h] = VIEWBOX[3];
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
  const states = germanyGeo.features
    .map((f) => ({ f, d: path(f) }))
    .filter((s) => s.d)
    .map((s) => `<path class="map-state" d="${s.d}"><title>${esc(s.f.properties.name)}</title></path>`)
    .join("");
  const river = path({ type: "LineString", coordinates: ODER });

  // Our fields, magnified in an inset: at this scale all three fit under the farm's pin.
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

  // Pins: radius by farm area (area-true), our farm gets an extra ring.
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
  const details = ["9,999 t silo free", "combine busy · soil 99%"];
  for (const p of pins) {
    const name = `${p.name}${p.isOwn ? " (ours)" : ""}`;
    const box = (anchor, x, y, k) => labelBox(x, y, anchor, name, details, FS.pinName * k, FS.pinDetail * k);
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

  // Connectors from our farm to each neighbour: a gentle arc, its label beyond the bulge.
  // A delivery of our grain runs back along a second arc on the other side.
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
          const width = Math.max(textW("can share 9 combines · 9,999 t", fs), textW("borrow combine · deliver 9,999 t", fs));
          const top = ny < 0 ? ly - 2.2 * fs : ly - 0.5 * fs;
          return anchoredBox(lx, anchor, width, top, top + 2.6 * fs);
        };
        return { c, back, anchor, lx, ly, up: ny < 0, big: box(RESERVE), small: box(1) };
      });
      const pick =
        options.find((o) => isFree(o.big, reservedBig)) ?? options.find((o) => isFree(o.small, reservedBase)) ?? options[0];
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
      return {
        id: n.id,
        name: n.name,
        // Both paths run in the direction things move: the combine comes to us, grain goes out.
        toOwn: arc(n, own, pick.c),
        fromOwn: arc(own, n, pick.back),
        label: { anchor: pick.anchor, x: pick.lx, y: pick.ly, up: pick.up },
      };
    });

  // Place names last: each takes the first of its spots that is still free, or stays off.
  const places = PLACE_LABELS.map((l) => {
    const fs = l.kind === "river" ? FS.place + 1 : FS.place;
    const k = l.kind === "river" ? 0.5 : 0.82; // uppercase, letter-spaced names run wider
    for (const [lon, lat] of l.spots) {
      const [x, y] = projection([lon, lat]);
      const width = textW(l.text, fs, k) + 8;
      const box = { x0: x - width / 2, x1: x + width / 2, y0: y - fs * 0.75, y1: y + fs * 0.45 };
      if (isFree(box, reservedBase)) {
        reservedBase.push(box);
        return `<text class="map-place map-place-${l.kind}" text-anchor="middle" x="${f1(x)}" y="${f1(y)}">${esc(l.text)}</text>`;
      }
    }
    return "";
  }).join("");

  const base = `
    <rect class="map-abroad" x="0" y="0" width="${w}" height="${h}"/>
    ${states}
    <path class="map-lowland" d="${path(lowland)}"><title>Oderbruch lowland (outline approximate)</title></path>
    <path class="map-river-bank" fill="none" d="${river}"/>
    <path class="map-river" fill="none" d="${river}"><title>Oder</title></path>
    ${places}
    <g class="map-pointer"><title>Berlin is ${pointer.km} km west of ${esc(OWN_FARM.name)}</title>
      <path class="map-pointer-arrow" d="M8 -5L0 0L8 5" transform="translate(${f1(pointer.x)} ${f1(pointer.y)}) rotate(${f1(pointer.angle - 180)})"/>
      <text class="map-pointer-label" x="${f1(pointer.x + 14)}" y="${f1(pointer.y)}" dy="0.35em">Berlin ${pointer.km} km</text>
    </g>
    ${scaleBar(w - 24 - barLen, h - 20, barLen, "10 km")}`;
  return { base, pins, links, fields, yard };
}

const BUILDERS = { 1: buildEarth, 2: buildGermany, 3: buildOderbruch };

// -- the map cards ----------------------------------------------------------------------------
function missingCard() {
  return html`<div class="card map-missing" role="alert">
    <p>The map library didn't load. Check your connection and reload.</p>
  </div>`;
}

function svg(level, label, content) {
  const [w, h] = VIEWBOX[level];
  const cls = { 1: "earth", 2: "germany", 3: "oderbruch" }[level];
  return html`<svg class="map-svg map-svg-${cls}" viewBox="0 0 ${w} ${h}" role="group" aria-label="${label}">${content}</svg>`;
}

/** An SVG label of stacked lines. No whitespace between the tspans, so end-anchored text lines up. */
function svgText(cls, x, y, anchor, spans) {
  const tx = f1(x);
  const inner = spans
    .filter(Boolean)
    .map((s) => html`<tspan${s.cls ? raw(` class="${s.cls}"`) : ""} x="${tx}" dy="${s.dy}">${s.text}</tspan>`);
  return html`<text class="${cls}" text-anchor="${anchor}" x="${tx}" y="${f1(y)}">${inner}</text>`;
}

function earthMap(snap, net, t) {
  const m = baseMap(1);
  const [rx, ry] = m.region;
  const [cx, cy] = m.centroid;
  const weather = alertTone(snap);
  const overlay = html`
    <g class="map-hit" data-go="${t.germany}" role="link" tabindex="0" data-focus-key="earth-germany"
      aria-label="Germany: ${plural(net.count, "farm")} in the Oderbruch, Brandenburg. Zoom in.">
      <title>Germany: zoom in</title>
      <circle class="map-hit-area" cx="${f1(cx)}" cy="${f1(cy)}" r="34"/>
      <circle class="map-focus" cx="${f1(cx)}" cy="${f1(cy)}" r="26"/>
      <circle class="map-target-ring" cx="${f1(cx)}" cy="${f1(cy)}" r="19"/>
      <path class="map-de" d="${m.germany}"/>
      <path class="map-leader" fill="none" d="M${f1(rx + 5)} ${f1(ry)}H${f1(rx + 25)}"/>
      <circle class="map-pulse${weather ? ` is-${weather}` : ""}" cx="${f1(rx)}" cy="${f1(ry)}" r="6" style="${phase(PULSE_MS)}"/>
      <circle class="map-marker" cx="${f1(rx)}" cy="${f1(ry)}" r="3"/>
      ${svgText("map-label", rx + 30, ry, "start", [
        { cls: "map-label-name", dy: "-0.15em", text: "Germany" },
        { cls: "map-label-detail", dy: "1.3em", text: `${plural(net.count, "farm")} in the Oderbruch` },
      ])}
    </g>`;
  return html`<div class="card card-flush map-card map-card-earth">
    ${svg(1, "World map. Germany is highlighted; select it to zoom in.", html`${raw(m.base)}${overlay}`)}
    <div class="map-foot">
      <div class="legend">
        <span><i class="swatch map-sw-active"></i>Connected: Germany</span>
        <span><i class="swatch map-sw-ring"></i>The Oderbruch, where the ${plural(net.count, "farm")} are</span>
      </div>
      <span class="faint">Select Germany to zoom in.</span>
    </div>
  </div>`;
}

function germanyMap(snap, net, t) {
  const m = baseMap(2);
  const [rx, ry] = m.region;
  const weather = alertTone(snap);
  const overlay = html`
    <g class="map-hit" data-go="${t.oderbruch}" role="link" tabindex="0" data-focus-key="germany-oderbruch"
      aria-label="Oderbruch, Brandenburg: ${plural(net.count, "farm")}, ${int(net.siloFree)} t of silo space free, ${net.combinesFree} of ${net.count} combines free. Open the Oderbruch.">
      <title>Oderbruch: open the regional map</title>
      <circle class="map-hit-area" cx="${f1(rx)}" cy="${f1(ry)}" r="40"/>
      <path class="map-bb" d="${m.brandenburg}"/>
      ${weather ? html`<circle class="map-pulse is-${weather}" cx="${f1(rx)}" cy="${f1(ry)}" r="22" style="${phase(PULSE_MS)}"/>` : ""}
      <circle class="map-ring is-${net.worstTone}" cx="${f1(rx)}" cy="${f1(ry)}" r="27"/>
      <circle class="map-focus" cx="${f1(rx)}" cy="${f1(ry)}" r="33"/>
      <circle class="map-marker" cx="${f1(rx)}" cy="${f1(ry)}" r="3.5"/>
      ${svgText("map-label map-label-region", m.label.x, m.label.y, "end", [
        { cls: "map-label-name", dy: "0", text: "Oderbruch" },
        { cls: "map-label-detail", dy: "1.35em", text: `${plural(net.count, "farm")} · Brandenburg` },
        { cls: "map-label-detail", dy: "1.25em", text: `${net.combinesFree} of ${net.count} combines free` },
      ])}
    </g>
    ${raw(m.berlinRef)}`;
  return html`<div class="card card-flush map-card map-card-germany">
    ${svg(2, "Map of Germany's 16 states. Brandenburg is highlighted with the Oderbruch; select it to open the regional map.", html`${raw(m.base)}${overlay}`)}
    <div class="map-foot">
      <div class="legend">
        <span><i class="swatch map-sw-active"></i>Connected: Brandenburg</span>
        <span><i class="swatch map-sw-ring-tone is-${net.worstTone}"></i>Ring: the farm with the driest soil or fullest silo</span>
        <span><i class="swatch map-sw-city"></i>Berlin, for orientation</span>
      </div>
      <span class="faint">Select the Oderbruch to zoom in.</span>
    </div>
  </div>`;
}

function fieldShape(f, s, t) {
  const tone = fieldTone(s);
  const m = Math.round(s.soilMoisturePct);
  const name = FIELD_NAMES[f.field] ?? f.field;
  const status = tone === "harvested" || tone === "cover" ? FIELD_TONE_LABEL[tone] : `${m}%, ${FIELD_TONE_LABEL[tone]}`;
  const summary = `${name}, ${s.crop} (${s.areaHa} ha, ${s.stage}): ${status}; it suffers below ${s.stressThresholdPct}%.`;
  const detail = tone === "harvested" ? "harvested" : tone === "cover" ? "cover crop" : `${s.emoji ?? ""} ${m}%`.trim();
  return html`<g class="map-field is-${tone}" data-go="${t.field(f.field)}" role="link" tabindex="0"
    data-focus-key="field-${FIELD_IDS[f.field]}" aria-label="${summary} Open the field.">
    <title>${summary}</title>
    <path class="map-field-shape" d="${f.d}"/>
    ${svgText("map-field-label", f.cx, f.cy, "middle", [
      { cls: "map-field-name", dy: "-0.2em", text: f.field },
      { cls: "map-field-detail", dy: "1.2em", text: detail },
    ])}
  </g>`;
}

function fieldInset(snap, m, t) {
  const fields = m.fields.filter((f) => snap.fields?.[f.field]).map((f) => fieldShape(f, snap.fields[f.field], t));
  const [yx, yy] = m.yard;
  return html`<g class="map-inset" role="group" aria-label="Our three fields at ${OWN_FARM.name}">
    <rect class="map-inset-frame" x="${INSET.x}" y="${INSET.y}" width="${INSET.w}" height="${INSET.h}" rx="8"/>
    <text class="map-inset-title" x="${INSET.x + 14}" y="${INSET.y + 22}">Our fields</text>
    <text class="map-inset-farm" text-anchor="end" x="${INSET.x + INSET.w - 14}" y="${INSET.y + 22}">${OWN_FARM.name}</text>
    ${fields}
    <rect class="map-yard" x="${f1(yx - 4)}" y="${f1(yy - 4)}" width="8" height="8" rx="1.5"><title>Farmyard and silo</title></rect>
  </g>`;
}

function oderbruchMap(snap, net, t) {
  const m = baseMap(3);
  const stats = Object.fromEntries(net.farms.map((f) => [f.id, f]));
  const help = ringHelp(snap);
  const weather = alertTone(snap);

  const links = m.links.map((l) => {
    const report = snap.nearbyCapacity?.[l.name];
    const h = help[l.name];
    const borrow = Boolean(h?.borrowFor.length);
    const deliver = Boolean(h && h.deliverT > 0);
    const { anchor, x, y, up } = l.label;
    // Above the arc the label grows upward, so its last line stays next to the line.
    const first = up && h ? "-0.9em" : "0.35em";
    return html`<g class="map-link-group${borrow || deliver ? " is-help" : ""}">
      <path class="map-link${borrow ? " is-flow" : ""}" fill="none" d="${l.toOwn}"${borrow ? raw(` style="${phase(FLOW_MS)}"`) : ""}>
        <title>${borrow ? `${l.name}'s combine comes to ${OWN_FARM.name}` : `${l.name}: ${shareText(report)}`}</title>
      </path>
      ${deliver ? html`<path class="map-link map-link-grain is-flow" fill="none" d="${l.fromOwn}" style="${phase(FLOW_MS)}"><title>Our grain goes to ${l.name}'s silo</title></path>` : ""}
      ${svgText("map-link-label", x, y, anchor, [
        { dy: first, text: shareText(report) },
        h && { cls: "map-link-help", dy: "1.25em", text: helpText(h) },
      ])}
    </g>`;
  });

  const pins = m.pins.map((p) => {
    const s = stats[p.id];
    if (!s) return "";
    const name = `${p.name}${p.isOwn ? " (ours)" : ""}`;
    const combine = s.combineFree ? "combine free" : "combine busy";
    const why = s.reasons.length ? ` (${s.reasons.join(", ")})` : "";
    const summary = `${s.name}${p.isOwn ? ", our farm" : ""}: ${STATUS_LABEL[s.tone]}${why}. ${int(s.storageFreeT)} t of ${int(s.storageCapacityT)} t silo space free, ${combine}, soil moisture ${s.moisture}%.`;
    const { anchor, x, y } = p.label;
    return html`<g class="map-pin map-pin-${p.index}${p.isOwn ? " is-own" : ""}" data-go="${t.farm(p.id)}"
      role="link" tabindex="0" data-focus-key="pin-${p.id}" aria-label="${summary} Open the farm.">
      <title>${summary}</title>
      <circle class="map-hit-area" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 10)}"/>
      ${p.isOwn && weather ? html`<circle class="map-pulse is-${weather}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 3)}" style="${phase(PULSE_MS)}"/>` : ""}
      <circle class="map-focus" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + (p.isOwn ? 10 : 6))}"/>
      ${p.isOwn ? html`<circle class="map-pin-own" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r + 4.5)}"/>` : ""}
      <circle class="map-pin-dot is-${s.tone}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(p.r)}"/>
      ${svgText("map-label map-pin-label", x, y, anchor, [
        { cls: "map-pin-name", dy: "-0.15em", text: name },
        { cls: "map-pin-detail", dy: "1.25em", text: `${int(s.storageFreeT)} t silo free` },
        { cls: "map-pin-detail", dy: "1.25em", text: `${combine} · soil ${s.moisture}%` },
      ])}
    </g>`;
  });

  const helping = Object.keys(help).length > 0;
  return html`<div class="card card-flush map-card map-card-oderbruch">
    ${svg(
      3,
      "Map of the Oderbruch with the three farms of the twin and our three fields. Select a farm or a field to open it.",
      html`${raw(m.base)}${links}${pins}${fieldInset(snap, m, t)}`,
    )}
    <div class="map-foot">
      <div class="legend">
        <span><i class="swatch map-sw-tone is-ok"></i>Normal</span>
        <span><i class="swatch map-sw-tone is-warn"></i>Watch</span>
        <span><i class="swatch map-sw-tone is-crit"></i>Critical</span>
        <span><i class="swatch map-sw-own"></i>Ours</span>
        <span><i class="swatch map-sw-link"></i>Latest Machinery-ring report</span>
        ${helping ? html`<span><i class="swatch map-sw-flow"></i>Help in the waiting plan</span>` : ""}
        <span><i class="swatch map-sw-lowland"></i>Oderbruch lowland</span>
      </div>
      <span class="faint">Pin size: farm area. Farm colour: soil moisture and silo fill. Field colour: soil moisture against the crop's stress level. Outlines simplified.</span>
    </div>
  </div>`;
}

const MAPS = { 1: earthMap, 2: germanyMap, 3: oderbruchMap };

// -- panels ------------------------------------------------------------------------------------
function earthPanel(snap, net, t) {
  const own = net.own;
  const firstField = snap.fields?.[FIELDS[0]];
  const levels = [
    { n: 1, name: "Earth", scale: EARTH_KM, shows: "Where the farms are.", token: t.earth },
    { n: 2, name: "Germany", scale: GERMANY_KM, shows: "Which region is connected.", token: t.germany },
    {
      n: 3,
      name: "Oderbruch",
      scale: `about ${LENGTH_KM} km long`,
      shows: "Every farm's silo space, combine and soil, and what it can share.",
      token: t.oderbruch,
    },
    {
      n: 4,
      name: "Farm",
      scale: `${own ? own.areaHa : OWN_FARM.areaHa} ha`,
      shows: "Weather, resources, the plan for the day and the team conversation.",
      token: t.farm(OWN_FARM.id),
    },
    {
      n: 5,
      name: "Field",
      scale: firstField ? `${firstField.areaHa} ha` : "",
      shows: "Soil moisture over the season, the crop and its last plans.",
      token: t.field(FIELDS[0]),
    },
  ];
  return html`
    <div class="card map-about">
      <div class="eyebrow">What MetaAgri is</div>
      <p>
        A digital twin of three farms, simulated day by day. Every morning a field agent for each of our three fields
        proposes the day's work. The Coordinator bundles the proposals and settles who gets the one combine, the Safety
        check blocks anything unsafe or against the rules, and the Machinery ring borrows a neighbour's combine or silo
        space when ours can't cope. The farm manager approves or rejects the plan.
      </p>
    </div>
    <div class="card map-summary">
      <div>
        <div class="eyebrow">${REGION.name}, ${REGION.state}</div>
        <h3>${OWN_FARM.name} <span class="faint map-ours">(ours)</span></h3>
      </div>
      <p class="muted">
        A drained river lowland on the Oder, along the Polish border, with ${plural(net.count, "farm")} in the twin.
        ${own ? `${upperFirst(own.crops)} on ${own.areaHa} ha.` : ""}
      </p>
      ${own
        ? html`<div class="map-stats">
            ${stat(html`${int(own.storageFreeT)}<small> t</small>`, `silo space free of ${int(own.storageCapacityT)} t`)}
            ${stat(html`${own.moisture}<small>%</small>`, "average soil moisture")}
          </div>`
        : ""}
      <div class="row">${planChip(snap, t, "earth-plan")} ${scenarioChips(snap)}</div>
      <div class="row">
        <a class="btn btn-primary" href="#${t.germany}" data-focus-key="earth-zoom">Zoom to Germany</a>
        <a class="btn" href="#${t.farm(OWN_FARM.id)}" data-focus-key="earth-farm">Open ${OWN_FARM.name}</a>
      </div>
    </div>
    <div class="card">
      <div class="eyebrow">Five levels, one twin</div>
      <ol class="map-levels">
        ${levels.map(
          (l) => html`<li>
            <a href="#${l.token}"${l.n === 1 ? raw(' aria-current="page"') : ""} data-focus-key="level-${l.n}">
              <span class="map-lvl-num">${l.n}</span>
              <span class="map-lvl-title"><span>${l.name}</span><span class="map-lvl-scale">${l.scale}</span></span>
              <span class="map-lvl-shows">${l.shows}</span>
            </a>
          </li>`,
        )}
      </ol>
    </div>`;
}

function germanyPanel(snap, net, t) {
  const berlinKm = Math.round(distanceKm([OWN_FARM.lon, OWN_FARM.lat], [BERLIN.lon, BERLIN.lat]));
  return html`
    <div class="card map-summary">
      <div><div class="eyebrow">Connected region</div><h3>${REGION.name}, ${REGION.state}</h3></div>
      <p class="muted">
        A flat river lowland along the Oder on the Polish border, about ${LENGTH_KM} km long, drained in the 18th century
        and farmed ever since. Its ${plural(net.count, "farm")} tell the Machinery ring every day what they can share: a
        free combine and silo space.
      </p>
      <div class="map-stats">
        ${stat(html`${int(net.areaHa)}<small> ha</small>`, `farmed by ${plural(net.count, "farm")}`)}
        ${stat(html`${int(net.siloFree)}<small> t</small>`, "silo space free")}
        ${stat(`${net.combinesFree} of ${net.count}`, "combines free today")}
        ${stat(net.own ? html`${net.own.moisture}<small>%</small>` : "–", `soil moisture at ${OWN_FARM.name}`)}
      </div>
      <div class="row">${worstChip(net)} ${scenarioChips(snap)}</div>
      <div class="row">
        <a class="btn btn-primary" href="#${t.oderbruch}" data-focus-key="germany-open">Open the Oderbruch</a>
      </div>
    </div>
    <div class="card">
      <div class="eyebrow">For orientation</div>
      <p class="map-note">
        Berlin is ${berlinKm} km west of ${OWN_FARM.name}. No farm outside the Oderbruch sends data to the twin yet.
      </p>
    </div>`;
}

function reportBlock(report) {
  if (!report) return html`<div class="map-report"><span class="muted">No Machinery-ring report yet.</span></div>`;
  return html`<div class="map-report">
    <div class="map-report-head">
      <span>Can share <strong>${plural(report.canShare.combine, "combine")}</strong> · <strong>${int(report.canShare.storageT)} t</strong></span>
      ${confBar(report.confidence)}
    </div>
    <div class="faint">Valid until ${report.validUntil}. ${upperFirst(report.note)}.</div>
  </div>`;
}

function farmCard(f, snap, help, t) {
  const place = f.place ?? {};
  const h = help[f.name];
  const why = f.reasons.length ? `: ${f.reasons.join(", ")}` : "";
  return html`<article class="card map-fcard map-fcard-${f.index}${f.isOwn ? " is-own" : ""}">
    <div class="map-fcard-head">
      <span class="map-dot is-${f.tone}" role="img" aria-label="${STATUS_LABEL[f.tone]}${why}" title="${STATUS_LABEL[f.tone]}${why}"></span>
      <div class="map-fcard-title">
        <h3>${f.name}</h3>
        <div class="faint">${f.crops ?? place.crops ?? ""} · ${f.areaHa ?? place.areaHa ?? 0} ha</div>
      </div>
      ${f.isOwn ? chip("ours", "accent", { plain: true }) : ""}
    </div>
    <div class="map-stats">
      ${stat(html`${int(f.storageFreeT)}<small> t</small>`, `silo free of ${int(f.storageCapacityT)} t`)}
      ${stat(html`${f.moisture}<small>%</small>`, "average soil moisture")}
    </div>
    <div class="map-silo">
      <span class="map-silo-name">Silo</span>
      ${meter(f.fill, { label: `Silo fill at ${f.name}` })}
      <span class="mono map-silo-num">${pct(f.fill)} full</span>
    </div>
    <div class="row">
      ${f.combineFree ? chip("Combine free today", "ok") : chip("Combine busy today", "warn")}
      ${f.isOwn ? planChip(snap, t, `plan-${f.id}`) : ""}
      ${h ? chip(`Waiting plan: ${helpText(h)}`, "accent") : ""}
    </div>
    ${reportBlock(snap.nearbyCapacity?.[f.name])}
    <div class="row">
      <a class="btn" href="#${t.farm(f.id)}" data-focus-key="open-${f.id}">Open ${f.name}</a>
    </div>
  </article>`;
}

function ringNote(snap, help) {
  const plan = snap.pendingBundle;
  const asks = Object.entries(help).map(([name, h]) => helpSentence(name, h));
  let now;
  if (!plan) now = "No plan is waiting for a decision right now.";
  else if (!asks.length) now = `The ${plan.planFor} plan needs no help from the neighbours.`;
  else now = `The ${plan.planFor} plan asks the neighbours to ${asks.join("; ")}.`;
  return html`<div class="card map-ring-note">
    <div class="eyebrow">Machinery ring</div>
    <p>
      Every day each farm's agent reports what it can spare: its combine, if no ripe crop of its own is waiting, and silo
      space beyond a reserve. When two of our fields need the one combine, or the harvest won't fit in our silo, the
      Machinery ring adds a borrowed combine or a delivery to a neighbour to the plan. The farm manager approves or
      rejects it with the rest of the plan.
    </p>
    <p class="muted">${now}</p>
  </div>`;
}

function oderbruchPanel(snap, net, t) {
  const help = ringHelp(snap);
  const ordered = [...net.farms].sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
  return html`${ordered.map((f) => farmCard(f, snap, help, t))}${ringNote(snap, help)}`;
}

// -- heads --------------------------------------------------------------------------------------
function headFor(level, snap, net, t) {
  if (level === 2) {
    return head({
      eyebrow: "Level 2 of 5 · Germany",
      title: "Which region is connected",
      lede: "The Oderbruch in Brandenburg is the only region in the twin so far. Select it to see its farms.",
      chips: html`${chip("1 region connected", "accent")} ${worstChip(net)} ${scenarioChips(snap)}`,
    });
  }
  if (level === 3) {
    return head({
      eyebrow: "Level 3 of 5 · Oderbruch",
      title: "Silo space, combines and soil across the Oderbruch",
      lede: "Each pin is a farm, sized by its area and coloured by its soil moisture and silo fill. The dashed lines show what each neighbour told the Machinery ring it can share. Select a farm, or one of our fields, to open it.",
      chips: html`${chip(`${int(net.siloFree)} t silo space free`, "", { plain: true })}
      ${chip(`${net.combinesFree} of ${net.count} combines free`, net.combinesFree ? "ok" : "warn")} ${worstChip(net)}
      ${scenarioChips(snap)}`,
    });
  }
  return head({
    eyebrow: "Level 1 of 5 · Earth",
    title: "Where the farms are",
    lede: `A digital twin of ${plural(net.count, "farm")} in the Oderbruch, simulated day by day, from the whole planet down to a single field. Select Germany to zoom in.`,
    chips: html`${chip(plural(net.count, "farm"), "accent")} ${planChip(snap, t, "head-plan")} ${scenarioChips(snap)}`,
  });
}

const PANELS = { 1: earthPanel, 2: germanyPanel, 3: oderbruchPanel };
const PANEL_LABEL = { 1: "MetaAgri and our farm", 2: "The connected region", 3: "Farms in the Oderbruch" };

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

// -- entry point -----------------------------------------------------------------------------------
export function render(container, ctx) {
  const level = [1, 2, 3].includes(ctx.route?.level) ? ctx.route.level : 1;
  const { snap } = ctx;
  const t = routeTokens(ctx);
  const net = regionStats(snap);
  const key = focusedKey(container);
  const stage = libsReady(level) ? MAPS[level](snap, net, t) : missingCard();
  container.innerHTML = String(html`
    ${headFor(level, snap, net, t)}
    <div class="layout map-layout">
      <section class="stage" aria-label="Map">${stage}</section>
      <aside class="panel" aria-label="${PANEL_LABEL[level]}">${PANELS[level](snap, net, t)}</aside>
    </div>
  `);
  restoreFocus(container, key);
}
