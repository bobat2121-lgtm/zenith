// normalizeAuxGrade: the auxiliary grade contract (spec section 4). Each rule
// rejects the one grade object with a message saying how to fix it.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const { normalizeAuxGrade, AUX_REASONS, labelRange } = await import("../worker/src/auxiliary.js");

const COVERED = ["RCAT", "MRLN", "PDYN", "AXON"];
const opts = { covered: COVERED, dupExists: (id) => [7, 8, 9].includes(id) };
const g = (over = {}) => ({
  item_id: 12, entity: "Anduril", score: 80, band: "digest", event_type: "financing", why: "Anduril raised a $2.5B Series G at a $30.5B valuation.",
  reads_through: [], flags: ["reason:material"], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, ...over,
});
const ok = (over) => {
  const r = normalizeAuxGrade(g(over), opts);
  assert.equal(r.ok, true, r.error);
  return r.grade;
};
const err = (over, re) => {
  const r = normalizeAuxGrade(over === null ? null : g(over), opts);
  assert.equal(r.ok, false, `expected a rejection for ${JSON.stringify(over)}`);
  assert.match(r.error, re);
  return r.error;
};

test("a scored grade is stored as given, flags and read-through as JSON", () => {
  const x = ok({ reads_through: [{ ticker: "pdyn", direction: "-" }, { ticker: "MRLN", direction: "±" }], flags: ["reason:material", "ceiling_only", "ceiling_only"] });
  assert.deepEqual(x, {
    item_id: 12, entity: "Anduril", score: 80, band: "digest", reason: "material", event_type: "financing",
    why: "Anduril raised a $2.5B Series G at a $30.5B valuation.",
    reads_through: '[{"ticker":"PDYN","direction":"-"},{"ticker":"MRLN","direction":"±"}]',
    flags: '["reason:material","ceiling_only"]', confidence: 0.8, read_source: 1, dup_of: null, covered_ticker: null,
    headline: null, headline_tag: null,
  });
  assert.equal(ok({ item_id: "12", score: "75", band: "Digest" }).score, 75, "numeric strings and band case are accepted");
  assert.deepEqual([ok({ reads_through: undefined }).reads_through, ok({ reads_through: null }).reads_through], ["[]", "[]"]);
  assert.deepEqual([ok({ read_source: undefined }).read_source, ok({ confidence: null }).confidence, ok({ event_type: null }).event_type], [0, null, null]);
  assert.equal(ok({ entity: "  Shield\n AI  " }).entity, "Shield AI");
});

test("item_id and entity", () => {
  err(null, /grade must be an object/);
  for (const item_id of [undefined, null, "", "12#RCAT", "abc", 0, -3, 1.5]) err({ item_id }, /item_id must be the auxiliary item_id/);
  for (const entity of [undefined, "", "   ", 42, "x".repeat(81)]) err({ entity }, /entity must name the company or program, 1-80 characters/);
  assert.equal(ok({ entity: "x".repeat(80) }).entity.length, 80);
});

test("exactly one reason: flag from the auxiliary list", () => {
  assert.deepEqual(AUX_REASONS, ["material", "minor", "noise", "stale", "duplicate", "covered_name", "off_topic", "promotional", "insufficient_evidence"]);
  err({ flags: "reason:material" }, /flags must be an array/);
  err({ flags: [] }, /exactly one reason: flag is required \(got 0\)/);
  err({ flags: ["ceiling_only"] }, /got 0/);
  err({ flags: ["reason:material", "reason:minor"] }, /got 2/);
  err({ flags: ["reason:primary_source"] }, /unknown reason:primary_source; allowed: material, minor/);
  for (const reason of ["material", "minor", "noise", "stale", "off_topic", "promotional", "insufficient_evidence"]) {
    assert.equal(ok({ flags: [`reason:${reason}`] }).reason, reason);
  }
});

test("scored grades: an integer 0-100 and the band that score falls in", () => {
  for (const [score, band] of [[100, "lead"], [90, "lead"], [89, "digest"], [70, "digest"], [69, "borderline"], [40, "borderline"], [39, "reject"], [0, "reject"]]) {
    assert.equal(ok({ score, band }).band, band, `${score}`);
  }
  for (const score of [null, undefined, "", "abc", 101, -1, 50.5, true]) err({ score }, /score must be an integer 0-100 \(null only with band duplicate or covered\)/);
  err({ score: 75, band: "lead" }, /band must be "digest" for score 75 .* got "lead"/);
  err({ score: 75, band: undefined }, /band must be "digest" for score 75 .* got none/);
  err({ score: 90, band: "digest" }, /band must be "lead"/);
});

test("duplicates: reason:duplicate, band duplicate, score null and dup_of another existing auxiliary item", () => {
  const dup = { score: null, band: "duplicate", flags: ["reason:duplicate"], dup_of: 7 };
  assert.deepEqual((({ score, band, dup_of }) => ({ score, band, dup_of }))(ok(dup)), { score: null, band: "duplicate", dup_of: 7 });
  assert.equal(ok({ ...dup, dup_of: "8" }).dup_of, 8);
  err({ ...dup, band: "digest" }, /reason:duplicate needs band "duplicate" \(got "digest"\)/);
  err({ ...dup, band: null }, /reason:duplicate needs band "duplicate" \(got none\)/);
  err({ ...dup, flags: ["reason:material"] }, /band "duplicate" needs reason:duplicate \(got reason:material\)/);
  err({ ...dup, score: 30 }, /a duplicate must have score null/);
  err({ ...dup, dup_of: null }, /a duplicate needs dup_of/);
  err({ ...dup, dup_of: "7#RCAT" }, /a duplicate needs dup_of/);
  err({ ...dup, dup_of: 12 }, /never the item itself/);
  err({ ...dup, dup_of: 4000 }, /dup_of 4000 is not an auxiliary item.*never a coverage item id/);
  err({ dup_of: 7 }, /dup_of is only for reason:duplicate/);
});

test("covered names: reason:covered_name, band covered, score null and a covered ticker", () => {
  const cov = { entity: "Red Cat", score: null, band: "covered", flags: ["reason:covered_name"], covered_ticker: "rcat" };
  const x = ok(cov);
  assert.deepEqual([x.score, x.band, x.covered_ticker], [null, "covered", "RCAT"]);
  err({ ...cov, band: "digest" }, /reason:covered_name needs band "covered"/);
  err({ ...cov, flags: ["reason:minor"] }, /band "covered" needs reason:covered_name/);
  err({ ...cov, score: 80 }, /a covered_name grade must have score null/);
  err({ ...cov, covered_ticker: null }, /needs covered_ticker, one of the covered tickers \(RCAT, MRLN, PDYN, AXON\); got none/);
  err({ ...cov, covered_ticker: "AVAV" }, /got AVAV/);
  err({ covered_ticker: "RCAT" }, /covered_ticker is only for reason:covered_name/);
});

test("reads_through: covered tickers with a direction of +, - or ±", () => {
  assert.equal(ok({ reads_through: [{ ticker: "RCAT", direction: "−" }] }).reads_through, '[{"ticker":"RCAT","direction":"-"}]', "peers.md's minus sign");
  err({ reads_through: { ticker: "RCAT", direction: "+" } }, /reads_through must be an array \(may be empty\)/);
  err({ reads_through: ["RCAT"] }, /each reads_through entry must be/);
  err({ reads_through: [{ ticker: "AVAV", direction: "+" }] }, /reads_through ticker AVAV is not a covered ticker/);
  err({ reads_through: [{ direction: "+" }] }, /reads_through ticker \(none\) is not a covered ticker/);
  err({ reads_through: [{ ticker: "RCAT", direction: "up" }] }, /direction for RCAT must be "\+", "-" or "±" \(got up\)/);
  err({ reads_through: [{ ticker: "RCAT" }] }, /got none/);
  err({ reads_through: [{ ticker: "RCAT", direction: "+" }, { ticker: "rcat", direction: "-" }] }, /lists RCAT twice/);
});

test("confidence 0-1, read_source boolean, why up to 400 characters, event_type up to 40", () => {
  for (const confidence of [0, 1, 0.55, "0.7"]) assert.equal(ok({ confidence }).confidence, Number(confidence));
  for (const confidence of [1.5, -0.1, "abc", true]) err({ confidence }, /confidence must be a number from 0 to 1/);
  for (const read_source of ["yes", 1, "true"]) err({ read_source }, /read_source must be true or false/);
  assert.equal(ok({ read_source: false }).read_source, 0);
  err({ why: undefined }, /why is required/);
  err({ why: "   " }, /why is required/);
  err({ why: 12 }, /why must be a string/);
  err({ why: "w".repeat(401) }, /why must be at most 400 characters \(got 401\)/);
  assert.equal(ok({ why: "w".repeat(400) }).why.length, 400);
  err({ event_type: "e".repeat(41) }, /event_type must be at most 40 characters/);
  err({ event_type: 5 }, /event_type must be a string/);
  assert.equal(ok({ event_type: "e".repeat(40) }).event_type.length, 40);
});

test("label ranges match the coverage labels the grader reads", () => {
  assert.deepEqual([labelRange("high"), labelRange("medium"), labelRange("low"), labelRange("noise")], [[80, 100], [60, 89], [30, 69], [0, 29]]);
  assert.deepEqual([labelRange("too_high", 60), labelRange("too_low", 60), labelRange("too_high", null)], [[0, 59], [61, 100], null]);
});

// Relations (plans/round5-expansion-approve-queue.md, A2): optional; a bad
// entry is dropped with a warning and the aux grade is still accepted.
test("relations on an aux grade: kept, or dropped with a warning while the grade is accepted", () => {
  const run = (relations, over = {}) => {
    const r = normalizeAuxGrade(g({ relations, ...over }), opts);
    assert.equal(r.ok, true, r.error);
    return r;
  };
  const R = (name, type = "acquired", evidence = 12) => ({ type, name, evidence });
  const kept = run([R("AGILOX"), R("Army", "customer"), R("DIU", "award", "12")]);
  assert.deepEqual(kept.relations, [{ type: "acquired", name: "AGILOX", evidence: 12 }, { type: "customer", name: "Army", evidence: 12 },
    { type: "award", name: "DIU", evidence: 12 }]);
  assert.deepEqual(kept.warnings, []);
  assert.equal("relations" in kept.grade, false, "the stored aux grade gains no column");
  for (const v of [undefined, null, []]) assert.deepEqual([run(v).relations, run(v).warnings], [[], []]);
  const drops = [
    [R("Anduril"), /name is the grade's own subject/],
    [R("Red Cat Holdings, Inc."), /name is a covered company \(RCAT\)/],
    [R("AXON"), /name is a covered company \(AXON\)/],
    [R("https://agilox.net"), /name must be the counterparty's own name/],
    [R("Agilox | Rockwell"), /name must be/],
    [R("Agilox (Austria"), /name must be/],
    [R("B".repeat(81)), /name must be/],
    [R("AGILOX", "investor"), /type must be one of/],
    [R("AGILOX", "acquired", 13), /evidence must be the item you are grading \(12\)/],
    [R("AGILOX", "acquired", "12#RCAT"), /evidence must be/],
  ];
  for (const [entry, re] of drops) {
    const r = run([entry]);
    assert.deepEqual(r.relations, [], JSON.stringify(entry));
    assert.match(r.warnings[0], re, JSON.stringify(entry));
  }
  // Carbyne is an AXON sheet product term, not a covered name: it stays a candidate.
  assert.deepEqual(run([R("Carbyne", "acquired")]).relations.map((x) => x.name), ["Carbyne"]);
  // A repeat and a 5th entry.
  const many = run([R("A1 Robotics"), R("a1 robotics llc", "partner"), R("B2"), R("C3"), R("D4"), R("E5")]);
  assert.deepEqual(many.relations.map((x) => x.name), ["A1 Robotics", "B2", "C3"]);
  assert.deepEqual(many.warnings.map((w) => /dropped: (.*)$/.exec(w)[1].slice(0, 20)),
    ["repeats an earlier r", "relations holds at m", "relations holds at m"]);
  // A bad shape is a warning too.
  assert.match(run("AGILOX").warnings[0], /relations must be an array/);
  // A grade rejected for another reason stays rejected.
  assert.equal(normalizeAuxGrade(g({ why: "", relations: [R("AGILOX")] }), opts).ok, false);
});
