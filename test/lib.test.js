import test from "node:test";
import assert from "node:assert/strict";
import { bandFor, normalizeGrade, skipReason, tokenMatches, roleFor } from "../worker/src/lib.js";

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
  assert.equal(normalizeGrade({ ...base, why: "  " }, item).ok, false);
  assert.equal(normalizeGrade(base, undefined).ok, false);
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS" }, item).ok, false);
  assert.equal(normalizeGrade({ ...base, ticker: "ONDS", flags: ["off_entity"] }, item).ok, true);
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
