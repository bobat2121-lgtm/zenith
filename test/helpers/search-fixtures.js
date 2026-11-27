// Synthetic seed helpers for the search tests (worker/src/search.js). Invented
// text only (widget, Widgetco, example.com); tickers TST and ACM are synthetic.
// Route tests pick bundled tickers at run time instead of using these maps.
let rowid = 50_000;
export const nextRowid = () => rowid++;

export const NOW = Date.parse("2026-06-15T16:00:00.000Z");
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const ago = (ms, now = NOW) => new Date(now - ms).toISOString();

// Synthetic maps in the real shapes of covered.json, rubric COVERED_NAMES and aux-sources.json.
export const COVERED_FIX = { tickers: ["TST", "ACM"], sources: { tst_ir: "TST", acm_ir: "ACM" }, counterparty: {}, records: [] };
export const NAMES_FIX = { TST: ["Test Robotics, Inc.", "Test Robotics"], ACM: ["Acme Holdings Corp."] };
export const AUX_FIX = {
  sources: {
    widgetco_news: { entity: "widgetco", name: "Widgetco", status: "private" },
    widgetco_filings: { entity: "widgetco", name: "Widgetco filings", status: "public" },
    gizmo_feed: { entity: "gizmo", name: "Gizmo Labs", status: "private" },
    plainco_news: { entity: "plainco", name: "Plainco", status: "private" },
  },
  exclude: {},
};
export const MUTED_FIX = "(SELECT source_key FROM source_prefs WHERE action = 'mute')";
export const deps = (over = {}) => ({ tickers: COVERED_FIX.tickers, names: NAMES_FIX, aux: AUX_FIX, covered: COVERED_FIX, muted: MUTED_FIX, now: NOW, ...over });

const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

// A coverage item; returns its id.
export async function addCov(db, over = {}) {
  const r = {
    nm_rowid: nextRowid(), source_key: "tst_ir", ticker: "TST", url: `https://example.com/c/${rowid}`, title: "Plain title",
    headline: null, excerpt: null, published: "2026-06-01", nm_first_seen: ago(HOUR), state: "pending", skip_reason: null,
    role: null, admit: null, released_at: null, ...over,
  };
  const res = await run(db,
    `INSERT INTO items (nm_rowid, source_key, ticker, url, title, headline, excerpt, published, nm_first_seen, nm_notified, ingested_at,
       state, skip_reason, role, admit, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    r.nm_rowid, r.source_key, r.ticker, r.url, r.title, r.headline, r.excerpt, r.published, r.nm_first_seen, r.nm_first_seen,
    r.state, r.skip_reason, r.role, r.admit, r.released_at);
  return res.meta.last_row_id;
}

// A coverage grade. A grade for the item's own ticker becomes its grade (state graded).
export async function gradeCov(db, itemId, over = {}) {
  const item = await db.prepare("SELECT ticker FROM items WHERE id = ?").bind(itemId).first();
  const g = { ticker: item.ticker, score: 50, band: null, why: "A reason.", note_hook: null, event_type: null, run_id: "run-1", ...over };
  if (!g.band) g.band = g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
  const res = await run(db,
    `INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, note_hook, event_type, graded_at)
     VALUES (?, ?, ?, 'r-test', 'm', ?, ?, ?, ?, ?, ?)`,
    itemId, g.ticker, g.run_id, g.score, g.band, g.why, g.note_hook, g.event_type, new Date(NOW).toISOString());
  const id = res.meta.last_row_id;
  if (g.ticker === item.ticker) await run(db, "UPDATE items SET state = 'graded', grade_id = ? WHERE id = ?", id, itemId);
  return id;
}

// An auxiliary item; returns its id.
export async function addAux(db, over = {}) {
  const r = {
    nm_rowid: nextRowid(), source_key: "plainco_news", entity_key: "plainco", entity_name: "Plainco", status: "private",
    url: `https://example.com/a/${rowid}`, title: "Plain title", headline: null, excerpt: null, page_excerpt: null,
    published: "2026-06-01", nm_first_seen: ago(HOUR), state: "pending", skip_reason: null, admit: null, released_at: null, ...over,
  };
  const res = await run(db,
    `INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, headline, excerpt, page_excerpt, published,
       nm_first_seen, ingested_at, state, skip_reason, admit, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.nm_rowid, r.source_key, r.entity_key, r.entity_name, r.status, r.url, r.title, r.headline, r.excerpt, r.page_excerpt, r.published,
    r.nm_first_seen, r.nm_first_seen, r.state, r.skip_reason, r.admit, r.released_at);
  return res.meta.last_row_id;
}

// An auxiliary grade; it becomes the item's grade (state graded).
export async function gradeAux(db, itemId, over = {}) {
  const g = { entity: "Plainco", covered_ticker: null, score: 50, band: null, why: "A reason.", event_type: null, ...over };
  if (!g.band) g.band = g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
  const res = await run(db,
    `INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, event_type, why, flags, graded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
    itemId, `run-${itemId}`, g.entity, g.covered_ticker, g.score, g.band, g.event_type, g.why, new Date(NOW).toISOString());
  const id = res.meta.last_row_id;
  await run(db, "UPDATE aux_items SET state = 'graded', grade_id = ? WHERE id = ?", id, itemId);
  return id;
}

// A mute written straight into source_prefs (POST /v1/source-prefs refuses unknown keys).
export const mute = (db, key) => run(db, "INSERT INTO source_prefs (source_key, action, note, updated_at) VALUES (?, 'mute', NULL, ?)",
  key, new Date(NOW).toISOString());

// EXPLAIN QUERY PLAN of one built statement, as one string.
export const planOf = (d1, s) => d1.db.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(...s.binds).map((r) => r.detail).join(" | ");

// Counts prepare and batch calls on a D1 stand-in.
export function spy(d1, { throwOnPrepare = false } = {}) {
  const calls = { prepare: 0, sql: [] };
  return {
    calls,
    db: {
      prepare(sql) {
        calls.prepare++;
        calls.sql.push(sql);
        if (throwOnPrepare) throw new Error("boom");
        return d1.prepare(sql);
      },
      batch: (stmts) => d1.batch(stmts),
      exec: (sql) => d1.exec(sql),
    },
  };
}
