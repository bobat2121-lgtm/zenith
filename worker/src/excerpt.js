// Fetches the text of new items so the grader reads the release, not just the
// headline. Runs on the cron after ingest, a few items per tick.
// Transient failures (429, 5xx, timeouts) and SEC items without a configured
// contact email are retried with backoff; other outcomes are final.
//
// The excerpt keeps the lead and then the sentences that carry figures, rather
// than the first 2,500 characters. SEC filings start at their first Item
// heading and add the Ex-99.1 exhibit (the release) when the filing has one.
//
// Feed text (roadmap T8): when news-monitor kept the item's own text from its
// feed (items.body), ingest builds the excerpt from it (excerpt_status 'feed')
// and the page is never fetched. A teaser (a WordPress "[…]" summary, a news
// snippet) is not enough: the page is fetched as before.
//
// PDFs (roadmap T9): a covered source's deck, shareholder letter or stats sheet
// is read with pdf-text.js (excerpt_status 'pdf', or 'pdf_unreadable' when it
// holds no readable text): a PDF URL, a PDF a deck feed names (excerpt_source,
// set by ingest), a page that redirects to a PDF, or a deck page that links its
// PDF. Downloads are bounded (the head of the file and, past the bound, its
// tail), at most PDF_PER_TICK a tick, parsed one at a time.
import { nowIso, isHttpUrl } from "./lib.js";
import { pdfText } from "./pdf-text.js";

const PER_TICK = 18;
const SEC_PER_TICK = 5;           // up to 3 sec.gov fetches each (filing, index, exhibit)
const CONCURRENCY = 6;            // Workers allows 6 simultaneous outbound connections
const SEC_CONCURRENCY = 2;        // in flight at once; secPace() sets the request rate
const MAX_BYTES = 600_000;
const MAX_TEXT_INPUT = 300_000;   // cap what the HTML-to-text pass ever sees
const EXCERPT_CHARS = 2500;
const LEAD_CHARS = 700;           // the opening kept verbatim before figure sentences
const SEC_BODY_CHARS = 800;       // the filing's own item text when an exhibit follows
const MIN_BODY_CHARS = 200;
const MAX_TRIES = 4;
const FORBIDDEN_TRIES = 2;        // a 403 is tried twice, 20 minutes apart
const RETRY_MINUTES = [20, 120, 720];
const FEED_MIN_CHARS = 400;           // shorter feed text is a teaser: fetch the page
const PDF_MAX_BYTES = 8_000_000;      // the head of a PDF that is read
const PDF_TAIL_BYTES = 2_000_000;     // and, past the bound, its tail (fonts, page tree)
const PDF_PER_TICK = 2;               // PDF downloads per enrich call
const PDF_TIMEOUT_MS = 20_000;
const PDF_WAIT_MINUTES = 5;           // a PDF over the tick's budget waits, without a try

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…", reg: "®", trade: "™", copy: "©" };
// ix:header is the hidden XBRL block at the top of inline-XBRL SEC filings.
const DROP_BLOCKS = ["script", "style", "noscript", "svg", "nav", "footer", "iframe", "head", "aside", "template", "ix:header"];

// Removes <tag ...>...</tag> blocks with indexOf scans (linear time; no
// backtracking regex). Unclosed blocks are removed to the end of the input.
function dropBlocks(html, tags) {
  let out = html;
  for (const tag of tags) {
    const lower = out.toLowerCase();
    const open = `<${tag}`, close = `</${tag}`;
    let res = "", pos = 0;
    for (;;) {
      let i = lower.indexOf(open, pos);
      // require a tag boundary after the name (<nav> or <nav ...>, not <navbar>)
      while (i !== -1 && /[a-z0-9-]/.test(lower[i + open.length] || "")) i = lower.indexOf(open, i + 1);
      if (i === -1) { res += out.slice(pos); break; }
      res += out.slice(pos, i) + " ";
      const j = lower.indexOf(close, i + open.length);
      if (j === -1) { pos = out.length; break; }
      const end = lower.indexOf(">", j);
      pos = end === -1 ? out.length : end + 1;
    }
    out = res;
  }
  return out;
}

// Removes <!-- ... --> comments in linear time (an unclosed one runs to the end).
function dropComments(html) {
  let res = "", pos = 0;
  for (;;) {
    const i = html.indexOf("<!--", pos);
    if (i === -1) return res + html.slice(pos);
    res += html.slice(pos, i) + " ";
    const j = html.indexOf("-->", i + 4);
    if (j === -1) return res;
    pos = j + 3;
  }
}

function decodeEntity(m, name) {
  if (name[0] === "#") {
    const cp = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  }
  return ENTITIES[name.toLowerCase()] ?? m;
}

export function htmlToText(html) {
  return dropBlocks(dropComments(String(html || "").slice(0, MAX_TEXT_INPUT)), DROP_BLOCKS)
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t\f\v\r\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// The first <h1> heading, as text (article pages put the headline there).
export function firstHeading(html) {
  const m = /<h1\b[^>]*>([\s\S]{0,600}?)<\/h1>/i.exec(String(html || "").slice(0, MAX_TEXT_INPUT));
  return m ? htmlToText(m[1]) : "";
}

// Page chrome that some IR sites put in the <h1> ("News Details", "Press
// Release"): never an anchor for the article.
const GENERIC_HEADING = /^(?:(?:news|press|media|investors?|company|corporate)(?:\s*(?:&|and)\s*events)?(?:\s+(?:releases?|details?|room|center|centre|news|updates?))?|(?:release|article|story)\s+details?|newsroom|investor relations)$/i;
export function usableHeading(heading) {
  const h = String(heading || "").replace(/\s+/g, " ").trim();
  return Boolean(h) && !GENERIC_HEADING.test(h) && h.split(" ").length >= 3;
}

// --- Picking the text ----------------------------------------------------------
const ABBREV = /(?:\b(?:Inc|Corp|Co|Ltd|Mr|Mrs|Ms|Dr|No|Nos|vs|approx|St|Jr|Sr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|e\.g|i\.e|etc)|\b[A-Z])\.$/;

// Sentences (and lines) with their offsets in text.
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const push = (a, b) => { const s = text.slice(a, b).trim(); if (s) out.push({ start: a, end: b, text: s }); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") { push(start, i); start = i + 1; continue; }
    if ((c === "." || c === "!" || c === "?") && /\s/.test(text[i + 1] || " ")) {
      if (c === "." && ABBREV.test(text.slice(Math.max(start, i - 8), i + 1))) continue;
      push(start, i + 1);
      start = i + 1;
    }
  }
  push(start, text.length);
  return out;
}

const MONEY_RE = /(?:US\$|C\$|A\$|NT\$|\$|€|£|¥)\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand|trillion|mn|bn)\b|\b\d[\d,]*(?:\.\d+)?\s?[MB]\b/i;
const PCT_RE = /\d(?:[\d,.]*\d)?\s?(?:%|percent\b|per cent\b|bps\b|basis points\b)/i;
const DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi;
const NUM_RE = /\b\d[\d,]*(?:\.\d+)?\b/g;

// How strongly a sentence carries figures: money 3, percentages 2, other
// quantities 1 each (at most 2); dates, times and years do not count.
export function figureScore(sentence) {
  let score = 0;
  if (MONEY_RE.test(sentence)) score += 3;
  if (PCT_RE.test(sentence)) score += 2;
  const nums = (sentence.replace(DATE_RE, " ").match(NUM_RE) || []).filter((n) => !/^(?:19|20)\d\d$/.test(n));
  return score + Math.min(2, nums.length);
}

// Keeps the opening (about lead characters, whole sentences), then the
// sentences with the most figures, in document order, within budget. Text that
// fits the budget is returned whole. Skipped stretches are marked " … ".
export function pickText(text, budget = EXCERPT_CHARS, lead = LEAD_CHARS) {
  const t = String(text || "").trim();
  if (t.length <= budget) return t;
  const sents = splitSentences(t);
  const chosen = new Set();
  let used = 0, k = 0;
  for (; k < sents.length; k++) {
    const len = sents[k].text.length + 1;
    if (used > 0 && used + len > lead) break;
    chosen.add(k); used += len;
  }
  const ranked = [];
  for (let j = k; j < sents.length; j++) {
    const score = figureScore(sents[j].text);
    if (score > 0) ranked.push({ j, score, len: sents[j].text.length + 3 });   // + a " … " gap
  }
  ranked.sort((a, b) => b.score - a.score || a.j - b.j);
  for (const r of ranked) {
    if (r.len > budget / 2 || used + r.len > budget) continue;   // flattened tables read badly
    chosen.add(r.j); used += r.len;
  }
  // Little to keep: carry on with the text in order.
  if (used < budget * 0.6) {
    for (let j = k; j < sents.length && used < budget; j++) {
      if (chosen.has(j)) continue;
      const len = sents[j].text.length + 3;
      if (used + len > budget) break;
      chosen.add(j); used += len;
    }
  }
  let out = "", prev = -1;
  for (const j of [...chosen].sort((a, b) => a - b)) {
    if (prev >= 0) out += j === prev + 1 ? (t.slice(sents[prev].end, sents[j].start).includes("\n") ? "\n" : " ") : " … ";
    out += sents[j].text;
    prev = j;
  }
  return out.slice(0, budget).trim();
}

// Where a release's news ends, on a line of its own past the lead:
// - always at forward-looking statements, a cautionary note, safe harbor,
//   signatures, or a contacts heading ("Media Contacts", "Contact:");
// - at an "About <Name>" heading only when it starts boilerplate: never
//   "About Us" (a menu line) or a section of the release itself ("About the
//   Transaction", "About the Offering"; "About the Company" is boilerplate),
//   and only when no money or percentage figure follows before the next
//   marker (company boilerplate carries none; a deal section does).
const HARD_TAIL_RE = /^(?:(?:Cautionary|Special)\s+(?:Note|Statement)s?\b.{0,70}|(?:Note\s+Regarding\s+)?Forward[- ]Looking\s+(?:Statements?|Information)\b.{0,40}|Safe\s+Harbor\b.{0,40}|SIGNATURES?|(?:Media|Investors?|Press)(?:\s+(?:and|&)\s+(?:Media|Investors?|Press))?(?:\s+Relations)?\s+(?:Contacts?|Inquiries)\s*:?|Contacts?\s*:)$/;
const ABOUT_RE = /^About\s+(the\s+)?([A-Z][\w&.,'’()-]*(?:\s+[A-Z0-9(][\w&.,'’()-]*){0,6})\s*:?$/;
const RELEASE_SECTION = /^(?:Transactions?|Offering|Agreements?|Contracts?|Acquisitions?|Merger|(?:Business\s+)?Combination|Programm?e?s?|Awards?|Orders?|Deals?|Partnership|Collaboration|Facility|Financing|Investment|Placement|Notes?|Loans?|Conference\s+Call|Call|Webcast|Event|Study|Trial|Project|Results|Quarter|Guidance|Outlook)\b/i;
function aboutBoilerplate(line) {
  const m = ABOUT_RE.exec(line);
  if (!m) return false;
  if (/^Us\b/.test(m[2])) return false;
  if (m[1] && !/^Company\b/i.test(m[2])) return false;
  return !RELEASE_SECTION.test(m[2]);
}
export function cutTail(text, minKeep = 300) {
  const t = String(text);
  const marks = [];
  let at = 0;
  for (const line of t.split("\n")) {
    const s = line.replace(/\s+/g, " ").trim();
    if (at >= minKeep && s && s.length <= 120) {
      if (HARD_TAIL_RE.test(s)) marks.push({ at, hard: true });
      else if (aboutBoilerplate(s)) marks.push({ at, hard: false });
    }
    at += line.length + 1;
  }
  for (let k = 0; k < marks.length; k++) {
    const section = t.slice(marks[k].at, k + 1 < marks.length ? marks[k + 1].at : t.length);
    if (marks[k].hard || (!MONEY_RE.test(section) && !PCT_RE.test(section))) return t.slice(0, marks[k].at).trim();
  }
  return t.trim();
}

// Starts the excerpt where the article starts: the <h1> if it is a real
// headline, else the first occurrence of the title's opening words, else the
// top of the text. Then keeps the lead and the figures (pickText). The tail
// is cut only after an anchor: without one the text opens with page chrome,
// whose menu lines can look like a release's tail.
export function excerptFrom(text, title, heading = "") {
  const anchors = [usableHeading(heading) ? heading : "", title].filter(Boolean);
  let start = -1;
  for (const a of anchors) {
    const words = String(a).replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
    if (words.length < 2) continue;
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+(?:\\w+\\W+){0,2}"), "i");
    const m = re.exec(text);
    if (m) { start = m.index; break; }
  }
  return pickText(start >= 0 ? cutTail(text.slice(start)) : String(text).trim());
}

// --- Feed text ------------------------------------------------------------------
// A summary that stops short: "[…]", a trailing ellipsis, "Read more".
const TEASER_RE = /(?:\[\s*(?:…|\.\.\.|&hellip;)\s*\]|…|\.\.\.|\bread more\b[^\n]{0,30}|\bcontinue reading\b[^\n]{0,60})\s*$/i;
// WordPress's footer on every feed item, full text or teaser.
const WP_FOOTER_RE = /\n?The post [^\n]{1,400} appeared first on [^\n]{1,200}\s*$/;
const normalize = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const DATE_LINE_RE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})(?:\s*-?\s*\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)?$/i;

// Lines some feeds put above the release: the title again, "Content Import",
// a date, a one-word category ("General").
function dropFeedChrome(text, title) {
  const lines = text.split("\n");
  const t = normalize(title);
  let k = 0;
  for (; k < Math.min(lines.length - 1, 8); k++) {
    const line = lines[k].trim();
    const n = normalize(line);
    const chrome = !n || (t && n.startsWith(t) && n.length <= t.length + 60) || /^content import$/i.test(line) || DATE_LINE_RE.test(line) ||
      (line.length <= 25 && !/[.!?:]$/.test(line) && line.split(/\s+/).length <= 2 && !/\d/.test(line));
    if (!chrome) break;
  }
  return lines.slice(k).join("\n");
}

// The excerpt for an item whose feed carried its text, or null when the text
// is missing or only a teaser (the page is fetched instead).
export function feedExcerpt(body, title) {
  const text = String(body || "").trim().replace(WP_FOOTER_RE, "").trim();
  if (text.length < FEED_MIN_CHARS || TEASER_RE.test(text.slice(-300))) return null;
  const excerpt = pickText(cutTail(dropFeedChrome(text, title)));
  return excerpt.length >= MIN_BODY_CHARS ? excerpt : null;
}

// The first PDF a feed's text links, kept by news-monitor as "label (url)":
// a presentations feed often carries nothing else.
export function pdfLinkIn(body) {
  const m = /\((https?:\/\/[^\s()]+?\.pdf(?:[?#][^\s()]*)?)\)/i.exec(String(body || ""));
  return m && isHttpUrl(m[1]) ? m[1] : null;
}

// --- PDF text -------------------------------------------------------------------
// Legal and boilerplate sections of a deck or letter: a page is cut at a line
// that opens one, and a page whose opening is legal prose is dropped whole.
const PDF_SECTION_RE = /^(?:(?:Legal\s+)?Disclaimers?|Important\s+(?:Notice|Information)|(?:Use\s+of\s+)?Non-GAAP\s+(?:Financial\s+)?(?:Measures?|Information|Reconciliations?)|Industry\s+and\s+Market\s+Data|Trademarks?)\b.{0,40}$/i;
const LEGAL_OPENING_RE = /forward[- ]looking\s+(?:statements|information)|safe\s+harbor|Private\s+Securities\s+Litigation\s+Reform\s+Act|projected\s+financial\s+information|(?:is|does)\s+not\s+(?:an\s+offer|constitute\s+an\s+offer)/i;

// Lines that carry no reading: page and footnote numbers, and chart axes or
// bar labels (numbers with no word of three letters).
const PDF_NOISE = (l) => l.length < 3 || /^\(?\d{1,3}[.)]?$/.test(l) ||
  (!/\p{L}{3,}/u.test(l) && (l.match(/\d[\d,.]*/g) || []).length > 3);
const PDF_LEAD_CHARS = 400;

// Lead and figures of a PDF's pages. Running headers and footers (a line on at
// least three pages) and noise lines are dropped first; the lead is shorter
// than a release's, so more of the budget goes to the slides' figures.
export function pdfExcerpt(pages) {
  const list = (pages || []).map((p) => String(p || ""));
  const seen = new Map();
  for (const page of list) {
    for (const line of new Set(page.split("\n").map((l) => l.trim()).filter(Boolean))) seen.set(line, (seen.get(line) || 0) + 1);
  }
  const repeated = (line) => list.length >= 3 && (seen.get(line) || 0) >= Math.max(3, list.length * 0.3);
  const kept = [];
  for (const page of list) {
    // "1. Text" footnotes and list items read as "1) Text", so "1." is not a sentence.
    const lines = page.split("\n").map((l) => l.trim()).filter((l) => l && !PDF_NOISE(l) && !repeated(l))
      .map((l) => l.replace(/^(\d{1,2})\.\s+/, "$1) "));
    let cut = lines.length;
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].length <= 120 && (HARD_TAIL_RE.test(lines[k]) || PDF_SECTION_RE.test(lines[k]))) { cut = k; break; }
    }
    const text = lines.slice(0, cut).join("\n").trim();
    if (!text || LEGAL_OPENING_RE.test(text.slice(0, 400))) continue;
    kept.push(text);
  }
  // The lead is the first page (the cover), at most PDF_LEAD_CHARS.
  const lead = Math.min(PDF_LEAD_CHARS, (kept[0]?.length || 0) + 1);
  return pickText(kept.join("\n"), EXCERPT_CHARS, lead);
}

// --- SEC filings -------------------------------------------------------------
const ITEM_RE = /(?:^|\n)[ \t\u00a0]*(?:ITEM|Item)[ \t\u00a0]+\d{1,2}(?:\.\d{1,2})?[A-Z]?\b/g;
// A table-of-contents entry: an Item heading whose stretch to the next
// heading is short and holds no prose, only titles and page numbers (a 10-Q
// lists its statements under Item 1). A short real item, such as an 8-K's
// one-sentence Item 2.02, has a sentence and is kept.
const TOC_SPAN = 700;
function isProse(line) {
  const s = line.trim();
  const words = s.split(/\s+/).filter(Boolean).length;
  return words >= 15 || (words >= 3 && /[.!?]["'’”)]?$/.test(s));
}
function isTocEntry(segment) {
  if (segment.length >= TOC_SPAN) return false;
  const [head, ...rest] = segment.split("\n");
  return head.split(/\s+/).filter(Boolean).length < 15 && !rest.some(isProse);
}

// The filing's own text: from the first Item heading that starts real content
// (skipping a 10-Q/10-K table of contents) to the signature block. Filings
// without Item headings (6-K) start after the cover's check boxes.
export function secBody(text) {
  const t = String(text || "");
  const heads = [...t.matchAll(ITEM_RE)].slice(0, 80).map((m) => m.index + (t[m.index] === "\n" ? 1 : 0));
  let start = -1;
  for (let i = 0; i < heads.length; i++) {
    if (!isTocEntry(t.slice(heads[i], i + 1 < heads.length ? heads[i + 1] : t.length))) { start = heads[i]; break; }
  }
  if (start === -1 && heads.length) start = heads[0];
  if (start === -1) {
    let end = 0;
    for (const m of t.slice(0, 6000).matchAll(/Form 40-F[^\n]*|Rule 101\(b\)\(\d\)[^\n]*/g)) end = m.index + m[0].length;
    start = end;
  }
  let body = t.slice(start);
  const sigs = [...body.matchAll(/\n[ \t\u00a0]*SIGNATURES?\b/g)];
  if (sigs.length) body = body.slice(0, sigs[sigs.length - 1].index);
  return body.trim();
}

// https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/ for a filing URL.
function filingFolder(u) {
  const m = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\//.exec(u.pathname);
  return m ? { prefix: `/Archives/edgar/data/${m[1]}/${m[2]}/`, accession: m[2] } : null;
}
export function filingIndexUrl(url) {
  const u = new URL(url);
  const f = filingFolder(u);
  if (!f) return null;
  const a = f.accession;
  return `https://www.sec.gov${f.prefix}${a.slice(0, 10)}-${a.slice(10, 12)}-${a.slice(12)}-index.htm`;
}

// A link inside the same filing folder on www.sec.gov (inline-XBRL viewer
// links "/ix?doc=/Archives/..." point at the document itself).
function sameFiling(href, base) {
  let u;
  try { u = new URL(href.replace(/^\/ix\?doc=/, ""), base); } catch { return null; }
  const f = filingFolder(new URL(base));
  if (!f || !/^(www\.)?sec\.gov$/i.test(u.hostname) || !u.pathname.startsWith(f.prefix) || u.pathname === new URL(base).pathname) return null;
  if (/\.(pdf|jpe?g|png|gif|xlsx?|zip|xml|xsd)$/i.test(u.pathname)) return null;
  u.protocol = "https:"; u.hostname = "www.sec.gov"; u.hash = "";
  return u.toString();
}

const EX991_FILE = /(?:^|[^a-z0-9])(?:d?ex|exh|exhibit)[-_ ]?99[-_.]?0?1(?![0-9])/i;
const EX99_FILE = /(?:^|[^a-z0-9])(?:d?ex|exh|exhibit)[-_ ]?99(?![0-9])/i;
const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/gi;

// The Ex-99.1 link in a filing's own exhibit index (8-K and 10-Q documents
// link their exhibits), by file name, else by a table row that says 99.1.
export function findExhibitLink(html, baseUrl) {
  const h = String(html || "").slice(0, MAX_BYTES);
  let byName99 = null;
  for (const m of h.matchAll(ANCHOR_RE)) {
    const url = sameFiling(m[1], baseUrl);
    if (!url) continue;
    const file = new URL(url).pathname.split("/").pop();
    if (EX991_FILE.test(file)) return url;
    if (!byName99 && EX99_FILE.test(file)) byName99 = url;
  }
  for (const row of h.split(/<tr\b/i).slice(1, 400)) {
    const cell = row.split(/<\/tr>/i)[0];
    if (!/(?:^|[^\d.])99\.0?1(?![\d])/.test(htmlToText(cell))) continue;
    for (const m of cell.matchAll(ANCHOR_RE)) {
      const url = sameFiling(m[1], baseUrl);
      if (url) return url;
    }
  }
  return byName99;
}

// The EX-99.1 (else first EX-99.x) document in an EDGAR filing index page.
export function exhibitFromIndex(html, indexUrl) {
  let first99 = null;
  for (const row of String(html || "").split(/<tr\b/i).slice(1, 400)) {
    const cells = [...row.split(/<\/tr>/i)[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    const type = cells.map((c) => htmlToText(c).toUpperCase()).find((c) => /^EX-99(?:\.\d{1,2})?$/.test(c));
    if (!type) continue;
    const link = cells.join(" ").match(/href\s*=\s*["']([^"']+)["']/i);
    const url = link ? sameFiling(link[1], indexUrl) : null;
    if (!url) continue;
    if (/^EX-99\.0?1$/.test(type)) return url;
    first99 ||= url;
  }
  return first99;
}

// The primary document (first row) of an EDGAR filing index page.
export function primaryFromIndex(html, indexUrl) {
  for (const row of String(html || "").split(/<tr\b/i).slice(1, 50)) {
    const link = row.split(/<\/tr>/i)[0].match(/href\s*=\s*["']([^"']+\.(?:htm|html|txt))["']/i);
    const url = link ? sameFiling(link[1], indexUrl) : null;
    if (url) return url;
  }
  return null;
}

// Filing text first (its Item lines say what was filed), then the release.
export function secExcerpt(bodyText, exhibitText) {
  const body = secBody(bodyText);
  const ex = cutTail(String(exhibitText || ""));
  if (ex.length < MIN_BODY_CHARS) return pickText(body);
  const head = pickText(body, SEC_BODY_CHARS, 400);
  const label = "EX-99.1: ";
  return `${head}\n${label}${pickText(ex, EXCERPT_CHARS - head.length - label.length - 1)}`.trim();
}

// --- Fetching ----------------------------------------------------------------
// Pages that load their release body from another URL with JavaScript.
export function excerptUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  // Unusual Machines' release page is a shell that loads the text from the
  // company's public B2i library (the key is published in the page's script).
  const id = u.searchParams.get("i");
  if (/^(www\.)?unusualmachines\.com$/i.test(u.hostname) && u.pathname.replace(/\/$/, "") === "/press-release" && /^\d+$/.test(id || "")) {
    return `https://www.b2i.us/b2i/LibraryView.asp?b=2958&api=Qk2Te5Pj8&id=${id}`;
  }
  return raw;
}

function charsetOf(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || "");
  if (fromHeader) return fromHeader[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head || "");
  return fromMeta ? fromMeta[1] : "utf-8";
}

function decode(buf, label) {
  try { return new TextDecoder(label).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

const RETRYABLE = (status) => status === "skipped_sec_needs_contact" || status === "http_429" || /^http_5\d\d$/.test(status) || status.startsWith("error");
const isSecUrl = (u) => /(^|\.)sec\.gov$/i.test(u.hostname);

// sec.gov fair access allows 10 requests a second. Requests to it start at
// least SEC_GAP_MS apart in this isolate (under 7 a second, whatever the
// concurrency), and the cron's SEC pass stands aside while an admin refresh
// holds the lease (refreshSecExcerpts), so the two never add up.
const SEC_GAP_MS = 150;
const SEC_LEASE_KEY = "sec_refresh_until";
const SEC_LEASE_MS = 120_000;
// The gap runs from the previous request's actual start: a waiter that wakes
// late, or alongside another, checks again before it goes.
let secNextStart = 0;
async function secPace() {
  for (;;) {
    const now = Date.now();
    if (now >= secNextStart) { secNextStart = now + SEC_GAP_MS; return; }
    await new Promise((resolve) => setTimeout(resolve, secNextStart - now));
  }
}

// Up to limit bytes of a body; more = the body went on past them.
async function readBody(body, limit) {
  const chunks = [];
  let size = 0, more = false;
  if (body) {
    const reader = body.getReader();
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    if (size >= limit) more = true;
    try { await reader.cancel(); } catch {}
  }
  const buf = new Uint8Array(Math.min(size, limit));
  let off = 0;
  for (const c of chunks) {
    if (off >= buf.length) break;
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off); off += part.length;
  }
  return { buf, more };
}

const PDF_PATH_RE = /\.pdf$/i;
const isPdfBytes = (buf) => new TextDecoder("latin1").decode(buf.subarray(0, 1024)).includes("%PDF-");

// The last PDF_TAIL_BYTES of a file too large to read whole, or null when the
// server does not serve byte ranges.
async function fetchTail(url, ua, signal) {
  try {
    const r = await fetch(url, { headers: { "user-agent": ua, accept: "application/pdf", range: `bytes=-${PDF_TAIL_BYTES}` }, redirect: "follow", signal });
    if (r.status !== 206) { try { await r.body?.cancel(); } catch {} return null; }
    return (await readBody(r.body, PDF_TAIL_BYTES)).buf;
  } catch { return null; }
}

// One page: { status: "ok", html, finalUrl } or { status: http_<code> | skipped_* | error* }.
// With opts.pdf a PDF response is read too, as { status: "ok", pdf: [head, tail?],
// finalUrl }, while opts.budget has a download left (else "deferred_pdf").
async function fetchPage(url, ua, opts = {}) {
  const path = new URL(url).pathname;
  if (/\.(xlsx?|docx?|zip|pptx?)$/i.test(path) || (PDF_PATH_RE.test(path) && !opts.pdf)) return { status: "skipped_binary" };
  // A known PDF takes one of this tick's downloads before it is requested (the
  // fetches run concurrently); a request that brings no PDF gives it back.
  let reserved = false, downloaded = false;
  if (opts.pdf && opts.budget && PDF_PATH_RE.test(path)) {
    if (opts.budget.left <= 0) return { status: "deferred_pdf" };
    opts.budget.left--;
    reserved = true;
  }
  if (isSecUrl(new URL(url))) await secPace();
  const ctl = new AbortController();
  // starts when this fetch starts
  const timer = setTimeout(() => ctl.abort("timeout"), opts.pdf ? PDF_TIMEOUT_MS : 9000);
  try {
    const accept = opts.pdf ? "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" : "text/html,application/xhtml+xml,*/*";
    const r = await fetch(url, { headers: { "user-agent": ua, accept }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) return { status: `http_${r.status}` };
    const type = r.headers.get("content-type") || "";
    const finalUrl = r.url || url;
    const pdfLike = /application\/(?:x-)?pdf/i.test(type) ||
      (/octet-stream|binary|download/i.test(type) && (PDF_PATH_RE.test(path) || PDF_PATH_RE.test(new URL(finalUrl).pathname)));
    if (pdfLike) {
      if (!opts.pdf) { try { await r.body?.cancel(); } catch {} return { status: "skipped_binary" }; }
      if (opts.budget && !reserved) {
        if (opts.budget.left <= 0) { try { await r.body?.cancel(); } catch {} return { status: "deferred_pdf" }; }
        opts.budget.left--;
        reserved = true;
      }
      downloaded = true;
      const { buf, more } = await readBody(r.body, PDF_MAX_BYTES);
      if (!isPdfBytes(buf)) return { status: "skipped_content_type" };
      const tail = more ? await fetchTail(finalUrl, ua, ctl.signal) : null;
      return { status: "ok", pdf: tail ? [buf, tail] : [buf], finalUrl };
    }
    if (!/html|xml|text/i.test(type)) { try { await r.body?.cancel(); } catch {} return { status: "skipped_content_type" }; }
    const { buf } = await readBody(r.body, MAX_BYTES);
    const head = new TextDecoder("latin1").decode(buf.subarray(0, 4096));
    return { status: "ok", html: decode(buf, charsetOf(type, head)), finalUrl };
  } catch (e) {
    return { status: String(e).includes("timeout") ? "error_timeout" : "error" };
  } finally {
    clearTimeout(timer);
    if (reserved && !downloaded) opts.budget.left++;
  }
}

// PDFs are parsed one at a time in this isolate (memory), whatever the fetch
// concurrency.
let pdfQueue = Promise.resolve();
function parsePdf(segments) {
  const run = pdfQueue.then(() => pdfText(segments));
  pdfQueue = run.catch(() => {});
  return run;
}

async function pdfResult(doc, source) {
  let read;
  try { read = await parsePdf(doc.pdf); } catch { read = { status: "error", pages: [] }; }
  const excerpt = read.status === "ok" ? pdfExcerpt(read.pages) : "";
  return excerpt.length >= MIN_BODY_CHARS ? { status: "pdf", excerpt, source } : { status: "pdf_unreadable", source };
}

// Titles of documents a covered company posts as PDFs.
const DOC_TITLE_RE = /\b(?:presentations?|deck|slides?|letter|stats?\s+sheets?|fact\s*sheet|investor\s+day|analyst\s+day|annual\s+report|transcript)\b/i;

// The PDF a deck page links for this item: one whose URL carries the item's
// numeric id as a path segment (Equisolve's /presentations/detail/4849/ and
// /db/575/4849/pdf/), else the only PDF on the page of a document's own title.
export function deckPdfLink(html, baseUrl, item) {
  const links = [];
  for (const m of String(html || "").slice(0, MAX_BYTES).matchAll(/href\s*=\s*["']([^"'<>\s]+?\.pdf(?:[?#][^"'<>\s]*)?)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), baseUrl);
      if (u.protocol === "https:" || u.protocol === "http:") links.push(u.href);
    } catch { /* not a URL */ }
  }
  const unique = [...new Set(links)];
  if (!unique.length) return null;
  let ids = [];
  try { ids = new URL(item.url).pathname.split("/").filter((seg) => /^\d{3,9}$/.test(seg) && !/^(?:19|20)\d\d$/.test(seg)); } catch { ids = []; }
  for (const id of ids) {
    const hit = unique.find((u) => new URL(u).pathname.split("/").includes(id));
    if (hit) return hit;
  }
  return unique.length === 1 && DOC_TITLE_RE.test(item.title || "") ? unique[0] : null;
}

const redirectedAway = (finalUrl, url) => {
  try { return new URL(finalUrl).pathname.replace(/\/$/, "") !== url.pathname.replace(/\/$/, ""); } catch { return false; }
};

async function fetchSecExcerpt(env, item) {
  const ua = `zenith-core ${env.CONTACT_EMAIL}`;
  let docUrl = item.url;
  let page = await fetchPage(docUrl, ua);
  if (page.status !== "ok") return { status: page.status };
  let indexHtml = null;
  if (/-index\.html?$/i.test(new URL(docUrl).pathname)) {
    indexHtml = page.html;
    const primary = primaryFromIndex(indexHtml, docUrl);
    if (primary) {
      const p = await fetchPage(primary, ua);
      if (p.status === "ok") { page = p; docUrl = primary; }
    }
  }
  const text = htmlToText(page.html);
  let exUrl = findExhibitLink(page.html, docUrl);
  // 6-Ks often name Exhibit 99.1 without linking it: the filing index has it.
  if (!exUrl && /\b(?:Exhibit|EX-)\s*99\b/i.test(text)) {
    if (!indexHtml) {
      const idxUrl = filingIndexUrl(docUrl);
      const idx = idxUrl ? await fetchPage(idxUrl, ua) : null;
      if (idx?.status === "ok") indexHtml = idx.html;
    }
    if (indexHtml) exUrl = exhibitFromIndex(indexHtml, filingIndexUrl(docUrl) || docUrl);
  }
  let exText = "";
  if (exUrl) {
    const ex = await fetchPage(exUrl, ua);
    if (ex.status === "ok") exText = htmlToText(ex.html);
  }
  const excerpt = secExcerpt(text, exText);
  return excerpt.length >= MIN_BODY_CHARS ? { status: "ok", excerpt } : { status: "skipped_empty" };
}

const PAGE_UA = "zenith-core/1.0 (research feed)";

// ctx.pdfBudget ({ left }) is shared by every fetch of one enrich call.
// Counterparty items (they carry a role) never have their PDFs read.
export async function fetchExcerpt(env, item, ctx = {}) {
  if (!isHttpUrl(item.url)) return { status: "skipped_bad_url" };
  const url = new URL(item.url);
  if (isSecUrl(url)) {
    if (!env.CONTACT_EMAIL) return { status: "skipped_sec_needs_contact" };
    return fetchSecExcerpt(env, item);
  }
  const covered = !item.role;
  const budget = ctx.pdfBudget || { left: PDF_PER_TICK };
  // A PDF the item's feed named (a Q4 presentations feed links the deck).
  if (covered && item.excerpt_source && isHttpUrl(item.excerpt_source)) {
    const doc = await fetchPage(item.excerpt_source, PAGE_UA, { pdf: true, budget });
    if (doc.status === "ok" && doc.pdf) return pdfResult(doc, item.excerpt_source);
    if (doc.status !== "ok") return { status: doc.status };
  }
  const page = await fetchPage(excerptUrl(url.toString()), PAGE_UA, { pdf: covered, budget });
  if (page.status !== "ok") return { status: page.status };
  if (page.pdf) return pdfResult(page, page.finalUrl !== url.href ? page.finalUrl : null);
  // A deck's page (or the listing it redirects to) that links the deck's PDF.
  if (covered && (DOC_TITLE_RE.test(item.title || "") || redirectedAway(page.finalUrl, url))) {
    const link = deckPdfLink(page.html, page.finalUrl || url.href, item);
    if (link) {
      const doc = await fetchPage(link, PAGE_UA, { pdf: true, budget });
      if (doc.status === "ok" && doc.pdf) return pdfResult(doc, link);
      if (doc.status === "deferred_pdf") return doc;
    }
  }
  const excerpt = excerptFrom(htmlToText(page.html), item.title, firstHeading(page.html));
  return excerpt.length >= MIN_BODY_CHARS ? { status: "ok", excerpt } : { status: "skipped_empty" };
}

async function fetchAll(env, rows, concurrency, ctx = { pdfBudget: { left: PDF_PER_TICK } }) {
  const results = [];
  for (let i = 0; i < rows.length; i += concurrency) {
    const part = rows.slice(i, i + concurrency);
    results.push(...await Promise.all(part.map((item) => fetchExcerpt(env, item, ctx).then((r) => ({ item, ...r })))));
  }
  return results;
}

// The update for one fetch: retry later (excerpt_status stays NULL), or final.
// Without a contact address a sec.gov item is not a try: it waits, so setting
// CONTACT_EMAIL later still fills it in.
const NO_CONTACT_WAIT_MINUTES = 720;
function resultStatement(env, { item, status, excerpt, source }, now) {
  if (status === "skipped_sec_needs_contact") {
    return env.DB.prepare("UPDATE items SET excerpt_next_at = ? WHERE id = ?").bind(nowIso(Date.now() + NO_CONTACT_WAIT_MINUTES * 60_000), item.id);
  }
  // Over this tick's PDF budget: read on a later tick, without spending a try.
  if (status === "deferred_pdf") {
    return env.DB.prepare("UPDATE items SET excerpt_next_at = ? WHERE id = ?").bind(nowIso(Date.now() + PDF_WAIT_MINUTES * 60_000), item.id);
  }
  // A PDF's text, or one with none: final. excerpt_source names the PDF when
  // it is not the item's own URL.
  if (status === "pdf" || status === "pdf_unreadable") {
    return env.DB.prepare("UPDATE items SET excerpt = ?, excerpt_status = ?, excerpt_tries = ?, excerpt_at = ?, excerpt_source = COALESCE(?, excerpt_source) WHERE id = ?")
      .bind(excerpt || null, status, (item.excerpt_tries || 0) + 1, now, source || null, item.id);
  }
  const tries = (item.excerpt_tries || 0) + 1;
  // A 403 gets one later retry: CDN bot checks in front of IR sites (Q4's
  // Cloudflare, seen on SRFM, PL and ASST) refuse a request now and then.
  if ((RETRYABLE(status) && tries < MAX_TRIES) || (status === "http_403" && tries < FORBIDDEN_TRIES)) {
    const wait = RETRY_MINUTES[Math.min(tries - 1, RETRY_MINUTES.length - 1)];
    return env.DB.prepare("UPDATE items SET excerpt_tries = ?, excerpt_next_at = ? WHERE id = ?")
      .bind(tries, nowIso(Date.now() + wait * 60_000), item.id);
  }
  return env.DB.prepare("UPDATE items SET excerpt = ?, excerpt_status = ?, excerpt_tries = ?, excerpt_at = ? WHERE id = ?")
    .bind(excerpt || null, status, tries, now, item.id);
}

const SEC_URL_SQL = "(url LIKE 'https://www.sec.gov/%' OR url LIKE 'https://sec.gov/%' OR url LIKE 'http://www.sec.gov/%')";

// Due for a fetch: no retry is scheduled, its time has come, or (once
// CONTACT_EMAIL is set) it only waited for a contact address, which never
// spends a try. ?1 = now, ?2 = 1 when CONTACT_EMAIL is set.
const DUE_SQL = (p = "") => `(${p}excerpt_next_at IS NULL OR ${p}excerpt_next_at <= ?1 OR (?2 = 1 AND COALESCE(${p}excerpt_tries, 0) = 0))`;

async function secLeaseHeld(env, now) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(SEC_LEASE_KEY).first();
  return Boolean(row && row.value > now);
}

export async function enrich(env) {
  const now = nowIso();
  const contact = env.CONTACT_EMAIL ? 1 : 0;
  const pick = (secOnly, limit) => env.DB.prepare(
    `SELECT id, url, title, excerpt_tries, role, excerpt_source FROM items
      WHERE excerpt_status IS NULL AND state IN ('pending','claimed') AND ${DUE_SQL()} AND ${secOnly ? "" : "NOT "}${SEC_URL_SQL}
      ORDER BY nm_first_seen DESC LIMIT ?3`,
  ).bind(now, contact, limit).all().then((r) => r.results || []);
  // An admin SEC refresh in progress has sec.gov's budget to itself.
  const secBusy = await secLeaseHeld(env, now);
  const results = [
    ...await fetchAll(env, await pick(false, PER_TICK - SEC_PER_TICK), CONCURRENCY),
    ...(secBusy ? [] : await fetchAll(env, await pick(true, SEC_PER_TICK), SEC_CONCURRENCY)),
  ];
  const stmts = results.map((r) => resultStatement(env, r, now));
  if (stmts.length) await env.DB.batch(stmts);
  const count = (status) => results.filter((r) => r.status === status).length;
  return { tried: results.length, ok: count("ok"), pdf: count("pdf"), pdf_unreadable: count("pdf_unreadable"), pdf_deferred: count("deferred_pdf"),
    retry: results.filter((r) => RETRYABLE(r.status)).length, sec_deferred: secBusy, at: now };
}

// Last reads that ended in a refusal or an outage, worth one more pass.
const TRANSIENT_FINAL_SQL = (p = "") =>
  `(${p}excerpt_status IN ('http_403','http_429') OR ${p}excerpt_status LIKE 'http_5%' OR ${p}excerpt_status LIKE 'error%')`;

// Admin (POST /v1/admin/requeue {mode:"sec_excerpts"}): re-reads sec.gov items
// of the given (covered) tickers that were never read with this reader
// (excerpt_at is NULL), graded ones included, and requeues each one it could
// read so it is graded on the filing text. Bounded per call; call again until
// remaining is 0. Items in retry backoff wait for their next try and are
// counted as waiting, so back-to-back calls never spend an item's tries at
// once. Needs CONTACT_EMAIL; one refresh runs at a time.
//   limit (1-10, default 8), since (first_seen lower bound), include_duplicates,
//   retry_failed (also re-read items whose last read ended in a 403, 429, 5xx
//   or network error; pass it on every call of that pass), dry_run
export async function refreshSecExcerpts(env, body = {}, tickers = null) {
  if (!env.CONTACT_EMAIL) {
    return { mode: "sec_excerpts", error: "CONTACT_EMAIL is not set: sec.gov requires a contact address in the User-Agent, so filings cannot be read yet" };
  }
  const now = nowIso();
  const limit = Math.max(1, Math.min(10, Number(body.limit) || 8));
  const since = body.since ? String(body.since) : "1970-01-01";
  const unread = body.retry_failed ? `(i.excerpt_at IS NULL OR ${TRANSIENT_FINAL_SQL("i.")})` : "i.excerpt_at IS NULL";
  const scope = `${SEC_URL_SQL.replaceAll("url", "i.url")} AND ${unread} AND i.nm_first_seen >= ?3
      AND (i.state IN ('pending','graded') OR (i.state = 'claimed' AND i.claimed_until < ?1))
      AND (?4 = 1 OR g.band IS NULL OR g.band != 'duplicate')
      AND (?5 IS NULL OR i.ticker IN (SELECT value FROM json_each(?5)))`;
  // A transient final (excerpt_at set) is due again; its old backoff is spent.
  const due = `(${DUE_SQL("i.")} OR i.excerpt_at IS NOT NULL)`;
  const binds = [now, 1, since, body.include_duplicates ? 1 : 0, Array.isArray(tickers) ? JSON.stringify(tickers) : null];
  const FROM = "FROM items i LEFT JOIN grades g ON g.id = i.grade_id";
  const counts = async () => {
    const r = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN ${due} THEN 1 ELSE 0 END), 0) AS remaining, COALESCE(SUM(CASE WHEN ${due} THEN 0 ELSE 1 END), 0) AS waiting ${FROM} WHERE ${scope}`)
      .bind(...binds).first();
    return { remaining: r?.remaining || 0, waiting: r?.waiting || 0 };
  };
  const rows = (await env.DB.prepare(
    `SELECT i.id, i.url, i.title, i.state, i.excerpt_tries ${FROM} WHERE ${scope} AND ${due} ORDER BY i.nm_first_seen DESC LIMIT ?6`,
  ).bind(...binds, limit).all()).results || [];
  if (body.dry_run) return { mode: "sec_excerpts", dry_run: true, ...await counts(), next: rows.map((r) => ({ item_id: r.id, state: r.state, title: r.title })) };
  if (!rows.length) return { mode: "sec_excerpts", cleared: 0, processed: 0, ok: 0, requeued: 0, retry: 0, ...await counts(), items: [] };
  // One refresh at a time, and the cron's SEC pass waits while it runs.
  const lease = await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3`,
  ).bind(SEC_LEASE_KEY, nowIso(Date.now() + SEC_LEASE_MS), now).run();
  if (!lease.meta?.changes) return { mode: "sec_excerpts", error: "another SEC excerpt refresh is running; call again in a minute" };
  try {
    // Statuses written before this reader ran (excerpt_at NULL), and with
    // retry_failed the transient finals, are cleared with their tries: those
    // attempts had no contact address, the old reader, or a passing refusal.
    // Retries scheduled by this reader keep status NULL and their tries.
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    const cleared = await env.DB.prepare(
      `UPDATE items SET excerpt_status = NULL, excerpt_tries = 0, excerpt_next_at = NULL, excerpt_at = NULL
        WHERE id IN (${ph}) AND excerpt_status IS NOT NULL AND (excerpt_at IS NULL${body.retry_failed ? ` OR ${TRANSIENT_FINAL_SQL()}` : ""})`,
    ).bind(...ids).run();
    const fresh = (await env.DB.prepare(`SELECT id, excerpt_tries FROM items WHERE id IN (${ph})`).bind(...ids).all()).results || [];
    const tries = new Map(fresh.map((r) => [r.id, r.excerpt_tries]));
    const results = await fetchAll(env, rows.map((r) => ({ ...r, excerpt_tries: tries.get(r.id) ?? r.excerpt_tries })), SEC_CONCURRENCY);
    const stmts = [], items = [];
    for (const r of results) {
      stmts.push(resultStatement(env, r, now));
      const requeue = r.status === "ok" && r.item.state !== "pending";
      if (requeue) {
        stmts.push(env.DB.prepare("UPDATE items SET state='pending', claim_id=NULL, claimed_until=NULL, attempts=0 WHERE id = ? AND state IN ('graded','claimed')").bind(r.item.id));
      }
      items.push({ item_id: r.item.id, status: r.status, requeued: requeue });
    }
    if (stmts.length) await env.DB.batch(stmts);
    return {
      mode: "sec_excerpts", cleared: cleared.meta?.changes || 0, processed: results.length, ok: results.filter((r) => r.status === "ok").length,
      requeued: items.filter((i) => i.requeued).length, retry: results.filter((r) => RETRYABLE(r.status)).length,
      ...await counts(), items,
    };
  } finally {
    await env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(SEC_LEASE_KEY).run();
  }
}
