// The excerpt reader: figures over filler, page-chrome headings, the UMAC
// B2i rewrite, and SEC filings read from their Item text plus Ex-99.1
// (served from test/fixtures/sec-filings.json; sec.gov is never fetched).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  excerptFrom, pickText, figureScore, cutTail, usableHeading, secBody, secExcerpt, findExhibitLink, exhibitFromIndex,
  filingIndexUrl, excerptUrl, fetchExcerpt, htmlToText,
} from "../worker/src/excerpt.js";

const SEC = JSON.parse(readFileSync(new URL("./fixtures/sec-filings.json", import.meta.url), "utf8")).pages;
const AUR_8K = "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028.htm";
const GRRR_6K = "https://www.sec.gov/Archives/edgar/data/1903145/000121390026112233/ea0261234-6k_gorilla.htm";

// Serves the fixture pages; records every request.
function mockFetch(pages) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), ua: init.headers?.["user-agent"] });
    const body = pages[String(url)];
    if (body == null) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  return { fn, calls };
}
async function withFetch(pages, run) {
  const real = globalThis.fetch;
  const m = mockFetch(pages);
  globalThis.fetch = m.fn;
  try { return await run(m.calls); } finally { globalThis.fetch = real; }
}

test("figures beyond the first 2,500 characters are kept (SRFM)", () => {
  const filler = Array.from({ length: 30 }, (_, i) => `Surf Air continued to execute its transformation plan across the network in segment ${i}.`).join("\n");
  const text = `Surf Air Mobility Reports Third Quarter 2026 Financial Results\nLOS ANGELES -- Surf Air Mobility Inc. today reported results for the quarter.\n${filler}\nTotal revenue of $36.5 million, a 25% year-over-year increase.\nFull-year revenue guidance of $128 million to $138 million.\nForward-Looking Statements\nThis release has forward-looking statements under the Private Securities Litigation Reform Act of 1995 about $200 million.`;
  assert.ok(text.indexOf("$36.5 million") > 2500, "the figures sit past the old cut-off");
  const e = excerptFrom(text, "Surf Air Mobility Reports Third Quarter 2026 Financial Results");
  assert.ok(e.length <= 2500);
  assert.ok(e.startsWith("Surf Air Mobility Reports Third Quarter"));
  assert.ok(e.includes("Total revenue of $36.5 million, a 25% year-over-year increase."));
  assert.ok(e.includes("$128 million to $138 million"));
  assert.ok(!e.includes("Litigation Reform Act"), "forward-looking boilerplate is cut");
  assert.ok(e.includes(" … "), "skipped filler is marked");
});

test("short text is returned whole; sentences are scored on figures, not dates", () => {
  assert.equal(pickText("One line only."), "One line only.");
  assert.ok(figureScore("Revenue of $13.9 million, up 551%.") >= 5);
  assert.equal(figureScore("On November 5, 2026, the company held a call at 4:30 p.m."), 0);
  assert.equal(cutTail("Lead paragraph.\nAbout Red Cat Holdings, Inc.\nBoilerplate.", 5), "Lead paragraph.");
  assert.equal(cutTail("About 120 trucks were delivered.\nMore text.", 0), "About 120 trucks were delivered.\nMore text.");
});

test("page-chrome headings are not anchors (SRFM 'News Details')", () => {
  assert.equal(usableHeading("News Details"), false);
  assert.equal(usableHeading("Press Release"), false);
  assert.equal(usableHeading("Investor Relations"), false);
  assert.equal(usableHeading("Red Cat Receives $12.3 Million Order"), true);
  const text = "News Details\nView All News\nSurf Air Mobility Reports Third Quarter 2026 Financial Results\nNovember 5, 2026\nThird quarter revenue of $36.5 million.";
  const e = excerptFrom(text, "Surf Air Mobility Reports Third Quarter 2026 Financial Results, Meeting Revenue Guidance", "News Details");
  assert.ok(e.startsWith("Surf Air Mobility Reports"), e);
});

test("UMAC release pages are read from the company's B2i library", () => {
  assert.equal(excerptUrl("https://www.unusualmachines.com/press-release/?i=173088"),
    "https://www.b2i.us/b2i/LibraryView.asp?b=2958&api=Qk2Te5Pj8&id=173088");
  assert.equal(excerptUrl("https://www.unusualmachines.com/news-events/press-releases/"), "https://www.unusualmachines.com/news-events/press-releases/");
  assert.equal(excerptUrl("https://ir.redcatholdings.com/news/x?i=5"), "https://ir.redcatholdings.com/news/x?i=5");
});

test("UMAC fetch goes to B2i and anchors on the title", async () => {
  const body = `<style>.x{}</style><div>View All</div><div>November 5, 2026</div><div class="pressViewHeadline">Unusual Machines Third Quarter 2026 Shareholder Letter</div>
    <p>ORLANDO, FL / November 5, 2026 / Unusual Machines (NYSE American: UMAC) today filed its Form 10-Q and provided a letter to shareholders from its chief executive.</p>
    <p>In the third quarter, we generated $13.9 million in revenue, reflecting 551% year-over-year growth compared to the third quarter of 2025.</p>`;
  await withFetch({ "https://www.b2i.us/b2i/LibraryView.asp?b=2958&api=Qk2Te5Pj8&id=173088": body }, async (calls) => {
    const r = await fetchExcerpt({}, { url: "https://www.unusualmachines.com/press-release/?i=173088", title: "Unusual Machines Third Quarter 2026 Shareholder Letter" });
    assert.equal(r.status, "ok");
    assert.ok(r.excerpt.startsWith("Unusual Machines Third Quarter 2026 Shareholder Letter"));
    assert.ok(r.excerpt.includes("$13.9 million"));
    assert.deepEqual(calls.map((c) => c.url), ["https://www.b2i.us/b2i/LibraryView.asp?b=2958&api=Qk2Te5Pj8&id=173088"]);
  });
});

test("SEC bodies start at the first Item heading and stop at the signatures", () => {
  const body = secBody(htmlToText(SEC[AUR_8K]));
  assert.ok(body.startsWith("Item 2.02 Results of Operations"), body.slice(0, 80));
  assert.ok(!body.includes("0001828108"), "the hidden XBRL header is dropped");
  assert.ok(!body.includes("par value"), "the cover is skipped");
  assert.ok(!body.includes("duly caused"), "the signature block is cut");
  // A 10-Q table of contents is skipped to the first item with content.
  const tenQ = ["PART I. FINANCIAL INFORMATION", "Item 1. Financial Statements 3", "Item 2. Management's Discussion and Analysis 20",
    "Item 3. Quantitative and Qualitative Disclosures 31", "Item 4. Controls and Procedures 31", "PART I", "Item 1. Financial Statements",
    "Condensed consolidated balance sheets as of September 30, 2026 show total assets of $412.5 million and cash of $97.0 million at quarter end, an increase from the prior period.",
    "Item 2. Management's Discussion and Analysis", "Revenue increased 25% to $36.5 million.", "SIGNATURES", "Signed."].join("\n");
  assert.ok(secBody(tenQ).startsWith("Item 1. Financial Statements\nCondensed"), secBody(tenQ).slice(0, 60));
  // A 6-K without Item headings starts after the cover's check boxes.
  assert.ok(secBody(htmlToText(SEC[GRRR_6K])).startsWith("INFORMATION CONTAINED IN THIS REPORT"));
});

test("Ex-99.1 is found from the filing's own exhibit index, else from the EDGAR index page", () => {
  assert.equal(findExhibitLink(SEC[AUR_8K], AUR_8K), "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028xex991.htm");
  assert.equal(findExhibitLink(SEC[GRRR_6K], GRRR_6K), null, "the 6-K names the exhibit without linking it");
  const idx = filingIndexUrl(GRRR_6K);
  assert.equal(idx, "https://www.sec.gov/Archives/edgar/data/1903145/000121390026112233/0001213900-26-112233-index.htm");
  assert.equal(exhibitFromIndex(SEC[idx], idx), "https://www.sec.gov/Archives/edgar/data/1903145/000121390026112233/gorilla_pr_facility.htm");
  // Links that leave the filing are never followed.
  assert.equal(findExhibitLink('<a href="https://evil.example/ex99-1.htm">99.1</a>', AUR_8K), null);
  assert.equal(findExhibitLink('<a href="/Archives/edgar/data/1/000000000000000001/ex99-1.htm">x</a>', AUR_8K), null);
});

test("8-K excerpt: Item text, then the release's figures (AUR Q3)", async () => {
  await withFetch(SEC, async (calls) => {
    const r = await fetchExcerpt({ CONTACT_EMAIL: "ops@example.org" }, { url: AUR_8K, title: "Aurora Innovation, Inc.: 8-K filed 2026-10-28" });
    assert.equal(r.status, "ok");
    assert.ok(r.excerpt.startsWith("Item 2.02 Results of Operations"));
    assert.ok(r.excerpt.includes("EX-99.1: "));
    assert.ok(r.excerpt.includes("Revenue was $3.1 million"));
    assert.ok(r.excerpt.includes("about $200 million of 2027 revenue"));
    assert.ok(r.excerpt.includes("500 Aurora Driver-powered trucks"));
    assert.ok(!r.excerpt.includes("Litigation Reform Act"));
    assert.ok(r.excerpt.length <= 2500);
    assert.deepEqual(calls.map((c) => c.url), [AUR_8K, "https://www.sec.gov/Archives/edgar/data/1828108/000182810826000045/aur-20261028xex991.htm"]);
    assert.ok(calls.every((c) => c.ua === "zenith-core ops@example.org"), "sec.gov gets the contact address");
  });
});

test("6-K excerpt fetches the index to find the unlinked exhibit (GRRR facility)", async () => {
  await withFetch(SEC, async (calls) => {
    const r = await fetchExcerpt({ CONTACT_EMAIL: "ops@example.org" }, { url: GRRR_6K, title: "Gorilla Technology Group Inc.: 6-K filed 2026-11-03" });
    assert.equal(r.status, "ok");
    assert.ok(r.excerpt.includes("convertible note facility"));
    assert.ok(r.excerpt.includes("US$111 million"));
    assert.ok(r.excerpt.includes("4.5% coupon"));
    assert.equal(calls.length, 3, "filing, index, exhibit");
  });
});

test("no contact address: sec.gov is never requested", async () => {
  await withFetch(SEC, async (calls) => {
    assert.deepEqual(await fetchExcerpt({}, { url: AUR_8K, title: "x" }), { status: "skipped_sec_needs_contact" });
    assert.equal(calls.length, 0);
  });
});

test("an exhibit-less filing keeps its own text", () => {
  const text = "Item 5.02 Departure of Directors or Certain Officers.\nOn November 10, 2026, the Board appointed Jane Roe as Chief Financial Officer, effective December 1, 2026, with a base salary of $450,000.";
  assert.ok(secExcerpt(text, "").startsWith("Item 5.02"));
  assert.ok(secExcerpt(text, "").includes("$450,000"));
});
