// scripts/sync-covered.mjs: covered keys from the covered lane and from
// coveredTicker declarations; counterparty routing from role/affects on any
// source, COUNTERPARTY_SOURCES and the existing-source routing. aux-sources.json:
// every other polled source is auxiliary or ops; a counterparty filter built to
// watch a covered company is auxiliary marked coverage_subject.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";
import { buildCovered, buildAux, buildChannels, shortName, humanize, FILTER_ADAPTERS, OPS_ADAPTERS, FPDS, isRecordSource, RECORD_ADAPTERS, OFFICIAL_HOST_RE, REGISTER_ADAPTERS, REGISTERS, GROUP_ROUTED_ADAPTERS, buildRegisterGroups, BODY_RECORD_ADAPTERS } from "../scripts/sync-covered.mjs";

hookJsonImports();
const { makeAuxRoute } = await import("../worker/src/aux-route.js");

const SOURCES = [
  { key: "redcat", lane: "covered", covered: true, coveredTicker: "RCAT" },
  { key: "edgar_rcat", lane: "covered", covered: true, coveredTicker: "RCAT" },
  // A covered deck feed on an hourly cadence, declared only by coveredTicker.
  { key: "ondas_presentations", lane: "public_adjacent", coveredTicker: "onds", coveredCadence: "hourly" },
  { key: "unusual", lane: "covered", covered: true, coveredTicker: "UMAC" },
  // Counterparty sources declared in any stream's file.
  { key: "walmart_news", lane: "public_adjacent", role: "customer", affects: ["SYM"] },
  { key: "drone_dominance", lane: "strategic_fast_noncompany", role: "program", affects: ["RCAT", "UMAC", "PUSA"] },
  { key: "doordash", lane: "public_adjacent" },
  { key: "joby", lane: "public_adjacent" },
  { key: "bad_role", lane: "secondary_noncompany", role: "friend", affects: ["RCAT"] },
  { key: "maymobility_news", lane: "private_adjacent", route: "watchlist" },
  { key: "symbotic", lane: "covered", covered: true, coveredTicker: "SYM" },
];

test("covered keys come from the covered lane and from coveredTicker", () => {
  const { tickers, sources } = buildCovered(SOURCES);
  assert.deepEqual(tickers, ["ONDS", "RCAT", "SYM", "UMAC"]);
  assert.equal(sources.ondas_presentations, "ONDS");
  assert.equal(sources.edgar_rcat, "RCAT");
  assert.equal(sources.maymobility_news, undefined, "watchlist peers are not graded");
});

test("role and affects are read from every source, the counterparty list and the existing routing", () => {
  const { counterparty, warnings } = buildCovered(SOURCES, {
    counterpartySources: [{ key: "doordash", role: "relationship", affects: ["SERV", "SYM"] }],
    existing: { joby: { role: "rival", affects: ["MRLN", "SRFM"] }, gone: { role: "rival", affects: ["RCAT"] }, redcat: { role: "rival", affects: ["UMAC"] } },
  });
  assert.deepEqual(counterparty.walmart_news, { role: "customer", affects: ["SYM"] });
  assert.deepEqual(counterparty.drone_dominance, { role: "program", affects: ["RCAT", "UMAC"] });
  assert.deepEqual(counterparty.doordash, { role: "relationship", affects: ["SYM"] });
  assert.equal(counterparty.joby, undefined, "affects nothing covered here");
  assert.equal(counterparty.bad_role, undefined);
  assert.equal(counterparty.gone, undefined, "not a polled source");
  assert.equal(counterparty.redcat, undefined, "a covered company's own source is never a counterparty");
  assert.ok(warnings.some((w) => w.startsWith("bad_role:")));
  assert.ok(warnings.some((w) => w.startsWith("gone:")));
  assert.ok(warnings.some((w) => w.includes("PUSA not covered")));
});

const AUX_SOURCES = [
  { key: "redcat", lane: "covered", adapter: "rss", coveredTicker: "RCAT", name: "Red Cat (RCAT)" },
  { key: "kodiak", lane: "covered", adapter: "rss", coveredTicker: "KDK", name: "Kodiak (KDK)" },
  { key: "aglt_press", lane: "covered", adapter: "rss", coveredTicker: "AGLT", name: "Agility (AGLT)" },
  // S2 ops: by lane, by adapter and by key.
  { key: "edgar_latest", lane: "strategic_trigger_noncompany", adapter: "edgar_latest", name: "SEC latest filings" },
  { key: "site_kodiak", lane: "strategic_noncompany", adapter: "site_structure", name: "Kodiak site structure" },
  { key: "probe_kdk_ir_news_rss", lane: "strategic_noncompany", adapter: "probe", name: "Probe" },
  { key: "site_other", lane: "secondary_noncompany", adapter: "html_diff", name: "Site check" },
  { key: "trigger_x", lane: "strategic_trigger_noncompany", adapter: "rss", name: "Another trigger" },
  // S3 counterparty sources: a company channel is a plain auxiliary name; a
  // filter, or a key naming a covered ticker, is auxiliary as a coverage subject.
  { key: "skydio", lane: "private_adjacent", adapter: "sitemap_diff", companyStatus: "private", name: "Skydio", role: "relationship", affects: ["RCAT"] },
  { key: "volvo_autonomous", lane: "public_adjacent", adapter: "html_diff", companyStatus: "public", name: "Volvo Autonomous Solutions — news", role: "relationship", affects: ["KDK"] },
  { key: "aglt_rel", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Agility Robotics (AGLT) - partner co-mentions (NVIDIA, Foxconn)", role: "relationship", affects: ["AGLT"] },
  { key: "kdk_rel", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Kodiak AI (KDK): partner co-mentions", role: "relationship", affects: ["KDK"] },
  { key: "rcat_rel", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Red Cat (RCAT): partner co-mentions", role: "relationship", affects: ["RCAT"] },
  { key: "rcat_rel_steyr", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Steyr Motors AG IR: Red Cat notices", role: "relationship", affects: ["RCAT"] },
  { key: "westfraser_kdk", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "West Fraser", role: "customer", affects: ["KDK"] },
  { key: "acme_kdk", lane: "private_adjacent", adapter: "rss", companyStatus: "private", name: "Acme", role: "customer", affects: ["KDK"] },
  { key: "dronedominance", lane: "strategic_fast_noncompany", adapter: "js_announcements", name: "Drone Dominance", role: "program", affects: ["RCAT", "KDK"] },
  { key: "dronedominance_lists", lane: "strategic_noncompany", adapter: "js_list_diff", name: "Drone Dominance — vendor and results lists", role: "program", affects: ["RCAT"] },
  { key: "fpds_rcat", lane: "strategic_noncompany", adapter: "fpds_atom", name: "FPDS awards — Red Cat", role: "customer", affects: ["RCAT"] },
  { key: "fpds_kdk", lane: "strategic_noncompany", adapter: "fpds_atom", name: "FPDS awards — Kodiak", role: "customer", affects: ["KDK"] },
  { key: "wargov_contracts_matched", lane: "strategic_noncompany", adapter: "wargov_contract_paragraphs", name: "War.gov daily contracts — paragraphs naming covered companies", role: "customer", affects: ["RCAT", "KDK"] },
  { key: "uber", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Uber (UBER) — autonomy releases", role: "relationship", affects: ["KDK"] },
  { key: "uber_freight", lane: "public_adjacent", adapter: "rss", companyStatus: "public", name: "Uber Freight — news" },
  // S4: everything else.
  { key: "anduril", lane: "private_adjacent", adapter: "sitemap_diff", companyStatus: "private", name: "Anduril" },
  { key: "waymo", lane: "private_adjacent", adapter: "rss", companyStatus: "private", name: "Waymo blog" },
  { key: "electra", lane: "private_adjacent", adapter: "rss", companyStatus: "private", name: "Electra" },
  { key: "rekor", lane: "public_adjacent", adapter: "rss", companyStatus: "public", name: "Rekor" },
  { key: "parrot", lane: "public_adjacent", adapter: "rss", name: "Parrot - press releases" },
  { key: "heo", lane: "private_adjacent", adapter: "sitemap_diff", name: "HEO (HEO Robotics): non-Earth imaging deals" },
  { key: "maymobility_news", lane: "private_adjacent", adapter: "sitemap_diff", companyStatus: "private", name: "May Mobility — news" },
  { key: "maymobility_sec", lane: "public_adjacent", adapter: "edgar", companyStatus: "public", name: "ACP Holdings / May Mobility — SEC filings" },
  { key: "verkada", lane: "private_adjacent", adapter: "verkada_press", companyStatus: "private", name: "Verkada" },
  { key: "verkada_updates", lane: "private_adjacent", adapter: "verkada_updates", companyStatus: "private", name: "Verkada Product Updates" },
  { key: "space_eyes_sec", lane: "public_adjacent", adapter: "edgar", companyStatus: "public", name: "Space-Eyes – SEC" },
  { key: "nga", lane: "strategic_noncompany", adapter: "rss", name: "NGA — news" },
  { key: "wargov_contracts", lane: "strategic_fast_noncompany", adapter: "html_links", name: "War.gov Contracts" },
  { key: "regional_news", lane: "secondary_noncompany", adapter: "rss", name: "" },
];
const AUX_PEERS = [
  { key: "anduril", name: "Anduril (private)", status: "private" },
  { key: "waymo", name: "Waymo (Alphabet subsidiary)", status: "subsidiary" },
  { key: "electra", name: "ELECTRA AI (pending Nasdaq: AIBR)", status: "public-pending" },
  { key: "rekor", name: "Rekor Systems (NASDAQ: REKR)", status: "private" },
  { key: "maymobility", name: "May Mobility (private; pending Nasdaq: MAY)", status: "public-pending" },
  { key: "volvo", name: "Volvo Group (VOLV-B Stockholm; VLVLY)", status: "public" },
  { key: "space", name: "Space Inc", status: "public" },
  { key: "uber", name: "Uber Technologies (UBER)", status: "public" },
  { key: "space_eyes", name: "Space-Eyes", status: "public" },
];

function auxFixture() {
  const covered = buildCovered(AUX_SOURCES);
  return { covered, ...buildAux(AUX_SOURCES, covered, AUX_PEERS) };
}

test("every polled source is covered, auxiliary or excluded, exactly once", () => {
  const { covered, sources, exclude } = auxFixture();
  for (const s of AUX_SOURCES) {
    const homes = [s.key in covered.sources, s.key in sources, s.key in exclude].filter(Boolean);
    assert.equal(homes.length, 1, s.key);
  }
  for (const key of Object.keys(covered.sources)) assert.ok(!(key in sources) && !(key in exclude), `S1 ${key}`);
});

test("ops sources are excluded by lane, adapter or key", () => {
  const { exclude } = auxFixture();
  for (const key of ["edgar_latest", "site_kodiak", "probe_kdk_ir_news_rss", "site_other", "trigger_x"]) assert.equal(exclude[key], "ops", key);
});

test("counterparty filters built for a covered company are coverage_subject auxiliary entries with the tickers they affect", () => {
  const { sources, exclude } = auxFixture();
  assert.deepEqual(sources.skydio, { entity: "skydio", name: "Skydio", status: "private", lane: "private_adjacent" },
    "a counterparty company's own channel is a plain auxiliary name");
  assert.equal(sources.volvo_autonomous.coverage_subject, undefined);
  for (const key of ["aglt_rel", "kdk_rel", "rcat_rel", "rcat_rel_steyr", "westfraser_kdk", "acme_kdk", "dronedominance", "dronedominance_lists",
    "fpds_rcat", "fpds_kdk", "wargov_contracts_matched", "uber"]) {
    assert.equal(sources[key]?.coverage_subject, true, key);
    assert.ok(!(key in exclude), `${key} is no longer excluded`);
  }
  assert.deepEqual(sources.aglt_rel.affects, ["AGLT"], "filtered feed and covered-ticker token");
  assert.deepEqual(sources.acme_kdk.affects, ["KDK"], "company adapter, but the key names KDK");
  assert.deepEqual(sources.dronedominance.affects, ["RCAT", "KDK"]);
  assert.deepEqual(sources.wargov_contracts_matched.affects, ["RCAT", "KDK"]);
  // Only ops sources are still excluded.
  assert.deepEqual([...new Set(Object.values(exclude))], ["ops"]);
  assert.ok(FILTER_ADAPTERS.includes("rss_filtered") && !FILTER_ADAPTERS.includes("sitemap_diff"));
});

test("coverage-subject entities: the program or search name; the grader names the real outside company", () => {
  const { sources } = auxFixture();
  // A covered ticker's co-mention search: "<company> partner mentions"; a key under it shares it.
  assert.deepEqual(sources.aglt_rel, { entity: "aglt_rel", name: "Agility Robotics partner mentions", status: "public", lane: "public_adjacent",
    coverage_subject: true, affects: ["AGLT"] });
  assert.equal(sources.kdk_rel.name, "Kodiak AI partner mentions");
  assert.deepEqual([sources.rcat_rel_steyr.entity, sources.rcat_rel_steyr.name], ["rcat_rel", "Red Cat partner mentions"]);
  // Every FPDS award feed is one program.
  for (const key of ["fpds_rcat", "fpds_kdk"]) {
    assert.deepEqual([sources[key].entity, sources[key].name, sources[key].status], [FPDS.entity, "FPDS contracts", "program"], key);
  }
  assert.deepEqual([sources.dronedominance.entity, sources.dronedominance.name, sources.dronedominance.status], ["dronedominance", "Drone Dominance", "program"]);
  assert.deepEqual([sources.dronedominance_lists.entity, sources.dronedominance_lists.name], ["dronedominance", "Drone Dominance"],
    "a coverage subject may take its entity from another source");
  assert.deepEqual([sources.wargov_contracts_matched.entity, sources.wargov_contracts_matched.name], ["wargov_contracts", "War.gov Contracts"]);
  assert.deepEqual([sources.westfraser_kdk.entity, sources.westfraser_kdk.name], ["westfraser_kdk", "West Fraser"]);
  assert.deepEqual([sources.uber.entity, sources.uber.name], ["uber", "Uber Technologies (UBER)"], "a peers entry names it");
  // A plain auxiliary source never takes its entity from a coverage subject.
  assert.deepEqual([sources.uber_freight.entity, sources.uber_freight.name, sources.uber_freight.coverage_subject], ["uber", "Uber Technologies (UBER)", undefined],
    "uber is a peers key");
  const plain = buildAux([{ key: "acme_rel", lane: "public_adjacent", adapter: "rss_filtered", name: "Acme mentions", role: "relationship", affects: ["KDK"] },
    { key: "acme_rel_news", lane: "public_adjacent", adapter: "rss", name: "Acme — news" }],
  { tickers: ["KDK"], sources: {}, counterparty: { acme_rel: { role: "relationship", affects: ["KDK"] } } }, []);
  assert.equal(plain.sources.acme_rel_news.entity, "acme_rel_news", "not taken from the coverage subject acme_rel");
  assert.equal(plain.sources.acme_rel.coverage_subject, true, "a filter adapter");
  assert.equal(plain.sources.acme_rel.name, "Acme mentions", "acme is not a covered ticker: its own name");
});

test("every other company and program source is auxiliary, in key order", () => {
  const { sources, exclude } = auxFixture();
  for (const key of ["anduril", "waymo", "parrot", "nga", "wargov_contracts", "regional_news"]) assert.ok(sources[key], key);
  assert.deepEqual(Object.keys(sources), Object.keys(sources).slice().sort());
  assert.deepEqual(Object.keys(exclude), Object.keys(exclude).slice().sort());
  assert.equal(sources.nga.lane, "strategic_noncompany");
});

test("entity: a peers key, else the longest peers or auxiliary key prefix, else the key", () => {
  const { sources } = auxFixture();
  assert.equal(sources.anduril.entity, "anduril");
  assert.equal(sources.maymobility_news.entity, "maymobility");
  assert.equal(sources.maymobility_sec.entity, "maymobility");
  assert.equal(sources.volvo_autonomous.entity, "volvo");
  assert.equal(sources.verkada_updates.entity, "verkada", "prefix is another auxiliary source");
  assert.equal(sources.space_eyes_sec.entity, "space_eyes", "longest prefix wins over space");
  // SEC filing adapters are marked sec (zenith-core never mutes them); other sources are not.
  assert.equal(sources.maymobility_sec.sec, true);
  assert.equal(sources.space_eyes_sec.sec, true);
  assert.equal(sources.maymobility_news.sec, undefined);
  assert.equal(sources.nga.entity, "nga");
});

test("display name: peers name, else the source name before its qualifier, else the key humanized", () => {
  const { sources } = auxFixture();
  assert.equal(sources.anduril.name, "Anduril (private)");
  assert.equal(sources.maymobility_news.name, "May Mobility (private; pending Nasdaq: MAY)");
  assert.equal(sources.volvo_autonomous.name, "Volvo Group (VOLV-B Stockholm; VLVLY)");
  assert.equal(sources.parrot.name, "Parrot");
  assert.equal(sources.nga.name, "NGA");
  assert.equal(sources.heo.name, "HEO (HEO Robotics)");
  assert.equal(sources.verkada_updates.name, "Verkada", "named after the entity's own source");
  assert.equal(sources.regional_news.name, "Regional News");
  assert.equal(shortName("Space-Eyes – SEC"), "Space-Eyes");
  assert.equal(shortName("Agility Robotics (AGLT) - partner co-mentions"), "Agility Robotics (AGLT)");
  assert.equal(humanize("fort_robotics"), "Fort Robotics");
});

test("status: peers public/private, else companyStatus, else from the lane", () => {
  const { sources } = auxFixture();
  assert.equal(sources.anduril.status, "private");
  assert.equal(sources.rekor.status, "private", "peers status wins over companyStatus");
  assert.equal(sources.waymo.status, "private", "peers 'subsidiary' falls back to companyStatus");
  assert.equal(sources.electra.status, "private", "peers 'public-pending' falls back to companyStatus");
  assert.equal(sources.maymobility_sec.status, "public");
  assert.equal(sources.parrot.status, "public", "public_adjacent lane");
  assert.equal(sources.heo.status, "private", "private_adjacent lane");
  assert.equal(sources.nga.status, "program");
  assert.equal(sources.wargov_contracts.status, "program");
  assert.equal(sources.regional_news.status, "program");
});

test("a shadow source (shadow: true) is never in covered.json and is excluded in aux-sources.json, with one warning per key", () => {
  const list = [
    { key: "redcat", lane: "covered", covered: true, coveredTicker: "RCAT", adapter: "rss", name: "Red Cat (RCAT)" },
    { key: "unusual", lane: "covered", covered: true, coveredTicker: "UMAC", adapter: "rss", name: "Unusual Machines (UMAC)" },
    { key: "drv_fedreg_drone_rules", lane: "strategic_noncompany", adapter: "federal_register", name: "Federal Register drone rules", role: "program", affects: ["UMAC", "RCAT"] },
    { key: "drv_drone_industrial_policy", lane: "strategic_noncompany", adapter: "rss_filtered", name: "DoW drone industrial policy (Bing)", role: "program", affects: ["RCAT", "UMAC"], shadow: true },
    { key: "drv_shadow_plain", lane: "strategic_noncompany", adapter: "rss_filtered", name: "A shadow theme with no role", shadow: true },
    { key: "drv_not_shadow", lane: "strategic_noncompany", adapter: "rss_filtered", name: "shadow: false is not shadow", role: "program", affects: ["RCAT"], shadow: false },
  ];
  const covered = buildCovered(list, { existing: { drv_drone_industrial_policy: { role: "program", affects: ["RCAT"] } } });
  assert.deepEqual(covered.counterparty.drv_fedreg_drone_rules, { role: "program", affects: ["UMAC", "RCAT"] });
  assert.deepEqual(covered.counterparty.drv_not_shadow, { role: "program", affects: ["RCAT"] });
  assert.equal(covered.counterparty.drv_drone_industrial_policy, undefined, "a shadow source is not routed, even through the existing routing");
  assert.equal(covered.sources.drv_drone_industrial_policy, undefined);
  for (const key of ["drv_drone_industrial_policy", "drv_shadow_plain"]) {
    assert.equal(covered.warnings.filter((w) => w.startsWith(`${key}:`)).length, 1, `${key} warned once`);
    assert.match(covered.warnings.find((w) => w.startsWith(`${key}:`)), /shadow source \(shadow: true\), left out of covered\.json and excluded in aux-sources\.json/);
  }
  const aux = buildAux(list, covered, []);
  for (const key of ["drv_drone_industrial_policy", "drv_shadow_plain"]) {
    assert.equal(aux.sources[key], undefined, `${key} is not an auxiliary source`);
    assert.equal(aux.exclude[key], "shadow", `${key} is excluded, so auxRoute's unknown-key fallback never routes it`);
    assert.equal(makeAuxRoute(aux, covered)(key), null, `${key} never reaches the auxiliary pass`);
  }
  assert.equal(aux.sources.drv_fedreg_drone_rules?.coverage_subject, true);
  const written = JSON.stringify({ covered, sources: aux.sources });
  assert.doesNotMatch(written.replace(/"warnings":\[[^\]]*\]/, ""), /drv_drone_industrial_policy|drv_shadow_plain/);
});

// Phase 0 gates: official records (scripts/sync-covered.mjs isRecordSource).
test("buildAux marks record by adapter, or by a .gov/.mil/legistar host in the strategic lanes only; a bing.com endpoint never; a public_adjacent .gov host never; covered records lists SEC-adapter covered keys", () => {
  const list = [
    { key: "testco", lane: "covered", adapter: "rss", coveredTicker: "RCAT", name: "Testco", endpoint: "https://testco.example.com/feed" },
    { key: "edgar_rcat", lane: "covered", adapter: "edgar", coveredTicker: "RCAT", name: "Testco SEC" },
    { key: "testco_sec_extra", lane: "covered", adapter: "edgar_keyword", coveredTicker: "RCAT", name: "Testco SEC keyword" },
    { key: "fpds_testco", lane: "strategic_noncompany", adapter: "fpds_atom", name: "FPDS", role: "customer", affects: ["RCAT"] },
    { key: "legistar_testville", lane: "strategic_noncompany", adapter: "legistar_matters", name: "Testville council" },
    { key: "fedreg_test", lane: "strategic_noncompany", adapter: "federal_register", name: "Federal Register test" },
    { key: "agency_rss", lane: "strategic_noncompany", adapter: "rss", name: "Agency news", endpoint: "https://www.agency.gov/rss" },
    { key: "army_rss", lane: "strategic_fast_noncompany", adapter: "rss", name: "Army news", url: "https://news.example.mil/rss" },
    { key: "council_list", lane: "strategic_noncompany", adapter: "html_links", name: "Council", endpoint: "https://webapi.legistar.com/v1/x" },
    { key: "uk_gov", lane: "strategic_noncompany", adapter: "rss", name: "UK", endpoint: "https://www.mod.gov.uk/feed" },
    { key: "bing_program", lane: "strategic_noncompany", adapter: "rss_filtered", name: "Program search", endpoint: "https://www.bing.com/news/search?q=x&format=rss" },
    { key: "vendor_gov_page", lane: "public_adjacent", adapter: "rss", name: "Vendor", endpoint: "https://vendor.example.gov/feed" },
    { key: "drone_lists", lane: "strategic_noncompany", adapter: "js_list_diff", name: "Lists", endpoint: "https://drone-lists.example.io/" },
    { key: "outside_sec", lane: "public_adjacent", adapter: "edgar", name: "Outside SEC" },
    { key: "media_x", lane: "secondary_noncompany", adapter: "rss", name: "Media", endpoint: "https://media.example.com/rss" },
  ];
  const covered = buildCovered(list);
  assert.deepEqual(covered.records, ["edgar_rcat", "testco_sec_extra"]);
  const { sources } = buildAux(list, covered, []);
  const rec = Object.keys(sources).filter((k) => sources[k].record === true).sort();
  assert.deepEqual(rec, ["agency_rss", "army_rss", "council_list", "fedreg_test", "fpds_testco", "legistar_testville", "outside_sec", "uk_gov"]);
  for (const k of ["bing_program", "vendor_gov_page", "drone_lists", "media_x"]) assert.equal(sources[k].record, undefined, k);
  assert.equal(isRecordSource({ adapter: "rss", lane: "strategic_noncompany", endpoint: "not a url" }), false);
  assert.ok(RECORD_ADAPTERS.includes("fpds_atom") && OFFICIAL_HOST_RE.test("www.war.gov"));
});

// Phase 2 rival lists (registry/rivals.json, buildCovered's rivals option):
// sources already polled, declared rivals in Zenith only.
const RIVAL_SOURCES = [
  { key: "acmeco", lane: "covered", covered: true, coveredTicker: "AAA", adapter: "rss", name: "Acme Co", endpoint: "https://ir.acme.example/rss" },
  { key: "bolt", lane: "covered", covered: true, coveredTicker: "BBB", adapter: "rss", name: "Bolt", endpoint: "https://bolt.example/rss" },
  { key: "rival_new", lane: "private_adjacent", adapter: "sitemap_diff", name: "New Rival", endpoint: "https://www.newrival.example/sitemap.xml" },
  { key: "rival_old", lane: "public_adjacent", adapter: "rss", name: "Old Rival", endpoint: "https://ir.oldrival.example/rss", role: "rival", affects: ["AAA"] },
  { key: "rival_shadow", lane: "private_adjacent", adapter: "html_diff", name: "Shadow Rival", endpoint: "https://shadow.example/news", shadow: true },
  { key: "rival_bing", lane: "public_adjacent", adapter: "rss_filtered", name: "Rival search", endpoint: "https://www.bing.com/news/search?q=x&format=rss" },
  { key: "partner", lane: "private_adjacent", adapter: "sitemap_diff", name: "Partner", endpoint: "https://partner.example/sitemap.xml", role: "relationship", affects: ["AAA"] },
  { key: "rival_sec", lane: "public_adjacent", adapter: "edgar", name: "Rival SEC", endpoint: "data.sec.example" },
  { key: "rival_page", lane: "private_adjacent", adapter: "html_diff", name: "Rival page", endpoint: "https://page.example/newsroom" },
];

test("rivals option: a polled key becomes a rival of the ticker, affects are unioned; covered, shadow, Bing, unpolled and other-role keys are skipped with one warning each", () => {
  const before = buildCovered(RIVAL_SOURCES);
  const rivals = {
    BBB: [{ key: "rival_new" }, "rival_old", { key: "acmeco" }, { key: "rival_shadow" }, { key: "rival_bing" }, { key: "gone" }, { key: "partner" }],
    AAA: [{ key: "rival_sec" }],
    ZZZ: [{ key: "rival_page" }],
  };
  const { counterparty, sources, warnings } = buildCovered(RIVAL_SOURCES, { rivals });
  assert.deepEqual(counterparty.rival_new, { role: "rival", affects: ["BBB"] });
  assert.deepEqual(counterparty.rival_old, { role: "rival", affects: ["AAA", "BBB"] }, "already a rival of AAA: BBB is added");
  assert.deepEqual(counterparty.rival_sec, { role: "rival", affects: ["AAA"] });
  assert.equal(counterparty.rival_page, undefined, "a ticker that is not covered routes nothing");
  assert.ok(warnings.some((w) => w.startsWith("rival_page:") && w.includes("ZZZ not covered")));
  // Skipped keys keep their old entry.
  assert.deepEqual(sources, before.sources);
  assert.equal(counterparty.acmeco, undefined);
  assert.equal(sources.acmeco, "AAA");
  assert.equal(counterparty.rival_shadow, undefined);
  assert.equal(counterparty.rival_bing, undefined);
  assert.equal(counterparty.gone, undefined);
  assert.deepEqual(counterparty.partner, { role: "relationship", affects: ["AAA"] });
  const why = { acmeco: "covered company's own source", rival_shadow: "shadow source", rival_bing: "Bing search", gone: "not a polled source", partner: "already has role relationship" };
  for (const [key, text] of Object.entries(why)) {
    const mine = warnings.filter((w) => w.startsWith(`${key}: registry/rivals.json`));
    assert.equal(mine.length, 1, `${key} warned once`);
    assert.ok(mine[0].includes(text), `${key}: ${mine[0]}`);
  }
  // No rivals (the option's default) is today's output.
  assert.deepEqual(buildCovered(RIVAL_SOURCES, { rivals: {} }).counterparty, before.counterparty);
});

test("rivals do not change aux-sources: buildAux is identical with and without the rivals option, for rss, sitemap_diff, html_diff and edgar adapters", () => {
  const rivals = { BBB: ["rival_new", "rival_old", "rival_sec", "rival_page"], AAA: ["rival_page"] };
  const without = buildCovered(RIVAL_SOURCES);
  const withRivals = buildCovered(RIVAL_SOURCES, { rivals });
  assert.notDeepEqual(withRivals.counterparty, without.counterparty, "the option did route something");
  const adapters = new Set(RIVAL_SOURCES.filter((s) => withRivals.counterparty[s.key]?.role === "rival").map((s) => s.adapter));
  for (const a of ["rss", "sitemap_diff", "html_diff", "edgar"]) assert.ok(adapters.has(a), a);
  assert.deepEqual(buildAux(RIVAL_SOURCES, withRivals, []), buildAux(RIVAL_SOURCES, without, []));
});

// covered.json channels (buildChannels): each source's own registrable domain.
test("buildChannels: an own-host source gets its registrable domain; filter adapters, Bing and Google searches, ops sources, probe_ and site_ keys and non-URL endpoints get none; keys sorted", () => {
  const channels = buildChannels([
    { key: "zeta_news", adapter: "rss", endpoint: "https://ir.zeta.example/rss" },
    { key: "acme_news", adapter: "rss", endpoint: "https://news.example.co.uk/feed" },
    { key: "beta_blog", adapter: "sitemap_diff", url: "https://www.beta.example/sitemap.xml" },
    { key: "acme_mentions", adapter: "rss_filtered", endpoint: "https://feeds.acme.example/search" },
    { key: "acme_search", adapter: "rss", endpoint: "https://www.bing.com/news/search?q=acme&format=rss" },
    { key: "acme_google", adapter: "rss", endpoint: "https://news.google.com/rss/search?q=acme" },
    { key: "acme_site", adapter: "site_structure", endpoint: "https://acme.example/" },
    { key: "probe_x", adapter: "rss", endpoint: "https://probe.example/rss" },
    { key: "site_acme", adapter: "html_diff", endpoint: "https://acme.example/" },
    { key: "acme_sec", adapter: "edgar", endpoint: "data.sec.example" },
  ]);
  assert.deepEqual(channels, { acme_news: "example.co.uk", beta_blog: "beta.example", zeta_news: "zeta.example" });
  assert.deepEqual(Object.keys(channels), Object.keys(channels).slice().sort());
  assert.ok(OPS_ADAPTERS.includes("site_structure"));
});

// Phase 2 registers (Z5): the three register adapters. Synthetic keys, hosts
// and names; only the adapter names are news-monitor's.
const REGISTER_LIST = [
  { key: "testco", lane: "covered", covered: true, coveredTicker: "RCAT", adapter: "rss", name: "Testco", endpoint: "https://testco.example.com/feed" },
  { key: "otherco", lane: "covered", covered: true, coveredTicker: "KDK", adapter: "rss", name: "Otherco", endpoint: "https://otherco.example.com/feed" },
  { key: "reg_lobby_new", lane: "strategic_noncompany", adapter: "lda_registrations", name: "Lobbying register — new registrations",
    endpoint: "https://register.example.org/api/filings/", role: "program", affects: ["RCAT", "KDK", "ZZZ"] },
  { key: "reg_lobby_quarterly", lane: "strategic_noncompany", adapter: "lda_reports", name: "Lobbying register — quarterly reports",
    endpoint: "https://register.example.org/api/filings/", role: "program", affects: ["RCAT", "KDK"] },
  { key: "reg_vehicles", lane: "strategic_noncompany", adapter: "txdmv_av_report", name: "State vehicle authorizations report",
    endpoint: "https://vehicles.example.org/report", role: "program", affects: ["KDK"] },
  // Controls: a filter adapter and a record adapter that are not registers.
  { key: "fpds_testco", lane: "strategic_noncompany", adapter: "fpds_atom", name: "FPDS — Testco", role: "customer", affects: ["RCAT"] },
  { key: "fedreg_testco", lane: "strategic_noncompany", adapter: "federal_register", name: "Federal Register test", role: "program", affects: ["RCAT"] },
];

test("register adapters (Z5): record, register and coverage_subject true, one program entity per register, counterparty program with affects; other adapters carry no register flag", () => {
  assert.deepEqual(REGISTER_ADAPTERS, ["lda_registrations", "lda_reports", "txdmv_av_report", "fmcsa_inspections", "fmcsa_census", "oira_review", "govinfo_crpt", "ftc_hsr_et", "gao_docket_walk"]);
  for (const a of REGISTER_ADAPTERS) assert.ok(RECORD_ADAPTERS.includes(a) && FILTER_ADAPTERS.includes(a), a);
  const covered = buildCovered(REGISTER_LIST);
  assert.deepEqual(covered.counterparty.reg_lobby_new, { role: "program", affects: ["RCAT", "KDK"] }, "an uncovered ticker is dropped");
  assert.deepEqual(covered.counterparty.reg_lobby_quarterly, { role: "program", affects: ["RCAT", "KDK"] });
  assert.deepEqual(covered.counterparty.reg_vehicles, { role: "program", affects: ["KDK"] });
  assert.deepEqual(covered.records, [], "register sources are not covered own-lane records");
  const { sources, exclude } = buildAux(REGISTER_LIST, covered, []);
  const want = {
    reg_lobby_new: { entity: "lda", name: "LDA lobbying filings", status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: ["RCAT", "KDK"], record: true, register: true },
    reg_lobby_quarterly: { entity: "lda", name: "LDA lobbying filings", status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: ["RCAT", "KDK"], record: true, register: true },
    reg_vehicles: { entity: "txdmv_av", name: "Texas DMV AV authorizations", status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: ["KDK"], record: true, register: true },
  };
  for (const [key, entry] of Object.entries(want)) {
    assert.deepEqual(sources[key], entry, key);
    assert.ok(!(key in exclude), `${key} is not excluded`);
    assert.equal(isRecordSource(REGISTER_LIST.find((s) => s.key === key)), true, `${key} is a record by adapter, whatever its host`);
  }
  for (const key of ["fpds_testco", "fedreg_testco", "testco", "otherco"]) assert.equal(sources[key]?.register, undefined, key);
  assert.equal(sources.fpds_testco.entity, FPDS.entity, "FPDS keeps its own program entity");
  // A register is a filter over a third-party register, never a company's own channel.
  const channels = buildChannels(REGISTER_LIST);
  for (const key of Object.keys(want)) assert.ok(!(key in channels), `${key} has no channel`);
  assert.deepEqual(Object.keys(channels), ["otherco", "testco"]);
});

// Phase 5 P5-ZR (Z-W4): config.tagAffects === true is copied as tag_affects to the
// counterparty entry and to its aux entry (one rule for phases 4 and 5); the
// drain and outlet adapters are filters; every other source is unchanged.
const TAG_LIST = [
  { key: "testco", lane: "covered", covered: true, coveredTicker: "RCAT" },
  { key: "otherco", lane: "covered", covered: true, coveredTicker: "KDK" },
  { key: "drain_rel", lane: "strategic_noncompany", adapter: "discovery_drain", endpoint: "https://feed.example.com/x/", name: "Drain rel",
    role: "relationship", affects: ["RCAT", "KDK", "ZZZ"], config: { tagAffects: true } },
  { key: "drain_rival", lane: "strategic_noncompany", adapter: "discovery_drain", endpoint: "https://feed.example.com/x/", name: "Drain rival",
    role: "rival", affects: ["RCAT", "KDK"], config: { tagAffects: true } },
  { key: "drain_plain", lane: "strategic_noncompany", adapter: "discovery_drain", endpoint: "https://feed.example.com/x/", name: "Drain plain", config: { tagAffects: true } },
  { key: "reg_tagged", lane: "strategic_noncompany", adapter: "txdmv_av_report", endpoint: "https://vehicles.example.org/r", name: "Tagged register",
    role: "program", affects: ["KDK"], config: { tagAffects: true } },
  { key: "not_strict", lane: "strategic_noncompany", adapter: "rss_filtered", endpoint: "https://feed.example.com/y", name: "Not strict",
    role: "program", affects: ["RCAT"], config: { tagAffects: "yes" } },
  { key: "untagged", lane: "strategic_noncompany", adapter: "rss_filtered", endpoint: "https://feed.example.com/z", name: "Untagged", role: "program", affects: ["RCAT"] },
];

test("Z-W4 tag_affects: config.tagAffects === true is copied to the counterparty and the aux entry; drain and outlet adapters are filters; others carry no flag", () => {
  for (const a of ["discovery_drain", "outlet_feed", "ctech_tag", "outlet_sitemap"]) assert.ok(FILTER_ADAPTERS.includes(a), a);
  const covered = buildCovered(TAG_LIST);
  assert.deepEqual(covered.counterparty.drain_rel, { role: "relationship", affects: ["RCAT", "KDK"], tag_affects: true });
  assert.deepEqual(covered.counterparty.drain_rival, { role: "rival", affects: ["RCAT", "KDK"], tag_affects: true });
  assert.deepEqual(covered.counterparty.reg_tagged, { role: "program", affects: ["KDK"], tag_affects: true });
  assert.deepEqual(covered.counterparty.not_strict, { role: "program", affects: ["RCAT"] }, "only a literal true sets the flag");
  assert.deepEqual(covered.counterparty.untagged, { role: "program", affects: ["RCAT"] });
  assert.ok(!("drain_plain" in covered.counterparty));
  const { sources } = buildAux(TAG_LIST, covered, []);
  assert.deepEqual(sources.drain_rel, { entity: "drain_rel", name: "Drain rel", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["RCAT", "KDK"], tag_affects: true });
  assert.deepEqual(sources.drain_rival, { entity: "drain_rival", name: "Drain rival", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["RCAT", "KDK"], tag_affects: true });
  assert.equal(sources.reg_tagged.tag_affects, true);
  assert.equal(sources.reg_tagged.register, true);
  assert.deepEqual(sources.drain_plain, { entity: "drain_plain", name: "Drain plain", status: "program", lane: "strategic_noncompany" },
    "a drain source without a role is a plain aux entry, with no flag");
  for (const k of ["not_strict", "untagged"]) assert.equal(sources[k].tag_affects, undefined, k);
  // The same list without any config flag: identical output minus the flags.
  const bare = TAG_LIST.map(({ config, ...s }) => s);
  const c2 = buildCovered(bare);
  for (const e of Object.values(c2.counterparty)) assert.equal(e.tag_affects, undefined);
  const a2 = buildAux(bare, c2, []).sources;
  for (const [k, e] of Object.entries(sources)) {
    const { tag_affects, ...rest } = e;
    assert.deepEqual(a2[k], rest, k);
  }
});

// Phase 4 Part C (Z-C1): the FMCSA register adapters and the Legistar fan-out
// adapter. Synthetic keys, hosts and names; only the adapter names are
// news-monitor's.
const PART_C_LIST = [
  { key: "testco", lane: "covered", covered: true, coveredTicker: "RCAT", adapter: "rss", name: "Testco", endpoint: "https://testco.example.com/feed" },
  { key: "otherco", lane: "covered", covered: true, coveredTicker: "KDK", adapter: "rss", name: "Otherco", endpoint: "https://otherco.example.com/feed" },
  { key: "councils_fanout", lane: "strategic_noncompany", adapter: "legistar_fanout", name: "Testville councils (fan-out) — test matters",
    endpoint: "https://api.example.org/v1/", role: "customer", affects: ["RCAT", "ZZZ"] },
  { key: "carrier_inspections", lane: "strategic_noncompany", adapter: "fmcsa_inspections", name: "Carrier inspections — test",
    endpoint: "https://data.example.org/resource/a.json", role: "program", affects: ["KDK", "RCAT"] },
  { key: "carrier_census", lane: "strategic_noncompany", adapter: "fmcsa_census", name: "Carrier census — test",
    endpoint: "https://data.example.org/resource/b.json", role: "program", affects: ["KDK"] },
];

test("Z-C1 Part C adapters: fmcsa_inspections and fmcsa_census are registers (records, filters, one fmcsa entity); legistar_fanout is a record filter and a coverage subject, not a register", () => {
  for (const a of ["fmcsa_inspections", "fmcsa_census"]) {
    assert.ok(REGISTER_ADAPTERS.includes(a) && RECORD_ADAPTERS.includes(a) && FILTER_ADAPTERS.includes(a), a);
  }
  assert.ok(RECORD_ADAPTERS.includes("legistar_fanout") && FILTER_ADAPTERS.includes("legistar_fanout"));
  assert.ok(!REGISTER_ADAPTERS.includes("legistar_fanout"), "the fan-out is a record filter, not a register");
  const covered = buildCovered(PART_C_LIST);
  assert.deepEqual(covered.counterparty.councils_fanout, { role: "customer", affects: ["RCAT"] }, "an uncovered ticker is dropped");
  assert.deepEqual(covered.counterparty.carrier_inspections, { role: "program", affects: ["KDK", "RCAT"] });
  assert.deepEqual(covered.counterparty.carrier_census, { role: "program", affects: ["KDK"] });
  assert.deepEqual(covered.records, []);
  const { sources, exclude } = buildAux(PART_C_LIST, covered, []);
  const fmcsa = { entity: "fmcsa", name: "FMCSA inspection and census records", status: "program", lane: "strategic_noncompany", coverage_subject: true, record: true, register: true };
  assert.deepEqual(sources.carrier_inspections, { ...fmcsa, affects: ["KDK", "RCAT"] });
  assert.deepEqual(sources.carrier_census, { ...fmcsa, affects: ["KDK"] });
  assert.deepEqual(sources.councils_fanout, { entity: "councils_fanout", name: "Testville councils (fan-out)", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["RCAT"], record: true });
  for (const key of ["councils_fanout", "carrier_inspections", "carrier_census"]) {
    assert.ok(!(key in exclude), `${key} is not excluded`);
    assert.equal(isRecordSource(PART_C_LIST.find((s) => s.key === key)), true, `${key} is a record by adapter, whatever its host`);
  }
  const channels = buildChannels(PART_C_LIST);
  assert.deepEqual(Object.keys(channels), ["otherco", "testco"], "filters never become a company channel");
});

// Phase 4 Part B (Z-B1): the two group-routed register adapters. Synthetic
// keys, hosts, group entities and tickers; only the adapter names are
// news-monitor's. The group list has news-monitor GOV_GROUPS' shape (entity,
// label, name, mirror), plus fields the sync must never copy.
const PART_B_LIST = [
  { key: "testco", lane: "covered", covered: true, coveredTicker: "TST" },
  { key: "tsuco", lane: "covered", covered: true, coveredTicker: "TSU" },
  { key: "tsvco", lane: "covered", covered: true, coveredTicker: "TSV" },
  { key: "mirror_alpha", lane: "strategic_noncompany", adapter: "federal_register", endpoint: "https://rules.example.gov/a", name: "Alpha rules",
    role: "program", affects: ["TST", "TSU", "ZZZ"] },
  { key: "mirror_second", lane: "strategic_noncompany", adapter: "federal_register", endpoint: "https://rules.example.gov/b", name: "Second rules",
    role: "program", affects: ["TSV"] },
  { key: "mirror_gamma", lane: "strategic_noncompany", adapter: "federal_register", endpoint: "https://rules.example.gov/c", name: "Gamma rules",
    role: "program", affects: ["ZZZ"] },
  { key: "reviews_test", lane: "strategic_noncompany", adapter: "oira_review", endpoint: "https://reviews.example.gov/list.xml", name: "Test reviews — concluded",
    role: "program", affects: ["TST", "TSU", "TSV"] },
  { key: "reports_test", lane: "strategic_noncompany", adapter: "govinfo_crpt", endpoint: "https://reports.example.gov/feed.xml", name: "Test reports — lines",
    role: "program", affects: ["TST", "TSU"] },
  { key: "feed_test", lane: "strategic_noncompany", adapter: "rss_filtered", endpoint: "https://feed.example.com/x", name: "Feed test", role: "program", affects: ["TST"] },
];
const PART_B_GROUPS = [
  { key: "second", entity: "prog_test_second", label: "[Second policy]", name: "Test second policy", mirror: "mirror_second", terms: ["never copied"] },
  { key: "alpha", entity: "prog_test_alpha", label: "[Alpha policy]", name: "Test alpha policy", mirror: "mirror_alpha", affects: ["TSV"] },
  { key: "gamma", entity: "prog_test_gamma", label: "[Gamma policy]", name: "Test gamma policy", mirror: "mirror_gamma" },
  { key: "delta", entity: "prog_test_delta", label: "[Delta policy]", mirror: "not_polled" },
];

test("Z-B1 Part B adapters: oira_review and govinfo_crpt are group-routed registers (record, coverage_subject, group_routed); register_groups maps each group to its mirror's covered tickers; an rss source gets no flag", () => {
  for (const a of ["oira_review", "govinfo_crpt"]) {
    assert.ok(REGISTER_ADAPTERS.includes(a) && RECORD_ADAPTERS.includes(a) && FILTER_ADAPTERS.includes(a), a);
  }
  assert.deepEqual(GROUP_ROUTED_ADAPTERS, ["oira_review", "govinfo_crpt"]);
  assert.deepEqual(REGISTERS.oira_review, { entity: "oira", name: "OIRA regulatory review" });
  assert.deepEqual(REGISTERS.govinfo_crpt, { entity: "govinfo_crpt", name: "Congressional committee reports" });
  const covered = buildCovered(PART_B_LIST);
  assert.deepEqual(covered.counterparty.reviews_test, { role: "program", affects: ["TST", "TSU", "TSV"], group_routed: true });
  assert.deepEqual(covered.counterparty.reports_test, { role: "program", affects: ["TST", "TSU"], group_routed: true });
  assert.deepEqual(covered.counterparty.feed_test, { role: "program", affects: ["TST"] }, "a filter feed carries no group flag");
  assert.deepEqual(covered.counterparty.mirror_alpha, { role: "program", affects: ["TST", "TSU"] });
  const warnings = [];
  const aux = buildAux(PART_B_LIST, covered, [], { groups: PART_B_GROUPS, warnings });
  assert.deepEqual(aux.sources.reviews_test, { entity: "oira", name: "OIRA regulatory review", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["TST", "TSU", "TSV"], record: true, register: true, group_routed: true });
  assert.deepEqual(aux.sources.reports_test, { entity: "govinfo_crpt", name: "Congressional committee reports", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["TST", "TSU"], record: true, register: true, group_routed: true });
  assert.equal(aux.sources.feed_test.group_routed, undefined);
  assert.equal(aux.sources.mirror_alpha.group_routed, undefined);
  // register_groups: entities sorted; the mirror source's own affects (not the group's), covered only, in the mirror's order.
  assert.deepEqual(aux.register_groups, {
    prog_test_alpha: { name: "Test alpha policy", affects: ["TST", "TSU"], from: "mirror_alpha" },
    prog_test_second: { name: "Test second policy", affects: ["TSV"], from: "mirror_second" },
  });
  assert.deepEqual(Object.keys(aux), ["sources", "exclude", "register_groups"]);
  assert.ok(!JSON.stringify(aux.register_groups).includes("never copied"), "no term is copied");
  assert.equal(warnings.length, 2, "the uncovered and the unpolled mirror each warn once");
  assert.ok(warnings.some((w) => w.includes("prog_test_gamma")) && warnings.some((w) => w.includes("prog_test_delta")));
  // With no group (a news-monitor tree before Part B), aux-sources.json has no register_groups key at all.
  assert.deepEqual(Object.keys(buildAux(PART_B_LIST, covered, [])), ["sources", "exclude"]);
  // A label stands in for a missing name; a key that is not a group entity is skipped.
  const w2 = [];
  assert.deepEqual(buildRegisterGroups([{ entity: "prog_test_alpha", label: "[Alpha policy]", mirror: "mirror_alpha" }, { entity: "Bad-Key", mirror: "mirror_alpha" }],
    PART_B_LIST, covered.tickers, w2), { prog_test_alpha: { name: "Alpha policy", affects: ["TST", "TSU"], from: "mirror_alpha" } });
  assert.equal(w2.length, 1);
  // Registers are filters over a third-party register, never a company channel.
  const channels = buildChannels(PART_B_LIST);
  for (const k of ["reviews_test", "reports_test"]) assert.ok(!(k in channels), k);
});

// Phase 4 Part D (Z3, sync side): the FTC early-termination register adapter.
// Synthetic keys, hosts, names and tickers; only the adapter names are
// news-monitor's. tag_affects comes from config.tagAffects (phase 4 I5 F7,
// the phase 5 rule); body_record from the adapter (BODY_RECORD_ADAPTERS).
const PART_D_LIST = [
  { key: "own_tsa", lane: "covered", covered: true, coveredTicker: "TSA", adapter: "rss", name: "Tsaco", endpoint: "https://tsa.example.com/feed" },
  { key: "own_tsb", lane: "covered", covered: true, coveredTicker: "TSB", adapter: "rss", name: "Tsbco", endpoint: "https://tsb.example.com/feed" },
  { key: "legal_test_grants", lane: "strategic_noncompany", adapter: "ftc_hsr_et", endpoint: "https://api.example.gov/v0/notices", name: "Test early termination notices (API)",
    role: "program", affects: ["TSA", "TSB", "ZZZ"], config: { tagAffects: true, bodyRecord: true } },
  // Controls: a register without either flag, and a tagged filter that is not a body-record adapter.
  { key: "reg_vehicles_test", lane: "strategic_noncompany", adapter: "txdmv_av_report", endpoint: "https://vehicles.example.org/report", name: "Test vehicle report",
    role: "program", affects: ["TSA"] },
  { key: "drain_test", lane: "strategic_noncompany", adapter: "discovery_drain", endpoint: "https://feed.example.com/x/", name: "Drain test",
    role: "relationship", affects: ["TSA"], config: { tagAffects: true, bodyRecord: true } },
];

test("Z3 Part D adapter: ftc_hsr_et is a register (record, coverage_subject) with tag_affects from config and body_record from the adapter; no other adapter gets body_record", () => {
  assert.ok(REGISTER_ADAPTERS.includes("ftc_hsr_et") && RECORD_ADAPTERS.includes("ftc_hsr_et") && FILTER_ADAPTERS.includes("ftc_hsr_et"));
  assert.deepEqual(REGISTERS.ftc_hsr_et, { entity: "ftc_hsr", name: "FTC HSR early terminations" });
  assert.deepEqual(BODY_RECORD_ADAPTERS, ["ftc_hsr_et", "gao_docket_walk"]);
  assert.ok(!GROUP_ROUTED_ADAPTERS.includes("ftc_hsr_et"), "tag-routed, not group-routed: one routing flag per key");
  const covered = buildCovered(PART_D_LIST);
  assert.deepEqual(covered.counterparty.legal_test_grants, { role: "program", affects: ["TSA", "TSB"], tag_affects: true }, "an uncovered ticker is dropped");
  assert.deepEqual(covered.counterparty.reg_vehicles_test, { role: "program", affects: ["TSA"] });
  const { sources } = buildAux(PART_D_LIST, covered, []);
  assert.deepEqual(sources.legal_test_grants, { entity: "ftc_hsr", name: "FTC HSR early terminations", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["TSA", "TSB"], record: true, register: true, tag_affects: true, body_record: true });
  assert.equal(sources.reg_vehicles_test.body_record, undefined, "a register without the adapter keeps its page fetch");
  assert.equal(sources.drain_test.body_record, undefined, "config.bodyRecord alone sets nothing: the flag is keyed on the adapter");
  assert.equal(sources.drain_test.tag_affects, true);
  assert.ok(!("legal_test_grants" in buildChannels(PART_D_LIST)), "a register is never a channel");
});

// Phase 4 Part D (Z3, sync side): the GAO bid-protest docket walk adapter.
// Synthetic keys, hosts, names and tickers; only the adapter name is
// news-monitor's. As for the FTC adapter: tag_affects from config.tagAffects,
// body_record from the adapter, its own program entity.
const PART_D_GAO_LIST = [
  ...PART_D_LIST.filter((s) => s.key.startsWith("own_")),
  { key: "legal_test_dockets", lane: "strategic_noncompany", adapter: "gao_docket_walk", endpoint: "https://www.example.gov/docket/", name: "Test bid protest dockets (sequential walk)",
    role: "program", affects: ["TSB", "TSA", "ZZZ"], config: { tagAffects: true, bodyRecord: true } },
  // Control: the same adapter with no config flags still gets body_record (keyed on the adapter), never tag_affects.
  { key: "legal_test_dockets_plain", lane: "strategic_noncompany", adapter: "gao_docket_walk", endpoint: "https://www.example.gov/docket/", name: "Test dockets, no flags",
    role: "program", affects: ["TSA"] },
];

test("Z3 Part D adapter: gao_docket_walk is a register (record, coverage_subject) of its own gao_protests entity, tag_affects from config and body_record from the adapter", () => {
  assert.ok(REGISTER_ADAPTERS.includes("gao_docket_walk") && RECORD_ADAPTERS.includes("gao_docket_walk") && FILTER_ADAPTERS.includes("gao_docket_walk"));
  assert.deepEqual(REGISTERS.gao_docket_walk, { entity: "gao_protests", name: "GAO bid protests" });
  assert.notEqual(REGISTERS.gao_docket_walk.entity, REGISTERS.ftc_hsr_et.entity, "one program entity per register");
  assert.ok(!GROUP_ROUTED_ADAPTERS.includes("gao_docket_walk"), "tag-routed, not group-routed: one routing flag per key");
  const covered = buildCovered(PART_D_GAO_LIST);
  assert.deepEqual(covered.counterparty.legal_test_dockets, { role: "program", affects: ["TSB", "TSA"], tag_affects: true }, "an uncovered ticker is dropped; news-monitor's order kept");
  assert.deepEqual(covered.counterparty.legal_test_dockets_plain, { role: "program", affects: ["TSA"] });
  const { sources } = buildAux(PART_D_GAO_LIST, covered, []);
  assert.deepEqual(sources.legal_test_dockets, { entity: "gao_protests", name: "GAO bid protests", status: "program", lane: "strategic_noncompany",
    coverage_subject: true, affects: ["TSB", "TSA"], record: true, register: true, tag_affects: true, body_record: true });
  assert.equal(sources.legal_test_dockets_plain.body_record, true, "the flag is keyed on the adapter");
  assert.equal(sources.legal_test_dockets_plain.tag_affects, undefined, "tag_affects only from config.tagAffects");
  assert.ok(!("legal_test_dockets" in buildChannels(PART_D_GAO_LIST)), "a register is never a channel");
});
