// Auxiliary names: material news about every company or program news-monitor
// follows outside the covered universe (worker/src/aux-sources.json, routed by
// aux-route.js). A pipeline beside the coverage one, with its own tables
// (aux_items, aux_grades, aux_feedback: migrations 0008, 0009), cursor, claim and
// grade API, and feed. Nothing here reads or writes items, grades, feedback or
// runs, so no coverage count, alert, brief or grade can change.
//   cron  : ingestAux after the coverage ingest and enrich (and POST /v1/admin/aux-ingest),
//           with the one-time coverage-subject catch-up (migration 0009)
//   grader: POST /v1/aux/claim, POST /v1/aux/grades, GET /v1/aux/recent, GET /v1/aux/labels
//   app   : GET /v1/aux/feed, POST /v1/aux/feedback, the aux block of GET /v1/stats
//
// Grades measure materiality to that outside company or program (the aux
// rubric), not to a covered ticker. Read-through to covered tickers is a side
// note (reads_through) and never a score.
import COVERED from "./covered.json";
import { AUX_RUBRIC_VERSION } from "./rubric.generated.js";
import { auxRoute } from "./aux-route.js";
import { BATCH, MAX_BATCHES, newsRows, feedFields, getMeta, setMeta, initialCursor, storedArchiveCounts, seedMap, isSeedRow, gateContext, parkGroupStatement,
  coverageOwner } from "./ingest.js";
import { isOfficialRecord } from "./records.js";
import { WARGOV_HOLD_MINUTES } from "./wargov.js";
import { json, nowIso, bandFor, chunk, isHttpUrl, archiveGroupKey, archiveSeedGroups, arrivalGate, sightingAgeDays,
  olderEventDate, normalizeHeadline, normalizeRelations, labelReason, ownerRank, ownerPick, rivalDroppedSql, rivalOnCoverageSql, auxBandShownSql, LABELS, LEASE_MINUTES, MAX_ATTEMPTS, TO_LABEL_DAYS, TO_LABEL_ORDER,
  HELD_SQL, capUndated } from "./lib.js";
import { mutedSources, MUTED_SQL, DEMOTED_SQL, DEMOTE_POINTS } from "./tuning.js";
import { auxEntitySighting, upsertAfterGrades, relationSightings } from "./expansion.js";

export const AUX_BACKFILL_DAYS = 14;
export const AUX_MAX_CLAIM = 40;
const AUX_DEFAULT_CLAIM = 30;
export const AUX_REASONS = ["material", "minor", "noise", "stale", "duplicate", "covered_name", "off_topic", "promotional", "insufficient_evidence"];
export const DIRECTIONS = ["+", "-", "±"];
const PIN_LEAD_HOURS = 72;
const STATS_ENTITY_DAYS = 30;

// --- Ingest -----------------------------------------------------------------
// Copies news-monitor rows whose source routes to an auxiliary name, by its own
// rowid cursor (meta aux_nm_cursor; the first run backfills 14 days). Windowing,
// skip reasons and archive parking are the coverage ingest's (ingest.js); the
// excerpt is the feed's own text when it carries the release itself, and an
// auxiliary page is never fetched.
//
// One pipeline per item (Phase 0 gates (d), ingest.js coverageOwner): a row
// Coverage owns (a covered source's, or a counterparty row routed to a ticker
// and kept by the key-account gate) is never stored here, so no item is
// graded twice. Auxiliary stores plain auxiliary sources, counterparty rows
// with no routable ticker, and rival rows the key-account gate drops. A
// one-time cleanup at deploy (meta aux_owner_cleanup) parks the waiting aux
// copies of coverage-owned rows stored before this rule as 'on_coverage'.
//
// Coverage-subject sources (aux-route.js) joined after aux_nm_cursor had
// passed their rows, so a one-time catch-up (meta aux_cs_cursor) scans the
// rows from the 14-day backfill start up to aux_nm_cursor for those sources
// only, bounded per run like the main scan, and then stops ('done'). Under the
// one-pipeline rule it stores only the rows Coverage does not own. A zenith-db
// whose first auxiliary run routes them already never needs it.
//
// Rival sources (Z11): a rival's item that the coverage key-account gate drops
// (rival_no_key_account: its title names neither an affected company nor one
// of its key accounts) is graded here as outside-company news, entity the
// rival, with coverage_subject and the covered tickers the source affects, so
// reads_through can still tie it to a covered name. One the gate keeps is
// graded on Coverage and never stored here: nothing is on both pages. A
// one-time catch-up (meta aux_rv_cursor) applies this to the rival rows of
// the last 14 days up to aux_nm_cursor: a dropped row is stored (or, already
// stored and not yet graded, marked coverage_subject), and a kept one still
// waiting here is parked as 'on_coverage'.
//
// Muted sources (Z7, tuning.js): their new rows are stored skipped, as
// 'muted_source', so the grader never spends on them.
export const AUX_CS_DONE = "done";
const COUNTERPARTY = COVERED.counterparty || {};

export async function ingestAux(env) {
  const db = env.DB;
  const news = env.NEWS;
  const stored = await getMeta(db, "aux_nm_cursor");
  let cursor = Number(stored);
  if (stored === null || !Number.isFinite(cursor)) {
    cursor = await initialCursor(news, AUX_BACKFILL_DAYS);
    await db.batch([setMeta(db, "aux_nm_cursor", cursor), setMeta(db, "aux_cs_cursor", AUX_CS_DONE), setMeta(db, "aux_rv_cursor", AUX_CS_DONE)]);
  }
  const muted = await mutedSources(db);
  // Phase 0 gates (d): once, before the scan, the waiting aux copies of rows Coverage owns leave the queue.
  const ownerCleanup = await auxOwnerCleanup(db);
  const main = await scanAux(db, news, { cursorKey: "aux_nm_cursor", cursor, muted });
  const subjects = await catchUp(db, news, main.cursor, "aux_cs_cursor", { muted, only: (route) => route.coverage_subject === true });
  const rivals = await catchUp(db, news, main.cursor, "aux_rv_cursor", { muted, rivalCatchUp: true });
  return { ...main, owner_cleanup: ownerCleanup, coverage_subject_catch_up: subjects, rival_catch_up: rivals };
}

// One-time deploy cleanup (meta aux_owner_cleanup = 'done'): parks every
// waiting aux row (pending, or claimed with an expired lease) whose
// news-monitor row Coverage owns (coverageOwner), as 'on_coverage'. Never the
// aux copy of a rival row the key-account gate drops, whatever its Coverage
// stub's label. Bounded per run, paged by id: until done the meta value is the
// last id scanned, so rows Coverage does not own (which stay waiting) never
// hide later ones; done once a page finds fewer than the bound.
export const AUX_OWNER_CLEANUP_BATCH = 1000;
export async function auxOwnerCleanup(db, now = nowIso()) {
  const stored = await getMeta(db, "aux_owner_cleanup");
  if (stored === AUX_CS_DONE) return null;
  const after = Number(stored) > 0 ? Number(stored) : 0;
  const rows = (await db.prepare(
    `SELECT id, nm_rowid, source_key, title FROM aux_items
      WHERE id > ? AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?)) ORDER BY id LIMIT ?`,
  ).bind(after, now, AUX_OWNER_CLEANUP_BATCH).all()).results || [];
  const ids = rows.filter((r) => coverageOwner(r).owns).map((r) => r.id);
  let parked = 0;
  for (const part of chunk(ids)) {
    const r = await db.prepare(
      `UPDATE aux_items SET state = 'skipped', skip_reason = 'on_coverage', claim_id = NULL, claimed_until = NULL
        WHERE id IN (${part.map(() => "?").join(",")}) AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?))`,
    ).bind(...part, now).run();
    parked += r.meta?.changes || 0;
  }
  const done = rows.length < AUX_OWNER_CLEANUP_BATCH;
  await setMeta(db, "aux_owner_cleanup", done ? AUX_CS_DONE : String(rows[rows.length - 1].id)).run();
  return { scanned: rows.length, parked, done };
}

// A one-time catch-up (meta cursorKey) up to the main cursor (end). Returns
// null once done, else what this run scanned.
async function catchUp(db, news, end, cursorKey, opts) {
  const stored = await getMeta(db, cursorKey);
  if (stored === AUX_CS_DONE) return null;
  let cursor = Number(stored);
  if (stored === null || !Number.isFinite(cursor)) cursor = await initialCursor(news, AUX_BACKFILL_DAYS);
  const r = cursor >= end ? { cursor, scanned: 0, matched: 0, inserted: 0, skipped_on_arrival: 0, done: true }
    : await scanAux(db, news, { cursorKey, cursor, end, ...opts });
  if (r.done) await setMeta(db, cursorKey, AUX_CS_DONE).run();
  return { ...r, done: Boolean(r.done) };
}

// For a rival source's row: whether the coverage key-account gate keeps it
// (ingest.js coverageOwner, the coverage ingest's own routing), and the
// covered tickers the source affects. null for any other source.
export function rivalGate(r) {
  const cp = COUNTERPARTY[r.source_key];
  if (cp?.role !== "rival") return null;
  return { onCoverage: coverageOwner(r).owns, affects: [...(cp.affects || [])] };
}

// Scans news-monitor rows after `cursor` (up to `end` when given) in BATCH-row
// windows, MAX_BATCHES a run, storing every row whose route passes `only`, and
// keeps the cursor in meta cursorKey with each window. done: the scan reached
// `end`. rivalCatchUp: rival rows only, as the aux_rv_cursor catch-up above.
async function scanAux(db, news, { cursorKey, cursor, end = null, only = () => true, muted = new Set(), rivalCatchUp = false }) {
  const bounded = end !== null;
  let scanned = 0, matched = 0, inserted = 0, skipped = 0, parkedEarlier = 0, fromFeed = 0, moved = 0, held = 0, done = false;
  for (let b = 0; b < MAX_BATCHES; b++) {
    // Find the window end first so the cursor can advance past unmatched rows.
    const win = await news.prepare(`SELECT MAX(rowid) AS hi, COUNT(*) AS n FROM (SELECT rowid FROM items WHERE rowid > ?${bounded ? " AND rowid <= ?" : ""} ORDER BY rowid LIMIT ?)`)
      .bind(...(bounded ? [cursor, end, BATCH] : [cursor, BATCH])).first();
    if (!win || win.hi == null) { done = bounded; break; }
    const routed = [], onCoverage = [];
    for (const r of await newsRows(news, cursor, win.hi)) {
      let route = auxRoute(r.source_key);
      if (!route) continue;
      if (rivalCatchUp && COUNTERPARTY[r.source_key]?.role !== "rival") continue;
      // One pipeline per item (ingest.js coverageOwner): a row Coverage owns is never stored here.
      const own = coverageOwner(r);
      if (own.owns) { if (rivalCatchUp) onCoverage.push(r); continue; }
      if (own.dropped) route = { ...route, coverage_subject: true, affects: own.affects };
      if (only(route)) routed.push({ r, route });
    }
    matched += routed.length;
    const rows = routed.map((x) => x.r);
    const now = nowIso();
    const stmts = [];
    // Day-one archive rows (a seed or backfill of undated or old pages) are
    // parked, not queued; earlier rows of the same poll are parked too.
    const park = archiveSeedGroups(rows, await storedArchiveCounts(db, rows, cursor, "aux_items"));
    // Phase 0 gates: seed membership (news-monitor MIN(first_seen), SELECT only).
    const first = await seedMap(news, rows);
    const groupRow = new Map(rows.map((r) => [archiveGroupKey(r.source_key, r.first_seen), r]));
    for (const key of park) {
      const g = groupRow.get(key);
      stmts.push(parkGroupStatement(db, "aux_items", { sourceKey: g.source_key, firstSeen: g.first_seen, cursor, seed: isSeedRow(g, first) }));
    }
    const updates = stmts.length;
    // Rival rows the coverage gate keeps, stored here before Z11: graded on Coverage.
    for (const r of onCoverage) {
      stmts.push(db.prepare(
        `UPDATE aux_items SET state = 'skipped', skip_reason = 'on_coverage', claim_id = NULL, claimed_until = NULL
          WHERE nm_rowid = ? AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?))`,
      ).bind(r.nm_rowid, now));
    }
    const movedTo = stmts.length;
    for (const { r, route } of routed) {
      // The arrival gate (lib.js arrivalGate) with the Auxiliary rules: no
      // record exception past 21 days (auxiliary.md section 5).
      const gate = arrivalGate(r, gateContext(r, "aux", first, park));
      // Only http(s) links are ever shown in the feed.
      const reason = !isHttpUrl(r.url) ? "bad_url" : gate.reason || (muted.has(r.source_key) ? "muted_source" : null);
      const admit = reason ? null : gate.admit;
      if (reason) skipped++;
      if (admit) held++;
      const feed = feedFields(r, { role: null }, now);
      if (feed.status) fromFeed++;
      const subject = route.coverage_subject === true;
      // The rival catch-up also marks a stored row it would have routed this way.
      stmts.push(db.prepare(
        `INSERT${rivalCatchUp ? "" : " OR IGNORE"} INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
           ingested_at, state, skip_reason, excerpt, excerpt_status, coverage_subject, affects, admit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${rivalCatchUp
          ? " ON CONFLICT (nm_rowid) DO UPDATE SET coverage_subject = 1, affects = excluded.affects WHERE aux_items.state != 'graded'" : ""}`,
      ).bind(r.nm_rowid, r.source_key, route.entity_key, route.entity_name, route.status, r.url || "", r.title || "(untitled)", r.published ?? null,
        r.category ?? null, r.first_seen, now, reason ? "skipped" : "pending", reason || null, feed.status ? feed.excerpt : null, feed.status,
        subject ? 1 : 0, subject && route.affects?.length ? route.affects.join(",") : null, admit));
    }
    const n = stmts.length;
    stmts.push(setMeta(db, cursorKey, win.hi));
    stmts.push(setMeta(db, "aux_last_ingest_at", now));
    const res = await db.batch(stmts);
    const changes = (from, to) => res.slice(from, to).reduce((k, x) => k + (x.meta?.changes || 0), 0);
    inserted += changes(movedTo, n);
    parkedEarlier += changes(0, updates);
    moved += changes(updates, movedTo);
    scanned += win.n;
    cursor = win.hi;
    if (win.n < BATCH || (bounded && cursor >= end)) { done = bounded; break; }
  }
  const out = { cursor, scanned, matched, inserted, skipped_on_arrival: skipped, archive_parked_after_insert: parkedEarlier, feed_excerpts: fromFeed, held };
  if (rivalCatchUp) out.parked_on_coverage = moved;
  return bounded ? { ...out, done } : out;
}

// --- Claim ------------------------------------------------------------------
const CLAIM_COLS = `i.id AS item_id, i.source_key, i.entity_key, i.entity_name, i.status, i.title, i.url, i.published,
  i.nm_first_seen AS first_seen, i.excerpt, i.excerpt_status, i.coverage_subject, i.affects, i.admit`;

// Claim order (Z1): items first seen more than AUX_OLD_HOURS ago come first,
// oldest first, so a backlog drains instead of aging out; then newest first.
// ?1 is the AUX_OLD_HOURS cutoff.
export const AUX_OLD_HOURS = 72;
const CLAIM_ORDER = "(i.nm_first_seen >= ?1), CASE WHEN i.nm_first_seen < ?1 THEN i.nm_first_seen END, i.nm_first_seen DESC, i.id DESC";

// Same lease rules as the coverage claim: a 45-minute lease, attempts + 1, and
// items that failed grading MAX_ATTEMPTS times leave the queue.
export async function auxClaim(env, body) {
  const limit = Math.max(1, Math.min(AUX_MAX_CLAIM, Math.trunc(Number(body?.limit)) || AUX_DEFAULT_CLAIM));
  const runId = String(body?.run_id || crypto.randomUUID()).slice(0, 80);
  const now = nowIso();
  const until = nowIso(Date.now() + LEASE_MINUTES * 60_000);
  const claimId = crypto.randomUUID();
  await env.DB.prepare("UPDATE aux_items SET state='skipped', skip_reason='grading_failed' WHERE state IN ('pending','claimed') AND attempts >= ? AND (claimed_until IS NULL OR claimed_until < ?)")
    .bind(MAX_ATTEMPTS, now).run();
  // One statement, so concurrent claims can never share items or reopen a
  // graded one: the outer WHERE re-checks state. The state test is
  // parenthesised: a held row (Phase 0 gates, budget.js) is never claimed,
  // pending or with an expired lease. A war.gov digest without its text waits
  // WARGOV_HOLD_MINUTES after first sighting for the bulletin (excerpt.js enrichAuxWargov).
  const old = nowIso(Date.now() - AUX_OLD_HOURS * 3_600_000);
  await env.DB.prepare(
    `UPDATE aux_items SET state='claimed', claim_id=?2, claimed_until=?3, attempts=attempts+1
      WHERE id IN (SELECT i.id FROM aux_items i WHERE (i.state='pending' OR (i.state='claimed' AND i.claimed_until < ?4))
                      AND NOT ${HELD_SQL("i.")}
                      AND NOT (i.source_key = 'wargov_contracts' AND i.excerpt_status IS NULL AND i.nm_first_seen > ?6)
                    ORDER BY ${CLAIM_ORDER} LIMIT ?5)
        AND (state='pending' OR (state='claimed' AND claimed_until < ?4))`,
  ).bind(old, claimId, until, now, limit, nowIso(Date.now() - WARGOV_HOLD_MINUTES * 60_000)).run();
  const items = (await env.DB.prepare(`SELECT ${CLAIM_COLS} FROM aux_items i WHERE i.claim_id = ?2 ORDER BY ${CLAIM_ORDER}`)
    .bind(old, claimId).all()).results || [];
  // Timeliness is measured from first sighting, never from grading time.
  for (const it of items) {
    it.seen_after_days = sightingAgeDays(it.published, it.first_seen);
    // From a feed built for these covered companies (aux-route.js).
    it.coverage_subject = it.coverage_subject === 1;
    it.affects = it.affects ? String(it.affects).split(",").filter(Boolean) : [];
    // Phase 0 gates: whether it is an official record (admit says why the gate let it in).
    it.record = isOfficialRecord(it);
  }
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM aux_items WHERE state IN ('pending','claimed') AND NOT ${HELD_SQL()}`).first();
  return { claim_id: claimId, run_id: runId, lease_minutes: LEASE_MINUTES, rubric_version: AUX_RUBRIC_VERSION, items,
    remaining: Math.max(0, (pending?.n || 0) - items.length) };
}

// --- Grades -----------------------------------------------------------------
const squash = (v) => String(v).replace(/\s+/g, " ").trim();
// An auxiliary item id: an integer, or a string of digits.
export function auxItemId(v) {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v) || null;
  return null;
}
const given = (v) => v !== null && v !== undefined && v !== "";

// Validates one auxiliary grade (the aux rubric's output contract). Returns
// { ok: true, grade, relations, warnings } or { ok: false, error }, the error
// saying how to fix it; warnings say why each dropped relation was dropped.
//   covered:   the covered ticker list (covered_ticker, reads_through)
//   dupExists: (id) => whether id is an auxiliary item (dup_of)
export function normalizeAuxGrade(raw, { covered = COVERED.tickers, dupExists = () => true } = {}) {
  const bad = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("grade must be an object");
  const itemId = auxItemId(raw.item_id);
  if (itemId == null) return bad("item_id must be the auxiliary item_id the claim printed (an integer)");
  const entity = typeof raw.entity === "string" ? squash(raw.entity) : "";
  if (!entity || entity.length > 80) return bad(`entity must name the company or program, 1-80 characters (got ${entity.length})`);

  if (!Array.isArray(raw.flags)) return bad(`flags must be an array with exactly one reason: flag; allowed: ${AUX_REASONS.join(", ")}`);
  const flags = [...new Set(raw.flags.filter((f) => typeof f === "string").map(squash).filter(Boolean).map((f) => f.slice(0, 80)))].slice(0, 16);
  const reasons = flags.filter((f) => f.startsWith("reason:"));
  if (reasons.length !== 1) return bad(`exactly one reason: flag is required (got ${reasons.length}); allowed: ${AUX_REASONS.join(", ")}`);
  const reason = reasons[0].slice(7);
  if (!AUX_REASONS.includes(reason)) return bad(`unknown reason:${reason}; allowed: ${AUX_REASONS.join(", ")}`);

  const band = given(raw.band) ? String(raw.band).trim().toLowerCase() : "";
  let score = null, dupOf = null, coveredTicker = null, finalBand;
  if (reason === "duplicate" || band === "duplicate") {
    if (reason !== "duplicate") return bad(`band "duplicate" needs reason:duplicate (got reason:${reason})`);
    if (band !== "duplicate") return bad(`reason:duplicate needs band "duplicate" (got ${band ? `"${band}"` : "none"})`);
    if (given(raw.score)) return bad("a duplicate must have score null");
    dupOf = auxItemId(raw.dup_of);
    if (dupOf == null) return bad("a duplicate needs dup_of: the auxiliary item_id of the copy already graded (from aux-recent or this claim)");
    if (dupOf === itemId) return bad("dup_of must be another item, never the item itself");
    if (!dupExists(dupOf)) return bad(`dup_of ${dupOf} is not an auxiliary item; use an item_id from aux-recent or this claim (never a coverage item id)`);
    finalBand = "duplicate";
  } else if (reason === "covered_name" || band === "covered") {
    if (reason !== "covered_name") return bad(`band "covered" needs reason:covered_name (got reason:${reason})`);
    if (band !== "covered") return bad(`reason:covered_name needs band "covered" (got ${band ? `"${band}"` : "none"})`);
    if (given(raw.score)) return bad("a covered_name grade must have score null");
    coveredTicker = given(raw.covered_ticker) ? String(raw.covered_ticker).trim().toUpperCase() : "";
    if (!covered.includes(coveredTicker)) return bad(`reason:covered_name needs covered_ticker, one of the covered tickers (${covered.join(", ")}); got ${coveredTicker || "none"}`);
    finalBand = "covered";
  } else {
    // Number(null) is 0: a missing score must never become a silent 0 grade.
    const s = typeof raw.score === "number" || (typeof raw.score === "string" && raw.score.trim()) ? Number(raw.score) : NaN;
    if (!Number.isInteger(s) || s < 0 || s > 100) return bad("score must be an integer 0-100 (null only with band duplicate or covered)");
    score = s;
    finalBand = bandFor(score);
    if (band !== finalBand) return bad(`band must be "${finalBand}" for score ${score} (lead 90-100, digest 70-89, borderline 40-69, reject 0-39); got ${band ? `"${band}"` : "none"}`);
  }
  if (reason !== "duplicate" && given(raw.dup_of)) return bad("dup_of is only for reason:duplicate; set it to null");
  if (reason !== "covered_name" && given(raw.covered_ticker)) return bad("covered_ticker is only for reason:covered_name; set it to null");

  const rt = raw.reads_through ?? [];
  if (!Array.isArray(rt)) return bad('reads_through must be an array (may be empty) of { "ticker": "<covered ticker>", "direction": "+" | "-" | "±" }');
  const readsThrough = [];
  for (const x of rt) {
    if (!x || typeof x !== "object") return bad('each reads_through entry must be { "ticker": "<covered ticker>", "direction": "+" | "-" | "±" }');
    const t = given(x.ticker) ? String(x.ticker).trim().toUpperCase() : "";
    if (!covered.includes(t)) return bad(`reads_through ticker ${t || "(none)"} is not a covered ticker`);
    // peers.md prints minus as U+2212; the contract writes an ASCII hyphen.
    const d = given(x.direction) ? String(x.direction).trim().replace(/−/g, "-") : "";
    if (!DIRECTIONS.includes(d)) return bad(`reads_through direction for ${t} must be "+", "-" or "±" (got ${d || "none"})`);
    if (readsThrough.some((y) => y.ticker === t)) return bad(`reads_through lists ${t} twice`);
    readsThrough.push({ ticker: t, direction: d });
  }

  let confidence = null;
  if (given(raw.confidence)) {
    confidence = typeof raw.confidence === "number" || typeof raw.confidence === "string" ? Number(raw.confidence) : NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return bad("confidence must be a number from 0 to 1");
  }
  if (raw.read_source != null && typeof raw.read_source !== "boolean") return bad("read_source must be true or false");
  if (given(raw.why) && typeof raw.why !== "string") return bad("why must be a string");
  const why = given(raw.why) ? squash(raw.why) : "";
  if (!why) return bad("why is required");
  if (why.length > 400) return bad(`why must be at most 400 characters (got ${why.length})`);
  if (given(raw.event_type) && typeof raw.event_type !== "string") return bad("event_type must be a string");
  const eventType = given(raw.event_type) ? squash(raw.event_type) : "";
  if (eventType.length > 40) return bad(`event_type must be at most 40 characters (got ${eventType.length})`);
  // Optional headline and tag (aux.md section 8); a bad one rejects this grade only.
  const head = normalizeHeadline(raw);
  if (!head.ok) return head;
  // Optional relations (plans/round5-expansion-approve-queue.md, A2): bad
  // entries are dropped with a warning, never a rejection.
  const rel = normalizeRelations(raw.relations, { itemId, subject: entity });

  return {
    ok: true,
    relations: rel.relations,
    warnings: rel.warnings,
    grade: {
      item_id: itemId, entity, score, band: finalBand, reason, event_type: eventType || null, why,
      reads_through: JSON.stringify(readsThrough), flags: JSON.stringify(flags), confidence,
      read_source: raw.read_source ? 1 : 0, dup_of: dupOf, covered_ticker: coveredTicker,
      headline: head.headline, headline_tag: head.tag,
    },
  };
}

// Stores grades for claimed items. A grade is kept once per (item, run): a
// resubmitted file reports it as already accepted. The grader may grade only
// items its claim holds; admin may grade any item without a claim.
export async function submitAuxGrades(env, body, role) {
  if (!body || !Array.isArray(body.grades)) return json({ error: "body.grades must be an array" }, 400);
  if (body.grades.length > AUX_MAX_CLAIM * 2) return json({ error: "too many grades in one request" }, 400);
  const claimId = body.claim_id ? String(body.claim_id) : null;
  if (!claimId && role !== "admin") return json({ error: "claim_id is required" }, 400);
  const runId = String(body.run_id || "").trim().slice(0, 80);
  if (!runId) return json({ error: "run_id is required (the claim's run_id)" }, 400);
  // The graded items and every dup_of they name.
  const ids = [...new Set(body.grades.flatMap((g) => [auxItemId(g?.item_id), auxItemId(g?.dup_of)]).filter((x) => x != null))];
  const items = new Map();
  const already = new Set();
  for (const part of chunk(ids)) {
    const ph = part.map(() => "?").join(",");
    for (const r of (await env.DB.prepare(`SELECT id, state, claim_id, url, title, published, nm_first_seen FROM aux_items WHERE id IN (${ph})`).bind(...part).all()).results || []) items.set(r.id, r);
    for (const r of (await env.DB.prepare(`SELECT item_id FROM aux_grades WHERE run_id = ? AND item_id IN (${ph})`).bind(runId, ...part).all()).results || []) {
      already.add(r.item_id);
    }
  }
  const now = nowIso();
  const rubricVersion = String(body.rubric_version || AUX_RUBRIC_VERSION || "").slice(0, 40) || null;
  const model = String(body.model || "").slice(0, 60) || null;
  const accepted = [], rejected = [], skipped = [];
  const stmts = [];
  const sightings = [], warnings = [];
  for (const raw of body.grades) {
    const res = normalizeAuxGrade(raw, { covered: COVERED.tickers, dupExists: (id) => items.has(id) });
    if (!res.ok) { rejected.push({ item_id: raw?.item_id ?? null, error: res.error }); continue; }
    const g = res.grade;
    const item = items.get(g.item_id);
    if (!item) { rejected.push({ item_id: raw.item_id, error: `unknown item_id ${g.item_id}: not an auxiliary item` }); continue; }
    // Phase 0 gates (e): an undated item is never a Lead. The grader's band is
    // accepted as written and stored capped (89, digest) with the flag.
    if (g.score != null) {
      const flags = JSON.parse(g.flags);
      const capped = capUndated(g.score, item.published, flags);
      if (capped !== g.score) Object.assign(g, { score: capped, band: bandFor(capped), flags: JSON.stringify([...new Set(flags)]) });
    }
    // Idempotent: a resubmitted file never stores the same grade twice.
    if (already.has(item.id)) { skipped.push({ item_id: raw.item_id, note: "already accepted in this run" }); continue; }
    if (role !== "admin" && !(claimId && item.claim_id === claimId)) {
      rejected.push({ item_id: raw.item_id, error: `item ${item.id} is not in claim ${claimId} (state ${item.state}); grade only items from your claim` });
      continue;
    }
    already.add(item.id);
    stmts.push(env.DB.prepare(
      `INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, event_type, why, reads_through, flags, confidence, read_source,
         dup_of, rubric_version, model, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (item_id, run_id) DO NOTHING`,
    ).bind(item.id, runId, g.entity, g.covered_ticker, g.score, g.band, g.event_type, g.why, g.reads_through, g.flags, g.confidence, g.read_source,
      g.dup_of, rubricVersion, model, now));
    stmts.push(env.DB.prepare(
      "UPDATE aux_items SET state='graded', grade_id=(SELECT id FROM aux_grades WHERE item_id=?1 AND run_id=?2), claim_id=NULL, claimed_until=NULL WHERE id=?1",
    ).bind(item.id, runId));
    // The headline lives on the item; a grade without one keeps the item's.
    // Writing one ends any headline-pass lease, so that pass cannot overwrite it.
    if (g.headline) {
      stmts.push(env.DB.prepare(
        "UPDATE aux_items SET headline=?, headline_tag=?, headline_at=?, headline_claim_id=NULL, headline_claimed_until=NULL WHERE id=?",
      ).bind(g.headline, g.headline_tag, now, item.id));
    }
    accepted.push({ item_id: raw.item_id, entity: g.entity, score: g.score, band: g.band });
    // Aux entity rule (plans/round5-expansion-approve-queue.md, C2): a financing or acquisition grade at 70+.
    const sighting = auxEntitySighting(g, item);
    if (sighting) sightings.push(sighting);
    // Relations (A2-A3): dropped entries are warnings; kept ones become
    // candidates, subject the grade's entity, tickers its reads_through.
    for (const w of res.warnings || []) warnings.push({ item_id: raw.item_id, warning: w });
    const rtTickers = JSON.parse(g.reads_through).map((x) => x.ticker);
    sightings.push(...relationSightings(res.relations, { kind: "aux", subject: g.entity, tickers: rtTickers,
      item: { id: item.id, url: item.url, title: item.title, at: item.nm_first_seen } }));
  }
  // All-or-nothing: a failure part-way through commits nothing, so a retry is safe.
  if (stmts.length) await env.DB.batch(stmts);
  // A second batch, after the grades commit: a failure (a zenith-db before
  // migration 0012 included) is a warning and never touches the grades.
  warnings.push(...await upsertAfterGrades(env.DB, sightings, { now }));
  return json({ accepted: accepted.length, already_accepted: skipped.length, already: skipped.map((s) => s.item_id), rejected, results: accepted, warnings });
}

// --- Entity filter (feed and recent) ----------------------------------------
// A name matches, case-insensitively, the shown entity (the grade's, else the
// routed name), the routed name with or without its tag ("Anduril" finds
// "Anduril (private)", so a name's waiting items come with its graded ones),
// or the entity key, also as a name is written ("Shield AI" -> shieldai,
// "Fort Robotics" -> fort_robotics). Rows are aux_items i LEFT JOIN aux_grades g.
function entityFilter(entity) {
  const lower = entity.toLowerCase();
  return {
    sql: `(lower(COALESCE(g.entity, i.entity_name)) = lower(?) OR lower(i.entity_name) = lower(?)
      OR substr(lower(i.entity_name), 1, length(?) + 2) = lower(?) || ' ('
      OR lower(i.entity_key) IN (lower(?), ?, ?))`,
    binds: [entity, entity, entity, entity, entity, lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), lower.replace(/[^a-z0-9]/g, "")],
  };
}

// --- Grader reads -----------------------------------------------------------
// Recent auxiliary items (graded or waiting) with their current grades, for
// the duplicate rule across runs. Without entity (or "-"), every entity.
export async function auxRecent(env, url) {
  const q = url.searchParams;
  const raw = squash(q.get("entity") || "");
  const entity = raw === "-" ? "" : raw.slice(0, 80);
  const days = Math.max(1, Math.min(60, Number(q.get("days")) || 14));
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 80));
  const since = nowIso(Date.now() - days * 86_400_000);
  const match = entity ? entityFilter(entity) : { sql: "1", binds: [] };
  const rows = (await env.DB.prepare(
    `SELECT i.id AS item_id, COALESCE(g.entity, i.entity_name) AS entity, i.entity_key, i.status, i.source_key, i.title, i.url, i.published,
            i.nm_first_seen AS first_seen, i.state, g.score, g.band, g.event_type, g.dup_of, substr(g.why, 1, 160) AS why
       FROM aux_items i LEFT JOIN aux_grades g ON g.id = i.grade_id
      WHERE i.state != 'skipped' AND i.nm_first_seen >= ? AND ${match.sql}
      ORDER BY i.nm_first_seen DESC, i.id DESC LIMIT ?`,
  ).bind(since, ...match.binds, limit).all()).results || [];
  return json({ entity: entity || null, days, items: rows });
}

// Analyst labels are ranges on the 0-100 scale (the same as the coverage
// labels the grader reads); too_high / too_low are below / above the score
// the analyst saw.
export const LABEL_RANGE = { high: [80, 100], medium: [60, 89], low: [30, 69], noise: [0, 29] };
export function labelRange(label, shownScore) {
  if (LABEL_RANGE[label]) return LABEL_RANGE[label];
  if (shownScore == null) return null;
  if (label === "too_high") return [0, Math.max(0, shownScore - 1)];
  if (label === "too_low") return [Math.min(100, shownScore + 1), 100];
  return null;
}

// Auxiliary items whose current grade falls outside the analyst's latest
// label (labels from the last `days` days), largest gap first.
export async function auxLabels(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 30));
  const days = Math.max(1, Math.min(365, Number(q.get("days")) || 30));
  const since = nowIso(Date.now() - days * 86_400_000);
  const rows = (await env.DB.prepare(
    `SELECT f.id AS feedback_id, f.label, f.reason, f.note, f.created_at, i.id AS item_id, COALESCE(cg.entity, g.entity, i.entity_name) AS entity,
            i.entity_key, i.status, i.source_key, i.title, i.url,
            g.score AS graded_score, g.band AS graded_band, g.why AS graded_why,
            cg.score AS current_score, cg.band AS current_band, cg.why AS current_why
       FROM aux_feedback f JOIN aux_items i ON i.id = f.item_id
       LEFT JOIN aux_grades g ON g.id = f.grade_id
       LEFT JOIN aux_grades cg ON cg.id = i.grade_id
      WHERE f.id IN (SELECT MAX(id) FROM aux_feedback GROUP BY item_id) AND f.created_at >= ?
      ORDER BY f.id DESC LIMIT 1000`,
  ).bind(since).all()).results || [];
  const out = [];
  for (const l of rows) {
    const range = labelRange(l.label, l.graded_score);
    const s = l.current_score;
    if (!range || s == null) continue;
    const gap = s < range[0] ? range[0] - s : s > range[1] ? range[1] - s : 0;
    if (gap) out.push({ ...l, range: `${range[0]}-${range[1]}`, gap });
  }
  out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || b.feedback_id - a.feedback_id);
  return json({ days, total: out.length, labels: out.slice(0, limit) });
}

// --- App --------------------------------------------------------------------
const parseList = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

// The auxiliary feed. Params mirror /v1/feed: min_score, order=newest,
// pin_lead_hours (Leads first seen in that window come first), entity (the
// shown name or the entity key: entityFilter), unlabeled=1, state, limit, before_id (pass
// next_before_id back unchanged). Skipped items and the duplicate and covered
// bands are hidden unless asked for (include_skipped, include_duplicates,
// include_covered, or a state). A coverage-subject item (migration 0009) is
// hidden until it is graded, with the covered band: it is often only about a
// covered company. Newest first is news-monitor's arrival order (nm_rowid), so
// rows the one-time coverage-subject catch-up stores late sit by their age;
// before_id stays an item id.
//
// Rival twins (news-monitor rows a rival source delivered, stored in both
// pipelines): an aux copy graded 'covered' still shows when its coverage copy
// was dropped by the key-account gate (rival_no_key_account), else it would be
// on neither page; an aux copy whose coverage copy is shown (not skipped:
// stored before Z11 for a row the gate keeps) is hidden, so it is never on both.
// include_covered=1 shows both kinds.
// (lib.js rivalDroppedSql / rivalOnCoverageSql, shared with the headline pass and auxStats.)
export const RIVAL_DROPPED = rivalDroppedSql("i");
export const RIVAL_ON_COVERAGE = rivalOnCoverageSql("i");
export async function auxFeed(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 50));
  const toLabel = q.get("sort") === "to_label";
  const where = [], binds = [];
  const pinParam = Number(q.get("pin_lead_hours") ?? PIN_LEAD_HOURS);
  const pinHours = q.get("order") === "newest" || toLabel ? 0 : Math.max(0, Math.min(24 * 30, Number.isFinite(pinParam) ? pinParam : PIN_LEAD_HOURS));
  const pinSince = nowIso(Date.now() - pinHours * 3_600_000);
  // For You (the default order): a demoted source's cards count DEMOTE_POINTS
  // lower for pinning and min_score, as in /v1/feed.
  const forYou = q.get("order") !== "newest" && !toLabel;
  const SCORE = forYou ? `(g.score - CASE WHEN i.source_key IN ${DEMOTED_SQL} THEN ${DEMOTE_POINTS} ELSE 0 END)` : "g.score";
  // The owner's latest label (lf, joined below) overrides For You placement (Z13, lib.js ownerRank).
  const owner = ownerRank(SCORE, "lf.label");
  // CASE, not a bare comparison: an ungraded item (g.band NULL) is 0, not NULL.
  // Phase 0 gates (e): an undated card never pins as a fresh Lead, unless the owner marked it High.
  const PINNED = pinHours > 0
    ? `(CASE WHEN (g.band = 'lead' OR ${owner.high}) AND NOT ${owner.noise} AND ${owner.score} >= 90 AND i.nm_first_seen >= ?
         AND (i.published IS NOT NULL OR ${owner.high}) THEN 1 ELSE 0 END)` : "0";
  const pinBinds = pinHours > 0 ? [pinSince] : [];
  const entity = squash(q.get("entity") || "").slice(0, 80);
  if (entity) { const m = entityFilter(entity); where.push(m.sql); binds.push(...m.binds); }
  // A muted source's cards are hidden (source prefs, tuning.js).
  where.push(`i.source_key NOT IN ${MUTED_SQL}`);
  // Paging, as /v1/feed: a negative cursor means the last page ended inside the
  // pinned Leads (the rest of them come next, then the newest-first list); a
  // positive one continues the newest-first list after every pinned Lead.
  const before = Number(q.get("before_id"));
  const BEFORE = "i.nm_rowid < (SELECT b.nm_rowid FROM aux_items b WHERE b.id = ?)";
  if (Number.isInteger(before) && before !== 0 && !toLabel) {
    if (pinHours > 0 && before < 0) { where.push(`(${PINNED} = 0 OR ${BEFORE})`); binds.push(pinSince, -before); }
    else if (pinHours > 0) { where.push(BEFORE, `${PINNED} = 0`); binds.push(before, pinSince); }
    else { where.push(BEFORE); binds.push(Math.abs(before)); }
  }
  if (q.get("include_duplicates") !== "1") where.push("(g.band IS NULL OR g.band != 'duplicate')");
  if (q.get("include_covered") !== "1") {
    where.push(`(g.band IS NULL OR g.band != 'covered' OR ${RIVAL_DROPPED})`, "(i.coverage_subject = 0 OR i.grade_id IS NOT NULL)", `NOT ${RIVAL_ON_COVERAGE}`);
  }
  const minScore = Number(q.get("min_score"));
  const floor = q.get("min_score") !== null && q.get("min_score") !== "" && Number.isFinite(minScore) ? minScore : null;
  if (floor !== null) {
    // For You: the owner's High is in whatever the score or state; Noise is out whatever the score.
    where.push(forYou ? `(${owner.high} OR (${SCORE} >= ? AND NOT ${owner.noise}))` : `${SCORE} >= ?`);
    binds.push(floor);
  }
  const state = q.get("state");
  if (state) { where.push("i.state = ?"); binds.push(state); }
  if (q.get("include_skipped") !== "1" && !state) where.push("i.state != 'skipped'");
  // Held rows (waiting for the daily grading budget, budget.js) only with include_held=1.
  if (q.get("include_held") !== "1") where.push(`NOT ${HELD_SQL("i.")}`);
  if (q.get("unlabeled") === "1" || toLabel) where.push("NOT EXISTS (SELECT 1 FROM aux_feedback f WHERE f.item_id = i.id)");
  // sort=to_label (Z10, lib.js TO_LABEL_ORDER): graded, unlabeled, recent; no paging.
  if (toLabel) {
    where.push("i.state = 'graded'", "g.score IS NOT NULL", "i.nm_first_seen >= ?");
    binds.push(nowIso(Date.now() - TO_LABEL_DAYS * 86_400_000));
  }
  const sql = `SELECT i.id AS item_id, COALESCE(g.entity, i.entity_name) AS entity, i.entity_key, i.status, i.source_key, i.title, i.url, i.published,
      i.nm_first_seen AS first_seen, i.state, i.skip_reason, i.headline, i.headline_tag, substr(i.excerpt, 1, 420) AS snippet,
      g.id AS grade_id, g.score, CASE WHEN g.band = 'lead' AND i.published IS NULL THEN 'digest' ELSE g.band END AS band, g.band AS stored_band, g.event_type, g.why, g.reads_through, g.confidence, g.read_source, g.flags, g.covered_ticker, g.dup_of,
      g.graded_at, ${PINNED} AS pinned, (i.source_key IN ${DEMOTED_SQL}) AS demoted,
      lf.label AS label, lf.note AS label_note, lf.reason AS my_reason
    FROM aux_items i LEFT JOIN aux_grades g ON g.id = i.grade_id
    LEFT JOIN aux_feedback lf ON lf.id = (SELECT MAX(f.id) FROM aux_feedback f WHERE f.item_id = i.id)
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${toLabel ? `${TO_LABEL_ORDER}, i.nm_rowid DESC` : "pinned DESC, i.nm_rowid DESC"} LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...pinBinds, ...binds, limit).all()).results || [];
  for (const r of rows) {
    r.reads_through = parseList(r.reads_through);
    r.flags = parseList(r.flags);
    r.pinned = r.pinned ? 1 : 0;
    r.demoted = r.demoted ? 1 : 0;
    r.my_label = r.label;
    // In For You only because of the owner's High (Z13): the app's "Your pick".
    r.owner_pick = forYou ? ownerPick(r, floor, DEMOTE_POINTS) : 0;
    // The event date, when it is older than news-monitor's first sighting.
    r.event_date = olderEventDate(r.published, r.first_seen);
  }
  let next = null;
  if (rows.length === limit && !toLabel) {
    const last = rows[rows.length - 1];
    next = last.pinned ? -last.item_id : last.item_id;
  }
  return json({ items: rows, next_before_id: next });
}

// Records a label against the item's current grade. "Too high" / "too low"
// compare against a score, so they need one.
export async function auxFeedback(env, body) {
  const itemId = Number(body?.item_id);
  const label = String(body?.label || "").toLowerCase();
  if (!Number.isInteger(itemId)) return json({ error: "item_id required" }, 400);
  if (!LABELS.includes(label)) return json({ error: `label must be one of ${LABELS.join(", ")}` }, 400);
  const why = labelReason(body);
  if (!why.ok) return json({ error: why.error }, 400);
  const item = await env.DB.prepare("SELECT i.id, i.grade_id, g.score FROM aux_items i LEFT JOIN aux_grades g ON g.id = i.grade_id WHERE i.id = ?")
    .bind(itemId).first();
  if (!item) return json({ error: "unknown item" }, 404);
  if ((label === "too_high" || label === "too_low") && item.score == null) {
    return json({ error: `${label} needs a scored grade to compare against` }, 400);
  }
  const note = body?.note ? String(body.note).slice(0, 1000) : null;
  const res = await env.DB.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, note, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(itemId, item.grade_id ?? null, label, note, why.reason, nowIso()).run();
  return json({ ok: true, feedback_id: res.meta.last_row_id, grade_id: item.grade_id ?? null, reason: why.reason });
}

// The aux block of GET /v1/stats. entities: the names graded in the last 30
// days whose cards the feed shows (outside the duplicate and covered bands, a
// gate-dropped rival's covered card included, a rival twin on Coverage not: the app's Names filter),
// counted case-insensitively under the latest grade's spelling.
export async function auxStats(env) {
  const db = env.DB;
  // Phase 0 gates: held rows are counted as state 'held', never as pending (as index.js stats).
  const byState = (await db.prepare(`SELECT CASE WHEN state = 'pending' AND ${HELD_SQL()} THEN 'held' ELSE state END AS state, COUNT(*) AS n
    FROM aux_items GROUP BY 1`).all()).results || [];
  const byBand = (await db.prepare("SELECT g.band, COUNT(*) AS n FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id GROUP BY g.band").all()).results || [];
  const entities = (await db.prepare(
    `WITH names AS (
       SELECT lower(g.entity) AS k, MAX(g.id) AS last_id, COUNT(*) AS n
         FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id
        WHERE g.graded_at >= ? AND ${auxBandShownSql("i", "g.band")}
        GROUP BY lower(g.entity))
     SELECT x.entity AS name, names.n FROM names JOIN aux_grades x ON x.id = names.last_id
      ORDER BY names.n DESC, names.k LIMIT 200`,
  ).bind(nowIso(Date.now() - STATS_ENTITY_DAYS * 86_400_000)).all()).results || [];
  return { rubric_version: AUX_RUBRIC_VERSION, by_state: byState, by_band: byBand, entities, last_ingest_at: await getMeta(db, "aux_last_ingest_at") };
}
