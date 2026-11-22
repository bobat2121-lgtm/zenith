import test from "node:test";
import assert from "node:assert/strict";
import { D1, addItem, addGrade, fakeFetch } from "./helpers/d1.js";
import { pushLeads, heartbeat, heartbeatChecks, leadMessage, deliveryTick } from "../worker/src/delivery.js";
import { webhookUrl, discordSend, escapeMd, splitMessages, figures } from "../worker/src/discord.js";
import { etToUtc } from "../worker/src/et.js";

const HOOK = "https://discord.com/api/webhooks/123/abc";
const iso = (ms) => new Date(ms).toISOString();

// Discord stand-in: POST returns a new message id, PATCH echoes.
function discord({ fail = null } = {}) {
  let n = 0;
  return fakeFetch((call) => {
    if (fail) { const f = fail(call); if (f) return f; }
    if (call.method === "POST") return { json: { id: `m${++n}` } };
    return { json: { id: call.url.split("/messages/")[1]?.split("?")[0] } };
  });
}

test("webhook URLs: execute waits for the message, edit targets it, thread_id is kept", () => {
  assert.equal(webhookUrl(HOOK), `${HOOK}?wait=true`);
  assert.equal(webhookUrl(`${HOOK}?thread_id=9`, { messageId: "55" }), `${HOOK}/messages/55?thread_id=9`);
  assert.equal(webhookUrl("http://discord.com/x"), null, "https only");
  assert.equal(webhookUrl("not a url"), null);
});

test("discordSend disables mentions and link previews, reports 429", async () => {
  const f = fakeFetch(() => ({ status: 429, json: { retry_after: 2.5 } }));
  const r = await discordSend(HOOK, { content: "@everyone hi" }, { fetchImpl: f });
  assert.deepEqual([r.ok, r.status, r.retryAfter], [false, 429, 2.5]);
  assert.deepEqual(f.calls[0].body.allowed_mentions, { parse: [] });
  assert.equal(f.calls[0].body.flags, 4);
});

test("untrusted text cannot format, link or mention", () => {
  assert.equal(escapeMd("**x** [a](https://evil) <@123> @everyone"), "\\*\\*x\\*\\* \\[a\\]\\(https://evil\\) \\<\\@123\\> \\@everyone");
  assert.deepEqual(splitMessages(["a".repeat(1500), "b".repeat(1500)]).map((m) => m.length), [1500, 1500]);
  assert.equal(figures({ magnitude_usd: 111.1e6, magnitude_pct: 24.3, read_source: 0 }), "$111.1M · 24% of base · source not read");
});

async function leadSetup() {
  const db = new D1();
  const now = Date.now();
  const lead = await addItem(db, { ticker: "GRRR", title: "Gorilla Q3 revenue $69.5M", url: "https://ir.example/q3" });
  const leadGrade = await addGrade(db, lead, { score: 95, why: "Q3 revenue $69.5M, +163% YoY", note_hook: "Raises the FY floor", magnitude_usd: 69.5e6, magnitude_pct: 39 });
  const own85 = await addItem(db, { ticker: "SYM", title: "Symbotic order" });
  await addGrade(db, own85, { score: 86 });
  const own84 = await addItem(db, { ticker: "SYM", title: "Symbotic small order" });
  await addGrade(db, own84, { score: 84 });
  const cp85 = await addItem(db, { ticker: "AUR", title: "Werner expands lanes", role: "customer", affects: "AUR" });
  await addGrade(db, cp85, { score: 88 });
  const cpLead = await addItem(db, { ticker: "AUR", title: "Uber sells stake", role: "relationship", affects: "AUR" });
  await addGrade(db, cpLead, { score: 91 });
  const old = await addItem(db, { ticker: "PL", title: "Old news regraded", nm_first_seen: iso(now - 20 * 86_400_000) });
  await addGrade(db, old, { score: 96 });
  return { db, now, lead, leadGrade, own85, own84, cp85, cpLead, old };
}

test("Lead push: Leads and own Digests >= 85 post once; counterparty Digests and stale items do not", async () => {
  const s = await leadSetup();
  const f = discord();
  const env = { DB: s.db, DISCORD_LEAD_WEBHOOK: HOOK, ZENITH_PUBLIC_URL: "https://zenith.example.com" };
  const r1 = await pushLeads(env, { fetchImpl: f });
  assert.equal(r1.posted, 3);
  const posted = f.calls.map((c) => c.body.content);
  assert.ok(posted.some((c) => c.startsWith("**GRRR · Lead 95**")));
  assert.ok(posted.some((c) => c.startsWith("**SYM · Digest 86**")));
  assert.ok(posted.some((c) => c.startsWith("**AUR · Lead 91**") && /relationship source/.test(c)));
  assert.ok(!posted.some((c) => /Symbotic small order|Werner|Old news/.test(c)));
  const grrr = posted.find((c) => c.includes("GRRR"));
  assert.match(grrr, /\*\*Why:\*\* Q3 revenue \$69\.5M, \+163% YoY \(\$69\.5M · 39% of base\)/);
  assert.match(grrr, /\*\*Note hook:\*\* Raises the FY floor/);
  assert.match(grrr, /<https:\/\/ir\.example\/q3> · label: <https:\/\/zenith\.example\.com\/m#i\d+>/);
  assert.ok(f.calls.every((c) => c.method === "POST" && c.url.endsWith("?wait=true")));
  const rows = (await s.db.prepare("SELECT * FROM deliveries ORDER BY id").all()).results;
  assert.deepEqual(rows.map((r) => [r.status, r.message_id]), [["posted", "m1"], ["posted", "m2"], ["posted", "m3"]]);

  const r2 = await pushLeads(env, { fetchImpl: f });
  assert.deepEqual([r2.posted, r2.edited, r2.withdrawn], [0, 0, 0], "no double posts");
  assert.equal(f.calls.length, 3);
});

test("a re-grade edits the same message; leaving the band strikes it; returning restores it", async () => {
  const s = await leadSetup();
  const f = discord();
  const env = { DB: s.db, DISCORD_LEAD_WEBHOOK: HOOK };
  await pushLeads(env, { fetchImpl: f });
  const msg = (await s.db.prepare("SELECT message_id FROM deliveries WHERE item_id = ?").bind(s.lead).first()).message_id;

  await addGrade(s.db, s.lead, { run_id: "run-2", score: 92, why: "Re-read: $69.5M" });
  const r1 = await pushLeads(env, { fetchImpl: f });
  assert.equal(r1.edited, 1);
  const edit = f.calls.at(-1);
  assert.equal(edit.method, "PATCH");
  assert.ok(edit.url.endsWith(`/messages/${msg}`));
  assert.match(edit.body.content, /Re-graded 95 → 92/);

  await addGrade(s.db, s.lead, { run_id: "run-3", score: 72, why: "Preliminary only" });
  const r2 = await pushLeads(env, { fetchImpl: f });
  assert.equal(r2.withdrawn, 1);
  assert.match(f.calls.at(-1).body.content, /^~~\*\*GRRR · Lead 92\*\*~~ re-graded .*: Digest 72, no longer pushed/);
  assert.equal((await s.db.prepare("SELECT status, score FROM deliveries WHERE item_id = ?").bind(s.lead).first()).status, "retracted");

  await addGrade(s.db, s.lead, { run_id: "run-4", score: 93 });
  const r3 = await pushLeads(env, { fetchImpl: f });
  assert.equal(r3.edited, 1);
  assert.ok(f.calls.at(-1).url.endsWith(`/messages/${msg}`), "same message brought back");
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 3, "never a second post for the same item");
});

test("a cross-ticker Lead gets its own message and is withdrawn when the next pass drops it", async () => {
  const db = new D1();
  const item = await addItem(db, { ticker: "RCAT", title: "Red Cat and Unusual Machines sign supply deal" });
  await addGrade(db, item, { score: 75, run_id: "r1" });
  await addGrade(db, item, { ticker: "UMAC", score: 90, run_id: "r1" });
  const f = discord();
  const env = { DB: db, DISCORD_LEAD_WEBHOOK: HOOK };
  assert.equal((await pushLeads(env, { fetchImpl: f })).posted, 1);
  assert.match(f.calls[0].body.content, /^\*\*UMAC · Lead 90\*\* · from a RCAT item/);
  await addGrade(db, item, { score: 76, run_id: "r2" }); // new primary pass with no UMAC grade
  const r = await pushLeads(env, { fetchImpl: f });
  assert.equal(r.withdrawn, 1);
  assert.match(f.calls.at(-1).body.content, /grade withdrawn, no longer pushed/);
});

test("failures retry, 429 stops the tick, and a deleted message is re-posted", async () => {
  const s = await leadSetup();
  let down = true;
  const f = discord({ fail: () => (down ? { status: 500, text: "boom" } : null) });
  const env = { DB: s.db, DISCORD_LEAD_WEBHOOK: HOOK };
  const r1 = await pushLeads(env, { fetchImpl: f });
  assert.equal(r1.failed, 3);
  assert.equal((await s.db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE status='failed'").first()).n, 3);
  down = false;
  assert.equal((await pushLeads(env, { fetchImpl: f })).posted, 3);

  const limited = discord({ fail: () => ({ status: 429, json: { retry_after: 1 } }) });
  await addGrade(s.db, s.lead, { run_id: "run-9", score: 97 });
  await addGrade(s.db, s.own85, { run_id: "run-9", score: 98 });
  const r2 = await pushLeads(env, { fetchImpl: limited });
  assert.equal(limited.calls.length, 1, "stops at the first 429");
  assert.equal(r2.failed, 1);

  const gone = discord({ fail: (c) => (c.method === "PATCH" ? { status: 404, json: { message: "Unknown Message" } } : null) });
  const r3 = await pushLeads(env, { fetchImpl: gone });
  assert.ok(r3.edited >= 1);
  assert.ok(gone.calls.some((c) => c.method === "PATCH") && gone.calls.some((c) => c.method === "POST"), "PATCH 404 falls back to a new post");
});

test("Lead push is inert without its webhook", async () => {
  const s = await leadSetup();
  const f = discord();
  assert.deepEqual(await pushLeads({ DB: s.db }, { fetchImpl: f }), { lead: "off" });
  assert.equal(f.calls.length, 0);
  assert.equal((await s.db.prepare("SELECT COUNT(*) AS n FROM deliveries").first()).n, 0);
});

test("lead message escapes hostile titles", () => {
  const m = leadMessage({ ticker: "SYM", band: "lead", score: 91, item_ticker: "SYM", title: "[Click](https://evil) @everyone", why: "x", item_id: 5, source_key: "s", url: "javascript:alert(1)" });
  assert.ok(m.includes("\\[Click\\]\\(https://evil\\) \\@everyone"));
  assert.ok(!m.includes("javascript:"), "non-http links are dropped");
});

// --- Heartbeat ----------------------------------------------------------------

const MON_10 = etToUtc("2026-11-23", 10, 0); // Monday 10:00 ET
async function run(db, at, id = `run-${at}`) {
  await db.prepare("INSERT INTO runs (id, started_at, last_seen_at) VALUES (?, ?, ?)").bind(id, iso(at), iso(at)).run();
}

test("grader heartbeat: one alert after 90 quiet minutes in the weekday window, one recovery", async () => {
  const db = new D1();
  const f = discord();
  const env = { DB: db, DISCORD_OPS_WEBHOOK: HOOK };
  await run(db, MON_10 - 100 * 60_000);
  assert.equal((await heartbeat(env, { now: MON_10, fetchImpl: f })).grader_stale, "alerted");
  assert.match(f.calls[0].body.content, /^\*\*ALERT · Zenith grader stale\*\*\nGrader has not run since Mon 23 Nov 08:20 ET \(1h 40m ago\)/);
  assert.equal((await heartbeat(env, { now: MON_10 + 5 * 60_000, fetchImpl: f })).grader_stale, "open");
  assert.equal(f.calls.length, 1, "one alert per incident");
  await run(db, MON_10 + 9 * 60_000);
  assert.equal((await heartbeat(env, { now: MON_10 + 10 * 60_000, fetchImpl: f })).grader_stale, "recovered");
  assert.match(f.calls[1].body.content, /^\*\*RECOVERED · Zenith grader stale\*\* after 10m/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NOT NULL").first()).n, 1);
});

test("grader heartbeat holds outside weekdays 06:00-20:00 ET and gives the window 90 minutes to start", async () => {
  const db = new D1();
  await run(db, etToUtc("2026-11-20", 19, 0)); // Friday evening
  const at = (d, h, m = 0) => heartbeatChecks(db, etToUtc(d, h, m)).then((c) => c.find((x) => x.key === "grader_stale").state);
  assert.equal(await at("2026-11-21", 12), "hold", "Saturday");
  assert.equal(await at("2026-11-23", 5), "hold", "before 06:00");
  assert.equal(await at("2026-11-23", 7, 15), "hold", "first 90 minutes of the window");
  assert.equal(await at("2026-11-23", 7, 45), "fail");
  assert.equal(await at("2026-11-23", 21), "hold", "after 20:00");
});

test("queue heartbeat: covered items waiting over 75 minutes alert; counterparty and old requeues do not", async () => {
  const db = new D1();
  await run(db, MON_10);
  const f = discord();
  const env = { DB: db, DISCORD_OPS_WEBHOOK: HOOK };
  await addItem(db, { ticker: "AUR", role: "customer", nm_first_seen: iso(MON_10 - 200 * 60_000), ingested_at: iso(MON_10 - 200 * 60_000) });
  await addItem(db, { ticker: "PL", nm_first_seen: iso(MON_10 - 5 * 86_400_000), ingested_at: iso(MON_10 - 5 * 86_400_000) });
  assert.equal((await heartbeat(env, { now: MON_10, fetchImpl: f })).queue_stale, "ok");
  const id = await addItem(db, { ticker: "SYM", title: "Symbotic Q4 results", nm_first_seen: iso(MON_10 - 80 * 60_000), ingested_at: iso(MON_10 - 79 * 60_000) });
  assert.equal((await heartbeat(env, { now: MON_10, fetchImpl: f })).queue_stale, "alerted");
  assert.match(f.calls[0].body.content, /1 covered item waiting over 75 min for a grade; oldest SYM "Symbotic Q4 results" \(1h 19m\)/);
  await db.prepare("UPDATE items SET state='graded' WHERE id=?").bind(id).run();
  assert.equal((await heartbeat(env, { now: MON_10 + 60_000, fetchImpl: f })).queue_stale, "recovered");
});

test("heartbeat is inert without the ops webhook; an unsent alert retries", async () => {
  const db = new D1();
  assert.deepEqual(await heartbeat({ DB: db }, { now: MON_10 }), { heartbeat: "off" });
  const down = discord({ fail: () => ({ status: 503 }) });
  const env = { DB: db, DISCORD_OPS_WEBHOOK: HOOK };
  assert.equal((await heartbeat(env, { now: MON_10, fetchImpl: down })).grader_stale, "alert_failed");
  const up = discord();
  assert.equal((await heartbeat(env, { now: MON_10 + 300_000, fetchImpl: up })).grader_stale, "alerted");
  assert.match(up.calls[0].body.content, /Grader has never run/);
});

test("deliveryTick runs each part and keeps going when one fails", async () => {
  const db = new D1();
  const env = { DB: db, DISCORD_LEAD_WEBHOOK: HOOK };
  const out = await deliveryTick(env, { sources: {} }, { now: MON_10, fetchImpl: discord() });
  assert.deepEqual(Object.keys(out), ["lead", "heartbeat", "reports"]);
  assert.deepEqual(out.heartbeat, { heartbeat: "off" });
  const broken = await deliveryTick({ DB: { prepare() { throw new Error("db down"); } }, DISCORD_LEAD_WEBHOOK: HOOK, DISCORD_OPS_WEBHOOK: HOOK }, {}, { now: MON_10, fetchImpl: discord() });
  assert.match(broken.lead.error, /db down/);
  assert.match(broken.heartbeat.error, /db down/);
});
