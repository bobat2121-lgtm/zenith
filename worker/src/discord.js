// Discord webhook client and message formatting shared by the Lead push, the
// briefs and ops alerts. Webhook URLs are secrets: never log or echo them.
import { isHttpUrl } from "./lib.js";

export const SUPPRESS_EMBEDS = 1 << 2;
export const MAX_CONTENT = 1990; // Discord's content limit is 2000 characters

// Builds the execute (POST ?wait=true) or edit (PATCH /messages/<id>) URL,
// keeping any query the owner put on the webhook (e.g. thread_id).
export function webhookUrl(raw, { messageId = null } = {}) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (messageId) u.pathname = `${u.pathname.replace(/\/+$/, "")}/messages/${encodeURIComponent(messageId)}`;
  else u.searchParams.set("wait", "true");
  return u.toString();
}

// Posts (or, with messageId, edits) one message. Never throws.
// Returns { ok, id, status, error, retryAfter }.
export async function discordSend(webhook, payload, { messageId = null, fetchImpl = globalThis.fetch } = {}) {
  const url = webhookUrl(webhook, { messageId });
  if (!url) return { ok: false, status: 0, error: "webhook is not an https URL" };
  const body = JSON.stringify({ allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS, ...payload });
  let r;
  try {
    r = await fetchImpl(url, { method: messageId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body });
  } catch (e) {
    return { ok: false, status: 0, error: `network: ${String(e?.message || e).slice(0, 160)}` };
  }
  if (r.status === 429) {
    let retryAfter = 5;
    try { retryAfter = Number((await r.json()).retry_after) || 5; } catch { /* keep default */ }
    return { ok: false, status: 429, retryAfter, error: "rate limited" };
  }
  if (!r.ok) {
    let text = "";
    try { text = (await r.text()).replace(/\s+/g, " ").slice(0, 160); } catch { /* ignore */ }
    return { ok: false, status: r.status, error: `http ${r.status} ${text}`.trim() };
  }
  let id = messageId;
  if (!messageId) {
    try { id = String((await r.json())?.id || "") || null; } catch { id = null; }
  }
  return { ok: true, status: r.status, id };
}

// Posts several messages in order; stops at the first failure.
export async function discordSendAll(webhook, contents, opts = {}) {
  const ids = [];
  for (const content of contents) {
    const res = await discordSend(webhook, { content }, opts);
    if (!res.ok) return { ok: false, ids, error: res.error, status: res.status };
    ids.push(res.id);
  }
  return { ok: true, ids };
}

export const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// Untrusted text (titles, why lines) shown as literal text: markdown,
// masked links, mentions and channel references are neutralised.
export function escapeMd(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().replace(/([\\*_~`|>\[\]()#<@])/g, "\\$1")
    .replace(/^([-+])(?=\s)/, "\\$1").replace(/^(\d+)\.(?=\s)/, "$1\\."); // a leading "- " or "1. " would start a list
}

// A link Discord shows without a preview card; only http(s) URLs.
export function link(url) {
  if (!isHttpUrl(url)) return "";
  return `<${String(url).replace(/[\s<>]/g, (c) => encodeURIComponent(c))}>`;
}

// Splits lines into messages under the content limit (a line longer than the
// limit is cut).
export function splitMessages(lines, max = MAX_CONTENT) {
  const out = [];
  let cur = "";
  for (let line of lines) {
    if (line.length > max) line = `${line.slice(0, max - 1)}…`;
    if (cur && cur.length + 1 + line.length > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

export function fmtUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2).replace(/\.?0+$/, "")}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

// "$111.1M · 24% of base · source not read" for a grade row.
export function figures(g) {
  const parts = [];
  if (g.magnitude_usd != null) parts.push(fmtUsd(g.magnitude_usd));
  if (g.magnitude_pct != null && Number.isFinite(Number(g.magnitude_pct))) {
    const p = Number(g.magnitude_pct);
    parts.push(`${Math.abs(p) >= 10 ? Math.round(p) : Number(p.toFixed(1))}% of base`);
  }
  if (g.read_source === 0) parts.push("source not read");
  return parts.join(" · ");
}

export const bandName = (band) => ({ lead: "Lead", digest: "Digest", borderline: "Borderline", reject: "Reject", duplicate: "Duplicate" })[band] || String(band || "");
