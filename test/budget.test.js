// Phase 0 gates (plans/phase0-build-spec.md, Appendix A section 2, change h):
// the daily grading budget. Held rows (admit set, released_at NULL) are never
// claimed and never counted as waiting; releaseHeld lets at most 20 a UTC day
// through across both pipelines, at most 5 per source, while the claimable
// queue is under 60. Synthetic rows only, over the real migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { releaseHeld, budgetSettings, utcDayStart } = await import("../worker/src/budget.js");
const { heartbeatChecks } = await import("../worker/src/delivery.js");
const { enrich } = await import("../worker/src/excerpt.js");
const { ingest } = await import("../worker/src/ingest.js");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (msAgo = 0, base = Date.now()) => new Date(base - msAgo).toISOString();
const newEnv = (extra = {}) => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra });
const plain = (rows) => rows.map((r) => ({ ...r }));

let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: `Testco news ${rowid}`, published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", claim_id: null, claimed_until: null, role: null, admit: null, released_at: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state,
      claim_id, claimed_until, role, admit, released_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(over.nm_rowid ?? rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.claim_id, it.claimed_until,
      it.role, it.admit, it.released_at);
  return Number(r.lastInsertRowid);
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", url: `https://news.example.com/a/${++rowid}`, title: `Outside news ${rowid}`, published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", claim_id: null, claimed_until: null, admit: null, released_at: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, claim_id, claimed_until, admit, released_at) VALUES (?, ?, 'testent', 'Testent (private)', 'private', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(over.nm_rowid ?? rowid, it.source_key, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.claim_id, it.claimed_until, it.admit, it.released_at);
  return Number(r.lastInsertRowid);
}
const held = (over = {}) => ({ admit: "record_late", ...over });
const claim = async (env, path = "/v1/queue/claim", limit = 40) => (await request(worker, env, "POST", path, { role: "grader", body: { limit } })).body;
const ids = (c) => c.items.map((i) => i.item_id).sort((a, b) => a - b);

test("held rows are never claimed until released; claim.remaining and aux remaining exclude them", async () => {
  const env = newEnv();
  const fresh = addItem(env);
  const h = addItem(env, held());
  addItem(env, held());
  const auxFresh = addAux(env);
  const auxHeld = addAux(env, held({ admit: "seed_window" }));
  let c = await claim(env);
  assert.deepEqual(ids(c), [fresh]);
  assert.equal(c.remaining, 0, "held rows are not waiting");
  let a = await claim(env, "/v1/aux/claim");
  assert.deepEqual(ids(a), [auxFresh]);
  assert.equal(a.remaining, 0);
  const r = await releaseHeld(env);
  assert.deepEqual(r.released, { coverage: 2, aux: 1 });
  c = await claim(env);
  assert.ok(ids(c).includes(h), "a released row is claimable");
  a = await claim(env, "/v1/aux/claim");
  assert.deepEqual(ids(a), [auxHeld]);
});

test("aux claim: a held pending row and a held expired-claimed row are both not returned", async () => {
  const env = newEnv();
  addAux(env, held());
  addAux(env, held({ state: "claimed", claim_id: "old-claim", claimed_until: iso(HOUR) }));
  const open = addAux(env, { state: "claimed", claim_id: "old-claim", claimed_until: iso(HOUR) });
  const a = await claim(env, "/v1/aux/claim");
  assert.deepEqual(ids(a), [open], "only the unheld expired claim comes back");
  // Coverage: the same, for an expired held claim.
  addItem(env, held({ state: "claimed", claim_id: "old", claimed_until: iso(HOUR) }));
  assert.deepEqual(ids(await claim(env)), []);
});

test("releaseHeld: at most 20 a UTC day across both pipelines, at most 5 per source, oldest first_seen first, coverage before aux", async () => {
  const env = newEnv();
  const sources = ["redcat", "aurora", "planet", "kodiak"];
  const tick = { redcat: "RCAT", aurora: "AUR", planet: "PL", kodiak: "KDK" };
  const made = {};
  for (const s of sources) {
    made[s] = [];
    // Seven held rows each, inserted newest first, so id order is not age order.
    for (let k = 7; k >= 1; k--) made[s].push({ id: addItem(env, held({ source_key: s, ticker: tick[s], nm_first_seen: iso(k * HOUR) })), age: k });
  }
  const auxIds = [addAux(env, held()), addAux(env, held())];
  const r = await releaseHeld(env);
  assert.deepEqual(r.released, { coverage: 20, aux: 0 }, "coverage first; the 20 are used up before aux");
  assert.equal(r.left, 0);
  for (const s of sources) {
    const rel = env.DB.rows("SELECT id FROM items WHERE source_key = ? AND released_at IS NOT NULL", s).map((x) => x.id).sort((a, b) => a - b);
    const oldest5 = made[s].filter((x) => x.age >= 3).map((x) => x.id).sort((a, b) => a - b);
    assert.deepEqual(rel, oldest5, `${s}: its 5 oldest`);
  }
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE released_at IS NOT NULL")[0].n, 0);
  assert.deepEqual((await releaseHeld(env)).released, { coverage: 0, aux: 0 }, "nothing more today");
  void auxIds;
  // Per source across both tables: a source used up on Coverage gets nothing on Aux.
  const env2 = newEnv();
  for (let k = 0; k < 4; k++) addItem(env2, held({ source_key: "fpds_testco", ticker: "RCAT" }));
  for (let k = 0; k < 4; k++) addAux(env2, held({ source_key: "fpds_testco" }));
  const r2 = await releaseHeld(env2);
  assert.deepEqual(r2.released, { coverage: 4, aux: 1 });
});

test("releaseHeld: one source with 139 held rows at one first_seen does not starve a second source (both released the same day)", async () => {
  const env = newEnv();
  const seen = iso(3 * DAY);
  for (let k = 0; k < 139; k++) addAux(env, held({ source_key: "bigseed", nm_first_seen: seen }));
  const other = addAux(env, held({ source_key: "smallsrc", nm_first_seen: iso(HOUR) }));
  const r = await releaseHeld(env);
  assert.equal(r.released.aux, 6);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key='bigseed' AND released_at IS NOT NULL")[0].n, 5);
  assert.ok(env.DB.rows("SELECT released_at FROM aux_items WHERE id = ?", other)[0].released_at);
});

test("releaseHeld: nothing is released into a pipeline whose claimable queue is at 60", async () => {
  const env = newEnv();
  for (let k = 0; k < 60; k++) addItem(env);
  addItem(env, held());
  for (let k = 0; k < 58; k++) addAux(env);
  for (let k = 0; k < 4; k++) addAux(env, held({ source_key: `src${k}` }));
  const r = await releaseHeld(env);
  assert.deepEqual(r.released, { coverage: 0, aux: 2 }, "coverage is full; aux has room for 2");
  assert.deepEqual(r.held, { coverage: 1, aux: 2 });
});

test("excess stays pending (never skipped) and is released on the next UTC day", async () => {
  const env = newEnv();
  for (let k = 0; k < 8; k++) addAux(env, held({ source_key: "onesrc", nm_first_seen: iso((10 - k) * HOUR) }));
  const day1 = Date.parse("2026-11-24T23:50:00Z");
  const r1 = await releaseHeld(env, { now: day1 });
  assert.equal(r1.released.aux, 5);
  assert.deepEqual(plain(env.DB.rows("SELECT state, COUNT(*) AS n FROM aux_items GROUP BY state")), [{ state: "pending", n: 8 }]);
  assert.equal((await releaseHeld(env, { now: day1 + 5 * MIN })).released.aux, 0, "the same UTC day");
  const r2 = await releaseHeld(env, { now: Date.parse("2026-11-25T00:05:00Z") });
  assert.equal(r2.released.aux, 3);
  assert.equal(r2.used_today, 3);
  assert.equal(utcDayStart(Date.parse("2026-11-25T00:05:00Z")), "2026-11-25T00:00:00.000Z");
});

test("env GATE_BUDGET_TOTAL / GATE_BUDGET_PER_SOURCE / GATE_QUEUE_GUARD / GATE_FAST_CAP override the defaults", async () => {
  assert.deepEqual(budgetSettings({}), { total: 20, per_source: 5, guard: 60, fast_cap: 10 });
  assert.deepEqual(budgetSettings({ GATE_BUDGET_TOTAL: "3", GATE_BUDGET_PER_SOURCE: "2", GATE_QUEUE_GUARD: "10", GATE_FAST_CAP: "5" }), { total: 3, per_source: 2, guard: 10, fast_cap: 5 });
  assert.deepEqual(budgetSettings({ GATE_BUDGET_TOTAL: "0", GATE_BUDGET_PER_SOURCE: "x", GATE_QUEUE_GUARD: "-1", GATE_FAST_CAP: "y" }), { total: 0, per_source: 5, guard: 60, fast_cap: 10 });
  assert.equal(budgetSettings({ GATE_FAST_CAP: "0" }).fast_cap, 0, "0 turns the cap off");
  const env = newEnv({ GATE_BUDGET_TOTAL: "3", GATE_BUDGET_PER_SOURCE: "2" });
  for (let k = 0; k < 4; k++) addAux(env, held({ source_key: "s1" }));
  for (let k = 0; k < 4; k++) addAux(env, held({ source_key: "s2" }));
  assert.equal((await releaseHeld(env)).released.aux, 3);
  const g = newEnv({ GATE_QUEUE_GUARD: "1" });
  addAux(g);
  addAux(g, held());
  assert.equal((await releaseHeld(g)).released.aux, 0);
  const ops = (await request(worker, newEnv({ GATE_BUDGET_TOTAL: "7" }), "GET", "/v1/ops", { role: "app" })).body;
  assert.deepEqual(ops.grader.backlog.budget, { total: 7, per_source: 5, guard: 60, fast_cap: 10 });
});

test("held rows are not waiting: ops backlog, stats by_state, oldestPending and heartbeat queue_stale exclude them; ops reports coverage_held, aux_held, released_today, double_graded_24h", async () => {
  const env = newEnv();
  const now = Date.now();
  // Held rows are the oldest waiting rows; only one fresh row each.
  addItem(env, held({ nm_first_seen: iso(5 * HOUR) }));
  addItem(env, held({ nm_first_seen: iso(4 * HOUR) }));
  const fresh = addItem(env, { nm_first_seen: iso(10 * MIN) });
  addAux(env, held({ nm_first_seen: iso(9 * HOUR) }));
  addAux(env, { nm_first_seen: iso(2 * HOUR) });
  // One released row today (still pending): counted as pending and as released.
  addAux(env, held({ released_at: iso(MIN), nm_first_seen: iso(3 * HOUR) }));
  // One news-monitor row graded in both pipelines today.
  const both = addItem(env, { nm_rowid: 90_001, state: "graded", url: "https://twin.example.com/1", source_key: "fpds_testco" });
  const g = env.DB.db.prepare("INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at) VALUES (?, 'RCAT', 'r', 'v', 'm', 50, 'borderline', 'w', '[]', 0, ?)").run(both, iso(HOUR));
  env.DB.db.prepare("UPDATE items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), both);
  const aBoth = addAux(env, { nm_rowid: 90_001, state: "graded", url: "https://twin.example.com/1", source_key: "fpds_testco" });
  const ag = env.DB.db.prepare("INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, read_source, graded_at) VALUES (?, 'r', 'X', 40, 'borderline', 'w', '[]', '[]', 0, ?)").run(aBoth, iso(HOUR));
  env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(ag.lastInsertRowid), aBoth);

  const b = (await request(worker, env, "GET", "/v1/ops", { role: "app" })).body.grader.backlog;
  assert.equal(b.coverage_pending, 1);
  assert.equal(b.aux_pending, 2);
  assert.equal(b.coverage_held, 2);
  assert.equal(b.aux_held, 1);
  assert.equal(b.released_today, 1);
  assert.equal(b.double_graded_24h, 1);
  assert.equal(b.oldest_aux_pending_at, env.DB.rows("SELECT nm_first_seen AS t FROM aux_items WHERE released_at IS NOT NULL")[0].t, "the held 9-hour row is not the oldest pending");
  assert.deepEqual(b.budget, { total: 20, per_source: 5, guard: 60, fast_cap: 10 });

  const s = (await request(worker, env, "GET", "/v1/stats", { role: "app" })).body;
  const st = Object.fromEntries(s.by_state.map((x) => [x.state, x.n]));
  assert.equal(st.pending, 1);
  assert.equal(st.held, 2);
  assert.equal(s.oldest_pending_first_seen, env.DB.rows("SELECT nm_first_seen FROM items WHERE id = ?", fresh)[0].nm_first_seen);
  // Auxiliary the same (the app's Auxiliary "Waiting" is pending + claimed): the fresh and the released row are pending, the held one is held.
  const ast = Object.fromEntries(s.aux.by_state.map((x) => [x.state, x.n]));
  assert.deepEqual(ast, { pending: 2, held: 1, graded: 1 });

  // queue_stale: only held covered rows waiting over 75 minutes -> ok.
  const hb = newEnv();
  addItem(hb, held({ nm_first_seen: iso(3 * HOUR, now) }));
  hb.DB.db.prepare("UPDATE items SET ingested_at = nm_first_seen").run();
  const q = (await heartbeatChecks(hb.DB, now)).find((c) => c.key === "queue_stale");
  assert.equal(q.state, "ok");
  addItem(hb, { nm_first_seen: iso(3 * HOUR, now) });
  hb.DB.db.prepare("UPDATE items SET ingested_at = nm_first_seen").run();
  const q2 = (await heartbeatChecks(hb.DB, now)).find((c) => c.key === "queue_stale");
  assert.equal(q2.state, "fail");
  assert.match(q2.detail, /^1 covered item waiting/);
});

test("feeds (coverage, aux, /m) hide held rows, also with state=pending, unless include_held=1", async () => {
  const env = newEnv();
  const fresh = addItem(env, { title: "Testco fresh row" });
  const h = addItem(env, held({ title: "Testco held row" }));
  const rel = addItem(env, held({ title: "Testco released row", released_at: iso(MIN) }));
  const aFresh = addAux(env);
  const aHeld = addAux(env, held());
  const feedIds = async (path) => (await request(worker, env, "GET", path, { role: "app" })).body.items.map((i) => i.item_id).sort((a, b) => a - b);
  assert.deepEqual(await feedIds("/v1/feed"), [fresh, rel]);
  assert.deepEqual(await feedIds("/v1/feed?state=pending"), [fresh, rel]);
  assert.deepEqual(await feedIds("/v1/feed?include_held=1"), [fresh, h, rel]);
  assert.deepEqual(await feedIds("/v1/feed?state=pending&include_held=1"), [fresh, h, rel]);
  assert.deepEqual(await feedIds("/v1/aux/feed"), [aFresh]);
  assert.deepEqual(await feedIds("/v1/aux/feed?state=pending"), [aFresh]);
  assert.deepEqual(await feedIds("/v1/aux/feed?include_held=1"), [aFresh, aHeld]);
  const m = await worker.fetch(new Request("https://zenith.test/m", { headers: { authorization: `Bearer ${TOKENS.APP_TOKEN}` } }), env);
  assert.equal(m.status, 200);
  const page = await m.text();
  assert.match(page, /Testco fresh row/);
  assert.match(page, /Testco released row/);
  assert.doesNotMatch(page, /Testco held row/);
});

test("enrich reads a fresh SEC item before a held one", async () => {
  const env = newEnv({ CONTACT_EMAIL: "ops@example.com" });
  const sec = (n) => `https://www.sec.gov/Archives/edgar/data/1/00000000${n}/doc.htm`;
  // Five held SEC rows, newer than the one fresh SEC row: the SEC budget is 5 a tick.
  for (let k = 1; k <= 5; k++) addItem(env, held({ source_key: "edgar_rcat", url: sec(k), nm_first_seen: iso(k * MIN) }));
  addItem(env, { source_key: "edgar_rcat", url: sec(9), nm_first_seen: iso(HOUR) });
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response("gone", { status: 404 }); };
  try { await enrich(env); } finally { globalThis.fetch = real; }
  assert.ok(urls.includes(sec(9)), "the fresh filing is read in this tick");
});

test("REGRESSION with the budget at 0, a fresh own-channel release and a fresh edgar_* filing are pending with admit NULL and claimable at once", async () => {
  const env = newEnv({ GATE_BUDGET_TOTAL: "0" });
  const seen = iso(10 * MIN);
  const ins = env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)");
  ins.run("redcat", "https://ir.example.com/own/1", "Testco announces an order", iso(20 * MIN), seen);
  ins.run("edgar_rcat", "https://www.sec.gov/Archives/edgar/data/1/000000001/x.htm", "Testco: 8-K filed", iso(30 * MIN), seen);
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0')").run();
  await ingest(env);
  assert.deepEqual(plain(env.DB.rows("SELECT source_key, state, admit, released_at FROM items ORDER BY source_key")), [
    { source_key: "edgar_rcat", state: "pending", admit: null, released_at: null },
    { source_key: "redcat", state: "pending", admit: null, released_at: null },
  ]);
  assert.deepEqual((await releaseHeld(env)).released, { coverage: 0, aux: 0 });
  assert.equal((await claim(env)).items.length, 2);
});

test("A1 releaseHeld releases seed_fresh rows before older held rows, still at most 5 per source and 20 a day", async () => {
  const env = newEnv();
  // Older record_late rows from five sources (25 rows), then a new source's seed: 7 seed_fresh rows, newest of all.
  for (const s of ["r1", "r2", "r3", "r4", "r5"]) for (let k = 0; k < 5; k++) addAux(env, held({ source_key: s, nm_first_seen: iso((40 + k) * HOUR) }));
  for (let k = 0; k < 7; k++) addAux(env, held({ source_key: "legistar_testville", admit: "seed_fresh", nm_first_seen: iso(HOUR) }));
  // A second source's seed_fresh rows on Coverage come first there too.
  addItem(env, held({ source_key: "cov_old", nm_first_seen: iso(50 * HOUR) }));
  const covSeed = addItem(env, held({ source_key: "cov_seed", admit: "seed_fresh", nm_first_seen: iso(HOUR) }));
  const r = await releaseHeld(env, { now: Date.now() });
  assert.equal(r.released.coverage + r.released.aux, 20);
  const rel = (sql) => env.DB.rows(sql)[0].n;
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'legistar_testville' AND released_at IS NOT NULL"), 5, "seed first, capped at 5");
  assert.ok(env.DB.rows("SELECT released_at FROM items WHERE id = ?", covSeed)[0].released_at);
  assert.equal(r.released.coverage, 2);
  assert.equal(r.released.aux, 18);
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'record_late' AND released_at IS NOT NULL"), 13);
});

// Phase 1 (Part B PR-G3): rows held over the per-source fast-path cap are fresh, like seeds.
test("releaseHeld releases source_cap and seed_fresh rows before record_late, still at most 5 per source and 20 a day", async () => {
  const env = newEnv();
  // 25 older record_late rows across five sources, then 7 newer source_cap rows of one source and 3 seed_fresh rows of another.
  for (const s of ["r1", "r2", "r3", "r4", "r5"]) for (let k = 0; k < 5; k++) addAux(env, held({ source_key: s, nm_first_seen: iso((40 + k) * HOUR) }));
  for (let k = 0; k < 7; k++) addAux(env, held({ source_key: "capped_src", admit: "source_cap", nm_first_seen: iso(HOUR + k * MIN) }));
  for (let k = 0; k < 3; k++) addAux(env, held({ source_key: "seed_src", admit: "seed_fresh", nm_first_seen: iso(2 * HOUR) }));
  const r = await releaseHeld(env, { now: Date.now() });
  assert.equal(r.released.aux, 20);
  const rel = (sql) => env.DB.rows(sql)[0].n;
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'source_cap' AND released_at IS NOT NULL"), 5, "capped first, at most 5 for its source");
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'seed_fresh' AND released_at IS NOT NULL"), 3);
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'record_late' AND released_at IS NOT NULL"), 12);
  // The capped source's oldest rows went first.
  const capRel = env.DB.rows("SELECT nm_first_seen FROM aux_items WHERE admit = 'source_cap' AND released_at IS NULL ORDER BY nm_first_seen").map((x) => x.nm_first_seen);
  assert.equal(capRel.length, 2);
  assert.ok(env.DB.rows("SELECT MAX(nm_first_seen) AS t FROM aux_items WHERE admit = 'source_cap' AND released_at IS NOT NULL")[0].t < capRel[0]);
});

// Phase 1 (Part C §6.3): an FPDS row held record_fresh goes ahead of older held rows.
test("releaseHeld releases a record_fresh row ahead of older held rows and inside 20/5", async () => {
  const env = newEnv();
  const srcs = ["o1", "o2", "o3", "o4", "o5", "o6"];
  for (let k = 0; k < 25; k++) {
    addItem(env, held({ source_key: srcs[k % 6], admit: k % 2 ? "rescue" : "record_late", nm_first_seen: iso((100 + k) * HOUR) }));
  }
  const fresh = addItem(env, held({ source_key: "fpds_testco", admit: "record_fresh", nm_first_seen: iso(HOUR) }));
  const r = await releaseHeld(env, { now: Date.now() });
  assert.ok(env.DB.rows("SELECT released_at FROM items WHERE id = ?", fresh)[0].released_at, "released in the first run");
  assert.equal(r.released.coverage, 20);
  const per = env.DB.rows("SELECT source_key, COUNT(*) AS n FROM items WHERE released_at IS NOT NULL GROUP BY source_key");
  assert.equal(per.reduce((a, x) => a + x.n, 0), 20);
  for (const x of per) assert.ok(x.n <= 5, `${x.source_key} released ${x.n}`);
});

// Phase 1 (Part D §5.2): council outcomes are time-sensitive, as seeds are.
test("vote rows are released before older held rows, still at most 5 per source and 20 a day", async () => {
  const env = newEnv();
  for (const s of ["r1", "r2", "r3", "r4", "r5"]) for (let k = 0; k < 5; k++) addAux(env, held({ source_key: s, nm_first_seen: iso((40 + k) * HOUR) }));
  for (let k = 0; k < 7; k++) addAux(env, held({ source_key: "legistar_testville", admit: "vote", url: `https://testville.legistar.com/L.aspx?ID=${k}#vote-${k}`, nm_first_seen: iso(HOUR) }));
  addAux(env, held({ source_key: "r6", admit: "rescue", nm_first_seen: iso(60 * HOUR) }));
  const r = await releaseHeld(env, { now: Date.now() });
  assert.equal(r.released.aux, 20);
  const rel = (sql) => env.DB.rows(sql)[0].n;
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'vote' AND released_at IS NOT NULL"), 5, "votes first, capped at 5 for their source");
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit IN ('record_late','rescue') AND released_at IS NOT NULL"), 15);
  assert.equal(rel("SELECT COUNT(*) AS n FROM aux_items WHERE admit = 'rescue' AND released_at IS NOT NULL"), 1, "the oldest held row (a rescue) still goes before newer record_late rows");
});

// Phase 2 (Part E §5.1, PR-EG): register rows sit in the second tier, oldest first; budget.js is unchanged.
test("Z3 register rows are released in the second tier: after a seed_fresh row, at most 5 a source and 20 a day; an older record_late row goes first", async () => {
  const env = newEnv();
  // Six register rows of source B, older than one seed_fresh row of source A, all on one UTC day.
  const base = utcDayStart(Date.now());
  const at = (min) => new Date(Date.parse(base) + min * MIN).toISOString();
  const regs = [];
  for (let k = 0; k < 6; k++) regs.push(addItem(env, held({ source_key: "reg_src_b", admit: "register", nm_first_seen: at(k) })));
  const seedA = addItem(env, held({ source_key: "seed_src_a", admit: "seed_fresh", nm_first_seen: at(30) }));
  const r = await releaseHeld(env, { now: Date.parse(base) + 60 * MIN });
  assert.ok(env.DB.rows("SELECT released_at FROM items WHERE id = ?", seedA)[0].released_at, "the seed_fresh row is released");
  const relB = env.DB.rows("SELECT id FROM items WHERE source_key = 'reg_src_b' AND released_at IS NOT NULL").map((x) => x.id).sort((a, b) => a - b);
  assert.deepEqual(relB, regs.slice(0, 5), "at most 5 of the register source, oldest first");
  assert.equal(r.released.coverage, 6);
  assert.ok(r.released.coverage + r.released.aux <= 20);
  // With room for one row only, the seed_fresh row wins over the older register rows (first tier first).
  const one = newEnv({ GATE_BUDGET_TOTAL: "1" });
  for (let k = 0; k < 6; k++) addItem(one, held({ source_key: "reg_src_b", admit: "register", nm_first_seen: at(k) }));
  const seedOne = addItem(one, held({ source_key: "seed_src_a", admit: "seed_fresh", nm_first_seen: at(30) }));
  assert.equal((await releaseHeld(one, { now: Date.parse(base) + 60 * MIN })).released.coverage, 1);
  assert.ok(one.DB.rows("SELECT released_at FROM items WHERE id = ?", seedOne)[0].released_at, "seed_fresh first");
  // One source, a register row and an older record_late row, room for one: the older goes first (second tier, oldest first).
  const tie = newEnv({ GATE_BUDGET_PER_SOURCE: "1" });
  const newer = addItem(tie, held({ source_key: "reg_src_c", admit: "register", nm_first_seen: at(20) }));
  const older = addItem(tie, held({ source_key: "reg_src_c", admit: "record_late", nm_first_seen: at(5) }));
  assert.equal((await releaseHeld(tie, { now: Date.parse(base) + 60 * MIN })).released.coverage, 1);
  assert.ok(tie.DB.rows("SELECT released_at FROM items WHERE id = ?", older)[0].released_at, "the older record_late row");
  assert.equal(tie.DB.rows("SELECT released_at FROM items WHERE id = ?", newer)[0].released_at, null, "the register row waits");
});

test("muting a source parks its held rows with admit cleared, so a Left out grade after unmuting is claimable at once, not held again", async () => {
  const env = newEnv();
  const app = (method, path, body) => request(worker, env, method, path, { role: "app", body });
  const a = addAux(env, held({ admit: "seed_fresh" }));
  const c = addItem(env, held({ source_key: "fpds_pl", ticker: "PL" }));
  const m = await app("POST", "/v1/source-prefs", { source_key: "anduril", action: "mute" });
  assert.deepEqual(m.body.parked, { coverage: 0, aux: 1 });
  assert.equal((await app("POST", "/v1/source-prefs", { source_key: "fpds_pl", action: "mute" })).body.parked.coverage, 1);
  const row = (t, id) => ({ ...env.DB.rows(`SELECT state, skip_reason, admit, released_at FROM ${t} WHERE id = ?`, id)[0] });
  assert.deepEqual(row("aux_items", a), { state: "skipped", skip_reason: "muted_source", admit: null, released_at: null });
  assert.deepEqual(row("items", c), { state: "skipped", skip_reason: "muted_source", admit: null, released_at: null });
  for (const key of ["anduril", "fpds_pl"]) await app("POST", "/v1/source-prefs", { source_key: key, action: "normal" });
  const ga = await app("POST", "/v1/left-out/grade", { kind: "aux", id: a });
  assert.equal(ga.body.state, "pending");
  assert.equal((await app("POST", "/v1/left-out/grade", { kind: "coverage", id: c })).body.state, "pending");
  assert.deepEqual(ids(await claim(env, "/v1/aux/claim")), [a], "the next grader run grades it, as Left out says");
  assert.deepEqual(ids(await claim(env)), [c]);
});

// Integration I-1 (plans/phase0-build-spec.md section 6): the brief's waiting list and counts.
test("held rows are not waiting in the brief: waiting.items and counts leave them out; waiting.held counts them", async () => {
  const env = newEnv();
  const fresh = addItem(env, { nm_first_seen: iso(10 * MIN) });
  const released = addItem(env, held({ released_at: iso(MIN), nm_first_seen: iso(2 * HOUR) }));
  const h1 = addItem(env, held({ nm_first_seen: iso(5 * HOUR) }));
  const h2 = addItem(env, held({ admit: "seed_fresh", nm_first_seen: iso(HOUR) }));
  addItem(env, { role: "customer", ticker: "AUR", nm_first_seen: iso(20 * MIN) });
  const hCp = addItem(env, held({ role: "customer", ticker: "AUR", nm_first_seen: iso(6 * HOUR) }));
  env.DB.db.prepare("UPDATE items SET ingested_at = nm_first_seen").run();
  const r = await request(worker, env, "GET", `/v1/brief?since=${encodeURIComponent(iso(DAY))}`, { role: "app" });
  assert.equal(r.status, 200);
  const w = r.body.waiting;
  const shown = w.items.map((i) => i.item_id).sort((a, b) => a - b);
  assert.deepEqual(shown, [fresh, released].sort((a, b) => a - b), "a released row is waiting; held rows are not");
  for (const id of [h1, h2, hCp]) assert.ok(!shown.includes(id));
  assert.equal(w.count, 2);
  assert.equal(w.counterparty_count, 1);
  assert.equal(w.held, 3, "both roles");
  assert.equal(w.oldest, env.DB.rows("SELECT nm_first_seen AS t FROM items WHERE id = ?", released)[0].t, "the held 5-hour row is not the oldest");
});

// Overlapping cron runs (final verifier's race probe): each run reads the day's
// budget before it writes, so two runs whose reads interleave must still not
// release past 20 a day or 5 a source. Reads here wait a tick, as on real D1.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function slowDb(db, readMs) {
  const wrap = (s) => ({
    inner: s,
    bind: (...a) => wrap(s.bind(...a)),
    all: async () => { await sleep(readMs); return s.all(); },
    first: async (c) => { await sleep(readMs); return s.first(c); },
    run: async () => { await sleep(1); return s.run(); },
  });
  return { prepare: (sql) => wrap(db.prepare(sql)), batch: async (stmts) => { await sleep(1); return db.batch(stmts.map((s) => s.inner)); } };
}
test("interleaved releaseHeld runs never release past 20 a UTC day or 5 a source", async () => {
  for (const [delays, readMs] of [[[0, 0], 5], [[0, 2], 5], [[0, 7, 13], 4], [[0, 1, 2, 3], 3]]) {
    const env = newEnv();
    for (let s = 0; s < 10; s++) for (let k = 0; k < 10; k++) addAux(env, held({ admit: "seed_fresh", source_key: `testsrc${s}` }));
    for (let k = 0; k < 10; k++) addItem(env, held());
    const now = Date.now();
    const runs = delays.map(async (d) => { await sleep(d); return releaseHeld({ DB: slowDb(env.DB, readMs) }, { now }); });
    await Promise.all(runs);
    const per = env.DB.rows(`SELECT source_key, COUNT(*) AS n FROM (SELECT source_key FROM items WHERE released_at IS NOT NULL
      UNION ALL SELECT source_key FROM aux_items WHERE released_at IS NOT NULL) GROUP BY source_key`);
    const total = per.reduce((a, r) => a + r.n, 0);
    assert.equal(total, 20, `delays ${delays}: the day's budget is spent once, not once per run (${JSON.stringify(per)})`);
    for (const r of per) assert.ok(r.n <= 5, `delays ${delays}: ${r.source_key} released ${r.n}`);
    const again = await releaseHeld(env, { now });
    assert.deepEqual(again.released, { coverage: 0, aux: 0 });
    assert.equal(again.used_today, 20);
  }
});

// --- Phase 2: story copies back into the queue (storyOrphans, storyRelease, the rescue's live-copy check) ---
const { storyOrphans, isStoryOrphanTick, RESCUE_REASONS } = await import("../worker/src/budget.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const STORY_T = "Acme Robotics signs a fleet deal with Beta Freight";
function storyEnv(extra = {}) {
  const env = newEnv(extra);
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
}
let nmSeq = 0;
function nmRow(env, { source_key, first_seen, title = STORY_T, published, url }) {
  nmSeq++;
  return Number(env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
    .run(source_key, url ?? `https://news.example.com/st/${source_key}/${nmSeq}`, title, published === undefined ? first_seen : published, first_seen).lastInsertRowid);
}
// An earlier poll, 40 days back, so a source's later rows are not its seed (seed_fresh).
const seedPolls = (env, ...keys) => { for (const k of keys) nmRow(env, { source_key: k, first_seen: iso(40 * DAY), title: `Earlier poll row of ${k} ${nmSeq}` }); };
const byNm = (env, n, table = "items") => ({ ...env.DB.rows(`SELECT id, state, skip_reason, admit, released_at, story_key, story_of, source_key FROM ${table} WHERE nm_rowid = ?`, n)[0] });
const mute = (env, key) => request(worker, env, "POST", "/v1/source-prefs", { role: "app", body: { source_key: key, action: "mute" } });

test("B-T28 storyOrphans: a muted canonical's earliest unmuted copy becomes a held rescue row, the others point to it; one cron audit row; released within 20/5; only on the 00:00-00:04 tick", async () => {
  const env = storyEnv();
  seedPolls(env, "volvo_autonomous", "volvo", "aur_rel");
  const c = nmRow(env, { source_key: "volvo_autonomous", first_seen: iso(4 * DAY) });
  const d1 = nmRow(env, { source_key: "volvo", first_seen: iso(3 * DAY) });       // the earliest copy; its source is muted below
  const d2 = nmRow(env, { source_key: "aur_rel", first_seen: iso(2 * DAY) });
  const d3 = nmRow(env, { source_key: "aur_rel", first_seen: iso(DAY) });
  await ingest(env);
  for (const n of [d1, d2, d3]) assert.equal(byNm(env, n).story_of, byNm(env, c).id);
  assert.equal((await mute(env, "volvo_autonomous")).status, 200);
  assert.equal((await mute(env, "volvo")).status, 200);
  assert.equal(byNm(env, c).skip_reason, "muted_source");
  const r = await storyOrphans(env);
  assert.deepEqual(r.promoted, { coverage: 1, aux: 0 });
  const p = byNm(env, d2);
  assert.deepEqual([p.state, p.skip_reason, p.admit, p.released_at, p.story_of], ["pending", null, "rescue", null, null]);
  assert.ok(p.story_key, "keys kept");
  assert.deepEqual([byNm(env, d1).state, byNm(env, d1).story_of], ["skipped", p.id], "the muted source's copy is not re-pended, and points to the new canonical");
  assert.deepEqual([byNm(env, d3).state, byNm(env, d3).story_of], ["skipped", p.id]);
  const audits = env.DB.rows("SELECT actor, via, action, target_id, after_json FROM audit_log WHERE action = 'rescue'");
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].actor, audits[0].via, audits[0].target_id], ["cron", "cron", "story_orphan"]);
  assert.equal(JSON.parse(audits[0].after_json).mode, "story_orphan");
  assert.deepEqual(JSON.parse(audits[0].after_json).ids, { coverage: [p.id], coverage_total: 1, aux: [], aux_total: 0 });
  // A second pass finds nothing to do and writes no audit row.
  assert.deepEqual((await storyOrphans(env)).promoted, { coverage: 0, aux: 0 });
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rescue'")[0].n, 1);
  const rel = await releaseHeld(env);
  assert.ok(rel.released.coverage >= 1 && rel.used_today <= 20);
  assert.ok(byNm(env, d2).released_at, "released by the budget");
  // Every copy from a muted source: nothing moves.
  const e2 = storyEnv();
  seedPolls(e2, "aur_rel", "volvo");
  const c2 = nmRow(e2, { source_key: "aur_rel", first_seen: iso(2 * DAY) });
  const m2 = nmRow(e2, { source_key: "volvo", first_seen: iso(DAY) });
  await ingest(e2);
  await mute(e2, "aur_rel");
  await mute(e2, "volvo");
  assert.deepEqual((await storyOrphans(e2)).promoted, { coverage: 0, aux: 0 });
  assert.deepEqual([byNm(e2, m2).state, byNm(e2, m2).story_of], ["skipped", byNm(e2, c2).id]);
  // The tick: 00:00-00:04 UTC only.
  for (const [t, want] of [["2026-11-26T00:00:00Z", true], ["2026-11-26T00:04:59Z", true], ["2026-11-26T00:05:00Z", false], ["2026-11-25T23:59:59Z", false], ["2026-11-26T12:02:00Z", false]]) {
    assert.equal(isStoryOrphanTick(Date.parse(t)), want, t);
  }
});

test("B-T28 storyOrphans: muted-only orphans never fill the 50-row read; a newer unmuted orphan moves, and a muted copy of its key points to it", async () => {
  const env = storyEnv();
  await mute(env, "volvo");
  const ins = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason, story_key)
    VALUES (?, ?, 'AUR', ?, 'x', ?, ?, 'skipped', 'story_dup', ?)`);
  let n = 0;
  const orphan = (source, firstSeen, key) => { n++; return Number(ins.run(880_000 + n, source, `https://news.example.com/orphan/${n}`, firstSeen, iso(0), key).lastInsertRowid); };
  // 60 orphans (story_of NULL), each its own key, all from the muted source, older than the rest.
  for (let k = 0; k < 60; k++) orphan("volvo", iso(10 * DAY - k * MIN), `t:${String(k).padStart(16, "0")}`);
  const fresh = orphan("aur_rel", iso(DAY), "t:00000000000000ff");
  const mutedCopy = orphan("volvo", iso(DAY - MIN), "t:00000000000000ff");
  const r = await storyOrphans(env);
  assert.deepEqual(r.promoted, { coverage: 1, aux: 0 });
  assert.equal(r.orphans.coverage, 1, "the read skips the muted orphans");
  const row = (id) => env.DB.rows("SELECT state, skip_reason, admit, story_of FROM items WHERE id = ?", id)[0];
  assert.deepEqual({ ...row(fresh) }, { state: "pending", skip_reason: null, admit: "rescue", story_of: null });
  assert.deepEqual({ ...row(mutedCopy) }, { state: "skipped", skip_reason: "story_dup", admit: null, story_of: fresh });
  assert.equal(r.repointed.coverage, 1);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM items WHERE source_key = 'volvo' AND state = 'skipped' AND story_of IS NULL")[0].n, 60, "the muted-only orphans stay");
});

test("B-T28 the 5-minute cron runs storyOrphans on the 00:00 tick and not on others", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });
  try {
    for (const [t, want] of [["2026-11-26T00:02:00Z", 1], ["2026-11-26T00:07:00Z", 0]]) {
      const env = storyEnv();
      const now = Date.parse(t);
      // A copy whose canonical was never stored (story_of NULL).
      env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason, story_key)
        VALUES (990001, 'aur_rel', 'AUR', 'https://news.example.com/cron/1', ?, ?, ?, 'skipped', 'story_dup', 't:00000000000000aa')`)
        .run(STORY_T, new Date(now - DAY).toISOString(), iso());
      const waits = [];
      await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: now }, env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rescue' AND target_id = 'story_orphan'")[0].n, want, t);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("B-T29 rescue drops a pick with a live exact copy and reports has_live_copy; a rescued row gets its keys, and a later copy of it is held", async () => {
  const env = storyEnv();
  seedPolls(env, "volvo_autonomous", "aur_rel");
  // Skipped stale rows (18 days late, inside the rubric's 21 days), and a live copy of the first.
  const s1 = nmRow(env, { source_key: "volvo_autonomous", first_seen: iso(3 * DAY), published: iso(21 * DAY) });
  const live = nmRow(env, { source_key: "aur_rel", first_seen: iso(2 * DAY) });
  const s2 = nmRow(env, { source_key: "volvo_autonomous", first_seen: iso(3 * DAY), published: iso(21 * DAY), title: "Acme Robotics opens a second plant" });
  await ingest(env);
  assert.equal(byNm(env, s1).skip_reason, "stale_on_arrival");
  assert.equal(byNm(env, live).state, "pending");
  const since = iso(30 * DAY).slice(0, 10);
  const dry = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "rescue", since, kind: "coverage", dry_run: true } })).body;
  assert.deepEqual(dry.has_live_copy, { coverage: 1, aux: 0 });
  assert.deepEqual(dry.items.map((i) => i.id), [byNm(env, s2).id]);
  const real = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "rescue", since, kind: "coverage" } })).body;
  assert.deepEqual(real.held, { coverage: 1, aux: 0 });
  const r2 = byNm(env, s2);
  assert.deepEqual([r2.state, r2.admit], ["pending", "rescue"]);
  assert.match(r2.story_key, /^t:/);
  assert.equal(byNm(env, s1).state, "skipped", "the pick with a live copy stays skipped");
  await releaseHeld(env);
  assert.ok(byNm(env, s2).released_at);
  const later = nmRow(env, { source_key: "aur_rel", first_seen: iso(HOUR), title: "Acme Robotics opens a second plant" });
  await ingest(env);
  assert.deepEqual([byNm(env, later).skip_reason, byNm(env, later).story_of], ["story_dup", r2.id]);
});

test("B-T30 story_release: a dry run reports; a real run turns story_dup rows into held rescue rows (at most limit, muted sources skipped) with one audit row; story_dup is not a rescue reason", async () => {
  assert.ok(!RESCUE_REASONS.includes("story_dup"));
  const env = storyEnv();
  seedPolls(env, "volvo_autonomous", "aur_rel", "volvo", "aevex", "managed_widgetco_news");
  const c = nmRow(env, { source_key: "volvo_autonomous", first_seen: iso(5 * DAY) });
  const d = [nmRow(env, { source_key: "aur_rel", first_seen: iso(4 * DAY) }), nmRow(env, { source_key: "aur_rel", first_seen: iso(3 * DAY) }),
    nmRow(env, { source_key: "volvo", first_seen: iso(2 * DAY) })];
  nmRow(env, { source_key: "aevex", first_seen: iso(3 * DAY), url: "https://news.example.com/rel/1", title: "AEVEX opens a test range" });
  const y = nmRow(env, { source_key: "managed_widgetco_news", first_seen: iso(2 * DAY), url: "https://news.example.com/rel/1", title: "Widgetco range story" });
  await ingest(env);
  await ingestAux(env);
  assert.equal(byNm(env, y, "aux_items").skip_reason, "story_dup");
  await mute(env, "volvo");
  const since = iso(10 * DAY).slice(0, 10);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "story_release" } })).status, 400, "since is required");
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { role: "app", body: { mode: "story_release", since } })).status, 403);
  const dry = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "story_release", since, dry_run: true } })).body;
  assert.deepEqual([dry.matched, dry.muted_skipped, dry.held, dry.dry_run], [3, 1, { coverage: 2, aux: 1 }, true]);
  assert.equal(byNm(env, d[0]).state, "skipped", "a dry run changes nothing");
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rescue'")[0].n, 0);
  const real = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "story_release", since, limit: 2 } })).body;
  assert.deepEqual([real.held, real.remaining], [{ coverage: 2, aux: 0 }, 1]);
  for (const n of d.slice(0, 2)) {
    const r = byNm(env, n);
    assert.deepEqual([r.state, r.skip_reason, r.admit, r.released_at, r.story_of], ["pending", null, "rescue", null, byNm(env, c).id], "story_of kept as history");
  }
  assert.equal(byNm(env, d[2]).state, "skipped", "the muted source's copy stays");
  const audits = env.DB.rows("SELECT target_id, after_json FROM audit_log WHERE action = 'rescue'");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target_id, "story_release");
  assert.equal(JSON.parse(audits[0].after_json).mode, "story_release");
  const rest = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "story_release", since, kind: "aux" } })).body;
  assert.deepEqual(rest.held, { coverage: 0, aux: 1 });
  assert.equal(byNm(env, y, "aux_items").admit, "rescue");
});

test("B-T31 a later copy of an orphan-promoted row is held against it", async () => {
  const env = storyEnv();
  seedPolls(env, "volvo_autonomous", "aur_rel", "volvo");
  const c = nmRow(env, { source_key: "volvo_autonomous", first_seen: iso(3 * DAY) });
  const d = nmRow(env, { source_key: "aur_rel", first_seen: iso(2 * DAY) });
  await ingest(env);
  await mute(env, "volvo_autonomous");
  await storyOrphans(env);
  const p = byNm(env, d);
  assert.equal(p.admit, "rescue");
  await releaseHeld(env);
  assert.ok(byNm(env, d).released_at);
  const later = nmRow(env, { source_key: "volvo", first_seen: iso(HOUR) });
  await ingest(env);
  assert.deepEqual([byNm(env, later).skip_reason, byNm(env, later).story_of], ["story_dup", p.id]);
  assert.equal(byNm(env, c).skip_reason, "muted_source");
});
