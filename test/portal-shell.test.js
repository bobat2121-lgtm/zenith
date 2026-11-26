// Phase 3 PR-PA2: the portal shell. S11 label-body parity with /m, S12 escaping,
// S13 headers and CSP, S14 layout, S19 the view counter, S21 errors, plus the
// shared fragments (parseRange, rangeControl, safeReturn, itemCard for both kinds).
// Synthetic fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { addItem, addGrade } from "./helpers/d1.js";
import { loadWorkerModule, pfetch, sessionEnv, sessionCookie, ORIGIN, APP, UA, SECRET_TITLE } from "./helpers/portal.js";
import { html, raw, esc, parseRange, rangeControl, safeReturn, safeHref, tickerHref, itemCard } from "../worker/src/portal-html.js";
import { NAV } from "../worker/src/portal-shell.js";

const { worker, imp } = await loadWorkerModule();
const portalMod = await imp("portal.js");
const signedIn = async () => { const env = sessionEnv(); return { env, cookie: await sessionCookie(env) }; };

// --- S11 --------------------------------------------------------------------------------
test("S11: the same JSON bodies get the same status and error through /m/feedback and /p/api/feedback", async () => {
  const { env, cookie } = await signedIn();
  const id = await addItem(env.DB, { ticker: "TST", title: "x" });
  await addGrade(env.DB, id, { score: 75 });
  const ungraded = await addItem(env.DB, { ticker: "TST", title: "y" });
  const bodies = [
    { item_id: id, label: "bogus" },
    { item_id: ungraded, label: "too_high" },
    { item_id: id, label: "high", note: "n".repeat(3000) },
    { item_id: id, label: "low", ticker: "X\"><b>" },
    { item_id: id, label: "medium", ticker: "OTHER" },
    { item_id: "abc", label: "high" },
    { item_id: 999999, label: "noise" },
    { label: "high" },
    { item_id: id, label: "HIGH", reason: "stale" },
  ];
  for (const b of bodies) {
    const m = await worker.fetch(new Request(`${ORIGIN}/m/feedback`, { method: "POST", headers: { authorization: `Bearer ${APP}`, "content-type": "application/json" }, body: JSON.stringify(b) }), env);
    const mText = await m.text();
    const p = await pfetch(worker, env, "/p/api/feedback", { method: "POST", cookie, origin: ORIGIN, json: b });
    assert.equal(p.status, m.status, JSON.stringify(b).slice(0, 80));
    const strip = (t) => { const j = JSON.parse(t); delete j.feedback_id; return j; };
    assert.deepEqual(strip(p.text), strip(mText), JSON.stringify(b).slice(0, 80));
  }
  const notes = env.DB.db.prepare("SELECT length(note) AS n FROM feedback WHERE note IS NOT NULL").all().map((r) => r.n);
  assert.deepEqual(notes, [1000, 1000], "both routes cut the note the same way");
});

// --- S12 --------------------------------------------------------------------------------
const HOSTILE = {
  id: 7, ticker: "TST", grade_ticker: 'X"><b>', title: `<img src=x onerror=alert(1)>"'&`, url: "javascript:alert(1)",
  why: "</style><script>alert(1)</script>", note_hook: "<i>hook</i>", source_key: 'src"key', score: 91, band: "lead",
  event_type: "<svg onload=x>", nm_first_seen: new Date().toISOString(), label: "high",
};

test("S12: hostile row text renders as entities in both card kinds, with no javascript: link and no ticker link", () => {
  for (const kind of ["coverage", "aux"]) {
    const row = kind === "aux" ? { ...HOSTILE, entity_name: '"><img src=x onerror=alert(2)>' } : HOSTILE;
    const out = String(itemCard(row, { kind, extra: { badges: ["<b>badge</b>"], meta: ['"><script>m</script>'] } }));
    assert.doesNotMatch(out, /<img/, kind);
    assert.doesNotMatch(out, /<script/i, kind);
    assert.doesNotMatch(out, /<svg/i, kind);
    assert.doesNotMatch(out, /<b>|<i>/, kind);
    assert.doesNotMatch(out, /<[^>]*\son[a-z]+\s*=/i, `${kind}: no live event attribute`);
    assert.doesNotMatch(out, /href="javascript:/i, kind);
    assert.doesNotMatch(out, /href="\/p\/c\//, `${kind}: the bad ticker is text, not a link`);
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/, `${kind}: the title as text`);
    assert.match(out, /src&quot;key/, kind);
    assert.match(out, /&lt;b&gt;badge&lt;\/b&gt;/, kind);
  }
  const good = String(itemCard({ ...HOSTILE, grade_ticker: "TST", url: "https://example.com/a?b=1&c=2" }, {}));
  assert.match(good, /<a class="tk" href="\/p\/c\/TST">TST<\/a>/);
  assert.match(good, /href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"/);
});

test("S12: raw( in portal modules takes only allow-listed shell constants", () => {
  const SRC = new URL("../worker/src/", import.meta.url);
  const ALLOWED = new Set(["STYLE", "SCRIPT"]);
  const files = readdirSync(SRC).filter((f) => /^portal.*\.js$/.test(f));
  assert.ok(files.includes("portal-html.js") && files.includes("portal-shell.js"));
  const calls = [];
  for (const f of files) {
    const code = readFileSync(new URL(f, SRC), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    for (const m of code.matchAll(/(?<!function )(?<![\w.])raw\(([^)]*)\)/g)) calls.push([f, m[1].trim()]);
  }
  assert.ok(calls.length >= 2, "the shell's own raw() calls were found");
  for (const [f, arg] of calls) assert.ok(ALLOWED.has(arg), `${f}: raw(${arg})`);
});

test("html: escapes every interpolation, joins arrays, drops null/undefined/false, keeps nested html", () => {
  const inner = html`<b>${"<x>"}</b>`;
  assert.equal(String(html`<p>${"<&>"}${null}${undefined}${false}${0}${["<a>", inner]}</p>`), "<p>&lt;&amp;&gt;0&lt;a&gt;<b>&lt;x&gt;</b></p>");
  assert.equal(String(raw("<i>")), "<i>");
  assert.equal(esc(`"'`), "&quot;&#39;");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("https://example.com/"), "https://example.com/");
  assert.equal(tickerHref("BRK.B"), "/p/c/BRK.B");
  assert.equal(tickerHref("tst"), null);
  assert.equal(tickerHref("A".repeat(11)), null);
});

test("safeReturn keeps /p/ paths only", () => {
  assert.equal(safeReturn("/p/today?range=7d"), "/p/today?range=7d");
  assert.equal(safeReturn("/p/c/TST#i5"), "/p/c/TST#i5");
  for (const bad of ["https://example.com/x", "//x", "/p//x", "/p/\\evil", "/p/%0d%0aSet-Cookie:x", "/p/%0Ax", "/p/%5cx", "/m", "", null, `/p/${"a".repeat(201)}`, "/p/a b"]) {
    assert.equal(safeReturn(bad), "/p/today", String(bad));
  }
});

// --- parseRange and rangeControl --------------------------------------------------------
const NOW = Date.parse("2030-01-09T15:00:00.000Z"); // 10:00 ET
const U = (q) => new URL(`${ORIGIN}/p/today${q}`);

test("parseRange: presets, today from ET midnight, custom ET dates, and every bad input falls back", () => {
  const t = parseRange(U(""), { now: NOW, def: "today", maxDays: 14 });
  assert.equal(t.key, "today");
  assert.equal(t.fromIso, "2030-01-09T05:00:00.000Z", "00:00 ET in winter");
  assert.equal(t.toIso, new Date(NOW).toISOString());
  const w = parseRange(U("?range=7d"), { now: NOW, maxDays: 14 });
  assert.equal(w.key, "7d");
  assert.equal(w.fromIso, new Date(NOW - 7 * 86_400_000).toISOString());
  assert.equal(parseRange(U("?range=24h"), { now: NOW, maxDays: 14 }).fromIso, new Date(NOW - 86_400_000).toISOString());
  const c = parseRange(U("?start=2030-01-03&end=2030-01-05"), { now: NOW, maxDays: 14 });
  assert.deepEqual([c.key, c.days, c.fromIso, c.toIso], ["custom", 3, "2030-01-03T05:00:00.000Z", "2030-01-06T05:00:00.000Z"]);
  const summer = parseRange(new URL(`${ORIGIN}/p/x?start=2030-07-01&end=2030-07-01`), { now: Date.parse("2030-07-09T15:00:00Z"), maxDays: 14 });
  assert.equal(summer.fromIso, "2030-07-01T04:00:00.000Z", "00:00 ET in summer");
  for (const q of ["?start=2030-01-05&end=2030-01-03", "?start=2029-12-01&end=2029-12-20", "?range=30d", "?range=90d", "?range=1y", "?range=bogus",
    "?start=2030-01-05", "?start=2030-02-30&end=2030-03-01", "?start=2030-01-08&end=2030-01-10", "?start=x&end=y"]) {
    assert.equal(parseRange(U(q), { now: NOW, def: "today", maxDays: 14 }).key, "today", q);
  }
  // 90d and 1y exist, each only within the caller's maxDays.
  assert.equal(parseRange(U("?range=90d"), { now: NOW, def: "30d", maxDays: 90 }).key, "90d");
  assert.equal(parseRange(U("?range=1y"), { now: NOW, def: "30d", maxDays: 90 }).key, "30d");
  const y = parseRange(U("?range=1y"), { now: NOW, def: "30d", maxDays: 400 });
  assert.deepEqual([y.key, y.days], ["1y", 365]);
  assert.equal(parseRange(U("?start=2029-01-01&end=2030-01-01"), { now: NOW, def: "30d", maxDays: 400 }).days, 366);
  // The home-screen marker is not a range key.
  assert.equal(parseRange(U("?src=home"), { now: NOW, def: "today", maxDays: 14 }).key, "today");
});

test("rangeControl: presets within maxDays, aria-current on the active one, a date form, kept parameters escaped", () => {
  const r = parseRange(U("?range=7d"), { now: NOW, maxDays: 14 });
  const out = String(rangeControl(r, "/p/today", 14));
  for (const k of ["today", "24h", "3d", "7d", "14d"]) assert.match(out, new RegExp(`href="/p/today\\?range=${k}"`));
  for (const k of ["30d", "90d", "1y"]) assert.doesNotMatch(out, new RegExp(`range=${k}`));
  assert.match(out, /href="\/p\/today\?range=7d" aria-current="true"/);
  assert.match(out, /<form method="get" action="\/p\/today"/);
  assert.match(out, /type="date" name="start"/);
  assert.match(out, /type="date" name="end"/);
  const s = String(rangeControl(parseRange(U("?range=90d"), { now: NOW, def: "30d", maxDays: 90 }), "/p/search", { q: '"><x', ticker: "TST" }));
  assert.match(s, /range=90d/);
  assert.doesNotMatch(s, /range=1y/);
  assert.match(s, /<input type="hidden" name="q" value="&quot;&gt;&lt;x">/);
  assert.match(s, /href="\/p\/search\?q=%22%3E%3Cx&amp;ticker=TST&amp;range=7d"/);
});

test("itemCard: coverage posts to /p/api/feedback with the grade ticker; aux posts to /p/api/aux-feedback; extras render", () => {
  const cov = String(itemCard({ id: 5, ticker: "TST", grade_ticker: "TSTB", title: "t", score: 80, band: "digest", nm_first_seen: new Date(NOW - 3_600_000).toISOString() },
    { now: NOW, returnTo: "/p/today?range=7d" }));
  assert.match(cov, /<form class="lbl" method="post" action="\/p\/api\/feedback" data-endpoint="\/p\/api\/feedback" data-item="5" data-ticker="TSTB">/);
  assert.match(cov, /name="ticker" value="TSTB"/);
  assert.match(cov, /name="return" value="\/p\/today\?range=7d"/);
  assert.match(cov, /1h 00m ago/);
  const aux = String(itemCard({ id: 9, entity_name: "Example Corp", title: "a", score: 72, band: "digest", url: "https://example.com/x" },
    { kind: "aux", now: NOW, extra: { badges: ["rare"], meta: ["names TST"] }, returnTo: "https://example.com/" }));
  assert.match(aux, /<article class="card aux" id="a9">/);
  assert.match(aux, /<span class="tk">Example Corp<\/span>/);
  assert.match(aux, /action="\/p\/api\/aux-feedback" data-endpoint="\/p\/api\/aux-feedback" data-item="9">/);
  assert.doesNotMatch(aux, /name="ticker"/);
  assert.match(aux, /<span class="badge">rare<\/span>/);
  assert.match(aux, /names TST/);
  assert.match(aux, /name="return" value="\/p\/today"/, "an unsafe return falls back");
  for (const v of ["high", "medium", "low", "noise", "too_high", "too_low"]) assert.match(aux, new RegExp(`name="label" value="${v}"`));
});

// --- S13, S14 ---------------------------------------------------------------------------
test("S13: every /p HTML page has a fresh nonce CSP matching its one script and one style, and no inline handler", async () => {
  const { env, cookie } = await signedIn();
  const nonces = new Set();
  for (const [path, opts] of [["/p/login", {}], ["/p/today", { cookie }], ["/p/c", { cookie }], ["/p/rare", { cookie }], ["/p/pair", { cookie }], ["/p/nope", { cookie }]]) {
    const r = await pfetch(worker, env, path, opts);
    const csp = r.headers.get("content-security-policy");
    assert.ok(csp, path);
    const n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1];
    nonces.add(n);
    assert.match(csp, new RegExp(`style-src 'nonce-${n}'`));
    for (const d of ["default-src 'none'", "manifest-src 'self'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'none'"]) assert.ok(csp.includes(d), `${path}: ${d}`);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal((r.text.match(/<script\b/g) || []).length, 1, path);
    assert.equal((r.text.match(/<style\b/g) || []).length, 1, path);
    assert.ok(r.text.includes(`<script nonce="${n}">`) && r.text.includes(`<style nonce="${n}">`), path);
    assert.doesNotMatch(r.text, /<[^>]*\son[a-z]+\s*=/i, `${path}: inline handler`);
    for (const [h, v] of [["cache-control", "no-store"], ["x-content-type-options", "nosniff"], ["referrer-policy", "same-origin"], ["x-frame-options", "DENY"],
      ["cross-origin-opener-policy", "same-origin"], ["cross-origin-resource-policy", "same-origin"], ["x-robots-tag", "noindex, nofollow"],
      ["strict-transport-security", "max-age=31536000"]]) assert.equal(r.headers.get(h), v, `${path}: ${h}`);
    assert.match(r.headers.get("permissions-policy"), /camera=\(\)/);
  }
  assert.equal(nonces.size, 6, "a fresh nonce per response");
});

test("S14: the layout contract: viewport, manifest, icon, the 7 nav entries in order, aria-current on the active one", async () => {
  const { env, cookie } = await signedIn();
  const r = await pfetch(worker, env, "/p/competitors", { cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/);
  assert.match(r.text, /<link rel="manifest" href="\/s\/manifest.webmanifest" crossorigin="use-credentials">/);
  assert.match(r.text, /<link rel="apple-touch-icon" href="\/s\/icon-180.png">/);
  assert.deepEqual(NAV.map(([, l]) => l), ["Today", "Companies", "Competitors", "Industry", "Rare finds", "Search", "Brief"]);
  const side = /<nav class="side"[^>]*>(.*?)<\/nav>/s.exec(r.text)[1];
  assert.deepEqual([...side.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), NAV.map(([, l]) => l));
  assert.deepEqual([...side.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]), ["/p/competitors"]);
  assert.match(r.text, /Signed in on this device/);
  assert.match(r.text, /<form method="post" action="\/p\/logout">/);
  assert.match(r.text, /Not built yet/);
});

test("companies index lists the injected tickers; ?t= redirects only to a listed ticker; /p/c/<T> needs a listed, well-formed ticker", async () => {
  const { env, cookie } = await signedIn();
  const deps = { tickers: ["TST", "TSTB"], feedback: () => null };
  const call = async (path) => portalMod.portal(new Request(`${ORIGIN}${path}`, { headers: { cookie } }), env, new URL(`${ORIGIN}${path}`), deps);
  const idx = await call("/p/c");
  assert.equal(idx.status, 200);
  const text = await idx.text();
  assert.match(text, /<a href="\/p\/c\/TST">TST<\/a>/);
  assert.match(text, /<a href="\/p\/c\/TSTB">TSTB<\/a>/);
  const go = await call("/p/c?t=tst");
  assert.equal(go.status, 302);
  assert.equal(go.headers.get("location"), "/p/c/TST");
  for (const p of ["/p/c?t=NOPE", "/p/c?t=%3Cx", "/p/c/NOPE", "/p/c/tst", "/p/c/T%22"]) assert.equal((await call(p)).status, 404, p);
  assert.equal((await call("/p/c/TST")).status, 200);
  const root = await call("/p");
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/p/today");
});

// --- S19 --------------------------------------------------------------------------------
test("S19: the view counter stores a client class, never the user agent; a missing table does not break the page", async () => {
  const { env, cookie } = await signedIn();
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await pfetch(worker, env, "/p/today?src=home", { cookie, ua: UA.iphone })).status, 200);
  await pfetch(worker, env, "/p/today", { cookie, ua: UA.desktop });
  await pfetch(worker, env, "/p/today", { cookie, ua: UA.desktop });
  await pfetch(worker, env, "/p/c", { cookie, ua: UA.android });
  await pfetch(worker, env, "/p/c", { cookie, ua: UA.ipad, method: "HEAD" });
  const rows = env.DB.db.prepare("SELECT * FROM portal_views ORDER BY view, client").all();
  assert.deepEqual(rows.map((r) => [r.universe_id, r.day, r.view, r.client, r.via, r.n]), [
    ["u1", day, "companies", "phone", "session", 1],
    ["u1", day, "companies", "tablet", "session", 1],
    ["u1", day, "today", "desktop", "session", 2],
    ["u1", day, "today", "phone_home", "session", 1],
  ]);
  assert.ok(!JSON.stringify(rows).includes("Mozilla"), "no user agent stored");
  // A 404 and a failed sign-in count nothing.
  await pfetch(worker, env, "/p/nope", { cookie });
  assert.equal(env.DB.db.prepare("SELECT SUM(n) AS n FROM portal_views").get().n, 5);
  // With ctx, the count goes through waitUntil.
  const waits = [];
  await pfetch(worker, env, "/p/rare", { cookie, ctx: { waitUntil: (p) => waits.push(p) } });
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  env.DB.db.exec("DROP TABLE portal_views");
  const r = await pfetch(worker, env, "/p/today", { cookie, ua: UA.iphone });
  assert.equal(r.status, 200);
});

// --- S21 --------------------------------------------------------------------------------
test("S21: a view that throws gives a generic 500 with the portal headers, and logs only a fixed string and the view name", async () => {
  const { env, cookie } = await signedIn();
  const saved = portalMod.VIEWS.rare;
  const logged = [];
  const origError = console.error;
  portalMod.VIEWS.rare = async () => { throw new Error(SECRET_TITLE); };
  console.error = (...a) => logged.push(a);
  try {
    const r = await pfetch(worker, env, "/p/rare", { cookie, jwt: "a.b.c", json: undefined, headers: { "x-probe": "zz" } });
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes(SECRET_TITLE));
    assert.match(r.text, /Something went wrong\. Try again\./);
    assert.ok(r.headers.get("content-security-policy"));
    assert.equal(r.headers.get("cache-control"), "no-store");
  } finally {
    portalMod.VIEWS.rare = saved;
    console.error = origError;
  }
  assert.deepEqual(logged, [["portal view failed", "rare"]]);
  assert.ok(!JSON.stringify(logged).includes(cookie.split("=")[1]));
});

test("every view fails closed without vctx.auth.ok", async () => {
  for (const [name, view] of Object.entries(portalMod.VIEWS)) {
    for (const auth of [undefined, { ok: false }, { ok: "true" }]) {
      const out = await view({ env: {}, url: new URL(`${ORIGIN}/p/x`), auth, tickers: ["TST"], now: NOW });
      assert.equal(out.status, 403, `${name} with ${JSON.stringify(auth)}`);
      assert.doesNotMatch(String(out.body), /TST/);
    }
  }
});
