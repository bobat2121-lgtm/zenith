// Phase 3 PR-CV2 test P1: the query plans of worker/src/views.js's two window
// queries, on node:sqlite with every zenith-db migration applied. Q-V1 must
// drive from the grades indexes (the CROSS JOIN fixes grades as the outer
// table; a plain JOIN drove from idx_items_seen and read several times more
// rows), and Q-V2 from aux_items_state. No plan may scan items or aux_items.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb } from "./helpers/worker-env.js";

hookJsonImports();
const { windowSql } = await import("../worker/src/views.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");
const { universeSql } = await import("../worker/src/lib.js");

const db = zenithDb();
const SQL = (ticker) => windowSql({ ticker, muted: MUTED_SQL, universe: universeSql(["TST"]) });
const FROM = "2026-01-01T00:00:00.000Z", TO = "2026-01-15T00:00:00.000Z";
const plan = (sql, binds) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds);
// The main loop's rows (parent 0 and not a subquery's own steps), in order.
const top = (rows) => rows.filter((r) => r.parent === 0).map((r) => r.detail);
// A full scan of a row table, under any alias the statements use.
const SCAN_ROWS = /^SCAN (items|aux_items|grades|aux_grades|i|a|g|p|c)\b/;

function noRowScans(rows, name) {
  for (const r of rows) assert.doesNotMatch(r.detail, SCAN_ROWS, `${name}: ${r.detail}`);
}

test("P1: Q-V1 (all tickers) starts with SEARCH g USING INDEX idx_grades_graded_at and scans no row table", () => {
  const rows = plan(SQL(false).coverage, [FROM, TO]);
  const t = top(rows);
  assert.match(t[0], /^SEARCH g USING INDEX idx_grades_graded_at \(graded_at>\?\)/, t.join(" | "));
  assert.match(t[1], /^SEARCH i USING INTEGER PRIMARY KEY/, t.join(" | "));
  assert.ok(rows.some((r) => /^SEARCH p USING INTEGER PRIMARY KEY/.test(r.detail)), "the primary run is a PK lookup");
  noRowScans(rows, "Q-V1");
});

test("P1: Q-V1 ticker form uses idx_grades_ticker", () => {
  const rows = plan(SQL(true).coverage, [FROM, TO, "TST"]);
  const t = top(rows);
  assert.match(t[0], /^SEARCH g USING INDEX idx_grades_ticker \(ticker=\?\)/, t.join(" | "));
  assert.match(t[1], /^SEARCH i USING INTEGER PRIMARY KEY/, t.join(" | "));
  noRowScans(rows, "Q-V1 ticker");
});

test("P1: Q-V2 (both forms) uses aux_items_state with both window bounds and scans no row table", () => {
  for (const [ticker, binds] of [[false, [FROM, TO]], [true, [FROM, TO, "TST", "[]"]]]) {
    const rows = plan(SQL(ticker).aux, binds);
    const t = top(rows);
    assert.match(t[0], /^SEARCH a USING INDEX aux_items_state \(state=\? AND nm_first_seen>\? AND nm_first_seen<\?\)/, t.join(" | "));
    assert.ok(t.some((d) => /^SEARCH g USING INTEGER PRIMARY KEY/.test(d)), t.join(" | "));
    noRowScans(rows, `Q-V2 ticker=${ticker}`);
  }
});
