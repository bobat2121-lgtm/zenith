// Phase 2: the shadow page reader for auxiliary items (worker/src/aux-text.js)
// and the aux claim's show path (AUX_TEXT_SHOW, auxiliary.js auxClaim).
// Synthetic keys, round lengths and .example hosts only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { serveWorker, runGrader } from "./helpers/aux-e2e.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { enrichAuxText, AUX_TEXT_HOLD_MINUTES, AUX_TEXT_PICK_SQL } = await import("../worker/src/aux-text.js");
const { pickText, takeSecLease, releaseSecLease, EXCERPT_CHARS, LEAD_CHARS } = await import("../worker/src/excerpt.js");
const { releaseHeld } = await import("../worker/src/budget.js");
const { TEXT_BUDGET } = await import("../worker/src/text-class.js");
const { default: COVERED } = await import("../worker/src/covered.json");

const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const fig = (k) => `Line ${k} says the crew shipped ${k * 10 + 7} trackers worth $${k}.5 million to the field this term.`;
const body = (chars, from = 1) => {
  const out = [];
  let k = from;
  while (out.join(" ").length < chars) out.push(fig(k++));
  return out.join(" ");
};

let nm = 1;
// One aux_items row; over sets any column. Default: a pending issuer row (managed_* key) ingested an hour ago.
function addAux(db, over = {}) {
  const now = Date.now();
  const r = {
    nm_rowid: nm++, source_key: "managed_widget_news", entity_key: "widget", entity_name: "Widget", status: "unknown",
    url: `https://ir.widget${nm}.example/news/${nm}`, title: `Widget Corp ships trackers ${nm}`, nm_first_seen: iso(now - 60 * MIN), ingested_at: iso(now - 60 * MIN),
    state: "pending", excerpt: null, excerpt_status: null, admit: null, released_at: null, claim_id: null, claimed_until: null,
    page_excerpt: null, page_status: null, page_tries: 0, page_next_at: null, ...over,
  };
  const cols = Object.keys(r);
  return Number(db.db.prepare(`INSERT INTO aux_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => r[c])).lastInsertRowid);
}
const page = (db, id) => ({ ...db.rows("SELECT excerpt, excerpt_status, page_excerpt, page_status, page_tries, page_next_at, page_at, page_cap FROM aux_items WHERE id = ?", id)[0] });

// Answers by URL: a release page for any .example host unless a handler says otherwise.
const releaseHtml = (title, n = 19_000) => `<html><body><h1>${title}</h1><p>${title}. ${body(n)}</p></body></html>`;
async function withFetch(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    calls.push(url);
    const out = await handler(url, init, calls.length);
    if (out instanceof Response) return out;
    return new Response(out ?? releaseHtml("Widget Corp ships trackers"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try { return await run(calls); } finally { globalThis.fetch = real; }
}

// A D1 wrapper that counts calls that reach the database (all, first, run, batch).
function counting(db) {
  const n = { calls: 0, sql: [] };
  const wrap = (stmt, sql) => ({
    bind: (...a) => wrap(stmt.bind(...a), sql),
    all: () => { n.calls++; n.sql.push(sql); return stmt.all(); },
    first: (c) => { n.calls++; n.sql.push(sql); return stmt.first(c); },
    run: () => { n.calls++; n.sql.push(sql); return stmt.run(); },
    runSync: () => stmt.runSync(),
  });
  return { n, db: { prepare: (sql) => wrap(db.prepare(sql), sql), batch: (s) => { n.calls++; return db.batch(s.map((x) => ({ runSync: x.runSync }))); } } };
}

// --- A24: the pick -----------------------------------------------------------------------------------
test("A24: the pick takes only waiting rows with no feed text and no page status; press rows are marked skipped_class with no fetch", async () => {
  const db = zenithDb();
  const now = Date.now();
  const ok = addAux(db);
  const expired = addAux(db, { state: "claimed", claim_id: "c1", claimed_until: iso(now - MIN) });
  const live = addAux(db, { state: "claimed", claim_id: "c2", claimed_until: iso(now + 30 * MIN) });
  const skipped = addAux(db, { state: "skipped", skip_reason: "stale_on_arrival" });
  const held = addAux(db, { admit: "seed_fresh" });
  const graded = addAux(db, { state: "graded" });
  const feed = addAux(db, { excerpt: "feed text", excerpt_status: "feed" });
  const wargov = addAux(db, { source_key: "wargov_contracts", entity_key: "wargov_contracts", url: "https://www.war.gov/News/Contracts/Contract/Article/1/" });
  const done = addAux(db, { page_status: "http_404" });
  const later = addAux(db, { page_tries: 1, page_next_at: iso(now + 10 * MIN) });
  const press = addAux(db, { source_key: "search_widget_mentions", url: "https://press.example/story/1" });
  const r = await withFetch(() => null, (calls) => enrichAuxText({ DB: db }, { now }).then((x) => ({ ...x, calls: [...calls] })));
  assert.equal(r.tried, 2);
  assert.equal(r.ok, 2);
  assert.equal(r.skipped_class, 1);
  assert.equal(r.calls.length, 2, "one fetch each for the two waiting issuer rows");
  for (const id of [ok, expired]) assert.equal(page(db, id).page_status, "ok", `row ${id}`);
  for (const id of [live, skipped, held, graded, feed, wargov, later]) assert.equal(page(db, id).page_status, null, `row ${id} is not picked`);
  assert.equal(page(db, done).page_status, "http_404");
  assert.deepEqual([page(db, press).page_status, page(db, press).page_excerpt], ["skipped_class", null]);
  assert.ok(!r.calls.some((u) => u.includes("press.example")), "a press row is never fetched");
  assert.match(AUX_TEXT_PICK_SQL, /WHERE state IN \('pending','claimed'\)/, "the leading state term uses aux_items_state");
});

test("A24: AUX_TEXT_PRESS=1 reads press rows; AUX_TEXT_PER_TICK caps fetches; one row per registrable domain a tick; a no-fetch host is skipped_policy with no request", async () => {
  let db = zenithDb();
  const press = addAux(db, { source_key: "search_widget_mentions", url: "https://press.example/story/2" });
  await withFetch(() => null, () => enrichAuxText({ DB: db, AUX_TEXT_PRESS: "1" }));
  assert.equal(page(db, press).page_status, "ok");
  assert.equal(page(db, press).page_cap, TEXT_BUDGET.press);

  db = zenithDb();
  const ids = Array.from({ length: 8 }, () => addAux(db));
  let r = await withFetch(() => null, (calls) => enrichAuxText({ DB: db }).then((x) => ({ ...x, n: calls.length })));
  assert.deepEqual([r.tried, r.n], [4, 4], "AUX_TEXT_PER_TICK defaults to 4");
  r = await withFetch(() => null, (calls) => enrichAuxText({ DB: db, AUX_TEXT_PER_TICK: "2" }).then((x) => ({ ...x, n: calls.length })));
  assert.deepEqual([r.tried, r.n], [2, 2]);
  assert.equal(ids.filter((id) => page(db, id).page_status === "ok").length, 6);

  db = zenithDb();
  const a = addAux(db, { url: "https://ir.samehost.example/news/1" });
  const b = addAux(db, { url: "https://www.samehost.example/news/2" });
  r = await withFetch(() => null, (calls) => enrichAuxText({ DB: db }).then((x) => ({ ...x, n: calls.length })));
  assert.equal(r.n, 1, "one fetch per registrable domain a tick");
  assert.equal([a, b].filter((id) => page(db, id).page_status === "ok").length, 1);
  await withFetch(() => null, () => enrichAuxText({ DB: db }));
  assert.equal([a, b].filter((id) => page(db, id).page_status === "ok").length, 2, "the other one on the next tick");

  db = zenithDb();
  const blockedHost = addAux(db, { url: "https://news.blocked.example/1" });
  const reuters = addAux(db, { url: "https://www.reuters.com/business/x" });
  r = await withFetch(() => null, (calls) => enrichAuxText({ DB: db }, { noFetchHosts: ["blocked.example", "reuters.com"] }).then((x) => ({ ...x, calls: [...calls] })));
  assert.equal(r.calls.length, 0, "the fetch stub is never called");
  assert.equal(r.policy, 2);
  for (const id of [blockedHost, reuters]) assert.deepEqual([page(db, id).page_status, page(db, id).page_tries], ["skipped_policy", 0]);
  // The default list holds reuters.com.
  db = zenithDb();
  const def = addAux(db, { url: "https://www.reuters.com/markets/y" });
  await withFetch(() => { throw new Error("no fetch"); }, () => enrichAuxText({ DB: db }));
  assert.equal(page(db, def).page_status, "skipped_policy");
});

test("A24: AUX_TEXT_PER_TICK=0 makes no query and no fetch; a held row is read right after releaseHeld releases it", async () => {
  const db = zenithDb();
  const id = addAux(db, { admit: "seed_fresh" });
  const c = counting(db);
  const off = await withFetch(() => null, (calls) => enrichAuxText({ DB: c.db, AUX_TEXT_PER_TICK: "0" }).then((x) => ({ ...x, n: calls.length })));
  assert.deepEqual(off, { off: true, n: 0 });
  assert.equal(c.n.calls, 0, "no D1 call");
  await withFetch(() => null, () => enrichAuxText({ DB: db }));
  assert.equal(page(db, id).page_status, null, "held: not read");
  const rel = await releaseHeld({ DB: db });
  assert.equal(rel.released?.aux ?? db.rows("SELECT COUNT(*) n FROM aux_items WHERE released_at IS NOT NULL")[0].n, 1);
  await withFetch(() => null, () => enrichAuxText({ DB: db }));
  assert.equal(page(db, id).page_status, "ok", "released: read in the same tick");
});

// --- A25: the write guard ----------------------------------------------------------------------------
test("A25: a row claimed under a live lease, or graded, while its page was read keeps no page text", async () => {
  const db = zenithDb();
  const leased = addAux(db, { url: "https://ir.lease.example/1" });
  const graded = addAux(db, { url: "https://ir.graded.example/2" });
  const free = addAux(db, { url: "https://ir.free.example/3" });
  await withFetch((url) => {
    if (url.includes("lease.example")) db.db.prepare("UPDATE aux_items SET state = 'claimed', claim_id = 'x', claimed_until = ? WHERE id = ?").run(iso(Date.now() + 30 * MIN), leased);
    if (url.includes("graded.example")) db.db.prepare("UPDATE aux_items SET state = 'graded' WHERE id = ?").run(graded);
    return null;
  }, () => enrichAuxText({ DB: db }));
  for (const id of [leased, graded]) assert.deepEqual([page(db, id).page_status, page(db, id).page_excerpt], [null, null], `row ${id}`);
  assert.equal(page(db, free).page_status, "ok");
});

// --- A26: outcomes -----------------------------------------------------------------------------------
test("A26: 200 is ok at the class budget; a 403 is retried once 20 minutes later; a 503 at 20, 120, 720 minutes, final after 4 tries", async () => {
  const db = zenithDb();
  const issuer = addAux(db, { url: "https://ir.okhost.example/1" });
  const record = addAux(db, { source_key: "agency_notices", entity_key: "agency", url: "https://www.agency.gov/news/1" });
  const refused = addAux(db, { url: "https://ir.refuse.example/1" });
  const down = addAux(db, { url: "https://ir.down.example/1" });
  const handler = (url) => (url.includes("refuse.example") ? new Response("no", { status: 403 })
    : url.includes("down.example") ? new Response("down", { status: 503 }) : null);
  let now = Date.now();
  const counts = (r) => [r.tried, r.ok, r.retry, r.blocked, r.sec_deferred];
  let r = await withFetch(handler, () => enrichAuxText({ DB: db }, { now }));
  assert.deepEqual(counts(r), [4, 2, 2, 0, 0], "tried, ok, retry (scheduled), blocked, sec_deferred");
  assert.equal(page(db, issuer).page_status, "ok");
  assert.equal(page(db, issuer).page_cap, 6000);
  assert.ok(page(db, issuer).page_excerpt.length > EXCERPT_CHARS && page(db, issuer).page_excerpt.length <= 6000, "captured at the issuer budget");
  assert.equal(page(db, record).page_cap, 8000);
  assert.ok(page(db, issuer).page_at);
  const wait = (id) => Math.round((Date.parse(page(db, id).page_next_at) - now) / MIN);
  assert.deepEqual([page(db, refused).page_status, page(db, refused).page_tries, wait(refused)], [null, 1, 20]);
  assert.deepEqual([page(db, down).page_status, page(db, down).page_tries, wait(down)], [null, 1, 20]);
  now += 21 * MIN;
  r = await withFetch(handler, () => enrichAuxText({ DB: db }, { now }));
  assert.deepEqual(counts(r), [2, 0, 1, 0, 0], "a final http_403 is tried, not a retry");
  assert.deepEqual([page(db, refused).page_status, page(db, refused).page_tries, page(db, refused).page_excerpt], ["http_403", 2, null], "a 403 is final on its second try");
  assert.deepEqual([page(db, down).page_tries, wait(down)], [2, 120]);
  now += 121 * MIN;
  await withFetch(handler, () => enrichAuxText({ DB: db }, { now }));
  assert.deepEqual([page(db, down).page_tries, wait(down)], [3, 720]);
  now += 721 * MIN;
  r = await withFetch(handler, () => enrichAuxText({ DB: db }, { now }));
  assert.deepEqual(counts(r), [1, 0, 0, 0, 0], "the 4th 503 is final, not a retry");
  assert.deepEqual([page(db, down).page_status, page(db, down).page_tries], ["http_503", 4], "final after 4 tries");
});

test("A26: a PDF URL is skipped_binary with no download; a block page is retried once, then blocked; sec.gov without CONTACT_EMAIL waits 720 minutes without a try", async () => {
  const db = zenithDb();
  const pdf = addAux(db, { url: "https://ir.pdfhost.example/files/deck.pdf" });
  const block = addAux(db, { url: "https://ir.blockhost.example/1" });
  const sec = addAux(db, { source_key: "widget_filings", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000001/x.htm" });
  const handler = (url) => (url.includes("blockhost") ? `<html><body><h1>Attention Required! | Cloudflare</h1><p>Sorry, you have been blocked</p></body></html>` : null);
  let now = Date.now();
  let r;
  const calls = await withFetch(handler, async (c) => { r = await enrichAuxText({ DB: db }, { now }); return [...c]; });
  assert.deepEqual([r.tried, r.retry, r.blocked, r.sec_deferred], [2, 1, 0, 1], "a sec.gov row with no contact address makes no request: sec_deferred, not tried");
  assert.ok(!calls.some((u) => u.endsWith(".pdf")), "the PDF is never requested");
  assert.ok(!calls.some((u) => u.includes("sec.gov")), "no sec.gov request without a contact address");
  assert.equal(page(db, pdf).page_status, "skipped_binary");
  assert.deepEqual([page(db, block).page_status, page(db, block).page_tries], [null, 1]);
  assert.deepEqual([page(db, sec).page_status, page(db, sec).page_tries], [null, 0]);
  assert.equal(Math.round((Date.parse(page(db, sec).page_next_at) - now) / MIN), 720);
  now += 21 * MIN;
  r = await withFetch(handler, () => enrichAuxText({ DB: db }, { now }));
  assert.deepEqual([r.tried, r.retry, r.blocked], [1, 0, 1]);
  assert.equal(page(db, block).page_status, "blocked");
  assert.equal(page(db, block).page_excerpt, null);
});

// --- A27: sec.gov ------------------------------------------------------------------------------------
const SEC_HTML = `<html><body><p>FORM 8-K</p><p>Item 8.01 Other Events.</p><p>${body(3_000)}</p><p>SIGNATURES</p></body></html>`;
test("A27: at most one sec.gov row a tick; none while the SEC lease is held, and those are read on a later tick", async () => {
  const db = zenithDb();
  const env = { DB: db, CONTACT_EMAIL: "ops@example.org" };
  const secs = [1, 2, 3].map((k) => addAux(db, { source_key: "widget_filings", url: `https://www.sec.gov/Archives/edgar/data/1/00000000000000000${k}/doc${k}.htm` }));
  const handler = (url) => (url.includes("sec.gov") ? SEC_HTML : null);
  const now = Date.now();
  assert.equal(await takeSecLease(db, iso(now)), true);
  let r = await withFetch(handler, () => enrichAuxText(env, { now }));
  assert.deepEqual([r.tried, r.sec_deferred], [0, 3], "the lease holder has sec.gov to itself");
  await releaseSecLease(db);
  r = await withFetch(handler, () => enrichAuxText(env, { now }));
  assert.deepEqual([r.tried, r.sec_deferred], [1, 0], "one sec.gov row (the others share its domain and wait)");
  assert.equal(secs.filter((id) => page(db, id).page_status === "ok").length, 1);
  await withFetch(handler, () => enrichAuxText(env, { now }));
  assert.equal(secs.filter((id) => page(db, id).page_status === "ok").length, 2);
});

// --- A28: the subrequest bound -----------------------------------------------------------------------
test("A28: 40 eligible rows on 40 domains, with Federal Register and sec.gov rows: at most 2 x 4 + 2 page fetches and 3 D1 calls", async () => {
  const db = zenithDb();
  const now = Date.now();
  for (let k = 0; k < 36; k++) addAux(db, { url: `https://ir.host${k}.example/news/${k}`, nm_first_seen: iso(now - (100 + k) * MIN) });
  for (let k = 0; k < 2; k++) addAux(db, { source_key: "agency_notices", url: `https://www.federalregister.gov/documents/2030/01/0${k + 1}/X${k}-00001/sample-rule`, nm_first_seen: iso(now - k * MIN) });
  for (let k = 0; k < 2; k++) addAux(db, { source_key: "widget_filings", url: `https://www.sec.gov/Archives/edgar/data/${k + 1}/00000000000000000${k + 1}/d${k}.htm`, nm_first_seen: iso(now - (2 + k) * MIN) });
  const fr = JSON.stringify({ document_number: "X0-00001", type: "Rule", action: "Final rule.", publication_date: "2030-01-01", abstract: body(1_000) });
  const handler = (url) => {
    if (url.includes("/api/v1/documents/")) return new Response(fr, { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("govinfo.gov")) return `<html><body><pre>SUPPLEMENTARY INFORMATION: ${body(4_000)}</pre></body></html>`;
    if (url.includes("sec.gov")) return `<html><body><p>Item 8.01 Other Events.</p><p>${body(2_000)} See Exhibit 99.1.</p></body></html>`;
    return null;
  };
  const c = counting(db);
  const r = await withFetch(handler, (calls) => enrichAuxText({ DB: c.db, CONTACT_EMAIL: "ops@example.org" }, { now }).then((x) => ({ ...x, n: calls.length })));
  assert.ok(r.n <= 2 * 4 + 2, `page fetches ${r.n}`);
  assert.ok(r.n > 4, "Federal Register and sec.gov rows take more than one fetch");
  assert.equal(r.tried, 4);
  assert.ok(c.n.calls <= 3, `D1 calls ${c.n.calls}: ${c.n.sql.join(" | ")}`);
});

// --- A21 / A22 / A23: what the grader sees -----------------------------------------------------------
const claim = (env, body = { limit: 40 }) => request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body });

test("A21: shadow (AUX_TEXT_SHOW unset): the page text is stored, the claim carries none, the CLI prints the no-feed-text line, and excerpt_status is never ok", async () => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  const id = addAux(env.DB, { title: "Widget Corp ships trackers" });
  await withFetch(() => null, () => enrichAuxText(env));
  const p = page(env.DB, id);
  assert.equal(p.page_status, "ok");
  assert.ok(p.page_excerpt.length > EXCERPT_CHARS);
  assert.deepEqual([p.excerpt, p.excerpt_status], [null, null]);
  assert.equal(env.DB.rows("SELECT COUNT(*) n FROM aux_items WHERE excerpt_status = 'ok'")[0].n, 0);
  // The app's feed snippet reads excerpt only.
  const feed = await request(worker, env, "GET", "/v1/aux/feed?order=newest", { role: "app" });
  const card = feed.body.items.find((x) => x.item_id === id);
  assert.equal(card.snippet, null);
  // The real grader CLI against the Worker.
  const srv = await serveWorker(worker, env);
  const cwd = mkdtempSync(join(tmpdir(), "zenith-aux-text-"));
  try {
    const out = await runGrader(["aux-claim", "40"], { api: srv.url, token: TOKENS.GRADER_TOKEN, cwd });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /EXCERPT: none \(no feed text\)/);
    assert.ok(!out.stdout.includes(fig(5)), "no page text in the printout");
    const c = JSON.parse(readFileSync(join(cwd, ".zenith", "aux-claim.json"), "utf8"));
    const it = c.items.find((x) => x.item_id === id);
    assert.deepEqual([it.excerpt, it.excerpt_status], [null, null]);
    assert.ok(!Object.keys(it).some((k) => k.startsWith("page_")));
  } finally {
    await srv.close();
    rmSync(cwd, { recursive: true, force: true });
  }
  // The headline pass reads excerpt only.
  assert.doesNotMatch(readFileSync(new URL("../worker/src/headlines.js", import.meta.url), "utf8"), /page_/);
});

test("A22: AUX_TEXT_SHOW=1: the claim shows the page text as the excerpt (cut to 2,500 while TEXT_BUDGETS is legacy) with no page_* key", async () => {
  const env = { DB: zenithDb(), ...TOKENS, AUX_TEXT_SHOW: "1" };
  const id = addAux(env.DB, { page_excerpt: body(5_900), page_status: "ok", page_cap: 6000 });
  const feedRow = addAux(env.DB, { excerpt: "Feed text of the release. ".repeat(20), excerpt_status: "feed", page_status: null });
  const r = await claim(env);
  const it = r.body.items.find((x) => x.item_id === id);
  assert.equal(it.excerpt_status, "ok");
  assert.equal(it.excerpt, pickText(body(5_900), EXCERPT_CHARS, LEAD_CHARS));
  assert.ok(it.excerpt.length <= EXCERPT_CHARS);
  for (const x of r.body.items) assert.ok(!Object.keys(x).some((k) => k.startsWith("page_")), "no page_* key");
  assert.equal(r.body.items.find((x) => x.item_id === feedRow).excerpt_status, "feed", "feed text wins");

  const env2 = { DB: zenithDb(), ...TOKENS, AUX_TEXT_SHOW: "1", TEXT_BUDGETS: "class" };
  const id2 = addAux(env2.DB, { page_excerpt: body(5_900), page_status: "ok", page_cap: 6000 });
  const it2 = (await claim(env2)).body.items.find((x) => x.item_id === id2);
  assert.equal(it2.excerpt, body(5_900), "with TEXT_BUDGETS=class the stored class-budget text");
});

test("A22: the hold: with AUX_TEXT_SHOW=1 an unread row waits 45 minutes from release (else ingest); war.gov still waits 180; AUX_TEXT_PER_TICK=0 lifts it", async () => {
  assert.equal(AUX_TEXT_HOLD_MINUTES, 45);
  const now = Date.now();
  const seed = (db) => ({
    fresh: addAux(db, { ingested_at: iso(now - 10 * MIN), nm_first_seen: iso(now - 10 * MIN) }),
    aged: addAux(db, { ingested_at: iso(now - 46 * MIN), nm_first_seen: iso(now - 46 * MIN) }),
    released: addAux(db, { ingested_at: iso(now - 120 * MIN), admit: "seed_fresh", released_at: iso(now - 10 * MIN) }),
    read: addAux(db, { ingested_at: iso(now - 5 * MIN), page_status: "http_404" }),
    wargov: addAux(db, { source_key: "wargov_contracts", entity_key: "wargov_contracts", url: "https://www.war.gov/News/Contracts/Contract/Article/9/",
      ingested_at: iso(now - 60 * MIN), nm_first_seen: iso(now - 60 * MIN) }),
  });
  let env = { DB: zenithDb(), ...TOKENS, AUX_TEXT_SHOW: "1" };
  let ids = seed(env.DB);
  let r = await claim(env);
  let got = new Set(r.body.items.map((x) => x.item_id));
  assert.ok(got.has(ids.aged), "46 minutes: claimed");
  assert.ok(got.has(ids.read), "a row whose read is final is never held");
  assert.ok(!got.has(ids.fresh), "10 minutes: held for its read");
  assert.ok(!got.has(ids.released), "a released row is timed from released_at");
  assert.ok(!got.has(ids.wargov), "a war.gov digest still waits 180 minutes");
  assert.equal(r.body.remaining, 1, "only the war.gov digest counts as waiting; text-held rows do not");

  env = { DB: zenithDb(), ...TOKENS, AUX_TEXT_SHOW: "1", AUX_TEXT_PER_TICK: "0" };
  ids = seed(env.DB);
  got = new Set((await claim(env)).body.items.map((x) => x.item_id));
  assert.ok(got.has(ids.fresh) && got.has(ids.released), "AUX_TEXT_PER_TICK=0 lifts the hold");
  assert.ok(!got.has(ids.wargov));
});

test("A23: default env: a row ingested now with no text is claimed at once, and the claim payload keys are unchanged", async () => {
  const env = { DB: zenithDb(), ...TOKENS };
  const id = addAux(env.DB, { ingested_at: iso(Date.now()), nm_first_seen: iso(Date.now()), page_excerpt: body(3_000), page_status: "ok" });
  const r = await claim(env);
  const it = r.body.items.find((x) => x.item_id === id);
  assert.ok(it, "no hold by default");
  assert.deepEqual([it.excerpt, it.excerpt_status], [null, null], "stored page text is not shown by default");
  assert.deepEqual(Object.keys(it).sort(), ["admit", "affects", "coverage_subject", "entity_key", "entity_name", "excerpt", "excerpt_status", "first_seen",
    "item_id", "published", "record", "seen_after_days", "source_key", "status", "title", "url"]);
});

// --- A31: nothing new reaches Discord ----------------------------------------------------------------
test("A31: the aux reader and a full cron tick make no Discord request; deliveries, incidents and reports stay 0; aux-text.js and text-class.js reach neither delivery.js nor discord.js; covered.json gains no sources or counterparty key", async () => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  addAux(env.DB);
  addAux(env.DB, { source_key: "agency_notices", url: "https://www.agency.gov/news/2" });
  const keys = () => ({ sources: Object.keys(COVERED.sources).sort(), counterparty: Object.keys(COVERED.counterparty).sort() });
  const before = keys();
  const calls = await withFetch(() => null, async (c) => {
    await enrichAuxText(env);
    const waits = [];
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return [...c];
  });
  assert.ok(calls.length >= 2);
  assert.ok(!calls.some((u) => /discord(app)?\.com/i.test(u)), calls.join(", "));
  // No fast lane: the rows the reader read are under no covered or counterparty key, and the run adds none.
  assert.deepEqual(keys(), before);
  for (const k of ["managed_widget_news", "agency_notices"]) assert.ok(!(k in COVERED.sources) && !(k in COVERED.counterparty), k);
  assert.deepEqual({ ...env.DB.rows("SELECT (SELECT COUNT(*) FROM deliveries) d, (SELECT COUNT(*) FROM incidents) i, (SELECT COUNT(*) FROM reports) r")[0] }, { d: 0, i: 0, r: 0 });
  const SRC = new URL("../worker/src/", import.meta.url);
  for (const f of ["aux-text.js", "text-class.js"]) {
    const seen = new Set();
    const walk = (m) => {
      if (seen.has(m)) return;
      seen.add(m);
      for (const x of readFileSync(new URL(m, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) walk(x[1]);
    };
    walk(f);
    assert.ok(seen.size > 1);
    assert.ok(!seen.has("delivery.js") && !seen.has("discord.js"), `${f} reaches ${[...seen].join(", ")}`);
  }
  assert.doesNotMatch(readFileSync(new URL("aux-text.js", SRC), "utf8"), /\bfetch\(/, "aux-text.js fetches only through excerpt.js");
  // covered.json changes only through npm run sync:covered: neither module writes it or assigns a key in it.
  for (const f of ["aux-text.js", "text-class.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, SRC), "utf8"), /sync-covered|writeFile|COVERED\.(?:sources|counterparty)\b[^;\n]*[^=!<>]=[^=]/, f);
  }
});
