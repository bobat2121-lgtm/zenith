// Auxiliary ingest (auxiliary.js ingestAux): rows whose source routes to an
// auxiliary name are copied into aux_items by their own cursor, with the
// coverage ingest's windowing, skip reasons and archive parking; feed text that
// is the release becomes the excerpt and no page is ever fetched. The coverage
// tables and cursor never move because of it. Coverage-subject sources (filters
// built for a covered company) are stored with coverage_subject and affects, and
// a one-time catch-up (aux_cs_cursor) stores their rows the cursor had passed.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { ingestAux, AUX_BACKFILL_DAYS, AUX_CS_DONE } = await import("../worker/src/auxiliary.js");
const { ingest } = await import("../worker/src/ingest.js");
const { default: worker } = await import("../worker/src/index.js");

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let n = 0;
function ins(news, row) {
  const seen = row.first_seen ?? iso();
  news.db.prepare(`INSERT INTO items (source_key, url, title, published, category, first_seen, notified${row.body !== undefined ? ", body" : ""})
    VALUES (?, ?, ?, ?, NULL, ?, 1${row.body !== undefined ? ", ?" : ""})`)
    .run(...[row.source_key, row.url ?? `https://news.example.com/${row.source_key}/${++n}`, row.title ?? `Item ${n}`,
      row.published === undefined ? seen : row.published, seen, ...(row.body !== undefined ? [row.body] : [])]);
}
// Enrich (run by the cron) fetches coverage pages: never reach the network.
async function offline(run) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("offline", { status: 404 });
  try { return await run(); } finally { globalThis.fetch = real; }
}
const meta = (db, key) => db.rows("SELECT value FROM meta WHERE key = ?", key)[0]?.value ?? null;
const atStart = (db, key = "aux_nm_cursor") => db.db.prepare("INSERT INTO meta (key, value) VALUES (?, '0')").run(key);

test("routes auxiliary sources only: covered, ops and covered-duplicate rows are not stored; coverage subjects are, marked", async () => {
  const news = newsDb();
  const db = zenithDb();
  atStart(db);
  atStart(db, "nm_cursor");
  for (const source_key of ["anduril", "nga", "redcat", "aglt_rel", "site_kodiak", "probe_x", "edgar_latest", "managed_draganfly_news",
    "ia_media_dronelife", "edgar_ssti", "skydio", "maymobility_news"]) ins(news, { source_key, title: `${source_key} news` });
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.equal(r.scanned, 12);
  assert.equal(r.inserted, 7);
  const rows = Object.fromEntries(db.rows("SELECT source_key, entity_key, entity_name, status, state, coverage_subject, affects FROM aux_items")
    .map((x) => [x.source_key, { ...x }]));
  assert.deepEqual(Object.keys(rows).sort(), ["aglt_rel", "anduril", "edgar_ssti", "ia_media_dronelife", "maymobility_news", "nga", "skydio"]);
  assert.deepEqual(rows.anduril, { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", status: "private", state: "pending",
    coverage_subject: 0, affects: null });
  assert.deepEqual(rows.aglt_rel, { source_key: "aglt_rel", entity_key: "aglt_rel", entity_name: "Agility Robotics partner mentions", status: "public",
    state: "pending", coverage_subject: 1, affects: "AGLT" });
  assert.equal(rows.skydio.coverage_subject, 0, "a counterparty company's own channel is a plain auxiliary name");
  assert.deepEqual([rows.nga.entity_key, rows.nga.status], ["nga", "program"]);
  assert.deepEqual([rows.ia_media_dronelife.entity_key, rows.ia_media_dronelife.status], ["media_dronelife", "media"]);
  assert.deepEqual([rows.edgar_ssti.entity_key, rows.edgar_ssti.status], ["ssti", "unknown"]);
  assert.equal(rows.maymobility_news.entity_key, "maymobility");
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM items")[0].n, 0, "the auxiliary ingest never writes coverage items");
  assert.equal(meta(db, "nm_cursor"), "0", "nor moves the coverage cursor");
  assert.ok(meta(db, "aux_last_ingest_at"));

  // The coverage ingest of the same rows: covered and counterparty items only.
  // skydio is a counterparty source and also auxiliary, so it is on both pages.
  const c = await ingest({ DB: db, NEWS: news });
  assert.equal(c.scanned, 12);
  assert.deepEqual(db.rows("SELECT source_key FROM items ORDER BY id").map((x) => x.source_key), ["redcat", "aglt_rel", "skydio"]);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items")[0].n, 7, "nor does the coverage ingest touch aux_items");
  assert.equal(meta(db, "aux_nm_cursor"), String(r.cursor));
});

test("skips on arrival like coverage: bad_url, stale_on_arrival, and archive seeds parked across batch boundaries", async () => {
  const news = newsDb();
  const db = zenithDb();
  atStart(db);
  const seen = iso();
  // 396 rows from sources that never route (ops), then two odd rows, then a
  // 7-row sitemap seed (5 undated, 1 old, 1 dated today) straddling the
  // 400-row batch edge.
  for (let i = 0; i < 396; i++) ins(news, { source_key: "probe_filler", first_seen: seen });
  ins(news, { source_key: "nga", url: "javascript:alert(1)", title: "Bad link", first_seen: seen });
  ins(news, { source_key: "nga", url: "https://www.nga.mil/n/old", title: "Old post", published: iso(40 * DAY), first_seen: seen });
  const seed = [null, null, null, "2024-05-01T00:00:00Z", null, null, seen];
  seed.forEach((pub, i) => ins(news, { source_key: "anduril", url: `https://www.anduril.com/p${i}`, title: `Anduril page ${i}`, published: pub, first_seen: seen }));
  // Two undated rows from a later poll are not an archive.
  const later = new Date(Date.now() + 1000).toISOString();
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/a", title: "Anduril A", published: null, first_seen: later });
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/b", title: "Anduril B", published: null, first_seen: later });
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.equal(r.scanned, 407);
  assert.equal(r.inserted, 11);
  const byUrl = Object.fromEntries(db.rows("SELECT url, state, skip_reason FROM aux_items ORDER BY nm_rowid")
    .map((s) => [s.url.split("/").pop(), `${s.state}:${s.skip_reason}`]));
  assert.equal(byUrl["javascript:alert(1)"], "skipped:bad_url");
  assert.equal(byUrl.old, "skipped:stale_on_arrival");
  for (const k of ["p0", "p1", "p2", "p3", "p4", "p5"]) assert.equal(byUrl[k], "skipped:archive_seed", k);
  assert.equal(byUrl.p6, "pending:null", "a dated row from today stays queued");
  assert.equal(byUrl.a, "pending:null");
  assert.equal(byUrl.b, "pending:null");
  assert.ok(r.archive_parked_after_insert >= 1, "rows queued in the first batch were parked once the group reached five");
  assert.equal(r.skipped_on_arrival, 2 + 4, "bad_url, stale, and the seed rows of the second batch");
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM items")[0].n, 0, "coverage items are never parked by the auxiliary ingest");
});

test(`the first run backfills ${AUX_BACKFILL_DAYS} days from its own cursor; later runs continue from it`, async () => {
  const news = newsDb();
  const db = zenithDb();
  ins(news, { source_key: "anduril", title: "Twenty days old", first_seen: iso(20 * DAY), published: iso(20 * DAY) });
  ins(news, { source_key: "redcat", title: "Covered, ten days old", first_seen: iso(10 * DAY) });
  ins(news, { source_key: "nga", title: "Ten days old", first_seen: iso(10 * DAY), published: iso(10 * DAY) });
  ins(news, { source_key: "anduril", title: "Today", first_seen: iso() });
  // The coverage cursor is already further along; the auxiliary one is its own.
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '4')").run();
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual(db.rows("SELECT title FROM aux_items ORDER BY nm_rowid").map((x) => x.title), ["Ten days old", "Today"]);
  assert.equal(r.scanned, 3, "the window starts just before the oldest row of the last 14 days");
  assert.equal(meta(db, "aux_nm_cursor"), "4");
  assert.equal(meta(db, "nm_cursor"), "4");
  ins(news, { source_key: "nga", title: "Next" });
  const r2 = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r2.scanned, r2.inserted], [1, 1]);
  // Nothing in the window: start at the newest row, so only new rows come in.
  const news2 = newsDb();
  const db2 = zenithDb();
  ins(news2, { source_key: "anduril", first_seen: iso(30 * DAY) });
  assert.deepEqual([(await ingestAux({ DB: db2, NEWS: news2 })).inserted, meta(db2, "aux_nm_cursor")], [0, "1"]);
  ins(news2, { source_key: "anduril" });
  assert.equal((await ingestAux({ DB: db2, NEWS: news2 })).inserted, 1);
});

test("the cursor advances over unmatched rows, six 400-row windows a run; a replay stores nothing twice", async () => {
  const news = newsDb();
  const db = zenithDb();
  atStart(db);
  const seen = iso();
  const stmt = news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, 'T', ?, NULL, ?, 1)");
  for (let i = 0; i < 2500; i++) stmt.run(i % 5 === 0 ? "anduril" : "redcat", `https://x.example/${i}`, seen, seen);
  const r1 = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r1.scanned, r1.matched, r1.inserted, r1.cursor], [2400, 480, 480, 2400]);
  const r2 = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r2.scanned, r2.inserted, r2.cursor], [100, 20, 2500]);
  const r3 = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r3.scanned, r3.inserted, r3.cursor], [0, 0, 2500]);
  // Replaying from the start (a reset cursor) inserts nothing twice.
  db.db.prepare("UPDATE meta SET value = '0' WHERE key = 'aux_nm_cursor'").run();
  const again = await ingestAux({ DB: db, NEWS: news });
  assert.equal(again.inserted, 0);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items")[0].n, 500);
});

const TITLE = "Example Robotics Raises $150 Million Series D";
const RELEASE = [
  TITLE,
  "Nov 12, 2026",
  "AUSTIN, TX / November 12, 2026 / Example Robotics today announced a $150 million Series D led by a growth fund to scale production of its systems.",
  ...Array.from({ length: 30 }, (_, k) => `The company continued to build out its platform across several programs in phase ${k}.`),
  "The round values the company at $2.1 billion, up from $900 million in 2025.",
].join("\n");

test("feed text that is the release becomes the excerpt (status feed); teasers and PDF links do not, and no page is fetched", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const db = zenithDb();
  atStart(db);
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/n/release", title: TITLE, body: RELEASE });
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/n/teaser", title: "Teaser", body: "Only a teaser […]" });
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/n/deck", title: "Investor deck", body: "Deck (https://www.anduril.com/files/deck.pdf)" });
  ins(news, { source_key: "anduril", url: "https://www.anduril.com/n/none", title: "No text", body: null });
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("auxiliary items are never fetched"); };
  try {
    const r = await ingestAux({ DB: db, NEWS: news });
    assert.deepEqual([r.inserted, r.feed_excerpts], [4, 1]);
  } finally {
    globalThis.fetch = real;
  }
  const rows = Object.fromEntries(db.rows("SELECT url, excerpt, excerpt_status FROM aux_items").map((x) => [x.url.split("/").pop(), x]));
  assert.equal(rows.release.excerpt_status, "feed");
  assert.match(rows.release.excerpt, /^AUSTIN, TX .*\$150 million Series D/);
  for (const k of ["teaser", "deck", "none"]) assert.deepEqual([rows[k].excerpt, rows[k].excerpt_status], [null, null], k);
});

test("catch-up: coverage-subject rows the cursor passed before they were routed are stored once, from the 14-day backfill start", async () => {
  const news = newsDb();
  const db = zenithDb();
  // Round 1 already ran: its cursor passed every row, and stored only plain auxiliary names.
  ins(news, { source_key: "dronedominance", title: "Too old for the backfill", first_seen: iso(20 * DAY), published: iso(20 * DAY) });
  ins(news, { source_key: "dronedominance", title: "Drone Dominance Phase 2 vendors include Anduril", first_seen: iso(10 * DAY), published: iso(10 * DAY) });
  ins(news, { source_key: "anduril", title: "Anduril news", first_seen: iso(9 * DAY), published: iso(9 * DAY) });
  ins(news, { source_key: "fpds_pl", title: "FPDS: Planet Labs Federal award", first_seen: iso(8 * DAY), published: iso(8 * DAY) });
  ins(news, { source_key: "fpds_pl", title: "Old award first seen late", first_seen: iso(7 * DAY), published: iso(40 * DAY) });
  ins(news, { source_key: "redcat", title: "Covered", first_seen: iso(6 * DAY) });
  ins(news, { source_key: "site_kodiak", title: "Site change", first_seen: iso(6 * DAY) });
  ins(news, { source_key: "aglt_rel", url: "javascript:alert(1)", title: "Bad link", first_seen: iso(5 * DAY) });
  ins(news, { source_key: "wargov_contracts_matched", title: "War.gov paragraph naming Red Cat", first_seen: iso(4 * DAY), published: iso(4 * DAY) });
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_nm_cursor', '9'), ('nm_cursor', '9')").run();
  db.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at)
    VALUES (3, 'anduril', 'anduril', 'Anduril (private)', 'private', 'https://news.example.com/anduril/x', 'Anduril news', ?, ?)`).run(iso(9 * DAY), iso(9 * DAY));
  // A new coverage-subject row after the cursor: the main scan routes it now.
  ins(news, { source_key: "dronedominance_lists", title: "Vendor list updated" });
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r.scanned, r.inserted, r.cursor], [1, 1, 10]);
  const cu = r.coverage_subject_catch_up;
  assert.deepEqual([cu.scanned, cu.matched, cu.inserted, cu.skipped_on_arrival, cu.done], [9, 6, 5, 2, true],
    "rows 2-10: five coverage-subject rows stored (the new one was already there), two of them skipped");
  assert.equal(meta(db, "aux_cs_cursor"), AUX_CS_DONE);
  const got = db.rows("SELECT nm_rowid, source_key, entity_key, state, skip_reason, coverage_subject, affects FROM aux_items ORDER BY nm_rowid").map((x) => ({ ...x }));
  assert.deepEqual(got.map((x) => [x.nm_rowid, x.source_key, x.state, x.skip_reason]), [
    [2, "dronedominance", "pending", null],
    [3, "anduril", "pending", null],
    [4, "fpds_pl", "pending", null],
    [5, "fpds_pl", "skipped", "stale_on_arrival"],
    [8, "aglt_rel", "skipped", "bad_url"],
    [9, "wargov_contracts_matched", "pending", null],
    [10, "dronedominance_lists", "pending", null],
  ]);
  const by = Object.fromEntries(got.map((x) => [x.nm_rowid, x]));
  assert.deepEqual([by[2].entity_key, by[2].coverage_subject, by[2].affects], ["dronedominance", 1, "RCAT,DPRO,PUSA,UMAC"]);
  assert.deepEqual([by[4].entity_key, by[4].affects], ["fpds", "PL"]);
  assert.deepEqual([by[3].coverage_subject, by[3].affects], [0, null], "round 1's own rows are left as they were");
  assert.equal(by[10].coverage_subject, 1);
  // Coverage never moves, and a later run does no catch-up.
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM items")[0].n, 0);
  assert.equal(meta(db, "nm_cursor"), "9");
  const again = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([again.scanned, again.inserted, again.coverage_subject_catch_up], [0, 0, null]);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items")[0].n, 7);
});

test("catch-up is bounded per run like the main scan (six 400-row windows) and resumes from aux_cs_cursor", async () => {
  const news = newsDb();
  const db = zenithDb();
  const seen = iso(DAY);
  const stmt = news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, 'T', ?, NULL, ?, 1)");
  for (let i = 0; i < 3000; i++) stmt.run(i % 10 === 0 ? "pl_rel" : i % 10 === 1 ? "anduril" : "redcat", `https://x.example/${i}`, seen, seen);
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_nm_cursor', '3000')").run();
  const r1 = await ingestAux({ DB: db, NEWS: news });
  assert.equal(r1.scanned, 0);
  assert.deepEqual([r1.coverage_subject_catch_up.scanned, r1.coverage_subject_catch_up.inserted, r1.coverage_subject_catch_up.cursor,
    r1.coverage_subject_catch_up.done], [2400, 240, 2400, false]);
  assert.equal(meta(db, "aux_cs_cursor"), "2400");
  const r2 = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r2.coverage_subject_catch_up.scanned, r2.coverage_subject_catch_up.inserted, r2.coverage_subject_catch_up.done], [600, 60, true]);
  assert.equal(meta(db, "aux_cs_cursor"), AUX_CS_DONE);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'pl_rel' AND coverage_subject = 1 AND affects = 'PL'")[0].n, 300);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key != 'pl_rel'")[0].n, 0, "the catch-up stores coverage subjects only");
  assert.equal((await ingestAux({ DB: db, NEWS: news })).coverage_subject_catch_up, null);
});

test("catch-up: a first auxiliary run routes coverage subjects itself and never needs one; nothing to scan finishes it", async () => {
  const news = newsDb();
  const db = zenithDb();
  ins(news, { source_key: "dronedominance", title: "Drone Dominance update", first_seen: iso(2 * DAY), published: iso(2 * DAY) });
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.deepEqual([r.inserted, r.coverage_subject_catch_up], [1, null]);
  assert.equal(meta(db, "aux_cs_cursor"), AUX_CS_DONE);
  // Round 1 ran on a news-monitor-db with nothing in the last 14 days.
  const news2 = newsDb();
  const db2 = zenithDb();
  ins(news2, { source_key: "dronedominance", first_seen: iso(30 * DAY) });
  db2.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_nm_cursor', '1')").run();
  const r2 = await ingestAux({ DB: db2, NEWS: news2 });
  assert.deepEqual([r2.coverage_subject_catch_up.scanned, r2.coverage_subject_catch_up.done], [0, true]);
  assert.equal(meta(db2, "aux_cs_cursor"), AUX_CS_DONE);
});

test("scheduled: the 5-minute cron ingests auxiliary items after coverage ingest and enrich; a report cron does not", async () => {
  const news = newsDb();
  const db = zenithDb();
  ins(news, { source_key: "redcat", title: "Red Cat news" });
  ins(news, { source_key: "anduril", title: "Anduril news" });
  const env = { DB: db, NEWS: news, ...TOKENS };
  const order = [];
  const log = console.log;
  console.log = (label) => order.push(label);
  try {
    await offline(async () => {
      const waits = [];
      await worker.scheduled({ cron: "0 11,12 * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      assert.equal(meta(db, "aux_nm_cursor"), null, "report crons only send reports");
      order.length = 0;
      await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    });
  } finally {
    console.log = log;
  }
  assert.deepEqual(order, ["ingest", "delivery", "enrich", "aux ingest", "expansion backfill", "sec parties"]);
  assert.deepEqual(db.rows("SELECT title FROM items").map((x) => x.title), ["Red Cat news"]);
  assert.deepEqual(db.rows("SELECT title FROM aux_items").map((x) => x.title), ["Anduril news"]);
});

test("scheduled: an auxiliary ingest failure is logged and leaves the coverage ingest alone", async () => {
  const news = newsDb();
  const db = zenithDb();
  db.exec("DROP TABLE aux_feedback; DROP TABLE aux_grades; DROP TABLE aux_items;");
  ins(news, { source_key: "redcat", title: "Red Cat news" });
  ins(news, { source_key: "anduril", title: "Anduril news" });
  const errors = [];
  const { log, error } = console;
  console.log = () => {};
  console.error = (label) => errors.push(label);
  try {
    const waits = [];
    await offline(async () => {
      await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, { DB: db, NEWS: news, ...TOKENS }, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    });
  } finally {
    Object.assign(console, { log, error });
  }
  assert.deepEqual(errors, ["aux ingest failed"]);
  assert.deepEqual(db.rows("SELECT title FROM items").map((x) => x.title), ["Red Cat news"]);
});

test("POST /v1/admin/aux-ingest runs the auxiliary ingest for admin only", async () => {
  const news = newsDb();
  const db = zenithDb();
  ins(news, { source_key: "anduril", title: "Anduril news" });
  const env = { DB: db, NEWS: news, ...TOKENS };
  assert.equal((await request(worker, env, "POST", "/v1/admin/aux-ingest", { role: "grader" })).status, 403);
  assert.equal((await request(worker, env, "POST", "/v1/admin/aux-ingest", { role: "app" })).status, 403);
  const r = await request(worker, env, "POST", "/v1/admin/aux-ingest");
  assert.deepEqual([r.status, r.body.inserted], [200, 1]);
});
