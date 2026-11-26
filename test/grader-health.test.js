// Phase 1, Part B PR-G1: grader health in GET /v1/ops. The cadence
// (expected_every_min), missed scheduled runs (gaps_7d, open_gap), runs that
// claimed and died (last_run_unfinished, stuck_claims, stale_claims) and
// today's grades and releases. Synthetic fixtures over an in-memory zenith-db
// with the real migrations; every timestamp is relative to a fixed NOW.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";

hookJsonImports();
const { default: COVERED } = await import("../worker/src/covered.json");
const { expectedEvery, graderStatus, runGaps, openGap, ops, STUCK_CLAIM_MIN, LATE_SLACK_MIN } = await import("../worker/src/tuning.js");
const { LEASE_MINUTES } = await import("../worker/src/lib.js");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed, synthetic "now": 15:00 UTC, so "today" (UTC) has 15 hours behind it.
const NOW = Date.parse("2030-01-09T15:00:00.000Z");
const at = (ms) => new Date(ms).toISOString();
const ago = (ms) => at(NOW - ms);
const newEnv = (extra = {}) => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra });
const opsBody = async (env, now = NOW) => (await (await ops(env, { now })).json()).grader;

const OWN = Object.keys(COVERED.sources)[0];              // an own-lane (covered) source key
const OTHER = "synthetic_wire";                           // a source outside the own lane
assert.ok(!Object.prototype.hasOwnProperty.call(COVERED.sources, OTHER));

// Runs from start-to-start intervals (minutes), first start at `firstMs`, each
// lasting `dur` minutes (a number or a function of the index).
function runsFrom(intervals, firstMs, dur = 3) {
  const runs = [];
  let t = firstMs;
  const len = (k) => (typeof dur === "function" ? dur(k) : dur);
  runs.push({ started_at: at(t), last_seen_at: at(t + len(0) * MIN) });
  intervals.forEach((m, i) => {
    t += m * MIN;
    runs.push({ started_at: at(t), last_seen_at: at(t + len(i + 1) * MIN) });
  });
  return runs;
}
let runId = 0;
function addRuns(env, runs, over = {}) {
  for (const r of runs) {
    env.DB.db.prepare("INSERT INTO runs (id, started_at, last_seen_at, claimed, graded, rejected) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`run-${++runId}`, r.started_at, r.last_seen_at, r.claimed ?? over.claimed ?? 5, r.graded ?? over.graded ?? 5, r.rejected ?? over.rejected ?? 0);
  }
}
let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: OTHER, ticker: "RCAT", state: "pending", claim_id: null, claimed_until: null, nm_first_seen: ago(HOUR), ingested_at: ago(HOUR),
    admit: null, released_at: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state,
      skip_reason, claim_id, claimed_until, attempts, role, affects) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, NULL, ?, ?, 1, NULL, NULL)`)
    .run(++rowid, it.source_key, it.ticker, `https://news.example.com/c/${rowid}`, `Synthetic item ${rowid}`, it.nm_first_seen, it.nm_first_seen, it.ingested_at,
      it.state, it.claim_id, it.claimed_until);
  const id = Number(r.lastInsertRowid);
  env.DB.db.prepare("UPDATE items SET admit = ?, released_at = ? WHERE id = ?").run(it.admit, it.released_at, id);
  return id;
}
function addAux(env, over = {}) {
  const it = { source_key: OTHER, state: "pending", claim_id: null, claimed_until: null, nm_first_seen: ago(HOUR), admit: null, released_at: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, skip_reason, attempts, claim_id, claimed_until, coverage_subject, affects) VALUES (?, ?, 'synthco', 'Synthco', 'private', ?, ?, ?, NULL, ?, ?, ?,
      NULL, 1, ?, ?, 0, NULL)`)
    .run(++rowid, it.source_key, `https://news.example.com/a/${rowid}`, `Synthetic aux item ${rowid}`, it.nm_first_seen, it.nm_first_seen, it.nm_first_seen,
      it.state, it.claim_id, it.claimed_until);
  const id = Number(r.lastInsertRowid);
  env.DB.db.prepare("UPDATE aux_items SET admit = ?, released_at = ? WHERE id = ?").run(it.admit, it.released_at, id);
  return id;
}
function addGrade(env, itemId, gradedAt, { ticker = "RCAT", run = `g-${++rowid}` } = {}) {
  env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, confidence, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', 50, 'digest', 'why', '[]', 0.5, 1, ?)`).run(itemId, ticker, run, gradedAt);
}
function addAuxGrade(env, itemId, gradedAt) {
  env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, confidence, read_source, graded_at)
    VALUES (?, ?, 'Synthco', 50, 'digest', 'why', '[]', '[]', 0.5, 1, ?)`).run(itemId, `ag-${++rowid}`, gradedAt);
}
// A claim made `msAgo` before NOW holds its lease for LEASE_MINUTES.
const claimedAgo = (msAgo) => ({ state: "claimed", claim_id: "c-synthetic", claimed_until: at(NOW - msAgo + LEASE_MINUTES * MIN) });

// Minutes after `fromMs` until the status is no longer ok (scanned in seconds).
function firstNotOk(lastSeenMs, fromMs, every) {
  for (let s = 0; s <= 240 * 60; s++) if (graderStatus(at(lastSeenMs), fromMs + s * 1000, every) !== "ok") return s / 60;
  return Infinity;
}
const ONE_SEC = 1 / 60;

// Half-hourly starts at :07 and :37 (intervals 28.1-32.2 min, as measured), ending at `lastStartMs`.
const HALF = [30.0, 28.1, 31.9, 30.2, 29.8, 32.2, 28.4, 30.1, 29.9, 30.0, 31.6];
const HOURLY = [60.0, 59.2, 61.4, 62.0, 58.1, 60.3, 59.7, 60.6, 61.0, 59.4, 60.2];
const endingAt = (intervals, lastStartMs, dur = 3) => runsFrom(intervals, lastStartMs - intervals.reduce((a, b) => a + b, 0) * MIN, dur);

// --- 1-3 expectedEvery ------------------------------------------------------------------
test("expectedEvery: half-hourly starts give 30 and hourly starts give 60", () => {
  assert.equal(expectedEvery(runsFrom(HALF, NOW - DAY)), 30);
  assert.equal(expectedEvery(runsFrom(HOURLY, NOW - DAY)), 60);
  // Order of the rows does not matter.
  assert.equal(expectedEvery(runsFrom(HALF, NOW - DAY).reverse()), 30);
  // Only the last 10 usable intervals count: an hourly past then 10 half-hourly intervals gives 30.
  assert.equal(expectedEvery(runsFrom([...HOURLY, ...HALF.slice(0, 10)], NOW - 2 * DAY)), 30);
});

test("expectedEvery ignores a start 0.7 min after another and a 7-min extra start", () => {
  // Half-hourly with two extra starts (0.7 min and 7.1 min after a regular one).
  assert.equal(expectedEvery(runsFrom([30, 30, 0.7, 29.3, 30, 7.1, 22.9, 30, 30, 30, 30], NOW - DAY)), 30);
  // Short intervals are dropped, not counted: with them the lower median would be 7.1 (clamped to 30).
  assert.equal(expectedEvery(runsFrom([0.7, 7.1, 0.7, 7.1, 0.7, 60, 60, 60], NOW - DAY)), 60);
  assert.equal(expectedEvery(runsFrom([0.7, 7.1, 0.7, 7.1, 60, 60], NOW - DAY)), 60, "two usable intervals: the default");
  // Outages (over 90 min) are not cadence either.
  assert.equal(expectedEvery(runsFrom([30, 30, 600, 30, 900, 30], NOW - 2 * DAY)), 30);
});

test("expectedEvery: fewer than 3 usable intervals gives 60; GRADER_EVERY_MIN=45 overrides; 5 or \"x\" is ignored", () => {
  assert.equal(expectedEvery(runsFrom([47.5, 59.7], NOW - DAY)), 60, "the start-up case gives 60, not 48");
  assert.equal(expectedEvery(runsFrom([30, 30], NOW - DAY)), 60);
  assert.equal(expectedEvery([]), 60);
  assert.equal(expectedEvery(runsFrom([], NOW)), 60);
  assert.equal(expectedEvery(runsFrom([47.5, 59.7, 60.3], NOW - DAY)), 60);
  // The lower median is clamped to 30-60.
  assert.equal(expectedEvery(runsFrom([15, 15, 15, 15], NOW - DAY)), 30);
  assert.equal(expectedEvery(runsFrom([85, 85, 85], NOW - DAY)), 60);
  const half = runsFrom(HALF, NOW - DAY);
  assert.equal(expectedEvery(half, { GRADER_EVERY_MIN: "45" }), 45);
  assert.equal(expectedEvery(half, { GRADER_EVERY_MIN: 45 }), 45);
  assert.equal(expectedEvery([], { GRADER_EVERY_MIN: "120" }), 120);
  for (const bad of ["5", "x", "14", "121", "45.5", "", " ", "-30", null]) assert.equal(expectedEvery(half, { GRADER_EVERY_MIN: bad }), 30, String(bad));
});

// --- 4 graderStatus -----------------------------------------------------------------------
test("graderStatus every=30: 49 min ok, 51 late, 181 down; every=60: 79 ok, 81 late, 179 late", () => {
  const s = (minAgo, every) => graderStatus(ago(minAgo * MIN), NOW, every);
  assert.equal(s(49, 30), "ok");
  assert.equal(s(50, 30), "ok");
  assert.equal(s(51, 30), "late");
  assert.equal(s(180, 30), "late");
  assert.equal(s(181, 30), "down");
  assert.equal(s(79, 60), "ok");
  assert.equal(s(81, 60), "late");
  assert.equal(s(179, 60), "late");
  assert.equal(s(181, 60), "down");
  assert.equal(graderStatus(ago(79 * MIN), NOW), "ok", "60 is the default");
  assert.equal(graderStatus(ago(81 * MIN), NOW), "late");
  assert.equal(graderStatus(null, NOW, 30), "down");
  assert.equal(graderStatus("not a date", NOW, 30), "down");
  // The largest normal intervals (32.2 half-hourly, 62.0 hourly) stay ok.
  assert.equal(s(32.2, 30), "ok");
  assert.equal(s(62.0, 60), "ok");
  assert.equal(LATE_SLACK_MIN, 20);
});

// --- 5-6 exit test: a gap shows within an hour -----------------------------------------------
test("a single missed :37 run turns the status late 20-26 min after the missed start", async () => {
  const lastStart = Date.parse("2030-01-09T14:07:00.000Z");
  const missed = lastStart + 30 * MIN;                      // the :37 run never starts
  for (const dur of [1, 6]) {                               // last activity at :08 .. :13
    const runs = endingAt(HALF, lastStart, dur);
    const every = expectedEvery(runs);
    assert.equal(every, 30);
    const m = firstNotOk(lastStart + dur * MIN, missed, every);
    assert.ok(m >= 20 && m <= 26 + ONE_SEC, `late ${m} min after the missed start (last activity :${String(7 + dur).padStart(2, "0")})`);
  }
  // The same through GET /v1/ops.
  const env = newEnv();
  addRuns(env, endingAt(HALF, lastStart, 6));
  const before = await opsBody(env, missed + 19 * MIN);
  assert.equal(before.status, "ok");
  assert.equal(before.open_gap, null);
  const after = await opsBody(env, missed + 27 * MIN);
  assert.equal(after.expected_every_min, 30);
  assert.equal(after.status, "late");
  assert.deepEqual(after.open_gap, { from: at(lastStart + 6 * MIN), minutes: 51, missed_runs: 1, expected_every_min: 30 });
});

test("two missed half-hourly runs and one missed hourly run each show late within 60 min of the first missed start", async () => {
  // Half-hourly: :37 and :07 missed; last activity at :13.
  const lastStart = Date.parse("2030-01-09T13:07:00.000Z");
  const firstMissed = lastStart + 30 * MIN;
  const half = endingAt(HALF, lastStart, 6);
  const m = firstNotOk(lastStart + 6 * MIN, firstMissed, expectedEvery(half));
  assert.ok(m <= 60, `half-hourly: late ${m} min after the first missed start`);
  // It stays late through the second missed start and past it.
  for (const after of [m, 30, 45, 60]) assert.notEqual(graderStatus(at(lastStart + 6 * MIN), firstMissed + after * MIN, 30), "ok");
  const env = newEnv();
  addRuns(env, half);
  const g = await opsBody(env, firstMissed + 59 * MIN);     // just before the third start is due
  assert.equal(g.status, "late");
  assert.equal(g.open_gap.missed_runs, 2);

  // Hourly: the next :07 run is missed; last activity at :12.
  const hourStart = Date.parse("2030-01-09T13:07:00.000Z");
  const hourly = endingAt(HOURLY, hourStart, 5);
  assert.equal(expectedEvery(hourly), 60);
  const h = firstNotOk(hourStart + 5 * MIN, hourStart + 60 * MIN, 60);
  assert.ok(h <= 60, `hourly: late ${h} min after the missed start`);
  assert.ok(h > 25 && h <= 25 + ONE_SEC, String(h));
  const env2 = newEnv();
  addRuns(env2, hourly);
  const g2 = await opsBody(env2, hourStart + 60 * MIN + 30 * MIN);
  assert.equal(g2.expected_every_min, 60);
  assert.equal(g2.status, "late");
  assert.equal(g2.open_gap.missed_runs, 1);
});

// --- 7-8 runGaps ---------------------------------------------------------------------------
test("runGaps lists a single missed run at the 30-min cadence with missed_runs 1", () => {
  const runs = runsFrom([...HALF, 60.0, 30.0, 29.5], NOW - DAY, 5);
  const gaps = runGaps(runs, at(NOW - 7 * DAY));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].missed_runs, 1);
  assert.equal(gaps[0].expected_every_min, 30);
  assert.equal(gaps[0].from, runs[HALF.length].last_seen_at);
  assert.equal(gaps[0].to, runs[HALF.length + 1].started_at);
  assert.equal(gaps[0].hours, 0.9);
  // A gap that ends before `since` is not listed.
  assert.deepEqual(runGaps(runs, at(NOW)), []);
});

test("runGaps replay: three outages give exactly three gaps; no gap at the cadence change or at start-up", () => {
  // Hourly starts at :07-:10 with a start-up of 47.5, 59.7 and 60.3 min, then
  // outages of 15.6 h, 21.0 h and 11.1 h (last activity to the next start),
  // then half-hourly starts.
  const runs = [];
  let t = Date.parse("2030-01-01T00:45:00.000Z");
  const push = (start, dur = 3) => { runs.push({ started_at: at(start), last_seen_at: at(start + dur * MIN) }); t = start; };
  push(t);
  for (const m of [47.5, 59.7, 60.3]) push(t + m * MIN, 2);
  const hourly = (n) => { for (let i = 0; i < n; i++) push(t + [60, 61, 59, 62, 58, 60.5][i % 6] * MIN, 1 + (i % 5)); };
  const outage = (minutes) => push(Date.parse(runs.at(-1).last_seen_at) + minutes * MIN, 3);
  hourly(8);
  outage(15.6 * 60);
  hourly(14);
  outage(21.0 * 60);
  hourly(9);
  outage(11.1 * 60);
  hourly(12);
  for (let i = 0; i < 24; i++) push(t + [30, 28.1, 32.2, 29.4][i % 4] * MIN, 1 + (i % 4));
  const gaps = runGaps(runs, at(Date.parse(runs[0].started_at)));
  assert.deepEqual(gaps.map((g) => g.hours), [15.6, 21.0, 11.1]);
  assert.deepEqual(gaps.map((g) => g.missed_runs), [15, 20, 10]);
  assert.deepEqual(gaps.map((g) => g.expected_every_min), [60, 60, 60]);
  // The same history ends half-hourly: the cadence is 30 there.
  assert.equal(expectedEvery(runs), 30);
});

// --- 9-14 GET /v1/ops ----------------------------------------------------------------------------
test("ops: open_gap is set while the grader is down and status is late, and gaps_7d still holds only closed gaps", async () => {
  const env = newEnv();
  // Half-hourly with one closed missed run, then nothing for 2 h.
  const runs = runsFrom([...HALF, 60.0, 30.0, 30.0, 30.0], NOW - 2 * HOUR - 13.5 * 30 * MIN - 60 * MIN, 4);
  addRuns(env, runs);
  const last = runs.at(-1);
  const now = Date.parse(last.last_seen_at) + 2 * HOUR;
  const g = await opsBody(env, now);
  assert.equal(g.expected_every_min, 30);
  assert.equal(g.status, "late");
  assert.equal(g.gaps_7d.length, 1, "only the closed gap");
  assert.ok(g.gaps_7d.every((x) => x.to <= last.started_at));
  assert.deepEqual(g.open_gap, { from: last.last_seen_at, minutes: 120, missed_runs: 4, expected_every_min: 30 });
  assert.equal(openGap(last, now, 30).missed_runs, 4);

  const down = await opsBody(env, Date.parse(last.last_seen_at) + 4 * HOUR);
  assert.equal(down.status, "down");
  assert.equal(down.open_gap.minutes, 240);
  assert.equal(down.open_gap.missed_runs, 8);
  assert.equal(down.gaps_7d.length, 1);

  const ok = await opsBody(env, Date.parse(last.last_seen_at) + 10 * MIN);
  assert.equal(ok.status, "ok");
  assert.equal(ok.open_gap, null);
  // No run at all: down, no open gap to describe.
  const empty = await opsBody(newEnv());
  assert.equal(empty.status, "down");
  assert.equal(empty.open_gap, null);
  assert.equal(empty.expected_every_min, 60);
  assert.equal(empty.last_run_unfinished, false);
});

test("ops: the cadence uses the last 11 runs whatever their age, and GRADER_EVERY_MIN", async () => {
  const env = newEnv();
  // Half-hourly runs that ended 30 days ago: a long outage keeps the cadence.
  addRuns(env, endingAt(HALF, NOW - 30 * DAY));
  const g = await opsBody(env);
  assert.equal(g.expected_every_min, 30);
  assert.equal(g.status, "down");
  assert.equal(g.gaps_7d.length, 0, "the outage is still open");
  env.GRADER_EVERY_MIN = "60";
  assert.equal((await opsBody(env)).expected_every_min, 60);
});

test("ops: last_run_unfinished is true for coverage claims not returned after 15 min, never for aux claims alone", async () => {
  assert.equal(STUCK_CLAIM_MIN, 15);
  const fresh = endingAt(HALF, NOW - 5 * MIN, 2);
  // 2 coverage items claimed 20 min ago and not returned (the claimed-2-returned-0 case).
  const a = newEnv();
  addRuns(a, endingAt(HALF, NOW - 20 * MIN, 0), { claimed: 2, graded: 0 });
  addItem(a, claimedAgo(20 * MIN));
  addItem(a, claimedAgo(20 * MIN));
  const ga = await opsBody(a);
  assert.equal(ga.status, "ok", "the claim itself was activity");
  assert.equal(ga.last_run_unfinished, true);
  assert.deepEqual(ga.backlog.stuck_claims, { coverage: 2, aux: 0 });
  // The same at 10 min: still a normal run.
  const b = newEnv();
  addRuns(b, endingAt(HALF, NOW - 10 * MIN, 0), { claimed: 2, graded: 0 });
  addItem(b, claimedAgo(10 * MIN));
  addItem(b, claimedAgo(10 * MIN));
  assert.equal((await opsBody(b)).last_run_unfinished, false);

  // A multi-ticker partial death: the run claimed 40, its graded counter is 44
  // across 20 items, and the other 20 have been claimed for 16 min.
  const c = newEnv();
  addRuns(c, fresh.slice(0, -1));
  addRuns(c, [{ ...fresh.at(-1), claimed: 40, graded: 44, rejected: 0 }]);
  for (let i = 0; i < 20; i++) {
    const id = addItem(c, { state: "graded" });
    addGrade(c, id, ago(14 * MIN), { ticker: "RCAT" });
    if (i < 4) addGrade(c, id, ago(14 * MIN), { ticker: "AXON" });
  }
  for (let i = 0; i < 20; i++) addItem(c, claimedAgo(16 * MIN));
  const gc = await opsBody(c);
  assert.ok(gc.last_run.graded >= gc.last_run.claimed, "the run counters look healthy");
  assert.equal(gc.status, "ok");
  assert.equal(gc.last_run_unfinished, true);
  assert.equal(gc.backlog.stuck_claims.coverage, 20);

  // Only aux items stuck (routine: the next aux claim retakes them).
  const d = newEnv();
  addRuns(d, fresh);
  for (let i = 0; i < 13; i++) addAux(d, claimedAgo(60 * MIN));
  const gd = await opsBody(d);
  assert.equal(gd.last_run_unfinished, false);
  assert.deepEqual(gd.backlog.stuck_claims, { coverage: 0, aux: 13 });
  assert.deepEqual(gd.backlog.stale_claims, { coverage: 0, aux: 13 });
  assert.equal(gd.open_gap, null);
});

test("ops: stuck_claims and stale_claims count both tables; a live claim under 15 min old is neither", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  for (const add of [addItem, addAux]) {
    add(env, claimedAgo(LEASE_MINUTES * MIN + 5 * MIN));   // lease expired: stuck and stale
    add(env, claimedAgo(20 * MIN));                         // not returned after 20 min: stuck
    add(env, claimedAgo(5 * MIN));                          // a live run: neither
    add(env, claimedAgo(14 * MIN));                         // still under 15 min: neither
    add(env);                                               // pending: neither
  }
  const g = await opsBody(env);
  assert.deepEqual(g.backlog.stuck_claims, { coverage: 2, aux: 2 });
  assert.deepEqual(g.backlog.stale_claims, { coverage: 1, aux: 1 });
  assert.equal(g.last_run_unfinished, true);
});

test("ops: grades_today classes a re-grade, a budgeted first grade, a fast-path grade and an own-lane grade once each; same-timestamp multi-ticker grades are not re-grades", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  const today = (h) => ago(h * HOUR);                       // NOW is 15:00 UTC
  // A re-grade: graded yesterday, requeued and graded again today.
  const r = addItem(env, { state: "graded" });
  addGrade(env, r, ago(20 * HOUR));
  addGrade(env, r, today(2));
  // A re-grade of a budgeted row is still a re-grade, counted once.
  const rb = addItem(env, { state: "graded", admit: "seed_fresh", released_at: ago(3 * HOUR) });
  addGrade(env, rb, today(3));
  addGrade(env, rb, today(1));
  // Budgeted first grades: a released row and a row admitted earlier.
  addGrade(env, addItem(env, { state: "graded", admit: "record_late", released_at: ago(4 * HOUR) }), today(4));
  addGrade(env, addItem(env, { state: "graded", admit: "rescue", released_at: null }), today(4));
  // Fast path: one plain row, and one submit's grades for two tickers at one timestamp.
  addGrade(env, addItem(env, { state: "graded" }), today(5));
  const multi = addItem(env, { state: "graded" });
  addGrade(env, multi, today(6), { ticker: "RCAT", run: "same-submit" });
  addGrade(env, multi, today(6), { ticker: "AXON", run: "same-submit" });
  // Own lane: a covered source's fast-path row.
  addGrade(env, addItem(env, { state: "graded", source_key: OWN }), today(7));
  // Yesterday's grade only: not today.
  addGrade(env, addItem(env, { state: "graded" }), ago(16 * HOUR));
  // Auxiliary: a re-grade, a budgeted grade and a fast-path grade.
  const ar = addAux(env, { state: "graded", source_key: "synthetic_aux" });
  addAuxGrade(env, ar, ago(18 * HOUR));
  addAuxGrade(env, ar, today(1));
  addAuxGrade(env, addAux(env, { state: "graded", source_key: "synthetic_aux", admit: "seed_fresh", released_at: ago(2 * HOUR) }), today(1));
  addAuxGrade(env, addAux(env, { state: "graded", source_key: "synthetic_aux" }), today(1));

  const g = (await opsBody(env)).grades_today;
  assert.deepEqual(g.coverage, { n: 9, regrade: 2, budgeted: 3, fast_path: 4, own_lane: 1 });
  assert.equal(g.coverage.regrade + g.coverage.budgeted + g.coverage.fast_path, g.coverage.n);
  assert.deepEqual(g.aux, { n: 3, regrade: 1, budgeted: 1, fast_path: 1, own_lane: 0 });
  assert.deepEqual(g.top_sources, [{ source_key: OTHER, n: 8 }, { source_key: "synthetic_aux", n: 3 }, { source_key: OWN, n: 1 }]);
  // The day boundary is 00:00 UTC of `now`.
  const next = (await opsBody(env, Date.parse("2030-01-10T01:00:00.000Z"))).grades_today;
  assert.deepEqual(next.coverage, { n: 0, regrade: 0, budgeted: 0, fast_path: 0, own_lane: 0 });
  assert.deepEqual(next.top_sources, []);
});

test("ops: released_by_source_today lists per-source releases with the per_source cap", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  const rel = (add, key, n, when = ago(HOUR)) => { for (let i = 0; i < n; i++) add(env, { source_key: key, admit: "seed_fresh", released_at: when }); };
  rel(addItem, "synthetic_a", 4);
  rel(addItem, "synthetic_b", 3);
  rel(addItem, "synthetic_c", 1);
  rel(addAux, "synthetic_d", 2);
  rel(addAux, "synthetic_a", 0);
  rel(addItem, "synthetic_e", 1);
  rel(addItem, "synthetic_f", 1);
  rel(addItem, "synthetic_g", 5, ago(20 * HOUR));           // released yesterday
  const b = (await opsBody(env)).backlog;
  assert.equal(b.released_today, 12);
  assert.deepEqual(b.released_by_source_today, [
    { source_key: "synthetic_a", n: 4, per_source: 5 },
    { source_key: "synthetic_b", n: 3, per_source: 5 },
    { source_key: "synthetic_d", n: 2, per_source: 5 },
    { source_key: "synthetic_c", n: 1, per_source: 5 },
    { source_key: "synthetic_e", n: 1, per_source: 5 },
  ]);
  assert.ok(b.released_by_source_today.every((x) => x.n <= x.per_source));
  env.GATE_BUDGET_PER_SOURCE = "4";
  assert.ok((await opsBody(env)).backlog.released_by_source_today.every((x) => x.per_source === 4));
  assert.deepEqual((await opsBody(newEnv())).backlog.released_by_source_today, []);
});

test("ops: a full budget day (20 released, at most 4 per source) adds up to released_today", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  const rel = (add, key, n) => { for (let i = 0; i < n; i++) add(env, { source_key: key, admit: "seed_fresh", released_at: ago(HOUR) }); };
  rel(addItem, "synthetic_a", 4);
  rel(addItem, "synthetic_b", 3);
  rel(addAux, "synthetic_b", 1);
  rel(addItem, "synthetic_c", 4);
  rel(addAux, "synthetic_d", 4);
  rel(addItem, "synthetic_e", 2);
  rel(addAux, "synthetic_e", 2);
  const b = (await opsBody(env)).backlog;
  assert.equal(b.released_today, 20);
  const list = b.released_by_source_today;
  assert.equal(list.length, 5);
  assert.equal(Math.max(...list.map((x) => x.n)), 4);
  assert.ok(list.every((x) => x.n <= x.per_source));
  assert.equal(list.reduce((s, x) => s + x.n, 0), b.released_today, "with 5 sources the per-source counts add up to released_today");
});

test("ops: the oldest waiting coverage row is dated by its release, else its ingest", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  addItem(env, { ingested_at: ago(3 * HOUR) });
  addItem(env, { ingested_at: ago(30 * DAY), nm_first_seen: ago(30 * DAY), admit: "record_late", released_at: ago(2 * HOUR) });
  addItem(env, { ingested_at: ago(10 * HOUR), admit: "record_late", released_at: null });   // still held: not waiting
  addItem(env, { ingested_at: ago(20 * HOUR), state: "graded" });
  addItem(env, { ingested_at: ago(20 * HOUR), ticker: "ZZZZ" });                           // not in the universe
  assert.equal((await opsBody(env)).backlog.oldest_coverage_waiting_at, ago(3 * HOUR));
  assert.equal((await opsBody(newEnv())).backlog.oldest_coverage_waiting_at, null);
});

test("ops: every statement is a SELECT with at most 3 bound parameters, and nothing is fetched", async () => {
  const env = newEnv();
  addRuns(env, endingAt(HALF, NOW - 5 * MIN));
  addItem(env, claimedAgo(20 * MIN));
  addAux(env, claimedAgo(20 * MIN));
  addGrade(env, addItem(env, { state: "graded", source_key: OWN }), ago(HOUR));
  const seen = [];
  for (const [name, db] of [["DB", env.DB], ["NEWS", env.NEWS]]) {
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const entry = { db: name, sql, params: 0 };
      seen.push(entry);
      const stmt = prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...args) => { entry.params = args.length; return bind(...args); };
      return stmt;
    };
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("ops must not fetch"); };
  try {
    const g = await opsBody(env);
    assert.equal(g.last_run_unfinished, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seen.length > 10);
  for (const s of seen) {
    assert.match(s.sql, /^\s*SELECT\b/i, s.sql);
    assert.doesNotMatch(s.sql, /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i, s.sql);
    assert.ok(s.params <= 3, `${s.params} parameters: ${s.sql}`);
  }
  assert.ok(seen.every((s) => s.db === "DB"), "news-monitor-db is not read by /v1/ops");
});

// --- Phase 3 PR-PA2: the grader-health functions live in an import-free module ----------------
// (grader-health.js), so the portal reads them without reaching tuning.js; tuning.js
// re-exports each one, so every existing importer sees the very same function.
test("grader-health.js imports nothing, and tuning.js re-exports every moved name unchanged", async () => {
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../worker/src/grader-health.js", import.meta.url), "utf8");
  assert.doesNotMatch(code, /^\s*import\s/m, "grader-health.js has no import line");
  assert.doesNotMatch(code, /\bfrom\s+["']/, "grader-health.js has no from clause");
  const gh = await import("../worker/src/grader-health.js");
  const tuning = await import("../worker/src/tuning.js");
  const moved = ["OPS_LATE_MIN", "LATE_SLACK_MIN", "EVERY_DEFAULT_MIN", "EVERY_MIN_CLAMP", "EVERY_WINDOW", "EVERY_MIN_INTERVALS",
    "EVERY_IGNORE", "expectedEvery", "runGaps", "graderStatus", "openGap"];
  for (const name of moved) {
    assert.ok(name in gh, `${name} is exported by grader-health.js`);
    assert.equal(tuning[name], gh[name], `${name} from tuning.js is the grader-health.js export`);
  }
  assert.deepEqual(Object.keys(gh).sort(), [...moved].sort(), "grader-health.js exports exactly the moved names");
  assert.equal(tuning.STUCK_CLAIM_MIN, 15, "STUCK_CLAIM_MIN stays in tuning.js");
  assert.ok(!("STUCK_CLAIM_MIN" in gh));
});
