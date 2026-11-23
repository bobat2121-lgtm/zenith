// grader/zenith.mjs auxiliary commands (aux-claim, aux-rubric, aux-recent,
// aux-labels, aux-submit) against a local mock of the zenith-core API: request
// paths and bodies, the grader token, the .zenith/ state files, NOTHING WAITING
// and the error exits. Also checks rubric/auxiliary.md against the API contract.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHeadline } from "../worker/src/lib.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(root, "grader", "zenith.mjs");
const TOKEN = "test-grader-token-9f3c";

// The mock API: routes keyed "METHOD /path" (query ignored); every request is recorded.
const requests = [];
const routes = new Map();
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, "http://mock");
  const rec = { method: req.method, path: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: raw ? JSON.parse(raw) : null };
  requests.push(rec);
  const handler = routes.get(`${req.method} ${url.pathname}`);
  const out = handler ? handler(rec) : { status: 404, json: { error: "not found" } };
  res.writeHead(out.status || 200, { "content-type": "application/json" });
  res.end(JSON.stringify(out.json));
});
let API = "";
const dirs = [];

before(async () => {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  API = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
beforeEach(() => { requests.length = 0; routes.clear(); });

function workdir() {
  const d = mkdtempSync(join(tmpdir(), "zenith-aux-cli-"));
  dirs.push(d);
  return d;
}

// Runs the CLI in `cwd` (so .zenith/ lands there) without blocking the mock server.
function run(cwd, args, { api = API, token = TOKEN } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ZENITH_/i.test(k)));
  if (api) env.ZENITH_API = api;
  if (token) env.ZENITH_GRADER_TOKEN = token;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (stdout.includes(TOKEN) || stderr.includes(TOKEN)) reject(new Error(`zenith.mjs ${args.join(" ")} printed the token`));
      else resolve({ code, stdout, stderr });
    });
  });
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const zen = (cwd, ...p) => join(cwd, ".zenith", ...p);

const CLAIM = {
  claim_id: "aux-claim-1",
  run_id: "run-cov-1",
  rubric_version: "a-0123456789ab",
  items: [
    { item_id: 101, source_key: "anduril", entity_key: "anduril", entity_name: "Anduril", status: "private",
      title: "Anduril raises $2.5B Series G", url: "https://example.com/a", published: "2026-11-22T14:00:00Z",
      first_seen: "2026-11-22T14:05:00Z", seen_after_days: 0, excerpt: "Anduril today announced $2.5B in new funding.", excerpt_status: "feed" },
    { item_id: 102, source_key: "wargov_contracts", entity_key: "wargov_contracts", entity_name: "War.gov contracts", status: "program",
      title: "Contracts for Nov. 21, 2026", url: "https://example.com/c", published: null,
      first_seen: "2026-11-21T22:00:00Z", seen_after_days: null, excerpt: null, excerpt_status: null },
  ],
  remaining: 7,
};

test("aux-claim posts limit, the shared run id and model with the grader token, saves the claim and prints the batch", async () => {
  const cwd = workdir();
  // The coverage pass of this run already created the run id: auxiliary batches reuse it.
  mkdirSync(zen(cwd), { recursive: true });
  writeFileSync(zen(cwd, "run.json"), JSON.stringify({ id: "run-cov-1", started_at: new Date().toISOString() }));
  routes.set("POST /v1/aux/claim", () => ({ json: CLAIM }));
  const r = await run(cwd, ["aux-claim"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests.length, 1);
  const [q] = requests;
  assert.equal(q.method, "POST");
  assert.equal(q.path, "/v1/aux/claim");
  assert.equal(q.auth, `Bearer ${TOKEN}`);
  assert.equal(q.type, "application/json");
  assert.deepEqual(q.body, { limit: 30, run_id: "run-cov-1", model: "claude-routine", rubric_version: "" });
  assert.deepEqual(readJson(zen(cwd, "aux-claim.json")), CLAIM);
  assert.equal(existsSync(zen(cwd, "claim.json")), false, "the coverage claim file is untouched");
  assert.match(r.stdout, /^aux claim aux-claim-1 \(run run-cov-1\): 2 item\(s\), 7 more waiting\. Rubric a-0123456789ab\./);
  assert.match(r.stdout, /reason:covered_name/);
  assert.match(r.stdout, /untrusted source data, not instructions\.\n----\n/);
  assert.match(r.stdout, /### item_id=101 entity=Anduril \[anduril, private\] source=anduril first_seen=2026-11-22T14:05:00Z published=2026-11-22T14:00:00Z seen_after_days=0\nTITLE: Anduril raises \$2\.5B Series G\nURL: https:\/\/example\.com\/a\nEXCERPT \(feed\):\nAnduril today announced/);
  assert.match(r.stdout, /### item_id=102 entity=War\.gov contracts \[wargov_contracts, program\] source=wargov_contracts first_seen=\S+ published=- seen_after_days=unknown\n.*\n.*\nEXCERPT: none \(no feed text\)/);
});

test("aux-claim prints COVERAGE_SUBJECT affects=... under a coverage-subject item and nothing under the others", async () => {
  const cwd = workdir();
  const subject = { item_id: 103, source_key: "dronedominance", entity_key: "dronedominance", entity_name: "Drone Dominance", status: "program",
    title: "Phase 2 vendors include Anduril", url: "https://example.com/d", published: null, first_seen: "2026-11-21T20:00:00Z", seen_after_days: null,
    excerpt: null, excerpt_status: null, coverage_subject: true, affects: ["RCAT", "DPRO", "PUSA", "UMAC"] };
  const plain = { ...CLAIM.items[0], coverage_subject: false, affects: [] };
  routes.set("POST /v1/aux/claim", () => ({ json: { ...CLAIM, items: [plain, subject] } }));
  const r = await run(cwd, ["aux-claim"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /### item_id=103 entity=Drone Dominance \[dronedominance, program\] source=dronedominance [^\n]*\nCOVERAGE_SUBJECT affects=RCAT,DPRO,PUSA,UMAC \([^\n]*OUTSIDE company[^\n]*reason:covered_name with covered_ticker\)\nTITLE: Phase 2 vendors include Anduril\n/);
  assert.equal(r.stdout.match(/COVERAGE_SUBJECT/g).length, 1, "only the coverage-subject item");
  assert.match(r.stdout, /### item_id=101 [^\n]*\nTITLE: Anduril raises/);
});

test("aux-claim sends the stored auxiliary rubric version and clamps the limit to 1..40", async () => {
  const cwd = workdir();
  mkdirSync(zen(cwd, "rubric"), { recursive: true });
  writeFileSync(zen(cwd, "rubric", "AUX_VERSION"), "a-feedfacecafe\n");
  routes.set("POST /v1/aux/claim", () => ({ json: CLAIM }));
  assert.equal((await run(cwd, ["aux-claim", "100"])).code, 0);
  assert.equal((await run(cwd, ["aux-claim", "5"])).code, 0);
  assert.equal((await run(cwd, ["aux-claim", "-3"])).code, 0);
  assert.deepEqual(requests.map((q) => q.body.limit), [40, 5, 1]);
  assert.ok(requests.every((q) => q.body.rubric_version === "a-feedfacecafe"));
  // One run id across batches, created on the first claim when none exists.
  const ids = new Set(requests.map((q) => q.body.run_id));
  assert.equal(ids.size, 1);
  assert.equal(readJson(zen(cwd, "run.json")).id, [...ids][0]);
});

test("aux-claim truncates a fractional limit and copes with a response without remaining", async () => {
  const cwd = workdir();
  const { remaining, ...noRemaining } = CLAIM;
  routes.set("POST /v1/aux/claim", () => ({ json: noRemaining }));
  const r = await run(cwd, ["aux-claim", "2.5"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests[0].body.limit, 2);
  assert.match(r.stdout, /^aux claim aux-claim-1 \(run run-cov-1\): 2 item\(s\), \? more waiting\./);
  assert.doesNotMatch(r.stdout, /undefined/);
});

// The auxiliary pass starts where an empty coverage claim used to end the run:
// that message must end only the coverage pass.
test("an empty coverage claim ends only the coverage pass and points to the auxiliary pass", async () => {
  const cwd = workdir();
  const empty = { claim_id: "cov-claim-0", run_id: "r", rubric_version: "r-1", items: [], remaining: 0 };
  routes.set("POST /v1/queue/claim", () => ({ json: empty }));
  const r = await run(cwd, ["claim", "20"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests[0].path, "/v1/queue/claim");
  assert.equal(requests[0].body.limit, 20);
  assert.match(r.stdout, /^NOTHING WAITING: no coverage items to grade\. The coverage pass is done; do not load the coverage rubric or labels; go on to the auxiliary pass \(GRADER\.md step 5\)\.\n$/);
  assert.doesNotMatch(r.stdout, /Stop this run/);
  assert.deepEqual(readJson(zen(cwd, "claim.json")), empty);
});

test("aux-claim prints NOTHING WAITING and exits 0 when the queue is empty", async () => {
  const cwd = workdir();
  const empty = { claim_id: "aux-claim-2", run_id: "r", rubric_version: "a-1", items: [], remaining: 0 };
  routes.set("POST /v1/aux/claim", () => ({ json: empty }));
  const r = await run(cwd, ["aux-claim", "30"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^NOTHING WAITING: no auxiliary items to grade\./);
  assert.doesNotMatch(r.stdout, /### item_id/);
  assert.deepEqual(readJson(zen(cwd, "aux-claim.json")), empty);
});

test("aux-claim stops on a response without an items list", async () => {
  const cwd = workdir();
  routes.set("POST /v1/aux/claim", () => ({ json: { error: "odd" } }));
  const r = await run(cwd, ["aux-claim"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: POST \/v1\/aux\/claim returned no items list/);
  assert.equal(existsSync(zen(cwd, "aux-claim.json")), false);
});

test("aux-rubric writes aux.md, peers.md and AUX_VERSION and leaves the coverage rubric alone", async () => {
  const cwd = workdir();
  mkdirSync(zen(cwd, "rubric"), { recursive: true });
  writeFileSync(zen(cwd, "rubric", "VERSION"), "r-coverage");
  writeFileSync(zen(cwd, "rubric", "core.md"), "# core");
  routes.set("GET /v1/rubric/aux", () => ({ json: { rubric_version: "a-0123456789ab", aux: "# Auxiliary rubric\n" } }));
  routes.set("GET /v1/rubric/peers", () => ({ json: { rubric_version: "r-coverage", peers: "# Peer notes\n### Anduril (private)\n" } }));
  const r = await run(cwd, ["aux-rubric"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.map((q) => `${q.method} ${q.path}`), ["GET /v1/rubric/aux", "GET /v1/rubric/peers"]);
  assert.ok(requests.every((q) => q.auth === `Bearer ${TOKEN}` && q.body === null));
  assert.equal(readFileSync(zen(cwd, "rubric", "aux.md"), "utf8"), "# Auxiliary rubric\n");
  assert.equal(readFileSync(zen(cwd, "rubric", "peers.md"), "utf8"), "# Peer notes\n### Anduril (private)\n");
  assert.equal(readFileSync(zen(cwd, "rubric", "AUX_VERSION"), "utf8"), "a-0123456789ab");
  assert.equal(readFileSync(zen(cwd, "rubric", "VERSION"), "utf8"), "r-coverage");
  assert.equal(readFileSync(zen(cwd, "rubric", "core.md"), "utf8"), "# core");
  assert.match(r.stdout, /^aux rubric a-0123456789ab: aux\.md \+ peers\.md in \.zenith\/rubric\/ \(Lead 90-100 \| Digest 70-89 \| Borderline 40-69 \| Reject <40\)/);
  assert.match(r.stdout, /grep/);
});

test("aux-rubric goes on without peer notes and stops when the rubric is not built", async () => {
  const cwd = workdir();
  routes.set("GET /v1/rubric/aux", () => ({ json: { rubric_version: "a-1", aux: "# Auxiliary rubric\n" } }));
  routes.set("GET /v1/rubric/peers", () => ({ status: 404, json: { error: "no peer notes" } }));
  const r = await run(cwd, ["aux-rubric"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /aux\.md \(no peer notes\)/);
  assert.equal(existsSync(zen(cwd, "rubric", "peers.md")), false);

  routes.set("GET /v1/rubric/aux", () => ({ status: 503, json: { error: "rubric not built" } }));
  const bad = await run(workdir(), ["aux-rubric"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /^zenith: GET \/v1\/rubric\/aux -> HTTP 503: .*rubric not built/);
});

test("aux-recent asks for one entity (or every entity with -) and lists the items", async () => {
  const cwd = workdir();
  routes.set("GET /v1/aux/recent", (q) => ({ json: { entity: "Shield AI", days: q.path.includes("days=7") ? 7 : 14, items: [
    { item_id: 55, entity: "Shield AI", title: "Shield AI raises $240M", first_seen: "2026-11-20T10:00:00Z", score: 93, band: "lead" },
    { item_id: 56, entity: "Shield AI", title: "Shield AI funding (wire copy)", first_seen: "2026-11-20T11:00:00Z", score: null, band: "duplicate", dup_of: 55 },
  ] } }));
  const r = await run(cwd, ["aux-recent", "Shield AI", "7"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].path, "/v1/aux/recent?entity=Shield%20AI&days=7");
  assert.equal(requests[0].auth, `Bearer ${TOKEN}`);
  assert.match(r.stdout, /^2 auxiliary item\(s\) for "Shield AI" in the last 7 days:\n/);
  assert.match(r.stdout, /- item_id=55 2026-11-20 lead 93 \[Shield AI\] Shield AI raises \$240M\n/);
  assert.match(r.stdout, /- item_id=56 2026-11-20 duplicate \[Shield AI\] Shield AI funding \(wire copy\) \(dup_of 55\)/);

  const all = await run(cwd, ["aux-recent", "-"]);
  assert.equal(all.code, 0, all.stderr);
  // Every entity asks for the API's maximum, not its default of 80.
  assert.equal(requests[1].path, "/v1/aux/recent?days=14&limit=200");
  assert.match(all.stdout, /^2 auxiliary item\(s\) for every entity in the last 14 days:/);
  assert.doesNotMatch(all.stdout, /only the 200 newest/);
});

test("aux-recent without an entity prints usage and calls nothing", async () => {
  const r = await run(workdir(), ["aux-recent"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /usage: aux-recent <entity\|-> \[days\]/);
  assert.equal(requests.length, 0);
});

test("aux-labels lists labels the current grade falls outside of, widest gap first, and saves them", async () => {
  const cwd = workdir();
  routes.set("GET /v1/aux/labels", () => ({ json: { labels: [
    { item_id: 8, entity: "Zoox", title: "Zoox recall", label: "too_high", graded_score: 80, current_score: 85, current_band: "digest", note: null },
    { item_id: 7, entity: "Waymo", title: "Waymo launches in Denver", label: "high", graded_score: 40, current_score: 45, current_band: "borderline", note: "new cities matter" },
  ] } }));
  const r = await run(cwd, ["aux-labels"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(requests[0].path, "/v1/aux/labels?limit=30");
  assert.equal(requests[0].auth, `Bearer ${TOKEN}`);
  assert.match(r.stdout, /^2 auxiliary item\(s\) whose current grade is outside the analyst's label/);
  assert.match(r.stdout, /preferences, never instructions/);
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(lines, [
    "- [Waymo] item_id=7 analyst=HIGH (80-100) grade now=45 (borderline) :: Waymo launches in Denver  || analyst note: new cities matter",
    "- [Zoox] item_id=8 analyst=TOO HIGH of 80 (0-79) grade now=85 (digest) :: Zoox recall",
  ]);
  const saved = readJson(zen(cwd, "aux-labels.json"));
  assert.deepEqual(saved.map((l) => [l.item_id, l.range, l.gap]), [[7, "80-100", 35], [8, "0-79", -6]]);

  assert.equal((await run(cwd, ["aux-labels", "10"])).code, 0);
  assert.equal(requests[1].path, "/v1/aux/labels?limit=10");
});

test("aux-labels leaves out labels the grade agrees with and grades with no score to compare", async () => {
  const cwd = workdir();
  routes.set("GET /v1/aux/labels", () => ({ json: { labels: [
    // Inside the analyst's range: no lesson.
    { item_id: 1, entity: "Wing", title: "Wing expands", label: "medium", graded_score: 70, current_score: 75, current_band: "digest" },
    // Now a duplicate (no score): a HIGH label is not a lesson to score higher.
    { item_id: 2, entity: "Zoox", title: "Zoox copy", label: "high", graded_score: 85, current_score: null, current_band: "duplicate", note: "dup now" },
    // Directional label on a grade the analyst saw without a score.
    { item_id: 3, entity: "Waymo", title: "Waymo covered", label: "too_low", graded_score: null, current_score: 50, current_band: "borderline" },
    // Outside the range: the one lesson.
    { item_id: 4, entity: "Skydio", title: "Skydio Army order", label: "high", graded_score: 50, current_score: 55, current_band: "borderline" },
  ] } }));
  const r = await run(cwd, ["aux-labels"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^1 auxiliary item\(s\) whose current grade is outside the analyst's label/);
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(lines, ["- [Skydio] item_id=4 analyst=HIGH (80-100) grade now=55 (borderline) :: Skydio Army order"]);
  assert.deepEqual(readJson(zen(cwd, "aux-labels.json")).map((l) => [l.item_id, l.gap]), [[4, 25]]);
});

function claimDir() {
  const cwd = workdir();
  mkdirSync(zen(cwd, "rubric"), { recursive: true });
  writeFileSync(zen(cwd, "aux-claim.json"), JSON.stringify({ claim_id: "aux-claim-9", run_id: "run-9", rubric_version: "a-claim",
    items: [{ item_id: 101 }, { item_id: 102 }, { item_id: 103 }], remaining: 0 }));
  writeFileSync(zen(cwd, "rubric", "AUX_VERSION"), "a-loaded");
  return cwd;
}
const grade = (id, extra = {}) => ({ item_id: id, entity: "Anduril", score: 93, band: "lead", event_type: "financing", why: "Closed a $2.5B round.",
  reads_through: [], flags: ["reason:material"], confidence: 0.9, read_source: true, dup_of: null, covered_ticker: null, ...extra });

test("aux-submit posts the claim's grades, reports rejects with exit 2 and lists items still to grade", async () => {
  const cwd = claimDir();
  const first = [grade(101), grade(102, { band: "digest" })];
  writeFileSync(join(cwd, "aux-grades.json"), JSON.stringify(first));
  routes.set("POST /v1/aux/grades", () => ({ json: { accepted: 1, already_accepted: 0, already: [],
    rejected: [{ item_id: 102, error: "band digest does not match score 93 (lead)" }], results: [{ item_id: 101, score: 93, band: "lead" }] } }));
  const r = await run(cwd, ["aux-submit", "aux-grades.json"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].path, "/v1/aux/grades");
  assert.equal(requests[0].auth, `Bearer ${TOKEN}`);
  assert.deepEqual(requests[0].body, { claim_id: "aux-claim-9", run_id: "run-9", rubric_version: "a-loaded", model: "claude-routine", grades: first });
  assert.match(r.stdout, /^accepted 1, already accepted 0, rejected 1\n/);
  assert.match(r.stdout, /  REJECTED item 102: band digest does not match score 93 \(lead\)\n/);
  assert.match(r.stdout, /  NOT YET GRADED from this claim: 102, 103\n/);

  // Resubmit the fixed file in the {"grades": [...]} form: 101 is already stored.
  const second = { grades: [grade(101), grade(102), grade(103, { score: 45, band: "borderline", flags: ["reason:minor"] })] };
  writeFileSync(join(cwd, "aux-grades.json"), JSON.stringify(second));
  routes.set("POST /v1/aux/grades", () => ({ json: { accepted: 2, already_accepted: 1, already: [101], rejected: [],
    results: [{ item_id: 102, score: 93, band: "lead" }, { item_id: 103, score: 45, band: "borderline" }] } }));
  const r2 = await run(cwd, ["aux-submit", "aux-grades.json"]);
  assert.equal(r2.code, 0, r2.stderr);
  assert.deepEqual(requests[1].body.grades, second.grades);
  assert.match(r2.stdout, /^accepted 2, already accepted 1, rejected 0\n$/);
  assert.deepEqual(readJson(zen(cwd, "aux-graded-aux-claim-9.json")).sort(), ["101", "102", "103"]);
  assert.equal(existsSync(zen(cwd, "graded-aux-claim-9.json")), false, "coverage tracking files are separate");
});

test("aux-submit falls back to the claim's rubric version and to submitted-minus-rejected tracking", async () => {
  const cwd = claimDir();
  rmSync(zen(cwd, "rubric", "AUX_VERSION"));
  writeFileSync(join(cwd, "g.json"), JSON.stringify([grade(101), grade(102), grade(103)]));
  // A response with counts only still tracks what was stored.
  routes.set("POST /v1/aux/grades", () => ({ json: { accepted: 2, already_accepted: 0, rejected: [{ item_id: 103, error: "entity must be 1-80 characters" }] } }));
  const r = await run(cwd, ["aux-submit", "g.json"]);
  assert.equal(r.code, 2);
  assert.equal(requests[0].body.rubric_version, "a-claim");
  assert.match(r.stdout, /NOT YET GRADED from this claim: 103\n/);
});

test("aux-submit stops before calling the API without a claim or a readable grades file", async () => {
  const noClaim = workdir();
  writeFileSync(join(noClaim, "g.json"), "[]");
  let r = await run(noClaim, ["aux-submit", "g.json"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: no current auxiliary claim \(\.zenith\/aux-claim\.json\); run aux-claim first/);

  const cwd = claimDir();
  r = await run(cwd, ["aux-submit"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /usage: aux-submit <grades\.json>/);
  r = await run(cwd, ["aux-submit", "missing.json"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: cannot read missing\.json/);
  writeFileSync(join(cwd, "bad.json"), "[{\"item_id\": 101,");
  r = await run(cwd, ["aux-submit", "bad.json"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: cannot read bad\.json/);
  writeFileSync(join(cwd, "obj.json"), JSON.stringify({ item_id: 101 }));
  r = await run(cwd, ["aux-submit", "obj.json"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must hold a JSON array of grade objects/);
  assert.equal(requests.length, 0);
});

test("API errors stop with the status, an unreachable API stops with its reason, and the token is never printed", async () => {
  const cwd = workdir();
  routes.set("POST /v1/aux/claim", (q) => ({ status: 401, json: { error: "unauthorized", saw: q.auth ? "a token" : "none" } }));
  let r = await run(cwd, ["aux-claim"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: POST \/v1\/aux\/claim -> HTTP 401: \{"error":"unauthorized"/);
  assert.equal(existsSync(zen(cwd, "aux-claim.json")), false);

  routes.set("GET /v1/aux/labels", () => ({ status: 500, json: { error: "boom" } }));
  r = await run(cwd, ["aux-labels"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /GET \/v1\/aux\/labels\?limit=30 -> HTTP 500/);
  assert.equal(existsSync(zen(cwd, "aux-labels.json")), false);

  // A port nothing listens on.
  const closed = createServer();
  await new Promise((ok) => closed.listen(0, "127.0.0.1", ok));
  const deadPort = closed.address().port;
  await new Promise((ok) => closed.close(ok));
  r = await run(cwd, ["aux-recent", "-"], { api: `http://127.0.0.1:${deadPort}` });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^zenith: cannot reach http:\/\/127\.0\.0\.1:\d+ /);

  const before = requests.length;
  r = await run(cwd, ["aux-claim"], { token: "" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /set ZENITH_API and ZENITH_GRADER_TOKEN/);
  assert.equal(requests.length, before);
});

test("usage lists the auxiliary commands", async () => {
  const r = await run(workdir(), ["help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /aux-claim \[limit\] \| aux-rubric \| aux-recent <entity\|-> \[days\] \| aux-labels \[limit\] \| aux-submit <grades\.json>/);
  assert.match(r.stdout, /headlines-claim \[limit\] \[days\] \| headlines-submit <headlines\.json>/);
  assert.equal(requests.length, 0);
});

// rubric/auxiliary.md (served as aux.md) is what the grader follows; the API validates against spec
// section 4. Keep the two in step.
const AUX_REASONS = ["material", "minor", "noise", "stale", "duplicate", "covered_name", "off_topic", "promotional", "insufficient_evidence"];
const auxMd = readFileSync(join(root, "rubric", "auxiliary.md"), "utf8");
const covered = JSON.parse(readFileSync(join(root, "worker", "src", "covered.json"), "utf8"));

// Git for Windows refuses paths named after DOS devices (aux, con, nul, ...),
// even with an extension, so such a rubric file could not be checked out on
// Windows. That is why the auxiliary rubric is auxiliary.md, not aux.md.
test("rubric file names are valid Windows paths", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name, ...walk(join(dir, e.name))] : [e.name]));
  const bad = walk(join(root, "rubric")).filter((n) => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(n));
  assert.deepEqual(bad, []);
});

test("rubric/auxiliary.md lists exactly the covered universe", () => {
  const line = /The covered universe \(core\.md section 1\): (.*)$/m.exec(auxMd);
  assert.ok(line, "covered-universe line present");
  const tickers = line[1].split(" · ").map((part) => part.trim().split(" ")[0]);
  assert.deepEqual([...tickers].sort(), [...covered.tickers].sort());
});

test("rubric/auxiliary.md uses the API's reason flags, bands and output fields", () => {
  const table = auxMd.slice(auxMd.indexOf("| `reason:` |"));
  const reasons = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...reasons].sort(), [...AUX_REASONS].sort());
  for (const b of ["`lead` 90-100", "`digest` 70-89", "`borderline` 40-69", "`reject` 0-39"]) assert.ok(auxMd.includes(b), b);

  const example = JSON.parse(/## 8\. Output contract[\s\S]*?```json\n([\s\S]*?)\n```/.exec(auxMd)[1]);
  const FIELDS = ["item_id", "entity", "score", "band", "event_type", "why", "reads_through", "flags", "confidence", "read_source", "dup_of", "covered_ticker",
    "headline", "tag"];
  const bandFor = (s) => (s >= 90 ? "lead" : s >= 70 ? "digest" : s >= 40 ? "borderline" : "reject");
  for (const g of example) {
    assert.deepEqual(Object.keys(g).sort(), [...FIELDS].sort());
    const reasonFlags = g.flags.filter((f) => f.startsWith("reason:"));
    assert.equal(reasonFlags.length, 1);
    const reason = reasonFlags[0].slice(7);
    assert.ok(AUX_REASONS.includes(reason));
    if (reason === "duplicate") assert.ok(g.band === "duplicate" && g.score === null && Number.isInteger(g.dup_of) && g.dup_of !== g.item_id);
    else if (reason === "covered_name") assert.ok(g.band === "covered" && g.score === null && covered.tickers.includes(g.covered_ticker));
    else assert.equal(g.band, bandFor(g.score));
    if (!g.read_source) assert.ok(g.confidence <= 0.5, "confidence <= 0.5 when the source was not read");
    assert.ok(g.entity.trim().length >= 1 && g.entity.trim().length <= 80);
    assert.ok(g.event_type.length <= 40 && g.why.length <= 400);
    for (const rt of g.reads_through) assert.ok(covered.tickers.includes(rt.ticker) && ["+", "-", "±"].includes(rt.direction));
    const head = normalizeHeadline(g);
    assert.ok(head.ok && head.headline === g.headline && head.tag === g.tag, head.error);
  }
});

// Section 2 keeps 0-9 for data problems; correct but immaterial items (recognition,
// marketing, routine news) sit at 10-39, and every section 9 example fits its reason.
test("rubric/auxiliary.md reason ranges and examples agree with the score scale", () => {
  assert.match(auxMd, /0-9 = data problem/);
  const table = auxMd.slice(auxMd.indexOf("| `reason:` |"));
  const ranges = Object.fromEntries([...table.matchAll(/^\| `([a-z_]+)` \| [^|]+ \| (\d+)-(\d+) \|$/gm)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
  for (const r of ["material", "minor", "noise", "promotional"]) assert.ok(ranges[r][0] >= 10, `${r} starts at ${ranges[r][0]}, inside the data-problem range`);
  const examples = auxMd.slice(auxMd.indexOf("## 9. Examples"));
  const rows = [...examples.matchAll(/^\| [^|]+ \| (\d+) `([a-z_]+)` \|/gm)];
  assert.ok(rows.length >= 8);
  for (const [, score, reason] of rows) {
    const [lo, hi] = ranges[reason];
    assert.ok(Number(score) >= lo && Number(score) <= hi, `example ${score} ${reason} is outside ${lo}-${hi}`);
  }
  // The API rejects an empty entity: the rubric must say what to use when no company or program is named.
  assert.match(auxMd, /no company or program is named[^.\n]*routed `entity=` name/i);
});

test("rubric/auxiliary.md and GRADER.md: a coverage-subject item is auxiliary only when mainly about an outside company", () => {
  const md = readFileSync(join(root, "grader", "GRADER.md"), "utf8");
  const step5 = /^5\. [\s\S]*?(?=^6\. )/m.exec(md)[0];
  assert.match(step5, /`COVERAGE_SUBJECT affects=<TICKERS>`[\s\S]*mainly about an OUTSIDE\s+company or program[\s\S]*reason:covered_name`?\s+with `covered_ticker`/);
  const rule = /\*\*Coverage-subject items\.\*\*[^\n]*/.exec(auxMd)?.[0] || "";
  assert.match(rule, /`COVERAGE_SUBJECT affects=<TICKERS>`/);
  assert.match(rule, /mainly about an \*\*outside\*\* company or program: `entity` is that real company/);
  assert.match(rule, /never the routed feed name/);
  assert.match(rule, /mainly about a covered company[^.]*`reason:covered_name`, `covered_ticker`/);
  assert.match(auxMd, /\| `COVERAGE_SUBJECT affects=PL`: [^|]+\| null `covered_name` \| `covered_ticker: "PL"`/);
});

test("GRADER.md hands an empty coverage claim on to the auxiliary pass", () => {
  const md = readFileSync(join(root, "grader", "GRADER.md"), "utf8");
  const step = (n) => new RegExp(`^${n}\\. [\\s\\S]*?(?=^${n + 1}\\. |^## )`, "m").exec(md)[0];
  assert.match(step(1), /NOTHING WAITING[\s\S]*auxiliary pass \(step 5\)/);
  assert.doesNotMatch(step(1), /report "nothing to grade"/);
  // A coverage grade given up on after two resubmits must not block the auxiliary pass.
  assert.match(step(5), /given up on after two\s+resubmits/);
  // The grader reads the served rubric, which carries the version recorded on each grade.
  const intro = md.slice(0, md.indexOf("## Procedure"));
  assert.match(intro, /`\.zenith\/rubric\/aux\.md`/);
  assert.doesNotMatch(intro, /`rubric\/auxiliary\.md`/);
});
