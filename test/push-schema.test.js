// Phase 3, Part E, PR-E4: migration 0024 (web push tables, shipped off).
// Schema and local query plans only. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zenithDb } from "./helpers/worker-env.js";

const MIGRATION = "0024_push.sql";
const SQL = readFileSync(new URL(`../worker/migrations/${MIGRATION}`, import.meta.url), "utf8");
const TABLES = ["push_subs", "push_events", "push_sends", "push_tests"];

const plan = (db, sql, ...args) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(" | ");
const cols = (db, t) => db.db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);

test("push schema: 0024 is additive and creates the four tables and their indexes", () => {
  assert.doesNotMatch(SQL, /\b(DROP|ALTER|DELETE|UPDATE)\b/i, "additive only");
  const db = zenithDb();
  const names = db.db.prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'push_%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`);
  for (const t of TABLES) assert.ok(names.includes(`table:${t}`), t);
  for (const i of ["push_subs_live", "push_events_day", "push_events_due", "push_tests_actor", "push_tests_pending"]) assert.ok(names.includes(`index:${i}`), i);
  assert.deepEqual(cols(db, "push_subs"), ["id", "universe_id", "actor", "endpoint", "p256dh", "auth", "platform", "created_at", "last_ok_at",
    "last_status", "fail_count", "revoked_at", "revoked_why"]);
  assert.deepEqual(cols(db, "push_tests"), ["id", "universe_id", "actor", "created_at", "status", "sent_at"]);
  for (const t of TABLES) assert.equal(db.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} starts empty`);
  // Re-running the file is harmless (IF NOT EXISTS everywhere).
  db.exec(SQL);
});

test("push schema: push_events is UNIQUE (universe_id, item_id, ticker) and takes Leads only by status", () => {
  const db = zenithDb();
  const ins = db.db.prepare("INSERT INTO push_events (item_id, ticker, grade_id, score, status, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(1, "TST", 10, 95, "pending", "2026-01-06T12:00:00.000Z");
  ins.run(1, "TSTB", 11, 95, "pending", "2026-01-06T12:00:00.000Z");
  assert.throws(() => ins.run(1, "TST", 12, 96, "pending", "2026-01-06T12:05:00.000Z"), /UNIQUE/);
  assert.throws(() => ins.run(2, "TST", 13, 96, "queued", "2026-01-06T12:05:00.000Z"), /CHECK/);
  assert.throws(() => db.db.prepare("INSERT INTO push_events (item_id, ticker, status, created_at) VALUES (3, 'TST', 'pending', 'x')").run(), /NOT NULL/);
});

test("push schema: push_tests has no unique key on (actor, day); push_subs endpoint is UNIQUE; push_sends PK (event_id, sub_id)", () => {
  const db = zenithDb();
  const t = db.db.prepare("INSERT INTO push_tests (actor, created_at, status) VALUES (?, ?, 'pending')");
  for (let i = 0; i < 4; i++) t.run("access:0000000000000000", `2026-01-06T12:0${i}:00.000Z`);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM push_tests").get().n, 4);
  const uniques = db.db.prepare("PRAGMA index_list(push_tests)").all().filter((r) => r.unique);
  assert.deepEqual(uniques, [], "no unique index on push_tests");
  const s = db.db.prepare("INSERT INTO push_subs (actor, endpoint, p256dh, auth, created_at) VALUES (?, ?, 'k', 'a', 'x')");
  s.run("access:0000000000000000", "https://fcm.googleapis.com/fcm/send/synthetic-1");
  assert.throws(() => s.run("access:1111111111111111", "https://fcm.googleapis.com/fcm/send/synthetic-1"), /UNIQUE/);
  const p = db.db.prepare("INSERT INTO push_sends (event_id, sub_id, status, attempts, at) VALUES (1, 1, 201, 1, 'x')");
  p.run();
  assert.throws(() => p.run(), /UNIQUE|PRIMARY/);
});

test("push schema: no column is named like an email, a user agent or an IP address", () => {
  const db = zenithDb();
  for (const t of TABLES) for (const c of cols(db, t)) assert.doesNotMatch(c, /email|mail|ua$|user_agent|ip$|^ip_/i, `${t}.${c}`);
});

test("push schema: EXPLAIN of Q14 uses push_tests_actor, of Q15 push_tests_pending, Q8 push_subs_live, Q10 push_events_due, Q9 push_events_day", () => {
  const db = zenithDb();
  assert.match(plan(db, "SELECT COUNT(*) AS n FROM push_tests WHERE actor = ? AND created_at >= ?", "a", "b"), /USING (COVERING )?INDEX push_tests_actor/);
  assert.match(plan(db, "SELECT id, actor FROM push_tests WHERE status = 'pending' ORDER BY id LIMIT 3"), /push_tests_pending/);
  assert.match(plan(db, "SELECT id, endpoint, p256dh, auth FROM push_subs WHERE universe_id = 'u1' AND actor = ? AND revoked_at IS NULL ORDER BY id LIMIT 5", "a"),
    /push_subs_live/);
  assert.match(plan(db, "SELECT id FROM push_events WHERE status IN ('pending','partial') AND next_at <= ? ORDER BY next_at, id LIMIT 5", "x"), /push_events_due/);
  assert.match(plan(db, "SELECT ticker, COUNT(*) AS n FROM push_events WHERE universe_id = 'u1' AND created_at >= ? AND status != 'capped' GROUP BY ticker", "x"),
    /push_events_day/);
  assert.match(plan(db, "SELECT id, actor, revoked_at FROM push_subs WHERE endpoint = ?", "x"), /sqlite_autoindex_push_subs_1/);
});
