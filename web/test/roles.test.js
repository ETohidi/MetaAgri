// "Viewing as" (src/ui/roles.js): a lens, not a login. Every role has a home level with a page,
// ACCESS says for every role what it sees at every level, and a "Not shown" placeholder always
// carries its badge and the reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS, DEFAULT_ROLE, ROLE_ORDER, ROLES, access, notShown, notShownReason, roleOf } from "../src/ui/roles.js";
import { LEVEL_ORDER, LEVELS } from "../src/ui/levels.js";
import { esc } from "../src/ui/dom.js";

const SEES = ["full", "aggregate", "none"];

test("the menu lists the four v2.0 roles, and the default is the federal ministry", () => {
  assert.deepEqual([...ROLE_ORDER].sort(), Object.keys(ROLES).sort());
  assert.equal(ROLE_ORDER.length, 4);
  assert.equal(DEFAULT_ROLE, "ministry");
  assert.ok(ROLE_ORDER.includes(DEFAULT_ROLE));
});

for (const id of ROLE_ORDER) {
  test(`role "${id}" has a name, an example and a home level with a page`, () => {
    const r = ROLES[id];
    assert.equal(r.id, id);
    assert.ok(r.name.trim().length > 0 && r.example.trim().length > 0, id);
    assert.ok(LEVEL_ORDER.includes(r.home), `${id}.home is a level`);
    assert.ok(LEVELS[r.home].route, `${id}.home has a page to open`);
    assert.equal(access(id, r.home), "full", `${id} sees its home level in full`);
  });
}

test("the default lens opens Germany, and the farm manager opens our fictional farm", () => {
  assert.equal(LEVELS[ROLES[DEFAULT_ROLE].home].route, "germany");
  assert.equal(LEVELS[ROLES.farm.home].route, "lerchenbruch");
});

test("ACCESS covers every level for every role, with full, aggregate or none", () => {
  assert.deepEqual(Object.keys(ACCESS).sort(), [...ROLE_ORDER].sort());
  for (const id of ROLE_ORDER) {
    assert.deepEqual(Object.keys(ACCESS[id]).sort(), [...LEVEL_ORDER].sort(), id);
    for (const lv of LEVEL_ORDER) assert.ok(SEES.includes(ACCESS[id][lv]), `${id}.${lv}`);
  }
});

test("only the farm manager sees a farm or field in full; nobody above the farm sees its fields", () => {
  for (const id of ROLE_ORDER) {
    if (id === "farm") continue;
    assert.notEqual(access(id, "farm"), "full", id);
    assert.equal(access(id, "field"), "none", id);
  }
  assert.equal(access("farm", "farm"), "full");
  assert.equal(access("farm", "field"), "full");
});

test("an unknown role falls back to the default lens; an unknown level shows nothing", () => {
  assert.equal(roleOf("nobody").id, DEFAULT_ROLE);
  assert.equal(access("nobody", "country"), access(DEFAULT_ROLE, "country"));
  assert.equal(access("farm", "galaxy"), "none");
});

test("Not shown renders its badge and a reason, never a number", () => {
  for (const lv of LEVEL_ORDER) {
    const out = String(notShown(lv, { what: "The field data", seenBy: "Farm manager" }));
    assert.match(out, /class="prov is-notshown"/, lv);
    assert.match(out, />Not shown</, lv);
    assert.match(out, /The field data is not shown to this role\./, lv);
    assert.ok(out.includes(esc(notShownReason(lv))) && notShownReason(lv).length > 20, `${lv} gives a reason`);
    assert.match(out, /Seen by: Farm manager\./);
    assert.doesNotMatch(out, />\s*0\s*</, `${lv}: Not shown is never 0`);
  }
  assert.match(String(notShown("galaxy")), /Not shared at this level\./);
});
