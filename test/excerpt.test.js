import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, excerptFrom } from "../worker/src/excerpt.js";

const page = `<html><head><style>.x{}</style><script>var a=1</script></head><body>
<nav>Home | Investors | News</nav><header>Red Cat Holdings</header>
<h1>Red Cat Receives $12.3 Million Order for Black Widow Systems</h1>
<p>SAN JUAN, Puerto Rico, Nov. 17, 2026 &mdash; Red Cat Holdings, Inc. (Nasdaq: RCAT) today announced&nbsp;an order&hellip;</p>
<p>The order brings 2026 SRR deliveries to&#160;1,200 units.</p><footer>Contact IR</footer></body></html>`;

test("htmlToText strips chrome, scripts and entities", () => {
  const t = htmlToText(page);
  assert.ok(!t.includes("var a=1"));
  assert.ok(!t.includes("Home | Investors"));
  assert.ok(!t.includes("Contact IR"));
  assert.ok(t.includes("Nov. 17, 2026 — Red Cat Holdings"));
  assert.ok(t.includes("1,200 units"));
});

test("excerpt starts at the headline", () => {
  const t = "Skip menu text and cookie banner. " + htmlToText(page);
  const e = excerptFrom(t, "Red Cat Receives $12.3 Million Order for Black Widow Systems");
  assert.ok(e.startsWith("Red Cat Receives"));
  assert.ok(e.length <= 2500);
});

test("excerpt falls back to the top when the headline is not found", () => {
  const e = excerptFrom("Body text only, no headline here.", "Completely Different Words Entirely");
  assert.equal(e, "Body text only, no headline here.");
});
