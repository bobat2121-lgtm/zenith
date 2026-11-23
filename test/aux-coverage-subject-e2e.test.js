// Coverage-subject sources end to end, over HTTP (round 2, R2A), from the state
// a live zenith-db is in when round 2 deploys: round 1's aux_nm_cursor has
// already passed the Drone Dominance rows (they were excluded then) and
// aux_cs_cursor does not exist. The one-time catch-up ingests them, the REAL
// grader CLI claims them (printing COVERAGE_SUBJECT affects=...) and submits:
// a post mainly about an outside company (Neros) is an auxiliary card under
// that company's name; a post mainly about a covered company (Red Cat) is
// graded reason:covered_name and stays off /v1/aux/feed. Until graded, a
// coverage-subject item is off the feed too, and the catch-up's late rows sit
// by their age in Latest, not above newer items.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";
import { serveWorker, runGrader, insertNews } from "./helpers/aux-e2e.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { AUX_RUBRIC_VERSION } = await import("../worker/src/rubric.generated.js");
const AUX_SOURCES = (await import("../worker/src/aux-sources.json", { with: { type: "json" } })).default;

const TOKEN_OF = { admin: TOKENS.ADMIN_TOKEN, grader: TOKENS.GRADER_TOKEN, app: TOKENS.APP_TOKEN };
const HOUR = 3_600_000;
let env, server, cwd, claim;
const rows = (sql, ...args) => env.DB.rows(sql, ...args).map((r) => ({ ...r }));
async function http(method, path, role, body) {
  const r = await fetch(server.url + path, {
    method, headers: { authorization: `Bearer ${TOKEN_OF[role]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const grader = (...args) => runGrader(args, { api: server.url, token: TOKENS.GRADER_TOKEN, cwd });
const feed = async (q) => {
  const r = await http("GET", `/v1/aux/feed${q}`, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items;
};
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const DD_AFFECTS = AUX_SOURCES.sources.dronedominance.affects;
const LISTS_AFFECTS = AUX_SOURCES.sources.dronedominance_lists.affects;

before(async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  // Rows round 1 already scanned past: two coverage-subject posts it excluded,
  // and a plain auxiliary row it would have stored (it is not rescanned).
  insertNews(news, [
    { source_key: "dronedominance", title: "Drone Dominance Phase 2: Neros Technologies to deliver 6,000 Archer FPV drones", first_seen: iso(6 * HOUR) },
    { source_key: "anduril", title: "Anduril opens Arsenal-1 in Ohio", first_seen: iso(5 * HOUR) },
    { source_key: "dronedominance_lists", title: "Drone Dominance blue list adds Red Cat Black Widow", first_seen: iso(4 * HOUR) },
  ]);
  env = { DB: zenithDb(), NEWS: news, ...TOKENS };
  // Round 1's state: aux_nm_cursor past those rows, no aux_cs_cursor.
  const passed = news.db.prepare("SELECT MAX(rowid) AS m FROM items").get().m;
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_nm_cursor', ?)").run(String(passed));
  // A coverage-subject post after the cursor: the main scan takes it.
  insertNews(news, [{ source_key: "dronedominance", title: "Drone Dominance program office sets Phase 3 evaluation dates", first_seen: iso(1 * HOUR) }]);
  server = await serveWorker(worker, env);
  cwd = mkdtempSync(join(tmpdir(), "zenith-aux-cs-e2e-"));
});
after(async () => {
  await server?.close();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

test("aux ingest: the one-time catch-up stores the coverage-subject rows round 1 passed, with their affects, and then stops", async () => {
  const r = await http("POST", "/v1/admin/aux-ingest", "admin", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.inserted, 1, "main scan: the new Phase 3 post");
  assert.equal(r.body.coverage_subject_catch_up.done, true);
  assert.equal(r.body.coverage_subject_catch_up.inserted, 2, "catch-up: the two Drone Dominance posts, not the Anduril row");
  const stored = rows("SELECT source_key, entity_key, entity_name, status, state, coverage_subject, affects FROM aux_items ORDER BY nm_rowid");
  assert.deepEqual(stored.map((x) => x.source_key), ["dronedominance", "dronedominance_lists", "dronedominance"]);
  for (const x of stored) {
    assert.deepEqual([x.entity_key, x.entity_name, x.status, x.state, x.coverage_subject], ["dronedominance", "Drone Dominance", "program", "pending", 1]);
  }
  assert.deepEqual(stored.map((x) => x.affects), [DD_AFFECTS.join(","), LISTS_AFFECTS.join(","), DD_AFFECTS.join(",")]);
  assert.equal(rows("SELECT value FROM meta WHERE key = 'aux_cs_cursor'")[0].value, "done");
  const again = await http("POST", "/v1/admin/aux-ingest", "admin", {});
  assert.deepEqual([again.body.inserted, again.body.coverage_subject_catch_up], [0, null]);
});

test("/v1/aux/feed before grading: pending coverage-subject items are hidden (include_covered=1 shows them, oldest last)", async () => {
  assert.deepEqual(await feed("?order=newest"), []);
  const all = await feed("?order=newest&include_covered=1");
  assert.deepEqual(all.map((i) => i.title.match(/Phase 3|Neros|Red Cat/)[0]), ["Phase 3", "Red Cat", "Neros"], "arrival order, though the catch-up stored two rows last");
  assert.ok(all.every((i) => i.state === "pending" && i.entity === "Drone Dominance"));
});

test("grader CLI: aux-claim prints COVERAGE_SUBJECT affects=... under each coverage-subject item", async () => {
  const c = await grader("aux-claim", "40");
  assert.equal(c.code, 0, c.stderr);
  claim = JSON.parse(readFileSync(join(cwd, ".zenith", "aux-claim.json"), "utf8"));
  assert.equal(claim.rubric_version, AUX_RUBRIC_VERSION);
  assert.equal(claim.items.length, 3);
  for (const i of claim.items) assert.equal(i.coverage_subject, true);
  assert.deepEqual(claim.items.map((i) => i.affects), [DD_AFFECTS, LISTS_AFFECTS, DD_AFFECTS], "newest first");
  assert.equal(c.stdout.match(/\nCOVERAGE_SUBJECT affects=/g).length, 3);
  assert.match(c.stdout, new RegExp(`source=dronedominance [^\\n]*\\nCOVERAGE_SUBJECT affects=${DD_AFFECTS.join(",")} \\(`));
  assert.match(c.stdout, new RegExp(`source=dronedominance_lists [^\\n]*\\nCOVERAGE_SUBJECT affects=${LISTS_AFFECTS.join(",")} \\(`));
  assert.match(c.stdout, /entity=Drone Dominance \[dronedominance, program\]/);
});

test("aux-submit, then /v1/aux/feed: the outside company is a card under its own name; the covered_name grade stays hidden", async () => {
  const by = (re) => claim.items.find((i) => re.test(i.title));
  const neros = by(/Neros/), redcat = by(/Red Cat/), phase3 = by(/Phase 3/);
  const base = { reads_through: [], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null };
  writeFileSync(join(cwd, "grades.json"), JSON.stringify([
    { ...base, item_id: neros.item_id, entity: "Neros Technologies", score: 78, band: "digest", event_type: "contract",
      why: "Neros won a 6,000-drone Drone Dominance Phase 2 order.", flags: ["reason:material"], reads_through: [{ ticker: "RCAT", direction: "-" }] },
    { ...base, item_id: redcat.item_id, entity: "Red Cat", score: null, band: "covered", event_type: "covered",
      why: "Blue-list addition for Red Cat's Black Widow: the covered company's own news.", flags: ["reason:covered_name"], covered_ticker: "RCAT" },
    { ...base, item_id: phase3.item_id, entity: "Drone Dominance", score: 55, band: "borderline", event_type: "program",
      why: "Phase 3 evaluation dates set for the Drone Dominance program.", flags: ["reason:material"] },
  ]));
  const s = await grader("aux-submit", "grades.json");
  assert.equal(s.code, 0, s.stdout + s.stderr);
  assert.match(s.stdout, /^accepted 3, already accepted 0, rejected 0/);

  const latest = await feed("?order=newest");
  assert.deepEqual(latest.map((i) => i.item_id), [phase3.item_id, neros.item_id], "the covered_name grade is not on the Auxiliary page");
  const card = latest[1];
  assert.deepEqual([card.entity, card.entity_key, card.status, card.source_key, card.band, card.score],
    ["Neros Technologies", "dronedominance", "program", "dronedominance", "digest", 78]);
  assert.deepEqual(card.reads_through, [{ ticker: "RCAT", direction: "-" }]);
  assert.equal(latest[0].entity, "Drone Dominance");
  assert.deepEqual((await feed("?min_score=70")).map((i) => i.item_id), [neros.item_id]);
  // Paging keeps arrival order: before_id is the last item's id.
  const p1 = await http("GET", "/v1/aux/feed?order=newest&limit=1", "app");
  assert.deepEqual([p1.body.items.map((i) => i.item_id), p1.body.next_before_id], [[phase3.item_id], phase3.item_id]);
  assert.deepEqual((await feed(`?order=newest&limit=1&before_id=${phase3.item_id}`)).map((i) => i.item_id), [neros.item_id]);
  assert.deepEqual((await feed("?order=newest&entity=Neros%20Technologies")).map((i) => i.item_id), [neros.item_id]);
  // Hidden by default only: the covered grade is stored with its ticker.
  const all = await feed("?order=newest&include_covered=1");
  const hidden = all.find((i) => i.item_id === redcat.item_id);
  assert.deepEqual([hidden.band, hidden.covered_ticker], ["covered", "RCAT"]);
  // Names counts the outside company and the program, never the covered name.
  const names = (await http("GET", "/v1/stats", "app")).body.aux.entities.map((e) => e.name).sort();
  assert.deepEqual(names, ["Drone Dominance", "Neros Technologies"]);
});
