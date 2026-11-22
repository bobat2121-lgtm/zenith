// Test-only D1 stand-in over node:sqlite, so SQL in worker modules runs against
// the real migrations. Implements the subset zenith-core uses:
// prepare().bind().all()/first()/run() and batch().
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS = new URL("../../worker/migrations/", import.meta.url);

const plain = (row) => (row ? { ...row } : null);
const arg = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(arg)); }
  _prep() { return this.db.prepare(this.sql); }
  async all() { return { results: this._prep().all(...this.args).map(plain), success: true, meta: {} }; }
  async first(col) {
    const row = plain(this._prep().get(...this.args));
    if (!row) return null;
    return col ? row[col] ?? null : row;
  }
  async run() {
    const r = this._prep().run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  _isRead() { return /^\s*(SELECT|WITH)\b/i.test(this.sql); }
}

export class D1 {
  constructor({ migrations = true } = {}) {
    this.db = new DatabaseSync(":memory:");
    if (migrations) {
      for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
        this.db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
      }
    }
  }
  prepare(sql) { return new Stmt(this.db, sql); }
  exec(sql) { this.db.exec(sql); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(s._isRead() ? await s.all() : await s.run());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

// Seed helpers: minimal rows with sensible defaults.
let rowid = 1000;
export async function addItem(db, over = {}) {
  const now = new Date().toISOString();
  const r = {
    nm_rowid: rowid++, source_key: "src", ticker: "SYM", url: `https://example.com/${rowid}`, title: "Title",
    published: null, category: null, nm_first_seen: now, nm_notified: 1, ingested_at: now, state: "pending",
    skip_reason: null, role: null, affects: null, ...over,
  };
  const res = await db.prepare(
    `INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, skip_reason, role, affects)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(r.nm_rowid, r.source_key, r.ticker, r.url, r.title, r.published, r.category, r.nm_first_seen, r.nm_notified, r.ingested_at,
    r.state, r.skip_reason, r.role, r.affects).run();
  return res.meta.last_row_id;
}

// Adds a grade; primary (ticker = item ticker) grades become the item's grade.
export async function addGrade(db, itemId, over = {}) {
  const item = await db.prepare("SELECT ticker FROM items WHERE id = ?").bind(itemId).first();
  const g = {
    ticker: item.ticker, run_id: "run-1", rubric_version: "r-test", model: "m", score: 50, band: null, why: "why",
    note_hook: null, event_type: null, magnitude_usd: null, magnitude_pct: null, read_source: 1, confidence: 0.8,
    flags: "[]", graded_at: new Date().toISOString(), ...over,
  };
  if (!g.band) g.band = g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
  const res = await db.prepare(
    `INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, note_hook, event_type, magnitude_usd, magnitude_pct,
       read_source, confidence, flags, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(itemId, g.ticker, g.run_id, g.rubric_version, g.model, g.score, g.band, g.why, g.note_hook, g.event_type, g.magnitude_usd,
    g.magnitude_pct, g.read_source, g.confidence, g.flags, g.graded_at).run();
  const id = res.meta.last_row_id;
  if (g.ticker === item.ticker) await db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").bind(id, itemId).run();
  return id;
}

// A fetch stub that records calls and answers from a handler.
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} };
    calls.push(call);
    const out = (await handler(call, calls.length)) || { status: 200, json: {} };
    return new Response(out.text ?? JSON.stringify(out.json ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}
