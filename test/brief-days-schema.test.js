// Phase 3, Part E, PR-E1: migration 0022 (brief_days, the stored weekday brief).
// Schema only: no Worker code reads or writes it yet. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeD1, zenithDb } from "./helpers/worker-env.js";

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0022_brief_days.sql";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");
const PK = ["universe_id", "day", "kind"];
const AUTOINDEX = "sqlite_autoindex_brief_days_1";
const col = (name, type, over = {}) => ({ name, type, notnull: 0, dflt_value: null, pk: 0, ...over });
const COLS = [
  col("universe_id", "TEXT", { notnull: 1, dflt_value: "'u1'", pk: 1 }), col("day", "TEXT", { notnull: 1, pk: 2 }),
  col("kind", "TEXT", { notnull: 1, pk: 3 }), col("status", "TEXT", { notnull: 1 }), col("attempts", "INTEGER", { notnull: 1, dflt_value: "1" }),
  col("window_from", "TEXT"), col("window_to", "TEXT"), col("built_at", "TEXT", { notnull: 1 }),
  col("counts", "TEXT"), col("contents", "TEXT"), col("error", "TEXT"),
];

// The statements Part E's later PRs run against this table (Part E §5.3, §5.4).
// Q1: the tick's point read of today's row.
const Q1 = "SELECT status, attempts FROM brief_days WHERE universe_id='u1' AND day=? AND kind='brief_am'";
// Q2: the tick's previous stored window, at most 6 days back.
const Q2 = `SELECT window_to FROM brief_days WHERE universe_id='u1' AND kind='brief_am' AND status='ok' AND day < ?1 AND day >= ?2
  ORDER BY day DESC LIMIT 1`;
// Q3: the Brief view's day strip (no contents).
const Q3 = "SELECT day, status, counts FROM brief_days WHERE universe_id='u1' AND kind='brief_am' AND day <= ? ORDER BY day DESC LIMIT 10";
// Q1': the Brief view's one stored day.
const Q1P = "SELECT status, window_from, window_to, counts, contents FROM brief_days WHERE universe_id='u1' AND day=? AND kind='brief_am'";
// The tick's write (§5.3 step 7): a failed row is retried, an ok row is never overwritten.
const UPSERT = `INSERT INTO brief_days (universe_id, day, kind, status, attempts, window_from, window_to, built_at, counts, contents, error)
  VALUES ('u1', ?, 'brief_am', ?, 1, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(universe_id, day, kind) DO UPDATE SET status = excluded.status, attempts = brief_days.attempts + 1,
    window_from = excluded.window_from, window_to = excluded.window_to, built_at = excluded.built_at,
    counts = excluded.counts, contents = excluded.contents, error = excluded.error
  WHERE brief_days.status != 'ok'`;

const DAY = "2026-01-06";
const FROM = "2026-01-05T12:00:00.000Z";
const TO = "2026-01-06T12:05:00.000Z";
const COUNTS = JSON.stringify({ leads_digests: 1, competitors: 0, industry: 0, calendar: 2 });
const CONTENTS = JSON.stringify({ leads_digests: [{ ticker: "TST", title: "Test item", url: "https://example.com/1" }] });

const tableInfo = (d1) => d1.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('brief_days') ORDER BY cid`).map((r) => ({ ...r }));
const tablesOf = (d1) => d1.rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
const schema = (d1) => d1.rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").map((r) => ({ ...r }));
const rows = (d1) => d1.rows("SELECT * FROM brief_days ORDER BY universe_id, day, kind").map((r) => ({ ...r }));
const statements = (sql) => sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const plan = (d1, sql) => d1.rows(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail);
const insert = (d1, { universe = "u1", day = DAY, kind = "brief_am", status = "ok", counts = COUNTS, contents = CONTENTS, builtAt = TO } = {}) =>
  d1.db.prepare(`INSERT INTO brief_days (universe_id, day, kind, status, window_from, window_to, built_at, counts, contents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(universe, day, kind, status, FROM, TO, builtAt, counts, contents);
const upsert = (d1, day, status, { at = TO, counts = COUNTS, contents = CONTENTS, error = null } = {}) =>
  d1.prepare(UPSERT).bind(day, status, FROM, at, at, counts, contents, error).run();

// A zenith-db built from the migrations before 0022 only.
function before0022() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

test("0022 directly follows 0021 and is additive only: 1 table, no index, no other change", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION));
  assert.equal(files.filter((f) => f.startsWith("0022_")).length, 1, "one 0022 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0021_portal.sql") + 1, "0022 directly follows 0021");
  const stmts = statements(SQL);
  assert.equal(stmts.length, 1, "1 statement");
  assert.match(stmts[0], /^CREATE TABLE IF NOT EXISTS brief_days \(/);
  assert.doesNotMatch(stmts[0], /\b(ALTER|DROP|UPDATE|DELETE|INSERT|RENAME|TRIGGER|INDEX|REFERENCES)\b/i, "no change to an existing object, no data");
  assert.doesNotMatch(stmts[0], /WITHOUT ROWID/i, "a rowid table, so the key is sqlite_autoindex_brief_days_1");
});

test("brief_days has the 11 columns and the primary key (universe_id, day, kind)", () => {
  const d1 = zenithDb();
  assert.deepEqual(tableInfo(d1), COLS);
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('brief_days') WHERE pk > 0 ORDER BY pk").map((r) => r.name), PK);
  assert.deepEqual(d1.rows("SELECT wr FROM pragma_table_list WHERE name = 'brief_days'").map((r) => r.wr), [0], "a rowid table");
  // The only index is the primary key's own.
  assert.deepEqual(d1.rows("SELECT name, origin, \"unique\" FROM pragma_index_list('brief_days')").map((r) => ({ ...r })),
    [{ name: AUTOINDEX, origin: "pk", unique: 1 }]);
  assert.deepEqual(d1.rows(`SELECT name FROM pragma_index_info('${AUTOINDEX}') ORDER BY seqno`).map((r) => r.name), PK);
});

test("0022 adds only brief_days (and its key) and leaves every old object and row unchanged; a second apply is a no-op", () => {
  const d1 = before0022();
  const before = schema(d1);
  const tablesBefore = tablesOf(d1);
  assert.ok(!tablesBefore.includes("brief_days"), "brief_days is new");
  d1.db.prepare(`INSERT INTO items (id, nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at)
    VALUES (1, 1, 'testsrc', 'TST', 'https://example.com/1', 'Test item', ?, ?)`).run(FROM, FROM);
  const itemsBefore = d1.rows("SELECT * FROM items").map((r) => ({ ...r }));
  d1.exec(SQL);
  assert.deepEqual(tablesOf(d1), [...tablesBefore, "brief_days"].sort(), "exactly the 1 new table");
  const after = schema(d1);
  const added = after.filter((o) => !before.some((b) => b.type === o.type && b.name === o.name));
  assert.deepEqual(added.map((o) => `${o.type}:${o.name}`).sort(), [`index:${AUTOINDEX}`, "table:brief_days"], "only the table and its key");
  assert.deepEqual(after.filter((o) => o.tbl_name !== "brief_days"), before, "every other object is the same");
  assert.deepEqual(d1.rows("SELECT * FROM items").map((r) => ({ ...r })), itemsBefore, "old rows unchanged");
  // IF NOT EXISTS: applying the file again changes nothing and keeps the rows.
  insert(d1);
  d1.exec(SQL);
  assert.deepEqual(schema(d1), after);
  assert.equal(rows(d1).length, 1);
});

test("a second insert for the same day and kind conflicts; another kind or universe is its own row", () => {
  const d1 = zenithDb();
  insert(d1);
  assert.throws(() => insert(d1, { status: "failed" }), /UNIQUE|PRIMARY KEY/);
  insert(d1, { kind: "brief_pm" });
  insert(d1, { universe: "u2" });
  insert(d1, { day: "2026-01-07" });
  assert.equal(rows(d1).length, 4);
  // A row written without naming universe_id or attempts gets the defaults.
  d1.db.prepare("INSERT INTO brief_days (day, kind, status, built_at) VALUES ('2026-01-08', 'brief_am', 'ok', ?)").run(TO);
  assert.deepEqual({ ...d1.rows("SELECT universe_id, attempts FROM brief_days WHERE day = '2026-01-08'")[0] }, { universe_id: "u1", attempts: 1 });
});

test("status is ok or failed; built_at, day and kind are required; counts and contents must be JSON or NULL", () => {
  const d1 = zenithDb();
  assert.throws(() => insert(d1, { status: "pending" }), /CHECK/);
  assert.throws(() => insert(d1, { status: null }), /NOT NULL/);
  assert.throws(() => insert(d1, { builtAt: null }), /NOT NULL/);
  assert.throws(() => insert(d1, { day: null }), /NOT NULL/);
  assert.throws(() => insert(d1, { kind: null }), /NOT NULL/);
  assert.throws(() => insert(d1, { counts: "{not json" }), /CHECK/);
  assert.throws(() => insert(d1, { contents: "<p>text</p>" }), /CHECK/);
  assert.equal(rows(d1).length, 0);
  insert(d1, { status: "failed", counts: null, contents: null, day: "2026-01-06" });
  insert(d1, { day: "2026-01-07" });
  assert.deepEqual(rows(d1).map((r) => [r.day, r.status, r.counts === null, r.contents === null]),
    [["2026-01-06", "failed", true, true], ["2026-01-07", "ok", false, false]]);
  assert.equal(d1.rows("SELECT json_extract(counts, '$.competitors') c FROM brief_days WHERE day = '2026-01-07'")[0].c, 0);
});

test("the tick's upsert: a failed day is retried with attempts + 1; an ok day is never overwritten", async () => {
  const d1 = zenithDb();
  const first = await upsert(d1, DAY, "failed", { counts: null, contents: null, error: "synthetic failure" });
  assert.equal(first.meta.changes, 1);
  assert.deepEqual({ ...(await d1.prepare(Q1).bind(DAY).first()) }, { status: "failed", attempts: 1 });
  const later = "2026-01-06T12:10:00.000Z";
  assert.equal((await upsert(d1, DAY, "ok", { at: later })).meta.changes, 1);
  const row = await d1.prepare(Q1P).bind(DAY).first();
  assert.deepEqual({ ...row }, { status: "ok", window_from: FROM, window_to: later, counts: COUNTS, contents: CONTENTS });
  assert.deepEqual({ ...(await d1.prepare(Q1).bind(DAY).first()) }, { status: "ok", attempts: 2 });
  assert.equal(rows(d1)[0].error, null, "the old error is cleared");
  // An ok row stays as it is.
  assert.equal((await upsert(d1, DAY, "failed", { at: "2026-01-06T12:15:00.000Z", counts: null, contents: null, error: "x" })).meta.changes, 0);
  assert.deepEqual({ ...(await d1.prepare(Q1).bind(DAY).first()) }, { status: "ok", attempts: 2 });
  assert.equal(rows(d1)[0].window_to, later);
});

test("Q2 and Q3 read the stored days in key order", async () => {
  const d1 = zenithDb();
  // Mon ok, Tue failed, Wed ok; a different kind and a different universe on Wed.
  insert(d1, { day: "2026-01-05" });
  insert(d1, { day: "2026-01-06", status: "failed", counts: null, contents: null });
  insert(d1, { day: "2026-01-07" });
  insert(d1, { day: "2026-01-07", kind: "brief_pm" });
  insert(d1, { day: "2026-01-07", universe: "u2" });
  d1.db.prepare("UPDATE brief_days SET window_to = day || 'T12:00:00.000Z'").run();
  assert.equal(await d1.prepare(Q2).bind("2026-01-08", "2026-01-02").first("window_to"), "2026-01-07T12:00:00.000Z");
  assert.equal(await d1.prepare(Q2).bind("2026-01-07", "2026-01-01").first("window_to"), "2026-01-05T12:00:00.000Z", "a failed day is skipped");
  assert.equal(await d1.prepare(Q2).bind("2026-01-05", "2025-12-30").first(), null);
  const strip = (await d1.prepare(Q3).bind("2026-01-07").all()).results.map((r) => [r.day, r.status]);
  assert.deepEqual(strip, [["2026-01-07", "ok"], ["2026-01-06", "failed"], ["2026-01-05", "ok"]]);
});

test("EXPLAIN QUERY PLAN of Q1, Q2, Q3 and Q1' uses sqlite_autoindex_brief_days_1, with no scan and no temp B-tree", () => {
  const d1 = zenithDb();
  for (const [name, sql] of [["Q1", Q1], ["Q2", Q2], ["Q3", Q3], ["Q1'", Q1P]]) {
    const lines = plan(d1, sql);
    assert.equal(lines.length, 1, `${name}: one plan line (${lines.join(" | ")})`);
    assert.match(lines[0], new RegExp(`^SEARCH brief_days USING INDEX ${AUTOINDEX} \\(universe_id=\\? AND day`), name);
    assert.doesNotMatch(lines.join("\n"), /\bSCAN\b|TEMP B-TREE/, name);
  }
  assert.match(plan(d1, Q1)[0], /\(universe_id=\? AND day=\? AND kind=\?\)$/, "Q1 is a full key lookup");
  assert.match(plan(d1, Q1P)[0], /\(universe_id=\? AND day=\? AND kind=\?\)$/, "Q1' is a full key lookup");
});

test("the full migration set: the live E1 checks", () => {
  const d1 = zenithDb();
  // E1 step 1: the table exists and starts empty.
  assert.deepEqual(d1.rows("SELECT name FROM sqlite_master WHERE name = 'brief_days' LIMIT 5").map((r) => r.name), ["brief_days"]);
  assert.equal(d1.rows("SELECT COUNT(*) n FROM brief_days LIMIT 1")[0].n, 0);
  // E1 step 2: the day-strip plan with a literal day uses the key.
  const lines = plan(d1, "SELECT day, status, counts FROM brief_days WHERE universe_id='u1' AND kind='brief_am' AND day <= '2026-12-01' ORDER BY day DESC LIMIT 10");
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^SEARCH brief_days USING INDEX ${AUTOINDEX} \\(universe_id=\\? AND day<\\?\\)$`));
});

test("no column can hold an email, actor, user agent, IP or token", () => {
  const d1 = zenithDb();
  const banned = new Set(["ua", "ip", "email", "mail", "actor", "agent", "user", "addr", "address", "host", "ray", "token", "endpoint", "who"]);
  const hits = d1.rows("SELECT name FROM pragma_table_info('brief_days')").map((r) => r.name)
    .filter((name) => name.toLowerCase().split("_").some((p) => banned.has(p)) || /email|actor|agent|token/.test(name));
  assert.deepEqual(hits, []);
});

test("the migration holds shapes only, no data", () => {
  // Public repo: no hosts, ids, counts or samples in the migration text.
  assert.doesNotMatch(SQL, /https?:\/\//, "no URL");
  assert.doesNotMatch(SQL, /@/, "no email");
  assert.doesNotMatch(SQL, /\b[0-9a-f]{12,}\b/i, "no digest");
  assert.doesNotMatch(SQL.replace(/^-- 0022:/, ""), /\b\d{3,}\b/, "no number");
});
