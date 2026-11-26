// Phase 3, Part B, P3-B1: migration 0023 (live-row indexes for the Company page).
// Indexes only: no Worker code depends on them yet. The Company page's reads
// (Q2, Q2e, Q3) are held here as copies, since company.js arrives in a later PR,
// whose own plan test checks the real strings. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FakeD1, zenithDb, hookJsonImports } from "./helpers/worker-env.js";
import { D1, addItem, addGrade } from "./helpers/d1.js";

hookJsonImports();
const { auxFeed } = await import("../worker/src/auxiliary.js");
const { findCanonicals } = await import("../worker/src/story.js");
const { rareRoute } = await import("../worker/src/rarity.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const MIGRATION = "0023_company_indexes.sql";
const SQL = readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8");
const LIVE = "WHERE state != 'skipped'";
const INDEXES = {
  aux_items_source_live: { table: "aux_items", cols: ["source_key", "nm_first_seen"], partial: 1 },
  aux_items_entity_live: { table: "aux_items", cols: ["entity_key", "nm_first_seen"], partial: 1 },
  idx_grades_ticker_graded: { table: "grades", cols: ["ticker", "graded_at"], partial: 0 },
};

// The Company page's reads (Part B §5.2), the columns trimmed; the WHERE and
// ORDER BY clauses are the ones the plans depend on.
const AUX_COLS = `a.id, a.nm_rowid, a.source_key, a.entity_key, a.state, a.nm_first_seen, g.band, g.score`;
const Q2 = `SELECT ${AUX_COLS} FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id
  WHERE a.source_key IN (SELECT value FROM json_each(?1)) AND a.state != 'skipped' AND a.nm_first_seen >= ?2
  ORDER BY a.nm_first_seen DESC LIMIT 300`;
const Q2E = `SELECT ${AUX_COLS} FROM aux_items a LEFT JOIN aux_grades g ON g.id = a.grade_id
  WHERE a.entity_key IN (SELECT value FROM json_each(?1)) AND a.source_key NOT IN (SELECT value FROM json_each(?2))
    AND a.state != 'skipped' AND a.nm_first_seen >= ?3 LIMIT 300`;
const Q3 = `SELECT g.id, g.item_id, g.run_id, g.score, g.band, i.ticker AS item_ticker, i.title, i.nm_first_seen,
    (SELECT p.run_id FROM grades p WHERE p.id = i.grade_id) AS primary_run
  FROM grades g JOIN items i ON i.id = g.item_id
  WHERE g.ticker = ?1 AND g.graded_at >= ?2 AND g.score IS NOT NULL AND i.ticker != ?1 AND i.nm_first_seen >= ?2
  ORDER BY g.graded_at DESC LIMIT 100`;
// The same Q2 with the live states listed: the partial index's WHERE is not implied by it.
const Q2_IN = Q2.replace("a.state != 'skipped'", "a.state IN ('pending','claimed','graded')");

const statements = (sql) => sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const schema = (d1) => d1.rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").map((r) => ({ ...r }));
const planOf = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
// The real tables a plan scans in full (a json_each list is not a table).
const scans = (lines) => lines.map((l) => /^SCAN (\w+)/.exec(l)?.[1]).filter((t) => t && t !== "json_each");

function migrated({ through } = {}) {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && (!through || f < through)).sort()) {
    d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  }
  return d1;
}
const before0023 = () => migrated({ through: MIGRATION });

// Records every statement a module prepares, running it on the real fixture DB.
function recorder(inner) {
  const seen = [];
  return { seen, prepare(sql) { seen.push(sql); return inner.prepare(sql); }, batch: (s) => inner.batch(s) };
}

let nmRowid = 1;
function addAux(d1, { source = "testsrc", entity = "test_entity", state = "pending", seen, title = "Test item" }) {
  const id = nmRowid++;
  d1.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
    VALUES (?, ?, ?, 'Test Co', 'public', ?, ?, ?, ?, ?)`).run(id, source, entity, `https://example.com/aux/${id}`, title, seen, seen, state);
  return Number(d1.db.prepare("SELECT id FROM aux_items WHERE nm_rowid = ?").get(id).id);
}

test("0023 directly follows 0022 and is additive only: 3 CREATE INDEX IF NOT EXISTS, nothing else", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.filter((f) => f.startsWith("0023_")).length, 1, "one 0023 file");
  assert.equal(files.indexOf(MIGRATION), files.indexOf("0022_brief_days.sql") + 1, "0023 directly follows 0022");
  const stmts = statements(SQL);
  assert.equal(stmts.length, 3, "3 statements");
  for (const s of stmts) {
    assert.match(s, /^CREATE INDEX IF NOT EXISTS \w+ ON (aux_items|grades)\(/);
    assert.doesNotMatch(s, /\b(ALTER|DROP|UPDATE|DELETE|INSERT|RENAME|TRIGGER|TABLE|UNIQUE)\b/i, "no change to an existing object, no data");
  }
  assert.deepEqual(stmts.map((s) => /^CREATE INDEX IF NOT EXISTS (\w+)/.exec(s)[1]), Object.keys(INDEXES));
});

test("T23: after all migrations the three indexes exist, on the right columns; the two aux ones are partial on live rows", () => {
  const d1 = zenithDb();
  for (const [name, { table, cols, partial }] of Object.entries(INDEXES)) {
    const row = d1.rows("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?", name)[0];
    assert.ok(row, `${name} exists`);
    assert.equal(row.tbl_name, table, name);
    assert.deepEqual(d1.rows(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).map((r) => r.name), cols, name);
    const info = d1.rows(`SELECT "unique", partial FROM pragma_index_list('${table}') WHERE name = ?`, name)[0];
    assert.deepEqual({ ...info }, { unique: 0, partial }, name);
    if (partial) assert.ok(row.sql.endsWith(LIVE), `${name} carries ${LIVE}`);
    else assert.doesNotMatch(row.sql, /\bWHERE\b/, `${name} is a full index`);
  }
  // The older indexes on the same columns stay (other queries use them).
  for (const old of ["aux_items_source", "aux_items_entity", "aux_items_state", "idx_grades_ticker", "idx_grades_item", "idx_grades_graded_at"]) {
    assert.equal(d1.rows("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND name = ?", old)[0].n, 1, old);
  }
});

test("0023 adds only the three indexes and leaves every old object and row unchanged; a second apply is a no-op", () => {
  const d1 = before0023();
  const before = schema(d1);
  for (const name of Object.keys(INDEXES)) assert.ok(!before.some((o) => o.name === name), `${name} is new`);
  const id = addAux(d1, { seen: "2026-01-05T12:00:00.000Z" });
  addAux(d1, { state: "skipped", seen: "2026-01-05T13:00:00.000Z" });
  const auxBefore = d1.rows("SELECT * FROM aux_items ORDER BY id").map((r) => ({ ...r }));
  d1.exec(SQL);
  const after = schema(d1);
  const added = after.filter((o) => !before.some((b) => b.type === o.type && b.name === o.name));
  assert.deepEqual(added.map((o) => `${o.type}:${o.name}`).sort(), Object.keys(INDEXES).map((n) => `index:${n}`).sort(), "only the 3 indexes");
  assert.deepEqual(after.filter((o) => !(o.name in INDEXES)), before, "every other object is the same");
  assert.deepEqual(d1.rows("SELECT * FROM aux_items ORDER BY id").map((r) => ({ ...r })), auxBefore, "old rows unchanged");
  // Built over the rows already there: the partial index holds the live row only.
  assert.deepEqual(d1.rows("SELECT id FROM aux_items INDEXED BY aux_items_source_live WHERE source_key = 'testsrc' AND state != 'skipped'")
    .map((r) => r.id), [id]);
  // IF NOT EXISTS: applying the file again changes nothing.
  d1.exec(SQL);
  assert.deepEqual(schema(d1), after);
});

test("T23: the Company page's Q2, Q2e and Q3 shapes use the new indexes, bounded by the window, with no table scan", () => {
  const db = zenithDb().db;
  const want = [
    ["Q2", Q2, /^SEARCH a USING INDEX aux_items_source_live \(source_key=\? AND nm_first_seen>\?\)$/],
    ["Q2e", Q2E, /^SEARCH a USING INDEX aux_items_entity_live \(entity_key=\? AND nm_first_seen>\?\)$/],
    ["Q3", Q3, /^SEARCH g USING INDEX idx_grades_ticker_graded \(ticker=\? AND graded_at>\?\)$/],
  ];
  for (const [name, sql, first] of want) {
    const lines = planOf(db, sql);
    assert.match(lines[0], first, `${name}: ${lines.join(" | ")}`);
    assert.deepEqual(scans(lines), [], `${name}: no SCAN of aux_items, grades or items`);
  }
  // Q3's ORDER BY graded_at DESC comes from the index: no sort step.
  assert.doesNotMatch(planOf(db, Q3).join("\n"), /TEMP B-TREE/);
});

test("before 0023 the same shapes used the older, unbounded indexes (why the migration exists)", () => {
  const db = before0023().db;
  assert.match(planOf(db, Q2)[0], /^SEARCH a USING INDEX aux_items_source \(source_key=\?\)$/);
  assert.match(planOf(db, Q2E)[0], /^SEARCH a USING INDEX aux_items_entity \(entity_key=\?\)$/);
  assert.match(planOf(db, Q3)[0], /^SEARCH g USING INDEX idx_grades_ticker \(ticker=\?\)$/);
});

test("code fact: the IN ('pending','claimed','graded') form does not use the partial index, so Q2 must say state != 'skipped'", () => {
  for (const db of [before0023().db, zenithDb().db]) {
    const lines = planOf(db, Q2_IN);
    assert.doesNotMatch(lines.join("\n"), /aux_items_source_live|aux_items_entity_live/, lines.join(" | "));
    assert.match(lines[0], /USING INDEX aux_items_state /, lines.join(" | "));
  }
});

test("Q2, Q2e and Q3 return the right synthetic rows through the new indexes", async () => {
  const d1 = zenithDb();
  const since = "2026-01-01T00:00:00.000Z";
  const own = addAux(d1, { source: "testsrc", seen: "2026-01-05T12:00:00.000Z" });
  const ownLater = addAux(d1, { source: "testsrc", state: "graded", seen: "2026-01-06T12:00:00.000Z" });
  addAux(d1, { source: "testsrc", state: "skipped", seen: "2026-01-06T13:00:00.000Z" });
  addAux(d1, { source: "testsrc", seen: "2025-12-20T12:00:00.000Z" });
  addAux(d1, { source: "othersrc", entity: "test_rival", state: "skipped", seen: "2026-01-05T12:00:00.000Z" });
  const rival = addAux(d1, { source: "othersrc", entity: "test_rival", state: "claimed", seen: "2026-01-04T12:00:00.000Z" });
  addAux(d1, { source: "testsrc", entity: "test_rival", seen: "2026-01-04T13:00:00.000Z" });
  const q2 = (await d1.prepare(Q2).bind(JSON.stringify(["testsrc"]), since).all()).results.map((r) => r.id);
  assert.deepEqual(q2.slice(0, 2), [ownLater, own], "newest first, live only, inside the window");
  assert.equal(q2.length, 3, "the in-window live row of the rival entity on the same source is a Q2 row too");
  const q2e = (await d1.prepare(Q2E).bind(JSON.stringify(["test_rival"]), JSON.stringify(["testsrc"]), since).all()).results.map((r) => r.id);
  assert.deepEqual(q2e, [rival], "rival rows from other sources, live only");

  const db = new D1();
  const otherItem = await addItem(db, { ticker: "TSTB", nm_first_seen: "2026-01-05T12:00:00.000Z" });
  await addGrade(db, otherItem, { ticker: "TSTB", run_id: "run-1", graded_at: "2026-01-05T13:00:00.000Z" });
  await addGrade(db, otherItem, { ticker: "TST", run_id: "run-1", score: 75, graded_at: "2026-01-05T13:00:01.000Z" });
  await addGrade(db, otherItem, { ticker: "TST", run_id: "run-0", score: 60, graded_at: "2025-12-01T00:00:00.000Z" });
  const ownItem = await addItem(db, { ticker: "TST", nm_first_seen: "2026-01-05T12:00:00.000Z" });
  await addGrade(db, ownItem, { ticker: "TST", graded_at: "2026-01-05T14:00:00.000Z" });
  const q3 = (await db.prepare(Q3).bind("TST", since).all()).results;
  assert.deepEqual(q3.map((r) => [r.item_id, r.item_ticker, r.score]), [[otherItem, "TSTB", 75]], "another name's item graded for T, in the window");
});

test("T23 plan record: existing queries keep their indexes; none becomes a SCAN where it was a SEARCH", async () => {
  const before = before0023(), after = zenithDb();
  // The real statements of existing code, captured from a run on the migrated fixture.
  const rec = recorder(after);
  await auxFeed({ DB: rec }, new URL("https://example.com/v1/aux/feed?entity=Test%20Co"));
  await auxFeed({ DB: rec }, new URL("https://example.com/v1/aux/feed?order=newest"));
  await findCanonicals(rec, "aux", { storyKeys: ["k1"], urlKeys: ["u1"], since: "2026-01-01T00:00:00.000Z" });
  await rareRoute({ DB: rec }, new URL("https://example.com/v1/rare?days=14"), { muted: MUTED_SQL });
  const real = [...new Set(rec.seen)].filter((s) => /\bFROM (aux_items|grades)\b/.test(s));
  assert.ok(real.length >= 4, "the aux feed, story copy and rarity reads were captured");
  for (const sql of real) {
    const was = planOf(before.db, sql), now = planOf(after.db, sql);
    assert.deepEqual(scans(now).filter((t) => !scans(was).includes(t)), [], `no new SCAN:\n${was.join(" | ")}\n${now.join(" | ")}`);
  }
  // The story copy read keeps its own keys; the rarity read keeps graded_at.
  const story = real.find((s) => /story_key IN/.test(s) && /FROM aux_items WHERE/.test(s));
  assert.match(planOf(after.db, story).join("\n"), /aux_items_story_key \(story_key=\? AND nm_first_seen>\?\)/);
  const rare = real.find((s) => /FROM grades g JOIN items i/.test(s));
  assert.match(planOf(after.db, rare)[0], /^SEARCH g USING INDEX idx_grades_graded_at \(graded_at>\?\)$/);

  // The aux feed's main read. Before 0023 it scans the table; after, the entity
  // feed and the default feed scan the matching live-row index instead, which
  // holds only live rows (`scans()` keeps only the alias, so it is spelled out
  // here). With skipped rows included, the plan stays a table scan.
  const feeds = [
    ["entity feed", "?entity=Test%20Co", /^SCAN i USING INDEX aux_items_entity_live$/],
    ["default feed", "?order=newest", /^SCAN i USING INDEX aux_items_source_live$/],
    ["feed with skipped rows", "?order=newest&include_skipped=1", /^SCAN i$/],
  ];
  for (const [name, query, now] of feeds) {
    const one = recorder(after);
    await auxFeed({ DB: one }, new URL(`https://example.com/v1/aux/feed${query}`));
    const main = one.seen.find((s) => /\bFROM aux_items i\b/.test(s));
    assert.ok(main, `${name}: main read captured`);
    assert.equal(planOf(before.db, main)[0], "SCAN i", `${name} before`);
    assert.match(planOf(after.db, main)[0], now, `${name} after`);
  }

  // Shapes held as copies: an entity_key filter on live rows moves to the partial
  // index; the grader's pending and per-item reads keep their indexes.
  const shapes = [
    ["entity_key on live rows", "SELECT i.id FROM aux_items i WHERE i.entity_key = ? AND i.state != 'skipped' ORDER BY i.nm_rowid DESC LIMIT 50",
      /aux_items_entity \(entity_key=\?\)/, /aux_items_entity_live \(entity_key=\?\)/],
    ["pending aux rows", "SELECT id FROM aux_items WHERE state = 'pending' ORDER BY nm_first_seen LIMIT 10",
      /aux_items_state \(state=\?\)/, /aux_items_state \(state=\?\)/],
    ["one source's pending rows", "SELECT id FROM aux_items WHERE source_key = ? AND state = 'pending' LIMIT 10",
      /aux_items_source \(source_key=\? AND state=\?\)/, /aux_items_source \(source_key=\? AND state=\?\)/],
    ["an item's grades", "SELECT id, ticker FROM grades WHERE item_id = ? ORDER BY id DESC LIMIT 5",
      /idx_grades_item \(item_id=\?\)/, /idx_grades_item \(item_id=\?\)/],
  ];
  for (const [name, sql, was, now] of shapes) {
    assert.match(planOf(before.db, sql).join("\n"), was, `${name} before`);
    assert.match(planOf(after.db, sql).join("\n"), now, `${name} after`);
    assert.deepEqual(scans(planOf(after.db, sql)), [], name);
  }
});

test("the migration holds shapes only, no data", () => {
  // Public repo: no hosts, ids, counts or samples in the migration text.
  assert.doesNotMatch(SQL, /https?:\/\//, "no URL");
  assert.doesNotMatch(SQL, /@/, "no email");
  assert.doesNotMatch(SQL, /\b[0-9a-f]{12,}\b/i, "no digest");
  assert.doesNotMatch(SQL.replace(/^-- 0023:/, ""), /\b\d{2,}\b/, "no number");
});
