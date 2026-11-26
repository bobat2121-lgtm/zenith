// Phase 3, Part E, PR-E4: who reaches the push routes and /s/sw.js.
// Every push route x every credential x push off and on (Part E §5.6): the first
// seven credentials get 403 in both states, an Access person 404 while off and
// the handler while on; no refused body holds an endpoint, ticker, score or
// title, and no refused call writes a push row. /s/sw.js is 404 while off.
// Synthetic fixtures only (example.com, analyst@example.com, example-team).
import test from "node:test";
import assert from "node:assert/strict";
import { addItem, addGrade } from "./helpers/d1.js";
import { hookJsonImports } from "./helpers/worker-env.js";
import {
  pfetch, sessionEnv, accessEnv, sessionCookie, keyPair, signJwt, goodClaims, withCerts, stripNonce, ORIGIN, APP, TOKENS, SECRET_TITLE,
} from "./helpers/portal.js";
import { clearJwksCache } from "../worker/src/mobile.js";
import { b64uEncode } from "../worker/src/push-routes.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { ROUTES } = await import("../worker/src/portal.js");

const KEY = await keyPair("kid-push");
const OTHER = await keyPair("kid-push-other");
const PUSH_PATHS = ROUTES.filter((r) => r.push);
const TABLES = ["push_subs", "push_events", "push_sends", "push_tests"];
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/synthetic-endpoint-auth";

async function vapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const d = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d;
  return { VAPID_PUBLIC_KEY: b64uEncode(await crypto.subtle.exportKey("raw", kp.publicKey)), VAPID_PRIVATE_KEY: d, VAPID_SUBJECT: "https://zenith.example.com/" };
}
const KEYS = await vapid();
async function subKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { p256dh: b64uEncode(await crypto.subtle.exportKey("raw", kp.publicKey)), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) };
}
const SUB = { endpoint: ENDPOINT, keys: await subKeys() };

const pushCount = (env) => TABLES.reduce((n, t) => n + env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0);
async function seed(db) {
  const id = await addItem(db, { ticker: "TST", title: SECRET_TITLE });
  await addGrade(db, id, { score: 97, why: SECRET_TITLE });
}

function assertClean(r, label) {
  const body = stripNonce(r.text, r.headers);
  assert.ok(!body.includes("fcm.googleapis.com") && !body.includes("synthetic-endpoint"), `${label}: endpoint`);
  assert.ok(!body.includes(SECRET_TITLE), `${label}: title`);
  assert.ok(!/\bTST\b/.test(body), `${label}: ticker`);
  assert.ok(!/\b97\b/.test(body), `${label}: score`);
  assert.equal(r.headers.get("set-cookie"), null, `${label}: no cookie`);
}

const call = (env, route, opts = {}) => pfetch(worker, env, route.path, {
  method: route.method, origin: ORIGIN, ...(route.method === "POST" ? { json: route.push === "unsubscribe" ? { endpoint: ENDPOINT } : route.push === "subscribe" ? SUB : {} } : {}), ...opts,
});

test("push auth: every push route is in ROUTES (so the S1 walk covers it)", () => {
  assert.deepEqual(PUSH_PATHS.map((r) => `${r.method} ${r.path}`),
    ["GET /p/api/push/key", "POST /p/api/push/subscribe", "POST /p/api/push/unsubscribe", "POST /p/api/push/test"]);
});

test("push auth: no credentials, bad and wrong-AUD JWTs, both bearers, a session cookie and a JWT without email get 403 with push off and on; an Access person 404 off", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk, OTHER.jwk] }, async () => {
    for (const on of [false, true]) {
      const extra = on ? { PUSH_ENABLED: "1", ...KEYS } : { ...KEYS };
      const aenv = accessEnv(extra);
      const senv = sessionEnv(extra);
      await seed(aenv.DB);
      await seed(senv.DB);
      const now = Date.now();
      const creds = [
        ["no credentials", aenv, {}],
        ["bad JWT", aenv, { jwt: "a.b.c" }],
        ["wrong-AUD JWT", aenv, { jwt: await signJwt(KEY, goodClaims(now, { aud: ["aud-tag-other"] })) }],
        ["grader bearer", aenv, { headers: { authorization: `Bearer ${TOKENS.GRADER_TOKEN}` } }],
        ["APP_TOKEN bearer", aenv, { headers: { authorization: `Bearer ${APP}` } }],
        ["session cookie (Access mode)", aenv, { cookie: await sessionCookie(senv, now) }],
        ["session cookie (session mode)", senv, { cookie: await sessionCookie(senv, now) }],
        ["Access JWT without email", aenv, { jwt: await signJwt(KEY, goodClaims(now, { email: undefined })) }],
        ["APP_TOKEN bearer (session mode)", senv, { headers: { authorization: `Bearer ${APP}` } }],
        ["?token= (session mode)", senv, { query: `?token=${APP}` }],
      ];
      for (const [name, env, opts] of creds) {
        for (const route of PUSH_PATHS) {
          const label = `${on ? "on" : "off"} ${name} ${route.method} ${route.path}`;
          const { query, ...o } = opts;
          const r = await call(env, query ? { ...route, path: `${route.path}${query}` } : route, o);
          assert.equal(r.status, 403, label);
          assert.match(r.headers.get("content-type") || "", /json/, label);
          const err = JSON.parse(r.text).error;
          assert.ok(err === "forbidden" || err === "push needs an Access sign-in", `${label}: ${err}`);
          if (name === "session cookie (session mode)") assert.equal(err, "push needs an Access sign-in", label);
          assertClean(r, label);
        }
        assert.equal(pushCount(env), 0, `${name}: no push row written`);
      }
      // The Access person: 404 "push is off" while off, the handler while on.
      const jwt = await signJwt(KEY, goodClaims(now));
      for (const route of PUSH_PATHS) {
        const r = await call(aenv, route, { jwt });
        const label = `${on ? "on" : "off"} Access person ${route.method} ${route.path}`;
        if (!on) {
          assert.equal(r.status, 404, label);
          assert.deepEqual(JSON.parse(r.text), { error: "push is off" }, label);
        } else {
          assert.ok([200, 201, 202].includes(r.status), `${label}: ${r.status} ${r.text}`);
        }
        assert.equal(r.headers.get("cache-control"), "no-store", label);
        assertClean(r, label);
      }
      if (!on) assert.equal(pushCount(aenv), 0, "push off: nothing stored for an Access person either");
    }
  });
});

test("push auth: with push on, an Access person's handlers answer key, subscribe, unsubscribe and test, and never echo the endpoint", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const env = accessEnv({ PUSH_ENABLED: "1", ...KEYS });
    const jwt = await signJwt(KEY, goodClaims(Date.now()));
    const key = await pfetch(worker, env, "/p/api/push/key", { jwt });
    assert.equal(key.status, 200);
    assert.deepEqual(JSON.parse(key.text), { public_key: KEYS.VAPID_PUBLIC_KEY });
    const sub = await pfetch(worker, env, "/p/api/push/subscribe", { method: "POST", jwt, origin: ORIGIN, json: SUB });
    assert.equal(sub.status, 201);
    assert.deepEqual(JSON.parse(sub.text), { subscribed: true, platform: "google" });
    const t = await pfetch(worker, env, "/p/api/push/test", { method: "POST", jwt, origin: ORIGIN, json: {} });
    assert.equal(t.status, 202);
    assert.deepEqual(JSON.parse(t.text), { queued: true });
    const un = await pfetch(worker, env, "/p/api/push/unsubscribe", { method: "POST", jwt, origin: ORIGIN, json: { endpoint: ENDPOINT } });
    assert.equal(un.status, 200);
    for (const r of [key, sub, t, un]) assert.ok(!r.text.includes("synthetic-endpoint"));
    // A form body or no content type is refused before anything is read.
    const form = await pfetch(worker, env, "/p/api/push/test", { method: "POST", jwt, origin: ORIGIN, form: { a: "1" } });
    assert.equal(form.status, 415);
  });
});

test("push auth: /s/sw.js is 404 while off (keys set but no switch, or the switch with no key) and 200 with the service-worker headers while on", async () => {
  for (const env of [sessionEnv(), sessionEnv({ ...KEYS }), sessionEnv({ PUSH_ENABLED: "1" }), sessionEnv({ PUSH_ENABLED: "true", ...KEYS }),
    sessionEnv({ PUSH_ENABLED: "1", VAPID_PUBLIC_KEY: "not-a-key" })]) {
    const r = await pfetch(worker, env, "/s/sw.js");
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.text, /addEventListener/);
  }
  const on = sessionEnv({ PUSH_ENABLED: "1", ...KEYS });
  const r = await pfetch(worker, on, "/s/sw.js");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/javascript/);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.equal(r.headers.get("service-worker-allowed"), "/p/");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; connect-src 'self'");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.match(r.text, /addEventListener\("push"/);
  for (const p of ["/s/sw.jsx", "/s/sw.js/x", "/s/SW.js"]) assert.equal((await pfetch(worker, on, p)).status, 404, p);
  assert.ok([404, 405].includes((await pfetch(worker, on, "/s/sw.js", { method: "POST", body: "x" })).status));
  assert.equal((await pfetch(worker, on, "/s/sw.js", { method: "HEAD" })).status, 200);
});

test("push auth: with push on, /s/sw.js is the only new path that answers 200 without credentials", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    for (const env of [sessionEnv({ PUSH_ENABLED: "1", ...KEYS }), accessEnv({ PUSH_ENABLED: "1", ...KEYS })]) {
      for (const route of PUSH_PATHS) {
        for (const method of ["GET", "HEAD", "POST"]) {
          const r = await pfetch(worker, env, route.path, { method, origin: ORIGIN, ...(method === "POST" ? { json: {} } : {}) });
          assert.equal(r.status, 403, `${method} ${route.path}`);
        }
      }
      assert.equal((await pfetch(worker, env, "/s/sw.js")).status, 200);
      assert.equal(pushCount(env), 0);
    }
  });
});

test("push auth: the Lead alerts panel is rendered only for an Access person while push is on; the page keeps one script and the CSP allows worker-src 'self'", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const now = Date.now();
    const jwt = await signJwt(KEY, goodClaims(now));
    const offA = accessEnv({ ...KEYS });
    const onA = accessEnv({ PUSH_ENABLED: "1", ...KEYS });
    const onS = sessionEnv({ PUSH_ENABLED: "1", ...KEYS });
    const pages = [
      ["off, Access", offA, { jwt }, false],
      ["on, Access", onA, { jwt }, true],
      ["on, session", onS, { cookie: await sessionCookie(onS, now) }, false],
    ];
    for (const [label, env, opts, shown] of pages) {
      const r = await pfetch(worker, env, "/p/brief", opts);
      assert.equal(r.status, 200, label);
      assert.equal(/<section[^>]*\sdata-push-panel\b/.test(r.text), shown, label);
      assert.equal((r.text.match(/<script\b/g) || []).length, 1, `${label}: one script`);
      assert.match(r.headers.get("content-security-policy"), /worker-src 'self'/, label);
      assert.doesNotMatch(r.text, /<[^>]*\son[a-z]+\s*=/i, `${label}: no inline handler`);
      if (shown) {
        assert.ok(r.text.includes(`data-key="${KEYS.VAPID_PUBLIC_KEY}"`), `${label}: the public key in a data- attribute`);
        assert.ok(!r.text.includes(KEYS.VAPID_PRIVATE_KEY), `${label}: never the private key`);
        assert.match(r.text, /Turn on Lead alerts/);
        assert.match(r.text, /Add Zenith to your Home Screen/);
      }
      assert.ok(!r.text.includes(KEYS.VAPID_PRIVATE_KEY), label);
    }
  });
});

