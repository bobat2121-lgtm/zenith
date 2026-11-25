// Phase 0 gates: the daily grading budget. Rows the arrival gate admits past
// the fast path (lib.js arrivalGate: record_late, seed_window, seed_fresh, and
// from phase 1 vote, record_fresh and source_cap) and
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
// GATE_QUEUE_GUARD, and GATE_FAST_CAP (phase 1, the per-source fast-path cap).
//
// Phase 2 story dedup (story.js) adds two ways a skipped 'story_dup' copy
// comes back, both as held admit 'rescue' rows under the same budget:
//   storyOrphans  once a UTC day (the 00:00-00:04 cron tick): a copy whose
//                 canonical left the queue (muted, parked, failed grading) or
//                 is missing; the earliest copy from an unmuted source is
//                 promoted and the group's other copies point to it
//   storyRelease  POST /v1/admin/requeue { mode: "story_release" }: the
//                 owner's rollback, copies first seen since a day
// The rescue (mode "rescue") drops a pick with a live exact copy (has_live_copy)
// and writes the keys of every row it re-pends.
import COVERED from "./covered.json";
import { HELD_SQL, universeSql, nowIso, chunk, sightingAgeDays, ARCHIVE_SEED_MIN, LATE_WINDOW_DAYS, RECORD_LOOKBACK_DAYS, audit } from "./lib.js";
import { coverageOwner, OLD_OR_UNDATED_SQL, isOwnLane } from "./ingest.js";
import { isOfficialRecord } from "./records.js";
import { mutedSources } from "./tuning.js";
import { storyKeys, findCanonicals, sharesKey, STORY_WINDOW_DAYS } from "./story.js";

export const GATE_BUDGET_TOTAL = 20;
export const GATE_BUDGET_PER_SOURCE = 5;
export const GATE_QUEUE_GUARD = 60;
// Phase 1: the most fast-path rows (admit NULL, not skipped) one source that is
// neither own-lane nor SEC may add per first-seen UTC day, across both
// pipelines; later fresh rows are held 'source_cap'. Secret GATE_FAST_CAP; 0 is off.
export const GATE_FAST_CAP = 10;
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
    fast_cap: setting(env.GATE_FAST_CAP, GATE_FAST_CAP),
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

// Rows released since 00:00 UTC (bound as ?1), per source, across both tables.
// Rescue rows count: this same function releases them.
const RELEASED_SINCE = `SELECT source_key FROM items WHERE released_at >= ?1
       UNION ALL SELECT source_key FROM aux_items WHERE released_at >= ?1`;
export async function releasedToday(db, now = Date.now()) {
  const day = utcDayStart(now);
  const rows = (await db.prepare(
    `SELECT source_key, COUNT(*) AS n FROM (${RELEASED_SINCE}) GROUP BY source_key`,
  ).bind(day).all()).results || [];
  return new Map(rows.map((r) => [r.source_key, r.n]));
}

// --- Phase 1: the per-source fast-path cap ------------------------------------
// Fast-path rows (admit NULL, not skipped) per source first seen on one UTC
// day (YYYY-MM-DD), across items and aux_items. Binds only the two day bounds
// (both arms share ?1 and ?2), never a key list, so the D1 limit of 100 bound
// parameters cannot be reached. Own-lane (covered.json sources) and edgar_*
// keys are uncapped and dropped here, in code. A non-edgar_ row on a sec.gov
// URL counts toward its source (conservative: it is never held itself).
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export async function fastPathCounts(db, day, ownLane = isOwnLane) {
  const d = String(day).slice(0, 10);
  const arm = (table) => `SELECT source_key, COUNT(*) AS n FROM ${table}
      WHERE nm_first_seen >= ?1 AND nm_first_seen < ?2 AND admit IS NULL AND state != 'skipped' GROUP BY source_key`;
  const rows = (await db.prepare(
    `SELECT source_key, SUM(n) AS n FROM (${arm("items")} UNION ALL ${arm("aux_items")}) GROUP BY source_key`,
  ).bind(d, nextDay(d)).all()).results || [];
  const out = new Map();
  for (const r of rows) {
    const k = String(r.source_key ?? "");
    if (ownLane(k) || k.startsWith("edgar_")) continue;
    out.set(k, r.n);
  }
  return out;
}

// One ingest batch's cap state: the day's stored fast-path counts (one
// fastPathCounts call per distinct first-seen day among the batch's rows that
// can be capped) plus an in-memory count of this batch's own fast-path rows.
// capped(r): the row's source is at the cap for the row's first-seen day.
// add(r): count a row that ended plain pending (no skip reason, admit NULL).
// A cap of 0 (or less) is off and sends no query.
const cappable = (r, ownLane) => !ownLane(String(r.source_key ?? "")) && !String(r.source_key ?? "").startsWith("edgar_");
const fastKey = (r) => `${r.source_key}\u0000${String(r.first_seen ?? "").slice(0, 10)}`;
export async function fastPathCounter(db, rows, cap, ownLane = isOwnLane) {
  const counts = new Map();
  if (cap > 0) {
    const days = [...new Set(rows.filter((r) => cappable(r, ownLane) && r.first_seen).map((r) => String(r.first_seen).slice(0, 10)))];
    for (const day of days) {
      for (const [k, n] of await fastPathCounts(db, day, ownLane)) counts.set(`${k}\u0000${day}`, n);
    }
  }
  return {
    capped: (r) => cap > 0 && cappable(r, ownLane) && (counts.get(fastKey(r)) || 0) >= cap,
    add: (r) => { if (cap > 0 && cappable(r, ownLane)) counts.set(fastKey(r), (counts.get(fastKey(r)) || 0) + 1); },
  };
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
  const day = utcDayStart(now);
  for (const t of TABLES) {
    if (left <= 0) break;
    const queued = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE state IN ('pending','claimed') AND NOT ${HELD_SQL()}`).first())?.n || 0;
    let room = cfg.guard - queued;
    if (room <= 0) continue;
    // At most PER_SOURCE candidates per source in SQL, so one big seed never
    // hides every other source. Fresh rows come first, they are
    // time-sensitive: a new source's first-poll rows (seed_fresh), Legistar
    // decision rows (vote), an FPDS source's undated rows after its first poll
    // (record_fresh) and fast-path rows over the source cap (source_cap), all
    // equal; then oldest first. rescue and record_late rows come after.
    const cands = (await db.prepare(
      `SELECT id, source_key, admit, nm_first_seen, rn FROM (
         SELECT id, source_key, admit, nm_first_seen,
                ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY (admit IN ('seed_fresh','vote','record_fresh','source_cap')) DESC, nm_first_seen, id) AS rn
           FROM ${t.table} WHERE state = 'pending' AND ${HELD_SQL()} ${t.scope})
        WHERE rn <= ?1 ORDER BY (admit IN ('seed_fresh','vote','record_fresh','source_cap')) DESC, nm_first_seen, id LIMIT 500`,
    ).bind(cfg.per_source).all()).results || [];
    const pick = [];
    for (const c of cands) {
      if (left <= 0 || room <= 0) break;
      const u = used.get(c.source_key) || 0;
      if (u >= cfg.per_source) continue;
      pick.push(c);
      used.set(c.source_key, u + 1);
      left--;
      room--;
    }
    // The reads above can be stale: two overlapping cron runs both see the
    // same budget left. So each row is released by its own UPDATE whose WHERE
    // re-counts today's released rows, in total and for that row's source,
    // inside the same statement. A D1 statement is atomic, D1 runs statements
    // one at a time, and a batch runs its statements in order in one
    // transaction, each seeing the writes before it; so however two runs
    // interleave, no UPDATE can take the day past TOTAL or a source past
    // PER_SOURCE. (A meta lease only narrows the race: a run slower than its
    // lease still overlaps the next.) Released rows count whether or not
    // admit is still set (a mute clears it), as in releasedToday.
    if (pick.length) {
      const res = await db.batch(pick.map((c) => db.prepare(
        `UPDATE ${t.table} SET released_at = ?2 WHERE id = ?3 AND source_key = ?4 AND state = 'pending' AND released_at IS NULL
           AND (SELECT COUNT(*) < ?5 AND TOTAL(source_key = ?4) < ?6 FROM (${RELEASED_SINCE}))`,
      ).bind(day, at, c.id, c.source_key, cfg.total, cfg.per_source)));
      for (const r of res) released[t.kind] += r.meta?.changes || 0;
    }
  }
  // Re-read: an overlapping run may have released rows since the first read.
  const usedToday = [...(await releasedToday(db, now)).values()].reduce((a, b) => a + b, 0);
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
// who (phase 1): lib.js whoFor, for the audit row written after a rescue that
// held at least one row (never on a dry run). Its ids are the rows the guarded
// UPDATE targeted, split by kind; held is the confirmed count.
export async function rescueSkipped(env, body, { now = Date.now(), who } = {}) {
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
            EXISTS (SELECT 1 FROM aux_items t WHERE t.nm_rowid = i.nm_rowid) AS has_aux, i.ticker
       FROM items i WHERE ${dated} AND i.ticker IN ${IN_UNIVERSE} LIMIT 5000`,
  ).bind(reasonsJson, p.since, p.until).all()).results || []).filter((r) => want(r.source_key));
  const aux = p.kind === "coverage" ? [] : ((await db.prepare(
    `SELECT ${COLS}, EXISTS (SELECT 1 FROM items t WHERE t.source_key = i.source_key AND t.url = i.url AND t.nm_rowid = i.nm_rowid AND t.state != 'skipped') AS twin_shown,
            i.entity_key
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
  // Phase 2 (story.js): a pick with a live exact copy (a row of the same table,
  // not skipped, sharing its story or URL key, a held row or a forced copy
  // included) first seen within STORY_WINDOW_DAYS either side is dropped and
  // counted as has_live_copy: the story is already in the queue. One
  // findCanonicals statement per table.
  const hasLiveCopy = { coverage: 0, aux: 0 };
  const windowMs = STORY_WINDOW_DAYS * 86_400_000;
  const unique = [];
  for (const kind of ["coverage", "aux"]) {
    const mine = picks.filter((r) => r.kind === kind);
    for (const r of mine) r.keys = await storyKeys(r, kind);
    const times = mine.map((r) => Date.parse(r.nm_first_seen)).filter(Number.isFinite);
    const live = times.length ? await findCanonicals(db, kind, { storyKeys: mine.map((r) => r.keys.story_key), urlKeys: mine.map((r) => r.keys.url_key),
      since: nowIso(Math.min(...times) - windowMs), anyCopy: true }) : [];
    for (const r of mine) {
      const t = Date.parse(r.nm_first_seen);
      const copy = live.some((c) => c.id !== r.id && c.nm_rowid !== r.nm_rowid && sharesKey(r.keys, c) && Math.abs(Date.parse(c.nm_first_seen) - t) <= windowMs);
      if (copy) hasLiveCopy[kind]++;
      else unique.push(r);
    }
  }
  picks.splice(0, picks.length, ...unique);
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
    // One statement per row (phase 2), so each re-pended row gets its story keys in the same UPDATE.
    for (const [kind, table] of [["coverage", "items"], ["aux", "aux_items"]]) {
      for (const part of chunk(take.filter((r) => r.kind === kind))) {
        const res = await db.batch(part.map((r) => db.prepare(
          `UPDATE ${table} SET state = 'pending', skip_reason = NULL, attempts = 0, claim_id = NULL, claimed_until = NULL, admit = 'rescue', released_at = NULL,
                  story_key = ?2${kind === "aux" ? ", url_key = ?3" : ""}
            WHERE id = ?1 AND state = 'skipped'`,
        ).bind(r.id, r.keys.story_key, ...(kind === "aux" ? [r.keys.url_key] : []))));
        held[kind] += res.reduce((k, x) => k + (x.meta?.changes || 0), 0);
      }
    }
    if (held.coverage + held.aux > 0) {
      const idsOf = (kind) => take.filter((r) => r.kind === kind).map((r) => r.id);
      await audit(db, who, { action: "rescue", target_kind: "items", target_id: "rescue",
        after: { since: p.since, until: p.untilDay, kind: p.kind, fit: p.fit, limit: p.limit, held: { ...held }, ids: { coverage: idsOf("coverage"), aux: idsOf("aux") } } });
    }
  }
  const cfg = budgetSettings(env);
  const used = [...(await releasedToday(db, now)).values()].reduce((a, b) => a + b, 0);
  return {
    mode: "rescue", since: p.since, until: p.untilDay, reasons: p.reasons, kind: p.kind, fit: p.fit, limit: p.limit,
    matched: fitting.length, excluded_by_fit: excluded, held, remaining: fitting.length - take.length, no_aux_copy: noAuxCopy, has_live_copy: hasLiveCopy,
    budget_left_today: Math.max(0, cfg.total - used), dry_run: p.dryRun,
    items: take.slice(0, 200).map((r) => ({ kind: r.kind, id: r.id, source_key: r.source_key, published: r.published, title: r.title, was: r.skip_reason, fit: r.fit })),
  };
}

// --- Phase 2: story copies back into the queue (story.js) ----------------------
const STORY_TABLES = [["coverage", "items"], ["aux", "aux_items"]];
const DAY_MS = 86_400_000;
// The copy's held re-pend: pending, admit 'rescue' (second tier, oldest first),
// guarded so a row that moved meanwhile is left alone.
const REPEND_COPY = `state = 'pending', skip_reason = NULL, admit = 'rescue', released_at = NULL, attempts = 0, claim_id = NULL, claimed_until = NULL`;
const COPY_GUARD = "state = 'skipped' AND skip_reason = 'story_dup'";

// The cron tick that runs storyOrphans: the */5 tick at 00:00-00:04 UTC, once
// a day, with no meta read.
export const isStoryOrphanTick = (scheduledTime) => {
  const d = new Date(scheduledTime);
  return Number.isFinite(d.getTime()) && d.getUTCHours() === 0 && d.getUTCMinutes() < 5;
};

// Copies (first seen in the last STORY_WINDOW_DAYS days) whose canonical left
// the queue (skipped for any reason but story_dup: muted, parked, failed
// grading) or does not exist (story_of NULL after an ignored INSERT, or
// dangling), at most 50 a table, on the skipped index. Per group (one
// canonical, or one key when story_of is NULL): copies of muted sources are
// passed over; the earliest other copy becomes a held admit 'rescue' row
// (story_of NULL, its keys kept), released only by releaseHeld under the
// budget, and the group's other copies point to it. A group whose copies are
// all from muted sources does not move. One audit row when anything moved.
export const ORPHAN_LIMIT = 50;
export async function storyOrphans(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const muted = await mutedSources(db);
  const since = nowIso(now - STORY_WINDOW_DAYS * DAY_MS);
  const promoted = { coverage: [], aux: [] };
  const repointed = { coverage: 0, aux: 0 };
  const seen = { coverage: 0, aux: 0 };
  for (const [kind, t] of STORY_TABLES) {
    const rows = (await db.prepare(
      `SELECT d.id, d.story_of, d.story_key, d.source_key, d.nm_first_seen FROM ${t} d LEFT JOIN ${t} c ON c.id = d.story_of
        WHERE d.state = 'skipped' AND d.skip_reason = 'story_dup' AND d.nm_first_seen >= ?1
          AND (c.id IS NULL OR (c.state = 'skipped' AND c.skip_reason != 'story_dup'))
        ORDER BY d.nm_first_seen LIMIT ${ORPHAN_LIMIT}`,
    ).bind(since).all()).results || [];
    seen[kind] = rows.length;
    const groups = new Map();
    for (const r of rows) {
      const g = r.story_of != null ? `of:${r.story_of}` : r.story_key != null ? `key:${r.story_key}` : `id:${r.id}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    for (const group of groups.values()) {
      const pick = group.find((r) => !muted.has(r.source_key));
      if (!pick) continue;
      const res = await db.prepare(`UPDATE ${t} SET ${REPEND_COPY}, story_of = NULL WHERE id = ?1 AND ${COPY_GUARD}`).bind(pick.id).run();
      if (!(res.meta?.changes > 0)) continue;
      promoted[kind].push(pick.id);
      // A group with a canonical: every copy of it, also past the 50 read here (story_of index).
      const others = pick.story_of != null
        ? await db.prepare(`UPDATE ${t} SET story_of = ?1 WHERE story_of = ?2 AND id != ?1 AND ${COPY_GUARD}`).bind(pick.id, pick.story_of).run()
        : group.length > 1
          ? await db.prepare(`UPDATE ${t} SET story_of = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND ${COPY_GUARD}`)
            .bind(pick.id, JSON.stringify(group.filter((r) => r.id !== pick.id).map((r) => r.id))).run()
          : null;
      repointed[kind] += others?.meta?.changes || 0;
    }
  }
  const moved = promoted.coverage.length + promoted.aux.length;
  if (moved > 0) {
    await audit(db, { actor: "cron", via: "cron", request_id: null }, { action: "rescue", target_kind: "items", target_id: "story_orphan",
      after: { mode: "story_orphan", ids: { coverage: promoted.coverage, aux: promoted.aux }, repointed: { ...repointed } } });
  }
  return { orphans: seen, promoted: { coverage: promoted.coverage.length, aux: promoted.aux.length }, repointed };
}

// POST /v1/admin/requeue { mode: "story_release", since, kind, limit, dry_run }:
// the rollback path. story_dup copies first seen since `since` (YYYY-MM-DD),
// oldest first, muted sources skipped, become held admit 'rescue' rows,
// released by releaseHeld under the budget. story_of is kept as history, so a
// released copy is never a canonical. Coverage copies only of today's
// universe (the rows releaseHeld can release). At most limit (1-300, default
// 60) rows a call, Coverage first. One audit row (action rescue, mode
// story_release) when a row moved; never on a dry run.
export async function storyRelease(env, body, { now = Date.now(), who } = {}) {
  const b = body && typeof body === "object" ? body : {};
  if (!validDay(b.since)) return { mode: "story_release", error: "since is required, as YYYY-MM-DD" };
  const kind = b.kind == null ? "both" : b.kind;
  if (!["coverage", "aux", "both"].includes(kind)) return { mode: "story_release", error: "kind must be coverage, aux or both" };
  const n = Math.trunc(Number(b.limit));
  const limit = b.limit == null || !Number.isFinite(n) ? RESCUE_DEFAULT_LIMIT : Math.max(1, Math.min(RESCUE_MAX_LIMIT, n));
  const dryRun = Boolean(b.dry_run);
  const db = env.DB;
  const muted = await mutedSources(db);
  const since = `${b.since}T00:00:00.000Z`;
  const take = [];
  let matched = 0, mutedSkipped = 0;
  for (const [k, t] of STORY_TABLES) {
    if (kind !== "both" && kind !== k) continue;
    const rows = (await db.prepare(
      `SELECT id, source_key, nm_first_seen, story_of FROM ${t} WHERE state = 'skipped' AND skip_reason = 'story_dup' AND nm_first_seen >= ?1
          ${k === "coverage" ? `AND ticker IN ${IN_UNIVERSE}` : ""}
        ORDER BY nm_first_seen, id LIMIT 1000`,
    ).bind(since).all()).results || [];
    for (const r of rows) {
      if (muted.has(r.source_key)) { mutedSkipped++; continue; }
      matched++;
      if (take.length < limit) take.push({ kind: k, ...r });
    }
  }
  const released = { coverage: 0, aux: 0 };
  if (dryRun) {
    for (const r of take) released[r.kind]++;
  } else {
    for (const [k, t] of STORY_TABLES) {
      for (const part of chunk(take.filter((r) => r.kind === k))) {
        const res = await db.batch(part.map((r) => db.prepare(`UPDATE ${t} SET ${REPEND_COPY} WHERE id = ?1 AND ${COPY_GUARD}`).bind(r.id)));
        released[k] += res.reduce((a, x) => a + (x.meta?.changes || 0), 0);
      }
    }
    if (released.coverage + released.aux > 0) {
      const idsOf = (k) => take.filter((r) => r.kind === k).map((r) => r.id);
      await audit(db, who, { action: "rescue", target_kind: "items", target_id: "story_release",
        after: { mode: "story_release", since: b.since, kind, limit, held: { ...released }, ids: { coverage: idsOf("coverage"), aux: idsOf("aux") } } });
    }
  }
  const cfg = budgetSettings(env);
  const used = [...(await releasedToday(db, now)).values()].reduce((a, c) => a + c, 0);
  return {
    mode: "story_release", since: b.since, kind, limit, matched, muted_skipped: mutedSkipped, held: released, remaining: matched - take.length,
    budget_left_today: Math.max(0, cfg.total - used), dry_run: dryRun,
    items: take.slice(0, 200).map((r) => ({ kind: r.kind, id: r.id, source_key: r.source_key, first_seen: r.nm_first_seen, copy_of: r.story_of })),
  };
}
