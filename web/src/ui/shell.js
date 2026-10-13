// The app bar: logo, breadcrumb of places (with the level name under each place, never a number
// or a km/ha scale), the "Viewing as" role menu with its "Follow the farm manager" entry, and the
// collapsible "Simulation" drawer that holds the demo controls (Next day, Play, speed, Heatwave,
// Hail warning, Restart season) and the "About this demo" popover (real vs synthetic data, seed).
// main.js owns the timers, the twin and the role; this file only draws the bar and reports clicks
// through onAction(action), onRole(id) and onFollow().

import { FARM_BY_ID, FIELD_NAMES, OWN_FARM } from "../data/places.js";
import { html, plural, raw } from "./dom.js";
import { LEVELS } from "./levels.js";
import { prov } from "./page.js";
import { ROLES, ROLE_ORDER, roleOf } from "./roles.js";

const ICONS = {
  sim: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.4 1.6"/></svg>',
  lens: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M1.2 8s2.5-4.6 6.8-4.6S14.8 8 14.8 8s-2.5 4.6-6.8 4.6S1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2.1"/></svg>',
  follow:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2.5v11l7-5.5zM11 2.5h2v11h-2z"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause:
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
  heat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/></svg>',
  hail: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10H4a2.8 2.8 0 0 1-.3-5.6A4 4 0 0 1 11.4 4a3 3 0 0 1 .6 6h-.5"/><circle cx="5.5" cy="12.6" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="11.6" r="1" fill="currentColor" stroke="none"/></svg>',
  restart:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg>',
};

/** Levels whose pages show the simulated farms: only they get the scenario buttons and strip. */
export const SIM_LEVELS = ["district", "farm", "field"];

/** Short role names for narrow app bars; the menu (and the button's label) give the full name. */
const SHORT_ROLE = { analyst: "Crop analyst", ministry: "Ministry", district: "District", farm: "Farmer" };

/** The place a level's page shows (for "Home: Country · Germany"). */
const LEVEL_PLACE = { world: "World", country: "Germany", district: "Oderbruch", farm: OWN_FARM.name };

const OPEN_KEY = "metaagri.simOpen";

function loadOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // private windows may block storage; the drawer just starts closed next time
  }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/**
 * Breadcrumb steps for a route: World / EU / Germany / Brandenburg / Oderbruch / <farm> / <field>.
 * EU and Brandenburg have no page yet (soon: why); a farm or field not chosen is pending (pending:
 * why). `scale` is the level name shown under the place, never a number; it is left out where it
 * equals the place (World, EU, and a Farm or Field not chosen).
 * @param {{level: string, farmId?: string, field?: string}} route
 */
export function ladderSteps(route, routes) {
  const farm = route.farmId ? FARM_BY_ID[route.farmId] : null;
  const L = LEVELS;
  return [
    { key: "world", name: "World", scale: L.world.name, token: routes.world },
    { key: "eu", name: "EU", scale: L.eu.name, soon: L.eu.pending },
    { key: "country", name: "Germany", scale: L.country.name, token: routes.germany },
    { key: "land", name: "Brandenburg", scale: `${L.land.name} · coming in v2.1`, soon: L.land.pending },
    { key: "district", name: "Oderbruch", scale: L.district.name, token: routes.oderbruch },
    farm
      ? { key: "farm", name: farm.name, scale: L.farm.name, token: routes.farm(farm.id) }
      : { key: "farm", name: L.farm.name, scale: L.farm.name, pending: "not chosen yet" },
    route.field
      ? { key: "field", name: FIELD_NAMES[route.field], scale: L.field.name, token: routes.field(route.field) }
      : {
          key: "field",
          name: L.field.name,
          scale: L.field.name,
          pending: farm && !farm.isOwn ? "only our own farm has field twins" : "not chosen yet",
        },
  ];
}

/**
 * Builds the shell around the #ladder, #role-toggle, #rolemenu, #follow, #sim-toggle, #simdrawer,
 * #simbar, #statusline, #about-toggle, #about, #scenario and #scenario-live elements of index.html.
 * @param {{ui: object, routes: object, onAction: (action: string) => void, onRole: (id: string) => void,
 *   onFollow: () => void, onToggle?: () => void}} opts
 */
export function createShell({ ui, routes, onAction, onRole, onFollow, onToggle }) {
  const $ = (sel) => document.querySelector(sel);
  const brand = $(".brand");
  const ladder = $("#ladder");
  const crumbs = ladder.closest(".crumbs");
  const roleToggle = $("#role-toggle");
  const roleMenu = $("#rolemenu");
  const follow = $("#follow");
  const toggle = $("#sim-toggle");
  const drawer = $("#simdrawer");
  const simbar = $("#simbar");
  const statusline = $("#statusline");
  const aboutToggle = $("#about-toggle");
  const about = $("#about");
  const strip = $("#scenario");
  const scenarioLive = $("#scenario-live");

  ui.simOpen = loadOpen();
  let simbarKey = null;
  let clockTime = null;
  let clockDay = null;
  let toggleKey = null;
  let ladderKey = null;
  let roleKey = null;
  let statusKey = null;
  let aboutKey = null;
  let stripKey = null;
  let scenariosWere = [];

  // -- Simulation drawer ---------------------------------------------------------------------
  function setOpen(open) {
    ui.simOpen = open;
    saveOpen(open);
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open) setAbout(false);
    onToggle?.();
  }
  setOpen(ui.simOpen);

  toggle.addEventListener("click", () => setOpen(!ui.simOpen));
  simbar.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-sim]");
    if (btn) onAction(btn.dataset.sim);
  });

  // -- "About this demo" popover ---------------------------------------------------------------
  function setAbout(open) {
    about.hidden = !open;
    aboutToggle.setAttribute("aria-expanded", String(open));
    onToggle?.();
  }
  aboutToggle.addEventListener("click", () => setAbout(about.hidden));

  // -- "Viewing as" role menu ------------------------------------------------------------------
  function setMenu(open, { focus = false } = {}) {
    roleMenu.hidden = !open;
    roleToggle.setAttribute("aria-expanded", String(open));
    if (open && focus) (roleMenu.querySelector('[aria-current="true"]') ?? roleMenu.querySelector("button"))?.focus();
  }
  // A keyboard "click" has detail 0: then move focus into the menu, as a menu button does.
  roleToggle.addEventListener("click", (event) => setMenu(roleMenu.hidden, { focus: event.detail === 0 }));
  roleMenu.addEventListener("click", (event) => {
    const opt = event.target.closest("[data-role]");
    const fol = event.target.closest("[data-follow]");
    if (!opt && !fol) return;
    setMenu(false);
    roleToggle.focus({ preventScroll: true });
    if (opt) onRole(opt.dataset.role);
    else onFollow();
  });
  roleMenu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...roleMenu.querySelectorAll("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    items[(i + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
  });
  follow.addEventListener("click", () => onFollow());

  // Escape closes the innermost open thing and returns focus to its button; a click outside closes.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!roleMenu.hidden) {
      setMenu(false);
      roleToggle.focus();
    } else if (!about.hidden) {
      setAbout(false);
      aboutToggle.focus();
    } else if (ui.simOpen && drawer.contains(document.activeElement)) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!roleMenu.hidden && !roleMenu.contains(event.target) && !roleToggle.contains(event.target)) setMenu(false);
    if (!about.hidden && !about.contains(event.target) && !aboutToggle.contains(event.target)) setAbout(false);
  });

  // -- breadcrumb ------------------------------------------------------------------------------
  function renderLadder(route) {
    const steps = ladderSteps(route, routes);
    const key = steps.map((s) => `${s.name}|${s.pending ? 1 : 0}`).join("/") + route.level;
    if (key === ladderKey) return;
    ladderKey = key;
    ladder.dataset.depth = route.level; // base.css drops the greyed steps first when a farm is open
    const here = steps.findIndex((s) => s.key === route.level);
    // On a phone or tablet only the nearest place above with a page, and the current place, show.
    let up = -1;
    for (let i = here - 1; i >= 0; i--) {
      if (steps[i].token) {
        up = i;
        break;
      }
    }
    ladder.innerHTML = String(
      html`${steps.map((s, i) => {
        const current = i === here;
        const cls = s.soon
          ? "is-soon"
          : s.pending
            ? "is-pending"
            : i === up
              ? "is-up"
              : i < here
                ? "is-far"
                : i > here
                  ? "is-down"
                  : "";
        const scale = s.scale === s.name ? "" : html`<span class="step-scale">${s.scale}</span>`;
        const inner = html`<span class="step-name">${s.name}</span>${scale}`;
        if (s.soon) {
          return html`<li class="${cls}"><span class="step is-soon" title="${s.soon}">${inner}<span class="sr-only"
                >: ${s.soon}</span
              ></span></li>`;
        }
        if (s.pending) {
          return html`<li class="${cls}"><span class="step is-pending" title="${cap(s.pending)}">${inner}<span class="sr-only"
                >: ${s.pending}</span
              ></span></li>`;
        }
        return html`<li${cls ? raw(` class="${cls}"`) : ""}><a href="#${s.token}"${current ? raw(' aria-current="page"') : ""}>${inner}</a></li>`;
      })}`,
    );
    // On a phone the breadcrumb scrolls sideways; keep the current place in view.
    const cur = ladder.querySelector('[aria-current="page"]');
    if (cur && crumbs) crumbs.scrollLeft = Math.max(0, cur.offsetLeft + cur.offsetWidth - crumbs.clientWidth + 8);
  }

  // -- role toggle, menu and the Follow entry ----------------------------------------------------
  function renderRole(roleId, homeToken) {
    const r = roleOf(roleId);
    if (r.id === roleKey) return;
    roleKey = r.id;
    brand.setAttribute("href", `#${homeToken}`);
    const home = LEVELS[r.home];
    brand.setAttribute("aria-label", `MetaAgri, home (${LEVEL_PLACE[r.home] ?? home?.name ?? "Germany"})`);
    roleToggle.setAttribute("aria-label", `Viewing as ${r.name}. Change the role`);
    roleToggle.innerHTML = String(html`${raw(ICONS.lens)}<span class="role-label"
        ><span class="role-pre">Viewing as</span><span class="role-name">${r.name}</span
        ><span class="role-short">${SHORT_ROLE[r.id] ?? r.name}</span></span
      ><span class="sim-chev" aria-hidden="true"></span>`);
    roleMenu.innerHTML = String(html`
      <p class="rolemenu-h" id="rolemenu-h">Viewing as</p>
      <ul class="rolemenu-list" aria-labelledby="rolemenu-h">
        ${ROLE_ORDER.map((id) => {
          const o = ROLES[id];
          const lv = LEVELS[o.home];
          const place = LEVEL_PLACE[o.home];
          return html`<li>
            <button type="button" class="role-opt" data-role="${id}" aria-current="${id === r.id}">
              <span class="role-opt-name">${o.name}</span>
              <span class="role-opt-ex">${o.example}</span>
              <span class="role-opt-home">Home: ${lv?.name ?? o.home}${place && place !== lv?.name ? ` · ${place}` : ""}</span>
            </button>
          </li>`;
        })}
      </ul>
      <button type="button" class="role-follow" data-follow ${r.id === "farm" ? raw("disabled") : ""}>
        ${raw(ICONS.follow)}
        <span
          ><b>Follow the farm manager</b>
          <small>${r.id === "farm" ? "You are following the farm manager." : `Open ${OWN_FARM.name}, the fictional demo farm, as its manager.`}</small></span
        >
      </button>
      <p class="rolemenu-note">
        A lens for the demo, not a login: a static site cannot enforce access, so a role only changes what the pages
        show. What a role may not see is marked Not shown, with the reason.
      </p>
    `);
    follow.hidden = r.id === "farm";
    follow.innerHTML = String(html`<span>Follow the farm manager</span>${raw(ICONS.follow)}`);
  }

  // -- Simulation toggle, drawer controls and status ---------------------------------------------
  function renderToggle(snap) {
    const pending = Boolean(snap.pendingBundle);
    const scenario = (snap.scenarios ?? []).length > 0;
    const key = `${snap.date}|${pending}|${scenario}`;
    if (key === toggleKey) return;
    toggleKey = key;
    const what = pending ? "a plan is waiting" : "no plan waiting";
    toggle.setAttribute("aria-label", `Simulation of the fictional farms, ${snap.longDate}, ${what}`);
    // "Mon 6 Jul" -> "Mon " + "6 Jul": phones drop the weekday
    const [wd, ...rest] = String(snap.date ?? "").split(" ");
    toggle.innerHTML = String(
      html`${raw(ICONS.sim)}<span class="sim-label">Simulation</span>
        <span class="sim-time"><span class="sim-day">${wd} </span>${rest.join(" ")}</span>
        ${
          pending || scenario
            ? html`<span class="sim-dot" title="${scenario ? "A scenario is running" : "A plan awaits a decision"}"></span>`
            : ""
        }
        <span class="sim-chev" aria-hidden="true"></span>`,
    );
  }

  // The clock is built once so its live region announces only real day changes; the buttons are
  // rebuilt only when their state changes, so a focused button survives an ordinary tick.
  function renderSimbar(route, snap) {
    if (!clockTime) {
      simbar.innerHTML = String(html`
        <div class="clock" aria-live="polite" aria-atomic="true">
          <span class="clock-time"></span>
          <span class="clock-day"></span>
        </div>
        <div class="simbar-buttons"></div>
      `);
      clockTime = simbar.querySelector(".clock-time");
      clockDay = simbar.querySelector(".clock-day");
    }
    // "Mon 6 Jul" / "Monday 6 July" -> "6 Jul" over "Monday"
    const dayMonth = String(snap.date ?? "").split(" ").slice(1).join(" ");
    const weekday = String(snap.longDate ?? "").split(" ")[0];
    if (clockTime.textContent !== dayMonth) clockTime.textContent = dayMonth;
    if (clockDay.textContent !== weekday) clockDay.textContent = weekday;

    const scenarios = SIM_LEVELS.includes(route.level);
    const key = `${ui.autoplay}|${ui.speed}|${scenarios}`;
    if (key === simbarKey) return;
    simbarKey = key;
    simbar.querySelector(".simbar-buttons").innerHTML = String(html`
      <button class="btn btn-primary" id="btn-next" data-sim="next" title="Advance the season by one day">
        ${raw(ICONS.next)} Next day
      </button>
      <button class="btn" id="btn-play" data-sim="play" aria-pressed="${ui.autoplay}" title="Advance automatically">
        ${raw(ui.autoplay ? ICONS.pause : ICONS.play)} <span class="btn-label">${ui.autoplay ? "Pause" : "Play"}</span>
      </button>
      <button class="btn btn-ghost" id="btn-speed" data-sim="speed" title="Autoplay speed">${ui.speed}×</button>
      ${
        scenarios
          ? html`<span class="simbar-sep" aria-hidden="true"></span>
              <button
                class="btn btn-scenario"
                id="btn-heat"
                data-sim="heatwave"
                title="Simulated: a four-day heatwave; the water authority cuts the farms' daily water permit"
              >
                ${raw(ICONS.heat)} Heatwave
              </button>
              <button class="btn btn-scenario" id="btn-hail" data-sim="hail" title="Simulated: severe hail expected in two days">
                ${raw(ICONS.hail)} Hail warning
              </button>`
          : ""
      }
      <button class="btn btn-ghost" id="btn-reset" data-sim="reset" title="Restart the season from the first day">
        ${raw(ICONS.restart)} <span class="btn-label">Restart season</span>
      </button>
    `);
  }

  function renderStatus(snap) {
    const pending = snap.pendingBundle;
    const key = pending ? `p${pending.id}|${pending.planFor}` : "none";
    if (key === statusKey) return;
    statusKey = key;
    statusline.innerHTML = String(
      pending
        ? html`<a class="chip chip-accent" href="#${routes.farm(OWN_FARM.id)}">Plan for ${pending.planFor} awaits a decision</a>`
        : html`<span class="chip">No plan waiting</span>`,
    );
  }

  function renderAbout(snap, dataState, data) {
    const values = data?.real?.values ?? null;
    const count = values ? Object.keys(values).length : 0;
    const curated = data?.real?.meta?.curatedAt ?? "";
    const key = `${snap.seed}|${dataState}|${count}|${curated}`;
    if (key === aboutKey) return;
    aboutKey = key;
    const realText =
      dataState === "ready" && count
        ? `${plural(count, "figure")} from official open sources${curated ? `, curated ${curated}` : ""}, each with its source, date and licence.`
        : dataState === "loading"
          ? "The real figures are still loading."
          : "The real figures could not be loaded, so they show as Unknown, never as 0.";
    about.innerHTML = String(html`
      <h2 class="about-h">About this demo</h2>
      <dl class="about-list">
        <dt>${prov("official", { label: "Real data", title: "Published statistics, never simulated" })}</dt>
        <dd>Above the farm (World, Country and District totals): real statistics. ${realText}</dd>
        <dt>${prov("simulated", { label: "Synthetic data", title: "Output of the seeded twin" })}</dt>
        <dd>
          ${OWN_FARM.name} and its two neighbours are fictional. Their numbers, at Farm and Field level, are simulated
          from a fixed seed (seed <span class="num">${snap.seed}</span>): the same seed replays the same season. The two
          kinds are never mixed.
        </dd>
        <dt>${prov("rule", { label: "Rule-based agents", title: "Plain rules in the browser" })}</dt>
        <dd>The field agents, Coordinator, Safety check and Machinery ring are plain rules in your browser. No server, no model calls.</dd>
      </dl>
      <p class="about-note">Roles are a lens, not a login. Nothing you do here leaves your browser.</p>
    `);
  }

  /** One strip per active scenario, only on the pages that show the simulated farms. */
  function renderStrip(route, snap) {
    const scenarios = snap.scenarios ?? [];
    // Announce a scenario once, when it starts; the visible strip is not a live region.
    const started = scenarios.filter((m) => !scenariosWere.includes(m));
    if (started.length) scenarioLive.textContent = `Simulated ${started.join(". Simulated ")}.`;
    if (!scenarios.length) scenarioLive.textContent = "";
    scenariosWere = scenarios;

    const show = SIM_LEVELS.includes(route.level) && scenarios.length > 0;
    const onOwnFarm = route.level === "farm" && route.farmId === OWN_FARM.id;
    const key = show ? `${scenarios.join("|")}|${snap.heatwaveDaysRemaining}|${onOwnFarm}` : "";
    if (key === stripKey) return;
    stripKey = key;
    strip.hidden = !show;
    strip.innerHTML = show
      ? String(
          html`${scenarios.map((msg) => {
            const hail = /^hail/i.test(msg);
            const days = !hail && /^heatwave/i.test(msg) ? (snap.heatwaveDaysRemaining ?? 0) : 0;
            return html`<div class="${hail ? "is-warn" : ""}">
              <span>${prov("simulated")} ${cap(msg)}${hail ? ". Harvest ripe crops before it hits." : ""}</span>
              ${days ? html`<span class="num">${plural(days, "day")} left</span>` : ""}
              ${onOwnFarm ? "" : html`<a href="#${routes.farm(OWN_FARM.id)}">Open<span class="em-long"> ${OWN_FARM.name}</span></a>`}
            </div>`;
          })}`,
        )
      : "";
  }

  return {
    /**
     * @param {object} route  main.js route ({level, token, farmId?, field?})
     * @param {object} snap   twin.snapshot()
     * @param {{role: string, homeToken: string, dataState: string, data: object|null}} state
     */
    render(route, snap, { role, homeToken, dataState, data }) {
      renderLadder(route);
      renderRole(role, homeToken);
      renderToggle(snap);
      renderSimbar(route, snap);
      renderStatus(snap);
      renderAbout(snap, dataState, data);
      renderStrip(route, snap);
    },
    setOpen,
    closeMenus() {
      setMenu(false);
      setAbout(false);
    },
  };
}
