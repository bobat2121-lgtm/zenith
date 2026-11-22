// zenith-core — graded research feed for the covered universe.
//   cron  : ingest covered-lane items from news-monitor-db, fetch excerpts
//   grader: POST /v1/queue/claim, POST /v1/grades, GET /v1/rubric[/TICKER|/peers], GET /v1/labels, GET /v1/recent
//   app   : GET /v1/feed, POST /v1/feedback, GET /v1/stats, GET /v1/rubric
//   admin : POST /v1/admin/ingest, /v1/admin/enrich, /v1/admin/requeue (and grade without a claim)
import COVERED from "./covered.json";
import { RUBRIC_VERSION, CORE, COMPANIES, PEERS } from "./rubric.generated.js";
import { ingest } from "./ingest.js";
import { enrich, refreshSecExcerpts } from "./excerpt.js";
import { json, roleFor, nowIso, normalizeGrade, parseItemRef, chunk, parseFloors, sightingAgeDays, olderEventDate, LABELS, MAX_CLAIM, LEASE_MINUTES, MAX_ATTEMPTS } from "./lib.js";

const ALLOW = {
  "POST /v1/queue/claim": ["grader", "admin"],
  "POST /v1/grades": ["grader", "admin"],
  "GET /v1/labels": ["grader", "app", "admin"],
  "GET /v1/recent": ["grader", "app", "admin"],
  "GET /v1/rubric": ["grader", "app", "admin"],
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
      `SELECT i.id, i.ticker, i.state, i.claim_id, i.title, i.source_key, i.url, i.published, i.nm_first_seen AS first_seen, g.run_id AS primary_run
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

async function feed(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 50));
  const where = [], binds = [];
  const ticker = (q.get("ticker") || "").toUpperCase();
  // With a ticker filter, show that ticker's grade (from the same grading pass
  // as the item's primary grade, so retracted cross-ticker grades drop out).
  const gradeJoin = ticker
    ? `LEFT JOIN grades g ON g.id = (SELECT MAX(gt.id) FROM grades gt WHERE gt.item_id = i.id AND gt.ticker = ?
         AND (gt.ticker = i.ticker OR gt.run_id IS (SELECT run_id FROM grades WHERE id = i.grade_id)))`
    : "LEFT JOIN grades g ON g.id = i.grade_id";
  const joinBinds = ticker ? [ticker] : [];
  if (ticker) { where.push("(i.ticker = ? OR g.id IS NOT NULL)"); binds.push(ticker); }
  const before = Number(q.get("before_id"));
  if (Number.isInteger(before) && before > 0) { where.push("i.id < ?"); binds.push(before); }
  if (q.get("include_duplicates") !== "1") where.push("(g.band IS NULL OR g.band != 'duplicate')");
  const minScore = Number(q.get("min_score"));
  if (q.get("min_score") !== null && Number.isFinite(minScore)) { where.push("g.score >= ?"); binds.push(minScore); }
  const state = q.get("state");
  if (state) { where.push("i.state = ?"); binds.push(state); }
  if (q.get("include_skipped") !== "1" && !state) where.push("i.state != 'skipped'");
  if (q.get("unlabeled") === "1") where.push("NOT EXISTS (SELECT 1 FROM feedback f WHERE f.item_id = i.id)");
  const sql = `SELECT ${ITEM_COLS}, substr(i.excerpt, 1, 420) AS snippet, g.id AS grade_id, g.ticker AS grade_ticker, g.score, g.band, g.rung,
      g.event_type, g.status_label, g.magnitude_usd, g.magnitude_pct, g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source,
      g.flags, g.graded_at, g.rubric_version, g.model, g.dup_of,
      (SELECT group_concat(gx.ticker || ':' || COALESCE(gx.score, 'dup'), ',') FROM grades gx
        WHERE gx.item_id = i.id AND g.id IS NOT NULL AND gx.ticker != g.ticker AND gx.run_id IS g.run_id) AS also,
      (SELECT label FROM feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label,
      (SELECT note FROM feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label_note
    FROM items i ${gradeJoin}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.id DESC LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...joinBinds, ...binds, limit).all()).results || [];
  for (const r of rows) {
    r.thesis_drivers = r.thesis_drivers ? JSON.parse(r.thesis_drivers) : [];
    r.flags = r.flags ? JSON.parse(r.flags) : [];
  }
  return json({ items: rows, next_before_id: rows.length === limit ? rows[rows.length - 1].item_id : null });
}

async function feedback(env, body) {
  const itemId = Number(body?.item_id);
  const label = String(body?.label || "").toLowerCase();
  if (!Number.isInteger(itemId)) return json({ error: "item_id required" }, 400);
  if (!LABELS.includes(label)) return json({ error: `label must be one of ${LABELS.join(", ")}` }, 400);
  const item = await env.DB.prepare("SELECT id, grade_id FROM items WHERE id = ?").bind(itemId).first();
  if (!item) return json({ error: "unknown item" }, 404);
  const note = body?.note ? String(body.note).slice(0, 1000) : null;
  const res = await env.DB.prepare("INSERT INTO feedback (item_id, label, note, grade_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(itemId, label, note, item.grade_id, nowIso()).run();
  return json({ ok: true, feedback_id: res.meta.last_row_id });
}

// Latest label per item only (a corrected label supersedes the earlier one),
// with the grade shown when labelled and the item's current grade.
async function labels(env, url) {
  const since = url.searchParams.get("since") || "1970-01-01";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  const rows = (await env.DB.prepare(
    `SELECT f.id AS feedback_id, f.label, f.note, f.created_at, i.id AS item_id, i.ticker, i.title, i.url, i.source_key,
            g.score AS graded_score, g.band AS graded_band, g.why AS graded_why,
            cg.score AS current_score, cg.band AS current_band
       FROM feedback f JOIN items i ON i.id = f.item_id
       LEFT JOIN grades g ON g.id = f.grade_id LEFT JOIN grades cg ON cg.id = i.grade_id
      WHERE f.id IN (SELECT MAX(id) FROM feedback GROUP BY item_id) AND f.created_at >= ?
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
      case "POST /v1/admin/requeue": {
        const body = await readJson(request);
        const ids = (body?.item_ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
        if (!ids.length) return json({ error: "item_ids required" }, 400);
        let requeued = 0;
        for (const part of chunk(ids)) {
          const ph = part.map(() => "?").join(",");
          const r = await env.DB.prepare(`UPDATE items SET state='pending', claim_id=NULL, claimed_until=NULL, attempts=0 WHERE id IN (${ph})`).bind(...part).run();
          requeued += r.meta.changes;
        }
        return json({ requeued });
      }
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
