// Phase 4 Part B (Z-B6): the group-routed registers write card bodies of
// 1,500-2,500 characters (decision or rows first, a source line last), so
// zenith-core's feedText keeps the whole body as the excerpt (excerpt_status
// 'feed') and enrich never fetches the pointer URL. Synthetic bodies in the
// two card shapes; every name, rule, report, date and amount is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const { feedText, EXCERPT_CHARS } = await import("../worker/src/excerpt.js");
const { feedFields } = await import("../worker/src/ingest.js");

// Fills a list of lines with numbered context lines until the body reaches `target` characters.
function body(head, tail, target) {
  const lines = [...head];
  for (let n = 1; [...lines, ...tail].join("\n").length < target; n++) {
    lines.push(`- Test rule ${n} (Test Agency, test stage): under review since 01/0${(n % 9) + 1}/2026; it concerns test operations in test airspace.`);
  }
  return [...lines, ...tail].join("\n");
}

const DECISION_HEAD = [
  "Review concluded 03/04/2026, consistent with change: Test Agency \"Test Rule on Example Operations\" (Interim Final Rule), received 01/02/2026, 61 days under review.",
  "Flags: economically significant no; major no; legal deadline none.",
  "Federal Register, checked 2026-03-04T10:00:00Z: no document for the rule dated on or after 01/02/2026 (some agencies' documents carry no rule identifier there).",
  "Earlier reviews of this rule this year: none.",
  "The group's rules still under review:",
];
const DECISION_TAIL = [
  "An OIRA conclusion means the review of the rule ended; the agency may now publish it, and publication is checked separately.",
  "Source: OIRA review lists (test fixture), run date 03/04/2026, retrieved 03/04/2026.",
];
const ROWS_HEAD = [
  "Test Report 1-001 (Test Appropriations Act, 2027), Test Committee, published 2026-03-04.",
  "- TEST PROCUREMENT, ARMY: 3 SMALL TEST AIRCRAFT: request $123.4M, recommended $56.7M, change -$66.7M",
  "  Program decrease--excess to need -$40.0M",
  "  Program increase--test payloads +$5.0M",
  "- TEST PROCUREMENT, ARMY: 1 TEST UAV: request $0.0M, recommended $200.0M, change +$200.0M",
  "Report language:",
];
const ROWS_TAIL = ["Source: test congressional reports feed, published 2026-03-04, retrieved 2026-03-04."];

test("Z-B6 a register card body of 1,500-2,500 characters is kept whole: full, excerpt equal to the body, decision line, both dates and the top row in it", () => {
  assert.equal(EXCERPT_CHARS, 2500);
  for (const [name, text, must] of [
    ["decision card", body(DECISION_HEAD, DECISION_TAIL, 1900), ["consistent with change", "received 01/02/2026", "Review concluded 03/04/2026", "Source: OIRA review lists"]],
    ["rows card", body(ROWS_HEAD, ROWS_TAIL, 2300), ["request $123.4M, recommended $56.7M, change -$66.7M", "excess to need -$40.0M", "+$200.0M", "Source: test congressional reports feed"]],
    ["short edge", body(DECISION_HEAD, DECISION_TAIL, 1500), ["Review concluded 03/04/2026"]],
  ]) {
    assert.ok(text.length >= 1500 && text.length <= 2500, `${name}: ${text.length} characters`);
    const title = `[Alpha policy] ${name}`;
    const r = feedText(text, title);
    assert.equal(r.full, true, name);
    assert.equal(r.excerpt, text, `${name}: the excerpt is the whole body`);
    for (const m of must) assert.ok(r.excerpt.includes(m), `${name}: ${m}`);
    const f = feedFields({ body: text, title }, { role: "program" }, "2026-03-04T10:00:00.000Z");
    assert.deepEqual([f.status, f.excerpt, f.source], ["feed", text, null], `${name}: ingest stores it as the feed excerpt`);
  }
});

test("Z-B6 a body under 1,500 characters is not full: enrich fetches the URL and the body is only the fallback", () => {
  const text = body(DECISION_HEAD, DECISION_TAIL, 1400).slice(0, 1400).replace(/\s+\S*$/, ".");
  assert.ok(text.length < 1500, String(text.length));
  assert.equal(feedText(text, "[Alpha policy] short").full, false);
  const f = feedFields({ body: text, title: "[Alpha policy] short" }, { role: "program" }, "2026-03-04T10:00:00.000Z");
  assert.equal(f.status, null);
  assert.ok(f.fallback && f.fallback.startsWith("Review concluded 03/04/2026"), "kept as the fallback");
});
