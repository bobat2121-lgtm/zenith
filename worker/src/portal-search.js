// Portal (phase 3 PR-D2): the Search view, /p/search.
// searchView(vctx) runs search.js searchRows with the viewer's universe, mute
// fragment and clock, and renders the form, the range control, the names block,
// one card per result (Part A's itemCard, with its label form) and a highlighted
// snippet line, plus a Next link under sort=newest.
// Rules on top of the portal-html.js ones:
//   - Empty q: the form only, no statement.
//   - Cross-site guard: the search runs only when Sec-Fetch-Site is absent,
//     same-origin or none. Any other value (a third-party page navigating here)
//     gets the form with q prefilled and no statement, so a guessed query cannot
//     be run and timed with the owner's cookie.
//   - q is echoed only into the escaped input value and an escaped heading; the
//     page title is the constant "Search".
//   - Highlighting matches on the raw text (search.js highlight) and escapes each
//     segment, so a term never lands inside an HTML entity.
//   - A failure is logged by its class name only, never q or the message.
// Imports portal-html.js, portal-stub.js and search.js only (the portal import rule, S18).
import { html, parseRange, rangeControl, itemCard, tickerHref, RANGE_PRESETS } from "./portal-html.js";
import { denied } from "./portal-stub.js";
import { searchRows, highlight, SEARCH_DEFAULT_RANGE, SEARCH_MAX_DAYS, SEARCH_SCOPED_MAX_DAYS, SEARCH_MAX_Q, SEARCH_LIMIT, SEARCH_MAX_TERMS } from "./search.js";

const PATH = "/p/search";
const RUN_SITES = new Set(["same-origin", "none"]);
// The query parameters the page's own links and forms carry; nothing else is copied.
const KEEP = ["q", "pipeline", "sort", "status", "ticker", "entity", "source", "range", "start", "end", "limit"];
const PIPELINE_LABELS = [["all", "Everything"], ["coverage", "Covered companies"], ["aux", "Other names"]];
const SORT_LABELS = [["best", "Best"], ["newest", "Newest"]];
const HIT_LABELS = {
  title: "title", headline: "grader headline", excerpt: "fetched text", page_excerpt: "fetched page text", why: "grader note",
  note_hook: "grader hook", entity: "name", entity_name: "name", ticker: "ticker",
};
const DAY = 86_400_000;

// A /p/search link from { name: value } (empty values dropped). Spaces are %20, not
// "+", so the link is also a valid label-form return path (portal-html.js safeReturn).
export function searchHref(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString().replace(/\+/g, "%20");
  return `${PATH}${s ? `?${s}` : ""}`;
}

const current = (sp) => Object.fromEntries(KEEP.map((k) => [k, (sp.get(k) || "").trim()]));
const scopeOf = (sp) => ({ ticker: (sp.get("ticker") || "").trim(), entity: (sp.get("entity") || "").trim(), source: (sp.get("source") || "").trim() });
const isScoped = (s) => Boolean(s.ticker || s.entity || s.source);

// The days a request asked for (a preset or a well-formed custom span), or null.
function askedDays(sp) {
  const start = sp.get("start"), end = sp.get("end");
  if (start || end) {
    const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / DAY) + 1 : null;
  }
  const p = RANGE_PRESETS.find(([k]) => k === sp.get("range"));
  return p ? p[1] : null;
}

function rangeLine(range) {
  if (range.key === "custom") return `Seen between ${range.label} (ET dates)`;
  if (range.key === "today") return "Seen today (since 00:00 ET)";
  return `Seen in the last ${range.label}`;
}

function fallBackLine(sp, scoped) {
  const days = askedDays(sp);
  const def = RANGE_PRESETS.find(([k]) => k === SEARCH_DEFAULT_RANGE)[2];
  if (!scoped && days !== null && days > SEARCH_MAX_DAYS) {
    return `Searches without a company, name or source are limited to ${SEARCH_MAX_DAYS} days; showing the last ${def}.`;
  }
  if (scoped && days !== null && days > SEARCH_SCOPED_MAX_DAYS) return `Searches are limited to ${SEARCH_SCOPED_MAX_DAYS} days; showing the last ${def}.`;
  return `That date range could not be used; showing the last ${def}.`;
}

function form(sp, range, scope, note) {
  const cur = current(sp);
  const select = (name, options, value) => html`<select name="${name}" aria-label="${name === "sort" ? "Order" : "Search in"}">${
    options.map(([v, t]) => html`<option value="${v}"${v === value ? html` selected` : ""}>${t}</option>`)}</select>`;
  const hidden = (name) => (cur[name] ? html`<input type="hidden" name="${name}" value="${cur[name]}">` : "");
  // The search form keeps the current range; the range control keeps the search.
  const rangeKeep = range.key === "custom" ? html`<input type="hidden" name="start" value="${range.start}"><input type="hidden" name="end" value="${range.end}">`
    : html`<input type="hidden" name="range" value="${range.key}">`;
  const keep = { q: cur.q, pipeline: cur.pipeline, sort: cur.sort, status: cur.status, ticker: cur.ticker, entity: cur.entity, source: cur.source };
  return html`<form method="get" action="${PATH}" class="dates" role="search">
<label>Search <input type="search" name="q" value="${cur.q}" maxlength="${SEARCH_MAX_Q}" autocomplete="off" spellcheck="false"></label>
${isScoped(scope) ? "" : select("pipeline", PIPELINE_LABELS, cur.pipeline || "all")}${select("sort", SORT_LABELS, cur.sort || "best")}
${hidden("ticker")}${hidden("entity")}${hidden("source")}${hidden("status")}${rangeKeep}<button type="submit">Search</button></form>
${note ? html`<p class="meta" role="status">${note}</p>` : ""}
${rangeControl(range, PATH, keep)}`;
}

// The names block (0 reads): companies link to their page, names and sources to a
// scoped search for the same q. Exported for its link tests.
export function namesBlock(result) {
  const q = result.q;
  const companies = (result.companies || []).map((c) => [c, tickerHref(c.ticker)]).filter(([, h]) => h)
    .map(([c, h]) => html`<li><a href="${h}">${c.ticker}</a> ${c.name && c.name !== c.ticker ? html`<span class="meta">${c.name}</span>` : ""}</li>`);
  const names = (result.names || []).map((n) => html`<li><a href="${searchHref({ entity: n.entity_key, q })}">${n.name}</a></li>`);
  const sources = (result.sources || []).map((s) => html`<li><a href="${searchHref({ source: s, q })}">${s}</a></li>`);
  if (!companies.length && !names.length && !sources.length) return "";
  return html`${companies.length ? html`<h2>Companies</h2><ul class="names">${companies}</ul>` : ""}${
    names.length ? html`<h2>Names</h2><ul class="names">${names}</ul>` : ""}${
    sources.length ? html`<h2>Sources</h2><ul class="names">${sources}</ul>` : ""}`;
}

function scopeLines(result, cur) {
  const all = { ...cur, ticker: "", entity: "", source: "", pipeline: "", cc: "", ca: "" };
  const lines = [];
  if (result.ticker) {
    const page = tickerHref(result.ticker);
    lines.push(html`<p class="meta">Company searches cover that company's coverage items, including items graded for it under another ticker. For rival and key-account news see the ${
      page ? html`<a href="${page}">company page</a>` : "company page"}. <a href="${searchHref(all)}">Search all names</a></p>`);
  } else if (result.entity) {
    lines.push(html`<p class="meta">Searching one name (${result.entity}). <a href="${searchHref(all)}">Search all names</a></p>`);
  } else if (result.source) {
    lines.push(html`<p class="meta">Searching one source (${result.source}). <a href="${searchHref(all)}">Search all sources</a></p>`);
  }
  return lines;
}

const statusChip = (r) => (r.status === "skipped" ? `skipped${r.skip_reason ? `: ${r.skip_reason}` : ""}` : r.status === "graded" ? "" : r.status);

function snippetLine(r, terms) {
  const field = HIT_LABELS[r.hit] || "";
  const segs = highlight(r.snippet, terms);
  if (!field && !segs.length) return "";
  return html`<p class="meta snip">${field ? `Matched in the ${field}` : ""}${field && segs.length ? ": " : ""}${
    segs.map((s) => (s.mark ? html`<mark>${s.text}</mark>` : s.text))}</p>`;
}

function card(r, terms, now, returnTo) {
  const aux = r.pipeline === "aux";
  const row = aux
    ? { item_id: r.item_id, entity_name: r.entity, title: r.title, headline: r.headline, url: r.url, score: r.score, band: r.band,
      event_type: r.event_type, why: r.why, source_key: r.source_key, nm_first_seen: r.first_seen, label: r.label }
    : { item_id: r.item_id, ticker: r.ticker, grade_ticker: r.grade_ticker, title: r.title, headline: r.headline, url: r.url, score: r.score,
      band: r.band, event_type: r.event_type, why: r.why, note_hook: r.note_hook, role: r.role, source_key: r.source_key,
      nm_first_seen: r.first_seen, label: r.label };
  const meta = [];
  if (aux && r.band === "covered") meta.push("graded as covered company news");
  if (r.also_graded_for) meta.push(`graded for ${r.also_graded_for}`);
  const chip = statusChip(r);
  return html`${itemCard(row, { kind: aux ? "aux" : "coverage", now, returnTo, extra: { badges: chip ? [chip] : [], meta } })}
${snippetLine(r, terms)}`;
}

function results(result, cur, now) {
  const returnTo = searchHref(cur);
  const n = result.results.length;
  const best = result.sort === "best";
  const truncated = result.truncated?.coverage || result.truncated?.aux;
  const lines = [];
  if (result.ignored_terms?.length) lines.push(html`<p class="meta">Only the first ${SEARCH_MAX_TERMS} words are searched; left out: ${result.ignored_terms.join(" ")}</p>`);
  if (best && truncated) {
    lines.push(html`<p class="meta">More than ${SEARCH_LIMIT} matches; showing the ${SEARCH_LIMIT} best. Add a word, narrow the dates, or sort by Newest to page through all.</p>`);
  }
  let next = "";
  if (!best && result.cursors) {
    const href = searchHref({ ...cur, cc: result.cursors.cc || "", ca: result.cursors.ca || "" });
    next = html`<p><a href="${href}" rel="next">Next</a></p>`;
  }
  return html`<h2>Results for “${result.q}”</h2>
<p class="meta">${n ? `${n} ${n === 1 ? "match" : "matches"} shown${best ? ", best first" : ", newest first"}` : "No matches."}</p>
${lines}
${result.results.map((r) => card(r, result.terms, now, returnTo))}
${next}`;
}

export async function searchView(vctx) {
  if (vctx?.auth?.ok !== true) return denied("search");
  const { env, url, request, now = Date.now(), tickers = [], muted } = vctx;
  const sp = url.searchParams;
  const scope = scopeOf(sp);
  const range = parseRange(url, { now, def: SEARCH_DEFAULT_RANGE, maxDays: isScoped(scope) ? SEARCH_SCOPED_MAX_DAYS : SEARCH_MAX_DAYS });
  const q = (sp.get("q") || "").trim();
  const done = (body, status) => ({ title: "Search", active: "search", body, ...(status ? { status } : {}) });
  const head = html`<p class="meta">${rangeLine(range)} · Searches titles, grader headlines and notes, and the first 2,500 characters of fetched text</p>`;

  if (!q) return done(html`${form(sp, range, scope)}${head}`);
  const site = request?.headers?.get("sec-fetch-site");
  if (site && !RUN_SITES.has(site.toLowerCase())) return done(html`${form(sp, range, scope, "Press Search to run this search.")}${head}`);

  let result;
  try {
    result = await searchRows(env, sp, { tickers, muted, now });
  } catch (e) {
    console.error("search failed", e?.name);
    return done(html`${form(sp, range, scope)}<p role="alert">Search failed. Try again in a moment.</p>`, 500);
  }
  if (result.error) return done(html`${form(sp, range, scope)}<p role="alert">${result.error}.</p>`, 400);

  const cur = current(sp);
  return done(html`${form(sp, range, scope)}${head}
${result.range.fell_back ? html`<p class="meta">${fallBackLine(sp, isScoped(scope))}</p>` : ""}
${scopeLines(result, cur)}
${namesBlock(result)}
${results(result, cur, now)}`);
}
