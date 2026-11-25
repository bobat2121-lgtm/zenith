// Phase 1 (plans/phase1-build-spec.md, Part B PR-G3, built as PR-GATE commit 1):
// the per-source fast-path cap. A source that is neither a covered own-lane
// source nor SEC may add at most fast_cap (10, secret GATE_FAST_CAP, 0 is off)
// fast-path rows (admit NULL, not skipped) per first-seen UTC day, across
// items and aux_items; its later fresh rows are held 'source_cap' and released
// by the daily budget. Synthetic rows only, over the real migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { fastPathCounts, releaseHeld } = await import("../worker/src/budget.js");
const { heartbeatChecks } = await import("../worker/src/delivery.js");
const COVERED = (await import("../worker/src/covered.json")).default;

const DAY_A = "2026-11-24";
const DAY_B = "2026-11-25";
const EARLIER = "2026-11-20T08:00:00.000Z";
const at = (day, k) => `${day}T${String(1 + Math.floor(k / 60)).padStart(2, "0")}:${String(k % 60).padStart(2, "0")}:00.000Z`;
const plain = (rows) => rows.map((r) => ({ ...r }));
const newEnv = (extra = {}) => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra };
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
};
let seq = 0;
// One news-monitor row, dated at its first sighting (fresh) unless published is given.
function nm(env, { source_key, first_seen, title, published, url }) {
  seq++;
  env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
    .run(source_key, url ?? `https://news.example.com/${source_key}/${seq}`, title ?? `Volvo Autonomous Solutions update ${seq}`,
      published === undefined ? first_seen : published, first_seen);
}
// A counterparty source of the generated catalog (role relationship, affects
// AUR); the titles name it, so every row routes to a ticker.
const CP = "volvo_autonomous";
// An earlier poll, so later rows are not the source's seed (seed_fresh).
const seedEarlier = (env, key = CP, title) => nm(env, { source_key: key, first_seen: EARLIER, title });
const admits = (env, table = "items", key = CP) =>
  plain(env.DB.rows(`SELECT admit FROM ${table} WHERE source_key = ? AND nm_first_seen > ? ORDER BY nm_rowid`, key, EARLIER)).map((x) => x.admit);
// A stored fast-path row (admit NULL, pending) of a source on aux_items.
function storedAux(env, key, firstSeen, over = {}) {
  env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen, ingested_at, state, admit)
    VALUES (?, ?, 'testent', 'Testent (private)', 'private', ?, 'Outside news', ?, NULL, ?, ?, ?, ?)`)
    .run(900_000 + ++seq, key, `https://news.example.com/stored/${seq}`, firstSeen, firstSeen, firstSeen, over.state ?? "pending", over.admit ?? null);
}

test("ingest: 10 fresh rows of one counterparty source first seen in one UTC day stay plain pending; the 11th is held source_cap", async () => {
  const env = newEnv();
  seedEarlier(env);
  for (let k = 0; k < 11; k++) nm(env, { source_key: CP, first_seen: at(DAY_A, k) });
  const r = await ingest(env);
  assert.deepEqual(admits(env), [...Array(10).fill(null), "source_cap"]);
  assert.equal(r.held, 2, "the earlier poll's seed_fresh row and the 11th row");
  const last = env.DB.rows("SELECT state, skip_reason, released_at FROM items WHERE admit = 'source_cap'")[0];
  assert.deepEqual({ ...last }, { state: "pending", skip_reason: null, released_at: null });
});

test("ingest: the count spans items and aux_items and earlier batches of the same tick; a new UTC day resets it; a batch that spans two days uses two queries", async () => {
  // Across tables: 6 stored aux fast-path rows of the source on day A leave room for 4 Coverage rows.
  const env = newEnv();
  for (let k = 0; k < 6; k++) storedAux(env, CP, at(DAY_A, k));
  storedAux(env, CP, at(DAY_A, 50), { admit: "seed_fresh" });           // held rows are not fast path
  storedAux(env, CP, at(DAY_A, 51), { state: "skipped" });              // nor are skipped rows
  seedEarlier(env);
  for (let k = 0; k < 5; k++) nm(env, { source_key: CP, first_seen: at(DAY_A, 10 + k) });
  await ingest(env);
  assert.deepEqual(admits(env), [null, null, null, null, "source_cap"]);

  // Across batches of one tick: 400 rows per batch; rows of sources Zenith does not know fill the window.
  const e2 = newEnv();
  seedEarlier(e2);
  for (let k = 0; k < 6; k++) nm(e2, { source_key: CP, first_seen: at(DAY_A, k) });
  for (let k = 0; k < 393; k++) nm(e2, { source_key: "not_a_known_source", first_seen: at(DAY_A, 100) });
  for (let k = 0; k < 6; k++) nm(e2, { source_key: CP, first_seen: at(DAY_A, 200 + k) });
  const sql = [];
  const prepare = e2.DB.prepare.bind(e2.DB);
  e2.DB.prepare = (s) => { sql.push(s); return prepare(s); };
  await ingest(e2);
  assert.equal(e2.DB.rows("SELECT value FROM meta WHERE key = 'nm_cursor'")[0].value, "406", "two batches ran");
  assert.deepEqual(admits(e2), [...Array(10).fill(null), "source_cap", "source_cap"]);
  assert.equal(sql.filter((s) => /admit IS NULL AND state != 'skipped' GROUP BY source_key/.test(s)).length, 3,
    "per batch, one count query per first-seen day: the earlier poll's day and day A, then day A again");

  // A new UTC day resets it, and one batch spanning two days asks for each day once.
  const e3 = newEnv();
  seedEarlier(e3);
  for (let k = 0; k < 11; k++) nm(e3, { source_key: CP, first_seen: at(DAY_A, k) });
  for (let k = 0; k < 11; k++) nm(e3, { source_key: CP, first_seen: at(DAY_B, k) });
  const binds = [];
  const p3 = e3.DB.prepare.bind(e3.DB);
  e3.DB.prepare = (s) => {
    const st = p3(s);
    if (!/admit IS NULL AND state != 'skipped' GROUP BY source_key/.test(s)) return st;
    return { bind: (...a) => { binds.push(a); return st.bind(...a); } };
  };
  await ingest(e3);
  assert.deepEqual(admits(e3), [...Array(10).fill(null), "source_cap", ...Array(10).fill(null), "source_cap"]);
  assert.deepEqual(binds.sort(), [[DAY_A, DAY_B], [DAY_B, "2026-11-26"], ["2026-11-20", "2026-11-21"]].sort(),
    "one query per first-seen day of the batch, each binding only the two day bounds");
});

test("fastPathCounts and ingest with 120 distinct non-own-lane keys in one batch succeed on a stub D1 that throws when a statement binds more than 100 parameters", async () => {
  const strict = (d1) => {
    const prepare = d1.prepare.bind(d1);
    d1.prepare = (s) => {
      const st = prepare(s);
      const bind = st.bind.bind(st);
      st.bind = (...a) => { if (a.length > 100) throw new Error(`too many SQL variables (${a.length})`); return bind(...a); };
      return st;
    };
    return d1;
  };
  const env = newEnv();
  strict(env.DB);
  strict(env.NEWS);
  // Counterparty keys (a rival's row is stored skipped rival_no_key_account, which is fine here).
  const keys = Object.keys(COVERED.counterparty).filter((k) => !/^(edgar_|legistar_|fpds_)/.test(k)).slice(0, 120);
  assert.equal(keys.length, 120);
  for (const [i, k] of keys.entries()) nm(env, { source_key: k, first_seen: at(DAY_A, i % 59), title: `Synthetic counterparty update ${i}` });
  const r = await ingest(env);
  assert.equal(r.scanned, 120);
  assert.equal(env.DB.rows("SELECT COUNT(DISTINCT source_key) AS n FROM items")[0].n, 120);
  // Directly: 120 keys with stored rows on one day come back in one call.
  for (const [i, k] of keys.entries()) storedAux(env, k, at(DAY_B, i % 59));
  const counts = await fastPathCounts(env.DB, DAY_B);
  assert.equal(counts.size, 120);
  assert.ok([...counts.values()].every((n) => n === 1));
});

test("fastPathCounts drops own-lane and edgar_* keys and counts a non-edgar_ row on a sec.gov URL toward its source", async () => {
  const env = newEnv();
  const own = Object.keys(COVERED.sources).find((k) => !k.startsWith("edgar_"));
  for (const key of [own, "edgar_testco", "synthetic_src"]) storedAux(env, key, at(DAY_A, 1));
  env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (1, 'synthetic_src', 'RCAT', 'https://www.sec.gov/Archives/edgar/data/1/0001/x.htm', 't', NULL, NULL, ?, 0, ?, 'pending')`).run(at(DAY_A, 2), at(DAY_A, 2));
  storedAux(env, "synthetic_src", at(DAY_B, 1));                         // another day
  assert.deepEqual([...await fastPathCounts(env.DB, DAY_A)], [["synthetic_src", 2]]);
  assert.deepEqual([...await fastPathCounts(env.DB, `${DAY_A}T00:00:00.000Z`)], [["synthetic_src", 2]], "a day-start ISO works too");
});

test("GATE_FAST_CAP=0 turns the cap off; GATE_FAST_CAP=5 holds the 6th row", async () => {
  const off = newEnv({ GATE_FAST_CAP: "0" });
  seedEarlier(off);
  for (let k = 0; k < 15; k++) nm(off, { source_key: CP, first_seen: at(DAY_A, k) });
  const sql = [];
  const prepare = off.DB.prepare.bind(off.DB);
  off.DB.prepare = (s) => { sql.push(s); return prepare(s); };
  await ingest(off);
  assert.deepEqual(admits(off), Array(15).fill(null));
  assert.ok(!sql.some((s) => /admit IS NULL AND state != 'skipped' GROUP BY source_key/.test(s)), "off sends no count query");
  const five = newEnv({ GATE_FAST_CAP: "5" });
  seedEarlier(five);
  for (let k = 0; k < 7; k++) nm(five, { source_key: CP, first_seen: at(DAY_A, k) });
  await ingest(five);
  assert.deepEqual(admits(five), [...Array(5).fill(null), "source_cap", "source_cap"]);
});

test("REGRESSION the cap never holds own-lane, edgar_* or sec.gov-URL rows, and a capped seed row stays seed_fresh", async () => {
  const env = newEnv();
  const own = Object.entries(COVERED.sources).find(([k]) => !k.startsWith("edgar_"))[0];
  nm(env, { source_key: own, first_seen: EARLIER, title: "Testco earlier release" });
  for (let k = 0; k < 12; k++) nm(env, { source_key: own, first_seen: at(DAY_A, k), title: `Testco release ${k}` });
  // A counterparty source's rows on a sec.gov URL: SEC items keep the fast path.
  seedEarlier(env);
  for (let k = 0; k < 12; k++) nm(env, { source_key: CP, first_seen: at(DAY_A, k), url: `https://www.sec.gov/Archives/edgar/data/9/000${k}/v.htm` });
  // A new source's first poll of 12 fresh rows: seed_fresh, whatever the cap.
  for (let k = 0; k < 12; k++) nm(env, { source_key: "fpds_pl", first_seen: at(DAY_A, 30), title: `Planet Labs PBC order ${k}` });
  await ingest(env);
  assert.deepEqual(admits(env, "items", own), Array(12).fill(null));
  assert.deepEqual(admits(env), Array(12).fill(null));
  assert.deepEqual(admits(env, "items", "fpds_pl"), Array(12).fill("seed_fresh"));
});

test("aux ingest applies the same cap", async () => {
  const env = newEnv();
  seedEarlier(env, "anduril", "Anduril earlier news");
  for (let k = 0; k < 12; k++) nm(env, { source_key: "anduril", first_seen: at(DAY_A, k), title: `Anduril news ${k}` });
  await ingestAux(env);
  assert.deepEqual(admits(env, "aux_items", "anduril"), [...Array(10).fill(null), "source_cap", "source_cap"]);
  // Counted across both pipelines: Coverage rows of the source the same day leave less room.
  const e2 = newEnv();
  e2.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (777001, 'anduril', 'RCAT', 'https://news.example.com/cov/1', 't', NULL, NULL, ?, 0, ?, 'pending')`).run(at(DAY_A, 0), at(DAY_A, 0));
  seedEarlier(e2, "anduril", "Anduril earlier news");
  for (let k = 0; k < 10; k++) nm(e2, { source_key: "anduril", first_seen: at(DAY_A, k + 1), title: `Anduril news ${k}` });
  await ingestAux(e2);
  assert.deepEqual(admits(e2, "aux_items", "anduril"), [...Array(9).fill(null), "source_cap"]);
});

test("REGRESSION an aux catch-up counts rows it finds already stored once, from the DB count only", async () => {
  // An existing zenith-db mid rival catch-up (aux_rv_cursor not done): the main
  // scan already stored 6 of a rival source's day-A rows; 5 more are not stored.
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  const key = "pixxel";
  nm(env, { source_key: key, first_seen: EARLIER, title: "Pixxel earlier news" });
  for (let k = 0; k < 11; k++) nm(env, { source_key: key, first_seen: at(DAY_A, k), title: `Pixxel launches satellite ${k}` });
  const news = plain(env.NEWS.rows("SELECT rowid AS nm_rowid, url, title, first_seen FROM items WHERE source_key = ? AND first_seen > ? ORDER BY rowid", key, EARLIER));
  for (const r of news.slice(0, 6)) {
    env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen, ingested_at, state, coverage_subject, affects)
      VALUES (?, ?, 'pixxel', 'Pixxel', 'private', ?, ?, ?, NULL, ?, ?, 'pending', 1, 'SATL')`).run(r.nm_rowid, key, r.url, r.title, r.first_seen, r.first_seen, r.first_seen);
  }
  const last = env.NEWS.rows("SELECT MAX(rowid) AS n FROM items")[0].n;
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', ?), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', '0'), ('aux_owner_cleanup', 'done')").run(String(last));
  const r = await ingestAux(env);
  assert.equal(r.rival_catch_up.done, true);
  // 6 stored + 4 new reach the cap of 10; only the 11th is held.
  assert.deepEqual(admits(env, "aux_items", key), [...Array(10).fill(null), "source_cap"]);
});

test("REGRESSION source_cap rows are left out of the brief's waiting list, queue_stale, the claims and the feeds, and are counted in heldCounts and in source_cap_held", async () => {
  const env = newEnv();
  const now = Date.now();
  const iso = (ms) => new Date(now - ms).toISOString();
  const ins = (title, over = {}) => Number(env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified,
      ingested_at, state, admit) VALUES (?, 'volvo_autonomous', 'AUR', ?, ?, ?, NULL, ?, 0, ?, 'pending', ?)`)
    .run(++seq, `https://news.example.com/r/${seq}`, title, iso(3 * 3_600_000), iso(3 * 3_600_000), iso(3 * 3_600_000), over.admit ?? null).lastInsertRowid);
  const capped = ins("Volvo Autonomous Solutions capped row", { admit: "source_cap" });
  storedAux(env, "anduril", iso(3 * 3_600_000), { admit: "source_cap" });
  const app = (path) => request(worker, env, "GET", path, { role: "app" });
  const feed = (await app("/v1/feed")).body.items.map((i) => i.item_id);
  assert.ok(!feed.includes(capped));
  assert.equal((await app("/v1/aux/feed")).body.items.length, 0);
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10 } })).body;
  assert.equal(claim.items.length, 0);
  assert.equal((await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 10 } })).body.items.length, 0);
  const brief = (await app(`/v1/brief?since=${encodeURIComponent(iso(86_400_000))}`)).body.waiting;
  assert.equal(brief.count, 0);
  assert.equal(brief.held, 1);
  assert.equal((await heartbeatChecks(env.DB, now)).find((c) => c.key === "queue_stale").state, "ok");
  const b = (await app("/v1/ops")).body.grader.backlog;
  assert.deepEqual([b.coverage_held, b.aux_held, b.source_cap_held], [1, 1, 2]);
  // Released, it leaves source_cap_held and is claimable.
  await releaseHeld(env, { now });
  assert.equal((await app("/v1/ops")).body.grader.backlog.source_cap_held, 0);
  assert.ok((await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10 } })).body.items.some((i) => i.item_id === capped));
});

test("ops: fast_path_today lists today's top 5 capped sources and budget carries fast_cap", async () => {
  const env = newEnv({ GATE_FAST_CAP: "7" });
  const today = new Date().toISOString().slice(0, 10);
  const t = (k) => `${today}T00:00:${String(k).padStart(2, "0")}.000Z`;
  for (const [key, n] of [["s_a", 6], ["s_b", 5], ["s_c", 4], ["s_d", 3], ["s_e", 2], ["s_f", 1], ["edgar_testco", 9]]) for (let k = 0; k < n; k++) storedAux(env, key, t(k));
  const b = (await request(worker, env, "GET", "/v1/ops", { role: "app" })).body.grader.backlog;
  assert.deepEqual(b.fast_path_today, [["s_a", 6], ["s_b", 5], ["s_c", 4], ["s_d", 3], ["s_e", 2]].map(([source_key, n]) => ({ source_key, n })));
  assert.equal(b.budget.fast_cap, 7);
  assert.equal(b.source_cap_held, 0);
});

// Integration (plans/phase1-build-spec.md §I2, PR-GATE commit 3): a vote or
// record_fresh row is held by its own rule before the cap is considered, and
// fastPathCounts counts admit IS NULL rows only, so it never uses up the cap.
test("held vote and record_fresh rows do not count toward the fast cap", async () => {
  // An FPDS source: 3 undated post-seed rows (record_fresh), then 11 fresh dated rows.
  const env = newEnv();
  seedEarlier(env, "fpds_pl", "[PL] FPDS: SYNTHETIC AGENCY earlier order");
  for (let k = 0; k < 3; k++) nm(env, { source_key: "fpds_pl", first_seen: at(DAY_A, k), published: null, title: `[PL] FPDS: SYNTHETIC AGENCY modification ${k}` });
  for (let k = 0; k < 11; k++) nm(env, { source_key: "fpds_pl", first_seen: at(DAY_A, 10 + k), title: `[PL] FPDS: SYNTHETIC AGENCY order ${k}` });
  await ingest(env);
  assert.deepEqual(admits(env, "items", "fpds_pl"), [...Array(3).fill("record_fresh"), ...Array(10).fill(null), "source_cap"]);
  // A second ingest the same day: the stored record_fresh rows still do not count.
  nm(env, { source_key: "fpds_pl", first_seen: at(DAY_A, 40), title: "[PL] FPDS: SYNTHETIC AGENCY later order" });
  await ingest(env);
  assert.equal(admits(env, "items", "fpds_pl").at(-1), "source_cap");
  assert.deepEqual([...await fastPathCounts(env.DB, DAY_A)], [["fpds_pl", 10]]);

  // A Legistar source: 3 decision rows (vote), then 11 fresh base rows.
  const e2 = newEnv();
  const key = "legistar_oakland_axon";
  const url = (k, frag = "") => `https://testville.legistar.com/LegislationDetail.aspx?ID=${k}&GUID=SYNTH${frag}`;
  seedEarlier(e2, key, "[AXON] Testville City Council earlier matter");
  for (let k = 0; k < 3; k++) nm(e2, { source_key: key, first_seen: at(DAY_A, k), url: url(k, `#vote-${k}`), title: `[AXON] Testville City Council matter ${k} — vote` });
  for (let k = 0; k < 11; k++) nm(e2, { source_key: key, first_seen: at(DAY_A, 10 + k), url: url(100 + k), title: `[AXON] Testville City Council matter ${100 + k}` });
  await ingest(e2);
  assert.deepEqual(admits(e2, "items", key), [...Array(3).fill("vote"), ...Array(10).fill(null), "source_cap"]);
});
