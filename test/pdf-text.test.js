// The PDF reader (roadmap T9): synthesized files with the structures real
// covered decks use. Real decks (ONDS, RCAT, PL, SRFM) were read from the audit
// machine when this was built; they are not stored here.
import test from "node:test";
import assert from "node:assert/strict";
import { pdfText, readable } from "../worker/src/pdf-text.js";
import { buildPdf, objStm, toUnicodeCMap, glyphHex, simplePdf } from "./helpers/pdf.js";

const ALPHABET = "InvestorPPresntai Q3$12.5ml,p9%BckgDTEJbuyNVd";

// A deck page in a composite font (Identity-H, ToUnicode, /W widths), with the
// page tree and fonts packed in an object stream and an XRef stream trailer, as
// PowerPoint and Equisolve-hosted decks are.
function deckPdf({ withToUnicode = true } = {}) {
  const t = (s) => `<${glyphHex(ALPHABET, s)}>`;
  const content = [
    "q 1 0 0 1 0 0 cm BT /F1 24 Tf 1 0 0 1 72 700 Tm",
    `[${t("Investor")} -300 ${t("Pre")} -10 ${t("sentation")}] TJ`,
    "1 0 0 1 72 660 Tm",
    `${t("Q3 revenue $12.5 million, up 39%")} Tj`,
    "ET Q",
    "/Fm1 Do",
  ].join("\n");
  const form = "BT /F2 12 Tf 72 600 Td 14 TL (Company\\200s backlog \\201 $70m) Tj T* " +
    "(Demand was strong across every region, and the outlook for the full year was raised again.) Tj ET";
  const members = [
    { num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, dict: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { num: 3, dict: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 6 0 R >> /XObject << /Fm1 8 0 R >> >> /Contents 7 0 R >>" },
    { num: 4, dict: `<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Calibri /Encoding /Identity-H /DescendantFonts [5 0 R]${withToUnicode ? " /ToUnicode 9 0 R" : ""} >>` },
    { num: 5, dict: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Calibri /DW 500 /W [1 [500 500 500]] >>" },
    { num: 6, dict: "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FirstChar 32 /Widths [278] /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [128 /quoteright /bullet] >> >>" },
  ];
  return buildPdf([
    objStm(20, members),
    { num: 7, dict: "<< >>", stream: content, flate: true },
    { num: 8, dict: "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F2 6 0 R >> >> >>", stream: form, flate: true },
    { num: 9, dict: "<< >>", stream: toUnicodeCMap(ALPHABET), flate: true },
    { num: 10, dict: "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>", stream: Buffer.alloc(64, 7), flate: true },
  ], { xrefStream: true });
}

test("a composite-font deck in an object stream reads as lines of words, with its form XObject", async () => {
  const r = await pdfText(deckPdf());
  assert.deepEqual(r.pages, ["Investor Presentation\nQ3 revenue $12.5 million, up 39%\nCompany’s backlog • $70m\n" +
    "Demand was strong across every region, and the outlook for the full year was raised again."]);
  assert.equal(r.status, "ok");
  assert.equal(r.stats.undecodable, 0);
});

test("a composite font without ToUnicode is skipped, never guessed", async () => {
  const r = await pdfText(deckPdf({ withToUnicode: false }));
  assert.match(r.pages[0], /^Company’s backlog • \$70m\nDemand/, "only the WinAnsi form text survives");
  assert.ok(r.stats.undecodable >= 2);
});

test("simple fonts: pages in page-tree order, escapes and T* line breaks", async () => {
  const lines = (n) => [`Page ${n} heading with (parentheses) and a back\\slash`, ...Array.from({ length: 8 }, (_, k) => `Line ${k} of page ${n} says revenue grew to $${k}.5 million in the quarter.`)];
  const r = await pdfText(simplePdf([lines(1), lines(2)]));
  assert.equal(r.status, "ok");
  assert.equal(r.pages.length, 2);
  assert.equal(r.pages[0].split("\n")[0], "Page 1 heading with (parentheses) and a back\\slash");
  assert.equal(r.pages[1].split("\n")[8], "Line 7 of page 2 says revenue grew to $7.5 million in the quarter.");
});

test("encrypted files and non-PDFs are refused", async () => {
  assert.equal((await pdfText(simplePdf([["Secret text here"]], { trailerExtra: "/Encrypt 99 0 R" }))).status, "encrypted");
  assert.equal((await pdfText(new TextEncoder().encode("<html>not a pdf</html>"))).status, "not_pdf");
});

test("a file read as head and tail yields the pages both parts hold, fonts from the tail", async () => {
  const t = (s) => `<${glyphHex(ALPHABET, s)}>`;
  const filler = Buffer.alloc(300_000, 0x41);
  const pdf = buildPdf([
    { num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, dict: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /Resources << /Font << /F1 7 0 R >> >> >>" },
    { num: 3, dict: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>" },
    { num: 4, dict: "<< >>", stream: `BT /F1 12 Tf 72 700 Td ${t("Investor Presentation")} Tj ET`, flate: true },
    { num: 20, dict: "<< /Type /XObject /Subtype /Image >>", stream: filler },
    { num: 5, dict: "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>" },
    { num: 6, dict: "<< >>", stream: `BT /F1 12 Tf 72 700 Td ${t("Q3 revenue $12.5 million, up 39%")} Tj ET`, flate: true },
    { num: 7, dict: "<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 8 0 R >>" },
    { num: 8, dict: "<< >>", stream: toUnicodeCMap(ALPHABET), flate: true },
  ]);
  const head = pdf.subarray(0, 150_000), tail = pdf.subarray(pdf.length - 100_000);
  const both = await pdfText([head, tail]);
  assert.deepEqual(both.pages, ["Investor Presentation", "Q3 revenue $12.5 million, up 39%"]);
  assert.equal(both.stats.truncated, true);
  const headOnly = await pdfText(head);
  assert.deepEqual(headOnly.pages, [""], "without the tail the font is missing: nothing is guessed");
});

test("content work is bounded: a megabyte of path operators reads quickly", async () => {
  const paths = Array.from({ length: 60_000 }, (_, k) => `${k} ${k + 1} m ${k + 2} ${k + 3} l S`).join("\n");
  const pdf = simplePdf([["Heading of the slide with enough words to be readable text here."]]);
  const big = buildPdf([
    { num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, dict: "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>" },
    { num: 3, dict: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>" },
    { num: 4, dict: "<< >>", stream: `${paths}\nBT /F1 12 Tf 72 700 Td (The end of the slide) Tj ET`, flate: true },
    { num: 5, dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
  ]);
  const started = Date.now();
  const r = await pdfText(big);
  assert.ok(Date.now() - started < 3000);
  assert.equal(r.pages[0], "The end of the slide");
  assert.equal((await pdfText(pdf)).status, "no_text", "too little text to call readable");
});

test("readable() refuses symbol soup", () => {
  assert.equal(readable("§¤¶ ÷×Ø ¦¬¯ ".repeat(40)), false);
  assert.equal(readable("Revenue grew thirty nine percent to twelve million dollars in the third quarter of the year. ".repeat(3)), true);
});
