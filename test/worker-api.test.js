// zenith-core routes end to end over an in-memory D1 (migrations 0001-0005):
// grade checks through the API, labels against the shown grade, the app
// token's reach, feed order, the requeue modes and excerpt retries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
