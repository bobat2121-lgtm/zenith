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

// The two FMCSA keys come with news-monitor's FMCSA register PR. Both are in
// the bundled catalog or neither is; the catalog tests below run once they are.
const FMCSA_KEYS = ["fmcsa_inspections", "fmcsa_census"];
const FMCSA_SYNCED = FMCSA_KEYS.filter((k) => Object.hasOwn(COVERED.counterparty, k));
const NOT_SYNCED = FMCSA_SYNCED.length ? false : "the FMCSA register keys are not in the bundled catalog yet (synced with news-monitor's FMCSA register PR)";

test("the FMCSA keys are synced together or not at all (Z-C1)", () => {
  assert.ok(FMCSA_SYNCED.length === 0 || FMCSA_SYNCED.length === FMCSA_KEYS.length, `synced: ${FMCSA_SYNCED.join(", ")}`);
  for (const k of FMCSA_KEYS) assert.equal(Object.hasOwn(AUX.sources, k), FMCSA_SYNCED.length > 0, `${k} aux entry`);
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
