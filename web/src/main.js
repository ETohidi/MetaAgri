// Boot, routing, the "Viewing as" role, the simulation controls' actions and the render loop. The
// app bar itself (breadcrumb, role menu, Simulation drawer) is drawn by ui/shell.js.
// Views live in ui/*.js and each exports render(container, ctx, { routeChanged }).

import { Twin } from "./engine/twin.js";
import { FARM_BY_ID, FIELD_BY_ID, FIELD_IDS, OWN_FARM } from "./data/places.js";
import { loadRealData } from "./data/real.js";
import { esc, plural } from "./ui/dom.js";
import { LEVELS } from "./ui/levels.js";
import { DEFAULT_ROLE, ROLES, roleOf } from "./ui/roles.js";
import { createShell } from "./ui/shell.js";
import * as worldView from "./ui/world.js";
import * as countryView from "./ui/country.js";
import * as districtView from "./ui/district.js";
import * as farmView from "./ui/farm.js";
import * as fieldView from "./ui/field.js";

const AUTOPLAY_MS = { 1: 5000, 2: 2500, 4: 1250 };

const twin = new Twin();
/** Per-viewer UI state that survives re-renders (drafts, selections, toggles). */
const ui = { drafts: {}, autoplay: false, speed: 1 };
/** Real open data (web/data/real.json), loaded once after the first paint; views get it as ctx.data. */
const real = { state: "loading", data: null };

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const toasts = $("#toasts");
const topbar = $(".topbar");

const has = (obj, key) => Boolean(key) && Object.hasOwn(obj, key);

// -- role: a lens, not a login (ui/roles.js) ---------------------------------------------------
const ROLE_KEY = "metaagri.role";

function loadRole() {
  try {
    const id = localStorage.getItem(ROLE_KEY);
    return has(ROLES, id) ? id : DEFAULT_ROLE;
  } catch {
    return DEFAULT_ROLE;
  }
}
function saveRole(id) {
  try {
    localStorage.setItem(ROLE_KEY, id);
  } catch {
    // private windows may block storage; the site just opens with the default lens next time
  }
}

let role = loadRole();

// -- routes -------------------------------------------------------------------
// Only plain hash tokens survive the artifact viewer (letters, digits, . _ ~ -), so routes are
// "world", "germany", "oderbruch", "<farmId>" and "lerchenbruch.<fieldId>" (only our own farm has
// a detailed twin, so only it has fields). The old "earth" token redirects to "world"; an empty
// or unknown hash opens the current role's home (Germany for the default ministry lens).
// route.level is a level key of ui/levels.js (world, country, district, farm, field).
export const routes = {
  world: "world",
  earth: "world",
  germany: "germany",
  country: "germany",
  oderbruch: "oderbruch",
  district: "oderbruch",
  farm: (id) => id,
  field: (field, farmId = OWN_FARM.id) => `${farmId}.${FIELD_IDS[field]}`,
};

/** The route token of a role's home level; EU and Land have no page yet, so they open Germany. */
function homeToken(roleId) {
  return LEVELS[roleOf(roleId).home]?.route ?? routes.germany;
}

/**
 * { level, token, farmId? (farm, field), field? ("North" | "West" | "River", field), redirect? }
 * redirect: the hash is not the canonical token (#earth, #Germany, junk) and is rewritten in place.
 */
function parseRoute(hash) {
  let rawToken = hash.replace(/^#/, "");
  try {
    rawToken = decodeURIComponent(rawToken);
  } catch {
    // a malformed %-escape falls through to the home page instead of blanking the app
  }
  const r = matchRoute(rawToken.toLowerCase());
  // An empty hash stays empty (the plain site URL opens the role's home).
  return rawToken === "" ? r : { ...r, redirect: r.token !== rawToken };
}

function matchRoute(token) {
  if (token === "world" || token === "earth") return { level: "world", token: "world" };
  if (token === "germany") return { level: "country", token };
  if (token === "oderbruch") return { level: "district", token };
  const [farmId, fieldId] = token.split(".");
  if (has(FARM_BY_ID, farmId)) {
    const farm = FARM_BY_ID[farmId];
    if (farm.isOwn && has(FIELD_BY_ID, fieldId)) {
      return { level: "field", token: `${farmId}.${fieldId}`, farmId, field: FIELD_BY_ID[fieldId] };
    }
    return { level: "farm", token: farmId, farmId };
  }
  // Owner decision: the site opens on the role's home; the default ministry lens opens Germany.
  // (Every home is a known token, so this recurses once; the guard only stops a bad home looping.)
  const home = homeToken(role);
  return home !== token ? matchRoute(home) : { level: "country", token: routes.germany };
}

/** Rewrites a redirected token in place (#earth -> #world, junk -> home) without a history entry. */
function settleRoute(r) {
  if (!r.redirect) return r;
  try {
    history.replaceState(history.state, "", `#${r.token}`);
  } catch {
    // some embedded viewers forbid replaceState; the page still renders the right view
  }
  return r;
}

let route = settleRoute(parseRoute(location.hash));

function go(token) {
  if (location.hash.replace(/^#/, "") === token) return;
  location.hash = token;
}

window.addEventListener("hashchange", () => {
  route = settleRoute(parseRoute(location.hash));
  shell.closeMenus();
  render({ routeChanged: true });
});

// -- toasts ---------------------------------------------------------------------
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  toasts.append(el);
  setTimeout(() => el.remove(), 3800);
}

/** Switches the lens, remembers it in this browser and opens the role's home level. */
function setRole(id) {
  if (!has(ROLES, id)) return;
  const changed = id !== role;
  role = id;
  saveRole(id);
  if (changed) toast(`Viewing as ${ROLES[id].name}. A lens for the demo, not a login.`);
  const token = homeToken(id);
  if (location.hash.replace(/^#/, "") === token) render({ routeChanged: changed });
  else go(token);
}

/** The demo story: switch to the farm manager and open our (fictional) farm. */
function followFarmManager() {
  setRole("farm");
  go(routes.farm(OWN_FARM.id));
}

// -- simulation controls ------------------------------------------------------------
let timer = null;

/** True while the waiting plan has a typed rejection reason: a new day would expire it and drop the text. */
function hasTypedReason() {
  const pending = twin.snapshot().pendingBundle;
  return Boolean(pending && ui.drafts[pending.id]?.custom?.trim());
}

function autoTick() {
  if (isBusy() || hasTypedReason()) return; // hold the season while the viewer is typing or deciding
  twin.tick();
}

function setAutoplay(on) {
  ui.autoplay = on;
  clearInterval(timer);
  timer = on ? setInterval(autoTick, AUTOPLAY_MS[ui.speed]) : null;
  render();
}

function onSimAction(action) {
  if (action === "next") {
    const bundle = twin.tick();
    const onOwnFarm = route.level === "farm" && route.farmId === OWN_FARM.id;
    if (bundle && !onOwnFarm) toast(`${bundle.planFor}: a new plan is waiting at ${OWN_FARM.name}.`);
    // On one-column layouts the plan sits below the farm overview; bring the new one into view.
    if (bundle && onOwnFarm && matchMedia("(max-width: 1180px)").matches) {
      view.querySelector('[id$="plan-title"]')?.scrollIntoView({ block: "start" });
    }
  } else if (action === "play") {
    setAutoplay(!ui.autoplay);
  } else if (action === "speed") {
    ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 4 : 1;
    if (ui.autoplay) setAutoplay(true);
    else render();
  } else if (action === "heatwave") {
    const daysLeft = twin.snapshot().heatwaveDaysRemaining ?? 0;
    const { scenario } = twin.heatwave() ?? {};
    toast(
      daysLeft > 0
        ? `The simulated heatwave is already on: ${plural(daysLeft, "day")} left.`
        : `Simulated ${scenario ?? "heatwave"}.`,
    );
  } else if (action === "hail") {
    const already = twin.snapshot().hailDate;
    const { scenario } = twin.hail() ?? {};
    toast(
      already
        ? `A simulated hail warning is already out: severe hail expected ${already}.`
        : `Simulated ${scenario ?? "hail warning"}. Harvest ripe crops before it hits.`,
    );
  } else if (action === "reset") {
    ui.drafts = {};
    twin.reset();
    toast(`The season restarted. It is ${twin.snapshot().longDate} again.`);
  }
}

const shell = createShell({
  ui,
  routes,
  onAction: onSimAction,
  onRole: setRole,
  onFollow: followFarmManager,
  onToggle: () => updateSticky(),
});

// Any element with data-go="<route token>" navigates (cards, pins, table rows).
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-go]");
  if (!target || target.closest("a[href]")) return;
  event.preventDefault();
  go(target.dataset.go);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target.closest("[data-go]");
  if (!target || target.matches("a, button, input, select, textarea")) return;
  event.preventDefault();
  go(target.dataset.go);
});

// -- render loop -------------------------------------------------------------------
const VIEWS = { world: worldView, country: countryView, district: districtView, farm: farmView, field: fieldView };
let deferred = false;
let pointerDown = false;

/**
 * True while the viewer is typing or choosing in a form control inside the view, or is
 * mid-click: replacing the element between pointerdown and pointerup would swallow the click.
 */
function isBusy() {
  const a = document.activeElement;
  return pointerDown || Boolean(a && view.contains(a) && a.matches("input, select, textarea"));
}

function renderIfDeferred() {
  setTimeout(() => {
    if (deferred && !isBusy()) render();
  }, 0);
}

document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener(
  "pointerup",
  () => {
    pointerDown = false;
    renderIfDeferred();
  },
  true,
);
document.addEventListener("pointercancel", () => (pointerDown = false), true);

function keepScroll(fn) {
  const saved = [...view.querySelectorAll("[data-keep-scroll]")].map((el) => [el.dataset.keepScroll, el.scrollTop]);
  fn();
  for (const [key, top] of saved) {
    const el = view.querySelector(`[data-keep-scroll="${CSS.escape(key)}"]`);
    if (el) el.scrollTop = top;
  }
}

// -- focus: re-renders replace the focused element; put the keyboard user back where they were --
function focusKey() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const tries = [];
  if (el.id) tries.push(`#${CSS.escape(el.id)}`);
  const key = el.getAttribute("data-focus-key");
  if (key) tries.push(`[data-focus-key="${CSS.escape(key)}"]`);
  // Plan controls carry the plan id; when a new plan replaces it, land on the same control,
  // else on the plan's heading.
  const plan = key && key.match(/^(approve|reason|custom|reject)-/);
  if (plan) tries.push(`[data-focus-key^="${plan[1]}-"]`, '[id$="plan-title"]');
  return tries.length ? tries : null;
}

function restoreFocus(selectors) {
  const a = document.activeElement;
  if (!selectors || (a && a !== document.body && a.isConnected)) return; // not lost, or a view restored it
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && !el.disabled) {
      if (el.id.endsWith("plan-title") && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  }
}

function render({ routeChanged = false } = {}) {
  const snap = twin.snapshot();
  const focused = routeChanged ? null : focusKey();
  shell.render(route, snap, { role, homeToken: homeToken(role), dataState: real.state, data: real.data });
  updateSticky();

  if (!routeChanged && isBusy()) {
    deferred = true; // don't yank a dropdown, text field or half-finished click from the viewer
    restoreFocus(focused);
    return;
  }
  deferred = false;
  const ctx = {
    twin,
    snap,
    route,
    routes,
    go,
    ui,
    toast,
    rerender: () => render(),
    data: real.data,
    dataState: real.state,
    role,
    setRole,
  };
  const mod = VIEWS[route.level];
  // Views re-assign the handlers they need on every render; clear the previous view's.
  view.onclick = view.onchange = view.oninput = view.onsubmit = view.onkeydown = null;
  keepScroll(() => mod.render(view, ctx, { routeChanged }));
  if (routeChanged) {
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
    window.scrollTo({ top: 0 });
    const h1 = view.querySelector("h1")?.textContent.trim().replace(/\s+/g, " ");
    document.title = h1 ? `${h1} · MetaAgri` : "MetaAgri";
    view.focus({ preventScroll: true });
  } else {
    restoreFocus(focused);
  }
}

// -- sticky header: anchors scroll in below it (--sticky-h) ---------------------------------------
function updateSticky() {
  document.documentElement.style.setProperty("--sticky-h", `${topbar.offsetHeight}px`);
}
if (typeof ResizeObserver === "function") new ResizeObserver(updateSticky).observe(topbar);

view.addEventListener("focusout", renderIfDeferred);

twin.subscribe(() => render());
render({ routeChanged: true });

// Real data loads after the first paint; the current view re-renders with it once it arrives.
// loadRealData() resolves even when the file fails (real: null, errors.real set).
Promise.resolve()
  .then(() => loadRealData())
  .then(
    (data) => {
      real.data = data ?? null;
      real.state = data?.real ? "ready" : "error";
      if (data?.errors?.real) console.warn("MetaAgri: real data did not load", data.errors.real);
    },
    (err) => {
      real.state = "error";
      console.warn("MetaAgri: real data did not load", err);
    },
  )
  .then(() => render());

// Exposed for debugging in the browser console.
window.metaagri = { twin, ui, esc, real, routes, setRole, get role() { return role; } };
