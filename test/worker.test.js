import test from "node:test";
import assert from "node:assert/strict";
import { D1, addItem, addGrade, fakeFetch } from "./helpers/d1.js";
import { loadWorker } from "./helpers/worker.js";
import { etToUtc, etParts, addDays } from "../worker/src/et.js";
import { isReportCron, REPORT_CRONS, SLOTS, slotsAt } from "../worker/src/brief.js";
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
  assert.equal(c.coverage.all_time.n, 0);
  assert.equal(c.aux.all_time.n, 0);
  assert.deepEqual(c.reasons, {});
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

// Cloudflare cron semantics: weekdays run 1 = Sunday to 7 = Saturday, or names.
const CF_DAYS = { sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7 };
function cfFires(cron, ms) {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  const d = new Date(ms);
  const field = (f, v, names) => f === "*" || f.split(",").some((part) => {
    if (part.startsWith("*/")) return v % Number(part.slice(2)) === 0;
    const [a, b] = part.split("-").map((x) => names?.[x.toLowerCase()] ?? Number(x));
    return b == null ? v === a : v >= a && v <= b;
  });
  return field(min, d.getUTCMinutes()) && field(hour, d.getUTCHours()) && field(dom, d.getUTCDate())
    && field(mon, d.getUTCMonth() + 1) && field(dow, d.getUTCDay() + 1, CF_DAYS);
}

test("each report slot has a dedicated cron firing at its ET time, on the right weekday, in EST and EDT", () => {
  const toml = readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
  const reportCrons = JSON.parse(/^crons\s*=\s*(\[.*\])/m.exec(toml)[1]).filter(isReportCron);
  assert.equal(cfFires("0 17 * * 1", Date.UTC(2026, 10, 22, 17, 0)), true, "Cloudflare's own example: 1 is Sunday");
  for (const start of ["2026-11-23", "2026-06-29"]) { // a winter (EST) and a summer (EDT) week, Monday first
    for (let k = 0; k < 7; k++) {
      const date = addDays(start, k);
      const weekday = etParts(etToUtc(date, 12, 0)).weekday;
      for (const s of SLOTS) {
        if (s.weekday != null && s.weekday !== weekday) continue;
        const at = etToUtc(date, s.hour, s.minute);
        assert.ok(reportCrons.some((c) => cfFires(c, at)), `${s.kind} on ${date}: a cron fires at ${new Date(at).toISOString()}`);
        assert.ok(slotsAt(at).some((x) => x.kind === s.kind), `${s.kind} on ${date} is that firing's slot`);
      }
    }
  }
  const calibration = REPORT_CRONS.find((c) => /\* \* \S+$/.test(c) && !/\* \* \*$/.test(c));
  for (let h = 0; h < 14 * 24; h++) {
    const t = Date.UTC(2026, 10, 22, 0, 0) + h * 3_600_000;
    if (cfFires(calibration, t)) assert.equal(etParts(t).weekday, 1, `${calibration} fires only on Mondays ET (${new Date(t).toISOString()})`);
  }
  assert.equal(isReportCron("0 12,13 * * MON"), true);
  assert.equal(isReportCron(" 30  21,22 * * * "), true, "spacing does not matter");
  assert.equal(isReportCron("*/5 * * * *"), false);
  assert.equal(isReportCron("0 12,13 * * 2"), true, "the same trigger in numeric form");
});
