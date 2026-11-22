// Copies new covered-lane items, and items from counterparty sources (customers,
// partners, programs, rivals and index providers of the covered companies), from
// news-monitor-db (binding NEWS, read-only by convention: this module only
// SELECTs from it) into zenith-db by rowid cursor. The cursor advances over
// every scanned row, matched or not.
import COVERED from "./covered.json";
import { MATCH } from "./rubric.generated.js";
import { nowIso, skipReason, isHttpUrl, routeCounterparty, chunk, isArchiveCandidate, archiveGroupKey, archiveSeedGroups } from "./lib.js";

const BATCH = 400;
const MAX_BATCHES = 6;
const BACKFILL_DAYS = 30;
const COUNTERPARTY = COVERED.counterparty || {};
// Filtered in code, not with SQL IN (...): D1 allows at most 100 bound
// parameters per query and there are ~150 source keys.
const SOURCE_KEYS = new Set([...Object.keys(COVERED.sources), ...Object.keys(COUNTERPARTY)]);

async function getMeta(db, key) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
const setMeta = (db, key, value) =>
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

async function initialCursor(news) {
  const since = nowIso(Date.now() - BACKFILL_DAYS * 86_400_000);
  const row = await news.prepare("SELECT MIN(rowid) AS r FROM items WHERE first_seen >= ?").bind(since).first();
  const max = await news.prepare("SELECT MAX(rowid) AS r FROM items").first();
  return row?.r != null ? row.r - 1 : (max?.r ?? 0);
}

// Undated or old rows already stored from earlier batches (rowid <= cursor),
// per source and first_seen, for the groups in this batch.
const OLD_OR_UNDATED_SQL = "(published IS NULL OR julianday(nm_first_seen) - julianday(published) > 14)";
async function storedArchiveCounts(db, rows, cursor) {
  const firstSeen = [...new Set(rows.filter(isArchiveCandidate).map((r) => r.first_seen))];
  const out = new Map();
  for (const part of chunk(firstSeen, 80)) {
    const ph = part.map(() => "?").join(",");
    const res = await db.prepare(
      `SELECT source_key, nm_first_seen, COUNT(*) AS n FROM items
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
  let scanned = 0, inserted = 0, skipped = 0, parkedEarlier = 0;
  for (let b = 0; b < MAX_BATCHES; b++) {
    // Find the window end first so the cursor can advance past unmatched rows.
    const win = await news.prepare("SELECT MAX(rowid) AS hi, COUNT(*) AS n FROM (SELECT rowid FROM items WHERE rowid > ? ORDER BY rowid LIMIT ?)")
      .bind(cursor, BATCH).first();
    if (!win || win.hi == null) break;
    const rows = ((await news.prepare(
      `SELECT rowid AS nm_rowid, source_key, url, title, published, category, first_seen, notified
         FROM items WHERE rowid > ? AND rowid <= ? ORDER BY rowid`,
    ).bind(cursor, win.hi).all()).results || []).filter((r) => SOURCE_KEYS.has(r.source_key));
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
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, skip_reason, role, affects)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(r.nm_rowid, r.source_key, route.ticker, r.url, r.title || "(untitled)", r.published, r.category,
        r.first_seen, r.notified, now, reason ? "skipped" : "pending", reason || null, route.role, route.affects));
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
  return { cursor, scanned, inserted, skipped_on_arrival: skipped, archive_parked_after_insert: parkedEarlier };
}
