// Phase 3 PR-PA3: the Today view (/p/today). T-1 filters and band sections, T-2 the
// range, T-3 grader status equal to /v1/ops, T-4 the queue equal to /v1/ops, T-5 the
// quiet list, T-6 the calendar and exactly four statements per open, T-7 the card and
// reject caps, T-8 the label forms. Synthetic fixtures only (ticker TST and TST*
// names injected as the universe; T-3/T-4 pick a covered ticker from the bundled
// covered.json at run time, because ops() counts the bundled universe).
import test from "node:test";
import assert from "node:assert/strict";
import { addItem, addGrade } from "./helpers/d1.js";
import { newsDb } from "./helpers/worker-env.js";
import { loadWorkerModule, sessionEnv, sessionCookie, spyDb, ORIGIN, UA } from "./helpers/portal.js";

const { imp } = await loadWorkerModule();
const portalMod = await imp("portal.js");
const todayMod = await imp("portal-today.js");
const { CALENDAR } = await imp("calendar.generated.js");
const { ops, MUTED_SQL } = await imp("tuning.js");
const { etParts, addDays } = await imp("et.js");
const { default: COVERED } = await import("../worker/src/covered.json", { with: { type: "json" } });

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed, synthetic "now": a Wednesday, 12:00 ET (EDT).
const NOW = Date.parse("2026-03-18T16:00:00.000Z");
const at = (ms) => new Date(ms).toISOString();
const ago = (ms) => at(NOW - ms);
let serial = 0;

// Opens a path through the portal router with an injected universe and clock.
async function open(env, path, { tickers = ["TST"], now = NOW, ua = UA.desktop } = {}) {
  const cookie = await sessionCookie(env, now);
  const req = new Request(`${ORIGIN}${path}`, { headers: { cookie, "user-agent": ua } });
  const res = await portalMod.portal(req, env, new URL(req.url), { tickers, muted: MUTED_SQL, feedback: () => null, now: () => now });
  return { status: res.status, text: await res.text() };
}

// The page's <h2> sections: [heading, the markup up to the next heading].
function sections(text) {
  const main = /<main>(.*)<\/main>/s.exec(text)[1];
  return main.split("<h2>").slice(1).map((s) => [s.slice(0, s.indexOf("</h2>")), s.slice(s.indexOf("</h2>") + 5)]);
}
const section = (text, name) => sections(text).find(([h]) => h === name)?.[1] ?? null;
const cardIds = (fragment) => [...String(fragment || "").matchAll(/<article class="card" id="i(\d+)"/g)].map((m) => Number(m[1]));
const strip = (text) => /<p class="meta strip"([^>]*)>/.exec(text)[1];
const dataAttr = (attrs, name) => new RegExp(`data-${name}="([^"]*)"`).exec(attrs)[1];

async function item(env, over = {}, grade = null) {
  const id = await addItem(env.DB, { ticker: "TST", title: `Synthetic item ${++serial}`, nm_first_seen: ago(HOUR), ...over });
  if (grade) await addGrade(env.DB, id, grade);
  return id;
}

// --- T-1 ---------------------------------------------------------------------------------
test("T-1: lead, digest, borderline and waiting in that order; an undated lead is a Digest; held, skipped, duplicate, muted and outside rows are absent", async () => {
  const env = sessionEnv();
  const lead = await item(env, { published: ago(2 * HOUR) }, { score: 93 });
  const digest = await item(env, { published: ago(2 * HOUR) }, { score: 75 });
  const border = await item(env, { published: ago(2 * HOUR) }, { score: 55 });
  const waiting = await item(env);
  const undated = await item(env, { published: null }, { score: 88, band: "lead" });
  const held = await item(env);
  env.DB.db.prepare("UPDATE items SET admit = 'seed_window', released_at = NULL WHERE id = ?").run(held);
  const skipped = await item(env, { state: "skipped", skip_reason: "synthetic" });
  const dup = await item(env, { published: ago(2 * HOUR) }, { score: null, band: "duplicate" });
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('synthetic_muted', 'mute', ?)").run(ago(DAY));
  const muted = await item(env, { source_key: "synthetic_muted", published: ago(2 * HOUR) }, { score: 95 });
  const outside = await item(env, { ticker: "TSTX", published: ago(2 * HOUR) }, { score: 95 });

  const r = await open(env, "/p/today");
  assert.equal(r.status, 200);
  const heads = sections(r.text).map(([h]) => h);
  const order = ["Leads", "Digest", "Borderline", "Waiting for a grade"].map((h) => heads.indexOf(h));
  assert.ok(order.every((i) => i >= 0), heads.join(", "));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in band order");
  assert.deepEqual(cardIds(section(r.text, "Leads")), [lead]);
  assert.deepEqual(cardIds(section(r.text, "Digest")), [undated, digest], "the undated stored lead shows under Digest, by score");
  assert.deepEqual(cardIds(section(r.text, "Borderline")), [border]);
  assert.deepEqual(cardIds(section(r.text, "Waiting for a grade")), [waiting]);
  const all = cardIds(r.text);
  for (const id of [held, skipped, dup, muted, outside]) assert.ok(!all.includes(id), `row ${id} is hidden`);
  assert.equal(all.length, 5);
  assert.match(r.text, /<title>Today · Zenith<\/title>/);
  assert.match(r.text, /<a href="\/p\/today" aria-current="page">Today<\/a>/);
  assert.match(r.text, /Today · Updated 12:00 ET/);
});

// --- T-2 ---------------------------------------------------------------------------------
test("T-2: range=7d includes a 5-day-old row, today excludes it, and bad or too-long ranges fall back to today", async () => {
  const env = sessionEnv();
  const old = await item(env, { nm_first_seen: ago(5 * DAY) }, { score: 75 });
  const fresh = await item(env, { nm_first_seen: ago(HOUR) }, { score: 76 });
  const active = (text) => /href="\/p\/today\?range=([a-z0-9]+)" aria-current="true"/.exec(text)?.[1] ?? null;

  const week = await open(env, "/p/today?range=7d");
  assert.deepEqual(cardIds(week.text).sort(), [old, fresh].sort());
  assert.equal(active(week.text), "7d");
  const today = await open(env, "/p/today?range=today");
  assert.deepEqual(cardIds(today.text), [fresh]);
  assert.equal(active(today.text), "today");

  const etToday = etParts(NOW).date;
  const custom = await open(env, `/p/today?start=${addDays(etToday, -6)}&end=${etToday}`);
  assert.deepEqual(cardIds(custom.text).sort(), [old, fresh].sort(), "a 7-day custom span is accepted");
  for (const q of ["start=2026-01-05&end=2026-01-03", `start=${addDays(etToday, -19)}&end=${etToday}`, "range=30d", "range=90d", "range=bogus",
    `start=${etToday}&end=${addDays(etToday, 1)}`]) {
    const r = await open(env, `/p/today?${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(active(r.text), "today", q);
    assert.deepEqual(cardIds(r.text), [fresh], q);
  }
  // Today offers presets up to 14 days only.
  assert.match(week.text, /range=14d/);
  assert.doesNotMatch(week.text, /range=30d|range=90d|range=1y/);
});

// --- T-3 ---------------------------------------------------------------------------------
function addRuns(env, runs) {
  for (const [i, r] of runs.entries()) {
    env.DB.db.prepare("INSERT INTO runs (id, started_at, last_seen_at) VALUES (?, ?, ?)").run(`run-${i}-${++serial}`, r.started_at, r.last_seen_at);
  }
}
const hourly = (lastStartAgo, n = 12, dur = 3 * MIN) =>
  Array.from({ length: n }, (_, k) => { const s = NOW - lastStartAgo - k * HOUR; return { started_at: at(s), last_seen_at: at(s + dur) }; });
const opsGrader = async (env) => (await (await ops({ ...env, NEWS: newsDb() }, { now: NOW })).json()).grader;

test("T-3: the grader status, last seen, gap and cadence equal /v1/ops on the same runs, including an overlapping run", async () => {
  const cases = {
    ok: hourly(30 * MIN),
    down: hourly(4 * HOUR),
    // An older start has the latest last_seen_at (a long run that overlapped later ones).
    overlap: [...hourly(4 * HOUR), { started_at: ago(6 * HOUR + 10 * MIN), last_seen_at: ago(3 * HOUR + 30 * MIN) }],
    never: [],
  };
  const want = { ok: "ok", down: "down", overlap: "down", never: "down" };
  for (const [name, runs] of Object.entries(cases)) {
    const env = sessionEnv();
    addRuns(env, runs);
    const g = await opsGrader(env);
    const attrs = strip((await open(env, "/p/today")).text);
    assert.equal(dataAttr(attrs, "grader"), g.status, name);
    assert.equal(g.status, want[name], name);
    assert.equal(dataAttr(attrs, "every"), String(g.expected_every_min), name);
    assert.equal(dataAttr(attrs, "gap-min"), g.open_gap ? String(g.open_gap.minutes) : "", name);
    const lastMin = g.last_run_at ? String(Math.round((NOW - Date.parse(g.last_run_at)) / MIN)) : "";
    assert.equal(dataAttr(attrs, "last-min"), lastMin, name);
    if (name === "overlap") assert.equal(lastMin, "210", "the overlapping run is the last one seen");
    if (name !== "ok" && name !== "never") assert.ok(g.open_gap, name);
  }
  const env = sessionEnv();
  addRuns(env, hourly(4 * HOUR));
  const text = (await open(env, "/p/today")).text;
  assert.match(text, /Grader down · last seen 237 min ago · gap 237 min, about \d+ runs? missed · runs every 60 min/);
});

// --- T-4 ---------------------------------------------------------------------------------
test("T-4: waiting and held equal /v1/ops coverage_pending and coverage_held, whatever the role", async () => {
  const env = sessionEnv();
  const T = COVERED.tickers[0];
  const seed = async (over, heldRow) => {
    const id = await addItem(env.DB, { ticker: T, nm_first_seen: ago(HOUR), ...over });
    if (heldRow) env.DB.db.prepare("UPDATE items SET admit = 'seed_window', released_at = NULL WHERE id = ?").run(id);
    return id;
  };
  await seed({ role: null }, true);
  await seed({ role: "customer" }, true);
  await seed({ role: "program" }, false);
  await seed({ state: "claimed" }, false);
  await seed({ ticker: "TSTX" }, false); // outside the universe: in neither count
  const backlog = (await (await ops({ ...env, NEWS: newsDb() }, { now: NOW })).json()).grader.backlog;
  assert.equal(backlog.coverage_pending, 2);
  assert.equal(backlog.coverage_held, 2);
  const r = await open(env, "/p/today", { tickers: COVERED.tickers });
  const attrs = strip(r.text);
  assert.equal(dataAttr(attrs, "waiting"), String(backlog.coverage_pending));
  assert.equal(dataAttr(attrs, "held"), String(backlog.coverage_held));
  assert.match(r.text, /2 waiting for a grade · 2 held for the daily budget/);
});

// --- T-5 ---------------------------------------------------------------------------------
test("T-5: the quiet list holds every covered name with no card at 60 or more, as company links", async () => {
  const env = sessionEnv();
  await item(env, { ticker: "TST", published: ago(HOUR) }, { score: 93 });
  await item(env, { ticker: "TSTB" }, { score: 55 });
  await item(env, { ticker: "TSTD" }, { score: 60 });
  const r = await open(env, "/p/today", { tickers: ["TST", "TSTB", "TSTC", "TSTD"] });
  const quiet = section(r.text, "Quiet in this range");
  const names = [...quiet.matchAll(/<a href="\/p\/c\/([A-Z]+)">\1<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(names, ["TSTB", "TSTC"]);
});

// --- T-6 ---------------------------------------------------------------------------------
test("T-6: Coming up lists a sheet entry dated tomorrow; one open makes exactly four statements (T1, T2, T3, W1)", async () => {
  const tomorrow = addDays(etParts(NOW).date, 1);
  const entry = { ticker: "TST", kind: "catalyst", start: tomorrow, end: tomorrow, precision: "day", text: "Synthetic catalyst <b>x</b>" };
  CALENDAR.push(entry, { ...entry, ticker: "TSTX", text: "Outside the universe" });
  try {
    const base = sessionEnv();
    await item(base, {}, { score: 75 });
    await item(base, {}, { score: 12 });
    for (const path of ["/p/today", "/p/today?rejects=1", "/p/today?range=14d", "/p/today?range=14d&rejects=1"]) {
      const spy = spyDb(base.DB);
      const env = { ...base, DB: spy };
      const r = await open(env, path);
      assert.equal(r.status, 200, path);
      assert.equal(spy.seen.length, 4, `${path}: ${spy.seen.length} statements`);
      assert.match(spy.seen[0], /FROM items i LEFT JOIN grades g/);
      assert.match(spy.seen[1], /FROM items WHERE state IN \('pending','claimed'\)/);
      assert.match(spy.seen[2], /FROM runs ORDER BY started_at DESC LIMIT 11/);
      assert.match(spy.seen[3], /INSERT INTO portal_views/);
      const coming = section(r.text, "Coming up (7 days)");
      assert.match(coming, /TST<\/a>: Synthetic catalyst &lt;b&gt;x&lt;\/b&gt;/, path);
      assert.doesNotMatch(coming, /Outside the universe/);
      assert.match(coming, /<a href="\/p\/brief">Full calendar<\/a>/);
    }
    // The same four statements when no reject is in range.
    const clean = sessionEnv();
    await item(clean, {}, { score: 75 });
    for (const path of ["/p/today", "/p/today?rejects=1"]) {
      const spy = spyDb(clean.DB);
      const r = await open({ ...clean, DB: spy }, path);
      assert.equal(r.status, 200, path);
      assert.match(r.text, /No rejects in this range/, path);
      assert.equal(spy.seen.length, 4, `${path} (no rejects): ${spy.seen.length} statements`);
    }
  } finally {
    CALENDAR.splice(CALENDAR.indexOf(entry), 2);
  }
  const elsewhere = section((await open(sessionEnv(), "/p/today")).text, "Elsewhere");
  for (const p of ["competitors", "industry", "rare"]) assert.match(elsewhere, new RegExp(`href="/p/${p}"`));
});

// --- T-7 ---------------------------------------------------------------------------------
async function bulk(env, n, score) {
  const ins = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, nm_notified, ingested_at, state)
    VALUES (?, 'src', 'TST', ?, 'Synthetic bulk', ?, 1, ?, 'graded')`);
  const gr = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, read_source, confidence, flags, graded_at)
    VALUES (?, 'TST', 'run-1', 'r-test', 'm', ?, ?, 'why', 1, 0.8, '[]', ?)`);
  const link = env.DB.db.prepare("UPDATE items SET grade_id = ? WHERE id = ?");
  const band = score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
  for (let k = 0; k < n; k++) {
    const n = ++serial;
    const id = Number(ins.run(500_000 + n, `https://example.com/b/${n}`, ago(HOUR + k * 1000), ago(HOUR)).lastInsertRowid);
    link.run(Number(gr.run(id, score, band, ago(HOUR)).lastInsertRowid), id);
  }
}

test("T-7: at most 150 cards; rejects are a count, or 50 cards with ?rejects=1; a full LIMIT with no reject reads 'not counted'", async () => {
  const env = sessionEnv();
  await bulk(env, 200, 20);
  await bulk(env, 100, 55);
  const r = await open(env, "/p/today");
  assert.equal(cardIds(r.text).length, 100);
  assert.match(r.text, /200 rejects · <a href="\/p\/today\?range=today&amp;rejects=1">Show rejects<\/a>/);
  assert.equal(section(r.text, "Rejects"), null);
  const shown = await open(env, "/p/today?rejects=1");
  assert.equal(cardIds(section(shown.text, "Rejects")).length, 50);
  assert.equal(cardIds(shown.text).length, 150);
  assert.match(shown.text, /Hide rejects/);

  const full = sessionEnv();
  await bulk(full, 500, 75);
  const f = await open(full, "/p/today");
  assert.equal(cardIds(f.text).length, 150);
  assert.match(f.text, /Rejects: not counted for this range/);
  assert.match(f.text, /Showing the first 150 of at least 400 cards/);

  const some = sessionEnv();
  await bulk(some, 390, 75);
  await bulk(some, 20, 20);
  const s = (await open(some, "/p/today")).text;
  assert.match(s, /At least 10 rejects/);
  assert.match(s, /Showing the first 150 of 390 cards/);
});

// --- T-8 ---------------------------------------------------------------------------------
test("T-8: cards label through /p/api/feedback with the grade's ticker and return to the same Today range", async () => {
  const env = sessionEnv();
  const own = await item(env, {}, { score: 75 });
  const cross = await item(env, { ticker: "TST" });
  const g = await addGrade(env.DB, cross, { ticker: "TSTB", score: 80 });
  env.DB.db.prepare("UPDATE items SET grade_id = ?, state = 'graded' WHERE id = ?").run(g, cross);
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'TSTB', ?)").run(cross, ago(MIN));
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'noise', 'TST', ?)").run(cross, ago(MIN));
  const r = await open(env, "/p/today?range=7d", { tickers: ["TST", "TSTB"] });
  const cardOf = (id) => new RegExp(`<article class="card" id="i${id}">(.*?)</article>`, "s").exec(r.text)[1];
  for (const [id, t] of [[own, "TST"], [cross, "TSTB"]]) {
    const c = cardOf(id);
    assert.match(c, /<form class="lbl" method="post" action="\/p\/api\/feedback" data-endpoint="\/p\/api\/feedback"/);
    assert.match(c, new RegExp(`data-ticker="${t}"`));
    assert.match(c, new RegExp(`<input type="hidden" name="ticker" value="${t}">`));
    assert.match(c, /<input type="hidden" name="return" value="\/p\/today\?range=7d">/);
    assert.match(c, new RegExp(`<a class="tk" href="/p/c/${t}">${t}</a>`));
  }
  assert.match(cardOf(cross), /Labelled high/, "the label given on the grade's ticker is shown");
  assert.doesNotMatch(cardOf(own), /Labelled/);
});

test("Today's card statement reads by the first-seen index and the grade's primary key", async () => {
  const env = sessionEnv();
  const plan = env.DB.db.prepare(`EXPLAIN QUERY PLAN ${todayMod.cardsSql(["TST"], MUTED_SQL)}`).all(ago(DAY), at(NOW)).map((r) => r.detail).join("\n");
  assert.match(plan, /idx_items_seen/);
  assert.match(plan, /SEARCH g USING INTEGER PRIMARY KEY/);
});
