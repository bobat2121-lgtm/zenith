// Phase 2: exact-key story dedup (stage 0 of staged grading). Before the
// grader sees a row, the ingests decide in code, with no model, whether the
// row is a second copy of a story Zenith already holds. A copy that matches
// on an exact key is stored skipped 'story_dup', linked to its first copy
// (story_of) and kept out of the claim. It is never deleted, never takes a
// budget slot, and the owner can still force it to be graded (Left out).
// Soft signals (news-monitor's fuzzy fingerprint, exact token sets,
// filing-to-release) are never used to hold anything.
//
// Keys (migration 0019). story_key is the strongest exact key a row has:
//   sec:<acc>                SEC accession (the excerpt.js filing-folder rule)
//   piid:<PIID>-<mod>        FPDS award and modification (an fpds.gov URL fragment)
//   lgs:<host>:<matter>#<f>  Legistar matter plus its fragment (a #vote- row is its own story)
//   t:<hash>                 exact normalised title, scoped by ticker (coverage) or entity (aux)
// On coverage every hard key is prefixed with the ticker, so one record routed
// to two tickers is held under neither. url_key (aux only) is the hash of the
// canonical URL. A register source (REGISTER_KEY), an official record, an SEC
// row and a templated source never get a title key; a register source gets no
// URL key either, so a register reading is never held as a copy of another.
//
// This file is pure apart from two D1 helpers (findCanonicals, storyBackfill).
// No fetch, and nothing from delivery.js or discord.js.
import COVERED from "./covered.json";
import { isSecItem, isHttpUrl, nowIso } from "./lib.js";
import { isOfficialRecord, isRegisterSource } from "./records.js";

// The grader's own "recent" window for duplicates (grader/GRADER.md).
export const STORY_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
// Register sources: never a title or URL key, whatever their catalog flags
// (the URL key also skips every catalog register, records.js isRegisterSource).
export const REGISTER_KEY = /^(lda_|txdmv)/;
// Sources whose titles are templates: one title, many different records.
export const TEMPLATED_KEY = /^(wargov_contracts|fpds_|legistar_)/;
// Titles that name a kind of notice, not a story. Tested against normTitle.
export const BOILERPLATE = /\b(inside information|article 17|regulation \(?eu\)?|voting rights|transaction in own shares|pdmr|notice of (annual|extraordinary|general)|press release|form 8 k|annual general meeting|monthly update|weekly update)\b/;
export const TITLE_MIN_CHARS = 12;
export const TITLE_MIN_WORDS = 3;

// The copies switch: Worker secret STORY_DEDUP. "off" writes keys and holds
// or swaps nothing (the GATE_FAST_CAP=0 pattern); anything else is on.
export const storyDedupOn = (env) => String(env?.STORY_DEDUP ?? "").trim().toLowerCase() !== "off";

// Case, punctuation and curly quotes folded; leading [TAG] groups and one
// leading (note) dropped. Digits, $, % and . are kept, and a " - Publisher"
// suffix is not stripped, so two orders of different size never match.
export function normTitle(t) {
  let s = String(t || "").normalize("NFKC").replace(/[‘’“”]/g, "'").trim();
  s = s.replace(/^(\[[^\]]{1,40}\]\s*)+/, "");
  s = s.replace(/^\([^)]{1,60}\)\s*/, "");
  return s.toLowerCase().replace(/[^a-z0-9$%.]+/g, " ").replace(/\s+/g, " ").trim();
}

// https, no leading www., no utm_*/fbclid/gclid/mc_* parameters, no trailing
// slash; the fragment is kept (Legistar #vote- and FPDS fragments are records
// of their own). A URL that does not parse is returned as given.
export function canonUrl(u) {
  try {
    const x = new URL(u);
    x.protocol = "https:";
    x.hostname = x.hostname.replace(/^www\./, "");
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) x.searchParams.delete(k);
    return `${x.hostname}${x.pathname.replace(/\/+$/, "")}${x.search}${x.hash}`;
  } catch {
    return String(u ?? "");
  }
}

// --- Hard keys ------------------------------------------------------------------
export function secAccession(url) {
  const m = /sec\.gov\/Archives\/edgar\/data\/(\d+)\/(\d{18})\//.exec(String(url || ""));
  return m ? m[2] : null;
}
export function fpdsPiid(url) {
  const u = String(url || "");
  const m = /#(\d{4})-([A-Z0-9]+)-([A-Z0-9]+)$/.exec(u);
  return /fpds\.gov/i.test(u) && m ? `${m[2]}-${m[3]}` : null;
}
export function legistarMatter(url) {
  const u = String(url || "");
  const m = /^https?:\/\/([a-z0-9-]+)\.legistar\.com\/LegislationDetail\.aspx\?ID=(\d+)/i.exec(u);
  if (!m) return null;
  const frag = (/#([a-z0-9-]+)$/i.exec(u) || [])[1] || "";
  return `${m[1].toLowerCase()}:${m[2]}#${frag}`;
}

// Whether a row may carry a title key: not SEC, not an official record, not a
// register or templated source, and a title of 12+ characters and 3+ words
// that is not boilerplate.
export function titleKeyable(row) {
  const key = String(row?.source_key ?? "");
  if (isSecItem(row) || isOfficialRecord(row) || REGISTER_KEY.test(key) || TEMPLATED_KEY.test(key)) return false;
  const t = normTitle(row?.title);
  return t.length >= TITLE_MIN_CHARS && t.split(" ").length >= TITLE_MIN_WORDS && !BOILERPLATE.test(t);
}

async function hex16(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// { story_key, url_key } for one row. pipeline: "coverage" (scope: ticker)
// or "aux" (scope: entity_key).
export async function storyKeys(row, pipeline) {
  const cov = pipeline === "coverage";
  const scope = cov ? row?.ticker : row?.entity_key;
  const pre = cov ? `${scope}:` : "";
  const url = String(row?.url ?? "");
  let storyKey = null;
  const acc = secAccession(url), piid = fpdsPiid(url), matter = legistarMatter(url);
  if (acc) storyKey = `sec:${pre}${acc}`;
  else if (piid) storyKey = `piid:${pre}${piid}`;
  else if (matter) storyKey = `lgs:${pre}${matter}`;
  else if (scope != null && scope !== "" && titleKeyable(row)) storyKey = `t:${await hex16(`${scope}|${normTitle(row.title)}`)}`;
  // A register's aux row gets no URL key either: REGISTER_KEY by key, or any catalog register (aux-sources.json register: true).
  const key = String(row?.source_key ?? "");
  const urlKey = !cov && isHttpUrl(url) && !REGISTER_KEY.test(key) && !isRegisterSource(key) ? `u:${await hex16(canonUrl(url))}` : null;
  return { story_key: storyKey, url_key: urlKey };
}

// The canonical order (rubric core.md, duplicates): a covered company's own
// release 3, an SEC filing 2, another official record 1, everything else 0.
const ownLane = (key) => Object.prototype.hasOwnProperty.call(COVERED.sources || {}, String(key ?? ""));
export function rankOf(row) {
  const sec = isSecItem(row);
  if (ownLane(row?.source_key) && !sec) return 3;
  if (sec) return 2;
  return isOfficialRecord(row) ? 1 : 0;
}

// Whether the ingest feed fields (ingest.js feedFields) carry text: the
// release itself (status 'feed') or a summary kept as the fallback.
export const hasFeedText = (f) => Boolean((f?.status === "feed" && f?.excerpt) || f?.fallback);

// Pure. row: { nm_rowid, first_seen, rank, has_text, admit } (admit: its own
// gate decision). cands: { id, nm_rowid, nm_first_seen, rank, has_text, held,
// in_batch }. A candidate with the row's own nm_rowid (a catch-up rescan), one
// first seen after the row, or more than windowDays before it, is ignored.
//   hold: a claimable (not held) candidate the row does not outrank, unless
//         the row has feed text and the candidate has none (the text guard).
//         The canonical is the earliest such candidate.
//   swap: no claimable candidate qualifies, the row's gate decision is the
//         fast path, and a held candidate would pass the same tests as a copy
//         of the row (it does not outrank the row; text guard reversed). The
//         row is stored plain and the held candidate becomes its copy.
//   none: otherwise.
export function decideCopy(row, cands, { windowDays = STORY_WINDOW_DAYS } = {}) {
  const seen = Date.parse(row?.first_seen ?? "");
  if (!Number.isFinite(seen)) return { action: "none" };
  const inWindow = (c) => {
    if (c.nm_rowid != null && c.nm_rowid === row.nm_rowid) return false;
    const t = Date.parse(c.nm_first_seen ?? "");
    return Number.isFinite(t) && t <= seen && seen - t <= windowDays * DAY_MS;
  };
  const order = (a, b) => String(a.nm_first_seen).localeCompare(String(b.nm_first_seen)) || (a.nm_rowid ?? 0) - (b.nm_rowid ?? 0);
  const near = (cands || []).filter(inWindow).sort(order);
  const canonical = near.find((c) => !c.held && row.rank <= c.rank && !(row.has_text && !c.has_text));
  if (canonical) return { action: "hold", canonical };
  if (row.admit == null) {
    const held = near.find((c) => c.held && c.rank <= row.rank && !(c.has_text && !row.has_text));
    if (held) return { action: "swap", canonical: held };
  }
  return { action: "none" };
}

// --- D1 helpers -------------------------------------------------------------------
const TABLES = {
  coverage: { table: "items", scope: "ticker" },
  aux: { table: "aux_items", scope: "entity_key" },
};
export const storyTable = (kind) => TABLES[kind] || null;

// The live rows (not skipped, not a copy) of one table that share a story or
// URL key, first seen since `since`, in ONE statement binding 2 (coverage) or
// 3 (aux) parameters, whatever the number of keys (D1 allows 100). anyCopy:
// copies (story_of set) count too (the rescue's live-copy check). Each row
// carries held (admitted, not yet released) and has_text: on coverage the
// excerpt or the feed summary kept as excerpt_fallback (before enrich copies
// it into the excerpt), the same text hasFeedText counts for a row in a batch.
export async function findCanonicals(db, kind, { storyKeys: sk = [], urlKeys: uk = [], since, anyCopy = false }) {
  const t = TABLES[kind];
  const s = [...new Set(sk.filter(Boolean))], u = kind === "aux" ? [...new Set(uk.filter(Boolean))] : [];
  if (!s.length && !u.length) return [];
  const copies = anyCopy ? "" : " AND story_of IS NULL";
  const rows = kind === "aux"
    ? (await db.prepare(
      `SELECT id, nm_rowid, source_key, url, entity_key, admit, released_at, nm_first_seen, (excerpt IS NOT NULL) AS has_text, story_key, url_key
         FROM aux_items WHERE nm_first_seen >= ?3 AND state != 'skipped'${copies}
          AND (story_key IN (SELECT value FROM json_each(?1)) OR url_key IN (SELECT value FROM json_each(?2)))`,
    ).bind(JSON.stringify(s), JSON.stringify(u), since).all()).results || []
    : (await db.prepare(
      `SELECT id, nm_rowid, source_key, url, ticker, admit, released_at, nm_first_seen, (excerpt IS NOT NULL OR excerpt_fallback IS NOT NULL) AS has_text, story_key
         FROM items WHERE nm_first_seen >= ?2 AND state != 'skipped'${copies}
          AND story_key IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(s), since).all()).results || [];
  return rows.map((r) => ({ ...r, has_text: Boolean(r.has_text), held: r.admit != null && r.released_at == null, rank: rankOf(r) }));
}

// Whether candidate c shares a key with keys k.
export const sharesKey = (k, c) => (k.story_key != null && c.story_key === k.story_key) || (k.url_key != null && c.url_key === k.url_key);

// One ingest batch's copy decisions (ingest.js, auxiliary.js scanAux). entries:
// the batch's rows in rowid order, each { r, live, has_text, scope } (live: no
// skip reason on arrival; scope: the row's ticker or entity_key). Keys are
// computed for live rows only, and ONE findCanonicals call covers the batch
// (none when no live row has a key). decide(entry, admit), called in rowid
// order with the row's own gate decision, returns { keys, action, canonical }.
// Every live row that is not held as a copy becomes a candidate for the later
// rows of the batch (in_batch); a swapped held row stops being one. on: the
// STORY_DEDUP switch; off, keys are still returned and nothing is held.
export async function storyPlanner(db, kind, entries, { on = true, windowDays = STORY_WINDOW_DAYS } = {}) {
  const cov = kind === "coverage";
  const keys = new Map();
  for (const e of entries) {
    if (!e.live) continue;
    const row = { source_key: e.r.source_key, url: e.r.url, title: e.r.title, [cov ? "ticker" : "entity_key"]: e.scope };
    keys.set(e.r.nm_rowid, await storyKeys(row, kind));
  }
  const all = [...keys.values()];
  const seen = entries.filter((e) => e.live && Number.isFinite(Date.parse(e.r.first_seen ?? ""))).map((e) => Date.parse(e.r.first_seen));
  const db_cands = on && seen.length && all.some((k) => k.story_key || k.url_key)
    ? await findCanonicals(db, kind, { storyKeys: all.map((k) => k.story_key), urlKeys: all.map((k) => k.url_key),
      since: nowIso(Math.min(...seen) - windowDays * DAY_MS) })
    : [];
  const pool = [...db_cands];
  const gone = new Set();
  return {
    decide(e, admit) {
      const k = keys.get(e.r.nm_rowid) || { story_key: null, url_key: null };
      if (!e.live) return { keys: { story_key: null, url_key: null }, action: "none" };
      if (!on) return { keys: k, action: "none" };
      const rank = rankOf(e.r);
      const cands = pool.filter((c) => !gone.has(c) && sharesKey(k, c));
      const d = decideCopy({ nm_rowid: e.r.nm_rowid, first_seen: e.r.first_seen, rank, has_text: Boolean(e.has_text), admit }, cands, { windowDays });
      if (d.action === "swap") gone.add(d.canonical);
      if (d.action !== "hold") {
        pool.push({ nm_rowid: e.r.nm_rowid, nm_first_seen: e.r.first_seen, rank, has_text: Boolean(e.has_text),
          held: d.action === "none" && admit != null, in_batch: true, ...k });
      }
      return { keys: k, ...d };
    },
  };
}

// The story_of value of a hold, for an INSERT: (?, ?) binds the canonical's
// id, or for an in-batch canonical its nm_rowid (statements run in order and
// nm_rowid is UNIQUE; an ignored canonical INSERT leaves story_of NULL, and
// the daily orphan pass repairs it).
export const storyOfSql = (table) => `COALESCE(?, (SELECT id FROM ${table} WHERE nm_rowid = ?))`;
export const storyOfArgs = (d) => (d.action !== "hold" ? [null, null] : d.canonical.in_batch ? [null, d.canonical.nm_rowid] : [d.canonical.id, null]);
// A swap: after the new canonical's INSERT, its held candidate becomes its
// copy. A row released meanwhile, or an ignored INSERT, leaves it unchanged;
// it frees a held slot and never takes one.
export function swapStatement(db, table, canonicalNmRowid, heldNmRowid) {
  return db.prepare(
    `UPDATE ${table} SET state = 'skipped', skip_reason = 'story_dup', admit = NULL, story_of = (SELECT id FROM ${table} WHERE nm_rowid = ?1)
      WHERE nm_rowid = ?2 AND state = 'pending' AND admit IS NOT NULL AND released_at IS NULL AND EXISTS (SELECT 1 FROM ${table} WHERE nm_rowid = ?1)`,
  ).bind(canonicalNmRowid, heldNmRowid);
}

// POST /v1/admin/story-backfill { kind, after_id = 0, limit 1-300 (300) }:
// writes story_key (and aux url_key) on the live rows (not skipped, no key,
// not a copy) first seen in the last STORY_WINDOW_DAYS days with id > after_id,
// by id. It never sets story_of and never holds anything. Run right after the
// deploy, following next_after_id until done.
export const BACKFILL_MAX_LIMIT = 300;
export async function storyBackfill(env, body, { now = Date.now() } = {}) {
  const kind = body?.kind;
  const t = TABLES[kind];
  if (!t) return { error: "kind must be coverage or aux" };
  const after = Math.max(0, Math.trunc(Number(body?.after_id)) || 0);
  const n = Math.trunc(Number(body?.limit));
  const limit = body?.limit == null || !Number.isFinite(n) ? BACKFILL_MAX_LIMIT : Math.max(1, Math.min(BACKFILL_MAX_LIMIT, n));
  const db = env.DB;
  const rows = (await db.prepare(
    `SELECT id, source_key, ${t.scope}, url, title FROM ${t.table}
      WHERE nm_first_seen >= ?1 AND id > ?2 AND state != 'skipped' AND story_key IS NULL AND story_of IS NULL ORDER BY id LIMIT ?3`,
  ).bind(nowIso(now - STORY_WINDOW_DAYS * DAY_MS), after, limit).all()).results || [];
  const stmts = [];
  for (const r of rows) {
    const k = await storyKeys(r, kind);
    if (!k.story_key && !k.url_key) continue;
    stmts.push(kind === "aux"
      ? db.prepare("UPDATE aux_items SET story_key = ?1, url_key = ?2 WHERE id = ?3 AND story_key IS NULL AND story_of IS NULL").bind(k.story_key, k.url_key, r.id)
      : db.prepare("UPDATE items SET story_key = ?1 WHERE id = ?2 AND story_key IS NULL AND story_of IS NULL").bind(k.story_key, r.id));
  }
  const res = stmts.length ? await db.batch(stmts) : [];
  const updated = res.reduce((a, x) => a + (x.meta?.changes || 0), 0);
  return { kind, scanned: rows.length, updated, next_after_id: rows.length ? rows[rows.length - 1].id : after, done: rows.length < limit };
}
