// Calendar for the twin. The season starts Monday 6 July 2026; one tick = one day. Ticks
// stay internal (ripening, spray intervals, plan expiry); this is the one place that turns
// a tick into something a person reads. Pure arithmetic (no Date), so the viewer's
// timezone can't shift the calendar.

export const SEASON_START = { year: 2026, month: 7, day: 6 }; // a Monday

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Days since 1970-01-01 <-> proleptic Gregorian date (H. Hinnant's civil-date algorithms).
function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const START_DAYS = daysFromCivil(SEASON_START.year, SEASON_START.month, SEASON_START.day);

/** The calendar date of a tick: {year, month (1-12), day, weekday (0 = Monday)}. */
export function tickToDate(tick) {
  const days = START_DAYS + tick;
  const weekday = (((days + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  return { ...civilFromDays(days), weekday };
}

/** "Mon 6 Jul" */
export function dateLabel(tick) {
  const d = tickToDate(tick);
  return `${WEEKDAYS[d.weekday].slice(0, 3)} ${d.day} ${MONTHS[d.month - 1].slice(0, 3)}`;
}

/** "Monday 6 July" */
export function longDate(tick) {
  const d = tickToDate(tick);
  return `${WEEKDAYS[d.weekday]} ${d.day} ${MONTHS[d.month - 1]}`;
}
