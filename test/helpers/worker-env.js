// Test harness: an in-memory D1 stand-in over node:sqlite (prepare/bind/all/
// first/run/batch), the zenith-db migrations, and a loader hook so the Worker's
// plain `import X from "./covered.json"` works under Node (wrangler bundles it).
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

let hooked = false;
export function hookJsonImports() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && url.endsWith(".json") && !context.importAttributes?.type) {
        return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  #prep() { return this.db.prepare(this.sql); }
  async all() { return { results: this.#prep().all(...this.args), success: true, meta: {} }; }
  async first(col) {
    const row = this.#prep().get(...this.args);
    if (!row) return null;
    return col ? row[col] : row;
  }
  async run() {
    const r = this.#prep().run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  runSync() {
    const p = this.#prep();
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql)) return { results: p.all(...this.args), meta: {} };
    const r = p.run(...this.args);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Stmt(this.db, sql); }
  exec(sql) { this.db.exec(sql); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.runSync());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  rows(sql, ...args) { return this.db.prepare(sql).all(...args); }
}

const MIGRATIONS = new URL("../../worker/migrations/", import.meta.url);
export function zenithDb() {
  const d1 = new FakeD1();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) d1.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return d1;
}

// A news-monitor-db stand-in with the columns zenith-core reads.
export function newsDb() {
  const d1 = new FakeD1();
  d1.exec(`CREATE TABLE items (source_key TEXT, url TEXT, title TEXT, published TEXT, category TEXT, first_seen TEXT, notified INTEGER)`);
  return d1;
}

export const TOKENS = { ADMIN_TOKEN: "admin-test-token", GRADER_TOKEN: "grader-test-token", APP_TOKEN: "app-test-token" };

export function request(worker, env, method, path, { role = "admin", body } = {}) {
  const token = { admin: TOKENS.ADMIN_TOKEN, grader: TOKENS.GRADER_TOKEN, app: TOKENS.APP_TOKEN }[role];
  const init = { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(`https://zenith.test${path}`, init), env).then(async (r) => ({ status: r.status, body: await r.json() }));
}
