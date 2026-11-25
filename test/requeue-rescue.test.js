// Phase 0 gates (plans/phase0-build-spec.md, Appendix A section 10, change i):
// POST /v1/admin/requeue { mode: "rescue" } turns skipped rows into held rows
// (admit 'rescue') that releaseHeld drains under the daily budget. Built, not
// run (before 2026-11-29; dry_run first). Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { releaseHeld, rescueParams } = await import("../worker/src/budget.js");

const DAY = 86_400_000;
const SEEN = "2026-11-20T10:00:00.000Z";
const ago = (days, from = SEEN) => new Date(Date.parse(from) - days * DAY).toISOString();
const newEnv = (extra = {}) => ({ DB: zenithDb(), ...TOKENS, ...extra });
let nm = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", title: `Testco item ${++nm}`, published: ago(30), nm_first_seen: SEEN, state: "skipped", skip_reason: "stale_on_arrival",
    role: null, nm_rowid: nm, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, ingested_at, state, skip_reason, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.ticker, it.url ?? `https://x.example/${it.source_key}/${it.nm_rowid}`, it.title, it.published,
    it.nm_first_seen, SEEN, it.state, it.skip_reason, it.role);
  return Number(r.lastInsertRowid);
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", title: `Outside item ${++nm}`, published: ago(18), nm_first_seen: SEEN, state: "skipped", skip_reason: "stale_on_arrival", nm_rowid: nm, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, skip_reason)
    VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.source_key, it.source_key, it.url ?? `https://x.example/${it.source_key}/${it.nm_rowid}`,
    it.title, it.published, it.nm_first_seen, SEEN, it.state, it.skip_reason);
  return Number(r.lastInsertRowid);
}
const rescue = (env, body, role = "admin") => request(worker, env, "POST", "/v1/admin/requeue", { role, body: { mode: "rescue", ...body } });
const state = (env, table, id) => ({ ...env.DB.rows(`SELECT state, skip_reason, admit, released_at, attempts FROM ${table} WHERE id = ?`, id)[0] });

test("rescue dry_run: counts distinct news rows, picks the owning pipeline by coverageOwner, never a row whose twin is shown", async () => {
  const env = newEnv();
  // A coverage-owned FPDS row, skipped on both sides (stored on Aux before one pipeline): only the Coverage copy.
  const n1 = ++nm;
  const fpdsCov = addItem(env, { nm_rowid: n1, source_key: "fpds_pl", ticker: "PL", title: "Contract notice: Planet Labs PBC", published: ago(18), role: "customer" });
  const fpdsAux = addAux(env, { nm_rowid: n1, source_key: "fpds_pl", title: "Contract notice: Planet Labs PBC", url: `https://x.example/fpds_pl/${n1}` });
  // A coverage-owned row whose aux twin is shown (pending): never rescued.
  const n2 = ++nm;
  addItem(env, { nm_rowid: n2, source_key: "aglt_rel", ticker: "AGLT", title: "Agility Robotics partner news", published: ago(10), role: "relationship" });
  addAux(env, { nm_rowid: n2, source_key: "aglt_rel", title: "Agility Robotics partner news", state: "pending", skip_reason: null });
  // A plain aux row: its Aux copy.
  const plain = addAux(env, { published: ago(5) });
  const before = env.DB.rows("SELECT COUNT(*) AS n FROM items WHERE state = 'skipped'")[0].n;
  const r = await rescue(env, { since: "2026-10-01", dry_run: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dry_run, true);
  assert.equal(r.body.matched, 2, "two distinct news rows");
  assert.deepEqual(r.body.held, { coverage: 1, aux: 1 }, "what would be held");
  assert.deepEqual(r.body.items.map((i) => [i.kind, i.id]), [["coverage", fpdsCov], ["aux", plain]]);
  assert.ok(!r.body.items.some((i) => i.kind === "aux" && i.id === fpdsAux));
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM items WHERE state = 'skipped'")[0].n, before, "a dry run writes nothing");
  assert.equal(r.body.budget_left_today, 20);
});

test("rescue: a rival row labelled stale_on_arrival on Coverage with a skipped Aux copy rescues the Aux copy, never the Coverage one; with no Aux copy, counted no_aux_copy", async () => {
  const env = newEnv();
  const n1 = ++nm;
  const stub = addItem(env, { nm_rowid: n1, source_key: "neura", ticker: "AGLT", title: "NEURA Robotics opens a plant", published: ago(18), role: "rival" });
  const copy = addAux(env, { nm_rowid: n1, source_key: "neura", title: "NEURA Robotics opens a plant", skip_reason: "archive_seed", published: ago(18) });
  addItem(env, { source_key: "neura", ticker: "AGLT", title: "NEURA Robotics hires a CFO", published: ago(12), role: "rival", skip_reason: "rival_no_key_account" });
  const r = await rescue(env, { since: "2026-10-01" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.held, { coverage: 0, aux: 1 });
  assert.equal(r.body.no_aux_copy, 1);
  assert.deepEqual(state(env, "aux_items", copy), { state: "pending", skip_reason: null, admit: "rescue", released_at: null, attempts: 0 });
  assert.equal(state(env, "items", stub).state, "skipped", "the Coverage stub stays");
});

test("rescue: since and until (dated rows only), reasons, kind, sources and fit filters; fit rubric excludes a 30-day non-record and a 69-day record in a burst, keeps a 69-day record outside one; limit default 60, max 300; newest published first", async () => {
  const env = newEnv();
  const recOut = addItem(env, { source_key: "fpds_pl", ticker: "PL", title: "Planet Labs PBC notice", published: ago(69), role: "customer" });
  // fpds_pdyn: one first poll of 5 old rows: a burst.
  const burstSeen = "2026-11-19T10:00:00.000Z";
  const inBurst = [80, 75, 69, 60, 50].map((d) => addItem(env, { source_key: "fpds_pdyn", ticker: "PDYN", title: "Palladyne notice", published: ago(d, burstSeen), nm_first_seen: burstSeen, role: "customer" }));
  const nonRec = addItem(env, { published: ago(30) });                        // redcat own channel, 30 days: stale under the rubric
  const fresh = addItem(env, { published: ago(16), skip_reason: "archive_seed" });
  const undated = addItem(env, { published: null });
  const tooOld = addItem(env, { source_key: "fpds_pl", ticker: "PL", title: "Planet Labs PBC old", published: "2026-06-01T00:00:00Z", role: "customer" });
  const auxRow = addAux(env, { published: ago(19) });
  let r = (await rescue(env, { since: "2026-07-01", dry_run: true })).body;
  const ids = r.items.filter((i) => i.kind === "coverage").map((i) => i.id);
  assert.ok(ids.includes(recOut) && ids.includes(fresh));
  assert.deepEqual(r.items.filter((i) => i.kind === "aux").map((i) => i.id), [auxRow]);
  assert.ok(!ids.includes(nonRec), "30-day non-record: outside the rubric");
  assert.ok(!inBurst.some((id) => ids.includes(id)), "a record in a burst");
  assert.ok(!ids.includes(undated) && !ids.includes(tooOld), "dated rows since `since` only");
  assert.equal(r.items.find((i) => i.kind === "coverage" && i.id === recOut).fit, "record_late");
  assert.equal(r.items.find((i) => i.kind === "coverage" && i.id === fresh).fit, "within_21d");
  assert.equal(r.excluded_by_fit, 6);
  // Newest published first, coverage before aux.
  assert.deepEqual(r.items.map((i) => [i.kind, i.id]), [["coverage", fresh], ["coverage", recOut], ["aux", auxRow]]);
  // fit all takes every match.
  r = (await rescue(env, { since: "2026-07-01", fit: "all", dry_run: true })).body;
  assert.equal(r.matched, 9);
  assert.equal(r.items.find((i) => i.kind === "coverage" && i.id === nonRec).fit, "outside_rubric");
  // until, reasons, kind and sources.
  r = (await rescue(env, { since: "2026-07-01", until: ago(20).slice(0, 10), fit: "all", dry_run: true })).body;
  assert.ok(!r.items.some((i) => (i.kind === "coverage" && i.id === fresh) || (i.kind === "aux" && i.id === auxRow)), "published after until");
  r = (await rescue(env, { since: "2026-07-01", reasons: ["archive_seed"], fit: "all", dry_run: true })).body;
  assert.deepEqual(r.items.map((i) => i.id), [fresh]);
  r = (await rescue(env, { since: "2026-07-01", kind: "aux", fit: "all", dry_run: true })).body;
  assert.deepEqual(r.items.map((i) => i.id), [auxRow]);
  r = (await rescue(env, { since: "2026-07-01", sources: ["fpds_*"], kind: "coverage", fit: "all", dry_run: true })).body;
  assert.deepEqual(r.items.map((i) => i.source_key).sort(), ["fpds_pdyn", "fpds_pdyn", "fpds_pdyn", "fpds_pdyn", "fpds_pdyn", "fpds_pl"]);
  r = (await rescue(env, { since: "2026-07-01", sources: ["fpds_pl"], fit: "all", dry_run: true })).body;
  assert.deepEqual(r.items.map((i) => i.id), [recOut]);
  // limit: default 60, at most 300.
  assert.equal(rescueParams({ since: "2026-10-01" }).limit, 60);
  assert.equal(rescueParams({ since: "2026-10-01", limit: 1000 }).limit, 300);
  assert.equal(rescueParams({ since: "2026-10-01", limit: 0 }).limit, 1);
  r = (await rescue(env, { since: "2026-07-01", fit: "all", limit: 2 })).body;
  assert.deepEqual([r.held.coverage + r.held.aux, r.remaining], [2, 7]);
});

test("rescue holds, never releases: a rescue of 60 with 20 left today releases at most 20 today through releaseHeld, the rest on later days, at most 5 per source", async () => {
  const env = newEnv();
  const keys = ["anduril", "skyward", "fortbot", "glimmer", "quillon", "northfield"];
  for (let k = 0; k < 60; k++) addAux(env, { source_key: keys[k % keys.length], published: ago(10 + (k % 5)) });
  const r = (await rescue(env, { since: "2026-10-01" })).body;
  assert.deepEqual([r.held.aux, r.matched, r.remaining], [60, 60, 0]);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE released_at IS NOT NULL")[0].n, 0, "the rescue itself releases nothing");
  const day1 = Date.parse("2026-11-30T08:00:00Z");
  const a = await releaseHeld(env, { now: day1 });
  assert.equal(a.released.aux, 20);
  const per = env.DB.rows("SELECT source_key, COUNT(*) AS n FROM aux_items WHERE released_at IS NOT NULL GROUP BY 1").map((x) => x.n);
  assert.ok(per.every((n) => n <= 5), JSON.stringify(per));
  // The queue guard lets the next day release more only while the queue has room.
  env.DB.db.prepare("UPDATE aux_items SET state = 'graded' WHERE released_at IS NOT NULL").run();
  const b = await releaseHeld(env, { now: day1 + DAY });
  assert.equal(b.released.aux, 20);
  assert.equal((await releaseHeld(env, { now: day1 + DAY + 60_000 })).released.aux, 0, "the day's budget is used");
  const rows = env.DB.rows("SELECT admit, state FROM aux_items WHERE released_at IS NULL");
  assert.equal(rows.length, 20);
  assert.ok(rows.every((x) => x.admit === "rescue" && x.state === "pending"));
});

test("rescue: 400 on missing or bad since, unknown reason, kind or fit; admin only (app and grader get 403)", async () => {
  const env = newEnv();
  for (const body of [{}, { since: "2026-13-01" }, { since: "yesterday" }, { since: "2026-10-01", until: "soon" },
    { since: "2026-10-01", reasons: ["muted_source"] }, { since: "2026-10-01", reasons: [] }, { since: "2026-10-01", kind: "all" },
    { since: "2026-10-01", fit: "some" }, { since: "2026-10-01", sources: ["bad key!"] }]) {
    const r = await rescue(env, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.body.error);
  }
  assert.equal((await rescue(env, { since: "2026-10-01", dry_run: true }, "app")).status, 403);
  assert.equal((await rescue(env, { since: "2026-10-01", dry_run: true }, "grader")).status, 403);
  const bad = await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "nope" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /late_flags, sec_excerpts or rescue/);
});

test("REGRESSION item_ids, late_flags and sec_excerpts modes behave as before", async () => {
  const env = newEnv();
  const id = addItem(env, { state: "graded", skip_reason: null });
  const r = await request(worker, env, "POST", "/v1/admin/requeue", { body: { item_ids: [id] } });
  assert.deepEqual([r.status, r.body.requeued], [200, 1]);
  assert.deepEqual(state(env, "items", id), { state: "pending", skip_reason: null, admit: null, released_at: null, attempts: 0 });
  const lf = await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "late_flags", dry_run: true } });
  assert.deepEqual([lf.status, lf.body.mode, lf.body.matched], [200, "late_flags", 0]);
  const sec = await request(worker, env, "POST", "/v1/admin/requeue", { body: { mode: "sec_excerpts" } });
  assert.equal(sec.status, 409, "no CONTACT_EMAIL");
  assert.equal((await request(worker, env, "POST", "/v1/admin/requeue", { body: {} })).status, 400);
});
