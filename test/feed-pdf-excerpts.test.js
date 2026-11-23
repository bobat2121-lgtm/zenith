// Feed text and PDFs as excerpts (roadmap T8, T9): ingest copies news-monitor's
// items.body into the excerpt (status 'feed') and never fetches that page; a
// deck feed's PDF link becomes excerpt_source; enrich reads covered PDFs
// (status 'pdf' / 'pdf_unreadable') within a per-tick budget.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";
import { buildPdf, simplePdf } from "./helpers/pdf.js";

hookJsonImports();
const { ingest, newsHasBody } = await import("../worker/src/ingest.js");
const { feedExcerpt, feedText, pdfLinkIn, pdfExcerpt, fetchExcerpt, enrich, deckPdfLink } = await import("../worker/src/excerpt.js");

const TITLE = "Example Corp. Wins $45 Million Counter-Drone Order";
const filler = Array.from({ length: 30 }, (_, k) => `The company continued to build out its platform across several programs in phase ${k}.`);
const RELEASE = [
  TITLE + " Content Import Thu, 11/12/2026 - 07:01",
  TITLE,
  "Nov 12, 2026",
  "General",
  "WEST PALM BEACH, FL / November 12, 2026 / Example Corp. (NASDAQ: ONDS) today announced a $45 million order for its counter-drone systems from a NATO customer.",
  ...filler,
  "Revenue guidance for 2027 is raised to at least $1.1 billion, up 40% from the prior target.",
  "Forward-Looking Statements",
  "This release contains forward-looking statements about a $9 billion market.",
].join("\n");

const DECK_PAGES = [
  ["Investor Presentation", "November 2026"],
  ["Q3 revenue of $167 million, up 39% year over year, and a record backlog of $835 million."],
  ["The 2027 revenue target is at least $1.1 billion, with more than $250 million expected in Q4."],
];
const deck = () => simplePdf(DECK_PAGES);

function pdfResponse(bytes, { url, status = 200, type = "application/pdf" } = {}) {
  const r = new Response(bytes, { status, headers: { "content-type": type } });
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
}
function htmlResponse(html, url) {
  const r = new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
}
async function withFetch(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), headers: init.headers || {} }); return handler(String(url), init); };
  try { return await run(calls); } finally { globalThis.fetch = real; }
}

test("feedExcerpt keeps the lead and the figures, drops feed chrome and the boilerplate tail", () => {
  const e = feedExcerpt(RELEASE, TITLE);
  assert.ok(e.startsWith("WEST PALM BEACH, FL / November 12, 2026 / Example Corp."), e.slice(0, 80));
  assert.match(e, /\$1\.1 billion, up 40%/);
  assert.doesNotMatch(e, /Content Import|\$9 billion|Forward-Looking/);
  assert.ok(e.length <= 2500);
});

test("teasers and short text are not excerpts; WordPress's footer is not a teaser mark", () => {
  const body = "Q3 revenue accelerated 39% sequentially and exceeded the upper end of the Company’s expectations. ".repeat(16);
  assert.equal(feedExcerpt(body + "building the foundation […]\nThe post Q3 results appeared first on Example.", "Q3"), null);
  assert.equal(feedExcerpt(body + "Read more", "Q3"), null);
  assert.equal(feedExcerpt("A short note of 120 characters about an order.", "x"), null);
  const full = feedExcerpt(body + "Contacts:\nir@example.com\nThe post Q3 results appeared first on Example.", "Q3");
  assert.ok(full && !/appeared first/.test(full));
  assert.equal(pdfLinkIn("View this Presentation (PDF) (http://s29.q4cdn.com/9/files/doc_presentations/2026/Deck.pdf)"),
    "http://s29.q4cdn.com/9/files/doc_presentations/2026/Deck.pdf");
  assert.equal(pdfLinkIn("No link (https://example.com/page)"), null);
});

// Shapes seen in live feeds on 2026-11-22 (text written for the test; each is
// over the old 400-character floor, as the live items were: 402, 408, 403-1,014).
// A Q4 blog item: title, date, "Blog", "General", then a teaser cut mid-sentence (MRLN).
const Q4_BLOG_TEASER = "One Brain, Many Airframes Content Import Thu, 11/19/2026 - 09:00\nOne Brain, Many Airframes\nNov 19, 2026\nBlog\nGeneral\n" +
  "One Brain, Many Airframes\nSince our listing in March the company has kept widening its programs across defense and civil aviation, and the number of " +
  "our updates and posts has grown with them. Readers who are new to the company, investors among them, often meet it one article at a time,";
// A WordPress summary that ends in an ellipsis, then a "Source" line (AWG).
const ELLIPSIS_SOURCE = "Example Grocers opened a new automated distribution center this fall, part of a multi-year program to modernize its network of " +
  "warehouses for member stores across the region. The cooperative said the site will serve more than 300 stores, and that the new system " +
  "will let its teams handle larger orders with fewer errors and shorter lead times, which it says is empowering both independent grocers and…\nSource";
// A description that is a complete but short summary of a longer release (Volvo).
const SUMMARY = "Example Group establishes a dedicated business entity to capture the growing demand for autonomous transport in mining and quarries. " +
  "The new entity will combine the group's autonomous haulage offers under one roof and serve customers and their contractors in several regions. " +
  "It starts operations on January 1, 2027, and will be led by a member of the group's management team who reports to the CEO. " +
  "“Autonomous solutions are moving from pilots to daily operations, and our customers want one partner for the whole site,” says the CEO.";

test("summaries and teasers are not the release: the page is fetched, the summary is only a fallback", () => {
  for (const [name, body, title] of [
    ["Q4 blog teaser", Q4_BLOG_TEASER, "One Brain, Many Airframes"],
    ["ellipsis + Source line", ELLIPSIS_SOURCE, "Example Grocers opens automated center"],
    ["short summary", SUMMARY, "Example Group establishes dedicated entity for autonomous mining"],
  ]) {
    const r = feedText(body, title);
    assert.equal(r.full, false, name);
    assert.equal(feedExcerpt(body, title), null, name);
    assert.ok(r.excerpt && r.excerpt.length >= 200, `${name}: kept as a fallback`);
    assert.doesNotMatch(r.excerpt, /Content Import|^Blog/, name);
  }
  const full = feedText(RELEASE, TITLE);
  assert.equal(full.full, true, "a full release is the excerpt");
  // A short release (its boilerplate counted) of FEED_FULL_CHARS or more is full.
  const short = ["Example Corp. will present at the Growth Conference on December 3, 2026, at 10:00 a.m. ET in New York.",
    "About Example Corp.", "Example Corp. builds autonomous systems for defense and industry. ".repeat(22), "Contacts:", "ir@example.com"].join("\n");
  assert.equal(feedText(short, "Example Corp. to Present at the Growth Conference").full, true);
});

function newsWithBody() {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  return news;
}
const ins = (news, row) => news.db.prepare(
  "INSERT INTO items (source_key, url, title, published, category, first_seen, notified, body) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)",
).run(row.source_key, row.url, row.title, row.published ?? new Date().toISOString(), new Date().toISOString(), row.body ?? null);

test("ingest copies feed text into the excerpt, and a deck feed's PDF link into excerpt_source", async () => {
  const news = newsWithBody();
  const db = zenithDb();
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0')").run();
  ins(news, { source_key: "ondas", url: "https://ir.ondas.com/news/detail/1/order", title: TITLE, body: RELEASE });
  ins(news, { source_key: "ondas", url: "https://ir.ondas.com/news/detail/2/teaser", title: "Teaser item", body: "Only a teaser […]" });
  ins(news, { source_key: "ondas", url: "https://ir.ondas.com/news/detail/3/none", title: "No text item" });
  ins(news, { source_key: "planet_decks", url: "https://investors.planet.com/presentation-details/2026/Q2/default.aspx", title: "Fiscal Second Quarter 2027 Earnings Presentation",
    body: "View this Presentation (PDF) (https://s29.q4cdn.com/903184914/files/doc_earnings/2027/q2/Deck.pdf)" });
  ins(news, { source_key: "yotta", url: "https://yotta.com/p/1", title: "Yotta signs a GPU deal with Gorilla Technology", body: RELEASE });
  ins(news, { source_key: "yotta", url: "https://yotta.com/p/2", title: "Yotta deck", body: "Deck (https://yotta.com/files/deck.pdf)" });
  const r = await ingest({ DB: db, NEWS: news });
  assert.equal(r.inserted, 6);
  assert.equal(r.feed_excerpts, 2);
  const rows = Object.fromEntries(db.rows("SELECT url, excerpt, excerpt_status, excerpt_at, excerpt_source FROM items").map((x) => [x.url.split("/").pop(), x]));
  assert.equal(rows.order.excerpt_status, "feed");
  assert.ok(rows.order.excerpt.startsWith("WEST PALM BEACH") && rows.order.excerpt_at);
  assert.deepEqual([rows.teaser.excerpt_status, rows.none.excerpt_status], [null, null], "fetched as before");
  assert.equal(rows["default.aspx"].excerpt_source, "https://s29.q4cdn.com/903184914/files/doc_earnings/2027/q2/Deck.pdf");
  assert.equal(rows["default.aspx"].excerpt_status, null);
  assert.equal(rows["1"].excerpt_status, "feed", "counterparty feed text is an excerpt too");
  assert.equal(rows["2"].excerpt_source, null, "a counterparty's PDF is never read");

  // enrich never fetches the feed item; it reads the deck's PDF from excerpt_source.
  await withFetch(async (url) => {
    if (url.endsWith("/Deck.pdf")) return pdfResponse(deck());
    return htmlResponse(`<h1>${"Teaser item"}</h1><p>${"Some page text about the item, long enough to keep. ".repeat(8)}</p>`);
  }, async (calls) => {
    const e = await enrich({ DB: db });
    assert.ok(!calls.some((c) => c.url.includes("/detail/1/")), "the feed item's page is not fetched");
    assert.ok(calls.some((c) => c.url.endsWith("/Deck.pdf")));
    assert.equal(e.pdf, 1);
  });
  const deckRow = db.rows("SELECT excerpt, excerpt_status, excerpt_source FROM items WHERE source_key = 'planet_decks'")[0];
  assert.equal(deckRow.excerpt_status, "pdf");
  assert.match(deckRow.excerpt, /^Investor Presentation\nNovember 2026\nQ3 revenue of \$167 million/);
});

test("ingest reads a news-monitor-db without items.body as before, and notices the column once it arrives", async () => {
  const news = newsDb();
  const t0 = Date.now();
  assert.equal(await newsHasBody(news, t0), false);
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  assert.equal(await newsHasBody(news, t0 + 60_000), false, "a no is kept for a while");
  assert.equal(await newsHasBody(news, t0 + 31 * 60_000), true);
  news.exec("ALTER TABLE items DROP COLUMN body");
  const db = zenithDb();
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0')").run();
  news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES ('ondas', 'https://ir.ondas.com/n/9', 'T', NULL, NULL, ?, 1)").run(new Date().toISOString());
  const r = await ingest({ DB: db, NEWS: news });
  assert.equal(r.inserted, 1, "a column that disappears is not an ingest failure");
});

test("covered PDFs are read; a counterparty's are not", async () => {
  await withFetch(async () => pdfResponse(deck()), async () => {
    const covered = await fetchExcerpt({}, { url: "https://ir.example.test/files/deck.pdf", title: "Investor Presentation" });
    assert.equal(covered.status, "pdf");
    assert.match(covered.excerpt, /\$167 million/);
    const counterparty = await fetchExcerpt({}, { url: "https://ir.example.test/files/deck.pdf", title: "Deck", role: "customer" });
    assert.equal(counterparty.status, "skipped_binary");
  });
});

test("a deck page that redirects to the listing reads the PDF carrying the item's id", async () => {
  const listing = `<a href="https://cdn.example.test/ondas/files/Tear+Sheet.pdf">Tear sheet</a>
    <a href="https://cdn.example.test/ondas/db/575/4849/pdf/Investor_Presentation.pdf">Investor Presentation</a>
    <a href="https://cdn.example.test/ondas/db/575/4848/pdf/Q3_Presentation.pdf">Q3</a>`;
  await withFetch(async (url) => {
    if (url.endsWith(".pdf")) return url.includes("/4849/") ? pdfResponse(deck()) : pdfResponse(simplePdf([["Wrong deck"]]));
    return htmlResponse(listing, "https://ir.example.test/presentations");
  }, async (calls) => {
    const item = { url: "https://ir.example.test/presentations/detal/4849/investor-presentation", title: "Investor Presentation" };
    const r = await fetchExcerpt({}, item);
    assert.equal(r.status, "pdf");
    assert.equal(r.source, "https://cdn.example.test/ondas/db/575/4849/pdf/Investor_Presentation.pdf");
    assert.equal(calls.filter((c) => c.url.endsWith(".pdf")).length, 1);
  });
  assert.equal(deckPdfLink(listing, "https://ir.example.test/presentations", { url: "https://ir.example.test/presentations/detail/2026/x", title: "Investor Presentation" }), null,
    "a year is not an id, and three PDFs are not one");
  assert.equal(deckPdfLink(`<a href="//s29.q4cdn.com/f/Deck.pdf">PDF</a>`, "https://investors.example.test/p/default.aspx", { url: "https://investors.example.test/p/default.aspx", title: "Earnings Presentation" }),
    "https://s29.q4cdn.com/f/Deck.pdf");
});

test("a page that redirects to a PDF is read as one, and an encrypted PDF is final", async () => {
  await withFetch(async () => pdfResponse(deck(), { url: "https://ir.example.test/_assets/db/937/10070/pdf/Deck.pdf" }), async () => {
    const r = await fetchExcerpt({}, { url: "https://ir.example.test/company-information/presentations/detail/10070/investor-presentation", title: "Investor Presentation October 2026" });
    assert.equal(r.status, "pdf");
    assert.equal(r.source, "https://ir.example.test/_assets/db/937/10070/pdf/Deck.pdf");
  });
  await withFetch(async () => pdfResponse(simplePdf(DECK_PAGES, { trailerExtra: "/Encrypt 99 0 R" })), async () => {
    assert.equal((await fetchExcerpt({}, { url: "https://ir.example.test/locked.pdf", title: "Deck" })).status, "pdf_unreadable");
  });
});

test("a PDF past the download bound is read from its head and its tail (byte range)", async () => {
  const pad = Buffer.alloc(8_200_000, 0x20);
  const big = buildPdf([
    { num: 3, dict: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>" },
    { num: 4, dict: "<< >>", stream: "BT /F1 12 Tf 72 700 Td (Investor Presentation) Tj 0 -14 Td (November 2026 update for shareholders and analysts) Tj ET", flate: true },
    { num: 20, dict: "<< /Type /XObject /Subtype /Image >>", stream: pad },
    { num: 5, dict: "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>" },
    { num: 6, dict: "<< >>", stream: "BT /F1 12 Tf 72 700 Td 14 TL (Q3 revenue of $167 million, up 39% year over year, with a record backlog of $835 million.) Tj T* " +
      "(The 2027 revenue target is at least $1.1 billion, with more than $250 million expected in the fourth quarter.) Tj ET", flate: true },
    { num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, dict: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /Resources << /Font << /F1 7 0 R >> >> >>" },
    { num: 7, dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
  ]);
  await withFetch(async (url, init) => {
    const range = init.headers?.range;
    if (range) return new Response(big.subarray(big.length - 2_000_000), { status: 206, headers: { "content-type": "application/pdf" } });
    return pdfResponse(big);
  }, async (calls) => {
    const r = await fetchExcerpt({}, { url: "https://cdn.example.test/big-deck.pdf", title: "Investor Presentation" });
    assert.equal(r.status, "pdf");
    assert.match(r.excerpt, /^Investor Presentation\nNovember 2026 update/);
    assert.match(r.excerpt, /\$835 million/);
    assert.equal(calls.filter((c) => c.headers.range === "bytes=-2000000").length, 1);
  });
});

test("enrich reads at most two PDFs a tick; the rest wait without spending a try", async () => {
  const db = zenithDb();
  const now = new Date().toISOString();
  for (let k = 0; k < 3; k++) {
    db.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state)
      VALUES (?, 'axon_ir_docs', 'AXON', ?, 'AXON Investor Deck', ?, ?, 'pending')`).run(500 + k, `https://investor.example.test/image/deck${k}.pdf`, now, now);
  }
  await withFetch(async () => pdfResponse(deck()), async (calls) => {
    const e = await enrich({ DB: db });
    assert.deepEqual([e.pdf, e.pdf_deferred], [2, 1]);
    assert.equal(calls.length, 2, "the deferred PDF is not requested");
  });
  const rows = db.rows("SELECT excerpt_status, excerpt_tries, excerpt_next_at FROM items ORDER BY nm_rowid");
  const waiting = rows.find((r) => r.excerpt_status === null);
  assert.equal(waiting.excerpt_tries, 0);
  assert.ok(Date.parse(waiting.excerpt_next_at) > Date.now());
  assert.equal(rows.filter((r) => r.excerpt_status === "pdf").length, 2);
});

const PAGE_TEXT = `<h1>Example Group establishes dedicated entity for autonomous mining</h1><p>${"The page carries the full release with its figures: revenue of $45 million, up 12%. ".repeat(6)}</p>`;
function pendingItem(db, { nm, url, title, role = null, source = null, fallback = null, tries = 0 }) {
  const now = new Date().toISOString();
  db.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, role, excerpt_source, excerpt_fallback, excerpt_tries)
    VALUES (?, 'ondas', 'ONDS', ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(nm, url, title, now, now, role, source, fallback, tries);
  return db.rows("SELECT id FROM items WHERE nm_rowid = ?", nm)[0].id;
}
const row = (db, id) => db.rows("SELECT excerpt, excerpt_status, excerpt_tries, excerpt_next_at, excerpt_source, excerpt_fallback FROM items WHERE id = ?", id)[0];

test("ingest keeps a summary as the fallback; enrich reads the page, and uses the summary only when the page gives nothing", async () => {
  const news = newsWithBody();
  const db = zenithDb();
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0')").run();
  ins(news, { source_key: "volvo", url: "https://www.example.test/news/entity", title: "Example Group establishes dedicated entity for autonomous mining", body: SUMMARY });
  ins(news, { source_key: "volvo", url: "https://www.example.test/news/gone", title: "Example Group establishes dedicated entity for autonomous mining", body: SUMMARY });
  ins(news, { source_key: "merlin", url: "https://investors.example.test/news/one-brain", title: "One Brain, Many Airframes", body: Q4_BLOG_TEASER });
  const r = await ingest({ DB: db, NEWS: news });
  assert.equal(r.feed_excerpts, 0, "summaries are not feed excerpts");
  const rows = db.rows("SELECT url, excerpt, excerpt_status, excerpt_fallback FROM items ORDER BY nm_rowid");
  assert.equal(rows.length, 3);
  for (const x of rows) {
    assert.deepEqual([x.excerpt, x.excerpt_status], [null, null], x.url);
    assert.ok(x.excerpt_fallback?.length >= 200, x.url);
  }
  await withFetch(async (url) => (url.endsWith("/gone") ? new Response("", { status: 404 }) : htmlResponse(PAGE_TEXT)), async (calls) => {
    await enrich({ DB: db });
    assert.equal(calls.length, 3, "every page is fetched");
  });
  const after = Object.fromEntries(db.rows("SELECT url, excerpt, excerpt_status FROM items").map((x) => [x.url.split("/").pop(), x]));
  assert.equal(after.entity.excerpt_status, "ok");
  assert.match(after.entity.excerpt, /\$45 million, up 12%/);
  assert.equal(after.gone.excerpt_status, "feed_summary");
  assert.match(after.gone.excerpt, /^Example Group establishes a dedicated business entity/);
});

test("a feed-named PDF that fails or is unreadable falls through to the item's page", async () => {
  const handler = async (url) => {
    if (url.endsWith("/a.pdf") || url.endsWith("/c.pdf") || url.endsWith("/news/c") || url.endsWith("/news/d")) return new Response("", { status: 404 });
    if (url.endsWith("/d.pdf")) return new Response("", { status: 503 });
    if (url.endsWith("/b.pdf")) return pdfResponse(simplePdf(DECK_PAGES, { trailerExtra: "/Encrypt 99 0 R" }));
    return htmlResponse(PAGE_TEXT);
  };
  // Two items per enrich call: each one's PDF takes one of the tick's two downloads.
  const db = zenithDb(), db2 = zenithDb();
  const pdf404 = pendingItem(db, { nm: 1, url: "https://ir.example.test/news/a", title: "Example Corp. Q3 results", source: "https://cdn.example.test/a.pdf" });
  const unreadable = pendingItem(db, { nm: 2, url: "https://ir.example.test/news/b", title: "Example Corp. Q3 results", source: "https://cdn.example.test/b.pdf" });
  const both = pendingItem(db2, { nm: 3, url: "https://ir.example.test/news/c", title: "Example Corp. Q3 results", source: "https://cdn.example.test/c.pdf" });
  const transient = pendingItem(db2, { nm: 4, url: "https://ir.example.test/news/d", title: "Example Corp. Q3 results", source: "https://cdn.example.test/d.pdf" });
  await withFetch(handler, async (calls) => {
    await enrich({ DB: db });
    await enrich({ DB: db2 });
    for (const page of ["/news/a", "/news/b", "/news/c", "/news/d"]) assert.ok(calls.some((c) => c.url.endsWith(page)), `${page} fetched`);
  });
  assert.equal(row(db, pdf404).excerpt_status, "ok");
  assert.equal(row(db, pdf404).excerpt_source, null, "the excerpt is the page's, not the PDF's");
  assert.equal(row(db, unreadable).excerpt_status, "ok");
  assert.match(row(db, unreadable).excerpt, /\$45 million/);
  assert.equal(row(db2, both).excerpt_status, "http_404", "both failed: the PDF's failure");
  assert.equal(row(db2, both).excerpt_source, "https://cdn.example.test/c.pdf");
  const t = row(db2, transient);
  assert.deepEqual([t.excerpt_status, t.excerpt_tries], [null, 1], "a PDF outage is retried even when the page 404s");
  assert.ok(Date.parse(t.excerpt_next_at) > Date.now());
});

test("a PDF is held before it is parsed, so a parse that ends the invocation is not repeated every tick", async () => {
  const db = zenithDb();
  const id = pendingItem(db, { nm: 1, url: "https://ir.example.test/files/deck.pdf", title: "Investor Presentation" });
  await withFetch(async () => pdfResponse(deck()), async () => {
    const item = db.rows("SELECT id, url, title, excerpt_tries, role, excerpt_source FROM items WHERE id = ?", id)[0];
    const r = await fetchExcerpt({ DB: db }, item);
    assert.equal(r.status, "pdf");
    // What the row holds if the invocation had died before enrich wrote the result.
    const held = row(db, id);
    assert.deepEqual([held.excerpt_status, held.excerpt_tries], [null, 1]);
    assert.ok(Date.parse(held.excerpt_next_at) > Date.now() + 50 * 60_000, "held for about an hour");
    const picked = await enrich({ DB: db });
    assert.equal(picked.tried, 0, "a held item is not picked on the next tick");
  });
  // An item that has used every try (its parses never finished) is final without a parse.
  const spent = pendingItem(db, { nm: 2, url: "https://ir.example.test/files/deck2.pdf", title: "Investor Presentation", tries: 4 });
  await withFetch(async () => pdfResponse(deck()), async () => {
    await enrich({ DB: db });
  });
  assert.deepEqual([row(db, spent).excerpt_status, row(db, spent).excerpt], ["pdf_unreadable", null]);
});

test("pdfExcerpt: the cover leads; legal pages, running footers, page numbers and axes are dropped", () => {
  const pages = [
    "Investor Presentation\nNovember 2026",
    "NASDAQ: TEST\nForward-Looking Statements\nThis presentation contains forward-looking statements about $1 billion.",
    "NASDAQ: TEST\nThis presentation may contain \"forward-looking statements\" as that term is defined under the Private Securities Litigation Reform Act.",
    "NASDAQ: TEST\nQ3 revenue of $167 million, up 39% year over year\n1. Excludes one-time items\n12",
    "NASDAQ: TEST\nHeadcount grew\n$0 $10 $20 $30 $40\n13",
    "NASDAQ: TEST\nDisclaimer\nLegal text that is not news.",
  ];
  const e = pdfExcerpt(pages);
  assert.equal(e, "Investor Presentation\nNovember 2026\nQ3 revenue of $167 million, up 39% year over year\n1) Excludes one-time items\nHeadcount grew");
});
