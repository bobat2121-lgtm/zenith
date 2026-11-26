// Phase 3, Part E, PR-E4: webpush.js (RFC 8291 message encryption, RFC 8292 VAPID).
// The RFC 8291 section 5 example (its published keys, salt and body) is the
// fixture; every other key is generated here. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { encryptPayload, vapidHeaders, vapidKey, vapidKeysMatch, clearVapidCache, sendPush, RECORD_SIZE } from "../worker/src/webpush.js";
import { b64uDecode, b64uEncode } from "../worker/src/push-routes.js";

const SRC = new URL("../worker/src/", import.meta.url);
const subtle = crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// RFC 8291 section 5 (Appendix A), the published example values.
const RFC = {
  plain: "When I grow up, I want to be a watermelon",
  asPub: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPriv: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPub: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const jwkOf = (point, d) => ({ kty: "EC", crv: "P-256", x: b64uEncode(point.slice(1, 33)), y: b64uEncode(point.slice(33, 65)), ...(d ? { d } : {}) });

async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

// A test-only decrypt (the user agent's side of RFC 8291 section 3.4).
async function decryptBody(body, uaKeys, authB64u) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, uaKeys.priv, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaKeys.pub, ...asPub]);
  const ikm = await hkdf(b64uDecode(authB64u), ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  assert.equal(padded[end], 2, "last record delimiter 0x02");
  return { plain: dec.decode(padded.slice(0, end)), rs, idlen, headerLen: 21 + idlen };
}

async function uaKeyPair() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { pub, priv: kp.privateKey, p256dh: b64uEncode(pub), auth };
}

async function vapidEnv(over = {}) {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  return { env: { VAPID_PUBLIC_KEY: b64uEncode(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "https://zenith.example.com/", ...over }, publicKey: kp.publicKey };
}

test("webpush: encryptPayload with the RFC 8291 section 5 sender key and salt reproduces the RFC body exactly (144 bytes)", async () => {
  const asPub = b64uDecode(RFC.asPub);
  const asPriv = await subtle.importKey("jwk", jwkOf(asPub, RFC.asPriv), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const out = await encryptPayload(RFC.plain, RFC.uaPub, RFC.auth, { as: { pub: asPub, priv: asPriv }, salt: b64uDecode(RFC.salt) });
  assert.equal(out.length, 144);
  assert.equal(b64uEncode(out), RFC.body);
});

test("webpush: a fresh ephemeral key decrypts back to the payload; header 86 bytes, rs 4096, idlen 65; each message differs", async () => {
  const ua = await uaKeyPair();
  const payload = JSON.stringify({ v: 1, title: "TST · new Lead", body: "Synthetic headline", url: "/p/c/TST" });
  const a = await encryptPayload(payload, ua.p256dh, ua.auth);
  const b = await encryptPayload(payload, ua.p256dh, ua.auth);
  assert.notEqual(b64uEncode(a), b64uEncode(b), "fresh salt and key per message");
  const d = await decryptBody(a, ua, ua.auth);
  assert.equal(d.plain, payload);
  assert.equal(d.rs, RECORD_SIZE);
  assert.equal(d.rs, 4096);
  assert.equal(d.idlen, 65);
  assert.equal(d.headerLen, 86);
  await assert.rejects(() => encryptPayload(payload, ua.p256dh.slice(0, 40), ua.auth), /bad subscription keys/);
});

test("webpush: VAPID JWT is ES256 with aud = the endpoint origin, exp within 24 h, sub = VAPID_SUBJECT, and the signature verifies", async () => {
  clearVapidCache();
  const { env, publicKey } = await vapidEnv();
  const now = Date.UTC(2026, 0, 6, 12, 0);
  const h = await vapidHeaders("https://fcm.googleapis.com/fcm/send/synthetic-endpoint", env, { now });
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.authorization);
  assert.ok(m, "vapid t=…, k=…");
  assert.equal(m[2], env.VAPID_PUBLIC_KEY);
  const [hh, cc, ss] = m[1].split(".");
  assert.deepEqual(JSON.parse(dec.decode(b64uDecode(hh))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(dec.decode(b64uDecode(cc)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, env.VAPID_SUBJECT);
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, "exp within 24 h");
  const sig = b64uDecode(ss);
  assert.equal(sig.length, 64, "raw r||s");
  assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, enc.encode(`${hh}.${cc}`)));
  // Reused per audience within the hour; a new one after it.
  const again = await vapidHeaders("https://fcm.googleapis.com/fcm/send/other", env, { now: now + 60_000 });
  assert.equal(again.authorization, h.authorization);
  const later = await vapidHeaders("https://fcm.googleapis.com/fcm/send/other", env, { now: now + 3_700_000 });
  assert.notEqual(later.authorization, h.authorization);
});

test("webpush: the imported VAPID private key is not extractable; keys that do not match are detected", async () => {
  clearVapidCache();
  const { env } = await vapidEnv();
  const key = await vapidKey(env);
  assert.equal(key.extractable, false);
  await assert.rejects(() => subtle.exportKey("jwk", key));
  assert.equal(await vapidKeysMatch(env), true);
  const other = await vapidEnv();
  assert.equal(await vapidKeysMatch({ ...env, VAPID_PRIVATE_KEY: other.env.VAPID_PRIVATE_KEY }), false);
  assert.equal(await vapidKeysMatch({ ...env, VAPID_PRIVATE_KEY: undefined }), false);
  assert.equal(await vapidKeysMatch({}), false);
});

test("webpush: sendPush posts aes128gcm with TTL, Urgency, Topic and VAPID, redirect manual; a refused host makes no fetch; it never throws", async () => {
  clearVapidCache();
  const { env } = await vapidEnv();
  const ua = await uaKeyPair();
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ u, init }); return new Response(null, { status: 201 }); };
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-endpoint", p256dh: ua.p256dh, auth: ua.auth };
  assert.deepEqual(await sendPush(sub, { v: 1 }, env, { fetchImpl, topic: "l7" }), { status: 201 });
  const [{ init }] = calls;
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal);
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers["content-type"], "application/octet-stream");
  assert.equal(init.headers.ttl, "86400");
  assert.equal(init.headers.urgency, "high");
  assert.equal(init.headers.topic, "l7");
  assert.match(init.headers.authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse((await decryptBody(init.body, ua, ua.auth)).plain), { v: 1 });
  for (const endpoint of ["https://fcm.googleapis.com.evil.example.com/x", "http://fcm.googleapis.com/x"]) {
    assert.equal((await sendPush({ ...sub, endpoint }, { v: 1 }, env, { fetchImpl })).status, 0);
  }
  assert.equal(calls.length, 1, "no fetch for a refused endpoint");
  const boom = async () => { throw new Error("network down"); };
  assert.deepEqual(await sendPush(sub, { v: 1 }, env, { fetchImpl: boom }), { status: 0 });
  assert.deepEqual(await sendPush({ ...sub, p256dh: "bad" }, { v: 1 }, env, { fetchImpl }), { status: 0 });
});

test("webpush (W4): the push modules have no node: import, no require( and no Buffer (comments aside)", () => {
  for (const f of ["webpush.js", "push-routes.js"]) {
    const code = readFileSync(new URL(f, SRC), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/from\s+"node:|import\("node:|\brequire\(|\bBuffer\b/.test(code), `${f} uses a Node API`);
  }
});

test("webpush (H2 a): VAPID_PRIVATE_KEY appears in worker/src only as an env. read, and never with a value in test/", () => {
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(new URL(f, SRC), "utf8");
    for (const m of code.matchAll(/VAPID_PRIVATE_KEY/g)) {
      const before = code.slice(Math.max(0, m.index - 5), m.index);
      const line = code.slice(code.lastIndexOf("\n", m.index) + 1, code.indexOf("\n", m.index));
      assert.ok(before.endsWith("env.") || before.endsWith("env?.") || /^\s*\/\//.test(line), `${f}: ${line.trim()}`);
    }
  }
  const TEST = new URL("./", import.meta.url);
  for (const f of readdirSync(TEST).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(new URL(f, TEST), "utf8");
    assert.doesNotMatch(code, /VAPID_PRIVATE_KEY\s*[:=]\s*["'`][A-Za-z0-9_-]{20,}/, `${f} holds a private key value`);
  }
});
