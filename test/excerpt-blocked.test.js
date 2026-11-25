// Block pages and the Federal Register reader. A bot check served with a 200
// (federalregister.gov's "Request Access" page) was stored as an 'ok' excerpt
// and graded; it is now status 'blocked', retried once like a 403. Federal
// Register documents are read from the API record and GPO's govinfo text
// (served from test/fixtures/fedreg.json; nothing is fetched).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb } from "./helpers/worker-env.js";

hookJsonImports();
const EX = await import("../worker/src/excerpt.js");
const { isBlockPage, fetchExcerpt, fetchPage, fedregDocNumber, fedregApiUrl, govinfoUrl, fedregSupplementary, fedregExcerpt, enrich, PAGE_UA } = EX;
const FR = JSON.parse(readFileSync(new URL("./fixtures/fedreg.json", import.meta.url), "utf8"));

// federalregister.gov's page as zenith-core received it (its text, 2026-11-25).
const FR_BLOCK = `<!DOCTYPE html><html><head><title>Federal Register :: Request Access</title><script>var x=1;</script></head><body>
<h1>Request Access</h1><p>Due to aggressive automated scraping of FederalRegister.gov and eCFR.gov, programmatic access to these sites is limited to access to our extensive developer APIs. Please visit <a href="/developers">FederalRegister.gov API documentation</a> or eCFR.gov API documentation to learn more about how to access the API.</p>
<p>Your request has been flagged as potentially automated. If you are human user receiving this message, please complete the CAPTCHA (bot test) below and click "Request Access".</p>
<form action="/unblock"><button data-action="unblock#handleSubmit">Request Access</button></form><p>An official website of the United States government.</p>
<div class="modal"><h2>IP Access Help</h2><label>* Your Name</label><label>* Email</label><label>* How can we help you?</label></div></body></html>`;
const CF_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><style>body{}</style></head><body><div class="main-wrapper"><h1>www.example.com</h1>
<h2>Verify you are human by completing the action below.</h2><noscript>Enable JavaScript and cookies to continue</noscript><div>Ray ID: 8f1e</div></div><script src="/cdn-cgi/challenge-platform/x.js"></script></body></html>`;
// Cloudflare's JS challenge as served (no h2: the text is drawn by script; the
// only marker is in <noscript>), and Incapsula's denial inside an <iframe>.
const CF_JS_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"><style>*{box-sizing:border-box}</style>
<script>(function(){window._cf_chl_opt={cvId:"3",cType:"managed"};})();</script></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div>
<script>(function(){var a=document.createElement("script");a.src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8f1e";document.getElementsByTagName("head")[0].appendChild(a);})();</script></body></html>`;
const INCAPSULA = `<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=5074a744"></script></head><body><iframe id="main-iframe" src="/_Incapsula_Resource?CWUDNSAI=9" frameborder=0 width="100%" height="100%">Request unsuccessful. Incapsula incident ID: 1-23456</iframe></body></html>`;
const AKAMAI = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don't have permission to access "http&#58;&#47;&#47;www&#46;example&#46;com&#47;news&#47;1" on this server.<P>Reference&#32;&#35;18&#46;abc</BODY></HTML>`;
const ARTICLE_ON_BOTS = `<h1>Ticket sites tighten bot defences</h1>${"<p>Retailers now ask shoppers to verify you are human and please complete the CAPTCHA before checkout, and the article goes on about what that means for sales of $40 million. </p>".repeat(30)}`;

test("isBlockPage: bot checks served as pages are refusals; an article about CAPTCHAs is not", () => {
  assert.equal(isBlockPage(FR_BLOCK), true, "federalregister.gov");
  assert.equal(isBlockPage(CF_CHALLENGE), true, "Cloudflare challenge");
  assert.equal(isBlockPage(AKAMAI), true, "Akamai denial");
  assert.equal(isBlockPage(CF_JS_CHALLENGE), true, "Cloudflare JS challenge (marker only in noscript)");
  assert.equal(isBlockPage(INCAPSULA), true, "Incapsula (marker only in an iframe)");
  assert.equal(isBlockPage(ARTICLE_ON_BOTS), false, "a long page that only mentions the words");
  assert.equal(isBlockPage(FR.govinfo["2026-22600"]), false);
  assert.equal(isBlockPage("<h1>Planet signs agreement</h1><p>Planet signed a multi-launch agreement.</p>"), false);
});

test("isBlockPage: markers only in scripts, attributes or hidden forms do not make a short release a block page", () => {
  const release = `<h1>Example Corp Wins $12 Million Order</h1><p>${"Example Corp today announced a $12 million order from a defense customer. ".repeat(10)}</p>`;
  const hidden = [
    `<script>var msg = "Please complete the CAPTCHA";</script>`,
    `<form data-error="Please complete the captcha."><input name="e"></form>`,
    `<div hidden data-msg="Enable JavaScript and cookies to continue"></div>`,
    `<template><label>Please verify you are human</label></template>`,
  ];
  for (const h of hidden) assert.equal(isBlockPage(`<html><head><title>Example Corp news</title></head><body>${h}${release}</body></html>`), false, h);
  assert.equal(isBlockPage(release), false);
});

test("Federal Register: the signature, [FR Doc.] line and billing code, and public-participation boilerplate are not kept", () => {
  const html = `<html><body><pre>
SUMMARY: The agency proposes a rule.

SUPPLEMENTARY INFORMATION:

Instructions

    All submissions must include the agency name and docket number.

Background

    The agency proposes to exempt 40 automated trucks from the rule.

Public Participation

    Comments may be submitted electronically.

</pre></body></html>`;
  const supp = fedregSupplementary(html);
  assert.equal(supp, "Background\nThe agency proposes to exempt 40 automated trucks from the rule.");
  const signed = `<pre>
SUPPLEMENTARY INFORMATION: The agency grants the exemption for 3 years.

    Issued under the authority of 49 CFR 1.87.
Jane Example,
Administrator.
[FR Doc. 2025-00123 Filed 1-7-25; 8:45 am]
BILLING CODE 4910-EX-P
</pre>`;
  assert.equal(fedregSupplementary(signed), "The agency grants the exemption for 3 years.");
  // DOT notices open with comment instructions, public participation and the
  // Privacy Act before the Background: those are skipped, not the end.
  const dot = `<pre>
SUPPLEMENTARY INFORMATION:

Instructions

    All submissions must include the agency name and docket number.

Public Participation and Request for Comments

    Comments may be submitted electronically.

Privacy Act

    DOT posts comments without edit.

Background

    The applicant asks to operate 12 driverless trucks on Texas highways.

</pre>`;
  assert.equal(fedregSupplementary(dot), "Background\nThe applicant asks to operate 12 driverless trucks on Texas highways.");
  assert.equal(fedregSupplementary("<preface>x</preface><pre>\nSUPPLEMENTARY INFORMATION: Real text.\n</pre>"), "Real text.");
});

function serve(routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    calls.push({ url, accept: init.headers?.accept, ua: init.headers?.["user-agent"] });
    const hit = routes(url);
    if (!hit) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(hit.body, { status: hit.status || 200, headers: { "content-type": hit.type || "text/html; charset=utf-8" } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const json = (o) => ({ body: JSON.stringify(o), type: "application/json; charset=utf-8" });
const FCC_URL = "https://www.federalregister.gov/documents/2026/11/05/2026-22600/modernizing-spectrum-sharing-for-satellite-broadband";
const BIS_URL = "https://www.federalregister.gov/documents/2026/11/25/2026-23999/additions-to-the-entity-list";
const frRoutes = (url) => {
  for (const n of Object.keys(FR.records)) {
    if (url === fedregApiUrl(n)) return json(FR.records[n]);
    if (url === govinfoUrl(FR.records[n])) return { body: FR.govinfo[n] };
  }
  if (/federalregister\.gov\/documents\//.test(url)) return { body: FR_BLOCK };
  return null;
};

test("htmlToText and the govinfo reader run in linear time on unclosed tags", () => {
  const { htmlToText } = EX;
  for (const s of ["<br ".repeat(75_000), "<".repeat(300_000), "<pre ".repeat(60_000)]) {
    const t = performance.now();
    htmlToText(s); fedregSupplementary(s); isBlockPage(`please complete the CAPTCHA ${s}`);
    assert.ok(performance.now() - t < 2000, `${s.slice(0, 5)}: ${Math.round(performance.now() - t)} ms`);
  }
  assert.equal(htmlToText("<p>a<br>b</p><brx>c<br/>d</h2 x>e<b>f</b>"), "a\nb\nc\nd\ne f");
});

test("fetchPage: a block page served with a 200 is 'blocked', not ok", async () => {
  const s = serve(() => ({ body: FR_BLOCK }));
  try {
    assert.deepEqual(await fetchPage("https://ir.example.test/news/1", PAGE_UA), { status: "blocked" });
    const r = await fetchExcerpt({}, { url: "https://ir.example.test/news/1", title: "Example Corp wins order" });
    assert.equal(r.status, "blocked");
    assert.equal(r.excerpt, undefined);
  } finally { s.restore(); }
});

test("Federal Register: document URLs map to the API; other pages do not", () => {
  assert.equal(fedregDocNumber(FCC_URL), "2026-22600");
  assert.equal(fedregDocNumber("https://federalregister.gov/d/2026-23999"), "2026-23999");
  assert.equal(fedregDocNumber("https://www.federalregister.gov/documents/2026/01/02/E6-12345/x"), "E6-12345");
  assert.equal(fedregDocNumber("https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=x"), null);
  assert.equal(fedregDocNumber("https://www.regulations.gov/document/FAA-2026-0001"), null);
  assert.equal(fedregDocNumber("not a url"), null);
  assert.match(fedregApiUrl("2026-22600"), /^https:\/\/www\.federalregister\.gov\/api\/v1\/documents\/2026-22600\.json\?fields%5B%5D=document_number&/);
  assert.equal(govinfoUrl(FR.records["2026-22600"]), "https://www.govinfo.gov/content/pkg/FR-2026-11-05/html/2026-22600.htm");
  assert.equal(govinfoUrl({ document_number: "2026-1", publication_date: "soon" }), null);
});

test("Federal Register: the FCC rule is read from the API and govinfo, never the bot-checked page", async () => {
  const s = serve(frRoutes);
  try {
    const r = await fetchExcerpt({}, { url: FCC_URL, title: "Modernizing Spectrum Sharing for Satellite Broadband", role: "counterparty" });
    assert.equal(r.status, "ok");
    assert.deepEqual([r.source, r.replaceSource], [null, true], "excerpt_source names the item's own URL");
    assert.ok(r.excerpt.startsWith("Rule: Final action.\nAgency: Federal Communications Commission\nDates: Effective December 7, 2026."), r.excerpt);
    assert.ok(r.excerpt.includes("geostationary (GSO) satellite network reference links"));
    assert.ok(r.excerpt.includes("SB Docket No. 25-157"), "the supplementary information follows the abstract");
    assert.ok(!/Request Access|CAPTCHA|Regulatory Flexibility Analysis/.test(r.excerpt), "no block page, no procedural sections");
    assert.ok(r.excerpt.length <= 2500);
    assert.deepEqual(s.calls.map((c) => new URL(c.url).hostname), ["www.federalregister.gov", "www.govinfo.gov"]);
    assert.ok(s.calls[0].url.includes("/api/v1/documents/2026-22600.json"));
    assert.match(s.calls[0].accept, /application\/json/);
    assert.ok(s.calls.every((c) => c.ua === PAGE_UA), "the plain research User-Agent");
  } finally { s.restore(); }
});

test("Federal Register: the BIS entity-list rule names the entities; repeated boilerplate and page markers are dropped", () => {
  const e = fedregExcerpt(FR.records["2026-23999"], fedregSupplementary(FR.govinfo["2026-23999"]));
  assert.ok(e.includes("adding 7 entities to the Entity List"));
  for (const name of ["MSFusion Sdn. Bhd.", "Megaspeed International Pte. Ltd", "Swiftdata Pte. Ltd.", "Megaspeed (Thailand) Co., Ltd."]) assert.ok(e.includes(name), name);
  assert.ok(!e.includes("[[Page"), "GPO page markers");
  assert.ok(!/Savings Clause|John S. McCain|reasonable cause to believe/.test(e), "BIS's standing boilerplate");
  assert.ok(e.length <= 2500);
});

test("Federal Register: without govinfo text the API record alone is the excerpt; a refused API is 'blocked'", async () => {
  let s = serve((url) => (url.includes("/api/v1/") ? frRoutes(url) : null));
  try {
    const r = await fetchExcerpt({}, { url: BIS_URL, title: "Additions to the Entity List" });
    assert.equal(r.status, "ok");
    assert.ok(r.excerpt.startsWith("Rule: Final rule.\nAgency: Commerce Department; Industry and Security Bureau"));
    assert.ok(r.excerpt.endsWith("foreign policy interests of the United States."), r.excerpt);
  } finally { s.restore(); }
  s = serve(() => ({ body: FR_BLOCK }));
  try {
    assert.deepEqual(await fetchExcerpt({}, { url: BIS_URL, title: "Additions to the Entity List" }), { status: "blocked" });
  } finally { s.restore(); }
  s = serve(() => ({ body: "<html>maintenance</html>", status: 503 }));
  try {
    assert.deepEqual(await fetchExcerpt({}, { url: BIS_URL, title: "Additions to the Entity List" }), { status: "http_503" });
  } finally { s.restore(); }
});

test("enrich: a block page is retried once, then final; the feed's summary is kept as the excerpt", async () => {
  const db = zenithDb();
  const now = new Date().toISOString();
  const add = (nm, url, fallback) => {
    db.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, excerpt_fallback, excerpt_tries)
      VALUES (?, 'ondas', 'ONDS', ?, 'Example Corp wins a large order', ?, ?, 'pending', ?, 0)`).run(nm, url, now, now, fallback);
    return db.rows("SELECT id FROM items WHERE nm_rowid = ?", nm)[0].id;
  };
  const summary = "Example Corp said it won a large order. ".repeat(8).trim();
  const withSummary = add(1, "https://ir.blocked.test/news/1", summary);
  const bare = add(2, "https://ir.blocked.test/news/2", null);
  const row = (id) => db.rows("SELECT excerpt, excerpt_status, excerpt_tries, excerpt_next_at FROM items WHERE id = ?", id)[0];
  const s = serve(() => ({ body: CF_CHALLENGE }));
  try {
    await enrich({ DB: db });
    for (const id of [withSummary, bare]) {
      assert.deepEqual([row(id).excerpt, row(id).excerpt_status, row(id).excerpt_tries], [null, null, 1], "first block waits for a retry");
      assert.ok(Date.parse(row(id).excerpt_next_at) > Date.now());
    }
    db.db.prepare("UPDATE items SET excerpt_next_at = ?").run(new Date(Date.now() - 60_000).toISOString());
    await enrich({ DB: db });
    assert.deepEqual([row(withSummary).excerpt, row(withSummary).excerpt_status, row(withSummary).excerpt_tries], [summary, "feed_summary", 2]);
    assert.deepEqual([row(bare).excerpt, row(bare).excerpt_status, row(bare).excerpt_tries], [null, "blocked", 2], "a second block is final, with no excerpt");
  } finally { s.restore(); }
});
