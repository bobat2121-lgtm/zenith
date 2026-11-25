// Recall scoreboard (Zenith show, phase 0): how many audited material events the
// system caught on time, late, in part or not at all.
//   admin     : POST /v1/admin/recall { source, events[1-200], replace?, dry_run? }
//               validates each event, resolves its captured item by exact URL
//               (coverage first, then aux), and upserts recall_events by id.
//   app, admin: GET /v1/recall: totals by status, by kind and by ticker. The event
//               list itself (events=1) is for the admin token only.
// The events are owner research: they live in a seed file outside this public repo
// and reach zenith-db only through the admin route. Examples here are synthetic
// (say 7 events: 3 on time, 2 late, 1 partial, 1 missed).
import COVERED from "./covered.json";
import { json, nowIso } from "./lib.js";

export const RECALL_KINDS = ["filing", "regulator", "local_government", "program_award", "register", "trade_press", "news"];
export const RECALL_STATUSES = ["on_time", "late", "partial", "missed"];
const CAPTURED_KINDS = ["coverage", "aux"];
const VERDICTS = ["confirmed", "partly"];
const MAX_EVENTS = 200;
const MISSING = "recall_events missing: apply migration 0015";

const ID_RE = /^([A-Z]{2,6})-\d{1,3}$/;
const VERDICT_REF_RE = /^miss:[A-Z]{2,6}:\d{1,3}$/;
const SOURCE_RE = /^[a-z0-9-]{1,60}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const missingTable = (e) => /no such table/i.test(String(e?.message || e));
const isDay = (v) => typeof v === "string" && DAY_RE.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const isIso = (v) => typeof v === "string" && ISO_RE.test(v) && Number.isFinite(Date.parse(v));
const nullish = (v) => v === null || v === undefined;
const optText = (v, max) => nullish(v) || (typeof v === "string" && v.length <= max);

// { ok: true, event } with every column (null when absent), or { ok: false, error }.
export function validateRecallEvent(e, tickers = COVERED.tickers) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, error: "event must be an object" };
  const m = typeof e.id === "string" ? ID_RE.exec(e.id) : null;
  if (!m) return { ok: false, error: "id must look like TICKER-n" };
  if (m[1] !== e.ticker) return { ok: false, error: "id prefix must equal ticker" };
  if (!tickers.includes(e.ticker)) return { ok: false, error: `ticker ${String(e.ticker).slice(0, 10)} is not covered` };
  if (typeof e.event !== "string" || !e.event.trim() || e.event.length > 400) return { ok: false, error: "event must be 1-400 characters" };
  if (!nullish(e.event_date) && !isDay(e.event_date)) return { ok: false, error: "event_date must be YYYY-MM-DD or null" };
  if (!RECALL_KINDS.includes(e.kind)) return { ok: false, error: `kind must be one of ${RECALL_KINDS.join(", ")}` };
  if (!RECALL_STATUSES.includes(e.status)) return { ok: false, error: `status must be one of ${RECALL_STATUSES.join(", ")}` };
  if (!nullish(e.public_url) && !(typeof e.public_url === "string" && /^https?:\/\//i.test(e.public_url) && e.public_url.length <= 600)) {
    return { ok: false, error: "public_url must be http(s), at most 600 characters, or null" };
  }
  if (!nullish(e.first_seen) && !isIso(e.first_seen)) return { ok: false, error: "first_seen must be ISO or null" };
  if (!nullish(e.lag_days) && !(typeof e.lag_days === "number" && Number.isFinite(e.lag_days))) return { ok: false, error: "lag_days must be a number or null" };
  if (!nullish(e.verdict) && !VERDICTS.includes(e.verdict)) return { ok: false, error: "verdict must be confirmed, partly or null" };
  if (!nullish(e.verdict_ref) && !(typeof e.verdict_ref === "string" && VERDICT_REF_RE.test(e.verdict_ref))) {
    return { ok: false, error: "verdict_ref must look like miss:TICKER:n or be null" };
  }
  if (!optText(e.captured_ref, 600)) return { ok: false, error: "captured_ref must be at most 600 characters" };
  if (!optText(e.notes, 1000)) return { ok: false, error: "notes must be at most 1000 characters" };
  if (!isIso(e.checked_at)) return { ok: false, error: "checked_at must be an ISO date or datetime" };
  const hasKind = !nullish(e.captured_kind), hasItem = !nullish(e.captured_item_id);
  if (hasKind !== hasItem || (hasKind && (!CAPTURED_KINDS.includes(e.captured_kind) || !Number.isInteger(e.captured_item_id) || e.captured_item_id < 1))) {
    return { ok: false, error: "captured_kind (coverage or aux) and captured_item_id (an id) go together, or both null" };
  }
  return {
    ok: true,
    event: {
      id: e.id, ticker: e.ticker, event: e.event, event_date: e.event_date ?? null, kind: e.kind, public_url: e.public_url ?? null,
      status: e.status, captured_kind: e.captured_kind ?? null, captured_item_id: e.captured_item_id ?? null,
      captured_ref: e.captured_ref ?? null, first_seen: e.first_seen ?? null, lag_days: e.lag_days ?? null,
      verdict: e.verdict ?? null, verdict_ref: e.verdict_ref ?? null, notes: e.notes ?? null, checked_at: e.checked_at,
    },
  };
}

const COLS = ["ticker", "event", "event_date", "kind", "public_url", "status", "captured_kind", "captured_item_id", "captured_ref",
  "first_seen", "lag_days", "verdict", "verdict_ref", "notes", "source", "checked_at", "loaded_at"];
const UPSERT = `INSERT INTO recall_events (id, ${COLS.join(", ")}) VALUES (${["id", ...COLS].map(() => "?").join(", ")})
  ON CONFLICT(id) DO UPDATE SET ${COLS.map((c) => `${c} = excluded.${c}`).join(", ")}`;

// Exact-URL matches, one set-based query per table: { url: { id, nm_first_seen } }.
async function urlHits(db, table, urls) {
  const rows = (await db.prepare(
    `SELECT url, MIN(id) AS id, MIN(nm_first_seen) AS nm_first_seen
       FROM ${table} WHERE url IN (SELECT value FROM json_each(?)) GROUP BY url LIMIT 200`,
  ).bind(JSON.stringify(urls)).all()).results || [];
  return new Map(rows.map((r) => [r.url, r]));
}

export async function recallLoad(env, body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.events)) return json({ error: "body.events must be an array" }, 400);
  if (typeof body.source !== "string" || !SOURCE_RE.test(body.source)) return json({ error: "source must be 1-60 characters of a-z, 0-9 and -" }, 400);
  if (!body.events.length || body.events.length > MAX_EVENTS) return json({ error: `events must hold 1-${MAX_EVENTS} events` }, 400);
  const dryRun = body.dry_run === true;
  const replace = body.replace === true;
  const db = env.DB;
  // A dry run too must say when migration 0015 is missing.
  try {
    await db.prepare("SELECT 1 FROM recall_events LIMIT 1").first();
  } catch (e) {
    if (missingTable(e)) return json({ error: MISSING }, 503);
    throw e;
  }
  const accepted = [], rejected = [];
  const seen = new Set();
  for (const raw of body.events) {
    const v = validateRecallEvent(raw);
    const id = typeof raw?.id === "string" ? raw.id.slice(0, 20) : null;
    if (!v.ok) { rejected.push({ id, error: v.error }); continue; }
    if (seen.has(v.event.id)) { rejected.push({ id, error: "duplicate id in this payload" }); continue; }
    seen.add(v.event.id);
    accepted.push(v.event);
  }
  // Captured items: two queries whatever the event count (items.url has no index of
  // its own). The same URL can belong to several events; the lowest id wins.
  const urls = [...new Set(accepted.filter((e) => e.public_url && e.captured_item_id == null).map((e) => e.public_url))];
  if (urls.length) {
    const [cov, aux] = await Promise.all([urlHits(db, "items", urls), urlHits(db, "aux_items", urls)]);
    for (const e of accepted) {
      if (e.captured_item_id != null || !e.public_url) continue;
      const hit = cov.get(e.public_url) ? ["coverage", cov.get(e.public_url)] : aux.get(e.public_url) ? ["aux", aux.get(e.public_url)] : null;
      if (!hit) continue;
      e.captured_kind = hit[0];
      e.captured_item_id = hit[1].id;
      if (!e.first_seen && hit[1].nm_first_seen) e.first_seen = hit[1].nm_first_seen;
    }
  }
  const byStatus = Object.fromEntries(RECALL_STATUSES.map((s) => [s, 0]));
  for (const e of accepted) byStatus[e.status]++;
  const keep = JSON.stringify(body.events.map((e) => (typeof e?.id === "string" ? e.id : null)).filter(Boolean));
  let replaced = 0;
  if (replace && accepted.length) {
    replaced = (await db.prepare("SELECT COUNT(*) AS n FROM recall_events WHERE source = ? AND id NOT IN (SELECT value FROM json_each(?))")
      .bind(body.source, keep).first())?.n || 0;
  }
  if (!dryRun && accepted.length) {
    const now = nowIso();
    const stmts = accepted.map((e) => db.prepare(UPSERT).bind(e.id, ...COLS.map((c) => (c === "source" ? body.source : c === "loaded_at" ? now : e[c]))));
    if (replace) stmts.push(db.prepare("DELETE FROM recall_events WHERE source = ? AND id NOT IN (SELECT value FROM json_each(?))").bind(body.source, keep));
    await db.batch(stmts);
  }
  return json({
    accepted: accepted.length, rejected, matched_items: accepted.filter((e) => e.captured_item_id != null).length,
    by_status: byStatus, dry_run: dryRun, replaced,
  });
}

const emptyCounts = () => ({ on_time: 0, late: 0, partial: 0, missed: 0, total: 0 });

// { total, by_status, by_kind: [{kind, on_time, late, partial, missed, total}], by_ticker: [...],
//   sources, checked_at, loaded_at }, plus events for the admin token with events=1.
export async function recallRoute(env, url, role) {
  const db = env.DB;
  let rows, meta, sources;
  try {
    [rows, meta, sources] = await Promise.all([
      db.prepare("SELECT kind, ticker, status, COUNT(*) AS n FROM recall_events GROUP BY kind, ticker, status LIMIT 1000").all(),
      db.prepare("SELECT MAX(checked_at) AS checked_at, MAX(loaded_at) AS loaded_at FROM recall_events LIMIT 1").first(),
      db.prepare("SELECT DISTINCT source FROM recall_events ORDER BY source LIMIT 50").all(),
    ]);
  } catch (e) {
    if (missingTable(e)) return json({ error: MISSING }, 503);
    throw e;
  }
  const all = emptyCounts();
  const kinds = new Map(), tickers = new Map();
  for (const r of rows.results || []) {
    if (!RECALL_STATUSES.includes(r.status)) continue;
    const n = Number(r.n) || 0;
    for (const [map, key] of [[kinds, r.kind], [tickers, r.ticker]]) {
      if (!map.has(key)) map.set(key, emptyCounts());
      map.get(key)[r.status] += n;
      map.get(key).total += n;
    }
    all[r.status] += n;
    all.total += n;
  }
  const list = (map, name) => [...map.entries()].map(([k, c]) => ({ [name]: k, ...c }))
    .sort((a, b) => b.total - a.total || String(a[name]).localeCompare(String(b[name])));
  const { total, ...byStatus } = all;
  const out = {
    total, by_status: byStatus, by_kind: list(kinds, "kind"), by_ticker: list(tickers, "ticker"),
    sources: (sources.results || []).map((r) => r.source), checked_at: meta?.checked_at || null, loaded_at: meta?.loaded_at || null,
  };
  // The event list is owner research: never for the app token, whatever it asks.
  if (role === "admin" && url.searchParams.get("events") === "1") {
    out.events = (await db.prepare(
      "SELECT * FROM recall_events ORDER BY ticker, CAST(substr(id, instr(id, '-') + 1) AS INTEGER), id LIMIT 1000",
    ).all()).results || [];
  }
  return json(out);
}
