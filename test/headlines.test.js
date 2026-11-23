// Headline and tag validation (core.md section 10, aux.md section 8): the
// shared check, and how coverage and auxiliary grades carry it. Optional; a bad
// one rejects only that grade object.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";
import { normalizeHeadline, normalizeGrade, SEC_FORM_RE, HEADLINE_TAGS, HEADLINE_MIN, HEADLINE_MAX } from "../worker/src/lib.js";

hookJsonImports();
const { normalizeAuxGrade } = await import("../worker/src/auxiliary.js");

const MODEL = "RoboStrategy Portfolio NAV hits $289 million. Up 4.1% in October.";
const ok = (raw, opts) => {
  const r = normalizeHeadline(raw, opts);
  assert.equal(r.ok, true, r.error);
  return r;
};
const err = (raw, re, opts) => {
  const r = normalizeHeadline(raw, opts);
  assert.equal(r.ok, false, `expected a rejection for ${JSON.stringify(raw)}`);
  assert.match(r.error, re);
};

test("absent is fine (old grader runs); required only for the headline pass", () => {
  for (const raw of [{}, { headline: null, tag: null }, { headline: "", tag: "" }, { headline: undefined }]) {
    assert.deepEqual(normalizeHeadline(raw), { ok: true, headline: null, tag: null });
  }
  err({}, /headline and tag are required/, { required: true });
});

test("headline and tag come together", () => {
  err({ headline: MODEL }, /headline needs a tag/);
  err({ headline: MODEL, tag: "" }, /headline needs a tag/);
  err({ tag: "8-K" }, /tag needs a headline/);
  err({ headline: null, tag: "Press release" }, /tag needs a headline/);
});

test("the owner's model headline passes as written", () => {
  assert.deepEqual(ok({ headline: MODEL, tag: "Press release" }), { ok: true, headline: MODEL, tag: "Press release" });
});

test("headline: a trimmed string of 8-140 characters on one line, without a URL", () => {
  err({ headline: 42, tag: "News" }, /headline must be a string/);
  err({ headline: ["a headline here"], tag: "News" }, /headline must be a string/);
  err({ headline: "Short", tag: "News" }, /headline must be 8-140 characters \(got 5\)/);
  err({ headline: "x".repeat(HEADLINE_MAX + 1), tag: "News" }, /8-140 characters \(got 141\)/);
  assert.equal(ok({ headline: "x".repeat(HEADLINE_MAX), tag: "News" }).headline.length, HEADLINE_MAX);
  assert.equal(ok({ headline: "x".repeat(HEADLINE_MIN), tag: "News" }).headline.length, HEADLINE_MIN);
  // Trimmed first: padding does not count, and an outer newline is padding.
  assert.equal(ok({ headline: `   ${MODEL}\n`, tag: "News" }).headline, MODEL);
  err({ headline: "      Short     ", tag: "News" }, /got 5/);
  for (const br of ["\n", "\r\n", "\r", " ", " ", "\u0085"]) err({ headline: `Red Cat wins order.${br}Up 4%.`, tag: "News" }, /one line: no line breaks/);
  // Runs of spaces and tabs collapse.
  assert.equal(ok({ headline: "Red Cat  wins\tan Army order.", tag: "News" }).headline, "Red Cat wins an Army order.");
  for (const u of ["See https://example.com/x for more", "Details at http://ir.example.com", "Details at www.example.com now"]) {
    err({ headline: u, tag: "News" }, /must not contain a URL/);
  }
  // A company name with a domain-like spelling is not a URL.
  ok({ headline: "Amazon.com expands Prime Air drone delivery to two cities.", tag: "News" });
});

test("a headline that repeats the original title is allowed (the rubric discourages it)", () => {
  ok({ headline: "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026", tag: "Press release" });
});

test("tag: an SEC form exactly as filed, or the vocabulary (any case, stored canonical)", () => {
  const forms = ["8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "6-K", "6-K/A", "20-F", "40-F", "S-1", "S-1/A", "S-3", "S-3/A", "S-4", "S-8",
    "F-1", "F-3", "424B1", "424B5", "424B8", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "13F-HR", "Form 3", "Form 4", "Form 5", "DEF 14A", "DEFA14A",
    "PRE 14A", "25-NSE", "NT 10-Q", "NT 10-K", "1-U", "1-K", "C", "D"];
  for (const tag of forms) {
    assert.match(tag, SEC_FORM_RE);
    assert.equal(ok({ headline: MODEL, tag }).tag, tag);
  }
  for (const tag of HEADLINE_TAGS) assert.equal(ok({ headline: MODEL, tag }).tag, tag);
  assert.deepEqual(HEADLINE_TAGS, ["Press release", "Presentation", "Shareholder letter", "Event", "Contract notice", "Program notice", "News", "Blog",
    "Video", "Filing", "Report", "Interview"]);
  assert.equal(ok({ headline: MODEL, tag: "press release" }).tag, "Press release");
  assert.equal(ok({ headline: MODEL, tag: "  Shareholder   letter " }).tag, "Shareholder letter");
  assert.equal(ok({ headline: MODEL, tag: " 8-K/A " }).tag, "8-K/A", "trimmed");
  for (const tag of ["8-k", "8K", "424B9", "424B", "Form 6", "SC13D", "Press Release!", "Tweet", "8-K filed", "E"]) {
    err({ headline: MODEL, tag }, /unknown tag/);
  }
  err({ headline: MODEL, tag: 8 }, /tag must be a string/);
});

const ITEM = { id: 5, ticker: "BOT", title: "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026", source_key: "bot_press", url: "https://ir.example.com/nav" };
const cov = (over) => ({ item_id: "5", score: 88, why: "NAV update.", read_source: true, confidence: 0.8, flags: ["reason:material"], ...over });

test("coverage grades: headline and tag are optional, validated, and returned for storage", () => {
  const none = normalizeGrade(cov(), ITEM);
  assert.equal(none.ok, true, none.error);
  assert.deepEqual([none.grade.headline, none.grade.headline_tag], [null, null]);
  const withOne = normalizeGrade(cov({ headline: MODEL, tag: "Press release" }), ITEM);
  assert.deepEqual([withOne.grade.headline, withOne.grade.headline_tag, withOne.grade.score], [MODEL, "Press release", 88]);
  const bad = normalizeGrade(cov({ headline: MODEL, tag: "Tweet" }), ITEM);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown tag "Tweet"/);
  assert.match(normalizeGrade(cov({ headline: MODEL }), ITEM).error, /headline needs a tag/);
  // A duplicate may carry a headline.
  const dup = normalizeGrade(cov({ score: null, band: "duplicate", flags: ["reason:duplicate", "dup_of:4"], headline: MODEL, tag: "News" }), ITEM);
  assert.equal(dup.ok, true, dup.error);
  assert.deepEqual([dup.grade.band, dup.grade.headline_tag], ["duplicate", "News"]);
});

const aux = (over) => ({ item_id: 12, entity: "Anduril", score: 92, band: "lead", event_type: "financing", why: "Anduril raised a $2.5B Series G.",
  reads_through: [], flags: ["reason:material"], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, ...over });

test("auxiliary grades: the same check; covered and duplicate grades may carry one", () => {
  const opts = { covered: ["RCAT", "PL"], dupExists: () => true };
  const none = normalizeAuxGrade(aux(), opts);
  assert.deepEqual([none.ok, none.grade.headline, none.grade.headline_tag], [true, null, null]);
  const h = "Anduril raises $2.5 billion Series G at a $30.5 billion valuation.";
  const one = normalizeAuxGrade(aux({ headline: h, tag: "Press release" }), opts);
  assert.deepEqual([one.grade.headline, one.grade.headline_tag], [h, "Press release"]);
  assert.equal(normalizeAuxGrade(aux({ headline: "Too short", tag: "Blog" }), opts).ok, true, "9 characters is enough");
  assert.match(normalizeAuxGrade(aux({ headline: "Short", tag: "Blog" }), opts).error, /headline must be 8-140 characters/);
  assert.match(normalizeAuxGrade(aux({ headline: h, tag: "Tweet" }), opts).error, /unknown tag/);
  assert.match(normalizeAuxGrade(aux({ tag: "News" }), opts).error, /tag needs a headline/);
  const covered = normalizeAuxGrade(aux({ score: null, band: "covered", flags: ["reason:covered_name"], covered_ticker: "PL", headline: "NGA extends Planet Labs imagery agreement.", tag: "Program notice" }), opts);
  assert.deepEqual([covered.ok, covered.grade.band, covered.grade.headline_tag], [true, "covered", "Program notice"]);
});
