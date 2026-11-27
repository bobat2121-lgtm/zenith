// worker/src/aux-route.js: static routing from aux-sources.json and covered.json, and
// the runtime fallback for source keys news-monitor creates on the fly.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const { auxRoute, makeAuxRoute, humanize } = await import("../worker/src/aux-route.js");

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const AUX = {
  sources: {
    anduril: { entity: "anduril", name: "Anduril (private)", status: "private", lane: "private_adjacent" },
    maymobility_news: { entity: "maymobility", name: "May Mobility", status: "private", lane: "private_adjacent" },
    maymobility_sec: { entity: "maymobility", name: "May Mobility", status: "public", lane: "public_adjacent" },
    verkada: { entity: "verkada", name: "Verkada (private)", status: "private", lane: "private_adjacent" },
    verkada_updates: { entity: "verkada", name: "Verkada (private)", status: "private", lane: "private_adjacent" },
    nga: { entity: "nga", name: "NGA", status: "program", lane: "strategic_noncompany" },
    aglt_rel: { entity: "aglt_rel", name: "Agility Robotics partner mentions", status: "public", lane: "public_adjacent", coverage_subject: true, affects: ["AGLT"] },
    fpds_pl: { entity: "fpds", name: "FPDS contracts", status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: ["PL"] },
    uber: { entity: "uber", name: "Uber", status: "public", lane: "public_adjacent", coverage_subject: true, affects: ["AUR", "SERV"] },
  },
  exclude: { site_kodiak: "ops" },
};
const COVERED = {
  tickers: ["DPRO", "MBAI", "RCAT", "SERV"],
  sources: { draganfly: "DPRO", mbody: "MBAI", redcat: "RCAT", edgar_rcat: "RCAT", serv_blog: "SERV" },
  counterparty: { aglt_rel: { role: "relationship", affects: ["AGLT"] } },
};
const route = makeAuxRoute(AUX, COVERED);
const unknown = (entity_key, entity_name) => ({ entity_key, entity_name, status: "unknown" });
const HEX = "0123456789abcdef0123456789abcdef";

test("aux-sources.json sources route to their entity, name and status", () => {
  assert.deepEqual(route("anduril"), { entity_key: "anduril", entity_name: "Anduril (private)", status: "private" });
  assert.deepEqual(route("maymobility_sec"), { entity_key: "maymobility", entity_name: "May Mobility", status: "public" });
  assert.deepEqual(route("nga"), { entity_key: "nga", entity_name: "NGA", status: "program" });
});

test("coverage-subject sources route with coverage_subject and the covered tickers they affect", () => {
  assert.deepEqual(route("aglt_rel"), { entity_key: "aglt_rel", entity_name: "Agility Robotics partner mentions", status: "public",
    coverage_subject: true, affects: ["AGLT"] });
  assert.deepEqual(route("fpds_pl"), { entity_key: "fpds", entity_name: "FPDS contracts", status: "program", coverage_subject: true, affects: ["PL"] });
  const a = route("uber");
  a.affects.push("XYZ");
  assert.deepEqual(route("uber").affects, ["AUR", "SERV"], "each route gets its own affects list");
  // A runtime key that only shares the name is that company's own channel.
  assert.deepEqual(route("managed_uber_news"), { entity_key: "uber", entity_name: "Uber", status: "public" });
  assert.deepEqual(route("ia_uber"), { entity_key: "uber", entity_name: "Uber", status: "public" });
  assert.equal(route("anduril").coverage_subject, undefined);
});

test("excluded and covered sources route to null", () => {
  for (const key of ["site_kodiak", "redcat", "edgar_rcat", "draganfly"]) assert.equal(route(key), null, key);
  assert.equal(route(""), null);
  assert.equal(route(null), null);
});

test("runtime ops keys route to null", () => {
  for (const key of ["probe_new_ir_rss", "site_newco", "edgar_latest"]) assert.equal(route(key), null, key);
});

test("managed sources: covered duplicates drop, known names keep their entry, others are unknown", () => {
  assert.equal(route("managed_draganfly_news"), null);
  assert.equal(route("managed_mbody_news"), null);
  assert.equal(route("managed_mbody"), null);
  assert.equal(route("managed_serv-blog"), null, "'-' read as '_'");
  assert.deepEqual(route("managed_anduril_news"), route("anduril"));
  assert.deepEqual(route("managed_verkada"), route("verkada"));
  assert.deepEqual(route("managed_maymobility_news"), route("maymobility_news"));
  assert.deepEqual(route(`managed_${HEX}_news`), { entity_key: `managed_${HEX}_news`, entity_name: "Other company", status: "unknown" });
  assert.deepEqual(route(`managed_${HEX}`), { entity_key: `managed_${HEX}`, entity_name: "Other company", status: "unknown" });
  assert.deepEqual(route("managed_fort_robotics_news"), unknown("fort_robotics", "Fort Robotics"));
  assert.deepEqual(route("managed_fort_robotics"), unknown("fort_robotics", "Fort Robotics"));
});

test("ia_ collectors: industry media, a known name, or an unknown one", () => {
  assert.deepEqual(route("ia_media_dronelife"), { entity_key: "media_dronelife", entity_name: "Industry media", status: "media" });
  assert.deepEqual(route("ia_anduril"), route("anduril"));
  assert.deepEqual(route("ia_fort_robotics"), unknown("fort_robotics", "Fort Robotics"));
});

test("any other unknown key is its own entity, without a leading edgar_", () => {
  assert.deepEqual(route("edgar_ssti"), unknown("ssti", "Ssti"));
  assert.deepEqual(route("soundthinking"), unknown("soundthinking", "Soundthinking"));
  assert.deepEqual(route("edgar_anduril"), route("anduril"));
  // A retired key named after a known entity keeps that entity's name.
  assert.deepEqual(route("maymobility"), { entity_key: "maymobility", entity_name: "May Mobility", status: "private" });
});

test("humanize capitalises each _-separated word", () => {
  assert.equal(humanize("fort_robotics"), "Fort Robotics");
  assert.equal(humanize("nga"), "Nga");
  assert.equal(humanize("a__b"), "A B");
  assert.equal(humanize(""), "");
});

test("the committed aux-sources.json agrees with covered.json and the spec's spot checks", async () => {
  const aux = json("../worker/src/aux-sources.json");
  const covered = json("../worker/src/covered.json");
  for (const key of Object.keys(covered.sources)) {
    assert.ok(!(key in aux.sources) && !(key in aux.exclude), `${key} is covered`);
    assert.equal(auxRoute(key), null, key);
  }
  for (const [key, e] of Object.entries(aux.sources)) {
    assert.ok(!(key in aux.exclude), key);
    assert.ok(["public", "private", "program"].includes(e.status), `${key} status ${e.status}`);
    assert.ok(e.entity && e.name && e.lane, key);
    if (e.coverage_subject !== undefined) {
      // A counterparty filter built for covered companies, affecting only covered tickers.
      assert.equal(e.coverage_subject, true, key);
      assert.ok(key in covered.counterparty, `${key} is a counterparty source`);
      assert.ok(e.affects.length && e.affects.every((t) => covered.tickers.includes(t)), `${key} affects ${e.affects}`);
      assert.deepEqual(auxRoute(key).affects, e.affects, key);
    }
  }
  for (const [key, why] of Object.entries(aux.exclude)) {
    assert.ok(why === "ops" || why === "shadow", `${key} ${why}`);
    if (why === "shadow") assert.ok(!(key in covered.sources) && !(key in covered.counterparty), `${key} shadow is not covered`);
    assert.equal(auxRoute(key), null, key);
  }
  assert.equal(auxRoute("anduril").entity_key, "anduril");
  assert.equal(auxRoute("skydio").status, "private");
  assert.equal(auxRoute("maymobility_news").entity_key, "maymobility");
  assert.equal(auxRoute("nga").status, "program");
  // Round 2: coverage-subject sources are auxiliary; ops sources stay excluded.
  assert.equal(aux.exclude.site_kodiak, "ops");
  assert.equal(auxRoute("site_kodiak"), null);
  const cs = (key) => { const r = auxRoute(key); return [r.entity_key, r.entity_name, r.status, r.coverage_subject, r.affects]; };
  assert.deepEqual(cs("dronedominance"), ["dronedominance", "Drone Dominance", "program", true, ["RCAT", "DPRO", "PUSA", "UMAC"]]);
  assert.deepEqual(cs("dronedominance_lists"), ["dronedominance", "Drone Dominance", "program", true, ["RCAT", "DPRO", "PUSA", "UMAC", "ONDS"]]);
  assert.deepEqual(cs("fpds_pl"), ["fpds", "FPDS contracts", "program", true, ["PL"]]);
  assert.deepEqual(cs("aglt_rel"), ["aglt_rel", "Agility Robotics partner mentions", "public", true, ["AGLT"]]);
  assert.equal(auxRoute("wargov_contracts_matched").coverage_subject, true);
  assert.ok(auxRoute("wargov_contracts_matched").affects.includes("RCAT"));
  assert.equal(auxRoute("wargov_contracts").coverage_subject, undefined, "the unfiltered contracts feed is a plain program source");
  assert.equal(auxRoute("skydio").coverage_subject, undefined, "a counterparty company's own channel is a plain auxiliary name");
  // The two FMCSA register keys sync together (test/nm-sources-sync.test.js Z-C1). The count is 138 whenever
  // news-monitor's source list (NEWS_MONITOR_REPO, else the checkout beside zenith) defines them, so a sync that
  // leaves them out fails here; 136 only while neither news-monitor nor the bundled catalog has them.
  const nmRoot = [process.env.NEWS_MONITOR_REPO, fileURLToPath(new URL("../../news-monitor-repo", import.meta.url)), fileURLToPath(new URL("../../../news-monitor-repo", import.meta.url))]
    .find((p) => p && existsSync(join(p, "src", "sources.js")) && existsSync(join(p, "src", "priority.js")));
  const nmSources = nmRoot ? (await import(pathToFileURL(join(nmRoot, "src", "sources.js")).href)).SOURCES : [];
  if (nmRoot) await import(pathToFileURL(join(nmRoot, "src", "priority.js")).href); // appends the register sources to SOURCES, as sync-covered.mjs reads them
  const fmcsa = ["fmcsa_inspections", "fmcsa_census"].some((k) => nmSources.some((s) => s.key === k)) ? 2
    : ["fmcsa_inspections", "fmcsa_census"].filter((k) => aux.sources[k]?.coverage_subject).length;
  // Phase 4 Part B: each group-routed register key counts once news-monitor defines it (or the catalog already has it).
  const partB = ["oira_reviews", "govinfo_committee_reports"].filter((k) => nmSources.some((s) => s.key === k) || aux.sources[k]?.coverage_subject).length;
  assert.equal(Object.values(aux.sources).filter((e) => e.coverage_subject).length, 136 + fmcsa + partB); // +fedreg_bis_ai_compute, grrr_policy (GRRR program sources); +4 drv_ drone group program sources; +4 drv_ defense budget sources (Phase 1a.2); +12 legistar_* fan-out, +fedreg_fcc_space (Phase 0 nm-sources); +7 fpds_* vendor-UEI keys (Phase 1 FPDS); +txdmv_av_authorizations (Phase 2 TxDMV register); +legistar_fanout (Phase 4 Legistar fan-out), +fmcsa_inspections, fmcsa_census (Phase 4 FMCSA registers; 138 once synced); +oira_reviews, govinfo_committee_reports (Phase 4 OIRA and committee-report registers)
  assert.deepEqual([auxRoute("legistar_fresno").coverage_subject, auxRoute("legistar_fresno").affects], [true, ["AXON", "SERV", "EVLV", "XTRAF"]]);
  assert.deepEqual(auxRoute("fedreg_fcc_space").affects, ["PL", "SATL"]);
});

test("runtime keys never route a covered company's channel or a blank name to the auxiliary page", () => {
  assert.equal(route("ia_draganfly"), null, "ia_<covered source key>");
  assert.equal(route("ia_redcat"), null);
  assert.deepEqual(route("edgar_"), unknown("edgar_", "Edgar"), "nothing after the prefix keeps the key");
  assert.deepEqual(route("ia_"), unknown("ia_", "Ia"));
  assert.deepEqual(route("ia_rockwell"), unknown("rockwell", "Rockwell"));
});
