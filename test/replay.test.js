// Phase 2, golden-set replay (synthetic fixtures only): the shared coverage
// claimable predicate (claimable.js), the industry ladder check in
// normalizeGrade, and the replay harness routes (replay.js).
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { coverageClaimableSql } = await import("../worker/src/claimable.js");
const { HELD_SQL, normalizeGrade } = await import("../worker/src/lib.js");
const { BILL_HOLD_SQL } = await import("../worker/src/bill-lines.js");

const newEnv = (extra = {}) => ({ DB: zenithDb(), ...TOKENS, ...extra });

// --- T3b: the claim SQL is unchanged ------------------------------------------------------------
test("T3b: the coverage claim built with coverageClaimableSql is string-equal to the inline text it replaced", async () => {
  const inline = `(state='pending' OR (state='claimed' AND claimed_until < ?3)) AND ${BILL_HOLD_SQL("?5")} AND NOT ${HELD_SQL()}`;
  assert.equal(coverageClaimableSql("?3", "?5"), inline);
  const before = `UPDATE items SET state='claimed', claim_id=?1, claimed_until=?2, attempts=attempts+1
      WHERE id IN (SELECT id FROM items WHERE (state='pending' OR (state='claimed' AND claimed_until < ?3)) AND ${BILL_HOLD_SQL("?5")} AND NOT ${HELD_SQL()}
                    ORDER BY (excerpt_status IS NULL), nm_first_seen DESC, id DESC LIMIT ?4)
        AND (state='pending' OR (state='claimed' AND claimed_until < ?3))`;
  const env = newEnv();
  const seen = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const r = await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 5, run_id: "run-sql" } });
  assert.equal(r.status, 200);
  assert.ok(seen.includes(before), "the claim UPDATE is byte-identical to the pre-phase-2 text");
});

// --- T12: the industry ladder in normalizeGrade --------------------------------------------------
test("T12: industry:<id> must be declared for the grade's ticker; the ceiling is 74 for a core entry and 69 otherwise", () => {
  const INDUSTRY = { SYN: { trade_x: { core: false }, rules_y: { core: true } } };
  const item = { id: 7, ticker: "SYN", title: "A synthetic agency action", published: "2026-01-01T00:00:00Z", first_seen: "2026-01-01T01:00:00Z" };
  const g = (score, flag) => ({ item_id: "7", score, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material", flag] });
  const check = (score, flag, industry = INDUSTRY) => normalizeGrade(g(score, flag), item, null, ["SYN"], null, { industry });
  assert.match(check(50, "industry:nope").error, /unknown industry link nope for SYN \(core\.md section 9A\)/);
  assert.match(check(70, "industry:trade_x").error, /industry ladder ceiling/);
  assert.equal(check(69, "industry:trade_x").ok, true);
  assert.match(check(75, "industry:rules_y").error, /industry ladder ceiling/);
  assert.equal(check(74, "industry:rules_y").ok, true);
  assert.match(check(50, "industry:rules_y", {}).error, /unknown industry link/, "an empty map rejects every industry flag");
  assert.match(check(50, "industry:constructor").error, /unknown industry link/, "only own keys count");
  assert.equal(normalizeGrade(g(90, "industry:nope"), item, null, ["SYN"], null).ok, true, "five arguments: not checked (unchanged callers)");
});

// --- The replay harness (replay.js) -------------------------------------------------------------
const { RUBRIC_VERSION } = await import("../worker/src/rubric.generated.js");
const { pairs, verdict, REPLAY_KEEP } = await import("../worker/src/replay.js");
const { loadWorker } = await import("./helpers/worker.js");
const { readFileSync, readdirSync } = await import("node:fs");

const CAND = "r-0000000c0ffe";
const CAND_FLOORS = '{"calendar":{"floor":77,"fixed":true,"undisclosed":null}}';
// A worker with a synthetic candidate bundled (rubric/candidate/ as build-rubric.mjs would emit it).
// The patterns match the committed lines whether or not a real overlay is bundled
// (PR-C4 bundles one), so these tests never depend on the repo's candidate.
const candLine = (name) => new RegExp(`^export const CANDIDATE_${name} = .*;$`, "m");
const candidateWorker = (version = CAND) => loadWorker({ patch: (f, code) => (f === "rubric.generated.js" ? code
  .replace(candLine("VERSION"), () => `export const CANDIDATE_VERSION = ${JSON.stringify(version)};`)
  .replace(candLine("FLOORS"), () => `export const CANDIDATE_FLOORS = ${CAND_FLOORS};`)
  .replace(candLine("INDUSTRY"), () => 'export const CANDIDATE_INDUSTRY = {"RCAT":{"rules_y":{"core":true}}};')
  .replace(candLine("SCOPE"), () => 'export const CANDIDATE_SCOPE = {"scope":"full","tickers":[]};') : code) });
const cworker = await candidateWorker();
// A worker with no candidate bundled (every CANDIDATE_* null), as on a main without rubric/candidate/.
const nworker = await loadWorker({ patch: (f, code) => (f === "rubric.generated.js"
  ? ["VERSION", "FLOORS", "INDUSTRY", "SCOPE"].reduce((c, n) => c.replace(candLine(n), `export const CANDIDATE_${n} = null;`), code) : code) });

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000, DAYMS = 86_400_000;
let gid = 0, rowid = 0;
function addGolden(env, over = {}) {
  const n = ++gid;
  const g = { code: `G${n}`, class: "anchor", basis: "rule", ticker: "RCAT", source_key: "redcat", role: null, affects: null,
    title: `Synthetic golden item ${n}`, url: `https://example.com/g/${n}`, published: "2026-01-05T00:00:00Z", first_seen: "2026-01-05T01:00:00Z",
    first_seen_rule: "published_plus_1h", excerpt: "Synthetic excerpt text.", excerpt_status: "ok", admit: null, expect: { RCAT: [40, 60] },
    ref: null, note: "a private note", active: 1, ...over };
  const r = env.DB.db.prepare(`INSERT INTO golden_items (code, class, basis, ticker, source_key, role, affects, title, url, published, first_seen,
      first_seen_rule, excerpt, excerpt_status, admit, expect, ref, note, active, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(g.code, g.class, g.basis, g.ticker, g.source_key, g.role, g.affects, g.title, g.url, g.published, g.first_seen, g.first_seen_rule, g.excerpt,
      g.excerpt_status, g.admit, JSON.stringify(g.expect), g.ref, g.note, g.active, iso());
  return { ...g, id: Number(r.lastInsertRowid) };
}
function addLiveItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", state: "pending", admit: null, released_at: null, ingested_at: iso(), ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (?, ?, ?, ?, 'Live item', NULL, NULL, ?, 0, ?, ?)`).run(++rowid, it.source_key, it.ticker, `https://ir.example.com/${rowid}`, iso(), it.ingested_at, it.state);
  env.DB.db.prepare("UPDATE items SET admit = ?, released_at = ? WHERE id = ?").run(it.admit, it.released_at, Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
}
function addAuxRow(env) {
  env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, attempts, coverage_subject) VALUES (?, 'synth_src', 'synthco', 'Synthco', 'private', ?, 'Aux item', NULL, NULL, ?, ?, 'pending', 0, 0)`)
    .run(++rowid, `https://news.example.com/a/${rowid}`, iso(), iso());
}
const idleRun = (env, id = "run-idle", claimed = 0) =>
  env.DB.db.prepare("INSERT OR REPLACE INTO runs (id, started_at, last_seen_at, claimed) VALUES (?, ?, ?, ?)").run(id, iso(), iso(), claimed);
const arm = (env, body = {}, w = worker) => request(w, env, "POST", "/v1/admin/replay", { body: { action: "arm", kind: "baseline", ...body } });
const rclaim = async (env, over = {}, w = worker) => (await request(w, env, "POST", "/v1/replay/claim", { role: "grader",
  body: { limit: 10, run_id: "run-idle", local: { live: RUBRIC_VERSION, candidate: CAND }, ...over } })).body;
const gr = (item_id, score, flags = ["reason:material"]) => ({ item_id, score, why: "w", read_source: true, confidence: 0.7, flags });
const rsubmit = (env, c, grades, w = worker, over = {}) => request(w, env, "POST", "/v1/replay/grades", { role: "grader",
  body: { claim_id: c.claim_id, run_id: "run-idle", rubric_version: c.rubric_version, model: "m", grades, ...over } });
const count = (env, t) => env.DB.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;
function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}
const FORBIDDEN = ["expect", "class", "basis", "code", "ref", "note", "first_seen_rule", "pass"];

test("T3: replay/claim reasons in order, then a claim when every check is clear", async () => {
  const env = newEnv();
  assert.equal((await rclaim(env)).reason, "none_armed");
  addGolden(env);
  assert.equal((await arm(env)).status, 200);
  assert.equal((await rclaim(env, { local: { live: "r-000000000000" } })).reason, "checkout_mismatch");
  assert.equal((await rclaim(env)).reason, "busy_run", "no runs row: the coverage claim did not run first");
  idleRun(env, "run-idle", 3);
  assert.equal((await rclaim(env)).reason, "busy_run", "the run claimed coverage items");
  idleRun(env);
  const live = addLiveItem(env);
  assert.equal((await rclaim(env)).reason, "live_coverage");
  env.DB.db.prepare("UPDATE items SET admit = 'seed_fresh' WHERE id = ?").run(live);
  addLiveItem(env, { source_key: "drv_govinfo_defense_bills" });
  for (let i = 0; i < 29; i++) addAuxRow(env);
  const clear = await rclaim(env, { limit: 1 });
  assert.equal(clear.items?.length, 1, `a held row, a bill row inside its hold window and 29 aux rows do not block (${clear.reason})`);
  env.DB.db.exec("UPDATE replay_queue SET state = 'pending', claim_id = NULL, claimed_until = NULL, attempts = 0");
  addAuxRow(env);
  assert.equal((await rclaim(env)).reason, "live_aux");
  env.DB.db.exec("DELETE FROM aux_items");
  const ins = env.DB.db.prepare("INSERT INTO replay_grades (replay_id, golden_id, ticker, pass, band, graded_at) VALUES ('rp-old', ?, 'RCAT', 1, 'reject', ?)");
  for (let i = 0; i < 20; i++) ins.run(1000 + i, iso());
  assert.equal((await rclaim(env)).reason, "daily_cap");
  env.DB.db.exec("DELETE FROM replay_grades");
  for (let i = 0; i < 100; i++) ins.run(1000 + i, iso(2 * DAYMS + i * MIN));
  assert.equal((await rclaim(env)).reason, "weekly_cap");
  env.DB.db.exec("DELETE FROM replay_grades");
  const off = await request(worker, { ...env, REPLAY_DAILY: "0" }, "POST", "/v1/replay/claim", { role: "grader",
    body: { run_id: "run-idle", local: { live: RUBRIC_VERSION } } });
  assert.equal(off.body.reason, "daily_cap", "REPLAY_DAILY=0 stops every replay claim");
  const runsBefore = env.DB.rows("SELECT * FROM runs");
  const c = await rclaim(env);
  assert.equal(c.items.length, 1);
  assert.equal(c.kind, "baseline");
  assert.equal(c.rubric_version, RUBRIC_VERSION);
  assert.deepEqual(env.DB.rows("SELECT * FROM runs"), runsBefore, "a replay claim writes no runs row");
});

test("T3: a claim never submitted still counts toward the caps after its lease ends", async () => {
  const lapse = (env) => env.DB.db.exec(`UPDATE replay_queue SET claimed_until = '${iso(1000)}' WHERE state = 'claimed'`);
  const env = newEnv({ REPLAY_WEEKLY: "15" });
  idleRun(env);
  for (let i = 0; i < 25; i++) addGolden(env);
  await arm(env);
  assert.equal((await rclaim(env)).items.length, 10);
  lapse(env);
  const second = await rclaim(env);
  assert.equal(second.items?.length, 5, `the lapsed 10 still count: 15 - 10 leaves 5 (${second.reason})`);
  lapse(env);
  assert.equal((await rclaim(env)).reason, "weekly_cap", "the reclaims count too");
  // The daily cap the same way. A lapsed claim's time is 45 minutes before its
  // claimed_until, so this part needs the UTC day to be past its first hour.
  const d = new Date();
  if (Date.now() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) > 60 * MIN) {
    const env2 = newEnv();
    idleRun(env2);
    for (let i = 0; i < 25; i++) addGolden(env2);
    await arm(env2);
    assert.equal((await rclaim(env2)).items.length, 10);
    lapse(env2);
    assert.equal((await rclaim(env2)).items.length, 10);
    lapse(env2);
    assert.equal((await rclaim(env2)).reason, "daily_cap", "20 claimed today, none submitted");
  }
});

test("T4: the claim carries no golden labels; the app's GET /v1/replay has counts and a verdict only; admin detail has the pairs", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env, { ref: "item:1", note: "private" });
  await arm(env);
  const c = await rclaim(env);
  const keys = keysDeep(c);
  for (const k of FORBIDDEN) assert.ok(!keys.has(k), `claim response holds ${k}`);
  assert.deepEqual(Object.keys(c.items[0]).sort(), ["admit", "affects", "excerpt", "excerpt_status", "first_seen", "item_id", "published", "record",
    "role", "seen_after_days", "source_key", "ticker", "title", "url"]);
  assert.equal(c.items[0].item_id, g.id);
  assert.equal((await rsubmit(env, c, [gr(g.id, 50)])).status, 200);
  const app = await request(worker, env, "GET", "/v1/replay", { role: "app" });
  assert.equal(app.status, 200);
  const appKeys = keysDeep(app.body);
  for (const k of ["code", "reasons", "misses", "regressions", "targets", "id"]) assert.ok(!appKeys.has(k), `app sees ${k}`);
  assert.equal(app.body.replays[0].verdict, "done");
  assert.deepEqual(app.body.replays[0].by_class.anchor, { n: 1, hits: 1 });
  assert.equal((await request(worker, env, "GET", "/v1/replay", { role: "grader" })).status, 403);
  const admin = (await request(worker, env, "GET", "/v1/replay?detail=1", { role: "admin" })).body;
  assert.ok("misses" in admin.replays[0] && "reasons" in admin.replays[0] && "regressions" in admin.replays[0]);
  assert.deepEqual(admin.detail.pairs, [{ code: g.code, ticker: "RCAT", pass: 1, score: 50, lo: 40, hi: 60, hit: true }]);
});

test("T5: a candidate replay validates with CANDIDATE_FLOORS and CANDIDATE_INDUSTRY", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env, { title: "Synthetic Co to report fourth quarter results on a set date" });
  assert.equal((await arm(env, { kind: "candidate" }, cworker)).status, 200);
  const c = await rclaim(env, {}, cworker);
  assert.equal(c.rubric_version, CAND);
  const cal = (score) => gr(g.id, score, ["reason:calendar_card", "floor:calendar"]);
  const r = (await rsubmit(env, c, [cal(72), cal(75)], cworker)).body;
  assert.equal(r.accepted, 0);
  assert.ok(r.rejected.every((x) => /floor:calendar, which is fixed at 77/.test(x.error)), JSON.stringify(r.rejected));
  assert.equal((await rsubmit(env, c, [cal(77)], cworker)).body.accepted, 1);
  // The live INDUSTRY {} would reject the flag; the candidate's industry_links apply here.
  const env2 = newEnv();
  idleRun(env2);
  const g2 = addGolden(env2);
  await arm(env2, { kind: "candidate" }, cworker);
  const c2 = await rclaim(env2, {}, cworker);
  const ind = (await rsubmit(env2, c2, [gr(g2.id, 75, ["reason:material", "industry:rules_y"])], cworker)).body;
  assert.match(ind.rejected[0].error, /industry ladder ceiling/);
  assert.equal((await rsubmit(env2, c2, [gr(g2.id, 74, ["reason:material", "industry:rules_y"])], cworker)).body.accepted, 1);
});

test("T6: a submit whose rubric_version is not the armed replay's is rejected in full", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env);
  await arm(env);
  const c = await rclaim(env);
  const r = await rsubmit(env, c, [gr(g.id, 50)], worker, { rubric_version: "r-ffffffffffff" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /is not the armed replay's/);
  assert.equal(count(env, "replay_grades"), 0);
  const other = await rsubmit(env, { claim_id: "not-mine", rubric_version: RUBRIC_VERSION }, [gr(g.id, 50)]);
  assert.match(other.body.rejected[0].error, /is not in claim not-mine/);
});

test("T7: a full replay leaves items, grades, runs and expansion_candidates unchanged; audit_log gains only the arm row", async () => {
  const env = newEnv();
  idleRun(env);
  addLiveItem(env, { state: "graded" });
  const a = addGolden(env, { expect: { RCAT: [40, 60], UMAC: [0, 20] }, affects: "UMAC" });
  const b = addGolden(env, { ticker: "UMAC", source_key: "umac", expect: { UMAC: [0, 39] } });
  const snap = () => ["items", "grades", "runs", "expansion_candidates"].map((t) => JSON.stringify(env.DB.rows(`SELECT * FROM ${t} ORDER BY rowid`)));
  const before = snap();
  const audits = count(env, "audit_log");
  await arm(env);
  const c = await rclaim(env);
  assert.equal(c.items.length, 2);
  const r = (await rsubmit(env, c, [gr(a.id, 55), gr(`${a.id}#UMAC`, 10), gr(b.id, 5, ["reason:out_of_scope"])])).body;
  assert.equal(r.accepted, 3);
  assert.equal(r.status, "done");
  assert.deepEqual(snap(), before);
  assert.equal(count(env, "audit_log"), audits + 1);
  assert.equal(env.DB.rows("SELECT target_id FROM audit_log ORDER BY id DESC LIMIT 1")[0].target_id, "replay_arm");
  assert.deepEqual({ ...env.DB.rows("SELECT status, n_graded, n_items FROM replays")[0] }, { status: "done", n_graded: 2, n_items: 2 });
  assert.equal(count(env, "replay_grades"), 3);
});

test("T8: verdict rules on a synthetic set (R1-R6), the confirm mean, and the missing #TICKER rule", () => {
  const G = (code, cls, expect, extra = {}) => ({ id: ++gid, code, class: cls, basis: "rule", ticker: "RCAT", expect: JSON.stringify(expect), ...extra });
  const run = (golden, scores, { kind = "candidate", targets = [], reference = null, failed = [] } = {}) => {
    const grades = [], queue = [];
    for (const g of golden) {
      queue.push({ golden_id: g.id, pass: 1, state: failed.includes(g.code) ? "failed" : "graded" });
      for (const [key, v] of Object.entries(scores[g.code] || {})) {
        const [ticker, pass] = key.split(":");
        grades.push({ golden_id: g.id, ticker, pass: Number(pass || 1), score: v, band: v == null ? "duplicate" : "x" });
        if (Number(pass) === 2 && !queue.some((q) => q.golden_id === g.id && q.pass === 2)) queue.push({ golden_id: g.id, pass: 2, state: "graded" });
      }
    }
    return verdict({ kind, targets: JSON.stringify(targets) }, pairs(golden, queue, grades), { reference });
  };
  const anchor = G("A1", "anchor", { RCAT: [40, 60] });
  assert.equal(run([anchor], { A1: { RCAT: 50 } }).verdict, "passed", "all hit");
  assert.equal(run([anchor], { A1: { RCAT: 50 } }, { kind: "baseline" }).verdict, "done");
  const guard = G("GX", "guard", { RCAT: [0, 39], UMAC: [0, 39] });
  assert.equal(run([guard], { GX: { RCAT: 45, "RCAT:2": 30 } }).verdict, "passed", "45 then 30: mean 38");
  const g2 = run([guard], { GX: { RCAT: 45, "RCAT:2": 41 } });
  assert.equal(g2.verdict, "failed");
  assert.match(g2.reasons.join(" "), /R2 guards: GX/);
  assert.deepEqual(run([guard], { GX: { RCAT: 5 } }).misses, [], "a guard #TICKER pair with hi 39 and no grade is a hit");
  const target = G("T1", "ladder", { RCAT: [60, null] });
  assert.equal(run([target], { T1: { RCAT: 58, "RCAT:2": 66 } }, { targets: ["T1"] }).verdict, "passed", "58 then 66: mean 62");
  assert.match(run([target], { T1: { RCAT: 50, "RCAT:2": 55 } }, { targets: ["T1"] }).reasons.join(" "), /R3 targets: T1/);
  const reports = [1, 2, 3].map((i) => G(`L${i}`, "ladder", { RCAT: [45, null] }));
  const rep = (n) => Object.fromEntries(reports.map((r, i) => [r.code, { RCAT: i < n ? 10 : 50 }]));
  assert.equal(run(reports, rep(2)).verdict, "passed", "2 report misses pass");
  assert.match(run(reports, rep(3)).reasons.join(" "), /R3b report misses 3 > 2/);
  const sentinel = G("S1", "ladder", { RCAT: [68, 89] }, { basis: "sheet" });
  assert.match(run([sentinel], { S1: { RCAT: 60, "RCAT:2": 62 } }).reasons.join(" "), /R4 sentinels: S1/);
  const anchors = [1, 2, 3, 4, 5, 6].map((i) => G(`AN${i}`, "anchor", { RCAT: [40, 60] }));
  const an = (n, gap = 10) => Object.fromEntries(anchors.map((a, i) => [a.code, { RCAT: i < n ? 60 + gap : 50 }]));
  const ref = { anchor_misses: 2, hit_pairs: [] };
  assert.equal(run(anchors, an(4), { reference: ref }).verdict, "passed", "reference 2 anchor misses: 4 pass");
  assert.match(run(anchors, an(5), { reference: ref }).reasons.join(" "), /R5 anchor misses 5 > 4/);
  assert.match(run(anchors, an(1, 21), { reference: ref }).reasons.join(" "), /R5 anchors more than 20 points off: AN1/);
  const refAll = { anchor_misses: 5, hit_pairs: anchors.map((a) => a.code) };
  assert.equal(run(anchors, an(3), { reference: refAll }).verdict, "passed", "3 regressions pass");
  assert.match(run(anchors, an(4), { reference: refAll }).reasons.join(" "), /R6 regressions 4 > 3/);
  // R1: a failed queue row is a miss; the own ticker always needs a grade.
  assert.match(run([anchor], {}, { failed: ["A1"] }).reasons.join(" "), /R1 incomplete: A1/);
  const cross = G("X1", "recall", { RCAT: [40, 60], UMAC: [50, 70] });
  assert.match(run([cross], { X1: { RCAT: 50 } }).reasons.join(" "), /R1 incomplete: X1#UMAC/);
  const dup = G("D1", "anchor", { RCAT: "duplicate" });
  assert.equal(run([dup], { D1: { RCAT: null } }).verdict, "passed", "a duplicate expectation hits on band duplicate");
});

test("T8: through the API a missed pair gets exactly one confirm re-grade, and the baseline ends done", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env, { expect: { RCAT: [40, 60] } });
  await arm(env);
  let c = await rclaim(env);
  let r = (await rsubmit(env, c, [gr(g.id, 80)])).body;
  assert.deepEqual([r.confirm_added, r.status], [1, "armed"]);
  assert.deepEqual(env.DB.rows("SELECT pass, state FROM replay_queue ORDER BY pass").map((r) => ({ ...r })), [{ pass: 1, state: "graded" }, { pass: 2, state: "pending" }]);
  r = (await rsubmit(env, c, [gr(g.id, 80)])).body;
  assert.equal(r.confirm_added, 0, "a resubmit adds no second confirm");
  c = await rclaim(env);
  assert.equal(c.items.length, 1);
  r = (await rsubmit(env, c, [gr(g.id, 30)])).body;
  assert.equal(r.status, "done");
  assert.equal(count(env, "replay_queue"), 2, "only one confirm row per pair");
  const s = JSON.parse(env.DB.rows("SELECT summary FROM replays")[0].summary);
  assert.deepEqual([s.verdict, s.misses, s.live_agreement.confirm], ["done", [], [{ pair: g.code, delta: 50 }]], "80 then 30: mean 55 hits");
});

test("T8: a rejected grade keeps its row open: a fixed resubmit is judged, and an unfixed row closes at lease end", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env, { class: "guard", affects: "UMAC", expect: { RCAT: [0, 39], UMAC: [0, 39] } });
  await arm(env);
  const c = await rclaim(env);
  let r = (await rsubmit(env, c, [gr(g.id, 20), gr(`${g.id}#UMAC`, 45, [])])).body;
  assert.deepEqual([r.accepted, r.rejected.length, r.status, r.not_yet_graded], [1, 1, "armed", [g.id]], "no verdict while a grade of the row was rejected");
  assert.equal(env.DB.rows("SELECT state FROM replay_queue")[0].state, "claimed");
  r = (await rsubmit(env, c, [gr(g.id, 20), gr(`${g.id}#UMAC`, 45)])).body;
  assert.deepEqual([r.accepted, r.rejected.length, r.confirm_added, r.status], [2, 0, 1, "armed"], "the fixed #UMAC grade is judged: 45 misses, one confirm");
  assert.equal(env.DB.rows("SELECT score FROM replay_grades WHERE ticker = 'UMAC'")[0].score, 45);
  // Never fixed: the next replay claim after the lease closes the row on the grades it has.
  const env2 = newEnv();
  idleRun(env2);
  const g2 = addGolden(env2, { class: "guard", affects: "UMAC", expect: { RCAT: [0, 39], UMAC: [0, 39] } });
  await arm(env2);
  const c2 = await rclaim(env2);
  assert.equal((await rsubmit(env2, c2, [gr(g2.id, 20), gr(`${g2.id}#UMAC`, 45, [])])).body.status, "armed");
  env2.DB.db.exec(`UPDATE replay_queue SET claimed_until = '${iso(MIN)}'`);
  assert.equal((await rclaim(env2)).reason, "replay_finished");
  assert.deepEqual({ ...env2.DB.rows("SELECT state, attempts FROM replay_queue")[0] }, { state: "graded", attempts: 1 }, "closed, not reclaimed");
  const rp = env2.DB.rows("SELECT status, n_graded, summary FROM replays")[0];
  assert.deepEqual([rp.status, rp.n_graded, JSON.parse(rp.summary).misses], ["done", 1, []]);
});

test("T8: a missing #TICKER grade with hi >= 40 gets no confirm re-grade; it stays an R1 miss on pass 1", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env, { affects: "UMAC", expect: { RCAT: [40, 60], UMAC: [50, 70] } });
  await arm(env);
  const c = await rclaim(env);
  const r = (await rsubmit(env, c, [gr(g.id, 50)])).body;
  assert.deepEqual([r.confirm_added, r.status], [0, "done"], "no pass-2 row spent on a pair pass 1 never graded");
  assert.equal(count(env, "replay_queue"), 1);
  const s = JSON.parse(env.DB.rows("SELECT summary FROM replays")[0].summary);
  assert.deepEqual(s.misses, [`${g.code}#UMAC`]);
});

test("T9: an unreturned claim is reclaimable after its lease; after MAX_ATTEMPTS the row is failed and a miss", async () => {
  const env = newEnv();
  idleRun(env);
  const g = addGolden(env);
  await arm(env);
  const first = await rclaim(env);
  assert.equal(first.items.length, 1);
  assert.equal((await rclaim(env)).reason, "nothing_claimable", "still leased");
  env.DB.db.exec(`UPDATE replay_queue SET claimed_until = '${iso(MIN)}'`);
  const again = await rclaim(env);
  assert.equal(again.items.length, 1, "reclaimable after the lease");
  assert.notEqual(again.claim_id, first.claim_id);
  env.DB.db.exec(`UPDATE replay_queue SET attempts = 4, claimed_until = '${iso(MIN)}'`);
  assert.equal((await rclaim(env)).reason, "replay_finished");
  assert.equal(env.DB.rows("SELECT state FROM replay_queue")[0].state, "failed");
  const s = JSON.parse(env.DB.rows("SELECT summary FROM replays")[0].summary);
  assert.deepEqual(s.misses, [g.code]);
});

test("T10: arm rules: 409 while armed, 400 without a candidate, stale versions abort, retry scope, owner_review on the 4th", async () => {
  const env = newEnv();
  idleRun(env);
  for (const code of ["AN-A", "AN-B", "AN-C"]) addGolden(env, { code });
  addGolden(env, { code: "GU-1", class: "guard", expect: { RCAT: [0, 39] } });
  addGolden(env, { code: "SE-1", class: "ladder", basis: "sheet", expect: { RCAT: [68, 89] } });
  addGolden(env, { code: "TG-1", class: "ladder", expect: { RCAT: [60, null] } });
  assert.equal((await arm(env)).status, 200);
  assert.equal((await arm(env)).status, 409);
  assert.equal((await request(worker, env, "POST", "/v1/admin/replay", { body: { action: "abort" } })).status, 200);
  const none = await arm(env, { kind: "candidate" }, nworker);
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no candidate rubric is bundled/);
  assert.match((await arm(env, { kind: "candidate", targets: ["NOPE"] }, cworker)).body.error, /unknown target codes: NOPE/);
  // A candidate armed under one bundle aborts itself once that version is no longer bundled.
  assert.equal((await arm(env, { kind: "candidate" }, cworker)).status, 200);
  const moved = await candidateWorker("r-0000000beef0");
  assert.equal((await rclaim(env, { local: { live: RUBRIC_VERSION, candidate: "r-0000000beef0" } }, moved)).reason, "none_armed");
  const aborted = env.DB.rows("SELECT status, summary FROM replays WHERE kind = 'candidate'")[0];
  assert.deepEqual([aborted.status, JSON.parse(aborted.summary).reason], ["aborted", "rubric_version_not_bundled"]);
  const first = (await arm(env, { kind: "candidate", targets: ["TG-1"] }, cworker)).body;
  assert.equal(first.iteration, 1, "an aborted replay does not count");
  env.DB.db.prepare("UPDATE replays SET status = 'failed', summary = ? WHERE id = ?").run(JSON.stringify({ verdict: "failed", misses: ["AN-A", "AN-B#UMAC"] }), first.replay_id);
  assert.match((await arm(env, { kind: "baseline", scope: "retry" })).body.error, /scope retry needs/);
  const retry = (await arm(env, { kind: "candidate", scope: "retry", targets: ["TG-1"] }, cworker)).body;
  assert.equal(retry.iteration, 2);
  const queued = env.DB.rows("SELECT g.code FROM replay_queue q JOIN golden_items g ON g.id = q.golden_id WHERE q.replay_id = ? ORDER BY g.code", retry.replay_id).map((r) => r.code);
  assert.deepEqual(queued, ["AN-A", "AN-B", "GU-1", "SE-1", "TG-1"], "missed pairs plus guards, sentinels and targets; AN-C hit and is left out");
  env.DB.db.prepare("UPDATE replays SET status = 'failed' WHERE id = ?").run(retry.replay_id);
  const third = (await arm(env, { kind: "candidate" }, cworker)).body;
  assert.equal(third.iteration, 3);
  env.DB.db.prepare("UPDATE replays SET status = 'failed' WHERE id = ?").run(third.replay_id);
  const fourth = await arm(env, { kind: "candidate" }, cworker);
  assert.equal(fourth.status, 400);
  assert.match(fourth.body.error, /^owner_review/);
});

test("T10: the 21st arm deletes the oldest replay's rows only", async () => {
  const env = newEnv();
  const g = addGolden(env, { code: "R-A" });
  const ins = env.DB.db.prepare(`INSERT INTO replays (id, rubric_version, base_version, kind, scope, status, armed_at, n_items) VALUES (?, 'r-x', 'r-x', 'baseline', 'full', 'done', ?, 1)`);
  for (let i = 0; i < REPLAY_KEEP; i++) {
    const id = `rp-${String(i).padStart(2, "0")}`;
    ins.run(id, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`);
    env.DB.db.prepare("INSERT INTO replay_queue (replay_id, golden_id) VALUES (?, ?)").run(id, g.id);
    env.DB.db.prepare("INSERT INTO replay_grades (replay_id, golden_id, ticker, band, graded_at) VALUES (?, ?, 'RCAT', 'reject', ?)").run(id, g.id, iso(40 * DAYMS));
  }
  const r = (await arm(env, { reference_id: "rp-05" })).body;
  assert.equal(r.deleted, "rp-00");
  assert.equal(r.reference_id, "rp-05");
  assert.equal(count(env, "replays"), REPLAY_KEEP);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM replay_queue WHERE replay_id = 'rp-00'")[0].n, 0);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM replay_grades WHERE replay_id = 'rp-00'")[0].n, 0);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM replay_queue WHERE replay_id = 'rp-01'")[0].n, 1, "only the oldest goes");
});

const GOOD = (over = {}) => ({ code: "GL-1", class: "anchor", basis: "rule", ticker: "RCAT", source_key: "redcat", title: "Synthetic Co wins a synthetic order",
  first_seen: "2026-01-05T01:00:00Z", published: "2026-01-05T00:00:00Z", first_seen_rule: "published_plus_1h", excerpt: "Synthetic text.", expect: { RCAT: [40, 60] }, ...over });
const golden = (env, body) => request(worker, env, "POST", "/v1/admin/golden", { body });

test("T11: admin/golden validates, counts on dry_run, refuses while armed, and audits without expectations", async () => {
  const env = newEnv();
  assert.equal((await request(worker, env, "POST", "/v1/admin/golden", { role: "grader", body: { items: [GOOD()] } })).status, 403);
  const dry = (await golden(env, { items: [GOOD(), GOOD({ code: "GU-1", class: "guard", expect: { RCAT: [0, 39] } })], dry_run: true })).body;
  assert.deepEqual(dry, { dry_run: true, would_insert: 2, would_update: 0, by_class: { anchor: 1, guard: 1 }, active_after: 2 });
  assert.equal(count(env, "golden_items"), 0);
  assert.match((await golden(env, { items: [GOOD({ ticker: "ZZZZ" })] })).body.error, /ticker ZZZZ is not covered/);
  const dropped = GOOD({ code: "IN-1", ticker: "ZZZZ", source_key: "zzzz", expect: { ZZZZ: [40, 60] } });
  assert.match((await golden(env, { items: [{ ...dropped, active: 1 }] })).body.error, /ticker ZZZZ is not covered/, "active: refused");
  assert.equal((await golden(env, { items: [{ ...dropped, active: 0 }] })).status, 200,
    "an inactive item for a dropped name, expect keyed to its own ticker, is accepted");
  assert.match((await golden(env, { items: [{ ...dropped, code: "IN-2", active: 0, affects: "YYYY", expect: { ZZZZ: [40, 60], YYYY: [40, 60] } }] })).body.error,
    /expect key YYYY is not a covered ticker/, "only the item's own ticker is exempt");
  assert.match((await golden(env, { items: [GOOD({ code: "GL-2", excerpt: "Sorry, you have been blocked" })] })).body.error, /block or challenge page/);
  assert.match((await golden(env, { items: [GOOD({ code: "GL-3", expect: { RCAT: [40, 60], UMAC: [50, 60] } })] })).body.error, /UMAC is neither in affects nor named in the title/);
  assert.equal((await golden(env, { items: [GOOD({ code: "GL-4", affects: "UMAC", expect: { RCAT: [40, 60], UMAC: [50, 60] } })] })).status, 200);
  assert.match((await golden(env, { items: [GOOD({ code: "GL-5", expect: { RCAT: [60, 40] } })] })).body.error, /\[lo, hi\]/);
  const many = Array.from({ length: 64 }, (_, i) => GOOD({ code: `M-${i}` }));
  const over = await golden(env, { items: many });
  assert.equal(over.status, 400, "65 active with the one already loaded");
  assert.match(over.body.error, /65 active golden items would exceed GOLDEN_MAX 64/);
  const res = await golden(env, { items: [GOOD()] });
  assert.deepEqual(res.body, { ok: true, inserted: 1, updated: 0, by_class: { anchor: 1 }, active: 2 });
  assert.equal((await golden(env, { items: [GOOD({ title: "Synthetic Co wins a larger synthetic order" })] })).body.updated, 1);
  const audits = env.DB.rows("SELECT target_kind, after_json FROM audit_log WHERE action = 'golden_load'");
  assert.equal(audits.length, 4);
  for (const a of audits) {
    assert.equal(a.target_kind, "golden");
    assert.doesNotMatch(a.after_json, /expect|\[40|RCAT/, a.after_json);
  }
  idleRun(env);
  await arm(env);
  assert.equal((await golden(env, { items: [GOOD()] })).status, 409, "frozen while armed");
  const ops = (await request(worker, env, "GET", "/v1/ops", { role: "app" })).body;
  assert.deepEqual(ops.replay, { armed: { kind: "baseline", scope: "full", rubric_version: RUBRIC_VERSION, n_graded: 0, n_items: 2 }, last: null });
});

test("T18: replay.js and claimable.js reach neither delivery.js nor discord.js, and make no fetch", () => {
  const SRC = new URL("../worker/src/", import.meta.url);
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) walk(m[1]);
  };
  for (const f of ["replay.js", "claimable.js"]) {
    seen.clear();
    walk(f);
    assert.ok(seen.size > 1 || f === "claimable.js");
    assert.ok(!seen.has("delivery.js") && !seen.has("discord.js"), `${f} reaches ${[...seen].join(", ")}`);
    assert.doesNotMatch(readFileSync(new URL(f, SRC), "utf8"), /\bfetch\(/, `${f} makes no fetch`);
  }
  assert.ok(readdirSync(SRC).includes("replay.js"));
});
