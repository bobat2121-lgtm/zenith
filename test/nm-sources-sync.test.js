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
