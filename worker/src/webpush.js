// Phase 3 Part E (PR-E4): Web Push message encryption (RFC 8291, aes128gcm per
// RFC 8188) and VAPID (RFC 8292), with WebCrypto only: no npm package, no node:
// import, no Buffer. Imported only by push.js, which only index.js's cron imports.
//
// The VAPID private key is a Worker secret (VAPID_PRIVATE_KEY). It is imported
// once per isolate as a non-extractable key and never logged or returned. Only
// VAPID_PUBLIC_KEY ever leaves the Worker (the Authorization header's k=, and the
// portal's Lead alerts panel). Nothing here logs an endpoint, a key or a JWT.
import { allowedEndpoint, b64uDecode, b64uEncode, publicPoint } from "./push-routes.js";

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
export const RECORD_SIZE = 4096;
export const JWT_HOURS = 12;          // RFC 8292 section 2: at most 24 hours
const JWT_REUSE_MS = 3_600_000;       // a JWT is reused per audience for an hour
export const SEND_TIMEOUT_MS = 5000;
export const TTL_SECONDS = 86_400;

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

const ecJwk = (point, d) => ({ kty: "EC", crv: "P-256", x: b64uEncode(point.slice(1, 33)), y: b64uEncode(point.slice(33, 65)), ...(d ? { d } : {}) });

// encryptPayload(payload, p256dhB64u, authB64u, { as, salt }) -> Uint8Array body.
// as = { pub: 65-byte point, priv: ECDH CryptoKey } and salt (16 bytes) are injectable
// for the RFC 8291 test vector only; otherwise both are fresh for every message.
export async function encryptPayload(payload, p256dhB64u, authB64u, { as, salt } = {}) {
  const ua = publicPoint(p256dhB64u);
  const authSecret = b64uDecode(authB64u);
  if (!ua || !authSecret || authSecret.length !== 16) throw new Error("bad subscription keys");
  const plain = typeof payload === "string" ? enc.encode(payload) : new Uint8Array(payload);
  if (!as) {
    const kp = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    as = { pub: new Uint8Array(await subtle().exportKey("raw", kp.publicKey)), priv: kp.privateKey };
  }
  const s = salt ? new Uint8Array(salt) : crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await subtle().importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, as.priv, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(enc.encode("WebPush: info\0"), ua, as.pub), 32);
  const cek = await hkdf(s, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(s, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, key, cat(plain, new Uint8Array([2]))));
  const rs = new Uint8Array([(RECORD_SIZE >>> 24) & 255, (RECORD_SIZE >>> 16) & 255, (RECORD_SIZE >>> 8) & 255, RECORD_SIZE & 255]);
  return cat(s, rs, new Uint8Array([as.pub.length]), as.pub, ct);
}

// --- VAPID ------------------------------------------------------------------------
let keyCache = null;        // { pub, priv, key } for the env's current key pair
const jwtCache = new Map(); // audience -> { jwt, made }
export function clearVapidCache() { keyCache = null; jwtCache.clear(); }

// The VAPID signing key (non-extractable), imported once per isolate and key pair.
export async function vapidKey(env) {
  const pub = env?.VAPID_PUBLIC_KEY;
  const priv = env?.VAPID_PRIVATE_KEY;
  if (keyCache && keyCache.pub === pub && keyCache.priv === priv) return keyCache.key;
  const point = publicPoint(pub);
  const d = b64uDecode(priv);
  if (!point || !d || d.length !== 32) throw new Error("VAPID keys are not set");
  const key = await subtle().importKey("jwk", ecJwk(point, b64uEncode(d)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  jwtCache.clear();
  keyCache = { pub, priv, key };
  return key;
}

// True when VAPID_PRIVATE_KEY signs what VAPID_PUBLIC_KEY verifies. Never throws.
export async function vapidKeysMatch(env) {
  try {
    const key = await vapidKey(env);
    const verifyKey = await subtle().importKey("raw", publicPoint(env.VAPID_PUBLIC_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const msg = enc.encode("zenith-vapid-check");
    const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, msg);
    return await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, sig, msg);
  } catch {
    return false;
  }
}

// A subject is an https: origin URL or a mailto: (RFC 8292 section 2.1).
export const validSubject = (s) => typeof s === "string" && /^(https:\/\/[^\s/]+\/?|mailto:[^\s]+)$/.test(s);

// vapidHeaders(endpoint, env, { now }) -> { authorization: "vapid t=<jwt>, k=<public key>" }
export async function vapidHeaders(endpoint, env, { now = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const key = await vapidKey(env);
  const hit = jwtCache.get(aud);
  let jwt = hit && now - hit.made < JWT_REUSE_MS && now >= hit.made ? hit.jwt : null;
  if (!jwt) {
    const h = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const c = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + JWT_HOURS * 3600, sub: env.VAPID_SUBJECT })));
    const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${c}`)));
    jwt = `${h}.${c}.${b64uEncode(sig)}`;
    jwtCache.set(aud, { jwt, made: now });
  }
  return { authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` };
}

// sendPush(sub, payloadObj, env, { fetchImpl, now, topic }) -> { status }
// status is the push service's HTTP status, or 0 for a refused endpoint, a network
// error or the 5 s timeout. Redirects are never followed (a 3xx is a failure).
// Never throws.
export async function sendPush(sub, payloadObj, env, { fetchImpl = globalThis.fetch, now = Date.now(), topic = null } = {}) {
  if (!allowedEndpoint(sub?.endpoint)) return { status: 0, refused: true };
  try {
    const body = await encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
    const headers = {
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(TTL_SECONDS),
      urgency: "high",
      ...(topic ? { topic } : {}),
      ...(await vapidHeaders(sub.endpoint, env, { now })),
    };
    const r = await fetchImpl(sub.endpoint, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    return { status: Number(r?.status) || 0 };
  } catch {
    return { status: 0 };
  }
}
