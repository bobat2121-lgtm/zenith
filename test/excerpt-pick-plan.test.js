// The enrich pick reads through idx_items_state, not idx_items_excerpt, and
// still returns the same rows in the same order. Synthetic rows only. The test
// D1 reports no rows_read, so only the plan and the result rows are asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { D1 } from "./helpers/d1.js";
import { enrichPickSql } from "../worker/src/excerpt.js";

// The pick text before the unary plus, written out, as main had it inline.
const SEC = "(url LIKE 'https://www.sec.gov/%' OR url LIKE 'https://sec.gov/%' OR url LIKE 'http://www.sec.gov/%')";
const OLD_PICK = (secOnly) =>
  `SELECT id, url, title, excerpt_tries, role, excerpt_source FROM items
      WHERE excerpt_status IS NULL AND state IN ('pending','claimed') AND (excerpt_next_at IS NULL OR excerpt_next_at <= ?1 OR (?2 = 1 AND COALESCE(excerpt_tries, 0) = 0)) AND ${secOnly ? "" : "NOT "}${SEC}
      ORDER BY (admit IS NOT NULL AND released_at IS NULL), nm_first_seen DESC LIMIT ?3`;

const NOW = "2026-11-20T12:00:00.000Z";
const at = (min) => new Date(Date.parse(NOW) + min * 60_000).toISOString();

const plan = (db, sql) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(NOW, 1, 13).map((r) => r.detail).join(" | ");

function assertStatePlan(db, label) {
  for (const secOnly of [false, true]) {
    const detail = plan(db, enrichPickSql(secOnly));
    assert.match(detail, /idx_items_state/, `${label} secOnly=${secOnly}: ${detail}`);
    assert.doesNotMatch(detail, /idx_items_excerpt/, `${label} secOnly=${secOnly}: ${detail}`);
  }
}

let seq = 0;
function insert(db, over = {}) {
  seq += 1;
  const r = {
    url: `https://example.com/news/${seq}`, state: "pending", excerpt_status: null, excerpt_next_at: null, excerpt_tries: 0,
    claimed_until: null, admit: null, released_at: null, nm_first_seen: at(-seq), ...over,
  };
  db.db.prepare(
    `INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, nm_notified, ingested_at, state,
       excerpt_status, excerpt_next_at, excerpt_tries, claimed_until, admit, released_at)
     VALUES (?, 'src', 'SYM', ?, 'Title', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(seq, r.url, r.nm_first_seen, NOW, r.state, r.excerpt_status, r.excerpt_next_at, r.excerpt_tries, r.claimed_until, r.admit, r.released_at);
}

function seed() {
  const db = new D1();
  // Many skipped rows that were never read: all of them sit in the
  // excerpt_status IS NULL range of idx_items_excerpt.
  for (let i = 0; i < 2500; i++) insert(db, { state: "skipped" });
  // Pending rows: due, waiting, retried, held, and sec.gov ones.
  insert(db, {});
  insert(db, { excerpt_next_at: at(-30), excerpt_tries: 1 });
  insert(db, { excerpt_next_at: at(30), excerpt_tries: 1 });
  insert(db, { excerpt_next_at: at(30), excerpt_tries: 0 });
  insert(db, { admit: "source_cap" });
  insert(db, { admit: "seed_fresh", released_at: at(-5) });
  insert(db, { url: "https://www.sec.gov/Archives/edgar/data/1/a.htm" });
  insert(db, { url: "https://sec.gov/Archives/edgar/data/1/b.htm", excerpt_next_at: at(60) });
  insert(db, { url: "http://www.sec.gov/Archives/edgar/data/1/c.htm", admit: "vote" });
  // Claimed rows whose claim has expired.
  insert(db, { state: "claimed", claimed_until: at(-10) });
  insert(db, { state: "claimed", claimed_until: at(-20), excerpt_next_at: at(10), excerpt_tries: 1 });
  insert(db, { state: "claimed", claimed_until: at(-30), url: "https://www.sec.gov/Archives/edgar/data/1/d.htm" });
  // Rows already read (a set status) and graded or skipped rows with one.
  insert(db, { excerpt_status: "ok" });
  insert(db, { excerpt_status: "feed_summary", state: "claimed", claimed_until: at(-5) });
  insert(db, { excerpt_status: "pdf", state: "graded" });
  insert(db, { excerpt_status: "skipped_empty", state: "skipped" });
  insert(db, { state: "graded" });
  return db;
}

test("the new pick text differs from the old one only by the unary plus", () => {
  for (const secOnly of [false, true]) {
    assert.equal(enrichPickSql(secOnly).replace("+excerpt_status IS NULL", "excerpt_status IS NULL"), OLD_PICK(secOnly));
    assert.equal(enrichPickSql(secOnly).split("+excerpt_status").length, 2);
  }
});

test("EXPLAIN QUERY PLAN of both pick arms uses idx_items_state and never idx_items_excerpt", () => {
  assertStatePlan(new D1(), "migrated, empty");
  const db = seed();
  assertStatePlan(db, "seeded");
  db.exec("ANALYZE");
  assertStatePlan(db, "seeded, analyzed");
});

test("the new and the old pick return the same ids in the same order", () => {
  const db = seed();
  const ids = (sql, contact, limit) => db.db.prepare(sql).all(NOW, contact, limit).map((r) => r.id);
  for (const secOnly of [false, true]) {
    for (const contact of [0, 1]) {
      for (const limit of [1, 3, 13, 100]) {
        const before = ids(OLD_PICK(secOnly), contact, limit);
        const after = ids(enrichPickSql(secOnly), contact, limit);
        assert.deepEqual(after, before, `secOnly=${secOnly} contact=${contact} limit=${limit}`);
      }
    }
    assert.ok(ids(enrichPickSql(secOnly), 1, 100).length > 0, `secOnly=${secOnly} picks something`);
  }
  // The non-SEC arm with a contact address: five due pending or claimed rows
  // (the untried waiting row counts as due when a contact address is set; the
  // pick has no claimed_until term) plus the held one, which comes last
  // (unreleased admits sort after the rest). Skipped rows, read rows and
  // retried rows that are still waiting are never picked.
  const picked = db.db.prepare(enrichPickSql(false)).all(NOW, 1, 100);
  assert.equal(picked.length, 6);
  assert.ok(picked.every((r) => !r.url.includes("sec.gov")));
  const held = db.db.prepare("SELECT id FROM items WHERE admit = 'source_cap'").get().id;
  assert.equal(picked.at(-1).id, held);
});
