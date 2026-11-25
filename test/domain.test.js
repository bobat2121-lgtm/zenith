// worker/src/domain.js: registrable domains, shared by the catalog script and
// the Worker.
import test from "node:test";
import assert from "node:assert/strict";
import { regDomain, hostOf } from "../worker/src/domain.js";

test("regDomain: the last two labels, or three under a country second level; hostOf is empty on a bad URL", () => {
  assert.equal(regDomain("ir.example.com"), "example.com");
  assert.equal(regDomain("news.example.co.uk"), "example.co.uk");
  assert.equal(regDomain("www.gov.uk"), "www.gov.uk", "government hosts are classed before regDomain is consulted");
  assert.equal(regDomain("IR.Example.COM."), "example.com", "lower-cased, trailing dot dropped");
  assert.equal(regDomain("example.com"), "example.com");
  assert.equal(regDomain("a.b.example.io"), "example.io", "not a country second level");
  assert.equal(regDomain("shop.example.com.au"), "example.com.au");
  assert.equal(regDomain(""), "");
  assert.equal(hostOf("https://IR.Example.com/news?x=1"), "ir.example.com");
  assert.equal(hostOf("not a url"), "");
  assert.equal(hostOf(undefined), "");
  assert.equal(regDomain(hostOf("not a url")), "");
});
