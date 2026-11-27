// Phase 3 PR-CV3 test V13: rarity.js rareData and GET /v1/rare's ticker, until
// and as_of. Synthetic fixtures only: tickers and source keys are picked from the
// bundled maps at run time (the test/rarity.test.js pattern); every row is seeded
// here and carries no real title, id or score.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { rareData, rareTicker, rarityClass } = await import("../worker/src/rarity.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");
const { universeSql } = await import("../worker/src/lib.js");
const { default: COVERED } = await import("../worker/src/covered.json");
const { default: AUX } = await import("../worker/src/aux-sources.json");

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const [T, U] = COVERED.tickers;
// A coverage-subject filter key (not a record, not sec): an "original" row on a trade host, "register" on legistar.
const FILTER = Object.entries(AUX.sources).find(([, a]) => a.coverage_subject && !a.record && !a.sec)?.[0];
const AUX_RECORD = Object.entries(AUX.sources).find(([, a]) => a.record === true && !a.sec)?.[0];
const UNIVERSE = universeSql(COVERED.tickers);

let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: FILTER, ticker: T, url: `https://town.legistar.com/Matter.aspx?ID=${++rowid}`, title: "A synthetic story",
    nm_first_seen: iso(DAY), state: "pending", ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, role)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, NULL)`).run(rowid, it.source_key, it.ticker, it.url, it.title, iso(DAY), it.nm_first_seen, iso(), it.state);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, { score = 70, ticker = null, run_id = null, graded_at = iso(DAY / 2), primary = true } = {}) {
  const item = env.DB.db.prepare("SELECT ticker FROM items WHERE id = ?").get(itemId);
  const band = score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, 'why', '["reason:material"]', 1, ?)`).run(itemId, ticker ?? item.ticker, run_id ?? `run-${itemId}`, score, band, graded_at);
  const id = Number(r.lastInsertRowid);
  if (primary) env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(id, itemId);
  return id;
}
function addAux(env, { score = 70, affects = null, reads_through = null, nm_first_seen = iso(DAY), source_key = AUX_RECORD } = {}) {
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state, affects)
    VALUES (?, ?, 'synthetic', 'Synthetic', 'public', ?, 'A synthetic aux story', ?, ?, 'graded', ?)`)
    .run(500000 + ++rowid, source_key, `https://records.example/${rowid}`, nm_first_seen, iso(), affects);
  const id = Number(r.lastInsertRowid);
  const band = score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
  const g = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, reads_through, flags, graded_at) VALUES (?, 'run-x', 'Synthetic', ?, ?, ?, '["reason:material"]', ?)`)
    .run(id, score, band, reads_through, iso());
  env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), id);
  return id;
}
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });
// A D1 wrapper that records every statement and its binds.
function spy(db) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      const real = db.prepare(sql);
      return { bind(...a) { call.binds = a; return real.bind(...a); }, all: () => real.all(), first: (c) => real.first(c), run: () => real.run() };
    },
    batch: (s) => db.batch(s),
    exec: (s) => db.exec(s),
    db: db.db,
  };
}
const reads = (...ts) => JSON.stringify(ts.map((ticker) => ({ ticker, direction: "-" })));
const ids = (list) => list.map((r) => r.item_id);

test("V13 fixtures: the bundled maps have the key shapes and two covered tickers", () => {
  assert.ok(T && U && T !== U, "two covered tickers");
  assert.ok(FILTER && AUX_RECORD, "a filter key and an aux record key");
  assert.equal(rarityClass({ source_key: FILTER, url: "https://town.legistar.com/x" }), "register");
  assert.equal(rarityClass({ source_key: AUX_RECORD, url: "https://records.example/x" }), "register");
});

test("V13: ?ticker=T keeps T's coverage rows and the aux rows whose affects or reads_through names T", async () => {
  const env = newEnv();
  const mine = addItem(env, { ticker: T });
  addGrade(env, mine, { score: 70 });
  const theirs = addItem(env, { ticker: U });
  addGrade(env, theirs, { score: 80 });
  const byAffects = addAux(env, { affects: `${U},${T}` });
  const byReads = addAux(env, { reads_through: reads(U, T) });
  addAux(env, { affects: U });                                   // another ticker's
  addAux(env, { affects: `${T}Z` });                              // a longer string is not T
  addAux(env, { reads_through: "not json" });                     // malformed: no throw, not T's
  addAux(env, { reads_through: JSON.stringify([{ ticker: `${T}Z` }]) });

  const r = await request(worker, env, "GET", `/v1/rare?days=14&ticker=${T.toLowerCase()}`, { role: "app" });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r.body.coverage), [mine]);
  assert.ok(r.body.coverage.every((x) => x.ticker === T));
  assert.deepEqual(ids(r.body.aux).sort(), [byAffects, byReads].sort());
  // Without the ticker every row is there; existing fields first, as_of added last.
  const all = await request(worker, env, "GET", "/v1/rare?days=14", { role: "app" });
  assert.deepEqual(Object.keys(all.body), ["coverage", "aux", "floor", "days", "as_of"]);
  assert.equal(all.body.coverage.length, 2);
  assert.equal(all.body.aux.length, 6);
  assert.ok(Math.abs(Date.parse(all.body.as_of) - Date.now()) < 60_000, "as_of is the read time");
  // An empty ticker is no filter.
  assert.equal((await request(worker, env, "GET", "/v1/rare?days=14&ticker=", { role: "app" })).body.coverage.length, 2);
});

test("V13: 201 higher-scored rows of another ticker cannot push T's row out (the filter runs before the scan limit)", async () => {
  const env = newEnv();
  for (let i = 0; i < 201; i++) addGrade(env, addItem(env, { ticker: U }), { score: 90 + (i % 10) });
  const mine = addItem(env, { ticker: T });
  addGrade(env, mine, { score: 61 });
  const all = (await request(worker, env, "GET", "/v1/rare", { role: "app" })).body;
  assert.ok(!ids(all.coverage).includes(mine), "without the filter, T's row is past the limit");
  const only = (await request(worker, env, "GET", `/v1/rare?ticker=${T}`, { role: "app" })).body;
  assert.deepEqual(ids(only.coverage), [mine]);
});

test("V13: a cross-ticker (#T) grade is not a Rare find for T (only the primary grade is joined, as in phase 2)", async () => {
  const env = newEnv();
  const other = addItem(env, { ticker: U });
  addGrade(env, other, { score: 75, run_id: "run-shared" });
  addGrade(env, other, { score: 88, ticker: T, run_id: "run-shared", primary: false });
  const r = (await request(worker, env, "GET", `/v1/rare?ticker=${T}`, { role: "app" })).body;
  assert.deepEqual(r.coverage, []);
  const u = (await request(worker, env, "GET", `/v1/rare?ticker=${U}`, { role: "app" })).body;
  assert.deepEqual(ids(u.coverage), [other]);
});

test("V13: an unknown or hostile ticker is 400 with no statement run; the ticker is bound, never spliced", async () => {
  const env = newEnv();
  addGrade(env, addItem(env, { ticker: T }), { score: 70 });
  const DB = spy(env.DB);
  for (const bad of ["ZZZZ", "AAA') OR 1=1--", "%20", `${T}Z`, `${T},${U}`]) {
    const r = await request(worker, { ...env, DB }, "GET", `/v1/rare?ticker=${encodeURIComponent(bad)}`, { role: "app" });
    assert.equal(r.status, 400, bad);
    assert.deepEqual(r.body, { error: "unknown ticker" }, bad);
  }
  assert.equal(DB.calls.length, 0, "no statement before the check");
  await request(worker, { ...env, DB }, "GET", `/v1/rare?ticker=${T}`, { role: "app" });
  assert.equal(DB.calls.length, 2);
  const [cov, aux] = DB.calls;
  assert.equal(cov.binds.at(-1), T);
  assert.deepEqual(aux.binds.slice(-2), [T, T]);
  for (const c of DB.calls) {
    const text = c.sql.split(UNIVERSE).join("<UNIVERSE>");
    assert.ok(!new RegExp(`\\b${T.replace(".", "\\.")}\\b`).test(text), "the ticker is only in the universe list, which is built by code");
  }
  await assert.rejects(rareData({ DB }, { since: iso(DAY), floor: 60, ticker: "ZZZZ", muted: MUTED_SQL }), RangeError);
  await assert.rejects(rareData({ DB }, { since: iso(DAY), floor: 60, ticker: T.toLowerCase(), muted: MUTED_SQL }), RangeError, "rareData takes the checked form only");
  assert.equal(DB.calls.length, 2);
  assert.equal(rareTicker(null), null);
  assert.equal(rareTicker(""), null);
  assert.equal(rareTicker(` ${T.toLowerCase()} `), T);
  assert.equal(rareTicker("ZZZZ"), false);
});

test("V13: rareData's until bounds coverage by graded_at and aux by first seen; as_of is the injected clock", async () => {
  const env = newEnv();
  const early = addItem(env);
  addGrade(env, early, { score: 70, graded_at: iso(5 * DAY) });
  const late = addItem(env);
  addGrade(env, late, { score: 70, graded_at: iso(DAY) });
  const auxEarly = addAux(env, { nm_first_seen: iso(5 * DAY) });
  addAux(env, { nm_first_seen: iso(DAY) });
  const now = Date.now();
  const out = await rareData(env, { since: iso(10 * DAY), until: iso(3 * DAY), floor: 60, muted: MUTED_SQL, universe: UNIVERSE, now });
  assert.deepEqual(Object.keys(out), ["coverage", "aux", "floor", "as_of"]);
  assert.deepEqual(ids(out.coverage), [early]);
  assert.deepEqual(ids(out.aux), [auxEarly]);
  assert.equal(out.as_of, new Date(now).toISOString());
  const open = await rareData(env, { since: iso(10 * DAY), floor: 60, muted: MUTED_SQL, universe: UNIVERSE, now });
  assert.equal(open.coverage.length, 2);
  assert.equal(open.aux.length, 2);
});

test("V13: the ticker form's plans search the ticker index and the aux state index; no row table is scanned", () => {
  const db = zenithDb();
  const captured = [];
  const rec = { prepare(sql) { captured.push(sql); return { bind() { return this; }, async all() { return { results: [] }; } }; } };
  return rareData({ DB: rec }, { since: iso(DAY), until: iso(0), floor: 60, ticker: T, muted: MUTED_SQL, universe: UNIVERSE }).then(() => {
    const plan = (sql, n) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("x")).map((r) => r.detail);
    const cov = plan(captured[0], 4);
    assert.match(cov[0], /^SEARCH g USING INDEX idx_grades_ticker(_graded)? \(ticker=\?/, cov.join(" | "));
    const aux = plan(captured[1], 5);
    assert.match(aux[0], /^SEARCH a USING INDEX aux_items_state \(state=\? AND nm_first_seen>\? AND nm_first_seen<\?\)/, aux.join(" | "));
    for (const d of [...cov, ...aux]) assert.doesNotMatch(d, /^SCAN (i|a|g|items|aux_items|grades|aux_grades)\b/, d);
  });
});

test("V13: /v1/rare without a token is 401; the grader token is 403", async () => {
  const env = newEnv();
  const r = await worker.fetch(new Request(`https://zenith.test/v1/rare?days=14&ticker=${T}`), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });
  assert.equal((await request(worker, env, "GET", `/v1/rare?ticker=${T}`, { role: "grader" })).status, 403);
});
