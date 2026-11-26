// Portal (phase 3): the one auth gate for every /p route.
// Modes (portalMode):
//   "off"     PORTAL_MODE=off, or nothing usable is configured: every /p route is 403.
//   "access"  ACCESS_TEAM_DOMAIN and ACCESS_AUD set: a verified Cloudflare Access JWT
//             (Cf-Access-Jwt-Assertion; JWKS, AUD, issuer) that carries an email,
//             optionally pinned by ACCESS_EMAIL_SHA256 (comma-separated hex hashes).
//             The CF_Authorization cookie and the session cookie are ignored.
//   "session" APP_TOKEN set and at least 32 characters: the __Host-zp cookie, minted by
//             a same-origin POST sign-in with APP_TOKEN or a single-use pairing code.
// Bearer tokens and token query parameters are never accepted here; a token only
// ever arrives in a POST body. The cookie holds an expiry and a MAC, no identity.
// Rotating APP_TOKEN or setting a new PORTAL_SESSION_EPOCH secret ends every session.
import { verifyAccessJwt, teamOrigin } from "./mobile.js";
import { tokenMatches, whoForMobile } from "./lib.js";

export const SESSION_COOKIE = "__Host-zp";
export const SESSION_DAYS = 30;
const SESSION_MAX_SEC = 31 * 86_400;
export const MIN_TOKEN_LEN = 32;
export const PAIR_MINUTES = 10;
export const PAIR_MAX_FAILS = 5;
const NEG_CACHE_MS = 60_000;

export function portalMode(env) {
  if (env?.PORTAL_MODE === "off") return "off";
  if (teamOrigin(env?.ACCESS_TEAM_DOMAIN) && env?.ACCESS_AUD) return "access";
  if (typeof env?.APP_TOKEN === "string" && env.APP_TOKEN.length >= MIN_TOKEN_LEN) return "session";
  return "off";
}

// --- Crypto helpers -------------------------------------------------------------------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export const sha256hex = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// K = HMAC-SHA256(APP_TOKEN, "zenith-portal-session-v1." + epoch), derived per request.
async function sessionKey(env) {
  return hmac(enc.encode(String(env.APP_TOKEN)), `zenith-portal-session-v1.${env.PORTAL_SESSION_EPOCH || "0"}`);
}

// The cookie value "v1.<exp>.<sig>" for a session that ends SESSION_DAYS from now.
export async function mintSession(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86_400;
  const sig = b64url(await hmac(await sessionKey(env), `v1.${exp}`));
  return `v1.${exp}.${sig}`;
}

export const sessionSetCookie = (value) => `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
export const sessionClearCookie = () => `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

// The __Host-zp value from a Cookie header, or "".
export function readSessionCookie(cookieHeader) {
  for (const part of String(cookieHeader || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

export async function verifySession(value, env, now = Date.now()) {
  if (portalMode(env) !== "session") return false;
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(value || ""));
  if (!m) return false;
  const exp = Number(m[1]);
  const t = Math.floor(now / 1000);
  if (!(exp > t) || exp > t + SESSION_MAX_SEC) return false;
  const want = b64url(await hmac(await sessionKey(env), `v1.${exp}`));
  return tokenMatches(m[2], want);
}

// --- Access ---------------------------------------------------------------------------
// A JWKS fetch wrapper: after a failed certs fetch (a throw or a non-2xx answer) every
// certs request for that origin gets a synthetic 503 for NEG_CACHE_MS, with no network
// call, so an outage costs at most one subrequest a minute per isolate.
const negUntil = new Map(); // origin -> ms
export function clearNegativeCache() { negUntil.clear(); }
function negCached(base, now) {
  return async (u, init) => {
    let origin = "";
    try { origin = new URL(String(u)).origin; } catch { /* keep "" */ }
    if ((negUntil.get(origin) || 0) > now) return new Response(null, { status: 503 });
    try {
      const r = await base(u, init);
      if (!r || !r.ok) negUntil.set(origin, now + NEG_CACHE_MS);
      return r;
    } catch (e) {
      negUntil.set(origin, now + NEG_CACHE_MS);
      throw e;
    }
  };
}

async function emailAllowed(env, email) {
  const pins = String(env.ACCESS_EMAIL_SHA256 || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!pins.length) return true;
  const h = await sha256hex(email.trim().toLowerCase());
  return pins.some((p) => tokenMatches(p, h));
}

// portalAuth(request, env, url, { now, fetchImpl }) -> { ok, mode, via?, email? }
export async function portalAuth(request, env, url, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const mode = portalMode(env);
  if (mode === "access") {
    const jwt = request.headers.get("cf-access-jwt-assertion");
    if (!jwt) return { ok: false, mode };
    let claims = null;
    try { claims = await verifyAccessJwt(jwt, env, { now, fetchImpl: negCached(fetchImpl, now) }); } catch { claims = null; }
    const email = typeof claims?.email === "string" ? claims.email.trim() : "";
    if (!claims || !email) return { ok: false, mode };
    if (!(await emailAllowed(env, email))) return { ok: false, mode };
    return { ok: true, mode, via: "access", email };
  }
  if (mode === "session") {
    const ok = await verifySession(readSessionCookie(request.headers.get("cookie")), env, now);
    return ok ? { ok: true, mode, via: "session" } : { ok: false, mode };
  }
  return { ok: false, mode: "off" };
}

// The audit actor for a portal action: access:<16 hex> through Access, else
// { actor: "app", via: "session" } with the request's cf-ray.
export async function whoForPortal(auth, request) {
  if (auth?.via === "access") return whoForMobile({ via: "access", email: auth.email }, request);
  let request_id = null;
  try { request_id = request?.headers?.get?.("cf-ray") || null; } catch { request_id = null; }
  return { actor: "app", via: "session", request_id };
}

// --- Pairing codes (session mode) ------------------------------------------------------
// 10 characters of RFC 4648 base32 (50 bits), single use, PAIR_MINUTES long, void after
// PAIR_MAX_FAILS wrong guesses. Only the SHA-256 is stored, and at most one row exists.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const iso = (ms) => new Date(ms).toISOString();

export async function createPairing(env, now = Date.now()) {
  const r = new Uint8Array(10);
  crypto.getRandomValues(r);
  const code = [...r].map((b) => B32[b & 31]).join("");
  const expires = now + PAIR_MINUTES * 60_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM portal_pairings"),
    env.DB.prepare("INSERT INTO portal_pairings (code_sha256, created_at, expires_at, used_at, fails) VALUES (?, ?, ?, NULL, 0)")
      .bind(await sha256hex(code), iso(now), iso(expires)),
  ]);
  return { code, expires_at: expires };
}

export async function redeemPairing(env, code, now = Date.now()) {
  const c = String(code || "").replace(/\s+/g, "").toUpperCase().slice(0, 64);
  if (!c) return false;
  try {
    const row = await env.DB.prepare("SELECT id, code_sha256 FROM portal_pairings WHERE used_at IS NULL AND expires_at > ? AND fails < ? LIMIT 1")
      .bind(iso(now), PAIR_MAX_FAILS).first();
    if (!row) return false;
    // Reserve one of the PAIR_MAX_FAILS tries atomically before comparing, so tries sent at
    // the same time cannot all pass the check above. A miss keeps its reservation; the hit
    // that reserved a try marks the code used.
    const slot = await env.DB.prepare("UPDATE portal_pairings SET fails = fails + 1 WHERE id = ? AND used_at IS NULL AND expires_at > ? AND fails < ?")
      .bind(row.id, iso(now), PAIR_MAX_FAILS).run();
    if (slot?.meta?.changes !== 1) return false;
    if (!tokenMatches(await sha256hex(c), String(row.code_sha256))) return false;
    const u = await env.DB.prepare("UPDATE portal_pairings SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(iso(now), row.id).run();
    return u?.meta?.changes === 1;
  } catch (e) {
    console.warn("portal pairing unavailable");
    return false;
  }
}
