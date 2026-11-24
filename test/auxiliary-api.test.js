// Auxiliary names API end to end over an in-memory D1 (migrations 0001-0008):
// the claim lease, grade submission, the grader's recent and labels reads, the
// app's feed and labels, the stats block, roles, the aux rubric route, and that
// no coverage endpoint, count, push or grade moves because of auxiliary rows.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { loadWorker } from "./helpers/worker.js";
import { fakeFetch } from "./helpers/d1.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { AUX_RUBRIC, AUX_RUBRIC_VERSION, RUBRIC_VERSION } = await import("../worker/src/rubric.generated.js");
const { AUX_MAX_CLAIM } = await import("../worker/src/auxiliary.js");
const { LEASE_MINUTES, MAX_ATTEMPTS, bandFor } = await import("../worker/src/lib.js");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = (extra = {}) => ({ DB: zenithDb(), ...TOKENS, ...extra });
const rows = (env, sql, ...args) => env.DB.rows(sql, ...args).map((r) => ({ ...r }));
const count = (env, table) => env.DB.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;

let rowid = 0;
const ANDURIL = { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", status: "private" };
const SHIELD = { source_key: "shieldai", entity_key: "shieldai", entity_name: "Shield AI (private)", status: "private" };
const NGA = { source_key: "nga", entity_key: "nga", entity_name: "NGA", status: "program" };
function addAux(env, over = {}) {
  const it = { ...ANDURIL, url: `https://news.example.com/a/${++rowid}`, title: `Auxiliary item ${rowid}`, published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", skip_reason: null, excerpt: null, excerpt_status: null, attempts: 0, claim_id: null, claimed_until: null,
    coverage_subject: 0, affects: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, skip_reason, excerpt, excerpt_status, attempts, claim_id, claimed_until, coverage_subject, affects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rowid, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state,
      it.skip_reason, it.excerpt, it.excerpt_status, it.attempts, it.claim_id, it.claimed_until, it.coverage_subject, it.affects);
  return Number(r.lastInsertRowid);
}
// A stored auxiliary grade; current: true makes it the item's grade.
function addAuxGrade(env, itemId, over = {}) {
  const g = { run_id: `run-${itemId}-${++rowid}`, entity: "Anduril", score: 80, why: "why", reads_through: [], flags: ["reason:material"], graded_at: iso(),
    covered_ticker: null, dup_of: null, current: true, ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : bandFor(g.score));
  const r = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, event_type, why, reads_through, flags, confidence,
      read_source, dup_of, rubric_version, model, graded_at) VALUES (?, ?, ?, ?, ?, ?, 'contract', ?, ?, ?, 0.8, 1, ?, 'a-test', 'm', ?)`)
    .run(itemId, g.run_id, g.entity, g.covered_ticker, g.score, band, g.why, JSON.stringify(g.reads_through), JSON.stringify(g.flags), g.dup_of, g.graded_at);
  const id = Number(r.lastInsertRowid);
  if (g.current) env.DB.db.prepare("UPDATE aux_items SET state='graded', grade_id=?, claim_id=NULL, claimed_until=NULL WHERE id=?").run(id, itemId);
  return id;
}
// Coverage rows, as worker-api.test.js seeds them.
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: "Red Cat news", published: iso(2 * HOUR), nm_first_seen: iso(HOUR), ingested_at: iso(), ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, 'pending')`).run(rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, it.ingested_at);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: "RCAT", score: 80, graded_at: iso(), ...over };
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, 'run-c', 'r-test', 'm', ?, ?, 'why', '["reason:material"]', 1, ?)`).run(itemId, g.ticker, g.score, bandFor(g.score), g.graded_at);
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
}
const grade = (item_id, over = {}) => ({ item_id, entity: "Anduril", score: 80, band: "digest", event_type: "financing", why: "Anduril raised a $2.5B Series G.",
  reads_through: [], flags: ["reason:material"], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, ...over });
const claimAux = async (env, body = {}, role = "grader") => (await request(worker, env, "POST", "/v1/aux/claim", { role, body })).body;
const submit = async (env, body, role = "grader") => request(worker, env, "POST", "/v1/aux/grades", { role, body });
const feedIds = async (env, q = "") => (await request(worker, env, "GET", `/v1/aux/feed${q}`, { role: "app" })).body.items.map((i) => i.item_id);

test("roles: the grader claims, grades and reads recent, labels and the aux rubric; the app reads the feed and labels; admin ingests", async () => {
  const env = newEnv({ NEWS: newsDb() });
  const id = addAux(env);
  addAuxGrade(env, id);
  const grader = ["POST /v1/aux/claim", "POST /v1/aux/grades", "GET /v1/aux/recent", "GET /v1/aux/labels", "GET /v1/rubric/aux"];
  const app = ["GET /v1/aux/feed", "POST /v1/aux/feedback"];
  for (const route of [...grader, ...app, "POST /v1/admin/aux-ingest"]) {
    const [method, path] = route.split(" ");
    const r = await worker.fetch(new Request(`https://zenith.test${path}`, { method }), env);
    assert.equal(r.status, 401, `${route} without a token`);
  }
  const as = (role, route) => {
    const [method, path] = route.split(" ");
    return request(worker, env, method, path, { role, body: method === "GET" ? undefined : {} });
  };
  for (const route of grader) assert.equal((await as("app", route)).status, 403, `app: ${route}`);
  for (const route of [...app, "POST /v1/admin/aux-ingest"]) assert.equal((await as("grader", route)).status, 403, `grader: ${route}`);
  assert.equal((await request(worker, env, "POST", "/v1/admin/aux-ingest", { role: "app" })).status, 403);
  assert.equal((await request(worker, env, "GET", "/v1/aux/feed", { role: "app" })).status, 200);
  assert.equal((await request(worker, env, "POST", "/v1/aux/feedback", { role: "app", body: { item_id: id, label: "high" } })).status, 200);
  for (const path of ["/v1/aux/recent", "/v1/aux/labels"]) assert.equal((await request(worker, env, "GET", path, { role: "grader" })).status, 200, path);
  assert.equal((await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: {} })).status, 200);
  assert.equal((await request(worker, env, "POST", "/v1/aux/claim", { role: "admin", body: {} })).status, 200);
  assert.equal((await request(worker, env, "GET", "/v1/stats", { role: "app" })).body.aux.by_band[0].band, "digest", "stats carries the aux block for the app");
});

test("GET /v1/rubric/aux: the bundled aux rubric with its own version, else 503 until it is built", async () => {
  const env = newEnv();
  const r = await request(worker, env, "GET", "/v1/rubric/aux", { role: "grader" });
  if (AUX_RUBRIC) assert.deepEqual([r.status, r.body.rubric_version, r.body.aux], [200, AUX_RUBRIC_VERSION, AUX_RUBRIC]);
  else assert.deepEqual([r.status, r.body], [503, { error: "aux rubric not built" }]);
  // Both states, independent of whether rubric/ holds an aux rubric today.
  const withAux = await loadWorker({ patch: (f, code) => (f === "rubric.generated.js"
    ? code.replace(/^export const AUX_RUBRIC_VERSION = .*$/m, 'export const AUX_RUBRIC_VERSION = "a-0123456789ab";')
      .replace(/^export const AUX_RUBRIC = .*$/m, 'export const AUX_RUBRIC = "# Auxiliary names rubric\\n";')
    : code) });
  const built = await request(withAux, env, "GET", "/v1/rubric/aux", { role: "grader" });
  assert.deepEqual([built.status, built.body], [200, { rubric_version: "a-0123456789ab", aux: "# Auxiliary names rubric\n" }]);
  const core = await request(withAux, env, "GET", "/v1/rubric", { role: "grader" });
  assert.equal(core.body.rubric_version, RUBRIC_VERSION, "the coverage rubric keeps its own version");
  const claim = (await request(withAux, env, "POST", "/v1/aux/claim", { role: "grader", body: {} })).body;
  assert.equal(claim.rubric_version, "a-0123456789ab");
  const none = await loadWorker({ patch: (f, code) => (f === "rubric.generated.js"
    ? code.replace(/^export const AUX_RUBRIC_VERSION = .*$/m, "export const AUX_RUBRIC_VERSION = null;").replace(/^export const AUX_RUBRIC = .*$/m, "export const AUX_RUBRIC = null;")
    : code) });
  const missing = await request(none, env, "GET", "/v1/rubric/aux", { role: "admin" });
  assert.deepEqual([missing.status, missing.body], [503, { error: "aux rubric not built" }]);
  assert.equal((await request(none, env, "GET", "/v1/rubric", { role: "grader" })).status, 200, "the coverage rubric does not need it");
});

test("claim: newest first under a 45-minute lease; concurrent claims never share items; expired leases return; failing items leave", async () => {
  const env = newEnv();
  const ids = [5, 4, 3, 2, 1].map((h) => addAux(env, { nm_first_seen: iso(h * HOUR), published: iso((h + 24) * HOUR) }));
  const skipped = addAux(env, { state: "skipped", skip_reason: "stale_on_arrival", nm_first_seen: iso(0) });
  const graded = addAux(env, { nm_first_seen: iso(0) });
  addAuxGrade(env, graded);
  const cov = addItem(env);
  const c1 = await claimAux(env, { limit: 2, run_id: "run-a", model: "m", rubric_version: "a-x" });
  assert.deepEqual(c1.items.map((i) => i.item_id), [ids[4], ids[3]], "newest first; skipped and graded items are never claimed");
  assert.deepEqual([c1.run_id, c1.rubric_version, c1.lease_minutes, c1.remaining], ["run-a", AUX_RUBRIC_VERSION, LEASE_MINUTES, 3]);
  assert.deepEqual(Object.keys(c1.items[0]).sort(), ["affects", "coverage_subject", "entity_key", "entity_name", "excerpt", "excerpt_status", "first_seen",
    "item_id", "published", "seen_after_days", "source_key", "status", "title", "url"]);
  assert.deepEqual([c1.items[0].entity_name, c1.items[0].status, c1.items[0].seen_after_days], ["Anduril (private)", "private", 1]);
  assert.deepEqual([c1.items[0].coverage_subject, c1.items[0].affects], [false, []], "a company's own channel is not a coverage subject");
  const lease = rows(env, "SELECT claim_id, claimed_until, attempts, state FROM aux_items WHERE id = ?", ids[4])[0];
  assert.equal(lease.claim_id, c1.claim_id);
  assert.equal(lease.state, "claimed");
  assert.equal(lease.attempts, 1);
  assert.ok(Math.abs(Date.parse(lease.claimed_until) - Date.now() - LEASE_MINUTES * 60_000) < 60_000);
  // Two claims at once split the rest; neither takes a leased item.
  const [c2, c3] = await Promise.all([claimAux(env, { limit: 2 }), claimAux(env, { limit: 2 })]);
  const got = [...c2.items, ...c3.items].map((i) => i.item_id);
  assert.equal(new Set(got).size, got.length, "no item in two claims");
  assert.deepEqual(got.sort(), [ids[0], ids[1], ids[2]].sort());
  assert.notEqual(c2.run_id, c3.run_id, "a claim without a run id gets its own");
  const empty = await claimAux(env, {});
  assert.deepEqual([empty.items.length, empty.remaining], [0, 5]);
  // An expired lease goes back to the queue, with another attempt counted.
  env.DB.db.prepare("UPDATE aux_items SET claimed_until = ? WHERE id = ?").run(iso(60_000), ids[4]);
  const again = await claimAux(env, { limit: 5 });
  assert.deepEqual(again.items.map((i) => i.item_id), [ids[4]]);
  assert.equal(rows(env, "SELECT attempts FROM aux_items WHERE id = ?", ids[4])[0].attempts, 2);
  // After MAX_ATTEMPTS tries an item leaves the queue as grading_failed.
  env.DB.db.prepare("UPDATE aux_items SET claimed_until = ?, attempts = ? WHERE id = ?").run(iso(60_000), MAX_ATTEMPTS, ids[4]);
  assert.deepEqual((await claimAux(env, { limit: 5 })).items, []);
  assert.deepEqual(rows(env, "SELECT state, skip_reason FROM aux_items WHERE id = ?", ids[4])[0], { state: "skipped", skip_reason: "grading_failed" });
  assert.deepEqual(rows(env, "SELECT state, skip_reason FROM aux_items WHERE id = ?", skipped)[0], { state: "skipped", skip_reason: "stale_on_arrival" });
  // Coverage is untouched: its item stays pending, no grading run is recorded.
  assert.deepEqual(rows(env, "SELECT state, attempts FROM items WHERE id = ?", cov)[0], { state: "pending", attempts: 0 });
  assert.equal(count(env, "runs"), 0, "aux claims never count as a coverage grading run (heartbeat, stats, brief)");
  const covClaim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 50 } })).body;
  assert.deepEqual(covClaim.items.map((i) => i.item_id), [cov]);
});

test("claim: a coverage-subject item carries coverage_subject true and the covered tickers its feed affects", async () => {
  const env = newEnv();
  const dd = addAux(env, { source_key: "dronedominance", entity_key: "dronedominance", entity_name: "Drone Dominance", status: "program",
    coverage_subject: 1, affects: "RCAT,DPRO,PUSA,UMAC", nm_first_seen: iso(2 * HOUR) });
  const plain = addAux(env, { nm_first_seen: iso(HOUR) });
  const c = await claimAux(env, { limit: 5 });
  const by = Object.fromEntries(c.items.map((i) => [i.item_id, i]));
  assert.deepEqual([by[dd].coverage_subject, by[dd].affects, by[dd].entity_name], [true, ["RCAT", "DPRO", "PUSA", "UMAC"], "Drone Dominance"]);
  assert.deepEqual([by[plain].coverage_subject, by[plain].affects], [false, []]);
});

test("claim limits: 1 to 40, default 30", async () => {
  const env = newEnv();
  for (let i = 0; i < 45; i++) addAux(env, { nm_first_seen: iso(i * 60_000) });
  assert.equal((await claimAux(env, { limit: 100 })).items.length, AUX_MAX_CLAIM);
  assert.equal(AUX_MAX_CLAIM, 40);
  const env2 = newEnv();
  for (let i = 0; i < 35; i++) addAux(env2, { nm_first_seen: iso(i * 60_000) });
  const d = await claimAux(env2, {});
  assert.deepEqual([d.items.length, d.remaining], [30, 5]);
  assert.equal((await claimAux(env2, { limit: -3 })).items.length, 1);
});

test("grades: only claimed items, each grade checked on its own, idempotent per item and run", async () => {
  const env = newEnv();
  const [a, b, c] = [3, 2, 1].map((h) => addAux(env, { nm_first_seen: iso(h * HOUR) }));
  const outside = addAux(env, { nm_first_seen: iso(10 * HOUR) });
  const cov = addItem(env);
  const claim = await claimAux(env, { limit: 3, run_id: "run-x" });
  assert.deepEqual(claim.items.map((i) => i.item_id), [c, b, a]);
  const file = { claim_id: claim.claim_id, run_id: "run-x", model: "claude-routine", rubric_version: "a-file", grades: [
    grade(a, { reads_through: [{ ticker: "MRLN", direction: "-" }] }),
    grade(b, { band: "lead" }),
    grade(c, { score: null, band: "duplicate", flags: ["reason:duplicate"], dup_of: a }),
    grade(outside),
    grade(99999),
    grade(b, { score: null, band: "duplicate", flags: ["reason:duplicate"], dup_of: cov + 5000 }),
  ] };
  const r = await submit(env, file);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.accepted, r.body.already_accepted], [2, 0]);
  assert.deepEqual(r.body.results, [{ item_id: a, entity: "Anduril", score: 80, band: "digest" }, { item_id: c, entity: "Anduril", score: null, band: "duplicate" }]);
  const errs = r.body.rejected.map((x) => `${x.item_id}: ${x.error}`);
  assert.equal(errs.length, 4);
  assert.match(errs[0], new RegExp(`^${b}: band must be "digest" for score 80`));
  assert.match(errs[1], new RegExp(`^${outside}: item ${outside} is not in claim ${claim.claim_id} \\(state pending\\)`));
  assert.match(errs[2], /^99999: unknown item_id 99999: not an auxiliary item/);
  assert.match(errs[3], new RegExp(`^${b}: dup_of ${cov + 5000} is not an auxiliary item`));
  const stored = rows(env, "SELECT item_id, run_id, entity, score, band, reads_through, flags, dup_of, rubric_version, model, read_source FROM aux_grades ORDER BY id");
  assert.deepEqual(stored, [
    { item_id: a, run_id: "run-x", entity: "Anduril", score: 80, band: "digest", reads_through: '[{"ticker":"MRLN","direction":"-"}]', flags: '["reason:material"]',
      dup_of: null, rubric_version: "a-file", model: "claude-routine", read_source: 1 },
    { item_id: c, run_id: "run-x", entity: "Anduril", score: null, band: "duplicate", reads_through: "[]", flags: '["reason:duplicate"]',
      dup_of: a, rubric_version: "a-file", model: "claude-routine", read_source: 1 },
  ]);
  const st = Object.fromEntries(rows(env, "SELECT id, state, claim_id, grade_id FROM aux_items").map((x) => [x.id, x]));
  assert.deepEqual([st[a].state, st[a].claim_id, st[a].grade_id != null], ["graded", null, true]);
  assert.deepEqual([st[b].state, st[b].claim_id], ["claimed", claim.claim_id], "a rejected grade leaves the item claimed");
  // Resubmitting the same file stores nothing twice; the bad grades are still refused.
  const again = (await submit(env, file)).body;
  assert.deepEqual([again.accepted, again.already_accepted, again.already, again.rejected.length], [0, 2, [a, c], 4]);
  assert.equal(count(env, "aux_grades"), 2);
  // The corrected grade lands; the same item twice in one file is stored once.
  const fixed = (await submit(env, { claim_id: claim.claim_id, run_id: "run-x", grades: [grade(b, { score: 72 }), grade(b, { score: 45, band: "borderline" })] })).body;
  assert.deepEqual([fixed.accepted, fixed.already_accepted, fixed.rejected], [1, 1, []]);
  assert.equal(rows(env, "SELECT g.score FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id WHERE i.id = ?", b)[0].score, 72);
  assert.equal(rows(env, "SELECT rubric_version FROM aux_grades WHERE item_id = ?", b)[0].rubric_version, AUX_RUBRIC_VERSION, "the bundled version when the file names none");
  // Request checks.
  assert.equal((await submit(env, { run_id: "run-x", grades: [] })).status, 400, "the grader needs a claim");
  assert.match((await submit(env, { claim_id: claim.claim_id, grades: [] })).body.error, /run_id is required/);
  assert.equal((await submit(env, { claim_id: claim.claim_id, run_id: "r" })).status, 400);
  assert.equal((await submit(env, { claim_id: claim.claim_id, run_id: "r", grades: Array.from({ length: 81 }, () => grade(a)) })).status, 400);
  // Admin may grade without a claim, and a later run regrades an item.
  const adm = (await submit(env, { run_id: "admin-1", grades: [grade(outside, { score: 30, band: "reject", flags: ["reason:noise"] })] }, "admin")).body;
  assert.equal(adm.accepted, 1);
  const re = (await submit(env, { run_id: "run-y", grades: [grade(a, { score: 93, band: "lead" })] }, "admin")).body;
  assert.equal(re.accepted, 1);
  assert.equal(rows(env, "SELECT g.score, g.run_id FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id WHERE i.id = ?", a)[0].run_id, "run-y");
  assert.equal(rows(env, "SELECT COUNT(*) AS n FROM aux_grades WHERE item_id = ?", a)[0].n, 2);
  // Nothing reached the coverage tables.
  assert.deepEqual([count(env, "grades"), count(env, "runs"), rows(env, "SELECT state FROM items")[0].state], [0, 0, "pending"]);
});

test("grades: a covered-name grade carries its ticker; the grader cannot grade an item another claim holds", async () => {
  const env = newEnv();
  const x = addAux(env, { ...NGA, title: "Army awards Teal Drones Black Widow order" });
  const y = addAux(env);
  const mine = await claimAux(env, { limit: 1, run_id: "run-1" });
  const theirs = await claimAux(env, { limit: 1, run_id: "run-2" });
  assert.deepEqual([mine.items[0].item_id, theirs.items[0].item_id], [y, x]);
  const r = (await submit(env, { claim_id: mine.claim_id, run_id: "run-1", grades: [
    grade(x, { entity: "Red Cat", score: null, band: "covered", flags: ["reason:covered_name"], covered_ticker: "RCAT" }),
  ] })).body;
  assert.match(r.rejected[0].error, /is not in claim .* \(state claimed\)/);
  const ok = (await submit(env, { claim_id: theirs.claim_id, run_id: "run-2", grades: [
    grade(x, { entity: "Red Cat", score: null, band: "covered", flags: ["reason:covered_name"], covered_ticker: "RCAT" }),
  ] })).body;
  assert.equal(ok.accepted, 1);
  assert.deepEqual(rows(env, "SELECT score, band, covered_ticker, entity FROM aux_grades")[0], { score: null, band: "covered", covered_ticker: "RCAT", entity: "Red Cat" });
});

test("recent: auxiliary items and their grades by entity name or key, for duplicate checks", async () => {
  const env = newEnv();
  const graded = addAux(env, { title: "Anduril raises $2.5B", nm_first_seen: iso(2 * DAY) });
  addAuxGrade(env, graded, { entity: "Anduril", score: 93, dup_of: null });
  const waiting = addAux(env, { title: "Anduril wins Army award", nm_first_seen: iso(DAY) });
  const shield = addAux(env, { ...SHIELD, title: "Shield AI V-BAT order" });
  const old = addAux(env, { title: "Anduril old", nm_first_seen: iso(20 * DAY) });
  addAux(env, { title: "Anduril skipped", state: "skipped", skip_reason: "bad_url" });
  const dup = addAux(env, { title: "Anduril raise, wire copy" });
  addAuxGrade(env, dup, { score: null, band: "duplicate", flags: ["reason:duplicate"], dup_of: graded });
  const get = async (q) => (await request(worker, env, "GET", `/v1/aux/recent${q}`, { role: "grader" })).body;
  const r = await get("?entity=Anduril");
  assert.deepEqual(r.items.map((i) => i.item_id), [dup, waiting, graded]);
  assert.deepEqual([r.entity, r.days], ["Anduril", 14]);
  const g = r.items.find((i) => i.item_id === graded);
  assert.deepEqual([g.entity, g.title, g.score, g.band, typeof g.first_seen], ["Anduril", "Anduril raises $2.5B", 93, "lead", "string"]);
  const w = r.items.find((i) => i.item_id === waiting);
  assert.deepEqual([w.entity, w.score, w.band, w.state], ["Anduril (private)", null, null, "pending"]);
  assert.equal(r.items.find((i) => i.item_id === dup).dup_of, graded);
  assert.deepEqual((await get("?entity=anduril")).items.map((i) => i.item_id), [dup, waiting, graded], "by entity key");
  assert.deepEqual((await get("?entity=ANDURIL%20(private)")).items.map((i) => i.item_id), [dup, waiting, graded], "by routed name");
  assert.deepEqual((await get("?entity=Shield%20AI")).items.map((i) => i.item_id), [shield], "a spaced name finds its key");
  assert.deepEqual((await get("?entity=Waymo")).items, []);
  assert.deepEqual((await get("?entity=Anduril&days=30")).items.map((i) => i.item_id), [dup, waiting, graded, old]);
  assert.deepEqual((await get("")).items.map((i) => i.item_id), [dup, shield, waiting, graded], "every entity, skipped items left out");
  assert.deepEqual((await get("?entity=-")).items.length, 4);
});

test("labels: auxiliary items whose current grade falls outside the analyst's latest label, largest gap first", async () => {
  const env = newEnv();
  const label = (item_id, label, over = {}) => {
    const gid = rows(env, "SELECT grade_id FROM aux_items WHERE id = ?", item_id)[0].grade_id;
    env.DB.db.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, note, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(item_id, over.grade_id ?? gid, label, over.note ?? null, over.created_at ?? iso());
  };
  const noise = addAux(env); addAuxGrade(env, noise, { score: 85, entity: "Anduril" }); label(noise, "noise", { note: "routine hiring post" });
  const medium = addAux(env, SHIELD); addAuxGrade(env, medium, { score: 50, entity: "Shield AI" }); label(medium, "medium");
  const inside = addAux(env); addAuxGrade(env, inside, { score: 82 }); label(inside, "high");
  // too_high at 60, regraded to 55: inside 0-59 now.
  const fixedUp = addAux(env); addAuxGrade(env, fixedUp, { score: 60 }); label(fixedUp, "too_high"); addAuxGrade(env, fixedUp, { score: 55 });
  const stillHigh = addAux(env); addAuxGrade(env, stillHigh, { score: 60 }); label(stillHigh, "too_high");
  const relabelled = addAux(env); addAuxGrade(env, relabelled, { score: 90 }); label(relabelled, "noise"); label(relabelled, "high");
  const old = addAux(env); addAuxGrade(env, old, { score: 10 }); label(old, "high", { created_at: iso(40 * DAY) });
  const ungraded = addAux(env); label(ungraded, "high");
  const get = async (q = "") => (await request(worker, env, "GET", `/v1/aux/labels${q}`, { role: "grader" })).body;
  const r = await get();
  assert.deepEqual(r.labels.map((l) => [l.item_id, l.label, l.range, l.gap]), [[noise, "noise", "0-29", -56], [medium, "medium", "60-89", 10], [stillHigh, "too_high", "0-59", -1]]);
  assert.deepEqual([r.total, r.days], [3, 30]);
  const n = r.labels[0];
  assert.deepEqual([n.entity, n.note, n.graded_score, n.current_score, n.current_band, n.title], ["Anduril", "routine hiring post", 85, 85, "digest", rows(env, "SELECT title FROM aux_items WHERE id = ?", noise)[0].title]);
  assert.deepEqual((await get("?limit=1")).labels.map((l) => l.item_id), [noise]);
  assert.deepEqual((await get("?days=60")).labels.map((l) => l.item_id), [old, noise, medium, stillHigh]);
  assert.equal(count(env, "feedback"), 0);
});

// Feed fixture: ids ascending in this order.
function feedFixture(env) {
  const f = {};
  f.oldLead = addAux(env, { nm_first_seen: iso(100 * HOUR) }); addAuxGrade(env, f.oldLead, { score: 92 });
  f.lead = addAux(env, { ...SHIELD, nm_first_seen: iso(3 * HOUR) });
  addAuxGrade(env, f.lead, { score: 91, entity: "Shield AI", reads_through: [{ ticker: "MRLN", direction: "-" }] });
  f.digest = addAux(env, { nm_first_seen: iso(2 * HOUR), published: "2026-10-21T12:00:00Z", excerpt: "x".repeat(600), excerpt_status: "feed" });
  addAuxGrade(env, f.digest, { score: 75 });
  f.reject = addAux(env, { nm_first_seen: iso(90 * 60_000) }); addAuxGrade(env, f.reject, { score: 20, flags: ["reason:noise"] });
  f.dup = addAux(env); addAuxGrade(env, f.dup, { score: null, band: "duplicate", dup_of: f.digest, flags: ["reason:duplicate"] });
  f.covered = addAux(env); addAuxGrade(env, f.covered, { score: null, band: "covered", covered_ticker: "RCAT", entity: "Red Cat", flags: ["reason:covered_name"] });
  f.skipped = addAux(env, { state: "skipped", skip_reason: "stale_on_arrival" });
  f.pending = addAux(env, { ...NGA, nm_first_seen: iso(HOUR) });
  return f;
}

test("feed: For You pins recent Leads and filters by score; Latest is newest first; skipped, duplicate and covered stay hidden", async () => {
  const env = newEnv();
  const f = feedFixture(env);
  assert.deepEqual(await feedIds(env), [f.lead, f.pending, f.reject, f.digest, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?min_score=70"), [f.lead, f.digest, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?min_score=90"), [f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?order=newest"), [f.pending, f.reject, f.digest, f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?pin_lead_hours=0"), [f.pending, f.reject, f.digest, f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?pin_lead_hours=200"), [f.lead, f.oldLead, f.pending, f.reject, f.digest]);
  assert.deepEqual(await feedIds(env, "?order=newest&include_duplicates=1"), [f.pending, f.dup, f.reject, f.digest, f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?order=newest&include_covered=1"), [f.pending, f.covered, f.reject, f.digest, f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?order=newest&include_skipped=1"), [f.pending, f.skipped, f.reject, f.digest, f.lead, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?state=skipped"), [f.skipped]);
  assert.deepEqual(await feedIds(env, "?state=pending"), [f.pending]);
  const items = (await request(worker, env, "GET", "/v1/aux/feed", { role: "app" })).body.items;
  const by = Object.fromEntries(items.map((i) => [i.item_id, i]));
  const lead = by[f.lead];
  assert.deepEqual([lead.entity, lead.entity_key, lead.status, lead.source_key, lead.score, lead.band, lead.pinned, lead.state],
    ["Shield AI", "shieldai", "private", "shieldai", 91, "lead", 1, "graded"]);
  assert.deepEqual(lead.reads_through, [{ ticker: "MRLN", direction: "-" }]);
  assert.deepEqual(lead.flags, ["reason:material"]);
  for (const k of ["item_id", "entity", "entity_key", "status", "source_key", "title", "url", "published", "first_seen", "event_date", "state", "score", "band",
    "event_type", "why", "reads_through", "confidence", "read_source", "snippet", "label", "label_note", "pinned"]) assert.ok(k in lead, k);
  const pending = by[f.pending];
  assert.deepEqual([pending.entity, pending.status, pending.score, pending.band, pending.pinned, pending.reads_through, pending.state],
    ["NGA", "program", null, null, 0, [], "pending"]);
  assert.equal(by[f.digest].snippet.length, 420);
  assert.equal(by[f.digest].event_date, "2026-10-21");
  assert.equal(pending.event_date, null);
});

test("feed: entity matches the shown name or the entity key; unlabeled hides labelled items", async () => {
  const env = newEnv();
  const f = feedFixture(env);
  assert.deepEqual(await feedIds(env, "?entity=anduril"), [f.reject, f.digest, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?entity=ANDURIL"), [f.reject, f.digest, f.oldLead]);
  assert.deepEqual(await feedIds(env, "?entity=Shield%20AI"), [f.lead]);
  assert.deepEqual(await feedIds(env, "?entity=shieldai"), [f.lead]);
  assert.deepEqual(await feedIds(env, "?entity=nga"), [f.pending]);
  // A name from stats.aux.entities also finds that name's waiting items
  // (routed as "Shield AI (private)", key shieldai) on the Latest view.
  const waiting = addAux(env, { ...SHIELD, nm_first_seen: iso(30 * 60_000) });
  assert.deepEqual(await feedIds(env, "?entity=Shield%20AI&order=newest"), [waiting, f.lead]);
  assert.deepEqual(await feedIds(env, "?entity=shield%20ai%20(private)&order=newest"), [waiting, f.lead], "the routed name finds graded items too");
  assert.deepEqual(await feedIds(env, "?entity=Shield%20AI&min_score=70"), [f.lead], "For You still needs a score");
  assert.deepEqual(await feedIds(env, "?entity=Shield"), [], "a partial name is not a match");
  env.DB.db.prepare("DELETE FROM aux_items WHERE id = ?").run(waiting);
  assert.deepEqual(await feedIds(env, "?entity=Red%20Cat&include_covered=1"), [f.covered]);
  assert.deepEqual(await feedIds(env, "?entity=Waymo"), []);
  assert.deepEqual(await feedIds(env, "?entity=anduril&min_score=70"), [f.digest, f.oldLead]);
  await request(worker, env, "POST", "/v1/aux/feedback", { role: "app", body: { item_id: f.digest, label: "high", note: "big round" } });
  assert.deepEqual(await feedIds(env, "?unlabeled=1"), [f.lead, f.pending, f.reject, f.oldLead]);
  const d = (await request(worker, env, "GET", "/v1/aux/feed?entity=anduril", { role: "app" })).body.items.find((i) => i.item_id === f.digest);
  assert.deepEqual([d.label, d.label_note], ["high", "big round"]);
});

test("feed paging: pass next_before_id back; pinned Leads come once, first, even across pages", async () => {
  const env = newEnv();
  const f = feedFixture(env);
  const page = async (q) => (await request(worker, env, "GET", `/v1/aux/feed${q}`, { role: "app" })).body;
  const p1 = await page("?limit=2");
  assert.deepEqual([p1.items.map((i) => i.item_id), p1.next_before_id], [[f.lead, f.pending], f.pending]);
  const p2 = await page(`?limit=2&before_id=${p1.next_before_id}`);
  assert.deepEqual(p2.items.map((i) => i.item_id), [f.reject, f.digest]);
  const p3 = await page(`?limit=2&before_id=${p2.next_before_id}`);
  assert.deepEqual([p3.items.map((i) => i.item_id), p3.next_before_id], [[f.oldLead], null]);
  const onlyPinned = await page("?limit=1");
  assert.equal(onlyPinned.next_before_id, -f.lead, "a page ending inside the pinned Leads gives a negative cursor");
  assert.deepEqual((await page(`?limit=5&before_id=${onlyPinned.next_before_id}`)).items.map((i) => i.item_id), [f.pending, f.reject, f.digest, f.oldLead]);
  const newest = await page("?order=newest&limit=3");
  assert.deepEqual((await page(`?order=newest&limit=3&before_id=${newest.next_before_id}`)).items.map((i) => i.item_id), [f.lead, f.oldLead]);

  // Many pinned Leads interleaved with other items, two to a page.
  const env2 = newEnv();
  const leads = [], others = [];
  for (let k = 0; k < 5; k++) {
    const l = addAux(env2, { nm_first_seen: iso((k + 1) * HOUR) }); addAuxGrade(env2, l, { score: 95 }); leads.push(l);
    others.push(addAux(env2, { nm_first_seen: iso((k + 1) * HOUR) }));
  }
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard++) {
    const p = (await request(worker, env2, "GET", `/v1/aux/feed?limit=2${cursor == null ? "" : `&before_id=${cursor}`}`, { role: "app" })).body;
    seen.push(...p.items.map((i) => i.item_id));
    if (p.next_before_id == null) break;
    cursor = p.next_before_id;
  }
  assert.deepEqual(seen, [...leads.reverse(), ...others.reverse()]);
});

test("feedback: labels the item's current grade; directional labels need a score; nothing reaches coverage feedback", async () => {
  const env = newEnv();
  const f = feedFixture(env);
  const post = (body) => request(worker, env, "POST", "/v1/aux/feedback", { role: "app", body });
  const gid = rows(env, "SELECT grade_id FROM aux_items WHERE id = ?", f.digest)[0].grade_id;
  const r = await post({ item_id: f.digest, label: "TOO_HIGH", note: "small round" });
  assert.deepEqual([r.status, r.body.ok, r.body.grade_id], [200, true, gid]);
  assert.deepEqual(rows(env, "SELECT item_id, grade_id, label, note FROM aux_feedback"), [{ item_id: f.digest, grade_id: gid, label: "too_high", note: "small round" }]);
  assert.deepEqual([(await post({ item_id: f.pending, label: "low" })).body.grade_id], [null], "an ungraded item can be labelled");
  assert.match((await post({ item_id: f.pending, label: "too_low" })).body.error, /too_low needs a scored grade/);
  assert.equal((await post({ item_id: f.dup, label: "too_high" })).status, 400, "a duplicate has no score");
  assert.equal((await post({ item_id: f.dup, label: "noise" })).status, 200);
  assert.equal((await post({ item_id: 99999, label: "high" })).status, 404);
  assert.match((await post({ item_id: f.digest, label: "sideways" })).body.error, /label must be one of high, medium, low, noise, too_high, too_low/);
  assert.equal((await post({ label: "high" })).status, 400);
  await post({ item_id: f.digest, label: "medium" });
  const d = (await request(worker, env, "GET", "/v1/aux/feed", { role: "app" })).body.items.find((i) => i.item_id === f.digest);
  assert.deepEqual([d.label, d.label_note], ["medium", null], "the latest label is shown");
  assert.equal(count(env, "feedback"), 0);
});

test("stats: an aux block (states, bands, names graded in 30 days, last ingest); every coverage field is unchanged by auxiliary rows", async () => {
  const seed = (env) => {
    const id = addItem(env, { nm_first_seen: "2026-11-20T10:00:00.000Z" }); addGrade(env, id, { score: 91 });
    addItem(env, { nm_first_seen: "2026-11-21T10:00:00.000Z" });
    env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('last_ingest_at', '2026-11-23T10:00:00.000Z')").run();
  };
  const plain = newEnv();
  const mixed = newEnv();
  seed(plain);
  seed(mixed);
  const f = feedFixture(mixed);
  const sh = addAux(mixed, SHIELD); addAuxGrade(mixed, sh, { entity: "shield ai", score: 60 });
  const stale = addAux(mixed); addAuxGrade(mixed, stale, { entity: "Old Name", graded_at: iso(40 * DAY) });
  mixed.DB.db.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, created_at) VALUES (?, NULL, 'high', ?)").run(f.pending, iso());
  mixed.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_last_ingest_at', '2026-11-23T11:00:00.000Z'), ('aux_nm_cursor', '77')").run();
  const a = (await request(worker, plain, "GET", "/v1/stats", { role: "app" })).body;
  const b = (await request(worker, mixed, "GET", "/v1/stats", { role: "app" })).body;
  const { aux: auxA, ...covA } = a;
  const { aux, ...covB } = b;
  assert.deepEqual(covB, covA, "coverage stats are the same with or without auxiliary rows");
  assert.equal(covB.labels, 0);
  assert.deepEqual(auxA, { rubric_version: AUX_RUBRIC_VERSION, by_state: [], by_band: [], entities: [], last_ingest_at: null });
  const byState = Object.fromEntries(aux.by_state.map((x) => [x.state, x.n]));
  assert.deepEqual(byState, { graded: 8, pending: 1, skipped: 1 });
  const byBand = Object.fromEntries(aux.by_band.map((x) => [x.band, x.n]));
  assert.deepEqual(byBand, { lead: 2, digest: 2, borderline: 1, reject: 1, duplicate: 1, covered: 1 });
  assert.deepEqual(aux.entities, [{ name: "Anduril", n: 3 }, { name: "shield ai", n: 2 }],
    "counted case-insensitively under the latest spelling; duplicate, covered and older grades left out");
  assert.equal(aux.last_ingest_at, "2026-11-23T11:00:00.000Z");
  // A broken aux block never takes the coverage stats down.
  mixed.DB.exec("DROP TABLE aux_feedback; DROP TABLE aux_grades;");
  const errors = [];
  const error = console.error;
  console.error = (label) => errors.push(label);
  try {
    const c = await request(worker, mixed, "GET", "/v1/stats", { role: "app" });
    assert.equal(c.status, 200);
    const { aux: gone, ...covC } = c.body;
    assert.deepEqual([gone, covC], [null, covA]);
  } finally {
    console.error = error;
  }
  assert.deepEqual(errors, ["aux stats failed"]);
});

test("coverage endpoints, the claim queue and Lead pushes are the same with or without auxiliary rows", async () => {
  const realFetch = globalThis.fetch;
  const t0 = Date.now();
  const at = (ms) => new Date(t0 - ms).toISOString();
  const seed = (env) => {
    const lead = addItem(env, { url: "https://ir.example.com/lead", ingested_at: at(0), published: at(HOUR), nm_first_seen: at(30 * 60_000), title: "Red Cat wins Army SRR Tranche 3" });
    addGrade(env, lead, { score: 95, graded_at: at(20 * 60_000) });
    const dig = addItem(env, { url: "https://ir.example.com/q3", ingested_at: at(0), published: at(3 * HOUR), nm_first_seen: at(2 * HOUR), title: "Red Cat Q3" });
    addGrade(env, dig, { score: 75, graded_at: at(HOUR) });
    addItem(env, { url: "https://ir.example.com/webinar", ingested_at: at(0), published: at(2 * HOUR), nm_first_seen: at(HOUR), title: "Red Cat webinar" });
    env.DB.db.prepare("INSERT INTO feedback (item_id, label, note, grade_id, ticker, created_at) VALUES (1, 'high', NULL, 1, 'RCAT', ?)").run(at(10 * 60_000));
  };
  const hook = "https://discord.com/api/webhooks/2/l";
  const plain = newEnv({ NEWS: newsDb(), DISCORD_LEAD_WEBHOOK: hook });
  const mixed = newEnv({ NEWS: newsDb(), DISCORD_LEAD_WEBHOOK: hook });
  seed(plain);
  seed(mixed);
  // Auxiliary rows with the same ids as the coverage ones, a fresh Lead among them.
  const f = feedFixture(mixed);
  const fresh = addAux(mixed, { nm_first_seen: iso(10 * 60_000), title: "Anduril acquires a rival" }); addAuxGrade(mixed, fresh, { score: 97 });
  mixed.DB.db.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, created_at) VALUES (1, 1, 'noise', ?)").run(iso());
  // Clock readings differ between the two calls (rendered text has times and
  // ages in it, so its digits are masked); everything else must match.
  const VOLATILE = new Set(["claim_id", "run_id", "generated_at", "week_from", "to"]);
  const stable = (body) => JSON.parse(JSON.stringify(body, (k, v) => (VOLATILE.has(k) ? undefined
    : k === "text" && Array.isArray(v) ? v.map((t) => String(t).replace(/\d+/g, "#")) : v)));
  for (const [role, path] of [["app", "/v1/feed"], ["app", "/v1/feed?min_score=70"], ["app", "/v1/feed?order=newest"], ["app", "/v1/feed?unlabeled=1"],
    ["app", "/v1/feed?ticker=RCAT"], ["grader", "/v1/labels"], ["grader", "/v1/recent?ticker=RCAT"], ["app", "/v1/calibration"], ["app", `/v1/brief?since=${encodeURIComponent(at(DAY))}`]]) {
    const a = await request(worker, plain, "GET", path, { role });
    const b = await request(worker, mixed, "GET", path, { role });
    // Calibration carries an aux block (round 4 Z6); its coverage block must not move.
    if (path === "/v1/calibration") {
      assert.deepEqual(stable(b.body.coverage), stable(a.body.coverage), path);
      assert.equal(b.body.aux.all_time.n, 1);
      continue;
    }
    assert.deepEqual(stable(b), stable(a), path);
  }
  const page = async (env) => (await worker.fetch(new Request("https://zenith.test/m", { headers: { authorization: `Bearer ${TOKENS.APP_TOKEN}` } }), env)).text();
  assert.doesNotMatch(await page(mixed), /Anduril/, "the phone page is coverage only");
  // Coverage claims and grades see coverage items only.
  const cc = (await request(worker, mixed, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 50, run_id: "cov-run" } })).body;
  assert.deepEqual(cc.items.map((i) => i.title), ["Red Cat webinar"]);
  assert.equal(cc.remaining, 0);
  // The 5-minute cron pushes the coverage Lead only.
  const fake = fakeFetch(() => ({ json: { id: "msg1" } }));
  globalThis.fetch = fake;
  const { log } = console;
  console.log = () => {};
  try {
    const waits = [];
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, mixed, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
  }
  const pushes = fake.calls.filter((c) => c.url.startsWith(hook));
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].body.content, /^\*\*RCAT · Lead 95\*\*/);
  assert.ok(!fake.calls.some((c) => JSON.stringify(c.body || "").includes("Anduril")));
  assert.equal(count(mixed, "deliveries"), 1);
  assert.equal(rows(mixed, "SELECT COUNT(*) AS n FROM aux_items WHERE id = ?", f.lead)[0].n, 1);
});

// Relations (plans/round5-expansion-approve-queue.md, A2-A3) through
// /v1/aux/grades, beside the aux entity rule (C2): one AGILOX row from a
// Rockwell relation and AGILOX's own acquisition grade, sightings 2.
test("aux grades: relations become candidates beside the entity rule; bad ones are warnings; grades survive a failed upsert", async () => {
  const env = newEnv();
  const ROCK = { source_key: "ia_rockwell", entity_key: "rockwell", entity_name: "Rockwell Automation", status: "public" };
  const rock = addAux(env, { ...ROCK, title: "Rockwell Automation to acquire AGILOX" });
  // AGILOX has no source of its own: its item came through a media feed (an own-source entity would make the row known).
  const agi = addAux(env, { source_key: "robot_report", entity_key: "robot_report", entity_name: "Industry media", status: "media", title: "AGILOX agrees to be acquired" });
  const claim = await claimAux(env, { limit: 5, run_id: "run-rel" });
  assert.equal(claim.items.length, 2);
  const R = (name, type = "acquired", evidence = rock) => ({ type, name, evidence });
  const file = { claim_id: claim.claim_id, run_id: "run-rel", grades: [
    grade(rock, { entity: "Rockwell Automation", score: 75, event_type: "contract", reads_through: [{ ticker: "SYM", direction: "-" }],
      relations: [R("AGILOX"), R("Red Cat"), R("Rockwell Automation Inc.", "acquirer"), R("Humyn Labs", "partner", agi)] }),
    grade(agi, { entity: "AGILOX", score: 88, event_type: "acquisition" }),
  ] };
  const r = (await submit(env, file)).body;
  assert.deepEqual([r.accepted, r.rejected], [2, []], "no grade is rejected for its relations");
  assert.deepEqual(r.warnings.map((w) => w.item_id), [rock, rock, rock]);
  assert.match(r.warnings[0].warning, /relation 2 "Red Cat" dropped: name is a covered company \(RCAT\)/);
  assert.match(r.warnings[1].warning, /relation 3 "Rockwell Automation Inc\." dropped: name is the grade's own subject/);
  assert.match(r.warnings[2].warning, new RegExp(`relation 4 "Humyn Labs" dropped: evidence must be the item you are grading \\(${rock}\\)`));
  const cands = () => rows(env, "SELECT name, origins, relation, subject, tickers, seen, evidence, status FROM expansion_candidates ORDER BY id");
  let c = cands();
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].name, c[0].relation, c[0].subject, c[0].status, JSON.parse(c[0].tickers), JSON.parse(c[0].origins)],
    ["AGILOX", "acquired", "Rockwell Automation", "pending", ["SYM"], ["grader_relation", "aux_entity"]]);
  assert.deepEqual(JSON.parse(c[0].seen), [`aux:${rock}`, `aux:${agi}`], "sightings 2");
  assert.deepEqual(JSON.parse(c[0].evidence).map((e) => [e.kind, e.item_id, e.origin]), [["aux", agi, "aux_entity"], ["aux", rock, "grader_relation"]]);

  // A re-submit and a new-run regrade both leave the sightings unchanged.
  const again = (await submit(env, file)).body;
  assert.deepEqual([again.accepted, again.already_accepted, again.warnings], [0, 2, []]);
  const re = (await submit(env, { run_id: "run-rel-2", grades: [grade(rock, { entity: "Rockwell Automation", score: 76, event_type: "contract", relations: [R("Agilox GmbH")] })] }, "admin")).body;
  assert.deepEqual([re.accepted, re.warnings], [1, []]);
  c = cands();
  assert.equal(c.length, 1, "Agilox GmbH has AGILOX's dedupe key");
  assert.deepEqual(JSON.parse(c[0].seen), [`aux:${rock}`, `aux:${agi}`]);
  assert.equal(count(env, "aux_grades"), 3);

  // A failed candidate upsert (here: no table, as before 0012) is a warning; the grade is stored.
  env.DB.exec("DROP TABLE expansion_candidates");
  const late = (await submit(env, { run_id: "run-rel-3", grades: [grade(agi, { entity: "AGILOX", score: 90, band: "lead", event_type: "acquisition",
    relations: [R("Rockwell Automation", "acquirer", agi)] })] }, "admin")).body;
  assert.deepEqual([late.accepted, late.rejected], [1, []]);
  assert.deepEqual(late.warnings.map((w) => w.item_id), [null]);
  assert.match(late.warnings[0].warning, /expansion queue not available yet: migration 0012 is not applied/);
  assert.equal(rows(env, "SELECT g.run_id FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id WHERE i.id = ?", agi)[0].run_id, "run-rel-3");
});
