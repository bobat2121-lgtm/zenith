// Portal (phase 3): the page template, nav, CSS, the inline label script, the
// security headers and the generic error page. The shell holds no data: views
// hand it a title and a body built with portal-html.js `html`.
import { html, raw } from "./portal-html.js";
import { ICON_COLOR } from "./portal-icons.generated.js";

// [view key, label, href]. The phone tab bar shows the first two, Search and Brief,
// and a "More" menu with the rest.
export const NAV = [
  ["today", "Today", "/p/today"],
  ["companies", "Companies", "/p/c"],
  ["competitors", "Competitors", "/p/competitors"],
  ["industry", "Industry", "/p/industry"],
  ["rare", "Rare finds", "/p/rare"],
  ["search", "Search", "/p/search"],
  ["brief", "Brief", "/p/brief"],
];
const TABS = ["today", "companies", "search", "brief"];

export const PORTAL_CSP = (nonce) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'`;

// Headers on every /p response (HTML or JSON); the CSP only when there is a nonce.
export function portalHeaders(nonce, extra = {}) {
  return {
    ...(nonce ? { "content-security-policy": PORTAL_CSP(nonce) } : {}),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "x-robots-tag": "noindex, nofollow",
    "strict-transport-security": "max-age=31536000",
    ...extra,
  };
}

export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "");
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#14181c;--mut:#5b6470;--line:#d9dde3;--card:#fff;--acc:#1f4f99;--accfg:#fff;--on:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--fg:#e7e9ea;--mut:#9aa3ad;--line:#2b3036;--card:#14171b;--acc:#8fb3ff;--accfg:#0b0d10;--on:#ff8a80}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;overflow-x:hidden}
a{color:var(--acc)}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.top-bar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));background:var(--bg);border-bottom:1px solid var(--line)}
.top-bar .brand{font-weight:700;text-decoration:none;color:var(--fg)}.top-bar h1{font-size:17px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side{display:none}
main{padding:12px 16px 96px;max-width:1100px}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:3;display:flex;justify-content:space-around;background:var(--card);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.tabs a,.tabs summary{display:flex;align-items:center;justify-content:center;min-height:48px;min-width:44px;padding:0 8px;font-size:13px;color:var(--mut);text-decoration:none;list-style:none;cursor:pointer}
.tabs summary::-webkit-details-marker{display:none}
.tabs [aria-current]{color:var(--acc);font-weight:600}
.tabs details{position:relative}.tabs details[open] .more{position:absolute;bottom:52px;right:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px;min-width:160px}
.tabs .more a{justify-content:flex-start}
@media (min-width:900px){
 body{display:grid;grid-template-columns:200px minmax(0,1fr)}
 .top-bar{grid-column:2}.side{display:block;grid-row:1/span 3;position:sticky;top:0;height:100vh;padding:16px;border-right:1px solid var(--line)}
 .side a{display:flex;align-items:center;min-height:40px;padding:0 10px;border-radius:8px;color:var(--fg);text-decoration:none}
 .side a[aria-current]{background:var(--card);color:var(--acc);font-weight:600}
 main{grid-column:2;padding:16px 24px 40px}.tabs{display:none}footer{grid-column:2}
}
footer{padding:16px;color:var(--mut);font-size:13px;padding-bottom:96px}footer form{display:inline}
footer button{background:none;border:0;color:var(--acc);font:inherit;padding:0;min-height:44px;cursor:pointer;text-decoration:underline}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0;max-width:760px}
.card .top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}.tk{font-weight:700;color:var(--fg)}
.score{background:var(--acc);color:var(--accfg);border-radius:6px;padding:0 6px;font-weight:700}.band,.ev,.badge{color:var(--mut)}
.badge{border:1px solid var(--line);border-radius:6px;padding:0 6px}
.card h3{font-size:15px;margin:6px 0;overflow-wrap:anywhere}.card h3 a{color:var(--fg);text-decoration:none}
.why{margin:4px 0;overflow-wrap:anywhere}.hook{margin:4px 0;color:var(--mut);font-style:italic}.meta{margin:4px 0;color:var(--mut);font-size:12px;overflow-wrap:anywhere}
form.lbl input[type=text]{width:100%;margin:6px 0;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:16px}
.btns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.btns button{min-height:44px;padding:6px 4px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:14px}
.btns button.on{border-color:var(--on);color:var(--on);font-weight:600}form.busy{opacity:.5}.status{margin:6px 0 0;font-size:12px;color:var(--mut)}
.range{margin:8px 0 12px}.presets{display:flex;flex-wrap:wrap;gap:4px 12px}.presets a{display:inline-flex;align-items:center;min-height:44px;color:var(--mut)}
.presets a[aria-current]{color:var(--acc);font-weight:600}.range summary{min-height:44px;display:flex;align-items:center;color:var(--mut);cursor:pointer}
.dates{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.dates input,.dates button,.signin input,.signin button,.pair button{min-height:44px;font-size:16px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.signin{display:grid;gap:10px;max-width:360px}.signin label{display:grid;gap:4px}.empty{color:var(--mut)}
.code{font:600 28px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}
ul.names{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 14px}ul.names a{display:inline-flex;min-height:44px;align-items:center}
`;

// Labels without a page reload (progressive enhancement). Without JavaScript the
// label form posts natively and the server answers 303 to the form's return path.
// Each form's first submit button is a disabled placeholder, so Enter in the note
// field labels nothing. XMLHttpRequest, JSON body, same origin only.
const SCRIPT = `
document.addEventListener("submit", function (e) {
  var form = e.target;
  if (!form.classList || !form.classList.contains("lbl")) return;
  var btn = e.submitter;
  if (!btn || !btn.value) return;
  e.preventDefault();
  var status = form.querySelector(".status");
  var noteEl = form.querySelector("input[name=note]");
  var note = noteEl.value.trim();
  var body = { item_id: Number(form.dataset.item), label: btn.value };
  if (form.dataset.ticker) body.ticker = form.dataset.ticker;
  if (note) body.note = note;
  form.classList.add("busy");
  var x = new XMLHttpRequest();
  x.open("POST", form.dataset.endpoint);
  x.setRequestHeader("content-type", "application/json");
  x.onload = function () {
    var j = {};
    try { j = JSON.parse(x.responseText); } catch (_) {}
    if (x.status >= 200 && x.status < 300) {
      form.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === btn); });
      status.textContent = "Labelled " + btn.textContent.toLowerCase();
      noteEl.value = "";
    } else {
      status.textContent = "Not saved: " + (j.error || ("HTTP " + x.status));
    }
    form.classList.remove("busy");
  };
  x.onerror = function () { status.textContent = "Not saved: network error"; form.classList.remove("busy"); };
  x.send(JSON.stringify(body));
});
// Lead alerts (web push, Part E). Inert unless the page holds the panel, which the
// Brief view renders only while push is on and the viewer signed in through Access.
(function () {
  var panel = document.querySelector("[data-push-panel]");
  if (!panel) return;
  var status = panel.querySelector(".push-status");
  var say = function (t) { status.textContent = t; };
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (ios && !standalone) panel.querySelector(".push-home").hidden = false;
  if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) { say("This browser cannot receive Lead alerts."); return; }
  var keyBytes = function (s) {
    var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    return Uint8Array.from(atob(t), function (c) { return c.charCodeAt(0); });
  };
  var post = function (path, body) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open("POST", path);
      x.setRequestHeader("content-type", "application/json");
      x.onload = function () { var j = {}; try { j = JSON.parse(x.responseText); } catch (_) {} resolve({ status: x.status, body: j }); };
      x.onerror = function () { resolve({ status: 0, body: {} }); };
      x.send(JSON.stringify(body));
    });
  };
  var why = function (res) { return res.body.error || ("HTTP " + res.status); };
  var actions = {
    on: function () {
      return Notification.requestPermission().then(function (p) {
        if (p !== "granted") { say("Notifications are not allowed for Zenith on this device."); return null; }
        return navigator.serviceWorker.register("/s/sw.js", { scope: "/p/" }).then(function () { return navigator.serviceWorker.ready; })
          .then(function (reg) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(panel.dataset.key) }); })
          .then(function (sub) { return post("/p/api/push/subscribe", sub.toJSON()); })
          .then(function (res) { say(res.status === 200 || res.status === 201 ? "Lead alerts are on for this device." : "Not turned on: " + why(res)); });
      });
    },
    test: function () {
      return post("/p/api/push/test", {}).then(function (res) { say(res.status === 202 ? "A test will arrive within 5 minutes." : "No test queued: " + why(res)); });
    },
    off: function () {
      return navigator.serviceWorker.getRegistration("/p/").then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).then(function (sub) {
        if (!sub) { say("Lead alerts are off for this device."); return null; }
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () { return post("/p/api/push/unsubscribe", { endpoint: endpoint }); })
          .then(function () { say("Lead alerts are off for this device."); });
      });
    },
  };
  panel.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("button[data-push]") : null;
    if (!b || !actions[b.dataset.push]) return;
    b.disabled = true;
    Promise.resolve().then(actions[b.dataset.push]).catch(function () { say("That did not work on this device."); }).then(function () { b.disabled = false; });
  });
})();`;

const navLink = (active) => ([key, label, href]) => html`<a href="${href}"${key === active ? html` aria-current="page"` : ""}>${label}</a>`;

function footer(mode) {
  if (mode === "access") return html`<footer>Signed in through Access</footer>`;
  if (mode === "session") {
    return html`<footer>Signed in on this device · <form method="post" action="/p/logout"><button type="submit">Sign out</button></form> · <a href="/p/pair">Pair a device</a></footer>`;
  }
  return "";
}

// page({ title, active, body, nonce, mode, bare }) -> the full HTML document.
// bare: no nav and no footer (the sign-in page, error pages).
export function page({ title, active = "", body, nonce, mode = "", bare = false }) {
  const tabs = NAV.filter(([k]) => TABS.includes(k));
  const more = NAV.filter(([k]) => !TABS.includes(k));
  const moreOpen = more.some(([k]) => k === active);
  return `<!doctype html>${html`<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${ICON_COLOR}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0d10" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/s/manifest.webmanifest" crossorigin="use-credentials">
<link rel="apple-touch-icon" href="/s/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Zenith">
<title>${title ? `${title} · Zenith` : "Zenith"}</title>
<style nonce="${nonce}">${raw(STYLE)}</style></head>
<body>${bare ? "" : html`<nav class="side" aria-label="Sections">${NAV.map(navLink(active))}</nav>`}
<header class="top-bar"><a class="brand" href="/p/today">Zenith</a><h1>${title || ""}</h1></header>
<main>${body}</main>
${bare ? "" : html`${footer(mode)}<nav class="tabs" aria-label="Sections">${tabs.map(navLink(active))}<details${moreOpen ? html` open` : ""}><summary${
    moreOpen ? html` aria-current="page"` : ""}>More</summary><div class="more">${more.map(navLink(active))}</div></details></nav>`}
<script nonce="${nonce}">${raw(SCRIPT)}</script></body></html>`}`;
}

export function htmlResponse(doc, nonce, status = 200, extra = {}) {
  return new Response(doc, { status, headers: portalHeaders(nonce, { "content-type": "text/html; charset=utf-8", ...extra }) });
}

// A short message page (sign-in failures, 403, 404, 405). Fixed text only.
export function messagePage(title, text, status, { link = null, extra = {} } = {}) {
  const nonce = newNonce();
  const body = html`<p>${text}</p>${link ? html`<p><a href="${link[0]}">${link[1]}</a></p>` : ""}`;
  return htmlResponse(page({ title, body, nonce, bare: true }), nonce, status, extra);
}

// The generic 500: fixed text, never the error.
export function errorPage(nonce = newNonce()) {
  return htmlResponse(page({ title: "Error", body: html`<p>Something went wrong. Try again.</p>`, nonce, bare: true }), nonce, 500);
}
