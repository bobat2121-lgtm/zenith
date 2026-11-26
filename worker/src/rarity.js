// Phase 2: the rarity class of a graded row, computed at read time from its
// source key and URL. It answers "is this a rare find?" (a register record or
// an outlet's own reporting) and never feeds the score, the band, the claim
// payload or normalizeGrade: the grader never sees it. Nothing is stored.
//
//   register  an official record: an aux record entry, or a government or
//             register host (records.js OFFICIAL_HOST_RE)
//   original  a named outlet's own reporting, reached through a filter feed
//   issuer    the company's own words: SEC filings, a covered company's own
//             lane, an outside company's own channel
//   wire      a wire or syndication copy (WIRE_HOSTS)
//
// rareRoute is GET /v1/rare, the data for the Rare finds shelf (phase 3).
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { OFFICIAL_HOST_RE } from "./records.js";
import { json, nowIso, universeSql, auxBandShownSql } from "./lib.js";

export const RARITY = ["register", "original", "issuer", "wire"];

// Newswires, syndication portals and market-data sites that re-serve other
// people's text. A URL host matches when it is one of these or a subdomain.
export const WIRE_HOSTS = [
  "prnewswire.com", "globenewswire.com", "businesswire.com", "accessnewswire.com", "accesswire.com",
  "newsfilecorp.com", "newmediawire.com", "einpresswire.com", "stocktitan.net", "nasdaq.com",
  "finance.yahoo.com", "yahoo.com", "msn.com", "marketscreener.com", "seekingalpha.com", "fool.com",
  "markets.businessinsider.com", "ad-hoc-news.de", "investing.com", "tipranks.com", "benzinga.com",
  "marketbeat.com", "247wallst.com", "zacks.com", "simplywall.st", "theglobeandmail.com",
  "streetinsider.com", "morningstar.com", "tradingview.com", "gurufocus.com", "aol.com",
  "finanznachrichten.de",
];

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const SEC_HOST = /(^|\.)sec\.gov$/;

export function hostOf(url) {
  try { return new URL(String(url ?? "")).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

export const isWireHost = (host) => !!host && WIRE_HOSTS.some((w) => host === w || host.endsWith("." + w));

// row: an items or aux_items row ({ source_key, url }). covered and aux are
// covered.json and aux-sources.json (injected in tests). The first rule that
// matches wins. The record test is done here from the injected maps, with the
// logic of records.js isRecordSource.
export function rarityClass(row, { covered = COVERED, aux = AUX } = {}) {
  const key = String(row?.source_key ?? "").trim();
  const host = hostOf(row?.url);
  const a = own(aux?.sources, key) ? aux.sources[key] : null;
  // 1. Filings are the filer's own disclosure (a policy choice: never register).
  if (key.startsWith("edgar_") || (covered?.records || []).includes(key) || a?.sec === true || SEC_HOST.test(host)) return "issuer";
  // 2. A covered company's own lane.
  if (own(covered?.sources, key)) return "issuer";
  // 3. An official record.
  if (a?.record === true || (host && OFFICIAL_HOST_RE.test(host))) return "register";
  // 4. A wire or syndication copy.
  if (isWireHost(host)) return "wire";
  // 5. Runtime keys in neither map, by the aux-route.js prefixes: ia_media_* is
  // industry media; managed_* and every other ia_<x> are that company's own
  // channel. Any other unknown key (a name dropped from coverage) has no class.
  if (!a && !own(covered?.counterparty, key)) {
    if (/^ia_media_./.test(key)) return "original";
    if (/^(managed|ia)_/.test(key)) return "issuer";
    return null;
  }
  // 6. An outside company's own channel (an aux entry that is not a filter
  // built for a covered company).
  if (a && !a.coverage_subject) return "issuer";
  // 7. A coverage-subject or counterparty filter feed whose URL is a named outlet.
  return "original";
}

export const RARE = ["register", "original"];
const RARE_TOP = 50;
const SCAN = 200;
const DAY_MS = 86_400_000;

// A query parameter as an integer in [lo, hi]; missing or not a number gives def.
function bounded(q, name, def, lo, hi) {
  const raw = q.get(name);
  const n = raw === null || raw === "" ? NaN : Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}

// GET /v1/rare?days=14&floor=60 (days 1-30, floor 40-100). The latest grade
// of each row at or above the floor, highest score first: coverage
// rows graded in the window (in the universe, not muted), aux rows first seen
// in the window and graded (not muted, shown on the aux feed). Then the rarity
// class keeps register and original rows, the top 50 of each pipeline.
// Rarity only filters; the order is the score's. muted: tuning.js MUTED_SQL.
export async function rareRoute(env, url, { muted, universe = universeSql(COVERED.tickers), now = Date.now() } = {}) {
  const q = url.searchParams;
  const days = bounded(q, "days", 14, 1, 30);
  const floor = bounded(q, "floor", 60, 40, 100);
  const since = nowIso(now - days * DAY_MS);
  const notMuted = (a) => (muted ? `AND ${a}.source_key NOT IN ${muted}` : "");
  const coverage = (await env.DB.prepare(
    `SELECT i.id AS item_id, COALESCE(g.ticker, i.ticker) AS ticker, i.source_key, i.url, i.title, i.headline, i.headline_tag,
        i.nm_first_seen AS first_seen, g.id AS grade_id, g.score, g.band, g.graded_at
       FROM grades g JOIN items i ON i.id = g.item_id AND i.grade_id = g.id
      WHERE g.graded_at >= ? AND g.score >= ? AND COALESCE(g.ticker, i.ticker) IN ${universe} ${notMuted("i")}
      ORDER BY g.score DESC, i.id DESC LIMIT ${SCAN}`,
  ).bind(since, floor).all()).results || [];
  const aux = (await env.DB.prepare(
    `SELECT a.id AS item_id, COALESCE(g.entity, a.entity_name) AS entity, a.entity_key, a.source_key, a.url, a.title, a.headline, a.headline_tag,
        a.nm_first_seen AS first_seen, g.id AS grade_id, g.score, g.band, g.graded_at
       FROM aux_items a JOIN aux_grades g ON g.id = a.grade_id
      WHERE a.state = 'graded' AND a.nm_first_seen >= ? AND g.score >= ? ${notMuted("a")} AND ${auxBandShownSql("a", "g.band")}
      ORDER BY g.score DESC, a.id DESC LIMIT ${SCAN}`,
  ).bind(since, floor).all()).results || [];
  const keep = (rows) => rows.map((r) => ({ ...r, rarity: rarityClass(r) })).filter((r) => RARE.includes(r.rarity)).slice(0, RARE_TOP);
  return json({ coverage: keep(coverage), aux: keep(aux), floor, days });
}
