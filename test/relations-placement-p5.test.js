// Phase 5 P5-ZR: relations.js placeAux for the two new kinds of aux twin.
// Z-P1: a tag_affects rival twin (the wide-net rivals drain shape) lists under
// the row's own stored affects (narrowed to its tag at ingest), never the
// source's affects. Z-P2: a media twin (an outlet feed) skips rule 1 and is
// industry news unless rules 3-4 make it a competitor row. Every other role and
// status places exactly as before (a frozen copy of the pre-phase-5 rule).
// Synthetic maps only (TST, UVW, NOR; widenet_x_*, outlet_x), plus the bundled
// catalog read at run time without naming a key.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";
import { buildRelations } from "../scripts/build-relations.mjs";

hookJsonImports();
const { loadRelations } = await import("../worker/src/relations.js");
const { default: COVERED } = await import("../worker/src/covered.json");
const { default: AUX } = await import("../worker/src/aux-sources.json");

const TICKERS = ["TST", "UVW", "NOR"];
const synPeers = [
  { key: "rival_co", name: "Rival Co", status: "private", reads_through: [{ ticker: "TST", direction: "-" }] },
  { key: "pal_co", name: "Pal Co", status: "public", reads_through: [{ ticker: "UVW", direction: "+" }] },
];
const synCovered = {
  tickers: TICKERS,
  sources: { tst_own: "TST" },
  counterparty: {
    widenet_x_rivals: { role: "rival", affects: TICKERS, tag_affects: true },
    widenet_x_covered: { role: "relationship", affects: TICKERS, tag_affects: true },
    plain_rival: { role: "rival", affects: ["TST", "UVW"] },
    outlet_x: { role: "media", affects: ["TST", "UVW"] },
    cust_y: { role: "customer", affects: ["TST"] },
    prog_z: { role: "program", affects: ["UVW"] },
    rel_w: { role: "relationship", affects: ["NOR"] },
    idx_v: { role: "index_event", affects: ["TST"] },
  },
  records: [],
};
const subject = (entity, status, affects, extra = {}) => ({ entity, name: entity, status, lane: "strategic_noncompany", coverage_subject: true, affects, ...extra });
const synAux = {
  sources: {
    widenet_x_rivals: subject("widenet_x_rivals", "program", TICKERS, { tag_affects: true }),
    widenet_x_covered: subject("widenet_x_covered", "program", TICKERS, { tag_affects: true }),
    widenet_x_industry: { entity: "widenet_x_industry", name: "widenet_x_industry", status: "program", lane: "strategic_noncompany" },
    plain_rival: { entity: "plain_rival", name: "Plain Rival", status: "private" },
    outlet_x: subject("outlet_x", "media", ["TST", "UVW"]),
    cust_y: subject("cust_y", "public", ["TST"]),
    prog_z: subject("prog_z", "program", ["UVW"]),
    rel_w: subject("rel_w", "public", ["NOR"]),
    idx_v: { entity: "idx_v", name: "Idx V", status: "public" },
    rival_co: { entity: "rival_co", name: "Rival Co", status: "private" },
    some_media: { entity: "some_media", name: "Some Media", status: "media" },
    a_register: { entity: "a_register", name: "A register", status: "public", record: true },
    pal_sec: { entity: "pal_co", name: "Pal filings", status: "public", sec: true, record: true },
  },
  exclude: {},
};
const synMatch = { TST: { terms: ["Testco"], accounts: [] }, UVW: { terms: ["Uvwco"], accounts: [] }, NOR: { terms: ["Norco"], accounts: [] } };
const synIsRecord = (k) => k.startsWith("edgar_") || synAux.sources[k]?.record === true;
const synBuilt = buildRelations({ peers: synPeers, keyAccounts: {}, rivals: {}, tickers: TICKERS, auxKeys: Object.keys(synAux.sources) });
const syn = () => loadRelations({ relations: synBuilt.relations, version: "rel-p5", covered: synCovered, aux: synAux, match: synMatch, industry: {}, isRecordSource: synIsRecord });

// The placement rule as it was before phase 5 (relations.js placeAux at the
// phase 3 merge), over the same object's public pieces. Rows of a media or a
// tag_affects source are the only ones phase 5 places differently.
function mainPlaceAux(rel, covered, aux, row) {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const universe = new Set(covered.tickers);
  const inOrder = (set) => covered.tickers.filter((t) => set.has(t));
  const key = row?.source_key;
  const cls = rel.sourceClass(key);
  const entity = row?.entity_key || (key ? ((own(aux.sources, key) && aux.sources[key]?.entity) || key) : null);
  let raw = row?.reads ?? row?.reads_through ?? null;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const reads = Array.isArray(raw) ? raw.map((r) => (typeof r === "string" ? r : r?.ticker)).filter((t) => universe.has(t)) : [];
  const status = row?.status ?? (own(aux.sources, key) ? aux.sources[key]?.status : null);
  const competitorsBy = () => inOrder(new Set([...rel.tickersOfEntity(entity).map((x) => x.ticker), ...reads]));
  if (cls?.startsWith("twin:")) {
    const role = cls.slice(5);
    if (role === "rival") return { competitors: inOrder(new Set((covered.counterparty[key]?.affects || []).filter((t) => universe.has(t)))), industry: false };
    return { competitors: [], industry: role === "program" };
  }
  if (status === "program" || cls === "register") return { competitors: [], industry: true };
  if (cls === "sec_feed") return { competitors: competitorsBy(), industry: false };
  const c = competitorsBy();
  if (c.length) return { competitors: c, industry: false };
  if (status === "media" && !row?.coverage_subject) return { competitors: [], industry: true };
  return { competitors: [], industry: false };
}

// --- Z-P1 ---------------------------------------------------------------------
test("Z-P1 a tag_affects rival twin places under its row's stored affects only, never the source's affects", () => {
  const rel = syn();
  const row = (affects, extra = {}) => ({ source_key: "widenet_x_rivals", entity_key: "widenet_x_rivals", status: "program", coverage_subject: 1, affects, ...extra });
  assert.deepEqual(rel.placeAux(row("UVW")), { competitors: ["UVW"], industry: false });
  assert.deepEqual(rel.placeAux(row("NOR,TST")), { competitors: ["TST", "NOR"], industry: false }, "covered-ticker order");
  assert.deepEqual(rel.placeAux(row(["UVW", "ZZZ"])), { competitors: ["UVW"], industry: false }, "an uncovered ticker is dropped");
  assert.deepEqual(rel.placeAux(row(null)), { competitors: [], industry: false }, "no stored affects: no ticker, never all of them");
  assert.deepEqual(rel.rivalTickers(row("UVW"), "aux"), ["UVW"]);
  // A plain rival twin keeps the source's affects (unchanged).
  assert.deepEqual(rel.placeAux({ source_key: "plain_rival", entity_key: "plain_rival", status: "private", affects: "UVW" }), { competitors: ["TST", "UVW"], industry: false });
  // A tag_affects twin of another role follows that role as before.
  assert.deepEqual(rel.placeAux({ source_key: "widenet_x_covered", entity_key: "widenet_x_covered", status: "program", coverage_subject: 1, affects: "UVW" }),
    { competitors: [], industry: false });
  // The flag on the aux entry alone also marks the twin.
  const auxOnly = loadRelations({ relations: synBuilt.relations, version: "rel-p5", match: synMatch, industry: {}, isRecordSource: synIsRecord,
    covered: { ...synCovered, counterparty: { ...synCovered.counterparty, widenet_x_rivals: { role: "rival", affects: TICKERS } } }, aux: synAux });
  assert.deepEqual(auxOnly.placeAux(row("UVW")), { competitors: ["UVW"], industry: false });
});

// --- Z-P2 ---------------------------------------------------------------------
test("Z-P2 a media twin skips rule 1: industry news unless its entity is a competitor or the grade reads through", () => {
  const rel = syn();
  const twin = (extra = {}) => ({ source_key: "outlet_x", entity_key: "outlet_x", status: "media", coverage_subject: 1, affects: "TST", ...extra });
  assert.deepEqual(rel.placeAux(twin()), { competitors: [], industry: true }, "a non-competitor entity");
  assert.deepEqual(rel.placeAux(twin({ entity_key: "rival_co" })), { competitors: ["TST"], industry: false }, "the grader named a rival of TST");
  assert.deepEqual(rel.placeAux(twin({ reads_through: '[{"ticker":"UVW","direction":"+"}]' })), { competitors: ["UVW"], industry: false }, "a read-through");
  assert.deepEqual(rel.placeAux(twin({ status: undefined })), { competitors: [], industry: true }, "status from the aux entry");
  assert.deepEqual(rel.placeAux(twin({ coverage_subject: 0 })), { competitors: [], industry: true });
  assert.deepEqual(rel.rivalTickers({ role: "media", ticker: "TST" }, "coverage"), [], "a media Coverage row is never a competitor row");
  // A coverage-subject media filter of another role is still neither (rule 6).
  assert.deepEqual(rel.placeAux({ source_key: "cust_y", entity_key: "cust_y", status: "media", coverage_subject: 1 }), { competitors: [], industry: false });
});

test("Z-P2 every pre-existing role and status places as before (synthetic table)", () => {
  const rel = syn();
  const keys = Object.keys(synAux.sources).filter((k) => !["outlet_x", "widenet_x_rivals"].includes(k)).concat(["edgar_pal", "unknown_src"]);
  const statuses = ["public", "private", "program", "media", "unknown", undefined];
  const reads = [undefined, '[{"ticker":"NOR","direction":"-"}]', "{bad"];
  let n = 0;
  for (const source_key of keys) for (const status of statuses) for (const coverage_subject of [0, 1]) for (const reads_through of reads) {
    for (const entity_key of [undefined, "rival_co", "pal_co", "nobody"]) {
      const row = { source_key, entity_key, status, coverage_subject, reads_through, affects: "NOR" };
      assert.deepEqual(rel.placeAux(row), mainPlaceAux(rel, synCovered, synAux, row), JSON.stringify(row));
      n++;
    }
  }
  assert.ok(n > 1000);
});

test("Z-P2 on the bundled catalog: every entry without a media role or tag_affects places as before", () => {
  const rel = loadRelations();
  let n = 0;
  for (const [k, a] of Object.entries(AUX.sources)) {
    const cp = COVERED.counterparty?.[k];
    if (cp?.role === "media" || cp?.tag_affects === true || a.tag_affects === true) continue;
    for (const coverage_subject of [a.coverage_subject ? 1 : 0, 1, 0]) {
      const row = { source_key: k, entity_key: a.entity, status: a.status, coverage_subject, affects: (a.affects || []).join(",") };
      assert.deepEqual(rel.placeAux(row), mainPlaceAux(rel, COVERED, AUX, row), k);
      n++;
    }
  }
  assert.ok(n > 0);
});
