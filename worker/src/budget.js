// Phase 0 gates: the daily grading budget. Rows the arrival gate admits past
// the fast path (lib.js arrivalGate: record_late, seed_window, seed_fresh) and
// rows an admin rescue turns back into work (admit 'rescue') are stored
// pending but held (admit set, released_at NULL): the claims never return
// them. releaseHeld, on every 5-minute cron, releases at most TOTAL a UTC day
// across both pipelines, at most PER_SOURCE per source, and only into a
// pipeline whose claimable queue is under GUARD, so a dark grader never piles
// released rows up. Rows over the day's budget stay held (pending, never
// skipped) for the next UTC day.
//
// Overrides only through Worker secrets (they survive `wrangler deploy`;
// wrangler.toml has no [vars]): GATE_BUDGET_TOTAL, GATE_BUDGET_PER_SOURCE,
// GATE_QUEUE_GUARD.
import COVERED from "./covered.json";
import { HELD_SQL, universeSql, nowIso, chunk, sightingAgeDays, ARCHIVE_SEED_MIN, LATE_WINDOW_DAYS, RECORD_LOOKBACK_DAYS } from "./lib.js";
import { coverageOwner, OLD_OR_UNDATED_SQL } from "./ingest.js";
import { isOfficialRecord } from "./records.js";

export const GATE_BUDGET_TOTAL = 20;
export const GATE_BUDGET_PER_SOURCE = 5;
export const GATE_QUEUE_GUARD = 60;
const IN_UNIVERSE = universeSql(COVERED.tickers);

// A whole non-negative number from a secret, else the default.
const setting = (v, dflt) => {
  if (v === undefined || v === null || String(v).trim() === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
};
export function budgetSettings(env = {}) {
  return {
    total: setting(env.GATE_BUDGET_TOTAL, GATE_BUDGET_TOTAL),
    per_source: setting(env.GATE_BUDGET_PER_SOURCE, GATE_BUDGET_PER_SOURCE),
    guard: setting(env.GATE_QUEUE_GUARD, GATE_QUEUE_GUARD),
  };
}

// 00:00 UTC of the day `now` (ms) falls in, as an ISO string.
export const utcDayStart = (now = Date.now()) => `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;

// The pipelines, coverage first (the cron serves coverage first). Coverage
// releases only rows of today's universe, as its feed shows.
const TABLES = [
  { kind: "coverage", table: "items", scope: `AND ticker IN ${IN_UNIVERSE}` },
  { kind: "aux", table: "aux_items", scope: "" },
];

// Rows released since 00:00 UTC, per source, across both tables. Rescue rows
// count: this same function releases them.
export async function releasedToday(db, now = Date.now()) {
  const day = utcDayStart(now);
  const rows = (await db.prepare(
    `SELECT source_key, COUNT(*) AS n FROM (SELECT source_key FROM items WHERE released_at >= ?1
       UNION ALL SELECT source_key FROM aux_items WHERE released_at >= ?1) GROUP BY source_key`,
  ).bind(day).all()).results || [];
  return new Map(rows.map((r) => [r.source_key, r.n]));
}

// Held rows per pipeline (pending, admitted, not yet released).
export async function heldCounts(db) {
  const out = {};
  for (const t of TABLES) {
    out[t.kind] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE state = 'pending' AND ${HELD_SQL()} ${t.scope}`).first())?.n || 0;
  }
  return out;
}

export async function releaseHeld(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const cfg = budgetSettings(env);
  const used = await releasedToday(db, now);
  const usedTotal = [...used.values()].reduce((a, b) => a + b, 0);
  let left = cfg.total - usedTotal;
  const released = { coverage: 0, aux: 0 };
  const at = nowIso(now);
  for (const t of TABLES) {
    if (left <= 0) break;
    const queued = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE state IN ('pending','claimed') AND NOT ${HELD_SQL()}`).first())?.n || 0;
    let room = cfg.guard - queued;
    if (room <= 0) continue;
    // At most PER_SOURCE candidates per source in SQL, so one big seed never
    // hides every other source. A new source's fresh first-poll rows
    // (seed_fresh) come first: they are time-sensitive; then oldest first.
    const cands = (await db.prepare(
      `SELECT id, source_key, admit, nm_first_seen, rn FROM (
         SELECT id, source_key, admit, nm_first_seen,
                ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY (admit = 'seed_fresh') DESC, nm_first_seen, id) AS rn
           FROM ${t.table} WHERE state = 'pending' AND ${HELD_SQL()} ${t.scope})
        WHERE rn <= ?1 ORDER BY (admit = 'seed_fresh') DESC, nm_first_seen, id LIMIT 500`,
    ).bind(cfg.per_source).all()).results || [];
    const pick = [];
    for (const c of cands) {
      if (left <= 0 || room <= 0) break;
      const u = used.get(c.source_key) || 0;
      if (u >= cfg.per_source) continue;
      pick.push(c.id);
      used.set(c.source_key, u + 1);
      left--;
      room--;
    }
    for (const part of chunk(pick)) {
      const r = await db.prepare(
        `UPDATE ${t.table} SET released_at = ? WHERE id IN (${part.map(() => "?").join(",")}) AND state = 'pending' AND released_at IS NULL`,
      ).bind(at, ...part).run();
      released[t.kind] += r.meta?.changes || 0;
    }
  }
  const usedToday = usedTotal + released.coverage + released.aux;
  return { released, held: await heldCounts(db), used_today: usedToday, left: Math.max(0, cfg.total - usedToday), budget: cfg, at };
}

// --- Admin rescue (POST /v1/admin/requeue { mode: "rescue" }) ------------------
// Built in Phase 0; NOT to be run before 2026-11-29 16:00 UTC, and dry_run
// first. It never releases anything: it turns skipped rows back into held
// rows (admit 'rescue', released_at NULL), which releaseHeld then drains under
// the same daily budget, per-source cap and queue guard as every other
// admission. One call can never put more than the day's budget into a queue.
//   since    required, YYYY-MM-DD: rows with published >= since (dated rows only)
//   until    optional, YYYY-MM-DD: published on or before that day
//   reasons  default and allowed: archive_seed, stale_on_arrival, rival_no_key_account
//   kind     coverage | aux | both (default both)
//   sources  optional keys or "prefix*" patterns
//   fit      rubric (default): rows the current rubric can score above stale:
//            first seen within 21 days of published, or (Coverage) an official
//            record 22-120 days late whose (source, first_seen) group in that
//            table is not an archive burst. all: every match.
//   limit    1-300 (default 60): the most rows this call turns into held rows
//   dry_run  report only
// One row per news-monitor row, in the pipeline that owns it (ingest.js
// coverageOwner, never the stored skip_reason): a Coverage-owned row's
// Coverage copy (unless its aux twin is shown), a gate-dropped rival row's Aux
// copy (its Coverage stub is never requeued; with no Aux copy it is counted
// no_aux_copy), a plain auxiliary row's Aux copy (unless its Coverage twin is
// shown). Newest published first, Coverage before Aux.
export const RESCUE_REASONS = ["archive_seed", "stale_on_arrival", "rival_no_key_account"];
export const RESCUE_DEFAULT_LIMIT = 60;
export const RESCUE_MAX_LIMIT = 300;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,120}\*?$/;
const validDay = (s) => typeof s === "string" && DAY_RE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function rescueParams(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!validDay(b.since)) return { error: "since is required, as YYYY-MM-DD" };
  if (b.until != null && !validDay(b.until)) return { error: "until must be YYYY-MM-DD" };
  const reasons = b.reasons == null ? RESCUE_REASONS : b.reasons;
  if (!Array.isArray(reasons) || !reasons.length || reasons.some((r) => !RESCUE_REASONS.includes(r))) {
    return { error: `reasons must be a non-empty list of ${RESCUE_REASONS.join(", ")}` };
  }
  const kind = b.kind == null ? "both" : b.kind;
  if (!["coverage", "aux", "both"].includes(kind)) return { error: "kind must be coverage, aux or both" };
  const fit = b.fit == null ? "rubric" : b.fit;
  if (!["rubric", "all"].includes(fit)) return { error: "fit must be rubric or all" };
  if (b.sources != null && (!Array.isArray(b.sources) || b.sources.some((s) => typeof s !== "string" || !KEY_RE.test(s)))) {
    return { error: 'sources must be a list of source keys or "prefix*" patterns' };
  }
  const n = Math.trunc(Number(b.limit));
  const limit = b.limit == null || !Number.isFinite(n) ? RESCUE_DEFAULT_LIMIT : Math.max(1, Math.min(RESCUE_MAX_LIMIT, n));
  const until = b.until ? new Date(Date.parse(`${b.until}T00:00:00Z`) + 86_400_000).toISOString() : null;
  return { since: b.since, until, untilDay: b.until || null, reasons: [...new Set(reasons)], kind, fit, sources: b.sources || null, limit, dryRun: Boolean(b.dry_run) };
}

const sourceMatch = (patterns) => (key) => !patterns || patterns.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));

// Groups (source, first_seen) of a table that are archive bursts: ARCHIVE_SEED_MIN
// or more undated or old rows (ingest.js storedArchiveCounts' rule).
async function burstGroups(db, table, keys) {
  const out = new Set();
  for (const part of chunk([...new Set(keys)])) {
    const res = await db.prepare(
      `SELECT source_key, nm_first_seen, COUNT(*) AS n FROM ${table} WHERE source_key IN (${part.map(() => "?").join(",")}) AND ${OLD_OR_UNDATED_SQL}
        GROUP BY source_key, nm_first_seen HAVING COUNT(*) >= ?`,
    ).bind(...part, ARCHIVE_SEED_MIN).all();
    for (const x of res.results || []) out.add(`${x.source_key}\u0000${x.nm_first_seen}`);
  }
  return out;
}

const COLS = "i.id, i.nm_rowid, i.source_key, i.title, i.url, i.published, i.nm_first_seen, i.skip_reason";
export async function rescueSkipped(env, body, { now = Date.now() } = {}) {
  const p = rescueParams(body);
  if (p.error) return { mode: "rescue", error: p.error };
  const db = env.DB;
  const reasonsJson = JSON.stringify(p.reasons);
  const dated = `i.state = 'skipped' AND i.skip_reason IN (SELECT value FROM json_each(?1)) AND i.published IS NOT NULL AND i.published >= ?2
    AND (?3 IS NULL OR i.published < ?3)`;
  const want = sourceMatch(p.sources);
  // Coverage rows, with whether the aux twin is shown and whether one exists.
  const cov = p.kind === "aux" ? [] : ((await db.prepare(
    `SELECT ${COLS},
            EXISTS (SELECT 1 FROM aux_items t LEFT JOIN aux_grades tg ON tg.id = t.grade_id
                     WHERE t.nm_rowid = i.nm_rowid AND t.state != 'skipped' AND (tg.band IS NULL OR tg.band != 'covered')) AS twin_shown,
            EXISTS (SELECT 1 FROM aux_items t WHERE t.nm_rowid = i.nm_rowid) AS has_aux
       FROM items i WHERE ${dated} AND i.ticker IN ${IN_UNIVERSE} LIMIT 5000`,
  ).bind(reasonsJson, p.since, p.until).all()).results || []).filter((r) => want(r.source_key));
  const aux = p.kind === "coverage" ? [] : ((await db.prepare(
    `SELECT ${COLS}, EXISTS (SELECT 1 FROM items t WHERE t.source_key = i.source_key AND t.url = i.url AND t.nm_rowid = i.nm_rowid AND t.state != 'skipped') AS twin_shown
       FROM aux_items i WHERE ${dated} LIMIT 5000`,
  ).bind(reasonsJson, p.since, p.until).all()).results || []).filter((r) => want(r.source_key));
  const picks = [];
  let noAuxCopy = 0;
  if (p.kind !== "aux") {
    for (const r of cov) {
      const own = coverageOwner(r);
      if (own.owns) { if (!r.twin_shown) picks.push({ kind: "coverage", ...r }); continue; }
      if (own.dropped && !r.has_aux) noAuxCopy++;                // its Aux copy, if any, comes from the aux list
    }
  }
  if (p.kind !== "coverage") {
    for (const r of aux) {
      const own = coverageOwner(r);
      if (own.owns || r.twin_shown) continue;                    // Coverage's row, or shown on Coverage
      if (own.dropped && !["archive_seed", "stale_on_arrival"].includes(r.skip_reason)) continue;
      picks.push({ kind: "aux", ...r });
    }
  }
  // Rubric fit (the current rubric's freshness lines, core.md section 8 and auxiliary.md section 5).
  const bursts = {
    coverage: await burstGroups(db, "items", picks.filter((r) => r.kind === "coverage").map((r) => r.source_key)),
    aux: new Set(),
  };
  const fitOf = (r) => {
    const age = sightingAgeDays(r.published, r.nm_first_seen);
    if (age != null && age <= LATE_WINDOW_DAYS) return "within_21d";
    if (r.kind === "coverage" && age != null && age <= RECORD_LOOKBACK_DAYS && isOfficialRecord(r)
      && !bursts.coverage.has(`${r.source_key}\u0000${r.nm_first_seen}`)) return "record_late";
    return null;
  };
  let excluded = 0;
  const fitting = [];
  for (const r of picks) {
    const f = fitOf(r);
    if (!f && p.fit === "rubric") { excluded++; continue; }
    fitting.push({ ...r, fit: f || "outside_rubric" });
  }
  const order = (a, b) => (a.kind === b.kind ? 0 : a.kind === "coverage" ? -1 : 1) || String(b.published).localeCompare(String(a.published)) || b.id - a.id;
  fitting.sort(order);
  const take = fitting.slice(0, p.limit);
  const held = { coverage: 0, aux: 0 };
  if (p.dryRun) {
    for (const r of take) held[r.kind]++;
  } else {
    for (const [kind, table] of [["coverage", "items"], ["aux", "aux_items"]]) {
      for (const part of chunk(take.filter((r) => r.kind === kind).map((r) => r.id))) {
        const res = await db.prepare(
          `UPDATE ${table} SET state = 'pending', skip_reason = NULL, attempts = 0, claim_id = NULL, claimed_until = NULL, admit = 'rescue', released_at = NULL
            WHERE id IN (${part.map(() => "?").join(",")}) AND state = 'skipped'`,
        ).bind(...part).run();
        held[kind] += res.meta?.changes || 0;
      }
    }
  }
  const cfg = budgetSettings(env);
  const used = [...(await releasedToday(db, now)).values()].reduce((a, b) => a + b, 0);
  return {
    mode: "rescue", since: p.since, until: p.untilDay, reasons: p.reasons, kind: p.kind, fit: p.fit, limit: p.limit,
    matched: fitting.length, excluded_by_fit: excluded, held, remaining: fitting.length - take.length, no_aux_copy: noAuxCopy,
    budget_left_today: Math.max(0, cfg.total - used), dry_run: p.dryRun,
    items: take.slice(0, 200).map((r) => ({ kind: r.kind, id: r.id, source_key: r.source_key, published: r.published, title: r.title, was: r.skip_reason, fit: r.fit })),
  };
}
