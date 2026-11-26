// Portal test helpers (phase 3 PR-PA2). Synthetic values only: example.com hosts,
// analyst@example.com, the example-team Access team and the ticker TST.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { D1 } from "./d1.js";
import { mintSession } from "../../worker/src/portal-auth.js";

export const BASE = "https://zenith.example.com";
export const ORIGIN = BASE;
// 40 synthetic characters: session mode needs an APP_TOKEN of at least 32.
export const APP = "portal-test-app-token-0123456789abcdefgh";
export const TOKENS = { ADMIN_TOKEN: "portal-test-admin-token", GRADER_TOKEN: "portal-test-grader-token", APP_TOKEN: APP };
export const TEAM = "example-team.cloudflareaccess.com";
export const AUD = "aud-tag-example";
export const EMAIL = "analyst@example.com";
export const SECRET_TITLE = "PORTAL-SECRET-TITLE";
export const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

// Loads worker/src as test/helpers/worker.js does (JSON imports rewritten), but
// returns the whole index.js module (for ALLOW) and an importer for its siblings,
// so a test reaches the very portal.js instance the Worker runs.
export async function loadWorkerModule() {
  const SRC = new URL("../../worker/src/", import.meta.url);
  const dir = mkdtempSync(join(tmpdir(), "zenith-portal-"));
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(new URL(f, SRC), "utf8")
      .replace(/from\s+"\.\/([^"]+\.json)"/g, (m, rel) => `from "${new URL(rel, SRC).href}" with { type: "json" }`);
    writeFileSync(join(dir, f), code);
  }
  const imp = (name) => import(pathToFileURL(join(dir, name)).href);
  const index = await imp("index.js");
  return { index, worker: index.default, imp };
}

// The portal tables (migration 0021, PR-PA1). Created here only when the
// migrations have not made them yet, with the same columns.
export function portalTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS portal_views (
  universe_id TEXT NOT NULL DEFAULT 'u1', day TEXT NOT NULL, view TEXT NOT NULL, client TEXT NOT NULL, via TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
  PRIMARY KEY (universe_id, day, view, client, via)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS portal_pairings (
  id INTEGER PRIMARY KEY, code_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
  fails INTEGER NOT NULL DEFAULT 0);`);
  return db;
}

export const newDb = () => portalTables(new D1());
export const sessionEnv = (extra = {}) => ({ DB: newDb(), ...TOKENS, ...extra });
export const accessEnv = (extra = {}) => ({ DB: newDb(), ...TOKENS, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra });

// A D1 wrapper that records every prepared statement's SQL.
export function spyDb(db) {
  const seen = [];
  return {
    seen,
    prepare(sql) { seen.push(sql); return db.prepare(sql); },
    batch(stmts) { seen.push("batch"); return db.batch(stmts); },
    exec(sql) { return db.exec(sql); },
    db: db.db,
  };
}

export async function sessionCookie(env, now = Date.now()) {
  return `__Host-zp=${await mintSession(env, now)}`;
}

// pfetch(worker, env, path, opts) -> { status, headers, text }
export async function pfetch(worker, env, path, { method = "GET", cookie, jwt, form, json, body, origin, secFetchSite, ua, host = BASE, ray,
  contentType, headers = {}, ctx } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (jwt) h["cf-access-jwt-assertion"] = jwt;
  if (origin) h.origin = origin;
  if (secFetchSite) h["sec-fetch-site"] = secFetchSite;
  if (ua) h["user-agent"] = ua;
  if (ray) h["cf-ray"] = ray;
  let payload = body;
  if (form) { payload = new URLSearchParams(form).toString(); h["content-type"] = "application/x-www-form-urlencoded"; }
  if (json !== undefined) { payload = JSON.stringify(json); h["content-type"] = "application/json"; }
  if (contentType) h["content-type"] = contentType;
  const r = await worker.fetch(new Request(`${host}${path}`, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : payload }), env, ctx);
  return { status: r.status, headers: r.headers, text: method === "HEAD" ? "" : await r.text() };
}

// --- Access JWTs (an RS256 keypair, as test/mobile.test.js signs them) ------------------
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function keyPair(kid) {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "RS256", use: "sig" };
  return { kp, jwk, kid };
}
export async function signJwt(key, claims) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
export const goodClaims = (now = Date.now(), over = {}) => ({ aud: [AUD], iss: `https://${TEAM}`, email: EMAIL,
  exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000) - 10, sub: "u1", ...over });

// Runs fn with globalThis.fetch answering the team's certs URL with `keys`
// (or with `status`), restored afterwards. Returns fn's result; calls are counted.
export async function withCerts({ keys = [], status = 200 } = {}, fn) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (String(u) !== `https://${TEAM}/cdn-cgi/access/certs`) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ keys }), { status, headers: { "content-type": "application/json" } });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = saved;
  }
}

// A body with the page's nonce removed (a random nonce could contain any letters).
export function stripNonce(text, headers) {
  const m = /'nonce-([^']+)'/.exec(headers.get("content-security-policy") || "");
  return m ? text.split(m[1]).join("") : text;
}
