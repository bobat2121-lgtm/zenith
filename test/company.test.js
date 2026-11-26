// Phase 3 Part B (P3-B2): worker/src/company.js, the Company page's data.
// Synthetic rows only. Tickers and source keys are picked from the bundled
// maps (covered.json, aux-sources.json, the relations module) at run time by
// their properties, never written here; synthetic keys (managed_test_news,
// test_series) stay literal. The sheet calendar is replaced by a synthetic one
// (calendar.generated.js patched in a temp copy of worker/src).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { D1, addItem, addGrade } from "./helpers/d1.js";
import { OPS_ALERTS_SQL, MANAGED_HEALTH_SQL } from "./helpers/news-ops.js";

const SRC = new URL("../worker/src/", import.meta.url);
const COV = JSON.parse(readFileSync(new URL("covered.json", SRC), "utf8"));
const AUX = JSON.parse(readFileSync(new URL("aux-sources.json", SRC), "utf8"));
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ago = (days) => iso(NOW - days * DAY);
const KA = new Set(["customer", "program", "relationship", "index_event"]);

// The synthetic sheet calendar is built once the calendar ticker is picked, so
// the modules load from a temp copy with calendar.generated.js replaced.
// asyncRelations: loadRelations becomes async in the copy (the phase 4 seam, spec I6).
async function loadModules(calendar, { asyncRelations = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zenith-company-"));
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    let code = readFileSync(new URL(f, SRC), "utf8")
      .replace(/from\s+"\.\/([^"]+\.json)"/g, (m, rel) => `from "${new URL(rel, SRC).href}" with { type: "json" }`);
    if (f === "calendar.generated.js") code = `export const CALENDAR_VERSION = "c-test";\nexport const CALENDAR = ${JSON.stringify(calendar)};\n`;
    if (asyncRelations && f === "relations.js") {
      assert.match(code, /^export function loadRelations\(/m);
      code = code.replace(/^export function loadRelations\(/m, "export async function loadRelations(");
    }
    writeFileSync(join(dir, f), code);
  }
  const imp = (n) => import(pathToFileURL(join(dir, n)).href);
  return { company: await imp("company.js"), relations: await imp("relations.js"), calendar: await imp("calendar.js"), et: await imp("et.js"),
    signals: await imp("source-signals.js"), generated: await imp("relations.generated.js"), rubric: await imp("rubric.generated.js") };
}

// Picks from the real maps, before the patched load (the channel map does not depend on the calendar).
const pre = await loadModules([]);
const relPre = pre.relations.loadRelations();
// channelsFor is async (it awaits loadRelations); the maps are read once here so the picks stay synchronous.
const mapsOf = async (company) => new Map(await Promise.all(COV.tickers.map(async (t) => [t, await company.channelsFor(t)])));
const preMaps = await mapsOf(pre.company);
const chPre = (t) => preMaps.get(t);
const pick = (what, fn) => {
  const t = COV.tickers.find(fn);
  assert.ok(t, `no covered ticker ${what}`);
  return t;
};
// SHAPE: own and SEC channels, a counterparty key-account key, a counterparty rival key, competitor entities.
const SHAPE = pick("with own, SEC, key-account and rival channels", (t) => {
  const ch = chPre(t);
  return ch.own.length && ch.sec.includes(`edgar_${t.toLowerCase()}`) && ch.key_accounts.some((k) => KA.has(COV.counterparty[k]?.role))
    && ch.rivals.some((k) => COV.counterparty[k]?.role === "rival") && ch.entities.length;
});
// REG: a counterparty register key and an aux coverage-subject register key.
const REG = pick("with register channels", (t) => t !== SHAPE && chPre(t).registers.some((k) => COV.counterparty[k]) && chPre(t).registers.some((k) => AUX.sources[k]?.coverage_subject));
const LEG = pick("with legistar channels", (t) => chPre(t).legistar.length);
const NOREG = pick("with no register channel", (t) => !chPre(t).registers.length);

const today = pre.et.etParts(NOW).date;
const plus = (n) => pre.et.addDays(today, n);
const CAL = [
  { ticker: SHAPE, kind: "catalyst", start: plus(10), end: plus(10), precision: "day", text: "Synthetic product day" },
  { ticker: SHAPE, kind: "catalyst", start: plus(20).slice(0, 8) + "01", end: plus(20).slice(0, 8) + "28", precision: "month", approx: true, text: "Synthetic month estimate" },
  { ticker: SHAPE, kind: "open_item_expiry", start: plus(12), end: plus(12), precision: "day", deadline: true, text: "Synthetic open item review" },
  { ticker: SHAPE, kind: "catalyst", start: plus(14), end: plus(14), precision: "day", context: true, text: "Synthetic context line" },
  { ticker: SHAPE, kind: "status_event", start: plus(-3), end: plus(-3), precision: "day", text: "Synthetic status event" },
];
const M = await loadModules(CAL);
const { companyData, companyRoute, filledSections, redactError, parseCompanyQuery, SECTIONS, COMPANY_SQL } = M.company;
const rel = M.relations.loadRelations();
const maps = await mapsOf(M.company);
const channelsFor = (t) => maps.get(t);

// --- Fixtures -------------------------------------------------------------------------------------------

let nm = 900_000;
async function addAux(db, over = {}, grade = {}) {
  const i = { nm_rowid: nm++, source_key: "test_aux", entity_key: "test_entity", entity_name: "Test Co", status: "public", url: `https://example.com/a/${nm}`,
    title: "Aux title", published: null, nm_first_seen: ago(1), ingested_at: ago(1), state: "graded", coverage_subject: 0, affects: null, admit: null,
    released_at: null, story_of: null, ...over };
  const r = await db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at,
      state, coverage_subject, affects, admit, released_at, story_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(i.nm_rowid, i.source_key, i.entity_key, i.entity_name, i.status, i.url, i.title, i.published, i.nm_first_seen, i.ingested_at, i.state,
      i.coverage_subject, i.affects, i.admit, i.released_at, i.story_of).run();
  const id = r.meta.last_row_id;
  if (grade !== null) {
    const g = { score: 60, band: null, why: "why", covered_ticker: null, reads_through: "[]", dup_of: null, ...grade };
    if (!g.band) g.band = g.score == null ? "duplicate" : g.score >= 90 ? "lead" : g.score >= 70 ? "digest" : g.score >= 40 ? "borderline" : "reject";
    const gr = await db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, covered_ticker, score, band, why, reads_through, flags, dup_of, graded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`).bind(id, `run-${id}`, i.entity_name, g.covered_ticker, g.score, g.band, g.why,
      typeof g.reads_through === "string" ? g.reads_through : JSON.stringify(g.reads_through), g.dup_of, ago(1)).run();
    await db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").bind(gr.meta.last_row_id, id).run();
  }
  return { id, nm_rowid: i.nm_rowid };
}
const item = (db, T, over = {}) => addItem(db, { ticker: T, nm_first_seen: ago(1), ...over });
async function graded(db, T, over = {}, g = {}) {
  const id = await item(db, T, over);
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
  n.exec(STATE_SQL);
  n.exec(OPS_ALERTS_SQL);
  n.exec(MANAGED_HEALTH_SQL);
  n.exec(SERIES_SQL);
  return n;
}
// Every channel key of T OK (polled an hour ago, next poll ahead).
function allOk(news, T, over = {}) {
  const ch = channelsFor(T);
  for (const k of [...ch.own, ...ch.sec, ...ch.registers, ...ch.rivals, ...ch.key_accounts]) {
    const s = { last_ok: ago(1 / 24), fail_count: 0, last_error: null, next_poll_at: iso(NOW + 30 * 60_000), ...(over[k] || {}) };
    if (s.skip) continue;
    news.db.prepare("INSERT INTO source_state (key, last_ok, fail_count, last_error, next_poll_at) VALUES (?, ?, ?, ?, ?)")
      .run(k, s.last_ok, s.fail_count, s.last_error, s.next_poll_at);
  }
}
const addPoint = (news, p) => news.db.prepare(`INSERT INTO series_points (series, subject, period, value, source_key, ticker, label, record_url, observed_at, updated_at)
  VALUES (?, ?, ?, ?, 'test_series_src', ?, ?, ?, ?, ?)`).run(p.series ?? "test_series", p.subject, p.period, p.value, p.ticker ?? null, p.label ?? null,
  p.record_url ?? null, ago(1), ago(1));

const data = (env, T, opts = {}) => companyData(env, T, { now: NOW, ...opts });
const ids = (rows) => rows.map((r) => r.id);
const flat = (rows) => rows.flatMap((r) => [r, ...(r.copies || [])]);

// --- Validation -----------------------------------------------------------------------------------------

test("validation: an unknown or malformed ticker returns an error and reads nothing; days and section are checked", async () => {
  const env = { DB: { prepare() { throw new Error("no read expected"); }, batch() { throw new Error("no read expected"); } } };
  for (const t of ["TST", "<script>", "", null, "a".repeat(20)]) assert.deepEqual(await data(env, t), { error: "unknown ticker", status: 404 });
  assert.equal((await data(env, SHAPE, { days: 31 })).status, 400);
  assert.equal((await data(env, SHAPE, { days: 0 })).status, 400);
  assert.equal((await data(env, SHAPE, { section: "nope" })).status, 400);
  const q = (s) => parseCompanyQuery(new URLSearchParams(s));
  assert.deepEqual(q(`ticker=${SHAPE.toLowerCase()}`), { ticker: SHAPE, days: 30, section: null });
  assert.deepEqual(q(`ticker=${SHAPE}&days=7&section=rivals`), { ticker: SHAPE, days: 7, section: "rivals" });
  for (const bad of ["days=1.5", "days=x", "days=31", "days=-1"]) assert.equal(q(`ticker=${SHAPE}&${bad}`).status, 400, bad);
  assert.equal(q("ticker=TST").status, 404);
  assert.deepEqual(SECTIONS, ["own", "filings", "ownership", "registers", "series", "rivals", "key_accounts", "calendar", "source_health"]);
});

test("I6: companyData and channelsFor await loadRelations, so an async loadRelations (phase 4) changes nothing", async () => {
  assert.ok(M.company.channelsFor(SHAPE) instanceof Promise);
  const A = await loadModules(CAL, { asyncRelations: true });
  assert.ok(A.relations.loadRelations() instanceof Promise, "the patched copy is async");
  const db = new D1();
  const ownKey = channelsFor(SHAPE).own[0];
  const id = await graded(db, SHAPE, { source_key: ownKey, title: "Release" });
  await graded(db, SHAPE, { source_key: "test_rival_src", role: "rival", title: "Rival" });
  const a = await A.company.companyData({ DB: db }, SHAPE, { now: NOW });
  const b = await data({ DB: db }, SHAPE);
  assert.equal(a.error, undefined);
  assert.deepEqual(ids(a.sections.own.rows), [id]);
  assert.deepEqual(a.sections, b.sections);
  assert.deepEqual(a.reference, b.reference);
  assert.deepEqual(await A.company.channelsFor(SHAPE), channelsFor(SHAPE));
});

// --- T3: sections -----------------------------------------------------------------------------------------

test("T3: rows go to the right section (records.js:23-30 classes, covered.json groups)", async () => {
  const db = new D1();
  const ch = channelsFor(SHAPE);
  const ownKey = ch.own[0], secKey = `edgar_${SHAPE.toLowerCase()}`;
  const kaKey = ch.key_accounts.find((k) => KA.has(COV.counterparty[k]?.role));
  const rivalKey = ch.rivals.find((k) => COV.counterparty[k]?.role === "rival");
  const entity = ch.entities.find((e) => !Object.values(AUX.sources).some((s) => s.entity === e && ch.auxKeys.includes(Object.keys(AUX.sources).find((k) => AUX.sources[k] === s))));
  const own = await graded(db, SHAPE, { source_key: ownKey, title: "Release" });
  const filing = await graded(db, SHAPE, { source_key: secKey, title: "10-Q quarterly report" });
  const ownership = await graded(db, SHAPE, { source_key: secKey, title: "Form 4: a director bought shares" });
  const ka = await graded(db, SHAPE, { source_key: kaKey, role: COV.counterparty[kaKey].role, title: "Customer order" });
  const rival = await graded(db, SHAPE, { source_key: rivalKey, role: "rival", title: "Rival news" });
  const ent = await addAux(db, { source_key: "managed_test_news", entity_key: entity ?? ch.entities[0], title: "Competitor news" });
  const regTicker = REG, rch = channelsFor(REG);
  const regCp = rch.registers.find((k) => COV.counterparty[k]);
  const regAux = rch.registers.find((k) => AUX.sources[k]?.coverage_subject);
  const reg1 = await graded(db, regTicker, { source_key: regCp, role: COV.counterparty[regCp].role, title: "Contract award" });
  const reg2 = await addAux(db, { source_key: regAux, entity_key: AUX.sources[regAux].entity, coverage_subject: 1, affects: regTicker, title: "Register record" });
  const d = await data({ DB: db }, SHAPE);
  assert.deepEqual(ids(d.sections.own.rows), [own]);
  assert.deepEqual(ids(d.sections.filings.rows), [filing]);
  assert.deepEqual(ids(d.sections.ownership.rows), [ownership]);
  assert.deepEqual(ids(d.sections.key_accounts.rows), [ka]);
  assert.deepEqual(d.sections.rivals.rows.map((r) => [r.kind, r.id]).sort(), [["aux", ent.id], ["coverage", rival]].sort());
  assert.deepEqual(d.sections.registers.rows, []);
  const r = await data({ DB: db }, REG);
  assert.deepEqual(r.sections.registers.rows.map((x) => [x.kind, x.id]).sort(), [["aux", reg2.id], ["coverage", reg1]].sort());
  assert.equal(d.sections.rivals.rows.find((x) => x.kind === "aux").via, "entity");
});

test("T3b: a twin shows once; the aux copy shows when the coverage copy is skipped rival_no_key_account (lib.js:57-64)", async () => {
  const ch = channelsFor(SHAPE);
  const rivalKey = ch.rivals.find((k) => COV.counterparty[k]?.role === "rival" && AUX.sources[k]);
  assert.ok(rivalKey, "a counterparty rival key that is also an aux key");
  for (const skipped of [false, true]) {
    const db = new D1();
    const cov = skipped
      ? await item(db, SHAPE, { source_key: rivalKey, role: "rival", state: "skipped", skip_reason: "rival_no_key_account", nm_rowid: 777 })
      : await graded(db, SHAPE, { source_key: rivalKey, role: "rival", nm_rowid: 777 });
    const aux = await addAux(db, { nm_rowid: 777, source_key: rivalKey, entity_key: AUX.sources[rivalKey].entity });
    const d = await data({ DB: db }, SHAPE);
    const rows = d.sections.rivals.rows.map((r) => [r.kind, r.id]);
    assert.deepEqual(rows, skipped ? [["aux", aux.id]] : [["coverage", cov]], `skipped=${skipped}`);
  }
});

test("T3c: a covered-band row shows only on its covered name's page; an ungraded coverage subject waits (auxiliary.js:702-704)", async () => {
  const key = Object.keys(AUX.sources).find((k) => {
    const s = AUX.sources[k];
    const a = (s.affects || []).filter((x) => COV.tickers.includes(x));
    return s.coverage_subject && (s.record || s.sec) && a.length >= 2 && a.every((x) => channelsFor(x).groupOf.get(k) === "registers");
  });
  assert.ok(key, "a register coverage-subject key that names two covered tickers");
  const [A, B] = AUX.sources[key].affects.filter((x) => COV.tickers.includes(x));
  const db = new D1();
  const cov = await addAux(db, { source_key: key, entity_key: AUX.sources[key].entity, coverage_subject: 1, affects: AUX.sources[key].affects.join(",") },
    { band: "covered", score: 50, covered_ticker: A });
  const wait = await addAux(db, { source_key: key, entity_key: AUX.sources[key].entity, coverage_subject: 1, affects: B }, null);
  const a = await data({ DB: db }, A);
  assert.deepEqual(ids(a.sections.registers.rows), [cov.id]);
  const b = await data({ DB: db }, B);
  assert.deepEqual(b.sections.registers.rows, []);
  assert.equal(b.sections.registers.left_out.reasons[`about ${A}`], 1);
  assert.equal(b.sections.registers.left_out.reasons["waiting for a grade"], 1);
  assert.equal(b.filled.registers, false);
  assert.equal(b.sections.registers.fill.lenient, true, "the lenient rule counts it");
  assert.equal(b.filled_lenient_count - b.filled_count >= 1, true);
  void wait;
});

test("T3f: a covered-band row about this name from a competitor's channel goes to own items, marked about (step 10), not rivals or registers", async () => {
  let T, key;
  for (const t of COV.tickers) {
    key = channelsFor(t).rivals.find((k) => {
      const s = AUX.sources[k];
      return s && rel.rivalTickers({ source_key: k, entity_key: s.entity || k, status: s.status ?? null, coverage_subject: s.coverage_subject ? 1 : 0 }, "aux").includes(t);
    });
    if (key) { T = t; break; }
  }
  assert.ok(T, "a rival aux key the rivals rule places with its ticker");
  const s = AUX.sources[key];
  const db = new D1();
  const a = await addAux(db, { source_key: key, entity_key: s.entity || key, status: s.status ?? null, coverage_subject: s.coverage_subject ? 1 : 0 },
    { band: "covered", score: 55, covered_ticker: T });
  const plain = await addAux(db, { source_key: key, entity_key: s.entity || key, status: s.status ?? null, coverage_subject: s.coverage_subject ? 1 : 0 });
  const d = await data({ DB: db }, T);
  assert.deepEqual(ids(d.sections.own.rows), [a.id]);
  assert.equal(d.sections.own.rows[0].about, `about ${T}, via ${key}`);
  assert.deepEqual(ids(d.sections.rivals.rows), [plain.id], "the same channel's other rows stay under rivals");
  assert.deepEqual(d.sections.registers.rows, []);
});

test("T3d: a counterparty key-account twin whose entity is also a competitor stays under key accounts (channel group, not entity)", async () => {
  let T, key;
  for (const t of COV.tickers) {
    const ch = channelsFor(t), comp = rel.competitorsOf(t);
    key = ch.key_accounts.find((k) => COV.counterparty[k] && comp.has(AUX.sources[k]?.entity));
    if (key) { T = t; break; }
  }
  assert.ok(T, "a key-account twin with a competitor entity");
  const db = new D1();
  const a = await addAux(db, { source_key: key, entity_key: AUX.sources[key].entity });
  const d = await data({ DB: db }, T);
  assert.deepEqual(ids(d.sections.key_accounts.rows), [a.id]);
  assert.deepEqual(d.sections.rivals.rows, []);
});

test("T3e: a managed-lane row of a competitor entity is a rival row; its health comes from universe_managed_health (source-signals.js:250)", async () => {
  assert.equal(M.company.MANAGED_FAIL_MIN, M.signals.MANAGED_FAIL_MIN);
  const ch = channelsFor(SHAPE);
  for (const [fails, status] of [[2, "ok"], [3, "failing"]]) {
    const db = new D1();
    const a = await addAux(db, { source_key: "managed_test_news", entity_key: ch.entities[0] });
    const news = newsDb();
    allOk(news, SHAPE);
    news.db.prepare("INSERT INTO universe_managed_health (key, last_ok, fail_count, next_poll_at) VALUES ('managed_test_news', ?, ?, ?)")
      .run(ago(1 / 24), fails, iso(NOW + 60_000));
    const d = await data({ DB: db, NEWS: news }, SHAPE);
    assert.deepEqual(ids(d.sections.rivals.rows), [a.id]);
    assert.equal(d.quiet.groups.rivals.managed, 1);
    const row = d.sections.source_health.rows.find((r) => r.key === "managed_test_news");
    assert.equal(row.status, status, `fail_count ${fails}`);
    assert.equal(d.quiet.groups.rivals.failing.includes("managed_test_news"), status === "failing");
  }
});

test("T22: every aux key of registry/rivals.json is in its ticker's rivals group", async () => {
  const rivals = M.generated.RELATIONS.rivals || {};
  let n = 0;
  for (const [t, keys] of Object.entries(rivals)) {
    if (!COV.tickers.includes(t)) continue;
    for (const k of keys) {
      if (!AUX.sources[k]) continue;
      n++;
      assert.ok(channelsFor(t).rivals.includes(k), `${t}: ${k}`);
    }
  }
  assert.ok(n > 0, "the rivals file has aux keys");
});

test("T25: one rivals rule. On every page, an aux row under rivals has the ticker in rel.rivalTickers, and none with it is under registers or key accounts", async () => {
  const db = new D1();
  const byId = new Map();
  const keys = Object.keys(AUX.sources);
  for (const [i, k] of keys.entries()) {
    const s = AUX.sources[k];
    const row = { source_key: k, entity_key: s.entity || k, status: s.status ?? null, coverage_subject: s.coverage_subject ? 1 : 0,
      affects: (s.affects || []).join(",") || null };
    // Some rows read through a covered ticker, so the grade's own reads_through is exercised too.
    const t = (s.affects || []).find((x) => COV.tickers.includes(x));
    const reads = i % 3 === 0 && t ? [{ ticker: t, direction: "-" }] : [];
    const a = await addAux(db, row, { reads_through: reads });
    byId.set(a.id, { ...row, reads_through: JSON.stringify(reads) });
  }
  let rivalRows = 0;
  for (const T of COV.tickers) {
    const d = await data({ DB: db }, T, { section: null });
    const full = [];
    for (const s of ["rivals", "registers", "key_accounts"]) full.push(await data({ DB: db }, T, { section: s }));
    const [riv, reg, ka] = full.map((x, j) => flat(x.sections[["rivals", "registers", "key_accounts"][j]].rows).filter((r) => r.kind === "aux"));
    for (const r of riv) {
      rivalRows++;
      assert.ok(rel.rivalTickers(byId.get(r.id), "aux").includes(T), `${T} rivals: ${r.source_key}`);
    }
    for (const r of [...reg, ...ka]) assert.ok(!rel.rivalTickers(byId.get(r.id), "aux").includes(T), `${T} registers/key accounts: ${r.source_key}`);
    assert.ok(d.sections.rivals.total >= 0);
  }
  assert.ok(rivalRows > 0);
});

// --- T4-T8: windows, shown, copies ------------------------------------------------------------------------

test("T4: the event date sets the window; the ownership strip lists dated filings stored skipped", async () => {
  const sec = `edgar_${SHAPE.toLowerCase()}`;
  for (const [days, own, filings] of [[400, 0, 0], [5, 1, 0]]) {
    const db = new D1();
    await item(db, SHAPE, { source_key: sec, title: "SC 13D/A amendment", published: ago(days), nm_first_seen: ago(0.01), state: "skipped", skip_reason: "stale_on_arrival" });
    const d = await data({ DB: db }, SHAPE);
    assert.equal(d.sections.ownership.rows.length, own, `published ${days} days ago`);
    assert.equal(d.sections.filings.rows.length, filings);
    assert.equal(d.filled.ownership, own === 1);
    assert.equal(d.filled.filings, false);
    if (own) assert.equal(d.sections.ownership.rows[0].on_record, true);
  }
});

test("T5: undated skipped rows never count and never look new", async () => {
  const db = new D1();
  for (let i = 0; i < 10; i++) await item(db, SHAPE, { source_key: channelsFor(SHAPE).own[0], state: "skipped", skip_reason: "archive_seed" });
  const d = await data({ DB: db }, SHAPE);
  assert.equal(d.filled.own, false);
  assert.deepEqual(d.sections.own.left_out, { n: 10, reasons: { archive_seed: 10 } });
  assert.equal(d.quiet.new_24h, 0);
});

test("T6: held rows are hidden; a duplicate collapses under its canonical row and is counted", async () => {
  const db = new D1();
  const sec = `edgar_${SHAPE.toLowerCase()}`;
  const held = await item(db, SHAPE, { source_key: channelsFor(SHAPE).own[0] });
  await db.prepare("UPDATE items SET admit = 'record', released_at = NULL WHERE id = ?").bind(held).run();
  const canon = await graded(db, SHAPE, { source_key: sec, title: "8-K current report", published: ago(2) });
  const copy = await graded(db, SHAPE, { source_key: sec, title: "8-K current report (copy)", published: ago(2), nm_first_seen: ago(0.5) });
  await db.prepare("UPDATE items SET story_of = ? WHERE id = ?").bind(canon, copy).run();
  const d = await data({ DB: db }, SHAPE);
  assert.deepEqual(d.sections.own.rows, []);
  assert.equal(d.sections.own.left_out.reasons.held, 1);
  assert.equal(d.filled.own, false);
  assert.deepEqual(ids(d.sections.filings.rows), [canon]);
  assert.deepEqual(ids(d.sections.filings.rows[0].copies), [copy]);
  assert.equal(d.sections.filings.shown, 2);
});

test("T7: an undated Lead shows as Digest (index.js feed band rule)", async () => {
  const db = new D1();
  const id = await graded(db, SHAPE, { source_key: channelsFor(SHAPE).own[0], published: null }, { score: 92 });
  const d = await data({ DB: db }, SHAPE);
  const r = d.sections.own.rows.find((x) => x.id === id);
  assert.equal(r.band, "digest");
  assert.equal(r.stored_band, "lead");
  assert.equal(r.undated, true);
});

test("T8: other names' items graded for this name, from the primary grade's run only and inside the window; never counted (index.js SHOWN_GRADE)", async () => {
  const P = COV.tickers.find((t) => t !== SHAPE);
  const db = new D1();
  const a = await item(db, P, { title: "Shown cross grade" });
  await addGrade(db, a, { run_id: "run-1" });
  await addGrade(db, a, { ticker: SHAPE, run_id: "run-1", score: 70 });
  const b = await item(db, P, { title: "Other run" });
  await addGrade(db, b, { run_id: "run-1" });
  await addGrade(db, b, { ticker: SHAPE, run_id: "run-2", score: 70 });
  const c = await item(db, P, { title: "Old", nm_first_seen: ago(40) });
  await addGrade(db, c, { run_id: "run-1", graded_at: ago(40) });
  await addGrade(db, c, { ticker: SHAPE, run_id: "run-1", score: 70, graded_at: ago(40) });
  const d = await data({ DB: db }, SHAPE);
  assert.deepEqual(d.also_graded.map((r) => r.id), [a]);
  assert.equal(d.filled_count, (await data({ DB: new D1() }, SHAPE)).filled_count, "never counted");
  assert.equal(d.filled.key_accounts, false);
});

// --- T9: calendar -----------------------------------------------------------------------------------------

test("T9: calendar entries, notices from the 30-day items, the counted rule and council agendas (parity with calendar.js upcoming)", async () => {
  const db = new D1();
  const own = channelsFor(SHAPE).own[0];
  const day = (n) => { const [y, m, dd] = plus(n).split("-").map(Number); return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${dd}, ${y}`; };
  const flags = JSON.stringify(["reason:calendar_card"]);
  await graded(db, SHAPE, { source_key: own, title: `Results call on ${day(8)}` }, { score: null, flags });
  const n1 = await graded(db, SHAPE, { source_key: own, title: `Investor day on ${day(9)}` }, { score: 65, flags });
  await graded(db, SHAPE, { source_key: own, title: `Old notice for ${day(11)}`, nm_first_seen: ago(45) }, { score: 65, flags });
  const d = await data({ DB: db }, SHAPE);
  const rows = d.sections.calendar.rows;
  const text = (t) => rows.find((r) => r.text === t);
  assert.equal(text("Synthetic product day").counted, true);
  assert.deepEqual([text("Synthetic month estimate").counted, text("Synthetic month estimate").counted_lenient, text("Synthetic month estimate").tags], [false, true, ["estimate"]]);
  assert.deepEqual([text("Synthetic open item review").counted, text("Synthetic open item review").tags], [false, ["open item review"]]);
  assert.deepEqual([text("Synthetic context line").counted, text("Synthetic context line").tags], [false, ["context"]]);
  assert.equal(text("Synthetic status event"), undefined, "status events are not listed");
  const notices = rows.filter((r) => r.kind === "graded_notice");
  assert.deepEqual(notices.map((r) => [r.item_id, r.start]), [[n1, plus(9)]], "a notice needs a score (calendar.js:373); 45 days old is outside the 30-day read");
  assert.equal(d.sections.calendar.counted, 2);
  assert.equal(d.filled.calendar, true);

  // Council agendas for a name with legistar channels.
  const ldb = new D1();
  const lkey = channelsFor(LEG).legistar[0];
  const term = (M.rubric.MATCH[LEG]?.terms || []).find((t) => typeof t === "string" && t !== t.toLowerCase() && !/[\\^$.*+?()[\]{}|]/.test(t));
  assert.ok(term, "a capitalised company term");
  const url = "https://example.com/council/m/1";
  const ag = await item(ldb, LEG, { source_key: lkey, title: `${term} camera contract — Agenda Ready, agenda ${plus(5)}`, url, nm_first_seen: ago(60) });
  await item(ldb, LEG, { source_key: lkey, title: `${term} camera contract — vote ${plus(5)} City Council: Approved`, url: `${url}#vote-9`, published: plus(5), nm_first_seen: ago(1) });
  const bad = await item(ldb, LEG, { source_key: lkey, title: `${term} renewal — Agenda Ready, agenda ${plus(6)}`, url: "https://example.com/council/m/2",
    state: "skipped", skip_reason: "bad_url", nm_first_seen: ago(2) });
  const ld = await data({ DB: ldb }, LEG);
  const agendas = ld.sections.calendar.rows.filter((r) => r.kind === "council_agenda");
  assert.deepEqual(agendas.map((r) => r.item_id).sort(), [ag, bad].sort(), "the bad_url agenda is kept (calendar.js:428)");
  assert.equal(agendas.find((r) => r.item_id === ag).closed, true);
  const ref = await M.calendar.upcoming(ldb, [], { from: plus(-30), days: 60, ticker: LEG, noticesSince: ago(120) });
  assert.deepEqual(agendas.map((r) => [r.item_id, r.start]).sort(), ref.filter((e) => e.kind === "council_agenda").map((e) => [e.item_id, e.start]).sort());
});

// --- T10-T12: the quiet line, series, NEWS failures --------------------------------------------------------

test("T10: the all-quiet line names every group and every channel that was not checked", async () => {
  const ch = channelsFor(SHAPE);
  const db = new D1();
  let news = newsDb();
  allOk(news, SHAPE);
  let d = await data({ DB: db, NEWS: news }, SHAPE);
  assert.match(d.quiet.text, new RegExp(`^All quiet for ${SHAPE.replace(".", "\\.")} in the last 24 hours\\. Checked: own channels ${ch.own.length} of ${ch.own.length}, SEC ${ch.sec.length} of ${ch.sec.length}`));
  assert.doesNotMatch(d.quiet.text, /Not checked/);
  assert.equal(d.quiet.groups.own.keys, ch.own.length);

  const [failKey, disKey, missKey] = [ch.own[0], ch.sec[0], ch.key_accounts[0]];
  news = newsDb();
  allOk(news, SHAPE, { [failKey]: { fail_count: 3, last_ok: ago(3), last_error: "html 500 x".repeat(20) },
    [disKey]: { fail_count: 0, last_error: "disabled: needs X" }, [missKey]: { skip: true } });
  news.db.prepare("INSERT INTO ops_alerts (source_key, rule, opened_at) VALUES (?, 'outage', ?)").run(ch.rivals[0], ago(1));
  await graded(db, SHAPE, { source_key: ch.own[1] || ch.own[0], nm_first_seen: ago(2 / 24) });
  d = await data({ DB: db, NEWS: news }, SHAPE);
  assert.match(d.quiet.text, new RegExp(`^New for ${SHAPE.replace(".", "\\.")} in the last 24 hours: 1 \\(own 1\\)\\.`));
  assert.match(d.quiet.text, new RegExp(`Not checked: .*${failKey} \\(own channels\\) failing since ${ago(3).slice(0, 10).slice(0, 4)}`));
  assert.ok(d.quiet.groups.own.failing.includes(failKey));
  assert.ok(d.quiet.groups.sec.disabled.includes(disKey));
  assert.ok(d.quiet.groups.key_accounts.never.includes(missKey));
  assert.match(d.quiet.text, new RegExp(`${missKey} \\(key accounts\\) never polled`));
  assert.match(d.quiet.text, new RegExp(`Open alerts: ${ch.rivals[0]} \\(outage\\)`));
  const failRow = d.sections.source_health.rows.find((r) => r.key === failKey);
  assert.ok(failRow.last_error.length <= 160);
  const clipped = /failing since [^(]*\(([^)]*)\)/.exec(d.quiet.text)[1];
  assert.ok(clipped.length <= 80, "the line's error is clipped to 80");

  // No SEC channel.
  const NOSEC = COV.tickers.find((t) => !channelsFor(t).sec.length);
  if (NOSEC) {
    const n2 = newsDb();
    allOk(n2, NOSEC);
    assert.match((await data({ DB: new D1(), NEWS: n2 }, NOSEC)).quiet.text, /no SEC channel/);
  }
});

test("T10: the 24-hour count reads every shown row, not only the rows left after the cut to 8, and does not depend on section", async () => {
  const db = new D1();
  const own = channelsFor(SHAPE).own[0];
  for (let i = 0; i < 12; i++) await graded(db, SHAPE, { source_key: own, title: `New release ${i}`, nm_first_seen: ago((i + 1) / 48) });
  // Nine older rival rows score above one new low-score rival row, so the new one sorts last and is cut.
  for (let i = 0; i < 9; i++) await graded(db, SHAPE, { source_key: "test_rival_src", role: "rival", title: `Old rival ${i}`, nm_first_seen: ago(5) }, { score: 80 });
  const fresh = await graded(db, SHAPE, { source_key: "test_rival_src", role: "rival", title: "New rival", nm_first_seen: ago(2 / 24) }, { score: 45 });
  const d = await data({ DB: db }, SHAPE);
  assert.equal(d.sections.own.rows.length, 8);
  assert.ok(!ids(d.sections.rivals.rows).includes(fresh), "the new rival row is past the cut");
  assert.equal(d.quiet.new_24h, 13);
  assert.match(d.quiet.text, new RegExp(`^New for ${SHAPE.replace(".", "\\.")} in the last 24 hours: 13 \\(own 12, rivals 1\\)\\.`));
  for (const section of ["own", "rivals", "calendar"]) {
    const s = await data({ DB: db }, SHAPE, { section });
    assert.equal(s.quiet.new_24h, d.quiet.new_24h, `section=${section}`);
    assert.equal(s.quiet.text, d.quiet.text, `section=${section}`);
  }
});

test("T10b: source errors are redacted and clipped", () => {
  assert.equal(redactError("html 500 https://x.example/a?api_key=SYNTH&page=2"), "html 500 https://x.example/a?api_key=[redacted]&page=2");
  assert.equal(redactError("auth failed: Bearer abc.def"), "auth failed: Bearer [redacted]");
  assert.equal(redactError("x?token=1&sig=2&access_token=3&q=4"), "x?token=[redacted]&sig=[redacted]&access_token=[redacted]&q=4");
  assert.equal(redactError("y".repeat(200), 80).length, 80);
  assert.equal(redactError(null), null);
});

test("T11: series lines (latest, previous, change), the _total line, the 120-day bound and the LIMIT", async () => {
  const news = newsDb();
  const d0 = (n) => plus(n);
  addPoint(news, { subject: "TST Fleet", ticker: SHAPE, period: d0(-40), value: 10, label: "vehicles", record_url: "https://example.com/r" });
  addPoint(news, { subject: "TST Fleet", ticker: SHAPE, period: d0(-20), value: 14, label: "vehicles", record_url: "javascript:alert(1)" });
  addPoint(news, { subject: "TST Fleet", ticker: SHAPE, period: d0(-200), value: 2 });
  for (let i = 0; i < 70; i++) addPoint(news, { subject: "_total", period: d0(-i - 1), value: 100 + i });
  const d = await data({ DB: new D1(), NEWS: news }, SHAPE);
  const own = d.sections.series.rows.find((r) => r.own);
  assert.deepEqual([own.latest, own.previous, own.change], [{ period: d0(-20), value: 14 }, { period: d0(-40), value: 10 }, 4]);
  assert.equal(own.record_url, null, "a non-http record URL is dropped");
  const total = d.sections.series.rows.find((r) => r.subject === "_total");
  assert.deepEqual([total.latest.period, total.previous.period], [d0(-1), d0(-2)]);
  assert.equal(d.filled.series, true);
  assert.equal(d.truncated.q6, true);
  // A point 200 days old only: not filled.
  const old = newsDb();
  addPoint(old, { subject: "TST Fleet", ticker: SHAPE, period: d0(-200), value: 2 });
  const o = await data({ DB: new D1(), NEWS: old }, SHAPE);
  assert.deepEqual(o.sections.series.rows, []);
  assert.equal(o.filled.series, false);
});

test("T12: NEWS missing or failing leaves the page whole, with one fixed log line", async () => {
  const db = new D1();
  const own = await graded(db, SHAPE, { source_key: channelsFor(SHAPE).own[0] });
  const a = await data({ DB: db }, SHAPE);
  assert.match(a.quiet.text, /Source health unavailable; channels not confirmed\./);
  assert.deepEqual(a.sections.series.rows, []);
  assert.equal(a.sections.source_health.available, false);
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const failing = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error("boom https://x.example/?token=SYNTH"); } };
    const b = await data({ DB: db, NEWS: failing }, SHAPE);
    assert.match(b.quiet.text, /Source health unavailable/);
    assert.deepEqual(ids(b.sections.own.rows), [own]);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(logs, [["company: news read failed"]]);
});

// --- T13, T14, T16 -----------------------------------------------------------------------------------------

test("T13: filled counts under the three rules; reference lists never count (B-F10)", async () => {
  const db = new D1();
  const ch = channelsFor(NOREG);
  assert.ok(ch.own.length && ch.sec.length, "the no-register ticker has own and SEC channels");
  await graded(db, NOREG, { source_key: ch.own[0], title: `Webinar on ${(() => { const [y, m, dd] = plus(6).split("-").map(Number); return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${dd}, ${y}`; })()}` },
    { score: 70, flags: JSON.stringify(["floor:calendar"]) });
  await graded(db, NOREG, { source_key: ch.sec[0], title: "10-K annual report" });
  const rival = await graded(db, NOREG, { source_key: "test_rival_src", role: "rival", title: "Rival" }, { score: 60 });
  let d = await data({ DB: db }, NOREG);
  assert.deepEqual(filledSections(d), ["own", "filings", "rivals", "calendar"]);
  assert.equal(d.filled_count, 4);
  assert.equal(d.filled_excluding_reject_count, 4);
  await db.prepare("UPDATE grades SET score = 20, band = 'reject' WHERE item_id = ?").bind(rival).run();
  d = await data({ DB: db }, NOREG);
  assert.equal(d.filled_count, 4);
  assert.equal(d.filled_excluding_reject_count, 3);
  assert.deepEqual(filledSections(d, "strict_no_reject"), ["own", "filings", "calendar"]);
  assert.equal(filledSections(d, "lenient").length, d.filled_lenient_count);
  assert.ok(d.reference.competitors.length >= 0 && Array.isArray(d.reference.key_accounts));
  assert.throws(() => filledSections(d, "loose"), RangeError);
});

test("T14: read-only. Every statement on either database is a SELECT, for every covered ticker, empty and seeded", async () => {
  const guard = (inner) => ({
    prepare(sql) {
      assert.match(sql, /^\s*(SELECT|WITH)\b/i, sql);
      return inner.prepare(sql);
    },
    batch: (s) => inner.batch(s),
  });
  const seeded = new D1();
  await graded(seeded, SHAPE, { source_key: channelsFor(SHAPE).own[0] });
  await addAux(seeded, { source_key: "managed_test_news", entity_key: channelsFor(SHAPE).entities[0] });
  for (const db of [new D1(), seeded]) {
    for (const T of COV.tickers) {
      const news = newsDb();
      const d = await data({ DB: guard(db), NEWS: guard(news) }, T);
      assert.equal(d.ticker, T);
      assert.equal(d.error, undefined);
    }
  }
});

test("T16: a muted source's rows are hidden; muted keys passed in skip the source_prefs read; a name off the list reaches no page", async () => {
  const db = new D1();
  const [k1, k2] = channelsFor(SHAPE).own.length > 1 ? channelsFor(SHAPE).own : [channelsFor(SHAPE).own[0], `edgar_${SHAPE.toLowerCase()}`];
  const muted = await graded(db, SHAPE, { source_key: k1 });
  const kept = await graded(db, SHAPE, { source_key: k2 });
  await db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES (?, 'mute', ?)").bind(k1, ago(0)).run();
  await item(db, "TST", { source_key: k1, title: "Off-list name" });
  // An off-list name's item graded for SHAPE in its primary run (also graded, Q3) stays off the page too;
  // an on-list name's item graded the same way is listed.
  const offList = await graded(db, "TST", { source_key: "test_offlist_src", title: "Off-list item" });
  await addGrade(db, offList, { ticker: SHAPE, score: 70 });
  const other = COV.tickers.find((t) => t !== SHAPE);
  const onList = await graded(db, other, { source_key: "test_onlist_src", title: "On-list item" });
  await addGrade(db, onList, { ticker: SHAPE, score: 70 });
  const all = (d) => SECTIONS.flatMap((s) => flat(d.sections[s].rows || [])).map((r) => r.id).filter(Boolean);
  const d = await data({ DB: db }, SHAPE);
  assert.ok(!all(d).includes(muted));
  assert.ok(all(d).includes(kept));
  assert.deepEqual(d.also_graded.map((r) => [r.ticker, r.item_id]), [[other, onList]]);
  const seen = [];
  const spy = { prepare(sql) { seen.push(sql); return db.prepare(sql); }, batch: (s) => db.batch(s) };
  const e = await data({ DB: spy }, SHAPE, { muted: new Set() });
  assert.ok(!seen.some((s) => /source_prefs/.test(s)), "QM skipped");
  assert.ok(all(e).includes(muted), "the caller's (empty) mute list wins");
  assert.deepEqual(await data({ DB: db }, "TST"), { error: "unknown ticker", status: 404 });
});

// --- T21 -----------------------------------------------------------------------------------------------------

test("T21: company.js reaches no Discord, tuning, auxiliary, brief or index code, calls no fetch, and logs fixed strings only", () => {
  const seen = new Set();
  const go = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) go(m[1]);
  };
  go("company.js");
  for (const f of ["delivery.js", "discord.js", "tuning.js", "auxiliary.js", "brief.js", "index.js", "ingest.js", "excerpt.js", "budget.js"]) {
    assert.ok(!seen.has(f), `company.js reaches ${f}`);
  }
  for (const f of seen) assert.doesNotMatch(readFileSync(new URL(f, SRC), "utf8"), /\bfetch\(/, f);
  const code = readFileSync(new URL("company.js", SRC), "utf8");
  const calls = [...code.matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.match(c, /^"[^"$`]*"$/, c);
  assert.ok(Object.values(COMPANY_SQL).every((s) => /\bLIMIT\b/.test(s)));
});

// --- JSON route ----------------------------------------------------------------------------------------------

test("companyRoute: the JSON shape, section=<name> returns up to 100 rows, and every section carries its counts", async () => {
  const db = new D1();
  const own = channelsFor(SHAPE).own[0];
  for (let i = 0; i < 12; i++) await graded(db, SHAPE, { source_key: own, title: `Release ${i}`, nm_first_seen: ago(1 + i / 24) });
  const res = await companyRoute({ DB: db }, new URL(`https://zenith.example.com/v1/company?ticker=${SHAPE}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const d = await res.json();
  for (const k of ["ticker", "name", "days", "from", "to", "generated_at", "relations_version", "calendar_version", "quiet", "sections", "also_graded",
    "reference", "filled", "filled_count", "filled_excluding_reject_count", "filled_lenient_count", "truncated", "reads"]) assert.ok(k in d, k);
  assert.deepEqual(Object.keys(d.sections), SECTIONS);
  assert.equal(d.name, M.rubric.COVERED_NAMES[SHAPE][0]);
  assert.equal(d.sections.own.rows.length, 8);
  assert.equal(d.sections.own.total, 12);
  const all = await (await companyRoute({ DB: db }, new URL(`https://zenith.example.com/v1/company?ticker=${SHAPE}&section=own&days=7`))).json();
  assert.equal(all.sections.own.rows.length, 12);
  assert.equal(all.days, 7);
  assert.equal((await companyRoute({ DB: db }, new URL("https://zenith.example.com/v1/company?ticker=TST"))).status, 404);
  assert.equal((await companyRoute({ DB: db }, new URL(`https://zenith.example.com/v1/company?ticker=${SHAPE}&days=90`))).status, 400);
});
