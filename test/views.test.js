// Phase 3 PR-CV2: worker/src/views.js, the Competitors and Industry window
// queries and selectors. Synthetic fixtures only: the relations object is built
// from synthetic maps (SYN, ACM, QXZ, widget_corp style) through the one
// relations module, and every row is seeded here. No real name, key, id, count
// or score is written in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hookJsonImports, zenithDb } from "./helpers/worker-env.js";
import { buildRelations } from "../scripts/build-relations.mjs";

hookJsonImports();
const views = await import("../worker/src/views.js");
const { windowRows, windowSql, competitorsView, industryView, industryKind, norm, readsOf, WINDOW_LIMIT, KINDS } = views;
const { loadRelations } = await import("../worker/src/relations.js");
const { MUTED_SQL } = await import("../worker/src/tuning.js");
const { universeSql } = await import("../worker/src/lib.js");

const SRC = new URL("../worker/src/", import.meta.url);

// --- Synthetic maps in the real shapes ----------------------------------------------------------
const TICKERS = ["SYN", "ACM", "QXZ"];
const synPeers = [
  { key: "widget_corp", name: "Widget Corp", status: "private", reads_through: [{ ticker: "SYN", direction: "−" }] },
  { key: "hedge_co", name: "Hedge Co", status: "public", reads_through: [{ ticker: "ACM", direction: "±" }] },
  { key: "plus_co", name: "Plus Co", status: "public", reads_through: [{ ticker: "SYN", direction: "+" }] },
];
const synKeyAccounts = { SYN: [{ name: "Acme Stores", kind: "customer", terms: ["Acme Stores"] }], ACM: [], QXZ: [] };
const synRivals = { ACM: [{ key: "hedge_co", basis: "peers" }, { key: "acme_rival_src", basis: "a sheet" }] };
const synCovered = {
  tickers: TICKERS,
  sources: { synco: "SYN" },
  counterparty: {
    rival_x: { role: "rival", affects: ["SYN"] },
    cust_y: { role: "customer", affects: ["SYN"] },
    prog_z: { role: "program", affects: ["SYN", "ACM"] },
    rel_w: { role: "relationship", affects: ["ACM"] },
    idx_v: { role: "index_event", affects: ["SYN"] },
  },
  records: [],
};
const synAux = {
  sources: {
    rival_x: { entity: "rival_x", name: "Rival X", status: "private" },
    cust_y: { entity: "cust_y", name: "Cust Y mentions", status: "public", coverage_subject: true, affects: ["SYN"] },
    prog_z: { entity: "prog_z", name: "Prog Z", status: "program", coverage_subject: true, affects: ["SYN", "ACM"] },
    rel_w: { entity: "rel_w", name: "Rel W", status: "public", coverage_subject: true, affects: ["ACM"] },
    idx_v: { entity: "idx_v", name: "Idx V", status: "public", affects: ["SYN"] },
    widget_corp: { entity: "widget_corp", name: "Widget Corp", status: "private" },
    widget_sec: { entity: "widget_corp", name: "Widget Corp filings", status: "public", sec: true, record: true },
    plus_co: { entity: "plus_co", name: "Plus Co", status: "public" },
    hedge_co: { entity: "hedge_co", name: "Hedge Co", status: "public" },
    city_council: { entity: "city_council", name: "City council matters", status: "program", record: true },
    state_register: { entity: "state_register", name: "State register", status: "public", record: true },
    acme_rival_src: { entity: "acme_rival", name: "Acme Rival news", status: "private" },
    syn_filter: { entity: "syn_filter", name: "Synco trade filter", status: "media", coverage_subject: true, affects: ["SYN"] },
    trade_media: { entity: "media_trade", name: "Trade media", status: "media" },
    other_co: { entity: "other_co", name: "Other Co", status: "public" },
  },
  exclude: {},
};
const synMatch = { SYN: { terms: ["Synco"], accounts: ["Acme Stores"] }, ACM: { terms: ["Acme Corp"], accounts: [] }, QXZ: { terms: ["Quixo"], accounts: [] } };
const synIsRecord = (k) => k.startsWith("edgar_") || synAux.sources[k]?.record === true || synAux.sources[k]?.sec === true;
const synBuilt = buildRelations({ peers: synPeers, keyAccounts: synKeyAccounts, rivals: synRivals, tickers: TICKERS, auxKeys: Object.keys(synAux.sources) });
const relOf = (over = {}) => loadRelations({
  relations: synBuilt.relations, version: "rel-test", covered: synCovered, aux: synAux, match: synMatch,
  industry: {}, isRecordSource: synIsRecord, ...over,
});
const REL = relOf();
const MANAGED = "managed_" + "0123456789abcdef".repeat(2);

// --- Seeding ------------------------------------------------------------------------------------
const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const WINDOW = () => ({ fromIso: iso(14 * DAY), toIso: iso(-60_000) });
let rowid = 50_000;

function addItem(env, over = {}) {
  const it = { nm_rowid: ++rowid, source_key: "rival_x", ticker: "SYN", url: `https://news.example.com/c/${rowid}`, title: "A synthetic story",
    published: iso(DAY), nm_first_seen: iso(DAY), state: "pending", skip_reason: null, role: "rival", affects: null, admit: null, released_at: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, nm_notified, ingested_at, state, skip_reason, role, affects, admit, released_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(),
    it.state, it.skip_reason, it.role, it.affects, it.admit, it.released_at);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const item = env.DB.db.prepare("SELECT ticker FROM items WHERE id = ?").get(itemId);
  const g = { ticker: item.ticker, run_id: `run-${itemId}`, score: 72, rung: null, event_type: null, flags: '["reason:material"]', graded_at: iso(HOUR), ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject");
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, rung, event_type, why, flags, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, ?, ?, 'why', ?, 1, ?)`).run(itemId, g.ticker, g.run_id, g.score, band, g.rung, g.event_type, g.flags, g.graded_at);
  const id = Number(r.lastInsertRowid);
  if (g.ticker === item.ticker) env.DB.db.prepare("UPDATE items SET state = 'graded', grade_id = ? WHERE id = ?").run(id, itemId);
  return id;
}
function addAux(env, over = {}) {
  const src = over.source_key ?? "widget_corp";
  const a = synAux.sources[src] || {};
  const it = { nm_rowid: ++rowid, source_key: src, entity_key: a.entity ?? src, entity_name: a.name ?? "Synthetic", status: a.status ?? "unknown",
    url: `https://news.example.com/a/${rowid}`, title: "A synthetic aux story", published: iso(DAY), nm_first_seen: iso(DAY), state: "graded",
    coverage_subject: a.coverage_subject ? 1 : 0, affects: a.affects ? a.affects.join(",") : null, score: 72, band: null, reads_through: null, event_type: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state, coverage_subject, affects)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(it.nm_rowid, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.published,
    it.nm_first_seen, iso(), it.state, it.coverage_subject, it.affects);
  const id = Number(r.lastInsertRowid);
  if (it.state === "graded") {
    const band = it.band ?? (it.score == null ? "duplicate" : it.score >= 90 ? "lead" : it.score >= 70 ? "digest" : it.score >= 40 ? "borderline" : "reject");
    const g = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, event_type, reads_through, flags, graded_at)
      VALUES (?, 'run-aux', ?, ?, ?, ?, ?, '["reason:material"]', ?)`).run(id, it.entity_name, it.score, band, it.event_type, it.reads_through, iso(HOUR));
    env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), id);
  }
  return id;
}
const newEnv = () => ({ DB: zenithDb() });
const load = (env, over = {}) => windowRows(env, { ...WINDOW(), muted: MUTED_SQL, rel: REL, ...over });
const ids = (list) => list.map((r) => r.item_id);
const section = (view, t) => view.find((s) => s.ticker === t);
const reads = (...pairs) => JSON.stringify(pairs.map(([ticker, direction]) => ({ ticker, direction })));
// A pure aux row as windowRows returns it.
const auxRow = (over) => {
  const a = synAux.sources[over.source_key] || {};
  return norm({ item_id: ++rowid, nm_rowid: rowid, entity_key: a.entity ?? over.source_key, entity_name: a.name ?? "Synthetic", status: a.status ?? "unknown",
    coverage_subject: a.coverage_subject ? 1 : 0, affects: a.affects ? a.affects.join(",") : null, url: "https://news.example.com/x", title: "A synthetic aux story",
    published: iso(DAY), first_seen: iso(DAY), score: 72, band: "digest", reads_through: null, ...over }, "aux", REL);
};
const covRow = (over) => norm({ item_id: ++rowid, nm_rowid: rowid, ticker: "SYN", source_key: "synco", role: null, affects: null, url: "https://news.example.com/c",
  title: "A synthetic story", published: iso(DAY), first_seen: iso(DAY), grade_ticker: over.ticker ?? "SYN", score: 72, band: "digest", rung: null,
  event_type: null, flags: '["reason:material"]', ...over }, "coverage", REL);
const inCompetitors = (row, t) => ids(section(competitorsView({ coverage: [], aux: [row] }, REL), t).items).includes(row.item_id);
const industryIds = (rows, t) => {
  const v = industryView(rows, REL);
  const s = t ? section(v.tickers, t) : v.sector_wide;
  return [...(s.areas || []).flatMap((a) => a.items), ...s.groups.flatMap((g) => g.items)].map((r) => r.item_id);
};

// --- V1 -----------------------------------------------------------------------------------------
test("V1: an aux row of a competitor's entity shows with the relation's sign; reads_through places a non-competitor; bad reads_through is []", () => {
  const peer = auxRow({ source_key: "widget_corp" });
  const v = competitorsView({ coverage: [], aux: [peer] }, REL);
  const card = section(v, "SYN").items.find((r) => r.item_id === peer.item_id);
  assert.ok(card, "a competitor's row is under its ticker");
  assert.equal(card.direction, "-", "the peer note's sign (U+2212 normalised)");
  assert.deepEqual(section(v, "ACM").items, []);

  const readThrough = auxRow({ source_key: "other_co", reads_through: reads(["QXZ", "+"]) });
  assert.deepEqual(readThrough.reads, [{ ticker: "QXZ", direction: "+" }]);
  const v2 = section(competitorsView({ coverage: [], aux: [readThrough] }, REL), "QXZ");
  assert.deepEqual(ids(v2.items), [readThrough.item_id]);
  assert.equal(v2.items[0].direction, "+", "the grader's sign wins");

  const outside = auxRow({ source_key: "other_co", reads_through: reads(["ZZZQ", "-"]) });
  assert.deepEqual(outside.reads, [], "a ticker outside the universe is dropped");
  for (const t of TICKERS) assert.equal(inCompetitors(outside, t), false, t);

  for (const bad of ["not json", "{\"ticker\":\"SYN\"}", "[1, null, {\"ticker\": 5}]", ""]) {
    const row = auxRow({ source_key: "other_co", reads_through: bad });
    assert.deepEqual(row.reads, [], bad);
  }
  assert.deepEqual(readsOf(reads(["SYN", "−"], ["SYN", "+"], ["ACM", "?"]), TICKERS), [{ ticker: "SYN", direction: "-" }, { ticker: "ACM", direction: null }]);
});

// --- V2 / V3 ------------------------------------------------------------------------------------
test("V2: a kept rival row and its aux twin give one coverage card; key account or company named", async () => {
  const env = newEnv();
  const a = addItem(env, { title: "Rival X wins Acme Stores order" });
  addGrade(env, a, { score: 75 });
  const aRow = env.DB.db.prepare("SELECT nm_rowid FROM items WHERE id = ?").get(a).nm_rowid;
  const twinA = addAux(env, { source_key: "rival_x", nm_rowid: aRow }); // the same news-monitor row as the coverage copy
  const b = addItem(env, { title: "Synco and Rival X both bid" });
  addGrade(env, b, { score: 74 });

  const rows = await load(env);
  assert.ok(!ids(rows.aux).includes(twinA), "the aux copy of a rival row on Coverage is hidden");
  const syn = section(competitorsView(rows, REL), "SYN");
  const cards = syn.items.filter((r) => r.nm_rowid === aRow);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].pipeline, "coverage");
  assert.equal(cards[0].at_key_account, true);
  assert.equal(cards[0].key_account, "Acme Stores");
  const cb = syn.items.find((r) => r.item_id === b);
  assert.equal(cb.at_key_account, false);
  assert.equal(cb.key_account, null);
  assert.equal(cb.names_company, "Synco");
});

test("V3: a gate-dropped rival row plus its aux twin graded covered give one aux card", async () => {
  const env = newEnv();
  const dropped = addItem(env, { state: "skipped", skip_reason: "rival_no_key_account" });
  const nm = env.DB.db.prepare("SELECT nm_rowid FROM items WHERE id = ?").get(dropped).nm_rowid;
  const twin = addAux(env, { source_key: "rival_x", nm_rowid: nm, score: null, band: "covered" });
  const rows = await load(env);
  assert.deepEqual(ids(rows.coverage), []);
  assert.deepEqual(ids(rows.aux), [twin]);
  const syn = section(competitorsView(rows, REL), "SYN");
  assert.deepEqual(syn.items.map((r) => [r.item_id, r.pipeline]), [[twin, "aux"]]);
});

// --- V4 -----------------------------------------------------------------------------------------
test("V4: muted, held, duplicate, ungraded and out-of-universe rows are hidden", async () => {
  const env = newEnv();
  const shown = addItem(env);
  addGrade(env, shown);
  const mutedItem = addItem(env, { source_key: "cust_y", role: "rival" });
  addGrade(env, mutedItem);
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES ('cust_y', 'mute', ?)").run(iso());
  const held = addItem(env, { admit: "record", released_at: null });
  addGrade(env, held);
  const dup = addItem(env);
  addGrade(env, dup, { score: null });
  addItem(env); // ungraded
  const outside = addItem(env, { ticker: "ZZZQ" });
  addGrade(env, outside);
  const old = addItem(env, { nm_first_seen: iso(20 * DAY) });
  addGrade(env, old);
  const plain = addItem(env, { role: null });
  addGrade(env, plain); // neither rival nor program nor industry

  const auxShown = addAux(env, { source_key: "widget_corp" });
  addAux(env, { source_key: "cust_y" }); // muted
  addAux(env, { source_key: "widget_corp", state: "pending" });
  addAux(env, { source_key: "widget_corp", score: null }); // duplicate
  addAux(env, { source_key: "widget_corp", nm_first_seen: iso(20 * DAY) });

  const rows = await load(env);
  assert.deepEqual(ids(rows.coverage), [shown]);
  assert.deepEqual(ids(rows.aux), [auxShown]);
  assert.deepEqual(rows.capped, { coverage: false, aux: false });
});

// --- V5 -----------------------------------------------------------------------------------------
test("V5: the primary grade plus same-run cross-ticker grades; an older run and NULL runs do not add a ticker", async () => {
  const env = newEnv();
  const both = addItem(env, { role: "program", source_key: "prog_z" });
  addGrade(env, both, { run_id: "run-a" });
  addGrade(env, both, { ticker: "ACM", run_id: "run-a" });
  const stale = addItem(env, { role: "program", source_key: "prog_z" });
  addGrade(env, stale, { ticker: "ACM", run_id: "run-old", graded_at: iso(2 * HOUR) });
  addGrade(env, stale, { run_id: "run-new" });
  const nullRun = addItem(env, { role: "program", source_key: "prog_z" });
  addGrade(env, nullRun, { run_id: null });
  addGrade(env, nullRun, { ticker: "ACM", run_id: null });

  const rows = await load(env);
  const v = industryView(rows, REL);
  const under = (t) => section(v.tickers, t).groups.flatMap((g) => g.items).map((r) => r.item_id);
  assert.deepEqual(under("SYN").sort(), [both, stale, nullRun].sort());
  assert.deepEqual(under("ACM"), [both]);
  for (const s of v.tickers) {
    const list = s.groups.flatMap((g) => g.items).map((r) => `${r.pipeline}:${r.item_id}`);
    assert.equal(new Set(list).size, list.length, `no item twice under ${s.ticker}`);
  }
});

// --- V6 -----------------------------------------------------------------------------------------
test("V6: an undated Lead shows as Digest; the stored band is kept", () => {
  const undated = covRow({ band: "lead", score: 92, published: null });
  assert.equal(undated.band, "digest");
  assert.equal(undated.stored_band, "lead");
  assert.equal(covRow({ band: "lead", score: 92 }).band, "lead");
  assert.equal(auxRow({ source_key: "widget_corp", band: "lead", score: 95, published: null }).band, "digest");
});

// --- V7 -----------------------------------------------------------------------------------------
test("V7: industryKind by host and event type, first match wins", () => {
  const k = (over) => industryKind(covRow({ role: "program", ...over }), { ticker: "SYN", industry: {}, rel: REL });
  assert.equal(k({ url: "https://www.federalregister.gov/d/x" }), "rules");
  assert.equal(k({ url: "https://www.regulations.gov/docket/x" }), "rules");
  assert.equal(k({ url: "https://news.example.com/x", event_type: "regulatory" }), "rules");
  assert.equal(k({ url: "https://www.appropriations.senate.gov/x" }), "budget");
  assert.equal(k({ url: "https://www.congress.gov/bill/x" }), "budget");
  assert.equal(k({ url: "https://city.legistar.com/Matter.aspx?ID=1" }), "local");
  assert.equal(k({ url: "https://news.example.com/x", event_type: "program_award" }), "programs");
  assert.equal(k({ url: "https://www.agency.gov/news/1" }), "government");
  assert.equal(k({ url: "https://news.example.com/x", source_key: "state_register" }), "government", "a register source");
  assert.equal(k({ url: "https://www.tradepress.example/x" }), "news");
  assert.equal(k({ url: "not a url" }), "news");
  assert.equal(k({ url: "https://federalregister.gov.example/x" }), "news", "a look-alike host is not a rules host");
  assert.deepEqual(KINDS, ["rules", "budget", "local", "programs", "government", "news"]);
});

// --- V8 -----------------------------------------------------------------------------------------
test("V8: the placement table through both views, one case per row", () => {
  const cases = [];
  const add = (name, row, where) => { cases.push({ name, row, where }); return row; };
  add("rival twin", auxRow({ source_key: "rival_x" }), { competitors: ["SYN"] });
  for (const key of ["cust_y", "rel_w", "idx_v"]) add(`${key} twin`, auxRow({ source_key: key, reads_through: reads(["ACM", "-"]) }), {});
  add("program row naming T", auxRow({ source_key: "city_council", affects: "SYN" }), { industry: ["SYN"] });
  add("register row reading through T", auxRow({ source_key: "state_register", reads_through: reads(["ACM", "-"]) }), { industry: ["ACM"] });
  add("competitor's SEC feed", auxRow({ source_key: "widget_sec" }), { competitors: ["SYN"] });
  add("non-competitor edgar_*", auxRow({ source_key: "edgar_zz", entity_key: "zz_inc", status: "unknown" }), {});
  add("media reading through T", auxRow({ source_key: "trade_media", reads_through: reads(["ACM", "-"]) }), { competitors: ["ACM"] });
  add("plain media", auxRow({ source_key: "trade_media" }), { industry: ["sector"] });
  add("coverage-subject filter", auxRow({ source_key: "syn_filter" }), {});
  add("unknown with reads_through", auxRow({ source_key: MANAGED, entity_key: MANAGED, status: "unknown", reads_through: reads(["QXZ", "-"]) }), { competitors: ["QXZ"] });
  add("unknown without", auxRow({ source_key: MANAGED, entity_key: MANAGED, status: "unknown" }), {});
  add("other public company", auxRow({ source_key: "other_co" }), {});

  const all = { coverage: [], aux: cases.map((c) => c.row) };
  const comp = competitorsView(all, REL);
  const ind = industryView(all, REL);
  const indIn = (s) => [...s.groups.flatMap((g) => g.items)].map((r) => r.item_id);
  for (const { name, row, where } of cases) {
    const inComp = TICKERS.filter((t) => ids(section(comp, t).items).includes(row.item_id));
    const inInd = [...TICKERS.filter((t) => indIn(section(ind.tickers, t)).includes(row.item_id)), ...(indIn(ind.sector_wide).includes(row.item_id) ? ["sector"] : [])];
    assert.deepEqual(inComp, where.competitors || [], `${name}: Competitors`);
    assert.deepEqual(inInd, where.industry || [], `${name}: Industry`);
    assert.ok(!(inComp.length && inInd.length), `${name} is in both views`);
  }
  // With a ticker filter, sector-wide rows are not offered.
  assert.equal(industryView(all, REL, { ticker: "SYN" }).sector_wide, undefined);
});

test("V8: a program twin merges into its coverage copy with an 'also graded' line", () => {
  const cov = covRow({ role: "program", source_key: "prog_z", ticker: "SYN", grade_ticker: "SYN", score: 12 });
  const twin = auxRow({ source_key: "prog_z", nm_rowid: cov.nm_rowid, score: 55, band: "borderline", entity: "Prog Z" });
  const other = covRow({ role: "program", source_key: "prog_z", ticker: "SYN", grade_ticker: "SYN" });
  const v = industryView({ coverage: [cov, other], aux: [twin] }, REL);
  const syn = section(v.tickers, "SYN").groups.flatMap((g) => g.items);
  const merged = syn.filter((r) => r.nm_rowid === cov.nm_rowid);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pipeline, "coverage");
  assert.deepEqual(merged[0].also, [{ item_id: twin.item_id, entity: "Prog Z", score: 55, band: "borderline" }]);
  assert.equal(merged[0].low, true, "a program row under 40 is collapsed");
  assert.deepEqual(syn.find((r) => r.item_id === other.item_id).also, []);
  const auxIn = (s) => s.groups.flatMap((g) => g.items).some((r) => r.pipeline === "aux" && r.item_id === twin.item_id);
  assert.equal(auxIn(section(v.tickers, "SYN")), false, "the aux twin is not repeated under the coverage card's ticker");
  assert.equal(auxIn(v.sector_wide), false);
  assert.equal(auxIn(section(v.tickers, "ACM")), true, "ACM has no coverage copy, so the twin it affects stands alone there");
  assert.equal(inCompetitors(twin, "SYN"), false);
});

test("V8/V9: the twin merge runs per ticker after minScore; a section is the same with or without the ticker filter", () => {
  // A coverage program row graded for SYN (low, as before promotion) and its aux
  // twin, affecting SYN and ACM, graded higher.
  const cov = covRow({ role: "program", source_key: "prog_z", ticker: "SYN", grade_ticker: "SYN", score: 10 });
  const twin = auxRow({ source_key: "prog_z", nm_rowid: cov.nm_rowid, score: 80, entity: "Prog Z" });
  const rows = { coverage: [cov], aux: [twin] };
  const cards = (v, t) => section(v.tickers, t).groups.flatMap((g) => g.items).map((r) => [r.pipeline, r.item_id, r.also.length]);
  const all = industryView(rows, REL);
  assert.deepEqual(cards(all, "SYN"), [["coverage", cov.item_id, 1]]);
  assert.deepEqual(cards(all, "ACM"), [["aux", twin.item_id, 0]]);
  // The coverage copy is under minScore: the score-80 twin stands alone under both tickers.
  const min40 = industryView(rows, REL, { minScore: 40 });
  assert.deepEqual(cards(min40, "SYN"), [["aux", twin.item_id, 0]]);
  assert.deepEqual(cards(min40, "ACM"), [["aux", twin.item_id, 0]]);
  assert.deepEqual(cards(industryView(rows, REL, { minScore: 90 }), "SYN"), []);
  // The ticker form of Q-V1 (g.ticker = 'ACM') returns no SYN coverage row.
  assert.deepEqual(cards(industryView({ coverage: [], aux: [twin] }, REL, { ticker: "ACM" }), "ACM"), cards(all, "ACM"));
  assert.deepEqual(cards(industryView(rows, REL, { ticker: "SYN" }), "SYN"), cards(all, "SYN"));
  assert.deepEqual(cards(industryView(rows, REL, { ticker: "SYN", minScore: 40 }), "SYN"), cards(min40, "SYN"));
  // Sector-wide: an aux twin with no ticker is hidden while its coverage copy shows, and stands alone when it does not.
  const pc = covRow({ role: "program", source_key: "synco", ticker: "SYN", grade_ticker: "SYN", score: 10 });
  const wide = auxRow({ source_key: "trade_media", nm_rowid: pc.nm_rowid, score: 70 });
  const wideIds = (opts) => ids(industryView({ coverage: [pc], aux: [wide] }, REL, opts).sector_wide.groups.flatMap((g) => g.items));
  assert.deepEqual(wideIds(), []);
  assert.deepEqual(wideIds({ minScore: 40 }), [wide.item_id]);
});

// --- V9 -----------------------------------------------------------------------------------------
test("V9: low rows, minScore, direction and sort", () => {
  const hi = auxRow({ source_key: "widget_corp", score: 80, first_seen: iso(3 * DAY) });
  const mid = auxRow({ source_key: "plus_co", score: 60, first_seen: iso(DAY) });
  const lo = auxRow({ source_key: "widget_corp", score: 20, first_seen: iso(2 * DAY) });
  const rows = { coverage: [], aux: [hi, mid, lo] };
  const syn = (opts) => section(competitorsView(rows, REL, opts), "SYN");
  assert.deepEqual(ids(syn().items), [hi.item_id, mid.item_id, lo.item_id], "score order");
  assert.deepEqual(syn().items.map((r) => r.low), [false, false, true]);
  assert.deepEqual(ids(syn({ sort: "newest" }).items), [mid.item_id, lo.item_id, hi.item_id]);
  assert.deepEqual(ids(syn({ minScore: 50 }).items), [hi.item_id, mid.item_id]);
  assert.deepEqual(ids(syn({ direction: "+" }).items), [mid.item_id]);
  assert.deepEqual(ids(syn({ direction: "-" }).items), [hi.item_id, lo.item_id]);
  assert.deepEqual(ids(syn({ direction: "bogus" }).items).length, 3, "an unknown direction filters nothing");
  const capped = syn({ limitPer: 1 });
  assert.equal(capped.n, 3);
  assert.equal(capped.items.length, 1);
  assert.equal(capped.more, 2);

  const p1 = covRow({ role: "program", score: 30, first_seen: iso(DAY) });
  const p2 = covRow({ role: "program", score: 65, first_seen: iso(2 * DAY) });
  const ind = (opts) => section(industryView({ coverage: [p1, p2], aux: [] }, REL, opts).tickers, "SYN").groups.flatMap((g) => g.items);
  assert.deepEqual(ind().map((r) => [r.item_id, r.low]), [[p1.item_id, true], [p2.item_id, false]], "newest first, low marked");
  assert.deepEqual(ids(ind({ minScore: 40 })), [p2.item_id]);
  assert.deepEqual(ind({ kind: "rules" }), []);
});

test("competitorsView: section header counts and the rivals-only quiet line", () => {
  const v = competitorsView({ coverage: [], aux: [auxRow({ source_key: "widget_corp" })] }, REL);
  const syn = section(v, "SYN");
  const comps = REL.competitorsOf("SYN");
  assert.equal(syn.rival_sources, REL.rivalSourceCount("SYN"));
  assert.equal(syn.key_accounts, REL.keyAccountsOf("SYN").length);
  assert.equal(syn.rivals_watched, [...comps.values()].filter((e) => e.watched).length);
  assert.ok(!syn.quiet.names.includes("Widget Corp"), "a competitor with a row is not quiet");
  assert.equal(syn.quiet.count, comps.size - 1);
  assert.equal(section(v, "QXZ").rival_sources, 0, "a ticker with no rival source");
  assert.deepEqual(competitorsView({ coverage: [], aux: [] }, REL, { ticker: "ACM" }).map((s) => s.ticker), ["ACM"]);
  assert.deepEqual(competitorsView({ coverage: [], aux: [] }, REL, { ticker: "ZZZQ" }), []);
  assert.deepEqual(competitorsView({ coverage: [], aux: [] }, REL).map((s) => s.ticker), TICKERS);
});

// --- V10 ----------------------------------------------------------------------------------------
test("V10: promotion invariance (pure): a flagged row moves from its kind group to the declared area", () => {
  const row = covRow({ rung: "industry", flags: '["reason:material","industry:x"]', url: "https://www.federalregister.gov/d/1" });
  assert.deepEqual(row.industry_ids, ["x"]);
  const before = section(industryView({ coverage: [row], aux: [] }, REL, { industry: {} }).tickers, "SYN");
  assert.deepEqual(before.areas, []);
  assert.deepEqual(before.groups.map((g) => [g.kind, ids(g.items)]), [["rules", [row.item_id]]]);
  const after = section(industryView({ coverage: [row], aux: [] }, REL, { industry: { SYN: { x: { core: true }, y: { core: false } } } }).tickers, "SYN");
  assert.deepEqual(after.areas.map((a) => [a.id, a.core, ids(a.items)]), [["x", true, [row.item_id]], ["y", false, []]]);
  assert.deepEqual(after.groups, [], "a row placed in an area is not repeated in its kind group");
  assert.equal(industryKind(row, { ticker: "ACM", industry: { SYN: { x: { core: true } } } }), "rules", "another ticker's link does not apply");
});

test("V10: with INDUSTRY patched in the bundle (one line), industryView shows the area with no code change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zenith-views-"));
  try {
    let replaced = 0;
    for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
      let code = readFileSync(new URL(f, SRC), "utf8")
        .replace(/from\s+"\.\/([^"]+\.json)"/g, (m, rel) => `from "${new URL(rel, SRC).href}" with { type: "json" }`);
      if (f === "rubric.generated.js") {
        const candidate = code.match(/^export const CANDIDATE_INDUSTRY = .*;$/m)?.[0];
        code = code.replace(/^export const INDUSTRY = .*;$/m, () => { replaced++; return 'export const INDUSTRY = {"SYN":{"x":{"core":true}}};'; });
        assert.equal(code.match(/^export const CANDIDATE_INDUSTRY = .*;$/m)?.[0], candidate, "CANDIDATE_INDUSTRY is untouched");
      }
      writeFileSync(join(dir, f), code);
    }
    assert.equal(replaced, 1, "exactly one INDUSTRY line");
    const patched = await import(pathToFileURL(join(dir, "views.js")).href);
    const row = covRow({ rung: "industry", flags: '["industry:x"]', url: "https://www.tradepress.example/x" });
    const s = section(patched.industryView({ coverage: [row], aux: [] }, REL).tickers, "SYN");
    assert.deepEqual(s.areas.map((a) => [a.id, a.core, ids(a.items)]), [["x", true, [row.item_id]]]);
    assert.deepEqual(section(industryView({ coverage: [row], aux: [] }, REL).tickers, "SYN").areas, [], "the bundled INDUSTRY declares no SYN area");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- V11 ----------------------------------------------------------------------------------------
function spyDb(results = () => []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: null };
      calls.push(call);
      const stmt = { bind(...args) { call.binds = args; return stmt; }, async all() { return { results: results(call), success: true, meta: {} }; } };
      return stmt;
    },
  };
}

test("V11: the ticker form binds the ticker and the competitor list and splices neither", async () => {
  const DB = spyDb();
  const w = WINDOW();
  await windowRows({ DB }, { ...w, ticker: "QXZ", muted: MUTED_SQL, rel: REL });
  assert.equal(DB.calls.length, 2);
  const [cov, aux] = DB.calls;
  assert.deepEqual(cov.binds, [w.fromIso, w.toIso, "QXZ"]);
  assert.deepEqual(aux.binds, [w.fromIso, w.toIso, "QXZ", JSON.stringify([...REL.competitorsOf("QXZ").keys()])]);
  for (const c of DB.calls) {
    // The universe list (built by code from the covered tickers) is the only place a ticker is inlined.
    assert.doesNotMatch(c.sql.replace(universeSql(TICKERS), "<UNIVERSE>"), /QXZ/, "the ticker is never in the statement text");
    assert.ok(!c.sql.includes(w.fromIso), "the window bounds are bound");
  }
  const acm = spyDb();
  await windowRows({ DB: acm }, { ...w, ticker: "ACM", muted: MUTED_SQL, rel: REL });
  const keys = JSON.parse(acm.calls[1].binds[3]);
  assert.deepEqual(keys.sort(), [...REL.competitorsOf("ACM").keys()].sort());
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(!acm.calls[1].sql.includes(k), `${k} is bound, not spliced`);

  const all = spyDb();
  await windowRows({ DB: all }, { ...w, muted: MUTED_SQL, rel: REL });
  assert.deepEqual(all.calls.map((c) => c.binds), [[w.fromIso, w.toIso], [w.fromIso, w.toIso]]);
  assert.doesNotMatch(all.calls[0].sql, /\?3/);
});

test("V11: windowRows' ticker form keeps only T's coverage rows and aux rows that can belong to T", async () => {
  const env = newEnv();
  const synRival = addItem(env, { ticker: "SYN" });
  addGrade(env, synRival);
  const acmRival = addItem(env, { ticker: "ACM", source_key: "acme_rival_src" });
  addGrade(env, acmRival);
  const crossGrade = addItem(env, { ticker: "ACM", role: "program", source_key: "prog_z" });
  addGrade(env, crossGrade, { run_id: "run-x" });
  addGrade(env, crossGrade, { ticker: "SYN", run_id: "run-x" });
  const peerRow = addAux(env, { source_key: "widget_corp" });              // entity is a competitor of SYN
  const affectsRow = addAux(env, { source_key: "city_council", affects: "ACM,SYN" });
  const readsRow = addAux(env, { source_key: "other_co", reads_through: reads(["SYN", "+"]) });
  addAux(env, { source_key: "other_co", reads_through: "not json" });     // malformed: no throw, not SYN's
  addAux(env, { source_key: "hedge_co" });                                // ACM's competitor
  addAux(env, { source_key: "other_co", affects: "SYNX" });               // a longer ticker is not SYN

  const rows = await load(env, { ticker: "SYN" });
  assert.deepEqual(ids(rows.coverage).sort(), [synRival, crossGrade].sort());
  assert.ok(rows.coverage.every((r) => r.grade_ticker === "SYN"));
  assert.deepEqual(ids(rows.aux).sort(), [peerRow, affectsRow, readsRow].sort());
  const allRows = await load(env);
  assert.equal(allRows.aux.length, 6, "the all-ticker form keeps every graded aux row");
});

test("windowRows: inputs are checked before any statement runs", async () => {
  const DB = spyDb();
  const w = WINDOW();
  for (const ticker of ["ZZZQ", "AAA') OR 1=1--", "syn", "", 5]) {
    await assert.rejects(windowRows({ DB }, { ...w, ticker, muted: MUTED_SQL, rel: REL }), RangeError, String(ticker));
  }
  await assert.rejects(windowRows({ DB }, { ...w, rel: REL }), TypeError, "muted is required");
  await assert.rejects(windowRows({ DB }, { ...w, muted: MUTED_SQL }), TypeError, "rel is required");
  await assert.rejects(windowRows({ DB }, { fromIso: "junk", toIso: w.toIso, muted: MUTED_SQL, rel: REL }), TypeError);
  assert.equal(DB.calls.length, 0);
  assert.throws(() => windowSql({ muted: MUTED_SQL, universe: "" }), TypeError);
});

test("windowRows: a pipeline at the 1,000-row guard is reported as capped; the universe defaults to rel's tickers", async () => {
  const DB = spyDb((call) => (/FROM aux_items/.test(call.sql) ? Array.from({ length: WINDOW_LIMIT }, (_, i) => ({ item_id: i + 1, source_key: "widget_corp" })) : []));
  const r = await windowRows({ DB }, { ...WINDOW(), muted: MUTED_SQL, rel: REL });
  assert.deepEqual(r.capped, { coverage: false, aux: true });
  assert.equal(r.aux.length, WINDOW_LIMIT);
  assert.ok(DB.calls[0].sql.includes(universeSql(TICKERS)));
  assert.match(DB.calls[0].sql, /LIMIT 1000$/);
  const custom = universeSql(["SYN"]);
  const DB2 = spyDb();
  await windowRows({ DB: DB2 }, { ...WINDOW(), muted: MUTED_SQL, universe: custom, rel: REL });
  assert.ok(DB2.calls[0].sql.includes(custom));
});

// --- V12 ----------------------------------------------------------------------------------------
test("V12: views.js, relations.js (and views-page.js once it exists) reach no forbidden module, fetch nothing, never name CANDIDATE_ or NEWS", () => {
  const forbidden = ["delivery.js", "discord.js", "brief.js", "ingest.js", "excerpt.js", "tuning.js", "auxiliary.js", "index.js"];
  for (const start of ["views.js", "views-page.js", "relations.js"]) {
    if (!existsSync(new URL(start, SRC))) { assert.equal(start, "views-page.js", `${start} exists`); continue; }
    const seen = new Set();
    const walk = (f) => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) walk(m[1]);
    };
    walk(start);
    for (const bad of forbidden) assert.ok(!seen.has(bad), `${start} reaches ${bad}`);
    const text = readFileSync(new URL(start, SRC), "utf8");
    assert.doesNotMatch(text, /\bfetch\(/, start);
    assert.doesNotMatch(text, /CANDIDATE_/, start);
    assert.doesNotMatch(text, /\bNEWS\b/, start);
  }
  const text = readFileSync(new URL("views.js", SRC), "utf8");
  assert.doesNotMatch(text, /from\s+"\.\/relations(\.generated)?\.js"/, "views.js takes rel from its caller");
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE)\b/, "views.js writes nothing");
});
