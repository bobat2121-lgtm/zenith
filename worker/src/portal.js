// Portal (phase 3): the router for /p/* and /s/*, served by zenith-core.
//   /s/*            public install files (portal-static.js), no auth
//   /p/login        sign-in form (GET) and POST sign-in, session mode only
//   /p/logout       POST, clears the session (Access mode: the Access logout)
//   everything else under /p goes through the one gate (portal-auth.js portalAuth)
//   before any route is looked at, so an unauthenticated probe learns nothing.
// Every path the portal serves is listed in ROUTES; a part that adds a path adds
// its ROUTES entry in the same change, and the auth walk (test/portal-auth.test.js)
// sweeps every entry without credentials. A view is
// async (vctx) -> { title, active, body, status? }, see portal-stub.js.
// Handlers that live in index.js, tuning.js or auxiliary.js arrive through deps
// (feedback, auxFeedback, tickers, muted, ctx), so no portal module imports them.
import { portalAuth, portalMode, whoForPortal, mintSession, sessionSetCookie, sessionClearCookie, createPairing, redeemPairing } from "./portal-auth.js";
import { sameOrigin, parseLabelBody } from "./mobile.js";
import { tokenMatches } from "./lib.js";
import { fmtEt } from "./et.js";
import { html, safeReturn, TICKER_RE } from "./portal-html.js";
import { page, htmlResponse, messagePage, errorPage, newNonce, portalHeaders } from "./portal-shell.js";
import { staticResponse } from "./portal-static.js";
import { stub, companiesIndex } from "./portal-stub.js";
import { todayView } from "./portal-today.js";

// One line per view; each later part replaces its own line (and adds one import).
export const VIEWS = {
  today: todayView,
  companies: companiesIndex,
  company: stub("company"),
  competitors: stub("competitors"),
  industry: stub("industry"),
  rare: stub("rare"),
  search: stub("search"),
  brief: stub("brief"),
};

// Every path the portal serves: { method, path } plus how it is handled. A path
// ending in "/:ticker" matches one more path segment.
export const ROUTES = [
  { method: "GET", path: "/p", redirect: "today" },
  { method: "GET", path: "/p/today", view: "today" },
  { method: "GET", path: "/p/c", view: "companies" },
  { method: "GET", path: "/p/c/:ticker", view: "company" },
  { method: "GET", path: "/p/competitors", view: "competitors" },
  { method: "GET", path: "/p/industry", view: "industry" },
  { method: "GET", path: "/p/rare", view: "rare" },
  { method: "GET", path: "/p/search", view: "search" },
  { method: "GET", path: "/p/brief", view: "brief" },
  { method: "POST", path: "/p/api/feedback", api: "coverage" },
  { method: "POST", path: "/p/api/aux-feedback", api: "aux" },
  { method: "GET", path: "/p/login", open: "login" },
  { method: "POST", path: "/p/login", open: "login" },
  { method: "POST", path: "/p/logout", open: "logout" },
  { method: "GET", path: "/p/pair", pair: true },
  { method: "POST", path: "/p/pair", pair: true },
];
const pathOf = (key) => ROUTES.find((r) => r.view === key || r.open === key).path;
const TODAY = () => pathOf("today");
const LOGIN = () => pathOf("login");
const ACCESS_LOGOUT = "/cdn-cgi/access/logout";

function matchRoutes(path) {
  const hits = [];
  for (const r of ROUTES) {
    const i = r.path.indexOf("/:");
    if (i < 0) {
      if (r.path === path) hits.push({ r, param: null });
      continue;
    }
    const base = r.path.slice(0, i + 1);
    const rest = path.startsWith(base) ? path.slice(base.length) : "";
    if (rest && !rest.includes("/")) hits.push({ r, param: rest });
  }
  return hits;
}

// --- Responses ----------------------------------------------------------------------
const jsonP = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: portalHeaders(null, { "content-type": "application/json; charset=utf-8", ...extra }) });
const forbiddenJson = () => jsonP({ error: "forbidden" }, 403);
const redirect = (location, status = 303, extra = {}) => new Response(null, { status, headers: portalHeaders(null, { location, ...extra }) });
const notFound = () => messagePage("Not found", "Not found.", 404);
const notAllowed = (allow) => messagePage("Not allowed", "Method not allowed.", 405, { extra: { allow } });
const unsupported = () => jsonP({ error: "content-type must be application/json or application/x-www-form-urlencoded" }, 415);

// A handler's JSON response with the portal headers added.
async function withPortalHeaders(res) {
  const headers = portalHeaders(null, { "content-type": res.headers.get("content-type") || "application/json; charset=utf-8" });
  return new Response(await res.text(), { status: res.status, headers });
}

const contentType = (request) => {
  const t = (request.headers.get("content-type") || "").toLowerCase();
  if (t.startsWith("application/json")) return "json";
  if (t.startsWith("application/x-www-form-urlencoded")) return "form";
  return null;
};

async function readBody(request, kind) {
  try {
    const raw = kind === "form" ? Object.fromEntries(await request.formData()) : await request.json();
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

// --- View counter -------------------------------------------------------------------
// client from the User-Agent, classified here and discarded: phone (iPhone, or
// Android with Mobile), phone_home (a phone opened from the home-screen icon,
// src=home), tablet (iPad, other Android), desktop (anything else).
export function clientClass(ua, url) {
  const s = String(ua || "");
  if (/iPhone/.test(s) || (/Android/.test(s) && /Mobile/.test(s))) return url?.searchParams?.get("src") === "home" ? "phone_home" : "phone";
  if (/iPad|Android/.test(s)) return "tablet";
  return "desktop";
}

let countWarned = false;
// One portal_views upsert per successful GET render. Never throws; a zenith-db
// without the table (before its migration) only logs once per isolate.
export async function countView(env, { view, client, via, now = Date.now() }) {
  try {
    const t = new Date(now).toISOString();
    await env.DB.prepare(
      `INSERT INTO portal_views (universe_id, day, view, client, via, n, first_at, last_at) VALUES ('u1', ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (universe_id, day, view, client, via) DO UPDATE SET n = n + 1, last_at = excluded.last_at`,
    ).bind(t.slice(0, 10), view, client, via, t, t).run();
  } catch {
    if (!countWarned) { countWarned = true; console.warn("portal view count unavailable"); }
  }
}

function scheduleCount(env, deps, entry) {
  const p = countView(env, entry);
  if (deps.ctx && typeof deps.ctx.waitUntil === "function") { deps.ctx.waitUntil(p); return null; }
  return p;
}

// --- Sign-in, sign-out and pairing ----------------------------------------------------
function loginPage(status = 200, note = "") {
  const nonce = newNonce();
  const body = html`${note ? html`<p role="alert">${note}</p>` : ""}
<form class="signin" method="post" action="${LOGIN()}"><label>App token <input type="password" name="token" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>
<h2>Or a pairing code</h2>
<form class="signin" method="post" action="${LOGIN()}"><label>Pairing code <input type="text" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" required></label><button type="submit">Sign in</button></form>
<p class="empty">Make a pairing code on a device that is already signed in (Pair a device).</p>`;
  return htmlResponse(page({ title: "Sign in", body, nonce, bare: true }), nonce, status);
}

async function login(request, env, url, mode, now) {
  if (mode !== "session") return notFound();
  if (request.method === "GET" || request.method === "HEAD") return loginPage();
  if (request.method !== "POST") return notAllowed("GET, HEAD, POST");
  if (!sameOrigin(request, url)) return loginPage(403, "Not signed in.");
  if (contentType(request) !== "form") return messagePage("Sign in", "Not signed in: send the sign-in form.", 415);
  const form = await readBody(request, "form");
  const token = typeof form?.token === "string" ? form.token : "";
  const code = typeof form?.code === "string" ? form.code : "";
  const ok = (token && tokenMatches(token, env.APP_TOKEN)) || (!token && code && (await redeemPairing(env, code, now)));
  if (!ok) return loginPage(403, "Not signed in.");
  return redirect(TODAY(), 303, { "set-cookie": sessionSetCookie(await mintSession(env, now)) });
}

function logout(request, url, mode) {
  if (request.method !== "POST") return notAllowed("POST");
  if (mode === "off" || !sameOrigin(request, url)) return forbiddenJson();
  if (mode === "access") return redirect(ACCESS_LOGOUT, 303);
  return redirect(LOGIN(), 303, { "set-cookie": sessionClearCookie() });
}

async function pair(request, env, url, auth, deps, now) {
  if (auth.mode !== "session") return notFound();
  const nonce = newNonce();
  const done = (body) => htmlResponse(page({ title: "Pair a device", active: "", body, nonce, mode: auth.mode }), nonce);
  if (request.method !== "POST") {
    const res = done(html`<p>A pairing code signs in one more device (for example this phone's home-screen app). It works once, for 10 minutes.</p>
<form class="pair" method="post" action="${ROUTES.find((x) => x.pair).path}"><button type="submit">Make a pairing code</button></form>`);
    const p = scheduleCount(env, deps, { view: "pair", client: clientClass(request.headers.get("user-agent"), url), via: auth.via, now });
    if (p) await p;
    return res;
  }
  if (!sameOrigin(request, url)) return forbiddenJson();
  if (contentType(request) !== "form") return unsupported();
  try {
    const { code, expires_at } = await createPairing(env, now);
    return done(html`<p>Enter this code on the other device's sign-in page:</p><p class="code">${code.slice(0, 5)} ${code.slice(5)}</p>
<p>Valid until ${fmtEt(expires_at, { day: false })}, one use.</p>`);
  } catch {
    console.error("portal view failed", "pair");
    return errorPage();
  }
}

// --- Labels -------------------------------------------------------------------------
// Aux labels pass the fields POST /v1/aux/feedback reads, unchanged, so both routes
// answer every body alike (auxiliary.js auxFeedback validates).
const auxLabelBody = (raw) => {
  const body = { item_id: raw.item_id, label: raw.label };
  if (raw.note !== undefined) body.note = raw.note;
  if (raw.reason !== undefined) body.reason = raw.reason;
  return body;
};

async function label(kind, request, url, auth, deps) {
  if (!sameOrigin(request, url)) return forbiddenJson();
  const type = contentType(request);
  if (!type) return unsupported();
  const raw = await readBody(request, type);
  if (!raw) return type === "form" ? messagePage("Not saved", "Not saved: unreadable form.", 400) : jsonP({ error: "body must be JSON" }, 400);
  let body;
  if (kind === "coverage") {
    const parsed = parseLabelBody(raw);
    if (parsed.error) return type === "form" ? messagePage("Not saved", `Not saved: ${parsed.error}.`, 400) : jsonP({ error: parsed.error }, 400);
    body = parsed.body;
  } else {
    body = auxLabelBody(raw);
  }
  const handler = kind === "coverage" ? deps.feedback : deps.auxFeedback;
  if (typeof handler !== "function") return jsonP({ error: "feedback unavailable" }, 500);
  let res;
  try {
    res = await handler(body, await whoForPortal(auth, request));
  } catch {
    console.error("portal view failed", kind === "coverage" ? "feedback" : "aux-feedback");
    return type === "form" ? errorPage() : jsonP({ error: "not saved" }, 500);
  }
  if (type === "json") return withPortalHeaders(res);
  if (res.ok) return redirect(safeReturn(raw.return), 303);
  let err = `HTTP ${res.status}`;
  try { err = (await res.json()).error || err; } catch { /* keep */ }
  return messagePage("Not saved", `Not saved: ${err}`, res.status, { link: [safeReturn(raw.return), "Back"] });
}

// --- Views --------------------------------------------------------------------------
async function renderView(name, request, env, url, auth, deps, now) {
  const view = VIEWS[name];
  const nonce = newNonce();
  let res;
  try {
    const vctx = { env, url, request, auth, who: await whoForPortal(auth, request), tickers: deps.tickers || [], muted: deps.muted, now, nonce };
    const out = await view(vctx);
    const status = out?.status || 200;
    const doc = page({ title: out?.title, active: out?.active ?? name, body: out?.body, nonce, mode: auth.mode });
    res = htmlResponse(request.method === "HEAD" ? null : doc, nonce, status);
  } catch {
    console.error("portal view failed", name);
    return errorPage();
  }
  if (res.status === 200) {
    const p = scheduleCount(env, deps, { view: name, client: clientClass(request.headers.get("user-agent"), url), via: auth.via, now });
    if (p) await p;
  }
  return res;
}

// --- Router -------------------------------------------------------------------------
// deps: { feedback(body, who), auxFeedback(body, who), tickers, muted, ctx, now?, fetchImpl? }
export async function portal(request, env, url, deps = {}) {
  if (url.pathname.startsWith("/s/")) return staticResponse(request, url);
  const now = typeof deps.now === "function" ? deps.now() : Date.now();
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 2) path = path.replace(/\/+$/, "");
  const mode = portalMode(env);
  const hits = matchRoutes(path);

  const open = hits.find((h) => h.r.open)?.r.open;
  if (open === "login") return login(request, env, url, mode, now);
  if (open === "logout") return logout(request, url, mode);

  const isGet = request.method === "GET" || request.method === "HEAD";
  const auth = await portalAuth(request, env, url, { now, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  if (!auth.ok) {
    if (!isGet) return forbiddenJson();
    if (auth.mode === "session") return redirect(LOGIN(), 303);
    return messagePage("Not signed in", auth.mode === "access" ? "This portal needs an Access sign-in." : "The portal is off.", 403);
  }

  if (!hits.length) return notFound();
  const method = request.method === "HEAD" ? "GET" : request.method;
  const hit = hits.find((h) => h.r.method === method);
  if (!hit) {
    const allow = [...new Set(hits.flatMap((h) => (h.r.method === "GET" ? ["GET", "HEAD"] : [h.r.method])))].join(", ");
    return notAllowed(allow);
  }
  const { r, param } = hit;

  if (r.redirect) return redirect(pathOf(r.redirect), 302);
  if (r.pair) return pair(request, env, url, auth, deps, now);
  if (r.api) return label(r.api, request, url, auth, deps);
  if (r.view === "companies" && url.searchParams.has("t")) {
    const t = String(url.searchParams.get("t") || "").trim().toUpperCase();
    if (!TICKER_RE.test(t) || !(deps.tickers || []).includes(t)) return notFound();
    return redirect(`${pathOf("company").slice(0, -":ticker".length)}${encodeURIComponent(t)}`, 302);
  }
  if (r.view === "company" && (!TICKER_RE.test(param || "") || !(deps.tickers || []).includes(param))) return notFound();
  return renderView(r.view, request, env, url, auth, deps, now);
}
