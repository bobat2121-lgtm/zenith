// Headlines through the API (migration 0010): stored on the item from coverage
// and auxiliary grades, shown on both feeds, and the headline-only pass
// (POST /v1/headlines/claim, POST /v1/headlines), whose lease never touches
// grading state and whose submit never touches a grade.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { LEASE_MINUTES } = await import("../worker/src/lib.js");

const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });
const rows = (env, sql, ...args) => env.DB.rows(sql, ...args).map((r) => ({ ...r }));
const call = (env, method, path, body, role = "grader") => request(worker, env, method, path, { role, body });
const H = {
  nav: "RoboStrategy Portfolio NAV hits $289 million. Up 4.1% in October.",
  order: "Red Cat wins a $12 million Army order for Black Widow systems.",
  cross: "Unusual Machines supplies motors for Red Cat's Army Black Widow order.",
  filing: "Agility Robotics amends its 8-K to add audited financial statements.",
};

let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: "Red Cat news", published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", excerpt: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, excerpt, excerpt_status)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?)`).run(rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state,
    it.excerpt, it.excerpt ? "ok" : null);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: "RCAT", score: 80, band: "digest", why: "why", ...over };
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, 'run-old', 'r-old', 'm', ?, ?, ?, '["reason:material"]', 1, ?)`).run(itemId, g.ticker, g.score, g.band, g.why, iso());
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", status: "private", title: "Anduril news",
    nm_first_seen: iso(HOUR), state: "pending", excerpt: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, excerpt, excerpt_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(++rowid, it.source_key, it.entity_key, it.entity_name, it.status, `https://news.example.com/a/${rowid}`, it.title,
    it.nm_first_seen, it.nm_first_seen, iso(), it.state, it.excerpt, it.excerpt ? "feed" : null);
  return Number(r.lastInsertRowid);
}
function addAuxGrade(env, itemId, over = {}) {
  const g = { entity: "Anduril", score: 75, band: "digest", why: "aux why", ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, read_source, graded_at)
    VALUES (?, 'aux-old', ?, ?, ?, ?, '[]', '["reason:material"]', 1, ?)`).run(itemId, g.entity, g.score, g.band, g.why, iso());
  env.DB.db.prepare("UPDATE aux_items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
}
const covGrade = (item_id, over) => ({ item_id, score: 80, why: "Army order.", read_source: true, confidence: 0.8, flags: ["reason:material"], ...over });
const auxGrade = (item_id, over) => ({ item_id, entity: "Anduril", score: 75, band: "digest", event_type: "contract", why: "Anduril won an order.",
  reads_through: [], flags: ["reason:material"], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, ...over });
const headlineOf = (env, table, id) => rows(env, `SELECT headline, headline_tag, headline_at FROM ${table} WHERE id = ?`, id)[0];

test("coverage grades: a headline is stored on the item; a bad one rejects only that grade; feed fields are null until written", async () => {
  const env = newEnv();
  const a = addItem(env), b = addItem(env), c = addItem(env), d = addItem(env);
  const claim = (await call(env, "POST", "/v1/queue/claim", { limit: 10, run_id: "run-a" })).body;
  assert.equal(claim.items.length, 4);
  assert.ok(claim.items.every((i) => !("headline" in i)), "the grading claim is unchanged");
  const r = await call(env, "POST", "/v1/grades", { claim_id: claim.claim_id, run_id: "run-a", grades: [
    covGrade(a, { headline: `  ${H.order} `, tag: "press release" }),
    covGrade(b, { headline: H.order, tag: "Tweet" }),
    covGrade(c),
    covGrade(d, { score: null, band: "duplicate", flags: ["reason:duplicate", `dup_of:${a}`], headline: H.order, tag: "News" }),
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 3);
  assert.deepEqual(r.body.rejected.map((x) => x.item_id), [b]);
  assert.match(r.body.rejected[0].error, /unknown tag "Tweet": use the SEC form exactly as filed/);
  const ha = headlineOf(env, "items", a);
  assert.deepEqual([ha.headline, ha.headline_tag], [H.order, "Press release"]);
  assert.ok(Date.parse(ha.headline_at) > Date.now() - 60_000);
  assert.deepEqual(headlineOf(env, "items", c), { headline: null, headline_tag: null, headline_at: null });
  assert.deepEqual([headlineOf(env, "items", d).headline_tag], ["News"], "a duplicate may carry a headline");
  assert.deepEqual(rows(env, "SELECT state FROM items WHERE id = ?", b)[0].state, "claimed", "the rejected grade left its item claimed");

  const feed = (await call(env, "GET", "/v1/feed?order=newest&include_duplicates=1", undefined, "app")).body.items;
  const of = Object.fromEntries(feed.map((i) => [i.item_id, i]));
  assert.deepEqual([of[a].headline, of[a].headline_tag], [H.order, "Press release"]);
  assert.deepEqual([of[c].headline, of[c].headline_tag], [null, null]);
  assert.deepEqual([of[b].headline, of[b].headline_tag], [null, null]);
  assert.ok("headline" in of[c] && "headline_tag" in of[c]);
});

test("a #TICKER grade sets the headline only when the item has none; a later own grade replaces it, one without a headline keeps it", async () => {
  const env = newEnv();
  const a = addItem(env), e = addItem(env);
  const claim = (await call(env, "POST", "/v1/queue/claim", { limit: 10, run_id: "run-a" })).body;
  const r = await call(env, "POST", "/v1/grades", { claim_id: claim.claim_id, run_id: "run-a", grades: [
    covGrade(`${a}#UMAC`, { headline: H.cross, tag: "Press release", flags: ["reason:material", "also:UMAC"] }),
    covGrade(a, { headline: H.order, tag: "Press release" }),
    covGrade(e),
    covGrade(`${e}#UMAC`, { headline: H.cross, tag: "Press release", flags: ["reason:material", "also:UMAC"] }),
  ] });
  assert.equal(r.body.accepted, 4, JSON.stringify(r.body.rejected));
  assert.equal(headlineOf(env, "items", a).headline, H.order, "the own-ticker grade wins, in either order");
  assert.equal(headlineOf(env, "items", e).headline, H.cross, "the item had none, so the cross-ticker headline is kept");
  // A cross-ticker grade later never overwrites.
  await call(env, "POST", "/v1/grades", { run_id: "run-b", grades: [covGrade(`${a}#UMAC`, { headline: H.cross, tag: "News", flags: ["reason:material", "also:UMAC"] })] }, "admin");
  assert.equal(headlineOf(env, "items", a).headline, H.order);
  // A regrade without a headline (an old grader) keeps it; one with a headline replaces it.
  await call(env, "POST", "/v1/grades", { run_id: "run-c", grades: [covGrade(a, { score: 70 })] }, "admin");
  assert.deepEqual([headlineOf(env, "items", a).headline, rows(env, "SELECT g.score FROM items i JOIN grades g ON g.id = i.grade_id WHERE i.id = ?", a)[0].score], [H.order, 70]);
  await call(env, "POST", "/v1/grades", { run_id: "run-d", grades: [covGrade(e, { headline: H.order, tag: "8-K" })] }, "admin");
  assert.deepEqual([headlineOf(env, "items", e).headline, headlineOf(env, "items", e).headline_tag], [H.order, "8-K"]);
});

test("auxiliary grades: stored on aux_items; a bad one rejects only that grade; /v1/aux/feed shows both fields", async () => {
  const env = newEnv();
  const x = addAux(env, { nm_first_seen: iso(3 * HOUR) }), y = addAux(env, { nm_first_seen: iso(2 * HOUR) }), z = addAux(env);
  const claim = (await call(env, "POST", "/v1/aux/claim", { limit: 10, run_id: "aux-a" })).body;
  assert.equal(claim.items.length, 3);
  const h = "Anduril wins a $40 million Army counter-drone order.";
  const r = await call(env, "POST", "/v1/aux/grades", { claim_id: claim.claim_id, run_id: "aux-a", grades: [
    auxGrade(x, { headline: h, tag: "Contract notice" }),
    auxGrade(y, { headline: "Too\nshort", tag: "News" }),
    auxGrade(z),
  ] });
  assert.equal(r.body.accepted, 2);
  assert.deepEqual(r.body.rejected.map((e) => e.item_id), [y]);
  assert.match(r.body.rejected[0].error, /one line: no line breaks/);
  assert.deepEqual([headlineOf(env, "aux_items", x).headline, headlineOf(env, "aux_items", x).headline_tag], [h, "Contract notice"]);
  assert.equal(headlineOf(env, "aux_items", z).headline, null);
  const feed = (await call(env, "GET", "/v1/aux/feed?order=newest", undefined, "app")).body.items;
  const of = Object.fromEntries(feed.map((i) => [i.item_id, i]));
  assert.deepEqual([of[x].headline, of[x].headline_tag, of[z].headline, of[z].headline_tag], [h, "Contract notice", null, null]);
  // A later grade without one keeps it.
  await call(env, "POST", "/v1/aux/grades", { run_id: "aux-b", grades: [auxGrade(x, { score: 72 })] }, "admin");
  assert.equal(headlineOf(env, "aux_items", x).headline, h);
});

// The headline pass ------------------------------------------------------------
function backlog(env) {
  const ids = {};
  ids.covNew = addItem(env, { title: "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026", ticker: "BOT", source_key: "bot_press", nm_first_seen: iso(1 * DAY),
    excerpt: "RoboStrategy reported Portfolio NAV of $289 million as of October 31, up 4.1% in October. " + "x".repeat(2000) });
  ids.covOld = addItem(env, { nm_first_seen: iso(10 * DAY) });
  ids.covDone = addItem(env, { nm_first_seen: iso(2 * DAY) });
  ids.covPending = addItem(env, { nm_first_seen: iso(3 * DAY) });
  ids.covAncient = addItem(env, { nm_first_seen: iso(40 * DAY) });
  ids.covDup = addItem(env, { nm_first_seen: iso(5 * DAY) });
  addGrade(env, ids.covNew, { ticker: "BOT", score: 88, band: "digest", why: "NAV update." });
  addGrade(env, ids.covOld, { score: 91, band: "lead" });
  addGrade(env, ids.covDone);
  addGrade(env, ids.covAncient);
  addGrade(env, ids.covDup, { score: null, band: "duplicate" });
  env.DB.db.prepare("UPDATE items SET headline = 'Already has one, written earlier.', headline_tag = 'News' WHERE id = ?").run(ids.covDone);
  ids.auxNew = addAux(env, { nm_first_seen: iso(2 * HOUR), excerpt: "Anduril today announced a $2.5 billion Series G." });
  ids.auxOld = addAux(env, { nm_first_seen: iso(20 * DAY) });
  ids.auxPending = addAux(env, { nm_first_seen: iso(1 * HOUR) });
  addAuxGrade(env, ids.auxNew, { entity: "Anduril", score: 95, band: "lead", why: "Series G." });
  addAuxGrade(env, ids.auxOld, { entity: "Skydio", score: 55, band: "borderline" });
  return ids;
}
const GRADING_COLS = "id, state, claim_id, claimed_until, attempts, grade_id, skip_reason";

test("headline claim: graded items without a headline, coverage first then auxiliary, newest first, on its own lease", async () => {
  const env = newEnv();
  const ids = backlog(env);
  const gradingBefore = { items: rows(env, `SELECT ${GRADING_COLS} FROM items ORDER BY id`), aux: rows(env, `SELECT ${GRADING_COLS} FROM aux_items ORDER BY id`) };
  const c1 = (await call(env, "POST", "/v1/headlines/claim", { limit: 4 })).body;
  assert.equal(c1.lease_minutes, LEASE_MINUTES);
  assert.equal(c1.days, 30);
  assert.deepEqual(c1.items.map((i) => [i.kind, i.item_id]),
    [["coverage", ids.covNew], ["coverage", ids.covDup], ["coverage", ids.covOld], ["aux", ids.auxNew]]);
  const [nav, , , anduril] = c1.items;
  assert.deepEqual(Object.keys(nav).sort(), ["band", "excerpt", "first_seen", "item_id", "kind", "published", "score", "ticker", "title", "url", "why"]);
  assert.deepEqual([nav.ticker, nav.score, nav.band, nav.why, nav.title], ["BOT", 88, "digest", "NAV update.", "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026"]);
  assert.equal(nav.excerpt.length, 1200);
  assert.match(nav.excerpt, /^RoboStrategy reported Portfolio NAV of \$289 million/);
  assert.deepEqual(Object.keys(anduril).sort(), ["band", "entity", "excerpt", "first_seen", "item_id", "kind", "published", "score", "title", "url", "why"]);
  assert.deepEqual([anduril.entity, anduril.score, anduril.band], ["Anduril", 95, "lead"], "the grade's entity name");
  assert.equal(c1.remaining, 1, "the older auxiliary item waits");
  // Grading state is untouched; the lease is on its own columns.
  assert.deepEqual({ items: rows(env, `SELECT ${GRADING_COLS} FROM items ORDER BY id`), aux: rows(env, `SELECT ${GRADING_COLS} FROM aux_items ORDER BY id`) }, gradingBefore);
  const leased = rows(env, "SELECT id, headline_claim_id, headline_claimed_until FROM items WHERE headline_claim_id IS NOT NULL ORDER BY id");
  assert.deepEqual(leased.map((r) => r.id).sort((p, q) => p - q), [ids.covNew, ids.covOld, ids.covDup].sort((p, q) => p - q));
  const until = Date.parse(leased[0].headline_claimed_until);
  assert.ok(Math.abs(until - (Date.now() + LEASE_MINUTES * 60_000)) < 60_000);

  // A second claim takes only what is left; a third finds nothing.
  const c2 = (await call(env, "POST", "/v1/headlines/claim", {})).body;
  assert.deepEqual(c2.items.map((i) => [i.kind, i.item_id]), [["aux", ids.auxOld]]);
  assert.equal(c2.remaining, 0);
  assert.deepEqual((await call(env, "POST", "/v1/headlines/claim", {})).body.items, []);
  // days widens the window (to at most 60); an expired lease is claimable again.
  const c4 = (await call(env, "POST", "/v1/headlines/claim", { days: 999 })).body;
  assert.equal(c4.days, 60);
  assert.deepEqual(c4.items.map((i) => i.item_id), [ids.covAncient]);
  env.DB.db.prepare("UPDATE items SET headline_claimed_until = ? WHERE id = ?").run(iso(60_000), ids.covOld);
  const c5 = (await call(env, "POST", "/v1/headlines/claim", { limit: 0 })).body;
  assert.deepEqual(c5.items.map((i) => i.item_id), [ids.covOld]);
  assert.equal(rows(env, "SELECT headline_claim_id FROM items WHERE id = ?", ids.covOld)[0].headline_claim_id, c5.claim_id);
});

test("headline claim limits: 1-60, default 40", async () => {
  const env = newEnv();
  for (let k = 0; k < 65; k++) addGrade(env, addItem(env, { nm_first_seen: iso((k + 1) * HOUR) }));
  assert.equal((await call(env, "POST", "/v1/headlines/claim", { limit: 999 })).body.items.length, 60);
  const env2 = newEnv();
  for (let k = 0; k < 45; k++) addGrade(env2, addItem(env2, { nm_first_seen: iso((k + 1) * HOUR) }));
  const d = (await call(env2, "POST", "/v1/headlines/claim", null)).body;
  assert.deepEqual([d.items.length, d.remaining], [40, 5]);
  assert.equal((await call(env2, "POST", "/v1/headlines/claim", { limit: -3 })).body.items.length, 1, "a negative limit is the minimum");
});

test("headline submit: validated like a grade's, items from the claim only, and never a grade, score or state", async () => {
  const env = newEnv();
  const ids = backlog(env);
  const claim = (await call(env, "POST", "/v1/headlines/claim", { limit: 60 })).body;
  // The leased item is requeued and claimed for grading meanwhile: the headline pass must not disturb it.
  await call(env, "POST", "/v1/admin/requeue", { item_ids: [ids.covOld] }, "admin");
  const gc = (await call(env, "POST", "/v1/queue/claim", { limit: 5, run_id: "run-x" })).body;
  assert.ok(gc.items.some((i) => i.item_id === ids.covOld));
  const snapshot = () => ({
    grades: rows(env, "SELECT * FROM grades ORDER BY id"), auxGrades: rows(env, "SELECT * FROM aux_grades ORDER BY id"),
    items: rows(env, `SELECT ${GRADING_COLS} FROM items ORDER BY id`), aux: rows(env, `SELECT ${GRADING_COLS} FROM aux_items ORDER BY id`),
  });
  const before = snapshot();
  const entries = [
    { kind: "coverage", item_id: ids.covNew, headline: H.nav, tag: "Press release" },
    { kind: "coverage", item_id: String(ids.covOld), headline: H.order, tag: "8-K" },
    { kind: "aux", item_id: ids.auxNew, headline: "Anduril raises $2.5 billion Series G.", tag: "press release" },
    { kind: "aux", item_id: ids.auxOld, headline: "Skydio adds two state police agencies.", tag: "Tweet" },
    { kind: "coverage", item_id: ids.covDup, headline: H.order },
    { kind: "coverage", item_id: ids.covDone, headline: H.order, tag: "News" },
    { kind: "coverage", item_id: ids.covPending, headline: H.order, tag: "News" },
    { kind: "news", item_id: ids.covNew, headline: H.order, tag: "News" },
    { kind: "coverage", item_id: `${ids.covNew}#UMAC`, headline: H.order, tag: "News" },
    { kind: "coverage", item_id: 999999, headline: H.order, tag: "News" },
    { kind: "coverage", item_id: ids.covNew, headline: H.order, tag: "News" },
    "not an object",
  ];
  const r = await call(env, "POST", "/v1/headlines", { claim_id: claim.claim_id, headlines: entries });
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 3);
  assert.deepEqual(r.body.results.map((x) => [x.kind, x.item_id]), [["coverage", ids.covNew], ["coverage", ids.covOld], ["aux", ids.auxNew]]);
  const why = r.body.rejected.map((x) => `${x.kind}:${x.item_id} ${x.error}`);
  assert.equal(why.length, 9);
  assert.match(why[0], new RegExp(`^aux:${ids.auxOld} unknown tag "Tweet"`));
  assert.match(why[1], new RegExp(`^coverage:${ids.covDup} headline needs a tag`));
  assert.match(why[2], new RegExp(`^coverage:${ids.covDone} coverage item ${ids.covDone} is not in headline claim ${claim.claim_id}`));
  assert.match(why[3], new RegExp(`^coverage:${ids.covPending} coverage item ${ids.covPending} is not in headline claim`));
  assert.match(why[4], /^news:\d+ kind must be "coverage" or "aux"/);
  assert.match(why[5], /item_id must be the integer item_id the claim printed/);
  assert.match(why[6], /unknown coverage item 999999/);
  assert.match(why[7], new RegExp(`coverage item ${ids.covNew} is listed twice`));
  assert.match(why[8], /^null:null each entry must be an object/);
  assert.deepEqual(snapshot(), before, "grades, scores and grading state are exactly as before");
  assert.deepEqual([headlineOf(env, "items", ids.covNew).headline, headlineOf(env, "items", ids.covNew).headline_tag], [H.nav, "Press release"]);
  assert.equal(headlineOf(env, "items", ids.covOld).headline_tag, "8-K");
  assert.equal(headlineOf(env, "aux_items", ids.auxNew).headline_tag, "Press release");
  assert.equal(headlineOf(env, "items", ids.covDone).headline, "Already has one, written earlier.");
  assert.equal(rows(env, "SELECT headline_claimed_until FROM items WHERE id = ?", ids.covNew)[0].headline_claimed_until, null);
  // A resubmitted file is accepted again and writes the same values.
  const again = await call(env, "POST", "/v1/headlines", { claim_id: claim.claim_id, headlines: entries.slice(0, 3) });
  assert.deepEqual([again.body.accepted, again.body.rejected], [3, []]);
  // Written items leave the backlog.
  const next = (await call(env, "POST", "/v1/headlines/claim", {})).body;
  assert.ok(!next.items.some((i) => [ids.covNew, ids.covOld].includes(i.item_id)));
});

test("headline routes: grader and admin only; claim_id required for the grader; body checks", async () => {
  const env = newEnv();
  const ids = backlog(env);
  assert.equal((await call(env, "POST", "/v1/headlines/claim", {}, "app")).status, 403);
  assert.equal((await call(env, "POST", "/v1/headlines", { claim_id: "x", headlines: [] }, "app")).status, 403);
  assert.equal((await call(env, "POST", "/v1/headlines", { headlines: [] })).status, 400);
  assert.match((await call(env, "POST", "/v1/headlines", { claim_id: "x" })).body.error, /body.headlines must be an array/);
  assert.match((await call(env, "POST", "/v1/headlines", { claim_id: "x", headlines: Array(121).fill({}) })).body.error, /too many/);
  assert.equal((await call(env, "POST", "/v1/headlines/claim", {}, "admin")).status, 200);
  // Admin may write a headline without a claim.
  const r = await call(env, "POST", "/v1/headlines", { headlines: [{ kind: "coverage", item_id: ids.covDone, headline: H.filing, tag: "8-K/A" }] }, "admin");
  assert.deepEqual([r.body.accepted, headlineOf(env, "items", ids.covDone).headline_tag], [1, "8-K/A"]);
});

test("a grade that writes a headline while the item is in a headline claim wins: the backfill is then rejected, never an overwrite", async () => {
  const env = newEnv();
  const ids = backlog(env);
  const extra = addItem(env, { nm_first_seen: iso(4 * DAY) });
  addGrade(env, extra);
  const claim = (await call(env, "POST", "/v1/headlines/claim", { limit: 60 })).body;
  const leased = new Set(claim.items.map((i) => `${i.kind}|${i.item_id}`));
  for (const k of [`coverage|${ids.covOld}`, `coverage|${ids.covNew}`, `coverage|${extra}`, `aux|${ids.auxNew}`]) assert.ok(leased.has(k), k);
  // Regrades with a headline (own-ticker, cross-ticker on an item with none, auxiliary); one without a headline keeps the lease.
  const fresh = "Fresh grade headline from the regrade";
  let r = await call(env, "POST", "/v1/grades", { run_id: "run-r", grades: [
    covGrade(ids.covOld, { headline: fresh, tag: "News" }),
    covGrade(`${extra}#UMAC`, { headline: H.cross, tag: "Press release", flags: ["reason:material", "also:UMAC"] }),
    covGrade(ids.covNew, { score: 70 }),
  ] }, "admin");
  assert.equal(r.body.accepted, 3, JSON.stringify(r.body.rejected));
  r = await call(env, "POST", "/v1/aux/grades", { run_id: "aux-r", grades: [auxGrade(ids.auxNew, { headline: "Anduril regrade headline, fresh.", tag: "News" })] }, "admin");
  assert.equal(r.body.accepted, 1, JSON.stringify(r.body.rejected));
  const lease = (table, id) => rows(env, `SELECT headline_claim_id, headline_claimed_until FROM ${table} WHERE id = ?`, id)[0];
  for (const [t, id] of [["items", ids.covOld], ["items", extra], ["aux_items", ids.auxNew]]) {
    assert.deepEqual(lease(t, id), { headline_claim_id: null, headline_claimed_until: null }, `${t} ${id}: a grade's headline ends the headline lease`);
  }
  assert.equal(lease("items", ids.covNew).headline_claim_id, claim.claim_id, "a grade without a headline leaves the lease");

  const res = await call(env, "POST", "/v1/headlines", { claim_id: claim.claim_id, headlines: [
    { kind: "coverage", item_id: ids.covOld, headline: "Backfill headline overwrite", tag: "News" },
    { kind: "coverage", item_id: extra, headline: "Backfill headline overwrite", tag: "News" },
    { kind: "aux", item_id: ids.auxNew, headline: "Backfill headline overwrite", tag: "News" },
    { kind: "coverage", item_id: ids.covNew, headline: H.nav, tag: "Press release" },
  ] });
  assert.equal(res.body.accepted, 1);
  assert.deepEqual(res.body.rejected.map((x) => [x.kind, x.item_id]), [["coverage", ids.covOld], ["coverage", extra], ["aux", ids.auxNew]]);
  for (const x of res.body.rejected) assert.match(x.error, /is not in headline claim/);
  assert.equal(headlineOf(env, "items", ids.covOld).headline, fresh);
  assert.equal(headlineOf(env, "items", extra).headline, H.cross);
  assert.equal(headlineOf(env, "aux_items", ids.auxNew).headline, "Anduril regrade headline, fresh.");
  assert.equal(headlineOf(env, "items", ids.covNew).headline, H.nav);
});

test("a grade landing between the headline submit's check and its write is not overwritten, and the entry is reported rejected", async () => {
  const env = newEnv();
  const ids = backlog(env);
  const claim = (await call(env, "POST", "/v1/headlines/claim", { limit: 60 })).body;
  const batch = env.DB.batch.bind(env.DB);
  let raced = false;
  env.DB.batch = async (stmts) => {
    if (!raced && stmts.some((s) => /SET headline = \?/.test(s.sql))) {
      raced = true;
      // What a regrade with a headline commits in between.
      env.DB.db.prepare("UPDATE items SET headline = 'Fresh grade headline from the regrade', headline_tag = 'News', headline_claim_id = NULL, headline_claimed_until = NULL WHERE id = ?").run(ids.covOld);
    }
    return batch(stmts);
  };
  const res = await call(env, "POST", "/v1/headlines", { claim_id: claim.claim_id, headlines: [
    { kind: "coverage", item_id: ids.covOld, headline: "Backfill headline overwrite", tag: "News" },
    { kind: "coverage", item_id: ids.covNew, headline: H.nav, tag: "Press release" },
  ] });
  assert.ok(raced);
  assert.equal(res.body.accepted, 1);
  assert.deepEqual(res.body.results.map((x) => x.item_id), [ids.covNew]);
  assert.deepEqual(res.body.rejected.map((x) => [x.kind, x.item_id]), [["coverage", ids.covOld]]);
  assert.match(res.body.rejected[0].error, /left headline claim .* before this write \(a grade wrote its headline\); nothing was changed/);
  assert.equal(headlineOf(env, "items", ids.covOld).headline, "Fresh grade headline from the regrade");
  assert.equal(headlineOf(env, "items", ids.covNew).headline, H.nav);
});
