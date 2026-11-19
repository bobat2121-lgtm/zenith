// Copies new covered-lane items from news-monitor-db (binding NEWS, read-only
// by convention: this module only SELECTs from it) into zenith-db by rowid
// cursor. The cursor advances over every scanned row, matched or not.
import COVERED from "./covered.json";
import { nowIso, skipReason } from "./lib.js";

const BATCH = 400;
const MAX_BATCHES = 6;
const BACKFILL_DAYS = 30;
const COVERED_KEYS = Object.keys(COVERED.sources);

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

export async function ingest(env) {
  const db = env.DB;
  const news = env.NEWS;
  let cursor = Number(await getMeta(db, "nm_cursor"));
  if (!Number.isFinite(cursor) || (await getMeta(db, "nm_cursor")) === null) {
    cursor = await initialCursor(news);
    await setMeta(db, "nm_cursor", cursor).run();
  }
  const placeholders = COVERED_KEYS.map(() => "?").join(",");
  let scanned = 0, inserted = 0, skipped = 0;
  for (let b = 0; b < MAX_BATCHES; b++) {
    // Find the window end first so the cursor can advance past unmatched rows.
    const win = await news.prepare("SELECT MAX(rowid) AS hi, COUNT(*) AS n FROM (SELECT rowid FROM items WHERE rowid > ? ORDER BY rowid LIMIT ?)")
      .bind(cursor, BATCH).first();
    if (!win || win.hi == null) break;
    const rows = (await news.prepare(
      `SELECT rowid AS nm_rowid, source_key, url, title, published, category, first_seen, notified
         FROM items WHERE rowid > ? AND rowid <= ? AND source_key IN (${placeholders}) ORDER BY rowid`,
    ).bind(cursor, win.hi, ...COVERED_KEYS).all()).results || [];
    const now = nowIso();
    const stmts = rows.map((r) => {
      const reason = skipReason(r);
      if (reason) skipped++;
      return db.prepare(
        `INSERT OR IGNORE INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, skip_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(r.nm_rowid, r.source_key, COVERED.sources[r.source_key], r.url, r.title || "(untitled)", r.published, r.category,
        r.first_seen, r.notified, now, reason ? "skipped" : "pending", reason);
    });
    stmts.push(setMeta(db, "nm_cursor", win.hi));
    stmts.push(setMeta(db, "last_ingest_at", now));
    const res = await db.batch(stmts);
    inserted += res.slice(0, rows.length).reduce((n, r) => n + (r.meta?.changes || 0), 0);
    scanned += win.n;
    cursor = win.hi;
    if (win.n < BATCH) break;
  }
  return { cursor, scanned, inserted, skipped_on_arrival: skipped };
}
