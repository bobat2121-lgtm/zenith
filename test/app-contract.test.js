// The Streamlit app against the real Worker: every /v1 path the app calls (read
// from app/*.py and app/views/*.py) is served to the app token, with the method
// the app uses, and answers with the fields the app reads. Seeded like a live
// system: one coverage ingest with grades, one aux claim graded through the API,
// a rival item left out, and a grader run.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { newsRows, insertNews, gradesFor } from "./helpers/aux-e2e.js";
import { addOpsTables, addAlert, addManagedConfig, addHealth } from "./helpers/news-ops.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { upsertSightings } = await import("../worker/src/expansion.js");

const APP = new URL("../app/", import.meta.url);
const appSource = [...["zenith_feed.py", "streamlit_app.py"].map((f) => new URL(f, APP)),
  ...readdirSync(new URL("views/", APP)).filter((f) => f.endsWith(".py")).map((f) => new URL(`views/${f}`, APP))]
  .map((u) => readFileSync(u, "utf8")).join("\n");
const appPaths = [...new Set([...appSource.matchAll(/["'](\/v1\/[a-z0-9/_-]+)["']/g)].map((m) => m[1]))].sort();

const HOUR = 3_600_000;
let env;
const app = (method, path, body) => request(worker, env, method, path, { role: "app", body });
const has = (obj, keys, what) => { for (const k of keys) assert.ok(obj && k in obj, `${what} has ${k}: ${JSON.stringify(obj)?.slice(0, 300)}`); };

before(async () => {
  const now = Date.now();
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  insertNews(news, [...newsRows(now),
    { source_key: "tfvector", title: "TFVector unveils new FPV interceptor", first_seen: new Date(now - 3 * HOUR).toISOString() }]);
  env = { DB: zenithDb(), NEWS: news, ...TOKENS };
  assert.equal((await request(worker, env, "POST", "/v1/admin/ingest", { body: {} })).status, 200);
  assert.equal((await request(worker, env, "POST", "/v1/admin/aux-ingest", { body: {} })).status, 200);
  const cc = await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 30, run_id: "run-contract", model: "m" } });
  assert.equal(cc.status, 200);
  const ins = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at, confidence)
    VALUES (?, ?, 'run-contract', 'r-test', 'm', 68, 'borderline', 'A follow-on order.', '["reason:material"]', 1, ?, 0.5)`);
  for (const it of cc.body.items) {
    const g = ins.run(it.item_id, it.ticker, new Date().toISOString());
    env.DB.db.prepare("UPDATE items SET state='graded', grade_id=?, claim_id=NULL WHERE id=?").run(Number(g.lastInsertRowid), it.item_id);
  }
  const ac = await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 40, run_id: "run-contract-aux", model: "m" } });
  const { grades } = gradesFor(ac.body, "RCAT");
  const rest = ac.body.items.filter((i) => !grades.some((g) => g.item_id === i.item_id)).map((i) => ({ item_id: i.item_id, entity: "TFVector",
    score: 30, band: "reject", event_type: "product", why: "Rival product news.", reads_through: [], confidence: 0.5, read_source: true,
    dup_of: null, covered_ticker: null, flags: ["reason:noise"] }));
  const sub = await request(worker, env, "POST", "/v1/aux/grades", { role: "grader", body: { claim_id: ac.body.claim_id, run_id: ac.body.run_id, model: "m", grades: [...grades, ...rest] } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
});

// The expansion queue (plans/round5-expansion-approve-queue.md, D1): one row per
// origin shape, an SEC filing party among them. Idempotent: the same items.
async function seedExpansion() {
  const at = new Date().toISOString();
  const sec = { name: "Upgrade Energy", origin: "sec_filing", relation: "acquired", subject: "UMAC", tickers: ["UMAC"], kind: "coverage", item_id: 18,
    url: "https://www.sec.gov/Archives/edgar/data/1956955/000168316826008046/umac_8k.htm", title: "Unusual Machines, Inc.: 8-K filed 2026-10-23", at,
    party: "DroneNX LLC d/b/a Upgrade Energy", aliases: ["DroneNX LLC"] };
  const r = await upsertSightings(env.DB, [sec, { ...sec, origin: "grader_relation", party: undefined, aliases: undefined },
    { name: "Genesis AI", origin: "aux_entity", relation: null, subject: null, tickers: [], kind: "aux", item_id: 222, url: "https://news.example.com/g", title: "Genesis AI raises", at },
    { name: "Anduril", origin: "grader_relation", relation: "partner", subject: "SPAI", tickers: ["SPAI"], kind: "coverage", item_id: 259, url: "https://ir.example.com/259", title: "Safe Pro news", at }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  return Object.fromEntries(env.DB.rows("SELECT id, name FROM expansion_candidates").map((x) => [x.name, x.id]));
}
const CANDIDATE_FIELDS = ["id", "name", "status", "relation", "subject", "origins", "tickers", "sightings", "evidence", "known", "similar",
  "decision", "approved_tickers", "actions", "decidable", "blocked", "last_seen_at", "about", "about_fallback", "about_source"];

// Each path the app calls: how the app calls it, and the fields the app reads.
const CONTRACT = {
  "/v1/expansion/candidates": async () => {
    await seedExpansion();
    for (const status of ["pending", "approved", "rejected", "known", "compiled"]) {
      const b = await ok("GET", `/v1/expansion/candidates?status=${status}&limit=50`);
      has(b, ["status", "counts", "candidates", "reject_reasons"], `expansion/candidates ${status}`);
      for (const c of b.candidates) {
        has(c, CANDIDATE_FIELDS, "candidate");
        for (const e of c.evidence) has(e, ["kind", "item_id", "url", "title", "at", "origin"], "candidate evidence");
      }
    }
    const pending = (await ok("GET", "/v1/expansion/candidates?status=pending&limit=50")).candidates;
    const upgrade = pending.find((c) => c.name === "Upgrade Energy");
    assert.deepEqual([upgrade.origins, upgrade.sightings, upgrade.known], [["sec_filing", "grader_relation"], 1, ["sheet_term:UMAC"]]);
    assert.equal(upgrade.evidence.find((e) => e.origin === "sec_filing").party, "DroneNX LLC d/b/a Upgrade Energy");
    const known = (await ok("GET", "/v1/expansion/candidates?status=known")).candidates;
    assert.deepEqual(known.find((c) => c.name === "Anduril").actions, ["reopen"]);
    assert.ok(known.every((c) => c.decidable === false && typeof c.blocked === "string"), "the app offers only Not the same company");
  },
  "/v1/expansion/decide": async () => {
    const ids = await seedExpansion();
    const d = await ok("POST", "/v1/expansion/decide", { id: ids["Genesis AI"], action: "reject", reason: "too_small", note: null });
    assert.deepEqual([d.status, d.decision.reason, d.decision.by], ["rejected", "too_small", "app"]);
    await ok("POST", "/v1/expansion/decide", { id: ids.Anduril, action: "reopen" });
    assert.equal((await app("POST", "/v1/expansion/decide", { id: ids["Upgrade Energy"], action: "approve", tickers: ["TSLA"] })).status, 400);
    const a = await ok("POST", "/v1/expansion/decide", { id: ids["Upgrade Energy"], action: "approve", tickers: ["UMAC"] });
    assert.deepEqual([a.status, a.decision.tickers], ["approved", ["UMAC"]]);
  },
  "/v1/expansion/compiled": async () => {
    const ids = await seedExpansion();
    const approved = (await ok("GET", "/v1/expansion/candidates?status=approved")).candidates;
    if (!approved.length) await ok("POST", "/v1/expansion/decide", { id: ids["Upgrade Energy"], action: "approve", tickers: ["UMAC"] });
    const read = (await ok("GET", "/v1/expansion/candidates?status=approved")).candidates;
    const b = await ok("POST", "/v1/expansion/compiled", { items: read.map((c) => ({ id: c.id, tickers: c.approved_tickers })), ref: "166" });
    has(b, ["ok", "compiled", "mismatches"], "expansion/compiled");
    assert.deepEqual([b.ok, b.compiled, b.mismatches], [true, read.map((c) => c.id), []]);
  },
  "/v1/stats": async () => has((await ok("GET", "/v1/stats")), ["tickers", "last_run", "labels", "aux"], "stats"),
  "/v1/source-health": async () => has(await ok("GET", "/v1/source-health"), ["edgar_fast_path", "ir_probes"], "source-health"),
  "/v1/site-changes": async () => has(await ok("GET", "/v1/site-changes?days=14&limit=20&tickers=RCAT"), ["items"], "site-changes"),
  "/v1/feed": async () => {
    for (const q of ["", "?order=newest", "?sort=to_label&unlabeled=1&state=graded", "?ticker=RCAT"]) {
      const b = await ok("GET", `/v1/feed${q}`);
      assert.ok(b.items.length, `/v1/feed${q} has items`);
      for (const it of b.items) has(it, ["item_id", "ticker", "url", "title", "why", "snippet", "grade_id", "event_date", "score", "band", "confidence", "label", "my_reason", "source_key", "first_seen", "owner_pick", "bill_lines"], `/v1/feed${q} item`);
    }
  },
  "/v1/aux/feed": async () => {
    for (const q of ["", "?order=newest", "?sort=to_label&unlabeled=1&state=graded"]) {
      const b = await ok("GET", `/v1/aux/feed${q}`);
      assert.ok(b.items.length, `/v1/aux/feed${q} has items`);
      for (const it of b.items) has(it, ["item_id", "url", "title", "why", "entity", "entity_key", "score", "band", "confidence", "label", "my_reason", "source_key", "first_seen", "owner_pick"], `/v1/aux/feed${q} item`);
    }
  },
  "/v1/feedback": async () => {
    const it = (await ok("GET", "/v1/feed")).items[0];
    await ok("POST", "/v1/feedback", { item_id: it.item_id, label: "noise", note: null, ticker: it.ticker, grade_id: it.grade_id, reason: "stale" });
    const after = (await ok("GET", `/v1/feed?ticker=${it.ticker}`)).items.find((x) => x.item_id === it.item_id);
    assert.deepEqual([after.label, after.my_reason], ["noise", "stale"]);
    assert.equal((await app("POST", "/v1/feedback", { item_id: it.item_id, label: "noise", ticker: it.ticker, reason: "bogus" })).status, 400);
  },
  "/v1/aux/feedback": async () => {
    const it = (await ok("GET", "/v1/aux/feed")).items[0];
    await ok("POST", "/v1/aux/feedback", { item_id: it.item_id, label: "low", reason: "marketing" });
    const after = (await ok("GET", "/v1/aux/feed")).items.find((x) => x.item_id === it.item_id);
    assert.deepEqual([after.label, after.my_reason], ["low", "marketing"]);
  },
  "/v1/ops": async () => {
    const b = await ok("GET", "/v1/ops");
    has(b, ["grader", "as_of"], "ops");
    has(b.grader, ["last_run_at", "last_run", "runs_24h", "gaps_7d", "status", "checks", "backlog"], "ops.grader");
    has(b.grader.backlog, ["coverage_pending", "aux_pending", "headlines_waiting", "oldest_aux_pending_at"], "ops.grader.backlog");
    assert.ok(Array.isArray(b.grader.gaps_7d) && Array.isArray(b.grader.checks));
  },
  "/v1/calibration": async () => {
    const b = await ok("GET", "/v1/calibration");
    has(b, ["coverage", "aux", "reasons"], "calibration");
    for (const part of ["coverage", "aux"]) {
      has(b[part], ["all_time", "this_week", "misses"], `calibration.${part}`);
      for (const w of ["all_time", "this_week"]) has(b[part][w], ["n", "agreement", "scored", "too_high", "too_low"], `calibration.${part}.${w}`);
      assert.equal(b[part].all_time.n, 1, `${part} counts the label posted above`);
      for (const m of b[part].misses) has(m, ["score", "label", "verdict", "title", part === "aux" ? "entity" : "ticker"], `calibration.${part} miss`);
    }
    assert.deepEqual(b.reasons, { stale: 1, marketing: 1 });
  },
  "/v1/source-yield": async () => {
    const b = await ok("GET", "/v1/source-yield?days=30");
    has(b, ["coverage", "aux"], "source-yield");
    assert.ok(b.coverage.length && b.aux.length);
    for (const r of b.coverage) has(r, ["source_key", "graded", "high", "reject", "duplicate", "last_high_at", "pref", "suggest", "mutable", "lock"], "yield row");
    for (const r of b.aux) has(r, ["source_key", "graded", "high", "reject", "duplicate", "covered", "last_high_at", "pref", "suggest", "mutable", "lock"], "aux yield row");
  },
  "/v1/source-prefs": async () => {
    await ok("POST", "/v1/source-prefs", { source_key: "tfvector", action: "demote" });
    assert.deepEqual((await ok("GET", "/v1/source-prefs")).prefs.map((p) => [p.source_key, p.action]), [["tfvector", "demote"]]);
    await ok("POST", "/v1/source-prefs", { source_key: "tfvector", action: "normal" });
  },
  "/v1/left-out": async () => {
    for (const kind of ["coverage", "aux"]) {
      const b = await ok("GET", `/v1/left-out?kind=${kind}&days=14&limit=20`);
      has(b, ["items", "counts"], `left-out ${kind}`);
      for (const it of b.items) has(it, ["id", "kind", kind === "aux" ? "entity" : "ticker", "source_key", "title", "url", "first_seen", "skip_reason", "gradeable", "blocked"], "left-out item");
    }
    const cov = await ok("GET", "/v1/left-out?kind=coverage&days=14&limit=20");
    assert.ok(cov.items.some((i) => i.skip_reason === "rival_no_key_account"), "the rival item is left out of coverage");
    const arch = await ok("GET", "/v1/left-out?kind=aux&reason=archive_seed&days=14&limit=20");
    assert.ok(arch.items.length && arch.items.every((i) => i.skip_reason === "archive_seed"));
  },
  "/v1/left-out/grade": async () => {
    const seed = (await ok("GET", "/v1/left-out?kind=aux&reason=archive_seed&days=14&limit=20")).items[0];
    await ok("POST", "/v1/left-out/grade", { kind: "aux", id: seed.id });
    assert.equal(env.DB.rows("SELECT state FROM aux_items WHERE id = ?", seed.id)[0].state, "pending");
    // The rival item's aux copy is graded: rescuing the coverage copy is refused (never on both pages).
    const rival = (await ok("GET", "/v1/left-out?kind=coverage&days=14&limit=20")).items.find((i) => i.skip_reason === "rival_no_key_account");
    assert.equal((await app("POST", "/v1/left-out/grade", { kind: "coverage", id: rival.id })).status, 400);
    assert.deepEqual([rival.gradeable, typeof rival.blocked], [false, "string"], "the app hides Grade it for it");
  },
  // Zenith show (phase 0): the Brief page, the Coverage ops strip and the Tuning recall section.
  "/v1/brief": async () => {
    // The seeded grades are 68, under the brief's 70 floor: lift one so the row fields are checked.
    env.DB.db.prepare("UPDATE grades SET score = 75, band = 'digest' WHERE id = (SELECT MIN(id) FROM grades WHERE run_id = 'run-contract')").run();
    const b = await ok("GET", `/v1/brief?since=${encodeURIComponent(new Date(Date.now() - 24 * HOUR).toISOString())}`);
    has(b, ["kind", "generated_at", "from", "to", "window", "leads_digests", "counterparty", "waiting", "catalysts", "health", "to_label"], "brief");
    has(b.waiting, ["count", "counterparty_count", "oldest", "items"], "brief.waiting");
    has(b.health, ["grader_last_run", "graded_in_window", "news_monitor"], "brief.health");
    const rows = [...b.leads_digests.flatMap((g) => g.items), ...b.counterparty];
    assert.ok(rows.length, "the brief has a graded row");
    for (const r of rows) has(r, ["headline", "headline_tag", "title", "url", "score", "band", "why", "graded_at", "item_ticker", "ticker"], "brief row");
    for (const e of b.catalysts) has(e, ["ticker", "start", "precision", "text"], "brief catalyst");
    for (const r of b.to_label) has(r, ["item_id", "ticker", "title", "url", "score", "why"], "brief to_label");
    for (const r of b.waiting.items) has(r, ["ticker", "title", "url", "nm_first_seen"], "brief waiting row");
  },
  "/v1/calendar": async () => {
    const b = await ok("GET", "/v1/calendar?days=30");
    has(b, ["from", "days", "entries"], "calendar");
    assert.ok(b.entries.length, "the sheet calendar has entries in 30 days");
    for (const e of b.entries) has(e, ["ticker", "kind", "start", "precision", "text"], "calendar entry");
  },
  "/v1/news-ops": async () => {
    // An isolated news-monitor-db with the ops tables, so the shared env.NEWS stays as it is.
    const news = addOpsTables(newsDb());
    addAlert(news, { source_key: "ticker:SYM", rule: "crosscheck_missing_release", detail: { ticker: "SYM", form: "8-K", items: ["7.01", "9.01"] } });
    addManagedConfig(news, 1, [{ key: "m_test", name: "Test Co" }]);
    addHealth(news, "m_test", 5);
    const r = await request(worker, { ...env, NEWS: news }, "GET", "/v1/news-ops", { role: "app" });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const b = r.body;
    has(b, ["alerts", "managed", "as_of"], "news-ops");
    has(b.alerts, ["open", "open_count", "bing_open", "resolved_24h"], "news-ops.alerts");
    assert.ok(b.alerts.open.length);
    for (const a of b.alerts.open) has(a, ["source_key", "rule", "opened_at", "last_seen_at", "acknowledged", "snoozed", "detail"], "news-ops alert");
    has(b.managed, ["configured", "failing", "failing_count", "last_attempt", "config_updated_at"], "news-ops.managed");
    assert.ok(b.managed.failing.length);
    for (const f of b.managed.failing) has(f, ["key", "name", "fail_count", "last_ok", "last_error"], "news-ops failing");
  },
  "/v1/recall": async () => {
    const events = [["SYM-1", "on_time"], ["SYM-2", "late"], ["SYM-3", "missed"]].map(([id, status]) => ({ id, ticker: "SYM", event: `Test event ${id}`,
      event_date: "2026-01-02", kind: "news", public_url: `https://news.example.com/${id}`, status, checked_at: "2026-01-15" }));
    const load = await request(worker, env, "POST", "/v1/admin/recall", { body: { source: "test-seed", events } });
    assert.equal(load.status, 200, JSON.stringify(load.body));
    assert.equal(load.body.accepted, 3);
    const b = await ok("GET", "/v1/recall");
    has(b, ["total", "by_status", "by_kind", "checked_at"], "recall");
    has(b.by_status, ["on_time", "late", "partial", "missed"], "recall.by_status");
    for (const r of b.by_kind) has(r, ["kind", "on_time", "late", "partial", "missed", "total"], "recall kind row");
    const b2 = await ok("GET", "/v1/recall?events=1");
    assert.ok(!("events" in b2), "the app token never gets the event list");
  },
};
async function ok(method, path, body) {
  const r = await app(method, path, body);
  assert.equal(r.status, 200, `${method} ${path} for the app: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// Worker routes the contract already checks before the app calls them (round 5:
// the Tuning page's Expansion queue lands in its own part). Once the app calls
// one, it is checked like any other path.
const AHEAD_OF_APP = new Set(["/v1/expansion/candidates", "/v1/expansion/decide", "/v1/expansion/compiled"]);
test("the app's /v1 paths are exactly the ones this contract checks", () => {
  assert.deepEqual(appPaths, Object.keys(CONTRACT).filter((p) => !AHEAD_OF_APP.has(p) || appPaths.includes(p)).sort());
  for (const p of appPaths) assert.ok(p in CONTRACT, `the app calls ${p}`);
});

for (const [path, check] of Object.entries(CONTRACT)) {
  test(`app contract: ${path} is served to the app token with the fields the app reads`, check);
}

test("the app token is refused on grader and admin routes", async () => {
  for (const [m, p] of [["POST", "/v1/queue/claim"], ["POST", "/v1/grades"], ["GET", "/v1/labels"], ["POST", "/v1/admin/ingest"], ["POST", "/v1/aux/claim"]]) {
    assert.equal((await app(m, p, m === "POST" ? {} : undefined)).status, 403, `${m} ${p}`);
  }
});
