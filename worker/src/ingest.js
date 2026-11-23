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
import { MATCH } from "./rubric.generated.js";
import { nowIso, skipReason, isHttpUrl, routeCounterparty, chunk, isArchiveCandidate, archiveGroupKey, archiveSeedGroups } from "./lib.js";
import { feedText, pdfLinkIn, isDocumentTitle } from "./excerpt.js";

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
export function feedFields(r, route, now) {
  const none = { excerpt: null, status: null, at: null, source: null, fallback: null };
  if (!r.body || typeof r.body !== "string") return none;
  const feed = feedText(r.body, r.title);
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

// Ticker, role and skip reason for one news-monitor row.
export function routeRow(r) {
  const cp = COUNTERPARTY[r.source_key];
  if (!cp) return { ticker: COVERED.sources[r.source_key], role: null, affects: null, skip: null };
  return routeCounterparty(r.title, cp, MATCH);
}

export async function ingest(env) {
  const db = env.DB;
  const news = env.NEWS;
  let cursor = Number(await getMeta(db, "nm_cursor"));
  if (!Number.isFinite(cursor) || (await getMeta(db, "nm_cursor")) === null) {
    cursor = await initialCursor(news);
    await setMeta(db, "nm_cursor", cursor).run();
  }
  let scanned = 0, inserted = 0, skipped = 0, parkedEarlier = 0, fromFeed = 0;
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
    const groupRow = new Map(routed.map(({ r }) => [archiveGroupKey(r.source_key, r.first_seen), r]));
    for (const key of park) {
      const { source_key: sourceKey, first_seen: firstSeen } = groupRow.get(key);
      stmts.push(db.prepare(
        `UPDATE items SET state = 'skipped', skip_reason = 'archive_seed', claim_id = NULL, claimed_until = NULL
          WHERE source_key = ? AND nm_first_seen = ? AND nm_rowid <= ? AND state = 'pending' AND ${OLD_OR_UNDATED_SQL}`,
      ).bind(sourceKey, firstSeen, cursor));
    }
    const updates = stmts.length;
    for (const { r, route } of routed) {
      const archive = park.has(archiveGroupKey(r.source_key, r.first_seen)) && isArchiveCandidate(r);
      // Only http(s) links are ever fetched or shown in the feed.
      const reason = !isHttpUrl(r.url) ? "bad_url" : archive ? "archive_seed" : skipReason(r) || route.skip;
      if (reason) skipped++;
      const feed = feedFields(r, route, now);
      if (feed.status) fromFeed++;
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, skip_reason, role, affects,
           excerpt, excerpt_status, excerpt_at, excerpt_source, excerpt_fallback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(r.nm_rowid, r.source_key, route.ticker, r.url, r.title || "(untitled)", r.published, r.category,
        r.first_seen, r.notified, now, reason ? "skipped" : "pending", reason || null, route.role, route.affects,
        feed.excerpt, feed.status, feed.at, feed.source, feed.fallback));
    }
    const n = stmts.length;
    stmts.push(setMeta(db, "nm_cursor", win.hi));
    stmts.push(setMeta(db, "last_ingest_at", now));
    const res = await db.batch(stmts);
    inserted += res.slice(updates, n).reduce((k, r) => k + (r.meta?.changes || 0), 0);
    parkedEarlier += res.slice(0, updates).reduce((k, r) => k + (r.meta?.changes || 0), 0);
    scanned += win.n;
    cursor = win.hi;
    if (win.n < BATCH) break;
  }
  return { cursor, scanned, inserted, skipped_on_arrival: skipped, archive_parked_after_insert: parkedEarlier, feed_excerpts: fromFeed };
}
