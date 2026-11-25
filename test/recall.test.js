// Recall scoreboard (Zenith show, phase 0): migration 0015, POST /v1/admin/recall
// and GET /v1/recall. Synthetic events and synthetic numbers only (a 7-event seed:
// 3 on time, 2 late, 1 partial, 1 missed). The last test guards the public repo:
// no recall seed, event list or real tally is tracked here.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { addItem } from "./helpers/d1.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { validateRecallEvent, RECALL_KINDS, RECALL_STATUSES } = await import("../worker/src/recall.js");

const newEnv = () => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS });
const load = (env, body, role = "admin") => request(worker, env, "POST", "/v1/admin/recall", { role, body });
const get = (env, q = "", role = "app") => request(worker, env, "GET", `/v1/recall${q}`, { role });

let n = 0;
const ev = (over = {}) => ({
  id: `SYM-${++n}`, ticker: "SYM", event: `2026-01-0${(n % 9) + 1} Test event ${n}`, event_date: `2026-01-0${(n % 9) + 1}`, kind: "news",
  public_url: `https://news.example.com/test-${n}`, status: "on_time", captured_ref: "test row", first_seen: null, lag_days: null,
  verdict: null, verdict_ref: null, notes: null, checked_at: "2026-01-15", ...over,
});
// The synthetic seed: 7 events, 3 on time, 2 late, 1 partial, 1 missed; filing 4 (2/1/1/0), news 3 (1/1/0/1).
function seven() {
  return [
    ev({ id: "SYM-1", kind: "filing", status: "on_time" }), ev({ id: "SYM-2", kind: "filing", status: "on_time" }),
    ev({ id: "SYM-3", kind: "filing", status: "late", verdict: "confirmed", verdict_ref: "miss:SYM:1", notes: "[confirmed] test note" }),
    ev({ id: "SYM-4", kind: "filing", status: "partial" }),
    ev({ id: "AXON-1", ticker: "AXON", kind: "news", status: "on_time" }), ev({ id: "AXON-2", ticker: "AXON", kind: "news", status: "late" }),
    ev({ id: "AXON-3", ticker: "AXON", kind: "news", status: "missed" }),
  ];
}
const rows = (env) => env.DB.rows("SELECT * FROM recall_events ORDER BY id");

test("migration 0015 creates recall_events with status and kind checks", () => {
  const env = newEnv();
  const cols = env.DB.rows("SELECT name FROM pragma_table_info('recall_events')").map((r) => r.name);
  assert.deepEqual(cols, ["id", "ticker", "event", "event_date", "kind", "public_url", "status", "captured_kind", "captured_item_id", "captured_ref",
    "first_seen", "lag_days", "verdict", "verdict_ref", "notes", "source", "checked_at", "loaded_at"]);
  const ins = (kind, status, captured = null, verdict = null) => env.DB.db.prepare(
    `INSERT INTO recall_events (id, ticker, event, kind, status, captured_kind, verdict, source, checked_at, loaded_at)
     VALUES (?, 'SYM', 'Test event', ?, ?, ?, ?, 'test-seed', '2026-01-15', '2026-01-15')`).run(`SYM-${++n}`, kind, status, captured, verdict);
  ins("news", "late", "aux", "partly");
  assert.throws(() => ins("blog", "late"), /CHECK/);
  assert.throws(() => ins("news", "early"), /CHECK/);
  assert.throws(() => ins("news", "late", "both"), /CHECK/);
  assert.throws(() => ins("news", "late", null, "maybe"), /CHECK/);
  assert.deepEqual([RECALL_KINDS.length, RECALL_STATUSES], [7, ["on_time", "late", "partial", "missed"]]);
  const idx = env.DB.rows("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recall_events' AND name LIKE 'recall_events_%'").map((r) => r.name).sort();
  assert.deepEqual(idx, ["recall_events_status", "recall_events_ticker"]);
});

test("POST /v1/admin/recall: admin only (app 403, grader 403); bad events rejected one by one; upsert by id is idempotent; dry_run writes nothing", async () => {
  const env = newEnv();
  const body = { source: "test-seed", events: seven() };
  assert.equal((await load(env, body, "app")).status, 403);
  assert.equal((await load(env, body, "grader")).status, 403);
  assert.equal((await load(env, { source: "test-seed" })).status, 400, "a missing events array");
  assert.equal((await load(env, { source: "Test Seed!", events: seven() })).status, 400, "a bad source label");
  assert.equal((await load(env, { source: "test-seed", events: [] })).status, 400);
  assert.equal((await load(env, { source: "test-seed", events: Array.from({ length: 201 }, () => ev()) })).status, 400);

  const dry = await load(env, { ...body, dry_run: true });
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.body.accepted, dry.body.dry_run, dry.body.by_status], [7, true, { on_time: 3, late: 2, partial: 1, missed: 1 }]);
  assert.equal(rows(env).length, 0, "a dry run writes nothing");

  const bad = [
    ev({ id: "sym-9" }), ev({ id: "AXON-9" }), ev({ id: "REKR-1", ticker: "REKR" }), ev({ event: "" }), ev({ event: "x".repeat(401) }),
    ev({ event_date: "2026-13-40" }), ev({ kind: "blog" }), ev({ status: "early" }), ev({ public_url: "javascript:alert(1)" }),
    ev({ public_url: `https://news.example.com/${"x".repeat(600)}` }), ev({ first_seen: "yesterday" }), ev({ lag_days: "3" }),
    ev({ verdict: "maybe" }), ev({ verdict_ref: "miss:SYM" }), ev({ captured_ref: "x".repeat(601) }), ev({ notes: "x".repeat(1001) }),
    ev({ checked_at: null }), ev({ captured_kind: "coverage" }), null,
  ];
  const r1 = await load(env, { source: "test-seed", events: [...seven(), ...bad, ev({ id: "SYM-1" })] });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.accepted, 7);
  assert.equal(r1.body.rejected.length, bad.length + 1);
  assert.ok(r1.body.rejected.every((x) => typeof x.error === "string" && x.error), JSON.stringify(r1.body.rejected));
  assert.equal(r1.body.rejected.at(-1).error, "duplicate id in this payload");
  assert.equal(rows(env).length, 7);
  const first = rows(env).find((r) => r.id === "SYM-3");
  assert.deepEqual([first.source, first.verdict, first.verdict_ref, first.notes], ["test-seed", "confirmed", "miss:SYM:1", "[confirmed] test note"]);

  // The same file again: the same 7 rows, nothing doubled; a changed field is updated in place.
  const again = seven();
  again[0].status = "late";
  const r2 = await load(env, { source: "test-seed", events: again });
  assert.equal(r2.body.accepted, 7);
  assert.equal(rows(env).length, 7);
  assert.equal(rows(env).find((r) => r.id === "SYM-1").status, "late");
});

test("a captured item is resolved by exact URL, coverage first, then aux; the lowest id wins when two items share a URL; two events sharing a URL both resolve; first_seen filled only when missing", async () => {
  const env = newEnv();
  const both = "https://news.example.com/both";
  const auxOnly = "https://news.example.com/aux-only";
  const twice = "https://news.example.com/twice";
  const cov = await addItem(env.DB, { ticker: "SYM", source_key: "src_a", url: both, nm_first_seen: "2026-01-03T10:00:00Z" });
  const lowTwice = await addItem(env.DB, { ticker: "SYM", source_key: "src_a", url: twice, nm_first_seen: "2026-01-05T09:00:00Z" });
  const highTwice = await addItem(env.DB, { ticker: "SYM", source_key: "src_b", url: twice, nm_first_seen: "2026-01-04T09:00:00Z" });
  assert.ok(highTwice > lowTwice);
  const addAux = (nm, url) => Number(env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at)
    VALUES (?, 'aux_src', 'testco', 'Testco', 'private', ?, 'Aux item', '2026-01-06T08:00:00Z', '2026-01-06T08:00:00Z')`).run(nm, url).lastInsertRowid);
  addAux(900001, both);
  const auxId = addAux(900002, auxOnly);
  const r = await load(env, { source: "test-seed", events: [
    ev({ id: "SYM-1", public_url: both }),
    ev({ id: "SYM-2", public_url: auxOnly, first_seen: "2026-01-02T00:00:00Z" }),
    ev({ id: "SYM-3", public_url: twice }),
    ev({ id: "SYM-4", public_url: twice, status: "late" }),
    ev({ id: "SYM-5", public_url: "https://news.example.com/nowhere" }),
    ev({ id: "SYM-6", public_url: null }),
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.matched_items, 4);
  const by = Object.fromEntries(rows(env).map((x) => [x.id, [x.captured_kind, x.captured_item_id, x.first_seen]]));
  assert.deepEqual(by["SYM-1"], ["coverage", cov, "2026-01-03T10:00:00Z"]);
  assert.deepEqual(by["SYM-2"], ["aux", auxId, "2026-01-02T00:00:00Z"], "a known first_seen is kept");
  // MIN(id) and MIN(nm_first_seen) per URL: the lowest id, the earliest sighting.
  assert.deepEqual(by["SYM-3"], ["coverage", lowTwice, "2026-01-04T09:00:00Z"]);
  assert.deepEqual(by["SYM-4"], ["coverage", lowTwice, "2026-01-04T09:00:00Z"]);
  assert.deepEqual(by["SYM-5"], [null, null, null]);
  assert.deepEqual(by["SYM-6"], [null, null, null]);
});

test("item resolution runs two SELECTs whatever the event count", async () => {
  const env = newEnv();
  for (let i = 0; i < 5; i++) await addItem(env.DB, { url: `https://news.example.com/spy-${i}` });
  const sql = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (s) => { sql.push(s); return prepare(s); };
  const events = Array.from({ length: 20 }, (_, i) => ev({ id: `SYM-${i + 1}`, public_url: `https://news.example.com/spy-${i % 10}` }));
  const r = await load(env, { source: "test-seed", events });
  assert.equal(r.body.matched_items, 10);
  const lookups = sql.filter((s) => /FROM (items|aux_items)\b/.test(s));
  assert.equal(lookups.length, 2, lookups.join("\n---\n"));
});

test("replace: rows of the same source missing from the payload are deleted; other sources kept", async () => {
  const env = newEnv();
  await load(env, { source: "test-seed", events: seven() });
  await load(env, { source: "other-seed", events: [ev({ id: "AXON-9", ticker: "AXON" })] });
  const keep = seven().slice(0, 5);
  const dry = await load(env, { source: "test-seed", events: keep, replace: true, dry_run: true });
  assert.deepEqual([dry.body.replaced, rows(env).length], [2, 8], "a dry run counts, deletes nothing");
  const r = await load(env, { source: "test-seed", events: keep, replace: true });
  assert.equal(r.body.replaced, 2);
  assert.deepEqual(rows(env).map((x) => x.id), ["AXON-1", "AXON-9", "SYM-1", "SYM-2", "SYM-3", "SYM-4"]);
});

test("GET /v1/recall: totals, by_status, by_kind, by_ticker; events only for admin with events=1, never for the app", async () => {
  const env = newEnv();
  const empty = await get(env);
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.total, empty.body.by_status, empty.body.by_kind], [0, { on_time: 0, late: 0, partial: 0, missed: 0 }, []]);
  await load(env, { source: "test-seed", events: seven() });
  const r = await get(env);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 7);
  assert.deepEqual(r.body.by_status, { on_time: 3, late: 2, partial: 1, missed: 1 });
  assert.deepEqual(r.body.by_kind, [
    { kind: "filing", on_time: 2, late: 1, partial: 1, missed: 0, total: 4 },
    { kind: "news", on_time: 1, late: 1, partial: 0, missed: 1, total: 3 },
  ]);
  assert.deepEqual(r.body.by_ticker.map((t) => [t.ticker, t.total]), [["SYM", 4], ["AXON", 3]]);
  assert.deepEqual([r.body.sources, r.body.checked_at], [["test-seed"], "2026-01-15"]);
  assert.ok(r.body.loaded_at);
  assert.ok(!("events" in r.body));
  const app = await get(env, "?events=1", "app");
  assert.ok(!("events" in app.body), "the app never gets the event list");
  assert.ok(!JSON.stringify(app.body).includes("Test event"));
  const admin = await get(env, "?events=1", "admin");
  assert.deepEqual(admin.body.events.map((e) => e.id), ["AXON-1", "AXON-2", "AXON-3", "SYM-1", "SYM-2", "SYM-3", "SYM-4"]);
  assert.ok(!("events" in (await get(env, "", "admin")).body));
  assert.equal((await get(env, "", "grader")).status, 403);
});

test("GET /v1/recall before migration 0015: 503 with a clear error", async () => {
  const env = newEnv();
  env.DB.exec("DROP TABLE recall_events");
  const r = await get(env);
  assert.deepEqual([r.status, r.body.error], [503, "recall_events missing: apply migration 0015"]);
  const p = await load(env, { source: "test-seed", events: seven(), dry_run: true });
  assert.deepEqual([p.status, p.body.error], [503, "recall_events missing: apply migration 0015"]);
});

test("validateRecallEvent: a good synthetic event passes with every column", () => {
  const v = validateRecallEvent(ev({ id: "SYM-77", first_seen: "2026-01-02T03:04:00Z", lag_days: 1.1 }));
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.event).sort(), ["captured_item_id", "captured_kind", "captured_ref", "checked_at", "event", "event_date", "first_seen",
    "id", "kind", "lag_days", "notes", "public_url", "status", "ticker", "verdict", "verdict_ref"]);
});

test("no recall seed, event list or real tally is in the repo", (t) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    t.skip("git is not available");
    return;
  }
  const files = listed.split("\0").filter(Boolean);
  assert.ok(files.length > 50, `${files.length} tracked files`);
  const self = "test/recall.test.js";
  assert.deepEqual(files.filter((f) => /recall-seed/i.test(f)), [], "no tracked seed file");
  // Built at run time so this file does not match itself.
  const schema = "zenith.recall_seed" + ".v1";
  const verdictLine = new RegExp("miss:[A-Z]{2,6}:\\d+ \\[(confirmed|partly)\\]");
  const seedSource = '"source": ' + '"audit-';
  const exemptFromSource = new Set(["worker/src/recall.js", "worker/migrations/0015_recall.sql"]);
  const hits = [];
  for (const f of files) {
    if (f === self) continue;
    let buf;
    try { buf = readFileSync(new URL(f, new URL("..", import.meta.url))); } catch { continue; }
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    const text = buf.toString("utf8");
    if (text.includes(schema)) hits.push(`${f}: seed schema id`);
    if (verdictLine.test(text)) hits.push(`${f}: a miss verdict line`);
    if (!exemptFromSource.has(f) && text.includes(seedSource)) hits.push(`${f}: a seed source line`);
  }
  assert.deepEqual(hits, []);
});
