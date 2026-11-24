import test from "node:test";
import assert from "node:assert/strict";
import { bandFor, normalizeGrade, parseItemRef, skipReason, tokenMatches, roleFor, chunk, isHttpUrl, normalizeRelations, candidateName, coveredTicker,
  RELATION_TYPES, normalizeAbout, ABOUT_MAX } from "../worker/src/lib.js";

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

// --- Relations (plans/round5-expansion-approve-queue.md, A2): a bad entry is
// dropped with a warning and the grade is still accepted.
const rel = (relations, over = {}, ref = item, also = null) => {
  const r = normalizeGrade({ ...base, relations, ...over }, ref, also, COVERED);
  assert.equal(r.ok, true, `the grade is still accepted: ${r.error}`);
  return r;
};
const keptNames = (r) => r.relations.map((x) => x.name);
const R = (name, type = "acquired", evidence = 7) => ({ type, name, evidence });

test("relations: kept entries are normalized; absent or [] means none", () => {
  const r = rel([R("Stemme"), { type: " Customer ", name: "  Army   Contracting  Command ", evidence: "7" }, R("UNMAS (UN)", "award")]);
  assert.deepEqual(r.relations, [
    { type: "acquired", name: "Stemme", evidence: 7 },
    { type: "customer", name: "Army Contracting Command", evidence: 7 },
    { type: "award", name: "UNMAS", evidence: 7 },
  ]);
  assert.deepEqual(r.warnings, []);
  for (const v of [undefined, null, []]) assert.deepEqual([rel(v).relations, rel(v).warnings], [[], []]);
  assert.equal("relations" in rel([R("Stemme")]).grade, false, "the stored grade gains no column");
  assert.deepEqual(RELATION_TYPES, ["acquired", "acquirer", "customer", "partner", "supplier", "subsidiary", "award"]);
});

test("relations: covered names are dropped, sheet product terms are kept", () => {
  // The ticker, a sheet's name:, its first terms entry (ONDS has no name:) and key-accounts company_names.
  for (const name of ["UMAC", "Unusual Machines, Inc.", "Unusual Machines", "Ondas", "Red Cat", "Red Cat Holdings, Inc."]) {
    const r = rel([R(name)]);
    assert.deepEqual(r.relations, [], name);
    assert.match(r.warnings[0], /dropped: name is a covered company \([A-Z]+\)/, name);
  }
  assert.equal(coveredTicker("Ondas Inc."), "ONDS", "compared by dedupe key");
  // MATCH.terms hold products and units, which stay candidates.
  assert.deepEqual(keptNames(rel([R("Carbyne"), R("Upgrade Energy"), R("Stemme")])), ["Carbyne", "Upgrade Energy", "Stemme"]);
  // The subject itself.
  const own = rel([R("RCAT")]);
  assert.deepEqual(own.relations, []);
});

test("relations: names with a URL, a | or (, control characters or outside 2-80 characters are dropped", () => {
  const x80 = "A".repeat(80), x81 = "A".repeat(81);
  for (const name of ["https://example.com", "stemme.de/news", "Acme | Corp", "Acme (Holdings", "Foo (bar) baz", "A\u0007cme", "A", "  ", x81, 42, null]) {
    const r = rel([R(name)]);
    assert.deepEqual(r.relations, [], String(name));
    assert.equal(r.warnings.length, 1, String(name));
    assert.match(r.warnings[0], /^relation 1.* dropped: /);
  }
  assert.deepEqual(keptNames(rel([R(x80)])), [x80], "80 characters is the limit, checked before any clip");
  assert.deepEqual(keptNames(rel([R("O'Neil & Sons, Ltd.")])), ["O'Neil & Sons, Ltd."]);
  assert.equal(candidateName("Zürich Robotik AG"), "Zürich Robotik AG", "Unicode letters pass");
  assert.match(rel([R("--")]).warnings[0], /name has no letters or digits/);
});

test("relations: a bad type, wrong evidence, a repeat, a 5th entry and a bad shape are dropped", () => {
  const r = rel([R("Stemme", "investor"), R("Alpha", "acquired", 8), R("Gamma"), R("gamma inc", "partner"), R("Delta"), R("Epsilon")]);
  assert.deepEqual(keptNames(r), ["Gamma"]);
  assert.match(r.warnings[0], /^relation 1 "Stemme" dropped: type must be one of acquired, acquirer/);
  assert.match(r.warnings[1], /^relation 2 "Alpha" dropped: evidence must be the item you are grading \(7\)/);
  assert.match(r.warnings[2], /^relation 4 "gamma inc" dropped: repeats an earlier relation/);
  assert.match(r.warnings[3], /^relation 5 "Delta" dropped: relations holds at most 4 entries/);
  assert.match(r.warnings[4], /^relation 6 "Epsilon" dropped: relations holds at most 4/);
  assert.equal(r.warnings.length, 5);
  // Evidence is the graded item's id, as a number or digits; nothing else.
  for (const evidence of [undefined, null, "7#RCAT", "item 7", 7.5, [7]]) {
    assert.match(rel([{ type: "partner", name: "Acme", evidence }]).warnings[0], /evidence must be the item you are grading/, String(evidence));
  }
  // Not an array, or an entry that is not an object.
  assert.match(rel("Stemme").warnings[0], /relations must be an array/);
  assert.match(rel({ type: "partner", name: "Acme", evidence: 7 }).warnings[0], /relations must be an array/);
  assert.match(rel(["Stemme", [1]]).warnings[1], /^relation 2 dropped: each relation must be/);
  // The helper on its own, for an aux subject.
  const aux = normalizeRelations([R("Rockwell Automation", "acquirer", 1859), R("AGILOX", "acquired", 1859)], { itemId: 1859, subject: "Rockwell Automation Inc." });
  assert.deepEqual(aux.relations, [{ type: "acquired", name: "AGILOX", evidence: 1859 }]);
  assert.match(aux.warnings[0], /dropped: name is the grade's own subject/);
});

test("relations: an about is kept squashed; a too-long, URL or control-character about is dropped with a warning and the entry is kept", () => {
  const A = (name, about) => ({ ...R(name), about });
  const ok = rel([A("Stemme", "  Swiss maker of\n electric \t motor gliders "), A("UNMAS", "UN agency that runs mine-clearance programs"), R("ARAN Defense")]);
  assert.deepEqual(ok.relations, [
    { type: "acquired", name: "Stemme", evidence: 7, about: "Swiss maker of electric motor gliders" },
    { type: "acquired", name: "UNMAS", evidence: 7, about: "UN agency that runs mine-clearance programs" },
    { type: "acquired", name: "ARAN Defense", evidence: 7 },
  ]);
  assert.deepEqual(ok.warnings, []);
  assert.equal(ABOUT_MAX, 160);
  // 160 characters after the squash is the limit, checked before any clip.
  const x160 = "A".repeat(160), x161 = "B".repeat(161);
  assert.equal(rel([A("Stemme", ` ${x160} `)]).relations[0].about, x160);
  for (const [about, why] of [[x161, /about must be at most 160 characters \(got 161\)/], ["Glider maker, see www.stemme.de", /about must not contain a URL/],
    ["Maker at https://stemme.com", /about must not contain a URL/], ["Glider\u0007 maker", /about must not contain control characters/],
    ["Glider \u202emaker", /about must not contain control characters/], [42, /about must be a string/]]) {
    const r = rel([A("Stemme", about)]);
    assert.deepEqual(r.relations, [{ type: "acquired", name: "Stemme", evidence: 7 }], `the entry is kept: ${String(about).slice(0, 20)}`);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /^relation 1 "Stemme" about dropped \(the relation is kept\): /);
    assert.match(r.warnings[0], why);
  }
  // Absent, null or blank: no about and no warning.
  for (const about of [undefined, null, "", "   "]) assert.deepEqual([rel([A("Stemme", about)]).relations[0], rel([A("Stemme", about)]).warnings], [R("Stemme"), []]);
  // A dropped entry's about makes no second warning.
  assert.equal(rel([{ ...A("Stemme", x161), type: "investor" }]).warnings.length, 1);
  assert.deepEqual(normalizeAbout(" a  b "), { about: "a b", warning: null });
});

test("relations: only the item's own grade carries them, never a #TICKER grade", () => {
  const also = rel([R("Stemme")], { ticker: "UMAC", flags: ["reason:material", "also:UMAC"] }, item, "UMAC");
  assert.equal(also.grade.primary, false);
  assert.deepEqual(also.relations, []);
  assert.match(also.warnings[0], /only the item's own grade \(bare item_id 7\) carries relations, never a #UMAC grade/);
  assert.deepEqual(rel([], { ticker: "UMAC", flags: ["reason:material", "also:UMAC"] }, item, "UMAC").warnings, [], "an empty list is no warning");
  // A rejected grade is still rejected for its own reasons, relations or not.
  assert.equal(normalizeGrade({ ...base, why: "", relations: [R("Stemme")] }, item, null, COVERED).ok, false);
});
