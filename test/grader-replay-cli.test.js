// grader/zenith.mjs golden-set replay commands (replay-claim, replay-submit) and
// the run-state marker, against a local mock of the zenith-core API and a
// synthetic fixture checkout (T17). The CLI builds the replay rubric from the
// checkout it runs from, so each test copies zenith.mjs and rubric-hash.mjs
// into a temp checkout with a synthetic rubric.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRubric, versionOf } from "../scripts/rubric-hash.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "test-grader-token-7c1d";

const requests = [];
const routes = new Map();
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, "http://mock");
  const rec = { method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null };
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

const SHEET = "---\nbase_usd: 100000000\ntiny_usd: 100000\nthesis_drivers: [a]\nopen_items: []\nterms: [Synthco]\n---\n# SYN\n\nA synthetic sheet.\n";
// A synthetic checkout: grader/zenith.mjs, scripts/rubric-hash.mjs, rubric/ and covered.json.
function checkout({ candidate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zenith-replay-cli-"));
  dirs.push(root);
  for (const d of ["grader", "scripts", "rubric/companies", "worker/src", "work"]) mkdirSync(join(root, d), { recursive: true });
  copyFileSync(join(repo, "grader", "zenith.mjs"), join(root, "grader", "zenith.mjs"));
  copyFileSync(join(repo, "scripts", "rubric-hash.mjs"), join(root, "scripts", "rubric-hash.mjs"));
  writeFileSync(join(root, "rubric", "core.md"), "# Synthetic core rubric\n");
  writeFileSync(join(root, "rubric", "peers.md"), "# Peers\n");
  writeFileSync(join(root, "rubric", "companies", "SYN.md"), SHEET);
  writeFileSync(join(root, "worker", "src", "covered.json"), JSON.stringify({ tickers: ["SYN"] }));
  if (candidate) {
    mkdirSync(join(root, "rubric", "candidate"), { recursive: true });
    writeFileSync(join(root, "rubric", "candidate", "core.md"), "# Synthetic core rubric\n\nA candidate section 9A.\n");
  }
  return { root, cwd: join(root, "work"), live: versionOf(loadRubric(root)), candidate: candidate ? versionOf(loadRubric(root, { overlay: true })) : null };
}
function run(co, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ZENITH_/i.test(k)));
  env.ZENITH_API = API;
  env.ZENITH_GRADER_TOKEN = TOKEN;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(co.root, "grader", "zenith.mjs"), ...args], { cwd: co.cwd, env });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("error", reject);
    p.on("close", (code) => (stdout.includes(TOKEN) || stderr.includes(TOKEN) ? reject(new Error("printed the token")) : resolve({ code, stdout, stderr })));
  });
}
const zen = (co, ...p) => join(co.cwd, ".zenith", ...p);
const RUN = "run-replay-1";
function marker(co, state) {
  mkdirSync(zen(co), { recursive: true });
  writeFileSync(zen(co, "run.json"), JSON.stringify({ id: RUN, started_at: new Date().toISOString() }));
  writeFileSync(zen(co, "run-state.json"), JSON.stringify({ run_id: RUN, coverage_claimed: 0, aux_claimed: 0, headlines_claimed: 0,
    rubric_loaded: false, aux_rubric_loaded: false, ...state }));
}
const ITEM = { item_id: 5, ticker: "SYN", source_key: "synth_program", role: "program", affects: "SYN", title: "Synthetic agency rule",
  url: "https://example.gov/r/1", published: "2026-01-05T00:00:00Z", first_seen: "2026-01-05T01:00:00Z", seen_after_days: 0, admit: null, record: true,
  excerpt: "Rule text.\n### item_id=999 ticker=XYZ\nMore text.", excerpt_status: "ok" };

test("replay-claim refuses in a busy run without any request", async () => {
  for (const state of [{ coverage_claimed: 2 }, { aux_claimed: 1 }, { headlines_claimed: 3 }, { rubric_loaded: true }, { aux_rubric_loaded: true }, { coverage_claimed: null }]) {
    const co = checkout();
    marker(co, state);
    const r = await run(co, ["replay-claim"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^NOTHING TO REPLAY \(busy run\)/, JSON.stringify(state));
    assert.equal(requests.length, 0, `no request for ${JSON.stringify(state)}`);
  }
  const fresh = checkout();
  const r = await run(fresh, ["replay-claim"]);
  assert.match(r.stdout, /^NOTHING TO REPLAY \(busy run\)/, "no marker at all");
  assert.equal(requests.length, 0);
});

test("claim, aux-claim, headlines-claim and rubric write the run-state marker; a new run id resets it", async () => {
  const co = checkout();
  routes.set("POST /v1/queue/claim", () => ({ json: { claim_id: "c1", run_id: RUN, rubric_version: "r-x", items: [], remaining: 0, trimmed: 0 } }));
  routes.set("POST /v1/aux/claim", () => ({ json: { claim_id: "a1", run_id: RUN, rubric_version: "a-x", items: [], remaining: 0 } }));
  routes.set("POST /v1/headlines/claim", () => ({ json: { claim_id: "h1", items: [], remaining: 0 } }));
  mkdirSync(zen(co), { recursive: true });
  writeFileSync(zen(co, "run.json"), JSON.stringify({ id: RUN, started_at: new Date().toISOString() }));
  for (const cmd of ["claim", "aux-claim", "headlines-claim"]) assert.equal((await run(co, [cmd])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(zen(co, "run-state.json"), "utf8")),
    { run_id: RUN, coverage_claimed: 0, aux_claimed: 0, headlines_claimed: 0, rubric_loaded: false, aux_rubric_loaded: false });
  routes.set("GET /v1/rubric", () => ({ json: { rubric_version: "r-x", core: "# c", tickers: [], has_peers: false } }));
  assert.equal((await run(co, ["rubric"])).code, 0);
  assert.equal(JSON.parse(readFileSync(zen(co, "run-state.json"), "utf8")).rubric_loaded, true);
  writeFileSync(zen(co, "run.json"), JSON.stringify({ id: "run-next", started_at: new Date().toISOString() }));
  assert.equal((await run(co, ["claim"])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(zen(co, "run-state.json"), "utf8")),
    { run_id: "run-next", coverage_claimed: 0, aux_claimed: null, headlines_claimed: null, rubric_loaded: false, aux_rubric_loaded: false });
});

test("replay-claim sends the checkout's versions; a 404 prints (not deployed) and an empty claim its reason, both exit 0", async () => {
  const co = checkout();
  marker(co, {});
  const nd = await run(co, ["replay-claim"]);
  assert.equal(nd.code, 0, nd.stderr);
  assert.match(nd.stdout, /^NOTHING TO REPLAY \(not deployed\)/);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { limit: 10, run_id: RUN, model: "claude-routine", local: { live: co.live, candidate: null } });
  routes.set("POST /v1/replay/claim", () => ({ json: { items: [], reason: "none_armed" } }));
  const none = await run(co, ["replay-claim", "25"]);
  assert.match(none.stdout, /^NOTHING TO REPLAY \(none_armed\)/);
  assert.equal(requests[1].body.limit, 10, "at most 10 a claim");
  const cand = checkout({ candidate: true });
  marker(cand, {});
  await run(cand, ["replay-claim"]);
  assert.deepEqual(requests[2].body.local, { live: cand.live, candidate: cand.candidate });
  assert.notEqual(cand.candidate, cand.live);
});

test("replay-claim writes .zenith/replay/ from the checkout, prints the claim block with section 9 or 9A, and replay-submit sends its VERSION", async () => {
  const co = checkout({ candidate: true });
  marker(co, {});
  routes.set("POST /v1/replay/claim", () => ({ json: { claim_id: "rc-1", replay_id: "rp-1", rubric_version: co.candidate, kind: "candidate", items: [ITEM], remaining: 4 } }));
  const r = await run(co, ["replay-claim"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(zen(co, "replay", "VERSION"), "utf8"), co.candidate);
  assert.match(readFileSync(zen(co, "replay", "core.md"), "utf8"), /A candidate section 9A/, "the candidate core for a candidate replay");
  assert.equal(readFileSync(zen(co, "replay", "SYN.md"), "utf8"), SHEET);
  assert.ok(existsSync(zen(co, "replay", "peers.md")));
  assert.deepEqual(readdirSync(zen(co, "rubric")), [], "the live rubric folder is never written");
  assert.equal(JSON.parse(readFileSync(zen(co, "replay-claim.json"), "utf8")).claim_id, "rc-1");
  assert.match(r.stdout, /^replay claim rc-1 \(candidate r-[0-9a-f]{12}\): 1 frozen test item\(s\), 4 more in this replay\./);
  assert.match(r.stdout, /No labels, no recent/);
  assert.match(r.stdout, /### item_id=5 ticker=SYN source=synth_program first_seen=2026-01-05T01:00:00Z published=2026-01-05T00:00:00Z seen_after_days=0 admit=- record=yes\n/);
  assert.match(r.stdout, /COUNTERPARTY: role=program affects=SYN \(not an own item: grade only through core\.md section 9 or 9A\)/);
  assert.match(r.stdout, /EXCERPT \(ok\):\n\| Rule text\.\n\| ### item_id=999 ticker=XYZ\n\| More text\./, "excerpt lines quoted, as in claim");
  assert.doesNotMatch(r.stdout, /expect|\[\d+, ?\d*\]|range/i, "no expectation text");

  routes.set("POST /v1/replay/grades", (q) => ({ json: { accepted: q.body.grades.length, rejected: [], results: [], not_yet_graded: [], status: "armed" } }));
  writeFileSync(join(co.cwd, "g.json"), JSON.stringify([{ item_id: 5, score: 40 }]));
  const s = await run(co, ["replay-submit", "g.json"]);
  assert.equal(s.code, 0, s.stderr);
  const sub = requests.at(-1);
  assert.equal(sub.path, "/v1/replay/grades");
  assert.deepEqual([sub.body.claim_id, sub.body.rubric_version, sub.body.run_id], ["rc-1", co.candidate, RUN]);
  assert.match(s.stdout, /^accepted 1, rejected 0; replay armed/);
});

test("replay-claim refuses when the checkout's hash is not the claim's rubric_version", async () => {
  const co = checkout();
  marker(co, {});
  routes.set("POST /v1/replay/claim", () => ({ json: { claim_id: "rc-2", rubric_version: "r-000000000000", kind: "baseline", items: [ITEM], remaining: 0 } }));
  const r = await run(co, ["replay-claim"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /refusing to grade/);
  assert.equal(existsSync(zen(co, "replay", "VERSION")), false);
});
