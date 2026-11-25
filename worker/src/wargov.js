// Phase 0 gates (f): body text for war.gov contract digests. Its own module
// (not excerpt.js) because it reads aux-sources.json and the rubric's MATCH.
import AUX from "./aux-sources.json";
import { MATCH } from "./rubric.generated.js";
import { nowIso, phraseRegex } from "./lib.js";
import { htmlToText, fetchPage, PAGE_UA, EXCERPT_CHARS } from "./excerpt.js";

const MAX_TEXT_INPUT = 300_000;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntity = (m, name) => {
  if (name[0] === "#") {
    const cp = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  }
  return ENTITIES[name.toLowerCase()] ?? m;
};

// wargov_contracts is an auxiliary program source whose items ("Contracts for
// <date>") carry no text, and war.gov article pages refuse Workers. The same
// announcement is in the Department's GovDelivery bulletin feed, with a "View
// Online" link to the war.gov article. enrichAuxWargov reads that feed (at most
// every WARGOV_FEED_MINUTES) and gives each waiting digest its text. The aux
// claim holds a digest without text for WARGOV_HOLD_MINUTES after it was first
// seen. Fetched bulletin text is untrusted data; the grader prints it under the
// claim's untrusted-data line.
export const WARGOV_BULLETIN_URL = "https://public.govdelivery.com/accounts/USDOD/feed.rss";
export const WARGOV_FEED_MINUTES = 15;
export const WARGOV_HOLD_MINUTES = 180;
const WARGOV_ARTICLE_RE = /href\s*=\s*["'](https:\/\/www\.war\.gov\/News\/Contracts\/Contract\/Article\/\d+\/[^"'\s<>]*)["']/i;
const decodeEntities = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);
const unCdata = (s) => String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");

// The bulletin feed's items: { title, html, articleUrl } (articleUrl null when
// the bulletin has no war.gov contracts link).
export function wargovBulletins(xml) {
  const out = [];
  for (const raw of String(xml || "").split(/<item[\s>]/i).slice(1)) {
    const b = raw.split(/<\/item>/i)[0];
    const title = htmlToText(decodeEntities(unCdata((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]))).replace(/\s+/g, " ").trim();
    const desc = unCdata((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || "");
    // An entity-encoded description is HTML once decoded; a CDATA one already is.
    const html = /&lt;/i.test(desc) ? decodeEntities(desc) : desc;
    const view = (html.match(WARGOV_ARTICLE_RE) || [])[1];
    out.push({ title, html, articleUrl: view ? decodeEntities(view) : null });
  }
  return out;
}

// A URL compared without query, hash or trailing slash, host lower-cased.
export function normalUrl(u) {
  try {
    const x = new URL(String(u || ""));
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch { return ""; }
}

// The contract paragraphs of one announcement, as news-monitor's
// contractParagraphs reads them: an all-caps <strong> line under 80 characters
// is the agency header for what follows; paragraphs under 80 characters (and
// footnotes starting with *) are dropped.
export function wargovParagraphs(html) {
  const out = [];
  let agency = null;
  for (const m of String(html || "").slice(0, MAX_TEXT_INPUT).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = htmlToText(m[1]).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^<strong>[\s\S]*<\/strong>$/i.test(m[1].trim()) && text.length < 80 && text === text.toUpperCase()) { agency = text; continue; }
    if (text.length < 80 || text.startsWith("*")) continue;
    out.push({ agency, text });
  }
  return out;
}

// The largest dollar amount a paragraph names, in dollars (0 when none).
export function largestDollars(text) {
  let best = 0;
  for (const m of String(text || "").matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(million|billion|thousand))?/gi)) {
    const n = Number(m[1].replace(/,/g, "")) * ({ thousand: 1e3, million: 1e6, billion: 1e9 }[String(m[2] || "").toLowerCase()] || 1);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

// Outside company names (auxiliary public and private entities, which carry
// peers.json names where one exists) and covered company terms (MATCH terms;
// key accounts are left out, because they include contracting activities such
// as the U.S. Navy and the Air Force Research Laboratory, which most
// paragraphs name).
const bareName = (n) => String(n || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
let defaultNames = null;
function wargovNames() {
  if (!defaultNames) {
    const entities = [...new Set(Object.values(AUX.sources || {}).filter((s) => s.status === "public" || s.status === "private").map((s) => bareName(s.name)))]
      .filter((n) => n.length >= 4);
    const covered = Object.values(MATCH || {}).flatMap((m) => m.terms || []);
    defaultNames = { entities, covered };
  }
  return defaultNames;
}

// The digest's excerpt within `budget` characters: "AGENCY: paragraph" lines.
// Paragraphs naming an outside company come first (auxiliary names), then the
// rest by their largest dollar amount; paragraphs naming a covered company come
// last (Coverage already grades them, one item each, through
// wargov_contracts_matched) and collapse into one count line when the budget
// runs out; "(+N more awards not shown)" ends a cut list.
// names: { entities, covered } (tests); defaults from aux-sources.json and MATCH.
export function wargovDigestExcerpt(html, budget = EXCERPT_CHARS, names = wargovNames()) {
  const paras = wargovParagraphs(html);
  if (!paras.length) return "";
  const entRe = phraseRegex(names.entities), covRe = phraseRegex(names.covered);
  const rows = paras.map((p, i) => ({ ...p, i, covered: Boolean(covRe?.test(p.text)), entity: Boolean(entRe?.test(p.text)), value: largestDollars(p.text) }));
  const rank = (r) => (r.covered ? 2 : r.entity ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? b.value - a.value : 0) || a.i - b.i);
  const line = (r) => `${r.agency ? `${r.agency}: ` : ""}${r.text}`;
  const room = budget - 140;                       // room kept for the two tail lines
  const out = [];
  let len = 0, notShown = 0;
  const add = (l) => { len += l.length + (out.length ? 1 : 0); out.push(l); };
  const fits = (l) => len + l.length + (out.length ? 1 : 0) <= room;
  const main = rows.filter((r) => !r.covered), covered = rows.filter((r) => r.covered);
  for (const [k, r] of main.entries()) {
    let l = line(r);
    if (!out.length && l.length > room) l = `${l.slice(0, room - 1).trimEnd()}…`;
    if (!fits(l)) { notShown = main.length - k; break; }
    add(l);
  }
  let coveredLeft = notShown ? covered.length : 0;
  if (!coveredLeft) {
    for (const [k, r] of covered.entries()) {
      const l = line(r);
      if (!fits(l)) { coveredLeft = covered.length - k; break; }
      add(l);
    }
  }
  if (coveredLeft) out.push(`(${coveredLeft} award${coveredLeft === 1 ? "" : "s"} naming covered companies ${coveredLeft === 1 ? "is" : "are"} graded on Coverage)`);
  if (notShown) out.push(`(+${notShown} more award${notShown === 1 ? "" : "s"} not shown)`);
  return out.join("\n").slice(0, budget);
}

// Gives waiting war.gov digests (aux_items, source wargov_contracts, pending,
// no excerpt yet) their text from the bulletin feed: matched by the bulletin's
// war.gov article URL, else by a unique equal title. A digest still unmatched
// WARGOV_HOLD_MINUTES after it was first seen is marked not_in_feed (graded
// without text). A failed feed read (403, 5xx, network) changes no row; the
// feed is read at most once every WARGOV_FEED_MINUTES (meta wargov_bulletin_next_at).
export async function enrichAuxWargov(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const rows = (await db.prepare(
    `SELECT id, url, title, nm_first_seen FROM aux_items WHERE source_key = 'wargov_contracts' AND state = 'pending' AND excerpt_status IS NULL
      ORDER BY nm_first_seen DESC LIMIT 50`,
  ).all()).results || [];
  if (!rows.length) return { waiting: 0 };
  const next = (await db.prepare("SELECT value FROM meta WHERE key = 'wargov_bulletin_next_at'").first())?.value;
  if (next && next > nowIso(now)) return { waiting: rows.length, next_at: next };
  await db.prepare("INSERT INTO meta (key, value) VALUES ('wargov_bulletin_next_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(nowIso(now + WARGOV_FEED_MINUTES * 60_000)).run();
  const page = await fetchPage(WARGOV_BULLETIN_URL, PAGE_UA);
  if (page.status !== "ok" || !page.html) return { waiting: rows.length, feed: page.status };
  const bulletins = wargovBulletins(page.html);
  const byUrl = new Map(bulletins.filter((b) => b.articleUrl).map((b) => [normalUrl(b.articleUrl), b]));
  const byTitle = new Map();
  for (const b of bulletins) {
    const k = b.title.toLowerCase();
    byTitle.set(k, byTitle.has(k) ? null : b);           // a repeated title matches nothing
  }
  const late = nowIso(now - WARGOV_HOLD_MINUTES * 60_000);
  const stmts = [];
  let ok = 0, missing = 0;
  for (const r of rows) {
    const b = byUrl.get(normalUrl(r.url)) || byTitle.get(String(r.title || "").replace(/\s+/g, " ").trim().toLowerCase()) || null;
    const excerpt = b ? wargovDigestExcerpt(b.html) : "";
    if (excerpt) {
      stmts.push(db.prepare("UPDATE aux_items SET excerpt = ?, excerpt_status = 'ok' WHERE id = ? AND excerpt_status IS NULL").bind(excerpt, r.id));
      ok++;
    } else if (r.nm_first_seen <= late) {
      stmts.push(db.prepare("UPDATE aux_items SET excerpt_status = 'not_in_feed' WHERE id = ? AND excerpt_status IS NULL").bind(r.id));
      missing++;
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { waiting: rows.length, bulletins: bulletins.length, ok, not_in_feed: missing };
}
