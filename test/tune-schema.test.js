// Phase 4, Part F, PR-F1: migration 0027 (owner grades on a 1-100 scale and gentle tuning).
// Schema and local query plans only (T1). Synthetic rows only.
// The migration must apply after 0025 or before it (wrangler applies by name), and needs nothing from
// 0026, so the "without" case applies every earlier file except 0025 and 0026.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { zenithDb } from "./helpers/worker-env.js";

const MIGRATION = "0027_owner_grades.sql";
const DIR = new URL("../worker/migrations/", import.meta.url);
const SQL = readFileSync(new URL(MIGRATION, DIR), "utf8");
const CODE = SQL.replace(/--[^\n]*/g, "");   // statements without comments

const TABLES = ["tune_actions", "tune_offsets", "tune_meta", "tune_history", "replay_inputs"];
const INDEXES = ["aux_feedback_time", "tune_actions_live"];
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
const pk = (db, t) => info(db, t).filter((r) => r.pk).sort((x, y) => x.pk - y.pk).map((r) => r.name);
const planOf = (db, sql) => {
  const n = (sql.match(/\?/g) || []).length;
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("x")).map((r) => r.detail).join(" | ");
};

// One coverage item, one aux item and one replay to hang synthetic rows on.
function seeded() {
  const db = zenithDb().db;
  db.prepare("INSERT INTO items (id, nm_rowid, ticker, source_key, url, title, ingested_at, nm_first_seen, state) VALUES (1, 1, 'TST', 'syn_src', 'https://example.com/a', 't', ?, ?, 'pending')").run(NOW, NOW);
  db.prepare("INSERT INTO aux_items (id, nm_rowid, entity_key, entity_name, status, source_key, url, title, ingested_at, nm_first_seen, state) VALUES (1, 1, 'syn_entity', 'Syn Entity', 'private', 'syn_aux', 'https://example.com/b', 't', ?, ?, 'pending')").run(NOW, NOW);
  db.prepare("INSERT INTO replays (id, rubric_version, base_version, kind, scope, status, armed_at, n_items) VALUES ('syn-replay-1', 'v', 'v', 'baseline', 'full', 'done', ?, 0)").run(NOW);
  return db;
}

test("tune schema: 0027 is additive (ADD COLUMN and CREATE only) and inserts no row", () => {
  assert.ok(files().includes(MIGRATION));
  assert.doesNotMatch(CODE, /\b(DROP|DELETE|UPDATE|INSERT|REPLACE|RENAME)\b/i, "schema only, additive");
  for (const line of CODE.split("\n").filter((l) => /\bALTER\b/i.test(l))) assert.match(line, /^ALTER TABLE (feedback|aux_feedback) ADD COLUMN /, line);
  assert.equal(CODE.match(/\bALTER TABLE\b/g).length, 4, "four new columns");
  const db = zenithDb();
  for (const t of TABLES) assert.equal(db.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} starts empty`);
});

test("tune schema: 0027 adds exactly the five tables and two indexes (7 names besides autoindexes)", () => {
  const before = files().filter((f) => f < MIGRATION);
  const a = names(dbFrom(before));
  const b = names(dbFrom([...before, MIGRATION]));
  const added = [...b].filter((n) => !a.has(n)).sort();
  assert.deepEqual(added, [...TABLES, ...INDEXES].sort());
  assert.equal(added.length, 7);
  // No new object, autoindexes included, matches phase 2's story-index pattern (story-schema.test.js and its
  // live S2 check select indexes LIKE '%story%' OR LIKE '%url_key%'): tune_history is WITHOUT ROWID for that.
  const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  const old = new Set(indexes(dbFrom(before)));
  const fresh = indexes(dbFrom([...before, MIGRATION])).filter((n) => !old.has(n));
  assert.deepEqual(fresh.sort(), [...INDEXES, "sqlite_autoindex_replay_inputs_1", "sqlite_autoindex_tune_meta_1", "sqlite_autoindex_tune_offsets_1"].sort());
  assert.deepEqual(fresh.filter((n) => /story|url_key/i.test(n)), []);
  assert.match(dbFrom([...before, MIGRATION]).prepare("SELECT sql FROM sqlite_master WHERE name = 'tune_history'").get().sql, /\)\s*WITHOUT ROWID\s*$/);
});

test("tune schema: applies without 0025 and 0026 (X-W4 order) and on the full folder in name order, with the same shape", () => {
  const without = files().filter((f) => f < MIGRATION && !f.startsWith("0025_") && !f.startsWith("0026_"));
  const db1 = dbFrom([...without, MIGRATION]);
  const db2 = dbFrom(files());
  for (const db of [db1, db2]) {
    const n = names(db);
    for (const x of [...TABLES, ...INDEXES]) assert.ok(n.has(x), x);
  }
  for (const t of [...TABLES, "feedback", "aux_feedback"]) assert.deepEqual(info(db1, t), info(db2, t), `${t} is the same either way`);
});

test("tune schema: feedback and aux_feedback gain owner_score and undo_of only, nullable, no default; existing rows read NULL", () => {
  const before = dbFrom(files().filter((f) => f < MIGRATION));
  before.prepare("INSERT INTO items (id, nm_rowid, ticker, source_key, url, title, ingested_at, nm_first_seen, state) VALUES (1, 1, 'TST', 'syn_src', 'https://example.com/a', 't', ?, ?, 'pending')").run(NOW, NOW);
  before.prepare("INSERT INTO feedback (item_id, label, created_at) VALUES (1, 'medium', ?)").run(NOW);
  const old = { feedback: cols(before, "feedback"), aux_feedback: cols(before, "aux_feedback") };
  before.exec(SQL);
  for (const t of ["feedback", "aux_feedback"]) {
    assert.deepEqual(cols(before, t), [...old[t], "owner_score", "undo_of"], t);
    for (const c of ["owner_score", "undo_of"]) {
      const r = info(before, t).find((x) => x.name === c);
      assert.equal(r.type, "INTEGER", `${t}.${c}`);
      assert.equal(r.notnull, 0, `${t}.${c} nullable`);
      assert.equal(r.dflt_value, null, `${t}.${c} no default`);
    }
  }
  assert.deepEqual({ ...before.prepare("SELECT label, owner_score, undo_of, universe_id FROM feedback").get() },
    { label: "medium", owner_score: null, undo_of: null, universe_id: "u1" }, "a legacy label keeps its row");
  // No shown_score and no withdrawn_at: an undo is a new row; the shown score is grade_id's.
  for (const t of ["feedback", "aux_feedback"]) for (const c of ["shown_score", "withdrawn_at"]) assert.ok(!cols(before, t).includes(c), `${t}.${c}`);
});

test("tune schema: owner_score accepts 1, 100 and NULL and refuses 0 and 101; the label CHECK from 0005 still holds", () => {
  const db = seeded();
  const cov = db.prepare("INSERT INTO feedback (item_id, label, owner_score, created_at) VALUES (1, ?, ?, ?)");
  const aux = db.prepare("INSERT INTO aux_feedback (item_id, label, owner_score, created_at) VALUES (1, ?, ?, ?)");
  for (const ins of [cov, aux]) {
    ins.run("noise", 1, NOW);
    ins.run("high", 100, NOW);
    ins.run("medium", null, NOW);
    assert.throws(() => ins.run("noise", 0, NOW), /CHECK/);
    assert.throws(() => ins.run("high", 101, NOW), /CHECK/);
  }
  assert.throws(() => cov.run("probe", 50, NOW), /CHECK/, "label probe still refused");
  const undo = db.prepare("INSERT INTO feedback (item_id, label, owner_score, undo_of, created_at) VALUES (1, 'medium', NULL, 2, ?)").run(NOW);
  assert.equal(db.prepare("SELECT undo_of FROM feedback WHERE id = ?").get(undo.lastInsertRowid).undo_of, 2);
});

test("tune schema: the columns and keys of the new tables are as specified", () => {
  const db = zenithDb().db;
  assert.deepEqual(cols(db, "tune_actions"), ["id", "universe_id", "kind", "pipeline", "scope_kind", "scope_key", "step", "points", "preview_json", "created_at", "actor", "undone_at"]);
  assert.deepEqual(cols(db, "tune_offsets"), ["universe_id", "pipeline", "scope_kind", "scope_key", "points", "conf", "from_grades", "from_actions", "n_grades", "n_agree", "held", "since", "computed_at"]);
  assert.deepEqual(cols(db, "tune_meta"), ["universe_id", "seen", "computed_at", "placement_on", "offsets_json", "effect_json"]);
  assert.deepEqual(cols(db, "tune_history"), ["universe_id", "day", "pipeline", "scope_kind", "scope_key", "points", "n_grades"]);
  assert.deepEqual(cols(db, "replay_inputs"), ["replay_id", "universe_id", "pipeline", "feedback_id", "owner_score", "graded_score"]);
  assert.deepEqual(pk(db, "tune_actions"), ["id"]);
  assert.deepEqual(pk(db, "tune_offsets"), ["universe_id", "pipeline", "scope_kind", "scope_key"]);
  assert.deepEqual(pk(db, "tune_meta"), ["universe_id"]);
  assert.deepEqual(pk(db, "tune_history"), ["universe_id", "day", "pipeline", "scope_kind", "scope_key"]);
  assert.deepEqual(pk(db, "replay_inputs"), ["replay_id", "pipeline", "feedback_id"]);
  const idx = (i) => db.prepare(`PRAGMA index_info(${i})`).all().map((r) => r.name);
  assert.deepEqual(idx("tune_actions_live"), ["universe_id", "undone_at", "scope_kind", "scope_key"]);
  assert.deepEqual(idx("aux_feedback_time"), ["created_at"]);
  // replay_inputs.replay_id has the type of replays.id (TEXT, 0018) and references it.
  assert.equal(info(db, "replays").find((r) => r.name === "id").type, "TEXT");
  assert.equal(info(db, "replay_inputs").find((r) => r.name === "replay_id").type, "TEXT");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_list(replay_inputs)").all().map((r) => [r.from, r.table, r.to]), [["replay_id", "replays", "id"]]);
  // No column holds text the owner wrote: ids, numbers, codes and JSON counts only.
  for (const t of TABLES) for (const c of cols(db, t)) assert.doesNotMatch(c, /note|title|why|text|email/i, `${t}.${c}`);
});

test("tune schema: universe_id is NOT NULL with no default on every new table; an INSERT without it is refused", () => {
  const db = seeded();
  for (const t of TABLES) {
    const u = info(db, t).find((r) => r.name === "universe_id");
    assert.ok(u, `${t}.universe_id`);
    assert.equal(u.notnull, 1, `${t}.universe_id NOT NULL`);
    assert.equal(u.dflt_value, null, `${t}.universe_id has no default`);
  }
  const refused = {
    tune_actions: "INSERT INTO tune_actions (kind, pipeline, scope_kind, scope_key, step, created_at, actor) VALUES ('step', 'aux', 'source', 'syn_src', -2, ?, 'app')",
    tune_offsets: "INSERT INTO tune_offsets (pipeline, scope_kind, scope_key, points, conf, from_grades, from_actions, n_grades, n_agree, since, computed_at) VALUES ('aux', 'source', 'syn_src', -2, 0, -2, 0, 3, 3, ?, ?)",
    tune_meta: "INSERT INTO tune_meta (seen, computed_at, offsets_json, effect_json) VALUES (1, ?, '{}', '{}')",
    tune_history: "INSERT INTO tune_history (day, pipeline, scope_kind, scope_key, points, n_grades) VALUES (?, 'aux', 'source', 'syn_src', -2, 3)",
    replay_inputs: "INSERT INTO replay_inputs (replay_id, pipeline, feedback_id, owner_score, graded_score) VALUES ('syn-replay-1', 'coverage', 1, ?, 70)",
  };
  for (const [t, sql] of Object.entries(refused)) {
    const n = (sql.match(/\?/g) || []).length;
    const args = t === "replay_inputs" ? [85] : Array(n).fill(NOW);
    assert.throws(() => db.prepare(sql).run(...args), /NOT NULL/, t);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} wrote nothing`);
  }
  // An explicit NULL is refused too (tune_meta's TEXT primary key would accept it without NOT NULL).
  assert.throws(() => db.prepare("INSERT INTO tune_meta (universe_id, seen, computed_at, offsets_json, effect_json) VALUES (NULL, 1, ?, '{}', '{}')").run(NOW), /NOT NULL/);
  // The existing label tables keep 0017's default: legacy INSERTs still land in u1.
  for (const t of ["feedback", "aux_feedback"]) assert.equal(info(db, t).find((r) => r.name === "universe_id").dflt_value, "'u1'", t);
});

test("tune schema: tune_actions kind checks (step, confirm, switch)", () => {
  const db = seeded();
  const ins = (kind, pipeline, scopeKind, scopeKey, step, points, preview = null) => db.prepare(
    "INSERT INTO tune_actions (universe_id, kind, pipeline, scope_kind, scope_key, step, points, preview_json, created_at, actor) VALUES ('u1', ?, ?, ?, ?, ?, ?, ?, ?, 'app')")
    .run(kind, pipeline, scopeKind, scopeKey, step, points, preview, NOW);
  // Accepted.
  ins("step", "aux", "source", "syn_src", -2, null);
  ins("step", "coverage", "topic", "TST:contract", 2, null, '{"enter":0,"leave":1}');
  ins("step", "both", "delivery", "brief_floor", 1, null);
  ins("confirm", "coverage", "source", "syn_src", null, -3.1);
  ins("confirm", "aux", "entity", "syn_entity", null, -8);
  ins("switch", "both", "delivery", "placement", -1, null);
  ins("switch", "both", "delivery", "placement", 1, null);
  // Refused.
  assert.throws(() => ins("step", "aux", "source", "syn_src", 0, null), /CHECK/, "step 0");
  assert.throws(() => ins("step", "aux", "source", "syn_src", 6, null), /CHECK/, "step out of range");
  assert.throws(() => ins("step", "aux", "source", "syn_src", null, null), /CHECK/, "step without a step");
  assert.throws(() => ins("step", "aux", "source", "syn_src", -2, -1), /CHECK/, "step with points");
  assert.throws(() => ins("confirm", "aux", "source", "syn_src", null, 1), /CHECK/, "confirm +1");
  assert.throws(() => ins("confirm", "aux", "source", "syn_src", null, 0), /CHECK/, "confirm 0");
  assert.throws(() => ins("confirm", "aux", "source", "syn_src", null, -9), /CHECK/, "confirm beyond -8");
  assert.throws(() => ins("confirm", "aux", "source", "syn_src", -2, -3), /CHECK/, "confirm with a step");
  assert.throws(() => ins("confirm", "both", "delivery", "brief_floor", null, -2), /CHECK/, "confirm on delivery");
  assert.throws(() => ins("switch", "both", "source", "syn_src", 1, null), /CHECK/, "switch on a source");
  assert.throws(() => ins("switch", "both", "delivery", "placement", 2, null), /CHECK/, "switch step 2");
  assert.throws(() => ins("mute", "aux", "source", "syn_src", -1, null), /CHECK/, "unknown kind");
  assert.throws(() => ins("step", "media", "source", "syn_src", -2, null), /CHECK/, "unknown pipeline");
  assert.throws(() => ins("step", "aux", "ticker", "TST", -2, null), /CHECK/, "unknown scope kind");
  assert.throws(() => ins("step", "aux", "source", "syn_src", -2, null, "not json"), /CHECK/, "bad preview JSON");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tune_actions").get().n, 7);
});

test("tune schema: tune_offsets, tune_meta, tune_history and replay_inputs checks", () => {
  const db = seeded();
  const off = db.prepare("INSERT INTO tune_offsets (universe_id, pipeline, scope_kind, scope_key, points, conf, from_grades, from_actions, n_grades, n_agree, since, computed_at) VALUES ('u1', ?, ?, ?, -2, ?, -2, 0, 3, 3, ?, ?)");
  off.run("aux", "source", "syn_src", 0, NOW, NOW);
  off.run("coverage", "topic", "TST:contract", -1.5, NOW, NOW);
  assert.equal(db.prepare("SELECT held FROM tune_offsets WHERE scope_key = 'syn_src'").get().held, 0, "held defaults to 0");
  assert.throws(() => off.run("aux", "entity", "syn_entity", 1, NOW, NOW), /CHECK/, "conf +1");
  assert.throws(() => off.run("both", "source", "syn_src2", 0, NOW, NOW), /CHECK/, "pipeline both is for actions only");
  assert.throws(() => off.run("aux", "delivery", "brief_floor", 0, NOW, NOW), /CHECK/, "delivery is not an offset scope");
  assert.throws(() => off.run("aux", "source", "syn_src", 0, NOW, NOW), /UNIQUE|PRIMARY/, "one row per scope");
  // The same scope in another universe is its own row.
  db.prepare("INSERT INTO tune_offsets (universe_id, pipeline, scope_kind, scope_key, points, conf, from_grades, from_actions, n_grades, n_agree, since, computed_at) VALUES ('u2', 'aux', 'source', 'syn_src', 2, 0, 2, 0, 3, 3, ?, ?)").run(NOW, NOW);

  const meta = db.prepare("INSERT INTO tune_meta (universe_id, seen, computed_at, placement_on, offsets_json, effect_json) VALUES (?, 1, ?, ?, ?, ?)");
  meta.run("u1", NOW, 1, '{"aux":{"source":{"syn_src":-2}}}', '{"held_at_line":0}');
  assert.throws(() => meta.run("u2", NOW, 1, "x", "{}"), /CHECK/, "bad offsets JSON");
  assert.throws(() => meta.run("u2", NOW, 1, "{}", "x"), /CHECK/, "bad effect JSON");
  assert.throws(() => meta.run("u2", NOW, 2, "{}", "{}"), /CHECK/, "placement_on is 0 or 1");
  assert.throws(() => meta.run("u1", NOW, 0, "{}", "{}"), /UNIQUE|PRIMARY/, "one row per universe");
  db.prepare("INSERT INTO tune_meta (universe_id, seen, computed_at, offsets_json, effect_json) VALUES ('u2', 1, ?, '{}', '{}')").run(NOW);
  assert.equal(db.prepare("SELECT placement_on FROM tune_meta WHERE universe_id = 'u2'").get().placement_on, 1, "placement on by default");

  const hist = db.prepare("INSERT INTO tune_history (universe_id, day, pipeline, scope_kind, scope_key, points, n_grades) VALUES ('u1', ?, 'aux', 'source', 'syn_src', ?, 3)");
  hist.run("2026-01-06", -2);
  hist.run("2026-01-07", 0);
  assert.throws(() => hist.run("2026-01-06", -4), /UNIQUE|PRIMARY/, "one row per scope and day");

  const fb = db.prepare("INSERT INTO feedback (item_id, label, owner_score, created_at) VALUES (1, 'medium', 85, ?)").run(NOW).lastInsertRowid;
  const ri = db.prepare("INSERT INTO replay_inputs (replay_id, universe_id, pipeline, feedback_id, owner_score, graded_score) VALUES (?, 'u1', ?, ?, ?, ?)");
  ri.run("syn-replay-1", "coverage", fb, 85, 60);
  ri.run("syn-replay-1", "aux", fb, 20, null);
  assert.throws(() => ri.run("syn-replay-1", "coverage", fb, 85, 60), /UNIQUE|PRIMARY/, "one row per replay, pipeline and feedback id");
  assert.throws(() => ri.run("syn-replay-1", "coverage", fb + 1, 0, 60), /CHECK/, "owner_score 0");
  assert.throws(() => ri.run("syn-replay-1", "coverage", fb + 1, 101, 60), /CHECK/, "owner_score 101");
  assert.throws(() => ri.run("syn-replay-1", "media", fb + 1, 50, 60), /CHECK/, "unknown pipeline");
  assert.throws(() => db.prepare("INSERT INTO replay_inputs (replay_id, universe_id, pipeline, feedback_id, graded_score) VALUES ('syn-replay-1', 'u1', 'coverage', 99, 60)").run(), /NOT NULL/, "owner_score required");
  assert.throws(() => ri.run("syn-replay-missing", "coverage", fb, 85, 60), /FOREIGN KEY/, "replay must exist (D1 enforces foreign keys)");
});

// Hand-off to P4-F7: the arm's retention trim (replay.js, REPLAY_KEEP) deletes replay_grades and
// replay_queue, then the replay. replay_inputs is the first table with a foreign key to replays, so
// that trim fails, and rolls back the whole arm batch, once the trimmed replay has inputs. The trim
// must delete replay_inputs first (and must never trim the latest passed owner_examples replay).
// No ON DELETE CASCADE: it would silently drop the live measured set when that replay ages out.
test("tune schema: a replay with inputs is deleted only after its replay_inputs rows (the arm trim order)", () => {
  const db = seeded();
  assert.deepEqual(db.prepare("PRAGMA foreign_key_list(replay_inputs)").all().map((r) => r.on_delete), ["NO ACTION"], "no cascade");
  const fb = db.prepare("INSERT INTO feedback (item_id, label, owner_score, created_at) VALUES (1, 'medium', 85, ?)").run(NOW).lastInsertRowid;
  db.prepare("INSERT INTO replay_inputs (replay_id, universe_id, pipeline, feedback_id, owner_score, graded_score) VALUES ('syn-replay-1', 'u1', 'coverage', ?, 85, 60)").run(fb);
  const batch = (tables) => {   // one transaction, as D1's db.batch
    db.exec("BEGIN");
    try {
      for (const t of tables) db.prepare(`DELETE FROM ${t} WHERE replay_id = ?`).run("syn-replay-1");
      db.prepare("DELETE FROM replays WHERE id = ?").run("syn-replay-1");
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  // main's trim order: refused, and nothing is deleted.
  assert.throws(() => batch(["replay_grades", "replay_queue"]), /FOREIGN KEY/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replays WHERE id = 'syn-replay-1'").get().n, 1, "replay kept");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replay_inputs").get().n, 1, "inputs kept");
  // replay_inputs first: the trim goes through.
  batch(["replay_inputs", "replay_grades", "replay_queue"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replays WHERE id = 'syn-replay-1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replay_inputs").get().n, 0);
});

test("tune schema: EXPLAIN of the Part F statements uses the planned keys, with no SCAN", () => {
  const db = zenithDb().db;
  const seen = [];
  const plan = (sql) => { const p = planOf(db, sql); seen.push(p); return p; };
  // The feeds read one tune_meta row per call, by its key.
  assert.match(plan("SELECT seen, computed_at, placement_on, offsets_json, effect_json FROM tune_meta WHERE universe_id = ?"),
    /SEARCH tune_meta USING INDEX sqlite_autoindex_tune_meta_1 \(universe_id=\?\)/);
  // Recompute inputs: offsets, live actions, grades in force by time, history.
  assert.match(plan("SELECT pipeline, scope_kind, scope_key, points FROM tune_offsets WHERE universe_id = ? LIMIT 500"),
    /SEARCH tune_offsets USING INDEX sqlite_autoindex_tune_offsets_1 \(universe_id=\?\)/);
  assert.match(plan("SELECT id, kind, scope_kind, scope_key, pipeline, step, points FROM tune_actions WHERE universe_id = ? AND undone_at IS NULL LIMIT 1000"),
    /SEARCH tune_actions USING INDEX tune_actions_live \(universe_id=\? AND undone_at=\?\)/);
  const cov = plan("SELECT f.id, f.item_id, f.ticker, f.label, f.owner_score, f.undo_of, i.source_key, g.score FROM feedback f JOIN items i ON i.id = f.item_id LEFT JOIN grades g ON g.id = f.grade_id WHERE f.created_at >= ? AND f.universe_id = ? LIMIT 5000");
  assert.match(cov, /SEARCH f USING INDEX idx_feedback_time \(created_at>\?\)/);
  const aux = plan("SELECT f.id, f.item_id, f.label, f.owner_score, f.undo_of, i.source_key, i.entity_key, g.score FROM aux_feedback f JOIN aux_items i ON i.id = f.item_id LEFT JOIN aux_grades g ON g.id = f.grade_id WHERE f.created_at >= ? AND f.universe_id = ? LIMIT 5000");
  assert.match(aux, /SEARCH f USING INDEX aux_feedback_time \(created_at>\?\)/);
  for (const p of [cov, aux]) {
    assert.match(p, /SEARCH i USING INTEGER PRIMARY KEY \(rowid=\?\)/);
    assert.match(p, /SEARCH g USING INTEGER PRIMARY KEY \(rowid=\?\)/);
  }
  assert.match(plan("SELECT f.id FROM aux_feedback f WHERE f.created_at >= '2026-01-01' LIMIT 10"), /SEARCH f USING (COVERING )?INDEX aux_feedback_time \(created_at>\?\)/);
  assert.match(plan("SELECT day, pipeline, scope_kind, scope_key, points FROM tune_history WHERE universe_id = ? AND day >= ? ORDER BY day LIMIT 5000"),
    /SEARCH tune_history USING PRIMARY KEY \(universe_id=\? AND day>\?\)/);
  // The frozen owner examples of one replay.
  assert.match(plan("SELECT feedback_id, owner_score, graded_score FROM replay_inputs WHERE replay_id = ? AND pipeline = ? LIMIT 100"),
    /SEARCH replay_inputs USING INDEX sqlite_autoindex_replay_inputs_1 \(replay_id=\? AND pipeline=\?\)/);
  assert.equal(seen.length, 8);
  for (const p of seen) assert.doesNotMatch(p, /\bSCAN\b/, p);
  for (const p of seen) assert.doesNotMatch(p, /TEMP B-TREE/, p);
});
