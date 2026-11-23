// Coverage-page signals from news-monitor's ops instruments (round 2, part R2B):
// site-structure changes and source health. Read from news-monitor-db through
// the NEWS binding, SELECT only; nothing here touches zenith-db, so no coverage
// count, alert, brief or grade can change.
//   app, admin: GET /v1/site-changes?days=14&limit=50, GET /v1/source-health
//
// site-sources.json (written by scripts/sync-covered.mjs) maps each site_*
// watcher and probe_* source to the covered ticker it watches.
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

// A section path that suggests investor relations, events, presentations,
// investor day, press or news.
export const NOTABLE_SECTION_RE = /investor|(?:^|[^a-z])ir(?:[^a-z]|$)|shareholder|stockholder|event|presentation|webcast|press|news|media/i;
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
  return NOTABLE_SECTION_RE.test(s);
}

function parseDetail(detail) {
  try {
    const d = JSON.parse(detail || "null");
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

// One site_structure_changes row -> the API shape. section: the changed
// section, or for a new child sitemap its first notable new section (else its
// first new one).
export function siteChangeRow(row, sites = SITE_SOURCES.sites || {}) {
  const d = parseDetail(row.detail);
  let section = typeof d.section === "string" ? d.section : null;
  if (!section && Array.isArray(d.newSections)) {
    const added = d.newSections.map((s) => s?.section).filter((s) => typeof s === "string");
    section = added.find(isNotableSection) || added[0] || null;
  }
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

export async function siteChanges(env, url, now = Date.now()) {
  if (!env.NEWS) return json({ error: "NEWS binding missing" }, 503);
  const days = intParam(url.searchParams.get("days"), SITE_DAYS, MAX_SITE_DAYS);
  const limit = intParam(url.searchParams.get("limit"), SITE_LIMIT, MAX_SITE_LIMIT);
  let rows;
  try {
    rows = (await env.NEWS.prepare(
      `SELECT id, source_key, kind, detected_at, message, detail FROM site_structure_changes
        WHERE detected_at >= ? ORDER BY detected_at DESC, id DESC LIMIT ?`,
    ).bind(nowIso(now - days * DAY_MS), limit).all()).results || [];
  } catch (e) {
    if (missingTable(e)) return json({ items: [] });
    return json({ error: clip(e?.message || e, 200) }, 502);
  }
  return json({ items: rows.map((r) => siteChangeRow(r)) });
}

// --- Source health ------------------------------------------------------------
// Probe verdicts that are a usable answer (src/ir-platforms.js classifyResponse);
// everything else (challenge, blocked, not_found, error_status, empty, error,
// other) is failing.
const PROBE_OK = new Set(["feed", "sitemap", "json", "page"]);

export function probeError(row) {
  const d = parseDetail(row.probe_detail);
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
    if (PROBE_OK.has(r.probe_verdict)) { ok++; continue; }
    const p = probes[r.key];
    failing.push({
      key: r.key, ticker: p?.ticker ?? null, label: p?.label || r.key.replace(/^probe_/, "").replace(/_/g, " "),
      since: r.polled_at || null, error: probeError(r),
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
