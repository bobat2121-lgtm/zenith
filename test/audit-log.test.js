// Phase 1, Part A, PR-U2: the audit log (migration 0017). One audit_log row per
// human or token action that changes state; none for a refusal, a dry run or an
// identical repeat, and none for grader or cron writes. Synthetic rows and
// synthetic actors only (analyst@example.com is the test address mobile.test.js uses).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { audit, auditJson, whoFor, whoForMobile, AUDIT_ACTIONS, AUDIT_MAX_LIST } = await import("../worker/src/lib.js");
const { clearJwksCache } = await import("../worker/src/mobile.js");

const SRC = new URL("../worker/src/", import.meta.url);
const ENVS = [];
const newEnv = (extra = {}) => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra };
  ENVS.push(env);
  return env;
};
const auditRows = (env, action) => env.DB.rows(`SELECT * FROM audit_log ${action ? "WHERE action = ?" : ""} ORDER BY id`, ...(action ? [action] : []))
  .map((r) => ({ ...r, before: r.before_json == null ? null : JSON.parse(r.before_json), after: r.after_json == null ? null : JSON.parse(r.after_json) }));
const count = (env, sql, ...args) => env.DB.rows(sql, ...args)[0].n;

// --- audit() and the who helpers, unit ------------------------------------------
test("audit writes one row with the actor, at and JSON before/after; a missing who is unknown/internal", async () => {
  const env = newEnv();
  assert.equal(await audit(env.DB, whoFor("admin", new Request("https://zenith.test/", { headers: { "cf-ray": "ray-1" } })),
    { action: "admin_run", target_kind: "job", target_id: "enrich", after: { processed: 2 } }), true);
  const [row] = auditRows(env);
  assert.deepEqual([row.actor, row.via, row.action, row.target_kind, row.target_id, row.request_id, row.before, row.after, row.universe_id],
    ["admin", "token", "admin_run", "job", "enrich", "ray-1", null, { processed: 2 }, "u1"]);
  assert.ok(Number.isFinite(Date.parse(row.at)));
  // A handler called without who: the wiring-bug signal. Not left in a shared env (see the last test).
  const own = { DB: zenithDb() };
  await audit(own.DB, undefined, { action: "requeue", target_kind: "items", target_id: "item_ids", after: { requeued: 1 } });
  assert.deepEqual(own.DB.rows("SELECT actor, via FROM audit_log").map((r) => [r.actor, r.via]), [["unknown", "internal"]]);
});

test("audit never throws on a bad action, a missing target_kind or a broken database", async () => {
  const env = newEnv();
  const who = whoFor("app", new Request("https://zenith.test/"));
  const quiet = console.error;
  const errors = [];
  console.error = (...a) => errors.push(a.join(" "));
  try {
    assert.equal(await audit(env.DB, who, { action: "lable", target_kind: "coverage_item", target_id: "1:RCAT" }), false);
    assert.equal(await audit(env.DB, who, { action: "label" }), false);
    assert.equal(await audit(env.DB, who, null), false);
    const broken = { prepare() { throw new Error("D1_ERROR: boom"); } };
    assert.equal(await audit(broken, who, { action: "label", target_kind: "coverage_item", target_id: "1:RCAT" }), false);
    const circular = {};
    circular.self = circular;
    assert.equal(await audit(env.DB, who, { action: "label", target_kind: "coverage_item", after: circular }), false, "serialization is inside the guard");
  } finally {
    console.error = quiet;
  }
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 0);
  assert.ok(errors.some((e) => /unknown action lable/.test(e)));
  assert.ok(errors.some((e) => /audit failed/.test(e)));
});

test("ids lists are capped at 500 with <name>_total, one level down too; over 8 KB the JSON is clipped", async () => {
  const ids = Array.from({ length: 600 }, (_, k) => k + 1);
  const v = JSON.parse(auditJson({ mode: "x", ids, nested: { coverage: ids.slice(0, 3), aux: [] }, n: 1 }));
  assert.equal(AUDIT_MAX_LIST, 500);
  assert.deepEqual([v.ids.length, v.ids_total, v.ids[499], v.nested.coverage, v.nested.coverage_total, v.nested.aux_total, v.n], [500, 600, 500, [1, 2, 3], 3, 0, 1]);
  assert.equal(auditJson(null), null);
  const big = JSON.parse(auditJson({ results: Array.from({ length: 400 }, (_, k) => ({ item_id: `${k}#RCAT`, ticker: "RCAT", score: 50, band: "borderline" })) }));
  assert.equal(big.clipped, true);
  assert.ok(big.bytes > 8192);
  const env = newEnv();
  await audit(env.DB, whoFor("admin", null), { action: "requeue", target_kind: "items", target_id: "item_ids", after: { ids } });
  const [row] = auditRows(env);
  assert.deepEqual([row.after.ids.length, row.after.ids_total, row.request_id], [500, 600, null]);
});

test("whoForMobile: app by token; access: plus 16 hex of SHA-256 of the lowercased email; access:unknown without an email", async () => {
  const req = new Request("https://zenith.test/m/feedback", { headers: { "cf-ray": "ray-m" } });
  assert.deepEqual(await whoForMobile({ ok: true, via: "token" }, req), { actor: "app", via: "token", request_id: "ray-m" });
  const hex = createHash("sha256").update("analyst@example.com").digest("hex").slice(0, 16);
  assert.deepEqual(await whoForMobile({ ok: true, via: "access", email: "  Analyst@Example.com " }, req), { actor: `access:${hex}`, via: "access", request_id: "ray-m" });
  assert.deepEqual(await whoForMobile({ ok: true, via: "access", email: null }, req), { actor: "access:unknown", via: "access", request_id: "ray-m" });
});
test("every literal audit action is known", () => {
  const found = [];
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.endsWith(".generated.js"))) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    for (const m of code.matchAll(/\baudit\(\s*[^,()]+,\s*[^,()]+,\s*\{\s*action:\s*"([a-z_]+)"/g)) found.push([f, m[1]]);
  }
  assert.ok(found.length >= 13, `found ${found.length} literal audit calls`);
  // The one dynamic action (expansion_approve, _reject, _reopen) is covered by the HTTP expansion tests.
  assert.match(readFileSync(new URL("expansion.js", SRC), "utf8"), /audit\(db, who, \{ action: `expansion_\$\{action\}`/);
  for (const [f, a] of found) assert.ok(AUDIT_ACTIONS.includes(a), `${f}: ${a}`);
  assert.deepEqual([...new Set(found.map(([, a]) => a))].sort(), AUDIT_ACTIONS.filter((a) => !a.startsWith("expansion_") || a === "expansion_compiled").sort());
});

// --- Through HTTP -----------------------------------------------------------------
const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let nm = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", title: `Testco item ${++nm}`, published: iso(2 * DAY), nm_first_seen: iso(DAY), state: "pending",
    skip_reason: null, role: null, nm_rowid: nm, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, ingested_at, state, skip_reason, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.ticker, it.url ?? `https://x.example/${it.source_key}/${it.nm_rowid}`, it.title,
    it.published, it.nm_first_seen, iso(), it.state, it.skip_reason, it.role);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: "RCAT", score: 80, band: "digest", flags: ["reason:material"], graded_at: iso(), ...over };
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, 'run-1', 'r-test', 'm', ?, ?, 'why', ?, 0, ?)`).run(itemId, g.ticker, g.score, g.band, JSON.stringify(g.flags), g.graded_at);
  const id = Number(r.lastInsertRowid);
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(id, itemId);
  return id;
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", title: `Outside item ${++nm}`, published: iso(2 * DAY), nm_first_seen: iso(DAY), state: "pending", skip_reason: null, nm_rowid: nm, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, skip_reason)
    VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.source_key, it.source_key, it.url ?? `https://x.example/${it.source_key}/${it.nm_rowid}`,
    it.title, it.published, it.nm_first_seen, iso(), it.state, it.skip_reason);
  return Number(r.lastInsertRowid);
}
const post = (env, path, body, role = "admin") => request(worker, env, "POST", path, { role, body });
const NOTE = "a private reason the analyst typed";
const noText = (row, ...texts) => {
  for (const t of texts) assert.ok(!String(row.before_json ?? "").includes(t) && !String(row.after_json ?? "").includes(t), `"${t}" is not in the audit row`);
};

test("a coverage label writes one feedback row and one audit row", async () => {
  const env = newEnv();
  const id = addItem(env);
  const gid = addGrade(env, id);
  const r = await post(env, "/v1/feedback", { item_id: id, label: "high", note: NOTE }, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM feedback"), 1);
  const rows = auditRows(env);
  assert.equal(rows.length, 1);
  const [a] = rows;
  assert.deepEqual([a.actor, a.via, a.action, a.target_kind, a.target_id, a.before], ["app", "token", "label", "coverage_item", `${id}:RCAT`, null]);
  assert.deepEqual(a.after, { feedback_id: r.body.feedback_id, label: "high", reason: null, grade_id: gid, has_note: true });
  noText(a, NOTE);
});

test("a corrected label records the earlier one as before", async () => {
  const env = newEnv();
  const id = addItem(env);
  addGrade(env, id);
  const first = await post(env, "/v1/feedback", { item_id: id, label: "high" }, "app");
  const second = await post(env, "/v1/feedback", { item_id: id, label: "too_high", reason: "not_material" }, "app");
  assert.equal(second.status, 200);
  const rows = auditRows(env, "label");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].before, { feedback_id: first.body.feedback_id, label: "high", reason: null });
  assert.deepEqual([rows[1].after.label, rows[1].after.reason, rows[1].after.has_note], ["too_high", "not_material", false]);
});

test("an aux label is audited on aux_item", async () => {
  const env = newEnv();
  const id = addAux(env);
  const r = await post(env, "/v1/aux/feedback", { item_id: id, label: "low", note: NOTE }, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const again = await post(env, "/v1/aux/feedback", { item_id: id, label: "noise" });
  const rows = auditRows(env, "label");
  assert.deepEqual(rows.map((x) => [x.actor, x.target_kind, x.target_id]), [["app", "aux_item", String(id)], ["admin", "aux_item", String(id)]]);
  assert.deepEqual(rows[0].after, { feedback_id: r.body.feedback_id, label: "low", reason: null, grade_id: null, has_note: true });
  assert.deepEqual(rows[1].before, { feedback_id: r.body.feedback_id, label: "low", reason: null });
  assert.equal(rows[1].after.feedback_id, again.body.feedback_id);
  noText(rows[0], NOTE);
});

test("a refused label writes no audit row", async () => {
  const env = newEnv();
  const ungraded = addItem(env);
  assert.equal((await post(env, "/v1/feedback", { item_id: 999999, label: "high" }, "app")).status, 404);
  assert.equal((await post(env, "/v1/feedback", { item_id: ungraded, label: "too_high" }, "app")).status, 400);
  assert.equal((await post(env, "/v1/aux/feedback", { item_id: 999999, label: "high" }, "app")).status, 404);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 0);
});

// Access keypair and signer, copied from mobile.test.js (that file is unchanged).
const TEAM = "zenith-team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function keyPair(kid) {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "RS256", use: "sig" };
  return { kp, jwk };
}
async function sign(kp, kid, claims) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

test("/m label by token is app, by Access is a hash of the email", async () => {
  const env = newEnv({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
  const id = addItem(env);
  addGrade(env, id);
  const byToken = await worker.fetch(new Request("https://zenith.test/m/feedback", { method: "POST",
    headers: { authorization: `Bearer ${TOKENS.APP_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ item_id: id, label: "medium" }) }), env);
  assert.equal(byToken.status, 200, await byToken.clone().text());
  const key = await keyPair("kid-a");
  const realFetch = globalThis.fetch;
  clearJwksCache();
  globalThis.fetch = async (u) => (String(u) === `https://${TEAM}/cdn-cgi/access/certs`
    ? new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("not found", { status: 404 }));
  try {
    const t = Math.floor(Date.now() / 1000);
    const jwt = await sign(key.kp, "kid-a", { aud: [AUD], iss: `https://${TEAM}`, email: "analyst@example.com", exp: t + 600, iat: t - 10, sub: "u1" });
    const byAccess = await worker.fetch(new Request("https://zenith.test/m/feedback", { method: "POST",
      headers: { "cf-access-jwt-assertion": jwt, origin: "https://zenith.test", "content-type": "application/json" }, body: JSON.stringify({ item_id: id, label: "high" }) }), env);
    assert.equal(byAccess.status, 200, await byAccess.clone().text());
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCache();
  }
  const hex = createHash("sha256").update("analyst@example.com").digest("hex").slice(0, 16);
  const rows = auditRows(env, "label");
  assert.deepEqual(rows.map((r) => [r.actor, r.via]), [["app", "token"], [`access:${hex}`, "access"]]);
  for (const r of env.DB.rows("SELECT * FROM audit_log")) assert.ok(!JSON.stringify({ ...r }).includes("analyst@example.com"), "the email is never stored");
});

test("mute then normal: no pref left, two audit rows", async () => {
  const env = newEnv();
  const pending = addAux(env);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "anduril", action: "mute", note: NOTE }, "app")).status, 200);
  assert.equal(env.DB.rows("SELECT state FROM aux_items WHERE id = ?", pending)[0].state, "skipped");
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "anduril", action: "normal" }, "app")).status, 200);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM source_prefs"), 0);
  const rows = auditRows(env, "source_pref");
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].target_kind, rows[0].target_id, rows[0].before], ["source", "anduril", null]);
  assert.deepEqual(rows[0].after, { action: "mute", has_note: true, note_changed: true, parked: { coverage: 0, aux: 1 } });
  assert.deepEqual([rows[1].before.action, rows[1].before.has_note, typeof rows[1].before.updated_at, rows[1].after], ["mute", true, "string", null]);
  for (const r of rows) noText(r, NOTE);
});

test("normal on an unset source and an identical repeat mute write nothing", async () => {
  const env = newEnv();
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "anduril", action: "normal" }, "app")).status, 200);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 0);
  for (let k = 0; k < 2; k++) assert.equal((await post(env, "/v1/source-prefs", { source_key: "anduril", action: "mute", note: "same" }, "app")).status, 200);
  assert.equal(auditRows(env, "source_pref").length, 1);
});

test("a repeat mute that parks new rows, or changes the note, is audited", async () => {
  const env = newEnv();
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "aglt_rel", action: "mute" }, "app")).status, 200);
  addItem(env, { source_key: "aglt_rel", ticker: "AGLT", role: "relationship" });
  const again = await post(env, "/v1/source-prefs", { source_key: "aglt_rel", action: "mute" }, "app");
  assert.deepEqual(again.body.parked, { coverage: 1, aux: 0 });
  let rows = auditRows(env, "source_pref");
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].before.action, rows[1].after.parked.coverage, rows[1].after.note_changed], ["mute", 1, false]);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "aglt_rel", action: "mute", note: NOTE }, "app")).status, 200);
  rows = auditRows(env, "source_pref");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2].after, { action: "mute", has_note: true, note_changed: true, parked: { coverage: 0, aux: 0 } });
  noText(rows[2], NOTE);
});

test("left-out grade is audited; refusals are not", async () => {
  const env = newEnv();
  const id = addItem(env, { state: "skipped", skip_reason: "stale_on_arrival" });
  const r = await post(env, "/v1/left-out/grade", { kind: "coverage", id }, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = auditRows(env, "left_out_grade");
  assert.deepEqual(rows.map((x) => [x.actor, x.target_kind, x.target_id, x.before, x.after]),
    [["app", "coverage_item", String(id), { state: "skipped", skip_reason: "stale_on_arrival" }, { state: "pending" }]]);
  // Still muted: refused, no row. Not skipped any more: refused, no row.
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "aglt_rel", action: "mute" }, "app")).status, 200);
  const muted = addItem(env, { source_key: "aglt_rel", ticker: "AGLT", state: "skipped", skip_reason: "muted_source" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: muted }, "app")).status, 400);
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id }, "app")).status, 400);
  const aux = addAux(env, { state: "skipped", skip_reason: "stale_on_arrival" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "aux", id: aux })).status, 200);
  assert.deepEqual(auditRows(env, "left_out_grade").map((x) => [x.actor, x.target_kind]), [["app", "coverage_item"], ["admin", "aux_item"]]);
});

const addCandidate = (env, name, tickers = ["RCAT"]) => Number(env.DB.db.prepare(
  "INSERT INTO expansion_candidates (dedupe_key, name, tickers, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
).run(name.toLowerCase(), name, JSON.stringify(tickers), iso(), iso()).lastInsertRowid);

test("expansion approve by app matches the decisions by field", async () => {
  const env = newEnv();
  const id = addCandidate(env, "Testco Robotics");
  const r = await post(env, "/v1/expansion/decide", { id, action: "approve", note: NOTE }, "app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const decisions = JSON.parse(env.DB.rows("SELECT decisions FROM expansion_candidates WHERE id = ?", id)[0].decisions);
  const rows = auditRows(env, "expansion_approve");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, decisions.at(-1).by);
  assert.equal(rows[0].actor, "app");
  assert.deepEqual([rows[0].target_kind, rows[0].target_id, rows[0].before, rows[0].after],
    ["expansion_candidate", String(id), { status: "pending" }, { status: "approved", reason: null, tickers: ["RCAT"], tickers_total: 1, has_note: true }]);
  noText(rows[0], NOTE);
  assert.equal((await post(env, "/v1/expansion/decide", { id, action: "approve" }, "app")).status, 400);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 1);
  const other = addCandidate(env, "Testco Systems");
  assert.equal((await post(env, "/v1/expansion/decide", { id: other, action: "reject", reason: "too_small" })).status, 200);
  assert.deepEqual(auditRows(env, "expansion_reject").map((x) => [x.actor, x.before.status, x.after.status, x.after.reason]), [["admin", "pending", "rejected", "too_small"]]);
});

test("compiled writes one row per compiled id, none for mismatches", async () => {
  const env = newEnv();
  const a = addCandidate(env, "Testco Alpha");
  const b = addCandidate(env, "Testco Beta");
  for (const id of [a, b]) assert.equal((await post(env, "/v1/expansion/decide", { id, action: "approve", tickers: ["RCAT"] }, "app")).status, 200);
  const r = await post(env, "/v1/expansion/compiled", { items: [{ id: a, tickers: ["RCAT"] }, { id: b, tickers: ["AUR"] }], ref: "t-1" }, "app");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.compiled, [a]);
  const rows = auditRows(env, "expansion_compiled");
  assert.deepEqual(rows.map((x) => [x.target_id, x.before, x.after.status, x.after.ref, x.after.tickers]), [[String(a), { status: "approved" }, "compiled", "t-1", ["RCAT"]]]);
});

test("requeue item_ids is audited with its ids", async () => {
  const env = newEnv();
  const ids = [addItem(env), addItem(env)];
  for (const id of ids) addGrade(env, id);
  const r = await post(env, "/v1/admin/requeue", { item_ids: ids });
  assert.equal(r.body.requeued, 2);
  const rows = auditRows(env, "requeue");
  assert.deepEqual(rows.map((x) => [x.actor, x.target_kind, x.target_id, x.before]), [["admin", "items", "item_ids", null]]);
  assert.deepEqual(rows[0].after, { mode: "item_ids", requeued: 2, ids, ids_total: 2 });
  // Unknown ids change nothing and write nothing.
  assert.equal((await post(env, "/v1/admin/requeue", { item_ids: [999999] })).body.requeued, 0);
  assert.equal(auditRows(env, "requeue").length, 1);
});

const LATE_DAY = "2026-11-19T15:00:00.000Z";
function addLate(env) {
  const id = addItem(env, { published: "2026-11-01T00:00:00Z", nm_first_seen: "2026-11-02T00:00:00Z" });
  addGrade(env, id, { score: 60, band: "borderline", flags: ["reason:primary_source", "late_first_sighting"], graded_at: LATE_DAY });
  return id;
}

test("late_flags audit lists every picked id, not the 200 in the response", async () => {
  const env = newEnv();
  const ids = Array.from({ length: 250 }, () => addLate(env));
  const r = await post(env, "/v1/admin/requeue", { mode: "late_flags" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.items.length, r.body.matched, r.body.requeued], [200, 250, 250]);
  const [row] = auditRows(env, "requeue");
  assert.deepEqual([row.target_id, row.after.mode, row.after.ids.length, row.after.ids_total, row.after.matched, row.after.requeued],
    ["late_flags", "late_flags", 250, 250, 250, 250]);
  assert.deepEqual(row.after.ids, ids);
});

const SEEN = "2026-11-20T10:00:00.000Z";
const before = (days) => new Date(Date.parse(SEEN) - days * DAY).toISOString();
const rescueCov = (env) => addItem(env, { published: before(10), nm_first_seen: SEEN, state: "skipped", skip_reason: "stale_on_arrival" });
const rescueAux = (env) => addAux(env, { published: before(10), nm_first_seen: SEEN, state: "skipped", skip_reason: "stale_on_arrival" });

test("rescue audit splits ids by kind and matches held", async () => {
  const env = newEnv();
  const cov = Array.from({ length: 160 }, () => rescueCov(env));
  const aux = Array.from({ length: 90 }, () => rescueAux(env));
  const r = await post(env, "/v1/admin/requeue", { mode: "rescue", since: "2026-10-01", limit: 250, kind: "both" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 200);
  assert.deepEqual(r.body.held, { coverage: 160, aux: 90 });
  const rows = auditRows(env, "rescue");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.actor, row.target_kind, row.target_id, row.before], ["admin", "items", "rescue", null]);
  assert.deepEqual([row.after.ids.coverage.length, row.after.ids.aux.length, row.after.ids.coverage_total, row.after.ids.aux_total], [160, 90, 160, 90]);
  assert.deepEqual(row.after.held, r.body.held);
  assert.deepEqual([[...row.after.ids.coverage].sort((x, y) => x - y), [...row.after.ids.aux].sort((x, y) => x - y)], [cov, aux]);
  assert.deepEqual([row.after.since, row.after.until, row.after.kind, row.after.fit, row.after.limit], ["2026-10-01", null, "both", "rubric", 250]);
  // A second rescue finds nothing left to hold: no row.
  assert.deepEqual((await post(env, "/v1/admin/requeue", { mode: "rescue", since: "2026-10-01" })).body.held, { coverage: 0, aux: 0 });
  assert.equal(auditRows(env, "rescue").length, 1);
});

let ev = 0;
const event = (over = {}) => ({ id: `RCAT-${++ev}`, ticker: "RCAT", event: `Synthetic test event ${ev}`, event_date: "2026-01-02", kind: "news",
  public_url: `https://news.example.com/t-${ev}`, status: "on_time", checked_at: "2026-01-15", notes: "synthetic test note", ...over });

test("dry runs write no audit row", async () => {
  const env = newEnv();
  addLate(env);
  rescueCov(env);
  assert.equal((await post(env, "/v1/admin/requeue", { mode: "late_flags", dry_run: true })).body.matched, 1);
  assert.equal((await post(env, "/v1/admin/requeue", { mode: "rescue", since: "2026-10-01", dry_run: true })).body.held.coverage, 1);
  assert.equal((await post(env, "/v1/admin/recall", { source: "test-seed", events: [event()], dry_run: true })).body.accepted, 1);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 0);
});

test("recall load is audited without event text", async () => {
  const env = newEnv();
  const events = [event(), event({ status: "late" })];
  const r = await post(env, "/v1/admin/recall", { source: "test-seed", events: [...events, { id: "bad" }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = auditRows(env, "recall_load");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.actor, row.target_kind, row.target_id], ["admin", "recall_source", "test-seed"]);
  assert.deepEqual(row.after, { accepted: 2, rejected: 1, replaced: 0, matched_items: 0, ids: events.map((e) => e.id), ids_total: 2 });
  assert.ok(!("event" in row.after) && !("notes" in row.after));
  noText(row, "Synthetic test event", "synthetic test note");
});

test("admin run and admin grade override are audited; grader grades are not", async () => {
  const env = newEnv();
  const run = await post(env, "/v1/admin/enrich", {});
  assert.equal(run.status, 200);
  const runs = auditRows(env, "admin_run");
  assert.deepEqual(runs.map((x) => [x.actor, x.via, x.target_kind, x.target_id]), [["admin", "token", "job", "enrich"]]);
  assert.ok(Object.values(runs[0].after).every((v) => typeof v === "number"), "numeric fields only");
  const g = (item_id, over) => ({ item_id, score: 80, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material"], ...over });
  const a = addItem(env);
  const b = addItem(env);
  const res = await post(env, "/v1/grades", { grades: [g(a), g(b, { score: 30, flags: ["reason:below_materiality"] })] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.accepted, 2);
  const over = auditRows(env, "grade_override");
  assert.equal(over.length, 1);
  assert.deepEqual([over[0].target_kind, over[0].target_id, over[0].after.accepted], ["coverage_grades", null, res.body.accepted]);
  assert.deepEqual(over[0].after.results, res.body.results);
  assert.ok(!("grade_ids" in over[0].after));
  // The grader's claim and grades write nothing.
  const c = addItem(env);
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 5, run_id: "run-g" } })).body;
  assert.ok(claim.items.some((i) => i.item_id === c));
  const graded = await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-g", grades: [g(c)] } });
  assert.equal(graded.body.accepted, 1);
  assert.equal(auditRows(env, "grade_override").length, 1);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'grader'"), 0);
});

test("admin ingest, aux-ingest and bill-lines runs are each one admin_run row with numeric fields only", async () => {
  const env = newEnv();
  for (const job of ["ingest", "aux-ingest", "bill-lines"]) {
    const r = await post(env, `/v1/admin/${job}`, {});
    assert.equal(r.status, 200, `${job}: ${JSON.stringify(r.body)}`);
    const [row, ...more] = auditRows(env, "admin_run").filter((x) => x.target_id === job);
    assert.equal(more.length, 0, job);
    assert.deepEqual([row.actor, row.via, row.target_kind], ["admin", "token", "job"], job);
    const want = Object.fromEntries(Object.entries(r.body).filter(([, v]) => typeof v === "number"));
    assert.deepEqual(row.after, want, `${job}: the response's top-level numbers, nothing else`);
  }
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 3);
});

test("admin aux grades are one grade_override row on aux_grades whose results keep entity", async () => {
  const env = newEnv();
  const a = addAux(env);
  const b = addAux(env);
  const g = (item_id, over) => ({ item_id, entity: "Testco Robotics", score: 80, band: "digest", event_type: "contract", why: "w", reads_through: [],
    flags: ["reason:material"], confidence: 0.7, read_source: true, dup_of: null, covered_ticker: null, ...over });
  const res = await post(env, "/v1/aux/grades", { run_id: "run-admin", model: "m", grades: [g(a), g(b, { entity: "Othertest Labs", score: 30, band: "reject", flags: ["reason:minor"] })] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.accepted, 2);
  const rows = auditRows(env, "grade_override");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.actor, row.via, row.target_kind, row.target_id, row.after.accepted], ["admin", "token", "aux_grades", null, 2]);
  assert.deepEqual(row.after.results, res.body.results);
  assert.deepEqual(row.after.results.map((x) => x.entity), ["Testco Robotics", "Othertest Labs"]);
  assert.ok(row.after.results.every((x) => !("ticker" in x)), "an undefined ticker is not stored");
});

test("requeue sec_excerpts is audited with only the requeued ids; a dry run writes nothing", async () => {
  const sec = JSON.parse(readFileSync(new URL("./fixtures/sec-filings.json", import.meta.url), "utf8")).pages;
  const url = "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028.htm";
  const env = newEnv({ CONTACT_EMAIL: "ops@example.org" });
  const graded = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url, title: "Testco: 8-K filed 2026-10-28" });
  addGrade(env, graded, { ticker: "AUR", score: 55, band: "borderline", flags: ["reason:primary_source", "no_figures"] });
  // Still pending: read, but not requeued.
  const pending = addItem(env, { source_key: "edgar_aur", ticker: "AUR", url: url.replace("aur-20261028", "missing"), title: "Testco: 8-K pending" });
  const dry = await post(env, "/v1/admin/requeue", { mode: "sec_excerpts", dry_run: true });
  assert.equal(dry.body.remaining, 2, JSON.stringify(dry.body));
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log"), 0);
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => new Response(sec[String(u)] ?? "missing", { status: sec[String(u)] ? 200 : 404, headers: { "content-type": "text/html" } });
  let r;
  try {
    r = (await post(env, "/v1/admin/requeue", { mode: "sec_excerpts" })).body;
  } finally { globalThis.fetch = real; }
  assert.deepEqual([r.processed, r.requeued], [2, 1], JSON.stringify(r));
  assert.deepEqual(r.items.filter((i) => i.requeued).map((i) => i.item_id), [graded]);
  assert.ok(r.items.some((i) => i.item_id === pending && !i.requeued));
  const rows = auditRows(env, "requeue");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.actor, row.target_kind, row.target_id], ["admin", "items", "sec_excerpts"]);
  assert.deepEqual(row.after, { mode: "sec_excerpts", cleared: r.cleared, processed: 2, requeued: 1, ids: [graded], ids_total: 1 });
  // Nothing left to read: processed 0, cleared 0, no second row.
  assert.equal((await post(env, "/v1/admin/requeue", { mode: "sec_excerpts" })).body.processed, 0);
  assert.equal(auditRows(env, "requeue").length, 1);
});

test("ids lists are capped at 500 through requeue", async () => {
  const env = newEnv();
  const real = addItem(env);
  addGrade(env, real);
  const ids = [real, ...Array.from({ length: 599 }, (_, k) => 900000 + k)];
  assert.equal((await post(env, "/v1/admin/requeue", { item_ids: ids })).body.requeued, 1);
  const [row] = auditRows(env, "requeue");
  assert.deepEqual([row.after.ids.length, row.after.ids_total, row.after.requeued], [500, 500, 1]);
});

test("a missing audit_log never fails the action", async () => {
  const env = newEnv();
  env.DB.exec("DROP TABLE audit_log");
  const id = addItem(env);
  addGrade(env, id);
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const r = await post(env, "/v1/feedback", { item_id: id, label: "high" }, "app");
    assert.equal(r.status, 200);
  } finally {
    console.warn = quiet;
  }
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM feedback"), 1);
  ENVS.splice(ENVS.indexOf(env), 1);
});

test("no HTTP path writes actor unknown, and every new row is universe u1", () => {
  let rows = 0;
  for (const env of ENVS) {
    assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log WHERE actor IN ('unknown', 'grader')"), 0);
    const u = env.DB.rows("SELECT DISTINCT universe_id FROM audit_log").map((r) => r.universe_id);
    assert.ok(u.length === 0 || (u.length === 1 && u[0] === "u1"), JSON.stringify(u));
    rows += count(env, "SELECT COUNT(*) AS n FROM audit_log");
  }
  assert.ok(rows > 20, `${rows} audit rows checked`);
});
