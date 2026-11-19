// zenith-core — graded research feed for the covered universe.
//   cron  : ingest covered-lane items from news-monitor-db
//   grader: POST /v1/queue/claim, POST /v1/grades, GET /v1/rubric[/TICKER], GET /v1/labels
//   app   : GET /v1/feed, POST /v1/feedback, GET /v1/stats, GET /v1/rubric
//   admin : POST /v1/admin/ingest, POST /v1/admin/requeue
import COVERED from "./covered.json";
import { RUBRIC_VERSION, CORE, COMPANIES } from "./rubric.generated.js";
import { ingest } from "./ingest.js";
import { enrich } from "./excerpt.js";
import { json, roleFor, nowIso, normalizeGrade, LABELS, MAX_CLAIM, LEASE_MINUTES, MAX_ATTEMPTS } from "./lib.js";

const ALLOW = {
  "POST /v1/queue/claim": ["grader", "admin"],
  "POST /v1/grades": ["grader", "admin"],
  "GET /v1/labels": ["grader", "app", "admin"],
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

const ITEM_COLS = `i.id AS item_id, i.ticker, i.source_key, i.title, i.url, i.published, i.category,
  i.nm_first_seen AS first_seen, i.nm_notified, i.state, i.skip_reason, i.attempts`;

async function claim(env, body) {
  const limit = Math.max(1, Math.min(MAX_CLAIM, Number(body?.limit) || 40));
  const runId = String(body?.run_id || crypto.randomUUID()).slice(0, 80);
  const now = nowIso();
  const until = nowIso(Date.now() + LEASE_MINUTES * 60_000);
  const claimId = crypto.randomUUID();
  // Items that failed grading repeatedly stop cycling through the queue.
  await env.DB.prepare("UPDATE items SET state='skipped', skip_reason='grading_failed' WHERE state IN ('pending','claimed') AND attempts >= ? AND (claimed_until IS NULL OR claimed_until < ?)")
    .bind(MAX_ATTEMPTS, now).run();
  // Items whose excerpt fetch has run come first (so the grader reads the
  // release), then newest first, so live news is graded before backfill.
  const ids = ((await env.DB.prepare(
    `SELECT id FROM items WHERE state = 'pending' OR (state = 'claimed' AND claimed_until < ?)
      ORDER BY (excerpt_status IS NULL), nm_first_seen DESC, id DESC LIMIT ?`,
  ).bind(now, limit).all()).results || []).map((r) => r.id);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE items SET state='claimed', claim_id=?, claimed_until=?, attempts=attempts+1 WHERE id IN (${ph})`)
      .bind(claimId, until, ...ids).run();
  }
  await env.DB.prepare(
    `INSERT INTO runs (id, started_at, last_seen_at, claimed, rubric_version, model) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, claimed=runs.claimed+excluded.claimed`,
  ).bind(runId, now, now, ids.length, String(body?.rubric_version || ""), String(body?.model || "")).run();
  const items = ids.length
    ? ((await env.DB.prepare(`SELECT ${ITEM_COLS}, i.excerpt, i.excerpt_status FROM items i WHERE i.claim_id = ? ORDER BY i.nm_first_seen DESC`).bind(claimId).all()).results || [])
    : [];
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE state IN ('pending','claimed')").first();
  return { claim_id: claimId, run_id: runId, lease_minutes: LEASE_MINUTES, rubric_version: RUBRIC_VERSION, items, remaining: Math.max(0, (pending?.n || 0) - items.length) };
}

async function submitGrades(env, body) {
  if (!body || !Array.isArray(body.grades)) return json({ error: "body.grades must be an array" }, 400);
  if (body.grades.length > MAX_CLAIM * 2) return json({ error: "too many grades in one request" }, 400);
  const ids = [...new Set(body.grades.map((g) => Number(g?.item_id)).filter(Number.isInteger))];
  const items = new Map();
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    for (const r of (await env.DB.prepare(`SELECT id, ticker, state, claim_id FROM items WHERE id IN (${ph})`).bind(...ids).all()).results || []) items.set(r.id, r);
  }
  const now = nowIso();
  const runId = String(body.run_id || "").slice(0, 80) || null;
  const rubricVersion = String(body.rubric_version || RUBRIC_VERSION).slice(0, 40);
  const model = String(body.model || "").slice(0, 60) || null;
  const accepted = [], rejected = [];
  for (const raw of body.grades) {
    const item = items.get(Number(raw?.item_id));
    const res = normalizeGrade(raw, item);
    if (!res.ok) { rejected.push({ item_id: raw?.item_id ?? null, error: res.error }); continue; }
    const g = res.grade;
    const ins = await env.DB.prepare(
      `INSERT INTO grades (item_id, run_id, rubric_version, model, score, band, rung, event_type, status_label, magnitude_usd, magnitude_pct,
         thesis_drivers, why, note_hook, confidence, read_source, flags, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(item.id, runId, rubricVersion, model, g.score, g.band, g.rung, g.event_type, g.status_label, g.magnitude_usd, g.magnitude_pct,
      g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source, g.flags, now).run();
    await env.DB.prepare("UPDATE items SET state='graded', grade_id=?, claim_id=NULL, claimed_until=NULL WHERE id=?")
      .bind(ins.meta.last_row_id, item.id).run();
    accepted.push({ item_id: item.id, grade_id: ins.meta.last_row_id, score: g.score, band: g.band });
  }
  if (runId) {
    await env.DB.prepare("UPDATE runs SET last_seen_at=?, graded=graded+?, rejected=rejected+? WHERE id=?")
      .bind(now, accepted.length, rejected.length, runId).run();
  }
  return json({ accepted: accepted.length, rejected, results: accepted });
}

async function feed(env, url) {
  const q = url.searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 50));
  const where = [], binds = [];
  const before = Number(q.get("before_id"));
  if (Number.isInteger(before) && before > 0) { where.push("i.id < ?"); binds.push(before); }
  const ticker = (q.get("ticker") || "").toUpperCase();
  if (ticker) { where.push("i.ticker = ?"); binds.push(ticker); }
  const minScore = Number(q.get("min_score"));
  if (Number.isFinite(minScore) && q.get("min_score") !== null) { where.push("g.score >= ?"); binds.push(minScore); }
  const state = q.get("state");
  if (state) { where.push("i.state = ?"); binds.push(state); }
  if (q.get("include_skipped") !== "1" && !state) where.push("i.state != 'skipped'");
  const unlabeled = q.get("unlabeled") === "1";
  if (unlabeled) where.push("NOT EXISTS (SELECT 1 FROM feedback f WHERE f.item_id = i.id)");
  const sql = `SELECT ${ITEM_COLS}, substr(i.excerpt, 1, 420) AS snippet, g.id AS grade_id, g.score, g.band, g.rung, g.event_type, g.status_label, g.magnitude_usd, g.magnitude_pct,
      g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source, g.flags, g.graded_at, g.rubric_version, g.model,
      (SELECT label FROM feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label,
      (SELECT note FROM feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label_note
    FROM items i LEFT JOIN grades g ON g.id = i.grade_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.id DESC LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...binds, limit).all()).results || [];
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

async function labels(env, url) {
  const since = url.searchParams.get("since") || "1970-01-01";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  const rows = (await env.DB.prepare(
    `SELECT f.id AS feedback_id, f.label, f.note, f.created_at, i.id AS item_id, i.ticker, i.title, i.url, i.source_key,
            g.score AS graded_score, g.band AS graded_band, g.why AS graded_why
       FROM feedback f JOIN items i ON i.id = f.item_id LEFT JOIN grades g ON g.id = f.grade_id
      WHERE f.created_at >= ? ORDER BY f.id DESC LIMIT ?`,
  ).bind(since, limit).all()).results || [];
  return json({ labels: rows });
}

async function stats(env) {
  const byState = (await env.DB.prepare("SELECT state, COUNT(*) AS n FROM items GROUP BY state").all()).results || [];
  const byBand = (await env.DB.prepare("SELECT g.band, COUNT(*) AS n FROM items i JOIN grades g ON g.id = i.grade_id GROUP BY g.band").all()).results || [];
  const lastRun = await env.DB.prepare("SELECT * FROM runs ORDER BY last_seen_at DESC LIMIT 1").first();
  const oldestPending = await env.DB.prepare("SELECT MIN(nm_first_seen) AS t FROM items WHERE state IN ('pending','claimed')").first();
  const labelCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first();
  const meta = Object.fromEntries(((await env.DB.prepare("SELECT key, value FROM meta").all()).results || []).map((r) => [r.key, r.value]));
  return json({ rubric_version: RUBRIC_VERSION, tickers: COVERED.tickers, by_state: byState, by_band: byBand, last_run: lastRun,
    oldest_pending_first_seen: oldestPending?.t || null, labels: labelCount?.n || 0, last_ingest_at: meta.last_ingest_at || null });
}

function rubric(url) {
  const ticker = url.pathname.split("/")[3]?.toUpperCase();
  if (!CORE) return json({ error: "rubric not built" }, 503);
  if (ticker) {
    const sheet = COMPANIES[ticker];
    return sheet ? json({ rubric_version: RUBRIC_VERSION, ticker, sheet }) : json({ error: `no sheet for ${ticker}` }, 404);
  }
  return json({ rubric_version: RUBRIC_VERSION, core: CORE, tickers: Object.keys(COMPANIES).sort() });
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
      case "POST /v1/grades": return submitGrades(env, await readJson(request));
      case "GET /v1/labels": return labels(env, url);
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
        const ph = ids.map(() => "?").join(",");
        const r = await env.DB.prepare(`UPDATE items SET state='pending', claim_id=NULL, claimed_until=NULL, attempts=0 WHERE id IN (${ph})`).bind(...ids).run();
        return json({ requeued: r.meta.changes });
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
