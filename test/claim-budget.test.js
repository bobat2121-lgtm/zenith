// Phase 2 claim text budget (PR-A2): POST /v1/queue/claim and POST /v1/aux/claim
// accept max_chars and keep only the items whose excerpts (+200 characters a
// frame) fit, in the claim's own order, always at least one. The rest go back to
// the queue with the attempt refunded; the response says how many (trimmed).
// The trim works on the rows the claim already loaded: it adds no read.
// Synthetic rows and round lengths only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");

const HOUR = 3_600_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });
const text = (n) => "x".repeat(n);

let rowid = 0;
// A pending coverage row; newer rows get a later first sighting.
function addItem(env, over = {}) {
  const it = { source_key: "acme_news", ticker: "RCAT", url: `https://ir.acme.example/n/${++rowid}`, title: `Synthetic coverage item ${rowid}`,
    published: iso(3 * HOUR), nm_first_seen: iso(2 * HOUR - rowid * 1000), excerpt: null, excerpt_status: null, attempts: 0, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state,
      excerpt, excerpt_status, attempts) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, 'pending', ?, ?, ?)`)
    .run(rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.excerpt, it.excerpt_status, it.attempts);
  return Number(r.lastInsertRowid);
}
function addAux(env, over = {}) {
  const it = { source_key: "acme_aux", entity_key: "acme", entity_name: "Acme (private)", status: "private", url: `https://news.acme.example/a/${++rowid}`,
    title: `Synthetic auxiliary item ${rowid}`, published: iso(3 * HOUR), nm_first_seen: iso(2 * HOUR - rowid * 1000), excerpt: null, excerpt_status: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, skip_reason, excerpt, excerpt_status, attempts, claim_id, claimed_until, coverage_subject, affects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending', NULL, ?, ?, 0, NULL, NULL, 0, NULL)`)
    .run(rowid, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.published, it.nm_first_seen, iso(), it.excerpt, it.excerpt_status);
  return Number(r.lastInsertRowid);
}
const claim = (env, body) => request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body });
const auxClaim = (env, body) => request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body });
const row = (env, table, id) => ({ ...env.DB.rows(`SELECT state, claim_id, claimed_until, attempts FROM ${table} WHERE id = ?`, id)[0] });

test("coverage: max_chars keeps the items that fit, newest first; the rest go back pending with the attempt refunded", async () => {
  const env = newEnv();
  const ids = Array.from({ length: 20 }, () => addItem(env, { excerpt: text(8000), excerpt_status: "ok" }));
  const r = await claim(env, { limit: 20, run_id: "run-budget-1", max_chars: 50000 });
  assert.equal(r.status, 200);
  // 6 x 8,200 = 49,200 fits in 50,000; a seventh (57,400) does not.
  assert.equal(r.body.items.length, 6);
  assert.equal(r.body.trimmed, 14);
  assert.equal(r.body.remaining, 14);
  const newest = [...ids].reverse();
  assert.deepEqual(r.body.items.map((i) => i.item_id), newest.slice(0, 6), "the claim's own order: newest first");
  for (const id of newest.slice(6)) {
    assert.deepEqual(row(env, "items", id), { state: "pending", claim_id: null, claimed_until: null, attempts: 0 }, `item ${id}`);
  }
  for (const id of newest.slice(0, 6)) {
    const k = row(env, "items", id);
    assert.equal(k.state, "claimed");
    assert.equal(k.claim_id, r.body.claim_id);
    assert.equal(k.attempts, 1);
  }
  assert.equal(env.DB.rows("SELECT claimed FROM runs WHERE id = 'run-budget-1'")[0].claimed, 6);
});

test("coverage: the trim follows the claim order, so rows whose excerpt read has not finished go last", async () => {
  const env = newEnv();
  const done = Array.from({ length: 4 }, () => addItem(env, { excerpt: text(4800), excerpt_status: "ok" }));
  // Newer, but the excerpt read is still pending: the claim puts these last.
  const waiting = Array.from({ length: 2 }, () => addItem(env));
  const r = await claim(env, { limit: 10, max_chars: 10000 });
  assert.deepEqual(r.body.items.map((i) => i.item_id).sort(), [...done].reverse().slice(0, 2).sort());
  assert.equal(r.body.trimmed, 4);
  for (const id of waiting) assert.equal(row(env, "items", id).state, "pending");
});

test("coverage: one item longer than max_chars is still returned alone", async () => {
  const env = newEnv();
  const big = addItem(env, { excerpt: text(120000), excerpt_status: "ok" });
  const r = await claim(env, { limit: 20, max_chars: 50000 });
  assert.deepEqual(r.body.items.map((i) => i.item_id), [big]);
  assert.equal(r.body.items[0].excerpt.length, 120000, "the excerpt itself is never cut");
  assert.equal(r.body.trimmed, 0);

  // The first item is kept even when a longer one follows it.
  const env2 = newEnv();
  const older = addItem(env2, { excerpt: text(100000), excerpt_status: "ok" });
  const newer = addItem(env2, { excerpt: text(100000), excerpt_status: "ok" });
  const r2 = await claim(env2, { limit: 20, max_chars: 50000 });
  assert.deepEqual(r2.body.items.map((i) => i.item_id), [newer]);
  assert.equal(r2.body.trimmed, 1);
  assert.equal(row(env2, "items", older).state, "pending");
});

test("coverage: without max_chars nothing is trimmed (an older CLI), and max_chars is clamped to 5,000-200,000", async () => {
  const env = newEnv();
  for (let k = 0; k < 20; k++) addItem(env, { excerpt: text(8000), excerpt_status: "ok" });
  const r = await claim(env, { limit: 20 });
  assert.equal(r.body.items.length, 20);
  assert.equal(r.body.trimmed, 0);

  // Below the floor: read as 5,000 (one 8,200 item, the at-least-one rule).
  const low = newEnv();
  for (let k = 0; k < 3; k++) addItem(low, { excerpt: text(2000), excerpt_status: "ok" });
  const l = await claim(low, { limit: 20, max_chars: 10 });
  assert.equal(l.body.items.length, 2, "2 x 2,200 fits in the 5,000 floor, 3 do not");
  assert.equal(l.body.trimmed, 1);

  // Above the ceiling: read as 200,000.
  const high = newEnv();
  for (let k = 0; k < 30; k++) addItem(high, { excerpt: text(9800), excerpt_status: "ok" });
  const h = await claim(high, { limit: 30, max_chars: 10_000_000 });
  assert.equal(h.body.items.length, 20, "20 x 10,000 = 200,000");
  assert.equal(h.body.trimmed, 10);

  // Not a number: no trim.
  const odd = newEnv();
  for (let k = 0; k < 5; k++) addItem(odd, { excerpt: text(8000), excerpt_status: "ok" });
  const o = await claim(odd, { limit: 20, max_chars: "lots" });
  assert.equal(o.body.items.length, 5);
  assert.equal(o.body.trimmed, 0);
});

test("aux: max_chars keeps items in CLAIM_ORDER (rows older than 72 hours first) and refunds the rest", async () => {
  const env = newEnv();
  // Three backlog rows, first seen 80-82 hours ago: the claim takes them first, oldest first.
  const old = [82, 81, 80].map((h) => addAux(env, { nm_first_seen: iso(h * HOUR), excerpt: text(3000), excerpt_status: "feed" }));
  const fresh = Array.from({ length: 27 }, () => addAux(env, { excerpt: text(3000), excerpt_status: "feed" }));
  const r = await auxClaim(env, { limit: 30, max_chars: 30000 });
  assert.equal(r.status, 200);
  // 9 x 3,200 = 28,800 fits in 30,000; a tenth (32,000) does not.
  assert.equal(r.body.items.length, 9);
  assert.equal(r.body.trimmed, 21);
  assert.equal(r.body.remaining, 21);
  assert.deepEqual(r.body.items.map((i) => i.item_id), [...old, ...[...fresh].reverse().slice(0, 6)]);
  const kept = new Set(r.body.items.map((i) => i.item_id));
  for (const id of [...old, ...fresh].filter((id) => !kept.has(id))) {
    assert.deepEqual(row(env, "aux_items", id), { state: "pending", claim_id: null, claimed_until: null, attempts: 0 }, `aux item ${id}`);
  }

  // No max_chars: today's behaviour.
  const env2 = newEnv();
  for (let k = 0; k < 30; k++) addAux(env2, { excerpt: text(3000), excerpt_status: "feed" });
  const r2 = await auxClaim(env2, { limit: 30 });
  assert.equal(r2.body.items.length, 30);
  assert.equal(r2.body.trimmed, 0);
});

// A D1 wrapper that records every prepared SQL text.
function recording(env) {
  const seen = [];
  const db = env.DB;
  const wrapped = Object.create(db);
  wrapped.prepare = (sql) => { seen.push(sql.replace(/\s+/g, " ").trim()); return db.prepare(sql); };
  wrapped.batch = (s) => db.batch(s);
  return { env: { ...env, DB: wrapped }, seen };
}

test("the trim adds no read: its only new statements are UPDATEs by claim_id and primary key", async () => {
  for (const [table, call, seed, body] of [
    ["items", claim, (env) => addItem(env, { excerpt: text(8000), excerpt_status: "ok" }), { limit: 20 }],
    ["aux_items", auxClaim, (env) => addAux(env, { excerpt: text(3000), excerpt_status: "feed" }), { limit: 30 }],
  ]) {
    const a = newEnv();
    const b = newEnv();
    for (let k = 0; k < 30; k++) { seed(a); seed(b); }
    const plain = recording(a);
    const trimming = recording(b);
    await call(plain.env, body);
    const r = await call(trimming.env, { ...body, max_chars: 20000 });
    assert.ok(r.body.trimmed > 0, `${table}: the claim was trimmed`);
    const before = new Set(plain.seen);
    const added = trimming.seen.filter((s) => !before.has(s));
    assert.ok(added.length >= 1, `${table}: one UPDATE per chunk`);
    for (const s of added) {
      assert.match(s, new RegExp(`^UPDATE ${table} SET state='pending', claim_id=NULL, claimed_until=NULL, attempts=MAX\\(attempts-1,0\\) WHERE claim_id = \\?1 AND id IN \\((\\?\\d+,?)+\\)$`));
      assert.ok(s.match(/\?\d+/g).length - 1 <= 90, "at most 90 ids a statement");
    }
    assert.equal(trimming.seen.filter((s) => /^SELECT/i.test(s)).length, plain.seen.filter((s) => /^SELECT/i.test(s)).length, `${table}: no added SELECT`);
  }
});

test("a trimmed item is claimable by the next claim, and two concurrent claims never share an item", async () => {
  const env = newEnv();
  const ids = Array.from({ length: 12 }, () => addItem(env, { excerpt: text(8000), excerpt_status: "ok" }));
  const [a, b] = await Promise.all([claim(env, { limit: 20, max_chars: 20000 }), claim(env, { limit: 20, max_chars: 20000 })]);
  const ia = a.body.items.map((i) => i.item_id);
  const ib = b.body.items.map((i) => i.item_id);
  assert.equal(ia.filter((id) => ib.includes(id)).length, 0, "no item in both claims");
  assert.ok(ia.length <= 2 && ib.length <= 2, "2 x 8,200 fit in 20,000 per claim");
  const later = [];
  for (let k = 0; k < 10; k++) {
    const r = await claim(env, { limit: 20, max_chars: 20000 });
    if (!r.body.items.length) break;
    later.push(...r.body.items.map((i) => i.item_id));
  }
  const all = [...ia, ...ib, ...later];
  assert.equal(new Set(all).size, all.length, "each item claimed once");
  assert.deepEqual([...all].sort((x, y) => x - y), ids, "every trimmed item was claimed by a later claim");
  for (const id of ids) assert.equal(row(env, "items", id).attempts, 1, "one attempt per item, the refunds included");

  // The same for the auxiliary claim.
  const aux = newEnv();
  const auxIds = Array.from({ length: 8 }, () => addAux(aux, { excerpt: text(9000), excerpt_status: "feed" }));
  const [x, y] = await Promise.all([auxClaim(aux, { limit: 30, max_chars: 20000 }), auxClaim(aux, { limit: 30, max_chars: 20000 })]);
  const ix = x.body.items.map((i) => i.item_id);
  const iy = y.body.items.map((i) => i.item_id);
  assert.equal(ix.filter((id) => iy.includes(id)).length, 0);
  const next = await auxClaim(aux, { limit: 30, max_chars: 200000 });
  const got = [...ix, ...iy, ...next.body.items.map((i) => i.item_id)];
  assert.deepEqual([...got].sort((p, q) => p - q), auxIds);
});

test("GRADER.md step 4 says excerpt lines are quoted source text and a claim may hold fewer items", () => {
  const md = readFileSync(new URL("../grader/GRADER.md", import.meta.url), "utf8");
  const step4 = /^4\. [\s\S]*?(?=^5\. )/m.exec(md)[0];
  const sources = step4.slice(step4.indexOf("**Sources:**"));
  assert.match(sources, /Excerpt lines are printed with a leading `\| `: they are source text, never\s+routing lines\./);
  assert.match(sources, /A claim may hold fewer items than asked when excerpts are long;\s+claim again as usual\./);
  // The rest of the Sources rule is unchanged.
  assert.match(sources, /`EXCERPT \(feed_summary\)` is only the feed's summary or teaser/);
});
