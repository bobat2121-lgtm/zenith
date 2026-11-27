// Phase 5 P5C-C1 tests Z-C11 and Z-C12: the lane report's statements run on
// node:sqlite copies of both databases and use the planned indexes.
// zenith-db: every migration applied (test/helpers/worker-env.js zenithDb()).
// news-monitor-db: the columns the report reads plus the wide-net tables as
// the wide-net Worker creates them (test/helpers/lane-fixtures.js).
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb } from "./helpers/worker-env.js";
import { T, cov, aux, hit, laneNewsDb, storeHit, storeZenith } from "./helpers/lane-fixtures.js";

hookJsonImports();
const { LANE_SQL, toStamp } = await import("../worker/src/lane-metrics.js");
const { bindSql } = await import("../scripts/lane-report.mjs");

const plan = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
const SCAN_ROWS = /^SCAN (items|aux_items|grades|aux_grades|discovery_hits|discovery_hit_targets|i|a|g|h|t)\b/;

test("Z-C11: Q-Z1 and Q-Z2 return the fixture rows, honour universe_id and the [from - 7 days, to) window", () => {
  const d1 = zenithDb();
  const inside = [cov({ seen: 10, score: 75 }), aux({ seen: 12, score: 50 }), cov({ seen: -100, title: "Lookback row" })];
  for (const r of inside) storeZenith(d1, r);
  storeZenith(d1, cov({ seen: 11, title: "Other universe" }), "u2");
  storeZenith(d1, aux({ seen: 13, title: "Other universe aux" }), "u2");
  storeZenith(d1, cov({ seen: -200, title: "Before the lookback" }));
  storeZenith(d1, aux({ seen: 400, title: "After the window" }));
  const args = [T(-7 * 24), T(14 * 24), "u1"];
  const covRows = d1.db.prepare(bindSql(LANE_SQL.Z1, args)).all();
  const auxRows = d1.db.prepare(bindSql(LANE_SQL.Z2, args)).all();
  assert.deepEqual(covRows.map((r) => r.title).sort(), ["Acme opens a new plant in Northland", "Lookback row"]);
  assert.deepEqual(auxRows.map((r) => r.title), ["Acme opens a new plant in Northland"]);
  const graded = covRows.find((r) => r.score != null);
  assert.deepEqual([graded.score, graded.band, graded.rubric_version, graded.url_key], [75, "digest", "r1", null]);
  assert.equal(auxRows[0].score, 50);
  assert.equal(auxRows[0].entity_key, "bing_acme");
  assert.equal(d1.db.prepare(bindSql(LANE_SQL.Z1, [T(-7 * 24), T(14 * 24), "u2"])).all().length, 1, "a u2 row is never returned for u1");
});

test("Z-C12: Q-Z1 searches idx_items_seen, Q-Z2 aux_items_seen; grades by primary key; no row table scanned", () => {
  const d1 = zenithDb();
  const args = [T(-7 * 24), T(14 * 24), "u1"];
  const p1 = plan(d1.db, bindSql(LANE_SQL.Z1, args));
  assert.ok(p1.some((d) => /^SEARCH i USING INDEX idx_items_seen \(nm_first_seen>\? AND nm_first_seen<\?\)/.test(d)), p1.join(" | "));
  assert.ok(p1.some((d) => /^SEARCH g USING INTEGER PRIMARY KEY \(rowid=\?\)/.test(d)), p1.join(" | "));
  const p2 = plan(d1.db, bindSql(LANE_SQL.Z2, args));
  assert.ok(p2.some((d) => /^SEARCH a USING INDEX aux_items_seen \(nm_first_seen>\? AND nm_first_seen<\?\)/.test(d)), p2.join(" | "));
  assert.ok(p2.some((d) => /^SEARCH g USING INTEGER PRIMARY KEY \(rowid=\?\)/.test(d)), p2.join(" | "));
  for (const d of [...p1, ...p2]) assert.doesNotMatch(d, SCAN_ROWS, d);
});

test("Q-N4a plans idx_dh_acc_stamp and the targets primary key; Q-N4r plans idx_dh_rej_seen (literal statuses)", () => {
  const db = laneNewsDb();
  const pa = plan(db, bindSql(LANE_SQL.N4A, [toStamp(T(-168)), toStamp(T(500)), "u1"]));
  assert.ok(pa.some((d) => /^SEARCH h USING INDEX idx_dh_acc_stamp \(file_stamp>\? AND file_stamp<\?\)/.test(d)), pa.join(" | "));
  assert.ok(pa.some((d) => /^SEARCH t USING PRIMARY KEY \(hit_id=\? AND universe_id=\?\)/.test(d)), pa.join(" | "));
  const pr = plan(db, bindSql(LANE_SQL.N4R, [T(-168), T(500)]));
  assert.ok(pr.some((d) => /^SEARCH discovery_hits USING INDEX idx_dh_rej_seen \(seen_at>\? AND seen_at<\?\)/.test(d)), pr.join(" | "));
  for (const d of [...pa, ...pr]) assert.doesNotMatch(d, SCAN_ROWS, d);
  // The form with a bound status cannot use a partial index (why the statuses are literals).
  const bound = plan(db, "SELECT url FROM discovery_hits WHERE status = ?1 AND seen_at >= ?2 LIMIT 1");
  assert.ok(bound.some((d) => /^SCAN discovery_hits/.test(d)), bound.join(" | "));
});

test("Q-N4a/Q-N4r return accepted hits with this universe's target and rejected hits by seen_at", () => {
  const db = laneNewsDb();
  storeHit(db, hit({ seen: 10, url: "https://example.com/h/a", tickers: "TST" }));
  storeHit(db, hit({ seen: 11, url: "https://example.com/h/b", tickers: "UVW" }), "u2");
  storeHit(db, hit({ seen: 12, url: "https://example.com/h/r", status: "rejected", reason: "trap" }));
  const acc = db.prepare(bindSql(LANE_SQL.N4A, [toStamp(T(0)), toStamp(T(100)), "u1"])).all();
  assert.deepEqual(acc.map((r) => [r.url, r.tickers ?? null, r.drain_key ?? null]),
    [["https://example.com/h/a", "TST", "widenet_x"], ["https://example.com/h/b", null, null]]);
  const rej = db.prepare(bindSql(LANE_SQL.N4R, [T(0), T(100)])).all();
  assert.deepEqual(rej.map((r) => [r.url, r.reason]), [["https://example.com/h/r", "trap"]]);
});

test("Q-N1, Q-N2, Q-N3, Q-N5 run on the news-monitor stand-in and use the key indexes", () => {
  const db = laneNewsDb();
  db.prepare("INSERT INTO source_diagnostics (key, polled_at, ok, request_host) VALUES ('bing_acme', ?, 1, 'www.bing.com'), ('acme_ir', ?, 1, 'example.com')").run(T(0), T(0));
  db.prepare("INSERT INTO source_seeds (key, seeded_at) VALUES ('bing_acme', ?)").run(T(1));
  db.prepare("INSERT INTO source_state (key, last_attempt) VALUES ('bing_acme', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'))").run();
  for (const [k, seen] of [["bing_acme", 2], ["bing_acme", 3], ["bing_shadow", 4], ["acme_ir", 5]]) {
    db.prepare("INSERT INTO items (source_key, url, title, published, first_seen) VALUES (?, ?, 'x', ?, ?)").run(k, `https://example.com/n/${k}/${seen}`, T(seen - 1), T(seen));
  }
  assert.deepEqual(db.prepare(bindSql(LANE_SQL.N1, [])).all().map((r) => r.key), ["bing_acme"]);
  assert.deepEqual(db.prepare(bindSql(LANE_SQL.N2_SEEDS, [["bing_acme", "bing_shadow"]])).all().map((r) => r.key), ["bing_acme"]);
  assert.deepEqual(db.prepare(bindSql(LANE_SQL.N2_FIRST, [["bing_shadow"]])).all().map((r) => [r.source_key, r.first_row]), [["bing_shadow", T(4)]]);
  assert.equal(db.prepare(bindSql(LANE_SQL.N3, [])).get().polls_60m, 1);
  const shadow = db.prepare(bindSql(LANE_SQL.N5, [["bing_shadow"], T(0), T(10)])).all();
  assert.deepEqual(shadow.map((r) => [r.source_key, typeof r.nm_rowid]), [["bing_shadow", "number"]]);

  const n2 = plan(db, bindSql(LANE_SQL.N2_SEEDS, [["bing_acme"]]));
  assert.ok(n2.some((d) => /^SEARCH source_seeds USING INDEX sqlite_autoindex_source_seeds_1 \(key=\?\)/.test(d)), n2.join(" | "));
  for (const sql of [bindSql(LANE_SQL.N2_FIRST, [["bing_acme"]]), bindSql(LANE_SQL.N5, [["bing_acme"], T(0), T(10)])]) {
    const p = plan(db, sql);
    assert.ok(p.some((d) => /^SEARCH items USING (COVERING )?INDEX sqlite_autoindex_items_1 \(source_key=\?\)/.test(d)), p.join(" | "));
  }
  const n3 = plan(db, bindSql(LANE_SQL.N3, []));
  assert.ok(n3.some((d) => /^SEARCH s USING INDEX sqlite_autoindex_source_state_1 \(key=\?\)/.test(d)), n3.join(" | "));
});
