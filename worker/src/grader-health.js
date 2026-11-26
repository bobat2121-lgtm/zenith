// Grader health (phase 1 Part B PR-G1, moved here in phase 3 PR-PA2): pure
// functions over runs rows ({ started_at, last_seen_at }). This module imports
// nothing, so the portal (portal*.js) can use it without reaching tuning.js,
// which imports delivery.js. tuning.js re-exports every name for its importers.
const HOUR = 3_600_000;

// Phase 1: grader health. A gap is a missed scheduled run, measured against the
// grader's own cadence (expected_every_min), not a fixed 2 h. The cadence is
// the lower median of the recent start-to-start intervals, or the
// GRADER_EVERY_MIN secret when it is set.
export const OPS_LATE_MIN = 180;          // older than this is "down"
export const LATE_SLACK_MIN = 20;         // a run is missed when nothing started within every + 20 min
export const EVERY_DEFAULT_MIN = 60;      // too little history to tell
export const EVERY_MIN_CLAMP = [30, 60];
export const EVERY_WINDOW = 10;           // the last 10 usable intervals
export const EVERY_MIN_INTERVALS = 3;     // fewer usable intervals than this gives the default
export const EVERY_IGNORE = [10, 90];     // intervals outside this range (minutes) are not cadence
const MIN_MS = 60_000;

const byStart = (runs) => [...runs].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
// Start-to-start intervals in minutes, for runs sorted by started_at.
const startIntervals = (sorted) => {
  const out = [];
  for (let k = 1; k < sorted.length; k++) out.push((Date.parse(sorted[k].started_at) - Date.parse(sorted[k - 1].started_at)) / MIN_MS);
  return out;
};
// The cadence from start-to-start intervals (minutes, oldest first).
function cadenceOf(intervals) {
  const use = intervals.filter((m) => Number.isFinite(m) && m >= EVERY_IGNORE[0] && m <= EVERY_IGNORE[1]).slice(-EVERY_WINDOW);
  if (use.length < EVERY_MIN_INTERVALS) return EVERY_DEFAULT_MIN;
  const sorted = [...use].sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)];
  return Math.max(EVERY_MIN_CLAMP[0], Math.min(EVERY_MIN_CLAMP[1], Math.round(lower)));
}
// A whole number of minutes from 15 to 120 in GRADER_EVERY_MIN, else null.
function everyOverride(env) {
  const v = String(env?.GRADER_EVERY_MIN ?? "").trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 15 && n <= 120 ? n : null;
}

// runs: { started_at, last_seen_at } in any order. Minutes between scheduled runs.
export function expectedEvery(runs, env = {}) {
  return everyOverride(env) ?? cadenceOf(startIntervals(byStart(runs || [])));
}

// runs: { started_at, last_seen_at } in any order. Interval k is a gap when the
// time from run k-1's last activity to run k's start is over exp_k + 20 min,
// where exp_k is the cadence of the intervals before k. Only gaps ending at or
// after `since` count.
export function runGaps(runs, since) {
  const sorted = byStart(runs);
  const intervals = startIntervals(sorted);
  const gaps = [];
  for (let k = 1; k < sorted.length; k++) {
    const from = sorted[k - 1].last_seen_at, to = sorted[k].started_at;
    const ms = Date.parse(to) - Date.parse(from);
    const every = cadenceOf(intervals.slice(0, k - 1));
    if (to >= since && Number.isFinite(ms) && ms > (every + LATE_SLACK_MIN) * MIN_MS) {
      gaps.push({ from, to, hours: Math.round((ms / HOUR) * 10) / 10,
        missed_runs: Math.max(1, Math.round(intervals[k - 1] / every) - 1), expected_every_min: every });
    }
  }
  return gaps;
}

export function graderStatus(lastRunAt, now, everyMin = EVERY_DEFAULT_MIN) {
  const ms = Date.parse(lastRunAt || "");
  if (!Number.isFinite(ms)) return "down";
  const age = now - ms;
  return age <= (everyMin + LATE_SLACK_MIN) * MIN_MS ? "ok" : age <= OPS_LATE_MIN * MIN_MS ? "late" : "down";
}

// The gap still open now: null while the grader is ok (or has never run).
export function openGap(last, now, every) {
  if (!last?.last_seen_at || graderStatus(last.last_seen_at, now, every) === "ok") return null;
  const since = Date.parse(last.started_at || last.last_seen_at);
  return {
    from: last.last_seen_at,
    minutes: Math.round((now - Date.parse(last.last_seen_at)) / MIN_MS),
    missed_runs: Math.max(1, Math.floor((now - since) / (every * MIN_MS)) || 1),
    expected_every_min: every,
  };
}
