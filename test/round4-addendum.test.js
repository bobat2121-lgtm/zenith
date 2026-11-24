// Round 4 addendum (plans/round4-addendum.md) and the round 4 verification
// follow-ups: the owner's label decides For You placement (Z13), Tuning rows
// say whether the server would refuse them (F1: mutable, gradeable), and rival
// twins are on exactly one page (F2: an aux copy graded 'covered' shows when
// its coverage copy was gate-dropped; F3: an aux copy whose coverage copy is
// shown is hidden). Over an in-memory zenith-db with the real migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { bandFor, ownerPick } = await import("../worker/src/lib.js");
const { prefLock } = await import("../worker/src/tuning.js");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = () => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS });

let rowid = 0;
let run = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: `Red Cat news ${rowid}`, published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", skip_reason: null, role: null, affects: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state,
      skip_reason, attempts, role, affects) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, 0, ?, ?)`)
    .run(it.nm_rowid ?? rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.skip_reason, it.role, it.affects);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: env.DB.rows("SELECT ticker FROM items WHERE id = ?", itemId)[0].ticker, score: 80, ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : bandFor(g.score));
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, confidence, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, 'why', '["reason:material"]', 0.8, 1, ?)`).run(itemId, g.ticker, `run-${++run}`, g.score, band, iso());
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", url: `https://news.example.com/a/${++rowid}`,
    title: `Auxiliary item ${rowid}`, nm_first_seen: iso(HOUR), state: "pending", skip_reason: null, coverage_subject: 0, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen,
      ingested_at, state, skip_reason, attempts, coverage_subject) VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .run(it.nm_rowid ?? rowid, it.source_key, it.entity_key, it.entity_name, it.url, it.title, iso(2 * HOUR), it.nm_first_seen, iso(), it.state, it.skip_reason,
      it.coverage_subject);
  return Number(r.lastInsertRowid);
}
function addAuxGrade(env, itemId, over = {}) {
  const g = { score: 80, ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : bandFor(g.score));
  const r = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, why, reads_through, flags, confidence, read_source, graded_at)
    VALUES (?, ?, 'Anduril', ?, ?, ?, 'why', '[]', '["reason:material"]', 0.8, 1, ?)`)
    .run(itemId, `run-${++run}`, band === "covered" ? "DPRO" : null, g.score, band, iso());
  env.DB.db.prepare("UPDATE aux_items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
}
const get = async (env, path) => request(worker, env, "GET", path, { role: "app" });
const post = async (env, path, body) => request(worker, env, "POST", path, { role: "app", body });
const ids = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.items.map((i) => i.item_id); };
const byId = (r, id) => r.body.items.find((i) => i.item_id === id);

// The two pipelines, so each Z13 case runs on both feeds.
const FEEDS = {
  coverage: {
    feed: "/v1/feed",
    add: (env, over = {}) => addItem(env, over), grade: (env, id, over) => addGrade(env, id, over),
    label: (env, id, label, ticker = "RCAT") => post(env, "/v1/feedback", { item_id: id, label, ticker }),
    other: { source_key: "skydio", ticker: "AXON", role: "relationship" },
  },
  aux: {
    feed: "/v1/aux/feed",
    add: (env, over = {}) => addAux(env, over), grade: (env, id, over) => addAuxGrade(env, id, over),
    label: (env, id, label) => post(env, "/v1/aux/feedback", { item_id: id, label }),
    other: { source_key: "skydio", entity_key: "skydio", entity_name: "Skydio (private)" },
  },
};

for (const [kind, F] of Object.entries(FEEDS)) {
  test(`Z13 ${kind}: owner High is in For You whatever the score or state, Noise is out; the latest label counts; Latest and To label unchanged`, async () => {
    const env = newEnv();
    const s40 = F.add(env, { nm_first_seen: iso(5 * HOUR) }); F.grade(env, s40, { score: 40 });
    const s85 = F.add(env, { nm_first_seen: iso(4 * HOUR) }); F.grade(env, s85, { score: 85 });
    const s95 = F.add(env, { nm_first_seen: iso(3 * HOUR) }); F.grade(env, s95, { score: 95 });
    const pend = F.add(env, { nm_first_seen: iso(2 * HOUR) });
    const claimed = F.add(env, { nm_first_seen: iso(HOUR), state: "claimed" });
    const old = F.add(env, { nm_first_seen: iso(10 * DAY) }); F.grade(env, old, { score: 30 });
    const latestBefore = ids(await get(env, `${F.feed}?order=newest`));
    assert.deepEqual(ids(await get(env, `${F.feed}?min_score=70`)), [s95, s85], "before: the Lead pinned, then newest");

    for (const id of [s40, pend, claimed, old]) assert.equal((await F.label(env, id, "high")).status, 200, `High on ${id}`);
    assert.equal((await F.label(env, s95, "noise")).status, 200);
    const fy = await get(env, `${F.feed}?min_score=70`);
    // Recent owner-High cards rank as max(score, 90) (ungraded as 90), so they pin with the Leads; the old one sorts by age.
    // (Unpinned cards are newest stored first: the old one was stored last.)
    assert.deepEqual(ids(fy), [claimed, pend, s40, old, s85], "High in (pending and claimed too), Noise on a 95 out");
    assert.deepEqual([claimed, pend, s40, s85, old].map((id) => [byId(fy, id).pinned, byId(fy, id).owner_pick]),
      [[1, 1], [1, 1], [1, 1], [0, 0], [0, 1]]);
    assert.deepEqual(ids(await get(env, `${F.feed}?min_score=90`)), [claimed, pend, s40, old], "whatever the Signal floor");
    // A later label replaces an earlier one: High then Medium takes the pin away.
    assert.equal((await F.label(env, s40, "medium")).status, 200);
    assert.equal((await F.label(env, s95, "high")).status, 200);
    const after = await get(env, `${F.feed}?min_score=70`);
    assert.deepEqual(ids(after), [claimed, pend, s95, old, s85], "the 40 leaves; the 95 is back, pinned (newest pin first)");
    assert.deepEqual([byId(after, s95).owner_pick, byId(after, s95).label], [0, "high"], "scored over the floor: not only the owner's pick");
    // Latest is unchanged by labels; To label still shows only unlabeled cards.
    const latest = await get(env, `${F.feed}?order=newest`);
    assert.deepEqual(ids(latest), latestBefore);
    assert.ok(latest.body.items.every((i) => i.pinned === 0 && i.owner_pick === 0));
    assert.deepEqual(ids(await get(env, `${F.feed}?sort=to_label`)), [s85]);
  });

  test(`Z13 ${kind}: the usual hides win over the owner's High`, async () => {
    const env = newEnv();
    const muted = F.add(env, F.other); F.grade(env, muted, { score: 40 });
    const dup = F.add(env); F.grade(env, dup, { score: null });
    const skipped = F.add(env, { state: "skipped", skip_reason: "stale_on_arrival" });
    const labels = [F.label(env, muted, "high", "AXON"), F.label(env, dup, "high"), F.label(env, skipped, "high")];
    if (kind === "coverage") {
      const out = F.add(env, { ticker: "SSTI", source_key: "ssti" }); F.grade(env, out, { score: 40 });
      labels.push(F.label(env, out, "high", "SSTI"));
    } else {
      const cov = F.add(env); F.grade(env, cov, { score: null, band: "covered" });
      labels.push(F.label(env, cov, "high"));
    }
    for (const r of await Promise.all(labels)) assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await post(env, "/v1/source-prefs", { source_key: "skydio", action: "mute" })).status, 200);
    assert.deepEqual(ids(await get(env, `${F.feed}?min_score=70`)), []);
  });

  test(`Z13 ${kind}: a demoted owner-High card still ranks 90; paging keeps every card once`, async () => {
    const env = newEnv();
    const dem = F.add(env, { ...F.other, nm_first_seen: iso(2 * HOUR) }); F.grade(env, dem, { score: 80 });
    const plain = F.add(env, { nm_first_seen: iso(HOUR) }); F.grade(env, plain, { score: 75 });
    const s50 = F.add(env, { nm_first_seen: iso(3 * HOUR) }); F.grade(env, s50, { score: 50 });
    assert.equal((await post(env, "/v1/source-prefs", { source_key: "skydio", action: "demote" })).status, 200);
    assert.deepEqual(ids(await get(env, `${F.feed}?min_score=70`)), [plain], "80 - 15 is under the floor");
    await F.label(env, dem, "high", "AXON");
    await F.label(env, s50, "high");
    const fy = await get(env, `${F.feed}?min_score=70`);
    assert.deepEqual(ids(fy), [s50, dem, plain]);
    assert.deepEqual([byId(fy, dem).owner_pick, byId(fy, dem).pinned], [1, 1]);
    const p1 = await get(env, `${F.feed}?min_score=70&limit=1`);
    const p2 = await get(env, `${F.feed}?min_score=70&limit=1&before_id=${p1.body.next_before_id}`);
    const p3 = await get(env, `${F.feed}?min_score=70&limit=1&before_id=${p2.body.next_before_id}`);
    assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], [s50, dem, plain]);
  });
}

test("Z13 ownerPick: only a High shown under the floor, or with no score", () => {
  assert.equal(ownerPick({ label: "high", score: null }, 70, 15), 1);
  assert.equal(ownerPick({ label: "high", score: 69 }, 70, 15), 1);
  assert.equal(ownerPick({ label: "high", score: 70 }, 70, 15), 0);
  assert.equal(ownerPick({ label: "high", score: 80, demoted: 1 }, 70, 15), 1);
  assert.equal(ownerPick({ label: "medium", score: 10 }, 70, 15), 0);
  assert.equal(ownerPick({ label: "high", score: 10 }, null, 15), 0, "no Signal floor: not For You");
});

test("Z13 coverage: a pending card labelled High is in For You under its ticker filter", async () => {
  const env = newEnv();
  const pend = addItem(env);
  assert.equal((await post(env, "/v1/feedback", { item_id: pend, label: "high", ticker: "RCAT" })).status, 200);
  assert.deepEqual(ids(await get(env, "/v1/feed?min_score=70&ticker=RCAT")), [pend]);
  assert.deepEqual(ids(await get(env, "/v1/feed?min_score=70&ticker=AXON")), []);
});

// --- F1 ------------------------------------------------------------------------
test("F1 source yield rows say whether the source may be muted or demoted", async () => {
  const env = newEnv();
  addGrade(env, addItem(env), { score: 10 });
  addGrade(env, addItem(env, { source_key: "edgar_rcat" }), { score: 10 });
  addGrade(env, addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival" }), { score: 10 });
  addAuxGrade(env, addAux(env, { source_key: "einride_sec", entity_key: "einride", entity_name: "Einride" }));
  addAuxGrade(env, addAux(env));
  const r = (await get(env, "/v1/source-yield?days=30")).body;
  const rows = Object.fromEntries([...r.coverage, ...r.aux].map((x) => [x.source_key, [x.mutable, x.lock]]));
  assert.deepEqual(rows, { redcat: [false, "own_channel"], edgar_rcat: [false, "sec"], tfvector: [true, null], einride_sec: [false, "sec"], anduril: [true, null] });
  // mutable agrees with what POST /v1/source-prefs does.
  for (const [key, [mutable]] of Object.entries(rows)) {
    assert.equal((await post(env, "/v1/source-prefs", { source_key: key, action: "demote" })).status, mutable ? 200 : 400, key);
  }
  assert.equal(prefLock("no_such_source"), "unknown");
  assert.equal(prefLock("bad key!"), "bad_key");
});

test("F1 left-out items say whether Grade it would be refused, and why", async () => {
  const env = newEnv();
  const vector = { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector" };
  const muted = addAux(env, { source_key: "skydio", entity_key: "skydio", entity_name: "Skydio", state: "skipped", skip_reason: "muted_source" });
  const rival = addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "rival_no_key_account" });
  addAux(env, { ...vector, nm_rowid: rowid, coverage_subject: 1 });
  const rivalCov = addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "rival_no_key_account" });
  addAuxGrade(env, addAux(env, { ...vector, nm_rowid: rowid }), { score: null, band: "covered" });
  const stale = addItem(env, { state: "skipped", skip_reason: "stale_on_arrival" });
  const parked = addAux(env, { state: "skipped", skip_reason: "on_coverage" });
  addItem(env, { nm_rowid: rowid, source_key: "tfvector", ticker: "DPRO", role: "rival" });
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "skydio", action: "mute" })).status, 200);

  const flags = async (kind) => Object.fromEntries((await get(env, `/v1/left-out?kind=${kind}`)).body.items.map((i) => [i.id, [i.gradeable, i.blocked]]));
  const cov = await flags("coverage");
  assert.deepEqual(cov[stale], [true, null]);
  assert.deepEqual(cov[rivalCov], [true, null], "an aux copy graded covered does not block: Grade it moves the item to Coverage");
  assert.equal(cov[rival][0], false);
  assert.match(cov[rival][1], /already on the Auxiliary page \(aux item \d+, pending\)/);
  const aux = await flags("aux");
  assert.equal(aux[muted][0], false);
  assert.match(aux[muted][1], /skydio is still muted/);
  assert.equal(aux[parked][0], false);
  assert.match(aux[parked][1], /already on the Coverage page \(coverage item \d+, pending\)/);
  // gradeable agrees with POST /v1/left-out/grade.
  for (const [kind, map] of [["coverage", cov], ["aux", aux]]) {
    for (const [id, [gradeable]] of Object.entries(map)) {
      assert.equal((await post(env, "/v1/left-out/grade", { kind, id: Number(id) })).status, gradeable ? 200 : 400, `${kind} ${id}`);
    }
  }
  await post(env, "/v1/source-prefs", { source_key: "skydio", action: "normal" });
  assert.deepEqual((await flags("aux"))[muted], [true, null], "unmuted: gradeable");
});

// --- F2 and F3 ------------------------------------------------------------------
test("F2 an aux copy graded covered shows when its coverage copy was dropped by the key-account gate", async () => {
  const env = newEnv();
  const rival = { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector", coverage_subject: 1 };
  const cov = addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "rival_no_key_account" });
  const dropped = addAux(env, { ...rival, nm_rowid: rowid }); addAuxGrade(env, dropped, { score: null, band: "covered" });
  addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "stale_on_arrival" });
  const stale = addAux(env, { ...rival, nm_rowid: rowid }); addAuxGrade(env, stale, { score: null, band: "covered" });
  const alone = addAux(env); addAuxGrade(env, alone, { score: null, band: "covered" });
  const plain = addAux(env); addAuxGrade(env, plain, { score: 75 });
  const latest = await get(env, "/v1/aux/feed?order=newest");
  assert.deepEqual(ids(latest), [plain, dropped], "it would be on neither page otherwise; other covered copies stay hidden");
  const card = byId(latest, dropped);
  assert.deepEqual([card.band, card.score, card.covered_ticker, card.entity], ["covered", null, "DPRO", "Anduril"]);
  // A normal aux card: no score, so not in For You until the owner says High.
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?min_score=70")), [plain]);
  assert.equal((await post(env, "/v1/aux/feedback", { item_id: dropped, label: "high" })).status, 200);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?min_score=70")), [dropped, plain]);
  // Grade it on the coverage copy moves the item to Coverage: the aux copy hides again.
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: cov })).status, 200);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?order=newest")), [plain]);
  assert.ok(ids(await get(env, "/v1/feed?order=newest")).includes(cov));
});

test("F3 an aux copy whose rival coverage copy is shown is hidden from the aux feed", async () => {
  const env = newEnv();
  const vector = { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector" };
  // Stored before Z11: the gate kept the row on Coverage, and both copies were graded.
  const covGraded = addItem(env, { source_key: "tfvector", ticker: "RCAT", role: "rival" }); addGrade(env, covGraded, { score: 75 });
  const twinGraded = addAux(env, { ...vector, nm_rowid: rowid }); addAuxGrade(env, twinGraded, { score: 85 });
  addItem(env, { source_key: "tfvector", ticker: "RCAT", role: "rival" });
  const twinPending = addAux(env, { ...vector, nm_rowid: rowid });
  // A coverage copy that is skipped does not hide its aux copy.
  addItem(env, { source_key: "tfvector", ticker: "RCAT", role: "rival", state: "skipped", skip_reason: "stale_on_arrival" });
  const kept = addAux(env, { ...vector, nm_rowid: rowid }); addAuxGrade(env, kept, { score: 85 });
  // A partner (not a rival) is on both pages by design.
  addItem(env, { source_key: "skydio", ticker: "AXON", role: "relationship" });
  const partner = addAux(env, { source_key: "skydio", entity_key: "skydio", entity_name: "Skydio", nm_rowid: rowid }); addAuxGrade(env, partner, { score: 85 });
  for (const q of ["?order=newest", "?min_score=70", "?sort=to_label"]) assert.deepEqual(ids(await get(env, `/v1/aux/feed${q}`)), [partner, kept], q);
  // Even the owner's High does not put it on both pages.
  assert.equal((await post(env, "/v1/aux/feedback", { item_id: twinGraded, label: "high" })).status, 200);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?min_score=70")), [partner, kept]);
  assert.ok(ids(await get(env, "/v1/aux/feed?order=newest&include_covered=1")).includes(twinPending), "include_covered=1 shows it");
  assert.ok(ids(await get(env, "/v1/feed?order=newest")).includes(covGraded), "the coverage copy stays");
});

// The headline pass and the backlog count follow the aux feed's F2/F3 rules
// (lib.js auxBandShownSql), as do the Names filter counts (auxStats).
test("F2/F3 the headline pass, headlines_waiting and the Names filter count exactly the aux cards the feed shows", async () => {
  const env = newEnv();
  const rival = { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector" };
  // F2: gate-dropped coverage copy; its aux copy is graded covered and shown.
  addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "rival_no_key_account" });
  const f2 = addAux(env, { ...rival, nm_rowid: rowid, coverage_subject: 1 }); addAuxGrade(env, f2, { score: null, band: "covered" });
  addItem(env, { source_key: "tfvector", ticker: "DPRO", role: "rival", state: "skipped", skip_reason: "rival_no_key_account" });
  const f2b = addAux(env, { ...rival, nm_rowid: rowid }); addAuxGrade(env, f2b, { score: 72 });
  // F3: the coverage copy is shown (pending); its graded aux copy is hidden.
  addItem(env, { source_key: "tfvector", ticker: "RCAT", role: "rival" });
  const f3 = addAux(env, { ...rival, nm_rowid: rowid }); addAuxGrade(env, f3, { score: 85 });
  addItem(env, { source_key: "tfvector", ticker: "RCAT", role: "rival" });
  const f3b = addAux(env, { ...rival, nm_rowid: rowid }); addAuxGrade(env, f3b, { score: 60 });
  // A covered aux card with no twin stays hidden.
  const alone = addAux(env); addAuxGrade(env, alone, { score: null, band: "covered" });
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?order=newest")), [f2b, f2]);
  const ops = await get(env, "/v1/ops");
  assert.equal(ops.status, 200);
  assert.equal(ops.body.grader.backlog.headlines_waiting, 2);
  const claim = await request(worker, env, "POST", "/v1/headlines/claim", { role: "grader", body: {} });
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body.items.map((i) => `${i.kind}:${i.item_id}`), [`aux:${f2b}`, `aux:${f2}`]);
  assert.equal(claim.body.remaining, 0);
  // GET /v1/stats: the F2 card's name is in the Names filter; the hidden F3 copy is not counted.
  const stats = await get(env, "/v1/stats");
  assert.deepEqual(stats.body.aux.entities, [{ name: "Anduril", n: 2 }]);
});
