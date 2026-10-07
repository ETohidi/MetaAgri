// Number formatting with Python's rules, so every text and rounded number the engine
// produces matches the Python hub it was ported from. JavaScript's toFixed rounds an exact
// tie (327.5, 0.125) up, Python rounds it to even; round() differs the same way.

const TIE_DIGITS = 30; // enough extra digits to see whether a double sits exactly on a tie

/** Python's f"{x:.{digits}f}". */
export function fixed(x, digits = 0) {
  if (!Number.isFinite(x)) return String(x);
  const ax = Math.abs(x);
  if (ax >= 1e21) return String(x);
  const exact = ax.toFixed(Math.min(100, digits + TIE_DIGITS));
  const dot = exact.indexOf(".");
  const rest = exact.slice(dot + 1 + digits);
  let out = ax.toFixed(digits);
  if (/^50*$/.test(rest)) {
    // An exact tie: toFixed went up; Python goes to the even neighbour.
    const kept = digits ? exact.slice(0, dot + 1 + digits) : exact.slice(0, dot);
    if (Number(kept[kept.length - 1]) % 2 === 0) out = kept;
  }
  return x < 0 ? `-${out}` : out;
}

/** Python's round(x, digits) for a float. */
export function pyRound(x, digits = 0) {
  return Number(fixed(x, digits));
}

/** Python's f"{x:,.{digits}f}": "6,000". */
export function thousands(x, digits = 0) {
  const s = fixed(x, digits);
  const [whole, frac] = s.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const grouped = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${frac === undefined ? "" : `.${frac}`}`;
}

/** Python's f"{x:g}" for the plain amounts the twin uses: 25 -> "25", 12.5 -> "12.5". */
export function g(x) {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(6)));
}

/** Python's f"{x:.0%}": 0.4 -> "40%". */
export function pct0(x) {
  return `${fixed(x * 100, 0)}%`;
}

/** Python's str.capitalize(): "winter wheat" -> "Winter wheat". */
export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** ['a'] -> 'a', ['a', 'b'] -> 'a and b', ['a', 'b', 'c'] -> 'a, b and c'. */
export function joinAnd(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
