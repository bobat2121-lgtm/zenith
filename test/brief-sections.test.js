// Phase 3 Part E (PR-E2): the brief's competitor and industry sections
// (worker/src/brief-sections.js) and the full brief (buildBrief sections:
// "full", GET /v1/brief?sections=full). Synthetic fixtures only: ticker TST
// (and OTH), example.com urls, and relations injected through
// loadRelations(deps), so no bundled name, key or count is written here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { D1, addItem, addGrade } from "./helpers/d1.js";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { loadRelations } = await import("../worker/src/relations.js");
const { briefSections, registerReadings, AUX_MUTED_SQL, AUX_RIVAL_TWIN_SQL, Q5_SQL, FLOOR, BELOW_N } = await import("../worker/src/brief-sections.js");
const { buildBrief, renderBrief } = await import("../worker/src/brief.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");
const { rivalOnCoverageSql } = await import("../worker/src/lib.js");
const { default: worker } = await import("../worker/src/index.js");

const FROM = "2026-01-05T12:00:00.000Z";
const TO = "2026-01-06T12:00:00.000Z";
const IN = "2026-01-06T03:00:00.000Z";
const COVERED = { tickers: ["TST", "OTH"] };

// Synthetic relations: acme is a peer of TST (+); widget_sec is a TST rival
// source key (rivals.json style) whose aux entity is widget; cust_twin is a
// customer counterparty of TST whose entity (acme_cust) is also a peer;
// acme_rival is a rival counterparty of TST whose aux entity is the peer acme.
const AUX_FIX = {
  sources: {
    acme_pr: { entity: "acme", name: "Acme news", status: "private" },
    acme_rival: { entity: "acme", name: "Acme rival feed", status: "private" },
    widget_sec: { entity: "widget", name: "Widget filings", status: "public", sec: true },
    widget_news: { entity: "widget", name: "Widget news", status: "public" },
    prog_src: { entity: "program_x", name: "Program X", status: "program" },
    media_src: { entity: "trade_mag", name: "Trade Mag", status: "media" },
    cust_twin: { entity: "acme_cust", name: "Acme Customer mentions", status: "public", coverage_subject: true, affects: ["TST"] },
    far_src: { entity: "faraway", name: "Faraway news", status: "private" },
  },
};
const rel = loadRelations({
  relations: {
    basis: "files",
    peers: {
      acme: { name: "Acme (private)", status: "private", reads: [{ ticker: "TST", direction: "+" }] },
      acme_cust: { name: "Acme Customer", status: "public", reads: [{ ticker: "TST", direction: "-" }] },
      faraway: { name: "Faraway Co", status: "private", reads: [{ ticker: "ZZZ", direction: "-" }] },
    },
    rivals: { TST: ["widget_sec"] },
    key_accounts: {},
  },
  version: "rel-test",
  covered: { tickers: ["TST", "OTH"], counterparty: { cust_twin: { role: "customer", affects: ["TST"] }, acme_rival: { role: "rival", affects: ["TST"] } } },
  aux: AUX_FIX,
  match: {},
  industry: {},
  isRecordSource: () => false,
});

let rowid = 50_000;
async function addAux(db, item = {}, grade = {}) {
  const i = {
    nm_rowid: rowid++, source_key: "acme_pr", entity_key: "acme", entity_name: "Acme", status: "private", url: `https://example.com/a/${rowid}`,
    title: "Aux title", nm_first_seen: IN, ingested_at: IN, state: "graded", coverage_subject: 0, affects: null, admit: null, released_at: null, ...item,
  };
  const r = await db.prepare(
    `INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state, coverage_subject, affects, admit, released_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(i.nm_rowid, i.source_key, i.entity_key, i.entity_name, i.status, i.url, i.title, i.nm_first_seen, i.ingested_at, i.state,
    i.coverage_subject, i.affects, i.admit, i.released_at).run();
  const id = r.meta.last_row_id;
  if (grade === null) return { id, nm_rowid: i.nm_rowid };
  const g = { score: 80, band: null, why: "why text", reads_through: "[]", graded_at: IN, ...grade };
  if (!g.band) g.band = g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
  const gr = await db.prepare(
    `INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).bind(id, `run-${id}`, i.entity_name, g.score, g.band, g.why, typeof g.reads_through === "string" ? g.reads_through : JSON.stringify(g.reads_through), g.graded_at).run();
  await db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").bind(gr.meta.last_row_id, id).run();
  return { id, nm_rowid: i.nm_rowid };
}

const ids = (list) => list.map((x) => x.item_id);
const sections = (db, over = {}) => briefSections({ DB: db, NEWS: over.NEWS ?? seriesDb([]) }, COVERED, { from: FROM, to: TO, graded: over.graded || [], rel, aux: AUX_FIX });

test("brief sections: a peer's aux grade 80 lists under TST with the relations sign; a program-source grade 75 lists under Industry with its reads_through ticker", async () => {
  const db = new D1();
  const peer = await addAux(db, { title: "Acme wins a large order" }, { score: 80, reads_through: [{ ticker: "TST", direction: "-" }] });
  const prog = await addAux(db, { source_key: "prog_src", entity_key: "program_x", entity_name: "Program X", status: "program", title: "Program X budget" },
    { score: 75, reads_through: [{ ticker: "OTH", direction: "+" }] });
  const { competitors: c, industry: s } = await sections(db);
  assert.deepEqual(c.by_ticker.map((g) => [g.ticker, ids(g.items), g.items.map((x) => x.direction)]), [["TST", [peer.id], ["+"]]],
    "the relations sign (+) wins over the grade's own sign");
  assert.equal(c.count, 1);
  assert.deepEqual(c.below, []);
  assert.deepEqual(s.items.map((x) => [x.item_id, x.tag, x.tickers]), [[prog.id, "program", ["OTH"]]]);
  assert.equal(s.count, 1);
  const row = c.by_ticker[0].items[0];
  assert.deepEqual([row.pipeline, row.entity_name, row.score, row.url.startsWith("https://example.com/")], ["aux", "Acme", 80, true]);
});

test("brief sections: a rivals.json-style source key resolves through aux-sources to its entity", async () => {
  const db = new D1();
  // The row comes from another source of the same entity; the rival list names only widget_sec.
  const w = await addAux(db, { source_key: "widget_news", entity_key: "widget", entity_name: "Widget", status: "public" }, { score: 77 });
  const { competitors: c } = await sections(db);
  assert.deepEqual(c.by_ticker.map((g) => [g.ticker, ids(g.items), g.items[0].direction]), [["TST", [w.id], "-"]]);
  assert.ok(c.rival_sources >= 1, "the TST rival source is counted");
});

test("brief sections: a 65 alone goes below the line with count 0; a 75 empties below; duplicate, covered, muted and rival-twin copies are left out; a Coverage rival row lists under Competitors", async () => {
  const db = new D1();
  const low = await addAux(db, { title: "Acme minor update" }, { score: 65 });
  let { competitors: c } = await sections(db);
  assert.deepEqual([c.count, ids(c.below), c.by_ticker.length], [0, [low.id], 0]);
  assert.ok(BELOW_N >= 1 && FLOOR === 70);

  // Left out: a duplicate, a 'covered' band, a muted source, an aux copy whose rival twin is on Coverage.
  await addAux(db, { title: "dup" }, { score: null, band: "duplicate" });
  await addAux(db, { title: "covered" }, { score: null, band: "covered" });
  await addAux(db, { source_key: "muted_src", title: "muted" }, { score: 88 });
  await db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('muted_src', 'mute', ?)").bind(IN).run();
  const twin = await addAux(db, { title: "twin" }, { score: 85 });
  await addItem(db, { nm_rowid: twin.nm_rowid, ticker: "TST", role: "rival", source_key: "acme_pr", state: "pending" });
  ({ competitors: c } = await sections(db));
  assert.deepEqual([c.count, ids(c.below)], [0, [low.id]], "none of the four is listed or counted");

  const high = await addAux(db, { title: "Acme big news" }, { score: 75 });
  const graded = [{ grade_id: 9, item_id: 777, ticker: "TST", role: "rival", source_key: "rival_src", score: 78, band: "digest", title: "Rival on Coverage", url: "https://example.com/r", why: "w", graded_at: IN }];
  ({ competitors: c } = await sections(db, { graded }));
  assert.deepEqual(c.below, [], "with a row at 70+, nothing goes below the line");
  assert.equal(c.count, 2);
  assert.deepEqual(c.by_ticker[0].items.map((x) => [x.pipeline, x.item_id, x.score]), [["coverage", 777, 78], ["aux", high.id, 75]]);
  assert.equal(c.by_ticker[0].items[0].direction, "-");
});

test("brief sections: a Coverage rival row takes the relations sign of its source key's entity, as competitorsOf gives it", async () => {
  const db = new D1();
  const graded = [
    { grade_id: 11, item_id: 901, ticker: "TST", role: "rival", source_key: "acme_rival", score: 80, band: "digest", title: "Acme via its rival feed", url: "https://example.com/ar", why: "w", graded_at: IN },
    { grade_id: 10, item_id: 902, ticker: "TST", role: "rival", source_key: "rival_src", score: 79, band: "digest", title: "Unmapped rival", url: "https://example.com/u", why: "w", graded_at: IN },
  ];
  const { competitors: c } = await sections(db, { graded });
  assert.equal(rel.competitorsOf("TST").get("acme")?.direction, "+");
  assert.deepEqual(c.by_ticker.map((g) => [g.ticker, g.items.map((x) => [x.item_id, x.direction])]), [["TST", [[901, "+"], [902, "-"]]]],
    "acme_rival resolves to the peer acme (+); a key with no entity and no peer note keeps '-'");
});

test("brief sections: the inlined mute and twin SQL equal tuning.js MUTED_SQL and lib.js rivalOnCoverageSql('i'); brief-sections.js imports neither tuning.js nor delivery.js", () => {
  assert.equal(AUX_MUTED_SQL, MUTED_SQL);
  assert.equal(AUX_RIVAL_TWIN_SQL, rivalOnCoverageSql("i"));
  assert.ok(Q5_SQL.includes(`i.source_key NOT IN ${MUTED_SQL}`));
  assert.ok(Q5_SQL.includes(`NOT ${rivalOnCoverageSql("i")}`));
  const src = readFileSync(new URL("../worker/src/brief-sections.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/(?:from\s+|import\()\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./aux-sources.json", "./lib.js", "./relations.js"]);
  assert.ok(/^import \{ isHttpUrl \} from "\.\/lib\.js";$/m.test(src) && !/^import .*(relations\.js|aux-sources)/m.test(src),
    "lib.js is the only static import, so the default brief never loads the JSON bundles");
  assert.ok(!/tuning\.js|delivery\.js|discord\.js/.test(src.replace(/^\s*\/\/.*$/gm, "")));
});

test("brief sections: a row with no covered ticker, and a customer twin whose entity is a peer, count in unassigned and are not listed", async () => {
  const db = new D1();
  await addAux(db, { source_key: "far_src", entity_key: "faraway", entity_name: "Faraway", title: "Faraway news" }, { score: 82 });
  await addAux(db, { source_key: "cust_twin", entity_key: "acme_cust", entity_name: "Acme Customer", status: "public", coverage_subject: 1, affects: "TST", title: "TST and Acme Customer" }, { score: 79 });
  await addAux(db, { source_key: "media_src", entity_key: "trade_mag", entity_name: "Trade Mag", status: "media", title: "Sector story" }, { score: 71 });
  const { competitors: c, industry: s } = await sections(db);
  assert.deepEqual([c.count, c.by_ticker.length, c.unassigned], [0, 0, 2]);
  assert.deepEqual(s.items.map((x) => [x.title, x.tickers]), [["Sector story", []]], "a media row with no reads is sector-wide");
  assert.equal(s.unassigned, 2);
});

test("brief sections: empty sections say 'None at 70+ since …' with waiting and held counts from aux_items", async () => {
  const db = new D1();
  await addAux(db, { state: "pending", title: "w1" }, null);
  await addAux(db, { state: "pending", title: "w2", admit: "gate", released_at: null }, null);
  await addAux(db, { state: "claimed", source_key: "prog_src", entity_key: "program_x", status: "program", title: "w3" }, null);
  const env = { DB: db, NEWS: seriesDb([]) };
  const b = await buildBrief(env, COVERED, { from: FROM, to: TO, now: Date.parse(TO), sections: "full", rel });
  assert.deepEqual(b.competitors.waiting, { n: 2, held: 1 });
  assert.deepEqual(b.industry.waiting, { n: 1, held: 0 });
  const text = renderBrief(b).join("\n");
  assert.match(text, /\*\*Competitors and peers\*\* \(0\)\nNone at 70\+ since .+\. 2 waiting for a grade \(1 held by the daily budget\); \d+ rival sources followed\./);
  assert.match(text, /\*\*Industry\*\* \(0\)\nNone at 70\+ since .+\. 1 waiting for a grade \(0 held by the daily budget\)\./);
});

function seriesDb(rows, { tableMissing = false } = {}) {
  const d = new D1({ migrations: false });
  if (!tableMissing) {
    d.exec("CREATE TABLE series_points (series TEXT, subject TEXT, period TEXT, value REAL, ticker TEXT, label TEXT, observed_at TEXT, PRIMARY KEY (series, subject, period))");
    for (const r of rows) d.db.prepare("INSERT INTO series_points VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.series, r.subject, r.period, r.value, r.ticker ?? null, r.label ?? null, r.observed_at);
  }
  const seen = [];
  return { seen, prepare(sql) { seen.push(sql); return d.prepare(sql); } };
}

test("brief sections: register readings give one line with the delta for a series new in the window; nothing new gives no line; a subject with no ticker and not '_total' is left out; NEWS sees only SELECT", async () => {
  const OLD = "2025-12-01T00:00:00.000Z";
  const news = seriesDb([
    { series: "reg_a", subject: "tst_co", period: "2025-11", value: 10, ticker: "TST", label: "TST units", observed_at: OLD },
    { series: "reg_a", subject: "tst_co", period: "2025-12", value: 14, ticker: "TST", label: "TST units", observed_at: IN },
    { series: "reg_a", subject: "_total", period: "2025-12", value: 30, observed_at: IN },
    { series: "reg_a", subject: "oth_co", period: "2025-12", value: 5, ticker: "OTH", observed_at: OLD },
    { series: "reg_a", subject: "nobody", period: "2025-12", value: 9, observed_at: IN },
    { series: "reg_b", subject: "zzz_co", period: "2025-12", value: 2, ticker: "ZZZ", observed_at: IN },
  ]);
  const db = new D1();
  const { industry: s } = await sections(db, { NEWS: news });
  assert.deepEqual(s.registers.map((r) => r.text), ["_total (2025-12): 30", "TST units (2025-12): 14 (+4 since 2025-11)"]);
  assert.ok(news.seen.length >= 1 && news.seen.every((q) => /^\s*SELECT\b/i.test(q)), news.seen.join(" | "));
  // Pure function: a drop gives a minus sign; nothing in the window gives nothing.
  const rows = [{ series: "s", subject: "x", period: "1", value: 5, ticker: "TST", observed_at: OLD }, { series: "s", subject: "x", period: "2", value: 3.5, ticker: "TST", observed_at: IN }];
  assert.deepEqual(registerReadings(rows, { from: FROM, to: TO, inUniverse: (t) => t === "TST" }).map((r) => r.text), ["x (2): 3.5 (-1.5 since 1)"]);
  assert.deepEqual(registerReadings(rows, { from: TO, to: "2026-02-01T00:00:00.000Z", inUniverse: () => true }), []);
});

test("brief sections: a dropped aux table gives competitors {error} and industry {error}; the rest is built; console.error is not called", async () => {
  const db = new D1();
  const item = await addItem(db, { ticker: "TST", title: "Own news", nm_first_seen: IN });
  await addGrade(db, item, { score: 81, graded_at: IN });
  db.exec("DROP TABLE aux_feedback; DROP TABLE aux_grades; DROP TABLE aux_items;");
  const { error, warn } = console;
  const errors = [], warns = [];
  console.error = (...a) => errors.push(a);
  console.warn = (...a) => warns.push(a[1]);
  let b;
  try {
    b = await buildBrief({ DB: db, NEWS: seriesDb([], { tableMissing: true }) }, COVERED, { from: FROM, to: TO, now: Date.parse(TO), sections: "full", rel });
  } finally {
    Object.assign(console, { error, warn });
  }
  assert.ok(b.competitors.error && b.industry.error, JSON.stringify([b.competitors, b.industry]));
  assert.deepEqual(b.leads_digests.map((g) => g.ticker), ["TST"]);
  assert.ok(Array.isArray(b.calendar));
  assert.deepEqual(errors, []);
  assert.ok(warns.includes("aux grades") && warns.includes("registers"), JSON.stringify(warns));
  const text = renderBrief(b).join("\n");
  assert.match(text, /\*\*Competitors and peers\*\* \(failed\)\nThis section failed to build\./);
  assert.match(text, /\*\*Industry\*\* \(failed\)\nThis section failed to build\./);
});

// The top-level keys /v1/brief returned before phase 3 (the Streamlit app reads them).
const BRIEF_KEYS = ["kind", "generated_at", "from", "to", "today", "leads_digests", "counterparty", "waiting", "catalysts",
  "council_outcomes", "health", "to_label", "window", "text"];

test("GET /v1/brief without sections has exactly the old top-level keys and text; ?sections=full adds competitors, industry and calendar; no token 401, grader 403", async () => {
  const db = zenithDb();
  const env = { DB: db, NEWS: newsDb(), ...TOKENS };
  const since = new Date(Date.now() - 3600_000).toISOString();
  const plain = await request(worker, env, "GET", `/v1/brief?since=${since}`, { role: "app" });
  assert.equal(plain.status, 200);
  assert.deepEqual(Object.keys(plain.body), BRIEF_KEYS);
  const joined = plain.body.text.join("\n");
  assert.ok(!/Competitors and peers|\*\*Industry\*\*/.test(joined));
  const full = await request(worker, env, "GET", `/v1/brief?sections=full&since=${since}`, { role: "app" });
  assert.equal(full.status, 200);
  assert.deepEqual(Object.keys(full.body), [...BRIEF_KEYS.slice(0, -2), "competitors", "industry", "calendar", "window", "text"]);
  assert.ok(Array.isArray(full.body.calendar) && full.body.calendar.length <= 100);
  assert.equal(typeof full.body.competitors.count, "number");
  assert.equal(typeof full.body.industry.count, "number");
  assert.ok(full.body.text.join("\n").includes("**Competitors and peers**"));
  // The same text without the new sections.
  const strip = (t) => t.join("\n").replace(/\n\n\*\*Competitors and peers\*\*[\s\S]*?(?=\n\n\*\*Waiting for a grade)/, "");
  // Times and ages are masked: the two requests may straddle a minute.
  const mask = (t) => t.replace(/\b\w{3} \d{1,2} \w{3} \d{2}:\d{2} ET\b/g, "DAY T").replace(/\d+[hmd]( \d+[hm])?/g, "T");
  assert.equal(mask(strip(full.body.text)), mask(joined));
  assert.equal((await request(worker, env, "GET", "/v1/brief?sections=full", { role: "admin" })).status, 200);
  assert.equal((await request(worker, env, "GET", "/v1/brief?sections=full", { role: "grader" })).status, 403);
  const anon = await worker.fetch(new Request("https://zenith.test/v1/brief?sections=full"), env);
  assert.equal(anon.status, 401);
});

test("brief sections: the transitive import graph of brief-sections.js (static and dynamic imports) reaches none of tuning.js, delivery.js, discord.js, brief.js", () => {
  const SRC = new URL("../worker/src/", import.meta.url);
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(new URL(f, SRC), "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)"\.\/([^"]+\.js)"/g)) walk(m[1]);
  };
  walk("brief-sections.js");
  assert.ok(seen.has("relations.js") && seen.has("lib.js"), [...seen].join(", "));
  for (const f of ["tuning.js", "delivery.js", "discord.js", "brief.js", "index.js"]) assert.ok(!seen.has(f), `${f} in ${[...seen].join(", ")}`);
});
