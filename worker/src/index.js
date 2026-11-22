// zenith-core — graded research feed for the covered universe.
//   cron  : ingest covered-lane items from news-monitor-db, fetch excerpts
//   grader: POST /v1/queue/claim, POST /v1/grades, GET /v1/rubric[/TICKER|/peers], GET /v1/labels, GET /v1/recent
//   app   : GET /v1/feed, POST /v1/feedback, GET /v1/stats
//   admin : POST /v1/admin/ingest, /v1/admin/enrich, /v1/admin/requeue (and grade without a claim)
import COVERED from "./covered.json";
import { RUBRIC_VERSION, CORE, COMPANIES, PEERS } from "./rubric.generated.js";
import { ingest } from "./ingest.js";
import { enrich, refreshSecExcerpts } from "./excerpt.js";
import { json, roleFor, nowIso, normalizeGrade, parseItemRef, chunk, parseFloors, sightingAgeDays, olderEventDate, LABELS, MAX_CLAIM, LEASE_MINUTES, MAX_ATTEMPTS } from "./lib.js";

const ALLOW = {
  "POST /v1/queue/claim": ["grader", "admin"],
  "POST /v1/grades": ["grader", "admin"],
  "GET /v1/labels": ["grader", "admin"],
  "GET /v1/recent": ["grader", "admin"],
  "GET /v1/rubric": ["grader", "admin"],
  "GET /v1/feed": ["app", "admin"],
  "POST /v1/feedback": ["app", "admin"],
  "GET /v1/stats": ["grader", "app", "admin"],
  "POST /v1/admin/ingest": ["admin"],
  "POST /v1/admin/enrich": ["admin"],
  "POST /v1/admin/requeue": ["admin"],
};

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// core.md section 6, read from the bundled rubric: the floors normalizeGrade enforces.
const FLOORS = parseFloors(CORE);

const ITEM_COLS = `i.id AS item_id, i.ticker, i.source_key, i.title, i.url, i.published, i.category,
  i.nm_first_seen AS first_seen, i.nm_notified, i.state, i.skip_reason, i.attempts, i.role, i.affects`;

async function claim(env, body) {
  const limit = Math.max(1, Math.min(MAX_CLAIM, Number(body?.limit) || 30));
  const runId = String(body?.run_id || crypto.randomUUID()).slice(0, 80);
  const now = nowIso();
  const until = nowIso(Date.now() + LEASE_MINUTES * 60_000);
  const claimId = crypto.randomUUID();
  // Items that failed grading repeatedly stop cycling through the queue.
  await env.DB.prepare("UPDATE items SET state='skipped', skip_reason='grading_failed' WHERE state IN ('pending','claimed') AND attempts >= ? AND (claimed_until IS NULL OR claimed_until < ?)")
    .bind(MAX_ATTEMPTS, now).run();
  // One statement, so concurrent claims can never share items or reopen a
  // graded one: the outer WHERE re-checks state. Items whose excerpt attempt
  // has finished come first, then newest first.
  await env.DB.prepare(
    `UPDATE items SET state='claimed', claim_id=?1, claimed_until=?2, attempts=attempts+1
      WHERE id IN (SELECT id FROM items WHERE state='pending' OR (state='claimed' AND claimed_until < ?3)
                    ORDER BY (excerpt_status IS NULL), nm_first_seen DESC, id DESC LIMIT ?4)
        AND (state='pending' OR (state='claimed' AND claimed_until < ?3))`,
  ).bind(claimId, until, now, limit).run();
  const items = (await env.DB.prepare(
    `SELECT ${ITEM_COLS}, i.excerpt, i.excerpt_status FROM items i WHERE i.claim_id = ? ORDER BY i.nm_first_seen DESC`,
  ).bind(claimId).all()).results || [];
  // Timeliness is measured from first sighting, never from grading time.
  for (const it of items) it.seen_after_days = sightingAgeDays(it.published, it.first_seen);
  await env.DB.prepare(
    `INSERT INTO runs (id, started_at, last_seen_at, claimed, rubric_version, model) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, claimed=runs.claimed+excluded.claimed`,
  ).bind(runId, now, now, items.length, String(body?.rubric_version || ""), String(body?.model || "")).run();
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE state IN ('pending','claimed')").first();
  return { claim_id: claimId, run_id: runId, lease_minutes: LEASE_MINUTES, rubric_version: RUBRIC_VERSION, items, remaining: Math.max(0, (pending?.n || 0) - items.length) };
}

async function submitGrades(env, body, role) {
  if (!body || !Array.isArray(body.grades)) return json({ error: "body.grades must be an array" }, 400);
  if (body.grades.length > MAX_CLAIM * 2) return json({ error: "too many grades in one request" }, 400);
  const claimId = body.claim_id ? String(body.claim_id) : null;
  if (!claimId && role !== "admin") return json({ error: "claim_id is required" }, 400);
  const runId = String(body.run_id || "").slice(0, 80) || null;
  const ids = [...new Set(body.grades.map((g) => parseItemRef(g?.item_id)?.id).filter(Number.isInteger))];
  const items = new Map();
  const already = new Set();
  for (const part of chunk(ids)) {
    const ph = part.map(() => "?").join(",");
    for (const r of (await env.DB.prepare(
      `SELECT i.id, i.ticker, i.state, i.claim_id, i.title, i.excerpt, i.source_key, i.url, i.published, i.nm_first_seen AS first_seen, g.run_id AS primary_run
         FROM items i LEFT JOIN grades g ON g.id = i.grade_id WHERE i.id IN (${ph})`,
    ).bind(...part).all()).results || []) items.set(r.id, r);
    if (runId) {
      for (const r of (await env.DB.prepare(`SELECT item_id, ticker FROM grades WHERE run_id = ? AND item_id IN (${ph})`).bind(runId, ...part).all()).results || []) {
        already.add(`${r.item_id}|${r.ticker}`);
      }
    }
  }
  const now = nowIso();
  const rubricVersion = String(body.rubric_version || RUBRIC_VERSION).slice(0, 40);
  const model = String(body.model || "").slice(0, 60) || null;
  const accepted = [], rejected = [], skipped = [];
  const stmts = [];
  for (const raw of body.grades) {
    const ref = parseItemRef(raw?.item_id);
    const item = ref ? items.get(ref.id) : undefined;
    const res = normalizeGrade(raw, item, ref?.alsoTicker || null, COVERED.tickers, FLOORS);
    if (!res.ok) { rejected.push({ item_id: raw?.item_id ?? null, error: res.error }); continue; }
    const g = res.grade;
    const key = `${item.id}|${g.ticker}`;
    // Idempotent: a resubmitted file never stores the same grade twice.
    if (already.has(key)) { skipped.push({ item_id: raw.item_id, note: "already accepted in this run" }); continue; }
    // Only grade what this claim holds (or what this run already graded).
    const inClaim = claimId && item.claim_id === claimId;
    const sameRun = runId && item.state === "graded" && item.primary_run === runId;
    if (role !== "admin" && !inClaim && !sameRun) {
      rejected.push({ item_id: raw.item_id, error: `item ${item.id} is not in claim ${claimId} (state ${item.state}); grade only items from your claim` });
      continue;
    }
    already.add(key);
    stmts.push(env.DB.prepare(
      `INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, rung, event_type, status_label, magnitude_usd, magnitude_pct,
         thesis_drivers, why, note_hook, confidence, read_source, flags, dup_of, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(item.id, g.ticker, runId, rubricVersion, model, g.score, g.band, g.rung, g.event_type, g.status_label, g.magnitude_usd, g.magnitude_pct,
      g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source, g.flags, g.dup_of, now));
    // Only the item's own-ticker grade becomes its primary grade; "#TICKER"
    // grades are stored alongside and surface under that ticker's filter.
    if (g.primary) {
      stmts.push(env.DB.prepare(
        "UPDATE items SET state='graded', grade_id=(SELECT MAX(id) FROM grades WHERE item_id=?1 AND ticker=?2), claim_id=NULL, claimed_until=NULL WHERE id=?1",
      ).bind(item.id, item.ticker));
    }
    accepted.push({ item_id: raw.item_id, ticker: g.ticker, score: g.score, band: g.band });
  }
  if (runId) {
    stmts.push(env.DB.prepare("UPDATE runs SET last_seen_at=?, graded=graded+?, rejected=rejected+? WHERE id=?")
      .bind(now, accepted.length, rejected.length, runId));
  }
  // All-or-nothing: a failure part-way through commits nothing, so a retry is safe.
  if (stmts.length) await env.DB.batch(stmts);
  return json({ accepted: accepted.length, already_accepted: skipped.length, already: skipped.map((s) => s.item_id), rejected, results: accepted });
}

// The grade an item shows under a ticker: the primary grade for the item's own
// ticker, else the latest grade for that ticker from the same grading pass as
// the primary grade (so retracted cross-ticker grades drop out).
const SHOWN_GRADE = `(SELECT MAX(gt.id) FROM grades gt WHERE gt.item_id = i.id AND gt.ticker = ?
         AND (gt.ticker = i.ticker OR gt.run_id IS (SELECT run_id FROM grades WHERE id = i.grade_id)))`;

// Lead items first seen in the last PIN_LEAD_HOURS come first, then newest.
const PIN_LEAD_HOURS = 72;

async function feed(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 50));
  const where = [], binds = [];
  const ticker = (q.get("ticker") || "").toUpperCase();
  const gradeJoin = ticker ? `LEFT JOIN grades g ON g.id = ${SHOWN_GRADE}` : "LEFT JOIN grades g ON g.id = i.grade_id";
  const joinBinds = ticker ? [ticker] : [];
  // order=newest (or pin_lead_hours=0) turns Lead pinning off.
  const pinParam = Number(q.get("pin_lead_hours") ?? PIN_LEAD_HOURS);
  const pinHours = q.get("order") === "newest" ? 0 : Math.max(0, Math.min(24 * 30, Number.isFinite(pinParam) ? pinParam : PIN_LEAD_HOURS));
  const pinSince = nowIso(Date.now() - pinHours * 3_600_000);
  // CASE, not a bare comparison: an ungraded item (g.band NULL) is 0, not NULL.
  const PINNED = pinHours > 0 ? "(CASE WHEN g.band = 'lead' AND i.nm_first_seen >= ? THEN 1 ELSE 0 END)" : "0";
  const pinBinds = pinHours > 0 ? [pinSince] : [];
  if (ticker) { where.push("(i.ticker = ? OR g.id IS NOT NULL)"); binds.push(ticker); }
  const before = Number(q.get("before_id"));
  if (Number.isInteger(before) && before > 0) {
    // Later pages continue the newest-first list; pinned Leads were on page one.
    where.push("i.id < ?"); binds.push(before);
    if (pinHours > 0) { where.push(`NOT ${PINNED}`); binds.push(pinSince); }
  }
  if (q.get("include_duplicates") !== "1") where.push("(g.band IS NULL OR g.band != 'duplicate')");
  const minScore = Number(q.get("min_score"));
  if (q.get("min_score") !== null && Number.isFinite(minScore)) { where.push("g.score >= ?"); binds.push(minScore); }
  const state = q.get("state");
  if (state) { where.push("i.state = ?"); binds.push(state); }
  if (q.get("include_skipped") !== "1" && !state) where.push("i.state != 'skipped'");
  // Labels belong to the grade shown: the item under the ticker it is shown for.
  const LABEL_OF = "f.item_id = i.id AND f.ticker = COALESCE(g.ticker, i.ticker)";
  if (q.get("unlabeled") === "1") where.push(`NOT EXISTS (SELECT 1 FROM feedback f WHERE ${LABEL_OF})`);
  const sql = `SELECT ${ITEM_COLS}, substr(i.excerpt, 1, 420) AS snippet, g.id AS grade_id, g.ticker AS grade_ticker, g.score, g.band, g.rung,
      g.event_type, g.status_label, g.magnitude_usd, g.magnitude_pct, g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source,
      g.flags, g.graded_at, g.rubric_version, g.model, g.dup_of, ${PINNED} AS pinned,
      (SELECT group_concat(gx.ticker || ':' || COALESCE(gx.score, 'dup'), ',') FROM grades gx
        WHERE gx.item_id = i.id AND g.id IS NOT NULL AND gx.ticker != g.ticker AND gx.run_id IS g.run_id) AS also,
      (SELECT label FROM feedback f WHERE ${LABEL_OF} ORDER BY f.id DESC LIMIT 1) AS label,
      (SELECT note FROM feedback f WHERE ${LABEL_OF} ORDER BY f.id DESC LIMIT 1) AS label_note
    FROM items i ${gradeJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY pinned DESC, i.id DESC LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...pinBinds, ...joinBinds, ...binds, limit).all()).results || [];
  for (const r of rows) {
    r.thesis_drivers = r.thesis_drivers ? JSON.parse(r.thesis_drivers) : [];
    r.flags = r.flags ? JSON.parse(r.flags) : [];
    r.pinned = r.pinned ? 1 : 0;
    // The event date, when it is older than news-monitor's first sighting.
    r.event_date = olderEventDate(r.published, r.first_seen);
  }
  let next = null;
  if (rows.length === limit) {
    const unpinned = rows.filter((r) => !r.pinned);
    // A page of pinned Leads only: the newest-first list starts from the top.
    next = unpinned.length ? unpinned[unpinned.length - 1].item_id : Number.MAX_SAFE_INTEGER;
  }
  return json({ items: rows, next_before_id: next });
}

// Records a label against the grade being shown: grade_id, or ticker (that
// ticker's grade of the item, as the feed shows it), else the primary grade.
async function feedback(env, body) {
  const itemId = Number(body?.item_id);
  const label = String(body?.label || "").toLowerCase();
  if (!Number.isInteger(itemId)) return json({ error: "item_id required" }, 400);
  if (!LABELS.includes(label)) return json({ error: `label must be one of ${LABELS.join(", ")}` }, 400);
  const item = await env.DB.prepare("SELECT id, ticker, grade_id FROM items WHERE id = ?").bind(itemId).first();
  if (!item) return json({ error: "unknown item" }, 404);
  const ticker = body?.ticker ? String(body.ticker).toUpperCase() : null;
  let grade = null;
  if (body?.grade_id != null && body.grade_id !== "") {
    const gradeId = Number(body.grade_id);
    if (!Number.isInteger(gradeId)) return json({ error: "grade_id must be an integer" }, 400);
    grade = await env.DB.prepare("SELECT id, ticker, score FROM grades WHERE id = ? AND item_id = ?").bind(gradeId, itemId).first();
    if (!grade) return json({ error: `grade ${gradeId} is not a grade of item ${itemId}` }, 404);
    if (ticker && grade.ticker !== ticker) return json({ error: `grade ${gradeId} is for ${grade.ticker}, not ${ticker}` }, 400);
  } else if (ticker && ticker !== item.ticker) {
    grade = await env.DB.prepare(`SELECT g.id, g.ticker, g.score FROM items i JOIN grades g ON g.id = ${SHOWN_GRADE} WHERE i.id = ?`)
      .bind(ticker, itemId).first();
    if (!grade) return json({ error: `item ${itemId} has no ${ticker} grade` }, 404);
  } else if (item.grade_id != null) {
    grade = await env.DB.prepare("SELECT id, ticker, score FROM grades WHERE id = ?").bind(item.grade_id).first();
  }
  // "Too high" / "too low" compare against a score, so they need one.
  if ((label === "too_high" || label === "too_low") && grade?.score == null) {
    return json({ error: `${label} needs a scored grade to compare against` }, 400);
  }
  const labelTicker = grade?.ticker ?? item.ticker;
  const note = body?.note ? String(body.note).slice(0, 1000) : null;
  const res = await env.DB.prepare("INSERT INTO feedback (item_id, label, note, grade_id, ticker, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(itemId, label, note, grade?.id ?? null, labelTicker, nowIso()).run();
  return json({ ok: true, feedback_id: res.meta.last_row_id, grade_id: grade?.id ?? null, ticker: labelTicker });
}

// Latest label per item and ticker (a corrected label supersedes the earlier
// one), with the grade shown when labelled and that ticker's current grade.
async function labels(env, url) {
  const since = url.searchParams.get("since") || "1970-01-01";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  const rows = (await env.DB.prepare(
    `SELECT f.id AS feedback_id, f.label, f.note, f.created_at, i.id AS item_id, COALESCE(f.ticker, i.ticker) AS ticker,
            i.ticker AS item_ticker, i.title, i.url, i.source_key,
            g.score AS graded_score, g.band AS graded_band, g.why AS graded_why,
            cg.score AS current_score, cg.band AS current_band
       FROM feedback f JOIN items i ON i.id = f.item_id
       LEFT JOIN grades g ON g.id = f.grade_id
       LEFT JOIN grades cg ON cg.id = CASE WHEN f.ticker IS NULL OR f.ticker = i.ticker THEN i.grade_id
                                           ELSE (SELECT MAX(x.id) FROM grades x WHERE x.item_id = i.id AND x.ticker = f.ticker) END
      WHERE f.id IN (SELECT MAX(id) FROM feedback GROUP BY item_id, ticker) AND f.created_at >= ?
      ORDER BY f.id DESC LIMIT ?`,
  ).bind(since, limit).all()).results || [];
  return json({ labels: rows });
}

// Recently graded items for one ticker, so the grader can apply the
// duplicate / already-covered rules across runs.
async function recent(env, url) {
  const ticker = (url.searchParams.get("ticker") || "").toUpperCase();
  if (!COVERED.tickers.includes(ticker)) return json({ error: "ticker must be a covered ticker" }, 400);
  const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days")) || 14));
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 80));
  const since = nowIso(Date.now() - days * 86_400_000);
  const rows = (await env.DB.prepare(
    `SELECT i.id AS item_id, i.source_key, i.title, i.published, i.nm_first_seen AS first_seen,
            g.score, g.band, g.event_type, g.dup_of, substr(g.why, 1, 160) AS why
       FROM items i JOIN grades g ON g.id = i.grade_id
      WHERE i.ticker = ? AND i.nm_first_seen >= ? ORDER BY i.nm_first_seen DESC LIMIT ?`,
  ).bind(ticker, since, limit).all()).results || [];
  return json({ ticker, days, items: rows });
}

async function stats(env) {
  const byState = (await env.DB.prepare("SELECT state, COUNT(*) AS n FROM items GROUP BY state").all()).results || [];
  const byBand = (await env.DB.prepare("SELECT g.band, COUNT(*) AS n FROM items i JOIN grades g ON g.id = i.grade_id GROUP BY g.band").all()).results || [];
  const lastRun = await env.DB.prepare("SELECT * FROM runs ORDER BY last_seen_at DESC LIMIT 1").first();
  const oldestPending = await env.DB.prepare("SELECT MIN(nm_first_seen) AS t FROM items WHERE state IN ('pending','claimed')").first();
  const labelCount = await env.DB.prepare("SELECT COUNT(DISTINCT item_id) AS n FROM feedback").first();
  const meta = Object.fromEntries(((await env.DB.prepare("SELECT key, value FROM meta").all()).results || []).map((r) => [r.key, r.value]));
  return json({ rubric_version: RUBRIC_VERSION, tickers: COVERED.tickers, by_state: byState, by_band: byBand, last_run: lastRun,
    oldest_pending_first_seen: oldestPending?.t || null, labels: labelCount?.n || 0, last_ingest_at: meta.last_ingest_at || null,
    sec_excerpts: Boolean(env.CONTACT_EMAIL) });
}

function rubric(url) {
  const ticker = url.pathname.split("/")[3]?.toUpperCase();
  if (!CORE) return json({ error: "rubric not built" }, 503);
  if (ticker === "PEERS") {
    return PEERS ? json({ rubric_version: RUBRIC_VERSION, peers: PEERS }) : json({ error: "no peer notes" }, 404);
  }
  if (ticker) {
    const sheet = COMPANIES[ticker];
    return sheet ? json({ rubric_version: RUBRIC_VERSION, ticker, sheet }) : json({ error: `no sheet for ${ticker}` }, 404);
  }
  return json({ rubric_version: RUBRIC_VERSION, core: CORE, tickers: Object.keys(COMPANIES).sort(), has_peers: Boolean(PEERS) });
}

// Admin requeue (POST /v1/admin/requeue), one of:
//   { item_ids: [..] }  those items go back to pending.
//   { mode: "late_flags", graded_on: "2026-11-19" | graded_from, graded_to, dry_run }
//     Primary grades in that window flagged late_first_sighting or reason:stale
//     whose item news-monitor first saw within 21 days of its published date:
//     the grading clock, not the sighting, made them late (core.md 4.5).
//     late_first_sighting also requeues undated items; archive bursts are kept.
//   { mode: "sec_excerpts", limit, since, include_duplicates, retry_failed, dry_run }
//     Clears and refetches sec.gov excerpts (graded items included), then
//     requeues the items it read. Needs CONTACT_EMAIL; call until remaining is
//     0 (items in retry backoff are counted as waiting).
//   Both modes touch covered tickers only (dropped names such as REKR and
//   SSTI keep their history).
const LATE_FLAG_BACKFILL_DAY = "2026-11-19";

async function requeueIds(env, ids) {
  let requeued = 0;
  for (const part of chunk(ids)) {
    const ph = part.map(() => "?").join(",");
    const r = await env.DB.prepare(`UPDATE items SET state='pending', claim_id=NULL, claimed_until=NULL, attempts=0 WHERE id IN (${ph})`).bind(...part).run();
    requeued += r.meta.changes;
  }
  return requeued;
}

async function requeueLateFlags(env, body) {
  const day = String(body?.graded_on || LATE_FLAG_BACKFILL_DAY).slice(0, 10);
  const dayEnd = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  const from = body?.graded_from ? String(body.graded_from) : day;
  const to = body?.graded_to ? String(body.graded_to) : Number.isFinite(dayEnd) ? nowIso(dayEnd) : "";
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return json({ error: "graded_on (YYYY-MM-DD), graded_from and graded_to must be dates" }, 400);
  const rows = (await env.DB.prepare(
    `SELECT i.id AS item_id, i.ticker, i.title, i.published, i.nm_first_seen AS first_seen, g.score, g.band, g.flags, g.graded_at
       FROM items i JOIN grades g ON g.id = i.grade_id
      WHERE i.state = 'graded' AND g.graded_at >= ? AND g.graded_at < ?
        AND (g.flags LIKE '%"late_first_sighting"%' OR g.flags LIKE '%"reason:stale"%')
        AND g.flags NOT LIKE '%"archive_burst"%'
        AND i.ticker IN (SELECT value FROM json_each(?))
      ORDER BY i.id LIMIT 1000`,
  ).bind(from, to, JSON.stringify(COVERED.tickers)).all()).results || [];
  const picked = rows.filter((r) => {
    const age = sightingAgeDays(r.published, r.first_seen);
    if (age == null) return r.flags.includes('"late_first_sighting"');
    return age <= 21;
  }).map((r) => ({ item_id: r.item_id, ticker: r.ticker, score: r.score, band: r.band, seen_after_days: sightingAgeDays(r.published, r.first_seen),
    flags: JSON.parse(r.flags).filter((f) => f === "late_first_sighting" || f === "reason:stale"), title: r.title }));
  const requeued = body?.dry_run ? 0 : await requeueIds(env, picked.map((r) => r.item_id));
  return json({ mode: "late_flags", graded_from: from, graded_to: to, matched: picked.length, considered: rows.length, requeued, dry_run: Boolean(body?.dry_run), items: picked.slice(0, 200) });
}

async function requeue(env, body) {
  if (body?.mode === "late_flags") return requeueLateFlags(env, body);
  if (body?.mode === "sec_excerpts") {
    const r = await refreshSecExcerpts(env, body, COVERED.tickers);
    return json(r, r.error ? 409 : 200);
  }
  if (body?.mode) return json({ error: "mode must be late_flags or sec_excerpts (or pass item_ids)" }, 400);
  const ids = (body?.item_ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
  if (!ids.length) return json({ error: "item_ids required" }, 400);
  return json({ requeued: await requeueIds(env, ids) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "zenith-core", rubric_version: RUBRIC_VERSION });
    const routeKey = `${request.method} ${url.pathname.startsWith("/v1/rubric") ? "/v1/rubric" : url.pathname}`;
    const allowed = ALLOW[routeKey];
    if (!allowed) return json({ error: "not found" }, 404);
    const role = roleFor(request, env);
    if (!role) return json({ error: "unauthorized" }, 401);
    if (!allowed.includes(role)) return json({ error: "forbidden" }, 403);
    switch (routeKey) {
      case "POST /v1/queue/claim": return json(await claim(env, await readJson(request)));
      case "POST /v1/grades": return submitGrades(env, await readJson(request), role);
      case "GET /v1/labels": return labels(env, url);
      case "GET /v1/recent": return recent(env, url);
      case "GET /v1/rubric": return rubric(url);
      case "GET /v1/feed": return feed(env, url);
      case "POST /v1/feedback": return feedback(env, await readJson(request));
      case "GET /v1/stats": return stats(env);
      case "POST /v1/admin/ingest": return json(await ingest(env));
      case "POST /v1/admin/enrich": return json(await enrich(env));
      case "POST /v1/admin/requeue": return requeue(env, await readJson(request));
    }
    return json({ error: "not found" }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try { console.log("ingest", JSON.stringify(await ingest(env))); } catch (e) { console.error("ingest failed", e?.stack || e); }
      try { console.log("enrich", JSON.stringify(await enrich(env))); } catch (e) { console.error("enrich failed", e?.stack || e); }
    })());
  },
};
