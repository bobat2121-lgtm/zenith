// worker/src/aux-route.js: static routing from aux-sources.json and covered.json, and
// the runtime fallback for source keys news-monitor creates on the fly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  },
  exclude: { aglt_rel: "coverage_subject", fpds_pl: "coverage_subject", site_kodiak: "ops" },
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

test("excluded and covered sources route to null", () => {
  for (const key of ["aglt_rel", "fpds_pl", "site_kodiak", "redcat", "edgar_rcat", "draganfly"]) assert.equal(route(key), null, key);
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

test("the committed aux-sources.json agrees with covered.json and the spec's spot checks", () => {
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
  }
  for (const [key, why] of Object.entries(aux.exclude)) {
    assert.ok(["ops", "coverage_subject"].includes(why), `${key} ${why}`);
    assert.equal(auxRoute(key), null, key);
  }
  assert.equal(auxRoute("anduril").entity_key, "anduril");
  assert.equal(auxRoute("skydio").status, "private");
  assert.equal(auxRoute("maymobility_news").entity_key, "maymobility");
  assert.equal(auxRoute("nga").status, "program");
  for (const key of ["aglt_rel", "fpds_pl", "site_kodiak", "dronedominance"]) assert.ok(key in aux.exclude, key);
});

test("runtime keys never route a covered company's channel or a blank name to the auxiliary page", () => {
  assert.equal(route("ia_draganfly"), null, "ia_<covered source key>");
  assert.equal(route("ia_redcat"), null);
  assert.deepEqual(route("edgar_"), unknown("edgar_", "Edgar"), "nothing after the prefix keeps the key");
  assert.deepEqual(route("ia_"), unknown("ia_", "Ia"));
  assert.deepEqual(route("ia_rockwell"), unknown("rockwell", "Rockwell"));
});
