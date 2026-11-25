// Auxiliary names end to end, over HTTP: the Worker behind a real node:http
// server (in-memory zenith-db, a fake news-monitor-db seeded with one row of
// every routing class), the auxiliary ingest, the REAL grader CLI as child
// processes (aux-rubric, aux-claim, aux-recent, aux-submit, aux-labels) with the
// grader token, then the app's reads and labels with the app token: For You vs
// Latest, the entity filter, Unlabeled only, stats.aux, and that the coverage
// feed, stats, tables and cursor are exactly as they were before any auxiliary row.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";
import { serveWorker, runGrader, newsRows, insertNews, gradesFor } from "./helpers/aux-e2e.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { AUX_RUBRIC, AUX_RUBRIC_VERSION } = await import("../worker/src/rubric.generated.js");

const TOKEN_OF = { admin: TOKENS.ADMIN_TOKEN, grader: TOKENS.GRADER_TOKEN, app: TOKENS.APP_TOKEN };
let env, server, cwd, claim, ids;
const rows = (sql, ...args) => env.DB.rows(sql, ...args).map((r) => ({ ...r }));
async function http(method, path, role, body) {
  const r = await fetch(server.url + path, {
    method, headers: { authorization: `Bearer ${TOKEN_OF[role]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const grader = (...args) => runGrader(args, { api: server.url, token: TOKENS.GRADER_TOKEN, cwd });
const zen = (...p) => join(cwd, ".zenith", ...p);
const feedIds = async (q) => {
  const r = await http("GET", `/v1/aux/feed${q}`, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.map((i) => i.item_id);
};

// Everything a coverage reader can see: the app's feed views and stats, the
// grader's reads, and the coverage tables and meta keys.
async function coverageSnapshot() {
  const feeds = {};
  for (const q of ["", "?order=newest", "?min_score=70", "?ticker=RCAT", "?unlabeled=1&state=graded", "?order=newest&include_skipped=1"]) {
    const r = await http("GET", `/v1/feed${q}`, "app");
    assert.equal(r.status, 200);
    feeds[q] = r.body;
  }
  const { aux, ...stats } = (await http("GET", "/v1/stats", "app")).body;
  return {
    feeds, stats,
    labels: (await http("GET", "/v1/labels", "grader")).body,
    recent: (await http("GET", "/v1/recent?ticker=RCAT", "grader")).body,
    tables: Object.fromEntries(["items", "grades", "feedback", "runs"].map((t) => [t, rows(`SELECT * FROM ${t} ORDER BY rowid`)])),
    meta: rows("SELECT key, value FROM meta WHERE key NOT LIKE 'aux\\_%' ESCAPE '\\' ORDER BY key"),
  };
}
let coverageBefore;

before(async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  insertNews(news, newsRows());
  env = { DB: zenithDb(), NEWS: news, ...TOKENS };
  server = await serveWorker(worker, env);
  cwd = mkdtempSync(join(tmpdir(), "zenith-aux-e2e-"));
  // The coverage pipeline first, with one graded Lead, as a live system has.
  const cov = await http("POST", "/v1/admin/ingest", "admin", {});
  assert.equal(cov.status, 200);
  const redcat = rows("SELECT id FROM items WHERE source_key = 'redcat'")[0].id;
  const g = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, 'RCAT', 'run-cov', 'r-test', 'm', 91, 'lead', 'Army follow-on order.', '["reason:material"]', 1, ?)`).run(redcat, new Date().toISOString());
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(g.lastInsertRowid), redcat);
  coverageBefore = await coverageSnapshot();
});
after(async () => {
  await server?.close();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

test("aux ingest stores auxiliary names only: peer newsroom, runtime managed_* and ia_media_* keys; rows Coverage owns never; archive seeds skipped", async () => {
  const r = await http("POST", "/v1/admin/aux-ingest", "admin", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.scanned, newsRows().length);
  const stored = rows("SELECT source_key, entity_key, entity_name, status, state, skip_reason, excerpt_status, coverage_subject, affects FROM aux_items ORDER BY id");
  const live = stored.filter((x) => x.state === "pending");
  assert.deepEqual(live.map((x) => x.source_key),
    ["anduril", "managed_fort_robotics_news", "nga", "anduril", "ia_media_dronelife"]);
  assert.ok(live.every((x) => x.coverage_subject === 0 && x.affects === null));
  // Covered, ops and covered-duplicate keys never become auxiliary rows, and
  // (Phase 0 gates d, one pipeline per item) neither do counterparty rows
  // Coverage owns: the FPDS filter and the counterparty company channel.
  for (const key of ["redcat", "site_kodiak", "managed_draganfly_news", "fpds_pl", "skydio"]) {
    assert.ok(!stored.some((x) => x.source_key === key), `${key} is not auxiliary`);
  }
  assert.deepEqual(stored.filter((x) => x.source_key === "zoox").map((x) => [x.state, x.skip_reason]), Array(6).fill(["skipped", "archive_seed"]));
  const by = Object.fromEntries(live.map((x) => [x.source_key, x]));
  assert.deepEqual([by.managed_fort_robotics_news.entity_key, by.managed_fort_robotics_news.entity_name, by.managed_fort_robotics_news.status],
    ["fort_robotics", "Fort Robotics", "unknown"]);
  assert.deepEqual([by.ia_media_dronelife.entity_key, by.ia_media_dronelife.entity_name, by.ia_media_dronelife.status], ["media_dronelife", "Industry media", "media"]);
  assert.deepEqual([by.nga.entity_key, by.nga.status], ["nga", "program"]);
  assert.equal(live.filter((x) => x.excerpt_status === "feed").length, 1, "the Anduril release carried its text");
  // The coverage ingest took the covered row, and the aux ingest never wrote a coverage row.
  assert.ok(rows("SELECT source_key FROM items").some((x) => x.source_key === "redcat"));
  // Replaying the ingest stores nothing twice.
  assert.equal((await http("POST", "/v1/admin/aux-ingest", "admin", {})).body.inserted, 0);
});

test("grader CLI: aux-rubric writes the served rubric, aux-claim prints the batch, aux-recent lists by entity and for every entity", async () => {
  const rub = await grader("aux-rubric");
  assert.equal(rub.code, 0, rub.stderr);
  assert.match(rub.stdout, new RegExp(`^aux rubric ${AUX_RUBRIC_VERSION}: aux\\.md \\+ peers\\.md in \\.zenith/rubric/`));
  assert.equal(readFileSync(zen("rubric", "aux.md"), "utf8"), AUX_RUBRIC);
  assert.equal(readFileSync(zen("rubric", "AUX_VERSION"), "utf8"), AUX_RUBRIC_VERSION);
  assert.ok(existsSync(zen("rubric", "peers.md")));

  const c = await grader("aux-claim", "40");
  assert.equal(c.code, 0, c.stderr);
  claim = JSON.parse(readFileSync(zen("aux-claim.json"), "utf8"));
  assert.equal(claim.items.length, 5);
  assert.equal(claim.remaining, 0);
  assert.equal(claim.rubric_version, AUX_RUBRIC_VERSION);
  assert.deepEqual(claim.items.map((i) => i.source_key),
    ["ia_media_dronelife", "anduril", "nga", "managed_fort_robotics_news", "anduril"], "newest first");
  assert.match(c.stdout, new RegExp(`^aux claim ${claim.claim_id} \\(run ${claim.run_id}\\): 5 item\\(s\\), 0 more waiting\\. Rubric ${AUX_RUBRIC_VERSION}\\.`));
  // No coverage subject here: the FPDS filter's rows are Coverage-only (one pipeline per item).
  assert.equal((c.stdout.match(/COVERAGE_SUBJECT/g) || []).length, 0);
  assert.match(c.stdout, /entity=Anduril \(private\) \[anduril, private\] source=anduril /);
  assert.match(c.stdout, /entity=Fort Robotics \[fort_robotics, unknown\] source=managed_fort_robotics_news /);
  assert.match(c.stdout, /entity=Industry media \[media_dronelife, media\] source=ia_media_dronelife /);
  assert.match(c.stdout, /EXCERPT \(feed\):\nCOSTA MESA, CA/);
  assert.match(c.stdout, /untrusted source data/);
  ({ ids } = gradesFor(claim, "RCAT"));

  const one = await grader("aux-recent", "Anduril", "14");
  assert.equal(one.code, 0, one.stderr);
  assert.match(one.stdout, /^2 auxiliary item\(s\) for "Anduril" in the last 14 days:/);
  assert.match(one.stdout, new RegExp(`- item_id=${ids.lead} \\d{4}-\\d\\d-\\d\\d ungraded \\[Anduril \\(private\\)\\] Anduril raises`));
  const all = await grader("aux-recent", "-");
  assert.equal(all.code, 0, all.stderr);
  assert.match(all.stdout, /^5 auxiliary item\(s\) for every entity in the last 14 days:/);
});

test("aux-submit: contract errors are rejected with the fix and left NOT YET GRADED; the corrected file is accepted; a resubmit is idempotent", async () => {
  const zooxId = rows("SELECT id FROM aux_items WHERE source_key = 'zoox' LIMIT 1")[0].id;
  const bad = gradesFor(claim, "RCAT", { invalid: true }).grades;
  bad.push({ ...bad[1], item_id: zooxId });
  writeFileSync(join(cwd, "bad.json"), JSON.stringify(bad));
  const r1 = await grader("aux-submit", "bad.json");
  assert.equal(r1.code, 2, r1.stderr);
  assert.match(r1.stdout, /^accepted 1, already accepted 0, rejected 5/);
  assert.match(r1.stdout, new RegExp(`REJECTED item ${ids.lead}: band must be "lead" for score 92`));
  assert.match(r1.stdout, new RegExp(`REJECTED item ${ids.fort}: reads_through ticker TSLA is not a covered ticker`));
  assert.match(r1.stdout, new RegExp(`REJECTED item ${ids.media}: dup_of must be another item`));
  assert.match(r1.stdout, new RegExp(`REJECTED item ${ids.nga}: reason:covered_name needs covered_ticker`));
  assert.match(r1.stdout, new RegExp(`REJECTED item ${zooxId}: item ${zooxId} is not in claim`));
  const missing = r1.stdout.match(/NOT YET GRADED from this claim: (.*)/)[1].split(", ").map(Number).sort((a, b) => a - b);
  assert.deepEqual(missing, [ids.lead, ids.fort, ids.media, ids.nga].sort((a, b) => a - b));

  const good = gradesFor(claim, "RCAT").grades;
  writeFileSync(join(cwd, "good.json"), JSON.stringify({ grades: good }));
  const r2 = await grader("aux-submit", "good.json");
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^accepted 4, already accepted 1, rejected 0/);
  assert.doesNotMatch(r2.stdout, /NOT YET GRADED/);
  const r3 = await grader("aux-submit", "good.json");
  assert.match(r3.stdout, /^accepted 0, already accepted 5, rejected 0/);

  const graded = rows(`SELECT i.id, i.state, i.claim_id, g.run_id, g.band, g.score, g.model, g.rubric_version, g.dup_of, g.covered_ticker
    FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id ORDER BY i.id`);
  assert.equal(graded.length, 5);
  assert.equal(rows("SELECT COUNT(*) AS n FROM aux_grades")[0].n, 5, "one grade per item and run");
  for (const g of graded) {
    assert.deepEqual([g.state, g.claim_id, g.run_id, g.model, g.rubric_version], ["graded", null, claim.run_id, "e2e-model", AUX_RUBRIC_VERSION]);
  }
  const of = Object.fromEntries(graded.map((g) => [g.id, g]));
  assert.deepEqual([of[ids.media].band, of[ids.media].dup_of], ["duplicate", ids.lead]);
  assert.deepEqual([of[ids.nga].band, of[ids.nga].covered_ticker], ["covered", "PL"]);

  const again = await grader("aux-claim");
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /^NOTHING WAITING: no auxiliary items to grade\./);
});

test("app: For You vs Latest, the entity filter, labels and Unlabeled only on /v1/aux/feed; stats.aux; roles", async () => {
  // A fresh Anduril item arrives after the grader ran: Latest shows it as pending.
  insertNews(env.NEWS, [{ source_key: "anduril", title: "Anduril unveils Fury production line", first_seen: new Date().toISOString() }]);
  assert.equal((await http("POST", "/v1/admin/aux-ingest", "admin", {})).body.inserted, 1);
  const pending = rows("SELECT id FROM aux_items WHERE state = 'pending'")[0].id;

  // For You: graded at or above the Signal floor, the recent Lead pinned first.
  const forYou = (await http("GET", "/v1/aux/feed?min_score=70", "app")).body;
  assert.deepEqual(forYou.items.map((i) => i.item_id), [ids.lead, ids.fort]);
  const lead = forYou.items[0];
  assert.deepEqual([lead.entity, lead.entity_key, lead.status, lead.band, lead.score, lead.pinned], ["Anduril", "anduril", "private", "lead", 92, 1]);
  assert.deepEqual(lead.reads_through, [{ ticker: "RCAT", direction: "-" }]);
  assert.match(lead.snippet, /^COSTA MESA, CA/);
  assert.equal(forYou.items[1].entity, "FORT Robotics");
  assert.equal(forYou.next_before_id, null);
  assert.deepEqual(await feedIds("?min_score=90"), [ids.lead]);
  // Latest: newest first, pending included; duplicate, covered and skipped hidden.
  const latest = (await http("GET", "/v1/aux/feed?order=newest", "app")).body.items;
  assert.deepEqual(latest.map((i) => i.item_id), [pending, ids.lead, ids.fort, ids.noise]);
  assert.deepEqual([latest[0].state, latest[0].band, latest[0].score, latest[0].entity], ["pending", null, null, "Anduril (private)"]);
  assert.ok(latest.every((i) => i.pinned === 0));
  // Entity: the shown name, the routed name or the key, case-insensitive.
  assert.deepEqual(await feedIds("?order=newest&entity=Anduril"), [pending, ids.lead, ids.noise]);
  assert.deepEqual(await feedIds("?order=newest&entity=anduril"), [pending, ids.lead, ids.noise]);
  assert.deepEqual(await feedIds("?min_score=70&entity=Anduril"), [ids.lead]);
  assert.deepEqual(await feedIds("?order=newest&entity=FORT%20Robotics"), [ids.fort]);
  assert.deepEqual(await feedIds("?order=newest&entity=fort_robotics"), [ids.fort]);
  assert.deepEqual(await feedIds("?order=newest&entity=Nobody"), []);

  // Labels, as the app posts them.
  const ok = await http("POST", "/v1/aux/feedback", "app", { item_id: ids.lead, label: "noise", note: "A private raise matters less to me" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.grade_id, rows("SELECT grade_id FROM aux_items WHERE id = ?", ids.lead)[0].grade_id);
  assert.equal((await http("POST", "/v1/aux/feedback", "app", { item_id: ids.fort, label: "high" })).status, 200);
  assert.equal((await http("POST", "/v1/aux/feedback", "app", { item_id: pending, label: "too_low" })).status, 400, "no score to compare");
  assert.equal((await http("POST", "/v1/aux/feedback", "app", { item_id: ids.noise, label: "bogus" })).status, 400);
  assert.equal((await http("POST", "/v1/aux/feedback", "app", { item_id: 999999, label: "high" })).status, 404);
  const labelled = (await http("GET", "/v1/aux/feed?order=newest", "app")).body.items.find((i) => i.item_id === ids.lead);
  assert.deepEqual([labelled.label, labelled.label_note], ["noise", "A private raise matters less to me"]);
  // The owner's Noise takes the Lead out of For You (Z13); the High stays in.
  assert.deepEqual(await feedIds("?min_score=70"), [ids.fort]);
  // Unlabeled only (the app sends state=graded with it).
  assert.deepEqual(await feedIds("?order=newest&unlabeled=1&state=graded"), [ids.noise]);
  assert.deepEqual(await feedIds("?min_score=70&unlabeled=1&state=graded"), []);

  const aux = (await http("GET", "/v1/stats", "app")).body.aux;
  const n = (list, k, v) => list.find((x) => x[k] === v)?.n ?? 0;
  assert.deepEqual(["graded", "pending", "skipped"].map((s) => n(aux.by_state, "state", s)), [5, 1, 6]);
  assert.deepEqual(["lead", "digest", "borderline", "reject", "duplicate", "covered"].map((b) => n(aux.by_band, "band", b)), [1, 1, 0, 1, 1, 1]);
  assert.deepEqual(aux.entities[0], { name: "Anduril", n: 2 });
  assert.deepEqual(aux.entities.map((e) => e.name).sort(), ["Anduril", "FORT Robotics"], "duplicate and covered grades are not names");
  assert.equal(aux.rubric_version, AUX_RUBRIC_VERSION);
  assert.ok(aux.last_ingest_at);

  // Roles: the app cannot grade, the grader cannot read the app feed or label.
  assert.equal((await http("POST", "/v1/aux/claim", "app", {})).status, 403);
  assert.equal((await http("GET", "/v1/aux/recent", "app")).status, 403);
  assert.equal((await http("GET", "/v1/aux/feed", "grader")).status, 403);
  assert.equal((await http("POST", "/v1/aux/feedback", "grader", { item_id: ids.lead, label: "high" })).status, 403);
});

test("grader CLI: aux-labels lists the analyst labels the current grade falls outside of", async () => {
  const r = await grader("aux-labels");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^2 auxiliary item\(s\) whose current grade is outside the analyst's label/);
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("- ["));
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^- \\[Anduril\\] item_id=${ids.lead} analyst=NOISE \\(0-29\\) grade now=92 \\(lead\\) :: .*analyst note: A private raise`));
  assert.match(lines[1], new RegExp(`^- \\[FORT Robotics\\] item_id=${ids.fort} analyst=HIGH \\(80-100\\) grade now=75 \\(digest\\)`));
});

test("coverage is untouched: /v1/feed, stats, labels, recent, the coverage tables and cursor are as before any auxiliary row", async () => {
  const after = await coverageSnapshot();
  assert.deepEqual(after, coverageBefore);
  const titles = JSON.stringify(after.feeds);
  for (const t of ["Anduril", "FORT Robotics", "Zoox journal"]) assert.ok(!titles.includes(t), `${t} is not on the coverage feed`);
  // A counterparty's own company channel routed to a covered ticker is on
  // Coverage only (Phase 0 gates d: one pipeline per item).
  assert.ok(after.feeds["?order=newest"].items.some((i) => i.source_key === "skydio"));
  assert.equal(after.feeds[""].items[0].ticker, "RCAT");
  assert.equal(after.stats.last_run, null, "auxiliary claims and grades never write runs");
});
