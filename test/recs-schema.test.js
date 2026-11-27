// Phase 4, Part E, PR-RE1: migration 0028 (source recommendations).
// Schema and local query plans only (R1). Synthetic rows only (Example Widgets LLC, ticker TST,
// CIK 0000000001).
// The migration must apply after 0027 or, under X-W4, before phase 3's 0025 (wrangler applies by
// name), and needs nothing from 0025, 0026 or 0027, so the "without" case applies every earlier
// file except those three.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { zenithDb } from "./helpers/worker-env.js";

const MIGRATION = "0028_recommendations.sql";
const DIR = new URL("../worker/migrations/", import.meta.url);
const SQL = readFileSync(new URL(MIGRATION, DIR), "utf8");
const CODE = SQL.replace(/--[^\n]*/g, "");   // statements without comments

const TABLES = ["recommendations", "feed_probes", "sec_seed_done"];
const INDEXES = ["rec_open", "rec_probe", "rec_candidate", "feed_probes_target"];
const NOW = "2026-01-06T12:00:00.000Z";
const ACC = "000000000126000001";   // a synthetic 18-digit accession (CIK 0000000001)

const files = () => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
function dbFrom(list) {
  const db = new DatabaseSync(":memory:");
  for (const f of list) db.exec(readFileSync(new URL(f, DIR), "utf8"));
  return db;
}
const names = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map((r) => r.name));
const info = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all();
const cols = (db, t) => info(db, t).map((r) => r.name);
const col = (db, t, c) => info(db, t).find((r) => r.name === c);
const count = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const planOf = (db, sql) => {
  const n = (sql.match(/\?/g) || []).length;
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("x")).map((r) => r.detail).join(" | ");
};

// One recommendation row; fields override the minimal valid insert.
function rec(db, fields = {}) {
  const row = { universe_id: "u1", kind: "entity", target_key: "example widgets", subject: "TST", name: "Example Widgets LLC",
    top_trigger: "sec_201", created_at: NOW, last_seen_at: NOW, ...fields };
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  return db.prepare(`INSERT INTO recommendations (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
}
function probe(db, fields = {}) {
  const row = { target_key: "example widgets", kind: "newsroom_rss", url: "https://example.com/feed", status: "ok", checked_at: NOW, ...fields };
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  return db.prepare(`INSERT INTO feed_probes (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
}

test("recs schema: 0028 is additive (one ADD COLUMN and CREATE only) and inserts no row", () => {
  assert.ok(files().includes(MIGRATION));
  assert.doesNotMatch(CODE, /\b(DROP|DELETE|UPDATE|INSERT|REPLACE|RENAME)\b/i, "schema only, additive");
  const alters = CODE.split("\n").filter((l) => /\bALTER\b/i.test(l));
  assert.deepEqual(alters, ["ALTER TABLE sec_subsidiaries ADD COLUMN accession TEXT;"]);
  const db = zenithDb().db;
  for (const t of TABLES) assert.equal(count(db, t), 0, `${t} starts empty`);
});

test("recs schema: 0028 adds exactly the three tables and four indexes (7 names besides autoindexes)", () => {
  const before = files().filter((f) => f < MIGRATION);
  const a = names(dbFrom(before));
  const b = names(dbFrom([...before, MIGRATION]));
  const added = [...b].filter((n) => !a.has(n)).sort();
  assert.deepEqual(added, [...TABLES, ...INDEXES].sort());
  assert.equal(added.length, 7);
  const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  const old = new Set(indexes(dbFrom(before)));
  const fresh = indexes(dbFrom([...before, MIGRATION])).filter((n) => !old.has(n));
  assert.deepEqual(fresh.sort(), [...INDEXES, "sqlite_autoindex_feed_probes_1", "sqlite_autoindex_recommendations_1", "sqlite_autoindex_sec_seed_done_1"].sort());
  // No new object matches phase 2's story-index pattern (story-schema.test.js and its live S2 check).
  assert.deepEqual(fresh.filter((n) => /story|url_key/i.test(n)), []);
});

test("recs schema: the PR-RE1 live check finds the 7 names and the accession column", () => {
  const db = zenithDb().db;
  const found = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('recommendations','feed_probes','sec_seed_done','rec_open','rec_probe','rec_candidate','feed_probes_target') LIMIT 10").all();
  assert.equal(found.length, 7);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sec_subsidiaries') WHERE name = 'accession' LIMIT 1").get().n, 1);
  assert.deepEqual({ ...db.prepare("SELECT (SELECT COUNT(*) FROM recommendations) AS r, (SELECT COUNT(*) FROM feed_probes) AS p LIMIT 1").get() }, { r: 0, p: 0 });
});

test("recs schema: applies without 0025, 0026 and 0027 (X-W4 order) and on the full folder in name order, with the same shape", () => {
  const without = files().filter((f) => f < MIGRATION && !/^002[567]_/.test(f));
  assert.ok(without.includes("0017_universe_audit.sql") && without.includes("0012_expansion.sql"));
  const db1 = dbFrom([...without, MIGRATION]);
  const db2 = dbFrom(files());
  for (const db of [db1, db2]) {
    const n = names(db);
    for (const x of [...TABLES, ...INDEXES]) assert.ok(n.has(x), x);
  }
  for (const t of [...TABLES, "sec_subsidiaries"]) assert.deepEqual(info(db1, t), info(db2, t), `${t} is the same either way`);
  const sqlOf = (db, n) => db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n).sql;
  for (const i of INDEXES) assert.equal(sqlOf(db1, i), sqlOf(db2, i), i);
});

test("recs schema: the columns, keys and indexes of the new tables are as specified", () => {
  const db = zenithDb().db;
  assert.deepEqual(cols(db, "recommendations"), ["id", "universe_id", "kind", "target_key", "subject", "name", "top_trigger", "triggers",
    "strength", "proposal", "evidence", "seen", "hosts", "candidate_id", "candidate_status", "candidate_decided_at", "status",
    "snooze_until", "decisions", "applied", "history", "probe_state", "probe_next_at", "created_at", "last_seen_at"]);
  assert.deepEqual(cols(db, "feed_probes"), ["id", "target_key", "kind", "url", "origin", "status", "http", "tries", "detail", "checked_at"]);
  assert.deepEqual(cols(db, "sec_seed_done"), ["accession", "cik", "outcome", "at"]);
  const pk = (t) => info(db, t).filter((r) => r.pk).map((r) => r.name);
  assert.deepEqual(pk("recommendations"), ["id"]);
  assert.deepEqual(pk("feed_probes"), ["id"]);
  assert.deepEqual(pk("sec_seed_done"), ["accession"]);
  const idx = (i) => db.prepare(`PRAGMA index_xinfo(${i})`).all().filter((r) => r.key).map((r) => (r.desc ? `${r.name} DESC` : r.name));
  assert.deepEqual(idx("rec_open"), ["universe_id", "status", "strength DESC", "last_seen_at DESC"]);
  assert.deepEqual(idx("rec_probe"), ["probe_next_at"]);
  assert.deepEqual(idx("rec_candidate"), ["candidate_id"]);
  assert.deepEqual(idx("feed_probes_target"), ["target_key", "kind"]);
  assert.deepEqual(idx("sqlite_autoindex_recommendations_1"), ["universe_id", "target_key", "subject"]);
  assert.deepEqual(idx("sqlite_autoindex_feed_probes_1"), ["target_key", "kind", "url", "origin"]);
  const sqlOf = (n) => db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n).sql;
  assert.match(sqlOf("rec_probe"), /WHERE probe_state = 'todo'$/, "rec_probe is partial");
  assert.match(sqlOf("rec_candidate"), /WHERE candidate_id IS NOT NULL$/, "rec_candidate is partial");
  assert.doesNotMatch(sqlOf("rec_open"), /WHERE/, "rec_open covers every status");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_list(recommendations)").all().map((r) => [r.from, r.table, r.to]), [["universe_id", "universes", "id"]]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_list(feed_probes)").all(), []);
  // Shared facts carry no universe_id (audit §9); the owner's websites are scoped by origin instead.
  for (const t of ["feed_probes", "sec_seed_done", "sec_subsidiaries"]) assert.ok(!cols(db, t).includes("universe_id"), `${t} is shared`);
});

test("recs schema: universe_id is NOT NULL with no default and must name a known universe", () => {
  const db = zenithDb().db;
  const u = col(db, "recommendations", "universe_id");
  assert.equal(u.notnull, 1);
  assert.equal(u.dflt_value, null, "no default: a missing bind is not filed as u1");
  assert.throws(() => db.prepare("INSERT INTO recommendations (kind, target_key, name, top_trigger, created_at, last_seen_at) VALUES ('entity', 'example widgets', 'Example Widgets LLC', 'sec_201', ?, ?)").run(NOW, NOW), /NOT NULL/);
  assert.throws(() => rec(db, { universe_id: null }), /NOT NULL/);
  assert.throws(() => rec(db, { universe_id: "u2" }), /FOREIGN KEY/, "u2 is not a universe yet (D1 enforces foreign keys)");
  assert.equal(count(db, "recommendations"), 0, "nothing was written");
  rec(db);
  db.prepare("INSERT INTO universes (id, label, created_at) VALUES ('u2', 'second', ?)").run(NOW);
  rec(db, { universe_id: "u2" });
  assert.deepEqual(db.prepare("SELECT universe_id FROM recommendations ORDER BY id").all().map((r) => r.universe_id), ["u1", "u2"]);
});

test("recs schema: one row per (universe, target, subject); a different kind for the same triple is an update", () => {
  const db = zenithDb().db;
  const id = rec(db).lastInsertRowid;
  assert.throws(() => rec(db), /UNIQUE/, "the same triple twice");
  assert.throws(() => rec(db, { kind: "edge" }), /UNIQUE/, "kind is not part of the key");
  db.prepare("UPDATE recommendations SET kind = 'edge' WHERE id = ?").run(id);
  assert.equal(db.prepare("SELECT kind FROM recommendations WHERE id = ?").get(id).kind, "edge");
  assert.equal(count(db, "recommendations"), 1);
  // Another subject, or a subject-less row, is its own row.
  rec(db, { subject: "TSTB" });
  const none = rec(db, { target_key: "class:example_miss", kind: "source_class", subject: undefined });
  assert.equal(db.prepare("SELECT subject FROM recommendations WHERE id = ?").get(none.lastInsertRowid).subject, "", "subject defaults to ''");
  // The same triple in another universe is that universe's own row.
  db.prepare("INSERT INTO universes (id, label, created_at) VALUES ('u2', 'second', ?)").run(NOW);
  rec(db, { universe_id: "u2" });
  assert.equal(count(db, "recommendations"), 4);
});

test("recs schema: recommendations defaults and CHECKs", () => {
  const db = zenithDb().db;
  const id = rec(db).lastInsertRowid;
  assert.deepEqual({ ...db.prepare("SELECT triggers, strength, proposal, evidence, seen, hosts, candidate_id, status, decisions, applied, history, probe_state, probe_next_at FROM recommendations WHERE id = ?").get(id) },
    { triggers: "[]", strength: 0, proposal: "{}", evidence: "[]", seen: "[]", hosts: "[]", candidate_id: null, status: "open",
      decisions: "[]", applied: null, history: 0, probe_state: "todo", probe_next_at: null });
  let n = 0;
  const ok = (fields) => rec(db, { target_key: `example widgets ${++n}`, ...fields });
  const bad = (fields, why) => assert.throws(() => ok(fields), /CHECK/, why);
  for (const kind of ["entity", "edge", "ids", "alias", "legistar", "source_class"]) ok({ kind });
  bad({ kind: "feed" }, "unknown kind");
  for (const status of ["open", "approved", "rejected", "snoozed", "known"]) ok({ status });
  bad({ status: "pending" }, "unknown status");
  ok({ strength: 100 });
  bad({ strength: -1 }, "strength below 0");
  bad({ strength: 101 }, "strength above 100");
  for (const c of ["triggers", "proposal", "evidence", "seen", "hosts", "decisions"]) {
    ok({ [c]: c === "proposal" ? '{"entity":{"name":"Example Widgets LLC"}}' : '[{"kind":"x"}]' });
    bad({ [c]: "not json" }, `${c} must be JSON`);
  }
  ok({ applied: '{"version":"v1","rows":[]}' });
  bad({ applied: "not json" }, "applied must be JSON when set");
  ok({ history: 1 });
  bad({ history: 2 }, "history is 0 or 1");
  for (const probe_state of ["todo", "done", "none"]) ok({ probe_state });
  bad({ probe_state: "due" }, "unknown probe_state");
  for (const c of ["name", "top_trigger", "created_at", "last_seen_at", "target_key"]) {
    assert.throws(() => rec(db, { target_key: `example widgets ${++n}`, [c]: null }), /NOT NULL/, `${c} is required`);
  }
});

test("recs schema: feed_probes defaults, CHECKs and its key (owner websites are their own rows)", () => {
  const db = zenithDb().db;
  const id = probe(db).lastInsertRowid;
  assert.deepEqual({ ...db.prepare("SELECT origin, tries, http, detail FROM feed_probes WHERE id = ?").get(id) }, { origin: "auto", tries: 0, http: null, detail: null });
  assert.throws(() => probe(db), /UNIQUE/, "one row per (target, kind, url, origin)");
  probe(db, { origin: "owner:u1" });
  probe(db, { kind: "ir_page" });
  probe(db, { url: "https://example.com/news.xml" });
  for (const kind of ["robots", "sec_cik", "legistar_client"]) probe(db, { kind, url: `https://example.com/${kind}` });
  assert.throws(() => probe(db, { kind: "gdelt", url: "https://example.com/g" }), /CHECK/, "unknown kind");
  for (const status of ["possible", "not_found", "robots", "blocked", "error", "not_feed", "off_domain"]) probe(db, { url: `https://example.com/${status}`, status });
  assert.throws(() => probe(db, { url: "https://example.com/c", status: "capped" }), /CHECK/, "unknown status");
  probe(db, { url: "https://example.com/d", detail: '{"slug":"exampleville","why":"200"}', http: 200, tries: 1 });
  assert.throws(() => probe(db, { url: "https://example.com/e", detail: "not json" }), /CHECK/, "detail must be JSON when set");
  for (const c of ["target_key", "url", "status", "checked_at"]) {
    assert.throws(() => probe(db, { url: `https://example.com/n-${c}`, [c]: null }), /NOT NULL/, `${c} is required`);
  }
  assert.equal(count(db, "feed_probes"), 15);
});

test("recs schema: sec_seed_done accepts only 18-character accessions, once each", () => {
  const db = zenithDb().db;
  const ins = db.prepare("INSERT INTO sec_seed_done (accession, cik, outcome, at) VALUES (?, '0000000001', ?, ?)");
  ins.run(ACC, "read", NOW);
  ins.run("000000000126000002", "skipped", NOW);
  ins.run("000000000126000003", "failed", NOW);
  assert.throws(() => ins.run(ACC, "read", NOW), /UNIQUE|PRIMARY/, "one row per accession");
  assert.throws(() => ins.run("00000000012600000", "read", NOW), /CHECK/, "17 characters");
  assert.throws(() => ins.run("0000000001260000011", "read", NOW), /CHECK/, "19 characters");
  assert.throws(() => ins.run("0000000001-26-000004", "read", NOW), /CHECK/, "the dashed form is not stored");
  assert.throws(() => ins.run(null, "read", NOW), /NOT NULL/, "a NULL accession is refused (a TEXT primary key accepts NULL otherwise)");
  assert.throws(() => ins.run("000000000126000005", "queued", NOW), /CHECK/, "unknown outcome");
  assert.throws(() => db.prepare("INSERT INTO sec_seed_done (accession, outcome, at) VALUES (?, 'read', ?)").run("000000000126000006", NOW), /NOT NULL/, "cik is required");
  assert.equal(count(db, "sec_seed_done"), 3);
});

test("recs schema: sec_subsidiaries gains a nullable accession; old rows read NULL; item_id 0 is the accession-only sentinel", () => {
  const before = dbFrom(files().filter((f) => f < MIGRATION));
  const ins = "INSERT INTO sec_subsidiaries (cik, ticker, names, item_id, filed, updated_at) VALUES (?, 'TST', '[\"example widgets\"]', ?, '2026-01-05', ?)";
  before.prepare(ins).run("1", 7, NOW);
  const old = cols(before, "sec_subsidiaries");
  before.exec(SQL);
  assert.deepEqual(cols(before, "sec_subsidiaries"), [...old, "accession"]);
  const c = col(before, "sec_subsidiaries", "accession");
  assert.equal(c.type, "TEXT");
  assert.equal(c.notnull, 0, "nullable");
  assert.equal(c.dflt_value, null, "no default");
  assert.deepEqual({ ...before.prepare("SELECT item_id, accession FROM sec_subsidiaries WHERE cik = '1'").get() }, { item_id: 7, accession: null }, "an existing baseline keeps its row");
  // The current writer's INSERT (no accession) still works, and the reader's SELECT is unchanged.
  before.prepare(ins).run("2", 8, NOW);
  assert.deepEqual({ ...before.prepare("SELECT names, filed FROM sec_subsidiaries WHERE cik = ?").get("2") }, { names: '["example widgets"]', filed: "2026-01-05" });
  // A baseline read from a filing with no zenith item.
  before.prepare("INSERT INTO sec_subsidiaries (cik, ticker, names, item_id, filed, updated_at, accession) VALUES ('3', 'TST', '[]', 0, '2026-01-05', ?, ?)").run(NOW, ACC);
  assert.equal(before.prepare("SELECT accession FROM sec_subsidiaries WHERE cik = '3'").get().accession, ACC);
  assert.throws(() => before.prepare("INSERT INTO sec_subsidiaries (cik, ticker, names, item_id, filed, updated_at) VALUES ('4', 'TST', '[]', NULL, '2026-01-05', ?)").run(NOW), /NOT NULL/, "item_id stays NOT NULL");
});

test("recs schema: EXPLAIN of the Part E statements uses the planned keys, with no SCAN", () => {
  const db = zenithDb().db;
  const seen = [];
  const plan = (sql) => { const p = planOf(db, sql); seen.push(p); return p; };
  // N1: the panel's open list.
  assert.match(plan("SELECT id, kind, name, subject, strength, status FROM recommendations WHERE universe_id = ? AND status = ? ORDER BY strength DESC, last_seen_at DESC LIMIT 30"),
    /SEARCH recommendations USING INDEX rec_open \(universe_id=\? AND status=\?\)/);
  // N2: counts by status.
  assert.match(plan("SELECT status, COUNT(*) AS n FROM recommendations WHERE universe_id = ? GROUP BY status LIMIT 10"),
    /SEARCH recommendations USING COVERING INDEX rec_open \(universe_id=\?\)/);
  // N3: the upsert lookup.
  assert.match(plan("SELECT id, kind, seen, hosts FROM recommendations WHERE universe_id = ? AND target_key = ? AND subject = ? LIMIT 1"),
    /SEARCH recommendations USING INDEX sqlite_autoindex_recommendations_1 \(universe_id=\? AND target_key=\? AND subject=\?\)/);
  // N4: probes due (the partial index needs the probe_state literal).
  assert.match(plan("SELECT id, target_key, kind FROM recommendations WHERE probe_state = 'todo' AND probe_next_at <= ? ORDER BY probe_next_at LIMIT 3"),
    /SEARCH recommendations USING INDEX rec_probe \(probe_next_at<\?\)/);
  // The u1 mirror by candidate.
  assert.match(plan("SELECT id, candidate_status FROM recommendations WHERE candidate_id = ? LIMIT 1"),
    /SEARCH recommendations USING INDEX rec_candidate \(candidate_id=\?\)/);
  // N6: probes of the shown rows.
  assert.match(plan("SELECT id, kind, url, status, detail FROM feed_probes WHERE target_key = ? AND (origin = 'auto' OR origin = ?) LIMIT 60"),
    /SEARCH feed_probes USING INDEX feed_probes_target \(target_key=\?\)/);
  // N7: decide by id.
  assert.match(plan("SELECT id, status, applied FROM recommendations WHERE id = ? AND universe_id = ? LIMIT 1"),
    /SEARCH recommendations USING INTEGER PRIMARY KEY \(rowid=\?\)/);
  // N9: the seed's membership test.
  assert.match(plan("SELECT 1 FROM sec_seed_done WHERE accession = ? LIMIT 1"),
    /SEARCH sec_seed_done USING (COVERING )?INDEX sqlite_autoindex_sec_seed_done_1 \(accession=\?\)/);
  assert.equal(seen.length, 8);
  for (const p of seen) assert.doesNotMatch(p, /\bSCAN\b/, p);
});
