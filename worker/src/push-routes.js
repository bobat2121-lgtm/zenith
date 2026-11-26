// Phase 3 Part E (PR-E4): the web push switch and the /p/api/push/* handlers.
// Shipped OFF: until PUSH_ENABLED is "1" and VAPID_PUBLIC_KEY is set (both
// secrets, set only by the owner), pushOn(env) is false, so /s/sw.js is 404, the
// Lead alerts panel is not rendered and every push route below answers 403 or 404.
//
// Order on every push route (the router has already matched the exact path and
// method and run portalAuth, which makes no database call):
//   person check (an Access sign-in with an email; a session cookie, a service
//   token or a bearer never gets further) -> pushOn -> sameOrigin and the JSON
//   content type (POST) -> handler.
// So a caller who is not signed in through Access cannot tell whether push is on.
//
// This module makes no network request. It uses WebCrypto only to check that a
// subscription's p256dh is a P-256 point. Sending lives in push.js and webpush.js,
// which only index.js's cron imports, so no portal module reaches a sender.
// An endpoint is a capability URL: it is never logged, audited or returned.
import { audit, whoForMobile } from "./lib.js";
import { sameOrigin } from "./mobile.js";
import { portalHeaders } from "./portal-shell.js";

export const PUSH_SUBS_PER_ACTOR = 5;
export const PUSH_TESTS_PER_DAY = 3;
export const ENDPOINT_MAX = 1024;
const BODY_MAX = 4096;

// --- base64url (no Buffer: this runs in the Worker) -----------------------------------
export function b64uDecode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
  const t = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (t.length % 4 === 1) return null;
  try {
    const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
export function b64uEncode(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A 65-byte uncompressed P-256 point (0x04 || x || y), or null.
export function publicPoint(b64u) {
  const b = b64uDecode(b64u);
  return b && b.length === 65 && b[0] === 4 ? b : null;
}

// The route-side switch: PUSH_ENABLED is exactly "1" and VAPID_PUBLIC_KEY is a
// P-256 point. Env only: no database call, no network. The cron side (push.js
// pushReady) also checks that the private key matches this public key.
export function pushOn(env) {
  return env?.PUSH_ENABLED === "1" && publicPoint(env?.VAPID_PUBLIC_KEY) !== null;
}

// --- The endpoint allow-list (an exact matcher; push.js re-checks before every send) --
const HOST_RULES = [
  [(h) => h === "fcm.googleapis.com", "google"],
  [(h) => h === "updates.push.services.mozilla.com" || h === "push.services.mozilla.com", "mozilla"],
  [(h) => h.endsWith(".push.apple.com"), "apple"],
  [(h) => h.endsWith(".notify.windows.com"), "microsoft"],
];

// allowedEndpoint(raw) -> { platform } for an https URL on a known push service
// (no port, no userinfo, no IP literal, no trailing dot, at most 1,024 chars), else null.
export function allowedEndpoint(raw) {
  if (typeof raw !== "string" || !raw || raw.length > ENDPOINT_MAX) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h || h.endsWith(".") || h.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  for (const [match, platform] of HOST_RULES) if (match(h)) return { platform };
  return null;
}

// A subscription's keys: p256dh a P-256 point that imports as an ECDH public key,
// auth 16 bytes. -> { p256dh, auth } (the base64url strings) or { error }.
export async function subscriptionKeys(keys) {
  const p = publicPoint(keys?.p256dh);
  if (!p) return { error: "keys.p256dh must be a 65-byte P-256 point" };
  try {
    await crypto.subtle.importKey("raw", p, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    return { error: "keys.p256dh must be a 65-byte P-256 point" };
  }
  const a = b64uDecode(keys?.auth);
  if (!a || a.length !== 16) return { error: "keys.auth must be 16 bytes" };
  return { p256dh: keys.p256dh, auth: keys.auth };
}

// --- Responses ----------------------------------------------------------------------
const jsonR = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: portalHeaders(null, { "content-type": "application/json; charset=utf-8" }) });

const iso = (ms) => new Date(ms).toISOString();
const utcDayStart = (ms) => `${iso(ms).slice(0, 10)}T00:00:00.000Z`;

async function readJsonBody(request) {
  const t = (request.headers.get("content-type") || "").toLowerCase();
  if (!t.startsWith("application/json")) return { status: 415 };
  let text = "";
  try { text = await request.text(); } catch { return { status: 400 }; }
  if (text.length > BODY_MAX) return { status: 413 };
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? { body: v } : { status: 400 };
  } catch {
    return { status: 400 };
  }
}

// --- Handlers -----------------------------------------------------------------------
async function subscribe(env, request, auth, body, now) {
  const allowed = allowedEndpoint(body.endpoint);
  if (!allowed) return jsonR({ error: "endpoint is not on a known push service" }, 400);
  const keys = await subscriptionKeys(body.keys);
  if (keys.error) return jsonR({ error: keys.error }, 400);
  const who = await whoForMobile(auth, request);
  if (!/^access:[0-9a-f]{16}$/.test(who.actor)) return jsonR({ error: "push needs an Access sign-in" }, 403);
  const t = iso(now);
  const found = await env.DB.prepare("SELECT id, actor, revoked_at FROM push_subs WHERE endpoint = ?").bind(body.endpoint).first();
  let id;
  if (found) {
    if (found.actor !== who.actor) return jsonR({ error: "this subscription belongs to another sign-in" }, 409);
    id = found.id;
    await env.DB.prepare(`UPDATE push_subs SET p256dh = ?, auth = ?, platform = ?, revoked_at = NULL, revoked_why = NULL, fail_count = 0
      WHERE id = ?`).bind(keys.p256dh, keys.auth, allowed.platform, id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO push_subs (universe_id, actor, endpoint, p256dh, auth, platform, created_at)
      VALUES ('u1', ?, ?, ?, ?, ?, ?)`).bind(who.actor, body.endpoint, keys.p256dh, keys.auth, allowed.platform, t).run();
    id = r.meta.last_row_id;
  }
  // At most PUSH_SUBS_PER_ACTOR live subscriptions: the oldest others are revoked as 'cap'.
  const live = (await env.DB.prepare(`SELECT id FROM push_subs WHERE universe_id = 'u1' AND actor = ? AND revoked_at IS NULL
    ORDER BY id LIMIT 50`).bind(who.actor).all()).results || [];
  const over = live.filter((r) => r.id !== id).slice(0, Math.max(0, live.length - PUSH_SUBS_PER_ACTOR));
  for (const r of over) {
    await env.DB.prepare("UPDATE push_subs SET revoked_at = ?, revoked_why = 'cap' WHERE id = ? AND revoked_at IS NULL").bind(t, r.id).run();
  }
  await audit(env.DB, who, { action: "push_subscribe", target_kind: "push_sub", target_id: String(id), after: { platform: allowed.platform } });
  return jsonR({ subscribed: true, platform: allowed.platform }, found ? 200 : 201);
}

async function unsubscribe(env, request, auth, body, now) {
  if (typeof body.endpoint !== "string" || !body.endpoint || body.endpoint.length > ENDPOINT_MAX) return jsonR({ error: "endpoint required" }, 400);
  const who = await whoForMobile(auth, request);
  const found = await env.DB.prepare("SELECT id, actor, revoked_at FROM push_subs WHERE endpoint = ?").bind(body.endpoint).first();
  if (!found || found.actor !== who.actor) return jsonR({ error: "not found" }, 404);
  if (found.revoked_at === null) {
    await env.DB.prepare("UPDATE push_subs SET revoked_at = ?, revoked_why = 'user' WHERE id = ? AND revoked_at IS NULL").bind(iso(now), found.id).run();
    await audit(env.DB, who, { action: "push_unsubscribe", target_kind: "push_sub", target_id: String(found.id) });
  }
  return jsonR({ unsubscribed: true });
}

// Queues a test notification; the cron's push stage sends it (no network call here).
async function queueTest(env, request, auth, now) {
  const who = await whoForMobile(auth, request);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM push_tests WHERE actor = ? AND created_at >= ?")
    .bind(who.actor, utcDayStart(now)).first())?.n || 0;
  if (n >= PUSH_TESTS_PER_DAY) return jsonR({ error: `${PUSH_TESTS_PER_DAY} tests a day` }, 429);
  await env.DB.prepare("INSERT INTO push_tests (universe_id, actor, created_at, status) VALUES ('u1', ?, ?, 'pending')").bind(who.actor, iso(now)).run();
  return jsonR({ queued: true }, 202);
}

// pushRoute(name, request, env, url, auth, { now }) for a ROUTES entry with push: name.
// auth is portalAuth's result and is already ok.
export async function pushRoute(name, request, env, url, auth, { now = Date.now() } = {}) {
  const person = auth?.ok === true && auth.via === "access" && typeof auth.email === "string" && auth.email.trim() !== "";
  if (!person) return jsonR({ error: "push needs an Access sign-in" }, 403);
  if (!pushOn(env)) return jsonR({ error: "push is off" }, 404);
  try {
    if (name === "key") return jsonR({ public_key: env.VAPID_PUBLIC_KEY });
    if (!sameOrigin(request, url)) return jsonR({ error: "forbidden" }, 403);
    const read = await readJsonBody(request);
    if (read.status === 415) return jsonR({ error: "content-type must be application/json" }, 415);
    if (read.status === 413) return jsonR({ error: "body too large" }, 413);
    if (!read.body) return jsonR({ error: "body must be a JSON object" }, 400);
    if (name === "subscribe") return await subscribe(env, request, auth, read.body, now);
    if (name === "unsubscribe") return await unsubscribe(env, request, auth, read.body, now);
    if (name === "test") return await queueTest(env, request, auth, now);
    return jsonR({ error: "not found" }, 404);
  } catch {
    console.error("push route failed", name);
    return jsonR({ error: "push unavailable" }, 500);
  }
}
