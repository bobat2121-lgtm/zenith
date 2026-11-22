import test from "node:test";
import assert from "node:assert/strict";
import { isEasternDst, etParts, etToUtc, addDays, weekdayOf, fmtAge } from "../worker/src/et.js";

const intl = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
function viaIntl(ms) {
  const p = Object.fromEntries(intl.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

test("ET wall time matches the IANA zone every 37 minutes across 2025-2028", () => {
  for (let ms = Date.UTC(2025, 0, 1); ms < Date.UTC(2029, 0, 1); ms += 37 * 60_000) {
    const a = etParts(ms), b = viaIntl(ms);
    if (a.date !== b.date || a.hour !== b.hour || a.minute !== b.minute) assert.fail(`${new Date(ms).toISOString()}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
});

test("DST edges: 2026-03-08 07:00 UTC and 2026-11-01 06:00 UTC", () => {
  assert.equal(isEasternDst(Date.UTC(2026, 2, 8, 6, 59)), false);
  assert.equal(isEasternDst(Date.UTC(2026, 2, 8, 7, 0)), true);
  assert.equal(isEasternDst(Date.UTC(2026, 10, 1, 5, 59)), true);
  assert.equal(isEasternDst(Date.UTC(2026, 10, 1, 6, 0)), false);
});

test("etToUtc inverts etParts, including both sides of a change", () => {
  assert.equal(new Date(etToUtc("2026-11-23", 7, 0)).toISOString(), "2026-11-23T12:00:00.000Z"); // EST
  assert.equal(new Date(etToUtc("2026-07-01", 7, 0)).toISOString(), "2026-07-01T11:00:00.000Z"); // EDT
  assert.equal(new Date(etToUtc("2026-11-01", 17, 30)).toISOString(), "2026-11-01T22:30:00.000Z"); // first EST day
  assert.equal(new Date(etToUtc("2026-03-08", 7, 0)).toISOString(), "2026-03-08T11:00:00.000Z"); // first EDT day
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekdayOf("2026-11-23"), 1);
  assert.equal(fmtAge(125 * 60_000), "2h 05m");
});
