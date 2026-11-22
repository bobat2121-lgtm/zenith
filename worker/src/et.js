// America/New_York wall time, computed in code (no dependence on the runtime's
// time-zone data). US rule since 2007: daylight time runs from the second
// Sunday of March at 02:00 EST (07:00 UTC) to the first Sunday of November at
// 02:00 EDT (06:00 UTC).
const MIN = 60_000;
export const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Day of month of the nth Sunday (n = 1, 2, ...) of a month (0-based).
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

export function isEasternDst(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
  return ms >= start && ms < end;
}

export const etOffsetMinutes = (ms) => (isEasternDst(ms) ? -240 : -300);

// Wall-clock parts in ET. weekday: 0 = Sunday.
export function etParts(ms) {
  const d = new Date(ms + etOffsetMinutes(ms) * MIN);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
    date: d.toISOString().slice(0, 10),
  };
}

// UTC milliseconds of an ET wall-clock time on an ET date ("YYYY-MM-DD").
export function etToUtc(date, hour = 0, minute = 0) {
  const [y, m, d] = String(date).split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  for (const off of [-300, -240]) {
    const ms = wall - off * MIN;
    if (etOffsetMinutes(ms) === off) return ms;
  }
  return wall + 300 * MIN; // inside the spring-forward gap: read as EST
}

// "YYYY-MM-DD" plus n calendar days.
export function addDays(date, n) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 0 = Sunday, for a "YYYY-MM-DD" date.
export function weekdayOf(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const pad = (n) => String(n).padStart(2, "0");

// "Mon 23 Nov" for a "YYYY-MM-DD" date.
export function fmtDay(date) {
  const [, m, d] = String(date).split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)]} ${d} ${MONTHS[m - 1]}`;
}

// "Mon 23 Nov 07:00 ET" for a UTC instant.
export function fmtEt(ms, { day = true } = {}) {
  const p = etParts(ms);
  const time = `${pad(p.hour)}:${pad(p.minute)} ET`;
  return day ? `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${time}` : time;
}

// "2h 05m", "38m", "3d 4h".
export function fmtAge(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
