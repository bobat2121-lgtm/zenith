import test from "node:test";
import assert from "node:assert/strict";
import { parseDatePhrase, extractSheetCalendar, occurrences, briefCatalysts, noticeDate, gradedNotices } from "../worker/src/calendar.js";
import { CALENDAR, CALENDAR_VERSION } from "../worker/src/calendar.generated.js";
import { D1, addItem, addGrade } from "./helpers/d1.js";

const span = (s) => { const p = parseDatePhrase(s); return p && `${p.start}..${p.end} ${p.precision}${p.approx ? "~" : ""}${p.deadline ? "!" : ""}`; };

test("date phrases parse to spans with precision", () => {
  assert.equal(span("2026-12-18, 17:00 CET"), "2026-12-18..2026-12-18 day");
  assert.equal(span("Q4/FY26 print, expected 2026-11-23"), "2026-11-23..2026-11-23 day~");
  assert.equal(span("About mid-December 2026"), "2026-12-11..2026-12-20 part~");
  assert.equal(span("Mid-to-late March 2027"), "2027-03-11..2027-03-31 part");
  assert.equal(span("About early to mid-December 2026"), "2026-12-01..2026-12-20 part~");
  assert.equal(span("End-November 2026"), "2026-11-21..2026-11-30 part");
  assert.equal(span("End of February 2027"), "2027-02-21..2027-02-28 part");
  assert.equal(span("Late Nov to Dec 2026"), "2026-11-21..2026-12-31 range");
  assert.equal(span("Dec 2026 - Jan 2027"), "2026-12-01..2027-01-31 range");
  assert.equal(span("About Feb-Mar 2027"), "2027-02-01..2027-03-31 range~");
  assert.equal(span("Q4 2026"), "2026-10-01..2026-12-31 quarter");
  assert.equal(span("Q2-Q3 2027"), "2027-04-01..2027-09-30 range");
  assert.equal(span("H1 2027"), "2027-01-01..2027-06-30 half");
  assert.equal(span("2H 2027"), "2027-07-01..2027-12-31 half");
  assert.equal(span("Spring 2027"), "2027-03-20..2027-06-20 season");
  assert.equal(span("Early 2027"), "2027-01-01..2027-04-30 year");
  assert.equal(span("End of 2026"), "2026-12-01..2026-12-31 month");
  assert.equal(span("About 2026-12"), "2026-12-01..2026-12-31 month~");
  assert.equal(span("By about 2027-03-31"), "2027-03-31..2027-03-31 day~!");
  assert.equal(span("December 2026 (estimate)"), "2026-12-01..2026-12-31 month~");
  assert.equal(span("S-3 effectiveness (filed 2026-11-13, timing open)"), null, "dates in parentheses are context");
  assert.equal(span("Rule 144 may lift"), null, "the verb may is not May");
  assert.equal(span("2027-28"), "2027-01-01..2028-12-31 range");
});

const SHEET = `---
ticker: TST
open_items:
  - {id: q4_print, text: "Q4 results", target: 2026-12-01, expires_at: 2026-12-15}
  - {id: other, what: "Something", expires_at: 2027-03-31}
status_events:
  - {date: 2026-10-01, event: "merger closed"}
thesis_drivers:
  - {id: ramp, text: "Ramp to 100 units by 2027-06-30"}
---
# TST

## Catalyst calendar
Context only; nothing here scores by itself.
- **Every Monday:** weekly 8-K (2026-11-23, 2026-11-30).
- **2026-11-25, after the close:** Q3 results (\`resolves:q3\`).
  - Watch the guide.
  - Watch the backlog.
- **About mid-January 2027:** proxy (filed 2026-01-16 last year).
- **Q1 2027 results:** about early May 2027 (2026-05-06 last year).
- **AGM 2026-12-22** (record date 2026-11-20). Votes on:
  - The 2026 equity plan.
- **Rolling:**
  - Follow-on orders.
- **Context only, not items:**
  - **By 2027-03-01:** a regulator deadline.
- **2027:**
- **About April 2027:** 20-F. **H1 2027:** deployment.
| Date | Event |
|---|---|
| 2026-12-16 | Growth conference |
| Any time | Financing |

## Grader notes
- **2026-12-01:** not a catalyst, wrong section.
`;

test("sheet extraction: open items, status events, thesis dates and the catalyst section", () => {
  const e = extractSheetCalendar("TST", SHEET);
  const find = (kind, pred) => e.filter((x) => x.kind === kind && pred(x));
  assert.equal(find("open_item_target", (x) => x.start === "2026-12-01").length, 1);
  assert.equal(find("open_item_expiry", () => true).length, 2);
  assert.equal(find("status_event", (x) => x.start === "2026-10-01").length, 1);
  assert.equal(find("thesis", (x) => x.start === "2027-06-30").length, 1);
  const cat = e.filter((x) => x.kind === "catalyst");
  assert.deepEqual(cat.find((x) => x.recur), { ticker: "TST", kind: "catalyst", precision: "day", recur: { weekday: 1 }, text: "Every Monday: weekly 8-K (2026-11-23, 2026-11-30)." });
  const q3 = cat.find((x) => x.start === "2026-11-25");
  assert.match(q3.text, /Q3 results.*Watch the guide.*Watch the backlog/, "undated sub-bullets fold into the parent");
  assert.equal(cat.find((x) => /proxy/.test(x.text)).start, "2027-01-11");
  assert.equal(cat.find((x) => /Q1 2027 results/.test(x.text)).start, "2027-05-01", "a finer date in the text beats a quarter label");
  const agm = cat.find((x) => x.start === "2026-12-22");
  assert.match(agm.text, /Votes on: The 2026 equity plan/);
  assert.ok(!cat.some((x) => x.start === "2026-01-01"), "a sub-bullet's bare year folds instead");
  assert.ok(!cat.some((x) => /Follow-on orders/.test(x.text)), "rolling items are undated");
  assert.equal(cat.find((x) => x.start === "2027-03-01").context, true);
  assert.ok(!cat.some((x) => x.text === "2027"), "a bare date label with nothing under it is dropped");
  assert.ok(cat.some((x) => x.start === "2027-04-01" && /20-F/.test(x.text)) && cat.some((x) => x.precision === "half" && /deployment/.test(x.text)), "two labels on one line");
  assert.ok(cat.some((x) => x.start === "2026-12-16" && /Growth conference/.test(x.text)), "table rows");
  assert.ok(!cat.some((x) => /Financing/.test(x.text)));
  assert.ok(!cat.some((x) => /wrong section/.test(x.text)), "only the catalyst section is read");
});

test("brief window: next 7 days, weekly expansion, no context or review dates, confirmed notice wins", () => {
  const e = [
    ...extractSheetCalendar("TST", SHEET),
    { ticker: "TST", kind: "catalyst", start: "2026-11-25", end: "2026-11-25", precision: "day", approx: true, text: "estimate" },
    { ticker: "TST", kind: "graded_notice", start: "2026-11-25", end: "2026-11-25", precision: "day", confirmed: true, text: "TST to report Q3 on Nov 25" },
    { ticker: "ZZZ", kind: "catalyst", start: "2026-11-01", end: "2027-03-31", precision: "range", text: "long window" },
  ];
  const list = briefCatalysts(e, "2026-11-22", 7);
  const keys = list.map((x) => `${x.start} ${x.ticker} ${x.kind}${x.recurring ? " weekly" : ""}`);
  // The sheet's own dated Q3 line stays (it is not an estimate); the confirmed notice sorts first.
  assert.deepEqual(keys, ["2026-11-23 TST catalyst weekly", "2026-11-25 TST graded_notice", "2026-11-25 TST catalyst"]);
  assert.ok(!list.some((x) => x.text === "estimate"), "the sheet's estimate yields to the confirmed notice");
  assert.ok(!list.some((x) => x.kind === "open_item_expiry" || x.kind === "status_event"));
  assert.ok(!list.some((x) => x.ticker === "ZZZ"), "a window that began earlier is not repeated");
  assert.equal(occurrences([{ ticker: "T", recur: { weekday: 1 }, text: "x" }], "2026-11-22", "2026-12-06").length, 2);
});

test("notice dates come from the title, then the why line, never before the notice", () => {
  assert.deepEqual(noticeDate("Planet to Announce Fiscal Third Quarter 2027 Results on Thursday, December 10, 2026", "", "2026-11-12T13:00:00Z"), { date: "2026-12-10", time: null });
  assert.deepEqual(noticeDate("Gorilla Technology to Host Third Quarter Financial Results Conference Call on November 19 at 4:30 p.m. ET", "", "2026-11-16T12:00:00Z"),
    { date: "2026-11-19", time: "4:30 p.m. ET" });
  assert.equal(noticeDate("Symbotic Announces Date for Reporting Fourth Quarter and Fiscal Year 2026 Financial Results",
    "Q4 and fiscal 2026 results set for Monday Nov 23, 2026 after close, webcast 5:00 pm ET; notice dated Oct 29.", "2026-10-29T20:01:00Z").date, "2026-11-23");
  assert.equal(noticeDate("Rekor Systems To Announce Results On Thursday November 12 2026", "", "2026-11-09").date, "2026-11-12");
  assert.equal(noticeDate("Draganfly to Host Shareholder Update Call", "set for Nov 10, 5:30 pm EST; notice dated Nov 6.", "2026-11-06").date, "2026-11-10");
  assert.equal(noticeDate("Company to present at January 8 conference", "", "2026-12-20").date, "2027-01-08", "a month earlier than the notice rolls to next year");
  assert.equal(noticeDate("No date here", "nor here", "2026-11-01"), null);
});

test("graded notices become confirmed calendar entries", async () => {
  const db = new D1();
  const id = await addItem(db, { ticker: "PL", title: "Planet to Announce Results on Thursday, December 10, 2026", published: "2026-11-12T13:00:00Z" });
  await addGrade(db, id, { score: 75, flags: JSON.stringify(["reason:calendar_card", "floor:calendar"]) });
  const other = await addItem(db, { ticker: "PL", title: "Planet wins order on December 1, 2026" });
  await addGrade(db, other, { score: 80, flags: JSON.stringify(["reason:material"]) });
  const n = await gradedNotices(db, { sinceIso: "2026-01-01" });
  assert.equal(n.length, 1);
  assert.equal(n[0].start, "2026-12-10");
  assert.equal(n[0].confirmed, true);
  assert.equal(n[0].item_id, id);
});

test("the generated calendar covers the sheets and the dates this roadmap protects", () => {
  assert.match(CALENDAR_VERSION, /^c-[0-9a-f]{12}$/);
  assert.ok(CALENDAR.length > 250, `${CALENDAR.length} entries`);
  const has = (t, d, re) => CALENDAR.some((e) => e.ticker === t && e.start === d && re.test(e.text));
  assert.ok(has("SYM", "2026-11-23", /Q4\/FY26 print/), "SYM print");
  assert.ok(has("PL", "2026-12-10", /Q3 FY27 results/), "PL print");
  assert.ok(has("MSTR", "2026-11-30", /MSCI/), "MSTR MSCI");
  assert.ok(has("RCAT", "2026-12-18", /Steyr/), "RCAT Steyr deadline");
  assert.ok(has("GRRR", "2026-11-29", /resale registration/), "GRRR registration");
  assert.ok(CALENDAR.some((e) => e.ticker === "MSTR" && e.recur?.weekday === 1), "MSTR weekly 8-K");
  for (const e of CALENDAR) {
    assert.ok(e.ticker && e.kind && e.text, JSON.stringify(e));
    if (!e.recur) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.start) && e.end >= e.start, JSON.stringify(e));
  }
});
