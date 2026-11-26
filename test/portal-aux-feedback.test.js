// Phase 3 PR-PA2 (integration edit E8): POST /p/api/aux-feedback, the portal's aux
// label route. Gate, same origin and content type first, then auxiliary.js
// auxFeedback through deps. Parity: every JSON body gets the same status and
// answer as POST /v1/aux/feedback with the app token. Synthetic fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkerModule, pfetch, sessionEnv, sessionCookie, ORIGIN, APP } from "./helpers/portal.js";

const { worker } = await loadWorkerModule();
let rowid = 5000;

function addAux(db, over = {}) {
  const r = db.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, attempts) VALUES (?, 'example_src', 'example-corp', 'Example Corp', 'active', ?, ?, NULL, NULL, ?, ?, 'pending', 0)`)
    .run(++rowid, `https://example.com/aux/${rowid}`, over.title || `Aux ${rowid}`, new Date().toISOString(), new Date().toISOString());
  return Number(r.lastInsertRowid);
}
function addAuxGrade(db, itemId, score) {
  const band = score == null ? "duplicate" : score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
  const g = db.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, event_type, why, reads_through, flags, confidence,
      read_source, dup_of, rubric_version, model, graded_at) VALUES (?, 'run-x', 'Example Corp', NULL, ?, ?, 'contract', 'why', '[]', '[]', 0.8, 1, NULL, 'a-test', 'm', ?)`)
    .run(itemId, score, band, new Date().toISOString());
  db.db.prepare("UPDATE aux_items SET state = 'graded', grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), itemId);
}
const count = (env, t) => env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

test("aux labels: the same JSON bodies get the same status and answer through /v1/aux/feedback and /p/api/aux-feedback", async () => {
  const env = sessionEnv();
  const cookie = await sessionCookie(env);
  const graded = addAux(env.DB);
  addAuxGrade(env.DB, graded, 72);
  const ungraded = addAux(env.DB);
  const bodies = [
    { item_id: graded, label: "bogus" },
    { label: "high" },
    { item_id: "abc", label: "high" },
    { item_id: 999999, label: "low" },
    { item_id: ungraded, label: "too_low" },
    { item_id: graded, label: "high", reason: "nonsense" },
    { item_id: graded, label: "Medium", reason: "stale", note: "n".repeat(3000) },
    { item_id: graded, label: "too_high" },
    { item_id: ungraded, label: "noise", note: "x" },
    { item_id: String(graded), label: "low", ticker: "TST" },
  ];
  for (const b of bodies) {
    const v = await worker.fetch(new Request(`${ORIGIN}/v1/aux/feedback`, { method: "POST", headers: { authorization: `Bearer ${APP}`, "content-type": "application/json" }, body: JSON.stringify(b) }), env);
    const vBody = await v.json();
    const p = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", cookie, origin: ORIGIN, json: b });
    const pBody = JSON.parse(p.text);
    assert.equal(p.status, v.status, JSON.stringify(b).slice(0, 80));
    delete vBody.feedback_id;
    delete pBody.feedback_id;
    assert.deepEqual(pBody, vBody, JSON.stringify(b).slice(0, 80));
    assert.equal(p.headers.get("cache-control"), "no-store");
  }
  const rows = env.DB.db.prepare("SELECT label, reason, length(note) AS n FROM aux_feedback ORDER BY id").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { label: "medium", reason: "stale", n: 1000 }, { label: "medium", reason: "stale", n: 1000 },
    { label: "too_high", reason: null, n: null }, { label: "too_high", reason: null, n: null },
    { label: "noise", reason: null, n: 1 }, { label: "noise", reason: null, n: 1 },
    { label: "low", reason: null, n: null }, { label: "low", reason: null, n: null },
  ], "each accepted body was written once by each route");
  const actors = env.DB.db.prepare("SELECT actor, via, target_kind FROM audit_log ORDER BY id").all().map((r) => `${r.actor}/${r.via}/${r.target_kind}`);
  assert.deepEqual(actors, Array.from({ length: 4 }, () => ["app/token/aux_item", "app/session/aux_item"]).flat());
});

test("aux labels: no credentials, another origin or text/plain write nothing; a native form returns to its page", async () => {
  const env = sessionEnv();
  const cookie = await sessionCookie(env);
  const id = addAux(env.DB);
  addAuxGrade(env.DB, id, 80);
  const before = () => [count(env, "aux_feedback"), count(env, "audit_log")];
  const b0 = before();
  const none = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", origin: ORIGIN, json: { item_id: id, label: "high" } });
  assert.equal(none.status, 403);
  assert.deepEqual(JSON.parse(none.text), { error: "forbidden" });
  const evil = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", cookie, origin: "https://evil.example", json: { item_id: id, label: "high" } });
  assert.equal(evil.status, 403);
  const plain = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", cookie, origin: ORIGIN, body: JSON.stringify({ item_id: id, label: "high" }), contentType: "text/plain" });
  assert.equal(plain.status, 415);
  const get = await pfetch(worker, env, "/p/api/aux-feedback", { cookie });
  assert.equal(get.status, 405);
  assert.deepEqual(before(), b0);
  const form = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", cookie, origin: ORIGIN, form: { item_id: String(id), label: "high", return: "/p/industry?range=7d" } });
  assert.equal(form.status, 303);
  assert.equal(form.headers.get("location"), "/p/industry?range=7d");
  const bad = await pfetch(worker, env, "/p/api/aux-feedback", { method: "POST", cookie, origin: ORIGIN, form: { item_id: String(id), label: "bogus", return: "//evil" } });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /Not saved: label must be one of/);
  assert.match(bad.text, /href="\/p\/today"/);
  assert.deepEqual(before(), [b0[0] + 1, b0[1] + 1]);
});
