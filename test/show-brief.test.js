// Zenith show (phase 0), part (a): GET /v1/brief as data for the app. The route
// sends nothing anywhere, graded rows carry their headline, dropped tickers stay
// out of every section, ?since sets the window, and council agendas reach the
// next 7 days tagged as such. Synthetic items only.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";
import { addItem, addGrade } from "./helpers/d1.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { etParts, addDays } = await import("../worker/src/et.js");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = (extra = {}) => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra });
const brief = (env, q = `?since=${encodeURIComponent(iso(DAY))}`) => request(worker, env, "GET", `/v1/brief${q}`, { role: "app" });
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("GET /v1/brief: the app token gets the brief as data; no fetch and no reports row, even with DISCORD_BRIEF_WEBHOOK set", async () => {
  const env = newEnv({ DISCORD_BRIEF_WEBHOOK: "https://discord.example/webhooks/0/test", DISCORD_OPS_WEBHOOK: "https://discord.example/webhooks/1/test" });
  const fetched = [];
  globalThis.fetch = async (u) => { fetched.push(String(u)); throw new Error("the brief route must not fetch"); };
  const id = await addItem(env.DB, { ticker: "SYM", source_key: "symbotic", title: "Testco wins an order", nm_first_seen: iso(3 * HOUR) });
  await addGrade(env.DB, id, { score: 92, graded_at: iso(2 * HOUR) });
  const r = await brief(env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.leads_digests.map((g) => g.ticker), ["SYM"]);
  assert.ok(Array.isArray(r.body.text), "the Discord text is still returned as data");
  assert.deepEqual(fetched, []);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM reports")[0].n, 0);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM deliveries")[0].n, 0);
});

test("GET /v1/brief: graded rows carry headline and headline_tag", async () => {
  const env = newEnv();
  const own = await addItem(env.DB, { ticker: "SYM", source_key: "symbotic", title: "Testco 8-K", nm_first_seen: iso(3 * HOUR) });
  await addGrade(env.DB, own, { score: 80, graded_at: iso(2 * HOUR) });
  env.DB.db.prepare("UPDATE items SET headline = 'Testco books a large order', headline_tag = 'Order' WHERE id = ?").run(own);
  const cp = await addItem(env.DB, { ticker: "AUR", source_key: "testcarrier", title: "Carrier adds trucks", role: "customer", affects: "AUR", nm_first_seen: iso(3 * HOUR) });
  await addGrade(env.DB, cp, { score: 75, graded_at: iso(2 * HOUR) });
  const r = await brief(env);
  const row = r.body.leads_digests[0].items[0];
  assert.deepEqual([row.headline, row.headline_tag, row.title], ["Testco books a large order", "Order", "Testco 8-K"]);
  assert.deepEqual([r.body.counterparty[0].headline, r.body.counterparty[0].headline_tag], [null, null]);
  assert.ok("headline" in r.body.counterparty[0] && "headline_tag" in r.body.counterparty[0]);
});

test("GET /v1/brief: waiting, counts and items to label leave out tickers dropped from coverage", async () => {
  const env = newEnv();
  await addItem(env.DB, { ticker: "REKR", source_key: "rekor", title: "Dropco pending", nm_first_seen: iso(HOUR) });
  await addItem(env.DB, { ticker: "SYM", source_key: "symbotic", title: "Testco pending", nm_first_seen: iso(2 * HOUR) });
  await addItem(env.DB, { ticker: "REKR", source_key: "rekor_cp", title: "Dropco counterparty pending", role: "customer", affects: "REKR", nm_first_seen: iso(HOUR) });
  const gr = await addItem(env.DB, { ticker: "REKR", source_key: "rekor", title: "Dropco graded", nm_first_seen: iso(5 * HOUR) });
  await addGrade(env.DB, gr, { score: 99, graded_at: iso(4 * HOUR) });
  const gs = await addItem(env.DB, { ticker: "SYM", source_key: "symbotic", title: "Testco graded", nm_first_seen: iso(5 * HOUR) });
  await addGrade(env.DB, gs, { score: 60, graded_at: iso(4 * HOUR) });
  // A graded date notice for the dropped name, inside the next 7 days: not a catalyst.
  const notice = await addItem(env.DB, { ticker: "REKR", source_key: "rekor", title: `Dropco to announce results on ${addDays(etParts(Date.now()).date, 3)}`,
    nm_first_seen: iso(DAY), published: iso(DAY) });
  await addGrade(env.DB, notice, { score: 75, flags: JSON.stringify(["reason:calendar_card"]) });
  const r = await brief(env);
  assert.ok(!r.body.catalysts.some((e) => e.ticker === "REKR"), JSON.stringify(r.body.catalysts.map((e) => e.ticker)));
  assert.deepEqual(r.body.waiting.items.map((i) => i.ticker), ["SYM"]);
  assert.deepEqual([r.body.waiting.count, r.body.waiting.counterparty_count], [1, 0]);
  assert.deepEqual(r.body.to_label.map((i) => i.ticker), ["SYM"]);
  assert.ok(!r.body.leads_digests.some((g) => g.ticker === "REKR"));
});

test("GET /v1/brief?since= sets window \"since\" and clamps to 7 days", async () => {
  const env = newEnv();
  const r = await brief(env, `?since=${encodeURIComponent(iso(10 * DAY))}`);
  assert.equal(r.body.window, "since");
  const from = Date.parse(r.body.from);
  assert.ok(Math.abs(from - (Date.now() - 7 * DAY)) < 60_000, r.body.from);
  const exact = iso(6 * HOUR);
  assert.equal((await brief(env, `?since=${encodeURIComponent(exact)}`)).body.from, exact);
  assert.equal((await brief(env, "")).body.window, "last_brief");
  assert.equal((await brief(env, "?since=not-a-date")).body.window, "last_brief");
});

test("the brief's next 7 days include a council agenda, tagged \"council agenda\" in text, not \"confirmed notice\"", async () => {
  const env = newEnv();
  const day = addDays(etParts(Date.now()).date, 3);
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testcity_axon",
    title: `[AXON] Testville City Council 26-3: Axon Enterprise contract — In Committee, agenda ${day}`, nm_first_seen: iso(DAY),
    state: "skipped", skip_reason: "stale_on_arrival" });
  const r = await brief(env);
  const agenda = r.body.catalysts.find((e) => e.kind === "council_agenda");
  assert.ok(agenda, JSON.stringify(r.body.catalysts.map((e) => [e.ticker, e.kind])));
  assert.deepEqual([agenda.ticker, agenda.start], ["AXON", day]);
  const line = r.body.text.join("\n").split("\n").find((l) => l.includes("Testville City Council 26-3"));
  assert.ok(line, "the agenda is in the Next 7 days text");
  assert.match(line, / · council agenda$/);
  assert.doesNotMatch(line, /confirmed notice/);
});

// Phase 1 (Legistar vote results). Synthetic town, files and votes.
const BASE = "https://testville.example.gov/LegislationDetail.aspx?ID=9100&GUID=TEST";
const HEAD = "[AXON] Testville City Council 26-60: Axon Enterprise body camera contract";
async function seedOutcome(env, agendaDay, voteDay, tail) {
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville", url: BASE, title: `${HEAD} — Agenda Ready, agenda ${agendaDay}`,
    nm_first_seen: iso(3 * DAY) });
  await addItem(env.DB, { ticker: "AXON", source_key: "legistar_testville", url: `${BASE}#vote-700`,
    title: `${HEAD} — vote ${voteDay} City Council: ${tail}`, published: `${voteDay}T00:00:00Z`, state: "pending" });
}
const textLines = (r) => r.body.text.join("\n").split("\n");

test("an agenda dated yesterday with a vote row first seen today appears under 'Council outcomes, last 7 days' tagged ' · decided: …'", async () => {
  const env = newEnv();
  const today = etParts(Date.now()).date;
  const yesterday = addDays(today, -1);
  await seedOutcome(env, yesterday, yesterday, "APPROVED (carried 6-1)");
  const r = await brief(env);
  assert.equal(r.status, 200);
  assert.ok(!r.body.catalysts.some((e) => e.kind === "council_agenda"), "a past agenda is not in the next 7 days");
  assert.equal(r.body.council_outcomes.length, 1);
  const e = r.body.council_outcomes[0];
  assert.deepEqual([e.ticker, e.start, e.closed, e.outcome_day, e.outcome_url], ["AXON", yesterday, true, yesterday, `${BASE}#vote-700`]);
  const lines = textLines(r);
  const head = lines.indexOf("**Council outcomes, last 7 days**");
  assert.ok(head > lines.findIndex((l) => l === "**Next 7 days**"), "the section follows Next 7 days");
  const line = lines[head + 1];
  assert.ok(line.startsWith("• ") && line.includes(" · **AXON** · ") && line.includes("Testville City Council 26-60"), line);
  assert.match(line, / · decided: 20\d\d-\d\d-\d\d City Council: APPROVED \\\(carried 6-1\\\)$/, "escaped for Discord");
});

test("a deferred outcome is tagged ' · deferred: …'; the section is omitted when there are no outcomes", async () => {
  const env = newEnv();
  const yesterday = addDays(etParts(Date.now()).date, -1);
  await seedOutcome(env, yesterday, yesterday, "TABLED (carried 7-0)");
  const r = await brief(env);
  assert.equal(r.body.council_outcomes[0].deferred, true);
  const lines = textLines(r);
  const line = lines[lines.indexOf("**Council outcomes, last 7 days**") + 1];
  assert.match(line, / · deferred: 20\d\d-\d\d-\d\d City Council: TABLED \\\(carried 7-0\\\)$/);
  assert.doesNotMatch(line, /decided:/);

  const quiet = newEnv();
  await addItem(quiet.DB, { ticker: "AXON", source_key: "legistar_testville", url: BASE, title: `${HEAD} — Agenda Ready, agenda ${yesterday}` });
  const q = await brief(quiet);
  assert.deepEqual(q.body.council_outcomes, []);
  assert.ok(!q.body.text.join("\n").includes("Council outcomes"), "no section while there are no outcomes");
});

test("council outcomes leave out outcomes older than 7 days", async () => {
  const env = newEnv();
  const today = etParts(Date.now()).date;
  const old = addDays(today, -9);
  await seedOutcome(env, old, old, "APPROVED (carried 6-1)");
  assert.deepEqual((await brief(env)).body.council_outcomes, []);
});

test("an agenda dated today and decided today keeps its Next 7 days line, tagged ' · decided: …' instead of ' · council agenda'", async () => {
  const env = newEnv();
  const today = etParts(Date.now()).date;
  await seedOutcome(env, today, today, "APPROVED (carried 6-1)");
  const r = await brief(env);
  const agenda = r.body.catalysts.find((e) => e.kind === "council_agenda");
  assert.ok(agenda?.closed, JSON.stringify(r.body.catalysts));
  const lines = textLines(r);
  const next = lines[lines.indexOf("**Next 7 days**") + 1];
  assert.match(next, / · decided: 20\d\d-\d\d-\d\d City Council: APPROVED \\\(carried 6-1\\\)$/);
  assert.doesNotMatch(next, /council agenda$/);
});
