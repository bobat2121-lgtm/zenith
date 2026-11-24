// Bill autonomy lines (plans/round7-phase1a2-budget.md, B): the extractor on
// small fixtures cut from the real govinfo files (test/fixtures/bill-lines/),
// totals without double counting, the grader's block, the cron pass with its
// retries, the claim's hold, and bill_lines in the Coverage feed.
//   ndaa-house-tables.xml       BILLS-119hr3838rh: SEC. 4101 and SEC. 4601 rows
//   ndaa-senate-rdte.xml        BILLS-119s2296rs: SEC. 4201 rows (program element column)
//   reconciliation-text.xml     BILLS-119hr1enr: SEC. 20002 paragraphs
//   appropriations-provisos.xml BILLS-118hr2882enr: CBP account, drone purchase ban, Tibet paragraph
//   report-text.htm             CRPT-119hrpt162: contents lines and recommendation summaries
//   ndaa-house-text.xml         BILLS-119hr3838rh: SEC. 127, 875, 1045, 1213 and 1723 text
//   appropriations-no-autonomy.xml BILLS-119hr4016rh: two accounts, no autonomy term
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const BL = await import("../worker/src/bill-lines.js");

const fixture = (name) => readFileSync(new URL(`./fixtures/bill-lines/${name}`, import.meta.url), "utf8");
const rowsOf = (r) => r.groups.flatMap((g) => g.rows.map((x) => ({ ...x, group: g.name })));
const byItem = (r, re) => rowsOf(r).find((x) => re.test(x.item));
const HOUSE_URL = "https://www.govinfo.gov/app/details/BILLS-119hr3838rh";

test("autonomy terms: the listed terms match, legal and medical senses do not", () => {
  for (const t of ["SMALL UNMANNED AERIAL SYSTEMS", "Outpost Uncrewed Surveillance System", "UAS PAYLOADS", "sUAS", "C-sUAS", "COUNTER—SMALL UNMANNED AIRCRAFT",
    "Low-Cost VTOL Loitering Precision Strike", "one-way attack drones", "COLLABORATIVE COMBAT AIRCRAFT", "Multi-role CCA propulsion", "Replicator",
    "attritable autonomous systems", "Drone Dominance", "XLUUV", "MUSV", "ROBOTIC COMBAT VEHICLE", "optionally manned fighting vehicle", "MQ–9 MODS",
    "RQ-11 UAV", "Israel Counter-UXS Program", "TACTICAL AUTONOMY", "the primary purpose of operating autonomously", "LAUNCHED EFFECTS FAMILY",
    "Navy Thermite Firefighting Robotics", "Explosive ordnance disposal robotics"]) assert.ok(BL.hasTerm(t), t);
  for (const t of ["Tibet Autonomous Region", "an autonomous agency of the Government", "robotic surgery training", "AH–64 APACHE BLOCK IIIA REMAN",
    "NDAA-compliant cameras", "MQUIRE", "Robotics Enhancements for Armaments Manufacturing [5,000]", "industrial robotics for depot maintenance"]) assert.equal(BL.hasTerm(t), false, t);
});

test("groups: each line lands in one category", () => {
  const cases = {
    "COUNTER-SMALL UNMANNED AERIAL SYSTEM (C-SUAS)": "Counter-UAS",
    "$500,000,000 for State and local capabilities to detect, identify, track, or monitor threats from unmanned aircraft systems": "Counter-UAS",
    "SMALL UNMANNED AERIAL SYSTEMS": "Drones / small UAS",
    "Low-Cost VTOL Loitering Precision Strike": "Drones / small UAS",
    "MQ–25": "Large UAS (MQ-/RQ-)",
    "RQ–11 small UAV": "Drones / small UAS",
    "RQ–20B PUMA": "Drones / small UAS",
    "RQ–11 UAV": "Drones / small UAS",
    "RQ–7B SHADOW": "Large UAS (MQ-/RQ-)",
    "RQ-4 GLOBAL HAWK": "Large UAS (MQ-/RQ-)",
    "MQ–9 UAV": "Large UAS (MQ-/RQ-)",
    "LAUNCHED EFFECTS FAMILY": "Drones / small UAS",
    "Navy Thermite Firefighting Robotics": "Uncrewed ground / robotics",
    "Explosive ordnance disposal robotics": "Uncrewed ground / robotics",
    "COLLABORATIVE COMBAT AIRCRAFT MODS": "Collaborative combat aircraft / aircraft autonomy",
    "SMALL & MEDIUM UUV": "Uncrewed maritime",
    "$145,000,000 for artificial intelligence to enable one-way attack unmanned aerial systems and naval systems": "Drones / small UAS",
    "Small Electric Unmanned Surface Vehicles": "Uncrewed maritime",
    "GROUND ROBOTICS": "Uncrewed ground / robotics",
    "UNMANNED ISR": "Other autonomy",
  };
  for (const [text, group] of Object.entries(cases)) assert.equal(BL.groupOf(text), group, text);
});

test("packages: the item URL names the package; bills read as XML, reports as HTML", () => {
  assert.equal(BL.packageOf(HOUSE_URL), "BILLS-119hr3838rh");
  assert.equal(BL.documentUrl("BILLS-119hr3838rh"), "https://www.govinfo.gov/content/pkg/BILLS-119hr3838rh/xml/BILLS-119hr3838rh.xml");
  assert.equal(BL.packageOf("https://www.govinfo.gov/content/pkg/CRPT-119hrpt162/html/CRPT-119hrpt162.htm"), "CRPT-119hrpt162");
  assert.equal(BL.documentUrl("CRPT-119hrpt162"), "https://www.govinfo.gov/content/pkg/CRPT-119hrpt162/html/CRPT-119hrpt162.htm");
  assert.equal(BL.packageOf("https://www.govinfo.gov/app/details/BILLS-119s2296es"), "BILLS-119s2296es");
  assert.equal(BL.packageOf("https://example.com/news/ndaa"), null);
  assert.equal(BL.packageOf("ftp://www.govinfo.gov/app/details/BILLS-119hr3838rh"), null);
  assert.deepEqual(BL.billLabel("BILLS-119hr3838rh"), { bill: "H.R. 3838", version: "RH", stage: "reported in House", congress: 119 });
  assert.equal(BL.billLabel("BILLS-119s2296es").stage, "passed Senate");
  assert.equal(BL.billLabel("BILLS-119hr3838enr").stage, "enrolled, passed both chambers");
  assert.deepEqual(BL.billLabel("CRPT-119hrpt162"), { bill: "H. Rept. 119-162", version: "report", stage: "committee report", congress: 119 });
});

test("amounts: plain, bracketed, negative and dollar forms", () => {
  assert.deepEqual(BL.parseAmount("726,034"), { value: 726034, bracket: false, dollar: false });
  assert.deepEqual(BL.parseAmount("[15,000]"), { value: 15000, bracket: true, dollar: false });
  assert.deepEqual(BL.parseAmount("[–27,000]"), { value: -27000, bracket: true, dollar: false });
  assert.deepEqual(BL.parseAmount("$71,200,000"), { value: 71200000, bracket: false, dollar: true });
  assert.equal(BL.parseAmount("SMALL UAS"), null);
  assert.equal(BL.parseAmount(""), null);
});

test("House NDAA tables: caption unit, accounts, kept lines, changes inside them never added twice", () => {
  const r = BL.extract(fixture("ndaa-house-tables.xml"), "BILLS-119hr3838rh");
  assert.equal(r.status, "ok");
  assert.equal(r.title, "National Defense Authorization Act for Fiscal Year 2026 (fixture)");
  const suas = byItem(r, /^SMALL UNMANNED AERIAL SYSTEMS$/);
  // In Thousands of Dollars: 726,034 -> $726,034,000.
  assert.deepEqual([suas.group, suas.account, suas.activity, suas.section, suas.line, suas.request, suas.bill, suas.change],
    ["Drones / small UAS", "AIRCRAFT PROCUREMENT, ARMY", "AGILE PORTFOLIO MANAGEMENT", "SEC. 4101. PROCUREMENT", "057", 726034000, 744034000, 18000000]);
  assert.deepEqual(suas.changes, [{ item: "FPV/PBAS Systems", change: 18000000 }]);
  assert.equal(byItem(r, /FPV\/PBAS/), undefined, "a change inside a kept line is not a line of its own");
  // Launched Effects (the Army's launched UAS family) is a drone line under its own account.
  const le = byItem(r, /LAUNCHED EFFECTS FAMILY/);
  assert.deepEqual([le.group, le.account, le.line, le.request, le.bill], ["Drones / small UAS", "MISSILE PROCUREMENT, ARMY", "044", 67816000, 67816000]);
  const uuv = byItem(r, /SMALL & MEDIUM UUV/);
  assert.deepEqual([uuv.group, uuv.account, uuv.request, uuv.bill], ["Uncrewed maritime", "OTHER PROCUREMENT, NAVY", 54854000, 69854000]);
  // A change inside a line that is not autonomy is a line of its own: change only.
  const outpost = byItem(r, /Outpost Uncrewed/);
  assert.deepEqual([outpost.kind, outpost.group, outpost.request, outpost.bill, outpost.change, outpost.inside],
    ["change", "Other autonomy", null, null, 10000000, "043 AN/SQQ–89 SURF ASW COMBAT SYSTEM"]);
  // MilCon: Account column, project title with its installation.
  const hangar = byItem(r, /MQ–25 Aircraft Maintenance Hangar/);
  assert.deepEqual([hangar.group, hangar.account, hangar.section, hangar.bill], ["Large UAS (MQ-/RQ-)", "Navy", "SEC. 4601. MILITARY CONSTRUCTION", 71200000]);
  assert.match(hangar.item, /\(Naval Base Ventura County Point Mugu\)$/);
  // Not autonomy, and not counted: the Apache line, its change and the account total.
  assert.equal(byItem(r, /APACHE|additional aircraft|TOTAL/), undefined);
  // Totals: bills of the kept lines plus the change inside another line; requests of the kept lines.
  const bills = 744034000 + 118459000 + 67816000 + 69854000 + 71200000 + 20430000;
  assert.deepEqual(r.totals, { lines: 7, request: 726034000 + 118459000 + 67816000 + 54854000 + 71200000 + 20430000, bill: bills + 10000000, change: 18000000 + 15000000 + 10000000, request_lines: 6 });
  const sum = (k) => r.groups.reduce((s, g) => s + g[k], 0);
  assert.deepEqual([sum("lines"), sum("request"), sum("bill")], [r.totals.lines, r.totals.request, r.totals.bill], "group totals add up to the overall total");
  assert.deepEqual(r.groups.map((g) => g.name), ["Drones / small UAS", "Large UAS (MQ-/RQ-)", "Uncrewed maritime", "Other autonomy"]);
});

test("Senate NDAA RDT&E: program element column, empty self-closing entries, counter-UAS changes", () => {
  const r = BL.extract(fixture("ndaa-senate-rdte.xml"), "BILLS-119s2296rs");
  const csuas = byItem(r, /C-SUAS\) APPLIED RESEARCH/);
  assert.deepEqual([csuas.line, csuas.pe, csuas.account, csuas.request, csuas.bill], ["9", "0602135A", "RESEARCH, DEVELOPMENT, TEST & EVAL, ARMY", 12618000, 12618000]);
  const ctrc = byItem(r, /Counter-UAS Testing and Research Center/);
  assert.deepEqual([ctrc.kind, ctrc.group, ctrc.change, ctrc.inside], ["change", "Counter-UAS", 5000000, "18 AIR AND MISSILE DEFENSE TECHNOLOGY"]);
  assert.equal(byItem(r, /Shape-shifting Drones/).group, "Drones / small UAS");
  assert.deepEqual([r.totals.lines, r.totals.request, r.totals.bill], [3, 12618000, 12618000 + 5000000 + 10000000]);
});

test("reconciliation text: one line per $ amount for an autonomy purpose", () => {
  const r = BL.extract(fixture("reconciliation-text.xml"), "BILLS-119hr1enr");
  const rows = rowsOf(r);
  assert.deepEqual(rows.map((x) => [x.group, x.bill]).sort((a, b) => b[1] - a[1]), [
    ["Uncrewed maritime", 2100000000], ["Uncrewed maritime", 1534000000], ["Uncrewed maritime", 1300000000],
    ["Uncrewed maritime", 250000000], ["Uncrewed maritime", 188360000], ["Uncrewed ground / robotics", 174000000]]);
  assert.ok(rows.every((x) => x.kind === "text" && x.request === null && x.in_total && x.section === "SEC. 20002. Enhancement of Department of Defense resources for shipbuilding"));
  assert.equal(byItem(r, /small unmanned surface vessel/).item, "$1,534,000,000 for expansion of small unmanned surface vessel production");
  assert.deepEqual([r.totals.bill, r.totals.request, r.totals.request_lines], [5546360000, 0, 0]);
});

test("appropriations provisos: a ban with no amount is a provision; an account naming autonomy among other uses is not added; Tibet is not autonomy", () => {
  const r = BL.extract(fixture("appropriations-provisos.xml"), "BILLS-118hr2882enr");
  const cbp = byItem(r, /Customs and Border Protection/);
  assert.match(cbp.item, /^For necessary expenses of U\.S\. Customs and Border Protection/);
  assert.deepEqual([cbp.bill, cbp.in_total, cbp.note], [850170000, false, "account names autonomy among other uses: not added"]);
  const ban = rowsOf(r).find((x) => x.kind === "provision");
  assert.equal(ban.group, "Provisions (no amount)");
  assert.match(ban.item, /may be used to purchase a drone manufactured in the People's Republic of China/);
  assert.equal(ban.account, "CAPITOL POLICE, General Expenses");
  assert.equal(rowsOf(r).some((x) => /Tibet/i.test(x.item)), false);
  assert.deepEqual([r.totals.lines, r.totals.bill], [2, 0]);
});

test("committee report text: recommendation lines kept, contents page numbers ignored", () => {
  const r = BL.extract(fixture("report-text.htm"), "CRPT-119hrpt162");
  assert.equal(r.title, "House Report 119-162 - DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2026");
  assert.deepEqual(rowsOf(r).map((x) => [x.group, x.account, x.bill]), [
    ["Large UAS (MQ-/RQ-)", "PROCUREMENT", 507957000],
    ["Collaborative combat aircraft / aircraft autonomy", "RESEARCH, DEVELOPMENT, TEST AND EVALUATION", 494896000]]);
  assert.equal(r.totals.bill, 1002853000);
  // Dotted leaders with columns: a report table line.
  const t = BL.reportLines("<pre>                    UNMANNED SYSTEMS\n               [In thousands of dollars]\n    Small unmanned aircraft systems.......   726,034     741,034     +15,000\n</pre>");
  assert.deepEqual(t.map((x) => [x.item, x.request, x.bill, x.change]), [["Small unmanned aircraft systems", 726034000, 741034000, 15000000]]);
});

test("the grader's block: header with bill, stage and totals; groups; at most maxRows lines with +N more", () => {
  const r = BL.extract(fixture("ndaa-house-tables.xml"), "BILLS-119hr3838rh");
  const block = BL.blockText(r);
  const lines = block.split("\n");
  assert.equal(lines[0], "AUTONOMY LINES (from the official bill text): H.R. 3838 RH (reported in House): 7 lines, total $1.10B (request $1.06B)");
  assert.ok(lines.includes("Drones / small UAS: 3 lines, $930.3M (request $912.3M)"));
  assert.ok(lines.includes("- SMALL UNMANNED AERIAL SYSTEMS [AIRCRAFT PROCUREMENT, ARMY, line 057]: request $726.0M, bill $744.0M (+$18.0M); changes: FPV/PBAS Systems +$18.0M"));
  assert.ok(lines.includes("- Outpost Uncrewed Surveillance System Increase [OTHER PROCUREMENT, NAVY, inside 043 AN/SQQ–89 SURF ASW COMBAT SYSTEM]: change +$10.0M"));
  const short = BL.blockText(r, 2).split("\n");
  assert.equal(short.at(-1), "+5 more");
  assert.equal(short.filter((l) => l.startsWith("- ")).length, 2);
  const text = BL.blockText(BL.extract(fixture("reconciliation-text.xml"), "BILLS-119hr1enr")).split("\n")[0];
  assert.match(text, /total \$5\.55B \(no request figures in the text\)$/);
  assert.equal(BL.blockText({ status: "failed", error: "http_404" }), null);
  assert.equal(BL.usd(1534000000), "$1.53B");
  assert.equal(BL.usd(509000), "$509K");
});

test("stored JSON is bounded: rows are dropped, largest kept, totals kept", () => {
  // Small rows in account "A", large rows in account "Z": the large ones are kept whatever their account.
  const rows = Array.from({ length: 3000 }, (_, i) => ({ kind: "line", group: "Drones / small UAS", item: `UNMANNED ITEM ${i} ${"x".repeat(150)}`, account: i < 1500 ? "A" : "Z",
    section: "S", line: String(i), request: i, bill: i < 1500 ? 1 : 1e9 + i, change: 0, changes: [], in_total: true }));
  const big = { v: 1, status: "ok", totals: BL.totalsOf(rows), groups: BL.groupLines(rows), more: 0 };
  const s = BL.storedJson(big);
  assert.ok(s.length <= 400_000, String(s.length));
  const back = JSON.parse(s);
  assert.equal(back.totals.lines, 3000);
  assert.ok(back.more > 0 && back.groups[0].rows.length + back.more === 3000);
  const kept = back.groups[0].rows;
  assert.ok(kept.every((r) => r.account === "Z"));
  assert.ok(kept.some((r) => r.bill === 1e9 + 2999));
  assert.ok(kept.every((r, i) => i === 0 || r.bill <= kept[i - 1].bill), "kept rows stay in account, then amount order");
});

test("a version with no autonomy lines never reads as a $0 total; lines with no counted amount say so; a report is a partial read", () => {
  // BILLS-119hr4016rh: an appropriations act carries account totals, not program amounts.
  const r = BL.extract(fixture("appropriations-no-autonomy.xml"), "BILLS-119hr4016rh");
  assert.deepEqual([r.totals.lines, r.groups], [0, []]);
  const block = BL.blockText(r);
  assert.equal(block, "AUTONOMY LINES (from the official bill text): H.R. 4016 RH (reported in House): no autonomy lines in the text (program amounts may be in the committee report; this is not a $0 total)");
  assert.doesNotMatch(block, /total \$0|0 lines/);
  // BILLS-118hr2882enr: the only amount row is not added.
  const head = BL.blockText(BL.extract(fixture("appropriations-provisos.xml"), "BILLS-118hr2882enr")).split("\n")[0];
  assert.equal(head, "AUTONOMY LINES (from the official bill text): H.R. 2882 ENR (enrolled, passed both chambers): 2 lines, no amounts counted");
  // CRPT-119hrpt162: summary text only, the program tables are images.
  const rep = BL.blockText(BL.extract(fixture("report-text.htm"), "CRPT-119hrpt162")).split("\n")[0];
  assert.match(rep, /: 2 lines, total \$1\.00B \(no request figures in the text\) \(report text only; its program tables are not read\)$/);
  assert.match(BL.blockText({ status: "ok", package: "CRPT-119hrpt162", bill: "H. Rept. 119-162", version: "report", stage: "committee report", totals: { lines: 0 }, groups: [] }),
    /: no autonomy lines in the report text \(its program tables are not read; this is not a \$0 total\)$/);
});

test("NDAA text: sourcing and ban provisions with the section header as the term; working-group language is not a ban", () => {
  // Cuts from BILLS-119hr3838rh SEC. 127, 875, 1045, 1213 and 1723.
  const r = BL.extract(fixture("ndaa-house-text.xml"), "BILLS-119hr3838rh");
  const prov = rowsOf(r).filter((x) => x.kind === "provision");
  assert.deepEqual(prov.map((x) => x.section.slice(0, 9)), ["SEC. 127.", "SEC. 1045", "SEC. 1723"]);
  assert.match(prov[0].item, /^The Secretary of the Navy may not enter into a contract/);
  assert.match(prov[1].item, /^Except as provided in subsection \(b\), the Secretary of the Army may not retire, divest/);
  assert.match(prov[2].item, /^Unmanned aircraft systems that are designed, developed, manufactured, or supplied .* of a foreign adversary$/);
  assert.equal(rowsOf(r).some((x) => /SEC\. 875/.test(x.section)), false, "the SkyFoundry working group is not a provision");
  assert.equal(BL.clauseLine("for improving the domestic manufacturing capacity for small unmanned aircraft systems"), null);
  assert.deepEqual(BL.clauseLine("small unmanned aircraft systems procured under this section shall be domestically sourced"), { provision: true });
  // A term only in the header: a ban counts, a rule of construction does not.
  assert.deepEqual(BL.clauseLine("the Secretary of the Army may not retire, divest, or otherwise take any action", "SEC. 1045. Limitation on retirement of Gray Eagle unmanned aircraft systems"), { provision: true });
  assert.equal(BL.clauseLine("This section shall not be construed to affect the authority of the Secretary", "SEC. 9. Unmanned aircraft"), null);
  assert.equal(BL.clauseLine("the Secretary may not retire, divest, or otherwise take any action", "SEC. 9. Aircraft retirements"), null);
  // SEC. 1213: an amended cap, in a section whose header names autonomy: the inserted amount, listed and not added.
  const cap = rowsOf(r).find((x) => x.kind === "text");
  assert.deepEqual([cap.group, cap.bill, cap.in_total, cap.note], ["Counter-UAS", 70000000, false, "amends an amount in earlier law: not added"]);
  assert.equal(r.totals.bill, 0);
});

test("NDAA text: an amount whose autonomy term is only in the section header", () => {
  // Cut from BILLS-119s2296rs SEC. 1256.
  const sec = (text) => `<legis-body><section><enum>1256.</enum><header>Extension and modification of United States-Israel cooperation to counter unmanned aerial systems</header><text>${text}</text></section></legis-body>`;
  const amend = sec("Section 1278 is amended— (1) in subsection (b)(4), by striking $55,000,000 and inserting $75,000,000; and (2) in subsection (f), by striking December 31, 2026 and inserting December 31, 2028.");
  for (const hasTables of [true, false]) {
    const lines = BL.textLines(amend, { hasTables });
    assert.deepEqual(lines.map((x) => [x.kind, x.group, x.bill, x.in_total]), [["text", "Counter-UAS", 75000000, false]], String(hasTables));
  }
  // Not an amendment: drawn from the tables when the bill has them, else added.
  const auth = sec("There is authorized to be appropriated $10,000,000 for fiscal year 2026 to carry out this section.");
  assert.deepEqual(BL.textLines(auth, { hasTables: true }).map((x) => [x.bill, x.in_total, x.note]), [[10000000, false, "drawn from amounts in the funding tables: not added"]]);
  assert.deepEqual(BL.textLines(auth, { hasTables: false }).map((x) => [x.bill, x.in_total]), [[10000000, true]]);
  assert.deepEqual(BL.textLines(sec("The program shall be carried out jointly with Israel."), { hasTables: true }), []);
  // A section header with no term adds nothing.
  assert.deepEqual(BL.textLines(amend.replace("to counter unmanned aerial systems", "on missile defense"), { hasTables: false }), []);
});

// ---- The cron pass, the claim and the feed --------------------------------------------
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: "drv_govinfo_defense_bills", ticker: "RCAT", url: HOUSE_URL, title: "H.R. 3838 (RH): NDAA for Fiscal Year 2026, reported in House",
    ingested_at: iso(), state: "pending", ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, role, affects, bill_lines)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, 'program', 'RCAT,UMAC,ONDS,PUSA,DPRO', ?)`).run(++rowid, it.source_key, it.ticker, it.url, it.title, iso(60_000), it.ingested_at, it.state, it.bill_lines ?? null);
  return Number(r.lastInsertRowid);
}
const stored = (env, id) => JSON.parse(env.DB.db.prepare("SELECT bill_lines FROM items WHERE id = ?").get(id).bill_lines);
async function withFetch(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init); };
  try { return await run(calls); } finally { globalThis.fetch = real; }
}
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });

test("migration 0014: items.bill_lines is a nullable TEXT column, added without changing others", () => {
  const env = newEnv();
  const col = env.DB.db.prepare("PRAGMA table_info(items)").all().find((c) => c.name === "bill_lines");
  assert.deepEqual([col?.type, col?.notnull, col?.dflt_value], ["TEXT", 0, null]);
  const sql = readFileSync(new URL("../worker/migrations/0014_bill_lines.sql", import.meta.url), "utf8").replace(/--.*$/gm, "").trim();
  assert.equal(sql, "ALTER TABLE items ADD COLUMN bill_lines TEXT;");
});

test("cron pass: reads the official XML once, stores the lines; other sources are never fetched", async () => {
  const env = newEnv();
  const bill = addItem(env);
  const other = addItem(env, { source_key: "redcat", url: "https://ir.example.com/x" });
  const xml = fixture("ndaa-house-tables.xml");
  await withFetch(async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }), async (calls) => {
    const res = await BL.billLinesPass(env);
    assert.deepEqual(calls, ["https://www.govinfo.gov/content/pkg/BILLS-119hr3838rh/xml/BILLS-119hr3838rh.xml"]);
    assert.deepEqual(res.items, [{ id: bill, status: "ok", lines: 7 }]);
    assert.equal((await BL.billLinesPass(env)).tried, 0, "a stored result is not read again");
  });
  const bl = stored(env, bill);
  assert.deepEqual([bl.status, bl.bill, bl.version, bl.totals.bill, bl.tries], ["ok", "H.R. 3838", "RH", 1101793000, 1]);
  assert.equal(env.DB.db.prepare("SELECT bill_lines FROM items WHERE id = ?").get(other).bill_lines, null);
});

test("cron pass: transient failures retry with backoff, then the failure is recorded; a 404 is final at once", async () => {
  const env = newEnv();
  const id = addItem(env);
  const gone = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119hr9999ih" });
  const nopkg = addItem(env, { url: "https://www.govinfo.gov/rss/bills.xml" });
  await withFetch(async (url) => new Response("busy", { status: url.includes("9999") ? 404 : 503 }), async () => {
    await BL.billLinesPass(env, { limit: 5 });
    assert.deepEqual([stored(env, id).status, stored(env, id).tries, stored(env, id).error], ["retry", 1, "http_503"]);
    assert.ok(Date.parse(stored(env, id).next_at) > Date.now() + 9 * 60_000);
    assert.deepEqual([stored(env, gone).status, stored(env, gone).error], ["failed", "http_404"]);
    assert.deepEqual([stored(env, nopkg).status, stored(env, nopkg).error], ["failed", "no_package"]);
    assert.equal((await BL.billLinesPass(env)).tried, 0, "a retry waits for next_at");
    for (let i = 0; i < 2; i++) {
      env.DB.db.prepare("UPDATE items SET bill_lines = json_set(bill_lines, '$.next_at', ?) WHERE id = ?").run(iso(1000), id);
      await BL.billLinesPass(env);
    }
  });
  assert.deepEqual([stored(env, id).status, stored(env, id).tries, stored(env, id).error], ["failed", 3, "http_503"]);
});

test("claim: a bill item waits for its lines (at most HOLD_MINUTES after ingest), then carries the AUTONOMY LINES block", async () => {
  const env = newEnv();
  const waiting = addItem(env);
  const late = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119hr3838eh", ingested_at: iso((BL.HOLD_MINUTES + 5) * 60_000) });
  const retrying = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119s2296rs", bill_lines: JSON.stringify({ v: 1, status: "retry", tries: 1, next_at: iso(-600_000) }) });
  const claim = async (run) => (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: run } })).body;
  const first = await claim("run-hold-1");
  assert.deepEqual(first.items.map((i) => i.item_id), [late], "only the item past the hold is claimed");
  assert.equal(first.items[0].autonomy_lines, undefined, "graded without lines");
  assert.equal("bill_lines" in first.items[0], false, "the grader never gets the stored JSON");
  const xml = fixture("ndaa-house-tables.xml");
  await withFetch(async () => new Response(xml, { status: 200 }), () => BL.billLinesPass(env, { limit: 5 }));
  env.DB.db.prepare("UPDATE items SET bill_lines = ? WHERE id = ?").run(JSON.stringify({ v: 1, status: "failed", error: "http_503", tries: 3 }), retrying);
  const second = await claim("run-hold-2");
  const byId = Object.fromEntries(second.items.map((i) => [i.item_id, i]));
  assert.deepEqual(Object.keys(byId).map(Number).sort(), [waiting, retrying].sort());
  assert.match(byId[waiting].autonomy_lines, /^AUTONOMY LINES \(from the official bill text\): H\.R\. 3838 RH \(reported in House\): 7 lines, total \$1\.10B \(request \$1\.06B\)\n/);
  assert.equal(byId[retrying].autonomy_lines, null);
  assert.equal(byId[retrying].autonomy_lines_status, "failed (http_503)");
});

test("cron pass: retries follow the excerpt pipeline: a 400 is final, a 403 is tried twice, a 503 three times", async () => {
  const env = newEnv();
  const ids = Object.fromEntries([400, 403, 503].map((code) => [code, addItem(env, { url: `https://www.govinfo.gov/app/details/BILLS-119hr${code}ih` })]));
  await withFetch(async (url) => new Response("no", { status: Number(/hr(\d{3})ih/.exec(url)[1]) }), async () => {
    await BL.billLinesPass(env, { limit: 5 });
    assert.deepEqual([400, 403, 503].map((c) => [stored(env, ids[c]).status, stored(env, ids[c]).tries]), [["failed", 1], ["retry", 1], ["retry", 1]]);
    env.DB.db.prepare("UPDATE items SET bill_lines = json_set(bill_lines, '$.next_at', ?) WHERE json_extract(bill_lines, '$.status') = 'retry'").run(iso(1000));
    await BL.billLinesPass(env, { limit: 5 });
    assert.deepEqual([403, 503].map((c) => [stored(env, ids[c]).status, stored(env, ids[c]).tries]), [["failed", 2], ["retry", 2]]);
  });
});

test("cron pass: a graded item whose lines are unread is read for up to 2 days after ingest, after pending items", async () => {
  const env = newEnv();
  const retry = JSON.stringify({ v: 1, status: "retry", error: "http_503", tries: 1, next_at: iso(1000) });
  const late = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119hr3838eh", state: "graded", ingested_at: iso(86_400_000), bill_lines: retry });
  const old = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119hr3838ih", state: "graded", ingested_at: iso(3 * 86_400_000), bill_lines: retry });
  const pending = addItem(env, { url: "https://www.govinfo.gov/app/details/BILLS-119s2296rs" });
  const xml = fixture("ndaa-house-tables.xml");
  await withFetch(async () => new Response(xml, { status: 200 }), async () => {
    assert.deepEqual((await BL.billLinesPass(env)).items.map((i) => i.id), [pending], "pending items come first");
    assert.deepEqual((await BL.billLinesPass(env)).items.map((i) => i.id), [late]);
    assert.equal((await BL.billLinesPass(env)).tried, 0, "an item graded more than 2 days ago is left as it is");
  });
  assert.equal(stored(env, late).status, "ok");
  assert.equal(stored(env, old).status, "retry");
});

test("claim: a bill item claimed while its lines are still being read says 'still reading', never the retry error", async () => {
  const env = newEnv();
  const id = addItem(env, { ingested_at: iso((BL.HOLD_MINUTES + 5) * 60_000), bill_lines: JSON.stringify({ v: 1, status: "retry", error: "http_503", tries: 2, next_at: iso(-600_000) }) });
  const res = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: "run-still" } })).body;
  const it = res.items.find((i) => i.item_id === id);
  assert.deepEqual([it.autonomy_lines, it.autonomy_lines_status], [null, "still reading"]);
});

test("GRADER.md: a block with no lines or no counted amount is never headlined as $0; a report block is a partial read", () => {
  const md = readFileSync(new URL("../grader/GRADER.md", import.meta.url), "utf8");
  assert.match(md, /`no autonomy lines in the text` is not a \$0 total/);
  assert.match(md, /Never headline \$0 or "no autonomy funding"/);
  assert.match(md, /a topline defense budget move is Digest 70-74/);
  assert.match(md, /`report text only` is a partial read/);
  assert.match(md, /`none \(still reading\)`/);
});

test("admin bill-lines route runs one pass; the app and grader tokens are refused", async () => {
  const env = newEnv();
  assert.equal((await request(worker, env, "POST", "/v1/admin/bill-lines", { role: "app", body: {} })).status, 403);
  assert.equal((await request(worker, env, "POST", "/v1/admin/bill-lines", { role: "grader", body: {} })).status, 403);
  const r = await request(worker, env, "POST", "/v1/admin/bill-lines", { body: {} });
  assert.deepEqual([r.status, r.body.tried], [200, 0]);
});

test("Coverage feed: bill_lines comes back parsed for a bill item, null for others", async () => {
  const env = newEnv();
  const id = addItem(env);
  addItem(env, { source_key: "redcat", url: "https://ir.example.com/y", title: "Red Cat news" });
  const xml = fixture("ndaa-house-tables.xml");
  await withFetch(async () => new Response(xml, { status: 200 }), () => BL.billLinesPass(env));
  const feed = (await request(worker, env, "GET", "/v1/feed?order=newest", { role: "app" })).body.items;
  const bill = feed.find((i) => i.item_id === id);
  assert.deepEqual([bill.bill_lines.status, bill.bill_lines.totals.lines, bill.bill_lines.groups[0].name], ["ok", 7, "Drones / small UAS"]);
  assert.equal(feed.find((i) => i.item_id !== id).bill_lines, null);
});
