// Copies new covered-lane items, and items from counterparty sources (customers,
// partners, programs, rivals and index providers of the covered companies), from
// news-monitor-db (binding NEWS, read-only by convention: this module only
// SELECTs from it) into zenith-db by rowid cursor. The cursor advances over
// every scanned row, matched or not.
//
// Feed text (roadmap T8): news-monitor keeps the text a covered or counterparty
// feed carries in items.body. When that is the release itself, ingest turns it
// into the item's excerpt (lead and figures, excerpt_status 'feed') and enrich
// never fetches that page; a summary or teaser only becomes the fallback
// (excerpt_fallback) for a page that cannot be read. A covered item whose feed
// text only links a PDF gets the link as excerpt_source, and enrich reads the
// PDF. A news-monitor-db without the column is detected and read as before:
// ingest never fails over it.
import COVERED from "./covered.json";
import { MATCH, COVERED_NAMES } from "./rubric.generated.js";
import { nowIso, isHttpUrl, routeCounterparty, chunk, isArchiveCandidate, archiveGroupKey, archiveSeedGroups, arrivalGate, isSecItem } from "./lib.js";
import { feedText, pdfLinkIn, isDocumentTitle, EXCERPT_CHARS } from "./excerpt.js";
import { textClass, visibleBudgets } from "./text-class.js";
import { mutedSources } from "./tuning.js";
import { isOfficialRecord, isFpdsSource, isRegisterSource } from "./records.js";
import { budgetSettings, fastPathCounter } from "./budget.js";
import { storyPlanner, storyDedupOn, hasFeedText, storyOfSql, storyOfArgs, swapStatement } from "./story.js";

// Windowing, shared with the auxiliary ingest (auxiliary.js).
export const BATCH = 400;
export const MAX_BATCHES = 6;
const BACKFILL_DAYS = 30;
const COUNTERPARTY = COVERED.counterparty || {};
// Filtered in code, not with SQL IN (...): D1 allows at most 100 bound
// parameters per query and there are ~150 source keys.
const SOURCE_KEYS = new Set([...Object.keys(COVERED.sources), ...Object.keys(COUNTERPARTY)]);

// Whether news-monitor-db has items.body, per NEWS binding in this isolate: a
// yes is kept, a no is checked again after BODY_RECHECK_MS (the column arrives
// with a news-monitor deploy). An error other than a missing column is not an
// answer; that run reads without the column.
const BODY_RECHECK_MS = 30 * 60_000;
const bodyColumn = new WeakMap();
const missingBody = (e) => /no such column|has no column named/i.test(String(e?.message || e)) && /\bbody\b/i.test(String(e?.message || e));
export async function newsHasBody(news, nowMs = Date.now()) {
  const known = bodyColumn.get(news);
  if (known?.has) return true;
  if (known && nowMs - known.at < BODY_RECHECK_MS) return false;
  try {
    await news.prepare("SELECT body FROM items WHERE rowid = 0").first();
    bodyColumn.set(news, { has: true, at: nowMs });
    return true;
  } catch (e) {
    if (missingBody(e)) bodyColumn.set(news, { has: false, at: nowMs });
    return false;
  }
}

const ROW_COLS = "rowid AS nm_rowid, source_key, url, title, published, category, first_seen, notified";
export async function newsRows(news, from, to) {
  const select = (cols) => news.prepare(`SELECT ${cols} FROM items WHERE rowid > ? AND rowid <= ? ORDER BY rowid`).bind(from, to).all();
  if (await newsHasBody(news)) {
    try { return (await select(`${ROW_COLS}, body`)).results || []; }
    catch (e) {
      if (!missingBody(e)) throw e;
      bodyColumn.set(news, { has: false, at: Date.now() });
    }
  }
  return (await select(ROW_COLS)).results || [];
}

// The excerpt fields an item starts with. Feed text that is the release itself
// is the excerpt (status 'feed'). A summary or a teaser leaves the item to
// enrich, which fetches the page as for any item; the summary is kept as
// excerpt_fallback, the excerpt only when the page cannot be read. A covered
// item whose feed text is only a PDF link, or a document's (deck, letter)
// title with one, gets the PDF as excerpt_source for enrich to read first.
// budget: the excerpt's characters (phase 2: the row's text class budget,
// 2,500 unless TEXT_BUDGETS=class).
export function feedFields(r, route, now, { budget = EXCERPT_CHARS } = {}) {
  const none = { excerpt: null, status: null, at: null, source: null, fallback: null };
  if (!r.body || typeof r.body !== "string") return none;
  const feed = feedText(r.body, r.title, budget);
  if (feed.full) return { ...none, excerpt: feed.excerpt, status: "feed", at: now };
  const pdf = route.role ? null : pdfLinkIn(r.body);
  return { ...none, fallback: feed.excerpt, source: pdf && (!feed.excerpt || isDocumentTitle(r.title)) ? pdf : null };
}

export async function getMeta(db, key) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
export const setMeta = (db, key, value) =>
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

// A first run starts just before the oldest row first seen in the last `days`
// days, or at the newest row when there is none.
export async function initialCursor(news, days = BACKFILL_DAYS) {
  const since = nowIso(Date.now() - days * 86_400_000);
  const row = await news.prepare("SELECT MIN(rowid) AS r FROM items WHERE first_seen >= ?").bind(since).first();
  const max = await news.prepare("SELECT MAX(rowid) AS r FROM items").first();
  return row?.r != null ? row.r - 1 : (max?.r ?? 0);
}

// Undated or old rows already stored from earlier batches (rowid <= cursor),
// per source and first_seen, for the groups in this batch. table: "items", or
// "aux_items" for the auxiliary ingest (same columns).
export const OLD_OR_UNDATED_SQL = "(published IS NULL OR julianday(nm_first_seen) - julianday(published) > 14)";
export async function storedArchiveCounts(db, rows, cursor, table = "items") {
  const firstSeen = [...new Set(rows.filter(isArchiveCandidate).map((r) => r.first_seen))];
  const out = new Map();
  for (const part of chunk(firstSeen, 80)) {
    const ph = part.map(() => "?").join(",");
    const res = await db.prepare(
      `SELECT source_key, nm_first_seen, COUNT(*) AS n FROM ${table}
        WHERE nm_first_seen IN (${ph}) AND nm_rowid <= ? AND ${OLD_OR_UNDATED_SQL} GROUP BY source_key, nm_first_seen`,
    ).bind(...part, cursor).all();
    for (const x of res.results || []) out.set(archiveGroupKey(x.source_key, x.nm_first_seen), x.n);
  }
  return out;
}

// --- Phase 0 gates: a source's first poll (its seed batch) -------------------
// news-monitor stores a source's first poll with one shared first_seen, so a
// row is in its source's seed batch iff its first_seen is the source's
// MIN(first_seen) in news-monitor-db. Cached per NEWS binding, per isolate: a
// source's MIN(first_seen) never changes once it has rows. SELECT only.
const firstPoll = new WeakMap();   // news binding -> Map(source_key -> MIN(first_seen))
export async function sourceFirstSeen(news, keys) {
  let known = firstPoll.get(news);
  if (!known) firstPoll.set(news, (known = new Map()));
  const need = [...new Set(keys)].filter((k) => k != null && !known.has(k));
  for (const part of chunk(need)) {
    const res = await news.prepare(
      `SELECT source_key, MIN(first_seen) AS f FROM items WHERE source_key IN (${part.map(() => "?").join(",")}) GROUP BY source_key`,
    ).bind(...part).all();
    for (const x of res.results || []) if (x.f != null) known.set(x.source_key, x.f);
  }
  return new Map([...new Set(keys)].map((k) => [k, known.get(k)]));
}
export const isSeedRow = (r, first) => first.get(r.source_key) != null && first.get(r.source_key) === r.first_seen;

// A covered company's own source (the covered lane): its fresh rows always
// take the fast path.
export const isOwnLane = (key) => Object.prototype.hasOwnProperty.call(COVERED.sources, key);
// The rows whose gate decision depends on seed membership: undated or old
// rows (the 21-day window and the burst labels), and every row of a source
// that is neither own-lane nor SEC (seed_fresh, integration ruling A1).
const needsSeed = (r) => isArchiveCandidate(r) || !(isOwnLane(r.source_key) || isSecItem(r));
export const seedMap = (news, rows) => sourceFirstSeen(news, rows.filter(needsSeed).map((r) => r.source_key));

// Phase 1: a Legistar decision row, news-monitor's second item for a matter
// (its URL plus a fragment): a vote result '#vote-<event id>' or a decisive
// status '#<status>'. The base row (no fragment) is not one.
export const isDecisionRow = (r) => String(r?.source_key ?? "").startsWith("legistar_") && /#[a-z0-9-]+$/i.test(String(r?.url ?? ""));

// The gate's context for one row (lib.js arrivalGate). fpds: an FPDS source
// (records.js isFpdsSource). decision: a Legistar decision row. register: a
// register source (records.js isRegisterSource; phase 2). capped: the row's
// source is at the day's fast-path cap (budget.js fastPathCounter).
export function gateContext(r, pipeline, first, park, { capped = false } = {}) {
  return { pipeline, record: isOfficialRecord(r), seed: isSeedRow(r, first), burst: park.has(archiveGroupKey(r.source_key, r.first_seen)),
    ownLane: isOwnLane(r.source_key), sec: isSecItem(r), fpds: isFpdsSource(r.source_key), decision: isDecisionRow(r),
    register: isRegisterSource(r.source_key), capped };
}

// The park UPDATE for a group that is a burst in this window: parks what the
// gate would have skipped (undated rows, and record_late rows over 21 days,
// which core.md's archive-burst rule scores 0-9), never an admission that is
// still valid (15-21 days) nor a released row. table: items or aux_items.
export function parkGroupStatement(db, table, { sourceKey, firstSeen, cursor, seed }) {
  return db.prepare(
    `UPDATE ${table} SET state = 'skipped', claim_id = NULL, claimed_until = NULL, admit = NULL,
            skip_reason = CASE WHEN published IS NULL THEN ? ELSE ? END
      WHERE source_key = ? AND nm_first_seen = ? AND nm_rowid <= ? AND state = 'pending' AND released_at IS NULL
        AND (published IS NULL OR (admit = 'record_late' AND julianday(nm_first_seen) - julianday(published) > 21))`,
  ).bind(seed ? "archive_seed" : "undated_burst", seed ? "archive_seed" : "stale_on_arrival", sourceKey, firstSeen, cursor);
}

// Phase 0 gates (d), one pipeline per item: Coverage owns every news-monitor
// row its ingest queues, a covered source's row or a counterparty row whose
// route has a ticker and no key-account skip. Auxiliary stores a row only when
// Coverage does not own it: a plain auxiliary source, a counterparty row the
// key-account gate drops (dropped, with the covered tickers the source
// affects), or one with no routable ticker. Decided from routing, never from
// a stored skip_reason, so a coverage-owned row that Coverage parks (stale,
// archive, muted, bad_url) is not stored on Auxiliary either.
// A row of a tag_affects source whose tag is outside its affects is stored on
// Coverage as skipped (countable, never graded) and Auxiliary never stores it.
export function coverageOwner(r) {
  if (isOwnLane(r.source_key)) return { owns: true };
  const cp = COUNTERPARTY[r.source_key];
  if (!cp) return { owns: false };
  const route = routeFor(r, cp);
  if (!route?.ticker) return { owns: false };
  if (route.skip === TAG_OUTSIDE) return { owns: true };
  // A dropped tag_affects row keeps only its tagged tickers (tagRoute narrowed them).
  const affects = cp.tag_affects ? String(route.affects || "").split(",").filter(Boolean) : [...(cp.affects || [])];
  return route.skip ? { owns: false, dropped: route.skip, affects } : { owns: true };
}

// Ticker, role and skip reason for one news-monitor row.
export function routeRow(r) {
  const cp = COUNTERPARTY[r.source_key];
  if (!cp) return { ticker: COVERED.sources[r.source_key], role: null, affects: null, skip: null };
  return routeFor(r, cp);
}

// --- Phase 5: routing for tagged and media rows ------------------------------
// One helper for every counterparty row, keyed on the catalog entry's flags
// (sync-covered.mjs), never on a source key. A key carries at most one flag;
// the order is tag narrowing (tag_affects), then the media gate (role
// "media"); any other counterparty row is routeCounterparty, unchanged.
export const TAG_OUTSIDE = "tag_outside_affects";
const LEAD_GROUP = /^\s*\[([^\]]*)\]\s*/;
const LEAD_TAG = /^\[([A-Z][A-Z0-9.]{0,7}(?:\/[A-Z][A-Z0-9.]{0,7})*)\]/;

// A tag_affects source (cp.tag_affects: its title starts with the tag of the
// tickers it is about, "[T]" or "[T/U]"): only the first leading [...] group is
// read, then stripped, so the tag can never be a company-term match; the row
// is routed among the tagged tickers that are in the source's affects. With
// none, it is stored skipped tag_outside_affects under affects[0]: never
// graded, never on Auxiliary. A dropped rival row's affects are the tagged ones.
export function tagRoute(r, cp, match = MATCH) {
  const title = String(r?.title || "");
  const group = LEAD_GROUP.exec(title);
  const tags = group ? group[1].split("/").map((t) => t.trim().toUpperCase()).filter(Boolean) : [];
  const affects = cp?.affects || [];
  const tagged = [...new Set(tags)].filter((t) => affects.includes(t));
  if (!tagged.length) return { ticker: affects[0] ?? null, role: cp?.role || "counterparty", affects: affects.join(","), skip: TAG_OUTSIDE };
  return routeCounterparty(group ? title.slice(group[0].length) : title, { ...cp, affects: tagged }, match);
}

// An outlet article (role "media") is on Coverage only when news-monitor's
// press matcher tagged it [T] (T in affects), or its title names T's own name
// (COVERED_NAMES, corporate suffix stripped) or a program-kind key account of T
// (covered.json media_accounts). Everything else is the skipped stub on
// Coverage and a coverage_subject row on Auxiliary: graded there, never lost.
// The stub keeps rival_no_key_account so the existing rescue and aux-band SQL
// work unchanged.
const stripSuffix = (n) => String(n).replace(/,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|plc)$/i, "").replace(/\s+(?:Holdings|Group)$/i, "");
export function mediaMatch(match = MATCH, names = COVERED_NAMES, programs = COVERED.media_accounts || {}) {
  const out = {};
  for (const t of Object.keys(match || {})) out[t] = { terms: [...new Set((names?.[t] || []).map(stripSuffix))], accounts: programs?.[t] || [] };
  return out;
}
const MEDIA_MATCH = mediaMatch();
export function routeCp(title, cp, match = MATCH, media = MEDIA_MATCH) {
  if (cp?.role !== "media") return routeCounterparty(title, cp, match);
  const g = routeCounterparty(title, { ...cp, role: "rival" }, media);
  if (!g) return g;
  const tag = (String(title || "").match(LEAD_TAG) || [])[1];
  const tagged = tag ? tag.split("/").some((t) => (cp.affects || []).includes(t)) : false;
  return { ...g, role: "media", skip: tagged ? null : g.skip };
}
export function routeFor(r, cp, match = MATCH, media = MEDIA_MATCH) {
  if (cp?.tag_affects) return tagRoute(r, cp, match);
  return routeCp(r?.title, cp, match, media);
}

export async function ingest(env) {
  const db = env.DB;
  const news = env.NEWS;
  let cursor = Number(await getMeta(db, "nm_cursor"));
  if (!Number.isFinite(cursor) || (await getMeta(db, "nm_cursor")) === null) {
    cursor = await initialCursor(news);
    await setMeta(db, "nm_cursor", cursor).run();
  }
  let scanned = 0, inserted = 0, skipped = 0, parkedEarlier = 0, fromFeed = 0, held = 0, storyHeld = 0, storySwapped = 0;
  // A muted source's rows are stored skipped (source prefs, tuning.js).
  const muted = await mutedSources(db);
  const fastCap = budgetSettings(env).fast_cap;
  const dedupOn = storyDedupOn(env);
  const budgets = visibleBudgets(env);
  for (let b = 0; b < MAX_BATCHES; b++) {
    // Find the window end first so the cursor can advance past unmatched rows.
    const win = await news.prepare("SELECT MAX(rowid) AS hi, COUNT(*) AS n FROM (SELECT rowid FROM items WHERE rowid > ? ORDER BY rowid LIMIT ?)")
      .bind(cursor, BATCH).first();
    if (!win || win.hi == null) break;
    const rows = (await newsRows(news, cursor, win.hi)).filter((r) => SOURCE_KEYS.has(r.source_key));
    const now = nowIso();
    const stmts = [];
    const routed = rows.map((r) => ({ r, route: routeRow(r) })).filter((x) => x.route?.ticker);
    // Day-one archive rows (a seed or backfill of undated or old pages): parked,
    // not queued as fresh news. Earlier rows of the same poll are parked too.
    const park = archiveSeedGroups(routed.map((x) => x.r), await storedArchiveCounts(db, routed.map((x) => x.r), cursor));
    // Phase 0 gates: seed membership (news-monitor MIN(first_seen), SELECT only).
    const first = await seedMap(news, routed.map((x) => x.r));
    const groupRow = new Map(routed.map(({ r }) => [archiveGroupKey(r.source_key, r.first_seen), r]));
    for (const key of park) {
      const g = groupRow.get(key);
      stmts.push(parkGroupStatement(db, "items", { sourceKey: g.source_key, firstSeen: g.first_seen, cursor, seed: isSeedRow(g, first) }));
    }
    const updates = stmts.length;
    // Phase 1: the per-source fast-path cap (budget.js fastPathCounter): the
    // day's stored fast-path rows, both tables, plus this batch's own.
    const fast = await fastPathCounter(db, routed.map((x) => x.r), fastCap);
    // Only http(s) links are ever fetched or shown in the feed. Precedence:
    // bad_url, then the key-account gate (a rival row it drops is labelled
    // rival_no_key_account whatever its age, so its Auxiliary copy is the
    // one graded), then the arrival gate, then a muted source, then (phase 2)
    // story_dup. The gate's skip reason never depends on the fast-path cap.
    const skipOf = (r, route, gate) => (!isHttpUrl(r.url) ? "bad_url" : route.skip || gate.reason || (muted.has(r.source_key) ? "muted_source" : null));
    // Phase 2: exact-key story dedup (story.js). Rows skipped on arrival get
    // no keys and are never held: they keep their own reason.
    const entries = routed.map(({ r, route }) => {
      const feed = feedFields(r, route, now, { budget: budgets[textClass(r)] });
      return { r, route, feed, scope: route.ticker, has_text: hasFeedText(feed),
        live: !skipOf(r, route, arrivalGate(r, gateContext(r, "coverage", first, park))) };
    });
    const story = await storyPlanner(db, "coverage", entries, { on: dedupOn });
    const holds = [], swaps = [];
    for (const e of entries) {
      const { r, route, feed } = e;
      // The arrival gate (lib.js arrivalGate): the stale gate, archive bursts,
      // and the admissions held for the daily grading budget (budget.js).
      const gate = arrivalGate(r, gateContext(r, "coverage", first, park, { capped: fast.capped(r) }));
      let reason = skipOf(r, route, gate);
      // A copy the gate admitted, whose canonical is claimable, takes no budget slot.
      const d = story.decide(e, reason ? null : gate.admit);
      if (!reason && d.action === "hold") reason = "story_dup";
      const admit = reason ? null : gate.admit;
      if (reason) skipped++;
      if (admit) held++;
      if (!reason && !admit) fast.add(r);
      if (feed.status) fromFeed++;
      if (d.action === "hold") holds.push(stmts.length);
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, skip_reason, role, affects,
           excerpt, excerpt_status, excerpt_at, excerpt_source, excerpt_fallback, admit, story_key, story_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${storyOfSql("items")})`,
      ).bind(r.nm_rowid, r.source_key, route.ticker, r.url, r.title || "(untitled)", r.published, r.category,
        r.first_seen, r.notified, now, reason ? "skipped" : "pending", reason || null, route.role, route.affects,
        feed.excerpt, feed.status, feed.at, feed.source, feed.fallback, admit, d.keys.story_key, ...storyOfArgs(d)));
      if (d.action === "swap") {
        swaps.push(stmts.length);
        stmts.push(swapStatement(db, "items", r.nm_rowid, d.canonical.nm_rowid));
      }
    }
    const n = stmts.length;
    stmts.push(setMeta(db, "nm_cursor", win.hi));
    stmts.push(setMeta(db, "last_ingest_at", now));
    const res = await db.batch(stmts);
    const swapSet = new Set(swaps);
    inserted += res.slice(updates, n).reduce((k, r, j) => k + (swapSet.has(updates + j) ? 0 : r.meta?.changes || 0), 0);
    storyHeld += holds.reduce((k, j) => k + (res[j]?.meta?.changes || 0), 0);
    storySwapped += swaps.reduce((k, j) => k + (res[j]?.meta?.changes || 0), 0);
    parkedEarlier += res.slice(0, updates).reduce((k, r) => k + (r.meta?.changes || 0), 0);
    scanned += win.n;
    cursor = win.hi;
    if (win.n < BATCH) break;
  }
  return { cursor, scanned, inserted, skipped_on_arrival: skipped, archive_parked_after_insert: parkedEarlier, feed_excerpts: fromFeed, held,
    story_held: storyHeld, story_swapped: storySwapped };
}
