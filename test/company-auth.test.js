// Phase 3 Part B (P3-B2): GET /v1/company needs the app or admin bearer token.
// T1 no token, no data; T2 the unauthenticated sweep (no database call);
// T2b an unknown or off-list ticker after auth reads nothing. Synthetic values
// only; the covered ticker is picked from covered.json at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadWorkerModule, TOKENS } from "./helpers/portal.js";
import { D1, addItem, addGrade } from "./helpers/d1.js";

const COV = JSON.parse(readFileSync(new URL("../worker/src/covered.json", import.meta.url), "utf8"));
const T = COV.tickers[0];
const OWN = Object.entries(COV.sources).find(([, t]) => t === T)?.[0];
const SENTINEL = "SENTINEL-TITLE";
const { index, worker } = await loadWorkerModule();
const BASE = "https://zenith.example.com";

async function seeded() {
  const db = new D1();
  const id = await addItem(db, { ticker: T, source_key: OWN, title: SENTINEL, nm_first_seen: new Date(Date.now() - 3_600_000).toISOString() });
  await addGrade(db, id, { score: 60 });
  return db;
}
// Counts every prepare and batch on DB and NEWS, passing through to real databases.
function counted(db, news) {
  const calls = [];
  const wrap = (name, inner) => ({
    prepare(sql) { calls.push(`${name}: ${sql.slice(0, 40)}`); return inner.prepare(sql); },
    batch(s) { calls.push(`${name}: batch`); return inner.batch(s); },
  });
  return { env: { DB: wrap("DB", db), NEWS: wrap("NEWS", news), ...TOKENS }, calls };
}
const send = (env, path, { method = "GET", headers = {} } = {}) =>
  worker.fetch(new Request(`${BASE}${path}`, { method, headers }), env, { waitUntil() {} });

test("the route is in ALLOW for app and admin only", () => {
  assert.deepEqual(index.ALLOW["GET /v1/company"], ["app", "admin"]);
});

test("T1: no token, no data. Only the app or admin bearer is read (lib.js roleFor reads the Authorization header only)", async () => {
  const path = `/v1/company?ticker=${T}`;
  const cases = [
    [{}, 401],
    [{ authorization: `Bearer ${TOKENS.GRADER_TOKEN}` }, 403],
    [{ authorization: "Bearer not-a-token" }, 401],
    [{ "cf-access-authenticated-user-email": "test@example.com" }, 401],
    [{ "cf-access-jwt-assertion": "a.b.c" }, 401],
    [{ cookie: "CF_Authorization=a.b.c" }, 401],
  ];
  for (const [headers, status] of cases) {
    const { env, calls } = counted(await seeded(), new D1({ migrations: false }));
    const r = await send(env, path, { headers });
    assert.equal(r.status, status, JSON.stringify(Object.keys(headers)));
    const body = await r.text();
    assert.ok(!body.includes(SENTINEL));
    assert.deepEqual(JSON.parse(body), { error: status === 401 ? "unauthorized" : "forbidden" });
    assert.deepEqual(calls, []);
  }
  {
    const { env, calls } = counted(await seeded(), new D1({ migrations: false }));
    const r = await send(env, `${path}&token=${TOKENS.APP_TOKEN}`);
    assert.equal(r.status, 401, "?token= is never read");
    assert.deepEqual(calls, []);
  }
  for (const tok of [TOKENS.APP_TOKEN, TOKENS.ADMIN_TOKEN]) {
    const { env } = counted(await seeded(), new D1({ migrations: false }));
    const r = await send(env, path, { headers: { authorization: `Bearer ${tok}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
    assert.equal(r.headers.get("set-cookie"), null);
    const body = await r.text();
    assert.ok(body.includes(SENTINEL), "the authorised call sees the row");
  }
});

test("T2: unauthenticated sweep. Every method and path variant is 401, 403 or 404 with no database call (index.js: ALLOW miss is 404 before auth)", async () => {
  const lower = T.toLowerCase();
  const paths = ["/v1/company", "/v1/company/", `/v1/company/${T}`, `/v1/company?ticker=${lower}`, `/v1/company?ticker=${T}&days=30&section=own`,
    "/v1/company?ticker=TST", "/v1/company?ticker=%3Cscript%3E", "/V1/company", "/v1/Company"];
  for (const method of ["GET", "HEAD", "POST"]) {
    for (const p of paths) {
      for (const headers of [{}, { "cf-access-authenticated-user-email": "test@example.com" }]) {
        const { env, calls } = counted(await seeded(), new D1({ migrations: false }));
        const r = await send(env, p, { method, headers });
        assert.ok([401, 403, 404].includes(r.status), `${method} ${p}: ${r.status}`);
        const body = await r.text();
        assert.ok(!body.includes(SENTINEL), `${method} ${p}`);
        assert.deepEqual(calls, [], `${method} ${p}: database touched`);
      }
    }
  }
});

test("T2b: an unknown, off-list or missing ticker after auth is 404 with no database call; bad days or section is 400", async () => {
  for (const [q, status] of [["?ticker=TST", 404], ["?ticker=%3Cscript%3E", 404], ["", 404], ["?ticker=", 404],
    [`?ticker=${T}&days=0`, 400], [`?ticker=${T}&days=31`, 400], [`?ticker=${T}&section=x`, 400]]) {
    const { env, calls } = counted(await seeded(), new D1({ migrations: false }));
    const r = await send(env, `/v1/company${q}`, { headers: { authorization: `Bearer ${TOKENS.APP_TOKEN}` } });
    assert.equal(r.status, status, q);
    if (status === 404) assert.deepEqual(await r.json(), { error: "unknown ticker" });
    assert.deepEqual(calls, [], `${q}: database touched`);
  }
});
