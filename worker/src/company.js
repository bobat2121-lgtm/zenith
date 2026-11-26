// Phase 3 Part B (P3-B2): the Company page's data, for one covered name at a
// time. GET /v1/company?ticker=&days=&section= (app and admin tokens; index.js)
// returns it as JSON; the portal's Company view (/p/c/<T>) renders the same
// object. Nine sections in the audit's order (own items, filings, ownership,
// registers, series, rivals, key accounts, calendar, source health), the
// "all quiet" line, and three filled counts (strict, strict without rejects,
// lenient) so the exit test can be read under any of the rules.
//
// Read-only and rendered on request: no write, no grade, no cron, no fetch.
// The only module the portal import walk lets read env.NEWS (SELECT only:
// source_state with ops_alerts, universe_managed_health, series_points). A
// news-monitor-db failure never fails the page: source health then reads
// "unavailable" and the series section is empty.
//
// Reads (each with a LIMIT; one zenith-db batch, one NEWS batch, plus the
// council-agenda reads of calendar.js for a name with legistar channels):
//   QM   muted source keys (skipped when the caller passes the keys)
//   Q1   the name's items, 30 days, idx_items_ticker
//   Q2   aux rows of the name's aux channels, live rows, aux_items_source_live
//   Q2e  aux rows of the name's competitor entities from other sources,
//        live rows, aux_items_entity_live
//   Q3   other names' items graded for this name, idx_grades_ticker_graded
//   Q4   source_state (+ open ops_alerts) of the channel keys       (NEWS)
//   Q4m  universe_managed_health of managed keys Q2e reached          (NEWS)
//   Q6   series_points of the name, with the series' _total lines    (NEWS)
// The aux reads say `state != 'skipped'` (never an IN list of the other
// states): only that form implies the partial indexes' WHERE (migration 0023).
//
// Imports no tuning.js, auxiliary.js, brief.js or index.js (the portal import
// walk, test/portal-imports.test.js).
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { isRecordSource } from "./records.js";
import { isHttpUrl, json } from "./lib.js";
import { noticeDate, occurrences, councilAgendas } from "./calendar.js";
import { CALENDAR, CALENDAR_VERSION } from "./calendar.generated.js";
import { COVERED_NAMES } from "./rubric.generated.js";
import { loadRelations } from "./relations.js";
import { addDays, etParts } from "./et.js";

// The nine sections, in the audit's order.
export const SECTIONS = ["own", "filings", "ownership", "registers", "series", "rivals", "key_accounts", "calendar", "source_health"];
// The sections of stored rows (the "new in 24 hours" count and the filled rule).
export const ROW_SECTIONS = ["own", "filings", "ownership", "registers", "rivals", "key_accounts"];
// The sections that can count as filled (source health and reference lists never do).
const FILL_SECTIONS = SECTIONS.filter((s) => s !== "source_health");
export const RULES = ["strict", "strict_no_reject", "lenient"];
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 30;
export const SECTION_ROWS = 8;
export const SECTION_ROWS_ALL = 100;
// Council agendas need their 120-day read on idx_items_source (calendar.js
// LEGISTAR_RANGE); off would leave the calendar to sheet entries and notices.
export const COUNCIL_AGENDAS = true;
// source-signals.js MANAGED_FAIL_MIN: a managed source is failing at 3 failed polls.
export const MANAGED_FAIL_MIN = 3;
// A source whose next poll is this far past is overdue.
const OVERDUE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const LIMITS = { qm: 500, q1: 1000, q2: 300, q2e: 300, q3: 100, q4: 80, q4m: 40, q6: 60 };
const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const KA_ROLES = new Set(["customer", "program", "relationship", "index_event"]);
// calendar.js NOTICE_FLAGS (graded date notices), the same four flags.
export const NOTICE_FLAGS = ["reason:calendar_card", "group:earnings_calendar", "floor:calendar", "floor:investor_day"];
// Ownership filings by title (Forms 144 and NPORT-P are not lib.js SEC_FORMS
// tags, so they match by title only) or by headline tag.
export const OWNERSHIP_TITLE_RE = /\bForm (3|4|5|144)\b|\bSC(HEDULE)? 13[DG]\b|\b13[DG]\/A\b|: D filed|\bNPORT-P\b/i;
export const OWNERSHIP_TAG_RE = /^(Form [345]|SC 13[DG]|SCHEDULE 13[DG]|D)(\/A)?$/;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const affectsOf = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);
const iso = (ms) => new Date(ms).toISOString();
const msOf = (s) => {
  const ms = Date.parse(s ?? "");
  return Number.isFinite(ms) ? ms : null;
};

// --- The channel map --------------------------------------------------------------------------

// The name's source keys by group, from covered.json, aux-sources.json and the
// relations module (0 rows read). First match wins, so every key is in one
// group. Built on first use and kept per isolate (cron invocations pay nothing);
// `rel` is for tests and is never cached.
const channelMemo = new Map();
export function channelsFor(ticker, rel = null) {
  if (!rel && channelMemo.has(ticker)) return channelMemo.get(ticker);
  const out = buildChannels(ticker, rel || loadRelations());
  if (!rel) channelMemo.set(ticker, out);
  return out;
}

function buildChannels(T, rel) {
  const comp = rel.competitorsOf(T);
  const groups = { own: [], sec: [], registers: [], rivals: [], key_accounts: [] };
  const groupOf = new Map();
  const put = (g, k) => {
    if (groupOf.has(k)) return;
    groupOf.set(k, g);
    groups[g].push(k);
  };
  for (const [k, t] of Object.entries(COVERED.sources || {})) if (t === T) put(isRecordSource(k) ? "sec" : "own", k);
  // Counterparty keys follow their role (a twin of an aux key, relations.js sourceClass "twin:<role>").
  for (const [k, cp] of Object.entries(COVERED.counterparty || {})) {
    if (!affectsOf(cp?.affects).includes(T)) continue;
    if (cp.role === "rival") put("rivals", k);
    else if (isRecordSource(k)) put("registers", k);
    else if (KA_ROLES.has(cp.role)) put("key_accounts", k);
  }
  // Aux keys: a search about T (coverage_subject naming T), else a competitor's source.
  for (const [k, s] of Object.entries(AUX.sources || {})) {
    if (groupOf.has(k)) continue;
    const competitor = comp.has(s?.entity);
    const cls = rel.sourceClass(k);
    if (s?.coverage_subject && affectsOf(s.affects).includes(T)) {
      // A competitor's SEC feed is a rival channel, never a register (relations.js sourceClass).
      if (cls === "sec_feed" && competitor) put("rivals", k);
      else if (isRecordSource(k)) put("registers", k);
      else if (competitor) put("rivals", k);
      else put("key_accounts", k);
    } else if (competitor && rivalByRule(rel, T, k, s)) {
      put("rivals", k);
    }
  }
  const all = [...groups.own, ...groups.sec, ...groups.registers, ...groups.rivals, ...groups.key_accounts];
  const channel = Object.fromEntries(all.map((k) => [k, own(COVERED.channels, k) ? "direct" : "search or filtered feed"]));
  return {
    ticker: T,
    ...groups,
    legistar: all.filter((k) => k.startsWith("legistar_")),
    auxKeys: all.filter((k) => own(AUX.sources, k)),
    entities: [...comp.keys()],
    groupOf,
    channel,
  };
}

// A competitor's aux source is a rival channel for T only when the one rivals
// rule places its rows with T (a register or a program source of a
// competitor is industry news, relations.js placeAux).
function rivalByRule(rel, T, key, s) {
  return rel.rivalTickers({ source_key: key, entity_key: s?.entity || key, status: s?.status ?? null, coverage_subject: s?.coverage_subject ? 1 : 0 }, "aux").includes(T);
}

// --- Small helpers ------------------------------------------------------------------------------

// Error text from a source adapter, safe to show: query values whose name
// looks like a key, token, secret, signature or auth are replaced, and so is a
// bearer token; then clipped to n characters.
export function redactError(s, n = 160) {
  if (s === null || s === undefined) return null;
  const out = String(s)
    .replace(/(^|[?&;\s])([^=&\s#;?]*(?:key|token|secret|sig|auth)[^=&\s#;?]*)=[^&\s#;]*/gi, "$1$2=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  return out.length > n ? `${out.slice(0, Math.max(0, n - 1)).trimEnd()}…` : out;
}

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// Parses the query of GET /v1/company (and the portal view). -> { ticker, days,
// section } or { error, status }.
export function parseCompanyQuery(params) {
  const raw = String(params.get("ticker") ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(raw) || !(COVERED.tickers || []).includes(raw)) return { error: "unknown ticker", status: 404 };
  let days = DEFAULT_DAYS;
  if (params.has("days")) {
    const d = String(params.get("days"));
    if (!/^\d{1,2}$/.test(d) || Number(d) < 1 || Number(d) > MAX_DAYS) return { error: `days must be an integer 1-${MAX_DAYS}`, status: 400 };
    days = Number(d);
  }
  const section = params.get("section");
  if (section !== null && section !== "" && !SECTIONS.includes(section)) return { error: "unknown section", status: 400 };
  return { ticker: raw, days, section: section || null };
}

// GET /v1/company (after auth): validation first, so an unknown ticker reads nothing.
export async function companyRoute(env, url) {
  const q = parseCompanyQuery(url.searchParams);
  if (q.error) return json({ error: q.error }, q.status);
  const data = await companyData(env, q.ticker, { days: q.days, section: q.section });
  if (data.error) return json({ error: data.error }, data.status || 404);
  return json(data);
}

// --- The SQL --------------------------------------------------------------------------------------

const Q1_SQL = `SELECT i.id, i.nm_rowid, i.ticker, i.source_key, i.role, i.state, i.skip_reason, i.admit, i.released_at, i.title, i.headline,
       i.headline_tag, i.url, i.published, i.nm_first_seen, i.story_of, g.id AS grade_id, g.ticker AS grade_ticker, g.score, g.band, g.why,
       g.note_hook, g.event_type, g.flags, g.dup_of, g.read_source
  FROM items i LEFT JOIN grades g ON g.id = i.grade_id
 WHERE i.ticker = ?1 AND i.nm_first_seen >= ?2 AND COALESCE(i.skip_reason,'') NOT IN ('bad_url','muted_source')
 ORDER BY i.nm_first_seen DESC LIMIT ${LIMITS.q1}`;
const AUX_COLS = `a.id, a.nm_rowid, a.source_key, a.entity_key, a.entity_name, a.status, a.coverage_subject, a.affects, a.title, a.headline,
       a.headline_tag, a.url, a.published, a.nm_first_seen, a.state, a.admit, a.released_at, a.story_of, g.id AS grade_id, g.band, g.score,
       g.why, g.event_type, g.covered_ticker, g.reads_through, g.dup_of, g.read_source`;
const Q2_SQL = `SELECT ${AUX_COLS}
  FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id
 WHERE a.source_key IN (SELECT value FROM json_each(?1)) AND a.state != 'skipped' AND a.nm_first_seen >= ?2
 ORDER BY a.nm_first_seen DESC LIMIT ${LIMITS.q2}`;
// "Not one of the name's aux keys" is a string test on the bound JSON list
// (?2, keys quoted, so '"key"' matches exactly one entry), not
// `NOT IN (SELECT value FROM json_each(?2))`: the same rows, but the list
// subquery costs a read per probe on top of reading the list, and the window
// rows of the competitor entities are probed one by one. Source keys never
// hold a quote or a backslash (test/company-plan.test.js).
const Q2E_SQL = `SELECT ${AUX_COLS}
  FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id
 WHERE a.entity_key IN (SELECT value FROM json_each(?1)) AND instr(?2, '"' || a.source_key || '"') = 0
   AND a.state != 'skipped' AND a.nm_first_seen >= ?3
 LIMIT ${LIMITS.q2e}`;
const Q3_SQL = `SELECT g.id, g.item_id, g.run_id, g.score, g.band, g.why, g.event_type, i.ticker AS item_ticker, i.source_key, i.title, i.url,
       i.published, i.nm_first_seen, (SELECT p.run_id FROM grades p WHERE p.id = i.grade_id) AS primary_run
  FROM grades g JOIN items i ON i.id = g.item_id
 WHERE g.ticker = ?1 AND g.graded_at >= ?2 AND g.score IS NOT NULL AND i.ticker != ?1 AND i.nm_first_seen >= ?2
 ORDER BY g.graded_at DESC LIMIT ${LIMITS.q3}`;
const QM_SQL = `SELECT source_key FROM source_prefs WHERE action = 'mute' LIMIT ${LIMITS.qm}`;
const Q4_SQL = `SELECT s.key, s.last_ok, s.fail_count, substr(s.last_error,1,160) AS last_error, s.next_poll_at,
       (SELECT group_concat(o.rule) FROM ops_alerts o WHERE o.source_key = s.key AND o.resolved_at IS NULL) AS open_rules
  FROM source_state s WHERE s.key IN (SELECT value FROM json_each(?1)) LIMIT ${LIMITS.q4}`;
const Q4M_SQL = `SELECT key, last_ok, fail_count, substr(last_error,1,160) AS last_error, next_poll_at
  FROM universe_managed_health WHERE key IN (SELECT value FROM json_each(?1)) LIMIT ${LIMITS.q4m}`;
const Q6_SQL = `SELECT series, subject, period, value, label, record_url, observed_at, ticker FROM series_points
 WHERE (ticker = ?1 AND period >= ?2)
    OR (subject IN ('_total','_companies') AND period >= ?2 AND series IN (SELECT series FROM series_points WHERE ticker = ?1))
 ORDER BY series, subject, period DESC LIMIT ${LIMITS.q6}`;

// The statements as text, for the plan test (test/company-plan.test.js).
export const COMPANY_SQL = { QM: QM_SQL, Q1: Q1_SQL, Q2: Q2_SQL, Q2E: Q2E_SQL, Q3: Q3_SQL, Q4: Q4_SQL, Q4M: Q4M_SQL, Q6: Q6_SQL };

const missingTable = (e) => /no such (table|column)/i.test(String(e?.message || e));
const rowsRead = (r) => Number(r?.meta?.rows_read) || 0;

// --- The data ---------------------------------------------------------------------------------------

// companyData(env, ticker, { days, now, section, muted, rel }) -> the page's data,
// or { error, status } (an unknown ticker reads nothing).
// muted: the muted source keys (a Set or an array) when the caller has them;
// anything else (null, or the MUTED_SQL fragment the portal carries) runs QM.
// rel: a loadRelations() object (tests only).
export async function companyData(env, ticker, { days = DEFAULT_DAYS, now = Date.now(), section = null, muted = null, rel = null } = {}) {
  const T = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
  if (!TICKER_RE.test(T) || !(COVERED.tickers || []).includes(T)) return { error: "unknown ticker", status: 404 };
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { error: `days must be an integer 1-${MAX_DAYS}`, status: 400 };
  if (section !== null && !SECTIONS.includes(section)) return { error: "unknown section", status: 400 };
  const relations = rel || loadRelations();
  const ch = channelsFor(T, rel);
  const fromMs = now - days * DAY_MS;
  const from30 = iso(now - MAX_DAYS * DAY_MS);
  const today = etParts(now).date;
  const reads = { zenith: 0, news: 0 };
  const truncated = { q1: false, q2: false, q2e: false, q3: false, q4: false, q4m: false, q6: false, muted: false };

  // One zenith-db batch: QM (unless given), Q1, Q2 (if any aux key), Q2e (if any competitor), Q3.
  const mutedGiven = muted instanceof Set || Array.isArray(muted);
  const plan = [];
  if (!mutedGiven) plan.push(["qm", env.DB.prepare(QM_SQL)]);
  plan.push(["q1", env.DB.prepare(Q1_SQL).bind(T, from30)]);
  if (ch.auxKeys.length) plan.push(["q2", env.DB.prepare(Q2_SQL).bind(JSON.stringify(ch.auxKeys), from30)]);
  if (ch.entities.length) plan.push(["q2e", env.DB.prepare(Q2E_SQL).bind(JSON.stringify(ch.entities), JSON.stringify(ch.auxKeys), from30)]);
  plan.push(["q3", env.DB.prepare(Q3_SQL).bind(T, from30)]);
  let results;
  try {
    results = await env.DB.batch(plan.map(([, s]) => s));
  } catch (e) {
    // A zenith-db without source_prefs (before migration 0011) mutes nothing.
    if (mutedGiven || !missingTable(e)) throw e;
    plan.shift();
    results = [{ results: [] }, ...await env.DB.batch(plan.map(([, s]) => s))];
    plan.unshift(["qm", null]);
  }
  const got = {};
  plan.forEach(([k], i) => {
    got[k] = results[i]?.results || [];
    reads.zenith += rowsRead(results[i]);
    if (k !== "qm" && got[k].length >= LIMITS[k]) truncated[k] = true;
  });
  if (got.qm && got.qm.length >= LIMITS.qm) truncated.muted = true;
  const mutedSet = mutedGiven ? new Set(muted) : new Set((got.qm || []).map((r) => r.source_key));

  // Council agendas (calendar.js, unchanged code, its own two reads) for a name with legistar channels.
  let agendas = [];
  if (COUNCIL_AGENDAS && ch.legistar.length) {
    try {
      agendas = (await councilAgendas(env.DB, { sinceIso: iso(now - 120 * DAY_MS) })).filter((e) => e.ticker === T);
    } catch {
      console.error("company: council agendas failed");
    }
  }

  const sections = Object.fromEntries(SECTIONS.map((s) => [s, { rows: [], shown: 0, left_out: { n: 0, reasons: {} }, filled: false }]));
  const fill = Object.fromEntries(FILL_SECTIONS.map((s) => [s, { strict: false, strict_no_reject: false, lenient: false }]));
  const leftOut = (sec, reason) => {
    const lo = sections[sec].left_out;
    lo.n++;
    lo.reasons[reason] = (lo.reasons[reason] || 0) + 1;
  };
  const counts = (sec, row) => {
    fill[sec].strict = true;
    fill[sec].lenient = true;
    if (row.band !== "reject") fill[sec].strict_no_reject = true;
  };
  const inWindow = (r) => {
    const ev = msOf(r.published) ?? msOf(r.nm_first_seen);
    return ev !== null && ev >= fromMs;
  };

  // Q1: the name's coverage rows (partition steps 1-7; first match wins).
  const shownRowids = new Set();
  for (const r of got.q1 || []) {
    if (mutedSet.has(r.source_key) || !inWindow(r)) continue;
    const key = r.source_key;
    let sec = null;
    if (ch.groupOf.get(key) === "sec") {
      sec = OWNERSHIP_TITLE_RE.test(String(r.title || "")) || OWNERSHIP_TAG_RE.test(String(r.headline_tag || "")) ? "ownership" : "filings";
    } else if (ch.groupOf.get(key) === "own") sec = "own";
    else if (r.role === "rival") sec = "rivals";
    else if (isRecordSource(key)) sec = "registers";
    else if (KA_ROLES.has(r.role)) sec = "key_accounts";
    if (!sec) continue;
    const held = r.admit !== null && r.admit !== undefined && (r.released_at === null || r.released_at === undefined);
    const shown = r.state !== "skipped" && !held;
    // The ownership strip also lists dated filings stored skipped ("on record, not graded").
    const onRecord = sec === "ownership" && !shown && !held && !!r.published;
    if (!shown && !onRecord) {
      leftOut(sec, held ? "held" : r.skip_reason || r.state || "other");
      continue;
    }
    if (shown && r.nm_rowid !== null && r.nm_rowid !== undefined) shownRowids.add(r.nm_rowid);
    const row = coverageRow(r, T);
    if (onRecord) row.on_record = true;
    sections[sec].rows.push(row);
    counts(sec, row);
  }

  // Q2 and Q2e: aux rows (partition steps 8-11). A row in both reads is taken once.
  const seenAux = new Set();
  const managedKeys = new Set(), entitySources = new Set();
  const auxRows = [...(got.q2 || []).map((r) => [r, "source"]), ...(got.q2e || []).map((r) => [r, "entity"])];
  for (const [r, via] of auxRows) {
    if (seenAux.has(r.id)) continue;
    seenAux.add(r.id);
    if (via === "entity" && r.source_key) (String(r.source_key).startsWith("managed_") ? managedKeys : entitySources).add(r.source_key);
    if (mutedSet.has(r.source_key) || !inWindow(r)) continue;
    const group = via === "source" ? ch.groupOf.get(r.source_key) || "rivals" : "rivals";
    // 8. The coverage copy stands for a twin that is shown there.
    if (r.nm_rowid !== null && r.nm_rowid !== undefined && shownRowids.has(r.nm_rowid)) continue;
    const held = r.admit !== null && r.admit !== undefined && (r.released_at === null || r.released_at === undefined);
    if (held) { leftOut(group, "held"); continue; }
    // 9. A search about a covered name shows once it is graded (auxiliary.js auxFeed).
    if (r.coverage_subject && (r.grade_id === null || r.grade_id === undefined)) { leftOut(group, "waiting for a grade"); continue; }
    const isRival = relations.rivalTickers(r, "aux").includes(T);
    let sec;
    if (r.band === "covered") {
      // 10. A row the grader banded "covered" belongs on its covered name's page only.
      if (r.covered_ticker !== T) {
        leftOut(group, `about ${r.covered_ticker || "another name"}`);
        if (affectsOf(r.affects).includes(T)) fill[isRecordSource(r.source_key) ? "registers" : group].lenient = true;
        continue;
      }
      sec = isRival ? "rivals" : isRecordSource(r.source_key) ? "registers" : "own";
    } else if (isRival) {
      // The one rivals rule (relations.js rivalTickers): a competitor row shows under rivals and only there.
      sec = "rivals";
    } else if (group === "rivals") {
      leftOut("rivals", "not a competitor row");
      continue;
    } else {
      // 11. Otherwise the channel group of the source key, never a peer-entity fallback.
      sec = group;
    }
    const row = auxRow(r, via, ch, T);
    sections[sec].rows.push(row);
    counts(sec, row);
  }

  // Q3: other names' items graded for this name, from the primary grade's run (index.js SHOWN_GRADE); never counted.
  const alsoGraded = [];
  for (const r of got.q3 || []) {
    if (r.run_id === null || r.run_id === undefined || r.run_id !== r.primary_run) continue;
    if (mutedSet.has(r.source_key) || !inWindow(r)) continue;
    alsoGraded.push({ kind: "coverage", id: r.item_id, item_id: r.item_id, ticker: r.item_ticker, grade_ticker: T, source_key: r.source_key,
      title: r.title, url: isHttpUrl(r.url) ? r.url : null, published: r.published || null, nm_first_seen: r.nm_first_seen,
      undated: !r.published, score: r.score, band: r.band === "lead" && !r.published ? "digest" : r.band, stored_band: r.band, why: r.why,
      event_type: r.event_type });
  }

  // NEWS: source health of every channel key and the keys Q2e reached, and the series.
  const healthKeys = [...new Set([...ch.own, ...ch.sec, ...ch.registers, ...ch.rivals, ...ch.key_accounts, ...entitySources])];
  let news = null;
  if (env.NEWS) {
    try {
      const nplan = [];
      if (healthKeys.length) nplan.push(["q4", env.NEWS.prepare(Q4_SQL).bind(JSON.stringify(healthKeys))]);
      if (managedKeys.size) nplan.push(["q4m", env.NEWS.prepare(Q4M_SQL).bind(JSON.stringify([...managedKeys]))]);
      nplan.push(["q6", env.NEWS.prepare(Q6_SQL).bind(T, addDays(today, -120))]);
      const nres = await env.NEWS.batch(nplan.map(([, s]) => s));
      news = {};
      nplan.forEach(([k], i) => {
        news[k] = nres[i]?.results || [];
        reads.news += rowsRead(nres[i]);
        if (news[k].length >= LIMITS[k]) truncated[k] = true;
      });
    } catch {
      console.error("company: news read failed");
      news = null;
    }
  }

  // Series (Q6): the name's lines and the series' _total and _companies lines.
  const series = seriesLines(news?.q6 || []);
  sections.series.rows = series;
  if (series.some((s) => s.own)) fill.series = { strict: true, strict_no_reject: true, lenient: true };

  // Calendar: sheet entries, graded notices from Q1's rows, council agendas.
  const cal = calendarRows(T, got.q1 || [], agendas, mutedSet, { today, days });
  sections.calendar.rows = cal.rows;
  sections.calendar.counted = cal.counted;
  if (cal.counted > 0) fill.calendar = { strict: true, strict_no_reject: true, lenient: true };
  else if (cal.lenient > 0) fill.calendar.lenient = true;

  // Order, collapse copies, cut to size. The 24-hour count reads every shown
  // row before the cut, so it is the same whatever `section` asks for.
  const cap = (name) => (section === name ? SECTION_ROWS_ALL : SECTION_ROWS);
  const since24 = now - DAY_MS;
  const newBy = {};
  for (const name of ROW_SECTIONS) {
    const s = sections[name];
    s.shown = s.rows.length;
    const n = s.rows.filter((r) => !r.on_record && (msOf(r.nm_first_seen) ?? 0) >= since24).length;
    if (n) newBy[name] = n;
    const sorted = sortRows(s.rows, name === "rivals" || name === "key_accounts");
    const top = collapse(sorted);
    s.total = top.length;
    s.rows = top.slice(0, cap(name));
  }
  sections.series.shown = series.length;
  sections.series.total = series.length;
  sections.calendar.shown = cal.rows.length;
  sections.calendar.total = cal.rows.length;
  sections.calendar.rows = cal.rows.slice(0, cap("calendar"));

  // Source health and the "all quiet" line.
  const quiet = quietLine(T, ch, news, { managedKeys, entitySources, now, newBy });
  sections.source_health = { rows: quiet.rows, shown: quiet.rows.length, total: quiet.rows.length, left_out: { n: 0, reasons: {} }, filled: false,
    available: news !== null };
  delete quiet.rows;

  const filled = {};
  for (const name of FILL_SECTIONS) {
    sections[name].filled = fill[name].strict;
    sections[name].fill = { ...fill[name] };
    filled[name] = fill[name].strict;
  }
  const countOf = (rule) => FILL_SECTIONS.filter((n) => fill[n][rule]).length;
  const competitors = [...relations.competitorsOf(T)].map(([entity_key, e]) => ({ entity_key, name: e.name, direction: e.direction, via: e.via,
    watched: e.watched }));

  return {
    ticker: T,
    name: COVERED_NAMES?.[T]?.[0] ?? T,
    days,
    from: iso(fromMs),
    to: iso(now),
    generated_at: iso(now),
    relations_version: relations.version,
    calendar_version: CALENDAR_VERSION,
    quiet,
    sections,
    also_graded: alsoGraded.slice(0, section === "key_accounts" ? SECTION_ROWS_ALL : SECTION_ROWS),
    also_graded_total: alsoGraded.length,
    reference: { competitors, key_accounts: relations.keyAccountsOf(T) },
    filled,
    filled_count: countOf("strict"),
    filled_excluding_reject_count: countOf("strict_no_reject"),
    filled_lenient_count: countOf("lenient"),
    truncated,
    reads,
  };
}

// filledSections(data, rule) -> the names of the filled sections under a rule
// ("strict" default, "strict_no_reject", "lenient"), in section order. Its
// length is the matching count companyData reports. Source health and the
// reference lists never count (B-F10).
export function filledSections(data, rule = "strict") {
  if (!RULES.includes(rule)) throw new RangeError(`filledSections: rule must be one of ${RULES.join(", ")}`);
  return FILL_SECTIONS.filter((name) => data?.sections?.[name]?.fill?.[rule] === true);
}

// --- Rows -------------------------------------------------------------------------------------------

function coverageRow(r, T) {
  return {
    kind: "coverage", id: r.id, item_id: r.id, ticker: r.ticker || T, grade_ticker: r.grade_ticker || r.ticker || T, source_key: r.source_key,
    role: r.role ?? null, state: r.state, title: r.title, headline: r.headline ?? null, headline_tag: r.headline_tag ?? null,
    url: isHttpUrl(r.url) ? r.url : null, published: r.published || null, nm_first_seen: r.nm_first_seen, undated: !r.published,
    score: r.score ?? null,
    // An undated stored Lead shows as Digest (index.js feed).
    band: r.band === "lead" && !r.published ? "digest" : r.band ?? null, stored_band: r.band ?? null,
    why: r.why ?? null, note_hook: r.note_hook ?? null, event_type: r.event_type ?? null, read_source: r.read_source ?? null,
    copy_of: r.story_of ?? (r.band === "duplicate" ? r.dup_of ?? null : null),
  };
}

function auxRow(r, via, ch, T) {
  const about = r.band === "covered" && r.covered_ticker === T ? `about ${T}, via ${r.source_key}` : null;
  return {
    kind: "aux", id: r.id, item_id: r.id, source_key: r.source_key, entity_key: r.entity_key ?? null, entity_name: r.entity_name ?? null,
    title: r.title, headline: r.headline ?? null, url: isHttpUrl(r.url) ? r.url : null, published: r.published || null,
    nm_first_seen: r.nm_first_seen, undated: !r.published, score: r.score ?? null,
    band: r.band === "lead" && !r.published ? "digest" : r.band ?? null, stored_band: r.band ?? null, why: r.why ?? null,
    event_type: r.event_type ?? null, covered_ticker: r.covered_ticker ?? null, read_source: r.read_source ?? null, via,
    channel: ch.channel[r.source_key] || (String(r.source_key || "").startsWith("managed_") ? "managed" : "search or filtered feed"),
    ...(about ? { about } : {}),
    copy_of: r.story_of ?? (r.band === "duplicate" ? r.dup_of ?? null : null),
  };
}

const eventMs = (r) => msOf(r.published) ?? msOf(r.nm_first_seen) ?? 0;
function sortRows(rows, byScore) {
  return [...rows].sort((a, b) => (byScore ? (b.score ?? -1) - (a.score ?? -1) : 0) || eventMs(b) - eventMs(a) || (b.id ?? 0) - (a.id ?? 0));
}

// A copy (story_of, or a duplicate grade's dup_of) sits under its canonical row
// when that row is in the same section and pipeline; else it stands, marked copy.
function collapse(rows) {
  const byId = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]));
  const top = [];
  for (const r of rows) {
    const canon = r.copy_of !== null && r.copy_of !== undefined ? byId.get(`${r.kind}:${r.copy_of}`) : null;
    if (canon && canon !== r && (canon.copy_of === null || canon.copy_of === undefined)) {
      (canon.copies ||= []).push(r);
      continue;
    }
    if (r.copy_of !== null && r.copy_of !== undefined) r.copy = true;
    top.push(r);
  }
  return top;
}

// --- Series -----------------------------------------------------------------------------------------

function seriesLines(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.series}\u0000${r.subject}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const list of by.values()) {
    list.sort((a, b) => String(b.period).localeCompare(String(a.period)));
    const [latest, previous] = list;
    const total = latest.subject === "_total" || latest.subject === "_companies";
    const change = previous && Number.isFinite(Number(latest.value)) && Number.isFinite(Number(previous.value)) ? Number(latest.value) - Number(previous.value) : null;
    out.push({ series: latest.series, subject: latest.subject, own: !total, label: latest.label ?? null,
      record_url: isHttpUrl(latest.record_url) ? latest.record_url : null, latest: { period: latest.period, value: latest.value },
      previous: previous ? { period: previous.period, value: previous.value } : null, change, observed_at: latest.observed_at ?? null });
  }
  return out.sort((a, b) => String(a.series).localeCompare(String(b.series)) || Number(b.own) - Number(a.own) || String(a.subject).localeCompare(String(b.subject)));
}

// --- Calendar ---------------------------------------------------------------------------------------

const spanDays = (e) => Math.round((Date.parse(e.end || e.start) - Date.parse(e.start)) / DAY_MS) + 1;
// A dated catalyst (the brief's rule, calendar.js briefCatalysts, plus: an estimate does not count).
const countable = (e) => !e.context && e.kind !== "open_item_expiry" && e.kind !== "status_event" && (e.precision === "day" || spanDays(e) <= 45);

function calendarRows(T, q1, agendas, mutedSet, { today, days }) {
  const sheet = CALENDAR.filter((e) => e.ticker === T && e.kind !== "status_event");
  // Graded date notices from Q1's rows (the primary grade, a score, a notice flag; calendar.js gradedNotices).
  const notices = [];
  for (const r of q1) {
    if (mutedSet.has(r.source_key) || r.score === null || r.score === undefined) continue;
    const flags = String(r.flags || "");
    if (!NOTICE_FLAGS.some((f) => flags.includes(`"${f}"`))) continue;
    const d = noticeDate(r.title, r.why, r.published || r.nm_first_seen);
    if (!d) continue;
    notices.push({ ticker: T, kind: "graded_notice", start: d.date, end: d.date, precision: "day", confirmed: true,
      ...(d.time ? { time: d.time } : {}), text: clip(r.title, 200), item_id: r.id, url: r.url, score: r.score });
  }
  const all = occurrences([...sheet, ...notices, ...agendas], addDays(today, -days), addDays(today, 30));
  // A weekly entry shows its next two occurrences.
  const recurSeen = new Map();
  const rows = [];
  let counted = 0, lenient = 0;
  for (const e of all) {
    if (e.recurring) {
      if (e.start < today) continue;
      const k = `${e.text}|${e.recur?.weekday}`;
      const n = recurSeen.get(k) || 0;
      if (n >= 2) continue;
      recurSeen.set(k, n + 1);
    }
    const ok = countable(e);
    const isCounted = ok && !e.approx;
    if (isCounted) counted++;
    if (ok) lenient++;
    const tags = [e.approx ? "estimate" : null, e.kind === "open_item_expiry" ? "open item review" : null, e.context ? "context" : null].filter(Boolean);
    rows.push({ ticker: T, kind: e.kind, start: e.start, end: e.end || e.start, precision: e.precision, text: e.text, tags,
      counted: isCounted, counted_lenient: ok, confirmed: !!e.confirmed, time: e.time ?? null, url: isHttpUrl(e.url) ? e.url : null,
      item_id: e.item_id ?? null, recurring: !!e.recurring, ...(e.closed ? { closed: true } : {}), ...(e.deferred ? { deferred: true } : {}),
      ...(e.outcome ? { outcome: e.outcome, outcome_day: e.outcome_day ?? null } : {}) });
  }
  return { rows, counted, lenient };
}

// --- Source health and the "all quiet" line ---------------------------------------------------------

const GROUP_LABELS = { own: "own channels", sec: "SEC", registers: "registers", key_accounts: "key accounts", rivals: "rivals" };
const SECTION_LABELS = { own: "own", filings: "filings", ownership: "ownership", registers: "registers", rivals: "rivals", key_accounts: "key accounts" };

function healthOf(row, managed, now) {
  if (!row || !row.last_ok) return "never";
  if (String(row.last_error || "").toLowerCase().startsWith("disabled")) return "disabled";
  if (managed ? Number(row.fail_count) >= MANAGED_FAIL_MIN : Number(row.fail_count) > 0) return "failing";
  const next = msOf(row.next_poll_at);
  if (next !== null && now - next > OVERDUE_MS) return "overdue";
  return "ok";
}

// newBy: per row section, the shown rows first seen in the last 24 hours (counted before the display cut).
function quietLine(T, ch, news, { managedKeys, entitySources, now, newBy }) {
  const groupKeys = {
    own: ch.own, sec: ch.sec, registers: ch.registers, key_accounts: ch.key_accounts,
    rivals: [...new Set([...ch.rivals, ...entitySources, ...managedKeys])],
  };
  const since = now - DAY_MS;
  const new24 = Object.values(newBy).reduce((a, b) => a + b, 0);
  const lead = new24
    ? `New for ${T} in the last 24 hours: ${new24} (${Object.entries(newBy).map(([k, n]) => `${SECTION_LABELS[k]} ${n}`).join(", ")}).`
    : `All quiet for ${T} in the last 24 hours.`;
  const groups = {};
  const rows = [];
  if (!news) {
    for (const [g, keys] of Object.entries(groupKeys)) groups[g] = { keys: keys.length, ok: null, ok_24h: null, failing: [], disabled: [], overdue: [], never: [],
      search: keys.filter((k) => !String(k).startsWith("managed_") && (ch.channel[k] || "search or filtered feed") !== "direct").length,
      managed: keys.filter((k) => String(k).startsWith("managed_")).length };
    return { new_24h: new24, available: false, groups, text: `${lead} Source health unavailable; channels not confirmed.`, rows };
  }
  const state = new Map((news.q4 || []).map((r) => [r.key, r]));
  const managedState = new Map((news.q4m || []).map((r) => [r.key, r]));
  const notChecked = [];
  const alerts = [];
  for (const [g, keys] of Object.entries(groupKeys)) {
    const out = { keys: keys.length, ok: 0, ok_24h: 0, failing: [], disabled: [], overdue: [], never: [], search: 0, managed: 0 };
    for (const k of keys) {
      const managed = String(k).startsWith("managed_");
      const row = managed ? managedState.get(k) : state.get(k);
      const h = healthOf(row, managed, now);
      if (managed) out.managed++;
      else if ((ch.channel[k] || "search or filtered feed") !== "direct") out.search++;
      if (h === "ok") {
        out.ok++;
        if ((msOf(row.last_ok) ?? 0) >= since) out.ok_24h++;
      } else out[h].push(k);
      const rules = row?.open_rules ? String(row.open_rules).split(",").map((s) => s.trim()).filter(Boolean) : [];
      const err = redactError(row?.last_error, 160);
      rows.push({ key: k, group: g, status: h, last_ok: row?.last_ok ?? null, fail_count: row ? Number(row.fail_count) || 0 : null,
        last_error: err, next_poll_at: row?.next_poll_at ?? null, open_rules: rules, managed,
        channel: managed ? "managed" : ch.channel[k] || "search or filtered feed" });
      if (rules.length) alerts.push(`${k} (${rules.join(", ")})`);
      if (h !== "ok") notChecked.push(notCheckedText(k, GROUP_LABELS[g], h, row));
    }
    groups[g] = out;
  }
  const parts = [];
  for (const g of ["own", "sec", "registers", "key_accounts", "rivals"]) {
    const o = groups[g];
    if (!o.keys) { if (g === "sec") parts.push("no SEC channel"); continue; }
    const extra = [o.search ? `${o.search} by search or filtered feed` : null, o.managed ? `${o.managed} managed` : null].filter(Boolean);
    parts.push(`${GROUP_LABELS[g]} ${o.ok} of ${o.keys}${g === "rivals" && extra.length ? ` (${extra.join("; ")})` : ""}`);
  }
  let text = `${lead} Checked: ${parts.join(", ")}.`;
  if (notChecked.length) text += ` Not checked: ${notChecked.join("; ")}.`;
  if (alerts.length) text += ` Open alerts: ${alerts.join("; ")}.`;
  return { new_24h: new24, available: true, groups, text, rows };
}

function notCheckedText(key, label, h, row) {
  if (h === "never") return `${key} (${label}) never polled`;
  const err = redactError(row?.last_error, 80);
  if (h === "disabled") return `${key} (${label}) disabled${err ? ` (${err})` : ""}`;
  if (h === "overdue") return `${key} (${label}) overdue since ${etDay(row.next_poll_at)}`;
  return `${key} (${label}) failing since ${row?.last_ok ? etDay(row.last_ok) : "never"}${err ? ` (${err})` : ""}`;
}

const etDay = (s) => {
  const ms = msOf(s);
  return ms === null ? String(s ?? "") : `${etParts(ms).date} ET`;
};
