// Fetches the opening text of new items so the grader reads the release, not
// just the headline. Runs on the cron after ingest, a few items per tick.
// Transient failures (429, 5xx, timeouts) and SEC items without a configured
// contact email are retried with backoff; other outcomes are final.
import { nowIso, isHttpUrl } from "./lib.js";

const PER_TICK = 18;
const CONCURRENCY = 6;            // Workers allows 6 simultaneous outbound connections
const MAX_BYTES = 600_000;
const MAX_TEXT_INPUT = 300_000;   // cap what the HTML-to-text pass ever sees
const EXCERPT_CHARS = 2500;
const MIN_BODY_CHARS = 200;
const MAX_TRIES = 4;
const RETRY_MINUTES = [20, 120, 720];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…", reg: "®", trade: "™", copy: "©" };
const DROP_BLOCKS = ["script", "style", "noscript", "svg", "nav", "footer", "iframe", "head", "aside", "template"];

// Removes <tag ...>...</tag> blocks with indexOf scans (linear time; no
// backtracking regex). Unclosed blocks are removed to the end of the input.
function dropBlocks(html, tags) {
  let out = html;
  for (const tag of tags) {
    const lower = out.toLowerCase();
    const open = `<${tag}`, close = `</${tag}`;
    let res = "", pos = 0;
    for (;;) {
      let i = lower.indexOf(open, pos);
      // require a tag boundary after the name (<nav> or <nav ...>, not <navbar>)
      while (i !== -1 && /[a-z0-9-]/.test(lower[i + open.length] || "")) i = lower.indexOf(open, i + 1);
      if (i === -1) { res += out.slice(pos); break; }
      res += out.slice(pos, i) + " ";
      const j = lower.indexOf(close, i + open.length);
      if (j === -1) { pos = out.length; break; }
      const end = lower.indexOf(">", j);
      pos = end === -1 ? out.length : end + 1;
    }
    out = res;
  }
  return out;
}

// Removes <!-- ... --> comments in linear time (an unclosed one runs to the end).
function dropComments(html) {
  let res = "", pos = 0;
  for (;;) {
    const i = html.indexOf("<!--", pos);
    if (i === -1) return res + html.slice(pos);
    res += html.slice(pos, i) + " ";
    const j = html.indexOf("-->", i + 4);
    if (j === -1) return res;
    pos = j + 3;
  }
}

function decodeEntity(m, name) {
  if (name[0] === "#") {
    const cp = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  }
  return ENTITIES[name.toLowerCase()] ?? m;
}

export function htmlToText(html) {
  return dropBlocks(dropComments(String(html || "").slice(0, MAX_TEXT_INPUT)), DROP_BLOCKS)
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// The first <h1> heading, as text (article pages put the headline there).
export function firstHeading(html) {
  const m = /<h1\b[^>]*>([\s\S]{0,600}?)<\/h1>/i.exec(String(html || "").slice(0, MAX_TEXT_INPUT));
  return m ? htmlToText(m[1]) : "";
}

// Starts the excerpt where the article starts: the <h1> if present, else the
// first occurrence of the headline's opening words, else the top of the text.
export function excerptFrom(text, title, heading = "") {
  const anchors = [heading, title].filter(Boolean);
  let start = -1;
  for (const a of anchors) {
    const words = String(a).replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
    if (words.length < 2) continue;
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+(?:\\w+\\W+){0,2}"), "i");
    const m = re.exec(text);
    if (m) { start = m.index; break; }
  }
  return text.slice(Math.max(0, start), Math.max(0, start) + EXCERPT_CHARS).trim();
}

function charsetOf(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || "");
  if (fromHeader) return fromHeader[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head || "");
  return fromMeta ? fromMeta[1] : "utf-8";
}

function decode(buf, label) {
  try { return new TextDecoder(label).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

const RETRYABLE = (status) => status === "skipped_sec_needs_contact" || status === "http_429" || /^http_5\d\d$/.test(status) || status.startsWith("error");

async function fetchExcerpt(env, item) {
  if (!isHttpUrl(item.url)) return { status: "skipped_bad_url" };
  const url = new URL(item.url);
  if (/\.(pdf|xlsx?|docx?|zip)$/i.test(url.pathname)) return { status: "skipped_binary" };
  const isSec = /(^|\.)sec\.gov$/i.test(url.hostname);
  if (isSec && !env.CONTACT_EMAIL) return { status: "skipped_sec_needs_contact" };
  const ua = isSec ? `zenith-core ${env.CONTACT_EMAIL}` : "zenith-core/1.0 (research feed)";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), 9000); // starts when this fetch starts
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
    const head = new TextDecoder("latin1").decode(buf.subarray(0, 4096));
    const html = decode(buf, charsetOf(type, head));
    const excerpt = excerptFrom(htmlToText(html), item.title, firstHeading(html));
    return excerpt.length >= MIN_BODY_CHARS ? { status: "ok", excerpt } : { status: "skipped_empty" };
  } catch (e) {
    return { status: String(e).includes("timeout") ? "error_timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function enrich(env) {
  const now = nowIso();
  const rows = (await env.DB.prepare(
    `SELECT id, url, title, excerpt_tries FROM items
      WHERE excerpt_status IS NULL AND state IN ('pending','claimed') AND (excerpt_next_at IS NULL OR excerpt_next_at <= ?)
      ORDER BY nm_first_seen DESC LIMIT ?`,
  ).bind(now, PER_TICK).all()).results || [];
  const results = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const part = rows.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(part.map((item) => fetchExcerpt(env, item).then((r) => ({ item, ...r })))));
  }
  const stmts = results.map(({ item, status, excerpt }) => {
    const tries = (item.excerpt_tries || 0) + 1;
    if (RETRYABLE(status) && tries < MAX_TRIES) {
      // Leave excerpt_status NULL so it is picked up again after the backoff.
      const wait = RETRY_MINUTES[Math.min(tries - 1, RETRY_MINUTES.length - 1)];
      return env.DB.prepare("UPDATE items SET excerpt_tries = ?, excerpt_next_at = ? WHERE id = ?")
        .bind(tries, nowIso(Date.now() + wait * 60_000), item.id);
    }
    return env.DB.prepare("UPDATE items SET excerpt = ?, excerpt_status = ?, excerpt_tries = ? WHERE id = ?")
      .bind(excerpt || null, status, tries, item.id);
  });
  if (stmts.length) await env.DB.batch(stmts);
  const ok = results.filter((r) => r.status === "ok").length;
  return { tried: results.length, ok, retry: results.filter((r) => RETRYABLE(r.status)).length, at: now };
}
