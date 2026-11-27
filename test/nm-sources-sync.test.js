// Phase 0 nm-sources (plans/phase0-build-spec.md A10, Appendix C sections 1.3a,
// 1.5 and 7): the 12 new Legistar clients and fedreg_fcc_space through the
// Coverage and Auxiliary ingests with the synced covered.json and
// aux-sources.json. Titles are synthetic, in news-monitor's current Legistar
// and Federal Register title format (p0-nm-sources): the "[TAG] " prefix, the
// "(Flock/ALPR, rival) " marker, and a company term kept past character 160.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";

hookJsonImports();
const { ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { releaseHeld } = await import("../worker/src/budget.js");
const { isRecordSource } = await import("../worker/src/records.js");
const { default: COVERED } = await import("../worker/src/covered.json");

const DAY = 86_400_000;
const SEEN = "2026-11-25T10:00:00.000Z";
const LATER = "2026-11-26T10:00:00.000Z";
const ago = (days, from = SEEN) => new Date(Date.parse(from) - days * DAY).toISOString();
const NEW_KEYS = ["legistar_fresno", "legistar_hayward", "legistar_elpaso", "legistar_toledo", "legistar_stpaul", "legistar_milwaukee",
  "legistar_sanjose", "legistar_dallas", "legistar_corpuschristi", "legistar_cookcounty", "legistar_nashville", "legistar_dane", "fedreg_fcc_space"];

const newEnv = () => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
};
let seq = 0;
function nm(env, { source_key, title, published, first_seen = SEEN, url }) {
  env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, 'CONTRACT', ?, 1)")
    .run(source_key, url ?? `https://testville.legistar.example/LegislationDetail.aspx?ID=${++seq}`, title, published, first_seen);
}

test("the 13 new sources are counterparty record sources, not covered own-lane and not SEC, so their seeds are budgeted (A1)", () => {
  for (const k of NEW_KEYS) {
    assert.ok(Object.hasOwn(COVERED.counterparty, k), `${k} counterparty`);
    assert.ok(!Object.hasOwn(COVERED.sources, k), `${k} is not a covered own-lane source`);
    assert.ok(!k.startsWith("edgar_"), k);
    assert.equal(isRecordSource(k), true, `${k} is a record source`);
  }
});

test("new Legistar and FCC space rows: Coverage routes them by company name, then the leading tag; first-poll fresh rows are held seed_fresh; none is stored on Auxiliary", async () => {
  const env = newEnv();
  const preamble = "Actions pertaining to the Testville Police Department modernization of its public-safety technology ecosystem, including a cooperative purchase agreement with ";
  const axon = `[AXON] Testville City Council ID 26-9001: ${preamble}Axon Enterprise, Inc. for body-worn cameras and TASER devices — not to exceed $2M — Agenda Ready, agenda 2026-12-08`;
  assert.ok(axon.indexOf("Axon Enterprise") > 160, "the company term sits past character 160");
  const rows = [
    { source_key: "legistar_fresno", title: axon, published: ago(8) },
    { source_key: "legistar_toledo", title: "[AXON] (Flock/ALPR, rival) Testville City Council R-9-26: Resolution to terminate the contract with Flock Safety for license plate readers — Introduced", published: ago(3) },
    { source_key: "legistar_sanjose", title: "[SERV] Testville City Council 26-9003: Personal Delivery Devices Regulations — Introduced", published: ago(3) },
    { source_key: "legistar_hayward", title: "[EVLV] Testville City Council 26-9004: Weapons screening systems at the convention center — Introduced", published: ago(3) },
    { source_key: "fedreg_fcc_space", title: "Federal Register FCC Proposed Rule: Testsat Space Modernization — Proposed rule.", published: ago(5), url: "https://www.federalregister.example/d/2026-90001" },
    { source_key: "fedreg_fcc_space", title: "[SATL] Federal Register FCC Rule: Earth station licence for Satellogic Inc. — Final rule.", published: ago(5), url: "https://www.federalregister.example/d/2026-90002" },
  ];
  for (const r of rows) nm(env, r);
  // A later poll of an established new source: the fast path (not its seed).
  nm(env, { source_key: "legistar_sanjose", title: "[SERV] Testville City Council 26-9010: Sidewalk delivery robot permit — Introduced", published: ago(1, LATER), first_seen: LATER });
  await ingest(env);
  await ingestAux(env);
  const cov = Object.fromEntries(env.DB.rows("SELECT title, ticker, role, state, admit, skip_reason FROM items").map((x) => [x.title, [x.ticker, x.role, x.state, x.admit, x.skip_reason]]));
  assert.deepEqual(cov[axon], ["AXON", "customer", "pending", "seed_fresh", null], "an Axon contract (Fresno-style)");
  assert.deepEqual(cov[rows[1].title], ["AXON", "customer", "pending", "seed_fresh", null], "D8: a rival-marked Flock/ALPR matter stays on AXON's Coverage page");
  assert.deepEqual(cov[rows[2].title], ["SERV", "customer", "pending", "seed_fresh", null], "San Jose PDD rules: the [SERV] tag decides");
  assert.deepEqual(cov[rows[3].title], ["EVLV", "customer", "pending", "seed_fresh", null]);
  assert.deepEqual(cov[rows[4].title], ["PL", "program", "pending", "seed_fresh", null], "no tag: affects[0]");
  assert.deepEqual(cov[rows[5].title], ["SATL", "program", "pending", "seed_fresh", null]);
  assert.deepEqual(cov["[SERV] Testville City Council 26-9010: Sidewalk delivery robot permit — Introduced"], ["SERV", "customer", "pending", null, null], "after the seed: fast path");
  // One pipeline per item: Coverage owns every one of these rows.
  assert.equal(env.DB.rows(`SELECT COUNT(*) AS n FROM aux_items WHERE source_key IN (${NEW_KEYS.map(() => "?").join(",")})`, ...NEW_KEYS)[0].n, 0);
  // The budget releases the held seed rows (at most 5 per source, 20 a day).
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM items WHERE admit = 'seed_fresh' AND released_at IS NULL")[0].n, 6);
  await releaseHeld(env);
  const held = env.DB.rows("SELECT source_key FROM items WHERE admit = 'seed_fresh' AND released_at IS NULL");
  assert.equal(held.length, 0, "six held rows over five sources all fit the budget");
});

// Phase 1 FPDS by vendor UEI (plans/phase1-build-spec.md Part C 6.2, Z8): the
// seven new fpds_* keys, synced from news-monitor by scripts/sync-covered.mjs.
// Key names and tickers only; titles, PIIDs and amounts below are synthetic.
const { default: AUX } = await import("../worker/src/aux-sources.json", { with: { type: "json" } });
const FPDS_KEYS = { fpds_evlv: "EVLV", fpds_rcat: "RCAT", fpds_pdyn_sarcos: "PDYN", fpds_mrln: "MRLN", fpds_kdk: "KDK", fpds_dpro: "DPRO", fpds_aglt: "AGLT" };

test("new FPDS keys sync as customer counterparties with entity fpds (Z8)", () => {
  for (const [k, t] of Object.entries(FPDS_KEYS)) {
    assert.deepEqual(COVERED.counterparty[k], { role: "customer", affects: [t] }, `${k} counterparty`);
    assert.ok(!Object.hasOwn(COVERED.sources, k), `${k} is not a covered own-lane source`);
    const a = AUX.sources[k];
    assert.ok(a, `${k} in aux-sources.json`);
    assert.equal(a.entity, "fpds", k);
    assert.equal(a.record, true, k);
    assert.equal(a.coverage_subject, true, k);
    assert.deepEqual(a.affects, [t], k);
    assert.equal(a.lane, "strategic_noncompany", k);
    assert.ok(!a.sec, `${k} is not SEC`);
    assert.ok(!Object.hasOwn(AUX.exclude, k), `${k} is not excluded`);
    assert.equal(isRecordSource(k), true, `${k} is a record source`);
  }
});

test("new FPDS keys: Coverage owns their seed rows under the key's ticker and holds them; none is stored on Auxiliary", async () => {
  const env = newEnv();
  for (const [k, t] of Object.entries(FPDS_KEYS)) {
    nm(env, { source_key: k, title: `[${t}] FPDS: TEST AGENCY purchase order TEST${t}0001 mod P00001 to TESTCO ${t} INC — $250K obligated`,
      published: ago(6), url: `https://www.fpds.example/ATOM?q=VENDOR_UEI:TEST${t}#9999-TEST${t}0001-P00001` });
  }
  await ingest(env);
  await ingestAux(env);
  const keys = Object.keys(FPDS_KEYS);
  const cov = Object.fromEntries(env.DB.rows("SELECT source_key, ticker, role, state, admit FROM items").map((x) => [x.source_key, [x.ticker, x.role, x.state, x.admit]]));
  for (const [k, t] of Object.entries(FPDS_KEYS)) assert.deepEqual(cov[k], [t, "customer", "pending", "seed_fresh"], k);
  assert.equal(env.DB.rows(`SELECT COUNT(*) AS n FROM aux_items WHERE source_key IN (${keys.map(() => "?").join(",")})`, ...keys)[0].n, 0);
});

// Phase 2 registers (plans Part E §5.2, Z6-Z8): the TxDMV register key, synced
// from news-monitor by scripts/sync-covered.mjs. The two LDA keys follow in a
// later sync with news-monitor's LDA adapters. Key names and tickers only;
// titles, names, dates and counts below are synthetic, in the card format of
// news-monitor's txdmv_av_report adapter.
const { MATCH } = await import("../worker/src/rubric.generated.js");
const { routeCounterparty } = await import("../worker/src/lib.js");
const { isRegisterSource } = await import("../worker/src/records.js");
const { default: worker } = await import("../worker/src/index.js");
const { request } = await import("./helpers/worker-env.js");
const REGISTER_KEYS = { txdmv_av_authorizations: ["AUR", "KDK"] };

test("the TxDMV register key is a program counterparty and a register record entry, a coverage subject with its tickers (Z7)", () => {
  for (const [k, affects] of Object.entries(REGISTER_KEYS)) {
    assert.deepEqual(COVERED.counterparty[k], { role: "program", affects }, `${k} counterparty`);
    assert.ok(!Object.hasOwn(COVERED.sources, k), `${k} is not a covered own-lane source`);
    assert.ok(!Object.hasOwn(COVERED.channels, k), `${k} is not a company channel`);
    assert.deepEqual(AUX.sources[k], { entity: "txdmv_av", name: "Texas DMV AV authorizations", status: "program", lane: "strategic_noncompany",
      coverage_subject: true, affects, record: true, register: true }, `${k} in aux-sources.json`);
    assert.ok(!Object.hasOwn(AUX.exclude, k), `${k} is not excluded`);
    assert.equal(isRecordSource(k), true, `${k} is a record source`);
    assert.equal(isRegisterSource(k), true, `${k} is a register source`);
  }
});

const REPORT = "https://vehicles.example/AV_Program_Report_";
const KDK_CARD = `[KDK] TxDMV AV authorizations 11/24/2026: "${MATCH.KDK.terms[0]}" 10 -> 12; "Testco Freight LLC" (customer) 4 -> 6; Texas total 100 -> 110`;
const txdmvRows = (env) => {
  nm(env, { source_key: "txdmv_av_authorizations", title: `[KDK] TxDMV AV authorizations baseline as of 11/10/2026: "${MATCH.KDK.terms[0]}" 10; Texas total 100`,
    published: ago(1), url: "https://vehicles.example/AVprogram#baseline-kdk" });
  nm(env, { source_key: "txdmv_av_authorizations", title: KDK_CARD, published: ago(1, LATER), first_seen: LATER, url: `${REPORT}20261124.pdf#kdk` });
};

test("TxDMV rows on Coverage: the key's first row is held seed_fresh, a later one is held register under KDK; none is stored on Auxiliary (Z6)", async () => {
  const env = newEnv();
  txdmvRows(env);
  await ingest(env);
  await ingestAux(env);
  const rows = env.DB.rows("SELECT ticker, role, state, admit, skip_reason, released_at FROM items WHERE source_key = 'txdmv_av_authorizations' ORDER BY nm_first_seen")
    .map((x) => [x.ticker, x.role, x.state, x.admit, x.skip_reason, x.released_at]);
  assert.deepEqual(rows, [["KDK", "program", "pending", "seed_fresh", null, null], ["KDK", "program", "pending", "register", null, null]]);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'txdmv_av_authorizations'")[0].n, 0);
});

test("a TxDMV row after the key's first row is held 'register': not claimable until releaseHeld runs, and claimable after (Z6)", async () => {
  const claim = async (e) => (await request(worker, e, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 20 } })).body.items;
  const env = newEnv();
  txdmvRows(env);
  await ingest(env);
  const [later] = env.DB.rows("SELECT id, state, admit, released_at FROM items WHERE title = ?", KDK_CARD);
  assert.deepEqual([later.state, later.admit, later.released_at], ["pending", "register", null]);
  assert.equal((await claim(env)).length, 0, "held: nothing is claimable");
  await releaseHeld(env);
  const it = (await claim(env)).find((i) => i.item_id === later.id);
  assert.ok(it, "claimable once released");
  assert.deepEqual([it.admit, it.record], ["register", true]);
});

test("TxDMV cards route to the ticker they are for (Z8): by the company named, else by the leading tag", () => {
  const tx = COVERED.counterparty.txdmv_av_authorizations;
  // Each case runs under both orders of affects, so the affects[0] default
  // never decides it: the name or the tag must.
  const orders = [tx, { ...tx, affects: [...tx.affects].reverse() }];
  assert.deepEqual(orders.map((cp) => cp.affects[0]).sort(), ["AUR", "KDK"]);
  const cases = [
    ["KDK", KDK_CARD],
    ["AUR", `[AUR] TxDMV AV authorizations 11/24/2026: "${MATCH.AUR.terms[0]}" 20 unchanged; rival counts changed`],
    // A register spelling that no MATCH term covers: the card's tag decides.
    ["KDK", `[KDK] TxDMV AV authorizations 11/24/2026: "Testco Autonomy LLC" 10 -> 12; Texas total 100 -> 110`],
    ["AUR", `[AUR] TxDMV AV authorizations baseline as of 11/10/2026: "Testco Trucking Inc" 20; Texas total 100`],
  ];
  for (const cp of orders) {
    for (const [t, title] of cases) assert.equal(routeCounterparty(title, cp, MATCH)?.ticker, t, `${title} (affects ${cp.affects})`);
  }
  // The company named wins over the tag: an untagged card naming AUR goes to AUR.
  for (const cp of orders) assert.equal(routeCounterparty(`TxDMV AV authorizations 11/24/2026: "${MATCH.AUR.terms[0]}" 20 -> 21`, cp, MATCH)?.ticker, "AUR");
});

// Phase 4 Part C (Z-C1..Z-C3): the Legistar fan-out key and the two FMCSA
// register keys, synced from news-monitor by scripts/sync-covered.mjs. Key
// names and tickers only; titles, matter numbers, places, dates and counts
// below are synthetic (testville, TST, example), in the card formats of
// news-monitor's legistar_fanout and fmcsa_* adapters.
const { archiveSeedGroups, arrivalGate, ARCHIVE_SEED_MIN } = await import("../worker/src/lib.js");
const { isDecisionRow } = await import("../worker/src/ingest.js");
const { legistarMatter } = await import("../worker/src/story.js");
const FANOUT = "legistar_fanout";
const FANOUT_URL = "https://testville.legistar.com/LegislationDetail.aspx?ID=9020&GUID=TEST-9020";

test("the Legistar fan-out key is a customer counterparty and a record coverage subject with the Legistar tickers, not a register (Z-C1)", () => {
  const legacy = COVERED.counterparty.legistar_fresno;
  assert.deepEqual(COVERED.counterparty[FANOUT], { role: "customer", affects: legacy.affects }, "the same tickers as the per-client keys");
  assert.ok(!Object.hasOwn(COVERED.sources, FANOUT) && !Object.hasOwn(COVERED.channels, FANOUT));
  const a = AUX.sources[FANOUT];
  assert.deepEqual([a.status, a.lane, a.coverage_subject, a.record, a.register], ["program", "strategic_noncompany", true, true, undefined]);
  assert.deepEqual(a.affects, legacy.affects);
  assert.equal(isRecordSource(FANOUT), true);
  assert.equal(isRegisterSource(FANOUT), false);
});

test("fan-out rows on Coverage (Z-C2): a matter is pending under its tag, its #vote- copy is admitted vote, a baseline card is neither a decision row nor hard-keyed; none is stored on Auxiliary", async () => {
  const env = newEnv();
  const matter = "[AXON] Testville City Council 26-9020: Testville test purchase of Axon camera units — Introduced";
  const card = "[AXON] Testville City Council (Legistar) baseline as of 11/25/2026: 3 earlier matching matters in 180 days, newest 26-9001";
  const cardUrl = "https://testville.legistar.com/Legislation.aspx?baseline=2026-11-25";
  nm(env, { source_key: FANOUT, title: matter, published: ago(2), url: FANOUT_URL });
  nm(env, { source_key: FANOUT, title: card, published: SEEN, url: cardUrl });
  nm(env, { source_key: FANOUT, title: `${matter} — vote: Passed`, published: ago(1, LATER), first_seen: LATER, url: `${FANOUT_URL}#vote-1` });
  await ingest(env);
  await ingestAux(env);
  const cov = Object.fromEntries(env.DB.rows("SELECT url, ticker, role, state, admit, skip_reason FROM items WHERE source_key = ?", FANOUT)
    .map((x) => [x.url, [x.ticker, x.role, x.state, x.admit, x.skip_reason]]));
  assert.deepEqual(cov[FANOUT_URL], ["AXON", "customer", "pending", "seed_fresh", null]);
  assert.deepEqual(cov[cardUrl], ["AXON", "customer", "pending", "seed_fresh", null], "the baseline card is one graded row");
  assert.deepEqual(cov[`${FANOUT_URL}#vote-1`], ["AXON", "customer", "pending", "vote", null], "a later poll's vote row is budgeted as a vote");
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = ?", FANOUT)[0].n, 0);
  assert.equal(isDecisionRow({ source_key: FANOUT, url: `${FANOUT_URL}#vote-1` }), true);
  assert.equal(isDecisionRow({ source_key: FANOUT, url: cardUrl }), false, "no fragment: not a decision row");
  assert.equal(legistarMatter(cardUrl), null, "no LegislationDetail: no hard key");
  assert.equal(legistarMatter(FANOUT_URL), "testville:9020#");
});

test("fan-out burst guard (Z-C2): four old rows and ten fresh ones in one poll park nothing; a fifth old row would park the group", () => {
  const row = (published) => ({ source_key: FANOUT, first_seen: SEEN, published });
  const fresh = Array.from({ length: 10 }, (_, i) => row(ago(i % 7)));
  const old = (n) => Array.from({ length: n }, (_, i) => row(ago(40 + i)));
  assert.equal(ARCHIVE_SEED_MIN - 1, 4, "news-monitor emits at most ARCHIVE_SEED_MIN - 1 old rows a fan-out poll");
  assert.equal(archiveSeedGroups([...old(4), ...fresh]).size, 0);
  assert.equal(archiveSeedGroups([...old(5), ...fresh]).size, 1);
});

// The two FMCSA keys come with news-monitor's FMCSA register PR. Whether the
// catalog tests below run is decided by news-monitor's source list, not by the
// bundled catalog they check: NEWS_MONITOR_REPO (main + the paired tip at
// merge time), else the checkout beside zenith, as test/records.test.js finds
// it. When that tree defines the FMCSA sources, a catalog without them fails.
const FMCSA_KEYS = ["fmcsa_inspections", "fmcsa_census"];
const FMCSA_SYNCED = FMCSA_KEYS.filter((k) => Object.hasOwn(COVERED.counterparty, k));
const { existsSync } = await import("node:fs");
const { join } = await import("node:path");
const { fileURLToPath, pathToFileURL } = await import("node:url");
const ZROOT = fileURLToPath(new URL("..", import.meta.url));
const NM_ROOT = [process.env.NEWS_MONITOR_REPO, join(ZROOT, "..", "news-monitor-repo"), join(ZROOT, "..", "..", "news-monitor-repo")]
  .find((p) => p && existsSync(join(p, "src", "sources.js")) && existsSync(join(p, "src", "priority.js")));
// priority.js appends the register and other generated sources to SOURCES in place, as sync-covered.mjs reads them.
const NM_SOURCES = NM_ROOT ? (await import(pathToFileURL(join(NM_ROOT, "src", "sources.js")).href)).SOURCES : [];
if (NM_ROOT) await import(pathToFileURL(join(NM_ROOT, "src", "priority.js")).href);
const NM_FMCSA = FMCSA_KEYS.filter((k) => NM_SOURCES.some((s) => s.key === k));
const NOT_SYNCED = NM_FMCSA.length || FMCSA_SYNCED.length ? false
  : "news-monitor defines no FMCSA register source yet and the bundled catalog has none (they come with news-monitor's FMCSA register PR)";

test("the FMCSA keys are synced together or not at all, and are synced whenever news-monitor defines them (Z-C1)", () => {
  assert.ok(NM_FMCSA.length === 0 || NM_FMCSA.length === FMCSA_KEYS.length, `news-monitor defines: ${NM_FMCSA.join(", ")}`);
  assert.ok(FMCSA_SYNCED.length === 0 || FMCSA_SYNCED.length === FMCSA_KEYS.length, `synced: ${FMCSA_SYNCED.join(", ")}`);
  for (const k of FMCSA_KEYS) assert.equal(Object.hasOwn(AUX.sources, k), FMCSA_SYNCED.length > 0, `${k} aux entry`);
  for (const k of NM_FMCSA) assert.ok(FMCSA_SYNCED.includes(k), `${k} is a news-monitor source but not in covered.json: regenerate against that tree`);
});

test("the FMCSA keys are program counterparties and register record entries of one fmcsa entity, coverage subjects with their tickers (Z-C1)", { skip: NOT_SYNCED }, () => {
  for (const k of FMCSA_KEYS) {
    const cp = COVERED.counterparty[k];
    assert.equal(cp.role, "program", k);
    assert.ok(cp.affects.length > 0 && cp.affects.every((t) => COVERED.tickers.includes(t)), k);
    assert.ok(!Object.hasOwn(COVERED.sources, k) && !Object.hasOwn(COVERED.channels, k), k);
    assert.deepEqual(AUX.sources[k], { entity: "fmcsa", name: "FMCSA inspection and census records", status: "program", lane: "strategic_noncompany",
      coverage_subject: true, affects: cp.affects, record: true, register: true }, `${k} in aux-sources.json`);
    assert.equal(isRecordSource(k), true, k);
    assert.equal(isRegisterSource(k), true, k);
  }
});

test("FMCSA rows on Coverage (Z-C3): the seed card is held seed_fresh, a later row dated by its upload day is held register, never record_late or stale; none on Auxiliary", { skip: NOT_SYNCED }, async () => {
  const env = newEnv();
  const t = COVERED.counterparty.fmcsa_inspections.affects[0];
  const base = "https://data.example.gov/resource/inspections.json";
  nm(env, { source_key: "fmcsa_inspections", title: `[${t}] FMCSA roadside inspections baseline as of 11/25/2026: 3 in 2026; shippers named on its trucks include TESTCO FOODS`,
    published: SEEN, url: `${base}?dot_number=0#baseline-test` });
  const late = `[${t}] FMCSA roadside inspection ${ago(200, LATER).slice(0, 10)} (TX, TESTVILLE): new shipper "TESTCO PAPER"`;
  nm(env, { source_key: "fmcsa_inspections", title: late, published: ago(1, LATER), first_seen: LATER, url: `${base}?inspection_id=1` });
  await ingest(env);
  await ingestAux(env);
  const rows = env.DB.rows("SELECT ticker, state, admit, skip_reason FROM items WHERE source_key = 'fmcsa_inspections' ORDER BY nm_first_seen")
    .map((x) => [x.ticker, x.state, x.admit, x.skip_reason]);
  assert.deepEqual(rows, [[t, "pending", "seed_fresh", null], [t, "pending", "register", null]]);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'fmcsa_inspections'")[0].n, 0);
});

test("FMCSA routing and dating, catalog-free (Z-C3): a register row dated by upload day is admitted register; dated by an inspection 200 days back it would be stale; a rival-labelled card goes to its tag", () => {
  const ctx = { pipeline: "coverage", record: true, register: true, seed: false, burst: false };
  assert.deepEqual(arrivalGate({ published: ago(1, LATER), first_seen: LATER }, ctx), { reason: null, admit: "register" });
  assert.deepEqual(arrivalGate({ published: ago(200, LATER), first_seen: LATER }, ctx), { reason: "stale_on_arrival", admit: null },
    "why news-monitor dates an inspection row by its upload day");
  const match = { TST: { terms: ["Testco"], accounts: [] }, TS2: { terms: ["Tsecond"], accounts: [] } };
  const cp = { role: "program", affects: ["TST", "TS2"] };
  const rival = "[TS2] (Example Freight, rival) FMCSA roadside inspection 2026-11-20 (TX, TESTVILLE): new shipper \"EXAMPLE FOODS\"";
  assert.equal(routeCounterparty(rival, cp, match).ticker, "TS2", "the tag decides when no company or account is named");
  assert.equal(routeCounterparty(rival.replace("[TS2]", "[TST]"), { ...cp, affects: ["TS2", "TST"] }, match).ticker, "TST");
});

// Phase 4 Part B (Z-B4): the two group-routed register keys (OIRA reviews,
// committee reports) and aux-sources.json register_groups, synced from
// news-monitor by scripts/sync-covered.mjs. As for FMCSA above, whether the
// catalog cases run is decided by news-monitor's source list (NEWS_MONITOR_REPO,
// else the checkout beside zenith). Key names and tickers only; group tickers
// are read from the generated file and news-monitor's tree, never written
// here; titles and URLs are synthetic.
const { isGroupRouted, groupAffects } = await import("../worker/src/records.js");
const PART_B_KEYS = ["oira_reviews", "govinfo_committee_reports"];
const PART_B_ENTITY = { oira_reviews: ["oira", "OIRA regulatory review"], govinfo_committee_reports: ["govinfo_crpt", "Congressional committee reports"] };
const NM_PART_B = PART_B_KEYS.filter((k) => NM_SOURCES.some((s) => s.key === k));
const PART_B_SYNCED = PART_B_KEYS.filter((k) => Object.hasOwn(COVERED.counterparty, k));
const WATCH_PATH = NM_ROOT ? join(NM_ROOT, "src", "register-gov-watch.js") : null;
const NM_GROUPS = WATCH_PATH && existsSync(WATCH_PATH) ? (await import(pathToFileURL(WATCH_PATH).href)).GOV_GROUPS || [] : [];
const partBSkip = (k) => (NM_PART_B.includes(k) || PART_B_SYNCED.includes(k) ? false
  : `news-monitor defines no ${k} source yet and the bundled catalog has none (it comes with news-monitor's Part B register PR)`);

test("the Part B register keys are synced whenever news-monitor defines them; group_routed is on both catalog entries or neither; register_groups exists exactly when a group-routed key is synced (Z-B4)", () => {
  for (const k of NM_PART_B) assert.ok(PART_B_SYNCED.includes(k), `${k} is a news-monitor source but not in covered.json: regenerate against that tree`);
  for (const [k, cp] of Object.entries(COVERED.counterparty)) {
    assert.equal(cp.group_routed === true, isGroupRouted(k), `${k}: the counterparty and aux flags agree`);
    if (cp.group_routed !== undefined) assert.equal(cp.group_routed, true, `${k}: the flag is only ever true`);
  }
  for (const k of Object.keys(AUX.sources)) if (isGroupRouted(k)) assert.equal(COVERED.counterparty[k]?.group_routed, true, `${k}: an aux group_routed entry is a group_routed counterparty`);
  const routed = Object.keys(COVERED.counterparty).filter((k) => COVERED.counterparty[k].group_routed);
  assert.equal(Object.hasOwn(AUX, "register_groups"), routed.length > 0, "register_groups is written with the group-routed keys");
});

test("register_groups: one entry per news-monitor topic group, each with its mirror channel's covered tickers in the mirror's order, every one inside the group-routed keys' affects (Z-B4)", { skip: !AUX.register_groups && "no group-routed key is synced yet" }, () => {
  const groups = AUX.register_groups;
  assert.deepEqual(Object.keys(groups), [...Object.keys(groups)].sort(), "entities sorted");
  if (NM_GROUPS.length) assert.deepEqual(Object.keys(groups), NM_GROUPS.map((g) => g.entity).sort(), "the tree's groups, all of them");
  const union = new Set(PART_B_SYNCED.flatMap((k) => COVERED.counterparty[k].affects));
  for (const [entity, g] of Object.entries(groups)) {
    assert.match(entity, /^[a-z][a-z0-9_]{2,63}$/, entity);
    assert.deepEqual(Object.keys(g), ["name", "affects", "from"], entity);
    assert.ok(g.affects.length > 0 && g.affects.every((t) => COVERED.tickers.includes(t) && union.has(t)), `${entity}: covered tickers of the registers`);
    if (NM_SOURCES.length) {
      const mirror = NM_SOURCES.find((s) => s.key === g.from);
      assert.ok(mirror, `${entity}: its mirror ${g.from} is a news-monitor source`);
      const list = Array.isArray(mirror.affects) ? mirror.affects : String(mirror.affects || "").split(",");
      const want = [...new Set(list.map((t) => String(t).trim().toUpperCase()))].filter((t) => COVERED.tickers.includes(t));
      assert.deepEqual(g.affects, want, `${entity}: the mirror's covered affects, in its order`);
    }
    assert.deepEqual(groupAffects(`https://register.example.gov/x#card-g=${entity}`)?.affects, g.affects, `${entity}: groupAffects reads it`);
  }
});

for (const k of PART_B_KEYS) {
  test(`${k} is a group-routed program counterparty and a register record entry, a coverage subject with its tickers (Z-B4)`, { skip: partBSkip(k) }, () => {
    const cp = COVERED.counterparty[k];
    assert.equal(cp.role, "program", k);
    assert.equal(cp.group_routed, true, k);
    assert.ok(cp.affects.length > 0 && cp.affects.every((t) => COVERED.tickers.includes(t)), k);
    assert.ok(!Object.hasOwn(COVERED.sources, k) && !Object.hasOwn(COVERED.channels, k), k);
    const [entity, name] = PART_B_ENTITY[k];
    assert.deepEqual(AUX.sources[k], { entity, name, status: "program", lane: "strategic_noncompany",
      coverage_subject: true, affects: cp.affects, record: true, register: true, group_routed: true }, `${k} in aux-sources.json`);
    assert.ok(!Object.hasOwn(AUX.exclude, k), k);
    assert.equal(isRecordSource(k), true, k);
    assert.equal(isRegisterSource(k), true, k);
    assert.equal(isGroupRouted(k), true, k);
  });

  test(`${k} cards on Coverage (Z-B2, bundled catalog): each group's card lands on the group's first ticker with the group's tickers as affects; an unknown group keeps the source's; held seed_fresh then register; none on Auxiliary; no Discord rows`, { skip: partBSkip(k) || (!AUX.register_groups && "no register_groups") }, async () => {
    const env = newEnv();
    const own = COVERED.counterparty[k].affects;
    const groups = Object.entries(AUX.register_groups).filter(([, g]) => g.affects.some((t) => own.includes(t)));
    const url = (n, entity) => `https://register.example.gov/card/${n}#test-${n}-g=${entity}`;
    groups.forEach(([entity], n) => nm(env, { source_key: k, title: "[Test policy] Synthetic baseline card", published: SEEN, url: url(n, entity) }));
    nm(env, { source_key: k, title: "[Test policy] Synthetic card, later poll", published: ago(1, LATER), first_seen: LATER, url: url(90, groups[0][0]) });
    nm(env, { source_key: k, title: "[Test policy] Synthetic card, unknown group", published: ago(1, LATER), first_seen: LATER, url: url(91, "prog_test_unknown") });
    const res = await ingest(env);
    await ingestAux(env);
    assert.equal(res.group_unknown, 1);
    const cov = Object.fromEntries(env.DB.rows("SELECT url, ticker, role, affects, state, admit FROM items WHERE source_key = ?", k)
      .map((x) => [x.url, [x.ticker, x.role, x.affects, x.state, x.admit]]));
    groups.forEach(([entity, g], n) => {
      const affects = g.affects.filter((t) => own.includes(t));
      assert.deepEqual(cov[url(n, entity)], [affects[0], "program", affects.join(","), "pending", "seed_fresh"], entity);
    });
    const first = groups[0][1].affects.filter((t) => own.includes(t));
    assert.deepEqual(cov[url(90, groups[0][0])], [first[0], "program", first.join(","), "pending", "register"]);
    assert.deepEqual(cov[url(91, "prog_test_unknown")], [own[0], "program", own.join(","), "pending", "register"], "unknown group: the source's union");
    assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = ?", k)[0].n, 0);
    for (const t of ["incidents", "deliveries", "reports"]) assert.equal(env.DB.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
  });
}

// Phase 4 Part D (Z3): the FTC early-termination register key, synced from
// news-monitor by scripts/sync-covered.mjs. As for FMCSA and Part B above,
// whether the catalog cases run is decided by news-monitor's source list
// (NEWS_MONITOR_REPO, else the checkout beside zenith). Key name only; its
// tickers are read from the generated file and news-monitor's tree, never
// written here; titles, parties, numbers and URLs are synthetic.
const { isBodyRecordSource } = await import("../worker/src/records.js");
const FTC_KEY = "ftc_hsr_early_termination";
const NM_FTC = NM_SOURCES.find((s) => s.key === FTC_KEY) || null;
const FTC_SYNCED = Object.hasOwn(COVERED.counterparty, FTC_KEY);
const ftcSkip = NM_FTC || FTC_SYNCED ? false
  : "news-monitor defines no FTC early-termination source yet and the bundled catalog has none (it comes with news-monitor's FTC register PR)";

test("the FTC register key is synced whenever news-monitor defines it, with its aux entry, or not at all (Z3)", () => {
  if (NM_FTC) assert.ok(FTC_SYNCED, `${FTC_KEY} is a news-monitor source but not in covered.json: regenerate against that tree`);
  assert.equal(Object.hasOwn(AUX.sources, FTC_KEY), FTC_SYNCED, "the counterparty and aux entries come together");
  for (const [k, a] of Object.entries(AUX.sources)) if (a.body_record !== undefined) assert.equal(a.body_record, true, `${k}: the flag is only ever true`);
});

test("the FTC register key is a tag_affects program counterparty and a register record entry with body_record, a coverage subject with its tickers (Z3)", { skip: ftcSkip }, () => {
  const cp = COVERED.counterparty[FTC_KEY];
  assert.deepEqual(Object.keys(cp), ["role", "affects", "tag_affects"]);
  assert.equal(cp.role, "program");
  assert.equal(cp.tag_affects, true);
  assert.ok(cp.affects.length > 0 && cp.affects.every((t) => COVERED.tickers.includes(t)));
  if (NM_FTC) {
    const list = Array.isArray(NM_FTC.affects) ? NM_FTC.affects : String(NM_FTC.affects || "").split(",");
    const want = [...new Set(list.map((t) => String(t).trim().toUpperCase()))].filter((t) => COVERED.tickers.includes(t));
    assert.deepEqual(cp.affects, want, "news-monitor's affects, covered tickers only");
    assert.equal(NM_FTC.config?.tagAffects, true, "the flag comes from the source's config.tagAffects");
  }
  assert.ok(!Object.hasOwn(COVERED.sources, FTC_KEY) && !Object.hasOwn(COVERED.channels, FTC_KEY));
  assert.deepEqual(AUX.sources[FTC_KEY], { entity: "ftc_hsr", name: "FTC HSR early terminations", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: cp.affects, record: true, register: true, tag_affects: true, body_record: true });
  assert.ok(!Object.hasOwn(AUX.exclude, FTC_KEY));
  assert.equal(isRecordSource(FTC_KEY), true);
  assert.equal(isRegisterSource(FTC_KEY), true);
  assert.equal(isBodyRecordSource(FTC_KEY), true);
});

test("FTC rows on Coverage (Z3, bundled catalog): each lands under its tag with only that ticker as affects and its body as the feed excerpt; an untagged row is skipped tag_outside_affects; none on Auxiliary; no Discord rows", { skip: ftcSkip }, async () => {
  const env = newEnv();
  env.NEWS.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const affects = COVERED.counterparty[FTC_KEY].affects;
  const t = affects[affects.length - 1];
  const body = (n) => [`Test early termination granted 11/20/2026, posted 2026-11-24T15:00:00Z (transaction ${n}).`,
    "Acquiring party: Example Fund LP. Acquired party: Example Target, Inc.; acquired entities: Example Target, Inc.",
    "Matched party: Example Target, Inc. (via name). Early termination is granted only when the parties ask for it; most filings never appear here.",
    "Source: test early termination notices API."].join("\n");
  const add = (n, title, published, first_seen) => env.NEWS.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified, body) VALUES (?, ?, ?, ?, 'REGULATORY', ?, 1, ?)")
    .run(FTC_KEY, `https://www.example.gov/early-termination-notices#${n}-T`, title, published, first_seen, body(n));
  add(1001, `[${t}] Test early termination granted 11/20/2026: "Example Target, Inc." acquired by Example Fund LP (transaction 1001)`, ago(5), SEEN);
  add(1002, `[${t}] Test early termination granted 11/24/2026: "Example Target, Inc." acquired by Example Fund LP (transaction 1002)`, ago(1, LATER), LATER);
  add(1003, "Test early termination granted 11/24/2026: \"Example Target, Inc.\" acquired by Example Fund LP (transaction 1003)", ago(1, LATER), LATER);
  await ingest(env);
  await ingestAux(env);
  const cov = Object.fromEntries(env.DB.rows("SELECT url, ticker, role, affects, skip_reason, excerpt_status FROM items WHERE source_key = ?", FTC_KEY)
    .map((x) => [x.url.split("#")[1].split("-")[0], [x.ticker, x.role, x.affects, x.skip_reason, x.excerpt_status]]));
  assert.deepEqual(cov[1001], [t, "program", t, null, "feed"]);
  assert.deepEqual(cov[1002], [t, "program", t, null, "feed"]);
  assert.deepEqual(cov[1003], [affects[0], "program", affects.join(","), "tag_outside_affects", "feed"]);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = ?", FTC_KEY)[0].n, 0);
  for (const x of ["incidents", "deliveries", "reports"]) assert.equal(env.DB.rows(`SELECT COUNT(*) AS n FROM ${x}`)[0].n, 0, x);
});
