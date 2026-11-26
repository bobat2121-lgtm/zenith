// Portal (phase 3): escaping and the shared fragments every view builds with.
// Rules for every portal*.js module:
//   - Build markup only with the `html` tagged template. Each interpolation is
//     escaped unless it is a SafeHtml value, which only `html` itself and `raw()`
//     make. `raw()` takes shell-owned constants only (a test scans its arguments).
//   - Untrusted text (titles, excerpts, why, notes, source keys, tickers and
//     entity names from the database) goes only into element text or quoted
//     attribute values: never into <script>, <style>, an event-handler
//     attribute, style= or an unquoted attribute. No JSON is embedded in HTML;
//     forms carry ids in data-* attributes and hidden inputs.
//   - Links: safeHref (http and https only), tickerHref (/p/c/<T> for a
//     well-formed ticker only), safeReturn (a /p/ path only).
// Imports only mobile.js, lib.js and et.js (the portal import rule, S18).
import { esc as mobileEsc, MOBILE_LABELS } from "./mobile.js";
import { isHttpUrl } from "./lib.js";
import { etParts, etToUtc, addDays, fmtDay, fmtAge } from "./et.js";

export const esc = mobileEsc;

class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const isSafeHtml = (v) => v instanceof SafeHtml;

// Marks a shell-owned constant (CSS, the inline script) as markup.
export function raw(s) { return new SafeHtml(String(s)); }

function part(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

// The URL when it is http(s), else null (rendered as plain text by callers).
export const safeHref = (u) => (typeof u === "string" && isHttpUrl(u) ? u : null);

export const tickerHref = (t) => (typeof t === "string" && TICKER_RE.test(t) ? `/p/c/${encodeURIComponent(t)}` : null);

// A same-site return path for a native form POST: a /p/ path, else /p/today.
export function safeReturn(s) {
  const v = typeof s === "string" ? s : "";
  if (!/^\/p\/[A-Za-z0-9._~/?=&%#-]{0,200}$/.test(v)) return "/p/today";
  if (v.includes("//") || v.includes("\\") || /%(0d|0a|5c)/i.test(v)) return "/p/today";
  // No "." or ".." segment and no encoded "/" (plain or percent-encoded) in the path part,
  // so the target cannot leave /p/. The query may hold anything above.
  const path = v.split(/[?#]/, 1)[0];
  if (/%2f/i.test(path) || /(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path)) return "/p/today";
  return v;
}

// --- Date range ---------------------------------------------------------------------
// range=today (from 00:00 America/New_York), 24h, 3d, 7d, 14d, 30d, 90d, 1y, or a custom
// start=YYYY-MM-DD&end=YYYY-MM-DD (ET dates, inclusive). A key or span longer than the
// caller's maxDays is neither offered nor accepted; anything malformed falls back to def.
const DAY = 86_400_000;
export const RANGE_PRESETS = [
  ["today", 1, "Today"], ["24h", 1, "24 h"], ["3d", 3, "3 days"], ["7d", 7, "7 days"], ["14d", 14, "14 days"],
  ["30d", 30, "30 days"], ["90d", 90, "90 days"], ["1y", 365, "1 year"],
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d) => DATE_RE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

function preset(key, now, maxDays) {
  const p = RANGE_PRESETS.find(([k]) => k === key);
  if (!p || p[1] > maxDays) return null;
  const [k, days, label] = p;
  const from = k === "today" ? etToUtc(etParts(now).date) : now - days * DAY;
  return { key: k, fromIso: new Date(from).toISOString(), toIso: new Date(now).toISOString(), label, days, maxDays };
}

// parseRange(url, { now, def, maxDays }) -> { key, fromIso, toIso (exclusive), label, days, maxDays, start?, end? }
export function parseRange(url, { now = Date.now(), def = "today", maxDays = 30 } = {}) {
  const q = url.searchParams;
  const fallback = () => preset(def, now, maxDays) || preset("today", now, Math.max(1, maxDays));
  const start = q.get("start"), end = q.get("end");
  if (start !== null || end !== null) {
    if (!validDate(start || "") || !validDate(end || "")) return fallback();
    const today = etParts(now).date;
    if (end < start || end > today) return fallback();
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
    if (days > maxDays) return fallback();
    const label = start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
    return { key: "custom", fromIso: new Date(etToUtc(start)).toISOString(), toIso: new Date(etToUtc(addDays(end, 1))).toISOString(),
      label, days, maxDays, start, end };
  }
  return preset(q.get("range") || def, now, maxDays) || fallback();
}

// keep: other query parameters the links and the form carry ({ name: value }).
function rangeHref(basePath, keep, extra) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(keep || {})) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return `${basePath}${s ? `?${s}` : ""}`;
}

// rangeControl(range, basePath, maxDays) or rangeControl(range, basePath, keep) or
// rangeControl(range, basePath, maxDays, keep): preset links plus a small GET form
// with two date fields. Works with JavaScript off.
export function rangeControl(range, basePath, maxDaysOrKeep, keepArg) {
  const keep = typeof maxDaysOrKeep === "object" && maxDaysOrKeep !== null ? maxDaysOrKeep : keepArg || {};
  const maxDays = typeof maxDaysOrKeep === "number" ? maxDaysOrKeep : range?.maxDays || 30;
  const links = RANGE_PRESETS.filter(([, days]) => days <= maxDays).map(([key, , label]) => html`<a href="${rangeHref(basePath, keep, { range: key })}"${
    range?.key === key ? html` aria-current="true"` : ""}>${label}</a>`);
  const hidden = Object.entries(keep).filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`);
  return html`<div class="range"><nav class="presets" aria-label="Date range">${links}</nav>
<details${range?.key === "custom" ? html` open` : ""}><summary>${range?.key === "custom" ? range.label : "Pick dates"}</summary>
<form method="get" action="${basePath}" class="dates">${hidden}<label>From <input type="date" name="start" value="${range?.start || ""}" required></label>
<label>To <input type="date" name="end" value="${range?.end || ""}" required></label><button type="submit">Show</button></form></details></div>`;
}

// --- Cards --------------------------------------------------------------------------
// itemCard(row, { kind, now, extra, returnTo }):
//   kind "coverage": row has id (or item_id), ticker, grade_ticker, title, url, score, band,
//     event_type, why, note_hook, role, source_key, nm_first_seen, read_source, label.
//     The label form posts to /p/api/feedback with the grade's ticker.
//   kind "aux": row has id (or item_id), entity_name (or entity), title, url, score, band,
//     event_type, why, source_key, nm_first_seen, label. The form posts to /p/api/aux-feedback.
//   extra: { badges: [string], meta: [string] }, plain strings (escaped).
//   returnTo: where a native form POST lands afterwards (safeReturn; default /p/today).
export function itemCard(row, { kind = "coverage", now = Date.now(), extra = {}, returnTo = "/p/today" } = {}) {
  const aux = kind === "aux";
  const id = Number(row.item_id ?? row.id);
  const itemId = Number.isInteger(id) ? id : "";
  const href = safeHref(row.url);
  const title = row.title || row.headline || "(untitled)";
  const shownTicker = row.grade_ticker || row.ticker || "";
  const tHref = aux ? null : tickerHref(shownTicker);
  const name = aux ? (row.entity_name || row.entity || "") : shownTicker;
  const seen = Date.parse(row.nm_first_seen || "");
  const meta = [
    !aux && row.role ? `${row.role} source` : "",
    row.source_key || "",
    Number.isFinite(seen) ? `${fmtAge(now - seen)} ago` : "",
    row.read_source === 0 ? "source not read" : "",
    ...(Array.isArray(extra.meta) ? extra.meta : []),
  ].filter((s) => typeof s === "string" && s !== "");
  const badges = (Array.isArray(extra.badges) ? extra.badges : []).filter((s) => typeof s === "string" && s !== "");
  const endpoint = aux ? "/p/api/aux-feedback" : "/p/api/feedback";
  const label = typeof row.label === "string" ? row.label : "";
  const buttons = MOBILE_LABELS.map(([v, t]) => html`<button type="submit" name="label" value="${v}"${label === v ? html` class="on"` : ""}>${t}</button>`);
  return html`<article class="card${aux ? " aux" : ""}" id="${aux ? "a" : "i"}${itemId}">
<div class="top">${tHref ? html`<a class="tk" href="${tHref}">${name}</a>` : html`<span class="tk">${name}</span>`}${
  row.score === null || row.score === undefined ? "" : html`<span class="score">${row.score}</span>`}${
  row.band ? html`<span class="band">${row.band}</span>` : ""}${row.event_type ? html`<span class="ev">${row.event_type}</span>` : ""}${
  badges.map((b) => html`<span class="badge">${b}</span>`)}</div>
<h3>${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h3>
${row.why ? html`<p class="why">${row.why}</p>` : ""}${!aux && row.note_hook ? html`<p class="hook">${row.note_hook}</p>` : ""}
<p class="meta">${meta.join(" · ")}</p>
<form class="lbl" method="post" action="${endpoint}" data-endpoint="${endpoint}" data-item="${itemId}"${aux ? "" : html` data-ticker="${shownTicker}"`}>
<button type="submit" class="nodefault" disabled hidden tabindex="-1" aria-hidden="true"></button>
<input type="hidden" name="item_id" value="${itemId}">${aux ? "" : html`<input type="hidden" name="ticker" value="${shownTicker}">`}<input type="hidden" name="return" value="${safeReturn(returnTo)}">
<input type="text" name="note" maxlength="500" placeholder="Why it matters (optional)" autocomplete="off" aria-label="Note">
<div class="btns">${buttons}</div>
<p class="status" aria-live="polite">${label ? `Labelled ${label.replace("_", " ")}` : ""}</p>
</form>
</article>`;
}
