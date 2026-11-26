// Phase 3 PR-PA2: the portal's one auth gate (portal-auth.js) through the Worker.
// S1 walks every ROUTES entry without credentials; S2-S10 and S20 cover the gate,
// sessions, sign-in, Access, the JWKS negative cache, pairing codes and CSRF.
// Synthetic fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { addItem, addGrade } from "./helpers/d1.js";
import {
  loadWorkerModule, pfetch, sessionEnv, accessEnv, sessionCookie, spyDb, keyPair, signJwt, goodClaims, withCerts, stripNonce,
  newDb, APP, ORIGIN, EMAIL, SECRET_TITLE, TEAM,
} from "./helpers/portal.js";
import { portalAuth, portalMode, createPairing, redeemPairing, mintSession, clearNegativeCache } from "../worker/src/portal-auth.js";
import { clearJwksCache } from "../worker/src/mobile.js";

const { worker, imp } = await loadWorkerModule();
const { ROUTES } = await imp("portal.js");
const KEY = await keyPair("kid-portal");
const OTHER_KEY = await keyPair("kid-other");
const DAY_S = 86_400;

async function seed(db) {
  for (const t of ["TST", "TST"]) {
    const id = await addItem(db, { ticker: t, title: SECRET_TITLE });
    await addGrade(db, id, { score: 91, why: SECRET_TITLE });
  }
}
const rowCount = (env, table) => env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const audits = (env) => env.DB.db.prepare("SELECT actor, via, request_id, before_json, after_json, target_id FROM audit_log ORDER BY id").all();

// The paths to probe for one ROUTES entry: the path (a pattern gets a ticker), a
// trailing slash, the last segment upper-cased, and the whole path upper-cased.
function variants(path) {
  const p = path.replace(/:ticker$/, "TST");
  const segs = p.split("/");
  const lastUp = [...segs.slice(0, -1), segs.at(-1).toUpperCase()].join("/");
  return [...new Set([p, `${p}/`, lastUp, p.toUpperCase()])];
}

function assertNoData(r, label) {
  const body = stripNonce(r.text, r.headers);
  assert.ok(!body.includes(SECRET_TITLE), `${label}: seeded title leaked`);
  assert.ok(!/\bTST\b/.test(body), `${label}: ticker leaked`);
  assert.ok(!/data-ticker|class="tk"|\/p\/c\/[A-Z]/.test(body), `${label}: card or ticker list`);
  assert.ok(!/<article/.test(body), `${label}: a card`);
  assert.equal(r.headers.get("cache-control"), "no-store", `${label}: no-store`);
}

// --- S1 ---------------------------------------------------------------------------------
test("S1: every ROUTES path and variant, every method, both modes, without credentials, gets a gate response and no data", async () => {
  assert.ok(ROUTES.length >= 16, "ROUTES lists the portal's paths");
  for (const mode of ["session", "access"]) {
    await withCerts({ keys: [KEY.jwk] }, async () => {
      const env = mode === "session" ? sessionEnv() : accessEnv();
      await seed(env.DB);
      const spy = spyDb(env.DB);
      const env2 = { ...env, DB: spy };
      const paths = new Set();
      for (const r of ROUTES) for (const v of variants(r.path)) paths.add(`${r.method} ${v}`);
      for (const r of ROUTES) {
        if (r.method === "GET") for (const v of variants(r.path)) { paths.add(`HEAD ${v}`); paths.add(`POST ${v}`); }
        else for (const v of variants(r.path)) paths.add(`GET ${v}`);
      }
      for (const extra of ["GET /p/nope", "GET /p//today", "GET /p/today/", "GET /P/today", "GET /p%2ftoday", "GET /p/c/TST/x", "PUT /p/today"]) paths.add(extra);
      assert.ok(paths.size >= 60, `${paths.size} method and path pairs`);
      for (const key of paths) {
        const [method, path] = key.split(" ");
        const label = `${mode} ${key}`;
        for (const extra of [{}, { form: { token: "nope" } }]) {
          if (extra.form && method !== "POST") continue;
          const r = await pfetch(worker, env2, path, { method, ...extra });
          assertNoData(r, label);
          const isLoginForm = mode === "session" && /^\/p\/login\/?$/.test(path) && (method === "GET" || method === "HEAD");
          if (isLoginForm) { assert.equal(r.status, 200, label); assert.equal(r.headers.get("set-cookie"), null, label); continue; }
          if (path === "/p%2ftoday" || /^\/P(\/|$)/.test(path)) {
            assert.equal(r.status, 404, label);
            assert.match(r.headers.get("content-type"), /json/, `${label}: the existing 404 JSON`);
            continue;
          }
          assert.ok([303, 403, 404, 405].includes(r.status), `${label}: status ${r.status}`);
          if (r.status === 303) assert.equal(r.headers.get("location"), "/p/login", label);
          if (r.status === 404) assert.ok(/^\/p\/login\/?$/i.test(path) && mode === "access", `${label}: 404 only for the Access-mode sign-in page`);
          if (r.status === 405) assert.ok(/^\/p\/(login|logout)\/?$/.test(path), `${label}: 405 only on the routes before the gate`);
          assert.equal(r.headers.get("set-cookie"), null, `${label}: no cookie`);
        }
      }
      const reads = spy.seen.filter((sql) => /\b(items|aux_items)\b/.test(sql));
      assert.deepEqual(reads, [], `${mode}: no items or aux_items read`);
    });
  }
});

test("S1: portal.js dispatches no /p path literal that is not in ROUTES", () => {
  const code = readFileSync(new URL("../worker/src/portal.js", import.meta.url), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const paths = ROUTES.map((r) => r.path);
  const prefixes = paths.filter((p) => p.includes("/:")).map((p) => p.slice(0, p.indexOf("/:") + 1));
  const literals = [...code.matchAll(/["'`](\/p(?:\/[^"'`$?#]*)?)/g)].map((m) => m[1]);
  assert.ok(literals.length >= paths.length, "ROUTES literals found");
  for (const l of literals) assert.ok(paths.includes(l) || prefixes.includes(l), `path literal ${l} is not in ROUTES`);
  assert.doesNotMatch(code, /pathname\s*===\s*["'`]\/p/, "no route is matched outside ROUTES");
});

// --- S2, S3 -----------------------------------------------------------------------------
test("S2: POST /p/api/feedback without credentials is 403 JSON and writes nothing", async () => {
  const env = sessionEnv();
  const id = await addItem(env.DB, { ticker: "TST", title: "x" });
  await addGrade(env.DB, id, { score: 80 });
  const before = [rowCount(env, "feedback"), rowCount(env, "audit_log")];
  for (const [label, opts] of [["no origin", {}], ["same origin", { origin: ORIGIN }]]) {
    const r = await pfetch(worker, env, "/p/api/feedback", { method: "POST", json: { item_id: id, label: "high" }, ...opts });
    assert.equal(r.status, 403, label);
    assert.deepEqual(JSON.parse(r.text), { error: "forbidden" });
  }
  assert.deepEqual([rowCount(env, "feedback"), rowCount(env, "audit_log")], before);
});

test("S3: a token in the query string or as a bearer never signs in", async () => {
  const env = sessionEnv();
  await seed(env.DB);
  const a = await pfetch(worker, env, `/p/today?token=${APP}`);
  assert.equal(a.status, 303);
  assert.equal(a.headers.get("location"), "/p/login");
  const b = await pfetch(worker, env, `/p/login?token=${APP}`);
  assert.equal(b.status, 200);
  const c = await pfetch(worker, env, "/p/today", { headers: { authorization: `Bearer ${APP}` } });
  assert.equal(c.status, 303);
  for (const r of [a, b, c]) { assert.equal(r.headers.get("set-cookie"), null); assertNoData(r, "S3"); }
  assert.doesNotMatch(readFileSync(new URL("../worker/src/portal-auth.js", import.meta.url), "utf8"), /searchParams/);
});

// --- S4, S4b ----------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function forge(token, exp, epoch = "0") {
  const k = createHmac("sha256", token).update(`zenith-portal-session-v1.${epoch}`).digest();
  return `__Host-zp=v1.${exp}.${b64url(createHmac("sha256", k).update(`v1.${exp}`).digest())}`;
}

test("S4: a valid session cookie passes; expired, too long, tampered, foreign, wrong-version and other-epoch cookies do not", async () => {
  const env = sessionEnv();
  const now = Date.now();
  const t = Math.floor(now / 1000);
  const valid = await sessionCookie(env, now);
  assert.equal(valid, forge(APP, t + 30 * DAY_S), "the cookie is the documented HMAC");
  assert.equal((await pfetch(worker, env, "/p/today", { cookie: valid })).status, 200);
  const [, exp, sig] = valid.split("=")[1].split(".");
  const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  const bad = [
    ["expired", await sessionCookie(env, now - 31 * DAY_S * 1000)],
    ["beyond 31 days", forge(APP, t + 40 * DAY_S)],
    ["tampered", `__Host-zp=v1.${exp}.${flipped}`],
    ["another APP_TOKEN", await sessionCookie({ ...env, APP_TOKEN: "another-app-token-of-forty-characters-xx" }, now)],
    ["version prefix", `__Host-zp=v2.${exp}.${sig}`],
  ];
  for (const [label, cookie] of bad) {
    const r = await pfetch(worker, env, "/p/today", { cookie });
    assert.equal(r.status, 303, label);
    assert.equal(r.headers.get("location"), "/p/login", label);
  }
  const epoch = await pfetch(worker, { ...env, PORTAL_SESSION_EPOCH: "1" }, "/p/today", { cookie: valid });
  assert.equal(epoch.status, 303, "minted with no epoch, checked under epoch 1");
  assert.equal((await pfetch(worker, { ...env, PORTAL_SESSION_EPOCH: "1" }, "/p/today", { cookie: forge(APP, exp, "1") })).status, 200);
});

test("S4b: portalMode: a 31-character APP_TOKEN is off, 32 is session, PORTAL_MODE=off is off", async () => {
  const t31 = "a".repeat(31), t32 = "b".repeat(32);
  assert.equal(portalMode({ APP_TOKEN: t31 }), "off");
  assert.equal(portalMode({ APP_TOKEN: t32 }), "session");
  assert.equal(portalMode({ APP_TOKEN: t32, PORTAL_MODE: "off" }), "off");
  assert.equal(portalMode({}), "off");
  assert.equal(portalMode({ APP_TOKEN: t32, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "x" }), "access");
  assert.equal(portalMode({ APP_TOKEN: t32, ACCESS_TEAM_DOMAIN: "http://plain.example", ACCESS_AUD: "x" }), "session");
  for (const env of [sessionEnv({ APP_TOKEN: t31 }), sessionEnv({ PORTAL_MODE: "off" })]) {
    const cookie = await sessionCookie({ APP_TOKEN: env.APP_TOKEN });
    assert.equal((await pfetch(worker, env, "/p/today", { cookie })).status, 403);
    assert.equal((await pfetch(worker, env, "/p/login")).status, 404);
    const post = await pfetch(worker, env, "/p/login", { method: "POST", origin: ORIGIN, form: { token: env.APP_TOKEN } });
    assert.equal(post.status, 404);
    assert.equal(post.headers.get("set-cookie"), null);
  }
  const env = sessionEnv({ APP_TOKEN: t32 });
  assert.equal((await pfetch(worker, env, "/p/today", { cookie: await sessionCookie(env) })).status, 200);
});

// --- S5 ---------------------------------------------------------------------------------
test("S5: sign-in sets a __Host- cookie only on a right token, same origin, form body", async () => {
  const env = sessionEnv();
  const ok = await pfetch(worker, env, "/p/login", { method: "POST", origin: ORIGIN, form: { token: APP } });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/p/today");
  const ck = ok.headers.get("set-cookie");
  assert.match(ck, /^__Host-zp=v1\.\d+\.[A-Za-z0-9_-]+;/);
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(ck.split("; ").includes(attr), attr);
  assert.doesNotMatch(ck, /Domain=/i);
  assert.ok(!ck.includes(APP), "the cookie holds no token");
  assert.equal((await pfetch(worker, env, "/p/today", { cookie: ck.split(";")[0] })).status, 200);
  const wrong = await pfetch(worker, env, "/p/login", { method: "POST", origin: ORIGIN, form: { token: `${APP}x` } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get("set-cookie"), null);
  const asJson = await pfetch(worker, env, "/p/login", { method: "POST", origin: ORIGIN, json: { token: APP } });
  assert.equal(asJson.status, 415);
  const asText = await pfetch(worker, env, "/p/login", { method: "POST", origin: ORIGIN, body: `token=${APP}`, contentType: "text/plain" });
  assert.equal(asText.status, 415);
  for (const r of [asJson, asText, await pfetch(worker, env, "/p/login")]) assert.equal(r.headers.get("set-cookie"), null);
  const out = await pfetch(worker, env, "/p/logout", { method: "POST", origin: ORIGIN, cookie: ck.split(";")[0] });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/p/login");
  assert.match(out.headers.get("set-cookie"), /^__Host-zp=; .*Max-Age=0/);
});

// --- S6, S7, S8 -------------------------------------------------------------------------
test("S6: Access mode: a valid JWT with an email passes; every other credential is refused", async () => {
  clearJwksCache();
  clearNegativeCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const now = Date.now();
    const env = accessEnv();
    const good = await signJwt(KEY, goodClaims(now));
    assert.equal((await pfetch(worker, env, "/p/today", { jwt: good })).status, 200);
    const noEmail = goodClaims(now);
    delete noEmail.email;
    const otherHash = createHash("sha256").update("someone@example.com").digest("hex");
    const cases = [
      ["wrong AUD", { jwt: await signJwt(KEY, goodClaims(now, { aud: ["other-aud"] })) }, env],
      ["wrong issuer", { jwt: await signJwt(KEY, goodClaims(now, { iss: "https://other-team.cloudflareaccess.com" })) }, env],
      ["expired", { jwt: await signJwt(KEY, goodClaims(now, { exp: Math.floor(now / 1000) - 600 })) }, env],
      ["no email", { jwt: await signJwt(KEY, noEmail) }, env],
      ["pinned to another email", { jwt: good }, { ...env, ACCESS_EMAIL_SHA256: otherHash }],
      ["CF_Authorization cookie only", { cookie: `CF_Authorization=${good}` }, env],
      ["session cookie, no JWT", { cookie: await sessionCookie(env) }, env],
    ];
    for (const [label, opts, e] of cases) {
      const r = await pfetch(worker, e, "/p/today", opts);
      assert.equal(r.status, 403, label);
      assertNoData(r, label);
    }
    const mine = createHash("sha256").update(EMAIL).digest("hex");
    assert.equal((await pfetch(worker, { ...env, ACCESS_EMAIL_SHA256: `${otherHash}, ${mine}` }, "/p/today", { jwt: good })).status, 200, "a pinned list");
  });
});

test("S7: a certs outage costs one fetch a minute: all refused, no throw", async () => {
  clearJwksCache();
  clearNegativeCache();
  await withCerts({ status: 500 }, async (calls) => {
    const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "aud-tag-example" };
    const t = Date.now();
    const jwt = await signJwt(KEY, goodClaims(t));
    const req = () => new Request(`${ORIGIN}/p/today`, { headers: { "cf-access-jwt-assertion": jwt } });
    const url = new URL(`${ORIGIN}/p/today`);
    assert.equal((await portalAuth(req(), env, url, { now: t })).ok, false);
    assert.equal((await portalAuth(req(), env, url, { now: t + 10_000 })).ok, false);
    assert.equal(calls.length, 1, "one certs fetch for the first two requests");
    assert.equal((await portalAuth(req(), env, url, { now: t + 70_000 })).ok, false);
    assert.equal(calls.length, 2, "one more after 60 s");
  });
  clearNegativeCache();
});

test("S8: /p/login and /p/pair are 404 in Access mode", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const env = accessEnv();
    const jwt = await signJwt(KEY, goodClaims());
    assert.equal((await pfetch(worker, env, "/p/login")).status, 404);
    assert.equal((await pfetch(worker, env, "/p/login", { jwt })).status, 404);
    assert.equal((await pfetch(worker, env, "/p/pair", { jwt })).status, 404);
    assert.equal((await pfetch(worker, env, "/p/pair", { method: "POST", jwt, origin: ORIGIN, form: {} })).status, 404);
    assert.equal(rowCount(env, "portal_pairings"), 0);
    const out = await pfetch(worker, env, "/p/logout", { method: "POST", jwt, origin: ORIGIN });
    assert.equal(out.status, 303);
    assert.equal(out.headers.get("location"), "/cdn-cgi/access/logout");
  });
  // A JWT signed by an unknown key is refused too.
  await withCerts({ keys: [KEY.jwk] }, async () => {
    assert.equal((await pfetch(worker, accessEnv(), "/p/today", { jwt: await signJwt(OTHER_KEY, goodClaims()) })).status, 403);
  });
});

// --- S9 ---------------------------------------------------------------------------------
test("S9: pairing codes are single use, short-lived, locked after 5 misses, one at a time, stored hashed", async () => {
  const env = { DB: newDb(), APP_TOKEN: APP };
  const t = Date.parse("2030-01-09T15:00:00.000Z");
  const MIN = 60_000;
  // (a) no code was asked for: nothing works and nothing is written.
  assert.equal(await redeemPairing(env, "ABCDEFGHIJ", t), false);
  assert.equal(rowCount(env, "portal_pairings"), 0);
  // (b) works at t + 9 min, lowercased and spaced; once only.
  const { code } = await createPairing(env, t);
  assert.match(code, /^[A-Z2-7]{10}$/);
  const spaced = `${code.slice(0, 5).toLowerCase()} ${code.slice(5).toLowerCase()}`;
  assert.equal(await redeemPairing(env, spaced, t + 9 * MIN), true);
  assert.equal(await redeemPairing(env, code, t + 9 * MIN), false, "single use");
  // (c) expires after 10 minutes.
  const c2 = (await createPairing(env, t)).code;
  assert.equal(await redeemPairing(env, c2, t + 11 * MIN), false);
  // (d) 5 wrong codes, then the right one: locked.
  const c3 = (await createPairing(env, t)).code;
  for (let i = 0; i < 5; i++) assert.equal(await redeemPairing(env, c3 === "AAAAAAAAAA" ? "BBBBBBBBBB" : "AAAAAAAAAA", t + MIN), false);
  assert.equal(await redeemPairing(env, c3, t + 2 * MIN), false, "locked after 5 misses");
  // (e) a second code makes the first fail.
  const c4 = (await createPairing(env, t)).code;
  const c5 = (await createPairing(env, t)).code;
  assert.equal(await redeemPairing(env, c4, t + MIN), c4 === c5);
  assert.equal(await redeemPairing(env, c5, t + MIN), c4 !== c5);
  // (f) only the hash is stored; at most one row.
  const rows = env.DB.db.prepare("SELECT * FROM portal_pairings").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code_sha256, createHash("sha256").update(c5).digest("hex"));
  assert.ok(!JSON.stringify(rows).includes(c5));
  // (g) through the Worker: GET /p/pair shows a button and creates nothing; POST shows a code that signs a device in.
  const wenv = sessionEnv();
  const cookie = await sessionCookie(wenv);
  const g = await pfetch(worker, wenv, "/p/pair", { cookie });
  assert.equal(g.status, 200);
  assert.match(g.text, /Make a pairing code/);
  assert.equal(rowCount(wenv, "portal_pairings"), 0);
  const p = await pfetch(worker, wenv, "/p/pair", { method: "POST", cookie, origin: ORIGIN, form: {} });
  assert.equal(p.status, 200);
  const shown = /class="code">([A-Z2-7]{5}) ([A-Z2-7]{5})</.exec(p.text);
  assert.ok(shown, "the code is shown once");
  assert.match(p.text, /one use/);
  const signIn = await pfetch(worker, wenv, "/p/login", { method: "POST", origin: ORIGIN, form: { code: `${shown[1]} ${shown[2]}` } });
  assert.equal(signIn.status, 303);
  assert.match(signIn.headers.get("set-cookie"), /^__Host-zp=v1\./);
  const again = await pfetch(worker, wenv, "/p/login", { method: "POST", origin: ORIGIN, form: { code: shown[1] + shown[2] } });
  assert.equal(again.status, 403);
});

// --- S10 --------------------------------------------------------------------------------
test("S10: labels record the right actor; cross-origin, sibling and Origin-less posts are refused on every state-changing route", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    // Session label.
    const env = sessionEnv();
    const id = await addItem(env.DB, { ticker: "TST", title: "x" });
    await addGrade(env.DB, id, { score: 80 });
    const cookie = await sessionCookie(env);
    const s = await pfetch(worker, env, "/p/api/feedback", { method: "POST", cookie, origin: ORIGIN, ray: "ray-portal-1", json: { item_id: id, label: "high" } });
    assert.equal(s.status, 200, s.text);
    assert.equal(JSON.parse(s.text).ok, true);
    assert.equal(rowCount(env, "feedback"), 1);
    assert.deepEqual(audits(env).map(({ actor, via, request_id }) => ({ actor, via, request_id })), [{ actor: "app", via: "session", request_id: "ray-portal-1" }]);
    // Access label.
    const aenv = accessEnv();
    const aid = await addItem(aenv.DB, { ticker: "TST", title: "x" });
    await addGrade(aenv.DB, aid, { score: 80 });
    const jwt = await signJwt(KEY, goodClaims());
    const a = await pfetch(worker, aenv, "/p/api/feedback", { method: "POST", jwt, origin: ORIGIN, json: { item_id: aid, label: "low" } });
    assert.equal(a.status, 200, a.text);
    const hex = createHash("sha256").update(EMAIL).digest("hex").slice(0, 16);
    const rows = audits(aenv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, `access:${hex}`);
    assert.equal(rows[0].via, "access");
    assert.ok(!JSON.stringify(rows).includes(EMAIL), "the email is not stored");
    // CSRF: bad origins on every state-changing route.
    const BAD = [
      ["evil origin", { origin: "https://evil.example" }],
      ["same-site sibling", { origin: "https://other.example-sub.workers.dev" }],
      ["no Origin, same-site fetch", { secFetchSite: "same-site" }],
      ["Origin null", { origin: "null" }],
    ];
    const routes = [
      ["/p/api/feedback", { json: { item_id: id, label: "noise" } }, ["session", "access"]],
      ["/p/login", { form: { token: APP } }, ["session"]],
      ["/p/logout", { form: {} }, ["session", "access"]],
      ["/p/pair", { form: {} }, ["session"]],
    ];
    for (const [path, body, modes] of routes) {
      for (const mode of modes) {
        const e = mode === "session" ? env : aenv;
        const cred = mode === "session" ? { cookie } : { jwt };
        for (const [label, hdr] of BAD) {
          const before = [rowCount(e, "feedback"), rowCount(e, "audit_log"), rowCount(e, "portal_pairings")];
          const r = await pfetch(worker, e, path, { method: "POST", ...cred, ...body, ...hdr });
          assert.equal(r.status, 403, `${mode} ${path} ${label}`);
          assert.equal(r.headers.get("set-cookie"), null, `${mode} ${path} ${label}`);
          assert.deepEqual([rowCount(e, "feedback"), rowCount(e, "audit_log"), rowCount(e, "portal_pairings")], before, `${mode} ${path} ${label}`);
        }
      }
    }
    // text/plain with a valid cookie and the same origin: 415, nothing written.
    const tp = await pfetch(worker, env, "/p/api/feedback", { method: "POST", cookie, origin: ORIGIN, body: JSON.stringify({ item_id: id, label: "noise" }), contentType: "text/plain" });
    assert.equal(tp.status, 415);
    assert.equal(rowCount(env, "feedback"), 1);
    // A native form post lands on its return path; unsafe returns land on /p/today.
    const form = (ret) => pfetch(worker, env, "/p/api/feedback", { method: "POST", cookie, origin: ORIGIN, form: { item_id: id, label: "medium", ticker: "TST", return: ret } });
    const back = await form("/p/today?range=7d");
    assert.equal(back.status, 303);
    assert.equal(back.headers.get("location"), "/p/today?range=7d");
    for (const ret of ["https://example.com/x", "//x", "/p/\\evil", "/p/%0d%0aSet-Cookie:x", `/p/${"a".repeat(298)}`]) {
      const r = await form(ret);
      assert.equal(r.status, 303, ret);
      assert.equal(r.headers.get("location"), "/p/today", ret);
    }
    assert.equal(rowCount(env, "feedback"), 7);
  });
});

// --- S20 --------------------------------------------------------------------------------
test("S20: the gate does not depend on the host (a version-URL-shaped host)", async () => {
  const env = sessionEnv();
  await seed(env.DB);
  const host = "https://1a2b3c4d-zenith.example.com";
  const anon = await pfetch(worker, env, "/p/today", { host });
  assert.equal(anon.status, 303);
  assertNoData(anon, "other host");
  assert.equal((await pfetch(worker, env, "/p/c", { host, cookie: await sessionCookie(env) })).status, 200);
  const post = await pfetch(worker, env, "/p/api/feedback", { host, method: "POST", origin: host, json: { item_id: 1, label: "high" } });
  assert.equal(post.status, 403);
});

test("mintSession: the session lasts 30 days", async () => {
  const now = Date.now();
  const v = await mintSession({ APP_TOKEN: APP }, now);
  assert.equal(Number(v.split(".")[1]), Math.floor(now / 1000) + 30 * DAY_S);
});
