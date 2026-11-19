import test from "node:test";
import assert from "node:assert/strict";
import { bandFor, normalizeGrade, parseItemRef, skipReason, tokenMatches, roleFor } from "../worker/src/lib.js";
const COVERED = ["RCAT", "UMAC", "ONDS"];

const item = { id: 7, ticker: "RCAT" };
const base = { item_id: 7, ticker: "RCAT", score: 82, band: "digest", why: "Army SRR Tranche 2 order, ~6% of FY26 revenue guide." };

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
  const r = normalizeGrade({ ...base, thesis_drivers_hit: ["SRR production"], magnitude_usd: "12000000", confidence: 1.4, read_source: true }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.band, "digest");
  assert.equal(r.grade.magnitude_usd, 12000000);
  assert.equal(r.grade.confidence, 1);
  assert.equal(r.grade.read_source, 1);
  assert.deepEqual(JSON.parse(r.grade.thesis_drivers), ["SRR production"]);
});

test("band is derived from score, and a mismatch is flagged", () => {
  const r = normalizeGrade({ ...base, score: 91, band: "digest" }, item);
  assert.equal(r.grade.band, "lead");
  assert.ok(JSON.parse(r.grade.flags).includes("band_corrected_from_digest"));
});

test("invalid grades are rejected", () => {
  assert.equal(normalizeGrade({ ...base, score: 101 }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, score: 55.5 }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, score: null }, item).ok, false, "null score without duplicate band");
  assert.equal(normalizeGrade({ ...base, why: "  " }, item).ok, false);
  assert.equal(normalizeGrade(base, undefined).ok, false);
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS" }, item).ok, false, "other ticker without a reason");
});

test("ticker mismatch is allowed with an off-entity or out-of-scope reason", () => {
  const r = normalizeGrade({ ...base, score: 3, ticker: "ONDS", flags: ["reason:off_entity"] }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.ticker, "RCAT");
  assert.equal(r.grade.primary, true);
  assert.equal(normalizeGrade({ ...base, score: 3, ticker: null, flags: ["reason:out_of_scope"] }, item).ok, true);
});

test("duplicates carry a null score and the duplicate band", () => {
  const r = normalizeGrade({ ...base, score: null, band: "duplicate", flags: ["reason:duplicate", "dup_of:118"] }, item);
  assert.equal(r.ok, true);
  assert.equal(r.grade.score, null);
  assert.equal(r.grade.band, "duplicate");
  assert.equal(r.grade.dup_of, "118");
});

test("covered-to-covered grades use the #TICKER suffix", () => {
  assert.deepEqual(parseItemRef("123#umac"), { id: 123, alsoTicker: "UMAC" });
  assert.deepEqual(parseItemRef(45), { id: 45, alsoTicker: null });
  assert.equal(parseItemRef("abc"), null);
  const r = normalizeGrade({ ...base, ticker: "UMAC", flags: ["reason:material", "also:RCAT"] }, item, "UMAC", COVERED);
  assert.equal(r.ok, true);
  assert.equal(r.grade.ticker, "UMAC");
  assert.equal(r.grade.primary, false);
  assert.equal(normalizeGrade({ ...base, ticker: "UMAC" }, item, "TSLA", COVERED).ok, false, "suffix must be covered");
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS" }, item, "UMAC", COVERED).ok, false, "ticker must match suffix");
});

test("a grade without a reason flag is accepted but marked", () => {
  const r = normalizeGrade(base, item);
  assert.ok(JSON.parse(r.grade.flags).includes("contract:no_reason"));
  const r2 = normalizeGrade({ ...base, flags: ["reason:material"] }, item);
  assert.ok(!JSON.parse(r2.grade.flags).includes("contract:no_reason"));
});

test("stale seeds are skipped on arrival, fresh items are not", () => {
  assert.equal(skipReason({ published: "2025-01-10T00:00:00Z", first_seen: "2026-11-18T00:00:00Z" }), "stale_on_arrival");
  assert.equal(skipReason({ published: "2026-11-17T00:00:00Z", first_seen: "2026-11-18T00:00:00Z" }), null);
  assert.equal(skipReason({ published: null, first_seen: "2026-11-18T00:00:00Z" }), null);
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
