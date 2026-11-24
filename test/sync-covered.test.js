// scripts/sync-covered.mjs: covered keys from the covered lane and from
// coveredTicker declarations; counterparty routing from role/affects on any
// source, COUNTERPARTY_SOURCES and the existing-source routing. aux-sources.json:
// every other polled source is auxiliary or ops; a counterparty filter built to
// watch a covered company is auxiliary marked coverage_subject.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";
import { buildCovered, buildAux, shortName, humanize, FILTER_ADAPTERS, FPDS } from "../scripts/sync-covered.mjs";

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

test("a shadow source (shadow: true) is never written to covered.json or aux-sources.json, with one warning per key", () => {
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
    assert.match(covered.warnings.find((w) => w.startsWith(`${key}:`)), /shadow source \(shadow: true\), left out of covered\.json and aux-sources\.json/);
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
