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

test("env GATE_BUDGET_TOTAL / GATE_BUDGET_PER_SOURCE / GATE_QUEUE_GUARD override the defaults", async () => {
  assert.deepEqual(budgetSettings({}), { total: 20, per_source: 5, guard: 60 });
  assert.deepEqual(budgetSettings({ GATE_BUDGET_TOTAL: "3", GATE_BUDGET_PER_SOURCE: "2", GATE_QUEUE_GUARD: "10" }), { total: 3, per_source: 2, guard: 10 });
  assert.deepEqual(budgetSettings({ GATE_BUDGET_TOTAL: "0", GATE_BUDGET_PER_SOURCE: "x", GATE_QUEUE_GUARD: "-1" }), { total: 0, per_source: 5, guard: 60 });
  const env = newEnv({ GATE_BUDGET_TOTAL: "3", GATE_BUDGET_PER_SOURCE: "2" });
  for (let k = 0; k < 4; k++) addAux(env, held({ source_key: "s1" }));
  for (let k = 0; k < 4; k++) addAux(env, held({ source_key: "s2" }));
  assert.equal((await releaseHeld(env)).released.aux, 3);
  const g = newEnv({ GATE_QUEUE_GUARD: "1" });
  addAux(g);
  addAux(g, held());
  assert.equal((await releaseHeld(g)).released.aux, 0);
  const ops = (await request(worker, newEnv({ GATE_BUDGET_TOTAL: "7" }), "GET", "/v1/ops", { role: "app" })).body;
  assert.deepEqual(ops.grader.backlog.budget, { total: 7, per_source: 5, guard: 60 });
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
  assert.deepEqual(b.budget, { total: 20, per_source: 5, guard: 60 });

  const s = (await request(worker, env, "GET", "/v1/stats", { role: "app" })).body;
  const st = Object.fromEntries(s.by_state.map((x) => [x.state, x.n]));
  assert.equal(st.pending, 1);
  assert.equal(st.held, 2);
  assert.equal(s.oldest_pending_first_seen, env.DB.rows("SELECT nm_first_seen FROM items WHERE id = ?", fresh)[0].nm_first_seen);

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
