// Auxiliary names: material news about every company or program news-monitor
// follows outside the covered universe (worker/src/aux-sources.json, routed by
// aux-route.js). A pipeline beside the coverage one, with its own tables
// (aux_items, aux_grades, aux_feedback: migration 0008), cursor, claim and
// grade API, and feed. Nothing here reads or writes items, grades, feedback or
// runs, so no coverage count, alert, brief or grade can change.
//   cron  : ingestAux after the coverage ingest and enrich (and POST /v1/admin/aux-ingest)
//   grader: POST /v1/aux/claim, POST /v1/aux/grades, GET /v1/aux/recent, GET /v1/aux/labels
//   app   : GET /v1/aux/feed, POST /v1/aux/feedback, the aux block of GET /v1/stats
//
// Grades measure materiality to that outside company or program (the aux
// rubric), not to a covered ticker. Read-through to covered tickers is a side
// note (reads_through) and never a score.
import COVERED from "./covered.json";
import { AUX_RUBRIC_VERSION } from "./rubric.generated.js";
import { auxRoute } from "./aux-route.js";
import { BATCH, MAX_BATCHES, newsRows, feedFields, getMeta, setMeta, initialCursor, storedArchiveCounts, OLD_OR_UNDATED_SQL } from "./ingest.js";
import { json, nowIso, bandFor, chunk, isHttpUrl, skipReason, isArchiveCandidate, archiveGroupKey, archiveSeedGroups, sightingAgeDays,
  olderEventDate, LABELS, LEASE_MINUTES, MAX_ATTEMPTS } from "./lib.js";

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
export async function ingestAux(env) {
  const db = env.DB;
  const news = env.NEWS;
  const stored = await getMeta(db, "aux_nm_cursor");
  let cursor = Number(stored);
  if (stored === null || !Number.isFinite(cursor)) {
    cursor = await initialCursor(news, AUX_BACKFILL_DAYS);
    await setMeta(db, "aux_nm_cursor", cursor).run();
  }
  let scanned = 0, matched = 0, inserted = 0, skipped = 0, parkedEarlier = 0, fromFeed = 0;
  for (let b = 0; b < MAX_BATCHES; b++) {
    // Find the window end first so the cursor can advance past unmatched rows.
    const win = await news.prepare("SELECT MAX(rowid) AS hi, COUNT(*) AS n FROM (SELECT rowid FROM items WHERE rowid > ? ORDER BY rowid LIMIT ?)")
      .bind(cursor, BATCH).first();
    if (!win || win.hi == null) break;
    const routed = [];
    for (const r of await newsRows(news, cursor, win.hi)) {
      const route = auxRoute(r.source_key);
      if (route) routed.push({ r, route });
    }
    matched += routed.length;
    const rows = routed.map((x) => x.r);
    const now = nowIso();
    const stmts = [];
    // Day-one archive rows (a seed or backfill of undated or old pages) are
    // parked, not queued; earlier rows of the same poll are parked too.
    const park = archiveSeedGroups(rows, await storedArchiveCounts(db, rows, cursor, "aux_items"));
    const groupRow = new Map(rows.map((r) => [archiveGroupKey(r.source_key, r.first_seen), r]));
    for (const key of park) {
      const { source_key: sourceKey, first_seen: firstSeen } = groupRow.get(key);
      stmts.push(db.prepare(
        `UPDATE aux_items SET state = 'skipped', skip_reason = 'archive_seed', claim_id = NULL, claimed_until = NULL
          WHERE source_key = ? AND nm_first_seen = ? AND nm_rowid <= ? AND state = 'pending' AND ${OLD_OR_UNDATED_SQL}`,
      ).bind(sourceKey, firstSeen, cursor));
    }
    const updates = stmts.length;
    for (const { r, route } of routed) {
      const archive = park.has(archiveGroupKey(r.source_key, r.first_seen)) && isArchiveCandidate(r);
      // Only http(s) links are ever shown in the feed.
      const reason = !isHttpUrl(r.url) ? "bad_url" : archive ? "archive_seed" : skipReason(r);
      if (reason) skipped++;
      const feed = feedFields(r, { role: null }, now);
      if (feed.status) fromFeed++;
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
           ingested_at, state, skip_reason, excerpt, excerpt_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(r.nm_rowid, r.source_key, route.entity_key, route.entity_name, route.status, r.url || "", r.title || "(untitled)", r.published ?? null,
        r.category ?? null, r.first_seen, now, reason ? "skipped" : "pending", reason || null, feed.status ? feed.excerpt : null, feed.status));
    }
    const n = stmts.length;
    stmts.push(setMeta(db, "aux_nm_cursor", win.hi));
    stmts.push(setMeta(db, "aux_last_ingest_at", now));
    const res = await db.batch(stmts);
    inserted += res.slice(updates, n).reduce((k, x) => k + (x.meta?.changes || 0), 0);
    parkedEarlier += res.slice(0, updates).reduce((k, x) => k + (x.meta?.changes || 0), 0);
    scanned += win.n;
    cursor = win.hi;
    if (win.n < BATCH) break;
  }
  return { cursor, scanned, matched, inserted, skipped_on_arrival: skipped, archive_parked_after_insert: parkedEarlier, feed_excerpts: fromFeed };
}

// --- Claim ------------------------------------------------------------------
const CLAIM_COLS = `i.id AS item_id, i.source_key, i.entity_key, i.entity_name, i.status, i.title, i.url, i.published,
  i.nm_first_seen AS first_seen, i.excerpt, i.excerpt_status`;

// Same lease rules as the coverage claim: a 45-minute lease, attempts + 1, and
// items that failed grading MAX_ATTEMPTS times leave the queue. Newest first.
export async function auxClaim(env, body) {
  const limit = Math.max(1, Math.min(AUX_MAX_CLAIM, Math.trunc(Number(body?.limit)) || AUX_DEFAULT_CLAIM));
  const runId = String(body?.run_id || crypto.randomUUID()).slice(0, 80);
  const now = nowIso();
  const until = nowIso(Date.now() + LEASE_MINUTES * 60_000);
  const claimId = crypto.randomUUID();
  await env.DB.prepare("UPDATE aux_items SET state='skipped', skip_reason='grading_failed' WHERE state IN ('pending','claimed') AND attempts >= ? AND (claimed_until IS NULL OR claimed_until < ?)")
    .bind(MAX_ATTEMPTS, now).run();
  // One statement, so concurrent claims can never share items or reopen a
  // graded one: the outer WHERE re-checks state.
  await env.DB.prepare(
    `UPDATE aux_items SET state='claimed', claim_id=?1, claimed_until=?2, attempts=attempts+1
      WHERE id IN (SELECT id FROM aux_items WHERE state='pending' OR (state='claimed' AND claimed_until < ?3)
                    ORDER BY nm_first_seen DESC, id DESC LIMIT ?4)
        AND (state='pending' OR (state='claimed' AND claimed_until < ?3))`,
  ).bind(claimId, until, now, limit).run();
  const items = (await env.DB.prepare(`SELECT ${CLAIM_COLS} FROM aux_items i WHERE i.claim_id = ? ORDER BY i.nm_first_seen DESC, i.id DESC`)
    .bind(claimId).all()).results || [];
  // Timeliness is measured from first sighting, never from grading time.
  for (const it of items) it.seen_after_days = sightingAgeDays(it.published, it.first_seen);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM aux_items WHERE state IN ('pending','claimed')").first();
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
// { ok: true, grade } or { ok: false, error }, the error saying how to fix it.
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

  return {
    ok: true,
    grade: {
      item_id: itemId, entity, score, band: finalBand, reason, event_type: eventType || null, why,
      reads_through: JSON.stringify(readsThrough), flags: JSON.stringify(flags), confidence,
      read_source: raw.read_source ? 1 : 0, dup_of: dupOf, covered_ticker: coveredTicker,
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
    for (const r of (await env.DB.prepare(`SELECT id, state, claim_id FROM aux_items WHERE id IN (${ph})`).bind(...part).all()).results || []) items.set(r.id, r);
    for (const r of (await env.DB.prepare(`SELECT item_id FROM aux_grades WHERE run_id = ? AND item_id IN (${ph})`).bind(runId, ...part).all()).results || []) {
      already.add(r.item_id);
    }
  }
  const now = nowIso();
  const rubricVersion = String(body.rubric_version || AUX_RUBRIC_VERSION || "").slice(0, 40) || null;
  const model = String(body.model || "").slice(0, 60) || null;
  const accepted = [], rejected = [], skipped = [];
  const stmts = [];
  for (const raw of body.grades) {
    const res = normalizeAuxGrade(raw, { covered: COVERED.tickers, dupExists: (id) => items.has(id) });
    if (!res.ok) { rejected.push({ item_id: raw?.item_id ?? null, error: res.error }); continue; }
    const g = res.grade;
    const item = items.get(g.item_id);
    if (!item) { rejected.push({ item_id: raw.item_id, error: `unknown item_id ${g.item_id}: not an auxiliary item` }); continue; }
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
    accepted.push({ item_id: raw.item_id, entity: g.entity, score: g.score, band: g.band });
  }
  // All-or-nothing: a failure part-way through commits nothing, so a retry is safe.
  if (stmts.length) await env.DB.batch(stmts);
  return json({ accepted: accepted.length, already_accepted: skipped.length, already: skipped.map((s) => s.item_id), rejected, results: accepted });
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
    `SELECT f.id AS feedback_id, f.label, f.note, f.created_at, i.id AS item_id, COALESCE(cg.entity, g.entity, i.entity_name) AS entity,
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
// include_covered, or a state).
export async function auxFeed(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 50));
  const where = [], binds = [];
  const pinParam = Number(q.get("pin_lead_hours") ?? PIN_LEAD_HOURS);
  const pinHours = q.get("order") === "newest" ? 0 : Math.max(0, Math.min(24 * 30, Number.isFinite(pinParam) ? pinParam : PIN_LEAD_HOURS));
  const pinSince = nowIso(Date.now() - pinHours * 3_600_000);
  // CASE, not a bare comparison: an ungraded item (g.band NULL) is 0, not NULL.
  const PINNED = pinHours > 0 ? "(CASE WHEN g.band = 'lead' AND i.nm_first_seen >= ? THEN 1 ELSE 0 END)" : "0";
  const pinBinds = pinHours > 0 ? [pinSince] : [];
  const entity = squash(q.get("entity") || "").slice(0, 80);
  if (entity) { const m = entityFilter(entity); where.push(m.sql); binds.push(...m.binds); }
  // Paging, as /v1/feed: a negative cursor means the last page ended inside the
  // pinned Leads (the rest of them come next, then the newest-first list); a
  // positive one continues the newest-first list after every pinned Lead.
  const before = Number(q.get("before_id"));
  if (Number.isInteger(before) && before !== 0) {
    if (pinHours > 0 && before < 0) { where.push(`(${PINNED} = 0 OR i.id < ?)`); binds.push(pinSince, -before); }
    else if (pinHours > 0) { where.push("i.id < ?", `${PINNED} = 0`); binds.push(before, pinSince); }
    else { where.push("i.id < ?"); binds.push(Math.abs(before)); }
  }
  if (q.get("include_duplicates") !== "1") where.push("(g.band IS NULL OR g.band != 'duplicate')");
  if (q.get("include_covered") !== "1") where.push("(g.band IS NULL OR g.band != 'covered')");
  const minScore = Number(q.get("min_score"));
  if (q.get("min_score") !== null && q.get("min_score") !== "" && Number.isFinite(minScore)) { where.push("g.score >= ?"); binds.push(minScore); }
  const state = q.get("state");
  if (state) { where.push("i.state = ?"); binds.push(state); }
  if (q.get("include_skipped") !== "1" && !state) where.push("i.state != 'skipped'");
  if (q.get("unlabeled") === "1") where.push("NOT EXISTS (SELECT 1 FROM aux_feedback f WHERE f.item_id = i.id)");
  const sql = `SELECT i.id AS item_id, COALESCE(g.entity, i.entity_name) AS entity, i.entity_key, i.status, i.source_key, i.title, i.url, i.published,
      i.nm_first_seen AS first_seen, i.state, i.skip_reason, substr(i.excerpt, 1, 420) AS snippet,
      g.id AS grade_id, g.score, g.band, g.event_type, g.why, g.reads_through, g.confidence, g.read_source, g.flags, g.covered_ticker, g.dup_of,
      g.graded_at, ${PINNED} AS pinned,
      (SELECT label FROM aux_feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label,
      (SELECT note FROM aux_feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label_note
    FROM aux_items i LEFT JOIN aux_grades g ON g.id = i.grade_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY pinned DESC, i.id DESC LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...pinBinds, ...binds, limit).all()).results || [];
  for (const r of rows) {
    r.reads_through = parseList(r.reads_through);
    r.flags = parseList(r.flags);
    r.pinned = r.pinned ? 1 : 0;
    // The event date, when it is older than news-monitor's first sighting.
    r.event_date = olderEventDate(r.published, r.first_seen);
  }
  let next = null;
  if (rows.length === limit) {
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
  const item = await env.DB.prepare("SELECT i.id, i.grade_id, g.score FROM aux_items i LEFT JOIN aux_grades g ON g.id = i.grade_id WHERE i.id = ?")
    .bind(itemId).first();
  if (!item) return json({ error: "unknown item" }, 404);
  if ((label === "too_high" || label === "too_low") && item.score == null) {
    return json({ error: `${label} needs a scored grade to compare against` }, 400);
  }
  const note = body?.note ? String(body.note).slice(0, 1000) : null;
  const res = await env.DB.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(itemId, item.grade_id ?? null, label, note, nowIso()).run();
  return json({ ok: true, feedback_id: res.meta.last_row_id, grade_id: item.grade_id ?? null });
}

// The aux block of GET /v1/stats. entities: the names graded in the last 30
// days outside the duplicate and covered bands (the app's Names filter),
// counted case-insensitively under the latest grade's spelling.
export async function auxStats(env) {
  const db = env.DB;
  const byState = (await db.prepare("SELECT state, COUNT(*) AS n FROM aux_items GROUP BY state").all()).results || [];
  const byBand = (await db.prepare("SELECT g.band, COUNT(*) AS n FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id GROUP BY g.band").all()).results || [];
  const entities = (await db.prepare(
    `WITH names AS (
       SELECT lower(g.entity) AS k, MAX(g.id) AS last_id, COUNT(*) AS n
         FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id
        WHERE g.graded_at >= ? AND g.band NOT IN ('duplicate', 'covered')
        GROUP BY lower(g.entity))
     SELECT x.entity AS name, names.n FROM names JOIN aux_grades x ON x.id = names.last_id
      ORDER BY names.n DESC, names.k LIMIT 200`,
  ).bind(nowIso(Date.now() - STATS_ENTITY_DAYS * 86_400_000)).all()).results || [];
  return { rubric_version: AUX_RUBRIC_VERSION, by_state: byState, by_band: byBand, entities, last_ingest_at: await getMeta(db, "aux_last_ingest_at") };
}
