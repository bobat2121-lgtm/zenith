// Phase 3 Part D, PR-D2: the Search view (/p/search, worker/src/portal-search.js).
// V1 no data without auth, V2 with auth, V3 the cross-site guard, V4 safe HTML and
// highlighting, V5 the form and title, V6 links, V7 the range, V8 only the view
// counter writes, V9 labels, V10 the view contract; plus parse errors, failures,
// scopes and row states. Synthetic fixtures only: the view tests inject the
// universe ["TST", "ACM"]; tests through the Worker pick a bundled ticker at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  loadWorkerModule, pfetch, sessionEnv, accessEnv, sessionCookie, spyDb, keyPair, signJwt, goodClaims, withCerts, stripNonce,
  APP, ORIGIN, EMAIL,
} from "./helpers/portal.js";
import { addCov, gradeCov, addAux, gradeAux } from "./helpers/search-fixtures.js";
import { clearNegativeCache } from "../worker/src/portal-auth.js";
import { clearJwksCache } from "../worker/src/mobile.js";

const { worker, imp } = await loadWorkerModule();
const portalMod = await imp("portal.js");
const viewMod = await imp("portal-search.js");
const { isSafeHtml } = await imp("portal-html.js");
const { MUTED_SQL } = await imp("tuning.js");
const { default: COVERED } = await import("../worker/src/covered.json", { with: { type: "json" } });
const KEY = await keyPair("kid-search");
const OTHER_KEY = await keyPair("kid-search-other");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A fixed, synthetic "now" for the view tests: a Wednesday, 12:00 ET (EDT).
const NOW = Date.parse("2026-03-18T16:00:00.000Z");
const ago = (ms, now = NOW) => new Date(now - ms).toISOString();
const SECRET = "SEARCH-SECRET-TITLE";
const TICKERS = ["TST", "ACM"];

// Prepared SQL that reads an item table.
const itemReads = (spy) => spy.seen.filter((s) => /\b(items|aux_items)\b/.test(s)).length;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const mainOf = (text) => /<main>(.*)<\/main>/s.exec(text)[1];
const cardIds = (text, kind = "i") => [...text.matchAll(new RegExp(`<article class="card(?: aux)?" id="${kind}(\\d+)"`, "g"))].map((m) => Number(m[1]));

// Opens a path through the portal router with an injected universe and clock.
async function open(env, path, { tickers = TICKERS, now = NOW, site, cookie } = {}) {
  const headers = { cookie: cookie ?? (await sessionCookie(env, now)) };
  if (site) headers["sec-fetch-site"] = site;
  const req = new Request(`${ORIGIN}${path}`, { headers });
  const res = await portalMod.portal(req, env, new URL(req.url), { tickers, muted: MUTED_SQL, feedback: () => null, auxFeedback: () => null, now: () => now });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

// --- V1 ----------------------------------------------------------------------------------
test("V1: no data and no item read without auth, in session and Access mode", async () => {
  clearJwksCache();
  clearNegativeCache();
  const T = COVERED.tickers[0];
  const seed = async (env) => addCov(env.DB, { ticker: T, source_key: "src_synthetic", title: `${SECRET} widget`, nm_first_seen: ago(HOUR, Date.now()) });

  const env = sessionEnv();
  await seed(env);
  const spy = spyDb(env.DB);
  const senv = { ...env, DB: spy };
  for (const [label, path, opts] of [
    ["no cookie", "/p/search?q=secret", {}],
    ["?token=", `/p/search?q=secret&token=${APP}`, {}],
    ["Access email header only", "/p/search?q=secret", { headers: { "cf-access-authenticated-user-email": EMAIL } }],
  ]) {
    const r = await pfetch(worker, senv, path, opts);
    assert.equal(r.status, 303, label);
    assert.equal(r.headers.get("location"), "/p/login", label);
    assert.ok(!r.text.includes(SECRET), label);
  }

  await withCerts({ keys: [KEY.jwk] }, async () => {
    const aenv0 = accessEnv();
    await seed(aenv0);
    const aspy = spyDb(aenv0.DB);
    const aenv = { ...aenv0, DB: aspy };
    const now = Date.now();
    for (const [label, opts] of [
      ["key not in the JWKS", { jwt: await signJwt(OTHER_KEY, goodClaims(now)) }],
      ["wrong aud", { jwt: await signJwt(KEY, goodClaims(now, { aud: ["other-aud"] })) }],
      ["wrong iss", { jwt: await signJwt(KEY, goodClaims(now, { iss: "https://issuer.example.com" })) }],
      ["expired", { jwt: await signJwt(KEY, goodClaims(now, { exp: Math.floor(now / 1000) - 600 })) }],
      ["session cookie, no JWT", { cookie: await sessionCookie(aenv0, now) }],
    ]) {
      const r = await pfetch(worker, aenv, "/p/search?q=secret", opts);
      assert.equal(r.status, 403, label);
      assert.ok(!stripNonce(r.text, r.headers).includes(SECRET), label);
    }
    assert.equal(itemReads(aspy), 0, "Access mode: no item read");
  });
  assert.equal(itemReads(spy), 0, "session mode: no item read");
  clearNegativeCache();
});

// --- V2 ----------------------------------------------------------------------------------
test("V2: a valid session cookie or Access JWT gets the results, through the Worker", async () => {
  clearJwksCache();
  const T = COVERED.tickers[0];
  const env = sessionEnv();
  await addCov(env.DB, { ticker: T, source_key: "src_synthetic", title: `${SECRET} widget`, nm_first_seen: ago(HOUR, Date.now()) });
  const r = await pfetch(worker, env, "/p/search?q=secret", { cookie: await sessionCookie(env) });
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(SECRET));
  assert.match(r.text, /<a href="\/p\/search" aria-current="page">Search<\/a>/);
  assert.equal(r.headers.get("cache-control"), "no-store");

  await withCerts({ keys: [KEY.jwk] }, async () => {
    const aenv = accessEnv();
    await addCov(aenv.DB, { ticker: T, source_key: "src_synthetic", title: `${SECRET} widget`, nm_first_seen: ago(HOUR, Date.now()) });
    const a = await pfetch(worker, aenv, "/p/search?q=secret", { jwt: await signJwt(KEY, goodClaims()) });
    assert.equal(a.status, 200);
    assert.ok(a.text.includes(SECRET));
  });
});

// --- V3 ----------------------------------------------------------------------------------
test("V3: the cross-site guard: cross-site and same-site get the prefilled form and no read; none, same-origin and absent search", async () => {
  const base = sessionEnv();
  await addCov(base.DB, { title: `${SECRET} widget`, nm_first_seen: ago(HOUR) });
  for (const site of ["cross-site", "same-site", "CROSS-SITE"]) {
    const spy = spyDb(base.DB);
    const r = await open({ ...base, DB: spy }, "/p/search?q=secret", { site });
    assert.equal(r.status, 200, site);
    assert.match(r.text, /<input type="search" name="q" value="secret"/, site);
    assert.match(r.text, /Press Search to run this search\./, site);
    assert.ok(!r.text.includes(SECRET), site);
    assert.equal(itemReads(spy), 0, site);
  }
  for (const site of ["none", "same-origin", undefined]) {
    const spy = spyDb(base.DB);
    const r = await open({ ...base, DB: spy }, "/p/search?q=secret", { site });
    assert.equal(r.status, 200, String(site));
    assert.ok(r.text.includes(SECRET), String(site));
    assert.ok(itemReads(spy) >= 1, String(site));
  }
});

// --- V4 ----------------------------------------------------------------------------------
test("V4: hostile titles and q are escaped, scripts are the shell's only, links are safe, highlighting never splits an entity", async () => {
  const env = sessionEnv();
  await addCov(env.DB, { title: `"><script>alert(1)</script> widget`, url: "javascript:alert(1)", nm_first_seen: ago(HOUR) });
  await addCov(env.DB, { title: "Widget at example", url: "https://example.com/w?a=1&b=2", nm_first_seen: ago(HOUR) });
  const r = await open(env, "/p/search?q=widget");
  assert.equal(r.status, 200);
  const body = stripNonce(r.text, r.headers);
  assert.doesNotMatch(body, /<script>alert/);
  assert.match(body, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; widget/);
  assert.equal((body.match(/<script/g) || []).length, (body.match(/<script nonce="/g) || []).length, "every script is the shell's nonce'd one");
  assert.doesNotMatch(body, /href="javascript:/i);
  const blank = [...body.matchAll(/<a [^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
  assert.ok(blank.length >= 1);
  for (const a of blank) {
    assert.match(a, /rel="noopener noreferrer"/);
    assert.match(a, /href="https?:\/\//);
  }

  const hq = await open(env, `/p/search?q=${encodeURIComponent('"><img src=x>')}`);
  assert.equal(hq.status, 200);
  assert.doesNotMatch(hq.text, /<img/);
  assert.match(hq.text, /value="&quot;&gt;&lt;img src=x&gt;"/);

  const amp = sessionEnv();
  await addAux(amp.DB, { title: "Plain title", excerpt: "A & B amplifier", nm_first_seen: ago(HOUR) });
  const a = await open(amp, "/p/search?q=amp");
  const snip = /<p class="meta snip">(.*?)<\/p>/s.exec(a.text)[1];
  assert.equal(snip, "Matched in the fetched text: A &amp; B <mark>amp</mark>lifier");
  assert.equal(unescape(snip.replace(/<\/?mark>/g, "")), "Matched in the fetched text: A & B amplifier");
  assert.doesNotMatch(a.text, /&<mark>|&a<mark>/);

  const apos = sessionEnv();
  await addCov(apos.DB, { title: "Plain title", excerpt: "It's 39 widgets", nm_first_seen: ago(HOUR) });
  const t = await open(apos, "/p/search?q=39");
  assert.match(t.text, /It&#39;s <mark>39<\/mark> widgets/);
  assert.doesNotMatch(t.text, /&#<mark>39<\/mark>;/);
  for (const text of [a.text, t.text]) assert.doesNotMatch(text, /="[^"]*<mark>/, "no mark inside an attribute");
});

// --- V5 ----------------------------------------------------------------------------------
test("V5: the form, the constant title, and an empty q that runs nothing", async () => {
  const env = sessionEnv();
  await addCov(env.DB, { title: "Widget UNIQUEQXYZ", nm_first_seen: ago(HOUR) });
  const r = await open(env, "/p/search?q=UNIQUEQXYZ");
  assert.match(r.text, /<form method="get" action="\/p\/search" class="dates" role="search">/);
  assert.match(r.text, /<input type="search" name="q" value="UNIQUEQXYZ" maxlength="120" autocomplete="off"/);
  assert.match(r.text, /<title>Search · Zenith<\/title>/);
  assert.doesNotMatch(/<title>.*?<\/title>/s.exec(r.text)[0], /UNIQUEQXYZ/);
  assert.match(r.text, /<h1>Search<\/h1>/);
  assert.match(r.text, /<h2>Results for “UNIQUEQXYZ”<\/h2>/);
  assert.match(r.text, /the first 2,500 characters of fetched text/);

  for (const path of ["/p/search", "/p/search?q=", "/p/search?q=%20%20"]) {
    const spy = spyDb(env.DB);
    const e = await open({ ...env, DB: spy }, path);
    assert.equal(e.status, 200, path);
    assert.match(e.text, /<input type="search" name="q" value=""/, path);
    assert.doesNotMatch(e.text, /<article/, path);
    assert.equal(itemReads(spy), 0, path);
    assert.equal(spy.seen.length, 1, `${path}: only the view counter`);
  }
});

// --- V6 ----------------------------------------------------------------------------------
test("V6: every link carries q exactly, and source only when the link sets it", async () => {
  const q = "a&source=x#y";
  const env = sessionEnv();
  for (let k = 0; k < 3; k++) await addCov(env.DB, { title: `Synthetic ${q} ${k}`, nm_first_seen: ago(HOUR + k * 1000) });
  const r = await open(env, `/p/search?${new URLSearchParams({ q, sort: "newest", limit: "1" })}`);
  assert.equal(r.status, 200);
  assert.equal(cardIds(r.text).length, 1);
  const hrefs = [...mainOf(r.text).matchAll(/href="(\/p\/search[^"]*)"/g)].map((m) => unescape(m[1]));
  assert.ok(hrefs.length >= 5, "the range presets and Next");
  for (const h of hrefs) {
    const u = new URL(h, ORIGIN);
    assert.equal(u.searchParams.get("q"), q, h);
    assert.equal(u.searchParams.has("source"), false, h);
    assert.equal(u.hash, "", h);
  }
  const next = /<a href="([^"]+)" rel="next">Next<\/a>/.exec(r.text);
  assert.ok(next, "a Next link under newest");
  const nu = new URL(unescape(next[1]), ORIGIN);
  assert.match(nu.searchParams.get("cc"), /~\d+$/);
  assert.equal(nu.searchParams.get("sort"), "newest");
  // Following Next shows the next row, then the last page has no Next.
  const p2 = await open(env, `${nu.pathname}${nu.search}`);
  assert.equal(cardIds(p2.text).length, 1);
  assert.notDeepEqual(cardIds(p2.text), cardIds(r.text));
  // The label forms return to the same search.
  const ret = /<input type="hidden" name="return" value="([^"]+)">/.exec(r.text)[1];
  assert.equal(new URL(unescape(ret), ORIGIN).searchParams.get("q"), q);

  // The names block (synthetic result): a name and a source link to a scoped search for q.
  const block = String(viewMod.namesBlock({ q, companies: [{ ticker: "TST", name: "Test Robotics" }], names: [{ entity_key: "widgetco", name: "Widgetco" }], sources: ["tst_ir"] }));
  const links = [...block.matchAll(/href="([^"]+)"/g)].map((m) => new URL(unescape(m[1]), ORIGIN));
  assert.deepEqual(links.map((u) => u.pathname), ["/p/c/TST", "/p/search", "/p/search"]);
  assert.equal(links[1].searchParams.get("q"), q);
  assert.equal(links[1].searchParams.get("entity"), "widgetco");
  assert.equal(links[1].searchParams.has("source"), false);
  assert.equal(links[2].searchParams.get("q"), q);
  assert.equal(links[2].searchParams.get("source"), "tst_ir");
  assert.equal(String(viewMod.namesBlock({ q, companies: [], names: [], sources: [] })), "");
});

// --- V7 ----------------------------------------------------------------------------------
test("V7: the range: the preset is marked, custom dates echo, a long unscoped span falls back with a line", async () => {
  const env = sessionEnv();
  await addCov(env.DB, { title: "Widget", nm_first_seen: ago(5 * DAY) });
  const week = await open(env, "/p/search?q=widget&range=7d");
  assert.match(week.text, /href="\/p\/search\?q=widget&amp;range=7d" aria-current="true"/);
  assert.match(week.text, /<input type="hidden" name="range" value="7d">/, "the search form keeps the range");
  assert.match(week.text, /Seen in the last 7 days/);
  assert.match(week.text, /range=90d/);
  assert.doesNotMatch(week.text, /range=1y/, "unscoped searches offer up to 90 days");
  assert.equal(cardIds(week.text).length, 1);

  const custom = await open(env, "/p/search?q=widget&start=2026-03-10&end=2026-03-17");
  assert.match(custom.text, /name="start" value="2026-03-10"/);
  assert.match(custom.text, /name="end" value="2026-03-17"/);
  assert.match(custom.text, /<details open>/);

  const long = await open(env, "/p/search?q=widget&start=2025-11-19&end=2026-03-17");
  assert.match(long.text, /Searches without a company, name or source are limited to 90 days; showing the last 30 days\./);
  const scoped = await open(env, "/p/search?q=widget&ticker=TST&start=2025-11-19&end=2026-03-17");
  assert.doesNotMatch(scoped.text, /limited to/);
  assert.match(scoped.text, /name="start" value="2025-11-19"/);
  assert.match(scoped.text, /range=1y/, "scoped searches offer up to 400 days");
  const bogus = await open(env, "/p/search?q=widget&range=bogus");
  assert.match(bogus.text, /That date range could not be used; showing the last 30 days\./);
});

// --- V8 ----------------------------------------------------------------------------------
test("V8: one rendered search writes exactly one portal_views upsert and nothing else", async () => {
  const env = sessionEnv();
  await addCov(env.DB, { title: "Widget", nm_first_seen: ago(HOUR) });
  await addAux(env.DB, { title: "Widget aux", nm_first_seen: ago(HOUR) });
  const changes = () => env.DB.db.prepare("SELECT total_changes() AS n").get().n;
  const views = () => env.DB.db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM portal_views WHERE view = 'search'").get().n;
  const c0 = changes(), v0 = views();
  const r = await open(env, "/p/search?q=widget");
  assert.equal(r.status, 200);
  assert.equal(views(), v0 + 1);
  assert.equal(changes(), c0 + 1);
  const r2 = await open(env, "/p/search?q=widget&sort=newest");
  assert.equal(r2.status, 200);
  assert.equal(views(), v0 + 2);
  assert.equal(changes(), c0 + 2);
  // A refused (400) search writes nothing.
  const bad = await open(env, "/p/search?q=x");
  assert.equal(bad.status, 400);
  assert.equal(changes(), c0 + 2);
});

// --- V9 ----------------------------------------------------------------------------------
test("V9: coverage cards post to /p/api/feedback, aux cards to /p/api/aux-feedback; a labelled row shows its label", async () => {
  const env = sessionEnv();
  const cov = await addCov(env.DB, { title: "Widget coverage", nm_first_seen: ago(HOUR) });
  await gradeCov(env.DB, cov, { score: 75 });
  const aux = await addAux(env.DB, { title: "Widget aux", nm_first_seen: ago(HOUR) });
  await gradeAux(env.DB, aux, { score: 72 });
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'TST', ?)").run(cov, ago(60_000));
  env.DB.db.prepare("INSERT INTO aux_feedback (item_id, label, created_at) VALUES (?, 'noise', ?)").run(aux, ago(60_000));
  const r = await open(env, "/p/search?q=widget");
  const cardOf = (kind, id) => new RegExp(`<article class="card${kind === "a" ? " aux" : ""}" id="${kind}${id}">(.*?)</article>`, "s").exec(r.text)[1];
  const c = cardOf("i", cov), a = cardOf("a", aux);
  assert.match(c, /<form class="lbl" method="post" action="\/p\/api\/feedback"/);
  assert.match(c, /data-ticker="TST"/);
  assert.match(c, /Labelled high/);
  assert.match(a, /<form class="lbl" method="post" action="\/p\/api\/aux-feedback"/);
  assert.match(a, /Labelled noise/);
  assert.match(c, /<input type="hidden" name="return" value="\/p\/search\?q=widget">/);
});

// --- V10 ---------------------------------------------------------------------------------
test("V10: the view contract: fails closed, returns { title, active, body } with SafeHtml and no headers; no raw( in the file", async () => {
  const env = sessionEnv();
  const spy = spyDb(env.DB);
  const url = new URL(`${ORIGIN}/p/search?q=widget`);
  for (const auth of [undefined, { ok: false }, { ok: "true" }]) {
    const out = await viewMod.searchView({ env: { ...env, DB: spy }, url, request: new Request(url), auth, tickers: TICKERS, now: NOW });
    assert.equal(out.status, 403);
    assert.ok(!("headers" in out));
  }
  assert.equal(spy.seen.length, 0, "no statement without auth");
  const out = await viewMod.searchView({ env, url, request: new Request(url), auth: { ok: true }, tickers: TICKERS, muted: MUTED_SQL, now: NOW });
  assert.equal(out.title, "Search");
  assert.equal(out.active, "search");
  assert.ok(isSafeHtml(out.body));
  assert.ok(!("headers" in out));
  assert.equal(out.status, undefined);
  assert.equal(portalMod.VIEWS.search, viewMod.searchView);
  const code = readFileSync(new URL("../worker/src/portal-search.js", import.meta.url), "utf8");
  assert.doesNotMatch(code, /(?<![\w.])raw\(/);
  assert.doesNotMatch(code, /console\.log/);
});

// --- Errors, scopes and row states ---------------------------------------------------------
test("a parse error is a 400 with the form; a failing database is a 500 that logs no query text", async () => {
  const env = sessionEnv();
  const bad = await open(env, "/p/search?q=widget&ticker=ZZZQ");
  assert.equal(bad.status, 400);
  assert.match(bad.text, /<p role="alert">ticker must be a covered ticker\.<\/p>/);
  assert.match(bad.text, /name="q" value="widget"/);

  const failing = { ...env, DB: { prepare(sql) { if (/portal_views/.test(sql)) return env.DB.prepare(sql); throw new Error("boom PRIVATE-QUERY-XYZ"); }, batch: () => { throw new Error("boom"); } } };
  const logged = [];
  const saved = { error: console.error, warn: console.warn, log: console.log };
  console.error = (...a) => logged.push(a);
  console.warn = (...a) => logged.push(a);
  console.log = (...a) => logged.push(a);
  let r;
  try {
    r = await open(failing, "/p/search?q=PRIVATE-QUERY-XYZ");
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(r.status, 500);
  assert.match(r.text, /Search failed/);
  assert.doesNotMatch(r.text, /boom/);
  assert.ok(logged.length >= 1);
  for (const args of logged) assert.ok(!args.some((x) => String(x).includes("PRIVATE-QUERY-XYZ") || String(x).includes("boom")), JSON.stringify(args));
});

test("scopes and states: a ticker search says what it covers and links out; held, waiting and skipped rows carry a chip", async () => {
  const env = sessionEnv();
  await addCov(env.DB, { title: "Widget skipped", state: "skipped", skip_reason: "synthetic_reason", nm_first_seen: ago(HOUR) });
  await addCov(env.DB, { title: "Widget held", admit: "seed_window", released_at: null, nm_first_seen: ago(HOUR) });
  await addCov(env.DB, { title: "Widget waiting", nm_first_seen: ago(HOUR) });
  const other = await addCov(env.DB, { ticker: "ACM", source_key: "acm_ir", title: "Widget for both", nm_first_seen: ago(HOUR) });
  await gradeCov(env.DB, other, { ticker: "TST", score: 80 });
  const aux = await addAux(env.DB, { title: "Widget covered news", nm_first_seen: ago(HOUR) });
  await gradeAux(env.DB, aux, { score: 70, band: "covered", covered_ticker: "TST" });

  const r = await open(env, "/p/search?q=widget&ticker=TST");
  assert.equal(r.status, 200);
  assert.match(r.text, /Company searches cover that company's coverage items/);
  assert.match(r.text, /<a href="\/p\/c\/TST">company page<\/a>/);
  assert.match(r.text, /<a href="\/p\/search\?q=widget">Search all names<\/a>/);
  assert.match(r.text, /<input type="hidden" name="ticker" value="TST">/);
  assert.doesNotMatch(r.text, /<select name="pipeline"/, "a scoped search has no pipeline choice");
  assert.equal(cardIds(r.text, "a").length, 0, "a ticker search shows no aux row");
  assert.match(r.text, /<span class="badge">skipped: synthetic_reason<\/span>/);
  assert.match(r.text, /<span class="badge">held<\/span>/);
  assert.match(r.text, /<span class="badge">waiting<\/span>/);
  assert.match(r.text, /graded for TST/);

  const all = await open(env, "/p/search?q=widget");
  assert.match(all.text, /<select name="pipeline"/);
  assert.match(all.text, /graded as covered company news/);
  assert.equal(cardIds(all.text, "a").length, 1);
  const ent = await open(env, "/p/search?q=widget&entity=plainco");
  assert.match(ent.text, /Searching one name \(plainco\)/);
  assert.equal(cardIds(ent.text, "i").length, 0);
});
