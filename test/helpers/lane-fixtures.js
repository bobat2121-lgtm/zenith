// Synthetic fixtures for the lane report (worker/src/lane-metrics.js and
// scripts/lane-report.mjs). Every key, ticker, title and URL here is made up
// (keys bing_acme, widenet_x, acme_ir; tickers TST, UVW; example.com URLs);
// times sit in 2030 at 17 minutes past the hour, so no published time is a bare date.
import { DatabaseSync } from "node:sqlite";

export const BASE = Date.parse("2030-03-01T00:17:00.000Z");
const H = 3_600_000;
// The ISO time `h` hours after BASE (fractions allowed).
export const T = (h) => new Date(BASE + h * H).toISOString();
export const FROM = T(0), TO = T(14 * 24);

let rowid = 5000, zid = 100;
export function resetIds() { rowid = 5000; zid = 100; }

// A Zenith Coverage row as Q-Z1 returns it. `seen`/`pub` in hours after BASE.
export function cov({ seen = 10, pub = seen - 1, key = "acme_ir", ticker = "TST", title = "Acme opens a new plant in Northland", url, score = null, band, rubric = "r1", ...over } = {}) {
  const id = over.id ?? zid++;
  const nm = over.nm_rowid ?? rowid++;
  return {
    pipeline: "coverage", id, nm_rowid: nm, source_key: key, ticker, entity_key: null, affects: null,
    url: url ?? `https://example.com/c/${nm}`, title, published: pub == null ? null : T(pub), nm_first_seen: T(seen), ingested_at: T(seen + 0.1),
    state: score == null ? "pending" : "graded", skip_reason: null, story_key: null, url_key: null, story_of: null,
    score, band: band ?? bandOf(score), dup_of: null, rubric_version: score == null ? null : rubric, ...over,
  };
}
// A Zenith Auxiliary row as Q-Z2 returns it.
export function aux({ seen = 10, pub = seen - 1, key = "bing_acme", entity = key, affects = "UVW", title = "Acme opens a new plant in Northland", url, score = null, band, rubric = "r1", ...over } = {}) {
  const id = over.id ?? zid++;
  const nm = over.nm_rowid ?? rowid++;
  return {
    pipeline: "aux", id, nm_rowid: nm, source_key: key, ticker: null, entity_key: entity, affects,
    url: url ?? `https://example.com/a/${nm}`, title, published: pub == null ? null : T(pub), nm_first_seen: T(seen), ingested_at: T(seen + 0.1),
    state: score == null ? "pending" : "graded", skip_reason: null, story_key: null, url_key: null, story_of: null,
    score, band: band ?? bandOf(score), dup_of: null, rubric_version: score == null ? null : rubric, ...over,
  };
}
// A Q-N5 shadow row (news-monitor only).
export function shadowRow({ seen = 10, pub = seen - 1, key = "bing_shadow", title = "Northland drone rules change again", url, ...over } = {}) {
  const nm = over.nm_rowid ?? rowid++;
  return { nm_rowid: nm, source_key: key, url: url ?? `https://example.com/s/${nm}`, title, published: pub == null ? null : T(pub), first_seen: T(seen), ...over };
}
// A wide-net hit as Q-N4a (accepted) or Q-N4r (rejected) returns it.
export function hit({ seen = 10, pub = seen - 1, status = "accepted", reason = null, url, title = "Acme opens a new plant in Northland", tickers = "TST", entity = "acme", exact = 1, drain = "widenet_x", dupOf = null, ...over } = {}) {
  const u = url ?? `https://example.com/h/${rowid++}`;
  return {
    url: u, url_norm: u.replace(/^https?:\/\/(www\.)?/, ""), title, entity_key: entity,
    tickers: status === "accepted" ? tickers : undefined, class: status === "accepted" ? "covered" : undefined, drain_key: status === "accepted" ? drain : undefined,
    published: pub == null ? null : T(pub), date_exact: exact, seen_at: T(seen), status, reason, dup_of: dupOf, ...over,
  };
}
export function bandOf(score) {
  if (score == null) return null;
  return score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
}
// A Bing key file (the shape news-monitor's bing-export.mjs writes).
export function bingFile(entries = [{ key: "bing_acme", q: "\"Acme Robotics\" contract", affects: ["UVW"], cadence: "hourly" }], widenet = ["widenet_x"]) {
  return { keys: entries, widenet };
}

// --- news-monitor-db stand-in -----------------------------------------------------
// The columns the report reads: news-monitor's items, source_state,
// source_diagnostics and source_seeds, and the wide-net tables as the
// wide-net Worker creates them.
export const NEWS_DDL = `
CREATE TABLE items (source_key TEXT NOT NULL, url TEXT NOT NULL, title TEXT, published TEXT, category TEXT, first_seen TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_key, url));
CREATE INDEX idx_items_notified ON items (notified, first_seen);
CREATE TABLE source_state (key TEXT PRIMARY KEY, last_polled TEXT, last_ok TEXT, last_attempt TEXT, next_poll_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT);
CREATE TABLE source_diagnostics (key TEXT PRIMARY KEY, polled_at TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, raw_count INTEGER,
  kept_count INTEGER, excluded_reasons TEXT, requests INTEGER, request_url TEXT, final_url TEXT, request_host TEXT, final_host TEXT,
  status INTEGER, content_type TEXT, not_modified INTEGER, html_feed INTEGER, redirected_host INTEGER, last_full_at TEXT, all_excluded_since TEXT);
CREATE TABLE source_seeds (key TEXT PRIMARY KEY, seeded_at TEXT NOT NULL, stored INTEGER NOT NULL DEFAULT 0, recent INTEGER NOT NULL DEFAULT 0,
  undated INTEGER NOT NULL DEFAULT 0);
`;
export const WIDE_NET_DDL = `
CREATE TABLE discovery_hits (id INTEGER PRIMARY KEY, url_norm TEXT NOT NULL UNIQUE, url TEXT NOT NULL, provider TEXT NOT NULL,
  file_stamp TEXT NOT NULL, seen_at TEXT NOT NULL, published TEXT, date_exact INTEGER NOT NULL DEFAULT 0, lang TEXT, domain TEXT,
  title TEXT NOT NULL, descr TEXT, entity_key TEXT, also TEXT, covered_any INTEGER NOT NULL DEFAULT 0, matched TEXT, mode TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted','rejected')), reason TEXT, dup_of TEXT,
  signals TEXT CHECK (signals IS NULL OR json_valid(signals)), story_fp TEXT, matcher TEXT NOT NULL);
CREATE INDEX idx_dh_rej_seen ON discovery_hits (seen_at) WHERE status = 'rejected';
CREATE INDEX idx_dh_acc_stamp ON discovery_hits (file_stamp) WHERE status = 'accepted';
CREATE INDEX idx_dh_acc_entity ON discovery_hits (entity_key, file_stamp) WHERE status = 'accepted';
CREATE INDEX idx_dh_acc_alias ON discovery_hits (matched, file_stamp) WHERE status = 'accepted';
CREATE TABLE discovery_hit_targets (hit_id INTEGER NOT NULL, universe_id TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('covered','rival','theme')), tickers TEXT NOT NULL, drain_key TEXT NOT NULL, emitted_at TEXT,
  PRIMARY KEY (hit_id, universe_id)) WITHOUT ROWID;
CREATE INDEX idx_dht_pending ON discovery_hit_targets (drain_key, hit_id) WHERE emitted_at IS NULL;
`;
export function laneNewsDb({ wideNet = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(NEWS_DDL);
  if (wideNet) db.exec(WIDE_NET_DDL);
  return db;
}
const stampOf = (iso) => iso.replace(/[-:T]/g, "").slice(0, 14);
// Stores one hit() row (and its target for `universe`) in the stand-in.
export function storeHit(db, h, universe = "u1") {
  const r = db.prepare(`INSERT INTO discovery_hits (url_norm, url, provider, file_stamp, seen_at, published, date_exact, domain, title, entity_key, status, reason, dup_of, matcher)
    VALUES (?, ?, 'gdelt_gal', ?, ?, ?, ?, 'example.com', ?, ?, ?, ?, ?, 'fb:test/wn2')`)
    .run(h.url_norm, h.url, stampOf(h.seen_at), h.seen_at, h.published, h.date_exact, h.title, h.entity_key, h.status, h.reason, h.dup_of);
  if (h.status === "accepted") {
    db.prepare("INSERT INTO discovery_hit_targets (hit_id, universe_id, class, tickers, drain_key) VALUES (?, ?, ?, ?, ?)")
      .run(Number(r.lastInsertRowid), universe, h.class || "covered", h.tickers, h.drain_key);
  }
}

// --- zenith-db rows (on test/helpers/worker-env.js zenithDb()) ------------------
// Stores one cov()/aux() row and its grade, keeping the ids it carries.
export function storeZenith(d1, r, universe = "u1") {
  const db = d1.db;
  if (r.pipeline === "coverage") {
    db.prepare(`INSERT INTO items (id, nm_rowid, source_key, ticker, url, title, published, nm_first_seen, ingested_at, state, skip_reason, affects, universe_id, story_key, story_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.nm_rowid, r.source_key, r.ticker, r.url, r.title, r.published, r.nm_first_seen, r.ingested_at, r.state, r.skip_reason, r.affects, universe, r.story_key, r.story_of);
    if (r.score != null || r.band) {
      const g = db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, read_source, confidence, flags, graded_at, dup_of, universe_id)
        VALUES (?, ?, 'run-1', ?, 'm', ?, ?, 'why', 1, 0.8, '[]', ?, ?, ?)`).run(r.id, r.ticker, r.rubric_version || "r1", r.score, r.band, r.ingested_at, r.dup_of, universe);
      db.prepare("UPDATE items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), r.id);
    }
  } else {
    db.prepare(`INSERT INTO aux_items (id, nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, skip_reason, affects, universe_id, story_key, url_key, story_of)
      VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.nm_rowid, r.source_key, r.entity_key, r.entity_key, r.url, r.title, r.published, r.nm_first_seen, r.ingested_at, r.state, r.skip_reason, r.affects, universe, r.story_key, r.url_key, r.story_of);
    if (r.score != null || r.band) {
      const g = db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, flags, dup_of, rubric_version, model, graded_at, universe_id)
        VALUES (?, 'run-1', ?, ?, ?, '[]', ?, ?, 'm', ?, ?)`).run(r.id, r.entity_key, r.score, r.band, r.dup_of, r.rubric_version || "r1", r.ingested_at, universe);
      db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), r.id);
    }
  }
}
