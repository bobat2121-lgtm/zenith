// Phase 3 Part B (P3-B3): the Company page, /p/c/<T> (worker/src/portal-company.js).
// T1b the page's gate, T18 escaping, T19 sections and empty states, T24 headers and
// methods, T21 imports, plus the view contract (fails closed, read-only, the window
// links, the "Search this company" link, label forms). Synthetic rows only. Tickers
// and source keys are picked from the bundled maps (covered.json, aux-sources.json,
// the relations module) at run time by their properties, never written here;
// synthetic keys (managed_test_news, test_series) stay literal. The sheet calendar
// is replaced by a synthetic one in a temp copy of worker/src.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { D1, addItem, addGrade } from "./helpers/d1.js";
import { OPS_ALERTS_SQL, MANAGED_HEALTH_SQL } from "./helpers/news-ops.js";
import {
  loadWorkerModule, pfetch, sessionEnv, accessEnv, sessionCookie, spyDb, keyPair, signJwt, goodClaims, withCerts, stripNonce,
  ORIGIN, APP, EMAIL,
} from "./helpers/portal.js";

const SRC = new URL("../worker/src/", import.meta.url);
const COV = JSON.parse(readFileSync(new URL("covered.json", SRC), "utf8"));
const AUX = JSON.parse(readFileSync(new URL("aux-sources.json", SRC), "utf8"));
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ago = (days) => iso(NOW - days * DAY);
const KA = new Set(["customer", "program", "relationship", "index_event"]);
const SENTINEL = "SENTINEL-COMPANY-TITLE";

// Loads worker/src from a temp copy (JSON imports rewritten), with calendar.generated.js
// replaced when a synthetic calendar is given.
async function loadPatched(calendar = null) {
  const dir = mkdtempSync(join(tmpdir(), "zenith-pcompany-"));
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    let code = readFileSync(new URL(f, SRC), "utf8")
      .replace(/from\s+"\.\/([^"]+\.json)"/g, (m, rel) => `from "${new URL(rel, SRC).href}" with { type: "json" }`);
    if (calendar && f === "calendar.generated.js") code = `export const CALENDAR_VERSION = "c-test";\nexport const CALENDAR = ${JSON.stringify(calendar)};\n`;
    writeFileSync(join(dir, f), code);
  }
  const imp = (n) => import(pathToFileURL(join(dir, n)).href);
  return { imp, worker: (await imp("index.js")).default };
}

// --- Picks from the bundled maps ------------------------------------------------------------------------
const pre = await loadWorkerModule();
const preCompany = await pre.imp("company.js");
const chPre = new Map(await Promise.all(COV.tickers.map(async (t) => [t, await preCompany.channelsFor(t)])));
const pick = (what, fn) => {
  const t = COV.tickers.find(fn);
  assert.ok(t, `no covered ticker ${what}`);
  return t;
};
// SHAPE: own and SEC channels, a counterparty key-account key that is an aux key, competitor entities.
const SHAPE = pick("with own, SEC, aux key-account channels and competitors", (t) => {
  const ch = chPre.get(t);
  return ch.own.length && ch.sec.length && ch.entities.length && ch.key_accounts.some((k) => KA.has(COV.counterparty[k]?.role) && AUX.sources[k]);
});
// OTHER: a second covered name (its items can be graded for SHAPE: "also graded").
const OTHER = pick("other than the first", (t) => t !== SHAPE);
// EMPTY: a covered name with no synthetic calendar entry (only SHAPE gets them).
const EMPTY = pick("for the empty page", (t) => t !== SHAPE);

const PAYLOADS = ["<img src=x onerror=alert(1)>", `"><meta http-equiv=refresh content='0;url=https://evil.example/?`, "javascript:alert(1)",
  " JaVaScRiPt:alert(1)", "data:text/html,x"];
const { etParts, addDays } = await pre.imp("et.js");
const today = etParts(NOW).date;
const CAL = [
  { ticker: SHAPE, kind: "catalyst", start: addDays(today, 3), end: addDays(today, 3), precision: "day", text: "Synthetic product day" },
  ...PAYLOADS.map((p, i) => ({ ticker: SHAPE, kind: "catalyst", start: addDays(today, 5 + i), end: addDays(today, 5 + i), precision: "day", text: p, url: p })),
];
const { imp, worker } = await loadPatched(CAL);
const portalMod = await imp("portal.js");
const view = await imp("portal-company.js");
const company = await imp("company.js");
const html = await imp("portal-html.js");
const mobile = await imp("mobile.js");
const auth = await imp("portal-auth.js");
const { MUTED_SQL } = await imp("tuning.js");
const ch = await company.channelsFor(SHAPE);
const OWN = ch.own[0];
const SEC = ch.sec[0];
const KA_KEY = ch.key_accounts.find((k) => KA.has(COV.counterparty[k]?.role) && AUX.sources[k]);

// --- Fixtures ---------------------------------------------------------------------------------------------
let nm = 800_000;
async function addAux(db, over = {}, grade = {}) {
  const i = { nm_rowid: nm++, source_key: "test_aux", entity_key: "test_entity", entity_name: "Test Co", status: "public", url: `https://example.com/a/${nm}`,
    title: "Aux title", published: null, nm_first_seen: ago(1), ingested_at: ago(1), state: "graded", coverage_subject: 0, affects: null, ...over };
  const r = await db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at,
      state, coverage_subject, affects) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(i.nm_rowid, i.source_key, i.entity_key, i.entity_name, i.status, i.url, i.title, i.published, i.nm_first_seen, i.ingested_at, i.state,
      i.coverage_subject, i.affects).run();
  const id = r.meta.last_row_id;
  const g = { score: 60, band: "borderline", why: "why", event_type: null, ...grade };
  const gr = await db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, why, event_type, reads_through, flags, dup_of, graded_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, '[]', '[]', NULL, ?)`).bind(id, `run-a${id}`, i.entity_name, g.score, g.band, g.why, g.event_type, ago(1)).run();
  await db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").bind(gr.meta.last_row_id, id).run();
  return id;
}
async function graded(db, T, over = {}, g = {}) {
  const id = await addItem(db, { ticker: T, nm_first_seen: ago(1), published: ago(1), ...over });
  await addGrade(db, id, { score: 60, ...g });
  return id;
}
const SERIES_SQL = `CREATE TABLE series_points (series TEXT NOT NULL, subject TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL,
  source_key TEXT NOT NULL, ticker TEXT, label TEXT, record_url TEXT, record_id TEXT, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (series, subject, period))`;
const STATE_SQL = `CREATE TABLE source_state (key TEXT PRIMARY KEY, last_polled TEXT, last_ok TEXT, last_attempt TEXT, next_poll_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT)`;
function newsDb() {
  const n = new D1({ migrations: false });
  for (const sql of [STATE_SQL, OPS_ALERTS_SQL, MANAGED_HEALTH_SQL, SERIES_SQL]) n.exec(sql);
  return n;
}
async function allOk(news, T, over = {}) {
  const c = await company.channelsFor(T);
  for (const k of [...c.own, ...c.sec, ...c.registers, ...c.rivals, ...c.key_accounts]) {
    const s = { last_ok: ago(1 / 24), fail_count: 0, last_error: null, next_poll_at: iso(NOW + 30 * 60_000), ...(over[k] || {}) };
    news.db.prepare("INSERT INTO source_state (key, last_ok, fail_count, last_error, next_poll_at) VALUES (?, ?, ?, ?, ?)")
      .run(k, s.last_ok, s.fail_count, s.last_error, s.next_poll_at);
  }
}
const addPoint = (news, p) => news.db.prepare(`INSERT INTO series_points (series, subject, period, value, source_key, ticker, label, record_url, observed_at, updated_at)
  VALUES (?, ?, ?, ?, 'test_series_src', ?, ?, ?, ?, ?)`).run(p.series ?? "test_series", p.subject, p.period, p.value, p.ticker ?? null, p.label ?? null,
  p.record_url ?? null, ago(1), ago(1));

// Opens a page through the Worker with a session cookie.
async function open(env, path, opts = {}) {
  const cookie = await sessionCookie(env);
  return pfetch(worker, env, path, { cookie, ...opts });
}
const page = (T, q = "") => `/p/c/${encodeURIComponent(T)}${q}`;
const main = (text) => /<main>(.*)<\/main>/s.exec(text)[1];
const sectionsOf = (text) => [...main(text).matchAll(/<section id="([a-z_]+)"[^>]*><h2>([^<]*)<\/h2>(.*?)<\/section>/gs)].map((m) => ({ id: m[1], head: m[2], body: m[3] }));
const sectionBody = (text, id) => sectionsOf(text).find((s) => s.id === id)?.body ?? null;
const cards = (fragment) => [...String(fragment || "").matchAll(/<article class="card( aux)?" id="([ai])(\d+)"/g)].map((m) => `${m[2]}${m[3]}`);
const esc = (s) => html.esc(s);

// --- The view contract ----------------------------------------------------------------------------------------

test("view contract: fails closed with no statement, 404 for a malformed path, and reads only SELECTs", async () => {
  const throwing = { prepare() { throw new Error("no read expected"); }, batch() { throw new Error("no read expected"); } };
  for (const a of [undefined, null, { ok: false }, { ok: "true" }]) {
    const out = await view.companyView({ env: { DB: throwing, NEWS: throwing }, url: new URL(`${ORIGIN}${page(SHAPE)}`), auth: a, tickers: COV.tickers, now: NOW });
    assert.equal(out.status, 403);
    assert.doesNotMatch(String(out.body), new RegExp(SHAPE.replace(".", "\\.")));
  }
  const nf = await view.companyView({ env: { DB: throwing }, url: new URL(`${ORIGIN}/p/c/x/y`), auth: { ok: true }, tickers: COV.tickers, now: NOW });
  assert.equal(nf.status, 404);
  // Read-only: proxies that throw on any statement not starting SELECT or WITH.
  const ro = (db) => ({
    prepare(sql) { assert.match(sql, /^\s*(SELECT|WITH)\b/i, sql); return db.prepare(sql); },
    batch(stmts) { return db.batch(stmts); },
  });
  const db = new D1();
  await graded(db, SHAPE, { source_key: OWN, title: "Release" });
  const news = newsDb();
  await allOk(news, SHAPE);
  const out = await view.companyView({ env: { DB: ro(db), NEWS: ro(news) }, url: new URL(`${ORIGIN}${page(SHAPE)}`), auth: { ok: true }, tickers: COV.tickers,
    muted: MUTED_SQL, now: NOW });
  assert.equal(out.status, undefined);
  assert.equal(out.title, SHAPE);
  assert.equal(out.active, "companies");
});

test("a listed ticker company.js does not cover shows a fixed line and reads no item; an unlisted one is the router's 404", async () => {
  const env = sessionEnv();
  const spy = spyDb(env.DB);
  const cookie = await sessionCookie(env);
  const call = (path, tickers) => portalMod.portal(new Request(`${ORIGIN}${path}`, { headers: { cookie } }), { ...env, DB: spy }, new URL(`${ORIGIN}${path}`),
    { tickers, muted: MUTED_SQL, feedback: () => null });
  const r = await call("/p/c/TST", ["TST"]);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /No company data for TST\./);
  assert.deepEqual(spy.seen.filter((s) => /\b(items|aux_items|grades)\b/.test(s)), []);
  assert.equal((await call(page(SHAPE), ["TST"])).status, 404);
  assert.equal((await call("/p/c/tst", ["TST"])).status, 404);
});

// --- T1b ----------------------------------------------------------------------------------------------------

test("T1b: the page's gate: only a valid session (session mode) or a valid Access JWT (Access mode) gets the page", async () => {
  const KEY = await keyPair("kid-company");
  const OTHER_KEY = await keyPair("kid-company-other");
  const seed = async (env) => graded(env.DB, SHAPE, { source_key: OWN, title: SENTINEL });
  const noData = (r, label) => {
    const body = stripNonce(r.text, r.headers);
    assert.ok(!body.includes(SENTINEL), `${label}: sentinel leaked`);
    assert.ok(!/<article/.test(body), `${label}: a card`);
    assert.equal(r.headers.get("set-cookie"), null, `${label}: no cookie`);
  };
  const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Session mode.
  const env = sessionEnv();
  await seed(env);
  const now = Date.now();
  const valid = await sessionCookie(env, now);
  const [, exp, sig] = valid.split("=")[1].split(".");
  const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  const far = Math.floor(now / 1000) + 40 * 86_400;
  const { createHmac } = await import("node:crypto");
  const k = createHmac("sha256", APP).update("zenith-portal-session-v1.0").digest();
  const tooLong = `__Host-zp=v1.${far}.${b64url(createHmac("sha256", k).update(`v1.${far}`).digest())}`;
  const goodJwt = await signJwt(KEY, goodClaims(now));
  const sessionCases = [
    ["no credentials", {}],
    ["forged signature", { cookie: `__Host-zp=v1.${exp}.${flipped}` }],
    ["expired", { cookie: await sessionCookie(env, now - 31 * 86_400_000) }],
    ["exp more than 31 days ahead", { cookie: tooLong }],
    ["token in the query", { path: page(SHAPE, `?token=${APP}`) }],
    ["bearer", { headers: { authorization: `Bearer ${APP}` } }],
    ["email header only", { headers: { "cf-access-authenticated-user-email": EMAIL } }],
    ["a.b.c assertion", { jwt: "a.b.c" }],
    ["CF_Authorization cookie", { cookie: `CF_Authorization=${goodJwt}` }],
  ];
  for (const [label, { path = page(SHAPE), ...opts }] of sessionCases) {
    const r = await pfetch(worker, env, path, opts);
    assert.equal(r.status, 303, label);
    assert.equal(r.headers.get("location"), "/p/login", label);
    noData(r, label);
  }
  const ok = await pfetch(worker, env, page(SHAPE, `?token=${APP}`), { cookie: valid });
  assert.equal(ok.status, 200, "a valid session; the token in the query is ignored");
  assert.ok(ok.text.includes(SENTINEL));

  // Access mode.
  mobile.clearJwksCache();
  auth.clearNegativeCache();
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const aenv = accessEnv();
    await seed(aenv);
    const t = Date.now();
    const accessCases = [
      ["no credentials", {}],
      ["valid session cookie", { cookie: await sessionCookie(sessionEnv(), t) }],
      ["unknown kid", { jwt: await signJwt(OTHER_KEY, goodClaims(t)) }],
      ["wrong aud", { jwt: await signJwt(KEY, goodClaims(t, { aud: ["other-aud"] })) }],
      ["wrong iss", { jwt: await signJwt(KEY, goodClaims(t, { iss: "https://example-team-other.cloudflareaccess.com" })) }],
      ["expired", { jwt: await signJwt(KEY, goodClaims(t, { exp: Math.floor(t / 1000) - 600 })) }],
      ["CF_Authorization cookie only", { cookie: `CF_Authorization=${await signJwt(KEY, goodClaims(t))}` }],
      ["a.b.c assertion", { jwt: "a.b.c" }],
      ["email header only", { headers: { "cf-access-authenticated-user-email": EMAIL } }],
    ];
    for (const [label, opts] of accessCases) {
      const r = await pfetch(worker, aenv, page(SHAPE), opts);
      assert.equal(r.status, 403, label);
      noData(r, label);
    }
    const good = await pfetch(worker, aenv, page(SHAPE, `?token=${APP}`), { jwt: await signJwt(KEY, goodClaims(t)) });
    assert.equal(good.status, 200);
    assert.ok(good.text.includes(SENTINEL));
  });
});

// --- T18 ----------------------------------------------------------------------------------------------------

async function payloadEnv(p) {
  const env = sessionEnv();
  const db = env.DB;
  const entity = ch.entities[0];
  // Q1: own, filing and a rival row whose source key is the payload.
  await graded(db, SHAPE, { source_key: OWN, title: p, url: p }, { why: p, event_type: p, note_hook: p });
  await graded(db, SHAPE, { source_key: SEC, title: `10-Q ${p}`, url: p }, { why: p });
  await graded(db, SHAPE, { source_key: p, role: "rival", title: p, url: p }, { why: p, event_type: p });
  // Q2: an aux row of a key-account channel; Q2e: a competitor entity's row from a payload source and a managed source.
  await addAux(db, { source_key: KA_KEY, entity_key: AUX.sources[KA_KEY].entity, entity_name: p, title: p, url: p }, { why: p, event_type: p });
  await addAux(db, { source_key: p, entity_key: entity, entity_name: p, title: p, url: p }, { why: p });
  await addAux(db, { source_key: "managed_test_news", entity_key: entity, entity_name: p, title: p, url: p }, { why: p });
  // Q3: another name's item graded for SHAPE in the primary grade's run.
  const o = await graded(db, OTHER, { title: p, url: p }, { run_id: "run-1" });
  await addGrade(db, o, { ticker: SHAPE, run_id: "run-1", score: 70, why: p, event_type: p });
  // Q4, Q4m, Q6.
  const news = newsDb();
  await allOk(news, SHAPE, { [OWN]: { fail_count: 3, last_ok: ago(2), last_error: p } });
  news.db.prepare("INSERT INTO source_state (key, last_ok, fail_count, last_error, next_poll_at) VALUES (?, ?, 4, ?, ?)").run(p, ago(2), p, iso(NOW + 60_000));
  news.db.prepare("INSERT INTO ops_alerts (source_key, rule, opened_at) VALUES (?, ?, ?)").run(OWN, p, ago(1));
  news.db.prepare("INSERT INTO universe_managed_health (key, last_ok, fail_count, last_error, next_poll_at) VALUES ('managed_test_news', ?, 5, ?, ?)")
    .run(ago(2), p, iso(NOW + 60_000));
  addPoint(news, { series: p, subject: p, period: addDays(today, -10), value: 4, ticker: SHAPE, label: p, record_url: p });
  addPoint(news, { series: p, subject: p, period: addDays(today, -40), value: 2, ticker: SHAPE, label: p, record_url: p });
  addPoint(news, { series: p, subject: "_total", period: addDays(today, -10), value: 9, label: p, record_url: p });
  return { ...env, NEWS: news };
}

test("T18: every rendered field is escaped; no data makes markup, a meta tag or a non-http(s) link", async () => {
  const baseline = await open(sessionEnv(), page(EMPTY));
  const metas = (t) => (t.match(/<meta\b/g) || []).length;
  assert.ok(metas(baseline.text) > 0);
  for (const p of PAYLOADS) {
    const env = await payloadEnv(p);
    const r = await open(env, page(SHAPE));
    assert.equal(r.status, 200, p);
    const text = stripNonce(r.text, r.headers);
    assert.equal(metas(text), metas(baseline.text), `${p}: only the document's own meta tags`);
    assert.doesNotMatch(text, /<img|<meta http-equiv/i, p);
    assert.doesNotMatch(text, /<[^>]*\son[a-z]+\s*=/i, `${p}: an inline handler`);
    assert.equal((text.match(/<script\b/g) || []).length, 1, p);
    for (const [, href] of text.matchAll(/\shref="([^"]*)"/g)) assert.match(href, /^(https:\/\/|http:\/\/|\/)/, `${p}: href ${href}`);
    for (const [, a] of text.matchAll(/\saction="([^"]*)"/g)) assert.match(a, /^\//, `${p}: action ${a}`);
    assert.doesNotMatch(text, /href="\s*(javascript|data):/i, p);
    // The payload reached the page as text: cards, quiet line, health, series, calendar.
    const n = text.split(esc(p)).length - 1;
    assert.ok(n >= 15, `${p}: rendered ${n} times`);
    const m = main(text);
    for (const id of ["own", "filings", "rivals", "key_accounts", "series", "calendar", "source_health"]) assert.ok(sectionBody(text, id).includes(esc(p.trim())), `${p}: ${id}`);
    assert.ok(/<p class="quiet"[^>]*>[^<]*<\/p>/.test(m), `${p}: the quiet line is text only`);
  }
  const code = readFileSync(new URL("portal-company.js", SRC), "utf8");
  assert.doesNotMatch(code, /\braw\(/, "portal-company.js never calls raw(");
  assert.doesNotMatch(code, /innerHTML|<script|<style|\son[a-z]+=/i);
});

// --- T19 ----------------------------------------------------------------------------------------------------

test("T19: nine sections in the audit's order, each with its empty text on an empty database", async () => {
  const e = await company.channelsFor(EMPTY);
  const T = EMPTY;
  const r = await open(sessionEnv(), page(T));
  assert.equal(r.status, 200);
  const secs = sectionsOf(r.text);
  assert.deepEqual(secs.map((s) => s.id), company.SECTIONS);
  assert.deepEqual(company.SECTIONS, ["own", "filings", "ownership", "registers", "series", "rivals", "key_accounts", "calendar", "source_health"]);
  for (const s of secs) assert.ok(s.head.startsWith(view.SECTION_TITLES[s.id]), s.head);
  assert.deepEqual(secs.map((s) => s.head.replace(/ \(\d+\)$/, "")),
    ["Own items", "Filings", "Ownership", "Registers", "Series", "Rivals", "Key accounts", "Calendar", "Source health"]);
  const body = (id) => sectionBody(r.text, id);
  const pl = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const days = 30;
  assert.ok(body("own").includes(esc(`No release, deck, event or newsroom post from ${T}'s own channels in the last ${days} days (${pl(e.own.length, "own channel")} checked).`)));
  assert.ok(body("filings").includes(e.sec.length ? `No SEC filing for ${T} in the last ${days} days.` : `${T} has no SEC channel.`));
  assert.ok(body("ownership").includes(`No ownership filing stored for ${T} in the last ${days} days. Zenith keeps only open-market Form 4 buys at small caps and 13D filings; the full strip (Forms 3, 4, 5, 144, 13G, D) waits on decision 3.`));
  assert.ok(body("registers").includes(e.registers.length
    ? `No register record (contracts, council items, federal notices) for ${T} in the last ${days} days; ${pl(e.registers.length, "register source")} checked.`
    : `No register source follows ${T} yet.`));
  assert.ok(body("series").includes(`No number series for ${T}. Series come from registers such as the Texas DMV automated-vehicle report.`));
  assert.ok(body("rivals").includes(`No rival news shown for ${T} in the last ${days} days (${pl(e.rivals.length, "rival source")} checked; 0 stored headlines left out).`));
  assert.ok(body("key_accounts").includes(`No key-account news shown for ${T} in the last ${days} days (${pl(e.key_accounts.length, "source")} checked).`));
  const { fmtDay } = await imp("et.js");
  assert.ok(body("calendar").includes(`No dated catalyst for ${T} between ${fmtDay(addDays(today, -days))} and ${fmtDay(addDays(today, 30))}.`));
  assert.ok(body("source_health").includes("Source health unavailable; channels not confirmed."), "no NEWS binding");
  assert.match(r.text, /Source health unavailable; channels not confirmed\./);
  assert.doesNotMatch(main(r.text), /Show all/);
  // With news-monitor-db bound and nothing in it, every channel is "never polled" (source health is never empty).
  const withNews = await open({ ...sessionEnv(), NEWS: newsDb() }, page(T));
  const h = sectionBody(withNews.text, "source_health");
  const all = [...e.own, ...e.sec, ...e.registers, ...e.rivals, ...e.key_accounts];
  if (all.length) assert.match(h, /never polled/);
  assert.match(sectionBody(withNews.text, "source_health"), /<p class="meta">/);
});

test("T19: 'Show all' only above 8 rows; ?section=own renders up to 100 and says how many more are stored", async () => {
  const env = sessionEnv();
  for (let i = 0; i < 8; i++) await graded(env.DB, SHAPE, { source_key: OWN, title: `Release ${i}`, published: ago(i / 10 + 0.1) });
  let r = await open(env, page(SHAPE));
  assert.equal(cards(sectionBody(r.text, "own")).length, 8);
  assert.doesNotMatch(sectionBody(r.text, "own"), /Show all/);
  await graded(env.DB, SHAPE, { source_key: OWN, title: "Release 8", published: ago(2) });
  r = await open(env, page(SHAPE));
  assert.equal(cards(sectionBody(r.text, "own")).length, 8);
  assert.ok(sectionBody(r.text, "own").includes(`<a href="/p/c/${SHAPE}?section=own#own">Show all 9</a>`));
  for (let i = 9; i < 105; i++) await graded(env.DB, SHAPE, { source_key: OWN, title: `Release ${i}`, published: ago(3 + i / 100) });
  r = await open(env, page(SHAPE, "?section=own"));
  const own = sectionBody(r.text, "own");
  assert.equal(cards(own).length, 100);
  assert.match(own, /Showing the first 100 of 105\./);
  assert.ok(own.includes(`<a href="/p/c/${SHAPE}#own">Show fewer</a>`));
  // The other sections keep their cut, and the section parameter rides on the window links.
  assert.ok(r.text.includes(`href="/p/c/${SHAPE}?days=7&amp;section=own"`));
  r = await open(env, page(SHAPE, "?section=bogus"));
  assert.equal(cards(sectionBody(r.text, "own")).length, 8, "an unknown section is ignored");
});

// --- Layout: header, window, quiet line, cards ---------------------------------------------------------------

test("E27 and the header: name, window links 7/14/30, Full calendar, Search this company; days outside 1-30 fall back to 30", async () => {
  const env = sessionEnv();
  const recent = await graded(env.DB, SHAPE, { source_key: OWN, title: "Recent", published: ago(2) });
  const older = await graded(env.DB, SHAPE, { source_key: OWN, title: "Older", published: ago(10) });
  const r = await open(env, page(SHAPE));
  const m = main(r.text);
  assert.match(r.text, new RegExp(`<title>${SHAPE.replace(".", "\\.")} · Zenith</title>`));
  assert.match(r.text, /<a href="\/p\/c" aria-current="page">Companies<\/a>/);
  assert.ok(m.includes(`<a href="/p/search?ticker=${encodeURIComponent(SHAPE)}">Search this company</a>`));
  assert.ok(m.includes('<a href="/p/brief">Full calendar</a>'));
  for (const d of [7, 14]) assert.ok(m.includes(`<a href="/p/c/${SHAPE}?days=${d}">${d} days</a>`), d);
  assert.ok(m.includes(`<a href="/p/c/${SHAPE}" aria-current="true">30 days</a>`));
  assert.deepEqual(cards(sectionBody(r.text, "own")).sort(), [`i${recent}`, `i${older}`].sort());
  const week = await open(env, page(SHAPE, "?days=7"));
  assert.deepEqual(cards(sectionBody(week.text, "own")), [`i${recent}`]);
  assert.ok(main(week.text).includes(`<a href="/p/c/${SHAPE}?days=7" aria-current="true">7 days</a>`));
  for (const q of ["?days=0", "?days=31", "?days=x", "?days=1.5", "?days=%3Cx%3E"]) {
    const b = await open(env, page(SHAPE, q));
    assert.equal(b.status, 200, q);
    assert.ok(main(b.text).includes(`aria-current="true">30 days</a>`), q);
    assert.doesNotMatch(b.text, /&lt;x&gt;|<x>/, `${q}: the raw query is never echoed`);
  }
  // The filled counts the exit test reads are on the page.
  const f = /<p class="meta filled" data-filled="(\d+)" data-filled-no-reject="(\d+)" data-filled-lenient="(\d+)">/.exec(m);
  assert.ok(f);
  const d = await company.companyData(env, SHAPE, { now: NOW });
  assert.deepEqual(f.slice(1).map(Number), [d.filled_count, d.filled_excluding_reject_count, d.filled_lenient_count]);
});

test("the all-quiet line comes first; source health shows failing channels with redacted errors clipped to 80", async () => {
  const env = sessionEnv();
  let news = newsDb();
  await allOk(news, SHAPE);
  let r = await open({ ...env, NEWS: news }, page(SHAPE));
  const m = main(r.text);
  const quiet = /<p class="quiet" data-new="0">([^<]*)<\/p>/.exec(m);
  assert.ok(quiet, "the quiet line");
  assert.ok(quiet[1].startsWith(`All quiet for ${SHAPE} in the last 24 hours. Checked:`), quiet[1]);
  assert.ok(m.indexOf('<p class="quiet"') < m.indexOf("<section"), "before the sections");
  assert.match(sectionBody(r.text, "source_health"), /Every channel polled without error\./);

  const err = `html 500 https://x.example.com/a?api_key=SYNTH&page=2 ${"x".repeat(120)}`;
  news = newsDb();
  await allOk(news, SHAPE, { [OWN]: { fail_count: 3, last_ok: ago(2), last_error: err } });
  news.db.prepare("INSERT INTO ops_alerts (source_key, rule, opened_at) VALUES (?, 'outage', ?)").run(OWN, ago(1));
  await graded(env.DB, SHAPE, { source_key: OWN, title: "Fresh", nm_first_seen: ago(2 / 24) });
  r = await open({ ...env, NEWS: news }, page(SHAPE));
  assert.ok(main(r.text).includes(`New for ${SHAPE} in the last 24 hours: 1 (own 1).`));
  const h = sectionBody(r.text, "source_health");
  assert.ok(h.includes("api_key=[redacted]&amp;page=2"));
  assert.ok(!r.text.includes("SYNTH"), "the secret never reaches the page");
  assert.ok(!h.includes("x".repeat(80)), "clipped");
  const bad = /<ul class="health bad">(.*?)<\/ul>/s.exec(h)[1];
  assert.ok(bad.includes(OWN) && bad.includes("failing") && bad.includes("open alerts: outage"));
  const errs = [...bad.matchAll(/ · (html 500[^<]*?)(?: · open alerts|<\/span>)/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  assert.ok(errs.length >= 1, "the error is shown");
  for (const e of errs) assert.ok(e.length <= view.ERROR_CLIP, e);
});

test("cards: coverage rows post labels to /p/api/feedback, aux rows to /p/api/aux-feedback, returning to the page; also graded and the reference lists", async () => {
  const env = sessionEnv();
  const own = await graded(env.DB, SHAPE, { source_key: OWN, title: "Release", published: null });
  const aux = await addAux(env.DB, { source_key: KA_KEY, entity_key: AUX.sources[KA_KEY].entity, title: "Account news" });
  const o = await graded(env.DB, OTHER, { title: "Other name item" }, { run_id: "run-1" });
  await addGrade(env.DB, o, { ticker: SHAPE, run_id: "run-1", score: 70 });
  const r = await open(env, page(SHAPE, "?days=14"));
  const ownBody = sectionBody(r.text, "own");
  assert.deepEqual(cards(ownBody), [`i${own}`]);
  assert.match(ownBody, new RegExp(`<form class="lbl" method="post" action="/p/api/feedback" data-endpoint="/p/api/feedback" data-item="${own}" data-ticker="${SHAPE.replace(".", "\\.")}">`));
  assert.ok(ownBody.includes(`<input type="hidden" name="return" value="/p/c/${SHAPE}?days=14">`));
  assert.match(ownBody, /<span class="badge">undated<\/span>/);
  assert.match(ownBody, /first seen /);
  const ka = sectionBody(r.text, "key_accounts");
  assert.ok(cards(ka).includes(`a${aux}`));
  assert.match(ka, new RegExp(`<article class="card aux" id="a${aux}">`));
  assert.match(ka, new RegExp(`action="/p/api/aux-feedback" data-endpoint="/p/api/aux-feedback" data-item="${aux}">`));
  assert.ok(ka.includes(`Also graded for ${SHAPE} (1)`));
  assert.ok(cards(ka).includes(`i${o}`));
  const accts = (await company.companyData(env, SHAPE, { now: NOW })).reference;
  if (accts.key_accounts.length) assert.ok(ka.includes(`Key accounts on file (${accts.key_accounts.length})`));
  else assert.ok(ka.includes("No key accounts on file."));
  const rivals = sectionBody(r.text, "rivals");
  if (accts.competitors.length) assert.ok(rivals.includes(`<details class="ref"><summary>Competitors on file (${accts.competitors.length})</summary>`));
  assert.ok(sectionBody(r.text, "calendar").includes("Synthetic product day"));
});

// --- T24 ----------------------------------------------------------------------------------------------------

test("T24: portal headers, no CORS, no cookie from the view; POST is 405; HEAD has no body", async () => {
  const env = sessionEnv();
  await graded(env.DB, SHAPE, { source_key: OWN, title: SENTINEL });
  const r = await open(env, page(SHAPE));
  assert.equal(r.status, 200);
  for (const [h, v] of [["cache-control", "no-store"], ["x-content-type-options", "nosniff"], ["referrer-policy", "same-origin"], ["x-frame-options", "DENY"]]) {
    assert.equal(r.headers.get(h), v, h);
  }
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal(r.headers.get("set-cookie"), null);
  const post = await open(env, page(SHAPE), { method: "POST", origin: ORIGIN, form: { x: "1" } });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  assert.ok(!post.text.includes(SENTINEL));
  const head = await open(env, page(SHAPE), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
});

// --- T21 ----------------------------------------------------------------------------------------------------

test("T21: portal-company.js reaches no Discord, tuning, auxiliary, brief or index code, calls no fetch, and logs nothing", () => {
  const seen = new Set();
  const go = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) go(m[1]);
  };
  go("portal-company.js");
  assert.ok(seen.has("company.js"));
  for (const f of ["delivery.js", "discord.js", "tuning.js", "auxiliary.js", "brief.js", "index.js", "ingest.js", "excerpt.js", "budget.js"]) {
    assert.ok(!seen.has(f), `portal-company.js reaches ${f}`);
  }
  const code = readFileSync(new URL("portal-company.js", SRC), "utf8");
  assert.doesNotMatch(code, /\bfetch\(/);
  assert.doesNotMatch(code, /\bconsole\./, "the router logs view failures with a fixed label");
  assert.doesNotMatch(code, /\benv\.NEWS\b/, "only company.js reads news-monitor-db");
  // portal.js gains exactly the company line and its import.
  const portal = readFileSync(new URL("portal.js", SRC), "utf8");
  assert.match(portal, /^import \{ companyView \} from "\.\/portal-company\.js";$/m);
  assert.match(portal, /^ {2}company: companyView,$/m);
  assert.equal(portalMod.VIEWS.company, view.companyView);
});

test("the truncation note: Q2e feeds own items and registers; 'newest' only when every cut read is ordered newest first", () => {
  const note = (name, truncated) => String(view.truncatedNote(name, { truncated }));
  const NEWEST = "More rows are stored than one read returns; showing the newest.";
  const SOME = "More rows are stored than one read returns; some are not shown.";
  for (const name of ["own", "registers", "rivals"]) {
    assert.ok(note(name, { q2e: true }).includes(SOME), `${name}: q2e`);
    assert.ok(!note(name, { q2e: true }).includes("newest"), `${name}: q2e is not ordered`);
    assert.ok(note(name, { q1: true }).includes(NEWEST), `${name}: q1`);
    assert.ok(note(name, { q1: true, q2e: true }).includes(SOME), `${name}: mixed`);
  }
  assert.equal(note("filings", { q2e: true }), "", "Q2e does not feed filings");
  assert.equal(note("own", {}), "");
  assert.ok(note("source_health", { q4: true }).includes(SOME));
  assert.ok(note("key_accounts", { q3: true }).includes(NEWEST));
});

test("source health: no channel rows prints one line, never 'Every channel polled without error.'", () => {
  const h = (rows, groups = {}) => String(view.healthSection({ sections: { source_health: { rows } }, quiet: { available: true, groups } }));
  const none = h([]);
  assert.ok(none.includes("No channel follows this name."));
  assert.ok(!none.includes("Every channel polled without error."));
  const ok = h([{ key: "test_ok", status: "ok", group: "own", open_rules: [] }], { own: { keys: 1, ok: 1 } });
  assert.ok(ok.includes("Every channel polled without error."));
  assert.ok(!ok.includes("No channel follows this name."));
});
