// Floors, the SEC unread cap, the first-sighting clock and the investor-day
// flag (core.md sections 4.5, 5, 6 and 8), as normalizeGrade enforces them.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGrade, parseFloors, sightingAgeDays, isSecItem, olderEventDate, archiveSeedGroups, isArchiveCandidate } from "../worker/src/lib.js";
import { CORE } from "../worker/src/rubric.generated.js";

const FLOORS = parseFloors(CORE);
const flagsOf = (r) => JSON.parse(r.grade.flags);
const grade = (over = {}) => ({ score: 80, why: "Same-day Q3 results with figures.", read_source: true, confidence: 0.8, flags: ["reason:material"], ...over });

test("the floor table is read from core.md section 6", () => {
  assert.deepEqual(FLOORS.results, { floor: 80, fixed: false, undisclosed: null });
  assert.deepEqual(FLOORS.calendar, { floor: 75, fixed: true, undisclosed: null });
  assert.deepEqual(FLOORS.investor_day, { floor: 80, fixed: false, undisclosed: null });
  assert.equal(FLOORS.lead_order.floor, 90);
  assert.equal(FLOORS.lead_order.undisclosed, 85);
  assert.ok(Object.keys(FLOORS).length >= 20);
  assert.deepEqual(parseFloors("# no floors here"), {});
});

test("timeliness runs from first sighting, not grading time (AUR Q3)", () => {
  // Seen the same day it was published; graded 22 days later.
  const aur = { id: 41, ticker: "AUR", source_key: "aurora", title: "Aurora Announces Third Quarter 2026 Results",
    url: "https://ir.aurora.tech/news-events/press-releases/detail/160", published: "2026-10-28T20:05:00Z", first_seen: "2026-10-28T20:12:00Z" };
  assert.equal(sightingAgeDays(aur.published, aur.first_seen), 0);
  const late = normalizeGrade(grade({ score: 75, flags: ["reason:primary_source", "late_first_sighting"] }), aur, null, null, FLOORS);
  assert.equal(late.ok, false);
  assert.match(late.error, /first seen 0 day\(s\) after its published date/);
  assert.match(late.error, /not from grading time/);
  // Graded on time it takes the results floor.
  assert.equal(normalizeGrade(grade({ score: 75, flags: ["reason:material", "floor:results"] }), aur, null, null, FLOORS).ok, false);
  assert.equal(normalizeGrade(grade({ flags: ["reason:material", "floor:results"] }), aur, null, null, FLOORS).ok, true);
  // A record really first seen a month after its date keeps the flag and the 79 cap.
  const old = { ...aur, published: "2026-09-20T12:00:00Z" };
  const ok = normalizeGrade(grade({ score: 65, flags: ["reason:new_information", "late_first_sighting", "floor:results"] }), old, null, null, FLOORS);
  assert.equal(ok.ok, true, "floors do not apply to a late first sighting");
  // An official record published late about an older event: explicit escape flag.
  assert.equal(normalizeGrade(grade({ score: 64, flags: ["reason:new_information", "late_first_sighting", "event_predates_publication"] }), aur, null, null, FLOORS).ok, true);
  // Undated items cannot be checked, so the flag stands.
  assert.equal(normalizeGrade(grade({ score: 60, flags: ["reason:new_information", "late_first_sighting"] }), { ...aur, published: null }, null, null, FLOORS).ok, true);
});

test("grades below a flagged floor are rejected; calendar notices are fixed at 75", () => {
  const sym = { id: 9, ticker: "SYM", source_key: "symbotic", title: "Symbotic Announces Date for Reporting Fourth Quarter and Fiscal Year 2026 Financial Results" };
  const cal = (score) => normalizeGrade(grade({ score, flags: ["reason:calendar_card", "floor:calendar", "group:earnings_calendar"] }), sym, null, null, FLOORS);
  assert.equal(cal(70).ok, false, "the three date notices graded 70");
  assert.match(cal(70).error, /below floor:calendar \(75 fixed/);
  assert.equal(cal(75).ok, true);
  assert.equal(cal(80).ok, false, "fixed floors are exact");
  // The highest flagged floor wins.
  const rcat = { id: 3, ticker: "RCAT", title: "Red Cat wins first Army order" };
  assert.equal(normalizeGrade(grade({ score: 80, flags: ["reason:material", "floor:order", "floor:lead_order"], magnitude_usd: 40e6 }), rcat, null, null, FLOORS).ok, false);
  assert.equal(normalizeGrade(grade({ score: 90, flags: ["reason:material", "floor:order", "floor:lead_order"], magnitude_usd: 40e6 }), rcat, null, null, FLOORS).ok, true);
  // lead_order: 85 while the value is undisclosed.
  assert.equal(normalizeGrade(grade({ score: 85, flags: ["reason:material", "floor:lead_order"] }), rcat, null, null, FLOORS).ok, true);
  assert.equal(normalizeGrade(grade({ score: 84, flags: ["reason:material", "floor:lead_order"] }), rcat, null, null, FLOORS).ok, false);
  // Unknown floor ids are not enforced; no floor table means no enforcement.
  assert.equal(normalizeGrade(grade({ score: 50, flags: ["reason:material", "floor:northland_watch"] }), rcat, null, null, FLOORS).ok, true);
  assert.equal(normalizeGrade(grade({ score: 50, flags: ["reason:material", "floor:results"] }), rcat).ok, true);
});

test("floors never rescue stale, off-entity, already-covered or late reposts", () => {
  const item = { id: 5, ticker: "AUR", title: "Aurora targets 30K driverless trucks" };
  for (const reason of ["stale", "off_entity", "already_covered", "late_repost"]) {
    assert.equal(normalizeGrade(grade({ score: 20, flags: [`reason:${reason}`, "floor:results"] }), item, null, null, FLOORS).ok, true, reason);
  }
  assert.equal(normalizeGrade(grade({ score: 5, flags: ["reason:stale", "archive_burst", "floor:results"] }), item, null, null, FLOORS).ok, true);
});

test("floor:investor_day needs the title to name an investor or analyst day", () => {
  const g = grade({ flags: ["reason:calendar_card", "floor:investor_day"] });
  const mstr = { id: 11, ticker: "MSTR", title: "Strategy to Host Live Q&A with Investors Featuring Michael Saylor and Phong Le" };
  const bot = { id: 12, ticker: "BOT", title: "RoboStrategy, Inc. to Host H2 2026 Investor Webcast on Monday, December 14, 2026" };
  for (const it of [mstr, bot]) {
    const r = normalizeGrade(g, it, null, null, FLOORS);
    assert.equal(r.ok, false, it.title);
    assert.match(r.error, /investor or analyst day/);
  }
  for (const title of ["Agility Robotics To Host Analyst Investor Day", "Aurora to Host Analyst & Investor Day on September 23, 2026",
    "Evolv Technology to Host Investor Day on June 9, 2026", "Kodiak to hold investor-day in March", "Unusual Machines Analyst Day"]) {
    assert.equal(normalizeGrade(g, { id: 13, ticker: "AUR", title }, null, null, FLOORS).ok, true, title);
  }
  // Below the investor-day floor is rejected once the flag is valid.
  assert.equal(normalizeGrade({ ...g, score: 75 }, { id: 13, ticker: "EVLV", title: "Evolv to Host Investor Day" }, null, null, FLOORS).ok, false);
});

test("unread SEC grades cap at 55 unless a floor applies by identifier", () => {
  const mbai = { id: 21, ticker: "MBAI", source_key: "edgar_mbai", title: "MBody AI: 6-K filed 2026-11-12",
    url: "https://www.sec.gov/Archives/edgar/data/1610590/000161059026000071/form6-k.htm" };
  assert.equal(isSecItem(mbai), true);
  assert.equal(isSecItem({ source_key: "x", url: "https://sec.gov/a" }), true);
  assert.equal(isSecItem({ source_key: "mbody", url: "https://ir.mbody.ai/news" }), false);
  const r = normalizeGrade(grade({ score: 65, read_source: false, confidence: 0.6, flags: ["reason:primary_source"] }), mbai, null, null, FLOORS);
  assert.equal(r.ok, true);
  assert.equal(r.grade.score, 55);
  assert.equal(r.grade.band, "borderline");
  assert.ok(flagsOf(r).includes("sec_unread_capped_from_65"));
  assert.ok(flagsOf(r).includes("no_figures"));
  assert.equal(r.grade.confidence, 0.4);
  // An 8-K Item 2.02 takes its floor by identifier, and no more while unread.
  const satl = { ...mbai, ticker: "SATL", source_key: "edgar_satl", title: "Satellogic: 8-K filed 2026-11-13 [Items 2.02, 9.01]" };
  const at = normalizeGrade(grade({ score: 80, read_source: false, flags: ["reason:primary_source", "floor:results", "no_figures"] }), satl, null, null, FLOORS);
  assert.equal(at.grade.score, 80);
  assert.ok(!flagsOf(at).some((f) => f.startsWith("sec_unread_capped")));
  const over = normalizeGrade(grade({ score: 88, read_source: false, flags: ["reason:primary_source", "floor:results"] }), satl, null, null, FLOORS);
  assert.equal(over.grade.score, 80);
  // A read filing is not capped.
  assert.equal(normalizeGrade(grade({ score: 82, read_source: true }), mbai, null, null, FLOORS).grade.score, 82);
  // Duplicates are untouched.
  assert.equal(normalizeGrade({ score: null, band: "duplicate", why: "Same as release", read_source: false, flags: ["reason:duplicate", "dup_of:20"] }, mbai, null, null, FLOORS).grade.score, null);
});

test("feed shows the event date only when it is over a day older than first sighting", () => {
  assert.equal(olderEventDate("2026-10-21T12:00:00Z", "2026-11-19T08:00:00Z"), "2026-10-21");
  assert.equal(olderEventDate("2026-11-19T00:00:00Z", "2026-11-19T15:00:00Z"), null);
  assert.equal(olderEventDate(null, "2026-11-19T15:00:00Z"), null);
});

test("archive seeds: five or more undated or old rows from one source sharing one first_seen", () => {
  const seen = "2026-11-18T10:00:00.000Z";
  const row = (i, extra = {}) => ({ source_key: "maymobility", first_seen: seen, published: null, url: `https://x/${i}`, ...extra });
  assert.equal(isArchiveCandidate(row(1)), true);
  assert.equal(isArchiveCandidate(row(1, { published: "2026-10-01T00:00:00Z" })), true);
  assert.equal(isArchiveCandidate(row(1, { published: "2026-11-17T00:00:00Z" })), false);
  const four = [1, 2, 3, 4].map((i) => row(i));
  assert.equal(archiveSeedGroups(four).size, 0);
  assert.equal(archiveSeedGroups([...four, row(5, { published: "2025-01-01T00:00:00Z" })]).size, 1);
  // Fresh dated rows in the same poll do not count toward the five.
  assert.equal(archiveSeedGroups([...four, row(6, { published: "2026-11-18T09:00:00Z" })]).size, 0);
  // Rows already stored from an earlier batch of the same poll count.
  assert.equal(archiveSeedGroups(four, new Map([["maymobility\u0000" + seen, 2]])).size, 1);
  // Different first_seen values are separate polls.
  assert.equal(archiveSeedGroups([...four, row(7, { first_seen: "2026-11-18T10:08:00.000Z" })]).size, 0);
});
