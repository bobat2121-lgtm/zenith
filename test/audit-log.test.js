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
