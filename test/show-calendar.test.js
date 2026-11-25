// Zenith show (phase 0), part (b): council agendas from legistar_* coverage items
// become confirmed day entries (only for the routed company's own matters, never
// for rival-marked or product-only titles), and GET /v1/calendar serves covered
// tickers only. Synthetic towns, files and titles throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { addItem, addGrade } from "./helpers/d1.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { councilAgendas, councilOutcomes } = await import("../worker/src/calendar.js");
const { CALENDAR } = await import("../worker/src/calendar.generated.js");
const { etParts, addDays } = await import("../worker/src/et.js");

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const SINCE = iso(120 * DAY);
const today = () => etParts(Date.now()).date;
const newEnv = () => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS });

const agendaTitle = (file, body, day) => `[AXON] Testville City Council ${file}: ${body} — In Committee, agenda ${day}`;

test("council agendas: a legistar_* item titled \", agenda YYYY-MM-DD\" becomes a confirmed day entry for its ticker", async () => {
  const env = newEnv();
  const title = agendaTitle("26-3", "Axon Enterprise contract", "2026-12-08");
  const id = await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title, url: "https://testville.example.gov/26-3",
    state: "skipped", skip_reason: "stale_on_arrival" });
  // Called directly (no try/catch around it): an SQL error fails this test.
  const out = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.deepEqual(out, [{ ticker: "AXON", kind: "council_agenda", start: "2026-12-08", end: "2026-12-08", precision: "day", confirmed: true,
    text: title, item_id: id, url: "https://testville.example.gov/26-3" }]);
});

test("council agendas: other sources, decisive-status titles without an agenda, muted sources, old items, rival-marked and product-only titles give no entry", async () => {
  const env = newEnv();
  const day = "2026-12-08";
  const own = agendaTitle("26-9", "Axon Enterprise contract", day);
  await addItem(env.DB, { ticker: "AXON", source_key: "legistarx_testcity", title: own });
  await addItem(env.DB, { ticker: "AXON", source_key: "xlegistar_testcity", title: own });
  await addItem(env.DB, { ticker: "AXON", source_key: "testcity_axon", title: own });
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title: "[AXON] Testville City Council 26-4: Axon Enterprise contract — Adopted" });
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title: own, state: "skipped", skip_reason: "muted_source" });
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title: own, nm_first_seen: iso(200 * DAY) });
  // A4: the rival marker, and a matter that names only a product, never the company.
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon",
    title: `[AXON] (Flock/ALPR, rival) Testville City Council 26-1: license plate reader renewal — In Committee, agenda ${day}` });
  await addItem(env.DB, { ticker: "SERV", source_key: "legistar_testcity_serv",
    title: `[SERV] Testville City Council 26-2: personal delivery device rules — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), []);
  // The routed company's own matter still gives its entry.
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title: agendaTitle("26-3", "Axon Enterprise contract", day) });
  assert.deepEqual((await councilAgendas(env.DB, { sinceIso: SINCE })).map((e) => [e.ticker, e.start]), [["AXON", day]]);
});

test("A4: a rival-marked title gives no entry, a product-only title gives no entry, the company's own contract gives one", async () => {
  const env = newEnv();
  const day = "2026-12-08";
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] (Flock/ALPR, rival) Testville City Council 26-1: Flock Safety ALPR agreement — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "rival-marked");
  // Rule 1 on its own: a rival-marked title that also names the company is still skipped.
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] (Flock/ALPR, rival) Testville City Council 26-11: ALPR vendor replaces Axon Enterprise cameras — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "rival-marked, names the company");
  await addItem(env.DB, { ticker: "SERV", source_key: "legistar_testville_serv",
    title: `[SERV] Testville City Council 26-2: personal delivery device rules — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "product-only");
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] Testville City Council 26-3: Axon Enterprise contract — In Committee, agenda ${day}` });
  assert.deepEqual((await councilAgendas(env.DB, { sinceIso: SINCE })).map((e) => [e.ticker, e.kind, e.start]), [["AXON", "council_agenda", day]]);
});

// news-monitor must not clip the matter name out of a Legistar title: here the
// company's name sits past character 160, and only the full name gives the entry.
test("A4: a long Legistar title naming the company past character 160 gives an entry; clipped to \"agreement with AX\" it gives none", async () => {
  const day = "2026-12-08";
  const head = "[AXON] Testville City Council 26-9: Actions pertaining to the Testville Police Department's modernization of its public-safety"
    + " technology ecosystem, including a cooperative purchase agreement with ";
  const tail = ` — not to exceed $1.0M — Agenda Ready, agenda ${day}`;
  const full = `${head}Axon Enterprise, Inc. (Police Department)${tail}`;
  assert.ok(full.indexOf("Axon Enterprise") > 160, "the name is past character 160");
  let env = newEnv();
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon", title: full, url: "https://testville.example.gov/26-9" });
  assert.deepEqual((await councilAgendas(env.DB, { sinceIso: SINCE })).map((e) => [e.ticker, e.kind, e.start]), [["AXON", "council_agenda", day]]);
  env = newEnv();
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon", title: `${head}AX${tail}`, url: "https://testville.example.gov/26-9" });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "clipped name: only the [AXON] routing tag is left");
});

test("A4: the leading [AXON] routing tag alone does not name the company (a title naming only another vendor gives no entry)", async () => {
  const env = newEnv();
  const day = "2026-12-08";
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] Testville City Council 26-7: Motorola Solutions body camera contract — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "tag only");
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] Testville City Council 26-3: Axon Enterprise contract — In Committee, agenda ${day}` });
  assert.deepEqual((await councilAgendas(env.DB, { sinceIso: SINCE })).map((e) => [e.ticker, e.start]), [["AXON", day]]);
});

test("A4: a capitalized one-word company term matched only as a lower-case word (\"prepared by staff\") gives no entry", async () => {
  const env = newEnv();
  const day = "2026-12-08";
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] Testville City Council 26-8: Staff report prepared on license plate reader use — In Committee, agenda ${day}` });
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), [], "lower-case common word");
  // Upper-case or capitalized forms of a company word still count.
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville_axon",
    title: `[AXON] Testville City Council 26-10: TASER replacement purchase — In Committee, agenda ${day}` });
  assert.deepEqual((await councilAgendas(env.DB, { sinceIso: SINCE })).map((e) => [e.ticker, e.start]), [["AXON", day]]);
});

// Phase 1 (Legistar vote results): decision rows of the same matter close or defer
// its agenda entry. Synthetic town, files and votes.
const BASE = "https://testville.example.gov/LegislationDetail.aspx?ID=9001&GUID=TEST";
const HEAD = "[AXON] Testville City Council 26-50: Axon Enterprise body camera contract — not to exceed $1.0M";
const addAgenda = (env, day, over = {}) => addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville", url: BASE,
  title: `${HEAD} — Agenda Ready, agenda ${day}`, ...over });
const addVote = (env, event, day, tail, over = {}) => addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville",
  url: `${BASE}#vote-${event}`, title: `${HEAD} — vote ${day} City Council: ${tail}`, published: `${day}T00:00:00Z`, ...over });

test("a council agenda plus a later '#vote-' row gives closed:true with the outcome text, outcome_day and outcome_url", async () => {
  const env = newEnv();
  const agendaId = await addAgenda(env, "2026-12-03");
  const voteId = await addVote(env, 501, "2026-12-03", "APPROVED (carried 6-1)");
  const out = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.equal(out.length, 1, "the vote row makes no entry of its own");
  const e = out[0];
  assert.deepEqual([e.kind, e.item_id, e.start, e.url], ["council_agenda", agendaId, "2026-12-03", BASE]);
  assert.equal(e.closed, true);
  assert.equal(e.deferred, undefined);
  assert.equal(e.outcome, "2026-12-03 City Council: APPROVED (carried 6-1)");
  assert.equal(e.outcome_day, "2026-12-03");
  assert.equal(e.outcome_url, `${BASE}#vote-501`);
  assert.equal(e.item_id_outcome, voteId);
  assert.match(e.text, /, agenda 2026-12-03$/, "the entry text stays the agenda title");
});

test("a TABLED vote gives deferred:true, not closed", async () => {
  const env = newEnv();
  await addAgenda(env, "2026-11-12");
  await addVote(env, 502, "2026-11-12", "TABLED (carried 7-0)");
  const [e] = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.equal(e.deferred, true);
  assert.equal(e.closed, undefined);
  assert.equal(e.outcome, "2026-11-12 City Council: TABLED (carried 7-0)");
  // A later meeting's vote on the same matter (the entry keeps its first agenda day) closes it.
  await addVote(env, 503, "2026-12-03", "APPROVED (carried 5-2)");
  const [later] = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.deepEqual([later.start, later.closed, later.deferred, later.outcome_day], ["2026-11-12", true, undefined, "2026-12-03"]);
  // A referral listed after a carried action still reads as deferred.
  const env2 = newEnv();
  await addAgenda(env2, "2026-11-04");
  await addVote(env2, 504, "2026-11-04", "Referred To (carried 10-0); Passage (failed)");
  assert.equal((await councilAgendas(env2.DB, { sinceIso: SINCE }))[0].deferred, true);
});

test("a vote dated before the agenda day (committee) does not close the entry", async () => {
  const env = newEnv();
  await addAgenda(env, "2026-11-19");
  await addVote(env, 505, "2026-11-18", "recommend approval (carried 3-0)");
  const [e] = await councilAgendas(env.DB, { sinceIso: SINCE });
  for (const k of ["closed", "deferred", "outcome", "outcome_day", "outcome_url", "item_id_outcome"]) assert.equal(e[k], undefined, k);
});

test("a '#approved' status row on or after the agenda day closes the entry", async () => {
  const env = newEnv();
  await addAgenda(env, "2026-11-19");
  const statusId = await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville", url: `${BASE}#approved`,
    title: `${HEAD} — Approved 2026-11-19`, published: "2026-11-19T00:00:00" });
  const [e] = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.deepEqual([e.closed, e.outcome, e.outcome_day, e.outcome_url, e.item_id_outcome],
    [true, "Approved 2026-11-19", "2026-11-19", `${BASE}#approved`, statusId]);
  // A status row dated before the agenda day does not.
  const env2 = newEnv();
  await addAgenda(env2, "2026-11-19");
  await addItem(env2.DB, { ticker: "AXON", source_key: "legistar_testville", url: `${BASE}#approved`,
    title: `${HEAD} — Approved 2026-11-10`, published: "2026-11-10T00:00:00" });
  assert.equal((await councilAgendas(env2.DB, { sinceIso: SINCE }))[0].closed, undefined);
});

test("a vote row alone gives no calendar entry; a muted or other-source decision row closes nothing", async () => {
  const env = newEnv();
  await addVote(env, 506, "2026-12-03", "APPROVED (carried 6-1)");
  assert.deepEqual(await councilAgendas(env.DB, { sinceIso: SINCE }), []);
  await addAgenda(env, "2026-12-03", { url: "https://testville.example.gov/LegislationDetail.aspx?ID=9002&GUID=TEST",
    title: `${HEAD.replace("26-50", "26-51")} — Agenda Ready, agenda 2026-12-03` });
  await addVote(env, 507, "2026-12-03", "APPROVED (carried 6-1)", { url: "https://testville.example.gov/LegislationDetail.aspx?ID=9002&GUID=TEST#vote-507",
    state: "skipped", skip_reason: "muted_source" });
  await addVote(env, 508, "2026-12-03", "APPROVED (carried 6-1)", { url: "https://testville.example.gov/LegislationDetail.aspx?ID=9002&GUID=TEST#vote-508",
    source_key: "testville_minutes" });
  const out = await councilAgendas(env.DB, { sinceIso: SINCE });
  assert.equal(out.length, 1);
  assert.equal(out[0].closed, undefined);
});

test("councilOutcomes keeps entries whose outcome_day is within the last 7 days, whatever their start; undecided past agendas are left out", () => {
  const today = "2026-12-05";
  const entries = [
    { ticker: "AXON", kind: "council_agenda", start: "2026-11-12", outcome_day: "2026-12-03", deferred: true, outcome: "tabled again" },
    { ticker: "AXON", kind: "council_agenda", start: "2026-12-04", outcome_day: "2026-12-04", closed: true, outcome: "approved" },
    { ticker: "AXON", kind: "council_agenda", start: "2026-12-01" },
    { ticker: "AXON", kind: "council_agenda", start: "2026-11-20", outcome_day: "2026-11-27", closed: true, outcome: "too old" },
    { ticker: "AXON", kind: "council_agenda", start: "2026-11-28", outcome_day: "2026-11-28", closed: true, outcome: "day 7" },
    { ticker: "AXON", kind: "council_agenda", start: "2026-12-06", outcome_day: "2026-12-06", closed: true, outcome: "future" },
    { ticker: "SYM", kind: "graded_notice", start: "2026-12-04", outcome_day: "2026-12-04", closed: true },
  ];
  assert.deepEqual(councilOutcomes(entries, today, 7).map((e) => e.outcome), ["approved", "tabled again", "day 7"]);
  assert.deepEqual(councilOutcomes(entries, today, 1).map((e) => e.outcome), ["approved"]);
  assert.deepEqual(councilOutcomes([], today), []);
});

test("GET /v1/calendar with a past from returns the closed council agenda with its outcome", async () => {
  const env = newEnv();
  await addAgenda(env, "2026-12-03");
  await addVote(env, 509, "2026-12-03", "APPROVED (carried 6-1)");
  const r = await request(worker, env, "GET", "/v1/calendar?ticker=AXON&from=2026-12-01&days=7", { role: "app" });
  assert.equal(r.status, 200);
  const e = r.body.entries.find((x) => x.kind === "council_agenda");
  assert.deepEqual([e.start, e.closed, e.outcome_day, e.outcome], ["2026-12-03", true, "2026-12-03", "2026-12-03 City Council: APPROVED (carried 6-1)"]);
});

async function seedCalendar(env) {
  const day = addDays(today(), 10);
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon", title: agendaTitle("26-3", "Axon Enterprise contract", day),
    url: "https://testville.example.gov/26-3" });
  const sym = await addItem(env.DB, { ticker: "SYM", source_key: "symbotic", title: `Testco to announce results on ${addDays(today(), 5)}`,
    nm_first_seen: iso(DAY), published: iso(DAY) });
  await addGrade(env.DB, sym, { score: 75, flags: JSON.stringify(["reason:calendar_card"]) });
  // A graded notice for a name dropped from coverage: never on the calendar.
  const rekr = await addItem(env.DB, { ticker: "REKR", source_key: "rekor", title: `Dropco to announce results on ${addDays(today(), 6)}`,
    nm_first_seen: iso(DAY), published: iso(DAY) });
  await addGrade(env.DB, rekr, { score: 75, flags: JSON.stringify(["reason:calendar_card"]) });
  return { day };
}

test("GET /v1/calendar: 30 days of sheet entries, notices and council agendas, covered tickers only", async () => {
  const env = newEnv();
  const { day } = await seedCalendar(env);
  const r = await request(worker, env, "GET", "/v1/calendar?days=30", { role: "app" });
  assert.equal(r.status, 200);
  const kinds = new Set(r.body.entries.map((e) => e.kind));
  assert.ok(kinds.has("graded_notice") && kinds.has("council_agenda"), [...kinds].join(","));
  assert.ok(r.body.entries.some((e) => !e.item_id), "sheet entries are still there");
  const agenda = r.body.entries.find((e) => e.kind === "council_agenda");
  assert.deepEqual([agenda.ticker, agenda.start, agenda.confirmed], ["AXON", day, true]);
  assert.ok(r.body.entries.some((e) => e.kind === "graded_notice" && e.ticker === "SYM"));
  assert.ok(!r.body.entries.some((e) => e.ticker === "REKR"), "REKR is no longer covered");
  // The ticker filter still works on top of the covered filter.
  const one = await request(worker, env, "GET", "/v1/calendar?days=30&ticker=AXON", { role: "app" });
  assert.ok(one.body.entries.length && one.body.entries.every((e) => e.ticker === "AXON"));
});

test("GET /v1/calendar: the grader token still gets 200 with entries after the covered-ticker filter", async () => {
  const env = newEnv();
  await seedCalendar(env);
  const r = await request(worker, env, "GET", "/v1/calendar?days=30", { role: "grader" });
  assert.equal(r.status, 200);
  assert.ok(r.body.entries.length > 0);
  assert.ok(r.body.entries.some((e) => e.kind === "council_agenda"));
});

test("README: the GET /v1/calendar row names the roles the Worker lets in (grader, app; admin is implied)", async () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const row = readme.split("\n").find((l) => l.startsWith("| `GET /v1/calendar"));
  assert.ok(row, "README has a GET /v1/calendar row");
  const cell = row.split("|").at(-2).trim();
  assert.equal(cell, "grader, app");
  const env = newEnv();
  for (const role of ["grader", "app"]) assert.equal((await request(worker, env, "GET", "/v1/calendar?days=30", { role })).status, 200, role);
});

test("the generated calendar keeps MSTR 2026-11-30 (MSCI) and MBAI 2026-12-22 (AGM)", () => {
  const has = (t, d, re) => CALENDAR.some((e) => e.ticker === t && e.start === d && e.precision === "day" && re.test(e.text));
  assert.ok(has("MSTR", "2026-11-30", /MSCI/), "MSTR MSCI");
  assert.ok(has("MBAI", "2026-12-22", /AGM/), "MBAI AGM");
});
