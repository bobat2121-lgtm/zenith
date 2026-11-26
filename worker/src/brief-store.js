// Phase 3 Part E: the stored weekday brief (migration 0022, brief_days). The
// 5-minute tick builds the 07:00 ET morning brief once each Monday to Friday
// (US holidays included) with the competitor and industry sections and the
// 30-day calendar, and stores it as one row; the portal's Brief view reads that
// row by primary key. Nothing is sent anywhere: this is not the Discord report
// path (reports, runSlot), which stays as it was.
//
// Cost rule: no D1 call outside Monday-Friday 07:00-09:59 ET, and inside that
// window one primary-key read per tick once the day is stored. The clock is the
// caller's event.scheduledTime, never Date.now(), so the cron tests do not
// depend on the wall clock. BRIEF_STORE=0 (a secret) turns it off.
import { buildBrief, SECTION_CAP } from "./brief.js";
import { etParts, etToUtc, addDays, weekdayOf } from "./et.js";
import { nowIso } from "./lib.js";

export const BRIEF_KIND = "brief_am";
export const STORE_HOURS = { from: 7, to: 10 };   // 07:00 to 09:59 ET
export const MAX_STORE_ATTEMPTS = 3;
export const MAX_STORED_BYTES = 65_536;
const WHY_CLIP = 160;

// Q1 (primary key): today's row.
export const Q1_SQL = "SELECT status, attempts FROM brief_days WHERE universe_id='u1' AND day=? AND kind='brief_am'";
// Q2 (primary-key range): the last stored window end, at most 6 days back.
export const Q2_SQL = `SELECT window_to FROM brief_days WHERE universe_id='u1' AND kind='brief_am' AND status='ok' AND day < ?1 AND day >= ?2
  ORDER BY day DESC LIMIT 1`;
// The write: a failed row is retried (attempts + 1), an ok row is never overwritten.
export const UPSERT_SQL = `INSERT INTO brief_days (universe_id, day, kind, status, attempts, window_from, window_to, built_at, counts, contents, error)
  VALUES ('u1', ?, 'brief_am', ?, 1, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(universe_id, day, kind) DO UPDATE SET status = excluded.status, attempts = brief_days.attempts + 1,
    window_from = excluded.window_from, window_to = excluded.window_to, built_at = excluded.built_at,
    counts = excluded.counts, contents = excluded.contents, error = excluded.error
  WHERE brief_days.status != 'ok'`;

// Monday to Friday, 07:00-09:59 America/New_York.
export function inStoreWindow(ms) {
  const et = etParts(ms);
  return et.weekday >= 1 && et.weekday <= 5 && et.hour >= STORE_HOURS.from && et.hour < STORE_HOURS.to;
}

// The weekday before an ET date (Monday -> the previous Friday).
export function previousWeekday(date) {
  let d = addDays(date, -1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, -1);
  return d;
}

const bytes = (s) => new TextEncoder().encode(s).length;
const clipWhy = (r) => (r && typeof r.why === "string" && r.why.length > WHY_CLIP ? { ...r, why: r.why.slice(0, WHY_CLIP) } : r);
const clipTitle = (r) => (r && typeof r.title === "string" && r.title.length > WHY_CLIP ? { ...r, title: r.title.slice(0, WHY_CLIP) } : r);
const HOOK_CLIP = 80;
const clipField = (r, k, n) => (typeof r[k] === "string" && r[k].length > n ? { [k]: r[k].slice(0, n) } : {});
const clipHook = (r) => (r ? { ...r, ...clipField(r, "note_hook", HOOK_CLIP), ...clipField(r, "headline", HOOK_CLIP) } : r);
const ok = (s) => s && !s.error;

// Applies f to every listed row of the brief (graded, counterparty, sections).
function mapRows(b, f) {
  const out = { ...b, leads_digests: b.leads_digests.map((g) => ({ ...g, items: g.items.map(f) })), counterparty: b.counterparty.map(f) };
  if (ok(b.competitors)) {
    out.competitors = { ...b.competitors, by_ticker: b.competitors.by_ticker.map((g) => ({ ...g, items: g.items.map(f) })), below: b.competitors.below.map(f) };
  }
  if (ok(b.industry)) out.industry = { ...b.industry, items: b.industry.items.map(f), below: b.industry.below.map(f) };
  return out;
}

// Drops n rows from the end of a list of { items } groups; empty groups go.
function dropGrouped(groups, n) {
  const out = groups.map((g) => ({ ...g, items: [...g.items] }));
  for (let i = out.length - 1; i >= 0 && n > 0; i--) {
    const k = Math.min(n, out[i].items.length);
    out[i].items.splice(out[i].items.length - k, k);
    n -= k;
  }
  return out.filter((g) => g.items.length);
}
const groupedLen = (groups) => groups.reduce((n, g) => n + g.items.length, 0);

// The last step's lists, least needed first: [name, length, drop(x, n)].
const CUT_ORDER = [
  ["calendar", (x) => x.calendar.length, (x, n) => ({ ...x, calendar: x.calendar.slice(0, -n) })],
  ["council_outcomes", (x) => x.council_outcomes.length, (x, n) => ({ ...x, council_outcomes: x.council_outcomes.slice(0, -n) })],
  ["catalysts", (x) => x.catalysts.length, (x, n) => ({ ...x, catalysts: x.catalysts.slice(0, -n) })],
  ["health_failing", (x) => x.health?.news_monitor?.failing?.length || 0,
    (x, n) => ({ ...x, health: { ...x.health, news_monitor: { ...x.health.news_monitor, failing: x.health.news_monitor.failing.slice(0, -n) } } })],
  ["industry_below", (x) => (ok(x.industry) ? x.industry.below.length : 0), (x, n) => ({ ...x, industry: { ...x.industry, below: x.industry.below.slice(0, -n) } })],
  ["competitors_below", (x) => (ok(x.competitors) ? x.competitors.below.length : 0), (x, n) => ({ ...x, competitors: { ...x.competitors, below: x.competitors.below.slice(0, -n) } })],
  ["industry", (x) => (ok(x.industry) ? x.industry.items.length : 0), (x, n) => ({ ...x, industry: { ...x.industry, items: x.industry.items.slice(0, -n) } })],
  ["competitors", (x) => (ok(x.competitors) ? groupedLen(x.competitors.by_ticker) : 0),
    (x, n) => ({ ...x, competitors: { ...x.competitors, by_ticker: dropGrouped(x.competitors.by_ticker, n) } })],
  ["counterparty", (x) => x.counterparty.length, (x, n) => ({ ...x, counterparty: x.counterparty.slice(0, -n) })],
  ["leads_digests", (x) => groupedLen(x.leads_digests), (x, n) => ({ ...x, leads_digests: dropGrouped(x.leads_digests, n) })],
];

// The last step, which always fits: rows cut from the bottom of each list in
// CUT_ORDER until the JSON is under the cap. contents.truncated names the rows
// cut per list (the counts column keeps the full numbers).
function cutToFit(s) {
  let x = { ...s, truncated: {} };
  let text = JSON.stringify(x);
  for (const [name, len, drop] of CUT_ORDER) {
    while (bytes(text) > MAX_STORED_BYTES && len(x) > 0) {
      const n0 = len(x);
      const listBytes = bytes(JSON.stringify(x)) - bytes(JSON.stringify(drop(x, n0)));
      const per = Math.max(1, listBytes / n0);
      const n = Math.min(n0, Math.max(1, Math.ceil((bytes(text) - MAX_STORED_BYTES) / per)));
      x = drop(x, n);
      x.truncated = { ...x.truncated, [name]: (x.truncated[name] || 0) + n };
      text = JSON.stringify(x);
    }
    if (bytes(text) <= MAX_STORED_BYTES) break;
  }
  return x;
}

// The stored copy: no text; each list cut to its brief cap (the counts column
// keeps the full numbers); under 64 KB by clipping why, then dropping the
// waiting items, then trimming the calendar to 30 entries, then clipping
// titles, then clipping note_hook and headline, then cutting rows from the
// bottom of the lists (contents.truncated).
export function capBrief(b) {
  const { text: _text, ...rest } = b;
  let shown = 0;
  const leads = [];
  for (const g of rest.leads_digests || []) {
    if (shown >= SECTION_CAP.graded) break;
    const items = g.items.slice(0, SECTION_CAP.graded - shown);
    shown += items.length;
    leads.push({ ...g, items });
  }
  let s = {
    ...rest,
    leads_digests: leads,
    counterparty: (rest.counterparty || []).slice(0, SECTION_CAP.counterparty),
    waiting: { ...rest.waiting, items: (rest.waiting?.items || []).slice(0, SECTION_CAP.waiting) },
    catalysts: (rest.catalysts || []).slice(0, SECTION_CAP.catalysts),
    council_outcomes: (rest.council_outcomes || []).slice(0, SECTION_CAP.catalysts),
    calendar: (rest.calendar || []).slice(0, SECTION_CAP.calendar),
  };
  if (ok(s.industry)) s.industry = { ...s.industry, items: s.industry.items.slice(0, SECTION_CAP.industry) };
  const steps = [
    (x) => mapRows(x, clipWhy),
    (x) => ({ ...x, waiting: { ...x.waiting, items: [] } }),
    (x) => ({ ...x, calendar: x.calendar.slice(0, 30) }),
    (x) => mapRows(x, clipTitle),
    (x) => mapRows(x, clipHook),
    cutToFit,
  ];
  let text = JSON.stringify(s);
  for (const step of steps) {
    if (bytes(text) <= MAX_STORED_BYTES) break;
    s = step(s);
    text = JSON.stringify(s);
  }
  // A guard only: cutToFit leaves no list rows when it cannot fit.
  if (bytes(text) > MAX_STORED_BYTES) throw new Error(`stored brief over ${MAX_STORED_BYTES} bytes (${bytes(text)})`);
  return { contents: s, json: text, bytes: bytes(text) };
}

// Section counts, all numbers (full, before the caps); a section that failed is null.
export function briefCounts(b) {
  const c = b.competitors, i = b.industry;
  return {
    leads_digests: (b.leads_digests || []).reduce((n, g) => n + g.items.length, 0),
    counterparty: (b.counterparty || []).length,
    waiting: b.waiting?.count ?? 0,
    held: b.waiting?.held ?? 0,
    catalysts: (b.catalysts || []).length,
    council_outcomes: (b.council_outcomes || []).length,
    competitors: ok(c) ? c.count : null,
    industry: ok(i) ? i.count : null,
    competitors_below: ok(c) ? c.below.length : null,
    industry_below: ok(i) ? i.below.length : null,
    registers: ok(i) && Array.isArray(i.registers) ? i.registers.length : null,
    calendar: (b.calendar || []).length,
  };
}

// One tick. now: event.scheduledTime. rel: a relations.js object (tests only).
export async function briefStoreTick(env, covered, { now, rel = null } = {}) {
  if (env.BRIEF_STORE === "0") return { status: "off" };
  if (!Number.isFinite(now)) throw new TypeError("briefStoreTick needs now (the event's scheduledTime)");
  if (!inStoreWindow(now)) return { status: "outside" };
  const db = env.DB;
  const day = etParts(now).date;
  const row = await db.prepare(Q1_SQL).bind(day).first();
  if (row?.status === "ok") return { status: "already", day };
  if (row?.status === "failed" && row.attempts >= MAX_STORE_ATTEMPTS) return { status: "gave_up", day, attempts: row.attempts };

  const last = await db.prepare(Q2_SQL).bind(day, addDays(day, -6)).first();
  const from = last?.window_to || nowIso(etToUtc(previousWeekday(day), STORE_HOURS.from, 0));
  const to = nowIso(now);
  const attempts = (row?.attempts || 0) + 1;
  let stored, counts;
  try {
    const b = await buildBrief(env, covered, { from, to, now, kind: BRIEF_KIND, sections: "full", rel });
    stored = capBrief(b);
    counts = briefCounts(b);
  } catch (e) {
    const error = String(e?.message || e).slice(0, 300);
    await db.prepare(UPSERT_SQL).bind(day, "failed", from, to, nowIso(now), null, null, error).run();
    return { status: "failed", day, attempts, error };
  }
  try {
    await db.prepare(UPSERT_SQL).bind(day, "ok", from, to, nowIso(now), JSON.stringify(counts), stored.json, null).run();
  } catch (e) {
    // The ok write failed (a transient D1 error): store failed so attempts
    // counts on and the 3-attempt cap holds; never rebuild on every tick.
    const error = `store write failed: ${String(e?.message || e)}`.slice(0, 300);
    try {
      await db.prepare(UPSERT_SQL).bind(day, "failed", from, to, nowIso(now), null, null, error).run();
    } catch {
      console.warn("brief store: the failed row was not written either");
    }
    return { status: "failed", day, attempts, error };
  }
  return { status: "ok", day, attempts, bytes: stored.bytes, counts };
}
