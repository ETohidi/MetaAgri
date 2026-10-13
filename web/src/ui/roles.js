// "Viewing as": a lens, not a login (docs/CONCEPT-v2.md section 3). A static site cannot enforce
// access, so a role only presets the home level and how much each level shows: in full, as
// aggregates only, or "Not shown" with the reason. The placeholders are how the sharing hierarchy
// becomes visible. A real deployment would enforce this on a backend.

import { html } from "./dom.js";
import { prov } from "./page.js";

/** The four roles of v2.0, in menu order. home: a level key of levels.js LEVEL_ORDER. */
export const ROLES = {
  analyst: {
    id: "analyst",
    name: "Global crop analyst",
    example: "FAO · AMIS · GEOGLAM",
    home: "world",
  },
  ministry: {
    id: "ministry",
    name: "Federal ministry",
    example: "BMLEH, Germany",
    home: "country",
  },
  district: {
    id: "district",
    name: "District & sharing network",
    example: "Märkisch-Oderland, water board, machinery sharing",
    home: "district",
  },
  farm: {
    id: "farm",
    name: "Farm manager",
    example: "Hof Lerchenbruch (fictional)",
    home: "farm",
  },
};

export const ROLE_ORDER = ["analyst", "ministry", "district", "farm"];
export const DEFAULT_ROLE = "ministry";

/**
 * What a role sees at a level: "full" (everything the level holds), "aggregate" (totals, status
 * bands, public orders and voluntary offers only) or "none" (the level's content is Not shown).
 */
export const ACCESS = {
  analyst: { world: "full", eu: "aggregate", country: "aggregate", land: "aggregate", district: "none", farm: "none", field: "none" },
  ministry: { world: "aggregate", eu: "aggregate", country: "full", land: "aggregate", district: "aggregate", farm: "none", field: "none" },
  district: { world: "aggregate", eu: "aggregate", country: "aggregate", land: "aggregate", district: "full", farm: "aggregate", field: "none" },
  farm: { world: "aggregate", eu: "aggregate", country: "aggregate", land: "aggregate", district: "aggregate", farm: "full", field: "full" },
};

/** Plain-language reasons, per level, for what a role outside it may not see. */
const REASON = {
  district:
    "Per-farm permits, herds and applications stay inside each authority's own channel; other roles see district totals and public orders.",
  farm: "A farm's plan, fields and raw data stay with the farm; others see only its voluntary offers and public status.",
  field: "Field and machine data stay with the farm (EU Code of Conduct on agricultural data sharing; Data Act).",
  world: "Global views hold country aggregates only.",
  eu: "EU views hold member-state and regional aggregates only.",
  country: "National views hold Land and district aggregates only.",
  land: "State views hold district aggregates only.",
};

export function roleOf(id) {
  return ROLES[id] ?? ROLES[DEFAULT_ROLE];
}

/** "full" | "aggregate" | "none" for a role at a level; unknown levels count as "none". */
export function access(roleId, levelKey) {
  return ACCESS[roleOf(roleId).id][levelKey] ?? "none";
}

export function notShownReason(levelKey) {
  return REASON[levelKey] ?? "Not shared at this level.";
}

/**
 * A "Not shown" placeholder that says why, and which role would see it.
 * @param {string} levelKey  where the hidden content lives
 * @param {{what?: string, seenBy?: string}} opts  what is hidden; the role name that sees it
 */
export function notShown(levelKey, { what = "This", seenBy = "" } = {}) {
  return html`<div class="notshown" role="note">
    ${prov("notshown")}
    <p><b>${what} is not shown to this role.</b> ${notShownReason(levelKey)}${seenBy ? ` Seen by: ${seenBy}.` : ""}</p>
  </div>`;
}
