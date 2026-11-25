// Scheduled reports, built from the database without an LLM:
//   * Briefs at 07:00 and 17:30 America/New_York to DISCORD_BRIEF_WEBHOOK, and
//     the same content at GET /v1/brief: Leads and Digests by ticker since the
//     last brief, counterparty items that passed, covered items still waiting
//     for a grade, the next 7 days of catalysts, council outcomes of the last 7
//     days (only when there are any), a health line, 3 items to label.
//   * Weekly calibration (Mondays 08:00 ET) to DISCORD_OPS_WEBHOOK, and at
//     GET /v1/calibration: analyst labels against the grades they were given on.
// Crons fire at both candidate UTC times (EST and EDT); slotsAt() keeps only the
// one that is the slot's ET wall time. The 5-minute tick retries missed slots.
import { json, nowIso, HELD_SQL } from "./lib.js";
import { etParts, etToUtc, addDays, fmtEt, fmtAge, fmtDay, DAY_MS } from "./et.js";
import { discordSendAll, escapeMd, clip, link, figures, bandName, splitMessages } from "./discord.js";
import { CALENDAR, CALENDAR_VERSION } from "./calendar.generated.js";
import { briefCatalysts, councilOutcomes, runtimeEntries, upcoming } from "./calendar.js";

// Cloudflare numbers weekdays 1 = Sunday to 7 = Saturday, so the Monday cron uses
// the day name, which means Monday in every cron dialect.
export const REPORT_CRONS = ["0 11,12 * * *", "30 21,22 * * *", "0 12,13 * * mon"];
const normCron = (c) => String(c || "").trim().toLowerCase().replace(/\s+/g, " ");
const CRON_ALIASES = { "0 12,13 * * 2": "0 12,13 * * mon" }; // the same trigger if Cloudflare reports it numerically
export const isReportCron = (cron) => REPORT_CRONS.includes(CRON_ALIASES[normCron(cron)] || normCron(cron));
export const SLOTS = [
  { kind: "brief_am", hour: 7, minute: 0, hook: "DISCORD_BRIEF_WEBHOOK" },
  { kind: "brief_pm", hour: 17, minute: 30, hook: "DISCORD_BRIEF_WEBHOOK" },
  { kind: "calibration", hour: 8, minute: 0, weekday: 1, hook: "DISCORD_OPS_WEBHOOK" },
];
const MIN = 60_000;
const CATCH_UP_AFTER_MIN = 10;   // the dedicated cron gets the first 10 minutes
const CATCH_UP_UNTIL_MIN = 180;
const STALE_SENDING_MIN = 15;
const MAX_REPORT_ATTEMPTS = 3;
const SECTION_CAP = { graded: 40, counterparty: 15, waiting: 20, catalysts: 25 };

// The grade that is current for (item, ticker): the item's primary grade, or a
// cross-ticker grade from the same grading pass as the primary. Needs
// `LEFT JOIN grades p ON p.id = i.grade_id`.
export const CURRENT_GRADE = `(g.id = i.grade_id OR (g.ticker != i.ticker AND g.id = (SELECT MAX(x.id) FROM grades x
    WHERE x.item_id = g.item_id AND x.ticker = g.ticker AND x.run_id IS p.run_id)))`;

// Report slots whose ET wall time is this instant's (minute precision).
export function slotsAt(ms) {
  const et = etParts(ms);
  return SLOTS.filter((s) => s.hour === et.hour && s.minute === et.minute && (s.weekday == null || s.weekday === et.weekday))
    .map((s) => ({ ...s, date: et.date, key: `${s.kind}:${et.date}`, at: etToUtc(et.date, s.hour, s.minute) }));
}

// The latest brief slot (07:00 or 17:30 ET) at least a minute before ms.
export function previousBriefAt(ms) {
  const et = etParts(ms);
  const times = [];
  for (const d of [addDays(et.date, -1), et.date]) {
    for (const s of SLOTS) if (s.kind.startsWith("brief")) times.push(etToUtc(d, s.hour, s.minute));
  }
  return Math.max(...times.filter((t) => t < ms - MIN));
}

// Where the next brief starts: the end of the last brief sent (within 48 h),
// else the brief slot before this one. slotAt is the scheduled slot's time, so a
// catch-up or late run still starts at the previous slot, not at its own.
export async function lastBriefEnd(db, now, { slotAt = now } = {}) {
  const row = await db.prepare(
    "SELECT MAX(window_to) AS t FROM reports WHERE kind IN ('brief_am','brief_pm') AND status = 'sent' AND window_to >= ? AND window_to <= ?",
  ).bind(nowIso(now - 2 * DAY_MS), nowIso(now)).first();
  return row?.t || nowIso(previousBriefAt(slotAt));
}

// --- Brief ----------------------------------------------------------------------

async function newsHealth(env, covered) {
  if (!env.NEWS) return { error: "NEWS binding missing" };
  try {
    // news-monitor-db is read-only for zenith-core: SELECT only.
    const rows = (await env.NEWS.prepare(
      "SELECT key, fail_count, last_ok, last_error FROM source_state WHERE fail_count > 0 ORDER BY fail_count DESC",
    ).all()).results || [];
    const keys = covered?.sources || {};
    return { failing: rows.filter((r) => keys[r.key]).map((r) => ({ key: r.key, ticker: keys[r.key], fail_count: r.fail_count, last_ok: r.last_ok, last_error: clip(r.last_error, 90) })) };
  } catch (e) {
    return { error: clip(e?.message || e, 120) };
  }
}

// Three unlabelled items worth the analyst's time: the top grade, the one
// nearest the Digest line, and one graded with little evidence.
// tickers: the covered universe (a dropped name never reaches the brief); null keeps all.
export async function pickToLabel(db, now, n = 3, tickers = null) {
  const rows = (await db.prepare(
    `SELECT i.id AS item_id, i.ticker, i.title, i.url, g.score, g.band, g.confidence, g.read_source
       FROM items i JOIN grades g ON g.id = i.grade_id
      WHERE i.nm_first_seen >= ? AND g.score IS NOT NULL AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.item_id = i.id)
        ${tickers ? "AND i.ticker IN (SELECT value FROM json_each(?))" : ""}
      ORDER BY g.score DESC, i.id DESC LIMIT 300`,
  ).bind(nowIso(now - 7 * DAY_MS), ...(tickers ? [JSON.stringify(tickers)] : [])).all()).results || [];
  const out = [];
  const take = (row, why) => { if (row && !out.some((o) => o.item_id === row.item_id)) out.push({ ...row, why }); };
  const left = () => rows.filter((r) => !out.some((o) => o.item_id === r.item_id));
  take(rows[0], "top grade");
  take(left().filter((r) => r.score >= 55 && r.score <= 85).sort((a, b) => Math.abs(a.score - 70) - Math.abs(b.score - 70))[0], "near the Digest line (70)");
  take(left().filter((r) => r.score >= 40).sort((a, b) => (a.read_source - b.read_source) || ((a.confidence ?? 1) - (b.confidence ?? 1)))[0], "graded with little evidence");
  for (const r of left()) { if (out.length >= n) break; take(r, "recent grade"); }
  return out.slice(0, n);
}

export async function buildBrief(env, covered, { from, to, now = Date.now(), kind = "brief" }) {
  const db = env.DB;
  const graded = ((await db.prepare(
    `SELECT g.id AS grade_id, g.item_id, g.ticker, g.score, g.band, g.event_type, g.why, g.note_hook, g.magnitude_usd,
            g.magnitude_pct, g.read_source, g.graded_at, i.title, i.url, i.role, i.affects, i.ticker AS item_ticker,
            i.source_key, i.nm_first_seen, i.headline, i.headline_tag
       FROM grades g JOIN items i ON i.id = g.item_id LEFT JOIN grades p ON p.id = i.grade_id
      WHERE g.graded_at >= ?1 AND g.graded_at < ?2 AND g.score >= 70 AND ${CURRENT_GRADE}
      ORDER BY g.score DESC, g.id DESC LIMIT 400`,
  ).bind(from, to).all()).results || []).filter((r) => !covered?.tickers || covered.tickers.includes(r.ticker)); // dropped names stay out
  const groups = new Map();
  for (const r of graded.filter((r) => !r.role)) {
    if (!groups.has(r.ticker)) groups.set(r.ticker, []);
    groups.get(r.ticker).push(r);
  }
  const byTicker = [...groups.entries()].map(([ticker, items]) => ({ ticker, items }))
    .sort((a, b) => b.items[0].score - a.items[0].score || a.ticker.localeCompare(b.ticker));

  // Dropped names (covered.json no longer lists them) never reach the waiting list or counts.
  const tickers = covered?.tickers || null;
  const inUniverse = tickers ? " AND ticker IN (SELECT value FROM json_each(?))" : "";
  const tickerBind = tickers ? [JSON.stringify(tickers)] : [];
  // Held rows (the daily grading budget, budget.js) are not waiting: they are
  // counted apart in waiting.held, both roles.
  const waitingRows = (await db.prepare(
    `SELECT id AS item_id, ticker, title, url, source_key, state, nm_first_seen, ingested_at
       FROM items WHERE state IN ('pending','claimed') AND role IS NULL AND NOT ${HELD_SQL()}${inUniverse} ORDER BY nm_first_seen DESC LIMIT 60`,
  ).bind(...tickerBind).all()).results || [];
  const counts = await db.prepare(
    `SELECT SUM(CASE WHEN role IS NULL THEN 1 ELSE 0 END) AS own, SUM(CASE WHEN role IS NOT NULL THEN 1 ELSE 0 END) AS cp,
            MIN(CASE WHEN role IS NULL THEN MAX(nm_first_seen, ingested_at) END) AS oldest
       FROM items WHERE state IN ('pending','claimed') AND NOT ${HELD_SQL()}${inUniverse}`,
  ).bind(...tickerBind).first();
  const heldCount = await db.prepare(
    `SELECT COUNT(*) AS n FROM items WHERE state IN ('pending','claimed') AND ${HELD_SQL()}${inUniverse}`,
  ).bind(...tickerBind).first();

  // Sheet entries, graded notices and council agendas (runtimeEntries logs and
  // drops a failing part), covered tickers only.
  const today = etParts(now).date;
  const runtime = await runtimeEntries(db, { sinceIso: nowIso(now - 120 * DAY_MS) });
  const catalysts = briefCatalysts([...CALENDAR, ...runtime], today, 7).filter((e) => !tickers || tickers.includes(e.ticker));
  // Council agendas closed or deferred in the last 7 days (their agenda day is past).
  const councilOut = councilOutcomes(runtime, today, 7).filter((e) => !tickers || tickers.includes(e.ticker));

  const lastRun = await db.prepare("SELECT id, last_seen_at, graded, rejected FROM runs ORDER BY last_seen_at DESC LIMIT 1").first();
  const gradedInWindow = await db.prepare("SELECT COUNT(*) AS n FROM grades WHERE graded_at >= ? AND graded_at < ?").bind(from, to).first();
  return {
    kind, generated_at: nowIso(now), from, to, today,
    leads_digests: byTicker,
    counterparty: graded.filter((r) => r.role),
    waiting: { count: counts?.own || 0, counterparty_count: counts?.cp || 0, oldest: counts?.oldest || null, held: heldCount?.n || 0, items: waitingRows },
    catalysts,
    council_outcomes: councilOut,
    health: {
      grader_last_run: lastRun?.last_seen_at || null,
      graded_in_window: gradedInWindow?.n || 0,
      news_monitor: await newsHealth(env, covered),
    },
    to_label: await pickToLabel(db, now, 3, tickers),
  };
}

function gradedLine(r) {
  const fig = figures(r);
  const cross = r.item_ticker && r.item_ticker !== r.ticker ? ` (from a ${r.item_ticker} item)` : "";
  const lead = r.band === "lead";
  return `• **${r.score}** ${bandName(r.band)} · ${escapeMd(clip(r.title, lead ? 150 : 120))}${cross} — ${escapeMd(clip(r.why, lead ? 240 : 150))}${fig ? ` (${fig})` : ""} ${link(r.url)}`.trimEnd();
}

// A council agenda's tag: its outcome once a decision row closed or deferred it.
function councilTag(e) {
  if (e.closed) return ` · decided: ${escapeMd(clip(e.outcome, 90))}`;
  if (e.deferred) return ` · deferred: ${escapeMd(clip(e.outcome, 90))}`;
  return " · council agenda";
}

// A header stays in the same Discord message as the first line under it.
function section(L, header, lines, empty) {
  const body = lines.length ? lines : [empty];
  L.push("", `${header}\n${body[0]}`, ...body.slice(1));
}

function labelUrl(publicUrl, itemId) {
  if (!publicUrl) return "";
  try { const u = new URL("/m", publicUrl); u.hash = `i${itemId}`; return u.protocol === "https:" ? `<${u}>` : ""; } catch { return ""; }
}

export function renderBrief(b, { publicUrl = "", now = Date.parse(b.generated_at) } = {}) {
  const L = [];
  const name = b.kind === "brief_am" ? "morning brief" : b.kind === "brief_pm" ? "evening brief" : "brief";
  L.push(`**Zenith ${name} · ${fmtEt(Date.parse(b.to))}**`);
  L.push(`-# since ${fmtEt(Date.parse(b.from))}`);

  const nGraded = b.leads_digests.reduce((k, g) => k + g.items.length, 0);
  const graded = [];
  let shown = 0;
  for (const g of b.leads_digests) {
    if (shown >= SECTION_CAP.graded) break;
    const lines = [];
    for (const r of g.items) { if (shown++ >= SECTION_CAP.graded) break; lines.push(gradedLine(r)); }
    graded.push(`__${g.ticker}__\n${lines[0]}`, ...lines.slice(1));
  }
  if (nGraded > SECTION_CAP.graded) graded.push(`… and ${nGraded - SECTION_CAP.graded} more in the app.`);
  section(L, `**Leads and Digests** (${nGraded})`, graded, "None graded since the last brief.");

  const cp = b.counterparty.slice(0, SECTION_CAP.counterparty).map((r) =>
    `• **${r.ticker}** ← ${escapeMd(r.role)} · **${r.score}** · ${escapeMd(clip(r.title, 140))} — ${escapeMd(clip(r.why, 180))} ${link(r.url)}`.trimEnd());
  if (b.counterparty.length > SECTION_CAP.counterparty) cp.push(`… and ${b.counterparty.length - SECTION_CAP.counterparty} more.`);
  section(L, `**Counterparty items that passed** (${b.counterparty.length})`, cp, "None.");

  const w = b.waiting;
  const waiting = w.items.slice(0, SECTION_CAP.waiting).map((r) =>
    `• **${r.ticker}** · ${fmtAge(now - Date.parse(r.nm_first_seen))} · ${escapeMd(clip(r.title, 150))} ${link(r.url)}`.trimEnd());
  if (w.count > SECTION_CAP.waiting) waiting.push(`… and ${w.count - SECTION_CAP.waiting} more.`);
  section(L, `**Waiting for a grade** (${w.count} covered${w.counterparty_count ? `, ${w.counterparty_count} counterparty` : ""})${w.oldest ? ` · oldest ${fmtAge(now - Date.parse(w.oldest))}` : ""}`,
    waiting, "Queue is clear.");

  const cats = b.catalysts.slice(0, SECTION_CAP.catalysts).map((e) => {
    const when = e.precision === "day" ? fmtDay(e.start) : `from ${fmtDay(e.start)} (${e.precision === "part" || e.precision === "month" ? "window" : e.precision})`;
    const tag = e.kind === "council_agenda" ? councilTag(e) : e.confirmed ? " · confirmed notice" : e.recurring ? " · weekly" : e.approx ? " · estimate" : e.deadline ? " · deadline" : "";
    return `• ${when} · **${e.ticker}** · ${escapeMd(clip(e.text, 170))}${e.time ? ` (${escapeMd(e.time)})` : ""}${tag}`;
  });
  if (b.catalysts.length > SECTION_CAP.catalysts) cats.push(`… and ${b.catalysts.length - SECTION_CAP.catalysts} more at /v1/calendar.`);
  section(L, "**Next 7 days**", cats, "Nothing dated.");

  // Omitted while empty, so the brief text is unchanged until the first outcome.
  const outcomes = b.council_outcomes || [];
  if (outcomes.length) {
    const lines = outcomes.slice(0, SECTION_CAP.catalysts).map((e) =>
      `• ${fmtDay(e.outcome_day)} · **${e.ticker}** · ${escapeMd(clip(e.text, 170))}${councilTag(e)}`);
    if (outcomes.length > SECTION_CAP.catalysts) lines.push(`… and ${outcomes.length - SECTION_CAP.catalysts} more.`);
    section(L, "**Council outcomes, last 7 days**", lines, "");
  }

  const h = b.health;
  const grader = h.grader_last_run ? `grader last ran ${fmtEt(Date.parse(h.grader_last_run))} (${fmtAge(now - Date.parse(h.grader_last_run))} ago)` : "grader has never run";
  const nm = h.news_monitor;
  const nmText = nm.error ? `news-monitor: unavailable (${escapeMd(nm.error)})`
    : !nm.failing.length ? "news-monitor: all covered sources OK"
    : `news-monitor: ${nm.failing.length} covered source${nm.failing.length === 1 ? "" : "s"} failing: ${nm.failing.slice(0, 8).map((s) => `${s.key} (${s.ticker}, ${s.fail_count} fails${s.last_ok ? `, ok ${fmtAge(now - Date.parse(s.last_ok))} ago` : ", never ok"})`).join(", ")}`;
  L.push("", `**Health** · ${grader}; ${h.graded_in_window} grades in this window · ${nmText}`);

  section(L, "**Label these**", b.to_label.map((r) => {
    const u = labelUrl(publicUrl, r.item_id);
    return `• item ${r.item_id} · **${r.ticker} ${r.score}** · ${escapeMd(clip(r.title, 130))} · _${r.why}_${u ? ` · ${u}` : ""}`;
  }), "Nothing unlabelled this week.");
  return splitMessages(L);
}

// --- Calibration ---------------------------------------------------------------

// The analyst's label ranges on the 0-100 scale (grader/zenith.mjs LABEL_RANGE).
export const LABEL_RANGE = { high: [80, 100], medium: [60, 89], low: [30, 69], noise: [0, 29] };

// agree | too_high | too_low (the grade, relative to the label), or null.
export function verdict(label, score) {
  if (label === "too_high" || label === "too_low") return label;
  const r = LABEL_RANGE[label];
  if (!r || score == null) return null;
  return score > r[1] ? "too_high" : score < r[0] ? "too_low" : "agree";
}

function summarize(rows) {
  const s = { n: rows.length, agree: 0, too_high: 0, too_low: 0, unscored: 0, labels: {} };
  for (const r of rows) {
    s.labels[r.label] = (s.labels[r.label] || 0) + 1;
    const v = verdict(r.label, r.score);
    if (v) s[v]++; else s.unscored++;
  }
  s.scored = s.agree + s.too_high + s.too_low;
  s.agreement = s.scored ? Math.round((100 * s.agree) / s.scored) : null;
  return s;
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = r[key] || "ungraded"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return Object.fromEntries([...m.entries()].map(([k, v]) => [k, summarize(v)]));
}

// One pipeline's calibration: rows are the latest label per item, `by` the
// column to group by (ticker for coverage, entity for auxiliary names).
function calibrationOf(rows, weekFrom, labelledThisWeek, by) {
  const week = rows.filter((r) => r.created_at >= weekFrom);
  const dist = (r) => {
    const v = verdict(r.label, r.score);
    if (v === "agree" || !v) return -1;
    const range = LABEL_RANGE[r.label];
    return range ? (v === "too_high" ? r.score - range[1] : range[0] - r.score) : 10;
  };
  const misses = week.map((r) => ({ ...r, verdict: verdict(r.label, r.score), distance: dist(r) }))
    .filter((r) => r.distance >= 0).sort((a, b) => b.distance - a.distance).slice(0, 5);
  const key = `by_${by}`;
  return {
    labelled_this_week: labelledThisWeek,
    this_week: { ...summarize(week), by_band: groupBy(week, "band"), [key]: groupBy(week, by) },
    all_time: { ...summarize(rows), by_band: groupBy(rows, "band"), [key]: groupBy(rows, by) },
    misses: misses.map((r) => ({ item_id: r.item_id, [by]: r[by], label: r.label, reason: r.reason ?? null, score: r.score, band: r.band, title: r.title, verdict: r.verdict })),
  };
}

// Coverage calibration at the top level (the Monday report renders it), with
// the auxiliary names' (aux_feedback against aux_grades, by entity) under aux
// and the analyst's reason codes (migration 0011) over both under reasons.
export async function buildCalibration(db, { now = Date.now() } = {}) {
  const weekFrom = nowIso(now - 7 * DAY_MS);
  const rows = (await db.prepare(
    `SELECT f.id, f.item_id, f.label, f.reason, f.created_at, g.score, g.band, COALESCE(g.ticker, i.ticker) AS ticker, i.title
       FROM feedback f JOIN items i ON i.id = f.item_id LEFT JOIN grades g ON g.id = f.grade_id
      WHERE f.id IN (SELECT MAX(id) FROM feedback GROUP BY item_id)`,
  ).all()).results || [];
  const labelled = await db.prepare("SELECT COUNT(DISTINCT item_id) AS n FROM feedback WHERE created_at >= ?").bind(weekFrom).first();
  const auxRows = (await db.prepare(
    `SELECT f.id, f.item_id, f.label, f.reason, f.created_at, g.score, g.band, COALESCE(g.entity, i.entity_name) AS entity, i.title
       FROM aux_feedback f JOIN aux_items i ON i.id = f.item_id LEFT JOIN aux_grades g ON g.id = f.grade_id
      WHERE f.id IN (SELECT MAX(id) FROM aux_feedback GROUP BY item_id)`,
  ).all()).results || [];
  const auxLabelled = await db.prepare("SELECT COUNT(DISTINCT item_id) AS n FROM aux_feedback WHERE created_at >= ?").bind(weekFrom).first();
  const reasons = {};
  for (const r of [...rows, ...auxRows]) if (r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  return {
    generated_at: nowIso(now), week_from: weekFrom,
    ...calibrationOf(rows, weekFrom, labelled?.n || 0, "ticker"),
    aux: calibrationOf(auxRows, weekFrom, auxLabelled?.n || 0, "entity"),
    reasons,
  };
}

const pct = (s) => (s.agreement == null ? "n/a" : `${s.agree}/${s.scored} agree (${s.agreement}%)`);
const dirs = (s) => [s.too_high && `${s.too_high} graded too high`, s.too_low && `${s.too_low} too low`].filter(Boolean).join(", ");

export function renderCalibration(c) {
  const L = [`**Zenith calibration · week to ${fmtEt(Date.parse(c.generated_at))}**`];
  const w = c.this_week, a = c.all_time;
  if (!a.n) {
    L.push("No labels yet. Label the 3 items in each brief (or on /m) so the grader can learn your bar.");
    return splitMessages(L);
  }
  L.push(`Items labelled this week: **${c.labelled_this_week}** (all time ${a.n}).`);
  L.push(`This week: ${pct(w)}${dirs(w) ? ` · ${dirs(w)}` : ""} · "too high" labels ${w.labels.too_high || 0} · "too low" labels ${w.labels.too_low || 0}`);
  L.push(`All time: ${pct(a)}${dirs(a) ? ` · ${dirs(a)}` : ""} · "too high" labels ${a.labels.too_high || 0} · "too low" labels ${a.labels.too_low || 0}`);
  const bandOrder = ["lead", "digest", "borderline", "reject", "duplicate", "ungraded"];
  L.push("", "**By band (all time)**");
  for (const b of bandOrder) {
    const s = a.by_band[b];
    if (s) L.push(`• ${bandName(b) || b}: ${s.n} labelled · ${pct(s)}${dirs(s) ? ` · ${dirs(s)}` : ""}`);
  }
  L.push("", "**By ticker (all time)**");
  const tickers = Object.entries(a.by_ticker).sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]));
  L.push(tickers.map(([t, s]) => `${t} ${s.agreement == null ? `${s.n}` : `${s.agree}/${s.scored}`}${s.too_high ? ` ↑${s.too_high}` : ""}${s.too_low ? ` ↓${s.too_low}` : ""}`).join(" · "));
  L.push("-# ↑ grade too high, ↓ too low. Ranges: high 80-100, medium 60-89, low 30-69, noise 0-29.");
  if (c.misses.length) {
    L.push("", "**Largest misses this week**");
    for (const m of c.misses) L.push(`• item ${m.item_id} · ${m.ticker} graded ${m.score ?? "dup"} · labelled ${m.label} · ${escapeMd(clip(m.title, 120))}`);
  }
  return splitMessages(L);
}

// --- Slots ------------------------------------------------------------------------

// Claims a slot (first run, a retry of a failed or partial send, or a send a
// crashed run left 'sending' for 15 minutes). Returns the claimed row or null.
async function claimReport(db, slot, now) {
  const nowS = nowIso(now);
  const r = await db.prepare(
    `INSERT INTO reports (slot, kind, status, attempts, created_at, updated_at) VALUES (?1, ?2, 'sending', 1, ?3, ?3)
     ON CONFLICT(slot) DO UPDATE SET status = 'sending', attempts = reports.attempts + 1, updated_at = excluded.updated_at
      WHERE (reports.status IN ('failed','partial') AND reports.attempts < ?4) OR (reports.status = 'sending' AND reports.updated_at < ?5)`,
  ).bind(slot.key, slot.kind, nowS, MAX_REPORT_ATTEMPTS, nowIso(now - STALE_SENDING_MIN * MIN)).run();
  if (!(r.meta.changes > 0)) return null;
  return db.prepare("SELECT * FROM reports WHERE slot = ?").bind(slot.key).first();
}

const jsonArray = (s) => { try { const v = JSON.parse(s || "null"); return Array.isArray(v) ? v : null; } catch { return null; } };

// Renders the slot's messages once and stores them with the window, then sends
// them paced to Discord's rate limit, recording each message id as it goes. A
// retry of a partial (or crashed) send resumes at the first unsent message, so
// the start is never repeated and the tail is never dropped.
export async function runSlot(env, covered, slot, { now = Date.now(), fetchImpl = globalThis.fetch, sleep } = {}) {
  const hook = env[slot.hook];
  if (!hook) return { slot: slot.key, status: "off" };
  const db = env.DB;
  const claimed = await claimReport(db, slot, now);
  if (!claimed) return { slot: slot.key, status: "already" };
  let contents = jsonArray(claimed.contents);
  let sent = contents?.length ? jsonArray(claimed.message_ids) || [] : [];
  try {
    if (!contents?.length) {
      let windowFrom = null;
      const windowTo = nowIso(now);
      if (slot.kind === "calibration") {
        contents = renderCalibration(await buildCalibration(db, { now }));
      } else {
        windowFrom = await lastBriefEnd(db, now, { slotAt: slot.at ?? now });
        contents = renderBrief(await buildBrief(env, covered, { from: windowFrom, to: windowTo, now, kind: slot.kind }),
          { publicUrl: env.ZENITH_PUBLIC_URL || "", now });
      }
      await db.prepare("UPDATE reports SET contents=?, message_ids='[]', window_from=?, window_to=?, updated_at=? WHERE slot=?")
        .bind(JSON.stringify(contents), windowFrom, windowTo, nowIso(), slot.key).run();
    }
    const resumed = sent.length;
    const res = await discordSendAll(hook, contents.slice(resumed), {
      fetchImpl, sleep,
      onSent: (ids) => db.prepare("UPDATE reports SET message_ids=?, updated_at=? WHERE slot=?")
        .bind(JSON.stringify([...sent, ...ids]), nowIso(), slot.key).run(),
    });
    sent = [...sent, ...res.ids];
    const status = res.ok ? "sent" : sent.length ? "partial" : "failed";
    await db.prepare("UPDATE reports SET status=?, message_ids=?, error=?, updated_at=? WHERE slot=?")
      .bind(status, JSON.stringify(sent), res.ok ? null : String(res.error || "").slice(0, 300), nowIso(), slot.key).run();
    return { slot: slot.key, status, messages: sent.length, of: contents.length, ...(resumed ? { resumed } : {}), ...(res.ok ? {} : { error: res.error }) };
  } catch (e) {
    // Retries resume from the stored messages and ids whatever this status says.
    const status = sent.length ? "partial" : "failed";
    await db.prepare("UPDATE reports SET status=?, error=?, updated_at=? WHERE slot=?")
      .bind(status, String(e?.message || e).slice(0, 300), nowIso(), slot.key).run();
    return { slot: slot.key, status, error: String(e?.message || e) };
  }
}

// Dedicated report crons: run whichever slots this scheduled time is.
export async function runReportSlots(env, covered, scheduledTime, opts = {}) {
  const out = [];
  for (const slot of slotsAt(scheduledTime)) out.push(await runSlot(env, covered, slot, { now: Date.now(), ...opts }));
  return out.length ? out : [{ status: "not_a_slot", et: fmtEt(scheduledTime) }];
}

// 5-minute tick: a slot whose cron did not deliver within 10 minutes (or went
// out in part) is retried for up to 3 hours.
export async function catchUpReports(env, covered, { now = Date.now(), fetchImpl = globalThis.fetch, sleep } = {}) {
  const et = etParts(now);
  const out = [];
  for (const s of SLOTS) {
    if (s.weekday != null && s.weekday !== et.weekday) continue;
    if (!env[s.hook]) continue;
    const at = etToUtc(et.date, s.hour, s.minute);
    if (now < at + CATCH_UP_AFTER_MIN * MIN || now > at + CATCH_UP_UNTIL_MIN * MIN) continue;
    const slot = { ...s, date: et.date, key: `${s.kind}:${et.date}`, at };
    const row = await env.DB.prepare("SELECT status FROM reports WHERE slot = ?").bind(slot.key).first();
    if (row?.status === "sent") continue;
    out.push(await runSlot(env, covered, slot, { now, fetchImpl, sleep }));
  }
  return out;
}

// --- Routes -----------------------------------------------------------------------

const isIso = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));

export async function briefRoute(env, covered, url) {
  const now = Date.now();
  const since = url.searchParams.get("since");
  let from = isIso(since) ? new Date(Date.parse(since)).toISOString() : await lastBriefEnd(env.DB, now);
  if (Date.parse(from) < now - 7 * DAY_MS) from = nowIso(now - 7 * DAY_MS);
  const brief = await buildBrief(env, covered, { from, to: nowIso(now), now, kind: "brief" });
  // window: whether from came from ?since or from the last brief slot.
  return json({ ...brief, window: isIso(since) ? "since" : "last_brief", text: renderBrief(brief, { publicUrl: env.ZENITH_PUBLIC_URL || "", now }) });
}

// Covered tickers only: a dropped name's graded notice stays out.
export async function calendarRoute(env, covered, url) {
  const q = url.searchParams;
  const now = Date.now();
  const days = Math.max(1, Math.min(400, Number(q.get("days")) || 30));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") || "") ? q.get("from") : etParts(now).date;
  const ticker = (q.get("ticker") || "").toUpperCase() || null;
  const entries = await upcoming(env.DB, CALENDAR, { from, days, ticker, tickers: covered?.tickers || null, noticesSince: nowIso(now - 120 * DAY_MS) });
  return json({ calendar_version: CALENDAR_VERSION, from, days, ticker, entries });
}

// { coverage: {..., text: the Monday report}, aux: {same shape, by entity}, reasons: {code: n} }
export async function calibrationRoute(env) {
  const c = await buildCalibration(env.DB, { now: Date.now() });
  const { aux, reasons, ...coverage } = c;
  return json({ generated_at: c.generated_at, week_from: c.week_from, coverage: { ...coverage, text: renderCalibration(c) }, aux, reasons });
}
