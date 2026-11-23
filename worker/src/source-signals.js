// Coverage-page signals from news-monitor's ops instruments (round 2, part R2B):
// site-structure changes and source health. Read from news-monitor-db through
// the NEWS binding, SELECT only; nothing here touches zenith-db, so no coverage
// count, alert, brief or grade can change.
//   app, admin: GET /v1/site-changes?days=14&limit=50[&tickers=KDK,RCAT],
//               GET /v1/source-health
//
// site-sources.json (written by scripts/sync-covered.mjs) maps each site_*
// watcher and probe_* source to the covered ticker it watches, and each probe
// to the answer it is built to get (expect).
//
// news-monitor tables read here:
//   site_structure_changes (src/site-structure.js): one row per flushed change;
//     kind index_moved | index_gone | child_new | child_gone | child_404 |
//     section_new | section_gone; message is the change's text, detail its JSON.
//   edgar_latest_matches (src/scale-schema.js): one row per (filing, woken
//     source) the EDGAR fast trigger matched; requested_at is the latest wakeup.
//   source_diagnostics (src/adapters-probe.js): one row per source; probes
//     (probe_*) write probe_verdict and probe_detail there once a day. Only the
//     latest check is kept, so a failing probe's `since` is the time of the
//     check that found it failing.
import SITE_SOURCES from "./site-sources.json";
import { json, nowIso } from "./lib.js";

const DAY_MS = 86_400_000;
export const SITE_DAYS = 14;
export const SITE_LIMIT = 50;
const MAX_SITE_DAYS = 90;
const MAX_SITE_LIMIT = 200;
// Rows read before the notable-first cut to `limit` (one restructure can emit
// dozens of section rows).
const SITE_SCAN = 1000;
const MAX_TICKERS = 100;

// Path words (split on / - _ .) that suggest investor relations, events,
// presentations, investor day, press or news. Whole words only: /prevention/,
// /express-delivery/, /social-media-policy/ and /newsletter/ are not leads.
export const NOTABLE_WORDS = new Set([
  "investor", "investors", "investorrelations", "investorday", "ir", "shareholder", "shareholders", "stockholder", "stockholders",
  "event", "events", "presentation", "presentations", "webcast", "webcasts",
  "press", "pressroom", "pressreleases", "news", "newsroom", "media", "mediaroom",
]);
// Words that count only when they lead a path segment.
const LEADING_ONLY = new Set(["media"]);
// An off-site section ("//host/", news-monitor's links to another host) counts
// only when the host's first label names an IR site (//investors.kodiak.ai/),
// not a CDN or an aggregator (//media.graphassets.com/, //news.ycombinator.com/).
const OFFSITE_IR_LABELS = new Set(["investor", "investors", "ir", "shareholder", "shareholders", "stockholders"]);
// Kinds that add or change a section: a new section, or a new child sitemap
// that brings new sections with it.
const ADDING_KINDS = new Set(["section_new", "child_new"]);

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
const missingTable = (e) => /no such (table|column)/i.test(String(e?.message || e));

// news-monitor's locale segments (src/site-structure.js isLocaleSegment): a
// language code, optionally with a region or script (en, en-us, pt_BR, es-419).
const LANGUAGES = new Set(("en es fr de it pt nl sv no nb nn da fi pl cs sk hu ro bg el tr ru uk he ar fa hi bn " +
  "ja ko zh th vi id ms tl et lv lt sl hr sr bs mk sq ca eu gl is ga cy af sw ur ta te mr kk az ka hy").split(" "));
function isRootSection(section) {
  if (section === "/") return true;
  const m = /^\/([a-z]{2})(?:[-_](?:[a-z]{2}|[a-z]{4}|\d{3}))?\/$/i.exec(section);
  return Boolean(m && LANGUAGES.has(m[1].toLowerCase()));
}

export function isNotableSection(section) {
  const s = String(section || "");
  // Root sections ("/", "/en/") hold one-level pages, never a section of their own.
  if (!s || isRootSection(s)) return false;
  const off = /^\/\/([^/]+)/.exec(s);
  if (off) return OFFSITE_IR_LABELS.has(off[1].toLowerCase().split(".")[0]);
  // "media" leads its segment (/media/, /media-kit/), so /social-media-policy/ is not a lead.
  return s.toLowerCase().split("/").some((seg) => seg.split(/[-_.]+/).some((w, i) => NOTABLE_WORDS.has(w) && (i === 0 || !LEADING_ONLY.has(w))));
}

function parseDetail(detail) {
  try {
    const d = JSON.parse(detail || "null");
    return d && typeof d === "object" ? d : {};
  } catch {
    return null;
  }
}

// Sections named in news-monitor's change text (src/site-structure.js
// changeText), for a detail JSON cut at 8000 characters: "new section /press/
// (...)", "new child sitemap <...> with new section /a/ (...); new section /b/
// (...)", "section /news/ gone (...)".
function sectionsFromMessage(kind, message) {
  const m = String(message || "");
  if (kind === "section_gone") return [/^section (\S+) gone/.exec(m)?.[1]].filter(Boolean);
  if (kind === "section_new" || kind === "child_new") return [...m.matchAll(/(?:^|with |; )new section (\S+) \(/g)].map((x) => x[1]);
  return [];
}

// One site_structure_changes row -> the API shape, or null for a section that
// news-monitor tells with its child sitemap (detail.merged: the child_new or
// child_gone row already carries it). section: the changed section, or for a
// new child sitemap its first notable new section (else its first new one).
export function siteChangeRow(row, sites = SITE_SOURCES.sites || {}) {
  const parsed = parseDetail(row.detail);
  if (parsed?.merged === true) return null;
  const d = parsed || {};
  let section = typeof d.section === "string" ? d.section : null;
  const added = Array.isArray(d.newSections)
    ? d.newSections.map((s) => s?.section).filter((s) => typeof s === "string")
    : parsed ? [] : sectionsFromMessage(row.kind, row.message);
  if (!section) section = added.find(isNotableSection) || added[0] || null;
  return {
    id: row.id,
    ticker: sites[row.source_key]?.ticker ?? null,
    source_key: row.source_key,
    kind: row.kind,
    section: clip(section, 300),
    detail: clip(row.message || row.kind, 1000),
    detected_at: row.detected_at,
    notable: ADDING_KINDS.has(row.kind) && isNotableSection(section),
  };
}

const intParam = (v, dflt, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : dflt;
};

// tickers=KDK,RCAT -> the site_* keys that watch them (null: no filter).
export function siteKeysFor(tickersParam, sites = SITE_SOURCES.sites || {}) {
  if (tickersParam == null) return null;
  const want = new Set(String(tickersParam).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS));
  return Object.keys(sites).filter((k) => sites[k]?.ticker && want.has(sites[k].ticker));
}

// Keep `limit` rows, notable ones first (so a burst of structural rows cannot
// push out a lead), returned newest first.
export function pickSiteChanges(items, limit) {
  const keep = new Set([...items.filter((i) => i.notable), ...items.filter((i) => !i.notable)].slice(0, limit));
  return items.filter((i) => keep.has(i));
}

export async function siteChanges(env, url, now = Date.now()) {
  if (!env.NEWS) return json({ error: "NEWS binding missing" }, 503);
  const days = intParam(url.searchParams.get("days"), SITE_DAYS, MAX_SITE_DAYS);
  const limit = intParam(url.searchParams.get("limit"), SITE_LIMIT, MAX_SITE_LIMIT);
  const keys = siteKeysFor(url.searchParams.get("tickers"));
  if (keys && !keys.length) return json({ items: [] });
  let rows;
  try {
    // The site keys go in as one JSON array (json_each), well under D1's 100-parameter limit.
    rows = (await env.NEWS.prepare(
      `SELECT id, source_key, kind, detected_at, message, detail FROM site_structure_changes
        WHERE detected_at >= ?1 AND (?2 IS NULL OR source_key IN (SELECT value FROM json_each(?2)))
        ORDER BY detected_at DESC, id DESC LIMIT ?3`,
    ).bind(nowIso(now - days * DAY_MS), keys ? JSON.stringify(keys) : null, SITE_SCAN).all()).results || [];
  } catch (e) {
    if (missingTable(e)) return json({ items: [] });
    return json({ error: clip(e?.message || e, 200) }, 502);
  }
  return json({ items: pickSiteChanges(rows.map((r) => siteChangeRow(r)).filter(Boolean), limit) });
}

// --- Source health ------------------------------------------------------------
// Probe verdicts that are a usable answer (src/ir-platforms.js classifyResponse);
// everything else (challenge, blocked, not_found, error_status, empty, error,
// other) is failing. A probe built to read a feed or a sitemap (expect, from
// site-sources.json) is also failing when it gets anything else, such as an
// HTML soft-404: news-monitor's feed validation calls that "page, not a feed".
const PROBE_OK = new Set(["feed", "sitemap", "json", "page"]);

// An unsynced probe's expected answer, from its key (*_rss, *_feed, *_sitemap).
const keyExpect = (key) => (/_sitemap$/.test(key) ? "sitemap" : /_(rss|feed)$/.test(key) ? "feed" : null);
export const probeOk = (verdict, expect) => PROBE_OK.has(verdict) && (!expect || verdict === expect);

export function probeError(row, expect = null) {
  if (expect && PROBE_OK.has(row.probe_verdict) && row.probe_verdict !== expect) return `${row.probe_verdict}, not a ${expect}`;
  const d = parseDetail(row.probe_detail) || {};
  const http = row.status != null ? `HTTP ${row.status}` : null;
  switch (row.probe_verdict) {
    case "challenge": return [`${d.vendor ? `${d.vendor} ` : ""}challenge`, http].filter(Boolean).join(", ");
    case "blocked": return ["blocked", http].filter(Boolean).join(", ");
    case "not_found": return ["not found", http].filter(Boolean).join(", ");
    case "error_status": return http || "error status";
    case "empty": return "empty response";
    case "error": return clip(d.error || row.error, 200) || "no answer";
    case null: case undefined: return clip(row.error, 200) || "no probe result";
    default: return http ? `${row.probe_verdict}, ${http}` : String(row.probe_verdict);
  }
}

async function edgarFastPath(news, now) {
  try {
    const r = await news.prepare(
      `SELECT MAX(requested_at) AS last_match_at,
              COUNT(DISTINCT CASE WHEN requested_at >= ?1 THEN accession END) AS matches_24h,
              COUNT(DISTINCT CASE WHEN requested_at >= ?2 THEN accession END) AS matches_7d
         FROM edgar_latest_matches`,
    ).bind(nowIso(now - DAY_MS), nowIso(now - 7 * DAY_MS)).first();
    return { last_match_at: r?.last_match_at || null, matches_24h: Number(r?.matches_24h) || 0, matches_7d: Number(r?.matches_7d) || 0 };
  } catch (e) {
    if (!missingTable(e)) console.error("source-health edgar", e?.message || e);
    return null;
  }
}

async function irProbes(news, probes) {
  let rows;
  try {
    rows = (await news.prepare(
      `SELECT key, polled_at, status, error, probe_verdict, probe_detail FROM source_diagnostics
        WHERE key LIKE 'probe\\_%' ESCAPE '\\' ORDER BY key`,
    ).all()).results || [];
  } catch (e) {
    if (!missingTable(e)) console.error("source-health probes", e?.message || e);
    return null;
  }
  const failing = [];
  let ok = 0;
  let checkedAt = null;
  for (const r of rows) {
    if (r.polled_at && (!checkedAt || r.polled_at > checkedAt)) checkedAt = r.polled_at;
    const p = probes[r.key];
    const expect = p ? p.expect ?? null : keyExpect(r.key);
    if (probeOk(r.probe_verdict, expect)) { ok++; continue; }
    failing.push({
      key: r.key, ticker: p?.ticker ?? null, label: p?.label || r.key.replace(/^probe_/, "").replace(/_/g, " "),
      since: r.polled_at || null, error: probeError(r, expect),
    });
  }
  // By ticker (probes without one last), then key.
  failing.sort((a, b) => (a.ticker === null) - (b.ticker === null) || String(a.ticker).localeCompare(String(b.ticker)) || a.key.localeCompare(b.key));
  return { checked_at: checkedAt, failing, ok };
}

export async function sourceHealth(env, now = Date.now()) {
  if (!env.NEWS) return json({ error: "NEWS binding missing" }, 503);
  const [edgar, probes] = await Promise.all([edgarFastPath(env.NEWS, now), irProbes(env.NEWS, SITE_SOURCES.probes || {})]);
  return json({ edgar_fast_path: edgar, ir_probes: probes, as_of: nowIso(now) });
}
