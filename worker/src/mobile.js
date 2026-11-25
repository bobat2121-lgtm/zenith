// Phone page: GET /m shows recent items by band with one-tap labels; labels go
// by POST /m/feedback only (never GET: Discord fetches links to preview them),
// using the POST /v1/feedback body (item_id, label, note, optional ticker).
// Auth: a valid Cloudflare Access JWT (Cf-Access-Jwt-Assertion, checked against
// ACCESS_TEAM_DOMAIN's JWKS and ACCESS_AUD) or the APP_TOKEN bearer; anything
// else gets 403, so the page is inert until one of them is configured.
// Strict CSP: one nonce'd inline script and style, no external resources, no
// inline event handlers. Titles and grader text are escaped as untrusted.
import { json, tokenMatches, isHttpUrl, universeSql, HELD_SQL } from "./lib.js";
import { fmtEt, fmtAge } from "./et.js";

export const MOBILE_LABELS = [
  ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["noise", "Noise"], ["too_high", "Too high"], ["too_low", "Too low"],
];
const BANDS = [["lead", "Lead"], ["digest", "Digest"], ["borderline", "Borderline"], ["waiting", "Waiting for a grade"], ["reject", "Reject"]];
const JWKS_TTL_MS = 10 * 60_000;

// --- Cloudflare Access JWT -----------------------------------------------------------

function b64urlBytes(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

// "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com" -> origin.
export function teamOrigin(domain) {
  const d = String(domain || "").trim().replace(/\/+$/, "");
  if (!d) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(d) ? d : `https://${d}`);
    return u.protocol === "https:" ? u.origin : null;
  } catch { return null; }
}

const jwksCache = new Map(); // origin -> { keys, at, forcedAt }
export function clearJwksCache() { jwksCache.clear(); }

async function jwks(origin, { now, fetchImpl, force = false }) {
  const hit = jwksCache.get(origin);
  if (hit && !force && now - hit.at < JWKS_TTL_MS) return hit.keys;
  if (hit && force && now - (hit.forcedAt || 0) < 60_000) return hit.keys; // at most one forced refetch a minute
  try {
    const r = await fetchImpl(`${origin}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } });
    if (!r.ok) return hit?.keys || [];
    const keys = (await r.json())?.keys || [];
    jwksCache.set(origin, { keys, at: now, forcedAt: force ? now : hit?.forcedAt || 0 });
    return keys;
  } catch {
    return hit?.keys || [];
  }
}

// Returns the JWT's claims when it is a valid Access token for this app, else null.
export async function verifyAccessJwt(token, env, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const origin = teamOrigin(env.ACCESS_TEAM_DOMAIN);
  if (!origin || !env.ACCESS_AUD || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { return null; }
  if (header?.alg !== "RS256" || !header.kid) return null;
  let jwk = (await jwks(origin, { now, fetchImpl })).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await jwks(origin, { now, fetchImpl, force: true })).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return null; }
  if (!ok) return null;
  const t = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp < t - 30) return null;
  if (typeof claims.nbf === "number" && claims.nbf > t + 30) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== origin) return null;
  return claims;
}

// { ok, via: "token" | "access", email }
export async function authorizeMobile(request, env, opts = {}) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (env.APP_TOKEN && tokenMatches(bearer, env.APP_TOKEN)) return { ok: true, via: "token" };
  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (jwt) {
    const claims = await verifyAccessJwt(jwt, env, opts);
    if (claims) return { ok: true, via: "access", email: claims.email || null };
  }
  return { ok: false };
}

// --- Page --------------------------------------------------------------------------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const SECURITY = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // same-origin, not no-referrer: under no-referrer a native form POST carries
  // "Origin: null", which the same-origin check below would refuse. Item links
  // to other sites still get no referrer.
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const csp = (nonce) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

function forbidden() {
  return new Response("forbidden\n", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY } });
}

function nonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "");
}

// universe: the covered tickers (deps.tickers). Items of a ticker dropped from
// coverage are not shown; without a list (a misconfigured caller) nothing is hidden.
async function pageRows(db, { days, ticker, unlabeled, now, universe }) {
  // Held rows (waiting for the daily grading budget, budget.js) are not shown.
  const where = ["i.nm_first_seen >= ?", "i.state != 'skipped'", `NOT ${HELD_SQL("i.")}`, "(g.band IS NULL OR g.band != 'duplicate')"];
  const binds = [new Date(now - days * 86_400_000).toISOString()];
  if (universe?.length) where.push(`COALESCE(g.ticker, i.ticker) IN ${universeSql(universe)}`);
  if (ticker) { where.push("i.ticker = ?"); binds.push(ticker); }
  if (unlabeled) where.push("NOT EXISTS (SELECT 1 FROM feedback f WHERE f.item_id = i.id)");
  return (await db.prepare(
    `SELECT i.id AS item_id, i.ticker, i.title, i.url, i.source_key, i.role, i.state, i.nm_first_seen,
            g.ticker AS grade_ticker, g.score, g.band, g.why, g.note_hook, g.read_source, g.event_type,
            (SELECT label FROM feedback f WHERE f.item_id = i.id ORDER BY f.id DESC LIMIT 1) AS label
       FROM items i LEFT JOIN grades g ON g.id = i.grade_id
      WHERE ${where.join(" AND ")}
      ORDER BY CASE g.band WHEN 'lead' THEN 0 WHEN 'digest' THEN 1 WHEN 'borderline' THEN 2 WHEN 'reject' THEN 4 ELSE 3 END,
               g.score DESC, i.id DESC
      LIMIT 250`,
  ).bind(...binds).all()).results || [];
}

function card(r, now) {
  const title = isHttpUrl(r.url)
    ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title);
  const score = r.score == null ? "" : `<span class="score">${esc(r.score)}</span>`;
  const meta = [r.role ? `${esc(r.role)} source` : "", esc(r.source_key), `${esc(fmtAge(now - Date.parse(r.nm_first_seen)))} ago`,
    r.read_source === 0 ? "source not read" : ""].filter(Boolean).join(" · ");
  const buttons = MOBILE_LABELS.map(([v, t]) => `<button type="submit" name="label" value="${v}"${r.label === v ? ' class="on"' : ""}>${t}</button>`).join("");
  return `<article class="card" id="i${esc(r.item_id)}">
<div class="top"><span class="tk">${esc(r.ticker)}</span>${score}${r.event_type ? `<span class="ev">${esc(r.event_type)}</span>` : ""}</div>
<h3>${title}</h3>
${r.why ? `<p class="why">${esc(r.why)}</p>` : ""}${r.note_hook ? `<p class="hook">${esc(r.note_hook)}</p>` : ""}
<p class="meta">${meta}</p>
<form class="lbl" method="post" action="/m/feedback" data-item="${esc(r.item_id)}" data-ticker="${esc(r.grade_ticker || r.ticker)}">
<button type="submit" class="nodefault" disabled hidden tabindex="-1" aria-hidden="true"></button>
<input type="hidden" name="item_id" value="${esc(r.item_id)}"><input type="hidden" name="ticker" value="${esc(r.grade_ticker || r.ticker)}">
<input type="text" name="note" maxlength="500" placeholder="Why it matters (optional)" autocomplete="off">
<div class="btns">${buttons}</div>
<p class="status" aria-live="polite">${r.label ? `Labelled ${esc(r.label.replace("_", " "))}` : ""}</p>
</form>
</article>`;
}

const STYLE = `
:root{color-scheme:dark;--bg:#000;--fg:#e7e9ea;--mut:#8b9298;--line:#2f3336;--red:#f4212e;--card:#0d0f10}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;background:#000d;backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:10px 16px;z-index:2}
header h1{margin:0;font-size:18px}header nav{margin-top:6px;display:flex;gap:12px;flex-wrap:wrap;font-size:13px}
a{color:var(--fg)}header nav a{color:var(--mut);text-decoration:none}header nav a.on{color:var(--red);font-weight:600}
main{padding:0 16px 40px;max-width:720px;margin:0 auto}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:22px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}
.top{display:flex;gap:8px;align-items:center;font-size:13px}.tk{font-weight:700}.score{background:var(--red);color:#fff;border-radius:6px;padding:0 6px;font-weight:700}
.ev{color:var(--mut)}h3{font-size:15px;margin:6px 0}h3 a{text-decoration:none}.why{margin:4px 0}.hook{margin:4px 0;color:var(--mut);font-style:italic}
.meta{margin:4px 0;color:var(--mut);font-size:12px}form.lbl input[type=text]{width:100%;margin:6px 0;padding:8px;border-radius:8px;border:1px solid var(--line);background:#000;color:var(--fg);font-size:14px}
.btns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.btns button{padding:10px 4px;border-radius:8px;border:1px solid var(--line);background:#16181a;color:var(--fg);font-size:14px}
.btns button.on{border-color:var(--red);color:var(--red);font-weight:600}form.busy{opacity:.5}.status{margin:6px 0 0;font-size:12px;color:var(--mut)}
details summary{cursor:pointer;color:var(--mut);margin:22px 0 8px}.empty{color:var(--mut)}`;

// Progressive enhancement: label without a page reload. Without JS the form
// posts natively and the server redirects back. Each form's first submit
// button is a disabled placeholder, so Enter in the note field labels nothing.
const SCRIPT = `
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.classList || !form.classList.contains("lbl")) return;
  const btn = e.submitter;
  if (!btn || !btn.value) return;
  e.preventDefault();
  const status = form.querySelector(".status");
  const note = form.querySelector("input[name=note]").value.trim();
  const body = { item_id: Number(form.dataset.item), label: btn.value, ticker: form.dataset.ticker || undefined };
  if (note) body.note = note;
  form.classList.add("busy");
  try {
    const r = await fetch("/m/feedback", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    form.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    status.textContent = "Labelled " + btn.textContent.toLowerCase();
    form.querySelector("input[name=note]").value = "";
  } catch (err) {
    status.textContent = "Not saved: " + err.message;
  } finally {
    form.classList.remove("busy");
  }
});`;

export function renderPage(rows, { days, ticker, unlabeled, now = Date.now(), nonce: n, tickers = [] }) {
  const groups = Object.fromEntries(BANDS.map(([b]) => [b, []]));
  for (const r of rows) groups[r.band && groups[r.band] ? r.band : r.state === "graded" ? "reject" : "waiting"].push(r);
  const q = (o) => {
    const p = new URLSearchParams();
    const v = { days, ticker, unlabeled, ...o };
    if (v.days !== 3) p.set("days", v.days);
    if (v.ticker) p.set("ticker", v.ticker);
    if (v.unlabeled) p.set("unlabeled", "1");
    const s = p.toString();
    return esc(`/m${s ? `?${s}` : ""}`);
  };
  const nav = [
    ...[1, 3, 7].map((d) => `<a href="${q({ days: d })}"${d === days ? ' class="on"' : ""}>${d}d</a>`),
    `<a href="${q({ unlabeled: !unlabeled })}"${unlabeled ? ' class="on"' : ""}>unlabelled</a>`,
    ticker ? `<a href="${q({ ticker: "" })}">all tickers</a>` : "",
  ].join("");
  const tickerNav = tickers.length ? `<nav>${tickers.map((t) => `<a href="${q({ ticker: t })}"${t === ticker ? ' class="on"' : ""}>${esc(t)}</a>`).join("")}</nav>` : "";
  const sections = BANDS.map(([b, name]) => {
    const list = groups[b];
    const inner = list.length ? list.map((r) => card(r, now)).join("\n") : `<p class="empty">None.</p>`;
    if (b === "reject") return `<details><summary>${name} (${list.length})</summary>${inner}</details>`;
    return `<h2>${name} (${list.length})</h2>${inner}`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Zenith feed</title><style nonce="${n}">${STYLE}</style></head>
<body><header><h1>Zenith</h1><nav>${nav}</nav>${tickerNav}</header>
<main><p class="meta">Updated ${esc(fmtEt(now))}. Labels: high 80-100, medium 60-89, low 30-69, noise 0-29; too high / too low say the grade missed.</p>
${sections}</main><script nonce="${n}">${SCRIPT}</script></body></html>`;
}

function htmlResponse(body, n, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp(n), ...SECURITY } });
}

function messagePage(text, status) {
  const n = nonce();
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenith</title></head><body><p>${esc(text)}</p><p><a href="/m">Back</a></p></body></html>`, n, status);
}

// A cookie-authenticated (Access) POST must come from this origin. "Origin: null"
// (an opaque origin, or a page served with a no-referrer policy) proves nothing,
// so it falls back to Sec-Fetch-Site like a missing header.
export function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") return origin === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

// deps.feedback(body) -> Response: the POST /v1/feedback handler.
export async function mobile(request, env, url, deps = {}) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/m" && path !== "/m/feedback") return new Response("not found\n", { status: 404, headers: SECURITY });
  const auth = await authorizeMobile(request, env, deps);
  if (!auth.ok) return forbidden();
  const now = Date.now();

  if (path === "/m") {
    if (request.method !== "GET") return new Response("method not allowed\n", { status: 405, headers: { allow: "GET", ...SECURITY } });
    const q = url.searchParams;
    const days = Math.max(1, Math.min(14, Number(q.get("days")) || 3));
    const ticker = /^[A-Z.]{1,8}$/.test((q.get("ticker") || "").toUpperCase()) ? q.get("ticker").toUpperCase() : "";
    const unlabeled = q.get("unlabeled") === "1";
    const rows = await pageRows(env.DB, { days, ticker, unlabeled, now, universe: deps.tickers });
    const n = nonce();
    return htmlResponse(renderPage(rows, { days, ticker, unlabeled, now, nonce: n, tickers: deps.tickers || [] }), n);
  }

  if (request.method !== "POST") return new Response("method not allowed\n", { status: 405, headers: { allow: "POST", ...SECURITY } });
  if (auth.via === "access" && !sameOrigin(request, url)) return forbidden();
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const isForm = type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");
  let raw = null;
  try { raw = isForm ? Object.fromEntries(await request.formData()) : await request.json(); } catch { raw = null; }
  if (!raw || typeof raw !== "object") return isForm ? messagePage("Not saved: unreadable form.", 400) : json({ error: "body must be JSON" }, 400);
  const body = { item_id: Number(raw.item_id), label: String(raw.label || "").toLowerCase() };
  if (raw.note && String(raw.note).trim()) body.note = String(raw.note).trim().slice(0, 1000);
  if (raw.ticker && /^[A-Za-z.]{1,8}$/.test(String(raw.ticker))) body.ticker = String(raw.ticker).toUpperCase();
  if (!MOBILE_LABELS.some(([v]) => v === body.label)) {
    const msg = `label must be one of ${MOBILE_LABELS.map(([v]) => v).join(", ")}`;
    return isForm ? messagePage(`Not saved: ${msg}.`, 400) : json({ error: msg }, 400);
  }
  if (typeof deps.feedback !== "function") return json({ error: "feedback unavailable" }, 500);
  const res = await deps.feedback(body);
  if (!isForm) return res;
  if (res.ok) {
    return new Response(null, { status: 303, headers: { location: `/m#i${Number.isInteger(body.item_id) ? body.item_id : ""}`, ...SECURITY } });
  }
  let err = `HTTP ${res.status}`;
  try { err = (await res.json()).error || err; } catch { /* keep */ }
  return messagePage(`Not saved: ${err}`, res.status);
}
