// Phase 3 PR-CV3: worker/src/views-page.js, the Competitors, Industry and Rare
// finds pages. A1 fail closed, G1 the identity table, G2 escaping, G3 parameter
// injection, G4 layout and the range age cap, G5 the Rare shelves, V10 through
// the page. Synthetic fixtures only: the page-level tests build their relations
// from synthetic maps (TST, TSTB, TSTC and widget_corp-style keys); the route
// tests pick covered tickers from the bundled covered.json at run time. Seeded
// titles carry the PORTAL-SECRET-TITLE marker.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { zenithDb } from "./helpers/worker-env.js";
import { loadWorker } from "./helpers/worker.js";
import {
  loadWorkerModule, pfetch, sessionEnv, accessEnv, sessionCookie, keyPair, signJwt, goodClaims, withCerts, stripNonce,
  ORIGIN, APP, EMAIL, SECRET_TITLE,
} from "./helpers/portal.js";
import { buildRelations } from "../scripts/build-relations.mjs";

const { worker, imp } = await loadWorkerModule();
const page = await imp("views-page.js");
const { competitorsPage, industryPage, rarePage, PAGE_CARDS, AGE_CAP_DAYS } = page;
const { loadRelations } = await imp("relations.js");
const { MUTED_SQL } = await imp("tuning.js");
const { etParts } = await imp("et.js");
const { VIEWS } = await imp("portal.js");
const { clearJwksCache } = await imp("mobile.js");
const { clearNegativeCache } = await imp("portal-auth.js");
const { default: COVERED } = await import("../worker/src/covered.json", { with: { type: "json" } });

// --- Synthetic relations ----------------------------------------------------------------------------
const TICKERS = ["TST", "TSTB", "TSTC"];
const synPeers = [
  { key: "widget_corp", name: "Widget Corp", status: "private", reads_through: [{ ticker: "TST", direction: "−" }] },
  { key: "plus_co", name: "Plus Co", status: "public", reads_through: [{ ticker: "TST", direction: "+" }] },
  { key: "hedge_co", name: "Hedge Co", status: "public", reads_through: [{ ticker: "TSTB", direction: "±" }] },
];
const synKeyAccounts = { TST: [{ name: "Acme Stores", kind: "customer", terms: ["Acme Stores"] }], TSTB: [], TSTC: [] };
const synRivals = { TSTB: [{ key: "hedge_co", basis: "peers" }] };
const synCovered = {
  tickers: TICKERS,
  sources: { testco: "TST" },
  counterparty: { rival_x: { role: "rival", affects: ["TST"] }, prog_z: { role: "program", affects: ["TST", "TSTB"] } },
  records: [],
};
const synAux = {
  sources: {
    rival_x: { entity: "rival_x", name: "Rival X", status: "private" },
    prog_z: { entity: "prog_z", name: "Prog Z", status: "program", coverage_subject: true, affects: ["TST", "TSTB"] },
    widget_corp: { entity: "widget_corp", name: "Widget Corp", status: "private" },
    plus_co: { entity: "plus_co", name: "Plus Co", status: "public" },
    hedge_co: { entity: "hedge_co", name: "Hedge Co", status: "public" },
    trade_media: { entity: "media_trade", name: "Trade media", status: "media" },
  },
  exclude: {},
};
const synMatch = { TST: { terms: ["Testco"], accounts: ["Acme Stores"] }, TSTB: { terms: ["Testb"], accounts: [] }, TSTC: { terms: ["Testc"], accounts: [] } };
const synBuilt = buildRelations({ peers: synPeers, keyAccounts: synKeyAccounts, rivals: synRivals, tickers: TICKERS, auxKeys: Object.keys(synAux.sources) });
const relOf = (industry = {}) => loadRelations({ relations: synBuilt.relations, version: "rel-test", covered: synCovered, aux: synAux, match: synMatch,
  industry, isRecordSource: (k) => k.startsWith("edgar_") });
const REL = relOf();
const OPTS = { rel: REL, aux: synAux };

// --- Seeding ----------------------------------------------------------------------------------------
const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
let rowid = 70_000;
function addItem(env, over = {}) {
  const it = { nm_rowid: ++rowid, source_key: "rival_x", ticker: "TST", url: `https://news.example.com/c/${rowid}`, title: `${SECRET_TITLE} story`,
    published: iso(DAY), nm_first_seen: iso(DAY), role: "rival", ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, nm_notified, ingested_at, state, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', ?)`).run(it.nm_rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.role);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const item = env.DB.db.prepare("SELECT ticker FROM items WHERE id = ?").get(itemId);
  const g = { ticker: item.ticker, run_id: `run-${itemId}`, score: 72, rung: null, event_type: null, flags: '["reason:material"]', why: "why", graded_at: iso(HOUR), ...over };
  const band = g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, rung, event_type, why, flags, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, ?, ?, ?, ?, 1, ?)`).run(itemId, g.ticker, g.run_id, g.score, band, g.rung, g.event_type, g.why, g.flags, g.graded_at);
  const id = Number(r.lastInsertRowid);
  if (g.ticker === item.ticker) env.DB.db.prepare("UPDATE items SET state = 'graded', grade_id = ? WHERE id = ?").run(id, itemId);
  return id;
}
const graded = (env, item = {}, grade = {}) => { const id = addItem(env, item); addGrade(env, id, grade); return id; };
function addAux(env, over = {}) {
  const src = over.source_key ?? "widget_corp";
  const a = synAux.sources[src] || {};
  const it = { nm_rowid: ++rowid, entity_key: a.entity ?? src, entity_name: a.name ?? "Synthetic", status: a.status ?? "unknown",
    url: `https://news.example.com/a/${rowid}`, title: `${SECRET_TITLE} aux story`, nm_first_seen: iso(DAY), affects: a.affects ? a.affects.join(",") : null,
    score: 72, reads_through: null, event_type: null, why: "aux why", entity: null, ...over, source_key: src };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, coverage_subject, affects)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'graded', ?, ?)`).run(it.nm_rowid, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, iso(DAY),
    it.nm_first_seen, iso(), a.coverage_subject ? 1 : 0, it.affects);
  const id = Number(r.lastInsertRowid);
  const band = it.score >= 90 ? "lead" : it.score >= 70 ? "digest" : it.score >= 40 ? "borderline" : "reject";
  const g = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, event_type, reads_through, why, flags, graded_at)
    VALUES (?, 'run-aux', ?, ?, ?, ?, ?, ?, '["reason:material"]', ?)`).run(id, it.entity ?? it.entity_name, it.score, band, it.event_type, it.reads_through, it.why, iso(HOUR));
  env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), id);
  return id;
}
const nmOf = (env, id) => env.DB.db.prepare("SELECT nm_rowid FROM items WHERE id = ?").get(id).nm_rowid;

// A view context as portal.js builds it (signed in), on a synthetic universe.
const NOW = Date.now();
const vctxOf = (env, path, over = {}) => ({ env, url: new URL(`${ORIGIN}${path}`), request: null, auth: { ok: true, mode: "session", via: "session" },
  who: null, tickers: TICKERS, muted: MUTED_SQL, now: NOW, nonce: "n", ...over });
const render = async (fn, env, path, opts = OPTS, over = {}) => {
  const out = await fn(vctxOf(env, path, over), opts);
  return { ...out, text: String(out.body) };
};
// The text of one <section data-ticker="T"> of a body.
const sectionOf = (text, t) => (new RegExp(`<section data-ticker="${t.replace(".", "\\.")}"[\\s\\S]*?</section>`).exec(text) || [""])[0];
// Every href in a body, unescaped.
const hrefs = (text) => [...text.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
// A D1 wrapper recording statements and binds.
function spy(db) {
  const calls = [];
  return {
    calls, db: db.db,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      const real = db.prepare(sql);
      return { bind(...a) { call.binds = a; return real.bind(...a); }, all: () => real.all(), first: (c) => real.first(c), run: () => real.run() };
    },
  };
}
const PAGES = [["competitors", competitorsPage], ["industry", industryPage], ["rare", rarePage]];

// --- A1 -----------------------------------------------------------------------------------------------
test("A1: each page called directly without a signed-in auth returns 403 and runs no statement", async () => {
  const DB = { prepare() { throw new Error("no statement may run"); } };
  for (const [name, fn] of PAGES) {
    for (const auth of [undefined, null, { ok: false }, { ok: "true" }, { ok: 1 }]) {
      const out = await fn({ env: { DB }, url: new URL(`${ORIGIN}/p/${name}?ticker=TST`), auth, tickers: TICKERS, muted: MUTED_SQL, now: NOW }, OPTS);
      assert.equal(out.status, 403, `${name} ${JSON.stringify(auth)}`);
      assert.doesNotMatch(String(out.body), /TST|data-ticker|<article/, name);
    }
    assert.equal(VIEWS[name], fn, `portal.js VIEWS.${name} is the page`);
  }
});

// --- Competitors -----------------------------------------------------------------------------------
test("Competitors: per-ticker sections, cards with the key account and sign, lower-scored collapsed, quiet line, no-rival-source line", async () => {
  const env = { DB: zenithDb() };
  const kept = graded(env, { title: "Rival X wins Acme Stores order" }, { score: 75 });
  const low = graded(env, { title: "Rival X minor note" }, { score: 30 });
  const peer = addAux(env, { source_key: "widget_corp", score: 66 });
  const hedge = addAux(env, { source_key: "hedge_co", score: 80 });
  const muted = graded(env, { source_key: "muted_src" }, { score: 90 });
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('muted_src', 'mute', ?)").run(iso());

  const DB = spy(env.DB);
  const out = await render(competitorsPage, { DB }, "/p/competitors");
  assert.equal(out.status, undefined);
  assert.equal(out.title, "Competitors");
  assert.equal(out.active, "competitors");
  assert.equal(DB.calls.length, 2, "two statements per open");
  assert.equal((out.text.match(/<section data-ticker=/g) || []).length, TICKERS.length);
  for (const t of TICKERS) assert.ok(out.text.includes(`<li><a href="/p/c/${t}">${t}</a></li>`), `chip ${t}`);

  const tst = sectionOf(out.text, "TST");
  assert.match(tst, /<h2><a href="\/p\/c\/TST">TST<\/a> · 3 in range · 3 rivals watched · 1 rival sources · 1 key accounts<\/h2>/);
  assert.ok(tst.includes(`id="i${kept}"`) && tst.includes(`id="a${peer}"`));
  assert.match(tst, /names Acme Stores/);
  assert.match(tst, /<span class="badge">− for TST<\/span>/);
  assert.match(tst, new RegExp(`<details><summary>Lower-scored \\(1\\)</summary>[\\s\\S]*id="i${low}"[\\s\\S]*</details>`));
  assert.match(tst, /Quiet in this range: Plus Co/);
  assert.ok(!out.text.includes(`id="i${muted}"`), "a muted source is hidden (vctx.muted)");
  assert.ok(sectionOf(out.text, "TSTB").includes(`id="a${hedge}"`));
  assert.match(sectionOf(out.text, "TSTB"), /± for TSTB/);
  assert.match(sectionOf(out.text, "TSTC"), /No rival source of its own; rivals come from peer notes only\./);
  assert.match(sectionOf(out.text, "TSTC"), /No competitor row in this range\./);
  assert.match(tst, /<a href="\/p\/competitors\?ticker=TST">Only TST<\/a>/);
  // The aux label form posts to the aux route and returns to this page.
  assert.match(tst, new RegExp(`data-endpoint="/p/api/aux-feedback" data-item="${peer}"`));
  assert.match(tst, /name="return" value="\/p\/competitors"/);
});

test("Competitors: ticker, dir, sort and min_score filter; the ticker form binds the ticker", async () => {
  const env = { DB: zenithDb() };
  const a = graded(env, { title: "older", nm_first_seen: iso(3 * DAY) }, { score: 50 });
  const b = graded(env, { title: "newer", nm_first_seen: iso(DAY) }, { score: 45 });
  const plus = addAux(env, { source_key: "plus_co", score: 88, nm_first_seen: iso(2 * DAY) });
  const DB = spy(env.DB);
  const only = await render(competitorsPage, { DB }, "/p/competitors?ticker=tst");
  assert.equal((only.text.match(/<section data-ticker=/g) || []).length, 1);
  assert.deepEqual(DB.calls.map((c) => c.binds[2]), ["TST", "TST"]);
  assert.match(only.text, /<a href="\/p\/competitors">All names<\/a>/);
  const order = (text) => [...sectionOf(text, "TST").matchAll(/id="([ia]\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(order((await render(competitorsPage, env, "/p/competitors?ticker=TST")).text), [`a${plus}`, `i${a}`, `i${b}`], "by score");
  assert.deepEqual(order((await render(competitorsPage, env, "/p/competitors?ticker=TST&sort=newest")).text), [`i${b}`, `a${plus}`, `i${a}`], "newest first");
  assert.deepEqual(order((await render(competitorsPage, env, "/p/competitors?ticker=TST&dir=plus")).text), [`a${plus}`]);
  assert.deepEqual(order((await render(competitorsPage, env, "/p/competitors?ticker=TST&min_score=60")).text), [`a${plus}`]);
  const minus = await render(competitorsPage, env, "/p/competitors?ticker=TST&dir=minus&range=30d");
  assert.deepEqual(order(minus.text), [`i${a}`, `i${b}`]);
  assert.match(minus.text, /<a href="\/p\/competitors\?range=30d&amp;ticker=TST&amp;dir=minus" aria-current="true">− read<\/a>/);
  assert.match(minus.text, /<input type="hidden" name="dir" value="minus">/, "the date form keeps the filters");
});

test("G4: at most 50 cards a ticker, the rest behind '+n more' to the ticker form", async () => {
  const env = { DB: zenithDb() };
  for (const t of TICKERS) for (let i = 0; i < 80; i++) graded(env, { ticker: t, source_key: t === "TST" ? "rival_x" : "src_other" }, { score: 60 + (i % 30) });
  const out = await render(competitorsPage, env, "/p/competitors?range=7d");
  for (const t of TICKERS) assert.equal((sectionOf(out.text, t).match(/<article /g) || []).length, 50, t);
  assert.match(sectionOf(out.text, "TST"), /<a href="\/p\/competitors\?range=7d&amp;ticker=TST">\+30 more<\/a>/);
  const one = await render(competitorsPage, env, "/p/competitors?ticker=TSTC");
  assert.equal((one.text.match(/<article /g) || []).length, 50);
});

test("G4: no '+n more' link leads back to the page it is on; the ticker form says how to see the rest", async () => {
  const env = { DB: zenithDb() };
  for (let i = 0; i < 80; i++) {
    graded(env, {}, { score: 60 + (i % 30) });
    graded(env, { role: "program", source_key: "prog_z", url: `https://www.tradepress.example/m${i}` }, { score: 60 + (i % 30) });
  }
  const moreHrefs = (text) => [...text.matchAll(/<a href="([^"]*)">\+\d+ more<\/a>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const comp = await render(competitorsPage, env, "/p/competitors?ticker=TST");
  assert.equal((comp.text.match(/<article /g) || []).length, 50);
  assert.deepEqual(moreHrefs(comp.text), [], "competitors, ticker form");
  assert.match(comp.text, /<p class="meta">\+30 more; narrow the range or raise the minimum score\.<\/p>/);
  const named = await render(industryPage, env, "/p/industry?ticker=TST");
  assert.deepEqual(moreHrefs(named.text), ["/p/industry?ticker=TST&kind=news"], "the ticker form links on to the kind form");
  const kind = await render(industryPage, env, "/p/industry?ticker=TST&kind=news");
  assert.equal((kind.text.match(/<article /g) || []).length, 50);
  assert.deepEqual(moreHrefs(kind.text), [], "industry, ticker and kind form");
  assert.match(kind.text, /<p class="meta">\+30 more; narrow the range or raise the minimum score\.<\/p>/);
});

test("G4: a start more than 120 days back falls back to the default range with the notice", async () => {
  const env = { DB: zenithDb() };
  const day = (n) => etParts(NOW - n * DAY).date;
  for (const [, fn] of PAGES) {
    const DB = spy(env.DB);
    const out = await render(fn, { DB }, `/p/x?start=${day(200)}&end=${day(195)}`);
    assert.match(out.text, new RegExp(`Ranges older than ${AGE_CAP_DAYS} days are not offered`));
    assert.match(out.text, /<p class="meta">14 days · Updated /);
    const from = Date.parse(DB.calls[0].binds[0]);
    assert.ok(Math.abs(from - (NOW - 14 * DAY)) < 1000, "the default 14-day window is read");
    const ok = await render(fn, env, `/p/x?start=${day(100)}&end=${day(90)}`);
    assert.doesNotMatch(ok.text, /not offered/, "100 days back is allowed");
  }
});

// --- Industry --------------------------------------------------------------------------------------
test("Industry: kind groups per ticker, the program twin merge, sector-wide rows, the kind filter and declared areas", async () => {
  const env = { DB: zenithDb() };
  const rule = graded(env, { role: "program", source_key: "prog_z", url: "https://www.federalregister.gov/d/1" }, { score: 55 });
  const twin = addAux(env, { source_key: "prog_z", nm_rowid: nmOf(env, rule), entity: "Prog Z", score: 61, affects: "TST" });
  const news = graded(env, { role: "program", source_key: "prog_z", url: "https://www.tradepress.example/x" }, { score: 20 });
  const wide = addAux(env, { source_key: "trade_media", score: 70 });
  const out = await render(industryPage, env, "/p/industry");
  assert.equal(out.title, "Industry");
  const tst = sectionOf(out.text, "TST");
  assert.match(tst, /<h2><a href="\/p\/c\/TST">TST<\/a> · 2 in range<\/h2>/);
  assert.match(tst, new RegExp(`<h3>Rules \\(1\\)</h3>[\\s\\S]*id="i${rule}"`));
  assert.ok(!out.text.includes(`id="a${twin}"`), "the twin is folded into its coverage card");
  assert.match(tst, /Also graded for Prog Z: 61/);
  assert.match(tst, new RegExp(`<h3>News \\(1\\)</h3><details><summary>Lower-scored \\(1\\)</summary>[\\s\\S]*id="i${news}"`));
  assert.match(out.text, new RegExp(`<section data-sector="wide"><h2>Sector-wide · 1 in range</h2>[\\s\\S]*id="a${wide}"`));
  assert.match(sectionOf(out.text, "TSTC"), /No industry row in this range\./);

  const rules = await render(industryPage, env, "/p/industry?kind=rules");
  assert.ok(rules.text.includes(`id="i${rule}"`) && !rules.text.includes(`id="i${news}"`) && !rules.text.includes(`id="a${wide}"`));
  assert.match(rules.text, /<a href="\/p\/industry\?kind=rules" aria-current="true">Rules<\/a>/);
  const named = await render(industryPage, env, "/p/industry?ticker=TST");
  assert.doesNotMatch(named.text, /data-sector="wide"/, "no sector-wide rows with a name picked");

  // Declared areas (promotion invariance through the page): the flagged row moves into the area.
  const flagged = graded(env, { role: null, source_key: "testco", url: "https://www.tradepress.example/f" }, { score: 66, rung: "industry", flags: '["industry:x"]' });
  const industry = { TST: { x: { core: true } } };
  const before = sectionOf((await render(industryPage, env, "/p/industry")).text, "TST");
  assert.match(before, new RegExp(`<h3>News \\(2\\)</h3>[\\s\\S]*id="i${flagged}"`));
  const after = await render(industryPage, env, "/p/industry", { rel: relOf(industry), industry });
  assert.match(sectionOf(after.text, "TST"), new RegExp(`<h3>Area x \\(core\\) \\(1\\)</h3>[\\s\\S]*id="i${flagged}"[\\s\\S]*<h3>Rules`));
  const area = await render(industryPage, env, "/p/industry?kind=area%3Ax", { rel: relOf(industry), industry });
  assert.match(area.text, /<a href="\/p\/industry\?kind=area%3Ax" aria-current="true">Area x<\/a>/);
  assert.doesNotMatch(sectionOf(area.text, "TST"), /<h3>Rules/);
  const unknown = await render(industryPage, env, "/p/industry?kind=area%3Anope", { rel: relOf(industry), industry });
  assert.match(unknown.text, /<a href="\/p\/industry" aria-current="true">All kinds<\/a>/);
});

// --- G5, Rare finds -----------------------------------------------------------------------------------
test("G5: Rare finds has two shelves; floor and ticker pass through to rareData; an empty shelf says so", async () => {
  const env = { DB: zenithDb() };
  // Runtime keys outside both bundled maps, so the class comes from the URL and key prefix only.
  const reg = graded(env, { role: null, source_key: "src_synthetic", url: "https://town.legistar.com/Matter.aspx?ID=1" }, { score: 70 });
  const orig = graded(env, { role: null, ticker: "TSTB", source_key: "ia_media_synthetic", url: "https://www.tradepress.example/o" }, { score: 64 });
  graded(env, { role: null, source_key: "src_synthetic", url: "https://www.tradepress.example/none" }, { score: 99 });   // no class
  const DB = spy(env.DB);
  const out = await render(rarePage, { DB }, "/p/rare", { rel: REL });
  assert.equal(out.title, "Rare finds");
  assert.equal(DB.calls.length, 2);
  assert.match(out.text, new RegExp(`<section data-shelf="register"><h2>Registers</h2>[\\s\\S]*id="i${reg}"[\\s\\S]*</section>`));
  assert.match(out.text, new RegExp(`<section data-shelf="original"><h2>Original reporting</h2>[\\s\\S]*id="i${orig}"[\\s\\S]*</section>`));
  assert.match(out.text, /<span class="badge">rare: register<\/span>/);
  assert.deepEqual(DB.calls.map((c) => c.binds.slice(1, 2)), [[60], [60]], "default floor 60");

  const high = await render(rarePage, { DB: spy(env.DB) }, "/p/rare?floor=70", { rel: REL });
  assert.match(high.text, /<section data-shelf="original"><h2>Original reporting<\/h2>\n<p class="empty">Nothing at or above 70 in this range\.<\/p>/);
  assert.match(high.text, /<a href="\/p\/rare\?floor=70" aria-current="true">70\+<\/a>/);

  const DB2 = spy(env.DB);
  const one = await render(rarePage, { DB: DB2 }, "/p/rare?ticker=TSTB", { rel: REL });
  assert.ok(one.text.includes(`id="i${orig}"`) && !one.text.includes(`id="i${reg}"`));
  assert.equal(DB2.calls[0].binds.at(-1), "TSTB");
  assert.deepEqual(DB2.calls[1].binds.slice(-2), ["TSTB", "TSTB"]);
  // A custom range passes its end as `until`; a preset passes none.
  const d = (n) => etParts(NOW - n * DAY).date;
  const DB3 = spy(env.DB);
  await render(rarePage, { DB: DB3 }, `/p/rare?start=${d(5)}&end=${d(2)}`, { rel: REL });
  assert.equal(DB3.calls[0].binds.length, 3);
  assert.equal(DB.calls[0].binds.length, 2);
  // An unknown ticker is no filter, not an error.
  const DB4 = spy(env.DB);
  await render(rarePage, { DB: DB4 }, "/p/rare?ticker=ZZZZ", { rel: REL });
  assert.equal(DB4.calls[0].binds.length, 2);
});

// --- G2 -----------------------------------------------------------------------------------------------
test("G2: hostile titles, why, entity names and URLs render as text through the shared itemCard", async () => {
  const env = { DB: zenithDb() };
  const evil = '"><img src=x onerror=alert(1)>';
  graded(env, { title: "<script>x</script>", url: "JaVaScRiPt:alert(1)" }, { score: 75, why: "</style><script>y</script>" });
  addAux(env, { source_key: "widget_corp", entity_name: evil, entity: evil, url: " javascript:x", title: "<script>a</script>" });
  addAux(env, { source_key: "hedge_co", url: "data:text/html,x", why: evil });
  addAux(env, { source_key: "trade_media", url: "//evil.example" });
  graded(env, { role: "program", source_key: "prog_z", url: "https://www.federalregister.gov/x" }, { score: 60, flags: '["industry:a\\"b"]', rung: "industry" });
  graded(env, { role: null, source_key: "src_synthetic", title: "<script>r</script>", url: "https://town.legistar.com/Matter.aspx?ID=9" }, { score: 80, why: evil });
  for (const [name, fn] of PAGES) {
    const { text } = await render(fn, env, `/p/${name}?range=30d`);
    assert.ok(/<article /.test(text), `${name} has cards`);
    assert.doesNotMatch(text, /<script|<img|<\/style>/i, name);
    assert.doesNotMatch(text, /<[^>]*\son[a-z]+\s*=/i, `${name}: an event-handler attribute`);
    for (const h of hrefs(text)) assert.match(h, /^(\/p\/|https:\/\/)/, `${name}: href ${h}`);
    assert.doesNotMatch(text, /href="[^"]*(javascript|data:|evil\.example)/i, name);
  }
});

// --- G3 -----------------------------------------------------------------------------------------------
test("G3: injected parameters render the defaults; every href carries only the allowed keys and values", async () => {
  const env = { DB: zenithDb() };
  graded(env, {}, { score: 75 });
  addAux(env, { source_key: "trade_media" });
  const bad = '?kind=%22%3E%3Cscript%3E&dir=%22%20onfocus%3D&min_score=1%26ticker%3DX&ticker=%3Cb%3E&sort=%3Ci%3E&floor=%3Cx%3E&range=%22%3E';
  const ALLOWED = {
    range: /^(today|24h|3d|7d|14d|30d)$/, start: /^\d{4}-\d{2}-\d{2}$/, end: /^\d{4}-\d{2}-\d{2}$/, ticker: /^(TST|TSTB|TSTC)$/,
    dir: /^(minus|plus|mixed)$/, sort: /^newest$/, kind: /^(rules|budget|local|programs|government|news|area:[a-z_]+)$/, min_score: /^\d{1,3}$/, floor: /^\d{2,3}$/,
  };
  for (const [name, fn] of PAGES) {
    const injected = await render(fn, env, `/p/${name}${bad}`);
    const plain = await render(fn, env, `/p/${name}`);
    assert.equal(injected.text, plain.text, `${name}: invalid parameters give the default page`);
    assert.doesNotMatch(injected.text, /<script|<b>|<i>|onfocus=/, name);
    for (const h of hrefs(injected.text)) {
      if (h.startsWith("https://")) continue;
      const u = new URL(h, ORIGIN);
      assert.match(u.pathname, /^\/p\/(competitors|industry|rare|c\/(TST|TSTB|TSTC))$/, h);
      for (const [k, v] of u.searchParams) {
        assert.ok(ALLOWED[k], `${name}: key ${k} in ${h}`);
        assert.match(v, ALLOWED[k], `${name}: ${k}=${v}`);
      }
    }
  }
});

// --- Through the Worker: G1, G4, V10 --------------------------------------------------------------------
const [CT] = COVERED.tickers;
const ROUTE_PATHS = ["/p/competitors", "/p/industry", "/p/rare", "/p/competitors/"];
function assertNoData(r, label) {
  const body = stripNonce(r.text, r.headers);
  assert.ok(!body.includes(SECRET_TITLE), `${label}: seeded title`);
  for (const t of COVERED.tickers) assert.ok(!new RegExp(`(^|[^A-Za-z0-9])${t.replace(".", "\\.")}([^A-Za-z0-9]|$)`).test(body), `${label}: ticker ${t}`);
  assert.doesNotMatch(body, /data-ticker|<article/, label);
}
// A rival row (Competitors), a register row (Rare) and a program row (Industry) for a covered ticker, marker titles.
function seedCovered(env) {
  graded(env, { ticker: CT, source_key: "src_synthetic", role: "rival" }, { score: 80 });
  graded(env, { ticker: CT, source_key: "src_synthetic", role: null, url: "https://town.legistar.com/Matter.aspx?ID=3" }, { score: 80 });
  graded(env, { ticker: CT, source_key: "src_synthetic", role: "program", url: "https://www.federalregister.gov/d/3" }, { score: 80 });
}
const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("G1: the identity table: only a valid session or a valid Access JWT opens the three pages", async () => {
  const s = sessionEnv();
  seedCovered(s);
  const cookie = await sessionCookie(s);
  for (const path of ROUTE_PATHS) {
    for (const [label, opts, p] of [
      ["no credentials", {}, path],
      ["APP_TOKEN as a bearer", { headers: { authorization: `Bearer ${APP}` } }, path],
      ["?token=APP_TOKEN", {}, `${path}?token=${APP}`],
      ["tampered cookie", { cookie: `${cookie.slice(0, -2)}xx` }, path],
    ]) {
      const r = await pfetch(worker, s, p, opts);
      assert.equal(r.status, 303, `${label} ${p}`);
      assert.equal(r.headers.get("location"), "/p/login");
      assertNoData(r, `${label} ${p}`);
    }
    const ok = await pfetch(worker, s, path, { cookie });
    assert.equal(ok.status, 200, path);
    assert.ok(ok.text.includes(SECRET_TITLE), `${path} shows the seeded row when signed in`);
  }

  clearJwksCache();
  clearNegativeCache();
  const KEY = await keyPair("kid-views");
  await withCerts({ keys: [KEY.jwk] }, async () => {
    const a = accessEnv();
    seedCovered(a);
    const now = Date.now();
    const good = await signJwt(KEY, goodClaims(now));
    const claims = b64url(JSON.stringify(goodClaims(now)));
    const none = `${b64url(JSON.stringify({ alg: "none", kid: KEY.kid, typ: "JWT" }))}.${claims}.`;
    const hsHead = b64url(JSON.stringify({ alg: "HS256", kid: KEY.kid, typ: "JWT" }));
    const hs = `${hsHead}.${claims}.${createHmac("sha256", "not-the-key").update(`${hsHead}.${claims}`).digest("base64url")}`;
    for (const path of ROUTE_PATHS) {
      for (const [label, opts] of [
        ["no JWT", {}],
        ["forged email header", { headers: { "cf-access-authenticated-user-email": EMAIL } }],
        ["CF_Authorization cookie only", { cookie: `CF_Authorization=${good}` }],
        ["wrong AUD", { jwt: await signJwt(KEY, goodClaims(now, { aud: ["other-aud"] })) }],
        ["wrong issuer", { jwt: await signJwt(KEY, goodClaims(now, { iss: "https://example-team-other.cloudflareaccess.com" })) }],
        ["expired", { jwt: await signJwt(KEY, goodClaims(now, { exp: Math.floor(now / 1000) - 600 })) }],
        ["alg none", { jwt: none }],
        ["HS256", { jwt: hs }],
        ["session cookie in Access mode", { cookie: await sessionCookie(a) }],
      ]) {
        const r = await pfetch(worker, a, path, opts);
        assert.equal(r.status, 403, `${label} ${path}`);
        assertNoData(r, `${label} ${path}`);
      }
      const ok = await pfetch(worker, a, path, { jwt: good });
      assert.equal(ok.status, 200, path);
      assert.ok(ok.text.includes(SECRET_TITLE), path);
    }
  });
});

test("G4: through the Worker, one section per covered ticker, every chip links to its company page, and the open is counted", async () => {
  const env = sessionEnv();
  seedCovered(env);
  const cookie = await sessionCookie(env);
  const r = await pfetch(worker, env, "/p/competitors", { cookie });
  assert.equal(r.status, 200);
  assert.equal((r.text.match(/<section data-ticker=/g) || []).length, COVERED.tickers.length);
  for (const t of COVERED.tickers) assert.ok(r.text.includes(`<li><a href="/p/c/${encodeURIComponent(t)}">${t}</a></li>`), t);
  assert.ok((r.text.match(/<article /g) || []).length <= PAGE_CARDS);
  for (const view of ["industry", "rare"]) assert.equal((await pfetch(worker, env, `/p/${view}`, { cookie })).status, 200, view);
  const counted = env.DB.db.prepare("SELECT view, SUM(n) AS n FROM portal_views GROUP BY view ORDER BY view").all().map((x) => [x.view, x.n]);
  assert.deepEqual(counted, [["competitors", 1], ["industry", 1], ["rare", 1]]);
});

test("G4: through the Worker, at most 200 cards a page: once the budget is spent a section shows only '+n more'", async () => {
  const env = sessionEnv();
  const five = COVERED.tickers.slice(0, 5);
  assert.equal(five.length, 5, "five covered tickers");
  for (const t of five) for (let i = 0; i < 60; i++) graded(env, { ticker: t, source_key: "src_synthetic", role: "rival" }, { score: 60 + (i % 30) });
  const r = await pfetch(worker, env, "/p/competitors", { cookie: await sessionCookie(env) });
  assert.equal((r.text.match(/<article /g) || []).length, PAGE_CARDS);
  assert.deepEqual(five.map((t) => (sectionOf(r.text, t).match(/<article /g) || []).length), [50, 50, 50, 50, 0]);
  assert.match(sectionOf(r.text, five[0]), /\+10 more<\/a>/);
  assert.match(sectionOf(r.text, five[4]), /\+60 more<\/a>/);
});

test("V10 (page): with INDUSTRY patched in the bundle (one line), /p/industry shows the declared area with no code change", async () => {
  let replaced = 0;
  const patched = await loadWorker({
    patch: (f, code) => (f !== "rubric.generated.js" ? code
      : code.replace(/^export const INDUSTRY = .*;$/m, () => { replaced++; return `export const INDUSTRY = ${JSON.stringify({ [CT]: { x: { core: true } } })};`; })),
  });
  assert.equal(replaced, 1, "exactly one INDUSTRY line");
  const env = sessionEnv();
  const id = graded(env, { ticker: CT, source_key: "src_synthetic", role: null, url: "https://www.tradepress.example/v10" }, { score: 66, rung: "industry", flags: '["industry:x"]' });
  const cookie = await sessionCookie(env);
  const path = `/p/industry?ticker=${encodeURIComponent(CT)}`;
  const area = await pfetch(patched, env, path, { cookie });
  assert.equal(area.status, 200);
  assert.match(area.text, new RegExp(`<h3>Area x \\(core\\) \\(1\\)</h3>[\\s\\S]*id="i${id}"`));
  const plain = await pfetch(worker, env, path, { cookie });
  assert.doesNotMatch(plain.text, /Area x/, "the bundled INDUSTRY declares no such area");
  assert.ok(plain.text.includes(`id="i${id}"`), "the row is in its kind group instead");
});
