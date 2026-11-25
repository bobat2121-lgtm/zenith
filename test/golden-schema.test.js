// Phase 2, Part C, PR-C1: migration 0018 (golden-set replay tables). Schema only:
// no Worker code reads or writes these yet. Synthetic rows only; no golden content.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeD1, zenithDb } from "./helpers/worker-env.js";

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0018_golden_replay.sql";
const NEW_TABLES = ["golden_items", "replay_grades", "replay_queue", "replays"];
const LIVE_TABLES = ["items", "aux_items", "grades", "aux_grades", "runs", "feedback", "aux_feedback", "recall_events",
  "expansion_candidates", "audit_log", "deliveries", "incidents", "reports"];
const AT = "2026-01-15T00:00:00Z";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");

const tableInfo = (d1, table) => d1.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`)
  .map((r) => ({ ...r }));
const cols = (d1, table) => tableInfo(d1, table).map((r) => r.name);
const run = (d1, sql, ...args) => d1.db.prepare(sql).run(...args);
const get = (d1, sql, ...args) => ({ ...d1.db.prepare(sql).get(...args) });

// A zenith-db built from the migrations before 0018 only.
function before0018() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

function golden(d1, over = {}) {
  const r = { id: 1, code: "T01", class: "anchor", basis: "rule", ticker: "SYN", source_key: "testsrc", title: "Synthetic golden item",
    first_seen: AT, first_seen_rule: "real", expect: '{"SYN":[40,59]}', added_at: AT, ...over };
  const keys = Object.keys(r).filter((k) => r[k] !== undefined);
  return run(d1, `INSERT INTO golden_items (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => r[k]));
}

function replay(d1, over = {}) {
  const r = { id: "rp-test-1", rubric_version: "r-test", base_version: "r-test", kind: "baseline", scope: "full", status: "armed",
    armed_at: AT, n_items: 1, ...over };
  const keys = Object.keys(r).filter((k) => r[k] !== undefined);
  return run(d1, `INSERT INTO replays (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => r[k]));
}

function replayGrade(d1, over = {}) {
  const r = { replay_id: "rp-test-1", golden_id: 1, ticker: "SYN", band: "borderline", score: 50, graded_at: AT, ...over };
  const keys = Object.keys(r).filter((k) => r[k] !== undefined);
  return run(d1, `INSERT INTO replay_grades (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => r[k]));
}

test("0018 is the next migration number and is additive only", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION));
  assert.equal(files.filter((f) => f.startsWith("0018_")).length, 1, "one 0018 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0017_universe_audit.sql") + 1, "0018 directly follows 0017");
  const stmts = SQL.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) assert.match(s, /^CREATE (TABLE|INDEX) /, `only CREATE TABLE / CREATE INDEX: ${s.slice(0, 40)}`);
  assert.equal(stmts.filter((s) => /^CREATE TABLE /.test(s)).length, 4, "4 tables");
  assert.equal(stmts.filter((s) => /^CREATE INDEX /.test(s)).length, 2, "2 indexes");
  assert.doesNotMatch(SQL, /\b(ALTER|DROP|UPDATE|DELETE|INSERT)\b/i);
});

test("0018 adds the 4 tables and leaves every live table unchanged", () => {
  const d1 = before0018();
  const live = Object.fromEntries(LIVE_TABLES.map((t) => [t, tableInfo(d1, t)]));
  for (const t of LIVE_TABLES) assert.ok(live[t].length > 0, `${t} exists before 0018`);
  const tables = () => d1.rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
  const before = tables();
  for (const t of NEW_TABLES) assert.ok(!before.includes(t), `${t} is new`);
  // A live row written before 0018 survives it untouched.
  run(d1, `INSERT INTO items (id, nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at)
       VALUES (1, 1, 'testsrc', 'SYN', 'https://example.com/1', 'Test item', ?, ?)`, AT, AT);
  run(d1, `INSERT INTO grades (item_id, ticker, rubric_version, score, band, why, graded_at) VALUES (1, 'SYN', 'r-test', 50, 'borderline', 'why', ?)`, AT);
  const liveRows = () => ({ items: d1.rows("SELECT * FROM items").map((r) => ({ ...r })), grades: d1.rows("SELECT * FROM grades").map((r) => ({ ...r })) });
  const rowsBefore = liveRows();
  d1.exec(SQL);
  assert.deepEqual(tables(), [...before, ...NEW_TABLES].sort(), "exactly the 4 new tables");
  for (const t of LIVE_TABLES) assert.deepEqual(tableInfo(d1, t), live[t], `${t} columns unchanged`);
  assert.deepEqual(liveRows(), rowsBefore, "live rows unchanged");
  for (const t of NEW_TABLES) assert.equal(get(d1, `SELECT COUNT(*) AS n FROM ${t}`).n, 0, `${t} starts empty`);
});

test("the full migration set builds the same tables", () => {
  const d1 = zenithDb();
  const names = d1.rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('golden_items','replays','replay_queue','replay_grades') ORDER BY name")
    .map((r) => r.name);
  assert.deepEqual(names, NEW_TABLES);
});

test("columns of the 4 tables", () => {
  const d1 = zenithDb();
  assert.deepEqual(cols(d1, "golden_items"), ["id", "code", "class", "basis", "ticker", "source_key", "role", "affects", "title", "url",
    "published", "first_seen", "first_seen_rule", "excerpt", "excerpt_status", "admit", "expect", "ref", "note", "active", "added_at", "universe_id"]);
  assert.deepEqual(cols(d1, "replays"), ["id", "rubric_version", "base_version", "kind", "scope", "scope_tickers", "iteration", "status",
    "targets", "reference_id", "armed_at", "finished_at", "n_items", "n_graded", "summary", "universe_id"]);
  assert.deepEqual(cols(d1, "replay_queue"), ["replay_id", "golden_id", "pass", "state", "claim_id", "claimed_until", "attempts"]);
  assert.deepEqual(cols(d1, "replay_grades"), ["replay_id", "golden_id", "ticker", "pass", "run_id", "model", "score", "band", "rung",
    "event_type", "flags", "why", "confidence", "read_source", "graded_at"]);
  const pk = (t) => tableInfo(d1, t).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pk("golden_items"), ["id"]);
  assert.deepEqual(pk("replays"), ["id"]);
  assert.deepEqual(pk("replay_queue"), ["replay_id", "golden_id", "pass"]);
  assert.deepEqual(pk("replay_grades"), ["replay_id", "golden_id", "ticker", "pass"]);
  const notNull = (t) => tableInfo(d1, t).filter((c) => c.notnull).map((c) => c.name);
  assert.deepEqual(notNull("golden_items"), ["code", "class", "basis", "ticker", "source_key", "title", "first_seen", "first_seen_rule",
    "expect", "active", "added_at", "universe_id"]);
  assert.deepEqual(notNull("replay_grades"), ["replay_id", "golden_id", "ticker", "pass", "band", "flags", "graded_at"]);
});

test("the 2 named indexes, and their columns", () => {
  const d1 = zenithDb();
  const idx = d1.rows(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
    AND tbl_name IN ('golden_items','replays','replay_queue','replay_grades') ORDER BY name`).map((r) => ({ ...r }));
  assert.deepEqual(idx, [{ name: "replay_grades_at", tbl_name: "replay_grades" }, { name: "replays_status", tbl_name: "replays" }]);
  const icols = (name) => d1.rows(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).map((r) => r.name);
  assert.deepEqual(icols("replays_status"), ["status", "armed_at"]);
  assert.deepEqual(icols("replay_grades_at"), ["graded_at"]);
});

test("the armed-replay lookup and the daily cap count are index-backed", () => {
  const d1 = zenithDb();
  const plan = (sql) => d1.rows(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join(" | ");
  assert.match(plan("SELECT id FROM replays WHERE status = 'armed' ORDER BY armed_at DESC LIMIT 1"), /USING (COVERING )?INDEX replays_status/);
  assert.match(plan("SELECT COUNT(*) FROM replay_grades WHERE graded_at >= '2026-01-15'"), /USING (COVERING )?INDEX replay_grades_at/);
});

test("defaults: universe u1, active, empty lists, pass 1, pending queue rows", () => {
  const d1 = zenithDb();
  golden(d1);
  assert.deepEqual(get(d1, "SELECT active, universe_id, role, affects, ref, note FROM golden_items WHERE id = 1"),
    { active: 1, universe_id: "u1", role: null, affects: null, ref: null, note: null });
  replay(d1);
  assert.deepEqual(get(d1, "SELECT scope_tickers, iteration, targets, reference_id, finished_at, n_graded, summary, universe_id FROM replays"),
    { scope_tickers: "[]", iteration: 1, targets: "[]", reference_id: null, finished_at: null, n_graded: 0, summary: null, universe_id: "u1" });
  run(d1, "INSERT INTO replay_queue (replay_id, golden_id) VALUES ('rp-test-1', 1)");
  assert.deepEqual(get(d1, "SELECT pass, state, claim_id, claimed_until, attempts FROM replay_queue"),
    { pass: 1, state: "pending", claim_id: null, claimed_until: null, attempts: 0 });
  replayGrade(d1);
  assert.deepEqual(get(d1, "SELECT pass, flags, rung, confidence FROM replay_grades"), { pass: 1, flags: "[]", rung: null, confidence: null });
});

test("CHECK constraints refuse values outside each list", () => {
  const d1 = zenithDb();
  for (const c of ["anchor", "recall", "ladder", "holdout", "guard"]) golden(d1, { id: undefined, code: `C-${c}`, class: c });
  for (const b of ["core11", "sheet", "rule", "auditor", "owner"]) golden(d1, { id: undefined, code: `B-${b}`, basis: b });
  golden(d1, { id: undefined, code: "F-1", first_seen_rule: "published_plus_1h" });
  assert.throws(() => golden(d1, { id: undefined, code: "X1", class: "sentinel" }), /CHECK/);
  assert.throws(() => golden(d1, { id: undefined, code: "X2", basis: "guess" }), /CHECK/);
  assert.throws(() => golden(d1, { id: undefined, code: "X3", first_seen_rule: "published" }), /CHECK/);
  let n = 0;
  for (const k of ["baseline", "candidate"]) replay(d1, { id: `rp-${n++}`, kind: k });
  for (const s of ["full", "sheets", "guards", "retry"]) replay(d1, { id: `rp-${n++}`, scope: s });
  for (const s of ["armed", "done", "passed", "failed", "aborted"]) replay(d1, { id: `rp-${n++}`, status: s });
  assert.throws(() => replay(d1, { id: "rp-x1", kind: "live" }), /CHECK/);
  assert.throws(() => replay(d1, { id: "rp-x2", scope: "partial" }), /CHECK/);
  assert.throws(() => replay(d1, { id: "rp-x3", status: "running" }), /CHECK/);
  for (const [i, s] of ["pending", "claimed", "graded", "failed"].entries()) {
    run(d1, "INSERT INTO replay_queue (replay_id, golden_id, state) VALUES ('rp-0', ?, ?)", i + 1, s);
  }
  assert.throws(() => run(d1, "INSERT INTO replay_queue (replay_id, golden_id, state) VALUES ('rp-0', 9, 'done')"), /CHECK/);
});

test("NOT NULL, UNIQUE code and the composite primary keys", () => {
  const d1 = zenithDb();
  golden(d1);
  assert.throws(() => golden(d1, { id: 2 }), /UNIQUE/, "code is unique");
  assert.throws(() => golden(d1, { id: 3, code: "T03", expect: null }), /NOT NULL/);
  assert.throws(() => golden(d1, { id: 4, code: "T04", ticker: null }), /NOT NULL/);
  replay(d1);
  assert.throws(() => replay(d1, { id: "rp-test-2", n_items: null }), /NOT NULL/);
  run(d1, "INSERT INTO replay_queue (replay_id, golden_id) VALUES ('rp-test-1', 1)");
  run(d1, "INSERT INTO replay_queue (replay_id, golden_id, pass) VALUES ('rp-test-1', 1, 2)");
  assert.throws(() => run(d1, "INSERT INTO replay_queue (replay_id, golden_id) VALUES ('rp-test-1', 1)"), /UNIQUE|PRIMARY/);
  replayGrade(d1);
  replayGrade(d1, { ticker: "SYX" });
  replayGrade(d1, { pass: 2 });
  assert.throws(() => replayGrade(d1), /UNIQUE|PRIMARY/, "one grade per replay, item, ticker and pass");
  assert.throws(() => replayGrade(d1, { ticker: "SYY", band: null }), /NOT NULL/);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM replay_grades").n, 3);
});

test("replay grades never land in the live grade tables", () => {
  const d1 = zenithDb();
  golden(d1);
  replay(d1);
  replayGrade(d1);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM grades").n, 0);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM aux_grades").n, 0);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM items").n, 0, "a golden item is not an items row");
  const triggers = d1.rows(`SELECT name FROM sqlite_master WHERE type='trigger'
    AND tbl_name IN ('golden_items','replays','replay_queue','replay_grades')`);
  assert.equal(triggers.length, 0, "no trigger copies replay rows anywhere");
});

test("the migration holds no golden content", () => {
  // Public repo: comments describe shapes only; no codes, ranges, item ids or tickers from the private seed.
  const comments = [...SQL.matchAll(/--([^\n]*)/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(comments, /\[\s*\d+\s*,\s*(\d+|null)\s*\]/, "no expected range");
  assert.doesNotMatch(comments, /item:\d/, "no live item id");
  assert.doesNotMatch(comments, /'[A-Z]{1,2}-?[A-Z0-9]*\d+'/, "no golden code");
});
