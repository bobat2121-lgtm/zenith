// Catalyst calendar.
//   Build time (scripts/build-calendar.mjs): extractSheetCalendar() reads each
//   company sheet's open_items (target / expires_at), status_events, dated
//   thesis_drivers and the "Catalyst calendar" section into dated entries.
//   Run time: upcoming() merges those entries with graded date notices
//   (calendar_card grades, dated from the title) and council agendas (legistar_*
//   items, councilAgendas) for GET /v1/calendar and the brief.
// Entry: { ticker, kind, start, end, precision, text, approx?, deadline?,
//          context?, recur?: { weekday }, id?, item_id?, url?, time?, confirmed? }
//   precision: day | part (early/mid/late month) | month | quarter | half | season | year | range
import { addDays, weekdayOf } from "./et.js";
import { MATCH } from "./rubric.generated.js";
import { phraseRegex } from "./lib.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PRECISION_RANK = { day: 0, part: 1, month: 2, season: 3, quarter: 4, half: 5, year: 6, range: 7 };

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthKey = (s) => MONTHS[s.slice(0, 3)] ?? MONTHS[s.slice(0, 4)];

// Plain text from a markdown fragment.
export function plainText(s) {
  return String(s ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const QUAL = "((?:early|mid|late|end)(?:[\\s-]+(?:to|-)[\\s-]+(?:early|mid|late|end))?)(?:[\\s-]+of)?[\\s-]+";

// Spans for one parsed point.
function monthSpan(y, m, qual) {
  const last = lastDay(y, m);
  const q = (qual || "").replace(/\s+/g, " ");
  const from = /^early/.test(q) ? 1 : /^mid/.test(q) ? 11 : /^(late|end)/.test(q) ? 21 : 1;
  const toWord = (q.match(/(early|mid|late|end)$/) || [])[1];
  const to = !q ? last : toWord === "early" ? 10 : toWord === "mid" ? 20 : last;
  return { start: iso(y, m, from), end: iso(y, m, to), precision: q ? "part" : "month" };
}
function yearSpan(y, qual) {
  if (qual === "early") return { start: iso(y, 1, 1), end: iso(y, 4, 30), precision: "year" };
  if (qual === "mid") return { start: iso(y, 5, 1), end: iso(y, 8, 31), precision: "year" };
  if (qual === "late") return { start: iso(y, 9, 1), end: iso(y, 12, 31), precision: "year" };
  if (qual === "end" || qual === "exit") return { start: iso(y, 12, 1), end: iso(y, 12, 31), precision: "month" };
  return { start: iso(y, 1, 1), end: iso(y, 12, 31), precision: "year" };
}

// Finds the date points in a phrase, left to right. A month without a year
// takes the year of the next point (or the previous one).
function points(text) {
  let s = ` ${String(text).toLowerCase().replace(/[–—]/g, "-")} `;
  const found = [];
  const take = (re, fn) => {
    s = s.replace(re, (m, ...g) => {
      const idx = g[g.length - 2];
      const p = fn(...g);
      if (p) found.push({ ...p, idx, len: m.length });
      return " ".repeat(m.length);
    });
  };
  take(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (y, m, d) => (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? { unit: "day", y: +y, m: +m, d: +d } : null));
  take(/\b(20\d\d)-(0[1-9]|1[0-2])\b(?!-\d)/g, (y, m) => ({ unit: "month", y: +y, m: +m }));
  take(new RegExp(`(?:\\b${QUAL})?\\b${MONTH_RE}\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:%|days?|weeks?)))?(?:,?\\s+(20\\d\\d))?\\b`, "g"),
    (qual, mon, day, y) => {
      if (mon === "may" && !y && !qual && !day) return null; // the verb "may"
      return { unit: day ? "day" : "month", y: y ? +y : null, m: monthKey(mon), d: day ? +day : null, qual: day ? null : qual };
    });
  take(/\b(?:(early|late|end of)\s+)?q([1-4])(?:\s*(?:-|to)\s*q([1-4]))?\s+(20\d\d)\b/g, (qual, a, b, y) => ({ unit: "quarter", y: +y, q: +a, q2: b ? +b : +a, qual }));
  take(/\b(?:(end of)\s+)?(?:([12])h|h([12]))\s+(20\d\d)\b/g, (qual, a, b, y) => ({ unit: "half", y: +y, h: +(a || b), qual }));
  take(/\b(spring|summer|fall|autumn|winter)\s+(20\d\d)\b/g, (season, y) => ({ unit: "season", y: +y, season }));
  take(/(?:\b(early|mid|late|end|exit)(?:\s+of)?[\s-]+)?\b(20\d\d)(?:-(\d\d))?\b(?![-\d])/g, (qual, y, y2) => ({ unit: "year", y: +y, y2: y2 ? 2000 + +y2 : null, qual }));
  found.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < found.length; i++) {
    if (found[i].y == null) {
      const next = found.slice(i + 1).find((p) => p.y != null);
      const prev = found.slice(0, i).reverse().find((p) => p.y != null);
      found[i].y = next?.y ?? prev?.y ?? null;
    }
  }
  return { found: found.filter((p) => p.y != null), masked: s };
}

function spanOf(p) {
  switch (p.unit) {
    case "day": return { start: iso(p.y, p.m, Math.min(p.d, lastDay(p.y, p.m))), end: iso(p.y, p.m, Math.min(p.d, lastDay(p.y, p.m))), precision: "day" };
    case "month": return monthSpan(p.y, p.m, p.qual);
    case "quarter": {
      const s = monthSpan(p.y, (p.q - 1) * 3 + 1, null), e = monthSpan(p.y, p.q2 * 3, null);
      if (p.qual === "end of") return { ...monthSpan(p.y, p.q2 * 3, null), precision: "month" };
      return { start: s.start, end: e.end, precision: p.q === p.q2 ? "quarter" : "range" };
    }
    case "half": return p.qual === "end of" ? { ...monthSpan(p.y, p.h * 6, null) } : { start: iso(p.y, p.h === 1 ? 1 : 7, 1), end: iso(p.y, p.h === 1 ? 6 : 12, p.h === 1 ? 30 : 31), precision: "half" };
    case "season": {
      const k = p.season === "autumn" ? "fall" : p.season;
      const span = { spring: [3, 20, 6, 20], summer: [6, 21, 9, 22], fall: [9, 23, 12, 20], winter: [12, 21, 3, 19] }[k];
      return { start: iso(p.y, span[0], span[1]), end: iso(k === "winter" ? p.y + 1 : p.y, span[2], span[3]), precision: "season" };
    }
    case "year": {
      if (p.y2 && p.y2 > p.y && p.y2 - p.y <= 5) return { start: iso(p.y, 1, 1), end: iso(p.y2, 12, 31), precision: "range" };
      return yearSpan(p.y, p.qual);
    }
  }
  return null;
}

// Parses a date phrase ("About mid-December 2026", "Q4 2026 to 2027",
// "2026-12-18, 17:00 CET"). Returns { start, end, precision, approx, deadline } or null.
// multiDay: return every day-precision date instead of one span.
export function parseDatePhrase(raw, { multiDay = false } = {}) {
  const full = plainText(raw);
  const text = full.replace(/\([^()]*\)/g, " ").replace(/\([^()]*\)/g, " ");
  const lower = full.toLowerCase();
  const { found, masked } = points(text);
  if (!found.length) return multiDay ? [] : null;
  const approx = /\b(about|around|expected|estimate[ds]?|approx\w*|likely|possible|planned|target(?:ed)?|guided)\b|~/.test(lower);
  const deadline = /^\s*(?:about\s+)?(by|through|before|no later than|deadline)\b/.test(lower);
  if (multiDay) {
    const days = found.filter((p) => p.unit === "day");
    if (days.length > 1) {
      const seen = new Set();
      return days.map((p) => ({ ...spanOf(p), approx, deadline })).filter((d) => !seen.has(d.start) && seen.add(d.start));
    }
  }
  let span;
  const between = (a, b) => masked.slice(a.idx + a.len, b.idx);
  if (found.length >= 2 && /^\s*(?:-|to|through|into|until|and)\s*$/.test(between(found[0], found[1]))) {
    const a = spanOf(found[0]), b = spanOf(found[1]);
    span = { start: a.start, end: b.end > a.start ? b.end : a.end, precision: "range" };
  } else {
    let best = found[0];
    for (const p of found) if (PRECISION_RANK[spanOf(p).precision] < PRECISION_RANK[spanOf(best).precision]) best = p;
    span = spanOf(best);
  }
  if (!span) return multiDay ? [] : null;
  const res = { ...span, approx, deadline };
  return multiDay ? [res] : res;
}

// "Every Monday" / "Weekly ... each Monday" -> 1.
function recurringWeekday(label, body) {
  const l = plainText(label).toLowerCase();
  if (!/^(every|each)\s+\w+day\b|^weekly\b/.test(l)) return null;
  const m = /\b(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(`${l} ${plainText(body).toLowerCase()}`);
  return m ? WEEKDAY_NAMES.indexOf(m[1]) : null;
}

// Front matter of a sheet (a leading --- block or a ```yaml fence).
export function frontMatter(md) {
  const text = String(md).replace(/\r\n/g, "\n");
  const dashed = /^(?:```ya?ml\n)?---\n([\s\S]*?)\n---/.exec(text);
  if (dashed) return dashed[1];
  const fenced = /```ya?ml\n([\s\S]*?)\n```/.exec(text.slice(0, 20000));
  return fenced ? fenced[1] : "";
}

// The "- {k: v, ...}" entries of one top-level front-matter list.
function flowList(fm, key) {
  const m = new RegExp(`^${key}:[^\\n]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "m").exec(fm);
  if (!m) return [];
  return m[1].split("\n").filter((l) => /^\s+-\s*\{/.test(l)).map((l) => {
    const obj = {};
    const body = l.replace(/^\s+-\s*\{/, "").replace(/\}\s*(#.*)?$/, "");
    for (const kv of body.matchAll(/(\w+):\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,{}]+)/g)) {
      obj[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
    return obj;
  });
}

const ISO_DAY = /^(20\d\d)-(\d\d)-(\d\d)$/;

// The sheet section under a "## <name>" heading.
function section(md, name) {
  const text = String(md).replace(/\r\n/g, "\n");
  const i = text.search(new RegExp(`^##\\s+${name}\\s*$`, "mi"));
  if (i < 0) return "";
  const rest = text.slice(i).split("\n").slice(1);
  const end = rest.findIndex((l) => /^##?\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

// Splits a bullet's text into labelled segments: a leading **label** and any
// later **label:** start a segment.
function segments(text) {
  const out = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let m, last = null, pos = 0;
  const lead = /^\s*\*\*([^*]+?)\*\*/.exec(text);
  if (!lead) { out.push({ label: "", body: text }); return out; }
  while ((m = re.exec(text))) {
    const isLabel = m.index === lead.index || /:\s*$/.test(m[1]);
    if (!isLabel) continue;
    if (last) last.body = text.slice(pos, m.index);
    last = { label: m[1].replace(/[:.\s]+$/, ""), body: "" };
    out.push(last);
    pos = m.index + m[0].length;
  }
  if (last) last.body = text.slice(pos);
  return out.map((s) => ({ label: s.label, body: s.body.replace(/^\s*:\s*/, "").trim() }));
}

const UNDATED = /^(rolling|ongoing|open|open-ended|open timing|pending|possible|timing unknown|unknown date|no date set|any time|overhang)\b/i;
const CONTEXT = /context only/i;

// One sheet -> calendar entries (dates in the past are kept; callers filter).
export function extractSheetCalendar(ticker, md) {
  const entries = [];
  const fm = frontMatter(md);
  const add = (e) => entries.push(Object.fromEntries(Object.entries({ ticker, ...e }).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "")));

  for (const o of flowList(fm, "open_items")) {
    const text = plainText(o.text || o.what || o.desc || o.id);
    if (ISO_DAY.test(o.target || "")) add({ kind: "open_item_target", start: o.target, end: o.target, precision: "day", deadline: true, id: o.id, text });
    if (ISO_DAY.test(o.expires_at || "")) add({ kind: "open_item_expiry", start: o.expires_at, end: o.expires_at, precision: "day", deadline: true, id: o.id, text });
  }
  for (const o of flowList(fm, "status_events")) {
    const p = o.date && parseDatePhrase(o.date);
    if (p && o.event) add({ kind: "status_event", ...p, approx: undefined, deadline: undefined, text: plainText(o.event) });
  }
  for (const o of flowList(fm, "thesis_drivers")) {
    const days = parseDatePhrase(o.text || "", { multiDay: true }).filter((p) => p.precision === "day");
    for (const p of days) add({ kind: "thesis", ...p, id: o.id, text: plainText(o.text) });
  }

  const body = section(md, "Catalyst calendar");
  const lines = body.split("\n");
  let parent = null; // { span, context, entryIndex }
  for (const raw of lines) {
    const table = /^\s*\|(.+)\|\s*$/.exec(raw);
    let indent, content;
    if (table) {
      const cells = table[1].split("|").map((c) => c.trim());
      if (cells.length < 2 || /^-+$/.test(cells[0]) || /^date$/i.test(cells[0])) continue;
      indent = 0; content = `**${cells[0]}:** ${cells.slice(1).join(" | ")}`;
    } else {
      const b = /^(\s*)[-*]\s+(.*)$/.exec(raw);
      if (!b) continue;
      indent = b[1].replace(/\t/g, "  ").length; content = b[2];
    }
    const nested = indent >= 2 && parent;
    const segs = segments(content);
    const top = !nested;
    let firstSpan = null, firstIdx = -1;
    let context = nested ? parent.context : false;
    for (const seg of segs) {
      const label = plainText(seg.label);
      const bodyText = plainText(seg.body);
      if (CONTEXT.test(label) || (!label && CONTEXT.test(bodyText) && /:\s*$/.test(bodyText))) context = true;
      const text = plainText([label, seg.body].filter(Boolean).join(": "));
      const weekday = recurringWeekday(label || bodyText, seg.body);
      if (weekday != null) {
        add({ kind: "catalyst", start: null, end: null, precision: "day", recur: { weekday }, context, text: clipText(text) });
        firstIdx = entries.length - 1;
        continue;
      }
      let spans = [];
      if (label && !UNDATED.test(label)) {
        const p = parseDatePhrase(label);
        // A label like "Q1 2027 results" or "Q4/FY2026 results and 2027 guidance"
        // is coarse: a finer date opening the text ("about early May 2027") wins.
        const q = (!p || PRECISION_RANK[p.precision] >= PRECISION_RANK.quarter) && bodyText ? parseDatePhrase(bodyText.split(/[.;]\s/)[0]) : null;
        if (q && (!p || PRECISION_RANK[q.precision] < PRECISION_RANK[p.precision])) spans = [q];
        else if (p) spans = [p];
      }
      if (!spans.length && !(label && UNDATED.test(label))) {
        // No date in the label: the opening clause of the text, else every day date in it.
        const opening = bodyText.split(/[.;]\s/)[0];
        spans = label ? [parseDatePhrase(opening)].filter(Boolean) : parseDatePhrase(bodyText, { multiDay: true });
      }
      // A sub-bullet of a dated parent keeps its own date only when that date is
      // finer than a year ("The 2026 equity plan" folds into the AGM line).
      if (nested && parent.span && !seg.label && spans.every((sp) => PRECISION_RANK[sp.precision] >= PRECISION_RANK.year)) spans = [];
      if (!spans.length && nested && parent.span && !seg.label) {
        // An undated sub-bullet belongs to its parent's date: fold it into the parent's text.
        if (parent.entryIndex >= 0) {
          const e = entries[parent.entryIndex];
          delete e._bare;
          e.text = clipText(`${e.text}${/:$/.test(e.text) ? " " : e.text.includes(": ") ? "; " : ": "}${text}`);
        }
        continue;
      }
      for (const sp of spans) {
        // A bare date label ("**2027:**") stays only if sub-bullets fill it in.
        add({ kind: "catalyst", ...sp, context, text: clipText(text), _bare: Boolean(label && !plainText(seg.body)) });
        if (!firstSpan) { firstSpan = sp; firstIdx = entries.length - 1; }
      }
    }
    if (top) parent = { span: firstSpan, context, entryIndex: firstIdx };
  }
  return entries.filter((e) => !e._bare);
}

function clipText(t, n = 280) {
  const s = plainText(t);
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// --- Run time -----------------------------------------------------------------

// Occurrences of entries that overlap [from, to] (inclusive "YYYY-MM-DD").
// Weekly entries expand to one occurrence per matching day.
export function occurrences(entries, from, to) {
  const out = [];
  for (const e of entries) {
    if (e.recur) {
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (weekdayOf(d) === e.recur.weekday) out.push({ ...e, start: d, end: d, recurring: true });
      }
    } else if (e.start && e.start <= to && (e.end || e.start) >= from) out.push(e);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.ticker.localeCompare(b.ticker) || (a.confirmed ? -1 : 1));
}

const spanDays = (e) => Math.round((Date.parse(e.end || e.start) - Date.parse(e.start)) / 86_400_000) + 1;

// What the brief lists for the next `days` days: dated events and windows of up
// to ~6 weeks that begin in the period; never context-only lines or open-item
// review dates. A graded notice on the same ticker and day replaces the
// sheet's estimate.
export function briefCatalysts(entries, today, days = 7) {
  const to = addDays(today, days);
  const list = occurrences(entries, today, to).filter((e) =>
    !e.context && e.kind !== "open_item_expiry" && e.kind !== "status_event"
    && e.start >= today && e.start <= to && (e.precision === "day" || spanDays(e) <= 45));
  const confirmed = new Set(list.filter((e) => e.confirmed).map((e) => `${e.ticker}|${e.start}`));
  return list.filter((e) => e.confirmed || !(e.approx && confirmed.has(`${e.ticker}|${e.start}`)));
}

// Date (and time) of the event a notice announces: the first date in the title,
// then the why line, that is not before the notice itself.
export function noticeDate(title, why, refIso) {
  const ref = refIso ? String(refIso).slice(0, 10) : null;
  const refYear = ref ? Number(ref.slice(0, 4)) : null;
  for (const text of [title, why]) {
    const s = String(text || "");
    const cands = [];
    for (const m of s.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) cands.push({ date: m[0], idx: m.index });
    const re = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d\\d))?`, "gi");
    for (const m of s.matchAll(re)) {
      const mon = monthKey(m[1].toLowerCase());
      const day = Number(m[2]);
      if (!mon || day < 1 || day > 31) continue;
      let y = m[3] ? Number(m[3]) : refYear;
      if (!y) continue;
      let date = iso(y, mon, Math.min(day, lastDay(y, mon)));
      if (!m[3] && ref && date < addDays(ref, -60)) date = iso(y + 1, mon, Math.min(day, lastDay(y + 1, mon)));
      cands.push({ date, idx: m.index });
    }
    cands.sort((a, b) => a.idx - b.idx);
    const hit = cands.find((c) => !ref || c.date >= addDays(ref, -1));
    if (hit) {
      const t = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?:\s*(?:ET|EST|EDT|E\.T\.))?)|\b((?:after|before) (?:the )?(?:market )?(?:close|open))\b/i.exec(s.slice(hit.idx));
      return { date: hit.date, time: t ? (t[1] || t[2]).replace(/\s+/g, " ") : null };
    }
  }
  return null;
}

const NOTICE_FLAGS = ["reason:calendar_card", "group:earnings_calendar", "floor:calendar", "floor:investor_day"];

// Graded date notices (current primary grades) as calendar entries.
export async function gradedNotices(db, { sinceIso }) {
  const like = NOTICE_FLAGS.map(() => "g.flags LIKE ?").join(" OR ");
  const rows = (await db.prepare(
    `SELECT i.id AS item_id, i.ticker, i.title, i.url, i.published, i.nm_first_seen, g.why, g.score, g.band, g.graded_at
       FROM items i JOIN grades g ON g.id = i.grade_id
      WHERE i.nm_first_seen >= ? AND g.score IS NOT NULL AND (${like})
      ORDER BY i.id DESC LIMIT 300`,
  ).bind(sinceIso, ...NOTICE_FLAGS.map((f) => `%"${f}"%`)).all()).results || [];
  const out = [];
  for (const r of rows) {
    const d = noticeDate(r.title, r.why, r.published || r.nm_first_seen);
    if (!d) continue;
    out.push({ ticker: r.ticker, kind: "graded_notice", start: d.date, end: d.date, precision: "day", confirmed: true,
      time: d.time || undefined, text: clipText(r.title, 200), item_id: r.item_id, url: r.url, score: r.score });
  }
  return out;
}

// Council agendas (Zenith show, phase 0): news-monitor's legistar_matters adapter
// writes "… — <status>, agenda YYYY-MM-DD" into a matter's title, so any coverage
// item from a legistar_* source with that tail becomes a confirmed day entry for
// its ticker. Any item state counts (a stale-skipped agenda still shows); muted
// sources do not. Kept only when the title names the routed company's own terms
// and carries no rival marker ("[AXON] (Flock/ALPR, rival) …"), so rival and
// product-only matters stay graded but off the calendar. The date is the agenda
// date as first seen: news-monitor does not re-store a matter when it moves.
const AGENDA_RE = /, agenda (20\d\d-\d\d-\d\d)\b/;
const RIVAL_MARK_RE = /^\[[^\]]+\]\s*\([^)]*\brival\)/;
// The leading routing tag ("[AXON] ") and any marker after it: news-monitor adds
// them, so they never count as the title naming the company ("[AXON]" matches "Axon").
const LEAD_TAG_RE = /^\[[^\]]+\]\s*(?:\([^)]*\)\s*)?/;
// True when the text names one of the company's terms. phraseRegex matches in any
// case; a one-word term the rubric writes with a capital ("Prepared") counts only
// when the match carries a capital too, so "report prepared by staff" is not a name.
function namesCompany(terms, text) {
  const re = phraseRegex(terms);
  if (!re) return false;
  const lowerTerms = new Set(terms.filter((t) => typeof t === "string" && t === t.toLowerCase()).map((t) => t.trim()));
  for (const m of text.matchAll(new RegExp(re.source, "giu"))) {
    const s = m[0];
    if (/\s/.test(s) || s !== s.toLowerCase() || lowerTerms.has(s)) return true;
  }
  return false;
}
export async function councilAgendas(db, { sinceIso }) {
  // substr, not LIKE 'legistar\_%' ESCAPE: the backslashes would not survive a JS string.
  const rows = (await db.prepare(
    "SELECT i.id AS item_id, i.ticker, i.title, i.url, i.source_key, i.nm_first_seen FROM items i WHERE substr(i.source_key, 1, 9) = 'legistar_' AND i.title LIKE '%, agenda 20%' AND i.nm_first_seen >= ? AND COALESCE(i.skip_reason,'') != 'muted_source' ORDER BY i.id DESC LIMIT 200",
  ).bind(sinceIso).all()).results || [];
  const out = [];
  for (const r of rows) {
    const title = String(r.title || "");
    const m = AGENDA_RE.exec(title);
    if (!m || RIVAL_MARK_RE.test(title)) continue;
    if (!namesCompany(MATCH[r.ticker]?.terms || [], title.replace(LEAD_TAG_RE, ""))) continue;
    const d = m[1];
    out.push({ ticker: r.ticker, kind: "council_agenda", start: d, end: d, precision: "day", confirmed: true,
      text: clipText(title, 200), item_id: r.item_id, url: r.url });
  }
  return out;
}

// Entries read from zenith-db at run time: graded notices and council agendas.
// Each part fails on its own: an error is logged and that part is empty.
export async function runtimeEntries(db, { sinceIso }) {
  const parts = await Promise.all([
    gradedNotices(db, { sinceIso }).catch((e) => { console.error("graded notices failed", e?.message || e); return []; }),
    councilAgendas(db, { sinceIso }).catch((e) => { console.error("council agendas failed", e?.message || e); return []; }),
  ]);
  return parts.flat();
}

// Sheet entries plus run-time entries overlapping [from, from + days]; with
// tickers, only those tickers (the covered universe).
export async function upcoming(db, sheetEntries, { from, days = 30, ticker = null, tickers = null, noticesSince }) {
  let all = [...sheetEntries, ...await runtimeEntries(db, { sinceIso: noticesSince })];
  if (tickers) all = all.filter((e) => tickers.includes(e.ticker));
  if (ticker) all = all.filter((e) => e.ticker === ticker);
  return occurrences(all, from, addDays(from, days));
}
