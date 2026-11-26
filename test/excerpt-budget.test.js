// Phase 2: excerpt budgets by text class (worker/src/excerpt.js, text-class.js).
// The default (TEXT_BUDGETS unset) is byte-identical to the 2,500-character
// reader; TEXT_BUDGETS=class sizes visible excerpts by class. Synthetic text,
// round lengths and .example hosts only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";

hookJsonImports();
const EX = await import("../worker/src/excerpt.js");
const { fedregExcerpt, excerptFrom, excerptInfo, secExcerpt, secBody, cutTail, pickText, htmlToText, firstHeading, feedText, pdfExcerpt, enrich,
  EXCERPT_CHARS, UNANCHORED_CHARS, LEAD_CHARS } = EX;
const { feedFields, ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { enrichAuxWargov } = await import("../worker/src/wargov.js");
const { default: COVERED } = await import("../worker/src/covered.json");

// A sentence that carries figures (money and a count), about 100 characters.
const fig = (k) => `Line ${k} says the crew shipped ${k * 10 + 7} trackers worth $${k}.5 million to the field this term.`;
const body = (chars, from = 1) => {
  const out = [];
  let k = from;
  while (out.join(" ").length < chars) out.push(fig(k++));
  return out.join(" ");
};
const TITLE = "Widget Corp ships autonomous trackers";
const RELEASE = `${TITLE}\n${body(19_000)}`;

async function withFetch(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init) => { calls.push(String(u)); return handler(String(u), init); };
  try { return await run(calls); } finally { globalThis.fetch = real; }
}
const html = (h1, text) => new Response(`<html><body>${h1 ? `<h1>${h1}</h1>` : ""}<p>${text}</p></body></html>`,
  { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

test("A17: Federal Register: at the default no supplementary text once head + abstract pass the budget (as today); at 8,000 head, abstract and supplementary sentences", () => {
  const rec = { type: "Rule", action: "Final rule.", agencies: [{ name: "Example Agency" }], dates: "Effective on a later date.", abstract: body(3_000) };
  const supp = body(30_000, 500);
  const head = "Rule: Final rule.\nAgency: Example Agency\nDates: Effective on a later date.";
  const today = [head, rec.abstract.replace(/\s+/g, " ").trim()].join("\n").slice(0, EXCERPT_CHARS).trim();
  assert.equal(fedregExcerpt(rec, supp), today, "the default is byte-identical to the 2,500 reader");
  assert.equal(fedregExcerpt(rec, supp, EXCERPT_CHARS), today);
  assert.doesNotMatch(fedregExcerpt(rec, supp), /Line 5\d\d /, "no supplementary sentence at the default");
  const big = fedregExcerpt(rec, supp, 8000);
  assert.ok(big.length <= 8000 && big.length > 6000, `8,000 budget: ${big.length}`);
  assert.ok(big.startsWith(head), "the record's head first");
  assert.ok(big.includes(rec.abstract.slice(0, 200)), "then the abstract");
  assert.match(big, /Line 5\d\d /, "then supplementary sentences");
});

test("A18: excerptFrom: an anchored release at 6,000 keeps 5,800-6,000 chars, lead first; an unanchored page keeps at most 2,500 at any budget", () => {
  const info = excerptInfo(RELEASE, TITLE, "", 6000);
  assert.equal(info.anchored, true);
  assert.equal(info.cap, 6000);
  assert.ok(info.excerpt.length >= 5800 && info.excerpt.length <= 6000, `anchored at 6,000: ${info.excerpt.length}`);
  assert.ok(info.excerpt.startsWith(`${TITLE}\n${fig(1)}`), "the lead first");
  assert.equal(excerptFrom(RELEASE, TITLE, "", 6000), info.excerpt);
  // The default is today's reader: the lead and figures within 2,500.
  assert.equal(excerptFrom(RELEASE, TITLE), pickText(cutTail(RELEASE), EXCERPT_CHARS, LEAD_CHARS));
  assert.equal(excerptInfo(RELEASE, TITLE).cap, EXCERPT_CHARS);

  const page = `Menu Home Products Careers\n${body(150_000)}`;
  for (const budget of [EXCERPT_CHARS, 6000, 8000]) {
    const u = excerptInfo(page, "Quarterly vessel delivery update", "", budget);
    assert.equal(u.anchored, false);
    assert.equal(u.cap, UNANCHORED_CHARS);
    assert.ok(u.excerpt.length <= UNANCHORED_CHARS, `unanchored at ${budget}: ${u.excerpt.length}`);
  }
  assert.equal(excerptFrom(page, "Quarterly vessel delivery update"), pickText(page.trim()), "the default unanchored excerpt is today's");
});

test("A19: secExcerpt at 8,000: filing text up to 1,500, then EX-99.1 and the exhibit, within 8,000; the default is today's text", () => {
  const filing = `UNITED STATES\nFORM 8-K\nItem 8.01 Other Events.\n${body(6_000, 900)}\nSIGNATURES\nBy: an officer`;
  const exhibit = `${TITLE}\n${body(20_000, 2000)}`;
  const big = secExcerpt(filing, exhibit, 8000);
  const [head, ex] = big.split("\nEX-99.1: ");
  assert.ok(head.length <= 1500 && head.length > 800, `filing text ${head.length}`);
  assert.ok(ex && ex.length > 2500, "the exhibit fills the rest");
  assert.ok(big.length <= 8000, `total ${big.length}`);
  // Today's formula, written out: Item text in 800 (lead 400), the exhibit in the rest of 2,500.
  const oldHead = pickText(secBody(filing), 800, 400);
  const today = `${oldHead}\nEX-99.1: ${pickText(cutTail(exhibit), EXCERPT_CHARS - oldHead.length - "EX-99.1: ".length - 1)}`.trim();
  assert.equal(secExcerpt(filing, exhibit), today);
  assert.equal(secExcerpt(filing, ""), pickText(secBody(filing)), "no exhibit: the filing text, as today");
  assert.ok(secExcerpt(filing, "", 8000).length > 2500);
});

test("pdfExcerpt and feedText take a budget; their defaults are today's", () => {
  const pages = [`Widget Corp investor deck`, body(9_000, 3000), body(9_000, 4000)];
  assert.ok(pdfExcerpt(pages).length <= EXCERPT_CHARS);
  assert.equal(pdfExcerpt(pages), pdfExcerpt(pages, EXCERPT_CHARS));
  assert.ok(pdfExcerpt(pages, 6000).length > EXCERPT_CHARS);
  const feed = `${TITLE}\n${body(5_000)}`;
  assert.ok(feedText(feed, TITLE).excerpt.length <= EXCERPT_CHARS);
  assert.ok(feedText(feed, TITLE, 6000).excerpt.length > EXCERPT_CHARS);
  assert.equal(feedText(feed, TITLE, 6000).full, true);
  const r = { body: feed, title: TITLE };
  assert.deepEqual(feedFields(r, { role: null }, "now"), feedFields(r, { role: null }, "now", { budget: EXCERPT_CHARS }));
  assert.ok(feedFields(r, { role: null }, "now", { budget: 6000 }).excerpt.length > EXCERPT_CHARS);
});

// --- enrich (A20) --------------------------------------------------------------------------------
let rowid = 1;
function addItem(db, { source_key, url, title }) {
  const now = new Date().toISOString();
  return Number(db.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state)
    VALUES (?, ?, 'SYN', ?, ?, ?, ?, 'pending')`).run(rowid++, source_key, url, title, now, now).lastInsertRowid);
}
const UNANCHORED_TITLE = "Quarterly vessel delivery update";
const PAGES = {
  "https://ir.widget.example/news/1": [TITLE, body(19_000)],
  "https://press.example/story/2": ["Widget Corp trackers reach the field", `Widget Corp trackers reach the field. ${body(19_000, 300)}`],
  "https://ir.widget.example/news/3": ["", body(150_000, 600)],
};
async function enrichOnce(env) {
  const ids = {
    issuer: addItem(env.DB, { source_key: "managed_widget_news", url: "https://ir.widget.example/news/1", title: TITLE }),
    press: addItem(env.DB, { source_key: "search_widget_mentions", url: "https://press.example/story/2", title: "Widget Corp trackers reach the field" }),
    unanchored: addItem(env.DB, { source_key: "managed_widget_news", url: "https://ir.widget.example/news/3", title: UNANCHORED_TITLE }),
  };
  await withFetch((u) => (PAGES[u] ? html(...PAGES[u]) : new Response("nope", { status: 404 })), () => enrich(env));
  const row = (id) => ({ ...env.DB.rows("SELECT excerpt, excerpt_status, excerpt_cap FROM items WHERE id = ?", id)[0] });
  return Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, row(id)]));
}
const todays = (url, title) => {
  const [h1, text] = PAGES[url];
  const page = `<html><body>${h1 ? `<h1>${h1}</h1>` : ""}<p>${text}</p></body></html>`;
  return excerptFrom(htmlToText(page), title, firstHeading(page));
};

test("A20: enrich with TEXT_BUDGETS unset: every excerpt is today's (at most 2,500), excerpt_cap 2,500", async () => {
  const r = await enrichOnce({ DB: zenithDb() });
  for (const [k, x] of Object.entries(r)) {
    assert.equal(x.excerpt_status, "ok", k);
    assert.ok(x.excerpt.length <= EXCERPT_CHARS, `${k}: ${x.excerpt.length}`);
    assert.equal(x.excerpt_cap, EXCERPT_CHARS, k);
  }
  assert.equal(r.issuer.excerpt, todays("https://ir.widget.example/news/1", TITLE));
  assert.equal(r.press.excerpt, todays("https://press.example/story/2", "Widget Corp trackers reach the field"));
  assert.equal(r.unanchored.excerpt, todays("https://ir.widget.example/news/3", UNANCHORED_TITLE));
});

test("A20: enrich with TEXT_BUDGETS=class: an issuer page up to 6,000 (cap 6,000), a press page and an unanchored issuer page at 2,500", async () => {
  const r = await enrichOnce({ DB: zenithDb(), TEXT_BUDGETS: "class" });
  assert.ok(r.issuer.excerpt.length > EXCERPT_CHARS && r.issuer.excerpt.length <= 6000, `issuer ${r.issuer.excerpt.length}`);
  assert.equal(r.issuer.excerpt_cap, 6000);
  assert.ok(r.press.excerpt.length <= EXCERPT_CHARS);
  assert.equal(r.press.excerpt_cap, 2500);
  assert.ok(r.unanchored.excerpt.length <= UNANCHORED_CHARS);
  assert.equal(r.unanchored.excerpt_cap, UNANCHORED_CHARS);
});

// --- Feed ingests (A29) --------------------------------------------------------------------------
let nmN = 0;
function nmRow(news, { source_key, url, title, body: text }) {
  const seen = new Date().toISOString();
  news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified, body) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)")
    .run(source_key, url ?? `https://news.widget.example/${++nmN}`, title, seen, seen, text);
}
function feedEnv(extra = {}) {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const db = zenithDb();
  for (const k of ["aux_nm_cursor", "nm_cursor"]) db.db.prepare("INSERT INTO meta (key, value) VALUES (?, '0')").run(k);
  return { DB: db, NEWS: news, ...extra };
}
const FEED = `${TITLE}\n${body(5_000)}`;

test("A29: aux ingest: an issuer feed carrying a 5,000-char release stores a feed excerpt within 2,500 by default and up to 6,000 with TEXT_BUDGETS=class; a teaser stores nothing", async () => {
  for (const [extra, check] of [[{}, (n) => n <= EXCERPT_CHARS], [{ TEXT_BUDGETS: "class" }, (n) => n > EXCERPT_CHARS && n <= 6000]]) {
    const env = feedEnv(extra);
    nmRow(env.NEWS, { source_key: "managed_widget_news", title: TITLE, body: FEED });
    nmRow(env.NEWS, { source_key: "managed_widget_news", title: "Widget Corp opens a depot", body: "Widget Corp opens a depot in a new city. Read more" });
    await ingestAux(env);
    const rows = env.DB.rows("SELECT title, excerpt, excerpt_status FROM aux_items ORDER BY id");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].excerpt_status, "feed");
    assert.ok(check(rows[0].excerpt.length), `${JSON.stringify(extra)}: ${rows[0].excerpt.length}`);
    assert.deepEqual([rows[1].excerpt, rows[1].excerpt_status], [null, null], "a teaser is not the release");
  }
});

test("A29: coverage ingest: a covered source's own-channel feed text is sized by its class only with TEXT_BUDGETS=class", async () => {
  // A covered source with a channel, picked from the bundled catalog at run time.
  const key = Object.keys(COVERED.sources).find((k) => COVERED.channels?.[k]);
  assert.ok(key, "the catalog has a covered source with a channel");
  const url = `https://news.${COVERED.channels[key]}/release-1`;
  for (const [extra, check] of [[{}, (n) => n <= EXCERPT_CHARS], [{ TEXT_BUDGETS: "class" }, (n) => n > EXCERPT_CHARS && n <= 6000]]) {
    const env = feedEnv(extra);
    nmRow(env.NEWS, { source_key: key, url, title: TITLE, body: FEED });
    await ingest(env);
    const row = env.DB.rows("SELECT excerpt, excerpt_status FROM items WHERE source_key = ?", key)[0];
    assert.equal(row?.excerpt_status, "feed");
    assert.ok(check(row.excerpt.length), `${JSON.stringify(extra)}: ${row.excerpt.length}`);
  }
});

// --- War.gov digests (A30) -----------------------------------------------------------------------
const ARTICLE = "https://www.war.gov/News/Contracts/Contract/Article/4400099/";
const award = (k) => `Vendor${k} Systems LLC, Testville, Ohio, was awarded a $${(k + 1) * 1_000_000} firm-fixed-price contract for spare parts and field services, with work expected to finish later.`;
const XML = `<?xml version="1.0"?><rss><channel><item><title>Contracts for a synthetic day</title><description><![CDATA[
<p><a href="${ARTICLE}">View Online</a></p><p><strong>NAVY</strong></p>${Array.from({ length: 80 }, (_, k) => `<p>${award(k)}</p>`).join("")}
]]></description></item></channel></rss>`;

test("A30: enrichAuxWargov writes at most 2,500 chars by default and at most 8,000 with TEXT_BUDGETS=class", async () => {
  for (const [extra, check] of [[{}, (n) => n <= EXCERPT_CHARS], [{ TEXT_BUDGETS: "class" }, (n) => n > EXCERPT_CHARS && n <= 8000]]) {
    const env = { DB: zenithDb(), ...extra };
    const now = Date.now();
    const id = Number(env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
      VALUES (1, 'wargov_contracts', 'wargov_contracts', 'War.gov Contracts', 'program', ?, 'Contracts for a synthetic day', ?, ?, 'pending')`)
      .run(ARTICLE, new Date(now).toISOString(), new Date(now).toISOString()).lastInsertRowid);
    await withFetch(() => new Response(XML, { status: 200, headers: { "content-type": "application/rss+xml" } }), () => enrichAuxWargov(env, { now }));
    const row = env.DB.rows("SELECT excerpt, excerpt_status FROM aux_items WHERE id = ?", id)[0];
    assert.equal(row.excerpt_status, "ok");
    assert.ok(check(row.excerpt.length), `${JSON.stringify(extra)}: ${row.excerpt.length}`);
  }
});
