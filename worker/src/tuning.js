// Reliability and tuning without labels (plans/round4-reliability-tuning.md,
// Part Z), for the app's Tuning page and grader health strip:
//   GET  /v1/ops               grader health: last run, gaps, status, heartbeat checks, backlog (Z3)
//   GET  /v1/source-prefs      muted and demoted sources (Z7)
//   POST /v1/source-prefs      { source_key, action: mute | demote | normal, note? } (Z7)
//   GET  /v1/source-yield      per-source grade yield with mute / demote suggestions (Z8)
//   GET  /v1/left-out          skipped items by skip reason (Z9)
//   POST /v1/left-out/grade    { kind, id }: one skipped item back to pending (Z9)
// Nothing here sends to Discord: the heartbeat checks are read only.
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { auxRoute } from "./aux-route.js";
import { heartbeatChecks } from "./delivery.js";
import { headlinesWaiting } from "./headlines.js";
import { json, nowIso, universeSql } from "./lib.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IN_UNIVERSE = universeSql(COVERED.tickers);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const clampInt = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || dflt));

// --- Source preferences (Z7) --------------------------------------------------
export const SOURCE_ACTIONS = ["mute", "demote", "normal"];
// For You orders a demoted source's cards as if scored this much lower.
export const DEMOTE_POINTS = 15;
// SQL subqueries of the muted and demoted source keys (migration 0011).
export const MUTED_SQL = "(SELECT source_key FROM source_prefs WHERE action = 'mute')";
export const DEMOTED_SQL = "(SELECT source_key FROM source_prefs WHERE action = 'demote')";

// A source key zenith-core can see: a coverage source (covered or
// counterparty), an auxiliary source, or a runtime managed_* / ia_* key that
// auxRoute routes.
export function knownSource(key) {
  if (has(COVERED.sources, key) || has(COVERED.counterparty, key) || has(AUX.sources, key)) return true;
  return /^(managed|ia)_./.test(key) && auxRoute(key) != null;
}
// Whether a source may be muted, demoted or suggested for either: never an SEC
// source (edgar_*, or an auxiliary source marked sec: an SEC filing adapter
// such as einride_sec or paccar) or a covered company's own channel (a
// covered.json source with no role). Returns null when it may, else the reason
// it may not.
export function prefRefusal(key) {
  const lock = prefLock(key);
  if (lock === "bad_key") return "source_key must be a source key";
  if (lock === "sec") return `${key} is an SEC source: SEC filings are never muted or demoted`;
  if (lock === "unknown") return `unknown source ${key}: use a coverage or auxiliary source key`;
  if (lock === "own_channel") return `${key} is ${COVERED.sources[key]}'s own channel: a covered company's own sources are never muted or demoted`;
  return null;
}
// Why prefRefusal refuses a key, as a code: bad_key, sec, unknown or
// own_channel; null when it may be muted or demoted.
export function prefLock(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(key)) return "bad_key";
  if (key.startsWith("edgar_") || (has(AUX.sources, key) && AUX.sources[key].sec === true)) return "sec";
  if (!knownSource(key)) return "unknown";
  if (has(COVERED.sources, key)) return "own_channel";
  return null;
}

// The muted source keys, for the ingests. A zenith-db without the table (before
// migration 0011) mutes nothing, so ingest never fails over it.
export async function mutedSources(db) {
  try {
    return new Set(((await db.prepare("SELECT source_key FROM source_prefs WHERE action = 'mute'").all()).results || []).map((r) => r.source_key));
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e))) return new Set();
    throw e;
  }
}

export async function getSourcePrefs(env) {
  const rows = (await env.DB.prepare("SELECT source_key, action, note, updated_at FROM source_prefs ORDER BY source_key").all()).results || [];
  return json({ prefs: rows });
}

// Saving a mute also parks the source's pending items, and its claimed ones
// whose lease ran out, as muted_source in both pipelines. normal deletes the
// row: future items flow again, and parked items stay parked (Left out can
// send one back to the grader).
export async function postSourcePrefs(env, body) {
  const key = typeof body?.source_key === "string" ? body.source_key.trim() : body?.source_key;
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!SOURCE_ACTIONS.includes(action)) return json({ error: `action must be one of ${SOURCE_ACTIONS.join(", ")}` }, 400);
  const refusal = prefRefusal(key);
  if (refusal) return json({ error: refusal }, 400);
  const db = env.DB;
  const now = nowIso();
  if (action === "normal") {
    await db.prepare("DELETE FROM source_prefs WHERE source_key = ?").bind(key).run();
    return json({ ok: true, source_key: key, action, parked: { coverage: 0, aux: 0 } });
  }
  const note = body?.note == null || body.note === "" ? null : String(body.note).slice(0, 500);
  const stmts = [db.prepare(
    `INSERT INTO source_prefs (source_key, action, note, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET action = excluded.action, note = excluded.note, updated_at = excluded.updated_at`,
  ).bind(key, action, note, now)];
  if (action === "mute") {
    for (const table of ["items", "aux_items"]) {
      stmts.push(db.prepare(
        `UPDATE ${table} SET state = 'skipped', skip_reason = 'muted_source', claim_id = NULL, claimed_until = NULL
          WHERE source_key = ? AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?))`,
      ).bind(key, now));
    }
  }
  const res = await db.batch(stmts);
  return json({ ok: true, source_key: key, action, parked: { coverage: res[1]?.meta?.changes || 0, aux: res[2]?.meta?.changes || 0 } });
}

// --- Source yield (Z8) ----------------------------------------------------------
// Each row carries mutable (false when prefRefusal refuses the key, so the app
// offers no Mute or Demote) and lock (prefLock's code, null when mutable).
// suggest: mute when graded >= 10 with no score >= 70 and reject + duplicate
// >= 90%; demote when graded >= 6 with reject >= 75%; never for a source
// prefRefusal refuses, nor one already set that way, nor a muted one (a
// demote suggestion there would unmute it).
export function suggestFor(row) {
  if (prefRefusal(row.source_key) || row.pref === "mute") return null;
  let s = null;
  if (row.graded >= 10 && row.high === 0 && (row.reject + row.duplicate) >= 0.9 * row.graded) s = "mute";
  else if (row.graded >= 6 && row.reject >= 0.75 * row.graded) s = "demote";
  return s && s !== row.pref ? s : null;
}

const YIELD = {
  coverage: { table: "items", grades: "grades", where: `i.ticker IN ${IN_UNIVERSE}`, covered: false },
  aux: { table: "aux_items", grades: "aux_grades", where: "1", covered: true },
};
const n1 = (sql) => `SUM(CASE WHEN ${sql} THEN 1 ELSE 0 END)`;

export async function sourceYield(env, url) {
  const days = clampInt(url.searchParams.get("days"), 1, 90, 30);
  const since = nowIso(Date.now() - days * DAY);
  const prefs = new Map(((await env.DB.prepare("SELECT source_key, action FROM source_prefs").all()).results || []).map((r) => [r.source_key, r.action]));
  const out = { days };
  for (const [kind, k] of Object.entries(YIELD)) {
    // The latest grade per item (grade_id), items first seen in the window.
    const rows = (await env.DB.prepare(
      `SELECT i.source_key, COUNT(*) AS graded, ${n1("g.score >= 70")} AS high, ${n1("g.band = 'reject'")} AS reject,
              ${n1("g.band = 'duplicate'")} AS duplicate${k.covered ? `, ${n1("g.band = 'covered'")} AS covered` : ""},
              MAX(CASE WHEN g.score >= 70 THEN i.nm_first_seen END) AS last_high_at
         FROM ${k.table} i JOIN ${k.grades} g ON g.id = i.grade_id
        WHERE i.nm_first_seen >= ? AND ${k.where}
        GROUP BY i.source_key ORDER BY graded DESC, i.source_key`,
    ).bind(since).all()).results || [];
    out[kind] = rows.map((r) => {
      const row = { ...r, pref: prefs.get(r.source_key) || null };
      const lock = prefLock(r.source_key);
      return { ...row, suggest: suggestFor(row), mutable: lock === null, lock };
    });
  }
  return json(out);
}

// --- Left out (Z9) ------------------------------------------------------------
const LEFT = {
  coverage: { table: "items", name: "i.ticker AS ticker", where: `i.ticker IN ${IN_UNIVERSE}`, other: "aux" },
  aux: { table: "aux_items", name: "i.entity_name AS entity", where: "1", other: "coverage" },
};
const leftKind = (kind) => (has(LEFT, kind) ? LEFT[kind] : null);
// The same news-monitor item's row in the other pipeline when it shows there:
// any coverage row not skipped, or an aux row not skipped and not graded
// 'covered' (the aux page hides those, except a rival row's copy while its
// coverage copy stays rival_no_key_account: rescuing that coverage copy moves
// the item to Coverage, and the aux feed hides the aux copy again). Rescuing
// an item with such a twin would put it on both pages (Z11).
// nm: the SQL of the news-monitor rowid (a bind, or the outer row's column).
const TWIN_FROM = {
  coverage: (nm) => `FROM items t WHERE t.nm_rowid = ${nm} AND t.state != 'skipped'`,
  aux: (nm) => `FROM aux_items t LEFT JOIN aux_grades tg ON tg.id = t.grade_id
         WHERE t.nm_rowid = ${nm} AND t.state != 'skipped' AND (tg.band IS NULL OR tg.band != 'covered')`,
};
const TWIN_SQL = { coverage: `SELECT t.id, t.state ${TWIN_FROM.coverage("?")}`, aux: `SELECT t.id, t.state ${TWIN_FROM.aux("?")}` };

// Skipped items, newest first, with counts per skip reason over the window.
// archive_seed rows (day-one archive pages) only when asked for by name. Each
// item carries gradeable (false when leftOutGrade would refuse it: its source
// is still muted, or its twin is shown on the other page) and blocked (why
// not, else null).
export async function leftOut(env, url) {
  const q = url.searchParams;
  const kind = q.get("kind") || "coverage";
  const k = leftKind(kind);
  if (!k) return json({ error: "kind must be coverage or aux" }, 400);
  const reason = q.get("reason") || "";
  if (reason && !/^[a-z_]{1,40}$/.test(reason)) return json({ error: "reason must be a skip_reason such as muted_source or stale_on_arrival" }, 400);
  const days = clampInt(q.get("days"), 1, 90, 14);
  const limit = clampInt(q.get("limit"), 1, 200, 50);
  const since = nowIso(Date.now() - days * DAY);
  const base = `FROM ${k.table} i WHERE i.state = 'skipped' AND i.nm_first_seen >= ? AND ${k.where}`;
  const items = (await env.DB.prepare(
    `SELECT i.id, '${kind}' AS kind, ${k.name}, i.source_key, i.title, i.url, i.nm_first_seen AS first_seen, i.skip_reason,
            (SELECT t.id ${TWIN_FROM[k.other]("i.nm_rowid")} LIMIT 1) AS twin_id,
            (SELECT t.state ${TWIN_FROM[k.other]("i.nm_rowid")} LIMIT 1) AS twin_state
       ${base} AND ${reason ? "i.skip_reason = ?" : "i.skip_reason IS NOT 'archive_seed'"}
      ORDER BY i.nm_first_seen DESC, i.id DESC LIMIT ?`,
  ).bind(since, ...(reason ? [reason] : []), limit).all()).results || [];
  const counts = Object.fromEntries(((await env.DB.prepare(
    `SELECT COALESCE(i.skip_reason, 'unknown') AS r, COUNT(*) AS n ${base} GROUP BY 1 ORDER BY n DESC, r`,
  ).bind(since).all()).results || []).map((r) => [r.r, r.n]));
  const muted = await mutedSources(env.DB);
  const page = { coverage: "Coverage", aux: "Auxiliary" }[k.other];
  for (const it of items) {
    const { twin_id: twinId, twin_state: twinState } = it;
    delete it.twin_id;
    delete it.twin_state;
    it.blocked = it.skip_reason === "muted_source" && muted.has(it.source_key) ? `${it.source_key} is still muted: set it back to normal first`
      : twinId != null ? `already on the ${page} page (${k.other} item ${twinId}, ${twinState}): one item is never on both pages` : null;
    it.gradeable = it.blocked === null;
  }
  return json({ kind, reason: reason || null, days, counts, items });
}

// One skipped item back to pending (attempts 0, claim cleared), so the next
// grader run grades it. A muted_source item waits while its source is muted,
// and an item already shown on the other page (rival_no_key_account on
// Coverage with its aux copy, on_coverage in aux) stays where it is.
export async function leftOutGrade(env, body) {
  const k = leftKind(body?.kind);
  if (!k) return json({ error: "kind must be coverage or aux" }, 400);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "id must be the item id" }, 400);
  const item = await env.DB.prepare(`SELECT id, nm_rowid, state, skip_reason, source_key FROM ${k.table} WHERE id = ?`).bind(id).first();
  if (!item) return json({ error: `unknown ${body.kind} item ${id}` }, 404);
  if (item.state !== "skipped") return json({ error: `${body.kind} item ${id} is ${item.state}, not skipped` }, 400);
  if (item.skip_reason === "muted_source" && (await mutedSources(env.DB)).has(item.source_key)) {
    return json({ error: `${item.source_key} is still muted: set it back to normal first` }, 400);
  }
  const twin = await env.DB.prepare(TWIN_SQL[k.other]).bind(item.nm_rowid).first();
  if (twin) return json({ error: `${body.kind} item ${id} is on the ${k.other} page as ${k.other} item ${twin.id} (${twin.state}): one item is never on both pages` }, 400);
  const r = await env.DB.prepare(
    `UPDATE ${k.table} SET state = 'pending', skip_reason = NULL, attempts = 0, claim_id = NULL, claimed_until = NULL WHERE id = ? AND state = 'skipped'`,
  ).bind(id).run();
  return json({ ok: r.meta.changes > 0, kind: body.kind, id, was: item.skip_reason, state: "pending" });
}

// --- Grader health (Z3) -------------------------------------------------------
export const OPS_OK_MIN = 90;
export const OPS_LATE_MIN = 180;
export const GAP_HOURS = 2;
const GAP_DAYS = 7;

// runs: { started_at, last_seen_at } in any order. A gap is the time from one
// run's last activity to the next run's start, when it is over GAP_HOURS;
// only gaps ending at or after `since` count.
export function runGaps(runs, since) {
  const sorted = [...runs].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const gaps = [];
  for (let k = 1; k < sorted.length; k++) {
    const from = sorted[k - 1].last_seen_at, to = sorted[k].started_at;
    const ms = Date.parse(to) - Date.parse(from);
    if (to >= since && Number.isFinite(ms) && ms > GAP_HOURS * HOUR) gaps.push({ from, to, hours: Math.round((ms / HOUR) * 10) / 10 });
  }
  return gaps;
}

export function graderStatus(lastRunAt, now) {
  const ms = Date.parse(lastRunAt || "");
  if (!Number.isFinite(ms)) return "down";
  const age = now - ms;
  return age < OPS_OK_MIN * 60_000 ? "ok" : age <= OPS_LATE_MIN * 60_000 ? "late" : "down";
}

export async function ops(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const since = nowIso(now - GAP_DAYS * DAY);
  const COLS = "id, started_at, last_seen_at, claimed, graded, rejected";
  const runs = (await db.prepare(`SELECT ${COLS} FROM runs WHERE last_seen_at >= ? OR started_at >= ? ORDER BY started_at`).bind(since, since).all()).results || [];
  // The run before the window, so a gap that ends inside it is seen.
  const before = await db.prepare(`SELECT ${COLS} FROM runs WHERE last_seen_at < ? AND started_at < ? ORDER BY last_seen_at DESC LIMIT 1`).bind(since, since).first();
  const last = await db.prepare(`SELECT ${COLS} FROM runs ORDER BY last_seen_at DESC LIMIT 1`).first();
  const day = await db.prepare("SELECT COUNT(*) AS n FROM runs WHERE started_at >= ?").bind(nowIso(now - DAY)).first();
  const count = async (sql) => (await db.prepare(sql).first())?.n || 0;
  const oldestAux = await db.prepare("SELECT MIN(nm_first_seen) AS t FROM aux_items WHERE state IN ('pending','claimed')").first();
  const grader = {
    last_run_at: last?.last_seen_at || null,
    last_run: last ? { id: last.id, started_at: last.started_at, last_seen_at: last.last_seen_at, claimed: last.claimed, graded: last.graded, rejected: last.rejected } : null,
    runs_24h: day?.n || 0,
    gaps_7d: runGaps(before ? [before, ...runs] : runs, since),
    status: graderStatus(last?.last_seen_at, now),
    checks: await heartbeatChecks(db, now),
    backlog: {
      coverage_pending: await count(`SELECT COUNT(*) AS n FROM items WHERE state IN ('pending','claimed') AND ticker IN ${IN_UNIVERSE}`),
      aux_pending: await count("SELECT COUNT(*) AS n FROM aux_items WHERE state IN ('pending','claimed')"),
      headlines_waiting: await headlinesWaiting(env),
      oldest_aux_pending_at: oldestAux?.t || null,
    },
  };
  return json({ grader, as_of: nowIso(now) });
}
