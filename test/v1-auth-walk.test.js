// Phase 3 PR-PA2 (integration edit E9), S22: every /v1 route needs its token.
// Walks the exported ALLOW table, so a route a later change adds is covered with
// no edit here: no token -> 401, the grader token on a route that does not list
// grader -> 403, and neither touches a database (0 prepare calls); a path that
// is not in ALLOW -> 404 before auth.
import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkerModule, TOKENS } from "./helpers/portal.js";

const { index, worker } = await loadWorkerModule();
const ALLOW = index.ALLOW;

function spyEnv() {
  const calls = [];
  const db = (name) => ({
    prepare(sql) { calls.push(`${name}: ${sql}`); throw new Error("no database access expected"); },
    batch() { calls.push(`${name}: batch`); throw new Error("no database access expected"); },
    exec() { calls.push(`${name}: exec`); },
  });
  return { env: { DB: db("DB"), NEWS: db("NEWS"), ...TOKENS }, calls };
}
const send = (env, key, token) => {
  const [method, path] = key.split(" ");
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (method !== "GET") headers["content-type"] = "application/json";
  return worker.fetch(new Request(`https://zenith.example.com${path}`, { method, headers, body: method === "GET" ? undefined : "{}" }), env, { waitUntil() {} });
};

test("S22: every ALLOW key without a token is 401 with no database call", async () => {
  const keys = Object.keys(ALLOW);
  assert.ok(keys.length >= 45, `${keys.length} /v1 routes`);
  for (const key of keys) {
    assert.match(key, /^(GET|POST) \/v1\//, key);
    const { env, calls } = spyEnv();
    const r = await send(env, key, null);
    assert.equal(r.status, 401, key);
    assert.deepEqual(await r.json(), { error: "unauthorized" }, key);
    assert.deepEqual(calls, [], `${key}: database touched`);
    const wrong = await send(env, key, "not-a-token");
    assert.equal(wrong.status, 401, `${key} with a wrong token`);
    assert.deepEqual(calls, [], `${key}: database touched`);
  }
});

test("S22: the grader token on every ALLOW key that does not list grader is 403 with no database call", async () => {
  const keys = Object.entries(ALLOW).filter(([, roles]) => !roles.includes("grader")).map(([k]) => k);
  assert.ok(keys.length >= 20);
  for (const key of keys) {
    const { env, calls } = spyEnv();
    const r = await send(env, key, TOKENS.GRADER_TOKEN);
    assert.equal(r.status, 403, key);
    assert.deepEqual(await r.json(), { error: "forbidden" }, key);
    assert.deepEqual(calls, [], `${key}: database touched`);
  }
  // The app token on admin-only keys, the same way.
  for (const key of Object.entries(ALLOW).filter(([, roles]) => !roles.includes("app")).map(([k]) => k)) {
    const { env, calls } = spyEnv();
    assert.equal((await send(env, key, TOKENS.APP_TOKEN)).status, 403, key);
    assert.deepEqual(calls, [], key);
  }
});

test("S22: a /v1 path or method not in ALLOW is 404 before auth", async () => {
  for (const key of ["GET /v1/nope", "DELETE /v1/feed", "PUT /v1/feedback", "GET /v1/admin/ingest", "GET /v1", "GET /v1/feed/x"]) {
    assert.ok(!ALLOW[key], key);
    const { env, calls } = spyEnv();
    for (const token of [null, TOKENS.ADMIN_TOKEN]) {
      const [method, path] = key.split(" ");
      const r = await worker.fetch(new Request(`https://zenith.example.com${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
      assert.equal(r.status, 404, `${key} ${token ? "admin" : "no token"}`);
    }
    assert.deepEqual(calls, [], key);
  }
});
