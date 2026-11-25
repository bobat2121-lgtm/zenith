// GET /v1/news-ops (Zenith show, phase 0): news-monitor's open ops alerts without
// Bing-host flaps, and the managed lane's failing sources, read from a fake
// news-monitor-db with news-monitor's own columns. SELECT only. Synthetic keys.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, FakeD1, TOKENS, request } from "./helpers/worker-env.js";
import { addOpsTables, addAlert, addDiag, addManagedConfig, addHealth } from "./helpers/news-ops.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { alertDetail, MANAGED_FAIL_MIN } = await import("../worker/src/source-signals.js");

const HOUR = 3_600_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const news = (opts) => addOpsTables(new FakeD1(), opts);
const get = (n, role = "app") => request(worker, { DB: zenithDb(), NEWS: n, ...TOKENS }, "GET", "/v1/news-ops", { role });

test("GET /v1/news-ops: open non-Bing alerts; Bing alerts left out by source_diagnostics.request_host (detail.final_url null, as the live outages) and by detail.final_url (no diagnostics row)", async () => {
  const n = news();
  addAlert(n, { source_key: "lane:test_lane", rule: "lateness", opened_at: iso(HOUR), detail: { lane: "test_lane", p95_ratio: 2.5, cadence_min: [60, 1440] } });
  addAlert(n, { source_key: "ticker:SYM", rule: "crosscheck_missing_release", opened_at: iso(2 * HOUR), detail: { ticker: "SYM", form: "8-K", items: ["7.01", "9.01"] } });
  addAlert(n, { source_key: "testco_site", rule: "outage", opened_at: iso(3 * HOUR), detail: { fail_count: 4, last_error: "sitemap 429" } });
  // Bing: an outage whose final_url is null but whose source polls bing.com, and a feed_html flap by final_url only.
  addDiag(n, "bingco_news", "www.bing.com");
  addAlert(n, { source_key: "bingco_news", rule: "outage", opened_at: iso(HOUR), detail: { final_url: null, fail_count: 3 } });
  addAlert(n, { source_key: "bingco2_news", rule: "feed_html", opened_at: iso(HOUR), detail: { final_url: "https://www.bing.com/news/search?q=x" } });
  // Resolved: one non-Bing within 24 h, one older, one Bing.
  addAlert(n, { source_key: "fixed_a", rule: "outage", resolved_at: iso(2 * HOUR) });
  addAlert(n, { source_key: "fixed_b", rule: "outage", resolved_at: iso(30 * HOUR) });
  addAlert(n, { source_key: "bingco_news", rule: "feed_html", resolved_at: iso(HOUR) });
  const r = await get(n);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.alerts.open.map((a) => [a.source_key, a.rule]),
    [["lane:test_lane", "lateness"], ["ticker:SYM", "crosscheck_missing_release"], ["testco_site", "outage"]]);
  assert.deepEqual([r.body.alerts.open_count, r.body.alerts.bing_open, r.body.alerts.resolved_24h], [3, 2, 1]);
  assert.deepEqual(r.body.alerts.open[1].detail, { ticker: "SYM", form: "8-K", items: ["7.01", "9.01"] });
  assert.ok(r.body.as_of);
});

test("a feed_html alert on a non-Bing host is kept", async () => {
  const n = news();
  addDiag(n, "testco_feed", "news.testco.example");
  addAlert(n, { source_key: "testco_feed", rule: "feed_html", detail: { final_url: "https://news.testco.example/feed" } });
  const r = await get(n);
  assert.deepEqual(r.body.alerts.open.map((a) => a.rule), ["feed_html"]);
  assert.equal(r.body.alerts.bing_open, 0);
});

test("a non-JSON detail does not break the route", async () => {
  const n = news();
  addAlert(n, { source_key: "plain_detail", rule: "break", detail: "not json {" });
  addAlert(n, { source_key: "null_detail", rule: "break", detail: null });
  addAlert(n, { source_key: "array_detail", rule: "break", detail: "[1,2]" });
  const r = await get(n);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.alerts.open.map((a) => a.detail), [{}, {}, {}]);
});

test("detail values: an items array of strings is kept, a numeric items is kept, cadence_min [60,1440] is kept, a nested object and an array holding an object are dropped, a long array is cut to 10, a non-http url is dropped", () => {
  assert.deepEqual(alertDetail(JSON.stringify({ items: ["7.01", "9.01"] })), { items: ["7.01", "9.01"] });
  assert.deepEqual(alertDetail(JSON.stringify({ items: 50, days: 9 })), { items: 50 });
  assert.deepEqual(alertDetail(JSON.stringify({ cadence_min: [60, 1440], deferred: 2 })), { cadence_min: [60, 1440] });
  assert.deepEqual(alertDetail(JSON.stringify({ lane: { name: "x" }, items: [{ a: 1 }], kind: [[1]] })), {});
  const long = alertDetail(JSON.stringify({ items: Array.from({ length: 14 }, (_, i) => `item-${i}-${"x".repeat(80)}`) }));
  assert.equal(long.items.length, 10);
  assert.ok(long.items.every((s) => s.length === 60));
  assert.deepEqual(alertDetail(JSON.stringify({ url: "javascript:alert(1)", last_error: "e".repeat(300) })), { last_error: "e".repeat(200) });
  assert.deepEqual(alertDetail(JSON.stringify({ url: "https://testco.example/r", fail_count: 3, last_ok: null })), { url: "https://testco.example/r", fail_count: 3, last_ok: null });
});

test("acknowledged and snoozed alerts are listed but not counted in open_count", async () => {
  const n = news();
  addAlert(n, { source_key: "a_open", rule: "outage" });
  addAlert(n, { source_key: "b_ack", rule: "outage", acknowledged_at: iso(HOUR) });
  addAlert(n, { source_key: "c_snoozed", rule: "outage", snoozed_until: new Date(Date.now() + 5 * HOUR).toISOString() });
  addAlert(n, { source_key: "d_snooze_over", rule: "outage", snoozed_until: iso(HOUR) });
  const r = await get(n);
  const by = Object.fromEntries(r.body.alerts.open.map((a) => [a.source_key, [a.acknowledged, a.snoozed]]));
  assert.deepEqual(by, { a_open: [false, false], b_ack: [true, false], c_snoozed: [false, true], d_snooze_over: [false, false] });
  assert.equal(r.body.alerts.open_count, 2);
});

test("managed: failing means fail_count >= 3 among keys in the latest config revision; stale health rows and fail_count 2 are ignored", async () => {
  assert.equal(MANAGED_FAIL_MIN, 3);
  const n = news();
  addManagedConfig(n, 1, [{ key: "m_old_only", name: "Old Co" }]);
  addManagedConfig(n, 2, [{ key: "m_bad", name: "Bad Co" }, { key: "m_worse", name: "Worse Co" }, { key: "m_two", name: "Two Co" }, { key: "m_ok", name: "Ok Co" }]);
  addHealth(n, "m_bad", 3, { last_error: "x".repeat(300), last_attempt: "2026-11-23T00:00:00Z" });
  addHealth(n, "m_worse", 40, { last_attempt: "2026-11-24T01:00:00Z" });
  addHealth(n, "m_two", 2, { last_attempt: "2026-11-23T00:00:00Z" });
  addHealth(n, "m_ok", 0, { last_attempt: "2026-11-24T02:00:00Z" });
  addHealth(n, "m_old_only", 99, { last_attempt: "2026-11-25T00:00:00Z" }); // a health row for a key the latest config dropped
  const r = await get(n);
  const m = r.body.managed;
  assert.deepEqual(m.failing.map((f) => [f.key, f.name, f.fail_count]), [["m_worse", "Worse Co", 40], ["m_bad", "Bad Co", 3]]);
  assert.deepEqual([m.configured, m.failing_count, m.last_attempt, m.config_updated_at], [4, 2, "2026-11-24T02:00:00Z", "2026-10-02T00:00:00Z"]);
  assert.equal(m.failing[1].last_error.length, 160);
});

test("missing tables give a null block; no NEWS binding gives 503", async () => {
  const noAlerts = await get(news({ alerts: false }));
  assert.equal(noAlerts.status, 200);
  assert.equal(noAlerts.body.alerts, null);
  assert.ok(noAlerts.body.managed);
  const noManaged = await get(news({ managed: false }));
  assert.equal(noManaged.body.managed, null);
  assert.ok(noManaged.body.alerts);
  const bare = await get(new FakeD1());
  assert.deepEqual([bare.status, bare.body.alerts, bare.body.managed], [200, null, null]);
  const none = await request(worker, { DB: zenithDb(), ...TOKENS }, "GET", "/v1/news-ops", { role: "app" });
  assert.equal(none.status, 503);
});

test("news-monitor-db is read with SELECT only", async () => {
  const n = news();
  addAlert(n, { source_key: "x", rule: "outage" });
  addManagedConfig(n, 1, [{ key: "m", name: "M" }]);
  addHealth(n, "m", 5);
  const sql = [];
  const prepare = n.prepare.bind(n);
  n.prepare = (s) => { sql.push(s); return prepare(s); };
  assert.equal((await get(n)).status, 200);
  assert.ok(sql.length >= 6, `${sql.length} statements`);
  for (const s of sql) assert.match(s, /^\s*SELECT\b/i);
});

test("roles: app and admin may read it, the grader may not", async () => {
  assert.equal((await get(news(), "app")).status, 200);
  assert.equal((await get(news(), "admin")).status, 200);
  assert.equal((await get(news(), "grader")).status, 403);
});
