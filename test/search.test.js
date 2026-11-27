// Phase 3 Part D, PR-D1: the search module (worker/src/search.js) and GET /v1/search.
// Synthetic fixtures only: module tests inject their own maps (test/helpers/search-fixtures.js);
// route tests pick a bundled ticker at run time and never write one as a literal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, FakeD1, TOKENS } from "./helpers/worker-env.js";
import { NOW, HOUR, DAY, ago, deps, MUTED_FIX, addCov, gradeCov, addAux, gradeAux, mute, planOf, spy } from "./helpers/search-fixtures.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const S = await import("../worker/src/search.js");
const PH = await import("../worker/src/portal-html.js");
const { MUTED_SQL, mutedSources } = await import("../worker/src/tuning.js");
const { default: COVERED } = await import("../worker/src/covered.json");

const SRC = new URL("../worker/src/", import.meta.url);
const params = (o) => new URLSearchParams(o);
const search = (db, o, over = {}) => S.searchRows({ DB: db }, params(o), deps(over));
const titles = (r) => r.results.map((x) => x.title);
const call = (env, path, headers = {}) => worker.fetch(new Request(`https://zenith.test${path}`, { headers }), env)
  .then(async (res) => ({ status: res.status, headers: res.headers, body: await res.json() }));

// --- S1 -------------------------------------------------------------------------------------
test("S1: /v1/search gives no data without the admin bearer and runs no statement", async () => {
  const d1 = zenithDb();
  await addCov(d1, { title: "Widget order", ticker: COVERED.tickers[0], nm_first_seen: new Date(Date.now() - HOUR).toISOString() });
  const s = spy(d1);
  const env = { DB: s.db, ...TOKENS };
  const path = "/v1/search?q=widget";
  const cases = [
    [{}, 401],
    [{ authorization: `Bearer ${TOKENS.APP_TOKEN}` }, 403],
    [{ authorization: `Bearer ${TOKENS.GRADER_TOKEN}` }, 403],
    [{ authorization: "Bearer not-a-token" }, 401],
    [{ "cf-access-authenticated-user-email": "analyst@example.com" }, 401],
    [{ "cf-access-jwt-assertion": "a.b.c" }, 401],
  ];
  for (const [headers, status] of cases) {
    const r = await call(env, path, headers);
    assert.equal(r.status, status, JSON.stringify(headers));
    assert.equal(r.body.results, undefined);
    assert.deepEqual(r.body, { error: status === 401 ? "unauthorized" : "forbidden" });
  }
  const q = await call(env, `${path}&token=${TOKENS.ADMIN_TOKEN}`);
  assert.equal(q.status, 401, "a token in the query string is never accepted");
  assert.equal(s.calls.prepare, 0, "no statement ran");
});

// --- S2 -------------------------------------------------------------------------------------
test("S2: smoke through the route with the admin token", async () => {
  const d1 = zenithDb();
  const ticker = COVERED.tickers[0];
  await addCov(d1, { title: "Widget order expands", ticker, source_key: "src_synthetic", nm_first_seen: new Date(Date.now() - HOUR).toISOString() });
  await addCov(d1, { title: "Unrelated", ticker, source_key: "src_synthetic", nm_first_seen: new Date(Date.now() - HOUR).toISOString() });
  const r = await call({ DB: d1, ...TOKENS }, "/v1/search?q=widget", { authorization: `Bearer ${TOKENS.ADMIN_TOKEN}` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.body.results.length, 1);
  assert.equal(r.body.results[0].ticker, ticker);
  assert.ok(r.body.cost.statements >= 2);
  assert.equal(r.body.cost.rows_read, 0, "the test D1 has no rows_read");
  const bad = await call({ DB: d1, ...TOKENS }, "/v1/search?q=x", { authorization: `Bearer ${TOKENS.ADMIN_TOKEN}` });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /2 or more/);
});

// --- S3 -------------------------------------------------------------------------------------
test("S3: every searched field is found and hit names it", async () => {
  const d1 = zenithDb();
  const cov = {
    title: await addCov(d1, { title: "Widget news" }),
    headline: await addCov(d1, { headline: "A widget headline" }),
    excerpt: await addCov(d1, { excerpt: "Long text about a widget." }),
    why: await addCov(d1, {}),
    note_hook: await addCov(d1, {}),
  };
  await gradeCov(d1, cov.why, { why: "Because of the widget." });
  await gradeCov(d1, cov.note_hook, { note_hook: "Widget follow-up" });
  const aux = {
    title: await addAux(d1, { title: "Widget launch" }),
    headline: await addAux(d1, { headline: "widget headline" }),
    excerpt: await addAux(d1, { excerpt: "feed text widget", page_excerpt: "page text with nothing relevant in it" }),
    page_excerpt: await addAux(d1, { page_excerpt: "page text widget" }),
    entity_name: await addAux(d1, { entity_key: "gizmo", entity_name: "Widget Works", source_key: "gizmo_feed" }),
    why: await addAux(d1, { entity_key: "gizmo", entity_name: "Gizmo Labs", source_key: "gizmo_feed" }),
    entity: await addAux(d1, { entity_key: "gizmo", entity_name: "Gizmo Labs", source_key: "gizmo_feed" }),
  };
  await gradeAux(d1, aux.why, { entity: "Gizmo Labs", why: "Widget demand." });
  await gradeAux(d1, aux.entity, { entity: "Widget Holdings" });
  // A graded row whose grader entity differs from the stored entity_name that matched.
  const gradedName = await addAux(d1, { entity_key: "gizmo", entity_name: "Widget Works", source_key: "gizmo_feed" });
  await gradeAux(d1, gradedName, { entity: "Gizmo Labs" });
  await addCov(d1, { title: "Nothing here" });
  await addAux(d1, { title: "Nothing here either" });
  const r = await search(d1, { q: "widget" });
  const got = new Map(r.results.map((x) => [`${x.pipeline}:${x.item_id}`, x.hit]));
  for (const [field, id] of Object.entries(cov)) assert.equal(got.get(`coverage:${id}`), field, `coverage ${field}`);
  for (const [field, id] of Object.entries(aux)) assert.equal(got.get(`aux:${id}`), field, `aux ${field}`);
  assert.equal(got.get(`aux:${gradedName}`), "entity_name");
  assert.equal(r.results.length, 13, "rows without the word are not returned");
  for (const x of r.results) assert.match(x.snippet, /widget/i, `${x.pipeline} ${x.hit}: the snippet holds the term`);
  assert.equal(r.results.find((x) => x.pipeline === "aux" && x.item_id === gradedName).snippet, "Widget Works");
  assert.equal(r.results.find((x) => x.pipeline === "aux" && x.item_id === aux.excerpt).snippet, "feed text widget");
});

// --- S4 -------------------------------------------------------------------------------------
test("S4: terms, phrases, LIKE escaping and SQL hygiene", async () => {
  const d1 = zenithDb();
  await addCov(d1, { title: "Acme widget order" });
  await addCov(d1, { title: "Widget for acme" });
  await addCov(d1, { title: "Widget only" });
  await addCov(d1, { title: "Buys a 50% stake" });
  await addCov(d1, { title: "Ships 500 units" });
  await addCov(d1, { title: "Code a_b release" });
  await addCov(d1, { title: "Code axb release" });
  assert.deepEqual(titles(await search(d1, { q: "acme widget" })).sort(), ["Acme widget order", "Widget for acme"]);
  assert.deepEqual(titles(await search(d1, { q: '"acme widget"' })), ["Acme widget order"]);
  assert.equal((await search(d1, { q: "WIDGET" })).results.length, 3);
  assert.deepEqual(titles(await search(d1, { q: "50%" })), ["Buys a 50% stake"]);
  assert.deepEqual(titles(await search(d1, { q: "a_b" })), ["Code a_b release"]);
  const one = await search(d1, { q: "x widget" });
  assert.deepEqual(one.terms, ["widget"]);
  const seven = S.parseQuery(params({ q: "aa bb cc dd ee ff gg" }), deps());
  assert.deepEqual(seven.terms, ["aa", "bb", "cc", "dd", "ee"]);
  assert.deepEqual(seven.ignored_terms, ["ff", "gg"]);
  assert.equal(S.parseQuery(params({ q: "w".repeat(300) }), deps()).terms[0].length, 60);

  const s = spy(d1);
  for (const q of ["", "   ", "a", '""']) {
    const r = await S.searchRows({ DB: s.db }, params({ q }), deps());
    assert.equal(r.error, "q needs a word of 2 or more characters");
  }
  for (const bad of [{ pipeline: "x" }, { sort: "x" }, { status: "x" }, { entity: "Bad Key" }, { source: "bad key" }, { limit: "0" },
    { limit: "101" }, { ticker: "TST", entity: "widgetco" }, { ticker: "TST", pipeline: "aux" }, { entity: "widgetco", pipeline: "coverage" }]) {
    const r = await S.searchRows({ DB: s.db }, params({ q: "widget", ...bad }), deps());
    assert.ok(r.error, JSON.stringify(bad));
  }
  assert.equal(s.calls.prepare, 0, "a parse error runs no statement");

  const tick = ["TST", "ACM", "QQA", "QQB", "QQC"];
  const muted = Array.from({ length: 60 }, (_, k) => `muted_${k}`);
  const shapes = [{ q: "widget" }, { q: "widget", sort: "newest", cc: "2026-06-01T00:00:00.000Z~5", ca: "2026-06-01T00:00:00Z~7" },
    { q: "widget", ticker: "TST" }, { q: "widget", entity: "widgetco" }, { q: "widget", source: "tst_ir", status: "graded" },
    { q: tick.join(" ") }];
  for (const o of shapes) {
    for (const keys of [[], ["k1"], muted]) {
      const q = S.parseQuery(params(o), deps({ tickers: tick }));
      q.mutedKeys = keys;
      for (const st of S.buildStatements(q, deps({ tickers: tick }))) {
        assert.doesNotMatch(st.sql, /\?(?!\d)/, "no anonymous placeholder");
        const used = new Set([...st.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
        assert.deepEqual([...used].sort((a, b) => a - b), st.binds.map((_, k) => k + 1), "every bind is used, numbered 1..n");
        assert.ok(st.binds.length <= 77);
      }
    }
  }
  const q = S.parseQuery(params({ q: tick.join(" "), sort: "newest", cc: "2026-06-01T00:00:00.000Z~5" }), deps({ tickers: tick }));
  q.mutedKeys = muted;
  const [cov] = S.buildStatements(q, deps({ tickers: tick }));
  assert.equal(cov.binds.length, 4 + 5 + 5 + 2 + 60, "60 muted keys and 5 ticker terms stay under D1's 100");
});

// --- S5 -------------------------------------------------------------------------------------
test("S5: the window: from is in, to is out; long unscoped spans fall back to 30 days", async () => {
  const d1 = zenithDb();
  const from = ago(7 * DAY), to = new Date(NOW).toISOString();
  await addCov(d1, { title: "Widget at from", nm_first_seen: from });
  await addCov(d1, { title: "Widget at to", nm_first_seen: to });
  await addCov(d1, { title: "Widget before", nm_first_seen: ago(7 * DAY + 1) });
  const r = await search(d1, { q: "widget", range: "7d" });
  assert.equal(r.range.key, "7d");
  assert.equal(r.range.fromIso, from);
  assert.equal(r.range.toIso, to);
  assert.equal(r.range.fell_back, false);
  assert.deepEqual(titles(r), ["Widget at from"]);

  const def = await search(d1, { q: "widget" });
  assert.equal(def.range.key, "30d");
  assert.equal(def.range.fell_back, false);
  const long = { q: "widget", start: "2026-02-15", end: "2026-06-14" };
  const un = await search(d1, long);
  assert.equal(un.range.key, "30d");
  assert.equal(un.range.fell_back, true);
  const scoped = await search(d1, { ...long, ticker: "TST" });
  assert.equal(scoped.range.key, "custom");
  assert.equal(scoped.range.fell_back, false);
  assert.ok(scoped.range.days > 90);
  assert.equal((await search(d1, { q: "widget", range: "1y" })).range.key, "30d", "1y is over the unscoped maximum");
  assert.equal((await search(d1, { q: "widget", range: "90d" })).range.key, "90d");
  assert.equal((await search(d1, { q: "widget", range: "1y", ticker: "TST" })).range.key, "1y");
  // The range is Part A's parseRange (portal-html.js): the same keys, labels and window.
  const partA = (params, maxDays) => PH.parseRange(new URL(`https://x.invalid/?${new URLSearchParams(params)}`), { now: NOW, def: "30d", maxDays });
  for (const [params, got, maxDays] of [[{ range: "7d" }, r, 90], [{}, def, 90], [long, scoped, 400]]) {
    const want = partA(params, maxDays);
    assert.deepEqual([got.range.key, got.range.label, got.range.fromIso, got.range.toIso, got.range.days],
      [want.key, want.label, want.fromIso, want.toIso, want.days], JSON.stringify(params));
  }
  assert.equal(def.range.label, PH.RANGE_PRESETS.find(([k]) => k === "30d")[2], "Part A's preset label");
  assert.match(scoped.range.label, /–/, "Part A's custom label (an en dash)");
  // A custom deps.parseRange overrides it.
  const seen = [];
  const pr = (url, opts) => { seen.push([url.searchParams.get("q"), opts]); return { key: "7d", fromIso: from, toIso: to, label: "x", days: 7 }; };
  await search(d1, { q: "widget", ticker: "TST" }, { parseRange: pr });
  assert.deepEqual(seen, [["widget", { now: NOW, def: "30d", maxDays: 400 }]]);
});

// --- S6 -------------------------------------------------------------------------------------
test("S6: universe, mute, duplicate and an undated lead", async () => {
  const d1 = zenithDb();
  await addCov(d1, { title: "Widget out of universe", ticker: "ZZQ" });
  await addCov(d1, { title: "Widget muted", source_key: "src_quiet" });
  await addAux(d1, { title: "Widget muted aux", source_key: "src_quiet" });
  const dup = await addCov(d1, { title: "Widget duplicate" });
  await gradeCov(d1, dup, { score: null, band: "duplicate" });
  const adup = await addAux(d1, { title: "Widget aux duplicate" });
  await gradeAux(d1, adup, { score: null, band: "duplicate" });
  const undated = await addCov(d1, { title: "Widget undated lead", published: null });
  await gradeCov(d1, undated, { score: 95 });
  const dated = await addCov(d1, { title: "Widget dated lead" });
  await gradeCov(d1, dated, { score: 95 });
  await mute(d1, "src_quiet");
  const r = await search(d1, { q: "widget" });
  assert.deepEqual(titles(r).sort(), ["Widget dated lead", "Widget undated lead"]);
  assert.equal(r.results.find((x) => x.item_id === undated).band, "digest");
  assert.equal(r.results.find((x) => x.item_id === dated).band, "lead");
});

test("S6b: the muted list is its own query, equal to tuning.js mutedSources; over 60 keys uses deps.muted", async () => {
  const d1 = zenithDb();
  assert.deepEqual(await S.searchMutedKeys(d1), { keys: [], rows_read: 0 });
  for (const k of ["src_a", "src_b", "src_c"]) await mute(d1, k);
  await d1.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('src_d', 'demote', 'x')").run();
  assert.deepEqual(new Set((await S.searchMutedKeys(d1)).keys), await mutedSources(d1));
  assert.deepEqual(await S.searchMutedKeys(new FakeD1()), { keys: [], rows_read: 0 }, "no table mutes nothing");

  for (let k = 0; k < 61; k++) await mute(d1, `src_many_${k}`);
  assert.deepEqual(new Set((await S.searchMutedKeys(d1)).keys), await mutedSources(d1));
  await addCov(d1, { title: "Widget muted", source_key: "src_many_60" });
  await addAux(d1, { title: "Widget muted aux", source_key: "src_many_3" });
  await addCov(d1, { title: "Widget shown" });
  assert.deepEqual(titles(await search(d1, { q: "widget" }, { muted: MUTED_SQL })), ["Widget shown"]);
  await assert.rejects(search(d1, { q: "widget" }, { muted: undefined }), /deps\.muted/);
});

// --- S7 -------------------------------------------------------------------------------------
test("S7: held and skipped rows are found and labelled; status=graded drops them", async () => {
  const d1 = zenithDb();
  const held = await addCov(d1, { title: "Widget held", admit: "seed_window" });
  const skipped = await addCov(d1, { title: "Widget skipped", state: "skipped", skip_reason: "stale_on_arrival" });
  const waiting = await addAux(d1, { title: "Widget waiting" });
  const graded = await addCov(d1, { title: "Widget graded" });
  await gradeCov(d1, graded, { score: 75 });
  const r = await search(d1, { q: "widget" });
  const st = (id, p = "coverage") => r.results.find((x) => x.item_id === id && x.pipeline === p);
  assert.equal(st(held).status, "held");
  assert.equal(st(skipped).status, "skipped");
  assert.equal(st(skipped).skip_reason, "stale_on_arrival");
  assert.equal(st(waiting, "aux").status, "waiting");
  assert.equal(st(graded).status, "graded");
  assert.equal(r.results.at(-1).item_id, skipped, "skipped ranks last");
  assert.deepEqual(titles(await search(d1, { q: "widget", status: "graded" })), ["Widget graded"]);
});

// --- S8 -------------------------------------------------------------------------------------
test("S8: one news-monitor row in both pipelines shows once, by state", async () => {
  const d1 = zenithDb();
  const pair = async (word, cov, aux) => {
    const nm_rowid = 900_000 + word.length * 7 + word.charCodeAt(0);
    const c = await addCov(d1, { nm_rowid, title: `Twin ${word}`, ...cov.over });
    const a = await addAux(d1, { nm_rowid, title: `Twin ${word}`, ...aux.over });
    if (cov.grade) await gradeCov(d1, c, { score: 60 });
    if (aux.grade) await gradeAux(d1, a, { score: 60 });
    const r = await search(d1, { q: word });
    assert.equal(r.results.length, 1, word);
    return r.results[0].pipeline;
  };
  assert.equal(await pair("alphaq", { over: {} }, { over: {}, grade: true }), "aux", "coverage waiting, aux graded");
  assert.equal(await pair("bravoq", { over: {}, grade: true }, { over: {}, grade: true }), "coverage", "both graded");
  assert.equal(await pair("charlieq", { over: { state: "skipped", skip_reason: "stale" } }, { over: {} }), "aux", "coverage skipped, aux waiting");
  assert.equal(await pair("deltaqq", { over: { state: "skipped", skip_reason: "stale" } }, { over: { state: "skipped", skip_reason: "stale" } }),
    "coverage", "both skipped");
});

test("S8b: sort=best keeps the higher-ranked copy of a row graded in both pipelines", async () => {
  // One news-monitor row graded Reject on coverage and Lead on aux, behind 50 newer
  // coverage Borderline matches: the Reject copy ranks 51st, so keeping it would
  // drop the Lead from the results altogether.
  const d1 = zenithDb();
  const nm_rowid = 950_001;
  const at = ago(5 * DAY);
  const cov = await addCov(d1, { nm_rowid, title: "Sprocket twin", nm_first_seen: at });
  await gradeCov(d1, cov, { score: 10 });
  const aux = await addAux(d1, { nm_rowid, title: "Sprocket twin", nm_first_seen: at });
  await gradeAux(d1, aux, { score: 91 });
  for (let k = 0; k < 50; k++) await gradeCov(d1, await addCov(d1, { title: `Sprocket note ${k}`, nm_first_seen: ago(k * HOUR + HOUR) }), { score: 50 });
  const r = await search(d1, { q: "sprocket" });
  assert.equal(r.results.length, 50);
  assert.deepEqual([r.results[0].pipeline, r.results[0].item_id, r.results[0].band], ["aux", aux, "lead"], "the Lead copy is kept and ranks first");
  assert.ok(!r.results.some((x) => x.pipeline === "coverage" && x.item_id === cov), "the Reject copy is dropped");

  // The same pair alone, both ways round: best keeps the higher tier; equal rank goes to coverage.
  const d2 = zenithDb();
  const pair = async (rowid, covScore, auxScore) => {
    const c = await addCov(d2, { nm_rowid: rowid, title: `Cog twin ${rowid}`, nm_first_seen: at });
    await gradeCov(d2, c, { score: covScore });
    const a = await addAux(d2, { nm_rowid: rowid, title: `Cog twin ${rowid}`, nm_first_seen: at });
    await gradeAux(d2, a, { score: auxScore });
    const best = await search(d2, { q: `twin ${rowid}` });
    const newest = await search(d2, { q: `twin ${rowid}`, sort: "newest" });
    assert.equal(best.results.length, 1);
    assert.equal(newest.results.length, 1);
    return [best.results[0].pipeline, newest.results[0].pipeline];
  };
  assert.deepEqual(await pair(950_002, 10, 91), ["aux", "coverage"], "best keeps the aux Lead; newest is unchanged (graded tie to coverage)");
  assert.deepEqual(await pair(950_003, 91, 10), ["coverage", "coverage"], "best keeps the coverage Lead");
  assert.deepEqual(await pair(950_004, 50, 55), ["coverage", "coverage"], "same tier: coverage");

  // Same tier, the aux copy has the stronger hit (headline or grader entity), the
  // coverage copy an excerpt hit only: the state rule decides, ties to coverage.
  const d3 = zenithDb();
  const twin = async (rowid, cov, aux, gCov, gAux, q) => {
    const c = await addCov(d3, { nm_rowid: rowid, nm_first_seen: at, ...cov });
    await gradeCov(d3, c, gCov);
    const a = await addAux(d3, { nm_rowid: rowid, nm_first_seen: at, ...aux });
    await gradeAux(d3, a, gAux);
    const r = await search(d3, { q });
    assert.equal(r.results.length, 1, q);
    return [r.results[0].pipeline, r.results[0].item_id === c];
  };
  assert.deepEqual(await twin(950_005, { title: "Twin story", excerpt: "about plainco deal" }, { title: "Twin story" },
    { score: 91 }, { score: 91, entity: "Plainco" }, "plainco"), ["coverage", true], "both Lead, aux entity hit: coverage");
  assert.deepEqual(await twin(950_006, { title: "Other story", excerpt: "a sprocket order" }, { title: "Other story", headline: "Sprocket win" },
    { score: 75 }, { score: 80 }, "sprocket"), ["coverage", true], "both Digest, aux headline hit: coverage");
});

// --- S9 -------------------------------------------------------------------------------------
test("S9: ranking finds an old Lead behind many newer skipped matches", async () => {
  const d1 = zenithDb();
  const lead = await addCov(d1, { title: "Widget contract", nm_first_seen: ago(60 * DAY) });
  await gradeCov(d1, lead, { score: 92 });
  for (let k = 0; k < 250; k++) await addCov(d1, { title: `Widget mention ${k}`, state: "skipped", skip_reason: "stale", nm_first_seen: ago(k * HOUR + HOUR) });
  const r = await search(d1, { q: "widget", range: "90d" });
  assert.equal(r.results[0].item_id, lead);
  assert.equal(r.results.length, 50);
  assert.equal(r.truncated.coverage, true);
  assert.equal(r.truncated.aux, false);

  const d2 = zenithDb();
  const ids = {};
  ids.skipped = await addCov(d2, { title: "Gadget skipped", state: "skipped", skip_reason: "stale", nm_first_seen: ago(1 * HOUR) });
  ids.waiting = await addAux(d2, { title: "Gadget waiting", nm_first_seen: ago(2 * HOUR) });
  ids.reject = await addCov(d2, { title: "Gadget reject", nm_first_seen: ago(3 * HOUR) });
  await gradeCov(d2, ids.reject, { score: 10 });
  ids.borderline_ex = await addCov(d2, { title: "Other", excerpt: "about a gadget", nm_first_seen: ago(4 * HOUR) });
  await gradeCov(d2, ids.borderline_ex, { score: 50 });
  ids.borderline = await addCov(d2, { title: "Gadget borderline", nm_first_seen: ago(5 * HOUR) });
  await gradeCov(d2, ids.borderline, { score: 50 });
  ids.lead = await addAux(d2, { title: "Gadget lead", nm_first_seen: ago(6 * HOUR) });
  await gradeAux(d2, ids.lead, { score: 91 });
  const o = await search(d2, { q: "gadget" });
  assert.deepEqual(o.results.map((x) => x.item_id),
    [ids.lead, ids.borderline, ids.borderline_ex, ids.reject, ids.waiting, ids.skipped], "tier order; a title hit beats an excerpt hit");
  assert.equal(o.cursors, null);
});

// --- S10 ------------------------------------------------------------------------------------
test("S10: newest paging over shared timestamps shows every row exactly once", async () => {
  const d1 = zenithDb();
  const batch = ago(2 * DAY);
  for (let k = 0; k < 120; k++) await addCov(d1, { title: `Widget c${k}`, nm_first_seen: batch });
  for (let k = 0; k < 80; k++) await addAux(d1, { title: `Widget a${k}`, nm_first_seen: batch });
  for (let k = 0; k < 15; k++) await addCov(d1, { title: `Widget cx${k}`, nm_first_seen: ago(k * 7 * HOUR + HOUR) });
  for (let k = 0; k < 15; k++) await addAux(d1, { title: `Widget ax${k}`, nm_first_seen: ago(k * 9 * HOUR + 2 * HOUR) });
  const seen = [];
  let cur = {};
  for (let page = 0; page < 20; page++) {
    const r = await search(d1, { q: "widget", sort: "newest", limit: "50", ...cur });
    assert.ok(r.results.length <= 50);
    seen.push(...r.results);
    if (!r.cursors) break;
    cur = Object.fromEntries(Object.entries(r.cursors).filter(([, v]) => v !== null));
  }
  const keys = seen.map((x) => `${x.pipeline}:${x.item_id}`);
  assert.equal(keys.length, 230);
  assert.equal(new Set(keys).size, 230, "no row repeats");
  for (const p of ["coverage", "aux"]) {
    const rows = seen.filter((x) => x.pipeline === p);
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1], b = rows[k];
      assert.ok(a.first_seen > b.first_seen || (a.first_seen === b.first_seen && a.item_id > b.item_id), `${p} order at ${k}`);
    }
  }
  // Copies in both pipelines on one timestamp: every news-monitor row is shown exactly once
  // (while both copies are fetched on one page; copies on different pages are §13's case).
  for (const limit of ["5", "3"]) {
    const d2 = zenithDb();
    const at = ago(3 * DAY);
    const rowids = [];
    for (let k = 0; k < 8; k++) {
      const nm_rowid = 700_000 + k;
      rowids.push(nm_rowid);
      await addCov(d2, { nm_rowid, title: `Widget c${k}`, nm_first_seen: at });
      if (k >= 5) await gradeAux(d2, await addAux(d2, { nm_rowid, title: `Widget c${k}`, nm_first_seen: at }), { score: 60 });
    }
    const shown = [];
    let c = {};
    for (let page = 0; page < 30; page++) {
      const r = await search(d2, { q: "widget", sort: "newest", limit, ...c });
      shown.push(...r.results);
      if (!r.cursors) break;
      c = Object.fromEntries(Object.entries(r.cursors).filter(([, v]) => v !== null));
    }
    const nm = new Map((await d2.prepare("SELECT 'coverage' AS p, id, nm_rowid FROM items UNION ALL SELECT 'aux', id, nm_rowid FROM aux_items")
      .all()).results.map((x) => [`${x.p}:${x.id}`, x.nm_rowid]));
    const got = shown.map((x) => nm.get(`${x.pipeline}:${x.item_id}`)).sort((a, b) => a - b);
    assert.deepEqual(got, rowids, `limit ${limit}: every nm_rowid exactly once`);
    assert.ok(shown.filter((x) => x.pipeline === "aux").length === 3, `limit ${limit}: the graded aux copies are the ones shown`);
  }

  const s = spy(d1);
  for (const cc of ["2026-06-01~5", "x", "2026-06-01T00:00:00.000Z~", "2026-06-01T00:00:00.000Z~1234567890"]) {
    const r = await S.searchRows({ DB: s.db }, params({ q: "widget", sort: "newest", cc }), deps());
    assert.ok(r.error, cc);
  }
  assert.equal(s.calls.prepare, 0);
  const done = await search(d1, { q: "widget", sort: "newest", cc: "end", ca: "end" });
  assert.deepEqual(done.results, []);
  assert.equal(done.cursors, null);
  assert.equal(done.cost.statements, 1, "only the muted list runs");
});

// --- S11 ------------------------------------------------------------------------------------
test("S11: ticker, entity, source and pipeline scopes", async () => {
  const d1 = zenithDb();
  const own = await addCov(d1, { title: "Widget own", ticker: "TST" });
  const other = await addCov(d1, { title: "Widget cross", ticker: "ACM", source_key: "acm_ir" });
  await gradeCov(d1, other, { score: 60 });
  await gradeCov(d1, other, { ticker: "TST", score: 80 });
  await addCov(d1, { title: "Widget not TST", ticker: "ACM", source_key: "acm_ir" });
  await addAux(d1, { title: "Widget aux one" });
  await addAux(d1, { title: "Widget aux two", entity_key: "gizmo", entity_name: "Gizmo Labs", source_key: "gizmo_feed" });

  const t = await search(d1, { q: "widget", ticker: "tst" });
  assert.equal(t.pipeline, "coverage");
  assert.deepEqual(t.results.map((x) => x.item_id).sort((a, b) => a - b), [own, other]);
  assert.equal(t.results.find((x) => x.item_id === other).also_graded_for, "TST");
  assert.equal(t.results.find((x) => x.item_id === own).also_graded_for, undefined);
  assert.ok(t.results.every((x) => x.pipeline === "coverage"));
  assert.equal(t.cost.statements, 3, "muted list, the coverage statement and labels: no aux statement");
  const tq = S.parseQuery(params({ q: "widget", ticker: "TST" }), deps());
  assert.deepEqual(S.buildStatements(tq, deps()).map((s) => s.pipeline), ["coverage"]);
  assert.match((await search(d1, { q: "widget", ticker: "ZZQ" })).error, /covered ticker/);

  const e = await search(d1, { q: "widget", entity: "gizmo" });
  assert.deepEqual(titles(e), ["Widget aux two"]);
  assert.equal(e.cost.statements, 3, "muted list, the aux statement and labels: coverage not run");
  assert.deepEqual(titles(await search(d1, { q: "widget", source: "acm_ir" })).sort(), ["Widget cross", "Widget not TST"]);
  const a = await search(d1, { q: "widget", pipeline: "aux" });
  assert.deepEqual(titles(a).sort(), ["Widget aux one", "Widget aux two"]);
  assert.equal(a.cost.statements, 3);
});

// --- S12 ------------------------------------------------------------------------------------
test("S12: a covered ticker as a term finds rows that never spell it", async () => {
  const d1 = zenithDb();
  const id = await addCov(d1, { title: "Quarterly order", ticker: "TST" });
  await addCov(d1, { title: "Other order", ticker: "ACM", source_key: "acm_ir" });
  const r = await search(d1, { q: "tst" });
  assert.deepEqual(r.results.map((x) => x.item_id), [id]);
  assert.equal(r.results[0].hit, "ticker");
});

// --- S13 ------------------------------------------------------------------------------------
test("S13: the names block reads nothing", async () => {
  const d1 = zenithDb();
  const s = spy(d1);
  const n = S.nameMatches("robotics", deps());
  assert.deepEqual(n.companies, [{ ticker: "TST", name: "Test Robotics, Inc." }]);
  assert.equal(s.calls.prepare, 0);
  assert.deepEqual(S.nameMatches("acm", deps()).companies.map((c) => c.ticker), ["ACM"], "a whole-query ticker");
  const w = S.nameMatches("widgetco", deps());
  assert.deepEqual(w.names, [{ entity_key: "widgetco", name: "Widgetco", sources: ["widgetco_news", "widgetco_filings"] }]);
  assert.deepEqual(w.sources, ["widgetco_filings", "widgetco_news"]);
  const r = await search(d1, { q: "robotics" });
  assert.deepEqual(r.companies.map((c) => c.ticker), ["TST"]);
});

// --- S14 ------------------------------------------------------------------------------------
test("S14: query plans of the built SQL", () => {
  const d1 = zenithDb();
  const stmts = (o, keys = ["k1", "k2", "k3"], over = {}) => {
    const q = S.parseQuery(params(o), deps(over));
    q.mutedKeys = keys;
    return Object.fromEntries(S.buildStatements(q, deps(over)).map((s) => [s.pipeline, s]));
  };
  const best = stmts({ q: "widget acme" });
  const cb = planOf(d1, best.coverage), ab = planOf(d1, best.aux);
  assert.match(cb, /SEARCH i USING INDEX idx_items_seen \(nm_first_seen>\? AND nm_first_seen<\?\)/);
  assert.doesNotMatch(cb, /SCAN i\b/);
  assert.match(cb, /SEARCH g USING INTEGER PRIMARY KEY/);
  assert.match(ab, /SEARCH a USING INDEX aux_items_seen \(nm_first_seen>\? AND nm_first_seen<\?\)/);
  assert.doesNotMatch(ab, /SCAN a\b/);
  for (const o of [{ q: "widget", sort: "newest" },
    { q: "widget", sort: "newest", cc: "2026-06-01T00:00:00.000Z~5", ca: "2026-06-01T00:00:00Z~7" }]) {
    const n = stmts(o);
    for (const p of ["coverage", "aux"]) {
      const plan = planOf(d1, n[p]);
      assert.doesNotMatch(plan, /USE TEMP B-TREE/, `${p} newest`);
      assert.match(plan, p === "coverage" ? /idx_items_seen/ : /aux_items_seen/);
    }
  }
  const g = stmts({ q: "widget", status: "graded" });
  assert.match(planOf(d1, g.coverage), /idx_items_seen \(nm_first_seen>\? AND nm_first_seen<\?\)/, "status=graded keeps the window");
  assert.doesNotMatch(planOf(d1, g.coverage), /idx_items_state/);
  assert.match(planOf(d1, g.aux), /aux_items_(seen|state) \((state=\? AND )?nm_first_seen>\? AND nm_first_seen<\?\)/);
  const t = planOf(d1, stmts({ q: "widget", ticker: "TST" }).coverage);
  assert.match(t, /idx_items_ticker/);
  assert.match(t, /idx_grades_ticker/);
  assert.match(planOf(d1, stmts({ q: "widget", entity: "widgetco" }).aux), /aux_items_entity \(entity_key=\?\)/);
  const src = stmts({ q: "widget", source: "tst_ir" });
  assert.match(planOf(d1, src.coverage), /idx_items_source \(source_key=\?\)/);
  assert.match(planOf(d1, src.aux), /aux_items_source \(source_key=\?\)/);
  // status=graded under a scope keeps the scope's own index (not aux_items_state over 400 days).
  for (const sort of ["best", "newest"]) {
    const eg = planOf(d1, stmts({ q: "widget", entity: "widgetco", status: "graded", sort }).aux);
    assert.match(eg, /aux_items_entity \(entity_key=\?\)/, `entity graded ${sort}`);
    assert.doesNotMatch(eg, /aux_items_state/);
    const sg = stmts({ q: "widget", source: "tst_ir", status: "graded", sort });
    assert.match(planOf(d1, sg.aux), /aux_items_source \(source_key=\?\)/, `source graded ${sort}`);
    assert.doesNotMatch(planOf(d1, sg.aux), /aux_items_state/);
    assert.match(planOf(d1, sg.coverage), /idx_items_source \(source_key=\?\)/, `coverage source graded ${sort}`);
  }
  for (const keys of [[], ["k1", "k2", "k3"]]) {
    for (const s of Object.values(stmts({ q: "widget" }, keys))) assert.doesNotMatch(s.sql, /source_prefs/);
  }
  const many = Array.from({ length: 61 }, (_, k) => `k${k}`);
  for (const s of Object.values(stmts({ q: "widget" }, many, { muted: MUTED_SQL }))) assert.ok(s.sql.includes(`NOT IN ${MUTED_SQL}`));
  assert.equal(MUTED_FIX, MUTED_SQL, "the fixture fragment is tuning.js's");
});

// --- S15 ------------------------------------------------------------------------------------
test("S15: searching writes nothing", async () => {
  const d1 = zenithDb();
  const id = await addCov(d1, { title: "Widget graded" });
  await gradeCov(d1, id, { score: 80 });
  await d1.prepare("INSERT INTO feedback (item_id, label, grade_id, ticker, created_at) VALUES (?, 'high', NULL, 'TST', 'x')").bind(id).run();
  const a = await addAux(d1, { title: "Widget aux" });
  await d1.prepare("INSERT INTO aux_feedback (item_id, label, created_at) VALUES (?, 'noise', 'x')").bind(a).run();
  const changes = () => d1.db.prepare("SELECT total_changes() AS n").get().n;
  const before = changes();
  let last;
  for (let k = 0; k < 10; k++) last = await search(d1, { q: "widget", sort: k % 2 ? "newest" : "best" });
  assert.equal(changes(), before);
  assert.equal(last.results.find((x) => x.pipeline === "coverage").label, "high", "labels shown");
  assert.equal(last.results.find((x) => x.pipeline === "aux").label, "noise");
  assert.equal(last.cost.statements, 4, "muted list, two search statements, labels");

  // feedback and aux_feedback have separate id sequences: many coverage relabels
  // (higher ids) do not push an aux label out of the cap.
  const d2 = zenithDb();
  const c2 = await addCov(d2, { title: "Widget relabelled" });
  const a2 = await addAux(d2, { title: "Widget aux labelled" });
  await d2.prepare("INSERT INTO aux_feedback (item_id, label, created_at) VALUES (?, 'noise', 'x')").bind(a2).run();
  for (let k = 0; k < 230; k++) {
    await d2.prepare("INSERT INTO feedback (item_id, label, grade_id, ticker, created_at) VALUES (?, ?, NULL, 'TST', 'x')")
      .bind(c2, k === 229 ? "high" : "noise").run();
  }
  const many = await search(d2, { q: "widget" });
  assert.equal(many.results.find((x) => x.pipeline === "aux").label, "noise", "the aux label survives");
  assert.equal(many.results.find((x) => x.pipeline === "coverage").label, "high", "the latest coverage label wins");
  assert.equal(many.cost.statements, 4, "labels stay one statement");
});

// --- S16 ------------------------------------------------------------------------------------
test("S16: no query text in logs, and no forbidden import", async () => {
  const d1 = zenithDb();
  const s = spy(d1, { throwOnPrepare: true });
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...args) => logged.push(...args);
  let r;
  try {
    r = await call({ DB: s.db, ...TOKENS }, "/v1/search?q=PRIVATE-QUERY-XYZ", { authorization: `Bearer ${TOKENS.ADMIN_TOKEN}` });
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "search failed" });
  assert.ok(logged.length > 0);
  for (const a of logged) assert.ok(!String(a?.stack ?? a).includes("PRIVATE-QUERY-XYZ") && !JSON.stringify(a ?? null).includes("PRIVATE-QUERY-XYZ"));

  // Transitive import walk from search.js (the portal walk, Part A S18, will include it).
  const reached = new Set();
  const walk = (f) => {
    if (reached.has(f)) return;
    reached.add(f);
    const code = readFileSync(new URL(f, SRC), "utf8");
    for (const m of code.matchAll(/^\s*import\s[^;]*?from\s+"\.\/([^"]+)"/gm)) if (m[1].endsWith(".js")) walk(m[1]);
  };
  walk("search.js");
  for (const bad of ["delivery.js", "discord.js", "budget.js", "excerpt.js", "tuning.js", "auxiliary.js", "index.js", "brief.js", "ingest.js"]) {
    assert.ok(!reached.has(bad), `search.js reaches ${bad}`);
  }
  for (const f of reached) assert.doesNotMatch(readFileSync(new URL(f, SRC), "utf8"), /env\.NEWS/, f);
  const code = readFileSync(new URL("search.js", SRC), "utf8");
  assert.doesNotMatch(code, /console\.log/);
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|REPLACE)\s/i, "search.js holds no write statement");
});

// --- S17 ------------------------------------------------------------------------------------
test("S17: Workers observability stays off for zenith-core (URLs carry q)", () => {
  const toml = readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
  assert.doesNotMatch(toml, /^\s*\[observability[\].]/m);
  assert.doesNotMatch(toml, /^\s*observability\s*=/m);
});

// --- highlight ------------------------------------------------------------------------------
test("highlight: segments on the raw text, case-insensitive, overlapping terms merged", () => {
  assert.deepEqual(S.highlight("A & B amplifier", ["amp"]), [{ text: "A & B ", mark: false }, { text: "amp", mark: true }, { text: "lifier", mark: false }]);
  assert.deepEqual(S.highlight("Widget WIDGET", ["widget"]).filter((x) => x.mark).map((x) => x.text), ["Widget", "WIDGET"]);
  assert.deepEqual(S.highlight("abcdef", ["abc", "cde"]), [{ text: "abcde", mark: true }, { text: "f", mark: false }]);
  assert.deepEqual(S.highlight("", ["x"]), []);
  assert.equal(S.highlight("it's 39", ["39"]).map((x) => x.text).join(""), "it's 39");
});
