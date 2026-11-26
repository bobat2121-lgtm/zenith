// Phase 3 Part E (PR-E2): the stored weekday brief (worker/src/brief-store.js)
// and its cron stage. Synthetic fixtures only (ticker TST, example.com).
//
// brief_days comes from migration 0022 (PR-E1). The test harness
// (test/helpers/d1.js, test/helpers/worker-env.js) applies every file in
// worker/migrations/; until this branch carries 0022, ensureBriefDays() runs
// the same CREATE TABLE IF NOT EXISTS on the stand-in after the harness, and
// once 0022 is present it is a no-op and the copy is checked against the file.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { D1, addItem, addGrade } from "./helpers/d1.js";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";
import { etToUtc } from "../worker/src/et.js";

hookJsonImports();
const { loadRelations } = await import("../worker/src/relations.js");
const store = await import("../worker/src/brief-store.js");
const { briefStoreTick, capBrief, briefCounts, inStoreWindow, previousWeekday, MAX_STORED_BYTES, Q1_SQL, Q2_SQL } = store;
const { default: worker } = await import("../worker/src/index.js");

const BRIEF_DAYS_DDL = `CREATE TABLE IF NOT EXISTS brief_days (
  universe_id TEXT NOT NULL DEFAULT 'u1',
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  window_from TEXT,
  window_to TEXT,
  built_at TEXT NOT NULL,
  counts TEXT CHECK (counts IS NULL OR json_valid(counts)),
  contents TEXT CHECK (contents IS NULL OR json_valid(contents)),
  error TEXT,
  PRIMARY KEY (universe_id, day, kind)
);`;
const MIGRATION = new URL("../worker/migrations/0022_brief_days.sql", import.meta.url);
function ensureBriefDays(db) {
  (db.db ?? db).exec(BRIEF_DAYS_DDL);
  return db;
}

const COVERED = { tickers: ["TST"] };
const rel = loadRelations({
  relations: { basis: "files", peers: {}, rivals: {}, key_accounts: {} }, version: "rel-test",
  covered: { tickers: ["TST"], counterparty: {} }, aux: { sources: {} }, match: {}, industry: {}, isRecordSource: () => false,
});
const at = (date, h, m) => etToUtc(date, h, m);
const TUE_EST = Date.parse("2026-01-06T12:05:00Z");   // Tue 07:05 EST
const TUE_EDT = Date.parse("2026-07-07T11:05:00Z");   // Tue 07:05 EDT
// A news-monitor-db stand-in with an empty series_points table.
const quietNews = () => {
  const d = new D1({ migrations: false });
  d.exec("CREATE TABLE series_points (series TEXT, subject TEXT, period TEXT, value REAL, ticker TEXT, label TEXT, observed_at TEXT, PRIMARY KEY (series, subject, period))");
  return { prepare: (sql) => d.prepare(sql) };
};

// A D1 whose prepare calls are counted (and can be made to fail for one statement).
function counted(db, { failOn = null } = {}) {
  const env = { calls: 0, sql: [], failOn };
  env.DB = {
    prepare(sql) {
      env.calls++;
      env.sql.push(sql);
      if (env.failOn && env.failOn.test(sql)) throw new Error("synthetic build failure");
      return db.prepare(sql);
    },
    batch: (s) => db.batch(s),
  };
  return env;
}
const rowsOf = (db) => db.db.prepare("SELECT day, status, attempts, window_from, window_to, counts, contents, error FROM brief_days ORDER BY day").all().map((r) => ({ ...r }));
const tick = (env, now) => briefStoreTick(env, COVERED, { now, rel });

test("brief store: the brief_days copy here equals migration 0022 once the branch carries it", () => {
  const norm = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  if (!existsSync(MIGRATION)) return; // before the rebase on main (PR-E1)
  const sql = readFileSync(MIGRATION, "utf8");
  const m = /CREATE TABLE IF NOT EXISTS brief_days \([\s\S]*?\n\);/.exec(sql);
  assert.ok(m, "0022 creates brief_days");
  assert.equal(norm(m[0]), norm(BRIEF_DAYS_DDL));
  // And the harness already applied it.
  const d = new DatabaseSync(":memory:");
  d.exec(sql);
  assert.ok(new D1().db.prepare("SELECT name FROM sqlite_master WHERE name = 'brief_days'").get());
});

test("brief store: 07:05 ET on a Tuesday stores one row in EST and in EDT; 06:55 ET stores none", async () => {
  for (const [now, want] of [[TUE_EST, 1], [TUE_EDT, 1], [Date.parse("2026-01-06T11:55:00Z"), 0], [Date.parse("2026-07-07T10:55:00Z"), 0]]) {
    const db = ensureBriefDays(new D1());
    const env = { DB: db, NEWS: quietNews() };
    const r = await tick(env, now);
    assert.equal(rowsOf(db).length, want, `${new Date(now).toISOString()} ${JSON.stringify(r)}`);
    assert.equal(r.status, want ? "ok" : "outside");
  }
  assert.equal(inStoreWindow(at("2026-01-06", 9, 59)), true);
  assert.equal(inStoreWindow(at("2026-01-06", 10, 0)), false);
  assert.equal(inStoreWindow(at("2026-01-06", 6, 59)), false);
});

test("brief store: in-window Tuesday stores ok, attempts 1, window_from = Monday 07:00 ET, counts with competitors, industry and calendar; the next tick reads one row and builds nothing", async () => {
  const db = ensureBriefDays(new D1());
  const id = await addItem(db, { ticker: "TST", title: "TST wins an order", nm_first_seen: "2026-01-05T20:00:00.000Z" });
  await addGrade(db, id, { score: 84, graded_at: "2026-01-05T21:00:00.000Z" });
  const env = counted(db);
  env.NEWS = quietNews();
  const r = await tick(env, TUE_EST);
  assert.equal(r.status, "ok");
  const [row] = rowsOf(db);
  assert.deepEqual([row.day, row.status, row.attempts, row.window_from, row.window_to, row.error],
    ["2026-01-06", "ok", 1, new Date(at("2026-01-05", 7, 0)).toISOString(), new Date(TUE_EST).toISOString(), null]);
  const counts = JSON.parse(row.counts);
  for (const k of ["leads_digests", "counterparty", "waiting", "held", "catalysts", "council_outcomes", "competitors", "industry",
    "competitors_below", "industry_below", "calendar"]) assert.equal(typeof counts[k], "number", k);
  assert.equal(counts.leads_digests, 1);
  const contents = JSON.parse(row.contents);
  assert.ok(!("text" in contents));
  assert.ok(contents.competitors && contents.industry && Array.isArray(contents.calendar));
  assert.deepEqual(contents.leads_digests.map((g) => g.ticker), ["TST"]);
  // Next tick: one primary-key read, no build, no write.
  env.calls = 0;
  env.sql = [];
  const again = await tick(env, TUE_EST + 5 * 60_000);
  assert.deepEqual([again.status, env.calls, env.sql], ["already", 1, [Q1_SQL]]);
});

test("brief store: Monday 07:05 ET starts at the previous Friday's window_to; Saturday and Sunday store nothing; Tuesday 06:55 and 10:00 ET make zero prepare calls", async () => {
  const db = ensureBriefDays(new D1());
  const friEnd = "2026-01-02T12:05:00.000Z";
  db.db.prepare("INSERT INTO brief_days (day, kind, status, window_from, window_to, built_at) VALUES ('2026-01-02', 'brief_am', 'ok', '2026-01-01T12:00:00.000Z', ?, ?)").run(friEnd, friEnd);
  const env = counted(db);
  env.NEWS = quietNews();
  const mon = at("2026-01-05", 7, 5);
  assert.equal((await tick(env, mon)).status, "ok");
  assert.equal(rowsOf(db).find((r) => r.day === "2026-01-05").window_from, friEnd);
  assert.equal(previousWeekday("2026-01-05"), "2026-01-02");
  assert.equal(previousWeekday("2026-01-06"), "2026-01-05");
  for (const now of [at("2026-01-03", 7, 5), at("2026-01-04", 8, 0), at("2026-01-06", 6, 55), at("2026-01-06", 10, 0)]) {
    env.calls = 0;
    const r = await tick(env, now);
    assert.deepEqual([r.status, env.calls], ["outside", 0], new Date(now).toISOString());
  }
  assert.deepEqual(rowsOf(db).map((r) => r.day), ["2026-01-02", "2026-01-05"]);
  // Q2 looks back at most 6 days: an older ok row is not the start.
  const db2 = ensureBriefDays(new D1());
  db2.db.prepare("INSERT INTO brief_days (day, kind, status, window_to, built_at) VALUES ('2025-12-29', 'brief_am', 'ok', '2025-12-29T12:05:00.000Z', 'x')").run();
  await tick({ DB: db2, NEWS: quietNews() }, at("2026-01-06", 7, 5));
  assert.equal(rowsOf(db2).find((r) => r.day === "2026-01-06").window_from, new Date(at("2026-01-05", 7, 0)).toISOString());
  assert.match(Q2_SQL, /day < \?1 AND day >= \?2/);
});

test("brief store: the tick uses event.scheduledTime, not Date.now()", async () => {
  const db = ensureBriefDays(new D1());
  const env = counted(db);
  const real = Date.now;
  Date.now = () => TUE_EST; // the wall clock says in-window
  try {
    const r = await tick(env, Date.parse("2026-01-04T15:00:00Z")); // the event says Sunday
    assert.deepEqual([r.status, env.calls], ["outside", 0]);
  } finally {
    Date.now = real;
  }
  await assert.rejects(() => briefStoreTick(env, COVERED, {}), /scheduledTime/);
});

// The auxiliary-ingest cron scenarios (the order list, and the error list with
// the aux tables dropped) give the same result inside and outside the window.
async function cronRun(now, { dropAux = false } = {}) {
  const db = ensureBriefDays(zenithDb());
  if (dropAux) db.exec("DROP TABLE aux_feedback; DROP TABLE aux_grades; DROP TABLE aux_items;");
  const news = newsDb();
  const env = { DB: db, NEWS: news, ...TOKENS };
  const order = [], errors = [], stored = [];
  const { log, error, warn } = console;
  const real = globalThis.fetch;
  console.log = (label, body) => { order.push(label); if (label === "brief store") stored.push(JSON.parse(body).status); };
  console.error = (label) => errors.push(label);
  console.warn = () => {};
  globalThis.fetch = async () => new Response("offline", { status: 404 });
  try {
    const waits = [];
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: now }, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    Object.assign(console, { log, error, warn });
    globalThis.fetch = real;
  }
  return { order, errors, stored, rows: db.rows("SELECT day, status FROM brief_days") };
}

test("brief store: the cron order and the aux-dropped error list are the same at a fixed in-window and out-of-window time", async () => {
  const inside = await cronRun(TUE_EST);
  const outside = await cronRun(Date.UTC(2026, 0, 4, 15, 0));
  const ORDER = ["ingest", "delivery", "enrich", "bill lines", "aux ingest", "wargov excerpts", "gate budget", "aux text", "expansion backfill", "brief store", "sec parties"];
  assert.deepEqual(inside.order, ORDER);
  assert.deepEqual(outside.order, ORDER);
  assert.deepEqual([inside.stored, outside.stored], [["ok"], ["outside"]]);
  assert.deepEqual(inside.rows.map((r) => ({ ...r })), [{ day: "2026-01-06", status: "ok" }]);
  const dIn = await cronRun(TUE_EST, { dropAux: true });
  const dOut = await cronRun(Date.UTC(2026, 0, 4, 15, 0), { dropAux: true });
  const ERRORS = ["aux ingest failed", "wargov excerpts failed", "gate budget failed", "aux text failed"];
  assert.deepEqual(dIn.errors, ERRORS);
  assert.deepEqual(dOut.errors, ERRORS);
  assert.deepEqual(dIn.stored, ["ok"], "the brief is still stored, with its aux sections as errors");
});

test("brief store: a build that throws stores failed; the next tick retries; after 3 attempts it gives up", async () => {
  const db = ensureBriefDays(new D1());
  const env = counted(db, { failOn: /FROM runs/ });
  env.NEWS = quietNews();
  const t = (k) => TUE_EST + k * 5 * 60_000;
  let r = await tick(env, t(0));
  assert.deepEqual([r.status, r.attempts, r.error], ["failed", 1, "synthetic build failure"]);
  assert.deepEqual([rowsOf(db)[0].status, rowsOf(db)[0].attempts, rowsOf(db)[0].counts, rowsOf(db)[0].contents], ["failed", 1, null, null]);
  r = await tick(env, t(1));
  assert.equal(r.status, "failed");
  r = await tick(env, t(2));
  assert.equal(r.status, "failed");
  assert.equal(rowsOf(db)[0].attempts, 3);
  env.calls = 0;
  r = await tick(env, t(3));
  assert.deepEqual([r.status, env.calls], ["gave_up", 1]);
  // A retry that succeeds: attempts counts on, status ok.
  const db2 = ensureBriefDays(new D1());
  const env2 = counted(db2, { failOn: /FROM runs/ });
  env2.NEWS = quietNews();
  await tick(env2, t(0));
  env2.failOn = null;
  r = await tick(env2, t(1));
  assert.deepEqual([r.status, r.attempts], ["ok", 2]);
  assert.deepEqual([rowsOf(db2)[0].status, rowsOf(db2)[0].attempts, rowsOf(db2)[0].error], ["ok", 2, null]);
  // An ok row is never overwritten.
  await db2.prepare(store.UPSERT_SQL).bind("2026-01-06", "failed", null, null, "x", null, null, "late").run();
  assert.deepEqual([rowsOf(db2)[0].status, rowsOf(db2)[0].attempts], ["ok", 2]);
});

// A D1 whose 'ok' brief_days write throws (`times` times, then works).
function okWriteFails(db, times = Infinity) {
  const env = { builds: 0, left: times };
  env.DB = {
    prepare(sql) {
      if (/FROM runs/.test(sql)) env.builds++;
      const stmt = db.prepare(sql);
      if (!/^INSERT INTO brief_days/.test(sql)) return stmt;
      return {
        bind: (...args) => {
          const bound = stmt.bind(...args);
          return { run: async () => { if (args[1] === "ok" && env.left > 0) { env.left--; throw new Error("synthetic write failure"); } return bound.run(); } };
        },
      };
    },
    batch: (st) => db.batch(st),
  };
  env.NEWS = quietNews();
  return env;
}

test("brief store: an ok write that throws stores failed, so attempts counts on and the tick gives up after 3; a write that fails once stores ok on the next tick", async () => {
  const t = (k) => TUE_EST + k * 5 * 60_000;
  const db = ensureBriefDays(new D1());
  const env = okWriteFails(db);
  for (let k = 0; k < 3; k++) {
    const r = await tick(env, t(k));
    assert.deepEqual([r.status, r.attempts, r.error], ["failed", k + 1, "store write failed: synthetic write failure"]);
    assert.deepEqual([rowsOf(db)[0].status, rowsOf(db)[0].attempts], ["failed", k + 1]);
  }
  const builds = env.builds;
  assert.equal((await tick(env, t(3))).status, "gave_up");
  assert.equal(env.builds, builds, "no build after the third attempt");
  const db2 = ensureBriefDays(new D1());
  const env2 = okWriteFails(db2, 1);
  assert.equal((await tick(env2, t(0))).status, "failed");
  const r = await tick(env2, t(1));
  assert.deepEqual([r.status, r.attempts], ["ok", 2]);
  assert.deepEqual([rowsOf(db2)[0].status, rowsOf(db2)[0].attempts, rowsOf(db2)[0].error], ["ok", 2, null]);
});

test("brief store: stored contents have no text key, graded ≤ 40 rows with full counts, and fit 64 KB with 200 graded rows and 100 calendar entries", async () => {
  const db = ensureBriefDays(new D1());
  for (let k = 0; k < 200; k++) {
    const id = await addItem(db, { ticker: "TST", title: `TST item ${k} ${"t".repeat(150)}`, url: `https://example.com/n/${k}`, nm_first_seen: "2026-01-05T15:00:00.000Z" });
    await addGrade(db, id, { score: 70 + (k % 30), why: "w".repeat(400), graded_at: "2026-01-05T16:00:00.000Z" });
  }
  const r = await tick({ DB: db, NEWS: quietNews() }, TUE_EST);
  assert.equal(r.status, "ok");
  const [row] = rowsOf(db);
  assert.ok(Buffer.byteLength(row.contents) <= MAX_STORED_BYTES, String(Buffer.byteLength(row.contents)));
  const c = JSON.parse(row.contents);
  assert.ok(!("text" in c));
  assert.equal(c.leads_digests.reduce((n, g) => n + g.items.length, 0), 40);
  assert.equal(JSON.parse(row.counts).leads_digests, 200);
  // capBrief on a synthetic brief over the cap: why clipped, waiting items dropped, calendar trimmed.
  const big = {
    kind: "brief_am", text: ["x"], leads_digests: [{ ticker: "TST", items: Array.from({ length: 60 }, (_, k) => ({ item_id: k, score: 80, title: "t".repeat(200), why: "w".repeat(2000) })) }],
    counterparty: [], waiting: { count: 60, held: 0, items: Array.from({ length: 60 }, (_, k) => ({ item_id: k, title: "q".repeat(300) })) },
    catalysts: [], council_outcomes: [],
    calendar: Array.from({ length: 140 }, (_, k) => ({ ticker: "TST", start: "2026-01-07", text: "c".repeat(400), k })),
    competitors: { by_ticker: [], count: 0, below: [], unassigned: 0, waiting: { n: 0, held: 0 }, rival_sources: 0 },
    industry: { items: [], count: 0, below: [], unassigned: 0, waiting: { n: 0, held: 0 }, registers: [] },
  };
  const out = capBrief(big);
  assert.ok(out.bytes <= MAX_STORED_BYTES);
  assert.ok(!("text" in out.contents));
  assert.equal(out.contents.leads_digests[0].items.length, 40);
  assert.ok(out.contents.leads_digests[0].items.every((x) => x.why.length <= 160));
  assert.ok(out.contents.calendar.length <= 100);
});

test("brief store: a brief with every list at its cap and long fields stores ok under 64 KB, rows cut from the bottom and named in truncated", async () => {
  const s = (n, c) => c.repeat(n);
  const url = (k) => `https://example.com/news/2026/01/05/a-fairly-long-article-slug-about-a-company-${k}?utm_source=feed&utm_medium=rss`;
  const graded = (k) => ({ grade_id: 100_000 + k, item_id: 50_000 + k, ticker: "TST", score: 99 - k, band: "digest", event_type: "contract_award",
    why: s(300, "w"), note_hook: s(200, "n"), magnitude_usd: 12_000_000, magnitude_pct: 0.5, read_source: 2, graded_at: "2026-01-05T16:00:00.000Z",
    title: s(140, "t"), url: url(k), role: null, affects: null, item_ticker: "TST", source_key: `src_${k}`, nm_first_seen: "2026-01-05T15:00:00.000Z",
    headline: s(100, "h"), headline_tag: "tag" });
  const aux = (k) => ({ pipeline: "aux", item_id: k, grade_id: k, entity_key: `entity_${k}`, entity_name: s(40, "e"), status: "media", source_key: `aux_${k}`,
    title: s(140, "t"), headline: s(100, "h"), url: url(k), score: 75, band: "digest", event_type: "x", why: s(300, "w"), graded_at: "2026-01-05T16:00:00.000Z" });
  const cal = (k) => ({ ticker: "TST", date: "2026-01-07", text: s(120, "c"), kind: "earnings", k });
  const b = {
    kind: "brief_am", text: ["x"], leads_digests: [{ ticker: "TST", items: Array.from({ length: 40 }, (_, k) => graded(k)) }],
    counterparty: Array.from({ length: 15 }, (_, k) => ({ ...graded(k), role: "rival" })),
    waiting: { count: 20, held: 0, items: Array.from({ length: 20 }, (_, k) => ({ item_id: k, ticker: "TST", title: s(140, "q"), url: url(k) })) },
    catalysts: Array.from({ length: 25 }, (_, k) => cal(k)), council_outcomes: [], calendar: Array.from({ length: 100 }, (_, k) => cal(k)),
    health: { news_monitor: { failing: Array.from({ length: 10 }, (_, k) => ({ key: `k${k}`, ticker: "TST", fail_count: 3, last_error: s(90, "e") })) } },
    to_label: [],
    competitors: { by_ticker: [{ ticker: "TST", items: Array.from({ length: 25 }, (_, k) => ({ ...aux(k), ticker: "TST", direction: "-" })) }],
      count: 25, listed: 25, more: 0, below: [], unassigned: 0, waiting: { n: 0, held: 0 }, rival_sources: 3 },
    industry: { items: Array.from({ length: 25 }, (_, k) => ({ ...aux(k), tag: "media", tickers: ["TST"] })), count: 25, below: [], unassigned: 0,
      waiting: { n: 0, held: 0 }, registers: [] },
  };
  const out = capBrief(b);
  assert.ok(out.bytes <= MAX_STORED_BYTES, String(out.bytes));
  assert.equal(out.bytes, Buffer.byteLength(out.json));
  const t = out.contents.truncated;
  assert.ok(t && t.calendar === 30 && t.catalysts === 25, JSON.stringify(t));
  assert.ok(out.contents.leads_digests[0].items.length === 40 && out.contents.counterparty.length === 15, "graded and counterparty rows are cut last");
  // Rows go from the bottom: what is kept is the top of each list.
  assert.equal(t.industry, 25, "industry goes before competitors");
  const kept = out.contents.competitors.by_ticker[0].items.map((x) => x.item_id);
  assert.ok(kept.length > 0 && kept.length + t.competitors === 25, JSON.stringify(t));
  assert.deepEqual(kept, Array.from({ length: kept.length }, (_, k) => k));
  assert.ok(out.contents.leads_digests[0].items.every((x) => x.note_hook.length <= 80 && x.headline.length <= 80));
  assert.deepEqual(briefCounts(b).calendar, 100, "counts keep the full numbers");
  // capBrief no longer throws here, so the tick stores ok (it throws only when no list row is left).
  // A brief under the cap has no truncated key.
  assert.ok(!("truncated" in capBrief({ ...b, calendar: [], catalysts: [], competitors: { ...b.competitors, by_ticker: [] }, industry: { ...b.industry, items: [] } }).contents));
});

test("brief store: BRIEF_STORE=0 makes zero prepare calls", async () => {
  const db = ensureBriefDays(new D1());
  const env = counted(db);
  env.BRIEF_STORE = "0";
  const r = await tick(env, TUE_EST);
  assert.deepEqual([r.status, env.calls], ["off", 0]);
});

// The 5-weekday exit-test query (Part E §8 E3 step 3), run on synthetic rows.
const STREAK_SQL = `WITH d AS (SELECT day, CAST(julianday(day) - julianday('2026-11-02') AS INTEGER) AS n FROM brief_days
             WHERE universe_id = 'u1' AND kind = 'brief_am' AND status = 'ok' AND day >= ?1
               AND strftime('%w', day) BETWEEN '1' AND '5' AND json_extract(counts, '$.competitors') IS NOT NULL
               AND json_extract(counts, '$.industry') IS NOT NULL),
      w AS (SELECT day, (n / 7) * 5 + (n % 7) AS ord FROM d),
      g AS (SELECT day, ord - ROW_NUMBER() OVER (ORDER BY day) AS grp FROM w)
 SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(*) AS weekdays FROM g GROUP BY grp ORDER BY weekdays DESC, last_day DESC LIMIT 3`;

function streak(days, start = "2026-11-02", { counts = '{"competitors":0,"industry":0}' } = {}) {
  const db = ensureBriefDays(new D1());
  for (const d of days) db.db.prepare("INSERT INTO brief_days (day, kind, status, built_at, counts) VALUES (?, 'brief_am', 'ok', 'x', ?)").run(d, counts);
  return db.db.prepare(STREAK_SQL).all(start).map((r) => ({ ...r }));
}

test("brief store: the streak SQL counts 5 weekdays Mon-Fri and across a weekend; a missing Wednesday splits; Saturday and rows before the start are ignored", () => {
  assert.equal(streak(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"])[0].weekdays, 5);
  assert.deepEqual(streak(["2026-12-03", "2026-12-04", "2026-12-07", "2026-12-08", "2026-12-09"])[0], { first_day: "2026-12-03", last_day: "2026-12-09", weekdays: 5 });
  assert.equal(streak(["2026-11-30", "2026-12-01", "2026-12-03", "2026-12-04", "2026-12-07"])[0].weekdays, 3);
  assert.equal(streak(["2026-12-03", "2026-12-04", "2026-12-05", "2026-12-07"])[0].weekdays, 3, "a Saturday row neither counts nor breaks the run");
  assert.equal(streak(["2026-11-27", "2026-11-30", "2026-12-01"], "2026-11-30")[0].weekdays, 2);
  assert.deepEqual(streak(["2026-11-30"], "2026-11-02", { counts: '{"competitors":null,"industry":0}' }), []);
});
