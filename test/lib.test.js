import test from "node:test";
import assert from "node:assert/strict";
import { bandFor, normalizeGrade, parseItemRef, skipReason, tokenMatches, roleFor, chunk, isHttpUrl } from "../worker/src/lib.js";

const COVERED = ["RCAT", "UMAC", "ONDS"];
const item = { id: 7, ticker: "RCAT" };
const base = { item_id: 7, ticker: "RCAT", score: 82, band: "digest", why: "Army SRR Tranche 2 order, ~6% of FY26 revenue guide.", flags: ["reason:material"], read_source: true };

test("bands follow the core scale", () => {
  assert.equal(bandFor(100), "lead");
  assert.equal(bandFor(90), "lead");
  assert.equal(bandFor(89), "digest");
  assert.equal(bandFor(70), "digest");
  assert.equal(bandFor(69), "borderline");
  assert.equal(bandFor(40), "borderline");
  assert.equal(bandFor(39), "reject");
  assert.equal(bandFor(0), "reject");
});

test("a valid grade is normalized", () => {
  const r = normalizeGrade({ ...base, thesis_drivers_hit: ["srr"], magnitude_usd: "12000000", confidence: 1.4 }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.band, "digest");
  assert.equal(r.grade.magnitude_usd, 12000000);
  assert.equal(r.grade.confidence, 1);
  assert.equal(r.grade.read_source, 1);
  assert.equal(r.grade.reason, "material");
  assert.deepEqual(JSON.parse(r.grade.thesis_drivers), ["srr"]);
});

test("band is derived from score, and a mismatch is flagged", () => {
  const r = normalizeGrade({ ...base, score: 91, band: "digest" }, item);
  assert.equal(r.grade.band, "lead");
  assert.ok(JSON.parse(r.grade.flags).includes("band_corrected_from_digest"));
});

test("invalid grades are rejected", () => {
  assert.equal(normalizeGrade({ ...base, score: 101 }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, score: 55.5 }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, score: null }, item).ok, false, "null score without duplicate");
  assert.equal(normalizeGrade({ ...base, why: "  " }, item).ok, false);
  assert.equal(normalizeGrade(base, undefined).ok, false);
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS" }, item).ok, false, "other ticker without a reason");
  assert.equal(normalizeGrade({ ...base, read_source: "yes" }, item).ok, false, "read_source must be boolean");
});

test("exactly one known reason flag is required", () => {
  assert.equal(normalizeGrade({ ...base, flags: [] }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, flags: ["reason:material", "reason:primary_source"] }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, flags: ["reason:vibes"] }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, flags: ["reason:primary_source", "group:axon_awards"] }, item).ok, true);
});

test("unread sources cap confidence at 0.5", () => {
  const r = normalizeGrade({ ...base, read_source: false, confidence: 0.9 }, item);
  assert.equal(r.grade.confidence, 0.5);
  assert.ok(JSON.parse(r.grade.flags).includes("confidence_capped"));
});

test("ticker mismatch is allowed with an off-entity or out-of-scope reason", () => {
  const r = normalizeGrade({ ...base, score: 3, ticker: "ONDS", flags: ["reason:off_entity"] }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.ticker, "RCAT");
  assert.equal(r.grade.primary, true);
  assert.equal(normalizeGrade({ ...base, score: 3, ticker: null, flags: ["reason:out_of_scope"] }, item).ok, true);
});

test("duplicates carry a null score, the duplicate band and dup_of", () => {
  const r = normalizeGrade({ ...base, score: null, band: "duplicate", flags: ["reason:duplicate", "dup_of:118"] }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.score, null);
  assert.equal(r.grade.band, "duplicate");
  assert.equal(r.grade.dup_of, "118");
  assert.equal(normalizeGrade({ ...base, score: null, band: "duplicate", flags: ["reason:duplicate"] }, item).ok, false, "needs dup_of");
  assert.equal(normalizeGrade({ ...base, score: 40, flags: ["reason:duplicate", "dup_of:118"] }, item).ok, false, "duplicate with a score");
});

test("covered-to-covered grades use the #TICKER suffix; own ticker is primary", () => {
  assert.deepEqual(parseItemRef("123#umac"), { id: 123, alsoTicker: "UMAC" });
  assert.deepEqual(parseItemRef(45), { id: 45, alsoTicker: null });
  assert.equal(parseItemRef("abc"), null);
  const r = normalizeGrade({ ...base, ticker: "UMAC", flags: ["reason:material", "also:RCAT"] }, item, "UMAC", COVERED);
  assert.equal(r.ok, true);
  assert.equal(r.grade.ticker, "UMAC");
  assert.equal(r.grade.primary, false);
  const own = normalizeGrade({ ...base }, item, "RCAT", COVERED);
  assert.equal(own.ok, true);
  assert.equal(own.grade.primary, true, "'7#RCAT' on an RCAT item is the primary grade");
  assert.equal(normalizeGrade({ ...base, ticker: "UMAC" }, item, "TSLA", COVERED).ok, false, "suffix must be covered");
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS" }, item, "UMAC", COVERED).ok, false, "ticker must match suffix");
});

test("stale seeds are skipped on arrival, fresh items are not", () => {
  assert.equal(skipReason({ published: "2025-01-10T00:00:00Z", first_seen: "2026-11-18T00:00:00Z" }), "stale_on_arrival");
  assert.equal(skipReason({ published: "2026-11-17T00:00:00Z", first_seen: "2026-11-18T00:00:00Z" }), null);
  assert.equal(skipReason({ published: null, first_seen: "2026-11-18T00:00:00Z" }), null);
});

test("helpers: chunking and URL schemes", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(chunk(Array.from({ length: 250 }, (_, i) => i)).every((p) => p.length <= 90), true);
  assert.equal(isHttpUrl("https://ir.example.com/a"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("not a url"), false);
});

test("tokens and roles", () => {
  assert.equal(tokenMatches("abc", "abc"), true);
  assert.equal(tokenMatches("abd", "abc"), false);
  assert.equal(tokenMatches("", "abc"), false);
  const env = { ADMIN_TOKEN: "a".repeat(40), GRADER_TOKEN: "g".repeat(40), APP_TOKEN: "p".repeat(40) };
  const req = (t) => new Request("https://x/v1/feed", { headers: t ? { authorization: `Bearer ${t}` } : {} });
  assert.equal(roleFor(req(env.GRADER_TOKEN), env), "grader");
  assert.equal(roleFor(req(env.APP_TOKEN), env), "app");
  assert.equal(roleFor(req(env.ADMIN_TOKEN), env), "admin");
  assert.equal(roleFor(req("nope"), env), null);
  assert.equal(roleFor(req(null), env), null);
});
