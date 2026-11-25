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
  const r = await brief(env);
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
