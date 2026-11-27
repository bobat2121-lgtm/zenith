// Lane metrics for the side-by-side report (scripts/lane-report.mjs). Pure:
// no fetch, no D1 handle, nothing from delivery.js or discord.js, and every
// statement in LANE_SQL is a read with a LIMIT. Nothing the Worker bundles
// imports this file; it runs on the integrator's machine only.
//
// It names no source key, ticker or title. Every private value (the Bing key
// list, the pattern check, the rows themselves) arrives as input and every
// result leaves as output, which the script writes outside the repository.
//
// Three lanes: "bing" (the keys of the Bing key file), "widenet" (keys that
// start with WIDENET_PREFIX, the wide-net drain keys) and "rest" (every other
// key). One lag rule for all of them: first seen minus published, in hours.
import { normTitle, canonUrl } from "./story.js";

export const WIDENET_PREFIX = "widenet_";
export const FRESH_H = 168; // a row first seen a week or more after publication is stale
export const SEED_MIN = 60; // rows first seen within this many minutes of a key's seed are seed rows
export const LINK_DAYS = 7; // the soft join and the "another lane had it" test look this far
export const UNIQUE_LEAD_H = 2; // the wide net must lead every other lane by this much
export const JACCARD = 0.5; // title-token overlap for the soft join with a shared ticker
export const JACCARD_UNSCOPED = 0.6; // the same when either side has no ticker
export const MATERIAL = 70; // rubric bands: digest and lead
export const NOTABLE = 40; // borderline and up
export const L1_MIN_N = 30; // fewer L1 rows: P1 is not measurable
export const SUSPECT_MIN = 20; // L1 lags under this many minutes ...
export const SUSPECT_SHARE = 0.5; // ... on more than this share of L1 rows: P1 is suspect

const H = 3_600_000;
const DAY = 86_400_000;
const IGNORED_BANDS = new Set(["duplicate", "covered"]);

// Read-only statements. ?n placeholders are filled by the script's quoting
// function (ISO times, 14-digit file stamps, a universe id or a JSON array of
// keys only); the script checks every filled statement before it runs.
export const LANE_SQL = Object.freeze({
  // Q-Z1 coverage rows, fetched from `from - 7 days` for linking.
  Z1: "SELECT i.id, i.nm_rowid, i.source_key, i.ticker, NULL AS entity_key, i.affects, i.url, i.title, i.published, i.nm_first_seen, i.ingested_at, i.state, i.skip_reason, i.story_key, NULL AS url_key, i.story_of, g.score, g.band, g.dup_of, g.rubric_version FROM items i LEFT JOIN grades g ON g.id = i.grade_id WHERE i.nm_first_seen >= ?1 AND i.nm_first_seen < ?2 AND i.universe_id = ?3 LIMIT 50000",
  // Q-Z2 the same over the Auxiliary pipeline.
  Z2: "SELECT a.id, a.nm_rowid, a.source_key, NULL AS ticker, a.entity_key, a.affects, a.url, a.title, a.published, a.nm_first_seen, a.ingested_at, a.state, a.skip_reason, a.story_key, a.url_key, a.story_of, g.score, g.band, g.dup_of, g.rubric_version FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id WHERE a.nm_first_seen >= ?1 AND a.nm_first_seen < ?2 AND a.universe_id = ?3 LIMIT 50000",
  // Q-N1 (news-monitor-db) Bing-host keys; a cross-check of the key file only.
  N1: "SELECT key FROM source_diagnostics WHERE request_host = 'www.bing.com' LIMIT 500",
  // Q-N2 seeds: the seed table where it has the key, else the key's first row.
  N2_SEEDS: "SELECT key, seeded_at FROM source_seeds WHERE key IN (SELECT value FROM json_each(?1)) LIMIT 2000",
  N2_FIRST: "SELECT source_key, MIN(first_seen) AS first_row FROM items WHERE source_key IN (SELECT value FROM json_each(?1)) GROUP BY source_key LIMIT 2000",
  // Q-N3 Bing polls in the last 60 minutes.
  N3: "SELECT COUNT(*) AS polls_60m FROM source_state s WHERE s.key IN (SELECT key FROM source_diagnostics WHERE request_host = 'www.bing.com') AND s.last_attempt >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 minutes') LIMIT 1",
  // Q-N4a accepted wide-net hits by file stamp, with this universe's target.
  N4A: "SELECT h.url, h.url_norm, h.title, h.entity_key, t.tickers, t.class, t.drain_key, h.published, h.date_exact, h.seen_at, h.status, h.reason, h.dup_of FROM discovery_hits h LEFT JOIN discovery_hit_targets t ON t.hit_id = h.id AND t.universe_id = ?3 WHERE h.status = 'accepted' AND h.file_stamp >= ?1 AND h.file_stamp < ?2 LIMIT 20000",
  // Q-N4r rejected wide-net hits by the time the Worker parsed them.
  N4R: "SELECT url, url_norm, title, entity_key, published, date_exact, seen_at, status, reason, dup_of FROM discovery_hits WHERE status = 'rejected' AND seen_at >= ?1 AND seen_at < ?2 LIMIT 20000",
  // Q-N5 shadow Bing rows (stored by news-monitor, never sent to Zenith).
  N5: "SELECT rowid AS nm_rowid, source_key, url, title, published, first_seen FROM items WHERE source_key IN (SELECT value FROM json_each(?1)) AND first_seen >= ?2 AND first_seen < ?3 LIMIT 2000",
});

// --- Small numeric helpers ---------------------------------------------------
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export function pct(values, p) {
  const xs = values.map(num).filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}
export const median = (values) => pct(values, 0.5);
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const ms = (iso) => {
  if (iso == null || iso === "") return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
};
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
export const toStamp = (iso) => new Date(iso).toISOString().replace(/[-:T]/g, "").slice(0, 14);

// --- Row rules ------------------------------------------------------------------
const firstSeenOf = (row) => row?.first_seen ?? row?.nm_first_seen ?? row?.seen_at ?? null;

// Lag in hours from publication to first seen. null when `published` does not
// parse, sits exactly on UTC midnight (a date without a time), or is more than
// 5 minutes after first seen.
export function lagHours(row) {
  const pub = ms(row?.published), seen = ms(firstSeenOf(row));
  if (pub == null || seen == null) return null;
  const d = new Date(pub);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) return null;
  if (seen - pub < -5 * 60_000) return null;
  return (seen - pub) / H;
}
export const isFresh = (lag) => lag != null && lag < FRESH_H;

// A seed row: first seen within SEED_MIN minutes of its key's seed time (the
// seed table where it has the key, else the key's first row), or a row any
// Zenith copy of which was stored skipped `archive_seed`.
export function isSeed(row, seedByKey) {
  if (row?.archive_seed || row?.skip_reason === "archive_seed") return true;
  const seed = ms(getKey(seedByKey, row?.source_key));
  const seen = ms(firstSeenOf(row));
  return seed != null && seen != null && seen < seed + SEED_MIN * 60_000;
}
function getKey(map, key) {
  if (!map || key == null) return undefined;
  return map instanceof Map ? map.get(key) : map[key];
}

// Ticker lists arrive as a comma list (Zenith `affects`), a slash list (the
// wide-net title tag) or a JSON array (the wide net's targets).
export function parseTickers(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  const s = String(v).trim();
  if (s.startsWith("[")) {
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return parseTickers(a);
    } catch { /* not JSON: fall through */ }
  }
  return s.split(/[\s,/]+/).map((x) => x.trim()).filter(Boolean);
}
const TAG = /^\[([^\]]{1,40})\]/;

// --- The Bing key file and the pattern check ------------------------------------
const KEY = /^[a-z0-9_]+$/;
const tokenOf = (q) => {
  const words = String(q || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  return words.reduce((best, w) => (w.length > best.length ? w : best), "") || null;
};

// The key file written by news-monitor's scripts/bing-export.mjs. Accepted
// shapes: { keys: [...] | {key: {...}}, widenet: [...] }, { sources: [...] }
// or a bare array of entries { key, q, token, affects, role, cadence, lane,
// shadow, stage_state }.
export function parseBingKeys(json) {
  if (json && json.keys instanceof Map) return json;
  const list = Array.isArray(json) ? json
    : Array.isArray(json?.keys) ? json.keys
    : Array.isArray(json?.sources) ? json.sources
    : json?.keys && typeof json.keys === "object" ? Object.entries(json.keys).map(([key, v]) => ({ key, ...v }))
    : null;
  if (!list) throw new Error("bing key file: expected an array of entries or { keys: [...] }");
  const keys = new Map();
  for (const e of list) {
    const key = typeof e === "string" ? e : e?.key;
    if (!KEY.test(String(key ?? ""))) throw new Error(`bing key file: bad key ${JSON.stringify(key)}`);
    const o = typeof e === "string" ? {} : e;
    keys.set(key, {
      key,
      q: o.q ?? null,
      token: (o.token ? String(o.token).toLowerCase() : null) ?? tokenOf(o.q),
      affects: parseTickers(o.affects),
      role: o.role ?? null,
      cadence: o.cadence ?? null,
      lane: o.lane ?? null,
      shadow: Boolean(o.shadow),
      stage_state: o.stage_state ?? null,
    });
  }
  const widenet = (Array.isArray(json?.widenet) ? json.widenet : []).map(String);
  return { keys, widenet };
}

// Stops the report (throws) when a Bing-host key is missing from the key file
// or a wide-net drain key does not carry WIDENET_PREFIX.
export function checkBingKeys(bing, hostKeys = []) {
  const b = parseBingKeys(bing);
  const missing = [...new Set(hostKeys)].filter((k) => !b.keys.has(k));
  if (missing.length) throw new Error(`bing key file is missing ${missing.length} Bing-host key(s): ${missing.join(", ")}`);
  const bad = b.widenet.filter((k) => !String(k).startsWith(WIDENET_PREFIX));
  if (bad.length) throw new Error(`wide-net drain key(s) without the ${WIDENET_PREFIX} prefix: ${bad.join(", ")}`);
  for (const k of b.widenet) if (b.keys.has(k)) throw new Error(`key ${k} is both a Bing key and a wide-net key`);
  return b;
}

// pattern-check.json from news-monitor's scripts/bing-pattern-check.mjs.
// Accepted: { keys: {...} | [...] }, an array of { key, ... } or a map. null in,
// null out (a missing file: no key counts as covered).
export function parsePattern(json) {
  if (json == null) return null;
  if (json instanceof Map) return json;
  const src = Array.isArray(json) ? json : json.keys ?? json;
  const entries = Array.isArray(src) ? src.map((e) => [e?.key, e]) : Object.entries(src);
  const out = new Map();
  for (const [key, v] of entries) if (KEY.test(String(key ?? ""))) out.set(key, { ...v, pattern_covered: v?.pattern_covered === true });
  return out;
}

// --- Lanes --------------------------------------------------------------------
export function laneOf(sourceKey, { bing } = {}) {
  const key = String(sourceKey ?? "");
  const set = bing instanceof Set ? bing : bing?.keys instanceof Map ? bing.keys : bing instanceof Map ? bing : new Set(bing || []);
  const isBing = set.has(key);
  const isWide = key.startsWith(WIDENET_PREFIX);
  if (isBing && isWide) throw new Error(`key ${key} is both a Bing key and a wide-net key`);
  return isBing ? "bing" : isWide ? "widenet" : "rest";
}

// Tickers of one raw row or hit. Coverage: its ticker. Auxiliary: its affects.
// A wide-net row: the leading [A/B] tag of its title, else its hit's tickers.
// A hit: its target's tickers, else its entity's (ctx.entityTickers). A Bing
// row with neither: the Bing key's affects.
export function tickersOf(row, ctx = {}) {
  const out = new Set();
  if (row?.kind === "hit") {
    for (const t of parseTickers(row.tickers)) out.add(t);
    if (!out.size && row.entity_key != null) for (const t of getKey(ctx.entityTickers, row.entity_key) || []) out.add(t);
    return out;
  }
  const key = String(row?.source_key ?? "");
  if (key.startsWith(WIDENET_PREFIX)) {
    const m = TAG.exec(String(row?.title ?? ""));
    if (m) for (const t of parseTickers(m[1])) out.add(t);
    else if (ctx.hitTickers) for (const t of ctx.hitTickers(row)) out.add(t);
    if (out.size) return out;
  }
  if (row?.pipeline === "coverage" || (row?.pipeline == null && row?.ticker)) {
    if (row.ticker) out.add(String(row.ticker));
  } else {
    for (const t of parseTickers(row?.affects)) out.add(t);
  }
  if (!out.size && ctx.bingKeys?.has?.(key)) for (const t of ctx.bingKeys.get(key).affects || []) out.add(t);
  return out;
}

// --- Story linking ----------------------------------------------------------------
// Title tokens for the soft join: normTitle words with three or more letters.
export function titleTokens(title) {
  const out = new Set();
  for (const w of normTitle(title).split(" ")) {
    const t = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (t.replace(/[^a-z]/g, "").length >= 3) out.add(t);
  }
  return out;
}
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

class Sets {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { const x = this.find(a), y = this.find(b); if (x !== y) this.p[Math.max(x, y)] = Math.min(x, y); }
}

function obsOfHit(h) {
  if (h.status === "accepted") return "accepted";
  return h.reason === "dup_collected" ? "dup_collected" : "rejected";
}

// Builds one node per news-monitor row (its Coverage and Auxiliary copies and
// any shadow copy merged by nm_rowid) and one per wide-net hit.
function buildNodes(rows, hits, shadowRows, ctx) {
  const nodes = [];
  const byRowid = new Map();
  const accByCanon = new Map();
  for (const h of hits || []) if (h.status === "accepted") {
    const c = canonUrl(h.url);
    if (!accByCanon.has(c)) accByCanon.set(c, h);
  }
  const tctx = {
    entityTickers: ctx.entityTickers,
    bingKeys: ctx.bing.keys,
    hitTickers: (row) => {
      const h = accByCanon.get(canonUrl(row.url));
      return h ? tickersOf({ ...h, kind: "hit" }, ctx) : [];
    },
  };
  const rowNode = (r, pipeline) => {
    const id = r.nm_rowid ?? `${pipeline}:${r.id}`;
    let n = byRowid.get(id);
    if (!n) {
      const seen = r.nm_first_seen ?? r.first_seen;
      n = {
        kind: "row", nm_rowid: r.nm_rowid ?? null, source_key: r.source_key, lane: laneOf(r.source_key, { bing: ctx.bing }),
        first_seen: seen, t: ms(seen), published: r.published ?? null, ingested_at: r.ingested_at ?? null,
        url: r.url, canon: canonUrl(r.url), title: r.title, tokens: titleTokens(r.title), tickers: new Set(),
        story_keys: new Set(), url_keys: new Set(), cov_ids: new Set(), aux_ids: new Set(), dup_cov: new Set(), dup_aux: new Set(),
        grades: [], pipelines: new Set(), archive_seed: false,
      };
      byRowid.set(id, n);
      nodes.push(n);
    }
    n.pipelines.add(pipeline);
    if (r.skip_reason === "archive_seed") n.archive_seed = true;
    if (r.story_key) n.story_keys.add(r.story_key);
    if (r.url_key) n.url_keys.add(r.url_key);
    if (pipeline === "coverage" && r.id != null) n.cov_ids.add(Number(r.id));
    if (pipeline === "aux" && r.id != null) n.aux_ids.add(Number(r.id));
    if (r.dup_of != null && r.dup_of !== "" && Number.isFinite(Number(r.dup_of))) (pipeline === "aux" ? n.dup_aux : n.dup_cov).add(Number(r.dup_of));
    if (r.band != null || r.score != null) n.grades.push({ score: num(r.score), band: r.band ?? null, rubric_version: r.rubric_version ?? null, pipeline });
    if (n.ingested_at == null && r.ingested_at) n.ingested_at = r.ingested_at;
    for (const t of tickersOf({ ...r, pipeline }, tctx)) n.tickers.add(t);
    return n;
  };
  for (const r of rows || []) rowNode(r, r.pipeline === "aux" ? "aux" : "coverage");
  for (const r of shadowRows || []) rowNode({ ...r, nm_first_seen: r.first_seen }, "shadow");
  const seenHit = new Set();
  for (const h of hits || []) {
    const id = h.url_norm || canonUrl(h.url);
    if (seenHit.has(id)) continue;
    seenHit.add(id);
    nodes.push({
      kind: "hit", obs: obsOfHit(h), status: h.status, reason: h.reason ?? null, dup_of: h.dup_of ?? null,
      first_seen: h.seen_at, t: ms(h.seen_at), published: h.published ?? null, date_exact: Number(h.date_exact) === 1,
      url: h.url, canon: canonUrl(h.url), title: h.title, tokens: titleTokens(h.title),
      tickers: tickersOf({ ...h, kind: "hit" }, ctx), entity_key: h.entity_key ?? null, drain_key: h.drain_key ?? null,
      source_key: h.drain_key ?? null, lane: "widenet",
    });
  }
  return { nodes, accByCanon };
}

// Candidate pairs for the soft join by prefix filtering: under one global
// token order (rarest first), two sets whose overlap reaches JACCARD share a
// token within their first |A| - ceil(JACCARD * |A|) + 1 tokens. Exact, and it
// avoids comparing every pair.
function softCandidates(nodes) {
  const freq = new Map();
  for (const n of nodes) for (const t of n.tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const order = (a, b) => freq.get(a) - freq.get(b) || (a < b ? -1 : a > b ? 1 : 0);
  const index = new Map();
  const pairs = [];
  nodes.forEach((n, i) => {
    const toks = [...n.tokens].sort(order);
    if (!toks.length) return;
    const prefix = toks.slice(0, toks.length - Math.ceil(JACCARD * toks.length) + 1);
    const seen = new Set();
    for (const t of prefix) for (const j of index.get(t) || []) if (!seen.has(j)) { seen.add(j); pairs.push([j, i]); }
    for (const t of prefix) { if (!index.has(t)) index.set(t, []); index.get(t).push(i); }
  });
  return pairs;
}

const bingToken = (n, ctx) => (n.kind === "row" && n.lane === "bing" ? ctx.bing.keys.get(n.source_key)?.token || null : null);

// The soft rule: first seen within LINK_DAYS of each other, and either a
// shared ticker with title overlap JACCARD or more, or (when either side has
// no ticker) overlap JACCARD_UNSCOPED or more with each Bing side's query
// token present in the other side's title.
export function softJoin(a, b, ctx) {
  if (a.t == null || b.t == null || Math.abs(a.t - b.t) > LINK_DAYS * DAY) return false;
  const j = jaccard(a.tokens, b.tokens);
  if (a.tickers.size && b.tickers.size) {
    for (const t of a.tickers) if (b.tickers.has(t)) return j >= JACCARD;
    return false;
  }
  if (j < JACCARD_UNSCOPED) return false;
  const ta = bingToken(a, ctx), tb = bingToken(b, ctx);
  if (ta && !b.tokens.has(ta)) return false;
  if (tb && !a.tokens.has(tb)) return false;
  return true;
}

// Clusters of nodes that tell one story. Joins: the same story_key, url_key or
// canonical URL (how a dup_collected hit meets the row it duplicates), a
// grade's dup_of naming the other row's id in the same pipeline (coverage
// dup_of is TEXT, Auxiliary INTEGER, so both are compared as numbers), or the
// soft rule above.
export function linkStories(nodes, ctx) {
  const s = new Sets(nodes.length);
  const by = (keyFn) => {
    const first = new Map();
    nodes.forEach((n, i) => {
      for (const k of keyFn(n)) {
        if (k == null || k === "") continue;
        if (first.has(k)) s.union(first.get(k), i);
        else first.set(k, i);
      }
    });
  };
  by((n) => [...(n.story_keys || [])].map((k) => `s|${k}`));
  by((n) => [...(n.url_keys || [])].map((k) => `u|${k}`));
  by((n) => (n.canon ? [`c|${n.canon}`] : []));
  const covIdx = new Map(), auxIdx = new Map();
  nodes.forEach((n, i) => {
    for (const id of n.cov_ids || []) covIdx.set(id, i);
    for (const id of n.aux_ids || []) auxIdx.set(id, i);
  });
  nodes.forEach((n, i) => {
    for (const d of n.dup_cov || []) if (covIdx.has(d)) s.union(covIdx.get(d), i);
    for (const d of n.dup_aux || []) if (auxIdx.has(d)) s.union(auxIdx.get(d), i);
  });
  for (const [i, j] of softCandidates(nodes)) if (s.find(i) !== s.find(j) && softJoin(nodes[i], nodes[j], ctx)) s.union(i, j);
  const out = new Map();
  nodes.forEach((n, i) => {
    const r = s.find(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(n);
  });
  return [...out.values()];
}

// The clusters of raw inputs (as report() builds them), for inspection.
export function clusterRows(rows, hits = [], shadowRows = [], opts = {}) {
  const ctx = { bing: parseBingKeys(opts.bing ?? []), entityTickers: new Map(Object.entries(opts.entityTickers || {})) };
  return linkStories(buildNodes(rows, hits, shadowRows, ctx).nodes, ctx);
}

// The best grader score of a cluster, ignoring `duplicate` and `covered`
// grades, with that grade's rubric_version. Owner scores are never read.
export function storyScore(cluster) {
  let best = null;
  for (const n of cluster) for (const g of n.grades || []) {
    if (g.score == null || IGNORED_BANDS.has(g.band)) continue;
    if (!best || g.score > best.score) best = { score: g.score, rubric_version: g.rubric_version, pipeline: g.pipeline };
  }
  return best;
}

// --- The report -------------------------------------------------------------------
function laneStats(rows) {
  const post = rows.filter((n) => !n.seed);
  const dated = post.filter((n) => n.lag != null);
  const fresh = dated.filter((n) => isFresh(n.lag));
  const lags = fresh.map((n) => n.lag);
  return {
    rows: rows.length, post_seed: post.length, dated: dated.length, fresh: fresh.length,
    stale_share: dated.length ? round((dated.length - fresh.length) / dated.length, 4) : null,
    lag_median_h: round(median(lags)), lag_p25_h: round(pct(lags, 0.25)), lag_p90_h: round(pct(lags, 0.9)),
    under_2h: fresh.filter((n) => n.lag < 2).length,
  };
}
const earliest = (xs) => xs.reduce((a, b) => (a == null || (b.t != null && b.t < a.t) ? b : a), null);
const within = (a, b, days) => a.t != null && b.t != null && Math.abs(a.t - b.t) <= days * DAY;

// One cluster's observations by lane. A wide-net hit whose URL is already a
// wide-net Zenith row is not counted twice: the row (at nm_first_seen) stands
// for it.
function observe(cluster) {
  const rows = cluster.filter((n) => n.kind === "row");
  const bing = rows.filter((n) => n.lane === "bing");
  const rest = rows.filter((n) => n.lane === "rest");
  const wideRows = rows.filter((n) => n.lane === "widenet");
  const wideCanon = new Set(wideRows.map((n) => n.canon));
  const hits = cluster.filter((n) => n.kind === "hit");
  const accepted = [...wideRows, ...hits.filter((h) => h.obs === "accepted" && !wideCanon.has(h.canon))];
  const dup = hits.filter((h) => h.obs === "dup_collected");
  const rejected = hits.filter((h) => h.obs === "rejected");
  return { bing, rest, accepted, dup, rejected };
}

// report(rows, hits, shadowRows, opts) -> the side-by-side JSON.
//   rows       Zenith rows of Q-Z1 and Q-Z2, each with pipeline "coverage" or "aux"
//   hits       wide-net hits of Q-N4a and Q-N4r (both statuses)
//   shadowRows Q-N5 rows of shadow Bing keys
//   opts       { from, to, bing (the key file), seedByKey, pattern (the pattern
//              check or null), entityTickers?, maxHourly?, maxPerHour?, samplePool? }
export function report(rows, hits, shadowRows, opts = {}) {
  const from = ms(opts.from), to = ms(opts.to);
  if (from == null || to == null || !(from < to)) throw new Error("report: from and to must be times with from < to");
  const bing = parseBingKeys(opts.bing ?? []);
  const pattern = parsePattern(opts.pattern ?? null);
  const seedByKey = opts.seedByKey ?? new Map();
  const entityTickers = new Map(opts.entityTickers instanceof Map ? opts.entityTickers : Object.entries(opts.entityTickers || {}));
  for (const h of hits || []) if (h.status === "accepted" && h.entity_key != null) {
    const list = parseTickers(h.tickers);
    if (!list.length) continue;
    const set = new Set(entityTickers.get(h.entity_key) || []);
    for (const t of list) set.add(t);
    entityTickers.set(h.entity_key, [...set]);
  }
  const ctx = { bing, entityTickers };
  const { nodes } = buildNodes(rows, hits, shadowRows, ctx);
  const inWin = (n) => n.t != null && n.t >= from && n.t < to;

  for (const n of nodes) {
    n.lag = lagHours(n);
    n.fresh = isFresh(n.lag);
    if (n.kind === "row") n.seed = isSeed(n, seedByKey);
    else n.seed = n.obs === "accepted" ? isSeed({ source_key: n.drain_key, first_seen: n.first_seen }, seedByKey) : false;
  }
  const clusters = linkStories(nodes, ctx);
  const info = new Map();
  for (const c of clusters) {
    const o = observe(c);
    const sc = storyScore(c);
    const tickers = new Set();
    for (const n of c) for (const t of n.tickers) tickers.add(t);
    const meta = { ...o, score: sc, tickers };
    for (const n of c) info.set(n, meta);
  }

  // Lanes: one row per news-monitor row first seen in the window.
  const winRows = nodes.filter((n) => n.kind === "row" && inWin(n));
  const lanes = {};
  for (const lane of ["bing", "widenet", "rest"]) lanes[lane] = laneStats(winRows.filter((n) => n.lane === lane));

  // L1: fresh post-seed wide-net rows whose URL has an accepted hit with an
  // exact GAL date (so GDELT's own first-seen stamp never passes as a date).
  const exactCanon = new Set(nodes.filter((n) => n.kind === "hit" && n.obs === "accepted" && n.date_exact).map((n) => n.canon));
  const wideFresh = winRows.filter((n) => n.lane === "widenet" && !n.seed && n.fresh);
  const l1Rows = wideFresh.filter((n) => exactCanon.has(n.canon));
  const l1 = l1Rows.map((n) => n.lag);
  const l1Ingested = l1Rows.map((n) => lagHours({ published: n.published, first_seen: n.ingested_at })).filter((v) => v != null);
  const l5 = nodes.filter((n) => n.kind === "hit" && n.obs === "accepted" && n.date_exact && inWin(n)).map((n) => n.lag).filter((v) => v != null);
  const under = l1.filter((v) => v < SUSPECT_MIN / 60).length;
  const l1Median = median(l1);
  const P1 = l1.length < L1_MIN_N ? "not_measurable" : under / l1.length > SUSPECT_SHARE ? "suspect" : l1Median < 2 ? "pass" : "fail";
  const L1 = {
    n: l1.length, median_h: round(l1Median), p25_h: round(pct(l1, 0.25)), p90_h: round(pct(l1, 0.9)),
    under_20m: under, date_exact_share: wideFresh.length ? round(l1Rows.length / wideFresh.length, 4) : null,
    L5_median_h: round(median(l5)), L5_n: l5.length, L1_ingested_median_h: round(median(l1Ingested)), P1,
  };
  if (opts.samplePool) L1.sample_pool = l1Rows.map((n) => ({ url: n.url, published: n.published }));

  // new_material_unique, wide_net_first and the beside lines.
  const winDays = Math.max(1, Math.ceil((to - from) / DAY));
  const nmu = { total: 0, by_day: {}, by_rubric: {}, coverage: 0, aux: 0 };
  const first = { total: 0, by_day: {} };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const c of clusters) {
    const m = info.get(c[0]);
    if (!m.score || m.score.score < MATERIAL) continue;
    const e = earliest(m.accepted);
    if (!e || !inWin(e) || e.seed || !e.fresh) continue;
    // A dup_collected hit says another source held its URL by then: it bounds
    // the other lanes too.
    const others = [...m.bing, ...m.rest, ...m.dup].filter((o) => o.t != null);
    const day = dayOf(e.t);
    if (others.every((o) => e.t < o.t)) { first.total++; bump(first.by_day, day); }
    if (others.every((o) => e.t <= o.t - UNIQUE_LEAD_H * H)) {
      nmu.total++;
      bump(nmu.by_day, day);
      bump(nmu.by_rubric, m.score.rubric_version ?? "unknown");
      nmu[m.score.pipeline === "aux" ? "aux" : "coverage"]++;
    }
  }
  // rubric_version segments: the UTC days on which window rows carry grades of
  // that version (first to last day, inclusive).
  const span = new Map();
  for (const n of winRows) for (const g of n.grades) {
    if (g.rubric_version == null) continue;
    const d = Math.floor(n.t / DAY);
    const s = span.get(g.rubric_version) || [d, d];
    span.set(g.rubric_version, [Math.min(s[0], d), Math.max(s[1], d)]);
  }
  const segments = [...span.entries()].sort((a, b) => a[1][0] - b[1][0]).map(([v, [a, b]]) => {
    const days = b - a + 1, n = nmu.by_rubric[v] || 0;
    return { rubric_version: v, days, n, per_day: round(n / days), gated: days >= 5 };
  });
  const P2 = nmu.total >= winDays && segments.every((s) => !s.gated || s.n / s.days >= 1) ? "pass" : "fail";
  const new_material_unique = { ...nmu, days: winDays, per_day_mean: round(nmu.total / winDays), segments, P2 };

  // Beside lines: Part A's Coverage-only count (wide-net Coverage rows graded
  // MATERIAL+ by day), Auxiliary MATERIAL+ wide-net rows, and the rest lane's.
  const beside = { widenet_coverage_material_by_day: {}, widenet_aux_material: 0, rest_material: 0 };
  for (const n of winRows) for (const g of n.grades) {
    if (g.score == null || g.score < MATERIAL || IGNORED_BANDS.has(g.band)) continue;
    if (n.lane === "widenet" && g.pipeline === "coverage") bump(beside.widenet_coverage_material_by_day, dayOf(n.t));
    if (n.lane === "widenet" && g.pipeline === "aux") beside.widenet_aux_material++;
    if (n.lane === "rest") beside.rest_material++;
  }

  // L2 head to head: clusters with a Bing row in the window and a wide-net
  // accepted (or else dup_collected) observation.
  const h2h = { accepted: [], dup_collected: [] };
  for (const c of clusters) {
    const m = info.get(c[0]);
    const b = earliest(m.bing);
    if (!b || !inWin(b)) continue;
    const a = earliest(m.accepted), d = earliest(m.dup);
    if (a) h2h.accepted.push((a.t - b.t) / H);
    else if (d) h2h.dup_collected.push((d.t - b.t) / H);
  }
  const pair = (xs) => ({ n: xs.length, median_h: round(median(xs)), earlier_share: xs.length ? round(xs.filter((x) => x < 0).length / xs.length, 4) : null });
  const accPair = pair(h2h.accepted);
  const head_to_head = { accepted: accPair, dup_collected: pair(h2h.dup_collected), all: pair([...h2h.accepted, ...h2h.dup_collected]), P4: accPair.n ? (accPair.median_h <= 0 ? "pass" : "flag") : "not_measurable" };

  // Reject reasons per UTC day: the days the open-entity breaker capped.
  const capDays = new Set(nodes.filter((n) => n.kind === "hit" && n.obs === "rejected" && n.reason === "cap_open_daily" && n.t != null).map((n) => dayOf(n.t)));

  // A Bing row is "alone" when no rest row, wide-net accepted observation or
  // dup_collected hit of its cluster is within LINK_DAYS of it.
  const alone = (b) => {
    const m = info.get(b);
    return ![...m.rest, ...m.accepted, ...m.dup].some((o) => within(o, b, LINK_DAYS));
  };
  const bing_only_material = [];
  for (const c of clusters) {
    const m = info.get(c[0]);
    if (!m.score || m.score.score < MATERIAL) continue;
    const b = earliest(m.bing.filter((n) => inWin(n) && !n.seed && n.fresh));
    if (!b || !alone(b)) continue;
    const rej = earliest(m.rejected);
    bing_only_material.push({
      key: b.source_key, tickers: [...m.tickers].sort(), title: b.title, score: m.score.score, first_seen: b.first_seen,
      in_rejects: rej ? rej.reason : "not_seen", cap_hit_day: capDays.has(dayOf(b.t)),
    });
  }
  bing_only_material.sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)) || a.key.localeCompare(b.key));

  // per_bing_key: F = fresh post-seed rows of the key that are alone.
  const per_bing_key = {};
  for (const [key, def] of bing.keys) {
    const mine = winRows.filter((n) => n.lane === "bing" && n.source_key === key);
    const post = mine.filter((n) => !n.seed);
    const F = post.filter((n) => n.fresh && alone(n));
    const cl = new Set(F.map((n) => info.get(n)));
    const scored = (min) => (def.shadow ? null : [...cl].filter((m) => m.score && m.score.score >= min).length);
    const pc = pattern ? pattern.get(key)?.pattern_covered === true : false;
    per_bing_key[key] = {
      rows: mine.length, post_seed: post.length, F: F.length, U40: scored(NOTABLE), U70: scored(MATERIAL),
      lag_median_h: round(median(F.map((n) => n.lag))), pattern_covered: pc,
      bing_only_material: bing_only_material.filter((x) => x.key === key).length,
      cadence: def.cadence, shadow: def.shadow,
    };
  }
  const stage_plan = stagePlan(Object.entries(per_bing_key).map(([key, v]) => ({ key, ...v })), { maxHourly: opts.maxHourly, maxPerHour: opts.maxPerHour });
  for (const [key, v] of Object.entries(per_bing_key)) v.verdict = stage_plan.verdict[key];

  // per_name: tickers, or `key:<bing key>` for a Bing row with no ticker.
  const acc = new Map();
  const nm = (name) => {
    if (!acc.has(name)) acc.set(name, { bing_fresh: 0, widenet_fresh: 0, bing_only_material: 0, bl: [], wl: [], bm: new Set(), wm: new Set() });
    return acc.get(name);
  };
  for (const n of winRows.filter((x) => x.lane === "bing" && !x.seed && x.fresh)) {
    const names = n.tickers.size ? [...n.tickers] : [`key:${n.source_key}`];
    const m = info.get(n);
    for (const name of names) {
      const p = nm(name);
      p.bing_fresh++; p.bl.push(n.lag);
      if (m.score && m.score.score >= MATERIAL) p.bm.add(m);
    }
  }
  for (const n of nodes.filter((x) => inWin(x) && !x.seed && x.fresh && x.lane === "widenet" && (x.kind === "row" || x.obs === "accepted"))) {
    const m = info.get(n);
    if (n.kind === "hit" && m.accepted.indexOf(n) < 0) continue;
    for (const name of n.tickers) {
      const p = nm(name);
      p.widenet_fresh++; p.wl.push(n.lag);
      if (m.score && m.score.score >= MATERIAL) p.wm.add(m);
    }
  }
  for (const x of bing_only_material) for (const name of x.tickers.length ? x.tickers : [`key:${x.key}`]) nm(name).bing_only_material++;
  const per_name = {};
  for (const [name, p] of [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    per_name[name] = {
      bing_fresh: p.bing_fresh, widenet_fresh: p.widenet_fresh, bing_material: p.bm.size, widenet_material: p.wm.size,
      bing_only_material: p.bing_only_material, bing_lag_median_h: round(median(p.bl)), widenet_lag_median_h: round(median(p.wl)),
    };
  }

  const rubric_versions = [...new Set(winRows.flatMap((n) => n.grades.map((g) => g.rubric_version)).filter((v) => v != null))].sort();
  const widenet_keys = [...new Set(winRows.filter((n) => n.lane === "widenet").map((n) => n.source_key))].sort();
  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days: winDays },
    widenet_data: (hits || []).length > 0,
    lanes, L1, new_material_unique, wide_net_first: first, beside, head_to_head,
    bing_only_material, per_name, per_bing_key, stage_plan,
    cap_hit_days: [...capDays].sort(), rubric_versions, widenet_keys,
    verdict: { P1, P2, P3: "manual", P4: head_to_head.P4 },
  };
}

// --- Stage plan (news-monitor's Bing stage 1) ------------------------------------
const CADENCE = { fast: 8, hourly: 60, twice: 120, sixhourly: 360, six_hourly: 360, "six-hourly": 360, daily: 1440 };
export function cadenceMinutes(c) {
  if (typeof c === "number" && c > 0) return c;
  return CADENCE[String(c ?? "").toLowerCase()] ?? 60;
}

// keep/retire per Bing key. Must keep: a key with a Bing-only MATERIAL story,
// a key whose subject the wide net cannot match (pattern_covered false, which
// is every key when the pattern check is missing), or a graded key with an
// unobserved NOTABLE story (U40 > 0). If those need more than maxHourly hourly
// slots the integrator asks the owner. Otherwise six-hourly keys with F > 0
// stay (not shadow keys), and the hourly slots fill by rank: U70, U40, F, the
// shorter median lag, then key. Shadow keys are kept only as a must (pattern
// gap) or as a filler.
export function stagePlan(perKey, { maxHourly = 18, maxPerHour = 20 } = {}) {
  maxHourly ??= 18; maxPerHour ??= 20;
  const list = (Array.isArray(perKey) ? perKey : Object.entries(perKey).map(([key, v]) => ({ key, ...v }))).slice();
  const mins = (k) => cadenceMinutes(k.cadence_min ?? k.cadence);
  const hourly = (k) => mins(k) <= 60;
  const verdict = {};
  const must = list.filter((k) => (k.bing_only_material || 0) > 0 || k.pattern_covered !== true || (!k.shadow && (k.U40 || 0) > 0));
  for (const k of must) verdict[k.key] = "keep:must";
  const mustHourly = must.filter(hourly).length;
  const rest = list.filter((k) => !verdict[k.key]);
  let status = "ok";
  if (mustHourly > maxHourly) {
    status = "ask_owner";
  } else {
    for (const k of rest) if (!hourly(k) && !k.shadow && (k.F || 0) > 0) verdict[k.key] = "keep:six_hourly";
    const rank = (a, b) => (b.U70 ?? -1) - (a.U70 ?? -1) || (b.U40 ?? -1) - (a.U40 ?? -1) || (b.F || 0) - (a.F || 0)
      || (a.lag_median_h ?? Infinity) - (b.lag_median_h ?? Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const fill = rest.filter((k) => hourly(k) && !verdict[k.key]).sort(rank).slice(0, maxHourly - mustHourly);
    for (const k of fill) verdict[k.key] = "keep:fill";
  }
  for (const k of list) verdict[k.key] ||= "retire";
  const keep = list.filter((k) => verdict[k.key] !== "retire");
  const perHour = keep.reduce((s, k) => s + 60 / mins(k), 0);
  if (status === "ok" && !(perHour < maxPerHour)) status = "over_budget";
  return {
    status, verdict, keep: keep.map((k) => k.key).sort(), retire: list.filter((k) => verdict[k.key] === "retire").map((k) => k.key).sort(),
    must_keep: must.map((k) => k.key).sort(), hourly: keep.filter(hourly).length, per_hour: round(perHour, 2), max_hourly: maxHourly, max_per_hour: maxPerHour,
  };
}

// --- L3 helpers (the opt-in publication-time sample) ----------------------------
// The publication time an article page states: article:published_time, then
// JSON-LD datePublished, then the first <time datetime>. null if none parses.
export function pagePublished(html) {
  const s = String(html || "");
  const cands = [];
  const meta = /<meta\b[^>]*>/gi;
  for (const m of s.matchAll(meta)) {
    const tag = m[0];
    if (/(property|name)\s*=\s*["']article:published_time["']/i.test(tag)) {
      const c = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (c) cands.push(c[1]);
    }
  }
  const ld = /"datePublished"\s*:\s*"([^"]+)"/i.exec(s);
  if (ld) cands.push(ld[1]);
  const tm = /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i.exec(s);
  if (tm) cands.push(tm[1]);
  for (const c of cands) {
    const t = ms(c);
    if (t != null) return new Date(t).toISOString();
  }
  return null;
}

// Whether robots.txt lets `agent` read `path`: the group naming the agent,
// else the `*` group; the longest matching rule wins, Allow on a tie; `*` and
// a trailing `$` are honoured.
export function robotsAllows(txt, path, agent = "zenith-lag-check") {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (cur && (field === "allow" || field === "disallow")) {
      cur.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const a = agent.toLowerCase();
  const group = groups.find((g) => g.agents.some((x) => x !== "*" && a.includes(x))) || groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (r.pattern === "") continue;
    const anchored = r.pattern.endsWith("$");
    const body = (anchored ? r.pattern.slice(0, -1) : r.pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    if (!new RegExp(`^${body}${anchored ? "$" : ""}`).test(path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}
