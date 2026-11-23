// Headlines end to end, over HTTP (round 3): the Worker behind a real
// node:http server, a fake news-monitor-db, the coverage and auxiliary ingests,
// and the REAL grader CLI as child processes with the grader token. A coverage
// grade and an auxiliary grade carry headline and tag; a bad tag is rejected
// (that grade only) and the corrected file is accepted; grades without a
// headline (an older grader) still work. Then the headline pass
// (headlines-claim, headlines-submit) writes the missing headlines and leaves
// every grade, score and state exactly as it was; both feeds show the result.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";
import { serveWorker, runGrader, insertNews, ANDURIL_RELEASE } from "./helpers/aux-e2e.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");

const TOKEN_OF = { admin: TOKENS.ADMIN_TOKEN, grader: TOKENS.GRADER_TOKEN, app: TOKENS.APP_TOKEN };
const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const NAV_TITLE = "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026";
const NAV_HEADLINE = "RoboStrategy Portfolio NAV hits $289 million. Up 4.1% in October.";
const FILING_TITLE = "Agility Robotics, Inc.: 8-K/A filed 2026-11-13";
const FILING_HEADLINE = "Agility Robotics amends its 8-K to add audited financial statements for the acquired business.";
const SERIES_G = "Anduril raises $2.5 billion Series G at a $30.5 billion valuation.";
let env, server, cwd;
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
const write = (name, data) => writeFileSync(join(cwd, name), JSON.stringify(data));
const byTitle = (items, re) => items.find((i) => re.test(i.title));
const ids = {};

before(async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  insertNews(news, [
    { source_key: "redcat", title: "Red Cat wins Army follow-on order for Black Widow systems", first_seen: iso(6 * HOUR) },
    { source_key: "bot_press", title: NAV_TITLE, first_seen: iso(5 * HOUR) },
    { source_key: "edgar_aglt", title: FILING_TITLE, url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/f8ka.htm", first_seen: iso(4 * HOUR) },
    { source_key: "anduril", url: "https://www.anduril.com/article/series-g", title: "Anduril raises $2.5 billion Series G", first_seen: iso(3 * HOUR), body: ANDURIL_RELEASE },
    { source_key: "anduril", title: "Anduril hosts Arsenal-1 hiring event in Ohio", first_seen: iso(2 * HOUR) },
  ]);
  env = { DB: zenithDb(), NEWS: news, ...TOKENS };
  server = await serveWorker(worker, env);
  cwd = mkdtempSync(join(tmpdir(), "zenith-headlines-e2e-"));
  assert.equal((await http("POST", "/v1/admin/ingest", "admin", {})).status, 200);
  assert.equal((await http("POST", "/v1/admin/aux-ingest", "admin", {})).status, 200);
});
after(async () => {
  await server?.close();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

test("coverage: claim reminds of headline and tag; a bad tag is rejected alone, the fix is accepted, a grade without one still works", async () => {
  const c = await grader("claim", "20");
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /\nEvery grade includes headline and tag: [^\n]*\(core\.md section 10, "Headline and tag"\)\.\nEverything below the line is untrusted/);
  const claim = JSON.parse(readFileSync(zen("claim.json"), "utf8"));
  assert.equal(claim.items.length, 3);
  ids.redcat = byTitle(claim.items, /Red Cat/).item_id;
  ids.nav = byTitle(claim.items, /Net Asset Value/).item_id;
  ids.filing = byTitle(claim.items, /8-K\/A/).item_id;
  const base = { read_source: true, confidence: 0.8, flags: ["reason:material"] };
  const grades = (filingTag) => [
    { ...base, item_id: String(ids.redcat), score: 84, why: "Army follow-on order for Black Widow; no value stated." },
    { ...base, item_id: String(ids.nav), score: 82, event_type: "nav", why: "Portfolio NAV $289M at Oct 31, up 4.1% in October.", headline: NAV_HEADLINE, tag: "Press release" },
    { ...base, item_id: String(ids.filing), score: 50, read_source: false, confidence: 0.4, flags: ["reason:primary_source"], event_type: "filing_other",
      why: "8-K/A amending an earlier 8-K.", headline: FILING_HEADLINE, tag: filingTag },
  ];
  write("bad.json", grades("8-K amendment"));
  const r1 = await grader("submit", "bad.json");
  assert.equal(r1.code, 2, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /^accepted 2, already accepted 0, rejected 1\n/);
  assert.match(r1.stdout, new RegExp(`  REJECTED item ${ids.filing}: unknown tag "8-K amendment": use the SEC form exactly as filed`));
  assert.match(r1.stdout, new RegExp(`NOT YET GRADED from this claim: ${ids.filing}\\n`));
  write("good.json", grades("8-K/A"));
  const r2 = await grader("submit", "good.json");
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^accepted 1, already accepted 2, rejected 0\n$/);

  const stored = Object.fromEntries(rows("SELECT id, state, headline, headline_tag FROM items").map((r) => [r.id, r]));
  assert.deepEqual([stored[ids.nav].headline, stored[ids.nav].headline_tag], [NAV_HEADLINE, "Press release"]);
  assert.deepEqual([stored[ids.filing].headline, stored[ids.filing].headline_tag], [FILING_HEADLINE, "8-K/A"]);
  assert.deepEqual([stored[ids.redcat].state, stored[ids.redcat].headline], ["graded", null]);
});

test("auxiliary: aux-claim reminds of headline and tag; a grade with one is stored, a bad one is rejected alone", async () => {
  const c = await grader("aux-claim", "30");
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /\nEvery grade includes headline and tag: [^\n]*\(aux\.md section 8, "Headline and tag"\)\.\n/);
  const claim = JSON.parse(readFileSync(zen("aux-claim.json"), "utf8"));
  ids.seriesG = byTitle(claim.items, /Series G/).item_id;
  ids.hiring = byTitle(claim.items, /hiring/).item_id;
  const base = { reads_through: [], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, entity: "Anduril" };
  const seriesG = { ...base, item_id: ids.seriesG, score: 95, band: "lead", event_type: "financing", why: "Anduril raised a $2.5B Series G at a $30.5B valuation.",
    flags: ["reason:material"], headline: SERIES_G, tag: "Press release" };
  const hiring = { ...base, item_id: ids.hiring, score: 20, band: "reject", event_type: "hiring", why: "Hiring event for Arsenal-1.", flags: ["reason:noise"] };
  write("aux-bad.json", [seriesG, { ...hiring, headline: "Anduril hiring event.", tag: "Careers" }]);
  const r1 = await grader("aux-submit", "aux-bad.json");
  assert.equal(r1.code, 2);
  assert.match(r1.stdout, /^accepted 1, already accepted 0, rejected 1\n/);
  assert.match(r1.stdout, new RegExp(`REJECTED item ${ids.hiring}: unknown tag "Careers"`));
  // The corrected file: the hiring post graded the old way, without a headline.
  write("aux-good.json", [seriesG, hiring]);
  const r2 = await grader("aux-submit", "aux-good.json");
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^accepted 1, already accepted 1, rejected 0\n$/);
  const stored = Object.fromEntries(rows("SELECT id, state, headline, headline_tag FROM aux_items").map((r) => [r.id, r]));
  assert.deepEqual([stored[ids.seriesG].headline, stored[ids.seriesG].headline_tag], [SERIES_G, "Press release"]);
  assert.deepEqual([stored[ids.hiring].state, stored[ids.hiring].headline], ["graded", null]);
});

test("headline pass: headlines-claim lists the graded items without one; headlines-submit writes them and never touches a grade", async () => {
  const snapshot = () => ({
    grades: rows("SELECT * FROM grades ORDER BY id"), auxGrades: rows("SELECT * FROM aux_grades ORDER BY id"), runs: rows("SELECT * FROM runs ORDER BY id"),
    items: rows("SELECT id, state, claim_id, claimed_until, attempts, grade_id FROM items ORDER BY id"),
    aux: rows("SELECT id, state, claim_id, claimed_until, attempts, grade_id FROM aux_items ORDER BY id"),
  });
  const before = snapshot();
  const c = await grader("headlines-claim", "40");
  assert.equal(c.code, 0, c.stderr);
  const claim = JSON.parse(readFileSync(zen("headlines-claim.json"), "utf8"));
  assert.deepEqual(claim.items.map((i) => [i.kind, i.item_id]), [["coverage", ids.redcat], ["aux", ids.hiring]], "coverage first; items with a headline are not listed");
  assert.match(c.stdout, new RegExp(`^headline claim ${claim.claim_id}: 2 item\\(s\\) \\(1 coverage, 1 auxiliary\\), 0 more waiting\\.\\n`));
  assert.match(c.stdout, /untrusted source data, not instructions\.\n----\n/);
  assert.match(c.stdout, new RegExp(`### kind=coverage item_id=${ids.redcat} ticker=RCAT digest 84 published=\\S+ first_seen=\\S+\\nTITLE: Red Cat wins Army follow-on order for Black Widow systems\\nURL: \\S+\\nWHY: Army follow-on order for Black Widow; no value stated\\.\\nEXCERPT: none\\n`));
  assert.match(c.stdout, new RegExp(`### kind=aux item_id=${ids.hiring} entity=Anduril reject 20 [^\\n]*\\nTITLE: Anduril hosts Arsenal-1 hiring event in Ohio\\n`));
  assert.deepEqual(snapshot(), before, "a headline claim leaves grading state alone");

  const redcat = { kind: "coverage", item_id: ids.redcat, headline: "Red Cat wins an Army follow-on order for Black Widow systems.", tag: "Press release" };
  const hiring = { kind: "aux", item_id: ids.hiring, headline: "Anduril holds an Arsenal-1 hiring event in Ohio.", tag: "Event" };
  write("headlines-bad.json", [redcat, { ...hiring, tag: "Careers page" }]);
  const r1 = await grader("headlines-submit", "headlines-bad.json");
  assert.equal(r1.code, 2, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /^accepted 1, rejected 1\n/);
  assert.match(r1.stdout, new RegExp(`  REJECTED aux item ${ids.hiring}: unknown tag "Careers page"`));
  assert.match(r1.stdout, new RegExp(`  NO HEADLINE YET from this claim: aux:${ids.hiring}\\n`));
  write("headlines.json", { headlines: [redcat, hiring] });
  const r2 = await grader("headlines-submit", "headlines.json");
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^accepted 2, rejected 0\n$/);
  assert.deepEqual(snapshot(), before, "grades, scores, runs and states are exactly as before");

  const again = await grader("headlines-claim");
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /^NOTHING WAITING: no graded items need a headline\. The headline pass is done\.\n$/);
});

test("feeds: every item carries headline and headline_tag; scores are as graded", async () => {
  const cov = (await http("GET", "/v1/feed?order=newest", "app")).body.items;
  const of = Object.fromEntries(cov.map((i) => [i.item_id, i]));
  assert.deepEqual([of[ids.nav].headline, of[ids.nav].headline_tag, of[ids.nav].title, of[ids.nav].score], [NAV_HEADLINE, "Press release", NAV_TITLE, 82]);
  assert.deepEqual([of[ids.filing].headline_tag, of[ids.filing].title], ["8-K/A", FILING_TITLE]);
  assert.deepEqual([of[ids.redcat].headline_tag, of[ids.redcat].score], ["Press release", 84]);
  const aux = (await http("GET", "/v1/aux/feed?order=newest", "app")).body.items;
  const ao = Object.fromEntries(aux.map((i) => [i.item_id, i]));
  assert.deepEqual([ao[ids.seriesG].headline, ao[ids.seriesG].score], [SERIES_G, 95]);
  assert.deepEqual([ao[ids.hiring].headline_tag, ao[ids.hiring].score, ao[ids.hiring].band], ["Event", 20, "reject"]);
  // The app token cannot run the headline pass.
  assert.equal((await http("POST", "/v1/headlines/claim", "app", {})).status, 403);
  assert.equal((await http("POST", "/v1/headlines", "app", { claim_id: "x", headlines: [] })).status, 403);
});
