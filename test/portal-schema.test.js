// Phase 3, Part A, PR-PA1: migration 0021 (portal_views, the privacy-safe open counter,
// and portal_pairings, the session-mode pairing codes). Schema only: no Worker code reads
// or writes these yet. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeD1, zenithDb } from "./helpers/worker-env.js";

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0021_portal.sql";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");
const NEW_TABLES = ["portal_pairings", "portal_views"];
const VIEWS_PK = ["universe_id", "day", "view", "client", "via"];
const col = (name, type, over = {}) => ({ name, type, notnull: 1, dflt_value: null, pk: 0, ...over });
const VIEWS_COLS = [
  col("universe_id", "TEXT", { dflt_value: "'u1'", pk: 1 }), col("day", "TEXT", { pk: 2 }), col("view", "TEXT", { pk: 3 }),
  col("client", "TEXT", { pk: 4 }), col("via", "TEXT", { pk: 5 }), col("n", "INTEGER", { dflt_value: "0" }),
  col("first_at", "TEXT"), col("last_at", "TEXT"),
];
// An INTEGER PRIMARY KEY reports notnull 0 in pragma_table_info (it is the rowid alias).
const PAIRINGS_COLS = [
  col("id", "INTEGER", { notnull: 0, pk: 1 }), col("code_sha256", "TEXT"), col("created_at", "TEXT"), col("expires_at", "TEXT"),
  col("used_at", "TEXT", { notnull: 0 }), col("fails", "INTEGER", { dflt_value: "0" }),
];

// The W1 upsert the view counter will run (Part A §5.10), with the D1 shape: prepare, bind, run.
const W1 = `INSERT INTO portal_views (universe_id, day, view, client, via, n, first_at, last_at) VALUES ('u1', ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT (universe_id, day, view, client, via) DO UPDATE SET n = n + 1, last_at = excluded.last_at`;
// The pairing statements (Part A §5.10): create, redeem, then one UPDATE.
const PAIR_DELETE = "DELETE FROM portal_pairings";
const PAIR_INSERT = "INSERT INTO portal_pairings (code_sha256, created_at, expires_at, used_at, fails) VALUES (?, ?, ?, NULL, 0)";
const PAIR_REDEEM = "SELECT id, code_sha256 FROM portal_pairings WHERE used_at IS NULL AND expires_at > ? AND fails < 5 LIMIT 1";
const PAIR_USED = "UPDATE portal_pairings SET used_at = ? WHERE id = ? AND used_at IS NULL";
const PAIR_FAIL = "UPDATE portal_pairings SET fails = fails + 1 WHERE id = ?";

const T1 = "2026-01-15T10:00:00.000Z";
const T2 = "2026-01-15T10:05:00.000Z";
const DAY = "2026-01-15";
// A synthetic stand-in for a code's SHA-256 (64 hex characters, not the hash of anything).
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const tableInfo = (d1, table) => d1.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`)
  .map((r) => ({ ...r }));
const tablesOf = (d1) => d1.rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
const schema = (d1) => d1.rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").map((r) => ({ ...r }));
const viewRows = (d1) => d1.rows("SELECT * FROM portal_views ORDER BY day, view, client, via").map((r) => ({ ...r }));
const statements = (sql) => sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

// A zenith-db built from the migrations before 0021 only.
function before0021() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

const countView = (d1, day, view, client, via, at) => d1.prepare(W1).bind(day, view, client, via, at, at).run();

test("0021 directly follows 0020 and is additive only: 2 tables, no index, no other change", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION));
  assert.equal(files.filter((f) => f.startsWith("0021_")).length, 1, "one 0021 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0020_text.sql") + 1, "0021 directly follows 0020");
  const stmts = statements(SQL);
  assert.equal(stmts.length, 2, "2 statements");
  assert.match(stmts[0], /^CREATE TABLE portal_views \(/);
  assert.match(stmts[1], /^CREATE TABLE portal_pairings \(/);
  const body = stmts.join(";\n"); // statements only: the header comment names what is absent
  assert.doesNotMatch(body, /\b(ALTER|DROP|UPDATE|DELETE|INSERT|RENAME|TRIGGER|INDEX|REFERENCES)\b/i, "no change to an existing object, no data");
  assert.doesNotMatch(body, /\bIF NOT EXISTS\b/i, "a clean create: the tables are new");
});

test("portal_views has the 8 columns, is WITHOUT ROWID and has the 5-column primary key", () => {
  const d1 = zenithDb();
  assert.deepEqual(tableInfo(d1, "portal_views"), VIEWS_COLS);
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('portal_views') WHERE pk > 0 ORDER BY pk").map((r) => r.name), VIEWS_PK);
  assert.deepEqual(d1.rows("SELECT wr FROM pragma_table_list WHERE name = 'portal_views'").map((r) => r.wr), [1], "WITHOUT ROWID");
  assert.match(statements(SQL)[0], /\) WITHOUT ROWID$/);
  // The only index is the primary key itself.
  assert.deepEqual(d1.rows("SELECT origin FROM pragma_index_list('portal_views')").map((r) => r.origin), ["pk"]);
});

test("portal_pairings has the 6 columns, a rowid primary key and no index", () => {
  const d1 = zenithDb();
  assert.deepEqual(tableInfo(d1, "portal_pairings"), PAIRINGS_COLS);
  assert.deepEqual(d1.rows("SELECT wr FROM pragma_table_list WHERE name = 'portal_pairings'").map((r) => r.wr), [0], "a rowid table");
  assert.deepEqual(d1.rows("SELECT name FROM pragma_index_list('portal_pairings')"), []);
});

test("0021 adds only the 2 tables and leaves every old object and row unchanged", () => {
  const d1 = before0021();
  const before = schema(d1);
  const tablesBefore = tablesOf(d1);
  for (const t of NEW_TABLES) assert.ok(!tablesBefore.includes(t), `${t} is new`);
  d1.db.prepare(`INSERT INTO items (id, nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at)
    VALUES (1, 1, 'testsrc', 'TST', 'https://example.com/1', 'Test item', ?, ?)`).run(T1, T1);
  const itemsBefore = d1.rows("SELECT * FROM items").map((r) => ({ ...r }));
  d1.exec(SQL);
  assert.deepEqual(tablesOf(d1), [...tablesBefore, ...NEW_TABLES].sort(), "exactly the 2 new tables");
  const after = schema(d1);
  const added = after.filter((o) => !before.some((b) => b.type === o.type && b.name === o.name));
  // A WITHOUT ROWID table is stored as its primary key, so there is no separate index object.
  assert.deepEqual(added.map((o) => `${o.type}:${o.name}`).sort(), ["table:portal_pairings", "table:portal_views"], "only the 2 tables");
  assert.deepEqual(after.filter((o) => !NEW_TABLES.includes(o.tbl_name)), before, "every other object is the same");
  assert.deepEqual(d1.rows("SELECT * FROM items").map((r) => ({ ...r })), itemsBefore, "old rows unchanged");
});

test("the full migration set: the live P2 and P3 checks", () => {
  const d1 = zenithDb();
  // P2: both tables start empty.
  assert.deepEqual({ ...d1.rows("SELECT (SELECT COUNT(*) FROM portal_views) v, (SELECT COUNT(*) FROM portal_pairings) p LIMIT 1")[0] }, { v: 0, p: 0 });
  // P3: the point read of one counter key uses the primary key.
  const plan = d1.rows(`EXPLAIN QUERY PLAN SELECT n FROM portal_views WHERE universe_id = 'u1' AND day = '2000-01-01' AND view = 'today'
    AND client = 'desktop' AND via = 'session'`).map((r) => r.detail);
  assert.equal(plan.length, 1);
  assert.match(plan[0], /^SEARCH portal_views USING PRIMARY KEY \(universe_id=\? AND day=\? AND view=\? AND client=\? AND via=\?\)$/);
});

test("the W1 upsert twice for one key gives one row with n = 2, first_at kept and last_at from the second call", async () => {
  const d1 = zenithDb();
  await countView(d1, DAY, "today", "phone_home", "session", T1);
  assert.deepEqual(viewRows(d1), [{ universe_id: "u1", day: DAY, view: "today", client: "phone_home", via: "session", n: 1, first_at: T1, last_at: T1 }]);
  const r = await countView(d1, DAY, "today", "phone_home", "session", T2);
  assert.equal(r.meta.changes, 1);
  assert.deepEqual(viewRows(d1), [{ universe_id: "u1", day: DAY, view: "today", client: "phone_home", via: "session", n: 2, first_at: T1, last_at: T2 }]);
});

test("each part of the key is its own counter row", async () => {
  const d1 = zenithDb();
  await countView(d1, DAY, "today", "desktop", "session", T1);
  await countView(d1, DAY, "today", "phone", "session", T1);
  await countView(d1, DAY, "today", "phone", "access", T1);
  await countView(d1, DAY, "brief", "phone", "access", T1);
  await countView(d1, "2026-01-16", "brief", "phone", "access", T2);
  await countView(d1, DAY, "today", "desktop", "session", T2);
  const rows = viewRows(d1);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.n).sort(), [1, 1, 1, 1, 2]);
  assert.ok(rows.every((r) => r.universe_id === "u1"));
  // A row written without naming universe_id gets the default too.
  d1.db.prepare("INSERT INTO portal_views (day, view, client, via, n, first_at, last_at) VALUES (?, 'rare', 'tablet', 'session', 1, ?, ?)").run(DAY, T1, T1);
  assert.equal(d1.rows("SELECT universe_id FROM portal_views WHERE view = 'rare'")[0].universe_id, "u1");
  // The key is enforced: a plain second INSERT of the same key is refused.
  assert.throws(() => d1.db.prepare("INSERT INTO portal_views (day, view, client, via, n, first_at, last_at) VALUES (?, 'rare', 'tablet', 'session', 1, ?, ?)")
    .run(DAY, T1, T1), /UNIQUE|PRIMARY KEY/);
  // first_at and last_at are required.
  assert.throws(() => d1.db.prepare("INSERT INTO portal_views (day, view, client, via, n) VALUES (?, 'search', 'desktop', 'session', 1)").run(DAY), /NOT NULL/);
});

test("the pairing statements run against the schema: create, redeem once, lock out after 5 fails", async () => {
  const d1 = zenithDb();
  const create = (hash, at, exp) => d1.batch([d1.prepare(PAIR_DELETE), d1.prepare(PAIR_INSERT).bind(hash, at, exp)]);
  const redeem = (at) => d1.prepare(PAIR_REDEEM).bind(at).first();
  // No code created: nothing to redeem.
  assert.equal(await redeem(T1), null);
  await create(HASH_A, T1, "2026-01-15T10:10:00.000Z");
  const row = await redeem(T2);
  assert.equal(row.code_sha256, HASH_A);
  assert.deepEqual({ ...d1.rows("SELECT used_at, fails FROM portal_pairings")[0] }, { used_at: null, fails: 0 });
  // Single use.
  assert.equal((await d1.prepare(PAIR_USED).bind(T2, row.id).run()).meta.changes, 1);
  assert.equal(await redeem(T2), null);
  // A new code replaces the old one: the table holds at most one row.
  await create(HASH_B, T2, "2026-01-15T10:15:00.000Z");
  assert.deepEqual(d1.rows("SELECT code_sha256 FROM portal_pairings").map((r) => r.code_sha256), [HASH_B]);
  // Expired.
  assert.equal(await redeem("2026-01-15T10:15:00.000Z"), null);
  // Lockout after 5 fails.
  const live = await redeem(T2);
  for (let i = 0; i < 4; i++) await d1.prepare(PAIR_FAIL).bind(live.id).run();
  assert.equal((await redeem(T2)).id, live.id, "4 fails: still live");
  await d1.prepare(PAIR_FAIL).bind(live.id).run();
  assert.equal(await redeem(T2), null, "5 fails: locked out");
  assert.throws(() => d1.db.prepare("INSERT INTO portal_pairings (created_at, expires_at) VALUES (?, ?)").run(T1, T2), /NOT NULL/, "code_sha256 is required");
});

test("no column can hold a user agent, IP, email, actor, item id or a raw code", () => {
  const d1 = zenithDb();
  const banned = new Set(["ua", "ip", "email", "mail", "actor", "item", "code", "agent", "user", "addr", "address", "host", "ray", "token", "endpoint"]);
  const hits = [];
  for (const t of NEW_TABLES) {
    for (const { name } of d1.rows(`SELECT name FROM pragma_table_info('${t}')`)) {
      if (t === "portal_pairings" && name === "code_sha256") continue; // the only code column, and it holds a hash
      const parts = name.toLowerCase().split("_");
      if (parts.some((p) => banned.has(p)) || /email|actor|agent|item|token/.test(name)) hits.push(`${t}.${name}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('portal_pairings') WHERE name LIKE '%code%'").map((r) => r.name), ["code_sha256"]);
});

test("the migration holds shapes only, no data", () => {
  // Public repo: no hosts, ids, counts or samples in the migration text.
  assert.doesNotMatch(SQL, /https?:\/\//, "no URL");
  assert.doesNotMatch(SQL, /@/, "no email");
  assert.doesNotMatch(SQL, /\b[0-9a-f]{12,}\b/i, "no digest");
  assert.doesNotMatch(SQL.replace(/^-- 0021:/, "").replace(/SHA-256/g, ""), /\b\d{3,}\b/, "no number");
});
