// Portal (phase 3 P3-B3): the Company page, /p/c/<T>. One VIEWS line in portal.js.
// The data is company.js companyData (the same object GET /v1/company returns);
// this module only renders it. Top to bottom: the name, the window links (7, 14,
// 30 days), "Full calendar" and "Search this company"; the "all quiet" line; the
// nine sections in the audit's order (own items, filings, ownership, registers,
// series, rivals, key accounts, calendar, source health), each with its count,
// up to 8 rows, "Show all <n>" (?section=<name>, up to 100) and its empty state;
// the reference lists (competitors and key accounts on file) in <details>.
// Coverage rows render through itemCard with the label form to /p/api/feedback,
// aux rows through itemCard({ kind: "aux" }) with the form to /p/api/aux-feedback.
// Every string from zenith-db, news-monitor-db or the relations bundle goes
// through `html` interpolation; every URL through safeHref (itemCard does it for
// cards). Links are built from parsed values with URLSearchParams; the raw query
// string is never echoed. The view fails closed (403, no statement) unless
// vctx.auth?.ok === true, and sets no headers.
// Imports portal-html.js, portal-stub.js, company.js and et.js only (the portal
// import rule, S18: company.js is the one module that may read news-monitor-db).
import { html, itemCard, safeHref, tickerHref, TICKER_RE } from "./portal-html.js";
import { denied } from "./portal-stub.js";
import { companyData, redactError, SECTIONS, SECTION_ROWS, MAX_DAYS, DEFAULT_DAYS } from "./company.js";
import { etParts, addDays, fmtDay, fmtEt } from "./et.js";

export const DAY_LINKS = [7, 14, 30];
export const ERROR_CLIP = 80;
const SEARCH_PATH = "/p/search";
const BRIEF_PATH = "/p/brief";

export const SECTION_TITLES = {
  own: "Own items", filings: "Filings", ownership: "Ownership", registers: "Registers", series: "Series", rivals: "Rivals",
  key_accounts: "Key accounts", calendar: "Calendar", source_health: "Source health",
};
const GROUP_LABELS = { own: "own channels", sec: "SEC", registers: "registers", key_accounts: "key accounts", rivals: "rivals" };
// Which read feeds which section, for the "more stored than one read returns" note.
// Q2e feeds own items and registers too: a covered-band row about T (company.js step 10).
const TRUNCATES = {
  own: ["q1", "q2", "q2e"], filings: ["q1"], ownership: ["q1"], registers: ["q1", "q2", "q2e"], series: ["q6"], rivals: ["q1", "q2", "q2e"],
  key_accounts: ["q1", "q2", "q3"], calendar: ["q1"], source_health: ["q4", "q4m"],
};
// The reads ordered newest first; a cut on any other read (Q2e, Q4, Q4m, Q6) keeps rows in index order.
const NEWEST_FIRST = new Set(["q1", "q2", "q3"]);
const STATUS_TEXT = { ok: "OK", failing: "failing", disabled: "disabled", overdue: "overdue", never: "never polled" };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (v) => (Array.isArray(v) ? v : []);
const etDay = (s) => {
  const ms = Date.parse(s || "");
  return Number.isFinite(ms) ? fmtDay(etParts(ms).date) : "";
};

// --- Parameters and links ---------------------------------------------------------------------------

// The ticker from the path (the router has already matched it against TICKER_RE and
// deps.tickers; it is checked again here), days 1-30 (else the default) and a section.
export function parsePage(vctx) {
  const segs = String(vctx.url.pathname).split("/").filter(Boolean);
  const raw = segs.length === 3 && segs[0] === "p" && segs[1] === "c" ? segs[2] : "";
  const ticker = TICKER_RE.test(raw) && list(vctx.tickers).includes(raw) ? raw : null;
  const q = vctx.url.searchParams;
  const d = String(q.get("days") ?? "");
  const days = /^\d{1,2}$/.test(d) && Number(d) >= 1 && Number(d) <= MAX_DAYS ? Number(d) : DEFAULT_DAYS;
  const s = q.get("section");
  const section = SECTIONS.includes(s) ? s : null;
  return { ticker, days, section };
}

function pageHref(T, { days, section = null, anchor = "" }) {
  const p = new URLSearchParams();
  if (days !== DEFAULT_DAYS) p.set("days", String(days));
  if (section) p.set("section", section);
  const s = p.toString();
  return `${tickerHref(T)}${s ? `?${s}` : ""}${anchor}`;
}

const searchHref = (T) => `${SEARCH_PATH}?${new URLSearchParams({ ticker: T })}`;

// --- Fragments --------------------------------------------------------------------------------------

function leftOutLine(lo) {
  if (!lo || !lo.n) return "";
  const reasons = Object.entries(lo.reasons || {}).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([r, n]) => `${r} ${n}`).join(", ");
  return html`<p class="meta left-out">${plural(lo.n, "stored row")} left out (${reasons}).</p>`;
}

function copiesList(copies) {
  if (!copies?.length) return "";
  return html`<details class="copies"><summary>${plural(copies.length, "copy", "copies")}</summary><ul>${copies.map((c) => {
    const href = safeHref(c.url);
    const title = c.title || c.headline || "(untitled)";
    return html`<li>${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>` : title} <span class="meta">${c.source_key || ""}</span></li>`;
  })}</ul></details>`;
}

function rowCard(r, ctx) {
  const badges = [];
  if (r.copy) badges.push("copy");
  if (r.on_record) badges.push("on record, not graded");
  else if ((r.score === null || r.score === undefined) && !r.band) badges.push("waiting for a grade");
  if (r.undated) badges.push("undated");
  if (r.about) badges.push(r.about);
  const meta = [r.undated ? `first seen ${etDay(r.nm_first_seen)}` : `published ${etDay(r.published)}`];
  if (r.kind === "aux" && r.channel) meta.push(r.channel);
  const kind = r.kind === "aux" ? "aux" : "coverage";
  return html`${itemCard(r, { kind, now: ctx.now, returnTo: ctx.returnTo, extra: { badges, meta } })}${copiesList(r.copies)}`;
}

function moreLinks(name, s, ctx) {
  const total = Number(s.total) || 0;
  const shownNow = list(s.rows).length;
  if (ctx.section === name) {
    const back = html`<p><a href="${pageHref(ctx.T, { days: ctx.days, anchor: `#${name}` })}">Show fewer</a></p>`;
    return total > shownNow ? html`<p class="meta">Showing the first ${shownNow} of ${total}.</p>${back}` : back;
  }
  if (total > SECTION_ROWS && total > shownNow) return html`<p><a href="${pageHref(ctx.T, { days: ctx.days, section: name, anchor: `#${name}` })}">Show all ${total}</a></p>`;
  return "";
}

// Exported for tests.
export function truncatedNote(name, data) {
  const hits = (TRUNCATES[name] || []).filter((k) => data.truncated?.[k] === true);
  if (!hits.length) return "";
  return hits.every((k) => NEWEST_FIRST.has(k))
    ? html`<p class="meta">More rows are stored than one read returns; showing the newest.</p>`
    : html`<p class="meta">More rows are stored than one read returns; some are not shown.</p>`;
}

function emptyText(name, data, ctx) {
  const { T, days } = ctx;
  const g = data.quiet?.groups || {};
  const keys = (k) => Number(g[k]?.keys) || 0;
  const lo = Number(data.sections?.[name]?.left_out?.n) || 0;
  switch (name) {
    case "own":
      return `No release, deck, event or newsroom post from ${T}'s own channels in the last ${days} days (${plural(keys("own"), "own channel")} checked).`;
    case "filings":
      return keys("sec") ? `No SEC filing for ${T} in the last ${days} days.` : `${T} has no SEC channel.`;
    case "ownership":
      return `No ownership filing stored for ${T} in the last ${days} days. Zenith keeps only open-market Form 4 buys at small caps and 13D filings; the full strip (Forms 3, 4, 5, 144, 13G, D) waits on decision 3.`;
    case "registers":
      return keys("registers")
        ? `No register record (contracts, council items, federal notices) for ${T} in the last ${days} days; ${plural(keys("registers"), "register source")} checked.`
        : `No register source follows ${T} yet.`;
    case "series":
      return `No number series for ${T}. Series come from registers such as the Texas DMV automated-vehicle report.`;
    case "rivals":
      return `No rival news shown for ${T} in the last ${days} days (${plural(keys("rivals"), "rival source")} checked; ${plural(lo, "stored headline")} left out).`;
    case "key_accounts":
      return `No key-account news shown for ${T} in the last ${days} days (${plural(keys("key_accounts"), "source")} checked).`;
    case "calendar":
      return `No dated catalyst for ${T} between ${fmtDay(addDays(ctx.today, -days))} and ${fmtDay(addDays(ctx.today, 30))}.`;
    default:
      return "";
  }
}

// --- Sections ---------------------------------------------------------------------------------------

function rowSection(name, data, ctx) {
  const s = data.sections[name];
  const rows = list(s.rows);
  const body = rows.length ? rows.map((r) => rowCard(r, ctx)) : html`<p class="empty">${emptyText(name, data, ctx)}</p>`;
  let tail = "";
  if (name === "rivals") tail = competitorsList(data);
  if (name === "key_accounts") tail = html`${alsoGraded(data, ctx)}${keyAccountsList(data)}`;
  // The rivals empty text already counts the rows left out.
  return html`${body}${name === "rivals" && !rows.length ? "" : leftOutLine(s.left_out)}${moreLinks(name, s, ctx)}${tail}`;
}

function competitorsList(data) {
  const comps = list(data.reference?.competitors);
  if (!comps.length) return html`<p class="meta">No competitors on file.</p>`;
  return html`<details class="ref"><summary>Competitors on file (${comps.length})</summary><ul>${comps.map((c) =>
    html`<li>${c.name || c.entity_key} <span class="meta">${[c.direction || "", list(c.via).join(", "), c.watched ? "watched" : ""].filter(Boolean).join(" · ")}</span></li>`)}</ul></details>`;
}

function keyAccountsList(data) {
  const accts = list(data.reference?.key_accounts);
  if (!accts.length) return html`<p class="meta">No key accounts on file.</p>`;
  return html`<details class="ref"><summary>Key accounts on file (${accts.length})</summary><ul>${accts.map((a) =>
    html`<li>${a.name || ""}${a.kind ? html` <span class="meta">${a.kind}</span>` : ""}</li>`)}</ul></details>`;
}

function alsoGraded(data, ctx) {
  const rows = list(data.also_graded);
  if (!rows.length) return "";
  const total = Number(data.also_graded_total) || rows.length;
  return html`<h3 class="sub">Also graded for ${ctx.T} (${total})</h3>
<p class="meta">Other names' items the grader also scored for ${ctx.T}; they do not fill this section.</p>${rows.map((r) => rowCard(r, ctx))}${
    total > rows.length && ctx.section !== "key_accounts" ? html`<p><a href="${pageHref(ctx.T, { days: ctx.days, section: "key_accounts", anchor: "#key_accounts" })}">Show all ${total}</a></p>` : ""}`;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));
function seriesSection(data, ctx) {
  const rows = list(data.sections.series.rows);
  const ownLines = rows.filter((r) => r.own);
  const items = rows.map((r) => {
    const who = r.own ? r.subject : r.subject === "_total" ? "total" : r.subject === "_companies" ? "companies" : r.subject;
    const href = safeHref(r.record_url);
    const prev = r.previous ? `, previous ${r.previous.value} (${r.previous.period})` : "";
    const change = r.change === null || r.change === undefined ? "" : `, change ${signed(r.change)}`;
    return html`<li><span class="when">${r.latest?.period ?? ""}</span> ${r.series} · ${who}: ${r.latest?.value ?? ""}${prev}${change}${
      r.label ? html` <span class="meta">${r.label}</span>` : ""}${href ? html` <a href="${href}" target="_blank" rel="noopener noreferrer">record</a>` : ""}</li>`;
  });
  return html`${ownLines.length ? "" : html`<p class="empty">${emptyText("series", data, ctx)}</p>`}${rows.length ? html`<ul class="series">${items}</ul>` : ""}`;
}

function whenText(e) {
  const span = e.end && e.end !== e.start ? `${fmtDay(e.start)} – ${fmtDay(e.end)}` : fmtDay(e.start);
  return e.time ? `${span} ${e.time}` : span;
}

function calendarSection(data, ctx) {
  const s = data.sections.calendar;
  const rows = list(s.rows);
  const items = rows.map((e) => {
    const href = safeHref(e.url);
    const tags = [...list(e.tags), e.closed ? "closed" : "", e.deferred ? "deferred" : "", e.outcome ? `outcome: ${e.outcome}` : "", e.counted ? "" : "not counted"]
      .filter(Boolean);
    return html`<li><span class="when">${whenText(e)}</span> ${e.text || ""}${tags.length ? html` <span class="meta">${tags.join(" · ")}</span>` : ""}${
      href ? html` <a href="${href}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</li>`;
  });
  return html`${Number(s.counted) > 0 ? "" : html`<p class="empty">${emptyText("calendar", data, ctx)}</p>`}${rows.length ? html`<ul class="coming">${items}</ul>` : ""}${
    moreLinks("calendar", s, ctx)}<p><a href="${BRIEF_PATH}">Full calendar</a></p>`;
}

function healthLine(r) {
  const bits = [STATUS_TEXT[r.status] || r.status || "", `${GROUP_LABELS[r.group] || r.group || ""}`, r.channel || "",
    r.last_ok ? `last OK ${etDay(r.last_ok)}` : "", r.fail_count ? plural(r.fail_count, "failed poll") : ""].filter(Boolean);
  const err = redactError(r.last_error, ERROR_CLIP);
  const rules = list(r.open_rules);
  return html`<li data-status="${r.status || ""}">${r.key} <span class="meta">${bits.join(" · ")}${err ? html` · ${err}` : ""}${
    rules.length ? html` · open alerts: ${rules.join(", ")}` : ""}</span></li>`;
}

function healthSection(data) {
  const s = data.sections.source_health;
  if (s.available === false || data.quiet?.available === false) return html`<p class="empty">Source health unavailable; channels not confirmed.</p>`;
  const rows = list(s.rows);
  const bad = rows.filter((r) => r.status !== "ok" || list(r.open_rules).length);
  const g = data.quiet?.groups || {};
  const summary = ["own", "sec", "registers", "key_accounts", "rivals"].filter((k) => g[k]?.keys)
    .map((k) => `${GROUP_LABELS[k]} ${g[k].ok} of ${g[k].keys} OK`);
  return html`<p class="meta">${summary.length ? summary.join(" · ") : "No channel follows this name."}</p>${
    bad.length ? html`<ul class="health bad">${bad.map(healthLine)}</ul>` : html`<p class="meta">Every channel polled without error.</p>`}${
    rows.length ? html`<details class="ref"><summary>All ${plural(rows.length, "channel")}</summary><ul class="health">${rows.map(healthLine)}</ul></details>` : ""}`;
}

function section(name, data, ctx) {
  const s = data.sections[name];
  let inner;
  if (name === "series") inner = seriesSection(data, ctx);
  else if (name === "calendar") inner = calendarSection(data, ctx);
  else if (name === "source_health") inner = healthSection(data);
  else inner = rowSection(name, data, ctx);
  const n = name === "source_health" ? list(s.rows).length : Number(s.total ?? s.shown) || 0;
  const filled = name === "source_health" ? "" : `${s.filled ? "filled" : "not filled"}${name === "calendar" ? ` · ${Number(s.counted) || 0} counted` : ""}`;
  return html`<section id="${name}" data-filled="${s.filled ? "1" : "0"}"><h2>${SECTION_TITLES[name]} (${n})</h2>${
    filled ? html`<p class="meta">${filled}</p>` : ""}${truncatedNote(name, data)}${inner}</section>`;
}

// --- The view -----------------------------------------------------------------------------------------

export async function companyView(vctx) {
  if (vctx?.auth?.ok !== true) return denied("companies");
  const { ticker: T, days, section: only } = parsePage(vctx);
  if (!T) return { title: "Not found", active: "companies", body: html`<p>Not found.</p>`, status: 404 };
  const now = vctx.now ?? Date.now();
  const data = await companyData(vctx.env, T, { days, section: only, now, muted: vctx.muted });
  // A ticker the portal lists but company.js does not cover (a stale deploy) reads nothing.
  if (data?.error) return { title: T, active: "companies", body: html`<p class="empty">No company data for ${T}.</p>` };
  const ctx = { T, days, section: only, now, today: etParts(now).date, returnTo: pageHref(T, { days, section: only }) };
  const dayLinks = DAY_LINKS.map((d) => html`<a href="${pageHref(T, { days: d, section: only })}"${d === days ? html` aria-current="true"` : ""}>${d} days</a>`);
  const counts = html`<p class="meta filled" data-filled="${data.filled_count}" data-filled-no-reject="${data.filled_excluding_reject_count}" data-filled-lenient="${
    data.filled_lenient_count}">${data.filled_count} of ${SECTIONS.length - 1} sections filled (${data.filled_excluding_reject_count} without rejects, ${
    data.filled_lenient_count} under the lenient rule).</p>`;
  const body = html`<p class="meta">${data.name && data.name !== T ? html`${data.name} · ` : ""}${T} · last ${days} days · Updated ${fmtEt(now, { day: false })}</p>
<nav class="presets" aria-label="Window">${dayLinks}</nav>
<p><a href="${BRIEF_PATH}">Full calendar</a> · <a href="${searchHref(T)}">Search this company</a></p>
<p class="quiet" data-new="${data.quiet?.new_24h ?? 0}">${data.quiet?.text || ""}</p>
${counts}
${SECTIONS.map((name) => section(name, data, ctx))}`;
  return { title: T, active: "companies", body };
}
