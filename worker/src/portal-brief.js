// Portal (phase 3 Part E, PR-E3): the Brief view, /p/brief.
// Shows the stored weekday morning brief (brief_days, written by brief-store.js
// on the 5-minute tick) and never builds one: the live, on-request brief stays
// at /v1/brief for the Streamlit app, so this module never imports brief.js.
// Reads per open: Q3 (the last 10 stored days, no contents) and Q1' (one row by
// primary key). It writes nothing; the router's portal_views upsert counts the
// open. Every stored string is escaped by `html`; item links go through itemCard
// (safeHref) and ticker links through tickerHref.
//
// Sections, in order: Leads and Digests; Competitors and peers; Industry (with
// the register readings); Counterparty (rival rows are under Competitors);
// Waiting; Next 7 days; Calendar, next 30 days (id="calendar", the target of
// Today's "Full calendar" link); Council outcomes; Health.
//
// When the stored copy had to be cut to fit 64 KB, brief-store.js names the
// rows it cut per list in contents.truncated ({ list: rows cut }). The page says
// so at the top and in each cut section, so a list emptied by the cut is never
// shown as a list with nothing in it.
import { html, itemCard, tickerHref, TICKER_RE } from "./portal-html.js";
import { denied } from "./portal-stub.js";
import { etParts, fmtEt, fmtDay, addDays, weekdayOf } from "./et.js";
import { pushOn } from "./push-routes.js";

export const BRIEF_PATH = "/p/brief";
export const STRIP_ROWS = 10;
export const WHY_CLIP = 150;
const REGISTER_CLIP = 160;
const STRIP_DAYS = 14;   // calendar days of weekdays shown in the strip, stored or not

// Q3 (primary-key range, at most 10 rows, no contents): the day strip.
export const Q3_SQL = `SELECT day, status, counts FROM brief_days WHERE universe_id='u1' AND kind='brief_am' AND day <= ?1
  ORDER BY day DESC LIMIT ${STRIP_ROWS}`;
// Q1' (primary key, 1 row): the selected day; error is read for a failed day's "Not built" line.
export const Q1V_SQL = "SELECT status, window_from, window_to, counts, contents, error FROM brief_days WHERE universe_id='u1' AND day=? AND kind='brief_am'";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar date written YYYY-MM-DD (2026-13-01 and 2026-02-30 are not).
export function validDay(d) {
  if (typeof d !== "string" || !DAY_RE.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}
const isDay = validDay;

// The names contents.truncated uses (brief-store.js CUT_ORDER) as the page shows them.
export const CUT_NAMES = {
  leads_digests: "Leads and Digests",
  competitors: "Competitors and peers",
  competitors_below: "Competitors and peers, below the Digest line",
  industry: "Industry",
  industry_below: "Industry, below the Digest line",
  counterparty: "Counterparty",
  catalysts: "Next 7 days",
  calendar: "Calendar, next 30 days",
  council_outcomes: "Council outcomes",
  health_failing: "Health, failing sources",
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n) => {
  const v = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v;
};
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
const list = (v) => (Array.isArray(v) ? v : []);
const ok = (s) => s && typeof s === "object" && !s.error;
const etTime = (iso) => { const ms = Date.parse(iso || ""); return Number.isFinite(ms) ? fmtEt(ms) : ""; };
const dayText = (d) => (isDay(d) ? fmtDay(d) : String(d ?? ""));
const parseJson = (s) => { if (typeof s !== "string") return null; try { return JSON.parse(s); } catch { return null; } };

// { list: rows cut } from contents.truncated: positive integers only.
export function cutsOf(contents) {
  const t = contents?.truncated;
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const out = {};
  for (const [k, v] of Object.entries(t)) if (Number.isInteger(v) && v > 0) out[k] = v;
  return out;
}

// The note at the top when the stored copy was cut to fit.
function truncatedNote(contents) {
  if (!contents || !("truncated" in contents)) return "";
  const cuts = cutsOf(contents) || {};
  const names = Object.entries(cuts).map(([k, n]) => `${CUT_NAMES[k] || k} (${plural(n, "row")})`);
  return html`<p class="note truncated" role="note" data-truncated="${Object.keys(cuts).join(" ")}"><strong>This stored brief was cut to fit the 64 KB store.</strong> ${
    names.length ? `Rows cut from the bottom of: ${names.join("; ")}.` : "Some rows were cut from the bottom of its lists."} A cut list below says so; it was not empty. The counts are the full numbers.</p>`;
}

// The per-list line under a cut list (nothing when the list was not cut).
function cutLine(cuts, key, kept) {
  const n = cuts?.[key] || 0;
  if (!n) return "";
  return html`<p class="meta cut" data-cut="${key}">${kept ? `${plural(n, "more row")} cut to fit the store.` : `All ${plural(n, "row")} cut to fit the store.`}</p>`;
}

// A list section body: rows, or the empty text; a cut list never shows the empty text.
function rowsOr(rows, render, empty, cuts, key) {
  const cut = cutLine(cuts, key, rows.length > 0);
  if (rows.length) return html`${rows.map(render)}${cut}`;
  return cut || html`<p class="empty">${empty}</p>`;
}

const failed = () => html`<p class="empty">This section failed to build.</p>`;
const missing = () => html`<p class="empty">Not in this stored brief.</p>`;

function coverageCard(r, ctx) {
  return itemCard(r, { kind: "coverage", now: ctx.now, returnTo: ctx.returnTo });
}

function auxCard(r, ctx, { badges = [], meta = [] } = {}) {
  const seen = etTime(r.graded_at);
  return itemCard({ ...r, why: clip(r.why, WHY_CLIP) || null }, {
    kind: "aux", now: ctx.now, returnTo: ctx.returnTo,
    extra: { badges, meta: [...meta, seen ? `graded ${seen}` : ""] },
  });
}

const signOf = (d) => (typeof d === "string" && d ? d : "±");

// A Competitors entry: aux rows as aux cards, Coverage rival rows as coverage cards.
// A by_ticker entry carries its own ticker and direction. A below-the-line entry
// (brief-sections.js) carries them as tickers: [{ ticker, direction }], one badge
// each; its top-level ticker, when it has one, is the Coverage row's own company.
function competitorCard(r, ctx, below = false) {
  const tk = below ? list(r.tickers).filter((t) => t && typeof t.ticker === "string" && TICKER_RE.test(t.ticker)) : [];
  const badges = tk.length ? tk.map((t) => `${signOf(t.direction)} ${t.ticker}`) : [`${signOf(r.direction)} ${r.ticker || ""}`.trim()];
  if (r.pipeline === "coverage") {
    return itemCard({ ...r, why: clip(r.why, WHY_CLIP) || null }, {
      kind: "coverage", now: ctx.now, returnTo: ctx.returnTo, extra: { badges },
    });
  }
  return auxCard(r, ctx, { badges });
}

function industryCard(r, ctx) {
  const badges = [r.tag || r.status || "", ...list(r.tickers).filter((t) => typeof t === "string")];
  return auxCard(r, ctx, { badges: badges.length > 1 || badges[0] ? badges : ["sector"] });
}

// "None at 70+ since …" with the section's waiting counts (as the brief text says it).
function noneLine(s, from, tail = "") {
  const w = s.waiting || {};
  const wait = !w || w.error ? "waiting count unavailable" : `${num(w.n) ?? 0} waiting for a grade (${num(w.held) ?? 0} held by the daily budget)`;
  const since = etTime(from);
  return html`<p class="empty">None at 70+${since ? ` since ${since}` : ""}. ${wait}${tail}</p>`;
}

function belowBlock(s, render, ctx, cuts, key) {
  const rows = list(s.below);
  if (!rows.length && !cuts?.[key]) return "";
  return html`<p class="sub"><strong>Below the Digest line</strong></p>${rows.map((r) => render(r, ctx))}${cutLine(cuts, key, rows.length > 0)}`;
}

function leadsSection(c, counts, ctx, cuts) {
  const rows = list(c.leads_digests).flatMap((g) => list(g?.items));
  const total = num(counts?.leads_digests);
  const shown = total !== null && total > rows.length ? html`<p class="meta">Showing ${rows.length} of ${total}.</p>` : "";
  return html`<h2>Leads and Digests</h2>${shown}${rowsOr(rows, (r) => coverageCard(r, ctx), "None graded at 70+ in this window.", cuts, "leads_digests")}`;
}

function competitorsSection(c, ctx, cuts) {
  const s = c.competitors;
  const head = html`<h2>Competitors and peers</h2>`;
  if (!s) return html`${head}${missing()}`;
  if (!ok(s)) return html`${head}${failed()}`;
  const groups = list(s.by_ticker).filter((g) => list(g?.items).length);
  const count = num(s.count) ?? 0;
  const body = groups.map((g) => {
    const t = tickerHref(g.ticker);
    return html`<p class="sub grp">${t ? html`<a class="tk" href="${t}">${g.ticker}</a>` : g.ticker}</p>${list(g.items).map((r) => competitorCard({ ...r, ticker: r.ticker || g.ticker }, ctx))}`;
  });
  const more = num(s.more) > 0 ? html`<p class="meta">${plural(num(s.more), "more entry", "more entries")} past the brief's cap.</p>` : "";
  const cut = cutLine(cuts, "competitors", groups.length > 0);
  const none = !count && !groups.length && !cut ? noneLine(s, c.from, `; ${num(s.rival_sources) ?? 0} rival sources followed.`) : "";
  return html`${head}${count ? html`<p class="meta">${plural(count, "row")} at 70+.</p>` : ""}${body}${more}${cut}${none}${belowBlock(s, (r) => competitorCard(r, ctx, true), ctx, cuts, "competitors_below")}`;
}

function registersBlock(regs) {
  if (regs === undefined || regs === null) return "";
  if (!Array.isArray(regs)) return html`<p class="sub"><strong>Register readings</strong></p><p class="empty">Register readings were not available.</p>`;
  if (!regs.length) return html`<p class="sub"><strong>Register readings</strong></p><p class="empty">No new register reading in this window.</p>`;
  return html`<p class="sub"><strong>Register readings</strong></p><ul class="registers">${regs.map((r) => html`<li>${clip(r?.text, REGISTER_CLIP)}</li>`)}</ul>`;
}

function industrySection(c, ctx, cuts) {
  const s = c.industry;
  const head = html`<h2>Industry</h2>`;
  if (!s) return html`${head}${missing()}`;
  if (!ok(s)) return html`${head}${failed()}`;
  const rows = list(s.items);
  const count = num(s.count) ?? 0;
  const more = count > rows.length + (cuts?.industry || 0) ? html`<p class="meta">${plural(count - rows.length - (cuts?.industry || 0), "more row")} past the brief's cap.</p>` : "";
  const cut = cutLine(cuts, "industry", rows.length > 0);
  const none = !count && !rows.length && !cut ? noneLine(s, c.from, ".") : "";
  return html`${head}${count ? html`<p class="meta">${plural(count, "row")} at 70+.</p>` : ""}${rows.map((r) => industryCard(r, ctx))}${more}${cut}${none}${
    belowBlock(s, industryCard, ctx, cuts, "industry_below")}${registersBlock(s.registers)}`;
}

function counterpartySection(c, ctx, cuts) {
  const all = list(c.counterparty);
  const rows = all.filter((r) => r?.role !== "rival");
  const rivals = all.length - rows.length;
  const note = rivals ? html`<p class="meta">${plural(rivals, "rival row")} listed under Competitors and peers.</p>` : "";
  return html`<h2>Counterparty</h2>${note}${rowsOr(rows, (r) => coverageCard(r, ctx), "None.", cuts, "counterparty")}`;
}

function waitingSection(c, ctx) {
  const w = c.waiting && typeof c.waiting === "object" ? c.waiting : {};
  const rows = list(w.items);
  const count = num(w.count) ?? 0;
  const line = [`${count} covered waiting for a grade`, num(w.counterparty_count) ? `${num(w.counterparty_count)} counterparty` : "",
    `${num(w.held) ?? 0} held by the daily budget`, w.oldest ? `oldest first seen ${etTime(w.oldest)}` : ""].filter(Boolean).join(" · ");
  const kept = rows.length < count
    ? html`<p class="meta">${rows.length ? `Showing ${rows.length} of ${count}.` : "The waiting list was not kept in the stored copy."}</p>` : "";
  return html`<h2>Waiting</h2><p class="meta">${line}</p>${rows.map((r) => coverageCard(r, ctx))}${kept}${!count && !rows.length ? html`<p class="empty">Queue is clear.</p>` : ""}`;
}

// A calendar entry as the brief text writes it.
function entryLine(e) {
  const when = e?.precision === "day" || !e?.precision ? dayText(e?.start)
    : `from ${dayText(e.start)} (${e.precision === "part" || e.precision === "month" ? "window" : e.precision})`;
  const tag = e?.kind === "council_agenda" ? (e.closed ? `decided: ${clip(e.outcome, 90)}` : e.deferred ? `deferred: ${clip(e.outcome, 90)}` : "council agenda")
    : e?.confirmed ? "confirmed notice" : e?.recurring ? "weekly" : e?.approx ? "estimate" : e?.deadline ? "deadline" : "";
  const t = tickerHref(e?.ticker);
  return html`<li><span class="when">${when}</span> ${t ? html`<a href="${t}">${e.ticker}</a>` : e?.ticker || ""}: ${clip(e?.text, 280)}${
    e?.time ? ` (${e.time})` : ""}${tag ? html` <span class="meta">${tag}</span>` : ""}</li>`;
}

function entriesBlock(rows, empty, cuts, key) {
  const cut = cutLine(cuts, key, rows.length > 0);
  if (!rows.length) return cut || html`<p class="empty">${empty}</p>`;
  return html`<ul class="coming">${rows.map(entryLine)}</ul>${cut}`;
}

function calendarSection(c, counts, cuts) {
  const rows = list(c.calendar);
  if (!("calendar" in c)) return html`<h2 id="calendar">Calendar, next 30 days</h2>${missing()}`;
  const total = num(counts?.calendar);
  const shown = total !== null && total > rows.length && !(cuts?.calendar) ? html`<p class="meta">Showing ${rows.length} of ${total} entries.</p>` : "";
  return html`<h2 id="calendar">Calendar, next 30 days</h2>${shown}${entriesBlock(rows, "Nothing on the calendar for the next 30 days.", cuts, "calendar")}`;
}

function outcomesSection(c, cuts) {
  const rows = list(c.council_outcomes);
  const cut = cutLine(cuts, "council_outcomes", rows.length > 0);
  const body = rows.length
    ? html`<ul class="coming">${rows.map((e) => {
      const t = tickerHref(e?.ticker);
      const tag = e?.closed ? `decided: ${clip(e.outcome, 90)}` : e?.deferred ? `deferred: ${clip(e.outcome, 90)}` : "council agenda";
      return html`<li><span class="when">${dayText(e?.outcome_day)}</span> ${t ? html`<a href="${t}">${e.ticker}</a>` : e?.ticker || ""}: ${clip(e?.text, 170)} <span class="meta">${tag}</span></li>`;
    })}</ul>${cut}`
    : cut || html`<p class="empty">None in the last 7 days.</p>`;
  return html`<h2>Council outcomes</h2>${body}`;
}

function healthSection(c, cuts) {
  const h = c.health && typeof c.health === "object" ? c.health : {};
  const grader = h.grader_last_run ? `Grader last ran ${etTime(h.grader_last_run)}` : "The grader had not run";
  const nm = h.news_monitor && typeof h.news_monitor === "object" ? h.news_monitor : null;
  const failing = list(nm?.failing);
  const cut = cutLine(cuts, "health_failing", failing.length > 0);
  let nmBody;
  if (!nm || nm.error) nmBody = html`<p class="meta">news-monitor: unavailable${nm?.error ? ` (${clip(nm.error, 120)})` : ""}.</p>`;
  else if (!failing.length && !cut) nmBody = html`<p class="meta">news-monitor: all covered sources OK.</p>`;
  else {
    nmBody = html`<p class="meta">news-monitor: covered sources failing:</p><ul class="failing">${failing.map((s) => html`<li>${s?.key || ""} (${s?.ticker || ""}, ${
      num(s?.fail_count) ?? 0} fails${s?.last_ok ? `, last ok ${etTime(s.last_ok)}` : ", never ok"})</li>`)}</ul>${cut}`;
  }
  return html`<h2>Health</h2><p class="meta">${grader}; ${num(h.graded_in_window) ?? 0} grades in this window.</p>${nmBody}`;
}

// The weekdays of the last STRIP_DAYS calendar days and every Q3 day, newest first.
function dayStrip(rows, today, selected) {
  const stored = new Map(rows.map((r) => [r.day, r]));
  const days = new Set(rows.map((r) => r.day).filter(isDay));
  for (let d = today, k = 0; k < STRIP_DAYS; k++, d = addDays(d, -1)) {
    const w = weekdayOf(d);
    if (w >= 1 && w <= 5) days.add(d);
  }
  const items = [...days].sort().reverse().map((d) => {
    const r = stored.get(d);
    const cur = d === selected ? html` aria-current="true"` : "";
    if (!r) return html`<li class="missing" data-day="${d}"${cur}>${fmtDay(d)} · not stored</li>`;
    return html`<li data-day="${d}"><a href="${BRIEF_PATH}?day=${d}"${cur}>${fmtDay(d)}</a>${r.status === "ok" ? "" : html` <span class="meta">${r.status}</span>`}</li>`;
  });
  return html`<nav aria-label="Stored days"><ul class="names days">${items}</ul></nav>`;
}

// The Lead alerts panel (web push, PR-E4): rendered only while push is on and the
// viewer signed in through Access with an email, so it is invisible while push is
// off and in session mode. The public key sits in a data- attribute (it is public);
// the shell's one script drives the buttons and is inert without this element.
export function pushPanel(vctx) {
  const a = vctx?.auth;
  if (!pushOn(vctx?.env) || a?.via !== "access" || typeof a.email !== "string" || !a.email.trim()) return "";
  return html`<section class="push" data-push-panel data-key="${vctx.env.VAPID_PUBLIC_KEY}"><h2>Lead alerts</h2>
<p class="meta">A notification on this device when a covered company gets a new graded Lead (at most 5 a day).</p>
<p class="meta push-home" hidden>Add Zenith to your Home Screen (Share → Add to Home Screen), open it from there, then turn alerts on. Needs iOS 16.4 or later.</p>
<div class="btns"><button type="button" data-push="on">Turn on Lead alerts</button><button type="button" data-push="test">Send a test</button><button type="button" data-push="off">Turn off</button></div>
<p class="status push-status" role="status"></p></section>`;
}

// briefView(vctx) -> { title, active, body, status? }
export async function briefView(vctx) {
  if (vctx?.auth?.ok !== true) return denied("brief");
  const { env, url, now } = vctx;
  const asked = url.searchParams.get("day");
  if (asked !== null && !isDay(asked)) {
    return { title: "Brief", active: "brief", status: 400, body: html`<p>Bad day: use a date written YYYY-MM-DD.</p><p><a href="${BRIEF_PATH}">Latest brief</a></p>` };
  }
  const today = etParts(now).date;
  const panel = pushPanel(vctx);
  const db = env.DB;
  const strip = (await db.prepare(Q3_SQL).bind(today).all())?.results || [];
  const day = asked ?? (strip.some((r) => r.day === today) ? today : strip[0]?.day ?? null);
  if (!day) {
    return { title: "Brief", active: "brief", body: html`<p class="empty">No brief stored yet. The morning brief is stored each weekday from 07:00 ET.</p>${dayStrip(strip, today, null)}${panel}` };
  }
  const row = await db.prepare(Q1V_SQL).bind(day).first();
  const head = html`<p class="meta brief-head"><strong>Morning brief · ${fmtDay(day)}</strong>${row?.window_from ? ` · since ${etTime(row.window_from)}` : ""}</p>`;
  const tail = dayStrip(strip, today, day);
  if (!row) return { title: "Brief", active: "brief", body: html`${head}<p class="empty">Not stored: no brief was stored for this day.</p>${tail}${panel}` };
  if (row.status !== "ok") {
    return { title: "Brief", active: "brief", body: html`${head}<p class="empty">Not built: ${clip(row.error ?? "", 300) || "unknown error"}</p>${tail}${panel}` };
  }
  const c = parseJson(row.contents);
  if (!c || typeof c !== "object") return { title: "Brief", active: "brief", body: html`${head}<p class="empty">The stored copy could not be read.</p>${tail}${panel}` };
  const counts = parseJson(row.counts) || {};
  const cuts = cutsOf(c);
  const ctx = { now, returnTo: `${BRIEF_PATH}?day=${day}` };
  const body = html`${head}${truncatedNote(c)}
${leadsSection(c, counts, ctx, cuts)}
${competitorsSection(c, ctx, cuts)}
${industrySection(c, ctx, cuts)}
${counterpartySection(c, ctx, cuts)}
${waitingSection(c, ctx)}
<h2>Next 7 days</h2>${entriesBlock(list(c.catalysts), "Nothing dated.", cuts, "catalysts")}
${calendarSection(c, counts, cuts)}
${outcomesSection(c, cuts)}
${healthSection(c, cuts)}
<h2>Stored days</h2>${tail}${panel}`;
  return { title: "Brief", active: "brief", body };
}
