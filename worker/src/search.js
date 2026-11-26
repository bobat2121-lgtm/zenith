// Phase 3 search (Part D): one bounded LIKE search over both pipelines' stored
// text, ranked in SQL, plus a no-read names block from the bundled catalog.
//   GET /v1/search (admin only; index.js): the same function as JSON, with
//   cost.rows_read, for the deploy's live cost checks. The portal's Search view
//   (portal-search.js, PR-D2) calls searchRows with the viewer's context.
//
// What it searches: coverage title, grader headline, excerpt, grade why and
// note_hook; aux title, headline, excerpt, page_excerpt, entity_name, grade why
// and entity. Excerpts are the first 2,500 characters of fetched text.
//
// Query shape (one statement per pipeline, both in one env.DB.batch()):
//   - the window is a range on nm_first_seen (idx_items_seen / aux_items_seen);
//     unscoped searches are at most SEARCH_MAX_DAYS, scoped ones (ticker,
//     entity or source, each bounded by its own index) SEARCH_SCOPED_MAX_DAYS;
//   - terms are ANDed, the columns of one term ORed; every value is bound with
//     a numbered ?NNN placeholder (never an anonymous ?), in a fixed order:
//     ?1 from, ?2 to, ?3 limit, ?4 first term lowercased, then one LIKE pattern
//     per term, one ticker literal per term that is a covered ticker (coverage
//     only), the scope value, the newest cursor (2) and the muted keys;
//   - sort=best orders by tier (graded Lead/Digest, Borderline, other graded,
//     waiting or held, skipped), then newest, LIMIT 51; sort=newest orders by
//     the window index itself (no temp B-tree) and pages with a compound
//     (nm_first_seen, id) cursor written as an explicit OR.
//   - muted sources are bound as literals (a NOT IN subquery costs about one
//     extra read per scanned row when the statement has a join); with more
//     than SEARCH_MUTED_LITERALS keys the statement uses deps.muted, the
//     MUTED_SQL fragment index.js passes (this module never imports tuning.js,
//     which reaches delivery.js and discord.js).
//
// No writes, no news-monitor-db read, no query text in logs: an error is logged as its
// class name only, never q or the message.
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { COVERED_NAMES } from "./rubric.generated.js";
import { json, nowIso, universeSql } from "./lib.js";
import { etParts, etToUtc, addDays, fmtDay, DAY_MS } from "./et.js";

export const SEARCH_DEFAULT_RANGE = "30d";
export const SEARCH_MAX_DAYS = 90;
export const SEARCH_SCOPED_MAX_DAYS = 400;
export const SEARCH_LIMIT = 50;
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MAX_Q = 120;
export const SEARCH_MUTED_LITERALS = 60;
const MAX_TERM = 60;
const NEWEST_MAX = 100;
const LABEL_ROWS = 200;
const MUTED_QUERY = "SELECT source_key FROM source_prefs WHERE action = 'mute' LIMIT 500";

const PIPELINES = ["all", "coverage", "aux"];
const STATUSES = ["all", "graded"];
const SORTS = ["best", "newest"];
const ENTITY_RE = /^[a-z0-9_]{1,60}$/;
const SOURCE_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)~(\d{1,9})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Date range ------------------------------------------------------------------------------
// Part A's parseRange(url, { now, def, maxDays }) -> { key, fromIso, toIso, label, days } is the
// portal's one range parser (portal-html.js, PR-PA2). Until PR-PA2 is on main this module
// carries the same contract here, and deps.parseRange overrides it; when PR-PA2 merges, this
// block is replaced by `import { parseRange } from "./portal-html.js"` and nothing else changes.
const PRESET_DAYS = { "24h": 1, "3d": 3, "7d": 7, "14d": 14, "30d": 30, "90d": 90, "1y": 365 };
const PRESET_LABEL = { today: "Today", "24h": "Last 24 hours", "3d": "Last 3 days", "7d": "Last 7 days", "14d": "Last 14 days",
  "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last year" };
const validDate = (d) => DATE_RE.test(d || "") && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
function preset(key, nowMs, maxDays) {
  if (key === "today") return { key, fromIso: nowIso(etToUtc(etParts(nowMs).date)), toIso: nowIso(nowMs), label: "Today (ET)", days: 1 };
  const days = PRESET_DAYS[key];
  if (!days || days > maxDays) return null;
  return { key, fromIso: nowIso(nowMs - days * DAY_MS), toIso: nowIso(nowMs), label: PRESET_LABEL[key], days };
}
function rangeShim(url, { now, def = "today", maxDays = 30 } = {}) {
  const p = url.searchParams;
  const nowMs = Number.isFinite(now) ? now : Date.parse(now) || Date.now();
  const start = p.get("start"), end = p.get("end");
  if (start || end) {
    const today = etParts(nowMs).date;
    if (validDate(start) && validDate(end) && end >= start && end <= today) {
      const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
      if (days <= maxDays) {
        return { key: "custom", fromIso: nowIso(etToUtc(start)), toIso: nowIso(etToUtc(addDays(end, 1))),
          label: `${fmtDay(start)} to ${fmtDay(end)} (ET)`, days, start, end };
      }
    }
  } else if (p.get("range")) {
    const r = preset(p.get("range"), nowMs, maxDays);
    if (r) return r;
  }
  return preset(def, nowMs, maxDays) || preset("today", nowMs, maxDays);
}

// --- Parse -----------------------------------------------------------------------------------
const depsOf = (deps = {}) => ({
  tickers: deps.tickers || COVERED.tickers,
  names: deps.names || COVERED_NAMES,
  aux: deps.aux || AUX,
  covered: deps.covered || COVERED,
  muted: deps.muted,
  now: deps.now ?? Date.now(),
  parseRange: deps.parseRange || rangeShim,
});

// "quoted phrases" stay whole, the rest splits on whitespace; terms under 2
// characters are dropped, each is cut to 60, and at most 5 are kept.
function splitTerms(q) {
  const out = [];
  for (const m of q.matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = (m[1] !== undefined ? m[1] : m[2].replace(/^"+|"+$/g, "")).trim().slice(0, MAX_TERM);
    if (t.length >= 2) out.push(t);
  }
  return out;
}

const fail = (error) => ({ error });

// params: URLSearchParams. Returns the parsed query, or { error } (no statement runs).
export function parseQuery(params, deps = {}) {
  const d = depsOf(deps);
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || "");
  const q = (p.get("q") || "").trim().slice(0, SEARCH_MAX_Q);
  const all = splitTerms(q);
  if (!all.length) return fail("q needs a word of 2 or more characters");
  const terms = all.slice(0, SEARCH_MAX_TERMS);
  const ignored_terms = all.slice(SEARCH_MAX_TERMS);

  const pick = (key, allowed, dflt) => {
    const v = p.get(key);
    if (v === null || v === "") return dflt;
    return allowed.includes(v) ? v : undefined;
  };
  let pipeline = pick("pipeline", PIPELINES, "all");
  if (pipeline === undefined) return fail(`pipeline must be one of ${PIPELINES.join(", ")}`);
  const status = pick("status", STATUSES, "all");
  if (status === undefined) return fail(`status must be one of ${STATUSES.join(", ")}`);
  const sort = pick("sort", SORTS, "best");
  if (sort === undefined) return fail(`sort must be one of ${SORTS.join(", ")}`);

  const rawTicker = (p.get("ticker") || "").trim();
  const entity = (p.get("entity") || "").trim();
  const source = (p.get("source") || "").trim();
  if ([rawTicker, entity, source].filter(Boolean).length > 1) return fail("use one of ticker, entity or source");
  const ticker = rawTicker.toUpperCase();
  if (ticker) {
    if (!d.tickers.includes(ticker)) return fail("ticker must be a covered ticker");
    if (pipeline === "aux") return fail("a ticker search covers coverage items only");
    pipeline = "coverage";
  }
  if (entity) {
    if (!ENTITY_RE.test(entity)) return fail("entity must be an entity key");
    if (pipeline === "coverage") return fail("an entity search covers auxiliary items only");
    pipeline = "aux";
  }
  if (source && !SOURCE_RE.test(source)) return fail("source must be a source key");

  let limit = SEARCH_LIMIT;
  const rawLimit = p.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > NEWEST_MAX) return fail(`limit must be 1-${NEWEST_MAX}`);
    if (sort === "newest") limit = n;
  }
  const cursors = {};
  for (const key of ["cc", "ca"]) {
    const v = p.get(key);
    if (v === null || v === "") { cursors[key] = null; continue; }
    if (v === "end") { cursors[key] = "end"; continue; }
    const m = CURSOR_RE.exec(v);
    if (!m) return fail(`${key} must be a cursor from a previous page`);
    cursors[key] = { at: m[1], id: Number(m[2]) };
  }

  const scoped = Boolean(ticker || entity || source);
  const maxDays = scoped ? SEARCH_SCOPED_MAX_DAYS : SEARCH_MAX_DAYS;
  const url = new URL(`https://search.invalid/?${p.toString()}`);
  const r = d.parseRange(url, { now: d.now, def: SEARCH_DEFAULT_RANGE, maxDays });
  const askedCustom = Boolean(p.get("start") || p.get("end"));
  const asked = askedCustom ? "custom" : p.get("range") || null;
  const range = { key: r.key, label: r.label, fromIso: r.fromIso, toIso: r.toIso, days: r.days, fell_back: asked !== null && r.key !== asked };

  return { q, terms, ignored_terms, pipeline, status, sort, ticker: ticker || null, entity: entity || null, source: source || null,
    limit, cursors, range, mutedKeys: [] };
}

// --- SQL -------------------------------------------------------------------------------------
const ESC = String.raw`ESCAPE '\'`;
const likePattern = (t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
// Graded Lead/Digest 0, Borderline 1, other graded 2, waiting or held 3, skipped 4.
const tierSql = (a) => `CASE WHEN ${a}.state = 'graded' AND g.band IN ('lead','digest') THEN 0
               WHEN ${a}.state = 'graded' AND g.band = 'borderline' THEN 1
               WHEN ${a}.state = 'graded' THEN 2
               WHEN ${a}.state = 'skipped' THEN 4 ELSE 3 END`;
const hitSql = (cols) => `CASE ${cols.map(([sql, name]) => `WHEN instr(lower(COALESCE(${sql}, '')), ?4) > 0 THEN '${name}'`).join(" ")} END AS hit`;
const COVERAGE_HIT = [["i.title", "title"], ["i.headline", "headline"], ["i.excerpt", "excerpt"], ["g.why", "why"], ["g.note_hook", "note_hook"]];
const AUX_HIT = [["a.title", "title"], ["a.headline", "headline"], ["a.entity_name", "entity_name"], ["a.excerpt", "excerpt"],
  ["a.page_excerpt", "page_excerpt"], ["g.why", "why"], ["g.entity", "entity"]];

// One pipeline's statement: { pipeline, sql, binds }. q.mutedKeys are the muted source keys.
function statement(pipeline, q, d, cursor) {
  const binds = [];
  const add = (v) => { binds.push(v); return `?${binds.length}`; };
  const cov = pipeline === "coverage";
  const a = cov ? "i" : "a";
  const newest = q.sort === "newest";
  // Fixed bind order: from, to, limit, first term, patterns, ticker literals, scope, cursor, muted.
  const pFrom = add(q.range.fromIso), pTo = add(q.range.toIso);
  add((newest ? q.limit : SEARCH_LIMIT) + 1);
  add(q.terms[0].toLowerCase());
  const pats = q.terms.map((t) => add(likePattern(t)));
  const tickerOf = (t) => d.tickers.find((x) => x.toLowerCase() === t.toLowerCase()) || null;
  const tick = cov ? q.terms.map((t) => (tickerOf(t) ? add(tickerOf(t)) : null)) : [];
  const scopeVal = cov ? q.ticker || q.source : q.entity || q.source;
  const pScope = scopeVal ? add(scopeVal) : null;
  const pCur = cursor ? [add(cursor.at), add(cursor.id)] : null;
  const keys = q.mutedKeys || [];
  const pMuted = keys.length && keys.length <= SEARCH_MUTED_LITERALS ? keys.map(add) : null;

  const where = [`${a}.nm_first_seen >= ${pFrom} AND ${a}.nm_first_seen < ${pTo}`];
  if (cov) where.push(`COALESCE(g.ticker, i.ticker) IN ${universeSql(d.tickers)}`);
  if (pMuted) where.push(`${a}.source_key NOT IN (${pMuted.join(", ")})`);
  else if (keys.length) {
    if (!d.muted) throw new Error("deps.muted is required when more than SEARCH_MUTED_LITERALS sources are muted");
    where.push(`${a}.source_key NOT IN ${d.muted}`);
  }
  where.push("(g.band IS NULL OR g.band != 'duplicate')");
  const cols = cov ? ["i.title", "i.headline", "i.excerpt", "g.why", "g.note_hook"]
    : ["a.title", "a.headline", "a.excerpt", "a.page_excerpt", "a.entity_name", "g.why", "g.entity"];
  pats.forEach((pat, k) => {
    const ors = cols.map((c) => `${c} LIKE ${pat} ${ESC}`);
    if (tick[k]) ors.push(`i.ticker = ${tick[k]}`);
    where.push(`(${ors.join(" OR ")})`);
  });
  if (cov && q.ticker) where.push(`(i.ticker = ${pScope} OR i.id IN (SELECT g2.item_id FROM grades g2 WHERE g2.ticker = ${pScope}))`);
  else if (!cov && q.entity) where.push(`a.entity_key = ${pScope}`);
  else if (q.source) where.push(`${a}.source_key = ${pScope}`);
  // status=graded: coverage's idx_items_state has no date column, so the planner
  // would read every graded row ever; the unary + keeps the window index. Aux's
  // aux_items_state(state, nm_first_seen) is itself windowed, so it may be used.
  if (q.status === "graded") where.push(cov ? "+i.state = 'graded'" : "a.state = 'graded'");
  if (pCur) where.push(`(${a}.nm_first_seen < ${pCur[0]} OR (${a}.nm_first_seen = ${pCur[0]} AND ${a}.id < ${pCur[1]}))`);

  const select = cov
    ? `SELECT i.id AS item_id, i.nm_rowid, i.ticker, i.source_key, i.role, i.title, i.headline, i.url, i.published,
       i.nm_first_seen AS first_seen, i.state, i.skip_reason, (i.admit IS NOT NULL AND i.released_at IS NULL) AS held,
       g.id AS grade_id, g.ticker AS grade_ticker, g.score, g.band, g.event_type, g.read_source,
       substr(g.why, 1, 280) AS why, substr(g.note_hook, 1, 200) AS note_hook, ${hitSql(COVERAGE_HIT)},
       substr(i.excerpt, max(1, instr(lower(i.excerpt), ?4) - 100), 280) AS ex_snip, ${tierSql("i")} AS tier
  FROM items i LEFT JOIN grades g ON g.id = i.grade_id`
    : `SELECT a.id AS item_id, a.nm_rowid, a.entity_key, COALESCE(g.entity, a.entity_name) AS entity, a.status AS entity_status,
       a.source_key, a.title, a.headline, a.url, a.published, a.nm_first_seen AS first_seen, a.state, a.skip_reason,
       (a.admit IS NOT NULL AND a.released_at IS NULL) AS held, g.id AS grade_id, g.score, g.band, g.event_type,
       g.covered_ticker, substr(g.why, 1, 280) AS why, ${hitSql(AUX_HIT)},
       substr(COALESCE(a.page_excerpt, a.excerpt), max(1, instr(lower(COALESCE(a.page_excerpt, a.excerpt)), ?4) - 100), 280) AS ex_snip,
       ${tierSql("a")} AS tier
  FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id`;
  const order = newest ? `${a}.nm_first_seen DESC, ${a}.id DESC` : `tier, ${a}.nm_first_seen DESC, ${a}.id DESC`;
  const sql = `${select}
 WHERE ${where.join("\n   AND ")}
 ORDER BY ${order}
 LIMIT ?3`;
  return { pipeline, sql, binds };
}

// The search statements for a parsed query (q.mutedKeys set), one per pipeline
// that runs: under newest a pipeline whose cursor is "end" does not run.
export function buildStatements(q, deps = {}) {
  const d = depsOf(deps);
  const out = [];
  for (const [pipeline, key] of [["coverage", "cc"], ["aux", "ca"]]) {
    if (q.pipeline !== "all" && q.pipeline !== pipeline) continue;
    const cursor = q.sort === "newest" ? q.cursors?.[key] ?? null : null;
    if (cursor === "end") continue;
    out.push(statement(pipeline, q, d, cursor));
  }
  return out;
}

// --- Names block (0 reads) -------------------------------------------------------------------
export function nameMatches(q, deps = {}) {
  const d = depsOf(deps);
  const needle = String(q || "").replace(/"/g, "").trim().toLowerCase();
  const empty = { companies: [], names: [], sources: [] };
  if (needle.length < 2) return empty;
  const companies = [];
  for (const t of d.tickers) {
    const names = d.names?.[t] || [];
    if (t.toLowerCase() === needle || names.some((n) => String(n).toLowerCase().includes(needle))) companies.push({ ticker: t, name: names[0] || t });
    if (companies.length >= 5) break;
  }
  const byEntity = new Map();
  for (const [key, s] of Object.entries(d.aux?.sources || {})) {
    if (!String(s?.name || "").toLowerCase().includes(needle)) continue;
    const entity = s.entity || key;
    if (!byEntity.has(entity)) {
      if (byEntity.size >= 8) continue;
      byEntity.set(entity, { entity_key: entity, name: s.name, sources: [] });
    }
    byEntity.get(entity).sources.push(key);
  }
  const keys = new Set([...Object.keys(d.covered?.sources || {}), ...Object.keys(d.aux?.sources || {})]);
  const sources = [...keys].filter((k) => k.toLowerCase().includes(needle)).sort().slice(0, 8);
  return { companies, names: [...byEntity.values()], sources };
}

// --- Highlight -------------------------------------------------------------------------------
// Match offsets on the raw, unescaped text: [{ text, mark }] segments. The view
// escapes each segment, so a term never lands inside an HTML entity.
const lowerSameLength = (s) => s.split("").map((c) => { const l = c.toLowerCase(); return l.length === 1 ? l : c; }).join("");
export function highlight(text, terms) {
  const s = String(text ?? "");
  if (!s) return [];
  const low = lowerSameLength(s);
  const spans = [];
  for (const t of terms || []) {
    const n = lowerSameLength(String(t || ""));
    if (!n) continue;
    for (let i = low.indexOf(n); i !== -1; i = low.indexOf(n, i + n.length)) spans.push([i, i + n.length]);
  }
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  const out = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: s.slice(at, a), mark: false });
    out.push({ text: s.slice(a, b), mark: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), mark: false });
  return out;
}

// --- Search ----------------------------------------------------------------------------------
// The muted source keys (its own query: tuning.js reaches delivery.js). A zenith-db
// without source_prefs mutes nothing, as tuning.js mutedSources.
export async function searchMutedKeys(db) {
  try {
    const r = await db.prepare(MUTED_QUERY).all();
    return { keys: (r.results || []).map((x) => x.source_key), rows_read: Number(r.meta?.rows_read) || 0 };
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e))) return { keys: [], rows_read: 0 };
    throw e;
  }
}

const statusOf = (r) => (r.state === "graded" ? "graded" : r.state === "skipped" ? "skipped" : r.held ? "held" : "waiting");
const copyRank = (r) => (r.state === "graded" ? 0 : r.state === "skipped" ? 2 : 1);
const lc = (s) => String(s ?? "").toLowerCase();

// One news-monitor row stored in both pipelines: keep graded, then waiting or
// held, then skipped; ties go to coverage. Returns the set of dropped rows.
function droppedCopies(cov, aux) {
  const byRowid = new Map(cov.map((r) => [r.nm_rowid, r]));
  const dropped = new Set();
  for (const r of aux) {
    const c = byRowid.get(r.nm_rowid);
    if (!c) continue;
    dropped.add(copyRank(r) < copyRank(c) ? c : r);
  }
  return dropped;
}

function snippetOf(r) {
  if (r.hit === "title") return r.title;
  if (r.hit === "headline") return r.headline;
  if (r.hit === "why") return r.why;
  if (r.hit === "note_hook") return r.note_hook;
  if (r.hit === "entity" || r.hit === "entity_name") return r.entity;
  return r.ex_snip ?? null;
}

function shape(r, q, labels) {
  const cov = r.pipeline === "coverage";
  const band = r.band === "lead" && !r.published ? "digest" : r.band ?? null;
  const out = { pipeline: r.pipeline, item_id: r.item_id };
  if (cov) Object.assign(out, { ticker: r.ticker, grade_ticker: r.grade_ticker ?? null, role: r.role ?? null });
  else Object.assign(out, { entity: r.entity, entity_key: r.entity_key, entity_status: r.entity_status, covered_ticker: r.covered_ticker ?? null });
  let hit = r.hit ?? null;
  if (!hit && cov && q.terms.some((t) => t.toUpperCase() === r.ticker)) hit = "ticker";
  Object.assign(out, {
    source_key: r.source_key, title: r.title, headline: r.headline ?? null, url: r.url, published: r.published ?? null,
    first_seen: r.first_seen, status: statusOf(r), skip_reason: r.skip_reason ?? null, grade_id: r.grade_id ?? null,
    score: r.score ?? null, band, event_type: r.event_type ?? null, hit, snippet: snippetOf({ ...r, hit }) ?? null,
    why: r.why ?? null, note_hook: cov ? r.note_hook ?? null : null,
    label: labels.get(`${r.pipeline}:${r.item_id}:${cov ? r.grade_ticker ?? r.ticker : ""}`) ?? null,
  });
  if (cov && q.ticker && r.ticker !== q.ticker) out.also_graded_for = q.ticker;
  return out;
}

// Every term in the title, headline or entity: ranked first within a tier.
const strongHit = (r, terms) => terms.every((t) => [r.title, r.headline, r.entity].some((f) => lc(f).includes(lc(t))));

export async function searchRows(env, params, deps = {}) {
  const d = depsOf(deps);
  const q = parseQuery(params, d);
  if (q.error) return q;
  const cost = { rows_read: 0, statements: 0 };
  const muted = await searchMutedKeys(env.DB);
  cost.statements++;
  cost.rows_read += muted.rows_read;
  q.mutedKeys = muted.keys;

  const stmts = buildStatements(q, d);
  const fetched = { coverage: [], aux: [] };
  if (stmts.length) {
    const res = await env.DB.batch(stmts.map((s) => env.DB.prepare(s.sql).bind(...s.binds)));
    stmts.forEach((s, k) => {
      cost.statements++;
      cost.rows_read += Number(res[k]?.meta?.rows_read) || 0;
      fetched[s.pipeline] = (res[k]?.results || []).map((r) => ({ ...r, pipeline: s.pipeline }));
    });
  }
  const dropped = droppedCopies(fetched.coverage, fetched.aux);
  const ran = new Set(stmts.map((s) => s.pipeline));

  let shown = [];
  let cursors = null;
  const truncated = { coverage: false, aux: false };
  if (q.sort === "best") {
    const rows = [...fetched.coverage, ...fetched.aux].filter((r) => !dropped.has(r));
    rows.sort((x, y) => x.tier - y.tier || (strongHit(y, q.terms) - strongHit(x, q.terms))
      || (x.first_seen < y.first_seen ? 1 : x.first_seen > y.first_seen ? -1 : 0)
      || (x.pipeline === y.pipeline ? y.item_id - x.item_id : x.pipeline === "coverage" ? -1 : 1));
    shown = rows.slice(0, SEARCH_LIMIT);
    truncated.coverage = fetched.coverage.length > SEARCH_LIMIT;
    truncated.aux = fetched.aux.length > SEARCH_LIMIT;
  } else {
    // Newest: merge by (first_seen, pipeline, item_id) descending. A dropped copy
    // before the page edge is consumed (its cursor moves past it) but not shown.
    const rows = [...fetched.coverage, ...fetched.aux];
    rows.sort((x, y) => (x.first_seen < y.first_seen ? 1 : x.first_seen > y.first_seen ? -1 : 0)
      || (x.pipeline === y.pipeline ? y.item_id - x.item_id : x.pipeline === "coverage" ? -1 : 1));
    const consumed = { coverage: [], aux: [] };
    for (const r of rows) {
      if (shown.length >= q.limit) break;
      consumed[r.pipeline].push(r);
      if (!dropped.has(r)) shown.push(r);
    }
    const next = {};
    for (const [pipeline, key] of [["coverage", "cc"], ["aux", "ca"]]) {
      const got = fetched[pipeline], used = consumed[pipeline];
      const incoming = q.cursors[key];
      if (!ran.has(pipeline) || got.length <= used.length) next[key] = "end";
      else if (!used.length) next[key] = incoming && incoming !== "end" ? `${incoming.at}~${incoming.id}` : null;
      else { const last = used[used.length - 1]; next[key] = `${last.first_seen}~${last.item_id}`; }
      truncated[pipeline] = next[key] !== "end";
    }
    cursors = next.cc === "end" && next.ca === "end" ? null : next;
  }

  // Labels for the shown ids (one statement, both tables; latest label first).
  const labels = new Map();
  if (shown.length) {
    const ids = (p) => JSON.stringify(shown.filter((r) => r.pipeline === p).map((r) => r.item_id));
    const r = await env.DB.prepare(
      `SELECT 'coverage' AS pipeline, id, item_id, ticker, label FROM feedback WHERE item_id IN (SELECT value FROM json_each(?1))
       UNION ALL
       SELECT 'aux' AS pipeline, id, item_id, '' AS ticker, label FROM aux_feedback WHERE item_id IN (SELECT value FROM json_each(?2))
       ORDER BY id DESC LIMIT ${LABEL_ROWS}`,
    ).bind(ids("coverage"), ids("aux")).all();
    cost.statements++;
    cost.rows_read += Number(r.meta?.rows_read) || 0;
    for (const l of r.results || []) {
      const key = `${l.pipeline}:${l.item_id}:${l.ticker ?? ""}`;
      if (!labels.has(key)) labels.set(key, l.label);
    }
  }

  const { companies, names, sources } = nameMatches(q.q, d);
  return {
    q: q.q, terms: q.terms, ignored_terms: q.ignored_terms, range: q.range, pipeline: q.pipeline, sort: q.sort, status: q.status,
    ticker: q.ticker, entity: q.entity, source: q.source, companies, names, sources,
    results: shown.map((r) => shape(r, q, labels)), truncated, cursors, cost,
  };
}

// GET /v1/search (admin): the body echoes q, so nosniff is set. A failure is
// logged by its class name only and answered with no detail.
export async function searchRoute(env, url, deps = {}) {
  try {
    const result = await searchRows(env, url.searchParams, deps);
    if (result.error) return json({ error: result.error }, 400, { "x-content-type-options": "nosniff" });
    return json(result, 200, { "x-content-type-options": "nosniff" });
  } catch (e) {
    console.error("search failed", e?.name);
    return json({ error: "search failed" }, 500, { "x-content-type-options": "nosniff" });
  }
}
