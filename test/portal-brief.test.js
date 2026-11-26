// Phase 3 Part E (PR-E3): the portal Brief view, /p/brief (worker/src/portal-brief.js).
// B-1 no data without auth (both modes, every refused credential); B-2 the signed-in
// page: sections in order, exactly Q3 + Q1' + the router's view count, no write to
// brief_days; B-3 portal headers and the view contract; B-4 escaping and links; B-5
// day selection, the day strip, 'not stored', a failed day and ?day= validation;
// B-6 counterparty leaves out rival rows (stored by the real store tick); B-7 a stored
// copy cut to fit 64 KB says which lists were cut; B-8 section errors and the empty
// lines; B-9 the import rule; B-10 the plans. Synthetic fixtures only (ticker TST,
// example.com).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addItem, addGrade, D1 } from "./helpers/d1.js";
import { hookJsonImports } from "./helpers/worker-env.js";
import {
  pfetch, sessionEnv, accessEnv, sessionCookie, spyDb, keyPair, signJwt, goodClaims, withCerts, stripNonce,
  ORIGIN, APP, TOKENS, SECRET_TITLE,
} from "./helpers/portal.js";
import { clearJwksCache } from "../worker/src/mobile.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const portalMod = await import("../worker/src/portal.js");
const briefMod = await import("../worker/src/portal-brief.js");
const { briefView, Q3_SQL, Q1V_SQL, CUT_NAMES } = briefMod;
const { briefStoreTick, capBrief } = await import("../worker/src/brief-store.js");
const { buildBrief } = await import("../worker/src/brief.js");
const { loadRelations } = await import("../worker/src/relations.js");
const { briefSections } = await import("../worker/src/brief-sections.js");

const KEY = await keyPair("kid-brief");
// A fixed, synthetic "now": Wednesday 2026-03-18, 12:00 ET (EDT).
const NOW = Date.parse("2026-03-18T16:00:00.000Z");
const TODAY = "2026-03-18";
const SECTIONS = ["Leads and Digests", "Competitors and peers", "Industry", "Counterparty", "Waiting", "Next 7 days",
  "Calendar, next 30 days", "Council outcomes", "Health", "Stored days"];

// --- Fixtures -----------------------------------------------------------------------
const cov = (id, over = {}) => ({ grade_id: id, item_id: id, ticker: "TST", score: 80, band: "digest", event_type: "contract", why: "Synthetic why",
  note_hook: null, read_source: 1, graded_at: "2026-03-17T15:00:00.000Z", title: `Coverage row ${id}`, url: `https://example.com/c/${id}`,
  role: null, item_ticker: "TST", source_key: "src_tst", nm_first_seen: "2026-03-17T14:00:00.000Z", headline: null, ...over });
const aux = (id, over = {}) => ({ pipeline: "aux", item_id: id, grade_id: id, entity_key: `entity_${id}`, entity_name: `Synthetic Entity ${id}`,
  status: "media", source_key: `aux_${id}`, title: `Aux row ${id}`, headline: null, url: `https://example.com/a/${id}`, score: 76, band: "digest",
  event_type: "x", why: "Aux why", graded_at: "2026-03-17T15:00:00.000Z", ...over });
const cal = (start, text, over = {}) => ({ ticker: "TST", kind: "catalyst", start, end: start, precision: "day", text, ...over });

function contents(over = {}) {
  return {
    kind: "brief_am", generated_at: "2026-03-18T11:05:00.000Z", from: "2026-03-17T11:00:00.000Z", to: "2026-03-18T11:05:00.000Z", today: TODAY,
    leads_digests: [{ ticker: "TST", items: [cov(101, { score: 88 })] }],
    counterparty: [cov(102, { role: "customer", title: "Customer row" }), cov(103, { role: "rival", title: "Rival row" })],
    waiting: { count: 1, counterparty_count: 0, oldest: "2026-03-17T13:00:00.000Z", held: 0, items: [{ item_id: 301, ticker: "TST", title: "Waiting row", url: "https://example.com/w", source_key: "src_tst", state: "pending", nm_first_seen: "2026-03-17T13:00:00.000Z" }] },
    catalysts: [cal("2026-03-20", "Synthetic catalyst")],
    council_outcomes: [],
    health: { grader_last_run: "2026-03-18T10:30:00.000Z", graded_in_window: 3, news_monitor: { failing: [] } },
    to_label: [],
    competitors: {
      by_ticker: [{ ticker: "TST", items: [{ ...aux(201, { score: 81, title: "Peer row" }), ticker: "TST", direction: "+" },
        { pipeline: "coverage", ...cov(103, { role: "rival", title: "Rival row", score: 78 }), direction: "-" }] }],
      count: 2, listed: 2, more: 0, below: [], unassigned: 0, waiting: { n: 1, held: 0 }, rival_sources: 2,
    },
    industry: { items: [{ ...aux(202, { title: "Industry row", status: "program", score: 74 }), tag: "program", tickers: ["TST"] }], count: 1, below: [],
      unassigned: 0, waiting: { n: 0, held: 0 }, registers: [{ text: "Synthetic register (2026-02): 5 (+1 since 2026-01)" }] },
    calendar: [cal("2026-03-20", "Synthetic catalyst"), cal("2026-04-10", "Synthetic calendar entry")],
    ...over,
  };
}
const countsOf = (c) => ({ leads_digests: 1, counterparty: c.counterparty?.length ?? 0, waiting: 1, held: 0, catalysts: 1, council_outcomes: 0,
  competitors: 2, industry: 1, competitors_below: 0, industry_below: 0, registers: 1, calendar: c.calendar?.length ?? 0 });

function store(env, day, { status = "ok", c = contents(), counts = null, error = null, from = "2026-03-17T11:00:00.000Z" } = {}) {
  const db = env.DB.db ?? env.DB;
  db.prepare(`INSERT INTO brief_days (universe_id, day, kind, status, attempts, window_from, window_to, built_at, counts, contents, error)
    VALUES ('u1', ?, 'brief_am', ?, 1, ?, ?, ?, ?, ?, ?)`).run(day, status, from, `${day}T11:05:00.000Z`, `${day}T11:05:00.000Z`,
    status === "ok" ? JSON.stringify(counts || countsOf(c)) : null, status === "ok" ? JSON.stringify(c) : null, error);
}
const briefRows = (env) => (env.DB.db ?? env.DB).prepare("SELECT day, status, attempts, built_at, counts, contents, error FROM brief_days ORDER BY day").all().map((r) => ({ ...r }));

// Opens a path through the portal router, signed in with a session cookie.
async function open(env, path, { now = NOW } = {}) {
  const cookie = await sessionCookie(env, now);
  const req = new Request(`${ORIGIN}${path}`, { headers: { cookie } });
  const res = await portalMod.portal(req, env, new URL(req.url), { tickers: ["TST"], feedback: () => null, now: () => now });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const mainOf = (text) => /<main>(.*)<\/main>/s.exec(text)[1];
function sections(text) {
  return mainOf(text).split(/<h2[^>]*>/).slice(1).map((s) => [s.slice(0, s.indexOf("</h2>")), s.slice(s.indexOf("</h2>") + 5)]);
}
const section = (text, name) => sections(text).find(([h]) => h === name)?.[1] ?? null;

// --- B-1 -------------------------------------------------------------------------------
test("B-1: /p/brief without a valid credential: 303 /p/login (session) or 403 (Access); no stored title, ticker or score; brief_days never read", async () => {
  clearJwksCache();
  const secret = contents({ leads_digests: [{ ticker: "TST", items: [cov(101, { title: SECRET_TITLE, score: 87, why: SECRET_TITLE })] }] });
  for (const mode of ["session", "access"]) {
    await withCerts({ keys: [KEY.jwk] }, async () => {
      const base = mode === "session" ? sessionEnv() : accessEnv();
      store(base, TODAY, { c: secret });
      const spy = spyDb(base.DB);
      const env = { ...base, DB: spy };
      const creds = [
        ["none", {}],
        ["bad JWT", { jwt: "a.b.c" }],
        ["wrong-AUD JWT", { jwt: await signJwt(KEY, goodClaims(Date.now(), { aud: ["other-aud"] })) }],
        ["APP_TOKEN bearer", { headers: { authorization: `Bearer ${APP}` } }],
        ["grader bearer", { headers: { authorization: `Bearer ${TOKENS.GRADER_TOKEN}` } }],
        ["?token=", {}, "?token=" + APP],
      ];
      for (const [label, opts, q = ""] of creds) {
        for (const path of [`/p/brief${q}`, `/p/brief${q ? `${q}&` : "?"}day=${TODAY}`, "/p/brief/"]) {
          const r = await pfetch(worker, env, path, opts);
          const tag = `${mode} ${label} ${path}`;
          assert.notEqual(r.status, 200, tag);
          if (mode === "session") { assert.equal(r.status, 303, tag); assert.equal(r.headers.get("location"), "/p/login", tag); }
          else assert.equal(r.status, 403, tag);
          const body = stripNonce(r.text, r.headers);
          assert.ok(!body.includes(SECRET_TITLE), `${tag}: title`);
          assert.ok(!/\bTST\b/.test(body), `${tag}: ticker`);
          assert.ok(!/class="score"|\b87\b|<article|Competitors and peers/.test(body), `${tag}: score or section`);
          assert.equal(r.headers.get("cache-control"), "no-store", tag);
        }
      }
      assert.deepEqual(spy.seen.filter((s) => /brief_days|\bitems\b/.test(s)), [], `${mode}: no read`);
    });
  }
});

// --- B-2 -------------------------------------------------------------------------------
test("B-2: signed in (session cookie or Access JWT): 200, the sections in order, exactly Q3, Q1' and the view count, nothing written to brief_days", async () => {
  clearJwksCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    for (const mode of ["session", "access"]) {
      const base = mode === "session" ? sessionEnv() : accessEnv();
      store(base, TODAY);
      const before = briefRows(base);
      const spy = spyDb(base.DB);
      const env = { ...base, DB: spy };
      const headers = mode === "session" ? { cookie: await sessionCookie(base, NOW) } : { "cf-access-jwt-assertion": await signJwt(KEY, goodClaims(NOW)) };
      const req = new Request(`${ORIGIN}/p/brief`, { headers });
      const res = await portalMod.portal(req, env, new URL(req.url), { tickers: ["TST"], feedback: () => null, now: () => NOW });
      const text = await res.text();
      assert.equal(res.status, 200, mode);
      assert.deepEqual(sections(text).map(([h]) => h), SECTIONS, mode);
      assert.match(text, /<h2 id="calendar">Calendar, next 30 days<\/h2>/);
      assert.match(text, /<title>Brief · Zenith<\/title>/);
      assert.match(text, /<a href="\/p\/brief" aria-current="page">Brief<\/a>/);
      assert.match(text, /Morning brief · Wed 18 Mar<\/strong> · since Tue 17 Mar 07:00 ET/);
      assert.equal(spy.seen.length, 3, `${mode}: ${spy.seen.join(" | ")}`);
      assert.equal(spy.seen[0], Q3_SQL);
      assert.equal(spy.seen[1], Q1V_SQL);
      assert.match(spy.seen[2], /^INSERT INTO portal_views/);
      assert.ok(!spy.seen.some((s) => /(INSERT|UPDATE|DELETE)[^;]*brief_days/i.test(s)), "no write to brief_days");
      assert.deepEqual(briefRows(base), before, `${mode}: brief_days unchanged`);
      const views = base.DB.db.prepare("SELECT view, n FROM portal_views").all().map((r) => ({ ...r }));
      assert.deepEqual(views, [{ view: "brief", n: 1 }]);
      // Cards with label forms that come back to this day.
      assert.match(section(text, "Leads and Digests"), /<article class="card" id="i101">/);
      assert.match(section(text, "Leads and Digests"), /name="return" value="\/p\/brief\?day=2026-03-18"/);
      const comp = section(text, "Competitors and peers");
      assert.match(comp, /<article class="card aux" id="a201">/);
      assert.match(comp, /<span class="badge">\+ TST<\/span>/);
      assert.match(comp, /<article class="card" id="i103">/, "the Coverage rival row is a coverage card");
      assert.match(comp, /<span class="badge">- TST<\/span>/);
      const ind = section(text, "Industry");
      assert.match(ind, /<article class="card aux" id="a202">/);
      assert.match(ind, /<span class="badge">program<\/span><span class="badge">TST<\/span>/);
      assert.match(ind, /Register readings.*Synthetic register \(2026-02\): 5 \(\+1 since 2026-01\)/s);
      assert.match(section(text, "Next 7 days"), /Fri 20 Mar<\/span> <a href="\/p\/c\/TST">TST<\/a>: Synthetic catalyst/);
      assert.match(section(text, "Calendar, next 30 days"), /Synthetic calendar entry/);
      assert.match(section(text, "Waiting"), /1 covered waiting for a grade/);
      assert.match(section(text, "Health"), /3 grades in this window/);
      assert.doesNotMatch(text, /cut to fit/, "no truncation note on an uncut copy");
    }
  });
});

// --- B-3 -------------------------------------------------------------------------------
test("B-3: the response has the portal headers (no-store, CSP with the nonce) and the view returns only title, active, body and status", async () => {
  const env = sessionEnv();
  store(env, TODAY);
  const r = await open(env, "/p/brief");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-security-policy"), /script-src 'nonce-/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("set-cookie"), null);
  const vctx = { env, url: new URL(`${ORIGIN}/p/brief`), auth: { ok: true, mode: "session" }, now: NOW, tickers: ["TST"] };
  const out = await briefView(vctx);
  assert.deepEqual(Object.keys(out).sort(), ["active", "body", "title"]);
  assert.deepEqual([out.title, out.active], ["Brief", "brief"]);
  const bad = await briefView({ ...vctx, url: new URL(`${ORIGIN}/p/brief?day=x`) });
  assert.deepEqual(Object.keys(bad).sort(), ["active", "body", "status", "title"]);
  // Fails closed without a verified gate result, before any query.
  const spy = spyDb(env.DB);
  for (const auth of [undefined, null, { ok: false }, { ok: "true" }]) {
    const d = await briefView({ ...vctx, env: { ...env, DB: spy }, auth });
    assert.equal(d.status, 403);
  }
  assert.equal(spy.seen.length, 0);
});

// --- B-4 -------------------------------------------------------------------------------
test("B-4: stored strings are escaped and a javascript: URL is never linked", async () => {
  const env = sessionEnv();
  const evil = "<script>alert(1)</script>";
  store(env, TODAY, { c: contents({
    leads_digests: [{ ticker: "TST", items: [cov(101, { title: evil, url: "javascript:alert(1)", why: `"><img src=x onerror=alert(1)>` })] }],
    competitors: { by_ticker: [{ ticker: "TST", items: [{ ...aux(201, { title: evil, url: "javascript:alert(2)", entity_name: evil }), ticker: "TST", direction: evil }] }],
      count: 1, listed: 1, more: 0, below: [], unassigned: 0, waiting: { n: 0, held: 0 }, rival_sources: 0 },
    calendar: [cal("2026-03-20", evil, { time: evil })],
    industry: { items: [], count: 0, below: [], unassigned: 0, waiting: { n: 0, held: 0 }, registers: [{ text: evil }] },
  }) });
  store(env, "2026-03-17", { status: "failed", error: `<img src=x onerror=alert(3)>` });
  for (const path of ["/p/brief", "/p/brief?day=2026-03-17"]) {
    const r = await open(env, path);
    assert.equal(r.status, 200, path);
    const main = mainOf(r.text);
    assert.doesNotMatch(main, /<script|<img/i, path);
    assert.doesNotMatch(main, /href="javascript:/i, path);
  }
  const main = mainOf((await open(env, "/p/brief")).text);
  assert.match(main, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(main, /<h3>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h3>/, "an unsafe URL leaves the title as plain text");
  assert.match(mainOf((await open(env, "/p/brief?day=2026-03-17")).text), /Not built: &lt;img src=x onerror=alert\(3\)&gt;/);
});

// --- B-5 -------------------------------------------------------------------------------
test("B-5: ?day= is validated; the default day is today when stored, else the newest; a missing weekday reads 'not stored'; a failed day shows its error", async () => {
  const env = sessionEnv();
  for (const q of ["2026-13-01x", "2026-13-01", "2026-02-30", "20260318", "2026-3-18", "", "2026-03-18%0a"]) {
    const spy = spyDb(env.DB);
    const r = await open({ ...env, DB: spy }, `/p/brief?day=${q}`);
    assert.equal(r.status, 400, q);
    assert.match(mainOf(r.text), /Bad day/, q);
    assert.equal(spy.seen.length, 0, `${q}: no query and no view count`);
  }
  // Nothing stored yet.
  const empty = await open(env, "/p/brief");
  assert.equal(empty.status, 200);
  assert.match(mainOf(empty.text), /No brief stored yet/);
  assert.match(mainOf(empty.text), /Wed 18 Mar · not stored/);

  store(env, "2026-03-13", { c: contents({ leads_digests: [{ ticker: "TST", items: [cov(111, { title: "Friday row" })] }] }) });
  store(env, "2026-03-17", { c: contents({ leads_digests: [{ ticker: "TST", items: [cov(112, { title: "Tuesday row" })] }] }) });
  store(env, "2026-03-12", { status: "failed", error: "synthetic failure" });
  const r = await open(env, "/p/brief");
  assert.match(r.text, /Morning brief · Tue 17 Mar/, "today is not stored: the newest row");
  assert.match(r.text, /Tuesday row/);
  const strip = section(r.text, "Stored days");
  assert.match(strip, /<a href="\/p\/brief\?day=2026-03-17" aria-current="true">Tue 17 Mar<\/a>/);
  assert.match(strip, /<a href="\/p\/brief\?day=2026-03-13">Fri 13 Mar<\/a>/);
  assert.match(strip, /Mon 16 Mar · not stored/);
  assert.match(strip, /Wed 18 Mar · not stored/);
  assert.match(strip, /Thu 12 Mar<\/a> <span class="meta">failed<\/span>/);
  assert.doesNotMatch(strip, /Sat 14 Mar|Sun 15 Mar/, "weekends are not listed unless stored");

  const friday = await open(env, "/p/brief?day=2026-03-13");
  assert.match(friday.text, /Morning brief · Fri 13 Mar/);
  assert.match(friday.text, /Friday row/);
  const monday = await open(env, "/p/brief?day=2026-03-16");
  assert.equal(monday.status, 200);
  assert.match(mainOf(monday.text), /Not stored: no brief was stored for this day/);
  assert.match(mainOf(monday.text), /Mon 16 Mar · not stored/);
  const failed = await open(env, "/p/brief?day=2026-03-12");
  assert.match(mainOf(failed.text), /Not built: synthetic failure/);
  assert.doesNotMatch(failed.text, /Competitors and peers/);

  store(env, TODAY, { c: contents({ leads_digests: [{ ticker: "TST", items: [cov(113, { title: "Today row" })] }] }) });
  const today = await open(env, "/p/brief");
  assert.match(today.text, /Morning brief · Wed 18 Mar/);
  assert.match(today.text, /Today row/);
});

// --- B-6 -------------------------------------------------------------------------------
test("B-6: a brief stored by the real store tick lists a rival Coverage row under Competitors, not Counterparty; the /v1/brief object still has it under counterparty", async () => {
  const env = sessionEnv();
  const news = new D1({ migrations: false });
  news.exec("CREATE TABLE series_points (series TEXT, subject TEXT, period TEXT, value REAL, ticker TEXT, label TEXT, observed_at TEXT, PRIMARY KEY (series, subject, period))");
  env.NEWS = { prepare: (sql) => news.prepare(sql) };
  const covered = { tickers: ["TST"] };
  const rel = loadRelations({
    relations: { basis: "files", peers: {}, rivals: {}, key_accounts: {} }, version: "rel-test",
    covered: { tickers: ["TST"], counterparty: {} }, aux: { sources: {} }, match: {}, industry: {}, isRecordSource: () => false,
  });
  const graded = "2026-03-16T15:00:00.000Z";
  const rival = await addItem(env.DB, { ticker: "TST", role: "rival", source_key: "rival_src", title: "Synthetic rival news", nm_first_seen: graded });
  await addGrade(env.DB, rival, { score: 78, graded_at: graded });
  const cust = await addItem(env.DB, { ticker: "TST", role: "customer", source_key: "cust_src", title: "Synthetic customer news", nm_first_seen: graded });
  await addGrade(env.DB, cust, { score: 75, graded_at: graded });
  const own = await addItem(env.DB, { ticker: "TST", title: "Synthetic own news", nm_first_seen: graded });
  await addGrade(env.DB, own, { score: 85, graded_at: graded });
  const tick = await briefStoreTick(env, covered, { now: Date.parse("2026-03-17T11:05:00.000Z"), rel });
  assert.equal(tick.status, "ok", JSON.stringify(tick));

  const r = await open(env, "/p/brief");
  assert.equal(r.status, 200);
  assert.match(r.text, /Morning brief · Tue 17 Mar<\/strong> · since Mon 16 Mar 07:00 ET/);
  const comp = section(r.text, "Competitors and peers");
  assert.match(comp, new RegExp(`id="i${rival}"`));
  assert.match(comp, /Synthetic rival news/);
  const cp = section(r.text, "Counterparty");
  assert.doesNotMatch(cp, /Synthetic rival news/);
  assert.match(cp, /Synthetic customer news/);
  assert.match(cp, /1 rival row listed under Competitors and peers/);
  assert.match(section(r.text, "Leads and Digests"), /Synthetic own news/);
  // The JSON brief (what /v1/brief returns) keeps the rival row in counterparty.
  const b = await buildBrief(env, covered, { from: "2026-03-16T11:00:00.000Z", to: "2026-03-17T11:05:00.000Z", now: Date.parse("2026-03-17T11:05:00.000Z") });
  assert.deepEqual(b.counterparty.map((x) => x.item_id).sort(), [rival, cust].sort());
  assert.ok(!("competitors" in b), "the default brief object is unchanged");
});

// --- B-7 -------------------------------------------------------------------------------
test("B-7: a stored copy cut to fit 64 KB says which lists were cut, and an emptied list says its rows were cut, not that it had none", async () => {
  const env = sessionEnv();
  const c = contents({
    calendar: [],
    competitors: { ...contents().competitors, by_ticker: [{ ticker: "TST", items: [{ ...aux(201), ticker: "TST", direction: "+" }] }], count: 3 },
    health: { grader_last_run: null, graded_in_window: 0, news_monitor: { failing: [] } },
    truncated: { calendar: 30, competitors: 2, health_failing: 4 },
  });
  store(env, TODAY, { c, counts: { ...countsOf(c), calendar: 30, competitors: 3 } });
  const r = await open(env, "/p/brief");
  assert.equal(r.status, 200);
  const main = mainOf(r.text);
  const note = /<p class="note truncated" role="note" data-truncated="([^"]*)">(.*?)<\/p>/s.exec(main);
  assert.ok(note, "the note is shown");
  assert.equal(note[1], "calendar competitors health_failing");
  assert.match(note[2], /cut to fit the 64 KB store/);
  assert.match(note[2], /Calendar, next 30 days \(30 rows\); Competitors and peers \(2 rows\); Health, failing sources \(4 rows\)/);
  assert.ok(main.indexOf("note truncated") < main.indexOf("<h2>"), "the note is at the top");
  const calendar = section(r.text, "Calendar, next 30 days");
  assert.match(calendar, /All 30 rows cut to fit the store/);
  assert.doesNotMatch(calendar, /Nothing on the calendar/);
  assert.match(section(r.text, "Competitors and peers"), /2 more rows cut to fit the store/);
  const health = section(r.text, "Health");
  assert.match(health, /All 4 rows cut to fit the store/);
  assert.doesNotMatch(health, /all covered sources OK/);
  // Lists that were not cut keep their normal empty text.
  assert.match(section(r.text, "Council outcomes"), /None in the last 7 days/);

  // The real cut: every list capBrief names in contents.truncated is named on the page.
  const s = (n, ch) => ch.repeat(n);
  const url = (k) => `https://example.com/news/a-fairly-long-article-slug-about-a-company-${k}?utm_source=feed&utm_medium=rss`;
  const g = (k) => cov(100_000 + k, { score: 99 - (k % 30), why: s(300, "w"), note_hook: s(200, "n"), title: s(140, "t"), url: url(k), headline: s(100, "h") });
  const big = {
    ...contents(), text: ["x"],
    leads_digests: [{ ticker: "TST", items: Array.from({ length: 40 }, (_, k) => g(k)) }],
    counterparty: Array.from({ length: 15 }, (_, k) => ({ ...g(k), role: "customer" })),
    catalysts: Array.from({ length: 25 }, (_, k) => cal("2026-03-20", s(120, "c"), { k })),
    calendar: Array.from({ length: 100 }, (_, k) => cal("2026-03-25", s(120, "c"), { k })),
    health: { news_monitor: { failing: Array.from({ length: 10 }, (_, k) => ({ key: `k${k}`, ticker: "TST", fail_count: 3, last_error: s(90, "e") })) } },
    competitors: { ...contents().competitors, by_ticker: [{ ticker: "TST", items: Array.from({ length: 25 }, (_, k) => ({ ...aux(k, { title: s(140, "t"), why: s(300, "w"), url: url(k), headline: s(100, "h") }), ticker: "TST", direction: "-" })) }], count: 25 },
    industry: { ...contents().industry, items: Array.from({ length: 25 }, (_, k) => ({ ...aux(500 + k, { title: s(140, "t"), why: s(300, "w"), url: url(k), headline: s(100, "h") }), tag: "media", tickers: ["TST"] })), count: 25 },
  };
  const cut = capBrief(big).contents;
  const names = Object.keys(cut.truncated);
  assert.ok(names.length >= 2, JSON.stringify(cut.truncated));
  const env2 = sessionEnv();
  store(env2, TODAY, { c: cut });
  const page = mainOf((await open(env2, "/p/brief")).text);
  const shown = /data-truncated="([^"]*)"/.exec(page)[1].split(" ");
  assert.deepEqual(shown, names);
  for (const k of names) {
    assert.ok(CUT_NAMES[k], `brief-store.js list ${k} has a name on the page`);
    assert.ok(page.includes(`${CUT_NAMES[k]} (${cut.truncated[k]} row`), `${k} is named with its count`);
  }
  assert.doesNotMatch(page, /Nothing on the calendar|Nothing dated\./, "an emptied calendar is not shown as empty");
});

// --- B-8 -------------------------------------------------------------------------------
// The Competitors section as brief-sections.js builds it for one peer aux grade at 65
// (a below-the-line row carries its tickers as [{ ticker, direction }]).
async function belowCompetitors() {
  const db = new D1();
  const auxMap = { sources: { peer_src: { entity: "peer_x", name: "Peer X news", status: "private" } } };
  const rel = loadRelations({
    relations: { basis: "files", peers: { peer_x: { name: "Peer X", status: "private", reads: [{ ticker: "TST", direction: "-" }] } }, rivals: {}, key_accounts: {} },
    version: "rel-test", covered: { tickers: ["TST"], counterparty: {} }, aux: auxMap, match: {}, industry: {}, isRecordSource: () => false,
  });
  const at = "2026-03-17T15:00:00.000Z";
  const item = await db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state, coverage_subject)
    VALUES (60001, 'peer_src', 'peer_x', 'Peer X', 'private', 'https://example.com/a/below', 'Below row', ?, ?, 'graded', 0)`).bind(at, at).run();
  const id = item.meta.last_row_id;
  const g = await db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, graded_at)
    VALUES (?, 'run-below', 'Peer X', 65, 'borderline', 'Below why', '[]', '[]', ?)`).bind(id, at).run();
  await db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").bind(g.meta.last_row_id, id).run();
  const news = { prepare: () => ({ all: async () => ({ results: [] }) }) };
  const { competitors } = await briefSections({ DB: db, NEWS: news }, { tickers: ["TST"] },
    { from: "2026-03-17T11:00:00.000Z", to: "2026-03-18T11:05:00.000Z", rel, aux: auxMap });
  return { competitors, id };
}

test("B-8: a failed section says so; an empty section says 'None at 70+' with its waiting counts and lists the rows below the Digest line with their sign and ticker; a missing section says so", async () => {
  const env = sessionEnv();
  const { competitors: built, id: belowId } = await belowCompetitors();
  assert.equal(built.count, 0);
  assert.deepEqual(built.below.map((x) => [x.item_id, x.tickers, "ticker" in x, "direction" in x]), [[belowId, [{ ticker: "TST", direction: "-" }], false, false]],
    "brief-sections.js stores a below row's ticker and sign only in tickers");
  store(env, TODAY, { c: contents({
    competitors: { ...built, unassigned: 1, waiting: { n: 4, held: 1 }, rival_sources: 2 },
    industry: { error: "synthetic section failure" },
    calendar: undefined,
  }) });
  const r = await open(env, "/p/brief");
  const comp = section(r.text, "Competitors and peers");
  assert.match(comp, /None at 70\+ since Tue 17 Mar 07:00 ET\. 4 waiting for a grade \(1 held by the daily budget\); 2 rival sources followed\./);
  assert.match(comp, new RegExp(`Below the Digest line</strong></p><article class="card aux" id="a${belowId}">`));
  const below = comp.slice(comp.indexOf("Below the Digest line"));
  assert.match(below, /<span class="badge">- TST<\/span>/, "the below row shows its stored sign and ticker");
  assert.doesNotMatch(below, /<span class="badge">±<\/span>/);
  assert.match(section(r.text, "Industry"), /This section failed to build/);
  assert.doesNotMatch(r.text, /synthetic section failure/, "the stored error text is not shown for a section");
  assert.match(section(r.text, "Calendar, next 30 days"), /Not in this stored brief/);
});

// --- B-9 -------------------------------------------------------------------------------
test("B-9: portal-brief.js imports none of brief.js, delivery.js, discord.js, tuning.js (transitively) and reads no env.NEWS", () => {
  const SRC = new URL("../worker/src/", import.meta.url);
  const seen = new Set();
  const go = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) go(m[1]);
  };
  go("portal-brief.js");
  for (const f of ["brief.js", "brief-store.js", "brief-sections.js", "delivery.js", "discord.js", "tuning.js", "index.js"]) assert.ok(!seen.has(f), `reaches ${f}`);
  const code = readFileSync(new URL("portal-brief.js", SRC), "utf8");
  assert.doesNotMatch(code, /\benv\.NEWS\b|\bfetch\(|import\(/);
  assert.doesNotMatch(code, /\.(run|batch)\(|INSERT|UPDATE|DELETE/, "the view writes nothing");
});

// --- B-10 ------------------------------------------------------------------------------
test("B-10: Q3 and Q1' read brief_days by its primary key", () => {
  const env = sessionEnv();
  const plan = (sql, ...args) => env.DB.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join("\n");
  const q3 = plan(Q3_SQL, TODAY);
  assert.match(q3, /sqlite_autoindex_brief_days_1/);
  assert.doesNotMatch(q3, /TEMP B-TREE/i);
  assert.match(plan(Q1V_SQL, TODAY), /SEARCH brief_days USING INDEX sqlite_autoindex_brief_days_1 \(universe_id=\? AND day=\? AND kind=\?\)/);
});
