// Phase 2, Part A, PR-A1: migration 0020 (the shadow page-read columns on aux_items and
// items.excerpt_cap). Schema only: no Worker code reads or writes these yet. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hookJsonImports, FakeD1, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0020_text.sql";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");
const AT = "2026-01-15T00:00:00Z";
const col = (name, type, over = {}) => ({ name, type, notnull: 0, dflt_value: null, pk: 0, ...over });
const NEW_COLS = {
  aux_items: [col("page_excerpt", "TEXT"), col("page_status", "TEXT"), col("page_tries", "INTEGER", { notnull: 1, dflt_value: "0" }),
    col("page_next_at", "TEXT"), col("page_at", "TEXT"), col("page_cap", "INTEGER")],
  items: [col("excerpt_cap", "INTEGER")],
};
const NEW_NAMES = Object.values(NEW_COLS).flat().map((c) => c.name);

const tableInfo = (d1, table) => d1.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`)
  .map((r) => ({ ...r }));
const cols = (d1, table) => tableInfo(d1, table).map((r) => r.name);
const run = (d1, sql, ...args) => d1.db.prepare(sql).run(...args);
const get = (d1, sql, ...args) => ({ ...d1.db.prepare(sql).get(...args) });
const schema = (d1) => d1.rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").map((r) => ({ ...r }));
const tablesOf = (d1) => d1.rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);

// A zenith-db built from the migrations before 0020 only.
function before0020() {
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

// The aux INSERT shape the existing API tests use: it names its columns and sets no page_* value.
function auxInsert(d1, n, over = {}) {
  const it = { source_key: "testaux", entity_key: "testent", entity_name: "Testent (private)", status: "private", url: `https://news.example.com/a/${n}`,
    title: `Auxiliary item ${n}`, published: AT, nm_first_seen: AT, state: "pending", skip_reason: null, excerpt: null, excerpt_status: null, attempts: 0,
    claim_id: null, claimed_until: null, coverage_subject: 0, affects: null, ...over };
  const r = d1.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, skip_reason, excerpt, excerpt_status, attempts, claim_id, claimed_until, coverage_subject, affects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(n, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.published, it.nm_first_seen, AT, it.state,
      it.skip_reason, it.excerpt, it.excerpt_status, it.attempts, it.claim_id, it.claimed_until, it.coverage_subject, it.affects);
  return Number(r.lastInsertRowid);
}

test("0020 directly follows 0019 and is additive only: 7 columns, no table, no index", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(MIGRATION));
  assert.equal(files.filter((f) => f.startsWith("0020_")).length, 1, "one 0020 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0019_story_dedup.sql") + 1, "0020 directly follows 0019");
  const stmts = SQL.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const s of stmts) assert.match(s, /^ALTER TABLE (items|aux_items) ADD COLUMN \w+ (TEXT|INTEGER)( NOT NULL DEFAULT 0)?$/, `only ADD COLUMN: ${s.slice(0, 60)}`);
  assert.equal(stmts.length, 7, "7 columns");
  assert.equal(stmts.filter((s) => /^ALTER TABLE aux_items /.test(s)).length, 6, "6 on aux_items");
  assert.equal(stmts.filter((s) => /^ALTER TABLE items /.test(s)).length, 1, "1 on items");
  const body = stmts.join(";\n");
  assert.doesNotMatch(body, /\b(CREATE|DROP|UPDATE|DELETE|INSERT|RENAME|CHECK|UNIQUE|REFERENCES|TRIGGER|INDEX)\b/i, "no object, constraint or data change");
  assert.equal((body.match(/NOT NULL/g) || []).length, 1, "only page_tries is NOT NULL");
  assert.match(body, /ADD COLUMN page_tries INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(body, /universe_id/, "universe_id is untouched");
});

test("0020 appends the 7 columns and leaves every old row and every other object unchanged", () => {
  const d1 = before0020();
  for (const [t, added] of Object.entries(NEW_COLS)) {
    for (const c of added) assert.ok(!cols(d1, t).includes(c.name), `${t}.${c.name} is new`);
  }
  item(d1, 1, { excerpt: "Synthetic feed text.", excerpt_status: "ok" });
  auxInsert(d1, 1, { excerpt: "Synthetic feed text.", excerpt_status: "ok" });
  auxInsert(d1, 2, { state: "skipped", skip_reason: "muted" });
  const info = { items: tableInfo(d1, "items"), aux_items: tableInfo(d1, "aux_items") };
  const rows = () => ({ items: d1.rows("SELECT * FROM items ORDER BY id").map((r) => ({ ...r })),
    aux_items: d1.rows("SELECT * FROM aux_items ORDER BY id").map((r) => ({ ...r })) });
  const rowsBefore = rows();
  const tablesBefore = tablesOf(d1);
  const otherObjects = (s) => s.filter((o) => !(o.type === "table" && (o.name === "items" || o.name === "aux_items")));
  const before = schema(d1);
  d1.exec(SQL);
  for (const [t, added] of Object.entries(NEW_COLS)) {
    const now = tableInfo(d1, t);
    assert.deepEqual(now.slice(0, info[t].length), info[t], `${t}: old columns unchanged`);
    assert.deepEqual(now.slice(info[t].length), added, `${t}: the new columns, appended`);
  }
  // Old rows keep every value; the new columns read NULL, and page_tries reads 0 (no backfill).
  const after = rows();
  for (const t of Object.keys(NEW_COLS)) {
    assert.equal(after[t].length, rowsBefore[t].length);
    after[t].forEach((r, i) => {
      const rest = { ...r };
      for (const c of NEW_NAMES) delete rest[c];
      assert.deepEqual(rest, rowsBefore[t][i], `${t} row ${r.id}: old values unchanged`);
    });
  }
  for (const r of after.aux_items) {
    assert.deepEqual({ page_excerpt: r.page_excerpt, page_status: r.page_status, page_tries: r.page_tries, page_next_at: r.page_next_at,
      page_at: r.page_at, page_cap: r.page_cap }, { page_excerpt: null, page_status: null, page_tries: 0, page_next_at: null, page_at: null, page_cap: null });
    assert.equal(r.excerpt_cap, undefined, "aux_items has no excerpt_cap");
  }
  assert.equal(after.items[0].excerpt_cap, null);
  assert.ok(!Object.keys(after.items[0]).some((k) => k.startsWith("page_")), "items has no page_* column");
  // No new table, index or trigger; every other object is byte for byte the same.
  assert.deepEqual(tablesOf(d1), tablesBefore, "no new table");
  const afterSchema = schema(d1);
  assert.deepEqual(afterSchema.filter((o) => !before.some((b) => b.type === o.type && b.name === o.name)), [], "no new object");
  assert.deepEqual(otherObjects(afterSchema), otherObjects(before));
  // The feed's excerpt keeps its meaning: the old aux row still reads its feed text.
  assert.deepEqual(get(d1, "SELECT excerpt, excerpt_status FROM aux_items WHERE id = 1"), { excerpt: "Synthetic feed text.", excerpt_status: "ok" });
});

test("no index names a new column", () => {
  const d1 = zenithDb();
  const indexed = [];
  for (const t of ["items", "aux_items"]) {
    for (const ix of d1.rows(`SELECT name FROM pragma_index_list('${t}')`).map((r) => r.name)) {
      for (const c of d1.rows(`SELECT name FROM pragma_index_info('${ix}')`).map((r) => r.name)) if (NEW_NAMES.includes(c)) indexed.push(`${ix}.${c}`);
    }
  }
  assert.deepEqual(indexed, []);
  const partial = d1.rows("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").map((r) => ({ ...r }))
    .filter((r) => NEW_NAMES.some((c) => new RegExp(`\\b${c}\\b`).test(r.sql)));
  assert.deepEqual(partial, [], "no index expression or WHERE names a new column");
});

test("the full migration set: the live S1, S2 and S3 checks", () => {
  const d1 = zenithDb();
  // S1: the LIKE pattern finds exactly the 6 page columns (aux_items had no page-prefixed column before).
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('aux_items') WHERE name LIKE 'page_%' LIMIT 10").map((r) => r.name),
    NEW_COLS.aux_items.map((c) => c.name));
  // S2
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('items') WHERE name = 'excerpt_cap' LIMIT 1").map((r) => r.name), ["excerpt_cap"]);
  assert.deepEqual(d1.rows("SELECT name FROM pragma_table_info('items') WHERE name LIKE 'page_%'").map((r) => r.name), []);
  // S3: rows written the existing way carry no page data.
  for (let n = 1; n <= 3; n++) auxInsert(d1, n);
  item(d1, 1);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM aux_items WHERE page_status IS NOT NULL OR page_tries != 0 LIMIT 1").n, 0);
  assert.equal(get(d1, "SELECT COUNT(*) AS n FROM items WHERE excerpt_cap IS NOT NULL").n, 0);
});

test("the existing aux INSERT shape still works and the columns take later values", () => {
  const d1 = zenithDb();
  const id = auxInsert(d1, 1);
  assert.equal(get(d1, "SELECT page_tries FROM aux_items WHERE id = ?", id).page_tries, 0);
  run(d1, "UPDATE aux_items SET page_excerpt = ?, page_status = 'ok', page_tries = 1, page_at = ?, page_cap = 6000 WHERE id = ? AND page_status IS NULL",
    "Synthetic page text.", AT, id);
  assert.deepEqual(get(d1, "SELECT page_excerpt, page_status, page_tries, page_at, page_cap, excerpt, excerpt_status FROM aux_items WHERE id = ?", id),
    { page_excerpt: "Synthetic page text.", page_status: "ok", page_tries: 1, page_at: AT, page_cap: 6000, excerpt: null, excerpt_status: null });
  run(d1, "UPDATE aux_items SET page_next_at = ? WHERE id = ?", AT, id);
  assert.equal(get(d1, "SELECT page_next_at FROM aux_items WHERE id = ?", id).page_next_at, AT);
  // page_tries is NOT NULL: an explicit NULL is refused, so a counter is never lost.
  assert.throws(() => run(d1, "UPDATE aux_items SET page_tries = NULL WHERE id = ?", id), /NOT NULL/);
  item(d1, 1);
  run(d1, "UPDATE items SET excerpt = ?, excerpt_status = 'ok', excerpt_cap = 2500 WHERE id = 1", "Synthetic excerpt.");
  assert.equal(get(d1, "SELECT excerpt_cap FROM items WHERE id = 1").excerpt_cap, 2500);
});

test("claims expose no new key", async () => {
  const env = { DB: zenithDb(), ...TOKENS };
  item(env.DB, 1, { published: AT, nm_notified: 0, state: "pending" });
  auxInsert(env.DB, 1);
  const c = await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 5, run_id: "run-text-schema" } });
  assert.equal(c.status, 200);
  assert.equal(c.body.items.length, 1);
  const a = await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 5, run_id: "run-text-schema-aux" } });
  assert.equal(a.status, 200);
  assert.equal(a.body.items.length, 1);
  for (const it of [c.body.items[0], a.body.items[0]]) {
    for (const k of NEW_NAMES) assert.ok(!(k in it), `${k} not in a claimed item`);
  }
});

test("the migration holds shapes only, no data", () => {
  // Public repo: no hosts, ids, counts or samples in the migration text.
  assert.doesNotMatch(SQL, /https?:\/\//, "no URL");
  assert.doesNotMatch(SQL, /\b[0-9a-f]{12,}\b/i, "no digest");
  assert.doesNotMatch(SQL.replace(/^-- 0020:/, ""), /\b\d{3,}\b/, "no number");
});
