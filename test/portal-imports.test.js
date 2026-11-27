// Phase 3 PR-PA2: the portal import boundary (S18) and the unchanged surfaces (S17).
// S18 is the T18 walk (test/rarity.test.js) from every worker/src/portal*.js and
// grader-health.js: the transitive import set reaches no Discord, brief, ingest,
// excerpt, tuning, auxiliary or index module; only company.js may read env.NEWS;
// the only fetch( is mobile.js's JWKS call (plus the /m page's own client script).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadWorkerModule, pfetch, sessionEnv } from "./helpers/portal.js";
import { addItem, addGrade } from "./helpers/d1.js";

const SRC = new URL("../worker/src/", import.meta.url);
const FORBIDDEN = ["delivery.js", "discord.js", "brief.js", "ingest.js", "excerpt.js", "tuning.js", "auxiliary.js", "index.js"];
const NEWS_ALLOWED = new Set(["company.js"]);
const FETCH_ALLOWED = new Set(["mobile.js"]);

function walk(start) {
  const seen = new Set();
  const go = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) go(m[1]);
  };
  go(start);
  return seen;
}

test("S18: no portal module reaches Discord, brief, ingest, excerpt, tuning, auxiliary or index code", () => {
  const starts = readdirSync(SRC).filter((f) => /^portal.*\.js$/.test(f));
  for (const f of ["portal.js", "portal-auth.js", "portal-html.js", "portal-shell.js", "portal-static.js", "portal-stub.js", "portal-icons.generated.js"]) {
    assert.ok(starts.includes(f), f);
  }
  starts.push("grader-health.js");
  const all = new Set();
  for (const s of starts) {
    const set = walk(s);
    for (const f of FORBIDDEN) assert.ok(!set.has(f), `${s} reaches ${f} (${[...set].join(", ")})`);
    for (const f of set) all.add(f);
  }
  assert.ok(all.has("mobile.js") && all.has("lib.js"), "the walk follows imports");
  for (const f of all) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    if (!NEWS_ALLOWED.has(f)) assert.doesNotMatch(code, /\benv\.NEWS\b/, `${f} reads env.NEWS`);
    if (!FETCH_ALLOWED.has(f)) assert.doesNotMatch(code, /\bfetch\(/, `${f} calls fetch(`);
    assert.doesNotMatch(code, /from\s+"\.\/budget\.js"/, `${f} imports budget.js`);
  }
  assert.doesNotMatch(readFileSync(new URL("grader-health.js", SRC), "utf8"), /^\s*import\s/m, "grader-health.js has no import line");
});

test("S17: GET /m opens the portal (PR-PA5); POST /m/feedback, /v1 and /health are unchanged next to it", async () => {
  const { worker } = await loadWorkerModule();
  const env = sessionEnv();
  for (const headers of [{}, { authorization: `Bearer ${env.APP_TOKEN}` }]) {
    const m = await worker.fetch(new Request("https://zenith.example.com/m", { headers }), env);
    assert.equal(m.status, 302);
    assert.equal(m.headers.get("location"), "/p/today");
    assert.equal(await m.text(), "", "no page and no data");
  }
  const id = await addItem(env.DB, { ticker: "SYM", title: "Symbotic test row" });
  await addGrade(env.DB, id, { score: 80 });
  const post = (headers) => worker.fetch(new Request("https://zenith.example.com/m/feedback", { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ item_id: id, label: "high" }) }), env, { waitUntil() {} });
  const denied = await post({});
  assert.equal(denied.status, 403);
  assert.equal(await denied.text(), "forbidden\n");
  assert.equal((await post({ authorization: `Bearer ${env.APP_TOKEN}` })).status, 200, "the app bearer still labels through POST /m/feedback");
  assert.equal((await env.DB.prepare("SELECT label FROM feedback WHERE item_id = ?").bind(id).first()).label, "high");
  const v = await worker.fetch(new Request("https://zenith.example.com/v1/feed"), env);
  assert.equal(v.status, 401);
  assert.deepEqual(await v.json(), { error: "unauthorized" });
  const h = await worker.fetch(new Request("https://zenith.example.com/health"), env);
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  // Paths that only look like the portal stay with the existing 404.
  for (const p of ["/px", "/P/today", "/p%2ftoday", "/sx"]) {
    const r = await pfetch(worker, env, p);
    assert.equal(r.status, 404, p);
    assert.deepEqual(JSON.parse(r.text), { error: "not found" }, p);
  }
});
