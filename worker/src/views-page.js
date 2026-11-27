// Portal (phase 3 PR-CV3): the Competitors, Industry and Rare finds views,
// /p/competitors, /p/industry and /p/rare. Each is one VIEWS line in portal.js.
//   Competitors  per covered name, the graded rival rows the one rivals rule puts
//                under it (relations.js rivalTickers, through views.js
//                competitorsView), then the competitors quiet in the range.
//   Industry     per covered name, its declared areas (INDUSTRY; none until the
//                ladder is promoted), then rules, budget, local, programs,
//                government and news rows (views.js industryView); then the
//                sector-wide rows when no name is picked.
//   Rare finds   two shelves, registers and original reporting (rarity.js rareData).
// Reads: two statements per open (views.js windowRows, or rareData's two). Graded
// rows only; nothing is written here (the shell counts the open). The mute
// fragment arrives as vctx.muted and the universe is built from vctx.tickers, so
// this module imports neither tuning.js nor index.js (the portal import rule).
// Every view fails closed (403, no statement) unless vctx.auth?.ok === true.
// Parameters are parsed once against allow-lists; anything invalid falls back to
// its default. Every link is built from the parsed values with URLSearchParams
// and escaped by `html`; the raw query string is never echoed.
import { html, parseRange, rangeControl, itemCard, tickerHref, TICKER_RE } from "./portal-html.js";
import { denied } from "./portal-stub.js";
import { universeSql } from "./lib.js";
import { fmtEt } from "./et.js";
import { loadRelations } from "./relations.js";
import { windowRows, competitorsView, industryView, KINDS, WINDOW_LIMIT } from "./views.js";
import { rareData, bounded, RARE } from "./rarity.js";

export const VIEW_DEF = "14d";
export const VIEW_MAX_DAYS = 30;
// Q-V1's rows read grow with grades since `from`, so no range may start earlier.
export const AGE_CAP_DAYS = 120;
export const PER_GROUP = 50;
export const PAGE_CARDS = 200;
export const MIN_SCORES = [0, 40, 60, 70];
export const RARE_FLOORS = [40, 60, 70];
export const RARE_DEF_FLOOR = 60;
const DAY = 86_400_000;
const PATH = { competitors: "/p/competitors", industry: "/p/industry", rare: "/p/rare" };
// Word tokens for the direction (a literal + in a query string decodes to a space).
const DIR_WORDS = { minus: "-", plus: "+", mixed: "±" };
const GLYPH = { "-": "−", "+": "+", "±": "±" };
const KIND_LABEL = { rules: "Rules", budget: "Budget", local: "Local", programs: "Programs", government: "Government", news: "News" };
// The query keys a link may carry, in the order they are written.
const KEYS = ["ticker", "dir", "sort", "kind", "min_score", "floor"];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- Parameters and links -------------------------------------------------------------------------

// The parsed state of one page: range, ticker and the page's own filters. A
// value equal to its default is null, so links stay short.
function parseState(vctx, rel, view, { areaIds = [] } = {}) {
  const { url, now } = vctx;
  const q = url.searchParams;
  let range = parseRange(url, { now, def: VIEW_DEF, maxDays: VIEW_MAX_DAYS });
  let aged = false;
  if (Date.parse(range.fromIso) < now - AGE_CAP_DAYS * DAY) {
    range = parseRange(new URL(url.pathname, url), { now, def: VIEW_DEF, maxDays: VIEW_MAX_DAYS });
    aged = true;
  }
  const tickers = (vctx.tickers || []).filter((t) => rel.tickers.includes(t));
  const t = String(q.get("ticker") ?? "").trim().toUpperCase();
  const st = { view, range, aged, tickers, ticker: TICKER_RE.test(t) && tickers.includes(t) ? t : null, dir: null, sort: null, kind: null, min_score: null, floor: null };
  if (view === "competitors") {
    const d = q.get("dir");
    st.dir = own(DIR_WORDS, d) ? d : null;
    st.sort = q.get("sort") === "newest" ? "newest" : null;
  }
  if (view === "industry") {
    const k = q.get("kind");
    st.kind = KINDS.includes(k) || (typeof k === "string" && k.startsWith("area:") && areaIds.includes(k.slice(5))) ? k : null;
  }
  if (view !== "rare") {
    const m = bounded(q, "min_score", 0, 0, 100);
    st.min_score = m > 0 ? m : null;
  } else {
    const f = bounded(q, "floor", RARE_DEF_FLOOR, 40, 100);
    st.floor = f === RARE_DEF_FLOOR ? null : f;
  }
  return st;
}

// The page's filters (not the range) as { key: value }, defaults left out.
const keepOf = (st, over = {}) => {
  const out = {};
  for (const k of KEYS) {
    const v = own(over, k) ? over[k] : st[k];
    if (v !== null && v !== undefined && v !== "") out[k] = String(v);
  }
  return out;
};

// A link to this page (or `path`) with the parsed state, changed by `over`.
function hrefOf(st, over = {}, path = PATH[st.view]) {
  const p = new URLSearchParams();
  const r = st.range;
  if (r.key === "custom") { p.set("start", r.start); p.set("end", r.end); } else if (r.key !== VIEW_DEF) p.set("range", r.key);
  for (const [k, v] of Object.entries(keepOf(st, over))) p.set(k, v);
  const s = p.toString();
  return `${path}${s ? `?${s}` : ""}`;
}

// One filter row: [label, over] pairs; the one matching the state is current.
function filterRow(st, label, key, options) {
  const links = options.map(([text, value]) => html`<a href="${hrefOf(st, { [key]: value })}"${
    (st[key] ?? null) === value ? html` aria-current="true"` : ""}>${text}</a>`);
  return html`<nav class="presets" aria-label="${label}">${links}</nav>`;
}

function header(st, now, capped) {
  return html`<p class="meta">${st.range.label} · Updated ${fmtEt(now, { day: false })}</p>
${st.aged ? html`<p class="meta" role="status">Ranges older than ${AGE_CAP_DAYS} days are not offered; showing the default range.</p>` : ""}
${rangeControl(st.range, PATH[st.view], VIEW_MAX_DAYS, keepOf(st))}
${capped ? html`<p class="meta" role="status">Showing the newest ${WINDOW_LIMIT.toLocaleString("en-US")}; narrow the range or pick a name.</p>` : ""}`;
}

// --- Cards ----------------------------------------------------------------------------------------

// A page-wide card budget (PAGE_CARDS), spent section by section.
function budget(max = PAGE_CARDS) {
  let left = max;
  return (n) => { const k = Math.max(0, Math.min(n, left)); left -= k; return k; };
}

const rarityBadge = (r) => (RARE.includes(r.rarity) ? `rare: ${r.rarity}` : "");

function card(r, { now, returnTo, badges = [], meta = [] }) {
  const row = { ...r, nm_first_seen: r.first_seen ?? r.nm_first_seen };
  return itemCard(row, { kind: r.pipeline === "aux" ? "aux" : "coverage", now, returnTo, extra: { badges: badges.filter(Boolean), meta: meta.filter(Boolean) } });
}

// Cards above the low line, then the lower-scored ones collapsed.
function cardList(items, render) {
  const high = items.filter((r) => !r.low), low = items.filter((r) => r.low);
  return html`${high.map(render)}${low.length ? html`<details><summary>Lower-scored (${low.length})</summary>${low.map(render)}</details>` : ""}`;
}

const sectionHead = (t, text) => html`<h2><a href="${tickerHref(t)}">${t}</a> · ${text}</h2>`;
// "+n more" links to the ticker (and group) form of the page. When that form is
// the page already shown, a link would lead back here, so it is plain text.
function moreNote(st, hidden, over) {
  const href = hrefOf(st, over);
  if (href === hrefOf(st)) return html`<p class="meta">+${hidden} more; narrow the range or raise the minimum score.</p>`;
  return html`<p class="meta"><a href="${href}">+${hidden} more</a></p>`;
}
// "+n more", else "Only <T>" when no name is picked.
function moreLine(st, t, hidden, over = {}) {
  if (hidden > 0) return moreNote(st, hidden, { ticker: t, ...over });
  if (!st.ticker) return html`<p class="meta"><a href="${hrefOf(st, { ticker: t })}">Only ${t}</a></p>`;
  return "";
}
const allNames = (st) => (st.ticker ? html`<p class="meta"><a href="${hrefOf(st, { ticker: null })}">All names</a></p>` : "");

// --- Competitors ----------------------------------------------------------------------------------

// opts (tests only): { rel, aux } in place of the bundled relations and aux map.
export async function competitorsPage(vctx, opts = {}) {
  if (vctx?.auth?.ok !== true) return denied("competitors");
  const { env, now, muted } = vctx;
  const rel = opts.rel ?? (await loadRelations());
  const st = parseState(vctx, rel, "competitors");
  const rows = await windowRows(env, { fromIso: st.range.fromIso, toIso: st.range.toIso, ticker: st.ticker, muted, universe: universeSql(st.tickers), rel });
  const view = competitorsView(rows, rel, { ticker: st.ticker, minScore: st.min_score ?? 0, direction: st.dir ? DIR_WORDS[st.dir] : null,
    sort: st.sort ?? "score", limitPer: PER_GROUP, ...(opts.aux ? { aux: opts.aux } : {}) }).filter((s) => st.tickers.includes(s.ticker));
  const returnTo = hrefOf(st);
  const take = budget();
  const render = (t) => (r) => card(r, { now, returnTo,
    badges: [r.direction ? `${GLYPH[r.direction] || r.direction} for ${t}` : "", rarityBadge(r)],
    meta: [r.key_account ? `names ${r.key_account}` : r.names_company ? `names ${r.names_company}` : ""] });
  const sections = view.map((s) => {
    const t = s.ticker;
    const items = s.items.slice(0, take(s.items.length));
    const hidden = s.items.length - items.length + s.more;
    const quiet = s.quiet.count ? html`<p class="meta quiet">Quiet in this range: ${s.quiet.names.join(", ")}${
      s.quiet.count > s.quiet.names.length ? ` (+${s.quiet.count - s.quiet.names.length})` : ""}</p>` : "";
    return html`<section data-ticker="${t}" id="t-${t}">
${sectionHead(t, `${s.n} in range · ${s.rivals_watched} rivals watched · ${s.rival_sources} rival sources · ${s.key_accounts} key accounts`)}
${s.rival_sources === 0 ? html`<p class="meta">No rival source of its own; rivals come from peer notes only.</p>` : ""}
${s.n ? cardList(items, render(t)) : html`<p class="empty">No competitor row in this range.</p>`}
${moreLine(st, t, hidden)}${quiet}
</section>`;
  });
  const chips = st.tickers.map((t) => [t, tickerHref(t)]).filter(([, h]) => h);
  const body = html`${header(st, now, rows.capped.coverage || rows.capped.aux)}
<ul class="names chips" aria-label="Company pages">${chips.map(([t, h]) => html`<li><a href="${h}">${t}</a></li>`)}</ul>
${filterRow(st, "Direction", "dir", [["Any direction", null], ["− read", "minus"], ["+ read", "plus"], ["± read", "mixed"]])}
${filterRow(st, "Order", "sort", [["By score", null], ["Newest", "newest"]])}
${filterRow(st, "Minimum score", "min_score", MIN_SCORES.map((m) => [m ? `${m}+` : "Any score", m || null]))}
${allNames(st)}
${sections}`;
  return { title: "Competitors", active: "competitors", body };
}

// --- Industry -------------------------------------------------------------------------------------

// opts (tests only): { rel, industry } in place of the bundled relations and INDUSTRY.
export async function industryPage(vctx, opts = {}) {
  if (vctx?.auth?.ok !== true) return denied("industry");
  const { env, now, muted } = vctx;
  const rel = opts.rel ?? (await loadRelations());
  const linksOf = (t) => (opts.industry ? Object.entries(opts.industry[t] || {}).map(([id, v]) => ({ id, core: v?.core === true })) : rel.industryLinksOf(t));
  const areaIds = [...new Set(rel.tickers.flatMap((t) => linksOf(t).map((l) => l.id)))];
  const st = parseState(vctx, rel, "industry", { areaIds });
  const rows = await windowRows(env, { fromIso: st.range.fromIso, toIso: st.range.toIso, ticker: st.ticker, muted, universe: universeSql(st.tickers), rel });
  const view = industryView(rows, rel, { ticker: st.ticker, minScore: st.min_score ?? 0, kind: st.kind, limitPer: PER_GROUP,
    ...(opts.industry ? { industry: opts.industry } : {}) });
  const returnTo = hrefOf(st);
  const take = budget();
  const render = (r) => card(r, { now, returnTo, badges: [rarityBadge(r)],
    meta: (r.also || []).map((a) => `Also graded for ${a.entity || "another name"}: ${a.score ?? "no score"}`) });
  // One group (an area or a kind) with its cards, collapsed low rows and its "+n more".
  const group = (title, g, t, over) => {
    const items = g.items.slice(0, take(g.items.length));
    const hidden = g.items.length - items.length + g.more;
    return html`<h3>${title} (${g.n})</h3>${items.length ? cardList(items, render) : g.n ? "" : html`<p class="empty">Nothing in this range.</p>`}${
      hidden > 0 ? moreNote(st, hidden, { ticker: t, ...over }) : ""}`;
  };
  const sections = view.tickers.filter((s) => st.tickers.includes(s.ticker)).map((s) => html`<section data-ticker="${s.ticker}" id="t-${s.ticker}">
${sectionHead(s.ticker, `${s.n} in range`)}
${s.areas.map((a) => group(`Area ${a.id}${a.core ? " (core)" : ""}`, a, s.ticker, { kind: `area:${a.id}` }))}
${s.groups.map((g) => group(KIND_LABEL[g.kind] || g.kind, g, s.ticker, { kind: g.kind }))}
${s.n ? "" : html`<p class="empty">No industry row in this range.</p>`}
${st.ticker ? "" : html`<p class="meta"><a href="${hrefOf(st, { ticker: s.ticker })}">Only ${s.ticker}</a></p>`}
</section>`);
  const wide = view.sector_wide
    ? html`<section data-sector="wide"><h2>Sector-wide · ${view.sector_wide.n} in range</h2>
${view.sector_wide.groups.length ? view.sector_wide.groups.map((g) => group(KIND_LABEL[g.kind] || g.kind, g, null, { kind: g.kind }))
    : html`<p class="empty">No sector-wide row in this range.</p>`}</section>` : "";
  const kinds = [["All kinds", null], ...areaIds.map((id) => [`Area ${id}`, `area:${id}`]), ...KINDS.map((k) => [KIND_LABEL[k], k])];
  const body = html`${header(st, now, rows.capped.coverage || rows.capped.aux)}
${filterRow(st, "Kind", "kind", kinds)}
${filterRow(st, "Minimum score", "min_score", MIN_SCORES.map((m) => [m ? `${m}+` : "Any score", m || null]))}
${allNames(st)}
${sections}
${wide}`;
  return { title: "Industry", active: "industry", body };
}

// --- Rare finds -----------------------------------------------------------------------------------

const SHELVES = [["register", "Registers"], ["original", "Original reporting"]];
const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.first_seen || "").localeCompare(String(a.first_seen || ""));

// opts (tests only): { rel } in place of the bundled relations (for the ticker list).
export async function rarePage(vctx, opts = {}) {
  if (vctx?.auth?.ok !== true) return denied("rare");
  const { env, now, muted } = vctx;
  const rel = opts.rel ?? (await loadRelations());
  const st = parseState(vctx, rel, "rare");
  const floor = st.floor ?? RARE_DEF_FLOOR;
  const data = await rareData(env, { since: st.range.fromIso, until: st.range.key === "custom" ? st.range.toIso : null, floor, ticker: st.ticker,
    tickers: st.tickers, muted, universe: universeSql(st.tickers), now });
  const rows = [...data.coverage.map((r) => ({ ...r, pipeline: "coverage" })), ...data.aux.map((r) => ({ ...r, pipeline: "aux" }))];
  const returnTo = hrefOf(st);
  const take = budget();
  const shelves = SHELVES.map(([cls, title]) => {
    const list = rows.filter((r) => r.rarity === cls).sort(byScore);
    const items = list.slice(0, take(list.length));
    return html`<section data-shelf="${cls}"><h2>${title}</h2>
${items.length ? items.map((r) => card(r, { now, returnTo, badges: [rarityBadge(r)] })) : html`<p class="empty">Nothing at or above ${floor} in this range.</p>`}
</section>`;
  });
  const names = [["All names", null], ...st.tickers.map((t) => [t, t])];
  const body = html`${header(st, now, false)}
${filterRow(st, "Score floor", "floor", RARE_FLOORS.map((f) => [`${f}+`, f === RARE_DEF_FLOOR ? null : f]))}
${filterRow(st, "Name", "ticker", names)}
${shelves}`;
  return { title: "Rare finds", active: "rare", body };
}
