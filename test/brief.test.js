import test from "node:test";
import assert from "node:assert/strict";
import { D1, addItem, addGrade, fakeFetch } from "./helpers/d1.js";
import { buildBrief, renderBrief, runSlot, runReportSlots, catchUpReports, lastBriefEnd, pickToLabel,
  buildCalibration, renderCalibration, verdict, slotsAt, previousBriefAt } from "../worker/src/brief.js";
import { etToUtc } from "../worker/src/et.js";
import { discordSendAll } from "../worker/src/discord.js";

const HOOK = "https://discord.com/api/webhooks/1/brief";
const OPS = "https://discord.com/api/webhooks/2/ops";
const iso = (ms) => new Date(ms).toISOString();
const AM = etToUtc("2026-11-24", 7, 0); // Tuesday 07:00 ET
const COVERED = { sources: { symbotic: "SYM", gorilla: "GRRR", planet_ir: "PL" } };

function discord() {
  let n = 0;
  return fakeFetch((c) => ({ json: { id: `b${++n}` } }));
}

// news-monitor-db stand-in with its source_state table.
function newsDb(rows) {
  const db = new D1({ migrations: false });
  db.exec("CREATE TABLE source_state (key TEXT PRIMARY KEY, last_polled TEXT, last_ok TEXT, last_attempt TEXT, next_poll_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT)");
  for (const r of rows) db.db.prepare("INSERT INTO source_state (key, fail_count, last_ok, last_error) VALUES (?, ?, ?, ?)").run(r.key, r.fail_count, r.last_ok ?? null, r.last_error ?? null);
  return db;
}

async function briefSetup() {
  const db = new D1();
  const t = (min) => iso(AM - min * 60_000);
  const sym = await addItem(db, { ticker: "SYM", source_key: "symbotic", title: "Symbotic reports Q4 FY26", nm_first_seen: t(600) });
  await addGrade(db, sym, { score: 93, why: "Q4 revenue $630M, above guide", graded_at: t(500) });
  const sym2 = await addItem(db, { ticker: "SYM", source_key: "symbotic", title: "Symbotic 10-K filed", nm_first_seen: t(590) });
  await addGrade(db, sym2, { score: 72, graded_at: t(480) });
  const low = await addItem(db, { ticker: "SYM", title: "Symbotic at a conference", nm_first_seen: t(580) });
  await addGrade(db, low, { score: 30, graded_at: t(470) });
  const before = await addItem(db, { ticker: "PL", title: "Old Planet item", nm_first_seen: t(1400) });
  await addGrade(db, before, { score: 88, graded_at: t(1300) }); // before the window
  const cp = await addItem(db, { ticker: "AUR", title: "Werner adds 50 Aurora trucks", role: "customer", affects: "AUR", nm_first_seen: t(300) });
  await addGrade(db, cp, { score: 78, graded_at: t(200) });
  const cross = await addItem(db, { ticker: "RCAT", title: "Red Cat and Unusual Machines deal", nm_first_seen: t(300) });
  await addGrade(db, cross, { score: 60, graded_at: t(150), run_id: "rx" });
  await addGrade(db, cross, { ticker: "UMAC", score: 82, graded_at: t(150), run_id: "rx" });
  await addItem(db, { ticker: "GRRR", source_key: "gorilla", title: "Gorilla files 6-K", nm_first_seen: t(40), ingested_at: t(38) });
  await addItem(db, { ticker: "AUR", role: "rival", title: "Rival news", nm_first_seen: t(40) });
  const notice = await addItem(db, { ticker: "PL", title: "Planet to Announce Q3 Results on Thursday, November 26, 2026", nm_first_seen: t(2000), published: t(2000) });
  await addGrade(db, notice, { score: 75, graded_at: t(1900), flags: JSON.stringify(["reason:calendar_card", "floor:calendar"]) });
  await db.prepare("INSERT INTO runs (id, started_at, last_seen_at) VALUES ('r', ?, ?)").bind(t(30), t(30)).run();
  const env = {
    DB: db,
    NEWS: newsDb([{ key: "symbotic", fail_count: 5, last_ok: t(3000), last_error: "HTTP 403" }, { key: "not_covered", fail_count: 9 }]),
  };
  return { db, env, sym, cp, cross };
}

test("brief sections: graded by ticker, counterparty, waiting, catalysts, health, items to label", async () => {
  const { env, cross } = await briefSetup();
  const from = iso(etToUtc("2026-11-23", 17, 30));
  const b = await buildBrief(env, COVERED, { from, to: iso(AM), now: AM, kind: "brief_am" });
  assert.deepEqual(b.leads_digests.map((g) => [g.ticker, g.items.map((i) => i.score)]), [["SYM", [93, 72]], ["UMAC", [82]]]);
  assert.equal(b.leads_digests[1].items[0].item_id, cross);
  assert.deepEqual(b.counterparty.map((r) => [r.ticker, r.role, r.score]), [["AUR", "customer", 78]]);
  assert.equal(b.waiting.count, 1);
  assert.equal(b.waiting.counterparty_count, 1);
  assert.equal(b.waiting.items[0].ticker, "GRRR");
  assert.ok(b.catalysts.some((e) => e.ticker === "PL" && e.start === "2026-11-26" && e.confirmed), "graded notice in the next 7 days");
  assert.ok(b.catalysts.some((e) => e.ticker === "MSTR" && e.start === "2026-11-30"), "sheet catalyst (MSCI deletion)");
  assert.ok(b.catalysts.every((e) => e.start >= "2026-11-24" && e.start <= "2026-12-01"));
  assert.deepEqual(b.health.news_monitor.failing.map((s) => s.key), ["symbotic"], "covered sources only");
  assert.equal(b.to_label.length, 3);
  assert.equal(b.to_label[0].score, 93);

  const text = renderBrief(b, { publicUrl: "https://zenith.example.com", now: AM });
  const all = text.join("\n");
  assert.ok(text.every((m) => m.length <= 2000));
  assert.match(all, /^\*\*Zenith morning brief · Tue 24 Nov 07:00 ET\*\*\n-# since Mon 23 Nov 17:30 ET/);
  assert.match(all, /__SYM__\n• \*\*93\*\* Lead · Symbotic reports Q4 FY26 — Q4 revenue \$630M, above guide/);
  assert.match(all, /• \*\*AUR\*\* ← customer · \*\*78\*\*/);
  assert.match(all, /\*\*Waiting for a grade\*\* \(1 covered, 1 counterparty\) · oldest 38m/);
  assert.match(all, /Thu 26 Nov · \*\*PL\*\* · Planet to Announce Q3 Results.* · confirmed notice/);
  assert.match(all, /\*\*Health\*\* · grader last ran Tue 24 Nov 06:30 ET \(30m ago\); \d+ grades in this window · news-monitor: 1 covered source failing: symbotic \(SYM, 5 fails, ok 2d 2h ago\)/);
  assert.match(all, /\*\*Label these\*\*\n• item \d+ · \*\*SYM 93\*\* .*<https:\/\/zenith\.example\.com\/m#i\d+>/);
});

test("brief health degrades gracefully without the NEWS binding", async () => {
  const { db } = await briefSetup();
  const b = await buildBrief({ DB: db }, COVERED, { from: iso(AM - 86_400_000), to: iso(AM), now: AM });
  assert.match(renderBrief(b, { now: AM }).join("\n"), /news-monitor: unavailable \(NEWS binding missing\)/);
});

test("brief slot: posts once per slot, records its window, and the next brief starts there", async () => {
  const { env } = await briefSetup();
  const f = discord();
  const e = { ...env, DISCORD_BRIEF_WEBHOOK: HOOK };
  const [slot] = slotsAt(AM);
  const r1 = await runSlot(e, COVERED, slot, { now: AM, fetchImpl: f });
  assert.equal(r1.status, "sent");
  assert.ok(f.calls.length >= 1 && f.calls.every((c) => c.url === `${HOOK}?wait=true`));
  const r2 = await runSlot(e, COVERED, slot, { now: AM + 1000, fetchImpl: f });
  assert.equal(r2.status, "already");
  const row = await env.DB.prepare("SELECT * FROM reports WHERE slot = 'brief_am:2026-11-24'").first();
  assert.equal(row.window_from, iso(etToUtc("2026-11-23", 17, 30)));
  assert.equal(row.window_to, iso(AM));
  assert.equal(JSON.parse(row.message_ids).length, f.calls.length);
  assert.equal(await lastBriefEnd(env.DB, AM + 10 * 3_600_000), iso(AM));
});

test("report crons: the off-candidate firing does nothing; the other runs; catch-up retries a failed slot", async () => {
  const { env } = await briefSetup();
  const e = { ...env, DISCORD_BRIEF_WEBHOOK: HOOK };
  const f = discord();
  assert.deepEqual((await runReportSlots(e, COVERED, AM - 3_600_000, { fetchImpl: f }))[0].status, "not_a_slot");
  assert.equal(f.calls.length, 0);

  const down = fakeFetch(() => ({ status: 500 }));
  assert.equal((await runReportSlots(e, COVERED, AM, { fetchImpl: down }))[0].status, "failed");
  assert.deepEqual(await catchUpReports(e, COVERED, { now: AM + 5 * 60_000, fetchImpl: f }), [], "the cron gets the first 10 minutes");
  const r = await catchUpReports(e, COVERED, { now: AM + 15 * 60_000, fetchImpl: f });
  assert.deepEqual(r.map((x) => [x.slot, x.status]), [["brief_am:2026-11-24", "sent"]]);
  assert.deepEqual(await catchUpReports(e, COVERED, { now: AM + 20 * 60_000, fetchImpl: f }), [], "sent slots are not repeated");
  assert.deepEqual(await catchUpReports(e, COVERED, { now: AM + 4 * 3_600_000, fetchImpl: f }), [], "too late to catch up");
});

test("briefs and calibration are inert without their webhooks", async () => {
  const { env } = await briefSetup();
  const f = discord();
  const [slot] = slotsAt(AM);
  assert.equal((await runSlot(env, COVERED, slot, { now: AM, fetchImpl: f })).status, "off");
  assert.deepEqual(await catchUpReports(env, COVERED, { now: AM + 15 * 60_000, fetchImpl: f }), []);
  assert.equal(f.calls.length, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first()).n, 0);
});

test("items to label: top grade, nearest the Digest line, least evidence, never labelled ones", async () => {
  const db = new D1();
  const now = Date.now();
  const mk = async (score, extra = {}) => { const id = await addItem(db, { ticker: "SYM" }); await addGrade(db, id, { score, ...extra }); return id; };
  const top = await mk(95), near = await mk(69), blind = await mk(45, { read_source: 0 }), labelled = await mk(99);
  await mk(20);
  await db.prepare("INSERT INTO feedback (item_id, label, created_at) VALUES (?, 'high', ?)").bind(labelled, iso(now)).run();
  const picks = await pickToLabel(db, now);
  assert.deepEqual(picks.map((p) => p.item_id), [top, near, blind]);
});

test("calibration: label ranges, explicit too high / too low, per band and ticker", async () => {
  assert.equal(verdict("high", 85), "agree");
  assert.equal(verdict("medium", 95), "too_high");
  assert.equal(verdict("noise", 45), "too_high");
  assert.equal(verdict("high", 70), "too_low");
  assert.equal(verdict("too_low", 50), "too_low");
  assert.equal(verdict("low", null), null);

  const db = new D1();
  // Stand-in for the grading stream's 0005 migration, which adds the too_high /
  // too_low labels: the feedback CHECK in 0001 allows only the four range labels.
  db.exec(`CREATE TABLE feedback2 (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, label TEXT NOT NULL, note TEXT, grade_id INTEGER, created_at TEXT NOT NULL);
           DROP TABLE feedback; ALTER TABLE feedback2 RENAME TO feedback;`);
  const now = Date.now();
  const label = async (ticker, score, lab, ageDays = 1) => {
    const id = await addItem(db, { ticker, title: `${ticker} ${score}` });
    const g = await addGrade(db, id, { score });
    await db.prepare("INSERT INTO feedback (item_id, label, grade_id, created_at) VALUES (?, ?, ?, ?)").bind(id, lab, g, iso(now - ageDays * 86_400_000)).run();
    return id;
  };
  await label("SYM", 92, "high");
  await label("SYM", 75, "noise");
  await label("AUR", 40, "high");
  await label("AUR", 91, "too_high");
  const old = await label("PL", 50, "low", 20);
  await db.prepare("INSERT INTO feedback (item_id, label, created_at) VALUES (?, 'medium', ?)").bind(old, iso(now - 15 * 86_400_000)).run(); // later label wins
  const c = await buildCalibration(db, { now });
  assert.equal(c.labelled_this_week, 4);
  assert.deepEqual([c.this_week.n, c.this_week.agree, c.this_week.too_high, c.this_week.too_low], [4, 1, 2, 1]);
  assert.equal(c.this_week.labels.too_high, 1);
  assert.deepEqual([c.all_time.n, c.all_time.agree], [5, 1], "PL 50 labelled medium (latest) is too low");
  assert.deepEqual(c.all_time.by_band.lead, { n: 2, agree: 1, too_high: 1, too_low: 0, unscored: 0, labels: { high: 1, too_high: 1 }, scored: 2, agreement: 50 });
  assert.equal(c.all_time.by_ticker.AUR.too_low, 1);
  assert.equal(c.misses[0].ticker, "SYM", "75 labelled noise is 46 points out");
  const text = renderCalibration(c).join("\n");
  assert.match(text, /Items labelled this week: \*\*4\*\* \(all time 5\)/);
  assert.match(text, /This week: 1\/4 agree \(25%\) · 2 graded too high, 1 too low · "too high" labels 1/);
  assert.match(text, /• Lead: 2 labelled · 1\/2 agree \(50%\) · 1 graded too high/);
  assert.match(text, /AUR 0\/2 ↑1 ↓1/);
  assert.match(renderCalibration(await buildCalibration(new D1(), { now })).join("\n"), /No labels yet/);
});

test("weekly calibration slot posts to the ops webhook on Mondays", async () => {
  const db = new D1();
  const f = discord();
  const mon8 = etToUtc("2026-11-23", 8, 0);
  const [slot] = slotsAt(mon8);
  assert.equal(slot.kind, "calibration");
  const r = await runSlot({ DB: db, DISCORD_OPS_WEBHOOK: OPS }, COVERED, slot, { now: mon8, fetchImpl: f });
  assert.equal(r.status, "sent");
  assert.equal(f.calls[0].url, `${OPS}?wait=true`);
  assert.match(f.calls[0].body.content, /^\*\*Zenith calibration · week to Mon 23 Nov 08:00 ET\*\*/);
});

test("report slots: only the candidate cron that is the ET wall time runs", () => {
  // Winter (EST): 07:00 ET is 12:00 UTC; the 11:00 UTC firing is not a slot.
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 24, 11, 0)).map((s) => s.kind), []);
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 24, 12, 0)).map((s) => s.key), ["brief_am:2026-11-24"]);
  // Summer (EDT): 07:00 ET is 11:00 UTC.
  assert.deepEqual(slotsAt(Date.UTC(2026, 6, 1, 11, 0)).map((s) => s.kind), ["brief_am"]);
  assert.deepEqual(slotsAt(Date.UTC(2026, 6, 1, 12, 0)).map((s) => s.kind), []);
  // 17:30 ET.
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 24, 22, 30)).map((s) => s.kind), ["brief_pm"]);
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 24, 21, 30)).map((s) => s.kind), []);
  assert.deepEqual(slotsAt(Date.UTC(2026, 6, 1, 21, 30)).map((s) => s.kind), ["brief_pm"]);
  // Monday 08:00 ET calibration: 13:00 UTC in winter, 12:00 UTC in summer (with no brief at 12:00 EDT).
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 23, 13, 0)).map((s) => s.kind), ["calibration"]);
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 23, 12, 0)).map((s) => s.kind), ["brief_am"]);
  assert.deepEqual(slotsAt(Date.UTC(2026, 5, 29, 12, 0)).map((s) => s.kind), ["calibration"]);
  assert.deepEqual(slotsAt(Date.UTC(2026, 10, 24, 13, 0)).map((s) => s.kind), [], "not Monday");
});

test("each brief covers the time since the previous slot", () => {
  const am = etToUtc("2026-11-24", 7, 0);
  assert.equal(new Date(previousBriefAt(am)).toISOString(), new Date(etToUtc("2026-11-23", 17, 30)).toISOString());
  const pm = etToUtc("2026-11-24", 17, 30);
  assert.equal(previousBriefAt(pm), am);
});

test("the brief lists only tickers still in coverage", async () => {
  const { env } = await briefSetup();
  const covered = { ...COVERED, tickers: ["SYM", "AUR", "PL", "GRRR"] }; // UMAC not covered here
  const b = await buildBrief(env, covered, { from: iso(AM - 86_400_000), to: iso(AM), now: AM });
  assert.deepEqual(b.leads_digests.map((g) => g.ticker), ["SYM", "PL"]);
  const text = renderBrief(b, { now: AM });
  assert.ok(text.every((m) => !/^__[A-Z]+__$/m.test(m.split("\n").at(-1))), "a ticker header never ends a message");
});

// A busy window: 24 graded items and 12 waiting ones, long enough for 6+ messages.
async function busySetup() {
  const db = new D1();
  const t = (min) => iso(AM - min * 60_000);
  const long = (s) => `${s} ${"with a long descriptive headline about the contract award and its terms ".repeat(3)}`.slice(0, 200);
  for (let k = 0; k < 24; k++) {
    const id = await addItem(db, { ticker: ["SYM", "GRRR", "PL"][k % 3], title: long(`Item ${k}`), nm_first_seen: t(600 - k) });
    await addGrade(db, id, { score: 95 - k, why: long(`Why ${k}: revenue $${k + 10}M`), graded_at: t(500 - k) });
  }
  for (let k = 0; k < 12; k++) await addItem(db, { ticker: "GRRR", title: long(`Waiting ${k}`), nm_first_seen: t(60 + k) });
  return { db, env: { DB: db, DISCORD_BRIEF_WEBHOOK: HOOK } };
}

// Discord's per-webhook bucket (5 requests per 2 s) on a fake clock that only
// moves when the sender sleeps. With headers, it also reports the bucket.
function limitedDiscord({ headers = false, failAt = null } = {}) {
  let t = 0, n = 0;
  const accepted = [], sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const f = fakeFetch((call, k) => {
    if (failAt && failAt(k)) return { status: 500, text: "boom" };
    const recent = accepted.filter((x) => x > t - 2000);
    if (recent.length >= 5) return { status: 429, json: { retry_after: (recent[0] + 2000 - t) / 1000, global: false } };
    accepted.push(t);
    const h = headers ? { "x-ratelimit-remaining": String(4 - recent.length), "x-ratelimit-reset-after": String(((recent[0] ?? t) + 2000 - t) / 1000) } : {};
    return { json: { id: `b${++n}` }, headers: h };
  });
  return { f, sleep, sleeps, accepted };
}

test("a long brief is paced to the webhook's rate limit and goes out whole", async () => {
  for (const headers of [false, true]) {
    const { env } = await busySetup();
    const d = limitedDiscord({ headers });
    const r = await runSlot(env, COVERED, slotsAt(AM)[0], { now: AM, fetchImpl: d.f, sleep: d.sleep });
    assert.equal(r.status, "sent", `headers=${headers}`);
    assert.ok(r.of >= 6, `a 6+ message brief (${r.of})`);
    assert.equal(r.messages, r.of);
    assert.equal(d.f.calls.length, r.of, "paced, so no 429s");
    const sent = d.f.calls.map((c) => c.body.content).join("\n");
    assert.match(sent, /\*\*Health\*\*/);
    assert.match(sent, /\*\*Label these\*\*/);
  }
});

test("a 429 waits retry_after and resends the same message", async () => {
  let n = 0;
  const f = fakeFetch((c, k) => (k === 3 ? { status: 429, json: { retry_after: 1.5 } } : { json: { id: `x${++n}` } }));
  const sleeps = [];
  const res = await discordSendAll(HOOK, ["one", "two", "three", "four"], { fetchImpl: f, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(res, { ok: true, ids: ["x1", "x2", "x3", "x4"] });
  assert.deepEqual(f.calls.map((c) => c.body.content), ["one", "two", "three", "three", "four"]);
  assert.ok(sleeps.includes(1500));
});

test("a brief cut off part-way is marked partial and the catch-up sends only the rest", async () => {
  const { env } = await busySetup();
  const d = limitedDiscord({ failAt: (k) => k === 3 });
  const slot = slotsAt(AM)[0];
  const r1 = await runSlot(env, COVERED, slot, { now: AM, fetchImpl: d.f, sleep: d.sleep });
  assert.deepEqual([r1.status, r1.messages], ["partial", 2]);
  const row = await env.DB.prepare("SELECT * FROM reports WHERE slot = ?").bind(slot.key).first();
  const contents = JSON.parse(row.contents);
  assert.equal(JSON.parse(row.message_ids).length, 2);
  assert.equal(await lastBriefEnd(env.DB, AM + 3_600_000, { slotAt: AM }), iso(etToUtc("2026-11-23", 17, 30)), "a partial brief does not move the next window");

  const ok = limitedDiscord();
  const r2 = await catchUpReports(env, COVERED, { now: AM + 15 * 60_000, fetchImpl: ok.f, sleep: ok.sleep });
  assert.deepEqual(r2.map((x) => [x.status, x.resumed, x.messages]), [["sent", 2, contents.length]]);
  assert.deepEqual(ok.f.calls.map((c) => c.body.content), contents.slice(2), "the start is not repeated, the tail is sent");
  const done = await env.DB.prepare("SELECT * FROM reports WHERE slot = ?").bind(slot.key).first();
  assert.equal(JSON.parse(done.message_ids).length, contents.length);
  assert.equal(done.window_to, iso(AM), "the window is the first attempt's");
  assert.deepEqual(await catchUpReports(env, COVERED, { now: AM + 20 * 60_000, fetchImpl: ok.f, sleep: ok.sleep }), []);
});

test("a send a crashed run left part-way resumes from the ids it recorded", async () => {
  const { env } = await busySetup();
  const slot = slotsAt(AM)[0];
  const d = limitedDiscord({ failAt: (k) => k === 4 });
  await runSlot(env, COVERED, slot, { now: AM, fetchImpl: d.f, sleep: d.sleep });
  // As if the run died after its third message: still 'sending', ids recorded.
  await env.DB.prepare("UPDATE reports SET status = 'sending', updated_at = ? WHERE slot = ?").bind(iso(AM - 3_600_000), slot.key).run();
  const ok = limitedDiscord();
  const [r] = await catchUpReports(env, COVERED, { now: AM + 20 * 60_000, fetchImpl: ok.f, sleep: ok.sleep });
  assert.deepEqual([r.status, r.resumed], ["sent", 3]);
});

test("with no brief sent in 48 h, a catch-up or late brief still starts at the previous slot", async () => {
  const { env } = await briefSetup();
  const e = { ...env, DISCORD_BRIEF_WEBHOOK: HOOK };
  const prevSlot = iso(etToUtc("2026-11-23", 17, 30));
  assert.equal(await lastBriefEnd(e.DB, AM + 10 * 60_000, { slotAt: AM }), prevSlot);
  assert.equal(await lastBriefEnd(e.DB, AM + 60 * 60_000, { slotAt: AM }), prevSlot);
  const [r] = await catchUpReports(e, COVERED, { now: AM + 70 * 60_000, fetchImpl: discord() });
  assert.equal(r.status, "sent");
  const row = await e.DB.prepare("SELECT window_from, window_to FROM reports WHERE slot = 'brief_am:2026-11-24'").first();
  assert.deepEqual([row.window_from, row.window_to], [prevSlot, iso(AM + 70 * 60_000)], "overnight grades are in the window");
});
