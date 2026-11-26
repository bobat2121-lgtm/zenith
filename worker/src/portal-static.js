// Portal (phase 3): the public install files under /s/ (manifest and icons). A
// fixed allow-list: any other /s/ path is 404. No auth, no data, never a cookie.
// They sit outside /p/ because browsers fetch the manifest without credentials
// unless the link says use-credentials; they are public code either way.
// /s/sw.js is reserved for the web-push service worker (Part E) and is 404 here.
import { ICONS, ICON_COLOR } from "./portal-icons.generated.js";

const iconUrl = (name) => `/s/${name}?v=${ICONS[name].sha8}`;

export const MANIFEST = Object.freeze({
  name: "Zenith",
  short_name: "Zenith",
  id: "/p/",
  start_url: "/p/today?src=home",
  scope: "/p/",
  display: "standalone",
  background_color: ICON_COLOR,
  theme_color: ICON_COLOR,
  icons: [
    { src: iconUrl("icon-192.png"), sizes: "192x192", type: "image/png" },
    { src: iconUrl("icon-512.png"), sizes: "512x512", type: "image/png" },
    { src: iconUrl("icon-mask-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

const b64bytes = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const IMMUTABLE = "public, max-age=604800, immutable";
export const STATIC = Object.freeze({
  "/s/manifest.webmanifest": Object.freeze({ type: "application/manifest+json", body: JSON.stringify(MANIFEST), cache: "public, max-age=86400" }),
  ...Object.fromEntries(Object.keys(ICONS).map((name) => [`/s/${name}`, Object.freeze({ type: "image/png", body: b64bytes(ICONS[name].b64), cache: IMMUTABLE })])),
});

const BASE = { "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" };

export function staticResponse(request, url) {
  const hit = Object.prototype.hasOwnProperty.call(STATIC, url.pathname) ? STATIC[url.pathname] : null;
  if (!hit) return new Response("not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...BASE } });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed\n", { status: 405, headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...BASE } });
  }
  return new Response(request.method === "HEAD" ? null : hit.body, { status: 200, headers: { "content-type": hit.type, "cache-control": hit.cache, ...BASE } });
}
