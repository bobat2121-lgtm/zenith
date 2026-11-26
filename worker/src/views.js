// Phase 3: the data behind the Competitors and Industry views. Two window
// queries (windowRows) and two pure selectors (competitorsView, industryView)
// over the one relations module's rules (relations.js, passed in as `rel`: the
// caller does `await loadRelations()`, so this file does not import it).
//
// Read-time only: nothing here changes a score, a band or what the grader
// sees. Graded rows only. No fetch, no news-monitor-db read, no write.
//
// The muted-source fragment and the universe come from the caller (the portal
// passes vctx.muted, index.js's MUTED_SQL, and universeSql(vctx.tickers)), so
// this file imports neither tuning.js nor index.js. Both are SQL built by code,
// never from input; every input value (the window bounds, the ticker, the
// competitor list) is bound as a parameter.
import AUX from "./aux-sources.json";
import { INDUSTRY } from "./rubric.generated.js";
import { HELD_SQL, auxBandShownSql, universeSql } from "./lib.js";
import { OFFICIAL_HOST_RE } from "./records.js";
import { rarityClass, hostOf } from "./rarity.js";

// A guard on each window query; the view says "Showing the newest 1,000" when
// a pipeline reaches it.
export const WINDOW_LIMIT = 1000;
// Scores under this are "lower-scored" and collapsed on the page.
export const LOW_SCORE = 40;
export const SORTS = ["score", "newest"];
export const DIRECTIONS = ["-", "+", "±"];
// industryKind's groups, in display order after the declared areas.
export const KINDS = ["rules", "budget", "local", "programs", "government", "news"];
const QUIET_NAMES = 30;
const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const isIso = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));

// --- The two window queries -----------------------------------------------------------------------

// Q-V1 (coverage) and Q-V2 (aux) as SQL text, for windowRows and the plan tests.
// ?1 = from, ?2 = to; the ticker form adds ?3 = ticker and (aux) ?4 = the JSON
// list of the ticker's competitor entity keys.
export function windowSql({ ticker = false, muted, universe }) {
  if (typeof muted !== "string" || !muted.trim()) throw new TypeError("windowSql: muted (the MUTED_SQL fragment) is required");
  if (typeof universe !== "string" || !universe.trim()) throw new TypeError("windowSql: universe (universeSql(tickers)) is required");
  // CROSS JOIN is load-bearing: it fixes grades as the outer table, so the
  // planner drives from idx_grades_graded_at (or idx_grades_ticker in the ticker
  // form) instead of idx_items_seen. The grade rule: the item's primary grade,
  // plus cross-ticker (#T) grades from the primary grade's run when that run
  // is not NULL (idx_grades_once makes that at most one per item and ticker).
  const coverage = `SELECT i.id AS item_id, i.nm_rowid, i.ticker, i.source_key, i.role, i.affects, i.url, i.title, i.headline, i.headline_tag,
       i.published, i.nm_first_seen AS first_seen, g.id AS grade_id, COALESCE(g.ticker, i.ticker) AS grade_ticker,
       g.score, g.band, g.rung, g.event_type, g.flags, g.why, g.note_hook, g.graded_at
  FROM grades g CROSS JOIN items i ON i.id = g.item_id
 WHERE g.graded_at >= ?1 AND i.nm_first_seen >= ?1 AND i.nm_first_seen < ?2
   AND (i.role IN ('rival','program') OR g.rung = 'industry' OR g.flags LIKE '%"industry:%')
   AND (g.id = i.grade_id
        OR (g.run_id IS NOT NULL AND g.ticker != i.ticker
            AND g.run_id = (SELECT p.run_id FROM grades p WHERE p.id = i.grade_id)))
   AND COALESCE(g.ticker, i.ticker) IN ${universe} AND i.source_key NOT IN ${muted}
   AND g.band != 'duplicate' AND NOT ${HELD_SQL("i.")}${ticker ? "\n   AND g.ticker = ?3" : ""}
 ORDER BY i.nm_first_seen DESC, i.id DESC LIMIT ${WINDOW_LIMIT}`;
  // The json_valid guard keeps a malformed reads_through from failing the
  // statement (json_each(NULL) is empty).
  const aux = `SELECT a.id AS item_id, a.nm_rowid, a.entity_key, a.entity_name, a.status, a.source_key, a.coverage_subject, a.affects, a.url,
       a.title, a.headline, a.headline_tag, a.published, a.nm_first_seen AS first_seen, g.id AS grade_id, g.entity, g.score,
       g.band, g.event_type, g.reads_through, g.why, g.graded_at
  FROM aux_items a JOIN aux_grades g ON g.id = a.grade_id
 WHERE a.state = 'graded' AND a.nm_first_seen >= ?1 AND a.nm_first_seen < ?2
   AND a.source_key NOT IN ${muted} AND ${auxBandShownSql("a", "g.band")}${ticker ? `
   AND (a.entity_key IN (SELECT value FROM json_each(?4))
        OR (',' || COALESCE(a.affects, '') || ',') LIKE '%,' || ?3 || ',%'
        OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(g.reads_through) THEN g.reads_through END) r
                   WHERE json_extract(r.value, '$.ticker') = ?3))` : ""}
 ORDER BY a.nm_first_seen DESC, a.id DESC LIMIT ${WINDOW_LIMIT}`;
  return { coverage, aux };
}

// The graded coverage and aux rows first seen in [fromIso, toIso), for the
// Competitors and Industry views; with `ticker`, only rows that can belong to
// that ticker (the selectors still apply the placement rule). Two statements.
// rel: the loadRelations() object. muted: index.js's MUTED_SQL (vctx.muted).
// universe: universeSql(vctx.tickers); defaults to rel's tickers.
export async function windowRows(env, { fromIso, toIso, ticker = null, muted, universe = null, rel }) {
  if (!rel || typeof rel.competitorsOf !== "function") throw new TypeError("windowRows: rel (loadRelations()) is required");
  if (!isIso(fromIso) || !isIso(toIso)) throw new TypeError("windowRows: fromIso and toIso must be ISO timestamps");
  if (ticker !== null && (typeof ticker !== "string" || !TICKER_RE.test(ticker) || !rel.tickers.includes(ticker))) {
    throw new RangeError("windowRows: unknown ticker");
  }
  const sql = windowSql({ ticker: ticker !== null, muted, universe: universe ?? universeSql(rel.tickers) });
  const covBinds = ticker !== null ? [fromIso, toIso, ticker] : [fromIso, toIso];
  const auxBinds = ticker !== null ? [fromIso, toIso, ticker, JSON.stringify([...rel.competitorsOf(ticker).keys()])] : [fromIso, toIso];
  const coverage = (await env.DB.prepare(sql.coverage).bind(...covBinds).all()).results || [];
  const aux = (await env.DB.prepare(sql.aux).bind(...auxBinds).all()).results || [];
  return {
    coverage: coverage.map((r) => norm(r, "coverage", rel)),
    aux: aux.map((r) => norm(r, "aux", rel)),
    capped: { coverage: coverage.length >= WINDOW_LIMIT, aux: aux.length >= WINDOW_LIMIT },
  };
}

// --- Row normalisation ----------------------------------------------------------------------------

const parseJson = (v) => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
};
const normDirection = (d) => {
  const x = typeof d === "string" ? d.trim().replace(/−/g, "-") : null;
  return DIRECTIONS.includes(x) ? x : null;
};

// The grade's reads_through -> [{ticker, direction}], covered tickers only,
// without repeats. A malformed value gives [] and never throws.
export function readsOf(value, tickers) {
  const raw = Array.isArray(value) ? value : parseJson(value);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const t = typeof r?.ticker === "string" ? r.ticker : null;
    if (!t || !tickers.includes(t) || out.some((x) => x.ticker === t)) continue;
    out.push({ ticker: t, direction: normDirection(r.direction) });
  }
  return out;
}

// "A,B" -> the covered tickers in it, in order, without repeats.
export function affectsOf(value, tickers) {
  const out = [];
  for (const x of String(value ?? "").split(",")) {
    const t = x.trim();
    if (tickers.includes(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

// The ids of a grade's industry:<id> flags.
export function industryIdsOf(flags) {
  const list = parseJson(flags);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((f) => typeof f === "string" && f.startsWith("industry:") && f.length > 9).map((f) => f.slice(9)))];
}

// One window row, as the selectors read it. An undated Lead shows as Digest
// (index.js feed); `stored_band` keeps the stored band. Text stays data: it is
// escaped when the page renders it.
export function norm(row, pipeline, rel) {
  const tickers = rel?.tickers || [];
  const out = {
    ...row,
    pipeline,
    stored_band: row.band ?? null,
    band: row.band === "lead" && !row.published ? "digest" : row.band ?? null,
    rarity: rarityClass(row),
    affects: affectsOf(row.affects, tickers),
    reads: pipeline === "aux" ? readsOf(row.reads_through, tickers) : [],
    industry_ids: pipeline === "coverage" ? industryIdsOf(row.flags) : [],
  };
  delete out.reads_through;
  return out;
}

// --- Shared helpers for the selectors -------------------------------------------------------------

const isLow = (row) => row.score != null && row.score < LOW_SCORE;
const passesMin = (row, minScore) => !(minScore > 0) || (row.score != null && row.score >= minScore);
const newestFirst = (a, b) => (a.first_seen < b.first_seen ? 1 : a.first_seen > b.first_seen ? -1 : (b.item_id ?? 0) - (a.item_id ?? 0));
const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || newestFirst(a, b);
const cardKey = (row) => `${row.pipeline}:${row.item_id}`;
const tickersFor = (rel, ticker) => (ticker ? (rel.tickers.includes(ticker) ? [ticker] : []) : [...rel.tickers]);

// A source key's entity (aux-sources.json), else the key itself.
const entityOfKey = (aux) => (key) => (own(aux?.sources, key) && aux.sources[key]?.entity) || key;

// --- Competitors ----------------------------------------------------------------------------------

// Per covered ticker T (or only `ticker`): its coverage rival rows and the aux
// rows the placement rule puts under T (rel.rivalTickers, the one rivals rule),
// newest-first or by score. rows: windowRows' { coverage, aux }.
export function competitorsView(rows, rel, { ticker = null, minScore = 0, direction = null, sort = "score", limitPer = 50, aux = AUX } = {}) {
  const order = sort === "newest" ? newestFirst : byScore;
  const dir = DIRECTIONS.includes(direction) ? direction : null;
  const entityOf = entityOfKey(aux);
  const coverage = rows?.coverage || [];
  const auxRows = rows?.aux || [];
  return tickersFor(rel, ticker).map((t) => {
    const comps = rel.competitorsOf(t);
    const seen = new Set();
    const all = [];
    const push = (card) => {
      // One card per news-monitor row: the coverage copy wins over its aux twin.
      const k = card.nm_rowid != null ? `nm:${card.nm_rowid}` : cardKey(card);
      if (seen.has(k) || seen.has(cardKey(card))) return;
      seen.add(k);
      seen.add(cardKey(card));
      all.push(card);
    };
    for (const row of coverage) {
      if (!rel.rivalTickers(row, "coverage").includes(t)) continue;
      const key_account = rel.keyAccountIn(t, row.title);
      const entity = entityOf(row.source_key);
      push({ ...row, entity_key: row.entity_key ?? entity, direction: comps.get(entity)?.direction ?? "-",
        key_account, names_company: rel.companyIn(t, row.title), at_key_account: key_account != null, low: isLow(row) });
    }
    for (const row of auxRows) {
      if (!rel.rivalTickers(row, "aux").includes(t)) continue;
      const graded = (row.reads || []).find((r) => r.ticker === t)?.direction;
      push({ ...row, direction: graded || comps.get(row.entity_key)?.direction || null,
        key_account: rel.keyAccountIn(t, row.headline || row.title), low: isLow(row) });
    }
    const active = new Set(all.map((r) => r.entity_key).filter(Boolean));
    const quietNames = [...comps].filter(([k]) => !active.has(k)).map(([, e]) => e.name);
    const shown = all.filter((r) => passesMin(r, minScore) && (!dir || r.direction === dir)).sort(order);
    return {
      ticker: t,
      n: shown.length,
      rivals_watched: [...comps.values()].filter((e) => e.watched).length,
      rival_sources: rel.rivalSourceCount(t),
      key_accounts: rel.keyAccountsOf(t).length,
      items: shown.slice(0, limitPer),
      more: Math.max(0, shown.length - limitPer),
      quiet: { names: quietNames.slice(0, QUIET_NAMES), count: quietNames.length },
    };
  });
}

// --- Industry -------------------------------------------------------------------------------------

const hostIn = (host, roots) => !!host && roots.some((r) => host === r || host.endsWith("." + r));
const RULES_HOSTS = ["federalregister.gov", "regulations.gov", "reginfo.gov"];
const BUDGET_HOSTS = ["congress.gov", "senate.gov", "house.gov"];
const PROGRAM_EVENTS = ["contract", "program_award", "program"];

// The kind of an Industry row under ticker T; the first match wins. `area:<id>`
// only when the grade carries industry:<id> and T declares that link.
export function industryKind(row, { ticker = null, industry = INDUSTRY, rel = null } = {}) {
  const links = ticker && own(industry, ticker) ? industry[ticker] : null;
  for (const id of row.industry_ids || []) if (links && own(links, id)) return `area:${id}`;
  const host = hostOf(row.url);
  if (hostIn(host, RULES_HOSTS) || row.event_type === "regulatory") return "rules";
  if (hostIn(host, BUDGET_HOSTS)) return "budget";
  if (hostIn(host, ["legistar.com"])) return "local";
  if (PROGRAM_EVENTS.includes(row.event_type)) return "programs";
  if ((host && OFFICIAL_HOST_RE.test(host)) || rel?.sourceClass?.(row.source_key) === "register") return "government";
  return "news";
}

const isCoverageIndustry = (row) => row.role === "program" || row.rung === "industry" || (row.industry_ids || []).length > 0;

function groupsOf(cards, { ticker, industry, rel, kind, limitPer }) {
  const links = ticker && own(industry, ticker) ? industry[ticker] : {};
  const buckets = new Map();
  for (const c of cards) {
    const k = industryKind(c, { ticker, industry, rel });
    if (kind && k !== kind) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const take = (k) => {
    const list = (buckets.get(k) || []).sort(newestFirst);
    return { n: list.length, items: list.slice(0, limitPer), more: Math.max(0, list.length - limitPer) };
  };
  const areas = Object.entries(links || {}).map(([id, v]) => ({ id, core: v?.core === true, ...take(`area:${id}`) }))
    .filter((a) => !kind || kind === `area:${a.id}`);
  const groups = KINDS.filter((k) => !kind || k === kind).map((k) => ({ kind: k, ...take(k) })).filter((g) => g.n > 0);
  const n = areas.reduce((s, a) => s + a.n, 0) + groups.reduce((s, g) => s + g.n, 0);
  return { n, areas, groups };
}

// Per covered ticker T (or only `ticker`): coverage program rows, industry-rung
// rows and rows with an industry flag (under the grade ticker), and aux rows
// the placement rule sends to Industry (under their affects, else reads_through
// tickers; with neither they are sector-wide, shown only without a ticker
// filter). A coverage row and an aux row of the same news-monitor row show as
// one card, the coverage copy, with the aux grade under `also`. The merge runs
// per ticker after minScore: under T the aux twin is folded into T's kept
// coverage card, and stands on its own when T has none (the coverage copy is
// another ticker's, or under minScore), so T's section is the same with or
// without the ticker filter. Declared areas (INDUSTRY; {} until the ladder is
// promoted) open each ticker's section.
export function industryView(rows, rel, { ticker = null, minScore = 0, kind = null, industry = INDUSTRY, limitPer = 50 } = {}) {
  const coverage = (rows?.coverage || []).filter(isCoverageIndustry);
  const auxRows = (rows?.aux || []).filter((r) => rel.placeAux(r).industry);
  // The aux grades of each news-monitor row, for a coverage card's `also` line.
  const also = new Map();
  for (const a of auxRows) {
    if (a.nm_rowid == null) continue;
    if (!also.has(a.nm_rowid)) also.set(a.nm_rowid, []);
    also.get(a.nm_rowid).push({ item_id: a.item_id, entity: a.entity || a.entity_name || null, score: a.score ?? null, band: a.band ?? null });
  }
  const card = (r) => ({ ...r, low: isLow(r), also: r.pipeline === "coverage" ? also.get(r.nm_rowid) || [] : [] });
  const auxTickers = (a) => (a.affects?.length ? a.affects : (a.reads || []).map((r) => r.ticker));
  const keep = (r) => passesMin(r, minScore);
  const keptCoverage = coverage.filter(keep);
  // An aux row is folded into a kept coverage card in `rowids`, else it stands alone.
  const alone = (a, rowids) => keep(a) && (a.nm_rowid == null || !rowids.has(a.nm_rowid));

  const sections = tickersFor(rel, ticker).map((t) => {
    const seen = new Set();
    const cards = [];
    for (const r of keptCoverage) if (r.grade_ticker === t && !seen.has(cardKey(r))) { seen.add(cardKey(r)); cards.push(card(r)); }
    const merged = new Set(cards.map((r) => r.nm_rowid).filter((x) => x != null));
    for (const r of auxRows) if (auxTickers(r).includes(t) && alone(r, merged) && !seen.has(cardKey(r))) { seen.add(cardKey(r)); cards.push(card(r)); }
    return { ticker: t, ...groupsOf(cards, { ticker: t, industry, rel, kind, limitPer }) };
  });
  const out = { tickers: sections };
  if (!ticker) {
    const shownAnywhere = new Set(keptCoverage.filter((r) => rel.tickers.includes(r.grade_ticker)).map((r) => r.nm_rowid).filter((x) => x != null));
    const wide = auxRows.filter((r) => auxTickers(r).length === 0 && alone(r, shownAnywhere)).map(card);
    const g = groupsOf(wide, { ticker: null, industry, rel, kind, limitPer });
    out.sector_wide = { n: g.n, groups: g.groups };
  }
  return out;
}
