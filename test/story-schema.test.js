// Phase 2, Part B, PR-B1: migration 0019 (exact-key story dedup columns and their partial
// indexes). Schema only: no Worker code reads or writes these yet. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeD1, zenithDb } from "./helpers/worker-env.js";

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0019_story_dedup.sql";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");
const AT = "2026-01-15T00:00:00Z";
const NEW_COLS = { items: ["story_key", "story_of"], aux_items: ["story_key", "url_key", "story_of"] };
const NEW_INDEXES = [
  { name: "aux_items_story_key", tbl: "aux_items", cols: ["story_key", "nm_first_seen"], where: "story_key IS NOT NULL" },
  { name: "aux_items_story_of", tbl: "aux_items", cols: ["story_of"], where: "story_of IS NOT NULL" },
  { name: "aux_items_url_key", tbl: "aux_items", cols: ["url_key", "nm_first_seen"], where: "url_key IS NOT NULL" },
  { name: "idx_items_story_key", tbl: "items", cols: ["story_key", "nm_first_seen"], where: "story_key IS NOT NULL" },
  { name: "idx_items_story_of", tbl: "items", cols: ["story_of"], where: "story_of IS NOT NULL" },
];

const tableInfo = (d1, table) => d1.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`)
  .map((r) => ({ ...r }));
const cols = (d1, table) => tableInfo(d1, table).map((r) => r.name);
const run = (d1, sql, ...args) => d1.db.prepare(sql).run(...args);
const get = (d1, sql, ...args) => ({ ...d1.db.prepare(sql).get(...args) });
const plan = (d1, sql) => d1.rows(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join(" | ");
const schema = (d1) => d1.rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").map((r) => ({ ...r }));

// A zenith-db built from the migrations before 0019 only.
function before0019() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

function item(d1, id, over = {}) {
  const r = { id, nm_rowid: id, source_key: "testsrc", ticker: "SYN", url: `https://example.com/c${id}`, title: "Acme Robotics wins a test order",
    nm_first_seen: AT, ingested_at: AT, ...over };
  const keys = Object.keys(r);
  return run(d1, `INSERT INTO items (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => r[k]));
}

function auxItem(d1, id, over = {}) {
  const r = { id, nm_rowid: id, source_key: "testaux", entity_key: "testent", entity_name: "Testent", status: "private",
    url: `https://example.com/a${id}`, title: "Testent opens a test plant", nm_first_seen: AT, ingested_at: AT, ...over };
  const keys = Object.keys(r);
  return run(d1, `INSERT INTO aux_items (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => r[k]));
}

test("0019 directly follows 0018 and is additive only", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION));
  assert.equal(files.filter((f) => f.startsWith("0019_")).length, 1, "one 0019 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0018_golden_replay.sql") + 1, "0019 directly follows 0018");
  const stmts = SQL.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const s of stmts) assert.match(s, /^(ALTER TABLE (items|aux_items) ADD COLUMN |CREATE INDEX )/, `only ADD COLUMN / CREATE INDEX: ${s.slice(0, 50)}`);
  assert.equal(stmts.filter((s) => /^ALTER TABLE /.test(s)).length, 5, "5 columns");
  assert.equal(stmts.filter((s) => /^CREATE INDEX /.test(s)).length, 5, "5 indexes");
  for (const s of stmts.filter((s) => /^CREATE INDEX /.test(s))) assert.match(s, / WHERE \w+ IS NOT NULL$/, `partial index: ${s.slice(0, 50)}`);
  const body = stmts.join(";\n"); // statements only: the header comment names what is absent
  assert.doesNotMatch(body, /\b(DROP|UPDATE|DELETE|INSERT|RENAME|CHECK|DEFAULT|UNIQUE|REFERENCES|TRIGGER)\b/i, "no constraint, default or data change");
  assert.doesNotMatch(body, /ADD COLUMN \w+ \w+ NOT NULL/i, "every new column is nullable");
  assert.doesNotMatch(body, /universe_id/, "universe_id is untouched");
});

test("0019 adds the 5 columns and leaves every old row and every other object unchanged", () => {
  const d1 = before0019();
  for (const [t, added] of Object.entries(NEW_COLS)) {
    for (const c of added) assert.ok(!cols(d1, t).includes(c), `${t}.${c} is new`);
  }
  item(d1, 1);
  auxItem(d1, 1);
  const info = { items: tableInfo(d1, "items"), aux_items: tableInfo(d1, "aux_items") };
  const rows = () => ({ items: d1.rows("SELECT * FROM items").map((r) => ({ ...r })), aux_items: d1.rows("SELECT * FROM aux_items").map((r) => ({ ...r })) });
  const rowsBefore = rows();
  const otherObjects = (s) => s.filter((o) => !(o.type === "table" && (o.name === "items" || o.name === "aux_items")));
  const before = schema(d1);
  d1.exec(SQL);
  // The two tables gain exactly the new columns, appended, nullable, with no default.
  for (const [t, added] of Object.entries(NEW_COLS)) {
    const now = tableInfo(d1, t);
    assert.deepEqual(now.slice(0, info[t].length), info[t], `${t}: old columns unchanged`);
    assert.deepEqual(now.slice(info[t].length), added.map((name) => ({ name, type: name === "story_of" ? "INTEGER" : "TEXT", notnull: 0, dflt_value: null, pk: 0 })),
      `${t}: the new columns`);
  }
  // Old rows keep every value and read NULL in the new columns (no backfill in SQL).
  const after = rows();
  for (const t of Object.keys(NEW_COLS)) {
    assert.equal(after[t].length, 1);
    const { story_key, story_of, url_key, ...rest } = after[t][0];
    assert.deepEqual(rest, rowsBefore[t][0], `${t}: old values unchanged`);
    assert.equal(story_key, null);
    assert.equal(story_of, null);
    if (t === "aux_items") assert.equal(url_key, null);
    else assert.equal(url_key, undefined, "coverage has no url_key");
  }
  // Every other table, index and trigger is unchanged; the only new objects are the 5 indexes.
  const afterSchema = schema(d1);
  const added = afterSchema.filter((o) => !before.some((b) => b.type === o.type && b.name === o.name));
  assert.deepEqual(added.map((o) => o.name).sort(), NEW_INDEXES.map((i) => i.name));
  assert.deepEqual(otherObjects(afterSchema).filter((o) => !added.includes(o)), otherObjects(before));
});

test("the full migration set has the columns on the right tables", () => {
  const d1 = zenithDb();
  const story = (t) => cols(d1, t).filter((c) => ["story_key", "url_key", "story_of"].includes(c));
  assert.deepEqual(story("items"), ["story_key", "story_of"], "coverage: no url_key");
  assert.deepEqual(story("aux_items"), ["story_key", "url_key", "story_of"]);
});

test("the 5 partial indexes, their columns and their WHERE clauses", () => {
  const d1 = zenithDb();
  const idx = d1.rows(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'
    AND (name LIKE '%story%' OR name LIKE '%url_key%') ORDER BY name`).map((r) => ({ ...r }));
  assert.deepEqual(idx.map((r) => r.name), NEW_INDEXES.map((i) => i.name), "the live S2 check sees exactly 5");
  for (const want of NEW_INDEXES) {
    const row = idx.find((r) => r.name === want.name);
    assert.equal(row.tbl_name, want.tbl, want.name);
    assert.deepEqual(d1.rows(`SELECT name FROM pragma_index_info('${want.name}') ORDER BY seqno`).map((r) => r.name), want.cols, want.name);
    assert.match(row.sql, new RegExp(`WHERE ${want.where}$`), `${want.name} is partial`);
    const list = d1.rows(`SELECT name, "unique", partial FROM pragma_index_list('${want.tbl}') WHERE name = '${want.name}'`).map((r) => ({ ...r }));
    assert.deepEqual(list, [{ name: want.name, unique: 0, partial: 1 }], `${want.name}: partial, not unique`);
  }
});

test("rows written without the new columns read NULL and add no index entry", () => {
  const d1 = zenithDb();
  for (let id = 1; id <= 3; id++) { item(d1, id); auxItem(d1, id); }
  assert.deepEqual(get(d1, "SELECT story_key, story_of FROM items WHERE id = 1"), { story_key: null, story_of: null });
  assert.deepEqual(get(d1, "SELECT story_key, url_key, story_of FROM aux_items WHERE id = 1"), { story_key: null, url_key: null, story_of: null });
  // The live S3 check: a count the partial index answers, 0 before any key is written.
  for (const [t, ix] of [["items", "idx_items_story_key"], ["aux_items", "aux_items_story_key"]]) {
    const sql = `SELECT COUNT(*) AS n FROM ${t} WHERE story_key IS NOT NULL`;
    assert.equal(get(d1, sql).n, 0);
    assert.match(plan(d1, sql), new RegExp(`USING (COVERING )?INDEX ${ix}\\b`));
  }
});

test("keys are not unique: copies share a story_key and point at one canonical", () => {
  const d1 = zenithDb();
  const key = "t:0000000000000000"; // synthetic shape, not a real digest
  item(d1, 1, { story_key: key });
  item(d1, 2, { story_key: key, story_of: 1, state: "skipped", skip_reason: "story_dup" });
  item(d1, 3, { story_key: key, story_of: 1, state: "skipped", skip_reason: "story_dup" });
  auxItem(d1, 1, { story_key: key, url_key: "u:0000000000000000" });
  auxItem(d1, 2, { story_key: key, url_key: "u:0000000000000000", story_of: 1, state: "skipped", skip_reason: "story_dup" });
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM items WHERE story_key = ?", key).n, 3);
  assert.deepEqual(d1.rows("SELECT id FROM items WHERE story_of = 1 ORDER BY id").map((r) => r.id), [2, 3]);
  assert.deepEqual(d1.rows("SELECT id FROM aux_items WHERE story_of = 1").map((r) => r.id), [2]);
  // story_of is a plain integer: no foreign key, so a dangling link is stored (the orphan pass repairs it).
  item(d1, 4, { story_key: key, story_of: 999 });
  assert.equal(get(d1, "SELECT story_of FROM items WHERE id = 4").story_of, 999);
});

test("the dedup lookups Part B plans are index-backed", () => {
  const d1 = zenithDb();
  // findCanonicals, coverage form.
  assert.match(plan(d1, `SELECT id FROM items WHERE nm_first_seen >= ?3 AND state != 'skipped' AND story_of IS NULL
    AND story_key IN (SELECT value FROM json_each(?1))`), /INDEX idx_items_story_key \(story_key=\? AND nm_first_seen>\?\)/);
  // findCanonicals, aux form (story_key OR url_key).
  const aux = plan(d1, `SELECT id FROM aux_items WHERE nm_first_seen >= ?3 AND state != 'skipped' AND story_of IS NULL
    AND (story_key IN (SELECT value FROM json_each(?1)) OR url_key IN (SELECT value FROM json_each(?2)))`);
  assert.match(aux, /INDEX aux_items_story_key \(story_key=\? AND nm_first_seen>\?\)/);
  assert.match(aux, /INDEX aux_items_url_key \(url_key=\? AND nm_first_seen>\?\)/);
  // The copies of one canonical, and of a set of canonicals.
  for (const [t, ix] of [["items", "idx_items_story_of"], ["aux_items", "aux_items_story_of"]]) {
    assert.match(plan(d1, `SELECT id FROM ${t} WHERE story_of = ?1`), new RegExp(`INDEX ${ix} \\(story_of=\\?\\)`));
    assert.match(plan(d1, `SELECT story_of, COUNT(*) FROM ${t} WHERE story_of IN (SELECT value FROM json_each(?1)) GROUP BY story_of`),
      new RegExp(`INDEX ${ix} \\(story_of=\\?\\)`));
  }
});

test("the migration holds shapes only, no data", () => {
  // Public repo: comments describe key shapes with <placeholders>; no hosts, digests, tickers or ids.
  assert.doesNotMatch(SQL, /https?:\/\//, "no URL");
  assert.doesNotMatch(SQL, /\b[0-9a-f]{12,}\b/i, "no digest");
  assert.doesNotMatch(SQL, /\b(sec|piid|lgs|t|u):[A-Za-z0-9]/, "every key after its prefix is a <placeholder>");
  assert.doesNotMatch(SQL.replace(/^-- 0019:/, ""), /\b\d{4,}\b/, "no row id");
});
