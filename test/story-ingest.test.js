// Phase 2: exact-key story dedup through the ingests (worker/src/ingest.js,
// worker/src/auxiliary.js scanAux), plus the ops block, Left out and the key
// backfill route. Synthetic rows over the real migrations; news-monitor-db is
// an in-memory stand-in written by the tests only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { releaseHeld, fastPathCounts, heldCounts, storyOrphans, releasedToday } = await import("../worker/src/budget.js");
const { enrich } = await import("../worker/src/excerpt.js");
const { storyKeys, findCanonicals, storyPlanner, rankOf } = await import("../worker/src/story.js");
const { mobile } = await import("../worker/src/mobile.js");
const COVERED = (await import("../worker/src/covered.json", { with: { type: "json" } })).default;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const plain = (r) => (r ? { ...r } : r);
const T = "Acme Robotics signs a fleet deal with Beta Freight";

function newEnv(extra = {}) {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra };
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
}
let seq = 0;
// One news-monitor row; published defaults to its first sighting (fresh). Returns its rowid.
function nm(env, { source_key, first_seen, title = T, published, url }) {
  seq++;
  const r = env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
    .run(source_key, url ?? `https://news.example.com/${source_key}/${seq}`, title, published === undefined ? first_seen : published, first_seen);
  return Number(r.lastInsertRowid);
}
// An earlier poll, 40 days back, so a source's later rows are not its seed (seed_fresh).
const seed = (env, ...keys) => { for (const k of keys) nm(env, { source_key: k, first_seen: ago(40 * DAY), title: `Earlier poll row of ${k} ${seq}` }); };
const cov = (env, nmRowid) => plain(env.DB.rows("SELECT id, state, skip_reason, admit, released_at, story_key, story_of FROM items WHERE nm_rowid = ?", nmRowid)[0]);
const auxRow = (env, nmRowid) => plain(env.DB.rows("SELECT id, state, skip_reason, admit, released_at, story_key, url_key, story_of FROM aux_items WHERE nm_rowid = ?", nmRowid)[0]);

// --- Coverage --------------------------------------------------------------------
test("B-T14 a second source's exact-title copy of a pending coverage row, 2 days later, is stored story_dup pointing at it; a third copy points to the same first id", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel", "volvo");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(3 * DAY) });
  await ingest(env);
  const first = cov(env, a);
  assert.equal(first.state, "pending");
  assert.match(first.story_key, /^t:[0-9a-f]{16}$/);
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(1 * DAY), title: `[AUR] ${T.toUpperCase()}` });
  const r = await ingest(env);
  assert.equal(r.story_held, 1);
  assert.deepEqual(cov(env, b), { id: cov(env, b).id, state: "skipped", skip_reason: "story_dup", admit: null, released_at: null, story_key: first.story_key, story_of: first.id });
  const c = nm(env, { source_key: "volvo", first_seen: ago(12 * HOUR) });
  await ingest(env);
  assert.equal(cov(env, c).story_of, first.id);
  assert.equal(cov(env, c).skip_reason, "story_dup");
  assert.equal(cov(env, a).state, "pending", "the canonical is untouched");
});

test("B-T15 two copies in one ingest batch: the second points to the first through the nm_rowid subquery", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * HOUR) });
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(HOUR) });
  const r = await ingest(env);
  assert.equal(r.story_held, 1);
  assert.equal(cov(env, a).state, "pending");
  assert.equal(cov(env, b).skip_reason, "story_dup");
  assert.equal(cov(env, b).story_of, cov(env, a).id);
});

test("B-T15 text guard across batches: a stored canonical with only a feed summary (excerpt_fallback, before enrich) holds a later copy that carries a summary", async () => {
  const env = newEnv();
  env.NEWS.db.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const summary = (who) => `${who} said on Tuesday that Acme Robotics signed a multi-year fleet agreement with Beta Freight covering routes in three states, with deliveries planned to start next spring and more lanes possible later in the year after a review.`;
  const withBody = (n, who) => env.NEWS.db.prepare("UPDATE items SET body = ? WHERE rowid = ?").run(summary(who), n);
  seed(env, "volvo_autonomous", "aur_rel");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * DAY) });
  withBody(a, "The company");
  await ingest(env);
  const stored = env.DB.rows("SELECT state, excerpt, excerpt_fallback FROM items WHERE nm_rowid = ?", a)[0];
  assert.deepEqual([stored.state, stored.excerpt], ["pending", null]);
  assert.ok(stored.excerpt_fallback, "only the summary is stored");
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(DAY) });
  withBody(b, "A partner");
  const r = await ingest(env);
  assert.equal(r.story_held, 1);
  assert.deepEqual([cov(env, b).skip_reason, cov(env, b).story_of], ["story_dup", cov(env, a).id]);
});

test("B-T16 aux: a managed-lane and a code-lane copy of one URL under two entity keys merge; coverage keeps one URL, and one accession, under two tickers", async () => {
  const env = newEnv();
  seed(env, "aevex", "managed_widgetco_news", "volvo_autonomous", "rcat_rel");
  const x = nm(env, { source_key: "aevex", first_seen: ago(2 * DAY), url: "https://news.example.com/story/acme-deal/?utm_source=feed", title: "AEVEX and Acme team up on a drone deal" });
  const y = nm(env, { source_key: "managed_widgetco_news", first_seen: ago(DAY), url: "http://www.news.example.com/story/acme-deal", title: "Widgetco newsroom: partner deal announced today" });
  await ingestAux(env);
  assert.equal(auxRow(env, x).state, "pending");
  assert.deepEqual([auxRow(env, y).skip_reason, auxRow(env, y).story_of, auxRow(env, y).url_key], ["story_dup", auxRow(env, x).id, auxRow(env, x).url_key]);
  // Coverage: no URL key, and hard keys are ticker-prefixed.
  const u = "https://news.example.com/story/shared";
  const c1 = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * DAY), url: u });
  const c2 = nm(env, { source_key: "rcat_rel", first_seen: ago(DAY), url: u });
  const acc = "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000777/form8k.htm";
  const s1 = nm(env, { source_key: "edgar_rcat", first_seen: ago(2 * DAY), url: acc, title: "8-K current report" });
  const s2 = nm(env, { source_key: "edgar_dpro", first_seen: ago(DAY), url: acc, title: "8-K current report" });
  await ingest(env);
  for (const n of [c1, c2, s1, s2]) assert.equal(cov(env, n).state, "pending", `nm ${n}`);
  assert.notEqual(cov(env, s1).story_key, cov(env, s2).story_key);
  assert.match(cov(env, s1).story_key, /^sec:RCAT:/);
});

// The register guard, discriminated: the same body under three keys. Under a
// plain key the later row is a copy; under an lda_ key (the guard) and under a
// key the catalog marks record (no title key for records) both stay pending.
async function registerPair(sourceKey) {
  const env = newEnv();
  seed(env, sourceKey);
  const a = nm(env, { source_key: sourceKey, first_seen: ago(8 * DAY), url: "https://register.example.gov/report/1", title: "Acme Robotics registration report" });
  const b = nm(env, { source_key: sourceKey, first_seen: ago(DAY), url: "https://register.example.gov/report/2", title: "Acme Robotics registration report" });
  await ingestAux(env);
  return [auxRow(env, a), auxRow(env, b)];
}
test("B-T17 two same-title rows with distinct report URLs, 7 days apart, both fresh: a copy under a plain key; both pending under an lda_ key or a record key", async () => {
  const [p1, p2] = await registerPair("acme_watch");
  assert.equal(p1.state, "pending");
  assert.deepEqual([p2.state, p2.skip_reason, p2.story_of], ["skipped", "story_dup", p1.id]);
  for (const k of ["lda_acme", "diu"]) {
    const [r1, r2] = await registerPair(k);
    assert.deepEqual([r1.state, r2.state, r1.story_key, r2.story_key, r2.story_of], ["pending", "pending", null, null, null], k);
    if (k === "lda_acme") assert.deepEqual([r1.url_key, r2.url_key], [null, null], "a register key gets no URL key either");
  }
});

test("B-T18 a held seed_fresh canonical plus a later fast-path media copy: the held row becomes the copy; a higher-ranked held row changes nothing", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous");
  const h = nm(env, { source_key: "volvo", first_seen: ago(2 * DAY) });          // volvo's first poll: seed_fresh, held
  await ingest(env);
  assert.equal(cov(env, h).admit, "seed_fresh");
  const before = [...(await releasedToday(env.DB)).values()].reduce((x, y) => x + y, 0);
  const m = nm(env, { source_key: "volvo_autonomous", first_seen: ago(DAY) });
  const r = await ingest(env);
  assert.equal(r.story_swapped, 1);
  assert.deepEqual([cov(env, m).state, cov(env, m).admit, cov(env, m).story_of], ["pending", null, null]);
  assert.deepEqual([cov(env, h).state, cov(env, h).skip_reason, cov(env, h).admit, cov(env, h).story_of], ["skipped", "story_dup", null, cov(env, m).id]);
  assert.equal([...(await releasedToday(env.DB)).values()].reduce((x, y) => x + y, 0), before, "released_today is unchanged");
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 40 } })).body;
  assert.deepEqual(claim.items.map((i) => i.item_id), [cov(env, m).id], "the copy is claimable");

  // A held own-lane row (a rescued company release, rank 3) with the same story: neither row changes.
  const e2 = newEnv();
  seed(e2, "rcat_rel");
  const k = await storyKeys({ source_key: "redcat", ticker: "RCAT", title: T, url: "https://ir.example.com/n/1" }, "coverage");
  e2.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, admit, story_key)
    VALUES (999001, 'redcat', 'RCAT', 'https://ir.example.com/n/1', ?, ?, ?, 'pending', 'rescue', ?)`).run(T, ago(2 * DAY), ago(0), k.story_key);
  const m2 = nm(e2, { source_key: "rcat_rel", first_seen: ago(DAY) });
  const r2 = await ingest(e2);
  assert.deepEqual([r2.story_held, r2.story_swapped], [0, 0]);
  assert.deepEqual([cov(e2, m2).state, cov(e2, m2).admit], ["pending", null]);
  assert.deepEqual([cov(e2, 999001).state, cov(e2, 999001).admit], ["pending", "rescue"]);

  // A held official record (rank 1: the record source's first poll, held) and a later fast-path media copy of its URL: neither row changes.
  const e3 = newEnv();
  seed(e3, "managed_widgetco_news");
  const url = "https://records.example.gov/notice/42";
  const rec = nm(e3, { source_key: "diu", first_seen: ago(2 * DAY), url, title: "Acme Robotics award notice" });
  await ingestAux(e3);
  const held = auxRow(e3, rec);
  assert.deepEqual([held.state, held.story_key], ["pending", null], "a record gets no title key");
  assert.ok(held.admit && held.url_key, "held, with its URL key");
  assert.equal(rankOf({ source_key: "diu" }), 1);
  const media = nm(e3, { source_key: "managed_widgetco_news", first_seen: ago(DAY), url: `${url}?utm_source=feed`, title: "Widgetco newsroom: award notice posted" });
  const r3 = await ingestAux(e3);
  assert.deepEqual([r3.story_held, r3.story_swapped], [0, 0]);
  assert.deepEqual([auxRow(e3, media).state, auxRow(e3, media).admit, auxRow(e3, media).url_key, auxRow(e3, media).story_of], ["pending", null, held.url_key, null]);
  assert.deepEqual(auxRow(e3, rec), held, "the held record is unchanged");
});

test("B-T19 not held: a copy of a skipped row, a copy 15 days later, an own release after a media copy; a stale copy keeps stale_on_arrival and gets no keys", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel", "rcat_rel");
  const stale = nm(env, { source_key: "volvo_autonomous", first_seen: ago(3 * DAY), published: ago(33 * DAY), title: "Acme Robotics opens a plant in Ohio" });
  const after = nm(env, { source_key: "aur_rel", first_seen: ago(DAY), title: "Acme Robotics opens a plant in Ohio" });
  const old = nm(env, { source_key: "volvo_autonomous", first_seen: ago(16 * DAY), title: "Acme Robotics hires a new chief" });
  const late = nm(env, { source_key: "aur_rel", first_seen: ago(DAY), title: "Acme Robotics hires a new chief" });
  const media = nm(env, { source_key: "rcat_rel", first_seen: ago(2 * DAY), title: "Red Cat ships a drone order today" });
  const own = nm(env, { source_key: "redcat", first_seen: ago(DAY), title: "Red Cat ships a drone order today" });
  const canon = nm(env, { source_key: "aur_rel", first_seen: ago(3 * DAY), title: "Acme Robotics wins a state contract" });
  const staleCopy = nm(env, { source_key: "volvo_autonomous", first_seen: ago(DAY), published: ago(20 * DAY), title: "Acme Robotics wins a state contract" });
  const r = await ingest(env);
  assert.equal(r.story_held, 0);
  assert.deepEqual([cov(env, stale).skip_reason, cov(env, stale).story_key], ["stale_on_arrival", null]);
  for (const n of [after, old, late, media, own, canon]) assert.deepEqual([cov(env, n).state, cov(env, n).story_of], ["pending", null], `nm ${n}`);
  assert.ok(cov(env, after).story_key, "a live row gets its keys");
  assert.deepEqual([cov(env, staleCopy).skip_reason, cov(env, staleCopy).story_key, cov(env, staleCopy).story_of], ["stale_on_arrival", null, null]);
});

test("B-T20 gate precedence: a copy the gate would admit seed_fresh or source_cap, with a claimable canonical, is story_dup with admit NULL; fastPathCounts is unchanged", async () => {
  const day = ago(3 * DAY).slice(0, 10);
  const at = (h) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;
  const env = newEnv({ GATE_FAST_CAP: "1" });
  seed(env, "volvo_autonomous", "aur_rel");
  const canon = nm(env, { source_key: "volvo_autonomous", first_seen: at(9) });
  const fastRow = nm(env, { source_key: "aur_rel", first_seen: at(10), title: "Aurora partner note on a new lane" });
  await ingest(env);
  const counts = await fastPathCounts(env.DB, day);
  const heldBefore = await heldCounts(env.DB);
  // aur_rel is at its cap of 1: its next fresh row would be held source_cap.
  const capped = nm(env, { source_key: "aur_rel", first_seen: at(11) });
  // volvo's first poll: its row would be held seed_fresh.
  const seedRow = nm(env, { source_key: "volvo", first_seen: at(12) });
  const r = await ingest(env);
  assert.equal(r.story_held, 2);
  assert.equal(r.held, 0, "no admission was counted");
  for (const n of [capped, seedRow]) assert.deepEqual([cov(env, n).skip_reason, cov(env, n).admit, cov(env, n).story_of], ["story_dup", null, cov(env, canon).id], `nm ${n}`);
  assert.equal(cov(env, fastRow).state, "pending");
  assert.deepEqual(await fastPathCounts(env.DB, day), counts);
  assert.deepEqual(await heldCounts(env.DB), heldBefore, "the copies take no held slot");
});

test("B-T21 a story_dup row is never claimed, shown, released, counted or fetched", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel", "aevex", "managed_widgetco_news");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * HOUR), url: "https://news.example.com/canon/1" });
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(HOUR), url: "https://news.example.com/copy/1" });
  const x = nm(env, { source_key: "aevex", first_seen: ago(2 * HOUR), url: "https://news.example.com/aux/1", title: "AEVEX opens a test range" });
  const y = nm(env, { source_key: "managed_widgetco_news", first_seen: ago(HOUR), url: "https://news.example.com/aux/1/", title: "Widgetco range news story" });
  await ingest(env);
  await ingestAux(env);
  const copy = cov(env, b).id, auxCopy = auxRow(env, y).id;
  assert.equal(cov(env, b).skip_reason, "story_dup");
  assert.equal(auxRow(env, y).skip_reason, "story_dup");
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { fetched.push(String(u)); return new Response("", { status: 404 }); };
  try { await enrich(env); } finally { globalThis.fetch = realFetch; }
  assert.ok(fetched.some((u) => u.includes("/canon/1")), "enrich ran on the canonical");
  assert.ok(!fetched.some((u) => u.includes("/copy/1")), "never the copy");
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 40 } })).body;
  assert.deepEqual(claim.items.map((i) => i.item_id), [cov(env, a).id]);
  const auxClaim = (await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 40 } })).body;
  assert.ok(!auxClaim.items.some((i) => i.item_id === auxCopy));
  const ids = async (path) => (await request(worker, env, "GET", path, { role: "app" })).body.items.map((i) => i.item_id);
  assert.ok(!(await ids("/v1/feed?order=newest")).includes(copy));
  assert.ok((await ids("/v1/feed?order=newest&include_skipped=1")).includes(copy));
  assert.ok(!(await ids("/v1/aux/feed?order=newest")).includes(auxCopy));
  assert.ok((await ids("/v1/aux/feed?order=newest&include_skipped=1")).includes(auxCopy));
  const brief = (await request(worker, env, "GET", `/v1/brief?since=${encodeURIComponent(ago(DAY))}`, { role: "app" })).body;
  assert.ok(!brief.waiting.items.some((i) => i.item_id === copy));
  // Phase 3 PR-PA5: GET /m is an empty 302 to the portal, so the old page is checked on the mobile() handler with the covered universe.
  const m = await mobile(new Request("https://zenith.test/m?days=7", { headers: { authorization: `Bearer ${TOKENS.APP_TOKEN}` } }), env,
    new URL("https://zenith.test/m?days=7"), { tickers: COVERED.tickers });
  assert.equal(m.status, 200);
  const page = await m.text();
  assert.ok(page.includes(`id="i${cov(env, a).id}"`), "the canonical is on the page");
  assert.ok(!page.includes(`id="i${copy}"`));
  // heldCounts counts only the earlier polls' seed_fresh rows, never a copy.
  assert.deepEqual(await heldCounts(env.DB), { coverage: 2, aux: 2 });
  await releaseHeld(env);
  assert.equal(env.DB.rows("SELECT released_at FROM items WHERE id = ?", copy)[0].released_at, null);
  assert.equal(env.DB.rows("SELECT released_at FROM aux_items WHERE id = ?", auxCopy)[0].released_at, null);
  const day = ago(HOUR).slice(0, 10);
  const fast = await fastPathCounts(env.DB, day);
  if (ago(2 * HOUR).slice(0, 10) === day) {
    assert.equal(fast.get("aur_rel") || 0, 0, "a copy is never a fast-path row");
    assert.equal(fast.get("managed_widgetco_news") || 0, 0);
  }
});

test("B-T22 STORY_DEDUP=off writes keys and holds or swaps nothing", async () => {
  const env = newEnv({ STORY_DEDUP: "off" });
  seed(env, "volvo_autonomous", "aur_rel");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * DAY) });
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(DAY) });
  const h = nm(env, { source_key: "volvo", first_seen: ago(3 * DAY), title: "Volvo and Acme plan a freight lane" });   // seed_fresh, held
  const m = nm(env, { source_key: "aur_rel", first_seen: ago(HOUR), title: "Volvo and Acme plan a freight lane" });
  const r = await ingest(env);
  assert.deepEqual([r.story_held, r.story_swapped], [0, 0]);
  assert.deepEqual([cov(env, b).state, cov(env, b).story_of, cov(env, b).story_key], ["pending", null, cov(env, a).story_key]);
  assert.ok(cov(env, b).story_key);
  assert.deepEqual([cov(env, h).state, cov(env, h).admit], ["pending", "seed_fresh"]);
  assert.equal(cov(env, m).state, "pending");
  const ops = (await request(worker, env, "GET", "/v1/ops", { role: "app" })).body;
  assert.equal(ops.grader.backlog.story.dedup, "off");
});

// A D1 wrapper that throws above 100 bound parameters (D1's limit) and records each statement's binds.
function limitedDb(db, log) {
  const wrap = (sql, s) => ({
    inner: s,
    bind: (...a) => {
      if (a.length > 100) throw new Error(`too many SQL variables: ${a.length}`);
      log.push({ sql, n: a.length });
      return wrap(sql, s.bind(...a));
    },
    all: () => s.all(), first: (c) => s.first(c), run: () => s.run(),
  });
  return { prepare: (sql) => wrap(sql, db.prepare(sql)), batch: (stmts) => db.batch(stmts.map((x) => x.inner)), db: db.db, rows: db.rows.bind(db) };
}
test("B-T23 120 distinct keys in one batch on a D1 that throws above 100 bound parameters: findCanonicals binds at most 3", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous");
  for (let k = 0; k < 120; k++) nm(env, { source_key: "volvo_autonomous", first_seen: ago(HOUR), title: `Acme Robotics fleet note number ${k}` });
  const log = [];
  const r = await ingest({ ...env, DB: limitedDb(env.DB, log), GATE_FAST_CAP: "0" });
  assert.equal(r.inserted, 121);
  const finds = log.filter((x) => /json_each\(\?1\)/.test(x.sql) && /story_key IN/.test(x.sql));
  assert.equal(finds.length, 1, "one findCanonicals call per batch");
  assert.equal(finds[0].n, 2, "coverage binds 2");
  const keys = Array.from({ length: 120 }, (_, k) => `t:${String(k).padStart(16, "0")}`);
  const log2 = [];
  await findCanonicals(limitedDb(env.DB, log2), "aux", { storyKeys: keys, urlKeys: keys.map((k) => k.replace("t:", "u:")), since: ago(14 * DAY) });
  assert.deepEqual(log2.map((x) => x.n), [3], "aux binds 3");
});

test("B-T24 query plans: findCanonicals, the ops story count and the orphan SELECT use their indexes", async () => {
  const env = newEnv();
  const log = [];
  const db = limitedDb(env.DB, log);
  await findCanonicals(db, "coverage", { storyKeys: ["t:0000000000000001"], since: ago(DAY) });
  await findCanonicals(db, "aux", { storyKeys: ["t:0000000000000001"], urlKeys: ["u:0000000000000001"], since: ago(DAY) });
  await storyOrphans({ DB: db });
  await request(worker, { ...env, DB: db }, "GET", "/v1/ops", { role: "app" });
  const plan = (x) => env.DB.db.prepare(`EXPLAIN QUERY PLAN ${x.sql}`).all(...x.args).map((p) => p.detail).join(" | ");
  // Re-run each captured statement's plan with representative binds.
  const find = (re) => log.filter((x) => re.test(x.sql));
  const covFind = find(/FROM items WHERE nm_first_seen >= \?2 AND state != 'skipped' AND story_of IS NULL/)[0];
  const auxFind = find(/FROM aux_items WHERE nm_first_seen >= \?3 AND state != 'skipped' AND story_of IS NULL/)[0];
  assert.ok(covFind && auxFind);
  assert.match(plan({ sql: covFind.sql, args: ['["t:1"]', ago(DAY)] }), /idx_items_story_key/);
  const auxPlan = plan({ sql: auxFind.sql, args: ['["t:1"]', '["u:1"]', ago(DAY)] });
  assert.match(auxPlan, /aux_items_story_key/);
  assert.match(auxPlan, /aux_items_url_key/);
  const opsCount = find(/COUNT\(\*\) AS n14/);
  assert.equal(opsCount.length, 2, "one statement per table");
  assert.match(plan({ sql: opsCount[0].sql, args: [ago(14 * DAY), ago(0)] }), /idx_items_skipped/);
  assert.match(plan({ sql: opsCount[1].sql, args: [ago(14 * DAY), ago(0)] }), /aux_items_skipped/);
  const orphan = find(/LEFT JOIN items c ON c.id = d.story_of/)[0];
  assert.match(plan({ sql: orphan.sql, args: [ago(14 * DAY), '["volvo"]'] }), /idx_items_skipped/);
  const auxOrphan = find(/LEFT JOIN aux_items c ON c.id = d.story_of/)[0];
  assert.match(plan({ sql: auxOrphan.sql, args: [ago(14 * DAY), '["volvo"]'] }), /aux_items_skipped/);
});

test("B-T25 ingest never prepares a non-SELECT on NEWS and never calls fetch", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel", "aevex", "managed_widgetco_news");
  nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * HOUR) });
  nm(env, { source_key: "aur_rel", first_seen: ago(HOUR) });
  nm(env, { source_key: "aevex", first_seen: ago(2 * HOUR), url: "https://news.example.com/aux/9" });
  nm(env, { source_key: "managed_widgetco_news", first_seen: ago(HOUR), url: "https://news.example.com/aux/9" });
  const news = env.NEWS;
  const guarded = {
    prepare(sql) {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`write on NEWS: ${sql.slice(0, 40)}`);
      return news.prepare(sql);
    },
    batch() { throw new Error("batch on NEWS"); },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch called"); };
  try {
    const r = await ingest({ ...env, NEWS: guarded });
    const a = await ingestAux({ ...env, NEWS: guarded });
    assert.equal(r.story_held, 1);
    assert.equal(a.story_held, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- Aux catch-up and ignored canonicals ---------------------------------------
test("B-T26 aux bounded catch-up: a row already stored never matches itself and is not counted in story_held", async () => {
  const env = newEnv();
  seed(env, "botauto");
  const title = "Bot Auto opens a new hub in the desert";
  // A rival row the coverage key-account gate drops (its title names no affected company): stored on Aux.
  const earlier = nm(env, { source_key: "botauto", first_seen: ago(3 * DAY), title, url: "https://news.example.com/botauto/1" });
  const row = nm(env, { source_key: "botauto", first_seen: ago(DAY), title, url: "https://news.example.com/botauto/2" });
  await ingestAux(env);
  const stored = auxRow(env, row);
  assert.equal(stored.skip_reason, "story_dup", "the main scan held the later copy");
  // Re-open the one-time rival catch-up over the same rows.
  env.DB.db.prepare("UPDATE meta SET value = '0' WHERE key = 'aux_rv_cursor'").run();
  env.DB.db.prepare("UPDATE aux_items SET state = 'pending', skip_reason = NULL, story_of = NULL WHERE nm_rowid = ?").run(row);
  const r = await ingestAux(env);
  assert.ok(r.rival_catch_up && r.rival_catch_up.scanned >= 2, "the catch-up rescanned the rows");
  assert.equal(r.rival_catch_up.story_held, 0, "a stored row is not evaluated");
  assert.deepEqual([auxRow(env, row).state, auxRow(env, row).story_of], ["pending", null]);
  assert.equal(auxRow(env, earlier).state, "pending");
});

test("B-T27 an in-batch canonical whose INSERT is ignored leaves its copy with story_of NULL; storyOrphans promotes the copy to a held rescue row", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel");
  const url = "https://news.example.com/volvo_autonomous/taken";
  // (source_key, url) already stored on a skipped row: the canonical's INSERT OR IGNORE is ignored.
  env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason)
    VALUES (998001, 'volvo_autonomous', 'AUR', ?, 'Older row', ?, ?, 'skipped', 'stale_on_arrival')`).run(url, ago(20 * DAY), ago(0));
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(2 * HOUR), url });
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(HOUR) });
  await ingest(env);
  assert.equal(cov(env, a), undefined, "the canonical was not stored");
  assert.deepEqual([cov(env, b).skip_reason, cov(env, b).story_of], ["story_dup", null]);
  const o = await storyOrphans(env);
  assert.deepEqual(o.promoted, { coverage: 1, aux: 0 });
  assert.deepEqual([cov(env, b).state, cov(env, b).skip_reason, cov(env, b).admit, cov(env, b).released_at, cov(env, b).story_of],
    ["pending", null, "rescue", null, null]);
  assert.ok(cov(env, b).story_key, "it keeps its keys");
});

// --- Ops, Left out, the backfill route --------------------------------------------
test("B-T32 ops backlog.story counts held_today and held_14d per table; double_graded_24h unchanged", async () => {
  const env = newEnv();
  const add = (table, firstSeen, reason = "story_dup") => env.DB.db.prepare(table === "items"
    ? `INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason) VALUES (?, 'volvo_autonomous', 'AUR', ?, 'x', ?, ?, 'skipped', ?)`
    : `INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state, skip_reason) VALUES (?, 'aevex', 'aevex', 'AEVEX', 'public', ?, 'x', ?, ?, 'skipped', ?)`)
    .run(++seq + 500_000, `https://news.example.com/ops/${seq}`, firstSeen, ago(0), reason);
  const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  add("items", todayStart);
  add("items", ago(3 * DAY));
  add("items", ago(20 * DAY));                    // outside the 14 days
  add("items", todayStart, "stale_on_arrival");  // another reason
  add("aux_items", ago(5 * DAY));
  const before = (await request(worker, env, "GET", "/v1/ops", { role: "app" })).body.grader.backlog;
  assert.deepEqual(before.story, { held_today: { coverage: 1, aux: 0 }, held_14d: { coverage: 2, aux: 1 }, dedup: "on" });
  assert.equal(before.double_graded_24h, 0);
});

test("B-T33 Left out: a story_dup row has copy_of and is gradeable, or blocked while its source is muted; Grade it writes keys and keeps story_of", async () => {
  const env = newEnv();
  seed(env, "volvo_autonomous", "aur_rel", "volvo");
  const a = nm(env, { source_key: "volvo_autonomous", first_seen: ago(3 * DAY) });
  const b = nm(env, { source_key: "aur_rel", first_seen: ago(2 * DAY) });
  const c = nm(env, { source_key: "volvo", first_seen: ago(2 * DAY - MIN) });
  const st = nm(env, { source_key: "aur_rel", first_seen: ago(3 * DAY), published: ago(40 * DAY), title: "Acme Robotics names a new CFO today" });
  await ingest(env);
  const canonId = cov(env, a).id, bId = cov(env, b).id, cId = cov(env, c).id;
  assert.equal(cov(env, c).skip_reason, "story_dup");
  assert.equal((await request(worker, env, "POST", "/v1/source-prefs", { role: "app", body: { source_key: "volvo", action: "mute" } })).status, 200);
  const items = (await request(worker, env, "GET", "/v1/left-out?kind=coverage&reason=story_dup", { role: "app" })).body.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.deepEqual([byId.get(bId).copy_of, byId.get(bId).gradeable, byId.get(bId).blocked], [canonId, true, null]);
  assert.deepEqual([byId.get(cId).copy_of, byId.get(cId).gradeable], [canonId, false]);
  assert.match(byId.get(cId).blocked, /still muted/);
  const refused = await request(worker, env, "POST", "/v1/left-out/grade", { role: "app", body: { kind: "coverage", id: cId } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /volvo is still muted: set it back to normal first/);
  // A forced copy keeps story_of and is never chosen as a canonical.
  const forced = await request(worker, env, "POST", "/v1/left-out/grade", { role: "app", body: { kind: "coverage", id: bId } });
  assert.equal(forced.status, 200);
  const fb = env.DB.rows("SELECT state, story_of, story_key FROM items WHERE id = ?", bId)[0];
  assert.deepEqual([fb.state, fb.story_of, fb.story_key], ["pending", canonId, cov(env, a).story_key]);
  env.DB.db.prepare("UPDATE items SET state = 'skipped', skip_reason = 'grading_failed' WHERE id = ?").run(canonId);
  const later = nm(env, { source_key: "aur_rel", first_seen: ago(HOUR) });
  await ingest(env);
  assert.deepEqual([cov(env, later).state, cov(env, later).story_of], ["pending", null], "neither the failed canonical nor the forced copy is a canonical");
  // A forced stale row gets its keys and holds a later copy.
  const g = await request(worker, env, "POST", "/v1/left-out/grade", { role: "app", body: { kind: "coverage", id: cov(env, st).id } });
  assert.equal(g.status, 200);
  assert.ok(cov(env, st).story_key);
  const copy = nm(env, { source_key: "volvo_autonomous", first_seen: ago(30 * MIN), title: "Acme Robotics names a new CFO today" });
  await ingest(env);
  assert.deepEqual([cov(env, copy).skip_reason, cov(env, copy).story_of], ["story_dup", cov(env, st).id]);
});

test("B-T34 POST /v1/admin/story-backfill: admin only; keys for live rows of the last 14 days, at most limit a call; next_after_id and done; no story_of; one admin_run audit row a call", async () => {
  const env = newEnv();
  const ins = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason)
    VALUES (?, 'volvo_autonomous', 'AUR', ?, ?, ?, ?, ?, ?)`);
  const id = (n, firstSeen, state = "pending", reason = null, title = T) => Number(ins.run(700_000 + n, `https://news.example.com/bf/${n}`, title, firstSeen, ago(0), state, reason).lastInsertRowid);
  const live = [id(1, ago(3 * DAY)), id(2, ago(2 * DAY), "graded"), id(3, ago(DAY), "claimed")];
  const skipped = id(4, ago(DAY), "skipped", "stale_on_arrival");
  const old = id(5, ago(20 * DAY));
  const short = id(6, ago(DAY), "pending", null, "Acme deal");
  env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
    VALUES (710001, 'aevex', 'aevex', 'AEVEX', 'public', 'https://news.example.com/bf/aux', ?, ?, ?, 'pending')`).run(T, ago(DAY), ago(0));
  for (const role of ["app", "grader"]) assert.equal((await request(worker, env, "POST", "/v1/admin/story-backfill", { role, body: { kind: "coverage" } })).status, 403);
  assert.equal((await request(worker, env, "POST", "/v1/admin/story-backfill", { body: { kind: "both" } })).status, 400);
  let r = await request(worker, env, "POST", "/v1/admin/story-backfill", { body: { kind: "coverage", limit: 2 } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.updated, r.body.next_after_id, r.body.done], [2, live[1], false]);
  r = await request(worker, env, "POST", "/v1/admin/story-backfill", { body: { kind: "coverage", limit: 2, after_id: r.body.next_after_id } });
  assert.deepEqual([r.body.scanned, r.body.updated, r.body.next_after_id, r.body.done], [2, 1, short, false]);
  r = await request(worker, env, "POST", "/v1/admin/story-backfill", { body: { kind: "coverage", limit: 2, after_id: r.body.next_after_id } });
  assert.deepEqual([r.body.scanned, r.body.done], [0, true]);
  const rows = new Map(env.DB.rows("SELECT id, story_key, story_of FROM items").map((x) => [x.id, x]));
  for (const i of live) assert.match(rows.get(i).story_key, /^t:/);
  for (const i of [skipped, old, short]) assert.equal(rows.get(i).story_key, null);
  assert.ok([...rows.values()].every((x) => x.story_of == null), "no story_of is ever set");
  r = await request(worker, env, "POST", "/v1/admin/story-backfill", { body: { kind: "aux" } });
  assert.deepEqual([r.body.updated, r.body.done], [1, true]);
  const a = env.DB.rows("SELECT story_key, url_key FROM aux_items")[0];
  assert.match(a.story_key, /^t:/);
  assert.match(a.url_key, /^u:/);
  const audits = env.DB.rows("SELECT actor, action, target_id FROM audit_log WHERE action = 'admin_run'");
  assert.equal(audits.length, 4);
  assert.ok(audits.every((x) => x.target_id === "story-backfill" && x.actor === "admin"));
});
