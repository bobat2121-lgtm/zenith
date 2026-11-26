// Portal (phase 3 PR-PA3): the Today view, /p/today.
// Sections, top to bottom: the range and update time; one status line (grader
// health from the newest runs, the coverage queue as /v1/ops counts it); Leads,
// Digest, Borderline and Waiting for a grade (up to 150 cards with label forms,
// grouped by the band /v1/feed shows: an undated stored lead shows as Digest);
// rejects as a count, or up to 50 cards with ?rejects=1; the covered names with
// no card at 60 or more in the range; sheet catalysts for the next 7 days; links
// to the other views.
// Reads: three statements per open (T1 cards, T2 queue, T3 runs). Rejects come in
// T1, sorted last, and are counted and cut in memory, so there is no second card
// statement. The quiet list and the calendar are computed in memory (0 rows).
// The mute fragment arrives as vctx.muted (index.js passes tuning.js MUTED_SQL),
// so this module never imports tuning.js (the portal import rule, S18).
import { html, parseRange, rangeControl, itemCard, tickerHref } from "./portal-html.js";
import { denied } from "./portal-stub.js";
import { HELD_SQL, universeSql } from "./lib.js";
import { etParts, fmtEt, fmtDay, fmtAge } from "./et.js";
import { briefCatalysts } from "./calendar.js";
import { CALENDAR } from "./calendar.generated.js";
import { expectedEvery, graderStatus, openGap } from "./grader-health.js";

export const TODAY_MAX_DAYS = 14;
export const T1_LIMIT = 400;      // one statement, rejects included (sorted last)
export const CARD_CAP = 150;      // non-reject cards shown
export const REJECT_CAP = 50;     // reject cards shown with ?rejects=1
export const QUIET_MIN = 60;      // a name is quiet with no card at this score or more
export const COMING_DAYS = 7;
const COMING_CAP = 40;
const RUNS_WINDOW = 11;           // the cadence window ops() uses
const MIN_MS = 60_000;
const PATH = "/p/today";

// The band /v1/feed shows (index.js feed): an undated stored lead is a Digest.
const SHOWN_BAND = "CASE WHEN g.band = 'lead' AND i.published IS NULL THEN 'digest' ELSE g.band END";

export function cardsSql(tickers, muted) {
  const mute = typeof muted === "string" && muted ? `AND i.source_key NOT IN ${muted}` : "";
  return `SELECT i.id, i.ticker, i.title, i.url, i.source_key, i.role, i.state, i.nm_first_seen, i.published,
       g.ticker AS grade_ticker, g.score, ${SHOWN_BAND} AS band, g.why, g.note_hook, g.event_type, g.read_source,
       (SELECT f.label FROM feedback f WHERE f.item_id = i.id AND f.ticker = COALESCE(g.ticker, i.ticker) ORDER BY f.id DESC LIMIT 1) AS label
  FROM items i LEFT JOIN grades g ON g.id = i.grade_id
 WHERE i.nm_first_seen >= ?1 AND i.nm_first_seen < ?2 AND i.state != 'skipped' AND NOT ${HELD_SQL("i.")}
   AND (g.band IS NULL OR g.band != 'duplicate') AND COALESCE(g.ticker, i.ticker) IN ${universeSql(tickers)}
   ${mute}
 ORDER BY CASE ${SHOWN_BAND} WHEN 'lead' THEN 0 WHEN 'digest' THEN 1 WHEN 'borderline' THEN 2 WHEN 'reject' THEN 4 ELSE 3 END,
          g.score DESC, i.id DESC
 LIMIT ${T1_LIMIT}`;
}

// Exactly /v1/ops backlog.coverage_pending (waiting) and coverage_held (held): no role filter.
const queueSql = (tickers) => `SELECT SUM(CASE WHEN ${HELD_SQL()} THEN 0 ELSE 1 END) AS waiting,
       SUM(CASE WHEN state = 'pending' AND ${HELD_SQL()} THEN 1 ELSE 0 END) AS held,
       MIN(CASE WHEN ${HELD_SQL()} THEN NULL ELSE COALESCE(released_at, ingested_at) END) AS oldest
  FROM items WHERE state IN ('pending','claimed') AND ticker IN ${universeSql(tickers)}`;

const RUNS_SQL = `SELECT started_at, last_seen_at FROM runs ORDER BY started_at DESC LIMIT ${RUNS_WINDOW}`;

// Grader health as ops() computes it: the cadence from the newest runs by start,
// and `last` = the greatest last_seen_at among them.
export function graderLine(runs, now, env = {}) {
  const every = expectedEvery(runs, env);
  let last = null;
  for (const r of runs || []) if (!last || String(r.last_seen_at) > String(last.last_seen_at)) last = r;
  const status = graderStatus(last?.last_seen_at, now, every);
  const seen = Date.parse(last?.last_seen_at || "");
  return {
    status,
    every,
    last_seen_min: Number.isFinite(seen) ? Math.round((now - seen) / MIN_MS) : null,
    gap: openGap(last, now, every),
  };
}

const ROW_BAND = (r) => (r.band === "lead" || r.band === "digest" || r.band === "borderline" || r.band === "reject" ? r.band : "waiting");
const SECTIONS = [["lead", "Leads"], ["digest", "Digest"], ["borderline", "Borderline"], ["waiting", "Waiting for a grade"]];

// Splits T1's rows: up to CARD_CAP non-reject cards in order, the reject count,
// up to REJECT_CAP reject cards, and whether LIMIT was hit.
export function splitRows(rows) {
  const cards = [], rejects = [];
  let nonReject = 0;
  for (const r of rows) {
    if (ROW_BAND(r) === "reject") rejects.push(r);
    else { nonReject++; if (cards.length < CARD_CAP) cards.push(r); }
  }
  return { cards, nonReject, rejectCount: rejects.length, rejectCards: rejects.slice(0, REJECT_CAP), hitLimit: rows.length >= T1_LIMIT };
}

// Covered names with no card scoring QUIET_MIN or more among the rows.
export function quietNames(rows, tickers) {
  const loud = new Set();
  for (const r of rows) if (Number(r.score) >= QUIET_MIN) loud.add(r.grade_ticker || r.ticker);
  return (tickers || []).filter((t) => !loud.has(t));
}

function todayHref(range, { rejects = false } = {}) {
  const p = new URLSearchParams();
  if (range.key === "custom") { p.set("start", range.start); p.set("end", range.end); } else p.set("range", range.key);
  if (rejects) p.set("rejects", "1");
  return `${PATH}?${p}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function statusStrip(g, q, now) {
  const grader = [`Grader ${g.status}`,
    g.last_seen_min === null ? "never seen" : `last seen ${g.last_seen_min} min ago`,
    g.gap ? `gap ${g.gap.minutes} min, about ${plural(g.gap.missed_runs, "run")} missed` : "",
    `runs every ${g.every} min`].filter(Boolean).join(" · ");
  const oldest = Date.parse(q.oldest || "");
  const queue = [`${q.waiting} waiting for a grade`, `${q.held} held for the daily budget`,
    q.waiting > 0 && Number.isFinite(oldest) ? `oldest ${fmtAge(now - oldest)} ago` : ""].filter(Boolean).join(" · ");
  return html`<p class="meta strip" data-grader="${g.status}" data-last-min="${g.last_seen_min ?? ""}" data-gap-min="${g.gap ? g.gap.minutes : ""}" data-every="${g.every}" data-waiting="${q.waiting}" data-held="${q.held}">${grader}<br>${queue}</p>`;
}

function rejectLine(split, range, showRejects) {
  const { rejectCount: n, hitLimit } = split;
  const count = hitLimit ? (n > 0 ? `At least ${plural(n, "reject")}` : "Rejects: not counted for this range") : n ? plural(n, "reject") : "No rejects in this range";
  if (showRejects) return html`<p class="meta rejects">${count} · <a href="${todayHref(range)}">Hide rejects</a></p>`;
  return html`<p class="meta rejects">${count}${n > 0 || hitLimit ? html` · <a href="${todayHref(range, { rejects: true })}">Show rejects</a>` : ""}</p>`;
}

function comingUp(tickers, now) {
  const today = etParts(now).date;
  const set = new Set(tickers || []);
  const list = briefCatalysts(CALENDAR, today, COMING_DAYS).filter((e) => set.has(e.ticker));
  const shown = list.slice(0, COMING_CAP);
  const items = shown.map((e) => {
    const t = tickerHref(e.ticker);
    return html`<li><span class="when">${fmtDay(e.start)}</span> ${t ? html`<a href="${t}">${e.ticker}</a>` : e.ticker}: ${e.approx ? "about: " : ""}${e.text}</li>`;
  });
  return html`<h2>Coming up (7 days)</h2>
${shown.length ? html`<ul class="coming">${items}</ul>` : html`<p class="empty">Nothing on the company sheets for the next 7 days.</p>`}${
  list.length > shown.length ? html`<p class="meta">${plural(list.length - shown.length, "more entry", "more entries")} in the full calendar.</p>` : ""}
<p><a href="/p/brief">Full calendar</a></p>`;
}

export async function todayView(vctx) {
  if (vctx?.auth?.ok !== true) return denied("today");
  const { env, url, now, tickers = [], muted } = vctx;
  const range = parseRange(url, { now, def: "today", maxDays: TODAY_MAX_DAYS });
  const showRejects = url.searchParams.get("rejects") === "1";
  const db = env.DB;
  const [rowsRes, queue, runsRes] = await Promise.all([
    db.prepare(cardsSql(tickers, muted)).bind(range.fromIso, range.toIso).all(),
    db.prepare(queueSql(tickers)).first(),
    db.prepare(RUNS_SQL).all(),
  ]);
  const rows = rowsRes?.results || [];
  const q = { waiting: Number(queue?.waiting) || 0, held: Number(queue?.held) || 0, oldest: queue?.oldest || null };
  const g = graderLine(runsRes?.results || [], now, env);
  const split = splitRows(rows);
  const returnTo = todayHref(range, { rejects: showRejects });
  const card = (r) => itemCard(r, { kind: "coverage", now, returnTo });

  const groups = SECTIONS.map(([band, label]) => [label, split.cards.filter((r) => ROW_BAND(r) === band)]).filter(([, list]) => list.length);
  const capped = split.nonReject > split.cards.length
    ? html`<p class="meta">Showing the first ${split.cards.length} of ${split.hitLimit ? "at least " : ""}${split.nonReject} cards; pick a shorter range for the rest.</p>` : "";
  const quiet = quietNames(rows, tickers).map((t) => [t, tickerHref(t)]).filter(([, h]) => h);

  const body = html`<p class="meta">${range.label} · Updated ${fmtEt(now, { day: false })}</p>
${rangeControl(range, PATH, TODAY_MAX_DAYS, { rejects: showRejects ? "1" : null })}
${statusStrip(g, q, now)}
${groups.length ? groups.map(([label, list]) => html`<h2>${label}</h2>${list.map(card)}`) : html`<p class="empty">No cards in this range.</p>`}
${capped}
${rejectLine(split, range, showRejects)}
${showRejects && split.rejectCards.length ? html`<h2>Rejects</h2>${split.rejectCards.map(card)}` : ""}
<h2>Quiet in this range</h2>
${quiet.length ? html`<p class="meta">No card at ${QUIET_MIN} or more.</p><ul class="names quiet">${quiet.map(([t, h]) => html`<li><a href="${h}">${t}</a></li>`)}</ul>`
    : html`<p class="empty">Every covered name has a card at ${QUIET_MIN} or more.</p>`}
${comingUp(tickers, now)}
<h2>Elsewhere</h2>
<ul class="names"><li><a href="/p/competitors">Competitors</a></li><li><a href="/p/industry">Industry</a></li><li><a href="/p/rare">Rare finds</a></li></ul>`;
  return { title: "Today", active: "today", body };
}
