// zenith-core routes end to end over an in-memory D1 (migrations 0001-0005):
// grade checks through the API, labels against the shown grade, the app
// token's reach, feed order, the requeue modes and excerpt retries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const SEC = JSON.parse(readFileSync(new URL("./fixtures/sec-filings.json", import.meta.url), "utf8")).pages;

const HOUR = 3_600_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: "Red Cat news", published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, excerpt, excerpt_status, role, affects)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?)`).run(rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(),
    it.state, it.excerpt ?? null, it.excerpt_status ?? null, it.role ?? null, it.affects ?? null);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: "RCAT", run_id: "run-1", score: 80, band: "digest", flags: ["reason:material"], graded_at: iso(), primary: true, ...over };
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, 'why', ?, 0, ?)`).run(itemId, g.ticker, g.run_id, g.score, g.band, JSON.stringify(g.flags), g.graded_at);
  const id = Number(r.lastInsertRowid);
  if (g.primary) env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(id, itemId);
  return id;
}
const newEnv = (extra = {}) => ({ DB: zenithDb(), ...TOKENS, ...extra });

test("the app token reaches feed, stats and feedback only", async () => {
  const env = newEnv();
  for (const path of ["/v1/rubric", "/v1/rubric/RCAT", "/v1/labels", "/v1/recent?ticker=RCAT"]) {
    assert.equal((await request(worker, env, "GET", path, { role: "app" })).status, 403, path);
  }
  assert.equal((await request(worker, env, "GET", "/v1/feed", { role: "app" })).status, 200);
  assert.equal((await request(worker, env, "GET", "/v1/stats", { role: "app" })).status, 200);
  const id = addItem(env);
  addGrade(env, id);
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "high" } })).status, 200);
  // The grader keeps the rubric and labels.
  assert.equal((await request(worker, env, "GET", "/v1/labels", { role: "grader" })).status, 200);
  assert.equal((await request(worker, env, "GET", "/v1/rubric", { role: "grader" })).status, 200);
});

test("claims show the age at first sighting; the API enforces floors, the SEC cap and the investor-day flag", async () => {
  const env = newEnv();
  const aur = addItem(env, { source_key: "aurora", ticker: "AUR", title: "Aurora Announces Third Quarter 2026 Results", published: "2026-10-28T20:05:00Z", nm_first_seen: "2026-10-28T20:12:00Z" });
  const mstr = addItem(env, { source_key: "strategy", ticker: "MSTR", title: "Strategy to Host Live Q&A with Investors Featuring Michael Saylor and Phong Le" });
  const mbai = addItem(env, { source_key: "edgar_mbai", ticker: "MBAI", title: "MBody AI: 6-K filed 2026-11-12", url: "https://www.sec.gov/Archives/edgar/data/1610590/000161059026000071/f6k.htm" });
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: "run-a" } })).body;
  assert.equal(claim.items.length, 3);
  assert.equal(claim.items.find((i) => i.item_id === aur).seen_after_days, 0);
  const g = (item_id, over) => ({ item_id, score: 80, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material"], ...over });
  const res = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-a", grades: [
    g(aur, { score: 75, flags: ["reason:primary_source", "late_first_sighting"] }),
    g(mstr, { score: 75, flags: ["reason:calendar_card", "floor:investor_day"] }),
    g(mbai, { score: 65, read_source: false, flags: ["reason:primary_source"] }),
  ] } })).body;
  assert.equal(res.accepted, 1);
  assert.deepEqual(res.rejected.map((r) => r.item_id).sort(), [aur, mstr].sort());
  assert.match(res.rejected.find((r) => r.item_id === aur).error, /not from grading time/);
  assert.match(res.rejected.find((r) => r.item_id === mstr).error, /investor or analyst day/);
  assert.deepEqual(res.results[0], { item_id: mbai, ticker: "MBAI", score: 55, band: "borderline" });
  // Fixed: AUR at its results floor is accepted.
  const fixed = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-a", grades: [
    g(aur, { score: 75, flags: ["reason:material", "floor:results"] }),
  ] } })).body;
  assert.match(fixed.rejected[0].error, /below floor:results \(80/);
  assert.equal((await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-a", grades: [
    g(aur, { score: 80, flags: ["reason:material", "floor:results"] }),
  ] } })).body.accepted, 1);
});

test("labels are recorded against the grade shown, and directional labels need a score", async () => {
  const env = newEnv();
  const id = addItem(env, { title: "Red Cat and Unusual Machines sign supply deal" });
  const primary = addGrade(env, id, { ticker: "RCAT", score: 72 });
  const cross = addGrade(env, id, { ticker: "UMAC", score: 85, band: "digest", primary: false });
  // Default: the primary grade.
  let r = await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "medium" } });
  assert.deepEqual([r.status, r.body.grade_id, r.body.ticker], [200, primary, "RCAT"]);
  // By ticker: that ticker's grade, as the feed shows it.
  r = await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "too_high", ticker: "umac" } });
  assert.deepEqual([r.status, r.body.grade_id, r.body.ticker], [200, cross, "UMAC"]);
  // By grade_id, which must belong to the item and match a given ticker.
  r = await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "high", grade_id: cross } });
  assert.equal(r.body.ticker, "UMAC");
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "high", grade_id: cross, ticker: "RCAT" } })).status, 400);
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "high", grade_id: 9999 } })).status, 404);
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "high", ticker: "ONDS" } })).status, 404);
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: id, label: "sideways" } })).status, 400);
  // too_high / too_low on an ungraded item has nothing to compare against.
  const ungraded = addItem(env);
  assert.equal((await request(worker, env, "POST", "/v1/feedback", { role: "app", body: { item_id: ungraded, label: "too_low" } })).status, 400);
  // The feed shows each ticker's own label.
  const rcatFeed = (await request(worker, env, "GET", "/v1/feed?ticker=RCAT", { role: "app" })).body.items.find((i) => i.item_id === id);
  const umacFeed = (await request(worker, env, "GET", "/v1/feed?ticker=UMAC", { role: "app" })).body.items.find((i) => i.item_id === id);
  assert.equal(rcatFeed.label, "medium");
  assert.equal(umacFeed.label, "high");
  assert.equal(umacFeed.grade_id, cross);
  const unl = (await request(worker, env, "GET", "/v1/feed?ticker=UMAC&unlabeled=1", { role: "app" })).body.items;
  assert.ok(!unl.some((i) => i.item_id === id));
  // The grader sees the latest label per item and ticker, with that ticker's scores.
  const labels = (await request(worker, env, "GET", "/v1/labels", { role: "grader" })).body.labels;
  assert.deepEqual(labels.map((l) => [l.ticker, l.label, l.graded_score, l.current_score]).sort(),
    [["RCAT", "medium", 72, 72], ["UMAC", "high", 85, 85]]);
});

test("feed: recent Leads first, then newest; event date shown when older than first sighting", async () => {
  const env = newEnv();
  const oldLead = addItem(env, { nm_first_seen: iso(100 * HOUR) });
  addGrade(env, oldLead, { score: 92, band: "lead" });
  const lead = addItem(env, { nm_first_seen: iso(3 * HOUR) });
  addGrade(env, lead, { score: 91, band: "lead" });
  const digest = addItem(env, { nm_first_seen: iso(2 * HOUR), published: "2026-10-21T12:00:00Z" });
  addGrade(env, digest, { score: 75 });
  const pending = addItem(env, { nm_first_seen: iso(HOUR) });
  const order = (await request(worker, env, "GET", "/v1/feed", { role: "app" })).body.items.map((i) => i.item_id);
  assert.deepEqual(order, [lead, pending, digest, oldLead]);
  const items = (await request(worker, env, "GET", "/v1/feed", { role: "app" })).body.items;
  assert.equal(items.find((i) => i.item_id === digest).event_date, "2026-10-21");
  assert.equal(items.find((i) => i.item_id === pending).event_date, null);
  assert.equal(items.find((i) => i.item_id === lead).pinned, 1);
  assert.deepEqual((await request(worker, env, "GET", "/v1/feed?order=newest", { role: "app" })).body.items.map((i) => i.item_id), [pending, digest, lead, oldLead]);
  // Paging: page two continues newest-first and never repeats the pinned Lead.
  const p1 = (await request(worker, env, "GET", "/v1/feed?limit=2", { role: "app" })).body;
  assert.deepEqual(p1.items.map((i) => i.item_id), [lead, pending]);
  const p2 = (await request(worker, env, "GET", `/v1/feed?limit=2&before_id=${p1.next_before_id}`, { role: "app" })).body;
  assert.deepEqual(p2.items.map((i) => i.item_id), [digest, oldLead]);
  const onlyPinned = (await request(worker, env, "GET", "/v1/feed?limit=1", { role: "app" })).body;
  const after = (await request(worker, env, "GET", `/v1/feed?limit=5&before_id=${onlyPinned.next_before_id}`, { role: "app" })).body;
  assert.deepEqual(after.items.map((i) => i.item_id), [pending, digest, oldLead]);
});

test("feed: tickers dropped from coverage (SSTI, REKR) leave every view, cross-ticker badges included", async () => {
  const env = newEnv();
  const ssti = addItem(env, { source_key: "soundthinking", ticker: "SSTI", title: "Transom Capital Completes Acquisition of SoundThinking" });
  addGrade(env, ssti, { ticker: "SSTI", score: 95, band: "lead" });
  const rekr = addItem(env, { source_key: "rekor", ticker: "REKR", title: "Rekor Q3" });
  const rcat = addItem(env, { title: "Red Cat and Rekor team up" });
  addGrade(env, rcat, { score: 91, band: "lead" });
  addGrade(env, rcat, { ticker: "REKR", score: 80, band: "digest", primary: false });
  addGrade(env, rcat, { ticker: "ONDS", score: 75, band: "digest", primary: false });
  const ids = async (q) => (await request(worker, env, "GET", `/v1/feed${q}`, { role: "app" })).body.items.map((i) => i.item_id);
  for (const q of ["", "?min_score=70", "?min_score=90", "?state=graded&unlabeled=1", "?order=newest"]) assert.deepEqual(await ids(q), [rcat], q || "latest");
  assert.deepEqual(await ids("?ticker=SSTI"), [], "a dropped ticker cannot be asked for");
  assert.deepEqual(await ids("?ticker=REKR"), [], "nor its cross-ticker grade on a covered item");
  assert.deepEqual(await ids("?ticker=ONDS"), [rcat], "a covered cross-ticker grade still shows");
  const card = (await request(worker, env, "GET", "/v1/feed", { role: "app" })).body.items[0];
  assert.equal(card.also, "ONDS:75", "no 'also REKR' badge");
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM items WHERE id IN (?, ?)", ssti, rekr)[0].n, 2, "rows are kept, only hidden");
});

test("requeue late_flags: the 11-19 backfill grades the grading clock made late", async () => {
  const env = newEnv();
  const day = "2026-11-19T15:00:00.000Z";
  const aur = addItem(env, { ticker: "AUR", published: "2026-10-28T20:00:00Z", nm_first_seen: "2026-10-28T20:10:00Z" });
  addGrade(env, aur, { ticker: "AUR", score: 75, flags: ["reason:primary_source", "late_first_sighting"], graded_at: day });
  const staleOk = addItem(env, { published: "2026-11-01T00:00:00Z", nm_first_seen: "2026-11-02T00:00:00Z" });
  addGrade(env, staleOk, { score: 20, band: "reject", flags: ["reason:stale"], graded_at: day });
  const archive = addItem(env, { published: "2021-03-01T00:00:00Z", nm_first_seen: "2026-11-03T00:00:00Z" });
  addGrade(env, archive, { score: 2, band: "reject", flags: ["reason:stale", "archive_burst"], graded_at: day });
  const reallyOld = addItem(env, { published: "2026-09-01T00:00:00Z", nm_first_seen: "2026-11-02T00:00:00Z" });
  addGrade(env, reallyOld, { score: 20, band: "reject", flags: ["reason:stale"], graded_at: day });
  const otherDay = addItem(env, { published: "2026-11-01T00:00:00Z", nm_first_seen: "2026-11-01T01:00:00Z" });
  addGrade(env, otherDay, { score: 70, flags: ["reason:primary_source", "late_first_sighting"], graded_at: "2026-11-21T10:00:00Z" });
  const dry = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "late_flags", dry_run: true } })).body;
  assert.deepEqual(dry.items.map((i) => i.item_id).sort((a, b) => a - b), [aur, staleOk]);
  assert.equal(dry.requeued, 0);
  assert.equal(env.DB.rows("SELECT state FROM items WHERE id = ?", aur)[0].state, "graded");
  const run = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "late_flags" } })).body;
  assert.equal(run.requeued, 2);
  assert.deepEqual(env.DB.rows("SELECT id, state, attempts FROM items WHERE state = 'pending' ORDER BY id").map((r) => r.id), [aur, staleOk]);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "late_flags", graded_on: "2026-11-21" } })).body.requeued, 1);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "nope" } })).status, 400);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { role: "grader", body: { mode: "late_flags" } })).status, 403);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { item_ids: [archive] } })).body.requeued, 1);
});

test("requeue sec_excerpts: reads graded sec.gov items once CONTACT_EMAIL is set, then requeues them", async () => {
  const url = "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028.htm";
  const noContact = newEnv();
  addItem(noContact, { source_key: "edgar_aur", ticker: "AUR", url, title: "Aurora: 8-K filed 2026-10-28" });
  const refused = await request(worker, noContact, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /CONTACT_EMAIL is not set/);

  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  const graded = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url, title: "Aurora: 8-K filed 2026-10-28", excerpt_status: "skipped_sec_needs_contact" });
  addGrade(env, graded, { ticker: "AUR", score: 55, band: "borderline", flags: ["reason:primary_source", "no_figures"] });
  const dup = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url: url.replace("aur-20261028", "dup"), title: "dup" });
  env.DB.db.prepare("INSERT INTO grades (item_id, ticker, run_id, rubric_version, score, band, why, flags, graded_at) VALUES (?, 'AUR', 'r', 'v', NULL, 'duplicate', 'w', '[\"reason:duplicate\"]', ?)").run(dup, iso());
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=(SELECT MAX(id) FROM grades WHERE item_id=?) WHERE id=?").run(dup, dup);
  const company = addItem(env, { source_key: "aurora", ticker: "AUR" });
  addGrade(env, company, { ticker: "AUR" });
  const dry = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts", dry_run: true } })).body;
  assert.equal(dry.remaining, 1, "duplicates and non-SEC items are left alone");
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => new Response(SEC[String(u)] ?? "missing", { status: SEC[String(u)] ? 200 : 404, headers: { "content-type": "text/html" } });
  try {
    const r = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body;
    assert.deepEqual([r.cleared, r.processed, r.ok, r.requeued, r.remaining], [1, 1, 1, 1, 0], "the old skipped_sec_needs_contact status is cleared first");
  } finally { globalThis.fetch = real; }
  const row = env.DB.rows("SELECT state, attempts, excerpt_status, excerpt, excerpt_at FROM items WHERE id = ?", graded)[0];
  assert.equal(row.state, "pending");
  assert.equal(row.excerpt_status, "ok");
  assert.ok(row.excerpt.includes("Revenue was $3.1 million"));
  assert.ok(row.excerpt_at);
  // Nothing left: a second call reads nothing.
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body.processed, 0);
});

test("enrich: a 403 gets one later retry; sec.gov without a contact address is not a try", async () => {
  const { enrich } = await import("../worker/src/excerpt.js");
  const env = newEnv();
  const page = `<h1>Planet and Stoke Space Sign Multi-Launch Agreement</h1><p>${"Planet signed a multi-launch agreement with Stoke Space for Nova. ".repeat(6)}</p>`;
  const flaky = addItem(env, { url: "https://investors.planet.com/news/a", title: "Planet and Stoke Space Sign Multi-Launch Agreement" });
  const blocked = addItem(env, { url: "https://ir.blocked.example/news/b", title: "Blocked release title here" });
  const sec = addItem(env, { source_key: "edgar_pl", ticker: "PL", url: "https://www.sec.gov/Archives/edgar/data/1836833/000183683326000099/pl-8k.htm", title: "Planet: 8-K" });
  const real = globalThis.fetch;
  let planetCalls = 0;
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes("sec.gov")) throw new Error("sec.gov must not be fetched without CONTACT_EMAIL");
    if (url.includes("planet") && ++planetCalls === 1) return new Response("denied", { status: 403 });
    if (url.includes("blocked")) return new Response("denied", { status: 403 });
    return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    await enrich(env);
    const row = (id) => env.DB.rows("SELECT excerpt_status, excerpt_tries, excerpt_next_at FROM items WHERE id = ?", id)[0];
    assert.deepEqual([row(flaky).excerpt_status, row(flaky).excerpt_tries], [null, 1], "first 403 waits for a retry");
    assert.deepEqual([row(sec).excerpt_status, row(sec).excerpt_tries], [null, 0], "no contact address: not a try");
    assert.ok(Date.parse(row(sec).excerpt_next_at) > Date.now() + 11 * HOUR);
    env.DB.db.prepare("UPDATE items SET excerpt_next_at = ? WHERE id IN (?, ?)").run(iso(HOUR), flaky, blocked);
    await enrich(env);
    assert.equal(row(flaky).excerpt_status, "ok");
    assert.deepEqual([row(blocked).excerpt_status, row(blocked).excerpt_tries], ["http_403", 2], "a second 403 is final");
  } finally { globalThis.fetch = real; }
});

test("grades: an SEC filing's excerpt can carry the investor-day words; calendar 72 is refused with the fix", async () => {
  const env = newEnv();
  const filing = addItem(env, { source_key: "edgar_aur", ticker: "AUR", title: "Aurora Innovation, Inc.: 8-K [Items 7.01, 9.01] filed 2026-08-20",
    url: "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000031/aur-20260820.htm", excerpt_status: "ok",
    excerpt: "Item 7.01 Regulation FD Disclosure.\nEX-99.1: Aurora to Host Analyst & Investor Day on September 23, 2026" });
  const date = addItem(env, { source_key: "aurora", ticker: "AUR", title: "Aurora to Host Third Quarter 2026 Business Review Conference Call on October 28, 2026" });
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: "run-i" } })).body;
  const g = (item_id, over) => ({ item_id, why: "w", read_source: true, confidence: 0.7, ...over });
  const res = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-i", grades: [
    g(filing, { score: 80, flags: ["reason:primary_source", "floor:investor_day"] }),
    g(date, { score: 72, flags: ["reason:calendar_card", "floor:calendar", "group:earnings_calendar"] }),
  ] } })).body;
  assert.deepEqual(res.results.map((r) => [r.item_id, r.score]), [[filing, 80]]);
  assert.match(res.rejected[0].error, /score it 75 and keep the flag/);
});

// sec_excerpts review fixes: backoff is respected, failed reads can be retried
// on request, one refresh at a time, covered tickers only.
const SEC_8K = "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028.htm";
function addGradedFiling(env, over = {}) {
  const id = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url: SEC_8K, title: "Aurora: 8-K filed 2026-10-28", ...over });
  addGrade(env, id, { ticker: over.ticker || "AUR", score: 55, band: "borderline", flags: ["reason:primary_source", "no_figures"] });
  return id;
}
async function withSecFetch(handler, run) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await run(); } finally { globalThis.fetch = real; }
}
const serveSec = async (u) => new Response(SEC[String(u)] ?? "missing", { status: SEC[String(u)] ? 200 : 404, headers: { "content-type": "text/html" } });

test("sec_excerpts: back-to-back calls wait out an item's retry backoff instead of spending its tries", async () => {
  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  const id = addGradedFiling(env);
  let calls = 0;
  await withSecFetch(async () => { calls++; return new Response("busy", { status: 503 }); }, async () => {
    const first = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body;
    assert.deepEqual([first.processed, first.retry, first.remaining, first.waiting], [1, 1, 0, 1]);
    for (let k = 0; k < 3; k++) {
      const again = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body;
      assert.deepEqual([again.processed, again.remaining, again.waiting], [0, 0, 1], "the item waits for its next try");
    }
  });
  assert.equal(calls, 1);
  const row = env.DB.rows("SELECT state, excerpt_status, excerpt_tries, excerpt_at FROM items WHERE id = ?", id)[0];
  assert.deepEqual([row.state, row.excerpt_status, row.excerpt_tries, row.excerpt_at], ["graded", null, 1, null]);
  // Once the retry is due it is read, and the item is requeued.
  env.DB.db.prepare("UPDATE items SET excerpt_next_at = ? WHERE id = ?").run(iso(HOUR), id);
  await withSecFetch(serveSec, async () => {
    const r = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body;
    assert.deepEqual([r.processed, r.ok, r.requeued, r.remaining, r.waiting], [1, 1, 1, 0, 0]);
  });
  assert.equal(env.DB.rows("SELECT state FROM items WHERE id = ?", id)[0].state, "pending");
});

test("sec_excerpts: retry_failed re-reads a filing whose last read was refused; default calls leave it", async () => {
  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  const id = addGradedFiling(env);
  env.DB.db.prepare("UPDATE items SET excerpt_status = 'http_403', excerpt_tries = 2, excerpt_at = ? WHERE id = ?").run(iso(HOUR), id);
  const notFound = addGradedFiling(env, { url: SEC_8K.replace("aur-20261028", "gone") });
  env.DB.db.prepare("UPDATE items SET excerpt_status = 'http_404', excerpt_tries = 1, excerpt_at = ? WHERE id = ?").run(iso(HOUR), notFound);
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts", dry_run: true } })).body.remaining, 0);
  const dry = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts", retry_failed: true, dry_run: true } })).body;
  assert.deepEqual(dry.next.map((n) => n.item_id), [id], "a 404 is final, not a passing refusal");
  await withSecFetch(serveSec, async () => {
    const r = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts", retry_failed: true } })).body;
    assert.deepEqual([r.cleared, r.processed, r.ok, r.requeued, r.remaining], [1, 1, 1, 1, 0]);
  });
  const row = env.DB.rows("SELECT state, excerpt_status, excerpt_tries FROM items WHERE id = ?", id)[0];
  assert.deepEqual([row.state, row.excerpt_status, row.excerpt_tries], ["pending", "ok", 1]);
});

test("sec_excerpts holds a lease: a second refresh is refused and the cron's SEC pass stands aside", async () => {
  const { enrich } = await import("../worker/src/excerpt.js");
  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  addGradedFiling(env);
  const pending = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url: SEC_8K.replace("aur-20261028", "new"), title: "Aurora: 8-K filed 2026-11-20" });
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('sec_refresh_until', ?)").run(new Date(Date.now() + 60_000).toISOString());
  let calls = 0;
  await withSecFetch(async () => { calls++; return new Response("x", { status: 404 }); }, async () => {
    const busy = await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } });
    assert.equal(busy.status, 409);
    assert.match(busy.body.error, /is running/);
    const e = await enrich(env);
    assert.equal(e.sec_deferred, true);
    assert.equal(calls, 0, "no sec.gov request while the lease is held");
    // An expired lease is taken over, and released when the refresh ends.
    env.DB.db.prepare("UPDATE meta SET value = ? WHERE key = 'sec_refresh_until'").run(iso(1000));
    assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts", limit: 1 } })).status, 200);
    assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM meta WHERE key = 'sec_refresh_until'")[0].n, 0);
    assert.equal((await enrich(env)).sec_deferred, false);
  });
  assert.ok(env.DB.rows("SELECT excerpt_status FROM items WHERE id = ?", pending)[0].excerpt_status, "the cron read it once the lease was gone");
});

test("requeue modes leave tickers dropped from coverage alone (REKR)", async () => {
  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  const day = "2026-11-19T10:00:00.000Z";
  const rekr = addItem(env, { source_key: "rekor", ticker: "REKR", published: "2026-10-27T12:00:00Z", nm_first_seen: "2026-10-27T13:00:00Z" });
  addGrade(env, rekr, { ticker: "REKR", score: 10, band: "reject", flags: ["reason:stale"], graded_at: day });
  const aur = addItem(env, { source_key: "aurora", ticker: "AUR", published: "2026-10-27T12:00:00Z", nm_first_seen: "2026-10-27T13:00:00Z" });
  addGrade(env, aur, { ticker: "AUR", score: 10, band: "reject", flags: ["reason:stale"], graded_at: day });
  const late = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "late_flags" } })).body;
  assert.deepEqual(late.items.map((i) => i.item_id), [aur]);
  assert.equal(env.DB.rows("SELECT state FROM items WHERE id = ?", rekr)[0].state, "graded");
  const filing = addGradedFiling(env, { source_key: "edgar_rekr", ticker: "REKR", title: "Rekor Systems: 8-K filed 2026-11-12" });
  let calls = 0;
  await withSecFetch(async () => { calls++; return new Response("x", { status: 404 }); }, async () => {
    const r = (await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } })).body;
    assert.deepEqual([r.processed, r.remaining, r.waiting], [0, 0, 0]);
  });
  assert.equal(calls, 0, "a dropped ticker's filing is never fetched");
  assert.equal(env.DB.rows("SELECT state FROM items WHERE id = ?", filing)[0].state, "graded");
});

test("enrich: once CONTACT_EMAIL is set, filings that only waited for it are read on the next tick", async () => {
  const { enrich } = await import("../worker/src/excerpt.js");
  const env = newEnv();
  const id = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url: SEC_8K, title: "Aurora: 8-K filed 2026-10-28" });
  await enrich(env);
  assert.ok(Date.parse(env.DB.rows("SELECT excerpt_next_at FROM items WHERE id = ?", id)[0].excerpt_next_at) > Date.now() + 11 * HOUR);
  env.CONTACT_EMAIL = "ops@example.org";
  await withSecFetch(serveSec, async () => {
    assert.equal((await enrich(env)).ok, 1);
  });
  assert.equal(env.DB.rows("SELECT excerpt_status FROM items WHERE id = ?", id)[0].excerpt_status, "ok");
});

test("feed paging returns every pinned Lead once, even when they fill several pages", async () => {
  const env = newEnv();
  const leads = [], others = [];
  for (let k = 1; k <= 10; k++) {
    const id = addItem(env, { nm_first_seen: iso(k * HOUR) });
    if (k <= 8 && k !== 4) { addGrade(env, id, { score: 95, band: "lead" }); leads.push(id); }
    else { addGrade(env, id, { score: 50, band: "borderline" }); others.push(id); }
  }
  const seen = [];
  let before = null, pages = 0;
  for (; pages < 10; pages++) {
    const r = (await request(worker, env, "GET", `/v1/feed?limit=3${before != null ? `&before_id=${before}` : ""}`, { role: "app" })).body;
    seen.push(...r.items.map((i) => i.item_id));
    if (r.next_before_id == null) break;
    before = r.next_before_id;
  }
  const desc = (a, b) => b - a;
  assert.deepEqual(seen, [...[...leads].sort(desc), ...[...others].sort(desc)], "pinned Leads first, then newest, no gaps or repeats");
  assert.equal(pages, 3);
  // A page that ends inside the pinned Leads hands back a negative cursor.
  const first = (await request(worker, env, "GET", "/v1/feed?limit=3", { role: "app" })).body;
  assert.ok(first.items.every((i) => i.pinned === 1));
  assert.equal(first.next_before_id, -first.items[2].item_id);
  // Without pinning a negative cursor is just an id bound.
  const flat = (await request(worker, env, "GET", `/v1/feed?order=newest&limit=50&before_id=${-leads[3]}`, { role: "app" })).body;
  assert.ok(flat.items.every((i) => i.item_id < leads[3]));
});

// Relations (plans/round5-expansion-approve-queue.md, A2-A3): through
// /v1/grades, dropped entries are warnings, kept ones become expansion
// candidates in a second batch after the grades commit.
test("grades: relations become expansion candidates; a bad one is a warning and the grade is still stored", async () => {
  const env = newEnv();
  const onds = addItem(env, { source_key: "ondas", ticker: "ONDS", title: "Ondas Holdings to acquire Stemme in drone deal" });
  const umac = addItem(env, { source_key: "unusual", ticker: "UMAC", title: "Unusual Machines completes acquisition of Upgrade Energy" });
  const spai = addItem(env, { source_key: "safepro", ticker: "SPAI", title: "Safe Pro Group awarded UNMAS contract" });
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: "run-r" } })).body;
  assert.equal(claim.items.length, 3);
  const g = (item_id, relations, over = {}) => ({ item_id, score: 84, why: "w", read_source: true, confidence: 0.8, flags: ["reason:material"], relations, ...over });
  const file = { claim_id: claim.claim_id, run_id: "run-r", grades: [
    g(onds, [{ type: "acquired", name: "Stemme", evidence: onds }, { type: "partner", name: "Unusual Machines", evidence: onds },
      { type: "customer", name: "https://stemme.de", evidence: onds }, { type: "acquired", name: "ARAN Defense", evidence: umac }]),
    g(umac, [{ type: "acquired", name: "Upgrade Energy", evidence: umac }]),
    g(spai, [{ type: "award", name: "UNMAS", evidence: String(spai) }]),
    g(`${onds}#UMAC`, [{ type: "partner", name: "Stemme", evidence: onds }], { ticker: "UMAC", flags: ["reason:material", "also:UMAC"] }),
  ] };
  const res = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: file })).body;
  assert.deepEqual([res.accepted, res.rejected], [4, []], "no grade is rejected for its relations");
  assert.deepEqual(res.warnings.map((w) => w.item_id), [onds, onds, onds, `${onds}#UMAC`]);
  assert.match(res.warnings[0].warning, /relation 2 "Unusual Machines" dropped: name is a covered company \(UMAC\)/);
  assert.match(res.warnings[1].warning, /relation 3 "https:\/\/stemme.de" dropped: name must be/);
  assert.match(res.warnings[2].warning, new RegExp(`relation 4 "ARAN Defense" dropped: evidence must be the item you are grading \\(${onds}\\)`));
  assert.match(res.warnings[3].warning, /never a #UMAC grade/);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM grades")[0].n, 4);
  const cand = () => Object.fromEntries(env.DB.rows("SELECT * FROM expansion_candidates").map((r) => [r.name, r]));
  let c = cand();
  assert.deepEqual(Object.keys(c).sort(), ["Stemme", "UNMAS", "Upgrade Energy"]);
  assert.deepEqual([c.Stemme.status, c.Stemme.relation, c.Stemme.subject, JSON.parse(c.Stemme.tickers), JSON.parse(c.Stemme.origins), c.Stemme.known],
    ["pending", "acquired", "ONDS", ["ONDS"], ["grader_relation"], null]);
  assert.deepEqual(JSON.parse(c.Stemme.seen), [`coverage:${onds}`]);
  const ev = JSON.parse(c.Stemme.evidence)[0];
  assert.deepEqual([ev.kind, ev.item_id, ev.title, ev.origin], ["coverage", onds, "Ondas Holdings to acquire Stemme in drone deal", "grader_relation"]);
  assert.ok(ev.url.startsWith("https://ir.example.com/n/") && ev.at);
  assert.deepEqual([c["Upgrade Energy"].status, JSON.parse(c["Upgrade Energy"].known)], ["pending", ["sheet_term:UMAC"]]);
  assert.deepEqual([c.UNMAS.status, c.UNMAS.relation, JSON.parse(c.UNMAS.known)], ["pending", "award", ["key_account:SPAI"]]);

  // Re-submitting the same file stores nothing twice and adds no sighting.
  const again = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: file })).body;
  assert.deepEqual([again.accepted, again.already_accepted, again.warnings], [0, 4, []]);
  // A regrade in a new run is a new accepted grade, but the same item adds no sighting.
  const re = (await request(worker, env, "POST", "/v1/grades", { body: { run_id: "run-s", grades: [g(onds, [{ type: "acquired", name: "Stemme AG", evidence: onds }])] } })).body;
  assert.deepEqual([re.accepted, re.warnings], [1, []]);
  c = cand();
  assert.equal(Object.keys(c).length, 3, "Stemme AG has Stemme's dedupe key");
  assert.deepEqual(JSON.parse(c.Stemme.seen), [`coverage:${onds}`], "sightings unchanged");
  assert.equal(JSON.parse(c.Stemme.evidence).length, 1);

  // Before migration 0012 (or any failed upsert) the grades are still stored, with a warning.
  env.DB.exec("DROP TABLE expansion_candidates");
  const late = (await request(worker, env, "POST", "/v1/grades", { body: { run_id: "run-t", grades: [g(umac, [{ type: "supplier", name: "Acme Motors", evidence: umac }])] } })).body;
  assert.deepEqual([late.accepted, late.rejected], [1, []]);
  assert.deepEqual(late.warnings.map((w) => w.item_id), [null]);
  assert.match(late.warnings[0].warning, /expansion queue not available yet: migration 0012 is not applied/);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM grades WHERE run_id = 'run-t'")[0].n, 1);
  assert.equal(env.DB.rows("SELECT run_id FROM grades WHERE id = (SELECT grade_id FROM items WHERE id = ?)", umac)[0].run_id, "run-t");
});

test("grades: a grade without relations gets an empty warnings list and makes no candidate", async () => {
  const env = newEnv();
  const id = addItem(env);
  const res = (await request(worker, env, "POST", "/v1/grades", { body: { run_id: "run-n", grades: [{ item_id: id, score: 50, why: "w", flags: ["reason:material"] }] } })).body;
  assert.deepEqual([res.accepted, res.warnings], [1, []]);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM expansion_candidates")[0].n, 0);
});

// Phase 2 (T12b): POST /v1/grades passes the bundled industry_links (INDUSTRY) to
// normalizeGrade. The bundled INDUSTRY has no RCAT entry, both while it is {} (before
// --promote-candidate) and after promotion (the ladder sheets only), so every
// industry:<id> flag on an RCAT item is rejected; with a synthetic INDUSTRY a declared
// id is accepted up to its ceiling (74 for a core entry, 69 otherwise). The synthetic
// map replaces whatever INDUSTRY export the bundle has, and the test checks it did.
test("grades: an industry:<id> flag is rejected under the bundled INDUSTRY and checked against a synthetic one", async () => {
  const g = (item_id, score, flag) => ({ item_id, score, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material", flag] });
  const gen = await import("../worker/src/rubric.generated.js");
  if (existsSync(new URL("../rubric/candidate", import.meta.url))) assert.deepEqual(gen.INDUSTRY, {});
  assert.equal(Object.hasOwn(gen.INDUSTRY, "RCAT"), false, "the bundled INDUSTRY has no RCAT entry");
  const env = newEnv();
  const id = addItem(env);
  const live = (await request(worker, env, "POST", "/v1/grades", { body: { run_id: "run-i", grades: [g(id, 50, "industry:rules_y")] } })).body;
  assert.equal(live.accepted, 0);
  assert.match(live.rejected[0].error, /unknown industry link rules_y for RCAT \(core\.md section 9A\)/);

  const { loadWorker } = await import("./helpers/worker.js");
  const SYN = 'export const INDUSTRY = {"RCAT":{"rules_y":{"core":true},"trade_x":{"core":false}}};';
  const INDUSTRY_LINE = /^export const INDUSTRY = [^\r\n]*;/m;
  let patchedCode = null;
  const patched = await loadWorker({ patch: (f, code) => {
    if (f !== "rubric.generated.js") return code;
    assert.equal(code.match(new RegExp(INDUSTRY_LINE.source, "gm"))?.length, 1, "the bundle has exactly one INDUSTRY export line");
    patchedCode = code.replace(INDUSTRY_LINE, SYN);
    return patchedCode;
  } });
  assert.ok(patchedCode, "the patch saw rubric.generated.js");
  assert.equal(patchedCode.match(new RegExp(INDUSTRY_LINE.source, "gm"))[0], SYN, "the synthetic INDUSTRY replaced the bundled one");
  const env2 = newEnv();
  const a = addItem(env2), b = addItem(env2), c = addItem(env2);
  const res = (await request(patched, env2, "POST", "/v1/grades", { body: { run_id: "run-j", grades: [
    g(a, 74, "industry:rules_y"), g(b, 70, "industry:trade_x"), g(c, 50, "industry:nope"),
  ] } })).body;
  assert.equal(res.accepted, 1);
  assert.deepEqual(res.results.map((r) => [r.item_id, r.score]), [[a, 74]]);
  assert.match(res.rejected.find((r) => r.item_id === b).error, /industry ladder ceiling: industry:trade_x for RCAT allows at most 69/);
  assert.match(res.rejected.find((r) => r.item_id === c).error, /unknown industry link nope for RCAT/);
});
