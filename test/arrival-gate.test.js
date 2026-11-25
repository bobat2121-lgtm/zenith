// Phase 0 gates (plans/phase0-build-spec.md, Appendix A sections 1.3, 3, 4 and
// ruling A1): the arrival gate. Official records past the 14-day stale gate,
// a 21-day window for a new source's first poll, seed_fresh for a new
// non-covered source's fresh first-poll rows, and today's fast path for
// everything else. Pure cases first, then through both ingests. Synthetic rows.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { serveWorker, runGrader } from "./helpers/aux-e2e.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { arrivalGate, LATE_WINDOW_DAYS, RECORD_LOOKBACK_DAYS, STALE_DAYS } = await import("../worker/src/lib.js");
const { ingest, sourceFirstSeen, isSeedRow } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { releaseHeld } = await import("../worker/src/budget.js");

const DAY = 86_400_000;
const SEEN = "2026-11-23T10:00:00.000Z";
const ago = (days, from = SEEN) => new Date(Date.parse(from) - days * DAY).toISOString();
const row = (days, over = {}) => ({ source_key: "x", published: days == null ? null : ago(days), first_seen: SEEN, ...over });
const gate = (days, ctx) => arrivalGate(row(days), ctx);
const plain = { reason: null, admit: null };
const plain2 = (rows) => rows.map((r) => ({ ...r }));

test("constants: 14-day fast path, 21-day window, 120-day Coverage record lookback", () => {
  assert.deepEqual([STALE_DAYS, LATE_WINDOW_DAYS, RECORD_LOOKBACK_DAYS], [14, 21, 120]);
});

test("gate coverage: an FPDS row 69 days old outside a burst is admitted record_late; 121 days is stale_on_arrival; 69 days inside a seed burst of 6 is archive_seed; 18 days inside that burst is record_late", () => {
  const fpds = { source_key: "fpds_pl", published: "2026-09-15T00:00:00Z", first_seen: "2026-11-23T00:00:00Z" };
  const rec = { pipeline: "coverage", record: true, seed: false, burst: false };
  assert.deepEqual(arrivalGate(fpds, rec), { reason: null, admit: "record_late" });
  assert.deepEqual(gate(121, rec), { reason: "stale_on_arrival", admit: null });
  assert.deepEqual(gate(120, rec), { reason: null, admit: "record_late" });
  const seedBurst = { ...rec, seed: true, burst: true };
  assert.deepEqual(gate(69, seedBurst), { reason: "archive_seed", admit: null });
  assert.deepEqual(gate(18, seedBurst), { reason: null, admit: "record_late" });
  // A later (non-seed) burst: no record exception past 21 days either.
  assert.deepEqual(gate(69, { ...rec, burst: true }), { reason: "stale_on_arrival", admit: null });
});

test("gate aux: a record 18 days old is record_late; 30 days is stale_on_arrival", () => {
  const ctx = { pipeline: "aux", record: true, seed: false, burst: false };
  assert.deepEqual(gate(18, ctx), { reason: null, admit: "record_late" });
  assert.deepEqual(gate(30, ctx), { reason: "stale_on_arrival", admit: null });
  assert.deepEqual(gate(30, { ...ctx, seed: true }), { reason: "stale_on_arrival", admit: null }, "no record exception on Auxiliary");
});

test("seed batch: rows 15-21 days old are admitted seed_window; 22+ days archive_seed in a burst, stale_on_arrival without one; undated in a burst archive_seed", () => {
  const seed = { pipeline: "coverage", record: false, seed: true, burst: false };
  for (const d of [15, 18, 21]) assert.deepEqual(gate(d, seed), { reason: null, admit: "seed_window" }, `${d} days`);
  assert.deepEqual(gate(22, { ...seed, burst: true }), { reason: "archive_seed", admit: null });
  assert.deepEqual(gate(22, seed), { reason: "stale_on_arrival", admit: null });
  assert.deepEqual(gate(null, { ...seed, burst: true }), { reason: "archive_seed", admit: null });
  assert.deepEqual(gate(18, { ...seed, pipeline: "aux" }), { reason: null, admit: "seed_window" });
});

test("a later burst (not a seed): undated rows are undated_burst, dated old rows stale_on_arrival, never archive_seed", () => {
  const later = { pipeline: "aux", record: false, seed: false, burst: true };
  assert.deepEqual(gate(null, later), { reason: "undated_burst", admit: null });
  assert.deepEqual(gate(40, later), { reason: "stale_on_arrival", admit: null });
  assert.deepEqual(gate(18, later), { reason: "stale_on_arrival", admit: null });
});

test("REGRESSION gate: a covered own channel's rows outside a seed are unchanged: dated today pending, undated pending, 15 days old stale_on_arrival, admit null", () => {
  const own = { pipeline: "coverage", record: false, seed: false, burst: false, ownLane: true };
  assert.deepEqual(gate(0, own), plain);
  assert.deepEqual(gate(null, own), plain);
  assert.deepEqual(gate(14, own), plain);
  assert.deepEqual(gate(15, own), { reason: "stale_on_arrival", admit: null });
});

test("REGRESSION gate: SEC fast path: an edgar_* row 0-14 days old is pending with admit null; 30 days old outside a burst is record_late on Coverage", () => {
  const sec = { pipeline: "coverage", record: true, seed: false, burst: false, ownLane: true, sec: true };
  for (const d of [0, 7, 14]) assert.deepEqual(gate(d, sec), plain, `${d} days`);
  assert.deepEqual(gate(30, sec), { reason: null, admit: "record_late" });
  // Its seed batch keeps the fast path too (ruling A1).
  assert.deepEqual(gate(3, { ...sec, seed: true }), plain);
});

test("A1 seed batch of a counterparty or aux source: a row dated 3 days ago and an undated row outside a burst are admitted seed_fresh (held)", () => {
  for (const pipeline of ["coverage", "aux"]) {
    const ctx = { pipeline, record: false, seed: true, burst: false, ownLane: false, sec: false };
    assert.deepEqual(gate(3, ctx), { reason: null, admit: "seed_fresh" }, pipeline);
    assert.deepEqual(gate(null, ctx), { reason: null, admit: "seed_fresh" }, pipeline);
    // A record source's fresh seed rows too (Legistar, FCC): budgeted, not record_late.
    assert.deepEqual(gate(3, { ...ctx, record: true }), { reason: null, admit: "seed_fresh" }, pipeline);
  }
});

test("REGRESSION A1 seed batch of a covered own-lane source and of an edgar_* source: fresh rows stay plain pending with admit null", () => {
  assert.deepEqual(gate(3, { pipeline: "coverage", seed: true, ownLane: true }), plain);
  assert.deepEqual(gate(null, { pipeline: "coverage", seed: true, ownLane: true }), plain);
  assert.deepEqual(gate(3, { pipeline: "aux", seed: true, sec: true }), plain);
});

test("A1 a non-seed fresh row of a counterparty source stays plain pending (the fast path is unchanged after the seed)", () => {
  assert.deepEqual(gate(3, { pipeline: "coverage", seed: false, ownLane: false, sec: false }), plain);
  assert.deepEqual(gate(null, { pipeline: "aux", seed: false, ownLane: false, sec: false }), plain);
});

// Phase 1 (Part B PR-G3): the per-source fast-path cap.
test("arrivalGate: a capped, fresh, non-seed row of a counterparty or aux source gives source_cap; own-lane rows, edgar_* rows and sec.gov-URL rows are never capped; a seed row stays seed_fresh; skip reasons are unchanged", () => {
  for (const pipeline of ["coverage", "aux"]) {
    const capped = { pipeline, record: false, seed: false, burst: false, ownLane: false, sec: false, capped: true };
    assert.deepEqual(gate(3, capped), { reason: null, admit: "source_cap" }, pipeline);
    assert.deepEqual(gate(null, capped), { reason: null, admit: "source_cap" }, `${pipeline}: undated`);
    assert.deepEqual(gate(3, { ...capped, capped: false }), plain, `${pipeline}: under the cap`);
    // Never capped: the covered own lane, edgar_* (own lane and SEC) and a sec.gov URL (SEC).
    assert.deepEqual(gate(3, { ...capped, ownLane: true }), plain);
    assert.deepEqual(gate(3, { ...capped, ownLane: true, sec: true }), plain);
    assert.deepEqual(gate(3, { ...capped, sec: true }), plain);
    // A seed row stays seed_fresh.
    assert.deepEqual(gate(3, { ...capped, seed: true }), { reason: null, admit: "seed_fresh" });
    // Skip reasons and late admissions are unchanged.
    assert.deepEqual(gate(40, capped), { reason: "stale_on_arrival", admit: null });
    assert.deepEqual(gate(null, { ...capped, burst: true }), { reason: "undated_burst", admit: null });
    assert.deepEqual(gate(18, { ...capped, record: true }), { reason: null, admit: "record_late" });
    assert.deepEqual(gate(18, { ...capped, seed: true }), { reason: null, admit: "seed_window" });
  }
});

// --- Through the ingests -------------------------------------------------------
const newEnv = (extra = {}) => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra };
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
};
let seq = 0;
function nm(env, { source_key, title = `Testco item ${++seq}`, published, first_seen = SEEN, url }) {
  env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
    .run(source_key, url ?? `https://news.example.gov/${source_key}/${++seq}`, title, published === undefined ? first_seen : published, first_seen);
}
// Every statement sent to news-monitor-db.
function spy(news) {
  const sql = [];
  const prepare = news.prepare.bind(news);
  news.prepare = (s) => { sql.push(s); return prepare(s); };
  return sql;
}
const EARLIER = "2026-09-01T00:00:00.000Z";

test("ingest: a late FPDS row is stored pending with admit record_late, is not claimable, and is claimed after releaseHeld; the claim carries admit and record:true", async () => {
  const env = newEnv();
  nm(env, { source_key: "fpds_pl", title: "Contract notice: Planet Labs PBC imagery", first_seen: EARLIER });   // an earlier poll
  nm(env, { source_key: "fpds_pl", title: "Contract notice: Planet Labs PBC tasking order", published: "2026-09-15T00:00:00Z", first_seen: SEEN });
  const r = await ingest(env);
  assert.equal(r.held, 2, "the earlier poll is the source's seed (seed_fresh); the late row record_late");
  const late = env.DB.rows("SELECT id, state, admit, released_at FROM items WHERE title LIKE '%tasking%'")[0];
  assert.deepEqual([late.state, late.admit, late.released_at], ["pending", "record_late", null]);
  const claim = async () => (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10 } })).body;
  assert.equal((await claim()).items.length, 0, "held");
  await releaseHeld(env);
  const c = await claim();
  const it = c.items.find((i) => i.item_id === late.id);
  assert.deepEqual([it.admit, it.record, it.seen_after_days], ["record_late", true, 69.4]);
});

test("ingest: bad_url, rival_no_key_account and muted_source win over admit", async () => {
  const env = newEnv();
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, note, updated_at) VALUES ('fpds_pdyn', 'mute', NULL, ?)").run(SEEN);
  for (const k of ["fpds_pl", "fpds_pdyn", "neura"]) nm(env, { source_key: k, title: `Earlier ${k}`, first_seen: EARLIER });
  nm(env, { source_key: "fpds_pl", title: "Planet Labs notice", url: "ftp://bad.example.gov/x", published: ago(40), first_seen: SEEN });
  nm(env, { source_key: "fpds_pdyn", title: "Palladyne notice", published: ago(40), first_seen: SEEN });
  nm(env, { source_key: "neura", title: "Rival robot launch", published: ago(3), first_seen: SEEN });
  await ingest(env);
  const got = plain2(env.DB.rows("SELECT source_key, state, skip_reason, admit FROM items WHERE nm_first_seen = ? ORDER BY source_key", SEEN));
  assert.deepEqual(got, [
    { source_key: "fpds_pdyn", state: "skipped", skip_reason: "muted_source", admit: null },
    { source_key: "fpds_pl", state: "skipped", skip_reason: "bad_url", admit: null },
    { source_key: "neura", state: "skipped", skip_reason: "rival_no_key_account", admit: null },
  ]);
});

test("seed batch of a Coverage record source outside a burst: the window is 120 days; inside a burst 21", async () => {
  const env = newEnv();
  // A new FPDS feed's first poll: 2 old rows (no burst).
  nm(env, { source_key: "fpds_pl", published: ago(100), first_seen: SEEN });
  nm(env, { source_key: "fpds_pl", published: ago(18), first_seen: SEEN });
  // Another new record feed's first poll: 6 old rows (a seed burst).
  for (const d of [100, 90, 80, 70, 60]) nm(env, { source_key: "fpds_pdyn", published: ago(d), first_seen: SEEN });
  nm(env, { source_key: "fpds_pdyn", published: ago(18), first_seen: SEEN });
  await ingest(env);
  const by = (k) => plain2(env.DB.rows("SELECT state, skip_reason, admit FROM items WHERE source_key = ? ORDER BY nm_rowid", k));
  assert.deepEqual(by("fpds_pl"), [{ state: "pending", skip_reason: null, admit: "record_late" }, { state: "pending", skip_reason: null, admit: "record_late" }]);
  const pdyn = by("fpds_pdyn");
  assert.deepEqual(pdyn.slice(0, 5).map((x) => x.skip_reason), Array(5).fill("archive_seed"));
  assert.deepEqual(pdyn[5], { state: "pending", skip_reason: null, admit: "record_late" });
});

test("a group that becomes a burst in a later window: an earlier 18-day admission stays admitted; an earlier record_late row (69 days) is parked archive_seed with admit null", async () => {
  const env = newEnv();
  // Window 1: a record feed's first poll, 2 old rows (not yet a burst), and a
  // non-record source's first poll with one 18-day row.
  nm(env, { source_key: "fpds_pl", published: ago(18), first_seen: SEEN });
  nm(env, { source_key: "fpds_pl", published: ago(69), first_seen: SEEN });
  nm(env, { source_key: "volvo_autonomous", title: "Volvo Autonomous Solutions route news", published: ago(18), first_seen: SEEN });
  nm(env, { source_key: "volvo_autonomous", title: "Volvo Autonomous Solutions archive", published: null, first_seen: SEEN });
  await ingest(env);
  assert.deepEqual(plain2(env.DB.rows("SELECT admit FROM items WHERE source_key = 'fpds_pl' ORDER BY nm_rowid")).map((x) => x.admit), ["record_late", "record_late"]);
  // Window 2: the same poll's remaining rows arrive (news-monitor stored them later): now 5 archive candidates.
  for (const d of [40, 50, 60]) nm(env, { source_key: "fpds_pl", published: ago(d), first_seen: SEEN });
  for (const k of [1, 2, 3, 4]) nm(env, { source_key: "volvo_autonomous", title: `Volvo Autonomous Solutions page ${k}`, published: null, first_seen: SEEN });
  const r = await ingest(env);
  assert.ok(r.archive_parked_after_insert >= 2);
  const pl = plain2(env.DB.rows("SELECT state, skip_reason, admit FROM items WHERE source_key = 'fpds_pl' ORDER BY nm_rowid"));
  assert.deepEqual(pl[0], { state: "pending", skip_reason: null, admit: "record_late" }, "18 days: still admitted");
  assert.deepEqual(pl[1], { state: "skipped", skip_reason: "archive_seed", admit: null }, "69 days in a burst: core.md archive-burst rule");
  assert.deepEqual(pl.slice(2).map((x) => x.skip_reason), ["archive_seed", "archive_seed", "archive_seed"]);
  const volvo = plain2(env.DB.rows("SELECT state, skip_reason, admit FROM items WHERE source_key = 'volvo_autonomous' ORDER BY nm_rowid"));
  assert.deepEqual(volvo[0], { state: "pending", skip_reason: null, admit: "seed_window" }, "the 18-day seed_window row stays");
  assert.deepEqual(volvo.slice(1).map((x) => x.skip_reason), Array(5).fill("archive_seed"), "the undated seed_fresh row is parked with its burst");
  assert.ok(volvo.slice(1).every((x) => x.admit === null));
});

test("a later burst of an established source: undated rows are undated_burst and dated old rows stale_on_arrival, also when parked after insert", async () => {
  const env = newEnv();
  nm(env, { source_key: "anduril", title: "Anduril earlier news", first_seen: EARLIER });
  for (let k = 0; k < 3; k++) nm(env, { source_key: "anduril", title: `Anduril page ${k}`, published: null, first_seen: SEEN });
  await ingestAux(env);
  assert.deepEqual(plain2(env.DB.rows("SELECT state, admit FROM aux_items WHERE nm_first_seen = ?", SEEN)).map((x) => x.state), ["pending", "pending", "pending"]);
  for (let k = 3; k < 5; k++) nm(env, { source_key: "anduril", title: `Anduril page ${k}`, published: null, first_seen: SEEN });
  nm(env, { source_key: "anduril", title: "Anduril old post", published: ago(40), first_seen: SEEN });
  await ingestAux(env);
  const got = plain2(env.DB.rows("SELECT state, skip_reason FROM aux_items WHERE nm_first_seen = ? ORDER BY nm_rowid", SEEN));
  assert.deepEqual(got.map((x) => x.skip_reason), [...Array(5).fill("undated_burst"), "stale_on_arrival"]);
});

test("A1 through both ingests: a new counterparty or aux source's fresh first-poll rows are held seed_fresh; a covered own-lane and an edgar_* seed stay plain; later fresh rows take the fast path", async () => {
  const env = newEnv();
  // First polls: an aux-only source, a counterparty source, a covered own channel, an SEC feed.
  nm(env, { source_key: "anduril", title: "Anduril update", published: ago(3), first_seen: SEEN });
  nm(env, { source_key: "anduril", title: "Anduril undated page", published: null, first_seen: SEEN });
  nm(env, { source_key: "volvo_autonomous", title: "Volvo Autonomous Solutions news", published: ago(3), first_seen: SEEN });
  nm(env, { source_key: "redcat", title: "Testco order", published: ago(3), first_seen: SEEN });
  nm(env, { source_key: "edgar_rcat", title: "Testco: 8-K", url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/x.htm", published: ago(1), first_seen: SEEN });
  const later = "2026-11-24T10:00:00.000Z";
  nm(env, { source_key: "anduril", title: "Anduril next poll", published: ago(0, later), first_seen: later });
  nm(env, { source_key: "volvo_autonomous", title: "Volvo Autonomous Solutions next poll", published: ago(0, later), first_seen: later });
  await ingest(env);
  await ingestAux(env);
  const cov = Object.fromEntries(env.DB.rows("SELECT title, state, admit FROM items").map((x) => [x.title, `${x.state}:${x.admit}`]));
  assert.equal(cov["Volvo Autonomous Solutions news"], "pending:seed_fresh");
  assert.equal(cov["Volvo Autonomous Solutions next poll"], "pending:null", "not the seed: fast path");
  assert.equal(cov["Testco order"], "pending:null", "REGRESSION: covered own lane");
  assert.equal(cov["Testco: 8-K"], "pending:null", "REGRESSION: SEC");
  const aux = Object.fromEntries(env.DB.rows("SELECT title, state, admit FROM aux_items").map((x) => [x.title, `${x.state}:${x.admit}`]));
  assert.equal(aux["Anduril update"], "pending:seed_fresh");
  assert.equal(aux["Anduril undated page"], "pending:seed_fresh");
  assert.equal(aux["Anduril next poll"], "pending:null");
});

test("seed is decided by news-monitor MIN(first_seen) per source (SELECT only, cached per NEWS binding)", async () => {
  const a = newsDb(), b = newsDb();
  const sql = spy(a);
  const ins = (news, key, seen) => news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, 't', NULL, NULL, ?, 1)")
    .run(key, `https://x.example/${++seq}`, seen);
  ins(a, "testsrc", "2026-11-01T00:00:00Z");
  ins(a, "testsrc", "2026-11-20T00:00:00Z");
  ins(b, "testsrc", "2026-11-20T00:00:00Z");
  const fa = await sourceFirstSeen(a, ["testsrc", "nosuch"]);
  assert.equal(fa.get("testsrc"), "2026-11-01T00:00:00Z");
  assert.equal(isSeedRow({ source_key: "testsrc", first_seen: "2026-11-20T00:00:00Z" }, fa), false);
  assert.equal(isSeedRow({ source_key: "nosuch", first_seen: undefined }, fa), false, "no rows: never a seed");
  // Another NEWS binding with the same key and another first_seen gets its own answer.
  const fb = await sourceFirstSeen(b, ["testsrc"]);
  assert.equal(isSeedRow({ source_key: "testsrc", first_seen: "2026-11-20T00:00:00Z" }, fb), true);
  // Cached: a second call for a known key sends nothing.
  const before = sql.length;
  await sourceFirstSeen(a, ["testsrc"]);
  assert.equal(sql.length, before);
  // And the ingests only SELECT from news-monitor-db.
  const env = newEnv();
  const all = spy(env.NEWS);
  nm(env, { source_key: "anduril", published: ago(18), first_seen: SEEN });
  nm(env, { source_key: "fpds_pl", published: ago(30), first_seen: SEEN });
  await ingest(env);
  await ingestAux(env);
  assert.ok(all.length > 0 && sql.length > 0);
  for (const s of [...sql, ...all]) assert.match(s, /^\s*SELECT\b/i, s);
});

test("grader print: the claim header shows admit and record; GATE lines only for record_late over 21 days and seed_window", async () => {
  const env = newEnv();
  nm(env, { source_key: "fpds_pl", title: "Earlier FPDS poll", first_seen: EARLIER });
  nm(env, { source_key: "fpds_pl", title: "Planet Labs PBC late notice", published: "2026-09-15T00:00:00Z", first_seen: SEEN });
  nm(env, { source_key: "redcat", title: "Testco own release", published: ago(1), first_seen: SEEN });
  nm(env, { source_key: "anduril", title: "Anduril seed window post", published: ago(18), first_seen: SEEN });
  nm(env, { source_key: "anduril", title: "Anduril seed fresh post", published: ago(2), first_seen: SEEN });
  await ingest(env);
  await ingestAux(env);
  await releaseHeld(env);
  const server = await serveWorker(worker, env);
  const cwd = mkdtempSync(join(tmpdir(), "zenith-gate-print-"));
  try {
    const c = await runGrader(["claim", "20"], { api: server.url, token: TOKENS.GRADER_TOKEN, cwd });
    assert.equal(c.code, 0, c.stderr);
    assert.match(c.stdout, /source=fpds_pl [^\n]* seen_after_days=69\.4 admit=record_late record=yes\nGATE: official record first seen late; zenith-core found no archive burst for it \(core\.md section 8, Freshness\)\nCOUNTERPARTY:/);
    assert.match(c.stdout, /source=redcat [^\n]* admit=- record=no\nTITLE: Testco own release/);
    assert.equal((c.stdout.match(/\nGATE: /g) || []).length, 1, "the seed_fresh FPDS row gets no GATE line");
    const a = await runGrader(["aux-claim", "20"], { api: server.url, token: TOKENS.GRADER_TOKEN, cwd });
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stdout, /admit=seed_window record=no\nGATE: first poll of a new source, first seen within 21 days of its date\nTITLE: Anduril seed window post/);
    assert.match(a.stdout, /admit=seed_fresh record=no\nTITLE: Anduril seed fresh post/);
  } finally {
    await server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
