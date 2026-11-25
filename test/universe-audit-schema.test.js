// Phase 1, Part A, PR-U1: migration 0017 (universe_id on the per-analyst tables,
// the universes table and the append-only audit_log). Schema only: no Worker
// code reads or writes these yet. Synthetic rows and synthetic actors only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hookJsonImports, FakeD1, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");

const MIGRATIONS = new URL("../worker/migrations/", import.meta.url);
const SRC = new URL("../worker/src/", import.meta.url);
const MIGRATION = "0017_universe_audit.sql";
const PER_ANALYST = ["items", "aux_items", "grades", "aux_grades", "feedback", "aux_feedback", "source_prefs", "expansion_candidates",
  "recall_events", "deliveries", "reports"];
const SHARED = ["meta", "runs", "incidents", "sec_subsidiaries"];
const AT = "2026-01-15T00:00:00Z";
const newEnv = () => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS });
const cols = (d1, table) => d1.rows(`SELECT name FROM pragma_table_info('${table}')`).map((r) => r.name);

// A zenith-db built from the migrations before 0017 only.
function before0017() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

function auditRow(d1, over = {}) {
  const r = { at: AT, actor: "admin", via: "token", action: "admin_run", target_kind: "job", target_id: "enrich", before_json: null,
    after_json: '{"n":1}', ...over };
  return d1.db.prepare(`INSERT INTO audit_log (at, actor, via, action, target_kind, target_id, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.at, r.actor, r.via, r.action, r.target_kind, r.target_id, r.before_json, r.after_json);
}

test("0017 gives rows written before it universe_id 'u1'", () => {
  const d1 = before0017();
  for (const t of PER_ANALYST) assert.ok(!cols(d1, t).includes("universe_id"), `${t} has no universe_id before 0017`);
  const run = (sql, ...args) => d1.db.prepare(sql).run(...args);
  run(`INSERT INTO items (id, nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at)
       VALUES (1, 1, 'testsrc', 'SYM', 'https://example.com/1', 'Test item', ?, ?)`, AT, AT);
  run(`INSERT INTO aux_items (id, nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at)
       VALUES (1, 1, 'testaux', 'testent', 'Testent', 'private', 'https://example.com/a1', 'Test aux item', ?, ?)`, AT, AT);
  run(`INSERT INTO grades (item_id, ticker, rubric_version, score, band, why, graded_at) VALUES (1, 'SYM', 'r-test', 50, 'borderline', 'why', ?)`, AT);
  run(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, graded_at) VALUES (1, 'run-1', 'Testent', 50, 'borderline', ?)`, AT);
  run(`INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (1, 'high', 'SYM', ?)`, AT);
  run(`INSERT INTO aux_feedback (item_id, label, created_at) VALUES (1, 'high', ?)`, AT);
  run(`INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('testsrc', 'demote', ?)`, AT);
  run(`INSERT INTO expansion_candidates (dedupe_key, name, created_at, last_seen_at) VALUES ('testco', 'Testco', ?, ?)`, AT, AT);
  run(`INSERT INTO recall_events (id, ticker, event, kind, status, source, checked_at, loaded_at)
       VALUES ('SYM-1', 'SYM', 'Test event', 'news', 'on_time', 'test-seed', '2026-01-15', ?)`, AT);
  run(`INSERT INTO deliveries (channel, item_id, ticker, status, created_at, updated_at) VALUES ('lead', 1, 'SYM', 'posted', ?, ?)`, AT, AT);
  run(`INSERT INTO reports (slot, kind, status, created_at, updated_at) VALUES ('brief_am:2026-01-15', 'brief_am', 'sent', ?, ?)`, AT, AT);
  d1.exec(readFileSync(new URL(MIGRATION, MIGRATIONS), "utf8"));
  for (const t of PER_ANALYST) {
    assert.deepEqual(d1.rows(`SELECT universe_id FROM ${t}`).map((r) => r.universe_id), ["u1"], `${t}: the old row reads u1`);
  }
  // A row written after 0017 without naming the column gets the default too.
  run(`INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('othersrc', 'mute', ?)`, AT);
  assert.deepEqual(d1.rows("SELECT DISTINCT universe_id FROM source_prefs").map((r) => r.universe_id), ["u1"]);
});

test("universes holds exactly u1", () => {
  const d1 = zenithDb();
  assert.deepEqual(d1.rows("SELECT id FROM universes").map((r) => r.id), ["u1"]);
  assert.deepEqual(d1.rows("SELECT label FROM universes").map((r) => r.label), ["default"]);
});

test("shared tables carry no universe_id", () => {
  const d1 = zenithDb();
  for (const t of PER_ANALYST) assert.ok(cols(d1, t).includes("universe_id"), `${t} has universe_id`);
  assert.ok(cols(d1, "audit_log").includes("universe_id"));
  for (const t of SHARED) {
    const c = cols(d1, t);
    assert.ok(c.length > 0, `${t} exists`);
    assert.ok(!c.includes("universe_id"), `${t} is shared and has no universe_id`);
  }
});

test("audit_log refuses UPDATE and DELETE", () => {
  const d1 = zenithDb();
  auditRow(d1);
  assert.throws(() => d1.exec("UPDATE audit_log SET actor='x'"), /append-only/);
  assert.throws(() => d1.exec("DELETE FROM audit_log"), /append-only/);
  assert.deepEqual(d1.rows("SELECT COUNT(*) AS n, MAX(actor) AS actor, MAX(universe_id) AS u FROM audit_log").map((r) => ({ ...r })),
    [{ n: 1, actor: "admin", u: "u1" }]);
  const triggers = d1.rows("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_log' ORDER BY name").map((r) => r.name);
  assert.deepEqual(triggers, ["audit_log_no_delete", "audit_log_no_update"]);
});

test("audit_log rejects invalid JSON", () => {
  const d1 = zenithDb();
  assert.throws(() => auditRow(d1, { before_json: "not json" }), /CHECK/);
  assert.throws(() => auditRow(d1, { after_json: "{bad" }), /CHECK/);
  auditRow(d1, { before_json: '{"label":"high"}', after_json: null });
  assert.equal(d1.rows("SELECT COUNT(*) AS n FROM audit_log")[0].n, 1);
});

test("no positional INSERT in worker/src", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.endsWith(".generated.js"));
  assert.ok(files.length > 10, "worker/src was read");
  const hits = [];
  for (const f of files) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    for (const m of code.matchAll(/INSERT\s+(OR\s+\w+\s+)?INTO\s+\w+\s+(VALUES|SELECT)\b/gi)) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], "every INSERT names its columns, so the universe_id default fills in");
});

test("grader claim keys unchanged", async () => {
  const env = newEnv();
  env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (1, 'testsrc', 'SYM', 'https://example.com/claim/1', 'Testco news', ?, ?, 0, ?, 'pending')`).run(AT, AT, AT);
  const r = await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 5, run_id: "run-schema" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ["admit", "affects", "attempts", "category", "excerpt", "excerpt_status", "first_seen", "item_id",
    "nm_notified", "published", "record", "role", "seen_after_days", "skip_reason", "source_key", "state", "ticker", "title", "url"]);
  assert.ok(!("universe_id" in r.body.items[0]));
});

test("expansion candidates expose no universe_id", async () => {
  const env = newEnv();
  env.DB.db.prepare(`INSERT INTO expansion_candidates (dedupe_key, name, created_at, last_seen_at) VALUES ('testco', 'Testco', ?, ?)`).run(AT, AT);
  const r = await request(worker, env, "GET", "/v1/expansion/candidates", { role: "app" });
  assert.equal(r.status, 200);
  assert.equal(r.body.candidates.length, 1);
  for (const c of r.body.candidates) assert.ok(!("universe_id" in c), "shapeRow whitelist drops universe_id");
});
