// Fetches the opening text of new items so the grader reads the release, not
// just the headline. Runs on the cron after ingest, a few items per tick.
import { nowIso } from "./lib.js";

const PER_TICK = 16;
const MAX_BYTES = 700_000;
const EXCERPT_CHARS = 2500;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…", reg: "®", trade: "™", copy: "©" };

export function htmlToText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Starts the excerpt where the article starts (the first occurrence of the
// headline's opening words), falling back to the top of the page text.
export function excerptFrom(text, title) {
  const words = String(title || "").replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  let start = 0;
  if (words.length >= 2) {
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+(?:\\w+\\W+){0,2}"), "i");
    const m = re.exec(text);
    if (m) start = m.index;
  }
  return text.slice(start, start + EXCERPT_CHARS).trim();
}

async function fetchExcerpt(env, item) {
  let url;
  try { url = new URL(item.url); } catch { return { status: "skipped_bad_url" }; }
  if (!/^https?:$/.test(url.protocol)) return { status: "skipped_bad_url" };
  if (/\.(pdf|xlsx?|docx?|zip)$/i.test(url.pathname)) return { status: "skipped_binary" };
  const isSec = /(^|\.)sec\.gov$/i.test(url.hostname);
  if (isSec && !env.CONTACT_EMAIL) return { status: "skipped_sec_needs_contact" };
  const ua = isSec ? `zenith-core ${env.CONTACT_EMAIL}` : "zenith-core/1.0 (research feed)";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), 9000);
  try {
    const r = await fetch(url.toString(), { headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) return { status: `http_${r.status}` };
    const type = r.headers.get("content-type") || "";
    if (!/html|xml|text/i.test(type)) return { status: "skipped_content_type" };
    const reader = r.body.getReader();
    const chunks = []; let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    try { await reader.cancel(); } catch {}
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    const html = new TextDecoder().decode(buf);
    const excerpt = excerptFrom(htmlToText(html), item.title);
    return excerpt.length >= 80 ? { status: "ok", excerpt } : { status: "skipped_empty" };
  } catch (e) {
    return { status: String(e).includes("timeout") ? "error_timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function enrich(env) {
  const rows = (await env.DB.prepare(
    "SELECT id, url, title FROM items WHERE excerpt_status IS NULL AND state IN ('pending','claimed') ORDER BY nm_first_seen DESC LIMIT ?",
  ).bind(PER_TICK).all()).results || [];
  const results = await Promise.all(rows.map((item) => fetchExcerpt(env, item).then((r) => ({ id: item.id, ...r }))));
  if (results.length) {
    await env.DB.batch(results.map((r) => env.DB.prepare("UPDATE items SET excerpt = ?, excerpt_status = ? WHERE id = ?").bind(r.excerpt || null, r.status, r.id)));
  }
  const ok = results.filter((r) => r.status === "ok").length;
  return { tried: results.length, ok, at: nowIso() };
}
