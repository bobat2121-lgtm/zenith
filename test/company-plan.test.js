// Phase 3 Part B (P3-B2) T17: the Company page's reads are indexed and bounded.
// Plans on node:sqlite with every zenith-db migration (0023's live-row indexes
// included); every statement has a LIMIT; one zenith-db batch of at most 5
// statements and one NEWS batch of at most 3, plus calendar.js's two
// council-agenda reads for a name with legistar channels. Synthetic rows only;
// tickers are picked from covered.json at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports } from "./helpers/worker-env.js";
import { D1 } from "./helpers/d1.js";

hookJsonImports();
const { COMPANY_SQL, companyData, channelsFor } = await import("../worker/src/company.js");
const COV = JSON.parse(readFileSync(new URL("../worker/src/covered.json", import.meta.url), "utf8"));
const AUX = JSON.parse(readFileSync(new URL("../worker/src/aux-sources.json", import.meta.url), "utf8"));
const CODE = readFileSync(new URL("../worker/src/company.js", import.meta.url), "utf8");

const FROM = "2026-01-01T00:00:00.000Z";
const KEYS = JSON.stringify(["test_a", "test_b"]);
const ENTS = JSON.stringify(["test_entity", "test_other"]);
const db = new D1();
const plan = (sql, binds) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds).map((r) => r.detail);
const SCAN_ROWS = /^SCAN (items|aux_items|grades|aux_grades|i|a|g|p)\b/;

test("T17: Q1, Q2, Q2e and Q3 search their indexes and scan no row table", () => {
  const cases = [
    ["Q1", [ "TST", FROM], /^SEARCH i USING INDEX idx_items_ticker \(ticker=\? AND nm_first_seen>\?\)/],
    ["Q2", [KEYS, FROM], /^SEARCH a USING INDEX aux_items_source_live \(source_key=\? AND nm_first_seen>\?\)/],
    ["Q2E", [ENTS, KEYS, FROM], /^SEARCH a USING INDEX aux_items_entity_live \(entity_key=\? AND nm_first_seen>\?\)/],
    ["Q3", ["TST", FROM], /^SEARCH g USING INDEX idx_grades_ticker_graded \(ticker=\? AND graded_at>\?\)/],
  ];
  for (const [name, binds, re] of cases) {
    const lines = plan(COMPANY_SQL[name], binds);
    assert.ok(lines.some((l) => re.test(l)), `${name}: ${lines.join(" | ")}`);
    for (const l of lines) assert.doesNotMatch(l, SCAN_ROWS, `${name}: ${l}`);
  }
  // The grade joins are primary-key lookups.
  assert.ok(plan(COMPANY_SQL.Q2, [KEYS, FROM]).some((l) => /^SEARCH g USING INTEGER PRIMARY KEY/.test(l)));
  assert.ok(plan(COMPANY_SQL.Q3, ["TST", FROM]).some((l) => /^SEARCH i USING INTEGER PRIMARY KEY/.test(l)));
});

test("T17: the aux reads say state != 'skipped' (the partial indexes' WHERE), never an IN list of states", () => {
  for (const name of ["Q2", "Q2E"]) {
    assert.match(COMPANY_SQL[name], /a\.state != 'skipped'/);
    assert.doesNotMatch(COMPANY_SQL[name], /state IN \(/);
  }
});

test("T17: every statement has a LIMIT, and company.js prepares only its own statements", () => {
  for (const [name, sql] of Object.entries(COMPANY_SQL)) assert.match(sql, /\bLIMIT \d+\s*$/, name);
  const prepared = [...CODE.matchAll(/\.prepare\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(prepared.length >= 7);
  for (const p of prepared) assert.match(p, /^Q[0-9A-Z]*_SQL$/, p);
});

test("T17: Q2e's string test on the bound key list equals NOT IN json_each, row for row; no source key holds a quote or a backslash", async () => {
  for (const k of [...Object.keys(AUX.sources), ...Object.keys(COV.sources), ...Object.keys(COV.counterparty)]) {
    assert.doesNotMatch(k, /["\\]/, k);
  }
  const d = new D1();
  let n = 0;
  for (const src of ["test_a", "test_b", "test_c", "managed_test_news", "test_a2", "test_"]) {
    for (const ent of ["test_entity", "test_other", "test_none"]) {
      for (const state of ["graded", "pending", "skipped"]) {
        n++;
        d.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
          VALUES (?, ?, ?, 'Test Co', 'public', ?, 'Title', ?, ?, ?)`).run(n, src, ent, `https://example.com/${n}`, "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z", state);
      }
    }
  }
  const notIn = COMPANY_SQL.Q2E.replace(/instr\(\?2, '"' \|\| a\.source_key \|\| '"'\) = 0/, "a.source_key NOT IN (SELECT value FROM json_each(?2))");
  assert.notEqual(notIn, COMPANY_SQL.Q2E);
  const ids = (sql) => d.db.prepare(sql).all(ENTS, KEYS, FROM).map((r) => r.id).sort((a, b) => a - b);
  const got = ids(COMPANY_SQL.Q2E);
  assert.deepEqual(got, ids(notIn));
  assert.ok(got.length > 0);
  assert.ok(!d.db.prepare(`SELECT source_key FROM aux_items WHERE id IN (${got.join(",")})`).all().some((r) => ["test_a", "test_b"].includes(r.source_key)));
});

test("T17: one zenith-db batch of at most 5 statements and one NEWS batch of at most 3, for every covered ticker", async () => {
  for (const T of COV.tickers) {
    const log = { DB: { batches: [], prepares: 0 }, NEWS: { batches: [], prepares: 0 } };
    const spy = (name, inner) => ({
      prepare(sql) { log[name].prepares++; return inner.prepare(sql); },
      async batch(stmts) { log[name].batches.push(stmts.length); return inner.batch(stmts); },
    });
    const news = new D1({ migrations: false });
    news.exec(`CREATE TABLE source_state (key TEXT PRIMARY KEY, last_polled TEXT, last_ok TEXT, last_attempt TEXT, next_poll_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT);
      CREATE TABLE ops_alerts (source_key TEXT NOT NULL, rule TEXT NOT NULL, opened_at TEXT NOT NULL, resolved_at TEXT, PRIMARY KEY (source_key, rule));
      CREATE TABLE universe_managed_health (key TEXT PRIMARY KEY, last_ok TEXT, last_error TEXT, fail_count INTEGER NOT NULL DEFAULT 0, next_poll_at TEXT);
      CREATE TABLE series_points (series TEXT NOT NULL, subject TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL, ticker TEXT, label TEXT,
        record_url TEXT, observed_at TEXT, PRIMARY KEY (series, subject, period))`);
    const out = await companyData({ DB: spy("DB", new D1()), NEWS: spy("NEWS", news) }, T);
    assert.equal(out.error, undefined, T);
    assert.equal(log.DB.batches.length, 1, T);
    assert.ok(log.DB.batches[0] <= 5, T);
    assert.equal(log.NEWS.batches.length, 1, T);
    assert.ok(log.NEWS.batches[0] <= 3, T);
    assert.equal(log.NEWS.prepares, log.NEWS.batches[0], T);
    // Outside the batch: calendar.js's council-agenda read (and its decisions read when an agenda exists), legistar names only.
    const outside = log.DB.prepares - log.DB.batches[0];
    if ((await channelsFor(T)).legistar.length) assert.ok(outside >= 1 && outside <= 2, `${T}: ${outside}`);
    else assert.equal(outside, 0, T);
  }
});
