// Phase 0 gates: official records. The rule (scripts/sync-covered.mjs
// isRecordSource) is applied by the generator to news-monitor's source
// definitions; worker/src/records.js reads its output. A rule test, not a
// snapshot: a re-sync that adds record keys stays green.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hookJsonImports } from "./helpers/worker-env.js";
import { isRecordSource as ruleIsRecord } from "../scripts/sync-covered.mjs";

hookJsonImports();
const { isRecordSource, isOfficialRecord } = await import("../worker/src/records.js");
const { default: AUX } = await import("../worker/src/aux-sources.json");
const { default: COVERED } = await import("../worker/src/covered.json");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// news-monitor's checkout beside the zenith checkout (or beside the worktrees
// folder), or NEWS_MONITOR_REPO. Without one, the definition checks are skipped.
const NM = [process.env.NEWS_MONITOR_REPO, join(root, "..", "news-monitor-repo"), join(root, "..", "..", "news-monitor-repo")]
  .find((p) => p && existsSync(join(p, "src", "sources.js")) && existsSync(join(p, "src", "priority.js")));

// The record keys of the spec's 2026-11-24 check (news-monitor 82dec51).
const KNOWN = ["einride_sec", "faraday", "iren", "maymobility_sec", "paccar", "palantir", "spaceeyes_sec", "swarmer",
  "fpds_axon", "fpds_onds", "fpds_pdyn", "fpds_pl", "fpds_pusa", "fpds_satl", "fpds_spai", "wargov_contracts", "wargov_contracts_matched",
  "legistar_oakland_axon", "fedreg_av_trucking", "fedreg_bis_ai_compute", "drv_fedreg_drone_rules", "nga", "diu", "xtech_announcements",
  "canada_dnd_drones", "fmv_planet", "nhtsa_sgo_ads", "safetyact_awards", "regulations_eas_srfm", "drv_whitehouse_actions",
  "drv_senate_approps_def", "drv_house_approps", "drv_govinfo_defense_bills"];

test("records (rule test): the generated record keys are a superset of the known 33; dronedominance, own channels and media are not; unusual and strive_sec_northland are in covered.json records", () => {
  const auxRecords = Object.keys(AUX.sources).filter((k) => AUX.sources[k].record === true);
  for (const k of KNOWN) assert.ok(auxRecords.includes(k), `${k} is a record`);
  for (const k of ["dronedominance", "dronedominance_lists"]) assert.notEqual(AUX.sources[k]?.record, true, k);
  for (const k of Object.keys(AUX.sources).filter((x) => /^ia_|media/.test(x))) assert.notEqual(AUX.sources[k].record, true, k);
  assert.ok(COVERED.records.includes("unusual") && COVERED.records.includes("strive_sec_northland"));
  for (const k of COVERED.records) assert.ok(Object.hasOwn(COVERED.sources, k), `${k} is a covered source`);
  // A covered company's own news channel is not a record.
  for (const k of ["redcat", "aurora", "planet"].filter((x) => Object.hasOwn(COVERED.sources, x))) assert.equal(isRecordSource(k), false, k);
});

test("records (rule test): every record key satisfies isRecordSource on its news-monitor definition; no www.bing.com endpoint is a record", { skip: NM ? false : "news-monitor checkout not found" }, async (t) => {
  const { SOURCES } = await import(pathToFileURL(join(NM, "src", "sources.js")).href);
  await import(pathToFileURL(join(NM, "src", "priority.js")).href);
  const def = new Map(SOURCES.map((s) => [s.key, s]));
  const auxRecords = Object.keys(AUX.sources).filter((k) => AUX.sources[k].record === true);
  // Phase 0 nm-sources: the generated files may be synced from a news-monitor
  // branch that is not merged yet (PR-Z2 deploys before news-monitor PR #63),
  // so a found main checkout can lack the newest keys. Those are listed, not
  // failed; with NEWS_MONITOR_REPO set (the checkout synced from), every key
  // must be defined.
  const missing = [...auxRecords, ...COVERED.records].filter((k) => !def.has(k));
  if (process.env.NEWS_MONITOR_REPO) assert.deepEqual(missing, [], "every record key is a news-monitor source");
  else if (missing.length) t.diagnostic(`news-monitor checkout ${NM} predates the generated files; not checked: ${missing.join(", ")}`);
  for (const k of [...auxRecords, ...COVERED.records].filter((x) => def.has(x))) {
    assert.ok(ruleIsRecord(def.get(k)), `${k} satisfies the rule`);
  }
  for (const s of SOURCES) {
    let host = "";
    try { host = new URL(s.endpoint || s.url || "").hostname; } catch {}
    if (host === "www.bing.com") assert.notEqual(AUX.sources[s.key]?.record, true, `${s.key} (Bing) is not a record`);
  }
});

test("records: any sec.gov item is a record whatever its key; edgar_* is a record source", () => {
  assert.equal(isRecordSource("edgar_anything_new"), true);
  assert.equal(isRecordSource("unusual"), true);
  assert.equal(isRecordSource("fpds_pl"), true);
  assert.equal(isRecordSource("einride_sec"), true, "an aux sec entry");
  assert.equal(isRecordSource("anduril"), false);
  assert.equal(isRecordSource(""), false);
  assert.equal(isRecordSource("toString"), false, "no prototype keys");
  assert.equal(isOfficialRecord({ source_key: "testco_news", url: "https://www.sec.gov/Archives/edgar/data/1/x.htm" }), true);
  assert.equal(isOfficialRecord({ source_key: "testco_news", url: "https://testco.example.com/news/1" }), false);
  assert.equal(isOfficialRecord({ source_key: "nga", url: "https://www.nga.mil/news/1" }), true);
});
