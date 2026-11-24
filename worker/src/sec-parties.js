// SEC party extraction (plans/round5-expansion-approve-queue.md, Part B).
// Covered companies' own filings, already ingested as coverage items, name
// their counterparties in fixed places. This pass reads those places with
// fixed patterns and upserts each party into expansion_candidates (origin
// sec_filing) through the shared upsert in expansion.js. No model, no
// news-monitor change, no new source, no JSON from sec.gov.
//
//   B1  which items: role NULL, source unusual or edgar_<ticker> (covered.json),
//       URL under /Archives/edgar/data/<cik>/<accession>/, title
//       "<Company>: <form>[ [Items ...]] filed <date>", form 8-K or 8-K/A with
//       Item 1.01 or 2.01 (no item list: the document's own headings decide),
//       or 10-Q, 10-K, 10-K/A.
//   B2  exhibits by the filing index's Type cell, never by file name: EX-2.1
//       (acquired), EX-10[.n] (partner; the 2 lowest that pass the people and
//       financing rules), EX-21[.n] (10-K and 10-K/A only).
//   B3  8-K Items 1.01 (partner) and 2.01 (acquired), heading to next heading,
//       4,000 characters; EX-2.1 and EX-10 preambles in the first 6,000.
//   B4  party names, deterministic; at most 6 per filing.
//   B5  EX-21 diff per CIK in sec_subsidiaries: first sight is a baseline,
//       later filings add new names, more than 20 new is a re-baseline.
//   B7  every request through fetchPage (secPace, the SEC User-Agent), inside
//       the SEC lease; 403/429 pause 60 minutes, 5xx/timeout stop the tick,
//       3 failed ticks skip a filing; at most 2 filings, 5 requests each and
//       50 items scanned per tick; meta cursor from MAX(items.id) plus the seed.
//
//   secParties(env, { now? }) -> { scanned, filings, requests, candidates,
//     baselines, rebaselined, stopped, at, skipped_filings, warnings } or
//     { skipped, at } when the pass does nothing this tick.
import COVERED from "./covered.json";
import { nowIso } from "./lib.js";
import { getMeta, setMeta } from "./ingest.js";
import { fetchPage, filingIndexUrl, sameFiling, htmlToText, ITEM_RE, secUserAgent, takeSecLease, releaseSecLease } from "./excerpt.js";
import { candidateName, dedupeKey, coveredTicker, upsertSightings } from "./expansion.js";

export const CURSOR_META = "sec_parties_cursor";
export const SEED_META = "sec_parties_seed";
export const PAUSE_META = "sec_parties_pause_until";
export const TRIES_META = "sec_parties_tries";
// The UMAC Upgrade Energy 8-K (filed 2026-10-23), already in zenith-db: read
// once on the first run, then removed. No other historic backfill.
export const SEED_ITEM_IDS = [18];
export const MAX_FILINGS = 2;
export const MAX_REQUESTS = 5;          // per filing: index, 8-K document, two contract exhibits, EX-21
export const MAX_SCANNED = 50;
export const MAX_TRIES = 3;
export const PAUSE_MINUTES = 60;
export const MAX_PARTIES = 6;           // B4: per filing (EX-21 diffs have their own bound)
export const MAX_SUBSIDIARIES = 400;
export const REBASELINE_OVER = 20;
const SECTION_CHARS = 4000;
const PREAMBLE_CHARS = 6000;
const LIST_CHARS = 600;
const FINANCING_HEAD = 600;

// --- B1: which items ------------------------------------------------------------
const SEC_SOURCES = Object.entries(COVERED.sources || {})
  .filter(([k]) => k === "unusual" || /^edgar_[a-z]+$/.test(k)).map(([k]) => k).sort();
const SEC_SOURCE_SET = new Set(SEC_SOURCES);
const FOLDER_RE = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d+)\/(\d{18})\//;
const TITLE_RE = /^(.+): (\S+)(?: \[Items? ([^\]]*)\])? filed (\d{4}-\d{2}-\d{2})$/;
const EIGHT_K = new Set(["8-K", "8-K/A"]);
const PERIODIC = new Set(["10-Q", "10-K", "10-K/A"]);
const ANNUAL = new Set(["10-K", "10-K/A"]);
const PARTY_ITEMS = ["1.01", "2.01"];

export function parseFilingTitle(title) {
  const m = TITLE_RE.exec(String(title ?? "").trim());
  if (!m) return null;
  const items = m[3] == null ? null : m[3].split(",").map((s) => s.trim()).filter(Boolean);
  return { company: m[1], form: m[2].toUpperCase(), items, filed: m[4] };
}

// The item's reading plan, or null when it is not read (B1).
export function qualify(item) {
  if (!item || item.role != null) return null;
  if (!SEC_SOURCE_SET.has(item.source_key)) return null;
  const ticker = COVERED.sources[item.source_key];
  const f = FOLDER_RE.exec(String(item.url ?? ""));
  if (!ticker || !f) return null;
  const t = parseFilingTitle(item.title);
  if (!t) return null;
  if (EIGHT_K.has(t.form)) {
    if (t.items && !t.items.some((c) => PARTY_ITEMS.includes(c))) return null;
  } else if (!PERIODIC.has(t.form)) return null;
  return { ticker, cik: String(Number(f[1])), form: t.form, items: t.items, filed: t.filed };
}

// --- B2: the filing index, by Type ----------------------------------------------
// Rows of an EDGAR filing index page: { type, description, url }. Columns are
// found from the header row (Seq, Description, Document, Type, Size), else the
// EDGAR order. Links pass sameFiling, so only documents in the filing folder.
export function indexRows(html, indexUrl) {
  const out = [];
  let cols = null;
  for (const row of String(html || "").split(/<tr\b/i).slice(1, 400)) {
    const body = row.split(/<\/tr>/i)[0];
    const th = [...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((c) => htmlToText(c[1]).trim().toLowerCase());
    if (th.length) {
      cols = { desc: th.indexOf("description"), doc: th.indexOf("document"), type: th.indexOf("type") };
      continue;
    }
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const at = (k, d) => cells[cols && cols[k] >= 0 ? cols[k] : d] ?? "";
    const type = htmlToText(at("type", 3)).replace(/\s+/g, "").toUpperCase();
    const link = at("doc", 2).match(/href\s*=\s*["']([^"']+)["']/i);
    const url = link ? sameFiling(link[1], indexUrl) : null;
    if (type && url) out.push({ type, description: htmlToText(at("desc", 1)).replace(/\s+/g, " ").trim(), url });
  }
  return out;
}

// B2's people and financing rules on an EX-10 Description (the financing rule
// also skips an 8-K Item 1.01 section, B3). Investors and lenders are not
// relations.
export const PEOPLE_RE = /\b(?:employment|separation|offer\s+letter|indemnification|incentive\s+plan|equity\s+plan|stock\s+option|restricted\s+stock|award\s+agreement|consulting|severance|retention|change\s+(?:in|of)\s+control|lease|sublease)\b/i;
export const FINANCING_RE = /\b(?:credit\s+agreement|loans?|promissory|notes?|indentures?|securities\s+purchase|subscriptions?|underwriting|placement|sales\s+agreement|at[-\s]the[-\s]market|equity\s+distribution|warrants?|convertible|debentures?)\b/i;

const EX21_RE = /^EX-21(?:\.\d{1,2})?$/;
const EX2_1_RE = /^EX-2\.0?1$/;
const EX10_RE = /^EX-10(?:\.(\d{1,3}))?(?:\.\d+)?[A-Z]?$/;

// The documents to read from the index rows: { primary, contracts: [{ url,
// type, relation }], ex21 }. Two contract exhibits at most, EX-2.1 first.
export function pickDocuments(rows, form) {
  const primary = EIGHT_K.has(form) ? (rows.find((r) => r.type === form) || rows.find((r) => EIGHT_K.has(r.type)))?.url ?? null : null;
  const ex2 = rows.filter((r) => EX2_1_RE.test(r.type)).map((r) => ({ url: r.url, type: r.type, relation: "acquired" }));
  const ex10 = rows.filter((r) => EX10_RE.test(r.type) && !PEOPLE_RE.test(r.description) && !FINANCING_RE.test(r.description))
    .map((r, i) => ({ url: r.url, type: r.type, relation: "partner", n: Number(EX10_RE.exec(r.type)[1] ?? 0), i }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map(({ url, type, relation }) => ({ url, type, relation }));
  const seen = new Set();
  const contracts = [...ex2, ...ex10].filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 2);
  const ex21 = ANNUAL.has(form) ? rows.find((r) => EX21_RE.test(r.type))?.url ?? null : null;
  return { primary, contracts, ex21 };
}

// --- B4: party names ----------------------------------------------------------
// Legal-suffix words. Case-insensitive words, plus the dotted and short forms
// with their usual case.
const SUFFIX_WORD_RE = /\b(?:inc|incorporated|llc|corp|corporation|company|ltd|limited|llp|gmbh|pty)\b\.?/giu;
const SUFFIX_FORM_RE = /(?<![\p{L}\p{N}.])(?:L\.L\.C\.?|L\.P\.?|S\.p\.A\.?|S\.A\.?|B\.V\.?|N\.V\.?|Co\.|CO\.|LP|AG|plc|PLC|Plc)(?![\p{L}\p{N}])/gu;
function suffixMatches(s) {
  const out = [];
  for (const re of [SUFFIX_WORD_RE, SUFFIX_FORM_RE]) for (const m of s.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}
// ", a Florida limited liability company": an entity description.
const DESC_RE = /,\s+an?\s+\p{Lu}[^,;()]{0,80}?\b(?:[Cc]orporation|[Cc]ompany|[Pp]artnership|[Ee]ntity|[Oo]rgani[sz]ation|[Aa]ssociation|[Tt]rust)\b/u;
const DBA_RE = /,?\s+(?:d\/b\/a|d\.b\.a\.?|dba|doing\s+business\s+as)(?![\p{L}\p{N}])[\s:]*/iu;
const SEP = "\u0001";
const DEFINED_RE = /\([^()]*["“”‘’'][^()]*\)/g;
const DESC_SPLIT_RE = /(,\s+an?\s+[^,;()\u0001]{0,80}?\b(?:corporation|company|partnership)\b)/giu;
const AND_RE = /,?\s+and\s+(?=\p{Lu})/gu;
// ", Foo Holdings": a plain comma before a capital starts a new party, unless
// what follows is only a legal suffix ("Foo Holdings, LLC", "Acme, Inc.").
const COMMA_RE = /,\s+(?=\p{Lu})(?!(?:Inc|Incorporated|LLC|L\.L\.C|Corp|Corporation|Co|Ltd|Limited|LP|L\.P|LLP|L\.L\.P|plc|PLC|Plc|GmbH|AG|S\.A|B\.V|N\.V|Pty|S\.p\.A)\.?(?![\p{L}\p{N}]))/gu;
// A prose name starts with a capital or a digit (or lower then upper, as in
// "iRobot"); "capital stock of Acme Robotics" or "into Target Corp." is not one.
const NAME_START_RE = /^(?:[\p{Lu}\p{N}]|\p{Ll}\p{Lu})/u;
const REFERENCE_RE = /^(?:the|its|our|such|each|said)\b/i;
const ROLE_KEYS = new Set(["Buyer", "Seller", "Purchaser", "Parent", "Merger Sub", "Company", "Registrant", "Lender", "Borrower", "Agent"].map(dedupeKey));
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Lowercase words that open a clause after a party name (case-sensitive, so
// "Made In Space" or "Back To Basics" keep their capitalized words).
const CLAUSE_RE = /\s+(?:as|pursuant|under|in|dated|entered|which|that|who|whose|whereby|to|with|from|by|on|at|upon|effective|hereinafter|hereby|shall|will|has|have|is|was)\b[\s\S]*$/;

// A party list -> its raw parts (B4 "Splitting a list").
export function splitList(text) {
  return String(text ?? "").replace(DEFINED_RE, SEP).replace(DESC_SPLIT_RE, `$1${SEP}`).replace(/;/g, SEP).replace(AND_RE, SEP).replace(COMMA_RE, SEP)
    .split(SEP)
    .map((s) => squash(s).replace(/^[\s,.:]+/, "").replace(/^and\s+/i, "").replace(/[\s,;:]+$/, ""))
    .filter(Boolean);
}

// Step 3: trim at the first comma, at " a "/" an " before a capital and at "(";
// a legal name is also cut after its first run of suffix words ("Foo LLC to
// supply drones" -> "Foo LLC"). A sentence-final period is dropped unless it
// ends an abbreviation.
function trimName(s, { suffixCut }) {
  let n = squash(s);
  n = n.split(",")[0];
  n = n.replace(/\s+an?\s+(?=\p{Lu})[\s\S]*$/u, "");
  n = n.split("(")[0];
  // A trailing lowercase clause is not part of the name: "Upgrade Energy as
  // contemplated by the Merger Agreement" -> "Upgrade Energy" (live, item 18).
  n = n.replace(CLAUSE_RE, "");
  if (suffixCut) {
    const ms = suffixMatches(n);
    if (ms.length) {
      let end = ms[0].end;
      for (const m of ms.slice(1)) {
        if (m.start < end) { end = Math.max(end, m.end); continue; }
        if (/^[\s,]*$/.test(n.slice(end, m.start))) end = m.end; else break;
      }
      n = n.slice(0, end);
    }
  }
  return squash(n).replace(/(?<!\b(?:inc|corp|co|ltd|bros|\p{L}))\.$/iu, "").trim();
}

const isReference = (n) => {
  const k = dedupeKey(n);
  return REFERENCE_RE.test(n) || ROLE_KEYS.has(k) || /\bmerger sub\b/.test(k);
};

// One raw party -> { name, aliases, party } or null (B4 steps 1-5). name is the
// trade name when there is one, else the legal name; aliases carries the legal
// name beside a trade name. A party whose legal or trade name is a covered
// name (the subject among them) is dropped. opts.listed skips step 1 and the
// suffix cut (an EX-21 line already cut after its last suffix word).
export function partyFrom(raw, { listed = false } = {}) {
  const text = squash(raw).replace(/^[\s,.:;]+/, "").replace(/^and\s+/i, "");
  if (!text) return null;
  if (!listed && !suffixMatches(text).length && !DESC_RE.test(text) && !DBA_RE.test(text)) return null;
  const d = DBA_RE.exec(text);
  const legalRaw = d ? text.slice(0, d.index) : text;
  const tradeRaw = d ? text.slice(d.index + d[0].length) : "";
  const clean = (s, suffixCut) => {
    const n = trimName(s, { suffixCut });
    if (!n || isReference(n)) return null;
    if (!listed && !NAME_START_RE.test(n)) return null;
    return candidateName(n);
  };
  const legal = clean(legalRaw, !listed);
  const trade = d ? clean(tradeRaw, false) : null;
  if ([legal, trade].some((n) => n && coveredTicker(n))) return null;
  const name = trade || legal;
  if (!name || !dedupeKey(name)) return null;
  // The trailing clause is cut from the party text too, but only after a d/b/a
  // ("doing business as" itself holds " as").
  const cutAt = d ? d.index + d[0].length : 0;
  const ptext = text.slice(0, cutAt) + text.slice(cutAt).replace(CLAUSE_RE, "");
  const party = squash(ptext.replace(/,?\s+an?\s+\p{Lu}[\s\S]*$/u, "").split("(")[0]).replace(/[\s,;:]+$/, "").slice(0, 120);
  return { name, aliases: trade && legal && dedupeKey(legal) !== dedupeKey(trade) ? [legal] : [], party: party || name };
}

// Sentences of legal text: split at line ends and at . ! ? followed by space
// and a capital or opening quote, unless the period ends an abbreviation
// (Inc., Corp., L.L.C., U.S., a single letter).
const ABBR_END_RE = /(?:\b(?:inc|corp|co|ltd|no|nos|mr|mrs|ms|dr|jr|sr|st|vs|approx|etc|bros)|(?:^|[^\p{L}])\p{L})\.$/iu;
export function sentences(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    let start = 0;
    for (const m of line.matchAll(/[.!?]["'”’)]*\s+(?=[\p{Lu}"“])/gu)) {
      const end = m.index + 1;
      if (line[m.index] === "." && ABBR_END_RE.test(line.slice(Math.max(start, end - 12), end))) continue;
      const s = line.slice(start, m.index + m[0].trimEnd().length).trim();
      if (s) out.push(s);
      start = m.index + m[0].length;
    }
    const s = line.slice(start).trim();
    if (s) out.push(s);
  }
  return out;
}

const listText = (s) => s.split(";")[0].slice(0, LIST_CHARS);
const LIST_KW_RE = /\b(?:by\s+and\s+between|by\s+and\s+among|between|among|with(?:\s+and\s+into)?)\b/giu;
const PREAMBLE_KW_RE = /\b(?:by\s+and\s+between|by\s+and\s+among|between|among)\b/iu;
const DEAL_RE = /\b(?:agreements?|contracts?|orders?|mergers?|amendments?|letters?\s+of\s+intent|memorand(?:um|a))\b/i;
// The optional "all ... of" runs to the last "of" before a capital or digit:
// "all of the issued and outstanding shares of capital stock of Acme" -> Acme.
const ACQ_RE = /\b(?:acquisition\s+of|acquired|to\s+acquire|merger\s+with(?:\s+and\s+into)?)\s+(?:(?:substantially\s+)?all\s+(?:[^\s.;,]+\s+){0,12}of\s+(?=[\p{Lu}\p{N}]))?/giu;

// The parties of a party list.
const listParties = (text) => splitList(listText(text)).map((p) => partyFrom(p)).filter(Boolean);

// B3 contract exhibits: the preamble, the first sentence within the first
// 6,000 characters that names its parties after "by and between", "by and
// among", "between" or "among".
export function preambleParties(text) {
  for (const s of sentences(String(text ?? "").slice(0, PREAMBLE_CHARS))) {
    const m = PREAMBLE_KW_RE.exec(s);
    if (!m) continue;
    const parties = listParties(s.slice(m.index + m[0].length));
    if (parties.length) return parties;
  }
  return [];
}

// B3 8-K sections: { "1.01": text, "2.01": text } from the document text, each
// from its Item heading to the next, at most 4,000 characters.
export function itemSections(text) {
  const t = String(text ?? "");
  const heads = [...t.matchAll(ITEM_RE)].slice(0, 80).map((m) => ({
    at: m.index + (t[m.index] === "\n" ? 1 : 0), code: (/\d{1,2}(?:\.\d{1,2})?/.exec(m[0]) || [""])[0],
  }));
  const out = {};
  heads.forEach((h, i) => {
    if (!PARTY_ITEMS.includes(h.code) || out[h.code]) return;
    const sec = t.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : t.length).slice(0, SECTION_CHARS);
    if (sec.trim().length > 12) out[h.code] = sec;
  });
  return out;
}

// An 8-K section's parties: list sentences with a deal word before the list
// keyword, and in Item 2.01 the acquisition pattern too.
export function sectionParties(section, code) {
  const out = [];
  for (const s of sentences(section)) {
    if (code === "2.01") {
      for (const m of s.matchAll(ACQ_RE)) {
        const first = splitList(listText(s.slice(m.index + m[0].length)))[0];
        const p = first ? partyFrom(first) : null;
        if (p) out.push(p);
      }
    }
    for (const m of s.matchAll(LIST_KW_RE)) {
      if (!DEAL_RE.test(s.slice(0, m.index))) continue;
      out.push(...listParties(s.slice(m.index + m[0].length)));
      break;
    }
  }
  return out;
}

// The 8-K document's parties: [{ party, relation }], Item 2.01 first.
// items: the title's item list (null: the document's headings decide).
export function eightKParties(text, items) {
  const sections = itemSections(text);
  const out = [];
  for (const code of ["2.01", "1.01"]) {
    const sec = sections[code];
    if (!sec || (items && !items.includes(code))) continue;
    if (code === "1.01" && FINANCING_RE.test(sec.slice(0, FINANCING_HEAD))) continue;
    for (const p of sectionParties(sec, code)) out.push({ ...p, relation: code === "2.01" ? "acquired" : "partner" });
  }
  return { parties: out, codes: Object.keys(sections) };
}

// B5: an EX-21's subsidiary names, Map(dedupe key -> { name, aliases, party }).
// One line per row; a line is kept only with a legal-suffix word and is cut
// after its last one (the jurisdiction column goes).
export function ex21Names(text) {
  const out = new Map();
  for (const raw of String(text ?? "").split("\n")) {
    const line = squash(raw);
    if (!line || /^(?:list\s+of\s+)?(?:significant\s+)?subsidiaries\b/i.test(line) || /^exhibit\b/i.test(line)) continue;
    const ms = suffixMatches(line);
    if (!ms.length) continue;
    const p = partyFrom(line.slice(0, Math.max(...ms.map((m) => m.end))), { listed: true });
    if (!p) continue;
    const k = dedupeKey(p.name);
    if (k && !out.has(k)) out.set(k, p);
    if (out.size >= MAX_SUBSIDIARIES) break;
  }
  return out;
}

// --- B7: fetching ---------------------------------------------------------------
class Stop {
  constructor(kind, status) { this.kind = kind; this.status = status; }
}
// One document through fetchPage: { html, url } or null (a 404 or another
// unreadable document is skipped). A 403/429 throws a pause, a 5xx, timeout
// or network error a tick stop.
async function getDoc(ctx, url) {
  if (ctx.requests >= MAX_REQUESTS) return null;
  ctx.requests++;
  const page = await fetchPage(url, ctx.ua);
  const s = page.status;
  if (s === "ok") return { html: page.html, url };
  if (s === "http_403" || s === "http_429") throw new Stop("pause", s);
  if (/^http_5\d\d$/.test(s) || s.startsWith("error")) throw new Stop("stop", s);
  ctx.notes.push(`${url}: ${s}`);
  return null;
}

// Reads one qualifying filing: { sightings, subsidiaries: null | { url, names } }.
async function readFiling(ctx, item, q) {
  const indexUrl = filingIndexUrl(item.url);
  const isIndex = /-index\.html?$/i.test(new URL(item.url).pathname);
  const idx = indexUrl ? await getDoc(ctx, indexUrl) : null;
  const docs = pickDocuments(idx ? indexRows(idx.html, indexUrl) : [], q.form);
  const found = [];
  if (EIGHT_K.has(q.form)) {
    const primary = docs.primary || (isIndex ? null : item.url);
    const doc = primary ? await getDoc(ctx, primary) : null;
    const r = doc ? eightKParties(htmlToText(doc.html), q.items) : { parties: [], codes: [] };
    // No item list in the title: the document's own Item 1.01 or 2.01 heading
    // decides, so an unreadable or other-item document ends the filing here.
    if (!q.items && !r.codes.length) return { sightings: [], subsidiaries: null };
    for (const p of r.parties) found.push({ ...p, url: doc.url });
  }
  for (const c of docs.contracts) {
    const doc = await getDoc(ctx, c.url);
    if (doc) for (const p of preambleParties(htmlToText(doc.html))) found.push({ ...p, relation: c.relation, url: doc.url });
  }
  let subsidiaries = null;
  if (docs.ex21) {
    const doc = await getDoc(ctx, docs.ex21);
    if (doc) subsidiaries = { url: doc.url, names: ex21Names(htmlToText(doc.html)) };
  }
  const keys = new Set();
  const sightings = [];
  for (const p of found) {
    const k = dedupeKey(p.name);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    sightings.push(sighting(item, q, p, p.relation, p.url));
    if (sightings.length >= MAX_PARTIES) break;
  }
  return { sightings, subsidiaries };
}

const sighting = (item, q, p, relation, url) => ({
  name: p.name, aliases: p.aliases, party: p.party, origin: "sec_filing", relation, subject: q.ticker, tickers: [q.ticker],
  kind: "coverage", item_id: item.id, url, title: item.title, at: item.nm_first_seen,
});

// B5: compares an EX-21 with the stored list for the CIK and writes the new
// list. Returns { sightings, baseline, rebaselined }.
async function diffSubsidiaries(db, item, q, sub, now) {
  if (!sub.names.size) return { sightings: [], baseline: false, rebaselined: false, note: `${sub.url}: no subsidiary names read` };
  const keys = [...sub.names.keys()];
  const row = await db.prepare("SELECT names, filed FROM sec_subsidiaries WHERE cik = ?").bind(q.cik).first();
  const write = () => db.prepare(
    `INSERT INTO sec_subsidiaries (cik, ticker, names, item_id, filed, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(cik) DO UPDATE SET ticker = excluded.ticker, names = excluded.names, item_id = excluded.item_id,
         filed = excluded.filed, updated_at = excluded.updated_at`,
  ).bind(q.cik, q.ticker, JSON.stringify(keys), item.id, q.filed, now).run();
  if (!row) { await write(); return { sightings: [], baseline: true, rebaselined: false }; }
  if (q.filed < row.filed) return { sightings: [], baseline: false, rebaselined: false, note: `EX-21 of ${q.filed} is older than the stored ${row.filed}` };
  let stored;
  try { stored = new Set(JSON.parse(row.names)); } catch { stored = new Set(); }
  const fresh = keys.filter((k) => !stored.has(k));
  if (fresh.length > REBASELINE_OVER) {
    await write();
    return { sightings: [], baseline: false, rebaselined: true, note: `EX-21 of CIK ${q.cik}: ${fresh.length} new names is a format change, stored as the new baseline` };
  }
  const sightings = fresh.map((k) => sighting(item, q, sub.names.get(k), "subsidiary", sub.url));
  return { sightings, baseline: false, rebaselined: false, write };
}

// --- The pass -----------------------------------------------------------------
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
const isMissingTable = (e) => /no such table/i.test(String(e?.message || e));

async function tablesReady(db) {
  try {
    await db.prepare("SELECT 1 FROM expansion_candidates LIMIT 1").all();
    await db.prepare("SELECT 1 FROM sec_subsidiaries LIMIT 1").all();
    return true;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

const ITEM_COLS = "id, source_key, ticker, url, title, role, nm_first_seen";

// A later item with the same URL as an earlier SEC-source item is the same
// filing (two sources can list it): it is not read twice.
async function firstWithUrl(db, url) {
  const ph = SEC_SOURCES.map(() => "?").join(",");
  const r = await db.prepare(`SELECT MIN(id) AS id FROM items WHERE source_key IN (${ph}) AND url = ?`).bind(...SEC_SOURCES, url).first();
  return r?.id ?? null;
}

export async function secParties(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const at = nowIso(now);
  if (!env.CONTACT_EMAIL) return { skipped: "CONTACT_EMAIL is not set", at };
  if (!await tablesReady(db)) return { skipped: "no table", at };
  const pause = await getMeta(db, PAUSE_META);
  if (pause && pause > at) return { skipped: "paused", until: pause, at };

  let cursor = await getMeta(db, CURSOR_META);
  const writes = [];
  let seedRaw;
  if (cursor == null) {
    // First run: only items ingested from now on, plus the seed.
    const max = (await db.prepare("SELECT MAX(id) AS id FROM items").first())?.id ?? 0;
    cursor = String(max);
    seedRaw = JSON.stringify(SEED_ITEM_IDS);
    writes.push(setMeta(db, CURSOR_META, cursor), setMeta(db, SEED_META, seedRaw));
  } else {
    seedRaw = await getMeta(db, SEED_META);
  }
  let cur = Number(cursor) || 0;
  let seed = (Array.isArray(parse(seedRaw, [])) ? parse(seedRaw, []) : []).filter((x) => Number.isInteger(x) && x > 0);
  let tries = parse(await getMeta(db, TRIES_META), null);
  const startCur = cur, startSeed = seedRaw == null ? "[]" : JSON.stringify(seed), startTries = JSON.stringify(tries);
  // A malformed or emptied seed list is cleared.
  if (seedRaw != null && (!seed.length || JSON.stringify(seed) !== seedRaw)) writes.push(seed.length ? setMeta(db, SEED_META, JSON.stringify(seed)) : db.prepare("DELETE FROM meta WHERE key = ?").bind(SEED_META));

  const seedRows = seed.length
    ? (await db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id IN (${seed.map(() => "?").join(",")})`).bind(...seed).all()).results || []
    : [];
  const byId = new Map(seedRows.map((r) => [r.id, r]));
  const queue = [
    ...seed.map((id) => ({ id, seed: true, row: byId.get(id) || null })),
    ...((await db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id > ? ORDER BY id LIMIT ?`).bind(cur, MAX_SCANNED).all()).results || [])
      .filter((row) => !seed.includes(row.id)).map((row) => ({ id: row.id, seed: false, row })),
  ];

  const out = { scanned: 0, filings: 0, requests: 0, candidates: 0, baselines: 0, rebaselined: 0, stopped: null, at, skipped_filings: [], warnings: [] };
  const done = (e) => {
    if (e.seed) seed = seed.filter((x) => x !== e.id);
    else cur = Math.max(cur, e.id);
    if (tries && tries.item_id === e.id) tries = null;
  };
  const ua = secUserAgent(env);
  let lease = false;
  try {
    for (const e of queue) {
      if (out.scanned >= MAX_SCANNED) break;
      out.scanned++;
      const q = e.row ? qualify(e.row) : null;
      if (!q) { done(e); continue; }
      const first = await firstWithUrl(db, e.row.url);
      if (first != null && first < e.id) { done(e); continue; }
      if (out.filings >= MAX_FILINGS) { out.scanned--; break; }
      if (!lease) {
        lease = await takeSecLease(db, at);
        if (!lease) { out.scanned--; out.stopped = "sec lease held"; break; }
      }
      out.filings++;
      const ctx = { ua, requests: 0, notes: [] };
      try {
        const res = await readFiling(ctx, e.row, q);
        const sightings = [...res.sightings];
        let sub = null;
        if (res.subsidiaries) {
          sub = await diffSubsidiaries(db, e.row, q, res.subsidiaries, at);
          if (sub.baseline) out.baselines++;
          if (sub.rebaselined) out.rebaselined++;
          if (sub.note) out.warnings.push(sub.note);
          sightings.push(...sub.sightings);
        }
        if (sightings.length) {
          const up = await upsertSightings(db, sightings, { now: at });
          out.candidates += up.upserted;
          out.warnings.push(...up.warnings.map((w) => w.warning));
        }
        // The stored list is replaced after the candidates are written; an
        // upsert failure is a warning and the filing still counts as done (B6).
        if (sub?.write) await sub.write();
        out.warnings.push(...ctx.notes);
        done(e);
      } catch (err) {
        // A 403/429 pauses the pass; a 5xx, timeout, network or other error
        // stops this tick. The filing is not done; its third failed tick skips it.
        const stop = err instanceof Stop ? err : new Stop("stop", `error_internal: ${String(err?.message || err).slice(0, 120)}`);
        out.stopped = stop.status;
        if (stop.kind === "pause") writes.push(setMeta(db, PAUSE_META, nowIso(now + PAUSE_MINUTES * 60_000)));
        const n = (tries && tries.item_id === e.id ? Number(tries.n) || 0 : 0) + 1;
        if (n >= MAX_TRIES) { done(e); out.skipped_filings.push(e.id); }
        else tries = { item_id: e.id, n };
        break;
      } finally {
        out.requests += ctx.requests;
      }
    }
  } finally {
    if (lease) await releaseSecLease(db);
    if (cur !== startCur) writes.push(setMeta(db, CURSOR_META, String(cur)));
    if (JSON.stringify(seed) !== startSeed) writes.push(seed.length ? setMeta(db, SEED_META, JSON.stringify(seed)) : db.prepare("DELETE FROM meta WHERE key = ?").bind(SEED_META));
    if (JSON.stringify(tries) !== startTries) writes.push(tries ? setMeta(db, TRIES_META, JSON.stringify(tries)) : db.prepare("DELETE FROM meta WHERE key = ?").bind(TRIES_META));
    if (writes.length) await db.batch(writes);
  }
  if (!out.skipped_filings.length) delete out.skipped_filings;
  if (!out.warnings.length) delete out.warnings;
  return out;
}
