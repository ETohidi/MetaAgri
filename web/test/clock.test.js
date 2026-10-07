// The calendar and the Python-compatible number formatting every engine text relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateLabel, longDate, tickToDate } from "../src/engine/clock.js";
import { capitalize, fixed, g, joinAnd, pct0, pyRound, thousands } from "../src/engine/format.js";

test("date labels from the season start (Monday 6 July 2026)", () => {
  assert.equal(dateLabel(0), "Mon 6 Jul");
  assert.equal(dateLabel(2), "Wed 8 Jul");
  assert.equal(dateLabel(26), "Sat 1 Aug");
  assert.equal(longDate(0), "Monday 6 July");
  assert.equal(longDate(1), "Tuesday 7 July");
  assert.equal(dateLabel(56), "Mon 31 Aug");
  assert.equal(longDate(57), "Tuesday 1 September");
  assert.equal(longDate(179), "Friday 1 January"); // into 2027
  assert.deepEqual(tickToDate(179), { year: 2027, month: 1, day: 1, weekday: 4 });
  assert.equal(dateLabel(1000), "Sun 1 Apr"); // 2029, past a leap day
});

test("fixed() rounds exact ties to even, like Python's format", () => {
  assert.equal(fixed(327.5, 0), "328");
  assert.equal(fixed(326.5, 0), "326"); // JavaScript's toFixed would say 327
  assert.equal(fixed(0.125, 2), "0.12");
  assert.equal(fixed(0.375, 2), "0.38");
  assert.equal(fixed(2.675, 2), "2.67"); // not a tie: the double is just below 2.675
  assert.equal(fixed(0.5, 0), "0");
  assert.equal(fixed(1.5, 0), "2");
  assert.equal(fixed(108.7, 0), "109");
  assert.equal(fixed(0.85, 2), "0.85");
  assert.equal(fixed(-2.5, 0), "-2");
  assert.equal(fixed(21.1, 1), "21.1");
  assert.equal(pyRound(0.25, 1), 0.2);
  assert.equal(pyRound(327.65, 1), 327.6); // the double sits just below .65
  assert.equal(pyRound(46.5), 46);
});

test("thousands, g, percent, capitalize and joins", () => {
  assert.equal(thousands(6000), "6,000");
  assert.equal(thousands(3600), "3,600");
  assert.equal(thousands(999), "999");
  assert.equal(thousands(1234567.4), "1,234,567");
  assert.equal(g(25), "25");
  assert.equal(g(12.5), "12.5");
  assert.equal(pct0(0.4), "40%");
  assert.equal(capitalize("winter wheat"), "Winter wheat");
  assert.equal(capitalize("fungicide"), "Fungicide");
  assert.equal(joinAnd(["North field"]), "North field");
  assert.equal(joinAnd(["North field", "West field"]), "North field and West field");
  assert.equal(joinAnd(["a", "b", "c"]), "a, b and c");
});
