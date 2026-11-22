import test from "node:test";
import assert from "node:assert/strict";
import { D1, addItem, addGrade, fakeFetch } from "./helpers/d1.js";
import { loadWorker } from "./helpers/worker.js";
import { etToUtc } from "../worker/src/et.js";
import { isReportCron, REPORT_CRONS } from "../worker/src/brief.js";
import { readFileSync } from "node:fs";

const worker = await loadWorker();
const TOKENS = { ADMIN_TOKEN: "admin-t", GRADER_TOKEN: "grader-t", APP_TOKEN: "app-t" };

function newsDb() {
  const db = new D1({ migrations: false });
  db.exec(`CREATE TABLE items (source_key TEXT NOT NULL, url TEXT NOT NULL, title TEXT, published TEXT, category TEXT, first_seen TEXT NOT NULL,
             notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_key, url));
           CREATE TABLE source_state (key TEXT PRIMARY KEY, last_polled TEXT, last_ok TEXT, last_attempt TEXT, next_poll_at TEXT,
             fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT);`);
  return db;
}
const call = (env, path, { token, method = "GET", body, headers = {} } = {}) =>
  worker.fetch(new Request(`https://zenith.example.com${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
  }), env, { waitUntil() {} });

test("routes: brief, calendar and calibration need the right role", async () => {
  const env = { DB: new D1(), NEWS: newsDb(), ...TOKENS };
  assert.equal((await call(env, "/v1/brief")).status, 401);
  assert.equal((await call(env, "/v1/brief", { token: "grader-t" })).status, 403);
  const brief = await (await call(env, "/v1/brief", { token: "app-t" })).json();
  assert.ok(Array.isArray(brief.text) && brief.text[0].startsWith("**Zenith brief"));
  assert.ok(Array.isArray(brief.catalysts));
  const cal = await (await call(env, "/v1/calendar?days=60&ticker=pl", { token: "grader-t" })).json();
  assert.ok(cal.entries.length > 0 && cal.entries.every((e) => e.ticker === "PL"));
  const c = await (await call(env, "/v1/calibration", { token: "app-t" })).json();
  assert.equal(c.all_time.n, 0);
});

test("/m is served by zenith-core, labels land through the real feedback handler", async () => {
  const env = { DB: new D1(), NEWS: newsDb(), ...TOKENS };
  const id = await addItem(env.DB, { ticker: "SYM", title: "Symbotic Q4" });
  await addGrade(env.DB, id, { score: 91 });
  assert.equal((await call(env, "/m")).status, 403);
  const page = await call(env, "/m", { token: "app-t" });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Symbotic Q4/);
  assert.equal((await call(env, "/m", { token: "grader-t" })).status, 403, "only the app token (or Access)");
  const r = await call(env, "/m/feedback", { token: "app-t", method: "POST", body: { item_id: id, label: "high", note: "print" } });
  assert.equal(r.status, 200);
  const row = await env.DB.prepare("SELECT label, note, grade_id FROM feedback WHERE item_id = ?").bind(id).first();
  assert.deepEqual(row, { label: "high", note: "print", grade_id: 1 });
  // too_high / too_low are accepted once the grading stream's labels change lands
  // (LABELS + migration 0005); until then the API says which labels it takes.
  const th = await call(env, "/m/feedback", { token: "app-t", method: "POST", body: { item_id: id, label: "too_high" } });
  assert.ok([200, 400].includes(th.status));
  if (th.status === 400) assert.match((await th.json()).error, /label must be one of/);
});

test("scheduled: a report cron sends only its slot; the 5-minute cron ingests then delivers", async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch(() => ({ json: { id: "msg1" } }));
  globalThis.fetch = f;
  try {
    const env = { DB: new D1(), NEWS: newsDb(), ...TOKENS, DISCORD_BRIEF_WEBHOOK: "https://discord.com/api/webhooks/1/b", DISCORD_LEAD_WEBHOOK: "https://discord.com/api/webhooks/2/l" };
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    const am = etToUtc("2026-11-24", 7, 0);
    await worker.scheduled({ cron: "0 11,12 * * *", scheduledTime: am - 3_600_000 }, env, ctx); // 06:00 EST candidate
    await Promise.all(waits);
    assert.equal(f.calls.length, 0);
    await worker.scheduled({ cron: "0 11,12 * * *", scheduledTime: am }, env, ctx);
    await Promise.all(waits);
    assert.ok(f.calls.length >= 1 && f.calls.every((c) => c.url.startsWith("https://discord.com/api/webhooks/1/b")));
    assert.equal((await env.DB.prepare("SELECT status FROM reports WHERE slot = 'brief_am:2026-11-24'").first()).status, "sent");

    const id = await addItem(env.DB, { ticker: "SYM", title: "Symbotic Q4 beat" });
    await addGrade(env.DB, id, { score: 95 });
    const before = f.calls.length;
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, ctx);
    await Promise.all(waits);
    const lead = f.calls.slice(before).filter((c) => c.url.startsWith("https://discord.com/api/webhooks/2/l"));
    assert.equal(lead.length, 1);
    assert.match(lead[0].body.content, /^\*\*SYM · Lead 95\*\*/);
    assert.ok((await env.DB.prepare("SELECT value FROM meta WHERE key = 'nm_cursor'").first())?.value != null, "ingest still runs first");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every report cron in wrangler.toml is recognised, and the 5-minute cron is not", () => {
  const toml = readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
  const crons = JSON.parse(/^crons\s*=\s*(\[.*\])/m.exec(toml)[1]);
  assert.ok(crons.includes("*/5 * * * *"));
  for (const c of REPORT_CRONS) assert.ok(crons.includes(c), `${c} in wrangler.toml`);
  assert.equal(isReportCron("*/5 * * * *"), false);
  assert.equal(crons.filter(isReportCron).length, REPORT_CRONS.length);
});
