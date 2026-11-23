// scripts/sync-covered.mjs: covered keys from the covered lane and from
// coveredTicker declarations; counterparty routing from role/affects on any
// source, COUNTERPARTY_SOURCES and the existing-source routing. aux-sources.json:
// every other polled source is auxiliary, ops, or a counterparty filter that
// only watches a covered company.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCovered, buildAux, shortName, humanize, FILTER_ADAPTERS } from "../scripts/sync-covered.mjs";

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
  // S3 counterparty sources: a company channel is also auxiliary; a filter, or a
  // key naming a covered ticker, is coverage only.
  { key: "skydio", lane: "private_adjacent", adapter: "sitemap_diff", companyStatus: "private", name: "Skydio", role: "relationship", affects: ["RCAT"] },
  { key: "volvo_autonomous", lane: "public_adjacent", adapter: "html_diff", companyStatus: "public", name: "Volvo Autonomous Solutions — news", role: "relationship", affects: ["KDK"] },
  { key: "aglt_rel", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "Agility co-mentions", role: "relationship", affects: ["AGLT"] },
  { key: "westfraser_kdk", lane: "public_adjacent", adapter: "rss_filtered", companyStatus: "public", name: "West Fraser", role: "customer", affects: ["KDK"] },
  { key: "acme_kdk", lane: "private_adjacent", adapter: "rss", companyStatus: "private", name: "Acme", role: "customer", affects: ["KDK"] },
  { key: "dronedominance", lane: "strategic_fast_noncompany", adapter: "js_announcements", name: "Drone Dominance", role: "program", affects: ["RCAT"] },
  { key: "fpds_rcat", lane: "strategic_noncompany", adapter: "fpds_atom", name: "FPDS awards", role: "customer", affects: ["RCAT"] },
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

test("counterparty sources are auxiliary only when they are a company channel not named for a covered ticker", () => {
  const { sources, exclude } = auxFixture();
  assert.ok(sources.skydio, "a counterparty company's own channel is also auxiliary");
  assert.ok(sources.volvo_autonomous);
  assert.equal(exclude.aglt_rel, "coverage_subject", "filtered feed and covered-ticker token");
  assert.equal(exclude.westfraser_kdk, "coverage_subject");
  assert.equal(exclude.acme_kdk, "coverage_subject", "company adapter, but the key names KDK");
  assert.equal(exclude.dronedominance, "coverage_subject");
  assert.equal(exclude.fpds_rcat, "coverage_subject");
  assert.ok(FILTER_ADAPTERS.includes("rss_filtered") && !FILTER_ADAPTERS.includes("sitemap_diff"));
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
