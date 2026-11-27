// Phase 3 Part E (PR-E4): the web push service worker, served at /s/sw.js with
// scope /p/ (portal-static.js), and only while pushOn(env) is true; otherwise
// /s/sw.js is 404. It is public code and holds no data.
//   push                    shows the notification (a payload that does not parse
//                           still shows "Zenith · new Lead": userVisibleOnly)
//   notificationclick       opens or focuses the payload's url only when it is a
//                           same-origin path under /p/, else /p/today
//   pushsubscriptionchange  re-subscribes with the key from GET /p/api/push/key and
//                           POSTs the new subscription (best effort; needs a live
//                           Access sign-in)
// It has no fetch handler and never touches Cache Storage, so a /p/ response is
// never cached by it. Its two requests run in the browser, not in the Worker;
// they go through the browser's own fetch, named `http` below.
export const SW_PATH = "/s/sw.js";
export const SW_SCOPE = "/p/";

export const SW_SOURCE = `"use strict";
var http = self.fetch.bind(self);
var FALLBACK_TITLE = "Zenith \\u00b7 new Lead";
function safePath(u) {
  return typeof u === "string" && /^\\/p\\/[A-Za-z0-9._~%\\/?=&#-]*$/.test(u) && u.indexOf("//") === -1 ? u : "/p/today";
}
function keyBytes(s) {
  var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), function (c) { return c.charCodeAt(0); });
}
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  if (!d || typeof d !== "object") d = {};
  var title = typeof d.title === "string" && d.title ? d.title : FALLBACK_TITLE;
  var opts = { body: typeof d.body === "string" ? d.body : "", data: { url: safePath(d.url) } };
  if (typeof d.tag === "string" && d.tag) opts.tag = d.tag;
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = safePath(e.notification.data && e.notification.data.url);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i !== list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        return c.focus().then(function (w) { return w && "navigate" in w ? w.navigate(url) : w; });
      }
    }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener("pushsubscriptionchange", function (e) {
  e.waitUntil(http("/p/api/push/key", { credentials: "include" }).then(function (r) { return r.json(); }).then(function (j) {
    return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(j.public_key) });
  }).then(function (sub) {
    return http("/p/api/push/subscribe", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  }).catch(function () {}));
});
`;
