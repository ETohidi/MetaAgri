// Regional weather for the Oderbruch (the same sky over all three farms).
//
// Days are generated ahead: state.forecast holds the next FORECAST_DAYS days and is exactly
// what then happens (no forecast error in this MVP), so the field agents can plan against
// it. Every draw goes through the twin's seeded rng.

import { dateLabel } from "./clock.js";
import { clamp, pyRound } from "./format.js";

export const FORECAST_DAYS = 3;

/** Python's random.triangular(low, high, mode): one draw. */
export function triangular(rng, low, high, mode) {
  let u = rng.random();
  let c = (mode - low) / (high - low);
  let lo = low;
  let hi = high;
  if (u > c) {
    u = 1 - u;
    c = 1 - c;
    [lo, hi] = [hi, lo];
  }
  return lo + (hi - lo) * Math.sqrt(u * c);
}

function makeDay(tick, { temp, rain, wind, et0, humidity, hail = false, note = "" }) {
  return {
    date: dateLabel(tick),
    tempMaxC: pyRound(temp, 1),
    rainMm: pyRound(rain, 1),
    windMs: pyRound(wind, 1),
    et0Mm: pyRound(et0, 1),
    humidityPct: pyRound(humidity, 0),
    hail,
    note,
  };
}

export function normalDay(rng, tick) {
  const temp = rng.uniform(21, 29);
  const r = rng.random();
  let rain = 0;
  if (r >= 0.85) rain = rng.uniform(5, 14);
  else if (r >= 0.65) rain = rng.uniform(0.5, 4);
  const wind = triangular(rng, 1, 8, 3); // mostly light, occasionally gusty
  const et0 = clamp(3.0 + (temp - 20) * 0.25 - rain * 0.05, 2.0, 5.5);
  const humidity = rng.uniform(50, 85) + (rain > 0 ? 10 : 0);
  return makeDay(tick, { temp, rain, wind, et0, humidity: Math.min(95, humidity) });
}

export function heatwaveDay(rng, tick) {
  const temp = rng.uniform(33, 37);
  const wind = rng.uniform(1.5, 4);
  const et0 = rng.uniform(6.8, 7.8);
  const humidity = rng.uniform(30, 45);
  return makeDay(tick, { temp, rain: 0, wind, et0, humidity, note: "heatwave" });
}

export function hailDay(rng, tick) {
  const rain = rng.uniform(18, 30);
  const wind = rng.uniform(12, 16);
  return makeDay(tick, { temp: 27, rain, wind, et0: 3.0, humidity: 90, hail: true, note: "hail storm" });
}

/** The same day made harvestable: no rain, light wind (the calm before the hail). */
export function calmDry(rng, day) {
  return { ...day, rainMm: 0, windMs: pyRound(rng.uniform(2, 4), 1) };
}

/**
 * The weather for a (future) day, honouring active scenarios: the hail day wins over a
 * heatwave; heatwaveDaysRemaining counts today as the first day.
 */
export function dayFor(state, tick) {
  if (state.hailTick !== null && tick === state.hailTick) return hailDay(state.rng, tick);
  if (tick < state.tick + state.heatwaveDaysRemaining) return heatwaveDay(state.rng, tick);
  return normalDay(state.rng, tick);
}
