// Auxiliary ingest (auxiliary.js ingestAux): rows whose source routes to an
// auxiliary name are copied into aux_items by their own cursor, with the
// coverage ingest's windowing, skip reasons and archive parking; feed text that
// is the release becomes the excerpt and no page is ever fetched. The coverage
// tables and cursor never move because of it.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { ingestAux, AUX_BACKFILL_DAYS } = await import("../worker/src/auxiliary.js");
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

test("routes auxiliary sources only: covered, ops, coverage-subject and covered-duplicate rows are not stored", async () => {
  const news = newsDb();
  const db = zenithDb();
  atStart(db);
  atStart(db, "nm_cursor");
  for (const source_key of ["anduril", "nga", "redcat", "aglt_rel", "site_kodiak", "probe_x", "edgar_latest", "managed_draganfly_news",
    "ia_media_dronelife", "edgar_ssti", "skydio", "maymobility_news"]) ins(news, { source_key, title: `${source_key} news` });
  const r = await ingestAux({ DB: db, NEWS: news });
  assert.equal(r.scanned, 12);
  assert.equal(r.inserted, 6);
  const rows = Object.fromEntries(db.rows("SELECT source_key, entity_key, entity_name, status, state FROM aux_items").map((x) => [x.source_key, { ...x }]));
  assert.deepEqual(Object.keys(rows).sort(), ["anduril", "edgar_ssti", "ia_media_dronelife", "maymobility_news", "nga", "skydio"]);
  assert.deepEqual(rows.anduril, { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", status: "private", state: "pending" });
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
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items")[0].n, 6, "nor does the coverage ingest touch aux_items");
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
  assert.deepEqual(order, ["ingest", "delivery", "enrich", "aux ingest"]);
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
