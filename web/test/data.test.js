// The hand-curated real data (web/data/real.json, read by src/data/real.js): exactly the keys the
// pages use, every value with its full provenance {label, kind, source, url, licence, asOf}, only
// Official or Estimated (Simulated never enters this file), and numbers that are real numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_KEYS, realValue } from "../src/data/real.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "../data/real.json");
const real = JSON.parse(fs.readFileSync(FILE, "utf8"));
const KINDS = ["Official", "Estimated"];
const TEXT_FIELDS = ["label", "kind", "source", "url", "licence", "asOf"];
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

test("real.json has a meta record with the curation date and a note", () => {
  assert.match(real.meta?.curatedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(nonEmpty(real.meta?.note), "meta.note");
});

test("real.json has exactly the keys in REAL_KEYS, no more and no fewer", () => {
  assert.equal(new Set(REAL_KEYS).size, REAL_KEYS.length, "REAL_KEYS has no duplicates");
  assert.deepEqual(Object.keys(real.values).sort(), [...REAL_KEYS].sort());
});

for (const key of REAL_KEYS) {
  test(`${key}: full provenance, an allowed kind and a usable value`, () => {
    const v = real.values[key];
    assert.ok(v && typeof v === "object", key);
    for (const f of TEXT_FIELDS) assert.ok(nonEmpty(v[f]), `${key}.${f} is a non-empty string`);
    assert.ok(KINDS.includes(v.kind), `${key}.kind is Official or Estimated, not ${v.kind}`);
    assert.match(v.url, /^https:\/\//, `${key}.url starts with https://`);
    assert.doesNotThrow(() => new URL(v.url), `${key}.url parses`);
    if (typeof v.value === "number") assert.ok(Number.isFinite(v.value), `${key}.value is finite`);
    else assert.ok(nonEmpty(v.value), `${key}.value is a number or a non-empty string`);
    if ("unit" in v) assert.ok(nonEmpty(v.unit), `${key}.unit`);
    if ("note" in v) assert.ok(nonEmpty(v.note), `${key}.note`);
  });
}

test("figures the pages compare are consistent with each other", () => {
  const n = (k) => real.values[k].value;
  // A mean farm size is farmland divided by farms (Eurostat, same table).
  assert.ok(Math.abs(n("de.uaaHa") / n("de.farms") - n("de.meanSizeHa")) < 0.1);
  assert.ok(Math.abs(n("bb.uaaHa") / n("bb.farms") - n("bb.meanSizeHa")) < 0.1);
  // Brandenburg is part of Germany; the district is part of Brandenburg.
  assert.ok(n("bb.farms") < n("de.farms") && n("bb.uaaHa") < n("de.uaaHa"));
  assert.ok(n("mol.farms") < n("bb.farms") && n("mol.uaaHa") < n("bb.uaaHa"));
  assert.ok(n("bb.irrigatedHa") < n("bb.uaaHa"));
  for (const k of REAL_KEYS) {
    if (real.values[k].unit === "%") assert.ok(n(k) >= 0 && n(k) <= 100, `${k} is a share`);
  }
});

test("realValue reads a key, and a missing key or file is null (Unknown), never 0", () => {
  const data = { real, errors: {} };
  assert.equal(realValue(data, "de.farms"), real.values["de.farms"]);
  assert.equal(realValue(data, "no.such.key"), null);
  assert.equal(realValue({ real: null, errors: { real: new Error("x") } }, "de.farms"), null);
  assert.equal(realValue(null, "de.farms"), null);
});
