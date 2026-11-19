import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, excerptFrom, firstHeading } from "../worker/src/excerpt.js";

const page = `<html><head><title>Investors | Red Cat</title><style>.x{}</style><script>var a=1</script></head><body>
<nav>Home | Investors | News</nav><header><h1>Red Cat Receives $12.3 Million Order for Black Widow Systems</h1></header>
<form id="aspnetForm"><p>SAN JUAN, Puerto Rico, Nov. 17, 2026 &mdash; Red Cat Holdings, Inc. (Nasdaq: RCAT) today announced&nbsp;an order&hellip;</p>
<p>The order brings 2026 SRR deliveries to&#160;1,200 units &#x1F680;.</p></form><aside>Related stories</aside><footer>Contact IR</footer></body></html>`;

test("htmlToText strips chrome, head, scripts and entities but keeps form and header content", () => {
  const t = htmlToText(page);
  assert.ok(!t.includes("var a=1"));
  assert.ok(!t.includes("Investors | Red Cat"), "head/title removed");
  assert.ok(!t.includes("Home | Investors"));
  assert.ok(!t.includes("Contact IR"));
  assert.ok(!t.includes("Related stories"));
  assert.ok(t.includes("Red Cat Receives $12.3 Million Order"), "header h1 kept");
  assert.ok(t.includes("Nov. 17, 2026 — Red Cat Holdings"), "ASP.NET form body kept");
  assert.ok(t.includes("1,200 units 🚀"), "astral code points decoded");
});

test("excerpt anchors on the h1, then the title", () => {
  const t = "Skip menu text and cookie banner. " + htmlToText(page);
  const e = excerptFrom(t, "unrelated feed title words here", firstHeading(page));
  assert.ok(e.startsWith("Red Cat Receives"));
  assert.ok(e.length <= 2500);
  const e2 = excerptFrom(t, "Red Cat Receives $12.3 Million Order", "");
  assert.ok(e2.startsWith("Red Cat Receives"));
});

test("excerpt falls back to the top when nothing matches", () => {
  assert.equal(excerptFrom("Body text only, no headline here.", "Completely Different Words Entirely"), "Body text only, no headline here.");
});

test("hostile markup is handled in linear time", () => {
  const evil = "<script>".repeat(40000) + "<!--".repeat(40000) + "<p>text</p>";
  const t0 = Date.now();
  htmlToText(evil);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
});
