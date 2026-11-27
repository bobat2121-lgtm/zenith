// Phase 4, Part A, PR-RA1: migration 0026 (the identifier registry and entity tags).
// Schema and local query plans only (R-S1). Synthetic rows only.
// The migration must apply after 0025 or before it (wrangler applies by name), so nothing here
// assumes 0025 exists: the "without 0025" case applies every earlier file except 0025.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { zenithDb } from "./helpers/worker-env.js";

const MIGRATION = "0026_registry.sql";
const DIR = new URL("../worker/migrations/", import.meta.url);
const SQL = readFileSync(new URL(MIGRATION, DIR), "utf8");
const CODE = SQL.replace(/--[^\n]*/g, "");   // statements without comments

const TABLES = ["entities", "universe_entities", "entity_ids", "entity_edges", "registry_overrides", "item_entities", "registry_snapshots"];
const INDEXES = ["entity_ids_entity", "item_entities_entity"];
const KEYED = TABLES.filter((t) => t !== "entities");   // the six WITHOUT ROWID tables
const NOW = "2026-01-06T12:00:00.000Z";

const files = () => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
function dbFrom(list) {
  const db = new DatabaseSync(":memory:");
  for (const f of list) db.exec(readFileSync(new URL(f, DIR), "utf8"));
  return db;
}
const names = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map((r) => r.name));
const info = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all();
const cols = (db, t) => info(db, t).map((r) => r.name);
const tableSql = (t) => {
  const m = SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n\\)`, "m"));
  assert.ok(m, `CREATE TABLE ${t} in ${MIGRATION}`);
  return m[1];
};
const planOf = (db, sql) => {
  const n = (sql.match(/\?/g) || []).length;
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("x")).map((r) => r.detail).join(" | ");
};

test("registry schema: 0026 is additive and inserts no row", () => {
  assert.ok(files().includes(MIGRATION));
  assert.doesNotMatch(CODE, /\b(DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i, "schema only, additive");
  assert.match(CODE, /^\s*CREATE (TABLE|INDEX) IF NOT EXISTS/m);
  const db = zenithDb();
  for (const t of TABLES) assert.equal(db.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} starts empty`);
  // Re-running the file is harmless (IF NOT EXISTS everywhere).
  db.exec(SQL);
});

test("registry schema: 0026 creates exactly the seven tables and two indexes (9 names besides autoindexes)", () => {
  const before = files().filter((f) => f < MIGRATION);
  const a = names(dbFrom(before));
  const b = names(dbFrom([...before, MIGRATION]));
  const added = [...b].filter((n) => !a.has(n)).sort();
  assert.deepEqual(added, [...TABLES, ...INDEXES].sort());
  assert.equal(added.length, 9);
  for (const t of TABLES) assert.ok(!a.has(t), `${t} is new in 0026`);
});

test("registry schema: applies without 0025 (X-W4 order) and on the full folder in name order", () => {
  const without = files().filter((f) => f < MIGRATION && !f.startsWith("0025_"));
  const db1 = dbFrom([...without, MIGRATION]);
  const db2 = dbFrom(files());
  for (const db of [db1, db2]) {
    const n = names(db);
    for (const x of [...TABLES, ...INDEXES]) assert.ok(n.has(x), x);
  }
  for (const t of TABLES) assert.deepEqual(info(db1, t), info(db2, t), `${t} is the same with or without 0025`);
});

test("registry schema: the columns are as specified", () => {
  const db = zenithDb().db;
  assert.deepEqual(cols(db, "entities"), ["key", "kind", "name", "status", "ticker", "parent_key", "same_as", "origin", "retired_at", "created_at", "updated_at"]);
  assert.deepEqual(cols(db, "universe_entities"), ["universe_id", "entity_key", "role", "origin", "retired_at", "created_at", "updated_at"]);
  assert.deepEqual(cols(db, "entity_ids"), ["kind", "scope", "norm", "entity_key", "lens", "value", "qualifier_json", "origin", "retired_at", "created_at", "updated_at"]);
  assert.deepEqual(cols(db, "entity_edges"), ["universe_id", "from_key", "kind", "to_key", "direction", "evidence_json", "origin", "retired_at", "created_at", "updated_at"]);
  assert.deepEqual(cols(db, "registry_overrides"), ["target_kind", "target_key", "field", "value", "universe_id", "origin", "at", "retired_at"]);
  assert.deepEqual(cols(db, "item_entities"), ["pipeline", "item_id", "entity_key", "role", "method", "matched", "tagger", "tagged_at"]);
  assert.deepEqual(cols(db, "registry_snapshots"), ["version", "part", "body", "sha256", "created_at"]);
  const pk = (t) => info(db, t).filter((r) => r.pk).sort((x, y) => x.pk - y.pk).map((r) => r.name);
  assert.deepEqual(pk("entities"), ["key"]);
  assert.deepEqual(pk("universe_entities"), ["universe_id", "entity_key", "role"]);
  assert.deepEqual(pk("entity_ids"), ["kind", "scope", "norm", "entity_key", "lens"]);
  assert.deepEqual(pk("entity_edges"), ["universe_id", "from_key", "kind", "to_key"]);
  assert.deepEqual(pk("registry_overrides"), ["target_kind", "target_key", "field"]);
  assert.deepEqual(pk("item_entities"), ["pipeline", "item_id", "entity_key"]);
  assert.deepEqual(pk("registry_snapshots"), ["version", "part"]);
  const idx = (i) => db.prepare(`PRAGMA index_info(${i})`).all().map((r) => r.name);
  assert.deepEqual(idx("entity_ids_entity"), ["entity_key", "kind"]);
  assert.deepEqual(idx("item_entities_entity"), ["entity_key", "role", "item_id"]);
  assert.deepEqual(db.prepare("PRAGMA index_list(entity_edges)").all().filter((r) => r.origin === "c"), [], "no to_key index on entity_edges");
});

test("registry schema: WITHOUT ROWID on the six keyed tables; entities keeps its rowid", () => {
  const db = zenithDb().db;
  for (const t of KEYED) {
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql, /\)\s*WITHOUT ROWID\s*$/, t);
    assert.throws(() => db.prepare(`SELECT rowid FROM ${t}`).all(), /no such column/, `${t} has no rowid`);
  }
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'entities'").get().sql, /WITHOUT ROWID/);
});

test("registry schema: open vocabularies carry no CHECK (a new kind or role needs no rebuild)", () => {
  for (const [t, c] of [["entities", "kind"], ["entities", "status"], ["entity_edges", "kind"], ["universe_entities", "role"], ["entity_ids", "kind"], ["entity_ids", "scope"], ["registry_overrides", "field"]]) {
    const line = tableSql(t).split("\n").find((l) => new RegExp(`^\\s*${c}\\s`).test(l));
    assert.ok(line, `${t}.${c}`);
    assert.doesNotMatch(line.replace(/--.*/, ""), /CHECK/i, `${t}.${c}`);
  }
  const db = zenithDb().db;
  db.prepare("INSERT INTO entities (key, kind, name, status, origin, created_at, updated_at) VALUES ('tstco', 'zz_new_kind', 'Tstco', 'zz_new_status', 'admin', ?, ?)").run(NOW, NOW);
  db.prepare("INSERT INTO universe_entities (universe_id, entity_key, role, origin, created_at, updated_at) VALUES ('u1', 'tstco', 'zz_new_role', 'admin', ?, ?)").run(NOW, NOW);
  db.prepare("INSERT INTO entity_edges (universe_id, from_key, kind, to_key, origin, created_at, updated_at) VALUES ('u1', 'TST', 'zz_new_edge', 'tstco', 'admin', ?, ?)").run(NOW, NOW);
  db.prepare("INSERT INTO entity_ids (kind, scope, norm, entity_key, lens, value, origin, created_at, updated_at) VALUES ('zz_new_id', 'zz_register', 'tstco', 'tstco', 'shared', 'Tstco', 'admin', ?, ?)").run(NOW, NOW);
  db.prepare("INSERT INTO registry_overrides (target_kind, target_key, field, value, origin, at) VALUES ('entity', 'tstco', 'zz_new_field', '1', 'admin', ?)").run(NOW);
  assert.equal(db.prepare("SELECT qualifier_json q FROM entity_ids WHERE entity_key = 'tstco'").get().q, "{}");
  assert.equal(db.prepare("SELECT evidence_json e FROM entity_edges WHERE to_key = 'tstco'").get().e, "[]");
});

test("registry schema: CHECKs hold on item_entities.pipeline and role, direction, target_kind and the JSON columns", () => {
  const db = zenithDb().db;
  const tag = db.prepare("INSERT INTO item_entities (pipeline, item_id, entity_key, role, method, matched, tagger, tagged_at) VALUES (?, ?, 'TST', ?, 'name', 'display_name:tst', 'v/1', ?)");
  for (const role of ["subject", "mention", "watch", "publisher"]) tag.run("coverage", ["subject", "mention", "watch", "publisher"].indexOf(role) + 1, role, NOW);
  tag.run("aux", 1, "subject", NOW);
  assert.throws(() => tag.run("media", 9, "subject", NOW), /CHECK/);
  assert.throws(() => tag.run("coverage", 9, "owner", NOW), /CHECK/);
  assert.throws(() => tag.run("coverage", 1, "subject", NOW), /UNIQUE|PRIMARY/, "one tag per (pipeline, item, entity)");

  const edge = db.prepare("INSERT INTO entity_edges (universe_id, from_key, kind, to_key, direction, evidence_json, origin, created_at, updated_at) VALUES ('u1', ?, 'rival', 'tstco', ?, ?, 'seed:u1:test', ?, ?)");
  edge.run("TSTA", null, "[]", NOW, NOW);
  for (const [k, d] of [["TSTB", "-"], ["TSTC", "+"], ["TSTD", "±"]]) edge.run(k, d, "[]", NOW, NOW);
  assert.throws(() => edge.run("TSTE", "up", "[]", NOW, NOW), /CHECK/);
  assert.throws(() => edge.run("TSTF", null, "not json", NOW, NOW), /CHECK/);

  const ov = db.prepare("INSERT INTO registry_overrides (target_kind, target_key, field, value, origin, at) VALUES (?, 'tstco', 'same_as', 'TST', 'admin', ?)");
  for (const k of ["entity", "id", "edge"]) ov.run(k, NOW);
  assert.throws(() => ov.run("universe", NOW), /CHECK/);

  assert.throws(() => db.prepare("INSERT INTO entity_ids (kind, scope, norm, entity_key, lens, value, qualifier_json, origin, created_at, updated_at) VALUES ('alias', 'any', 'tstco', 'TST', 'u1', 'Tstco', '{bad', 'seed:u1:test', ?, ?)").run(NOW, NOW), /CHECK/);
});

test("registry schema: universe_id NOT NULL with no default on the opinion tables; none on the shared tables", () => {
  const db = zenithDb().db;
  for (const t of ["universe_entities", "entity_edges"]) {
    const u = info(db, t).find((r) => r.name === "universe_id");
    assert.ok(u, `${t}.universe_id`);
    assert.equal(u.notnull, 1, `${t}.universe_id NOT NULL`);
    assert.equal(u.dflt_value, null, `${t}.universe_id has no default`);
  }
  assert.throws(() => db.prepare("INSERT INTO universe_entities (entity_key, role, origin, created_at, updated_at) VALUES ('TST', 'covered', 'seed:u1:test', ?, ?)").run(NOW, NOW), /NOT NULL/);
  assert.throws(() => db.prepare("INSERT INTO entity_edges (from_key, kind, to_key, origin, created_at, updated_at) VALUES ('TST', 'rival', 'tstco', 'seed:u1:test', ?, ?)").run(NOW, NOW), /NOT NULL/);
  for (const t of ["entities", "entity_ids", "item_entities", "registry_snapshots"]) assert.ok(!cols(db, t).includes("universe_id"), `${t} is shared: no universe_id`);
  // registry_overrides names the universe only for edge and membership targets, so it is nullable.
  assert.equal(info(db, "registry_overrides").find((r) => r.name === "universe_id").notnull, 0);
});

test("registry schema: no coverage role in a shared table (status is a fact; roles live in universe_entities)", () => {
  const status = tableSql("entities").split("\n").find((l) => /^\s*status\s/.test(l));
  assert.doesNotMatch(status, /\b(covered|key_account|filter)\b/);
  assert.doesNotMatch(tableSql("entities"), /\b(covered|key_account|filter)\b/);
  assert.match(tableSql("universe_entities"), /covered \| aux \| key_account/);
  const db = zenithDb().db;
  assert.ok(!cols(db, "entities").some((c) => /covered|role|universe/.test(c)));
  assert.ok(!cols(db, "entity_ids").some((c) => /covered|role|universe/.test(c)));
});

test("registry schema: EXPLAIN of the registry and tagger statements uses the planned keys, with no SCAN on a hot path", () => {
  const db = zenithDb().db;
  const seen = [];
  const plan = (d, sql) => { const p = planOf(d, sql); seen.push(p); return p; };
  // Q4/Q4b sync loads of one universe.
  assert.match(plan(db, "SELECT from_key, kind, to_key, direction, evidence_json, origin, retired_at FROM entity_edges WHERE universe_id = ? LIMIT 5000"),
    /SEARCH entity_edges USING PRIMARY KEY \(universe_id=\?\)/);
  assert.match(plan(db, "SELECT entity_key, role, origin, retired_at FROM universe_entities WHERE universe_id = ? LIMIT 5000"),
    /SEARCH universe_entities USING PRIMARY KEY \(universe_id=\?\)/);
  // Q7c tags of one entity and role: the index, no temp B-tree.
  const q7c = plan(db, "SELECT pipeline, item_id, method FROM item_entities WHERE entity_key = ? AND role = ? AND item_id >= ? ORDER BY item_id DESC LIMIT 200");
  assert.match(q7c, /SEARCH item_entities USING INDEX item_entities_entity \(entity_key=\? AND role=\? AND item_id>\?\)/);
  assert.doesNotMatch(q7c, /TEMP B-TREE/);
  // Q8 tags of one item.
  assert.match(plan(db, "SELECT entity_key, role, method FROM item_entities WHERE pipeline = ? AND item_id = ? LIMIT 50"),
    /SEARCH item_entities USING PRIMARY KEY \(pipeline=\? AND item_id=\?\)/);
  // Q10/Q11 resolve a name or a scoped id.
  assert.match(plan(db, "SELECT entity_key, lens FROM entity_ids WHERE kind = ? AND scope = 'any' AND norm = ? AND retired_at IS NULL LIMIT 5"),
    /SEARCH entity_ids USING PRIMARY KEY \(kind=\? AND scope=\? AND norm=\?\)/);
  assert.match(plan(db, "SELECT entity_key FROM entity_ids WHERE kind = ? AND scope = ? AND norm = ? AND retired_at IS NULL LIMIT 2"),
    /SEARCH entity_ids USING PRIMARY KEY \(kind=\? AND scope=\? AND norm=\?\)/);
  // Ids of one entity (admin and /v1/entity).
  assert.match(plan(db, "SELECT kind, scope, norm, lens FROM entity_ids WHERE entity_key = ? LIMIT 200"), /entity_ids_entity \(entity_key=\?\)/);
  // Q12 sample pull joins the item by its key.
  assert.match(plan(db, "SELECT ie.item_id, ie.entity_key, ie.role, i.title FROM item_entities ie JOIN items i ON i.id = ie.item_id WHERE ie.pipeline = 'coverage' AND ie.role IN ('subject','mention') AND i.nm_first_seen >= ? LIMIT 6000"),
    /SEARCH i USING INTEGER PRIMARY KEY \(rowid=\?\)/);
  // Q13r retag clears an item range by the PK.
  assert.match(plan(db, "DELETE FROM item_entities WHERE pipeline = ? AND item_id BETWEEN ? AND ? AND method <> 'grade'"),
    /SEARCH item_entities USING PRIMARY KEY \(pipeline=\? AND item_id>\? AND item_id<\?\)/);
  // Q15 edges into an entity: the PK prefix (admin validation only; no to_key index).
  assert.match(plan(db, "SELECT from_key, kind FROM entity_edges WHERE universe_id = ? AND to_key = ? AND retired_at IS NULL LIMIT 50"),
    /SEARCH entity_edges USING PRIMARY KEY \(universe_id=\?\)/);
  // Q16/Q17 snapshot parts of a version: one PK range read.
  assert.match(plan(db, "SELECT part, body, sha256 FROM registry_snapshots WHERE version = ? AND (part LIKE 'shared#%' OR part = ?) LIMIT 20"),
    /SEARCH registry_snapshots USING PRIMARY KEY \(version=\?/);
  assert.match(plan(db, "SELECT body, sha256 FROM registry_snapshots WHERE version = ? AND part = 'copy'"),
    /SEARCH registry_snapshots USING PRIMARY KEY \(version=\? AND part=\?\)/);
  assert.equal(seen.length, 12);
  for (const p of seen) assert.doesNotMatch(p, /\bSCAN\b/, p);
});
