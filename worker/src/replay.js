// Golden-set replay (phase 2, migration 0018): grade a frozen set of test items
// under a rubric version, in the routine's idle runs only, and judge the
// result before a rubric change goes live. Golden expectations live only in
// zenith-db (golden_items.expect), loaded by admin; this public repo holds the
// mechanism, never the set.
//   grader: POST /v1/replay/claim {limit, run_id, local: {live, candidate}}
//           POST /v1/replay/grades {claim_id, run_id, rubric_version, model, grades}
//   app   : GET /v1/replay (counts and a verdict only; admin also gets the
//           reasons and, with ?detail=1, every pair)
//   admin : POST /v1/admin/replay {action: "arm" | "abort", ...}
//           POST /v1/admin/golden {items, replace?, dry_run?}
// A replay never writes items, grades, aux_grades, expansion_candidates or runs,
// never uses the daily grading budget (budget.js) and makes no fetch. Its own
// caps: REPLAY_DAILY grades a UTC day (secret override; 0 stops every replay
// claim), REPLAY_WEEKLY in any 7 days, REPLAY_BATCH a claim, and a claim only
// in a run whose coverage claim took nothing, while no live coverage row is
// claimable and the aux queue is under REPLAY_AUX_GUARD.
import COVERED from "./covered.json";
import { RUBRIC_VERSION, CORE, INDUSTRY, MATCH, CANDIDATE_VERSION, CANDIDATE_FLOORS, CANDIDATE_INDUSTRY, CANDIDATE_SCOPE } from "./rubric.generated.js";
import { json, nowIso, normalizeGrade, parseItemRef, parseFloors, sightingAgeDays, phraseRegex, LEASE_MINUTES, MAX_ATTEMPTS, HELD_SQL, chunk, audit } from "./lib.js";
import { coverageClaimableSql } from "./claimable.js";
import { HOLD_MINUTES } from "./bill-lines.js";
import { WARGOV_HOLD_MINUTES } from "./wargov.js";
import { isBlockPage } from "./excerpt.js";
import { isOfficialRecord } from "./records.js";

export const REPLAY_BATCH = 10;
export const REPLAY_DAILY = 20;
export const REPLAY_WEEKLY = 100;
export const REPLAY_AUX_GUARD = 30;
export const GOLDEN_MAX = 64;
export const REPLAY_ITERATIONS = 3;
export const REPLAY_KEEP = 20;
export const GUARD_CEILING = 39;
// R3b, R5, R6 tolerances (see verdict()).
export const REPORT_MISSES = 2;
export const ANCHOR_MISSES_MIN = 3;
export const ANCHOR_SLACK = 2;
export const ANCHOR_MAX_GAP = 20;
export const REGRESSIONS_MAX = 3;
export const NOISE_POINTS = 7;

const CLASSES = ["anchor", "recall", "ladder", "holdout", "guard"];
const BASES = ["core11", "sheet", "rule", "auditor", "owner"];
const FIRST_SEEN_RULES = ["published_plus_1h", "real"];
const SCOPES = ["full", "sheets", "guards", "retry"];
const FINISHED = ["done", "passed", "failed", "aborted"];
const DAY = 86_400_000;
const LIVE_FLOORS = parseFloors(CORE);

// The caps in force: the constants, or the REPLAY_DAILY / REPLAY_WEEKLY secrets
// (whole numbers 0-1000; 0 stops every replay claim).
export function replaySettings(env = {}) {
  const read = (v, dflt) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isInteger(n) && n >= 0 && n <= 1000 ? n : dflt;
  };
  return { daily: read(env.REPLAY_DAILY, REPLAY_DAILY), weekly: read(env.REPLAY_WEEKLY, REPLAY_WEEKLY), batch: REPLAY_BATCH };
}

// The bundled versions and validation inputs: live for a baseline, the
// candidate overlay for a candidate (null when no candidate is bundled).
// `bundle` is for tests.
export function bundleFor(kind, bundle = BUNDLE) {
  if (kind === "candidate") {
    return bundle.candidate.version ? { version: bundle.candidate.version, floors: bundle.candidate.floors || {}, industry: bundle.candidate.industry || {} } : null;
  }
  return { version: bundle.live.version, floors: bundle.live.floors, industry: bundle.live.industry || {} };
}
const BUNDLE = {
  live: { version: RUBRIC_VERSION, floors: LIVE_FLOORS, industry: INDUSTRY },
  candidate: { version: CANDIDATE_VERSION, floors: CANDIDATE_FLOORS, industry: CANDIDATE_INDUSTRY, scope: CANDIDATE_SCOPE },
};

const parse = (s, dflt) => { try { return s == null ? dflt : JSON.parse(s); } catch { return dflt; } };
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
const utcMidnight = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

// The armed replay, or null. An armed replay whose version is no longer
// bundled (the live rubric or the candidate moved) is aborted here, so a stale
// replay never goes on.
export async function armedReplay(db, { now = Date.now(), bundle = BUNDLE } = {}) {
  const r = await db.prepare("SELECT * FROM replays WHERE status = 'armed' ORDER BY armed_at DESC LIMIT 1").first();
  if (!r) return null;
  const b = bundleFor(r.kind, bundle);
  if (b && b.version === r.rubric_version) return r;
  await db.prepare("UPDATE replays SET status = 'aborted', finished_at = ?, summary = ? WHERE id = ? AND status = 'armed'")
    .bind(nowIso(now), JSON.stringify({ verdict: "aborted", reason: "rubric_version_not_bundled" }), r.id).run();
  return null;
}

// Grades counted toward the caps since `since`: distinct (replay, item, pass).
async function gradedSince(db, since) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT replay_id, golden_id, pass FROM replay_grades WHERE graded_at >= ?)").bind(since).first();
  return r?.n || 0;
}

// The claimed fields of a golden item, as the coverage claim prints them;
// never expect, class, basis, code, ref, note, first_seen_rule or pass.
function claimItem(g) {
  return {
    item_id: g.id, ticker: g.ticker, source_key: g.source_key, role: g.role ?? null, affects: g.affects ?? null,
    title: g.title, url: g.url ?? null, published: g.published ?? null, first_seen: g.first_seen,
    seen_after_days: sightingAgeDays(g.published, g.first_seen), admit: g.admit ?? null,
    record: isOfficialRecord({ source_key: g.source_key, url: g.url }), excerpt: g.excerpt ?? null, excerpt_status: g.excerpt_status ?? null,
  };
}

// POST /v1/replay/claim. Returns {items: [], reason} (HTTP 200) on the first
// rule that holds, else up to min(limit, REPLAY_BATCH, caps left) queue rows.
export async function replayClaim(env, body, { now = Date.now(), bundle = BUNDLE } = {}) {
  const db = env.DB;
  const empty = (reason, extra = {}) => ({ items: [], reason, ...extra });
  const replay = await armedReplay(db, { now, bundle });
  if (!replay) return empty("none_armed");
  const b = bundleFor(replay.kind, bundle);
  const local = body?.local && typeof body.local === "object" ? body.local : {};
  const localVersion = replay.kind === "candidate" ? local.candidate : local.live;
  if (localVersion !== b.version) return empty("checkout_mismatch", { rubric_version: replay.rubric_version, kind: replay.kind });
  // The coverage claim always writes its runs row (index.js claim), so a
  // missing row means the run did not claim coverage first.
  const runId = String(body?.run_id || "").slice(0, 80);
  const run = runId ? await db.prepare("SELECT claimed FROM runs WHERE id = ?").bind(runId).first() : null;
  if (!run || Number(run.claimed) > 0) return empty("busy_run");
  const nowS = nowIso(now);
  const live = await db.prepare(`SELECT 1 AS x FROM items WHERE ${coverageClaimableSql("?1", "?2")} LIMIT 1`)
    .bind(nowS, nowIso(now - HOLD_MINUTES * 60_000)).first();
  if (live) return empty("live_coverage");
  // The aux claim's own predicate (auxiliary.js auxClaim), counted up to the guard.
  const aux = await db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM aux_items i WHERE (i.state='pending' OR (i.state='claimed' AND i.claimed_until < ?1))
        AND NOT ${HELD_SQL("i.")} AND NOT (i.source_key = 'wargov_contracts' AND i.excerpt_status IS NULL AND i.nm_first_seen > ?2) LIMIT ?3)`,
  ).bind(nowS, nowIso(now - WARGOV_HOLD_MINUTES * 60_000), REPLAY_AUX_GUARD).first();
  if ((aux?.n || 0) >= REPLAY_AUX_GUARD) return empty("live_aux");
  const caps = replaySettings(env);
  // Rows leased and not yet graded count against the caps too.
  const leased = (await db.prepare("SELECT COUNT(*) AS n FROM replay_queue WHERE replay_id = ? AND state = 'claimed' AND claimed_until >= ?").bind(replay.id, nowS).first())?.n || 0;
  const today = await gradedSince(db, nowIso(utcMidnight(now)));
  if (today + leased >= caps.daily) return empty("daily_cap");
  const week = await gradedSince(db, nowIso(now - 7 * DAY));
  if (week + leased >= caps.weekly) return empty("weekly_cap");
  const limit = Math.max(1, Math.min(Math.trunc(Number(body?.limit)) || REPLAY_BATCH, REPLAY_BATCH, caps.daily - today - leased, caps.weekly - week - leased));
  // Rows that ran out of attempts are failed (a miss, R1).
  await db.prepare(
    `UPDATE replay_queue SET state = 'failed' WHERE replay_id = ?1 AND state IN ('pending','claimed') AND attempts >= ?2
       AND (claimed_until IS NULL OR claimed_until < ?3)`,
  ).bind(replay.id, MAX_ATTEMPTS, nowS).run();
  const claimId = crypto.randomUUID();
  const until = nowIso(now + LEASE_MINUTES * 60_000);
  // One statement, as the coverage claim: the outer WHERE re-checks the state.
  // Ordered by ticker, so a batch reads few sheets.
  await db.prepare(
    `UPDATE replay_queue SET state = 'claimed', claim_id = ?1, claimed_until = ?2, attempts = attempts + 1
      WHERE rowid IN (SELECT q.rowid FROM replay_queue q JOIN golden_items g ON g.id = q.golden_id
                       WHERE q.replay_id = ?3 AND (q.state = 'pending' OR (q.state = 'claimed' AND q.claimed_until < ?4)) AND q.attempts < ?5
                       ORDER BY g.ticker, g.id, q.pass LIMIT ?6)
        AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?4))`,
  ).bind(claimId, until, replay.id, nowS, MAX_ATTEMPTS, limit).run();
  const rows = (await db.prepare(
    `SELECT g.* FROM replay_queue q JOIN golden_items g ON g.id = q.golden_id WHERE q.replay_id = ? AND q.claim_id = ? ORDER BY g.ticker, g.id`,
  ).bind(replay.id, claimId).all()).results || [];
  const left = (await db.prepare("SELECT COUNT(*) AS n FROM replay_queue WHERE replay_id = ? AND state IN ('pending','claimed')").bind(replay.id).first())?.n || 0;
  if (!rows.length) {
    if (!left) await finish(env, replay, { now });
    return empty(left ? "nothing_claimable" : "replay_finished");
  }
  return { claim_id: claimId, replay_id: replay.id, rubric_version: replay.rubric_version, kind: replay.kind, lease_minutes: LEASE_MINUTES,
    items: rows.map(claimItem), remaining: Math.max(0, left - rows.length) };
}

// POST /v1/replay/grades. Validates with normalizeGrade against the replay's
// floors and industry_links, stores into replay_grades only, idempotently.
export async function replaySubmit(env, body, role, { now = Date.now(), bundle = BUNDLE } = {}) {
  const db = env.DB;
  if (!body || !Array.isArray(body.grades)) return json({ error: "body.grades must be an array" }, 400);
  if (body.grades.length > REPLAY_BATCH * 8) return json({ error: "too many grades in one request" }, 400);
  const replay = await armedReplay(db, { now, bundle });
  if (!replay) return json({ error: "no replay is armed" }, 409);
  if (String(body.rubric_version || "") !== replay.rubric_version) {
    return json({ error: `rubric_version ${String(body.rubric_version || "").slice(0, 40) || "(none)"} is not the armed replay's ${replay.rubric_version}: nothing stored` }, 400);
  }
  const claimId = body.claim_id ? String(body.claim_id) : "";
  if (!claimId) return json({ error: "claim_id is required" }, 400);
  const b = bundleFor(replay.kind, bundle);
  const rows = new Map();
  for (const r of (await db.prepare(
    `SELECT q.pass, q.state AS q_state, g.* FROM replay_queue q JOIN golden_items g ON g.id = q.golden_id WHERE q.replay_id = ? AND q.claim_id = ?`,
  ).bind(replay.id, claimId).all()).results || []) rows.set(r.id, r);
  const runId = String(body.run_id || "").slice(0, 80) || null;
  const model = String(body.model || "").slice(0, 60) || null;
  const at = nowIso(now);
  const accepted = [], rejected = [], stmts = [], seen = new Set(), done = new Set();
  for (const raw of body.grades) {
    const ref = parseItemRef(raw?.item_id);
    const row = ref ? rows.get(ref.id) : undefined;
    if (!row) { rejected.push({ item_id: raw?.item_id ?? null, error: `item ${ref?.id ?? "?"} is not in claim ${claimId}; grade only items from your replay claim` }); continue; }
    const item = { id: row.id, ticker: row.ticker, title: row.title, excerpt: row.excerpt, source_key: row.source_key, url: row.url, published: row.published, first_seen: row.first_seen };
    const res = normalizeGrade(raw, item, ref.alsoTicker || null, COVERED.tickers, b.floors, { industry: b.industry });
    if (!res.ok) { rejected.push({ item_id: raw.item_id, error: res.error }); continue; }
    const g = res.grade;
    const key = `${row.id}|${g.ticker}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO replay_grades (replay_id, golden_id, ticker, pass, run_id, model, score, band, rung, event_type, flags, why, confidence, read_source, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(replay.id, row.id, g.ticker, row.pass, runId, model, g.score, g.band, g.rung, g.event_type, g.flags, g.why, g.confidence, g.read_source, at));
    if (g.primary && row.q_state === "claimed" && !done.has(row.id)) {
      done.add(row.id);
      stmts.push(db.prepare("UPDATE replay_queue SET state = 'graded' WHERE replay_id = ? AND golden_id = ? AND pass = ? AND claim_id = ? AND state = 'claimed'")
        .bind(replay.id, row.id, row.pass, claimId));
    }
    accepted.push({ item_id: raw.item_id, ticker: g.ticker, score: g.score, band: g.band });
  }
  if (done.size) stmts.push(db.prepare("UPDATE replays SET n_graded = n_graded + ? WHERE id = ?").bind(done.size, replay.id));
  // All-or-nothing, as the live submit: a retry after a failure is safe.
  if (stmts.length) await db.batch(stmts);
  const after = await afterGrades(env, replay, { now });
  const missing = [...rows.values()].filter((r) => r.q_state === "claimed" && !done.has(r.id)).map((r) => r.id);
  return json({ accepted: accepted.length, rejected, results: accepted, not_yet_graded: missing, ...after });
}

// --- Verdict -----------------------------------------------------------------------
// One pair per golden item and expected ticker. pairs(): the pair results of a
// replay from its golden rows, queue rows and grades.
const pairLabel = (code, ticker, own) => (own ? code : `${code}#${ticker}`);
function expectOf(g) {
  const e = parse(g.expect, {});
  return e && typeof e === "object" && !Array.isArray(e) ? e : {};
}
function judge(exp, grade) {
  if (exp === "duplicate") return { hit: grade?.band === "duplicate", gap: grade?.band === "duplicate" ? 0 : Infinity };
  const [lo, hi] = Array.isArray(exp) ? exp : [null, null];
  const s = grade?.score;
  if (s == null) return { hit: false, gap: Infinity };
  const gap = lo != null && s < lo ? lo - s : hi != null && s > hi ? s - hi : 0;
  return { hit: gap === 0, gap };
}
export function pairs(golden, queue, grades) {
  const gradeOf = new Map(grades.map((r) => [`${r.golden_id}|${r.ticker}|${r.pass}`, r]));
  // A pass-1 row that ran out of attempts is a miss on every pair (R1); a
  // failed confirm (pass 2) leaves the pass-1 result standing.
  const failed = new Set(queue.filter((q) => q.state === "failed" && q.pass === 1).map((q) => q.golden_id));
  const out = [];
  for (const g of golden) {
    for (const [ticker, exp] of Object.entries(expectOf(g))) {
      const own = ticker === g.ticker;
      const hi = Array.isArray(exp) ? exp[1] : null;
      const p1 = gradeOf.get(`${g.id}|${ticker}|1`) || null;
      const p2 = gradeOf.get(`${g.id}|${ticker}|2`) || null;
      const base = { code: g.code, class: g.class, basis: g.basis, ticker, own, label: pairLabel(g.code, ticker, own), golden_id: g.id,
        lo: Array.isArray(exp) ? exp[0] : null, hi, duplicate: exp === "duplicate", p1: p1?.score ?? null, p2: p2?.score ?? null, graded: Boolean(p1) };
      if (failed.has(g.id)) { out.push({ ...base, failed: true, hit: false, gap: Infinity, score: null, first_hit: false }); continue; }
      if (!p1) {
        // A missing #TICKER grade is a hit when the expectation is out of scope
        // (hi <= 39): the grader correctly sent no grade for that ticker.
        const outOfScope = !own && hi != null && hi <= GUARD_CEILING;
        out.push({ ...base, hit: outOfScope, gap: outOfScope ? 0 : Infinity, score: null, first_hit: outOfScope });
        continue;
      }
      const first = judge(exp, p1);
      if (first.hit || !p2) { out.push({ ...base, ...first, score: p1.score, first_hit: first.hit }); continue; }
      // The confirm re-grade: the rounded mean of the two (the median of two).
      let pairGrade;
      if (exp === "duplicate" || p1.score == null || p2.score == null) pairGrade = p2;
      else pairGrade = { score: Math.round((p1.score + p2.score) / 2), band: p2.band };
      out.push({ ...base, ...judge(exp, pairGrade), score: pairGrade.score ?? null, first_hit: false });
    }
  }
  return out;
}

// The verdict of a finished replay. reference: { anchor_misses, hit_pairs } of
// the reference replay's summary, or null. targets: codes. live: [{label, delta}].
export function verdict(replay, list, { reference = null, extra = [], live = [] } = {}) {
  const targets = parse(replay.targets, []);
  const isTarget = (p) => p.own && targets.includes(p.code);
  const sentinel = (p) => p.basis === "sheet";
  const reasons = [];
  const by_class = {};
  for (const c of CLASSES) by_class[c] = { n: 0, hits: 0 };
  for (const p of list) { by_class[p.class].n += 1; if (p.hit) by_class[p.class].hits += 1; }
  const misses = list.filter((p) => !p.hit).map((p) => p.label);
  const hitPairs = list.filter((p) => p.hit).map((p) => p.label);
  const anchorMisses = list.filter((p) => p.class === "anchor" && !p.hit);
  // R1 complete: every pair that expects a grade (hi >= 40 or open) has one.
  // The item's own ticker always needs a grade; a failed queue row is a miss.
  const incomplete = list.filter((p) => p.failed || ((p.own || p.hi == null || p.hi >= 40) && !p.graded));
  if (incomplete.length) reasons.push(`R1 incomplete: ${incomplete.map((p) => p.label).join(", ")}`);
  // R2 guards: at most the hard rule's ceiling.
  const guards = list.filter((p) => p.class === "guard" && (!p.hit || (p.score != null && p.score > GUARD_CEILING)));
  if (guards.length) reasons.push(`R2 guards: ${guards.map((p) => p.label).join(", ")}`);
  // R3 targets.
  const targetHits = {};
  for (const code of targets) targetHits[code] = list.some((p) => p.code === code && p.own && p.hit);
  const missedTargets = targets.filter((c) => !targetHits[c]);
  if (missedTargets.length) reasons.push(`R3 targets: ${missedTargets.join(", ")}`);
  // R3b report set: ladder and holdout pairs that are not targets or sentinels.
  const report = list.filter((p) => (p.class === "ladder" || p.class === "holdout") && !isTarget(p) && !sentinel(p) && !p.hit);
  if (report.length > REPORT_MISSES) reasons.push(`R3b report misses ${report.length} > ${REPORT_MISSES}: ${report.map((p) => p.label).join(", ")}`);
  // R4 owner-line sentinels.
  const sentinels = list.filter((p) => sentinel(p) && !p.hit);
  if (sentinels.length) reasons.push(`R4 sentinels: ${sentinels.map((p) => p.label).join(", ")}`);
  // R5 anchors, judged against the reference.
  const allowed = Math.max(ANCHOR_MISSES_MIN, (reference?.anchor_misses ?? 0) + ANCHOR_SLACK);
  if (anchorMisses.length > allowed) reasons.push(`R5 anchor misses ${anchorMisses.length} > ${allowed}`);
  const far = anchorMisses.filter((p) => p.gap > ANCHOR_MAX_GAP);
  if (far.length) reasons.push(`R5 anchors more than ${ANCHOR_MAX_GAP} points off: ${far.map((p) => p.label).join(", ")}`);
  // R6 regressions: pairs that hit in the reference and miss now (targets excluded).
  const refHits = new Set(reference?.hit_pairs || []);
  const regressions = list.filter((p) => !p.hit && !isTarget(p) && refHits.has(p.label)).map((p) => p.label);
  if (regressions.length > REGRESSIONS_MAX) reasons.push(`R6 regressions ${regressions.length} > ${REGRESSIONS_MAX}: ${regressions.join(", ")}`);
  // R7 (report only): live agreement and the pass-1/pass-2 spread.
  const spread = list.filter((p) => p.p1 != null && p.p2 != null).map((p) => ({ pair: p.label, delta: Math.abs(p.p1 - p.p2) }));
  const deltas = [...live.map((x) => x.delta), ...spread.map((x) => x.delta)];
  const warn = deltas.length && deltas.filter((d) => d > NOISE_POINTS).length * 3 > deltas.length ? "noise" : null;
  const v = replay.kind === "baseline" ? "done" : reasons.length ? "failed" : "passed";
  return {
    verdict: v, reasons: replay.kind === "baseline" ? [] : reasons, by_class, misses, regressions, targets: targetHits, extra,
    hit_pairs: hitPairs, anchor_misses: anchorMisses.length, live_agreement: { live, confirm: spread }, warn,
  };
}

async function replayRows(db, replayId) {
  const queue = (await db.prepare("SELECT golden_id, pass, state FROM replay_queue WHERE replay_id = ?").bind(replayId).all()).results || [];
  const ids = [...new Set(queue.map((q) => q.golden_id))];
  const golden = [];
  for (const part of chunk(ids)) {
    golden.push(...((await db.prepare(`SELECT * FROM golden_items WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all()).results || []));
  }
  const grades = (await db.prepare("SELECT golden_id, ticker, pass, score, band FROM replay_grades WHERE replay_id = ?").bind(replayId).all()).results || [];
  golden.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.id - b.id));
  return { queue, golden, grades };
}

// After a submit: one confirm re-grade (pass 2) for each pass-1 item with a
// missed pair, then the verdict once nothing is pending or claimed.
async function afterGrades(env, replay, { now }) {
  const db = env.DB;
  const { queue, golden, grades } = await replayRows(db, replay.id);
  const list = pairs(golden, queue, grades);
  const hasPass2 = new Set(queue.filter((q) => q.pass === 2).map((q) => q.golden_id));
  const graded1 = new Set(queue.filter((q) => q.pass === 1 && q.state === "graded").map((q) => q.golden_id));
  const confirm = [...new Set(list.filter((p) => !p.first_hit && graded1.has(p.golden_id) && !hasPass2.has(p.golden_id)).map((p) => p.golden_id))];
  if (confirm.length) {
    await db.batch(confirm.map((id) => db.prepare("INSERT OR IGNORE INTO replay_queue (replay_id, golden_id, pass) VALUES (?, ?, 2)").bind(replay.id, id)));
  }
  const left = (await db.prepare("SELECT COUNT(*) AS n FROM replay_queue WHERE replay_id = ? AND state IN ('pending','claimed')").bind(replay.id).first())?.n || 0;
  if (left) return { confirm_added: confirm.length, remaining: left, status: "armed" };
  const status = await finish(env, replay, { now });
  return { confirm_added: 0, remaining: 0, status };
}

// The verdict, written once: status, finished_at and summary (codes only).
async function finish(env, replay, { now }) {
  const db = env.DB;
  const { queue, golden, grades } = await replayRows(db, replay.id);
  const list = pairs(golden, queue, grades);
  const expected = new Set(golden.flatMap((g) => Object.keys(expectOf(g)).map((t) => `${g.id}|${t}`)));
  const codeOf = new Map(golden.map((g) => [g.id, g.code]));
  const extra = [...new Set(grades.filter((r) => !expected.has(`${r.golden_id}|${r.ticker}`)).map((r) => `${codeOf.get(r.golden_id)}#${r.ticker}`))].sort();
  let reference = null;
  if (replay.reference_id) {
    const ref = await db.prepare("SELECT summary FROM replays WHERE id = ?").bind(replay.reference_id).first();
    reference = parse(ref?.summary, null);
  }
  // R7: pass 1 against a live grade of the same item and ticker under the
  // replay's version (golden ref item:<id>). A SELECT only.
  const live = [];
  const refs = golden.map((g) => ({ g, m: /^item:(\d+)$/.exec(String(g.ref || "")) })).filter((x) => x.m);
  for (const part of chunk(refs)) {
    const rows = (await db.prepare(`SELECT item_id, ticker, score FROM grades WHERE rubric_version = ? AND item_id IN (${part.map(() => "?").join(",")}) ORDER BY id`)
      .bind(replay.rubric_version, ...part.map((x) => Number(x.m[1]))).all()).results || [];
    for (const { g, m } of part) {
      for (const p of list.filter((x) => x.golden_id === g.id && x.p1 != null)) {
        const l = rows.filter((r) => r.item_id === Number(m[1]) && r.ticker === p.ticker && r.score != null).pop();
        if (l) live.push({ pair: p.label, delta: Math.abs(p.p1 - l.score) });
      }
    }
  }
  const summary = verdict(replay, list, { reference, extra, live });
  const status = summary.verdict;
  await db.prepare("UPDATE replays SET status = ?, finished_at = ?, summary = ? WHERE id = ? AND status = 'armed'")
    .bind(status, nowIso(now), JSON.stringify(summary), replay.id).run();
  return status;
}

// --- Admin: arm and abort ---------------------------------------------------------------
// POST /v1/admin/replay {action: "arm", kind, scope?, targets?, reference_id?} | {action: "abort"}
export async function adminReplay(env, body, who, { now = Date.now(), bundle = BUNDLE } = {}) {
  const db = env.DB;
  const action = body?.action;
  if (action === "abort") {
    const r = await armedReplay(db, { now, bundle });
    if (!r) return json({ error: "no replay is armed" }, 409);
    await db.prepare("UPDATE replays SET status = 'aborted', finished_at = ?, summary = ? WHERE id = ? AND status = 'armed'")
      .bind(nowIso(now), JSON.stringify({ verdict: "aborted", reason: "admin_abort" }), r.id).run();
    await audit(db, who, { action: "admin_run", target_kind: "job", target_id: "replay_abort", after: { replay_id: r.id, kind: r.kind, scope: r.scope, version: r.rubric_version, n: r.n_items } });
    return json({ ok: true, replay_id: r.id, status: "aborted" });
  }
  if (action !== "arm") return json({ error: 'action must be "arm" or "abort"' }, 400);
  if (await armedReplay(db, { now, bundle })) return json({ error: "a replay is already armed; abort it first" }, 409);
  const kind = body?.kind;
  if (kind !== "baseline" && kind !== "candidate") return json({ error: 'kind must be "baseline" or "candidate"' }, 400);
  const b = bundleFor(kind, bundle);
  if (!b) return json({ error: "no candidate rubric is bundled (rubric/candidate/)" }, 400);
  let iteration = 1;
  let retryOf = null;
  if (kind === "candidate") {
    const prior = (await db.prepare("SELECT id, status, summary FROM replays WHERE kind = 'candidate' AND base_version = ? AND status != 'aborted' ORDER BY armed_at DESC")
      .bind(bundle.live.version).all()).results || [];
    if (prior.length >= REPLAY_ITERATIONS) return json({ error: `owner_review: ${prior.length} candidate replays on base ${bundle.live.version} (at most ${REPLAY_ITERATIONS}); the owner reviews before another` }, 400);
    iteration = prior.length + 1;
    retryOf = prior.find((p) => p.status === "failed" || p.status === "passed") || null;
  }
  const scope = body?.scope ?? (kind === "baseline" ? "full" : bundle.candidate.scope?.scope || "full");
  if (!SCOPES.includes(scope)) return json({ error: `scope must be one of ${SCOPES.join(", ")}` }, 400);
  if (scope === "retry" && (kind !== "candidate" || iteration < 2 || !retryOf)) return json({ error: "scope retry needs a finished candidate replay on this base (iteration 2 or later)" }, 400);
  const scopeTickers = scope === "sheets" ? splitList(body?.scope_tickers ?? bundle.candidate.scope?.tickers ?? []) : [];
  if (scope === "sheets" && !scopeTickers.length) return json({ error: "scope sheets needs scope_tickers" }, 400);
  const golden = (await db.prepare("SELECT id, code, class, basis, ticker, affects, expect FROM golden_items WHERE active = 1 ORDER BY ticker, id").all()).results || [];
  const codes = new Set(golden.map((g) => g.code));
  const targets = Array.isArray(body?.targets) ? [...new Set(body.targets.map(String))] : [];
  const unknown = targets.filter((t) => !codes.has(t));
  if (unknown.length) return json({ error: `unknown target codes: ${unknown.join(", ")}` }, 400);
  const always = (g) => g.class === "guard" || g.basis === "sheet" || targets.includes(g.code);
  let picked;
  if (scope === "full") picked = golden;
  else if (scope === "guards") picked = golden.filter(always);
  else if (scope === "sheets") {
    const meets = (g) => [g.ticker, ...splitList(g.affects), ...Object.keys(expectOf(g))].some((t) => scopeTickers.includes(t));
    picked = golden.filter((g) => always(g) || meets(g));
  } else {
    const missed = new Set((parse(retryOf.summary, {})?.misses || []).map((l) => String(l).split("#")[0]));
    picked = golden.filter((g) => always(g) || missed.has(g.code));
  }
  if (!picked.length) return json({ error: "no active golden items in this scope" }, 400);
  let referenceId = body?.reference_id ? String(body.reference_id) : null;
  if (referenceId) {
    const ok = await db.prepare("SELECT id FROM replays WHERE id = ? AND status IN ('done','passed')").bind(referenceId).first();
    if (!ok) return json({ error: `reference ${referenceId} is not a done or passed replay` }, 400);
  } else {
    const ref = await db.prepare("SELECT id FROM replays WHERE status = 'passed' ORDER BY armed_at DESC LIMIT 1").first()
      || await db.prepare("SELECT id FROM replays WHERE status = 'done' AND kind = 'baseline' ORDER BY armed_at DESC LIMIT 1").first();
    referenceId = ref?.id || null;
  }
  const id = `rp-${crypto.randomUUID()}`;
  const at = nowIso(now);
  const stmts = [db.prepare(
    `INSERT INTO replays (id, rubric_version, base_version, kind, scope, scope_tickers, iteration, status, targets, reference_id, armed_at, n_items, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'armed', ?, ?, ?, ?, ?)`,
  ).bind(id, b.version, bundle.live.version, kind, scope, JSON.stringify(scopeTickers), iteration, JSON.stringify(targets), referenceId, at, picked.length,
    retryOf && scope === "retry" ? JSON.stringify({ retry_of: retryOf.id }) : null)];
  for (const g of picked) stmts.push(db.prepare("INSERT INTO replay_queue (replay_id, golden_id, pass) VALUES (?, ?, 1)").bind(id, g.id));
  // Retention: the replay just beyond the newest REPLAY_KEEP (with this one), with its rows.
  const old = await db.prepare("SELECT id FROM replays ORDER BY armed_at DESC, id DESC LIMIT 1 OFFSET ?").bind(REPLAY_KEEP - 1).first();
  if (old && old.id !== referenceId) {
    for (const t of ["replay_grades", "replay_queue"]) stmts.push(db.prepare(`DELETE FROM ${t} WHERE replay_id = ?`).bind(old.id));
    stmts.push(db.prepare("DELETE FROM replays WHERE id = ?").bind(old.id));
  }
  await db.batch(stmts);
  await audit(db, who, { action: "admin_run", target_kind: "job", target_id: "replay_arm", after: { replay_id: id, kind, scope, version: b.version, n: picked.length } });
  return json({ ok: true, replay_id: id, kind, scope, scope_tickers: scopeTickers, rubric_version: b.version, base_version: bundle.live.version,
    iteration, n_items: picked.length, reference_id: referenceId, deleted: old && old.id !== referenceId ? old.id : null });
}

// --- Admin: the golden set ----------------------------------------------------------------
// POST /v1/admin/golden {items: [1-64], replace?, dry_run?}: upsert by code.
// replace: every active item not in the payload is set inactive. The response
// never echoes expectations.
const nameRegex = new Map();
function titleNames(title, ticker) {
  if (new RegExp(`(?<![A-Za-z0-9])\\$?${ticker.replace(/\./g, "\\.")}(?![A-Za-z0-9])`).test(String(title || ""))) return true;
  if (!nameRegex.has(ticker)) nameRegex.set(ticker, phraseRegex(MATCH?.[ticker]?.terms || []));
  return Boolean(nameRegex.get(ticker)?.test(String(title || "")));
}
function validGolden(raw, covered) {
  const err = (e) => ({ error: `${raw?.code ?? "?"}: ${e}` });
  if (!raw || typeof raw !== "object") return { error: "each item must be an object" };
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(code)) return err("code must be 1-40 letters, digits, - or _");
  if (!CLASSES.includes(raw.class)) return err(`class must be one of ${CLASSES.join(", ")}`);
  if (!BASES.includes(raw.basis)) return err(`basis must be one of ${BASES.join(", ")}`);
  if (!FIRST_SEEN_RULES.includes(raw.first_seen_rule)) return err(`first_seen_rule must be one of ${FIRST_SEEN_RULES.join(", ")}`);
  const active = raw.active === 0 || raw.active === false ? 0 : 1;
  const ticker = String(raw.ticker || "").toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) return err("ticker is required");
  if (active && !covered.includes(ticker)) return err(`ticker ${ticker} is not covered: load it with active: 0`);
  const sourceKey = typeof raw.source_key === "string" ? raw.source_key.trim() : "";
  if (!sourceKey) return err("source_key is required");
  const title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > 300) return err("title must be 1-300 characters");
  const excerpt = raw.excerpt == null ? null : String(raw.excerpt);
  if (excerpt != null && excerpt.length > 2500) return err("excerpt must be at most 2,500 characters");
  if (excerpt && isBlockPage(excerpt)) return err("excerpt is a block or challenge page");
  if (!Number.isFinite(Date.parse(raw.first_seen || ""))) return err("first_seen must be a date");
  if (raw.published != null && !Number.isFinite(Date.parse(raw.published))) return err("published must be a date or null");
  const affects = splitList(raw.affects);
  const expect = raw.expect;
  if (!expect || typeof expect !== "object" || Array.isArray(expect) || !Object.keys(expect).length) return err("expect must be an object keyed by ticker");
  for (const [t, v] of Object.entries(expect)) {
    if (!covered.includes(t)) return err(`expect key ${t} is not a covered ticker`);
    if (v !== "duplicate") {
      const ok = Array.isArray(v) && v.length === 2 && v.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x <= 100)) && (v[0] == null || v[1] == null || v[0] <= v[1]);
      if (!ok) return err(`expect ${t} must be [lo, hi] with 0 <= lo <= hi <= 100 (either may be null) or "duplicate"`);
    }
    if (t !== ticker && !affects.includes(t) && !titleNames(title, t)) return err(`expect key ${t} is neither in affects nor named in the title (the #TICKER rule)`);
  }
  return {
    item: {
      code, class: raw.class, basis: raw.basis, ticker, source_key: sourceKey, role: raw.role == null ? null : String(raw.role),
      affects: affects.length ? affects.join(",") : null, title, url: raw.url == null ? null : String(raw.url), published: raw.published ?? null,
      first_seen: String(raw.first_seen), first_seen_rule: raw.first_seen_rule, excerpt, excerpt_status: raw.excerpt_status == null ? null : String(raw.excerpt_status),
      admit: raw.admit == null ? null : String(raw.admit), expect: JSON.stringify(expect), ref: raw.ref == null ? null : String(raw.ref),
      note: raw.note == null ? null : String(raw.note).slice(0, 1000), active,
    },
  };
}

export async function goldenLoad(env, body, who, { now = Date.now(), bundle = BUNDLE, covered = COVERED.tickers } = {}) {
  const db = env.DB;
  const list = body?.items;
  if (!Array.isArray(list) || !list.length || list.length > GOLDEN_MAX) return json({ error: `items must be an array of 1-${GOLDEN_MAX} golden items` }, 400);
  if (await armedReplay(db, { now, bundle })) return json({ error: "a replay is armed: the golden set is frozen until it finishes or is aborted" }, 409);
  const items = [];
  for (const raw of list) {
    const r = validGolden(raw, covered);
    if (r.error) return json({ error: r.error }, 400);
    items.push(r.item);
  }
  const codes = items.map((i) => i.code);
  if (new Set(codes).size !== codes.length) return json({ error: "duplicate code in items" }, 400);
  const existing = new Map(((await db.prepare("SELECT code, active FROM golden_items").all()).results || []).map((r) => [r.code, r.active]));
  const keptActive = body?.replace ? 0 : [...existing].filter(([c, a]) => a === 1 && !codes.includes(c)).length;
  const active = keptActive + items.filter((i) => i.active).length;
  if (active > GOLDEN_MAX) return json({ error: `${active} active golden items would exceed GOLDEN_MAX ${GOLDEN_MAX}` }, 400);
  const by_class = {};
  for (const i of items) by_class[i.class] = (by_class[i.class] || 0) + 1;
  const wouldUpdate = items.filter((i) => existing.has(i.code)).length;
  const counts = { would_insert: items.length - wouldUpdate, would_update: wouldUpdate, by_class, active_after: active };
  if (body?.dry_run) return json({ dry_run: true, ...counts });
  const at = nowIso(now);
  const cols = ["code", "class", "basis", "ticker", "source_key", "role", "affects", "title", "url", "published", "first_seen", "first_seen_rule",
    "excerpt", "excerpt_status", "admit", "expect", "ref", "note", "active"];
  const stmts = [];
  if (body?.replace) stmts.push(db.prepare(`UPDATE golden_items SET active = 0 WHERE code NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(codes)));
  for (const i of items) {
    stmts.push(db.prepare(
      `INSERT INTO golden_items (${cols.join(", ")}, added_at) VALUES (${cols.map(() => "?").join(", ")}, ?)
       ON CONFLICT(code) DO UPDATE SET ${cols.filter((c) => c !== "code").map((c) => `${c} = excluded.${c}`).join(", ")}`,
    ).bind(...cols.map((c) => i[c]), at));
  }
  await db.batch(stmts);
  const result = { inserted: counts.would_insert, updated: counts.would_update, by_class };
  await audit(db, who, { action: "golden_load", target_kind: "golden", target_id: null, after: result });
  return json({ ok: true, ...result, active: active });
}

// --- GET /v1/replay -------------------------------------------------------------------------
// App: the last 5 replays as counts and a verdict (no codes, no reasons).
// Admin: plus reasons, misses and regressions; ?detail=1 (&id=) adds every pair
// of one replay (the newest by default).
export async function replayRoute(env, url, role) {
  const db = env.DB;
  const rows = (await db.prepare("SELECT * FROM replays ORDER BY armed_at DESC LIMIT 5").all()).results || [];
  const out = rows.map((r) => {
    const s = parse(r.summary, {}) || {};
    const base = { kind: r.kind, scope: r.scope, status: r.status, rubric_version: r.rubric_version, armed_at: r.armed_at, finished_at: r.finished_at,
      n_items: r.n_items, n_graded: r.n_graded, verdict: s.verdict ?? null, by_class: s.by_class ?? null };
    if (role !== "admin") return base;
    return { id: r.id, ...base, base_version: r.base_version, iteration: r.iteration, reference_id: r.reference_id, reasons: s.reasons ?? [], misses: s.misses ?? [],
      regressions: s.regressions ?? [], targets: s.targets ?? {}, extra: s.extra ?? [], warn: s.warn ?? null, reason: s.reason ?? null };
  });
  const body = { replays: out, caps: replaySettings(env) };
  if (role === "admin" && url.searchParams.get("detail") === "1") {
    const id = url.searchParams.get("id") || rows[0]?.id || null;
    if (id) {
      const { queue, golden, grades } = await replayRows(db, id);
      const list = pairs(golden, queue, grades);
      const gradeRows = [];
      for (const p of list) {
        for (const pass of [1, 2]) {
          const sc = pass === 1 ? p.p1 : p.p2;
          if (pass === 2 && sc == null) continue;
          gradeRows.push({ code: p.code, ticker: p.ticker, pass, score: sc, lo: p.lo, hi: p.hi, hit: p.hit });
        }
      }
      body.detail = { id, pairs: gradeRows };
    }
  }
  return json(body);
}

// /v1/ops replay line (tuning.js): one SELECT on replays_status, at most 2 rows;
// the counters are stored on the row. null on a database before migration 0018.
export async function replayOps(db) {
  try {
    const rows = (await db.prepare(
      `SELECT * FROM (SELECT kind, scope, status, rubric_version, n_graded, n_items, finished_at, json_extract(summary, '$.verdict') AS verdict
                        FROM replays WHERE status = 'armed' ORDER BY armed_at DESC LIMIT 1)
       UNION ALL
       SELECT * FROM (SELECT kind, scope, status, rubric_version, n_graded, n_items, finished_at, json_extract(summary, '$.verdict') AS verdict
                        FROM replays WHERE status IN ('done','passed','failed','aborted') ORDER BY armed_at DESC LIMIT 1)`,
    ).all()).results || [];
    const armed = rows.find((r) => r.status === "armed");
    const last = rows.find((r) => FINISHED.includes(r.status));
    return {
      armed: armed ? { kind: armed.kind, scope: armed.scope, rubric_version: armed.rubric_version, n_graded: armed.n_graded, n_items: armed.n_items } : null,
      last: last ? { kind: last.kind, status: last.status, finished_at: last.finished_at, verdict: last.verdict ?? null } : null,
    };
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e))) return null;
    throw e;
  }
}
