// Phase 3, Part E, PR-E4: push.js (the cron's push stage) and the push route
// handlers behind the gate. Shipped off: with PUSH_ENABLED unset the tick makes no
// database call and no network call. Synthetic fixtures only: tickers TST*,
// example.com, analyst@example.com, the example-team Access team, and push
// endpoints with synthetic paths on the public push-service hosts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { addItem, addGrade } from "./helpers/d1.js";
import { hookJsonImports } from "./helpers/worker-env.js";
import { accessEnv, newDb, spyDb, keyPair, signJwt, goodClaims, withCerts, ORIGIN, BASE, EMAIL } from "./helpers/portal.js";
import { clearJwksCache } from "../worker/src/mobile.js";

hookJsonImports();
const { pushTick, pushReady, leadPayload, freshLead, Q7_SQL, MUTED_LITERAL, CURRENT_GRADE_LITERAL, PUSH_FRESH_HOURS, PUSH_MAX_LAG_HOURS,
  PUSH_DAILY_CAP, PUSH_TICKER_CAP } = await import("../worker/src/push.js");
const { allowedEndpoint, b64uEncode, b64uDecode, pushOn } = await import("../worker/src/push-routes.js");
const { clearVapidCache } = await import("../worker/src/webpush.js");
const { portal } = await import("../worker/src/portal.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");
const { CURRENT_GRADE } = await import("../worker/src/brief.js");
const { LEAD_FRESH_HOURS, LEAD_MAX_LAG_HOURS } = await import("../worker/src/delivery.js");

const SRC = new URL("../worker/src/", import.meta.url);
const subtle = crypto.subtle;
const enc = new TextEncoder();
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 0, 6, 15, 0);   // a Tuesday, 15:00Z
const COVERED = { tickers: ["TST", "TSTB", "TSTC", "TSTD", "TSTE"] };
const JWT_KEY = await keyPair("kid-push-tick");
const EP = (n) => `https://fcm.googleapis.com/fcm/send/synthetic-endpoint-${n}`;

// --- Fixtures -----------------------------------------------------------------------
async function vapidKeys() {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { VAPID_PUBLIC_KEY: b64uEncode(await subtle.exportKey("raw", kp.publicKey)), VAPID_PRIVATE_KEY: (await subtle.exportKey("jwk", kp.privateKey)).d,
    VAPID_SUBJECT: "https://zenith.example.com/" };
}
const KEYS = await vapidKeys();
const onEnv = (db = newDb()) => ({ DB: db, PUSH_ENABLED: "1", ...KEYS });

async function uaKeys() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  return { pub, priv: kp.privateKey, p256dh: b64uEncode(pub), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) };
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
// A test-only decrypt of an aes128gcm push body (RFC 8291 section 3.4).
async function decrypt(body, ua) {
  const asPub = body.slice(21, 21 + body[20]);
  const asKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, ua.priv, 256));
  const ikm = await hkdf(b64uDecode(ua.auth), ecdh, new Uint8Array([...enc.encode("WebPush: info\0"), ...ua.pub, ...asPub]), 32);
  const salt = body.slice(0, 16);
  const key = await subtle.importKey("raw", await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
  const out = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12) }, key, body.slice(21 + body[20])));
  return JSON.parse(new TextDecoder().decode(out.slice(0, out.lastIndexOf(2))));
}

const iso = (ms) => new Date(ms).toISOString();
const rows = (env, sql, ...a) => env.DB.db.prepare(sql).all(...a).map((r) => ({ ...r }));
const one = (env, sql, ...a) => ({ ...env.DB.db.prepare(sql).get(...a) });

async function addSub(env, n, { actor = "access:0000000000000000", ua } = {}) {
  const k = ua || (await uaKeys());
  env.DB.db.prepare("INSERT INTO push_subs (actor, endpoint, p256dh, auth, platform, created_at) VALUES (?, ?, ?, ?, 'google', ?)")
    .run(actor, EP(n), k.p256dh, k.auth, iso(NOW - 10 * HOUR));
  return k;
}
const setCursor = (env, at = iso(NOW - 24 * HOUR)) => env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('push_cursor', ?)").run(at);

// A covered Lead: published 2 h ago, first seen 1 h ago, graded 30 min ago.
async function lead(env, over = {}, gradeOver = {}) {
  const id = await addItem(env.DB, { ticker: "TST", title: "Synthetic lead title", published: iso(NOW - 2 * HOUR), nm_first_seen: iso(NOW - HOUR),
    source_key: "src_tst", ...over });
  const gid = await addGrade(env.DB, id, { score: 95, graded_at: iso(NOW - 30 * 60_000), ...gradeOver });
  return { id, gid };
}

function stubFetch(status = 201) {
  const calls = [];
  const fn = async (u, init) => {
    calls.push({ u: String(u), init });
    const s = typeof status === "function" ? status(String(u), calls.length) : status;
    if (s === "throw") throw new Error("timeout");
    return new Response(null, { status: s });
  };
  fn.calls = calls;
  return fn;
}

// --- Off ----------------------------------------------------------------------------
test("push: off (keys set, PUSH_ENABLED unset, or a bad switch value, or keys that do not match): pushTick is off with zero prepare calls and zero fetches", async () => {
  const other = await vapidKeys();
  for (const env of [{ ...KEYS }, { PUSH_ENABLED: "true", ...KEYS }, { PUSH_ENABLED: "1" }, { PUSH_ENABLED: "1", ...KEYS, VAPID_PRIVATE_KEY: other.VAPID_PRIVATE_KEY },
    { PUSH_ENABLED: "1", ...KEYS, VAPID_SUBJECT: "analyst-at-example" }, {}]) {
    clearVapidCache();
    const spy = spyDb(newDb());
    const f = stubFetch();
    const globalFetch = globalThis.fetch;
    let globalCalls = 0;
    globalThis.fetch = async () => { globalCalls++; return new Response(null, { status: 500 }); };
    try {
      assert.deepEqual(await pushTick({ ...env, DB: spy }, COVERED, { now: NOW, fetchImpl: f }), { status: "off" });
    } finally {
      globalThis.fetch = globalFetch;
    }
    assert.equal(spy.seen.length, 0, "no prepare");
    assert.equal(f.calls.length + globalCalls, 0, "no fetch");
  }
  assert.equal(pushOn({ ...KEYS }), false);
  assert.equal(await pushReady(onEnv()), true);
});

// --- Routes behind the gate (Access person, push on) -----------------------------------
async function routeCall(env, path, { method = "POST", json, email = EMAIL, origin = ORIGIN, now = NOW } = {}) {
  const jwt = await signJwt(JWT_KEY, goodClaims(now, { email }));
  const headers = { "cf-access-jwt-assertion": jwt };
  if (origin) headers.origin = origin;
  if (json !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${BASE}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const r = await portal(req, env, new URL(req.url), { now: () => now });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const withAccess = (fn) => { clearJwksCache(); return withCerts({ keys: [JWT_KEY.jwk] }, fn); };
const accessOn = () => accessEnv({ PUSH_ENABLED: "1", ...KEYS });

test("push: a cross-origin POST subscribe from an Access person with push on is 403 and stores nothing", async () => {
  await withAccess(async () => {
    const env = accessOn();
    const k = await uaKeys();
    for (const origin of ["https://evil.example.com", "null", null]) {
      const r = await routeCall(env, "/p/api/push/subscribe", { origin, json: { endpoint: EP(1), keys: { p256dh: k.p256dh, auth: k.auth } } });
      assert.equal(r.status, 403, String(origin));
    }
    assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_subs").n, 0);
  });
});

test("push: allowedEndpoint refuses http, look-alike hosts, a trailing dot, IP literals, userinfo, a port and 1,025 characters; accepts the push services", () => {
  for (const bad of ["http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.test/", "https://fcm.googleapis.com./x", "https://1.2.3.4/x",
    "https://[::1]/x", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", `https://fcm.googleapis.com/${"a".repeat(1025 - 27)}`,
    "https://evilfcm.googleapis.com/x", "https://push.apple.com.evil.test/x", "https://example.com/x", "", null, 42, "not a url"]) {
    assert.equal(allowedEndpoint(bad), null, String(bad).slice(0, 60));
  }
  assert.equal(`https://fcm.googleapis.com/${"a".repeat(1025 - 27)}`.length, 1025);
  assert.deepEqual(allowedEndpoint("https://web.push.apple.com/synthetic-path"), { platform: "apple" });
  assert.deepEqual(allowedEndpoint("https://FCM.googleapis.com/fcm/send/synthetic"), { platform: "google" });
  assert.deepEqual(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/synthetic"), { platform: "mozilla" });
  assert.deepEqual(allowedEndpoint("https://wns2-synthetic.notify.windows.com/w/?token=synthetic"), { platform: "microsoft" });
});

test("push: subscribe refuses a 64-byte p256dh and a 15-byte auth; another person's endpoint is 409; a 6th subscription revokes the oldest as cap; the audit row holds the platform only", async () => {
  await withAccess(async () => {
    const env = accessOn();
    const k = await uaKeys();
    const short = b64uEncode(b64uDecode(k.p256dh).slice(0, 64));
    assert.equal((await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(1), keys: { p256dh: short, auth: k.auth } } })).status, 400);
    const auth15 = b64uEncode(crypto.getRandomValues(new Uint8Array(15)));
    assert.equal((await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(1), keys: { p256dh: k.p256dh, auth: auth15 } } })).status, 400);
    const notPoint = b64uEncode(new Uint8Array([4, ...new Uint8Array(64)]));
    assert.equal((await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(1), keys: { p256dh: notPoint, auth: k.auth } } })).status, 400);
    assert.equal((await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: "https://example.com/x", keys: { p256dh: k.p256dh, auth: k.auth } } })).status, 400);
    assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_subs").n, 0);
    for (let n = 1; n <= 6; n++) {
      const r = await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(n), keys: { p256dh: k.p256dh, auth: k.auth } } });
      assert.equal(r.status, 201, `sub ${n}`);
    }
    const subs = rows(env, "SELECT endpoint, revoked_at IS NULL AS live, revoked_why FROM push_subs ORDER BY id");
    assert.equal(subs.filter((s) => s.live).length, 5);
    assert.deepEqual({ ...subs[0] }, { endpoint: EP(1), live: 0, revoked_why: "cap" });
    // The same endpoint from another Access person.
    const other = await routeCall(env, "/p/api/push/subscribe", { email: "other@example.com", json: { endpoint: EP(2), keys: { p256dh: k.p256dh, auth: k.auth } } });
    assert.equal(other.status, 409);
    assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_subs").n, 6);
    // Re-subscribing a revoked endpoint re-activates it (and caps the oldest other).
    assert.equal((await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(1), keys: { p256dh: k.p256dh, auth: k.auth } } })).status, 200);
    assert.equal(one(env, "SELECT revoked_at IS NULL AS live FROM push_subs WHERE endpoint = ?", EP(1)).live, 1);
    assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_subs WHERE revoked_at IS NULL").n, 5);
    // Unsubscribe: only the caller's own row.
    assert.equal((await routeCall(env, "/p/api/push/unsubscribe", { email: "other@example.com", json: { endpoint: EP(3) } })).status, 404);
    assert.equal((await routeCall(env, "/p/api/push/unsubscribe", { json: { endpoint: EP(3) } })).status, 200);
    assert.equal(one(env, "SELECT revoked_why FROM push_subs WHERE endpoint = ?", EP(3)).revoked_why, "user");
    const audits = rows(env, "SELECT actor, via, action, target_kind, target_id, before_json, after_json FROM audit_log ORDER BY id");
    assert.deepEqual([...new Set(audits.map((a) => a.action))], ["push_subscribe", "push_unsubscribe"]);
    for (const a of audits) {
      assert.match(a.actor, /^access:[0-9a-f]{16}$/);
      assert.equal(a.target_kind, "push_sub");
      const text = JSON.stringify(a);
      assert.ok(!text.includes("synthetic-endpoint") && !text.includes(k.p256dh) && !text.includes(k.auth) && !text.includes(EMAIL), "no endpoint, key or email");
    }
    assert.deepEqual(JSON.parse(audits.find((a) => a.action === "push_subscribe").after_json), { platform: "google" });
  });
});

test("push: four tests in one UTC day give 202, 202, 202, 429; at 00:00Z the next day 202 again; the tick sends pending tests to the person's live subscriptions only", async () => {
  await withAccess(async () => {
    const env = accessOn();
    const me = "access:" + (await sha16(EMAIL));
    const mine = await addSub(env, 1, { actor: me });
    await addSub(env, 2, { actor: "access:1111111111111111" });
    await addSub(env, 3, { actor: me });
    env.DB.db.prepare("UPDATE push_subs SET revoked_at = ?, revoked_why = 'user' WHERE endpoint = ?").run(iso(NOW), EP(3));
    const day = Date.UTC(2026, 0, 6, 20, 0);
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await routeCall(env, "/p/api/push/test", { json: {}, now: day + i * 60_000 })).status);
    assert.deepEqual(got, [202, 202, 202, 429]);
    assert.equal((await routeCall(env, "/p/api/push/test", { json: {}, now: Date.UTC(2026, 0, 7, 0, 0) })).status, 202);
    assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_tests").n, 4);
    setCursor(env, iso(NOW));
    const f = stubFetch(201);
    clearVapidCache();
    const out = await pushTick(env, COVERED, { now: Date.UTC(2026, 0, 7, 0, 5), fetchImpl: f });
    assert.equal(out.tests, 3, "3 a tick");
    assert.deepEqual(f.calls.map((c) => c.u), [EP(1), EP(1), EP(1)], "only the person's live subscription");
    const p = await decrypt(new Uint8Array(f.calls[0].init.body), mine);
    assert.deepEqual(p, { v: 1, title: "Zenith test", body: "Lead alerts work on this device", url: "/p/brief" });
    assert.equal(f.calls[0].init.headers.topic, undefined);
    assert.deepEqual(rows(env, "SELECT status FROM push_tests ORDER BY id").map((r) => r.status), ["sent", "sent", "sent", "pending"]);
  });
});

async function sha16(s) {
  const d = new Uint8Array(await subtle.digest("SHA-256", enc.encode(s.trim().toLowerCase())));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// --- The tick -----------------------------------------------------------------------
test("push: first enable sets the cursor to now and an earlier Lead is never pushed", async () => {
  clearVapidCache();
  const env = onEnv();
  await addSub(env, 1);
  await lead(env);
  const f = stubFetch();
  const first = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.equal(first.status, "started");
  assert.equal(one(env, "SELECT value FROM meta WHERE key = 'push_cursor'").value, iso(NOW));
  const second = await pushTick(env, COVERED, { now: NOW + 5 * 60_000, fetchImpl: f });
  assert.equal(second.new, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_events").n, 0);
});

test("push: a fresh dated Lead (95) gives one event and one POST (aes128gcm, TTL, Urgency, Topic, vapid, redirect manual); the payload has no score; the next tick sends nothing", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  const ua = await addSub(env, 1);
  const { id } = await lead(env);
  env.DB.db.prepare("UPDATE items SET headline = ? WHERE id = ?").run("Synthetic headline for the lock screen", id);
  const f = stubFetch(201);
  const out = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.deepEqual(out, { status: "ok", new: 1, capped: 0, sent: 1, failed: 0, revoked: 0, tests: 0 });
  assert.equal(f.calls.length, 1);
  const { init, u } = f.calls[0];
  assert.equal(u, EP(1));
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers.ttl, "86400");
  assert.equal(init.headers.urgency, "high");
  assert.equal(init.headers.topic, `l${id}`);
  assert.match(init.headers.authorization, /^vapid t=[^,]+, k=/);
  const p = await decrypt(new Uint8Array(init.body), ua);
  assert.deepEqual(p, { v: 1, title: "TST · new Lead", body: "Synthetic headline for the lock screen", url: "/p/c/TST", tag: `lead-${id}-TST` });
  assert.ok(!JSON.stringify(p).includes("95"), "no score");
  assert.deepEqual(rows(env, "SELECT ticker, status, attempts, sent_at IS NOT NULL AS sent FROM push_events"), [{ ticker: "TST", status: "sent", attempts: 1, sent: 1 }]);
  assert.deepEqual(rows(env, "SELECT status, attempts FROM push_sends"), [{ status: 201, attempts: 1 }]);
  assert.equal(one(env, "SELECT last_status FROM push_subs").last_status, 201);
  const again = await pushTick(env, COVERED, { now: NOW + 5 * 60_000, fetchImpl: f });
  assert.equal(again.new + again.sent, 0);
  assert.equal(f.calls.length, 1);
});

test("push: a 307 answer is a failure and is never followed; an endpoint edited to a non-listed host in D1 gets no fetch", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  await addSub(env, 1);
  await lead(env);
  const f = stubFetch(307);
  const out = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.equal(out.failed, 1);
  assert.equal(f.calls.length, 1, "one request, no redirect followed");
  assert.equal(one(env, "SELECT last_status FROM push_subs").last_status, 307);
  assert.equal(one(env, "SELECT status FROM push_events").status, "failed");
  // An endpoint changed in place to a host off the allow-list.
  const env2 = onEnv();
  setCursor(env2);
  await addSub(env2, 1);
  env2.DB.db.prepare("UPDATE push_subs SET endpoint = 'https://push.example.com/x'").run();
  await lead(env2);
  const g = stubFetch(201);
  await pushTick(env2, COVERED, { now: NOW, fetchImpl: g });
  assert.equal(g.calls.length, 0);
  assert.equal(one(env2, "SELECT status FROM push_events").status, "failed");
});

test("push: not pushed: an own-item Digest 88, published NULL, first seen 80 h ago, first seen 100 h after published, a muted source, a ticker not covered", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  await addSub(env, 1);
  await lead(env, { ticker: "TST", title: "digest" }, { score: 88 });
  await lead(env, { ticker: "TSTB", published: null });
  await lead(env, { ticker: "TSTC", nm_first_seen: iso(NOW - 80 * HOUR), published: iso(NOW - 81 * HOUR) });
  await lead(env, { ticker: "TSTD", nm_first_seen: iso(NOW - HOUR), published: iso(NOW - 101 * HOUR) });
  await lead(env, { ticker: "TSTE", source_key: "src_muted" });
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('src_muted', 'mute', ?)").run(iso(NOW));
  await lead(env, { ticker: "OTHER" });
  const f = stubFetch(201);
  const out = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.equal(out.new, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(one(env, "SELECT COUNT(*) AS n FROM push_events").n, 0);
  // The cursor still moved past them.
  assert.equal(one(env, "SELECT value FROM meta WHERE key = 'push_cursor'").value, iso(NOW - 30 * 60_000));
  // Aux Leads live in aux_grades and are never read: Q7 reads grades and items only.
  assert.doesNotMatch(Q7_SQL, /\baux_/);
  assert.equal(freshLead({ nm_first_seen: iso(NOW - HOUR), published: iso(NOW - 2 * HOUR) }, NOW), true);
});

test("push: PUSH_FRESH_HOURS and PUSH_MAX_LAG_HOURS equal delivery.js; the inlined CURRENT_GRADE equals brief.js and the mute subquery equals tuning.js", () => {
  assert.equal(PUSH_FRESH_HOURS, LEAD_FRESH_HOURS);
  assert.equal(PUSH_MAX_LAG_HOURS, LEAD_MAX_LAG_HOURS);
  assert.equal(CURRENT_GRADE_LITERAL, CURRENT_GRADE);
  assert.equal(MUTED_LITERAL, MUTED_SQL);
  assert.ok(Q7_SQL.includes(CURRENT_GRADE) && Q7_SQL.includes(`NOT IN ${MUTED_SQL}`));
  for (const f of ["push.js", "push-routes.js", "webpush.js", "push-sw.js"]) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    assert.doesNotMatch(code, /from\s+"\.\/(brief|delivery|tuning|discord)\.js"/, f);
  }
});

test("push: 7 fresh Leads in a day: 5 sent, 2 capped; 3 for one ticker: 2 sent, 1 capped", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  await addSub(env, 1);
  for (const t of ["TST", "TST", "TSTB", "TSTB", "TSTC", "TSTC", "TSTD"]) await lead(env, { ticker: t });
  const f = stubFetch(201);
  const out = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.equal(out.new, PUSH_DAILY_CAP);
  assert.equal(out.capped, 2);
  assert.equal(out.sent, 5);
  assert.equal(f.calls.length, 5);
  assert.deepEqual(rows(env, "SELECT status, COUNT(*) AS n FROM push_events GROUP BY status ORDER BY status"), [{ status: "capped", n: 2 }, { status: "sent", n: 5 }]);
  const env2 = onEnv();
  setCursor(env2);
  await addSub(env2, 1);
  for (let i = 0; i < 3; i++) await lead(env2, { ticker: "TST" });
  const out2 = await pushTick(env2, COVERED, { now: NOW, fetchImpl: stubFetch(201) });
  assert.equal(out2.sent, PUSH_TICKER_CAP);
  assert.equal(out2.capped, 1);
});

test("push: 404 and 410 revoke the subscription; 429 retries at +5 and +15 min and fails after 3 attempts; 401 fails with last_status 401", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  for (const n of [1, 2]) await addSub(env, n);
  await lead(env);
  const out = await pushTick(env, COVERED, { now: NOW, fetchImpl: stubFetch((u) => (u === EP(1) ? 404 : 410)) });
  assert.equal(out.revoked, 2);
  assert.deepEqual(rows(env, "SELECT revoked_why, last_status FROM push_subs ORDER BY id"), [{ revoked_why: "gone_404", last_status: 404 }, { revoked_why: "gone_410", last_status: 410 }]);

  const env2 = onEnv();
  setCursor(env2);
  await addSub(env2, 1);
  await lead(env2);
  const busy = stubFetch(429);
  await pushTick(env2, COVERED, { now: NOW, fetchImpl: busy });
  assert.deepEqual(one(env2, "SELECT status, attempts, next_at FROM push_events"), { status: "partial", attempts: 1, next_at: iso(NOW + 5 * 60_000) });
  await pushTick(env2, COVERED, { now: NOW + 60_000, fetchImpl: busy });
  assert.equal(busy.calls.length, 1, "not due yet");
  await pushTick(env2, COVERED, { now: NOW + 5 * 60_000, fetchImpl: busy });
  assert.deepEqual(one(env2, "SELECT status, attempts, next_at FROM push_events"), { status: "partial", attempts: 2, next_at: iso(NOW + 20 * 60_000) });
  await pushTick(env2, COVERED, { now: NOW + 20 * 60_000, fetchImpl: busy });
  assert.deepEqual(one(env2, "SELECT status, attempts, next_at FROM push_events"), { status: "failed", attempts: 3, next_at: null });
  assert.equal(busy.calls.length, 3);
  assert.deepEqual(one(env2, "SELECT status, attempts FROM push_sends"), { status: 429, attempts: 3 });
  await pushTick(env2, COVERED, { now: NOW + 80 * 60_000, fetchImpl: busy });
  assert.equal(busy.calls.length, 3, "a failed event is done");
  // A timeout counts like a 429.
  const env4 = onEnv();
  setCursor(env4);
  await addSub(env4, 1);
  await lead(env4);
  await pushTick(env4, COVERED, { now: NOW, fetchImpl: stubFetch("throw") });
  assert.equal(one(env4, "SELECT status FROM push_events").status, "partial");

  const env3 = onEnv();
  setCursor(env3);
  await addSub(env3, 1);
  await lead(env3);
  await pushTick(env3, COVERED, { now: NOW, fetchImpl: stubFetch(401) });
  assert.equal(one(env3, "SELECT status FROM push_events").status, "failed");
  assert.deepEqual(one(env3, "SELECT last_status, revoked_at FROM push_subs"), { last_status: 401, revoked_at: null });
});

test("push: a Lead re-graded to digest before its send is marked stale", async () => {
  clearVapidCache();
  const env = onEnv();
  setCursor(env);
  await addSub(env, 1);
  const { id } = await lead(env);
  const f = stubFetch(429);
  await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
  assert.equal(one(env, "SELECT status FROM push_events").status, "partial");
  await addGrade(env.DB, id, { score: 80, graded_at: iso(NOW + 60_000), run_id: "run-2" });
  await pushTick(env, COVERED, { now: NOW + 5 * 60_000, fetchImpl: f });
  assert.equal(one(env, "SELECT status FROM push_events").status, "stale");
  assert.equal(f.calls.length, 1, "no second send");
});

test("push: the default payload is the ticker, 'new Lead' and the clipped headline, under 512 bytes, with no score", () => {
  const p = leadPayload({ item_id: 7, ticker: "TST", headline: "€".repeat(400), title: "t" });
  assert.ok(new TextEncoder().encode(JSON.stringify(p)).length <= 512);
  assert.deepEqual(Object.keys(p).sort(), ["body", "tag", "title", "url", "v"]);
  assert.equal(p.title, "TST · new Lead");
  assert.equal(leadPayload({ item_id: 7, ticker: "TST", headline: null, title: "Title only" }).body, "Title only");
});

// --- P13, P14 ---------------------------------------------------------------------------
function walk(start) {
  const seen = new Set();
  const go = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) go(m[1]);
  };
  go(start);
  return seen;
}

test("push (P13): the push modules, brief-sections.js and portal-brief.js reach neither discord.js nor delivery.js; brief-store.js reaches no delivery.js; push files never name the other channel", () => {
  for (const f of ["webpush.js", "push.js", "push-routes.js", "push-sw.js", "brief-sections.js", "portal-brief.js", "portal.js", "portal-static.js", "portal-shell.js"]) {
    const set = walk(f);
    for (const bad of ["discord.js", "delivery.js", "tuning.js", "brief.js"]) assert.ok(!set.has(bad), `${f} reaches ${bad}`);
  }
  // brief-store.js builds the brief through brief.js (which formats with discord.js
  // helpers on main); it still never reaches the Lead sender.
  assert.ok(!walk("brief-store.js").has("delivery.js"));
  // Only index.js imports the senders.
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js") && f !== "index.js" && f !== "push.js")) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    assert.doesNotMatch(code, /from\s+"\.\/(push|webpush)\.js"/, `${f} imports a push sender`);
  }
  assert.match(readFileSync(new URL("index.js", SRC), "utf8"), /import \{ pushTick \} from "\.\/push\.js";/);
  for (const f of ["webpush.js", "push.js", "push-routes.js", "push-sw.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, SRC), "utf8"), /discord/i, f);
  }
  // The service worker source has no fetch handler and never uses Cache Storage.
  const sw = readFileSync(new URL("push-sw.js", SRC), "utf8");
  assert.doesNotMatch(sw, /addEventListener\(\s*["']fetch["']|caches\.|cache\.add|cache\.put/);
});

test("push (P14): console output over subscribe, a 404, a 429, a timeout, a test send and a tick holds no endpoint, key, JWT or vapid header", async () => {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x) ?? String(x))).join(" "));
  let secrets = [];
  try {
    await withAccess(async () => {
      clearVapidCache();
      const env = accessOn();
      const k = await uaKeys();
      secrets = [EP(9), k.p256dh, k.auth, KEYS.VAPID_PRIVATE_KEY, "synthetic-endpoint"];
      await routeCall(env, "/p/api/push/subscribe", { json: { endpoint: EP(9), keys: { p256dh: k.p256dh, auth: k.auth } } });
      await routeCall(env, "/p/api/push/test", { json: {} });
      setCursor(env);
      for (const t of ["TST", "TSTB", "TSTC"]) await lead(env, { ticker: t });
      let n = 0;
      const f = stubFetch(() => [404, 429, "throw", 201][n++ % 4]);
      const r = await pushTick(env, COVERED, { now: NOW, fetchImpl: f });
      console.log("push", JSON.stringify(r));
      // A broken table makes a route fail: its log line names the route only.
      env.DB.db.exec("DROP TABLE push_tests");
      await routeCall(env, "/p/api/push/test", { json: {} });
    });
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.some((l) => l.startsWith("push {")), "the tick logged its counts");
  assert.ok(lines.some((l) => l === "push route failed test"), "the failed route logged its name");
  const all = lines.join("\n");
  for (const s of secrets) assert.ok(!all.includes(s), "a capability or key in the logs");
  assert.doesNotMatch(all, /vapid t=|eyJ[A-Za-z0-9_-]{10,}\./);
});

test("push: scripts/vapid-keys.mjs prints only the public key and 'done', pipes values on stdin only, and writes no file (static scan; never run here)", () => {
  const code = readFileSync(new URL("../scripts/vapid-keys.mjs", import.meta.url), "utf8");
  const body = code.replace(/^\s*\/\/.*$/gm, "");
  const logs = [...body.matchAll(/console\.(log|info|warn|debug)\(([^)]*)\)/g)].map((m) => m[2].trim());
  assert.deepEqual(logs, ["publicKey", '"done"'], "the only printed values");
  for (const m of body.matchAll(/console\.error\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /\bjwk\b|\bvalues?\b(?![^"`]*["`])|publicKey|\$\{(value|values|subject|jwk|publicKey)/, "an error line prints a value");
  assert.doesNotMatch(body, /process\.stdout\.write|process\.stderr\.write/);
  assert.doesNotMatch(body, /from\s+"(node:)?fs(\/promises)?"|writeFile|appendFile|createWriteStream/, "writes no file");
  assert.match(body, /stdio: \["pipe", "inherit", "inherit"\]/, "the value goes to the child's stdin");
  assert.match(body, /child\.stdin\.end\(value\)/);
  assert.doesNotMatch(body, /cmdArgs = \[[^\]]*value/, "never an argument");
  // The private value is only ever handed to `put` for zenith-core, never with a config.
  assert.match(body, /\["VAPID_PRIVATE_KEY", null\]/);
  assert.doesNotMatch(body, /\["VAPID_PRIVATE_KEY", config\]/);
});
