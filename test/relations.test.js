// Phase 3 PR-CV1: scripts/build-relations.mjs, worker/src/relations.generated.js
// and worker/src/relations.js (the one rivals rule and placement rule).
// Synthetic fixtures only: the pure tests inject their own maps (SYN, ACM, NOR,
// widget_corp style); tests on the bundled files compute every expected value
// from the input files at run time and never write a name, key or count here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hookJsonImports } from "./helpers/worker-env.js";
import {
  buildRelations, relationsVersion, renderRelations, parseGenerated, generate, COMMAND, DIRECTIONS,
} from "../scripts/build-relations.mjs";

hookJsonImports();
const { loadRelations } = await import("../worker/src/relations.js");
const GEN = await import("../worker/src/relations.generated.js");
const { default: COVERED } = await import("../worker/src/covered.json");
const { default: AUX } = await import("../worker/src/aux-sources.json");
const { isRecordSource } = await import("../worker/src/records.js");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "build-relations.mjs");
const SRC = new URL("../worker/src/", import.meta.url);
const readRepo = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const PEERS = JSON.parse(readRepo("rubric", "peers.json"));
const KEY_ACCOUNTS = JSON.parse(readRepo("rubric", "key-accounts.json"));
const RIVALS = JSON.parse(readRepo("registry", "rivals.json"));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

// --- Synthetic maps in the real shapes ----------------------------------------------------------
const MINUS = "−";
const synPeers = [
  { key: "widget_corp", name: "Widget Corp", status: "private", status_note: "note", matters: "m", noise: "n",
    reads_through: [{ ticker: "SYN", direction: MINUS, why: "a reason" }, { ticker: "ZZZ", direction: "+", why: "x" }] },
  { key: "hedge_co", name: "Hedge Co", status: "public", reads_through: [{ ticker: "ACM", direction: "±", why: "y" }] },
  { key: "plus_co", name: "Plus Co", status: "public", reads_through: [{ ticker: "SYN", direction: "+" }] },
  { key: "quiet_co", name: "Quiet Co", status: "private", reads_through: [] },
];
const synKeyAccounts = {
  _about: "about text",
  company_names: { SYN: ["Synco"] },
  SYN: [{ name: "Acme Stores", kind: "customer", terms: ["Acme Stores"], source: "dd" }],
  ACM: [],
  ZZZ: [{ name: "Not covered", kind: "customer", terms: [] }],
};
const synRivals = {
  ACM: [{ key: "hedge_co", basis: "rubric/peers.json" }, { key: "acme_rival_src", basis: "a sheet" }],
};
const synCovered = {
  tickers: ["SYN", "ACM", "NOR"],
  sources: { synco: "SYN", synco_sec: "SYN" },
  counterparty: {
    rival_x: { role: "rival", affects: ["SYN"] },
    cust_y: { role: "customer", affects: ["SYN"] },
    prog_z: { role: "program", affects: ["SYN", "ACM"] },
    rel_w: { role: "relationship", affects: ["ACM"] },
    idx_v: { role: "index_event", affects: ["SYN"] },
  },
  records: ["synco_sec"],
};
const synAux = {
  sources: {
    rival_x: { entity: "rival_x", name: "Rival X", status: "private" },
    cust_y: { entity: "hedge_co", name: "Hedge Co customer mentions", status: "public", coverage_subject: true, affects: ["SYN"] },
    prog_z: { entity: "prog_z", name: "Prog Z", status: "program", coverage_subject: true, record: true, affects: ["SYN", "ACM"] },
    rel_w: { entity: "rel_w", name: "Rel W", status: "public", coverage_subject: true, affects: ["ACM"] },
    idx_v: { entity: "idx_v", name: "Idx V", status: "public", affects: ["SYN"] },
    widget_corp: { entity: "widget_corp", name: "Widget Corp", status: "private" },
    widget_sec: { entity: "widget_corp", name: "Widget Corp filings", status: "public", sec: true, record: true },
    gizmo_sec: { entity: "gizmo_inc", name: "Gizmo filings", status: "public", sec: true, record: true },
    city_council: { entity: "city_council", name: "City council matters", status: "program", record: true },
    state_register: { entity: "state_register", name: "State register", status: "public", record: true },
    acme_rival_src: { entity: "acme_rival", name: "Acme Rival news", status: "private" },
    syn_filter: { entity: "syn_filter", name: "Synco trade filter", status: "media", coverage_subject: true, affects: ["SYN"] },
  },
  exclude: {},
};
const synMatch = { SYN: { terms: ["Synco"], accounts: ["Acme Stores"] }, ACM: { terms: ["Acme Corp"], accounts: [] }, NOR: { terms: ["Nordo"], accounts: [] } };
// The records.js rule over the synthetic maps (records.js reads the bundled maps only).
const synIsRecord = (k) => k.startsWith("edgar_") || synCovered.records.includes(k) || synAux.sources[k]?.record === true || synAux.sources[k]?.sec === true;
const synBuilt = buildRelations({ peers: synPeers, keyAccounts: synKeyAccounts, rivals: synRivals, tickers: synCovered.tickers, auxKeys: Object.keys(synAux.sources) });
const syn = (over = {}) => loadRelations({
  relations: synBuilt.relations, version: "rel-test", covered: synCovered, aux: synAux, match: synMatch,
  industry: {}, isRecordSource: synIsRecord, ...over,
});

function withRoot(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "zenith-rel-"));
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), text);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const synFiles = () => ({
  "rubric/peers.json": JSON.stringify(synPeers),
  "rubric/key-accounts.json": JSON.stringify(synKeyAccounts),
  "registry/rivals.json": JSON.stringify(synRivals),
  "worker/src/covered.json": JSON.stringify(synCovered),
  "worker/src/aux-sources.json": JSON.stringify(synAux),
});
const run = (root, ...flags) => spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...flags], { encoding: "utf8" });

// --- R1 -----------------------------------------------------------------------------------------
test("R1: the committed relations.generated.js equals a fresh build of the repo's files, and --check passes", () => {
  const fresh = generate(ROOT);
  const msg = `worker/src/relations.generated.js is stale: run ${COMMAND} and commit the result`;
  assert.deepEqual(GEN.RELATIONS, fresh.relations, msg);
  assert.equal(GEN.RELATIONS_VERSION, fresh.version, msg);
  assert.equal(readFileSync(new URL("relations.generated.js", SRC), "utf8"), fresh.text, msg);
  const r = run(ROOT, "--check");
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("R1: --check writes nothing, exits 1 on a stale or missing file and names the command and the key", () => withRoot(synFiles(), (root) => {
  const file = join(root, "worker", "src", "relations.generated.js");
  const missing = run(root, "--check");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /missing/);
  assert.ok(missing.stdout.includes(COMMAND), missing.stdout);
  assert.ok(!readdirSync(join(root, "worker", "src")).includes("relations.generated.js"), "--check wrote a file");

  assert.equal(run(root).status, 0);
  const built = readFileSync(file, "utf8");
  assert.ok(built.startsWith("// GENERATED by scripts/build-relations.mjs — do not edit by hand.\n"));
  assert.ok(!built.includes("\r"), "LF only");
  assert.equal(run(root, "--check").status, 0);

  // A peers.json edit after the build: --check fails and names the stale keys.
  writeFileSync(join(root, "rubric", "peers.json"), JSON.stringify([...synPeers, { key: "new_co", name: "New Co", status: "public", reads_through: [] }]));
  const stale = run(root, "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /RELATIONS_VERSION/);
  assert.match(stale.stdout, /RELATIONS\.peers/);
  assert.doesNotMatch(stale.stdout, /RELATIONS\.rivals|RELATIONS\.key_accounts/);
  assert.ok(stale.stdout.includes(COMMAND));
  assert.equal(readFileSync(file, "utf8"), built, "--check left the file alone");

  writeFileSync(file, "export const X = 1;\n");
  const garbled = run(root, "--check");
  assert.equal(garbled.status, 1);
  assert.match(garbled.stdout, /not in the generated format/);
}));

test("R1: the script warns, without failing, on an uncovered read-through ticker and an unknown rivals key", () => withRoot({
  ...synFiles(),
  "registry/rivals.json": JSON.stringify({ ...synRivals, SYN: [{ key: "nobody_known" }] }),
}, (root) => {
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WARNING peers\.json widget_corp reads through ZZZ, which is not covered/);
  assert.match(r.stdout, /WARNING rivals\.json SYN key nobody_known is neither a peer key nor an aux source/);
}));

test("R1: renderRelations and parseGenerated round-trip", () => {
  const text = renderRelations("rel-000000000000", synBuilt.relations);
  assert.deepEqual(parseGenerated(text), { version: "rel-000000000000", relations: synBuilt.relations });
  assert.deepEqual(parseGenerated(text.replace(/\n/g, "\r\n")), { version: "rel-000000000000", relations: synBuilt.relations });
  assert.equal(parseGenerated("// nothing here\n"), null);
});

// --- R2 -----------------------------------------------------------------------------------------
test("R2: RELATIONS holds only basis, peers{name,status,reads}, rivals and key_accounts{name,kind}", () => {
  const R = GEN.RELATIONS;
  assert.deepEqual(Object.keys(R), ["basis", "peers", "rivals", "key_accounts"]);
  assert.equal(R.basis, "files");
  for (const [k, p] of Object.entries(R.peers)) {
    assert.deepEqual(Object.keys(p), ["name", "status", "reads"], k);
    for (const r of p.reads) assert.deepEqual(Object.keys(r), ["ticker", "direction"], k);
  }
  for (const [t, list] of Object.entries(R.rivals)) for (const key of list) assert.equal(typeof key, "string", t);
  for (const [t, list] of Object.entries(R.key_accounts)) for (const e of list) assert.deepEqual(Object.keys(e), ["name", "kind"], t);
  const text = readFileSync(new URL("relations.generated.js", SRC), "utf8");
  for (const field of ["why", "terms", "source", "matters", "noise", "status_note", "reads_through", "company_names"]) {
    assert.ok(!text.includes(`"${field}"`), `the bundle carries ${field}`);
  }
});

test("R2: every string in RELATIONS appears in one of the four input files", () => {
  const inputs = [readRepo("rubric", "peers.json"), readRepo("rubric", "key-accounts.json"), readRepo("registry", "rivals.json"), readRepo("worker", "src", "covered.json")].join("\n");
  // Map keys (peer keys, tickers) and every string value; the field names are the bundle's own.
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const part of ["peers", "rivals", "key_accounts"]) {
    for (const [k, v] of Object.entries(GEN.RELATIONS[part])) { strings.push(k); walk(v); }
  }
  assert.ok(strings.length > 0);
  for (const s of new Set(strings)) {
    assert.ok(inputs.includes(s) || inputs.includes(JSON.stringify(s).slice(1, -1)), `not from an input file: ${JSON.stringify(s)}`);
  }
});

test("R2: synthetic build drops why, terms, source, notes and uncovered tickers; normalises U+2212", () => {
  const { relations: R, warnings } = synBuilt;
  assert.deepEqual(R.peers.widget_corp, { name: "Widget Corp", status: "private", reads: [{ ticker: "SYN", direction: "-" }] });
  assert.deepEqual(R.peers.hedge_co.reads, [{ ticker: "ACM", direction: "±" }]);
  assert.deepEqual(R.peers.quiet_co.reads, []);
  assert.deepEqual(Object.keys(R.peers), ["widget_corp", "hedge_co", "plus_co", "quiet_co"], "input order");
  assert.deepEqual(R.rivals, { ACM: ["hedge_co", "acme_rival_src"] });
  assert.deepEqual(R.key_accounts, { SYN: [{ name: "Acme Stores", kind: "customer" }], ACM: [] });
  assert.ok(warnings.some((w) => /ZZZ/.test(w)));
  const bad = buildRelations({ peers: [{ key: "k", name: "K", reads_through: [{ ticker: "SYN", direction: "?" }] }], keyAccounts: {}, rivals: {}, tickers: ["SYN"] });
  assert.deepEqual(bad.relations.peers.k.reads, []);
  assert.ok(bad.warnings.some((w) => /direction/.test(w)));
});

// --- R3 -----------------------------------------------------------------------------------------
test("R3: RELATIONS_VERSION follows the three files and the covered ticker list, not line endings", () => {
  const base = { peersText: "[1]", keyAccountsText: "{}", rivalsText: "{}", tickers: ["SYN", "ACM"] };
  const v = relationsVersion(base);
  assert.match(v, /^rel-[0-9a-f]{12}$/);
  assert.equal(relationsVersion({ ...base }), v);
  assert.notEqual(relationsVersion({ ...base, tickers: ["SYN"] }), v, "ticker list");
  assert.notEqual(relationsVersion({ ...base, tickers: ["ACM", "SYN"] }), v, "ticker order");
  assert.notEqual(relationsVersion({ ...base, peersText: "[2]" }), v, "peers.json");
  assert.notEqual(relationsVersion({ ...base, keyAccountsText: "{ }" }), v, "key-accounts.json");
  assert.notEqual(relationsVersion({ ...base, rivalsText: "{ }" }), v, "rivals.json");
  assert.equal(relationsVersion({ ...base, peersText: "[\r\n1]" }), relationsVersion({ ...base, peersText: "[\n1]" }), "CRLF = LF");
  // Moving text between files changes the version (the parts are separated).
  assert.notEqual(relationsVersion({ ...base, peersText: "[1]{}", keyAccountsText: "" }), v);
});

test("R3: a sync that changes the covered tickers changes the generated version", () => withRoot(synFiles(), (root) => {
  const a = generate(root).version;
  writeFileSync(join(root, "worker", "src", "covered.json"), JSON.stringify({ ...synCovered, tickers: ["SYN", "ACM"] }));
  assert.notEqual(generate(root).version, a);
}));

// --- R4 -----------------------------------------------------------------------------------------
test("R4: peer and key-account counts equal the input files'; every direction is -, + or ±", () => {
  const covered = new Set(COVERED.tickers);
  assert.equal(Object.keys(GEN.RELATIONS.peers).length, new Set(PEERS.map((p) => p.key)).size);
  for (const [t, list] of Object.entries(KEY_ACCOUNTS)) {
    if (!Array.isArray(list) || !covered.has(t)) continue;
    assert.equal(GEN.RELATIONS.key_accounts[t]?.length, list.length, t);
  }
  for (const t of Object.keys(GEN.RELATIONS.key_accounts)) assert.ok(covered.has(t), t);
  for (const p of PEERS) {
    const want = (p.reads_through || []).filter((r) => covered.has(r.ticker)).length;
    assert.equal(GEN.RELATIONS.peers[p.key].reads.length, want, p.key);
  }
  for (const [t, list] of Object.entries(RIVALS)) if (covered.has(t)) assert.equal(GEN.RELATIONS.rivals[t].length, new Set(list.map((r) => r.key)).size, t);
  assert.deepEqual(DIRECTIONS, ["-", "+", "±"]);
  for (const p of Object.values(GEN.RELATIONS.peers)) for (const r of p.reads) assert.ok(DIRECTIONS.includes(r.direction), r.direction);
  for (const m of Object.values(loadRelations().peerMap())) for (const d of Object.values(m)) assert.ok(DIRECTIONS.includes(d), d);
});

// --- R5 -----------------------------------------------------------------------------------------
test("R5: on the bundled maps competitorsOf(T) holds every peer reading through T, every rivals.json entity and every counterparty rival", () => {
  const rel = loadRelations();
  const entityOf = (k) => (own(AUX.sources, k) && AUX.sources[k].entity) || k;
  assert.deepEqual(rel.tickers, COVERED.tickers);
  for (const t of COVERED.tickers) {
    const c = rel.competitorsOf(t);
    for (const p of PEERS) {
      const link = (p.reads_through || []).find((r) => r.ticker === t);
      if (!link) continue;
      assert.ok(c.has(p.key), `${t} ${p.key}`);
      assert.ok(c.get(p.key).via.includes("peers"));
      assert.equal(c.get(p.key).direction, String(link.direction).replace(/−/g, "-"), `${t} ${p.key} takes the peer sign`);
    }
    for (const r of RIVALS[t] || []) assert.ok(c.get(entityOf(r.key))?.via.includes("rivals"), `${t} ${r.key}`);
    for (const [k, cp] of Object.entries(COVERED.counterparty)) {
      if (cp.role === "rival" && cp.affects.includes(t)) assert.ok(c.get(entityOf(k))?.via.includes("counterparty"), `${t} ${k}`);
    }
    for (const [entity, e] of c) {
      assert.ok(DIRECTIONS.includes(e.direction));
      assert.equal(typeof e.name, "string");
      assert.equal(e.watched, Object.values(AUX.sources).some((s) => s.entity === entity), entity);
      assert.ok(rel.tickersOfEntity(entity).some((x) => x.ticker === t && x.direction === e.direction));
    }
  }
});

test("R5: every counterparty key of every role is an aux source, and sourceClass calls it twin:<role>", () => {
  const rel = loadRelations();
  const keys = Object.keys(COVERED.counterparty);
  assert.ok(keys.length > 0);
  for (const k of keys) {
    assert.ok(own(AUX.sources, k), `counterparty key ${k} has no aux entry`);
    assert.equal(rel.sourceClass(k), `twin:${COVERED.counterparty[k].role}`, k);
  }
});

test("R5: synthetic direction rule: the peer sign wins (± kept), else -; via lists every source", () => {
  const rel = syn();
  const acm = rel.competitorsOf("ACM");
  assert.deepEqual(acm.get("hedge_co"), { name: "Hedge Co", status: "public", direction: "±", via: ["peers", "rivals"], watched: true });
  assert.deepEqual(acm.get("acme_rival"), { name: "Acme Rival news", status: "private", direction: "-", via: ["rivals"], watched: true }, "a rivals.json source key resolves to its entity");
  assert.deepEqual([...acm.keys()], ["hedge_co", "acme_rival"]);
  const s = rel.competitorsOf("SYN");
  assert.deepEqual([...s.keys()], ["widget_corp", "plus_co", "rival_x"]);
  assert.equal(s.get("widget_corp").direction, "-");
  assert.equal(s.get("plus_co").direction, "+");
  assert.equal(s.get("plus_co").watched, false, "no aux source has that entity");
  assert.deepEqual(s.get("rival_x"), { name: "Rival X", status: "private", direction: "-", via: ["counterparty"], watched: true });
  assert.equal(rel.competitorsOf("NOR").size, 0);
  assert.equal(rel.competitorsOf("ZZZ").size, 0);
  // A copy: mutating the result does not change the module's state.
  s.get("widget_corp").via.push("x");
  s.delete("plus_co");
  assert.deepEqual(rel.competitorsOf("SYN").get("widget_corp").via, ["peers"]);
  assert.ok(rel.competitorsOf("SYN").has("plus_co"));
});

test("R5: peerMap is the inverse of competitorsOf and tickersOfEntity lists it", () => {
  const rel = syn();
  assert.deepEqual(rel.peerMap(), {
    widget_corp: { SYN: "-" }, plus_co: { SYN: "+" }, rival_x: { SYN: "-" }, hedge_co: { ACM: "±" }, acme_rival: { ACM: "-" },
  });
  assert.deepEqual(rel.tickersOfEntity("hedge_co"), [{ ticker: "ACM", direction: "±" }]);
  assert.deepEqual(rel.tickersOfEntity("quiet_co"), []);
  assert.deepEqual(rel.tickersOfEntity("nobody"), []);
  const m = rel.peerMap();
  m.widget_corp.SYN = "+";
  assert.equal(rel.peerMap().widget_corp.SYN, "-", "peerMap returns a copy");
  // Bundled: the same inverse relation.
  const real = loadRelations();
  for (const [entity, byT] of Object.entries(real.peerMap())) {
    for (const [t, d] of Object.entries(byT)) assert.equal(real.competitorsOf(t).get(entity)?.direction, d, `${entity} ${t}`);
    assert.deepEqual(real.tickersOfEntity(entity), Object.entries(byT).map(([ticker, direction]) => ({ ticker, direction })));
  }
});

// --- R6 -----------------------------------------------------------------------------------------
test("R6: rivalSourceCount counts distinct counterparty rival keys plus rivals.json keys", () => {
  const rel = syn();
  assert.equal(rel.rivalSourceCount("NOR"), 0, "no rivals list and no counterparty rival");
  assert.equal(rel.rivalSourceCount("SYN"), 1);
  assert.equal(rel.rivalSourceCount("ACM"), 2);
  assert.equal(rel.rivalSourceCount("ZZZ"), 0);
  const real = loadRelations();
  for (const t of COVERED.tickers) {
    const keys = new Set([...(RIVALS[t] || []).map((r) => r.key),
      ...Object.entries(COVERED.counterparty).filter(([, cp]) => cp.role === "rival" && cp.affects.includes(t)).map(([k]) => k)]);
    assert.equal(real.rivalSourceCount(t), keys.size, t);
  }
});

// --- R7 -----------------------------------------------------------------------------------------
test("R7: keyAccountIn and companyIn use phraseRegex word bounds and return the matched phrase", () => {
  const rel = syn();
  assert.equal(rel.keyAccountIn("SYN", "Acme Stores signs a deal"), "Acme Stores");
  assert.equal(rel.keyAccountIn("SYN", "acme stores signs"), "acme stores", "case-insensitive");
  assert.equal(rel.keyAccountIn("SYN", "Acme Storesmart opens"), null);
  assert.equal(rel.companyIn("SYN", "Synco wins"), "Synco");
  assert.equal(rel.companyIn("SYN", "Syncopation wins"), null);
  assert.equal(rel.keyAccountIn("ACM", "Acme Stores signs"), null, "no accounts");
  assert.equal(rel.keyAccountIn("ZZZ", "anything"), null, "unknown ticker");
  assert.equal(rel.companyIn("SYN", null), null);
  assert.deepEqual(rel.keyAccountsOf("SYN"), [{ name: "Acme Stores", kind: "customer" }]);
  assert.deepEqual(rel.keyAccountsOf("ACM"), []);
  assert.deepEqual(rel.keyAccountsOf("NOR"), []);
  // Bundled: keyAccountsOf is the generated list.
  const real = loadRelations();
  for (const t of COVERED.tickers) {
    assert.deepEqual(real.keyAccountsOf(t), GEN.RELATIONS.key_accounts[t] || []);
  }
});

test("industryLinksOf reads INDUSTRY; empty when no links are declared", () => {
  const rel = syn({ industry: { SYN: { area_x: { core: true }, area_y: { core: false } } } });
  assert.deepEqual(rel.industryLinksOf("SYN"), [{ id: "area_x", core: true }, { id: "area_y", core: false }]);
  assert.deepEqual(rel.industryLinksOf("ACM"), []);
  assert.deepEqual(syn().industryLinksOf("SYN"), []);
  const real = loadRelations();
  for (const t of COVERED.tickers) assert.ok(Array.isArray(real.industryLinksOf(t)));
});

// --- R8 -----------------------------------------------------------------------------------------
test("R8: sourceClass on synthetic maps", () => {
  const rel = syn();
  assert.equal(rel.sourceClass("edgar_x"), "sec_feed");
  assert.equal(rel.sourceClass("widget_sec"), "sec_feed");
  assert.equal(rel.sourceClass("city_council"), "register");
  assert.equal(rel.sourceClass("state_register"), "register");
  assert.equal(rel.sourceClass("synco_sec"), "register", "a covered record key is a record source");
  assert.equal(rel.sourceClass("rival_x"), "twin:rival");
  assert.equal(rel.sourceClass("prog_z"), "twin:program", "a twin wins over record");
  assert.equal(rel.sourceClass("cust_y"), "twin:customer");
  assert.equal(rel.sourceClass("widget_corp"), null);
  assert.equal(rel.sourceClass("managed_widget_corp_news"), null);
  assert.equal(rel.sourceClass(""), null);
  assert.equal(rel.sourceClass(null), null);
  // The record test is the injected isRecordSource (records.js in production).
  const seen = [];
  const spy = syn({ isRecordSource: (k) => (seen.push(k), false) });
  assert.equal(spy.sourceClass("city_council"), null);
  assert.deepEqual(seen, ["city_council"]);
});

test("R8: sourceClass on the bundled maps uses records.js isRecordSource; one isRecordSource in worker/src", () => {
  const rel = loadRelations();
  assert.equal(rel.sourceClass("edgar_x"), "sec_feed");
  for (const [k, a] of Object.entries(AUX.sources)) {
    if (own(COVERED.counterparty, k)) continue;
    if (a.sec === true) assert.equal(rel.sourceClass(k), "sec_feed", k);
    else if (k.startsWith("edgar_")) assert.equal(rel.sourceClass(k), "sec_feed", k);
    else if (a.record === true) assert.equal(rel.sourceClass(k), "register", k);
    else assert.equal(rel.sourceClass(k), isRecordSource(k) ? "register" : null, k);
  }
  for (const k of COVERED.records || []) if (!own(COVERED.counterparty, k) && !k.startsWith("edgar_") && AUX.sources[k]?.sec !== true) assert.equal(rel.sourceClass(k), "register", k);
  const defs = readdirSync(SRC).filter((f) => f.endsWith(".js"))
    .flatMap((f) => [...readFileSync(new URL(f, SRC), "utf8").matchAll(/export const isRecordSource\b/g)].map(() => f));
  assert.deepEqual(defs, ["records.js"]);
});

// --- R9 -----------------------------------------------------------------------------------------
test("R9: relations.js imports only its six modules, never names CANDIDATE_ or NEWS, makes no fetch and reaches no Discord file", () => {
  const text = readFileSync(new URL("relations.js", SRC), "utf8");
  const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./aux-sources.json", "./covered.json", "./lib.js", "./records.js", "./relations.generated.js", "./rubric.generated.js"]);
  assert.doesNotMatch(text, /CANDIDATE_/);
  assert.doesNotMatch(text, /\bNEWS\b/);
  assert.doesNotMatch(text, /\bfetch\(/);
  assert.doesNotMatch(text, /\benv\./);
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) walk(m[1]);
  };
  walk("relations.js");
  for (const bad of ["delivery.js", "discord.js", "brief.js", "ingest.js", "excerpt.js", "tuning.js", "auxiliary.js", "index.js"]) {
    assert.ok(!seen.has(bad), `relations.js reaches ${bad}`);
  }
  const genText = readFileSync(new URL("relations.generated.js", SRC), "utf8");
  assert.doesNotMatch(genText, /^\s*import\s/m, "the generated file imports nothing");
});

test("R9: relations.js is imported by no other Worker module yet (PR-CV1 ships no deploy)", () => {
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js") && f !== "relations.js")) {
    const text = readFileSync(new URL(f, SRC), "utf8");
    assert.doesNotMatch(text, /from\s+"\.\/relations(\.generated)?\.js"/, f);
  }
});

test("loadRelations: built once per isolate without deps; deps builds a fresh object; awaitable", async () => {
  const a = loadRelations();
  assert.equal(loadRelations(), a);
  assert.equal(await loadRelations(), a);
  assert.notEqual(syn(), syn());
  assert.equal(a.basis, "files");
  assert.equal(a.version, GEN.RELATIONS_VERSION);
  assert.equal(syn().version, "rel-test");
});

// --- The placement rule (pure; one case per table row) -------------------------------------------
test("placeAux: 1a-1c counterparty twins follow their role", () => {
  const rel = syn();
  assert.deepEqual(rel.placeAux({ source_key: "rival_x", entity_key: "rival_x", status: "private" }), { competitors: ["SYN"], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "prog_z", entity_key: "prog_z", status: "program", affects: "SYN,ACM" }), { competitors: [], industry: true });
  // A customer twin whose entity is a peer of ACM is still neither (the key-accounts section owns it).
  for (const key of ["cust_y", "rel_w", "idx_v"]) {
    const a = synAux.sources[key];
    assert.deepEqual(rel.placeAux({ source_key: key, entity_key: a.entity, status: a.status, coverage_subject: a.coverage_subject ? 1 : 0,
      reads_through: JSON.stringify([{ ticker: "ACM", direction: "-" }]) }), { competitors: [], industry: false }, key);
  }
});

test("placeAux: 2 program or register rows go to Industry, not Competitors", () => {
  const rel = syn();
  assert.deepEqual(rel.placeAux({ source_key: "city_council", entity_key: "city_council", status: "program", affects: "SYN" }), { competitors: [], industry: true });
  assert.deepEqual(rel.placeAux({ source_key: "state_register", entity_key: "state_register", status: "public",
    reads_through: [{ ticker: "SYN", direction: "-" }] }), { competitors: [], industry: true });
  assert.deepEqual(rel.placeAux({ source_key: "managed_some_agency", entity_key: "some_agency", status: "program" }), { competitors: [], industry: true });
});

test("placeAux: 3 a competitor's SEC feed goes to Competitors; a non-competitor's edgar_* to neither", () => {
  const rel = syn();
  assert.deepEqual(rel.placeAux({ source_key: "widget_sec", entity_key: "widget_corp", status: "public" }), { competitors: ["SYN"], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "edgar_widget_corp", entity_key: "widget_corp", status: "unknown" }), { competitors: ["SYN"], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "gizmo_sec", entity_key: "gizmo_inc", status: "public" }), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "edgar_gizmo", entity_key: "gizmo", status: "unknown" }), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "edgar_gizmo", entity_key: "gizmo", status: "unknown",
    reads_through: '[{"ticker":"ACM","direction":"+"}]' }), { competitors: ["ACM"], industry: false }, "a read-through names ACM");
});

test("placeAux: 4 competitor entities and read-throughs; uncovered read-through tickers dropped", () => {
  const rel = syn();
  assert.deepEqual(rel.placeAux({ source_key: "widget_corp", entity_key: "widget_corp", status: "private" }), { competitors: ["SYN"], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "managed_hedge_co_news", entity_key: "hedge_co", status: "public" }), { competitors: ["ACM"], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "widget_corp", entity_key: "widget_corp", status: "private",
    reads_through: '[{"ticker":"ACM","direction":"±"},{"ticker":"ZZZ","direction":"-"}]' }), { competitors: ["SYN", "ACM"], industry: false }, "covered-ticker order");
  assert.deepEqual(rel.placeAux({ source_key: "ia_media_robots", entity_key: "media_robots", status: "media",
    reads_through: [{ ticker: "SYN", direction: "-" }] }), { competitors: ["SYN"], industry: false }, "media with a read-through");
  assert.deepEqual(rel.placeAux({ source_key: "unknown_src", entity_key: "unknown_src", status: "unknown",
    reads_through: '[{"ticker":"SYN","direction":"-"}]' }), { competitors: ["SYN"], industry: false }, "unknown with a read-through");
  assert.deepEqual(rel.placeAux({ source_key: "unknown_src", entity_key: "unknown_src", status: "unknown",
    reads_through: '[{"ticker":"ZZZ","direction":"-"}]' }), { competitors: [], industry: false }, "an uncovered read-through ticker is dropped");
  assert.deepEqual(rel.placeAux({ source_key: "x", entity_key: "x", status: "public", reads: ["ACM"] }), { competitors: ["ACM"], industry: false }, "a normalised reads list");
});

test("placeAux: 5 plain media goes to Industry; 6 everything else to neither; malformed input never throws", () => {
  const rel = syn();
  assert.deepEqual(rel.placeAux({ source_key: "ia_media_robots", entity_key: "media_robots", status: "media" }), { competitors: [], industry: true });
  assert.deepEqual(rel.placeAux({ source_key: "ia_media_robots", entity_key: "media_robots", status: "media", affects: "SYN" }), { competitors: [], industry: true });
  assert.deepEqual(rel.placeAux({ source_key: "syn_filter", entity_key: "syn_filter", status: "media", coverage_subject: 1, affects: "SYN" }),
    { competitors: [], industry: false }, "a coverage-subject filter is neither");
  assert.deepEqual(rel.placeAux({ source_key: "unknown_src", entity_key: "unknown_src", status: "unknown" }), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "some_co", entity_key: "some_co", status: "public" }), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "some_co", entity_key: "some_co", status: "private", reads_through: "{not json" }), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux({ source_key: "some_co", reads_through: '{"ticker":"SYN"}' }), { competitors: [], industry: false }, "not a list");
  assert.deepEqual(rel.placeAux({}), { competitors: [], industry: false });
  assert.deepEqual(rel.placeAux(null), { competitors: [], industry: false });
  // The entity falls back to the source's aux entity when the row has none.
  assert.deepEqual(rel.placeAux({ source_key: "widget_corp", status: "private" }), { competitors: ["SYN"], industry: false });
});

test("rivalTickers: the one rivals rule for coverage and aux rows", () => {
  const rel = syn();
  assert.deepEqual(rel.rivalTickers({ role: "rival", ticker: "SYN", grade_ticker: "ACM" }, "coverage"), ["ACM"], "the grade ticker");
  assert.deepEqual(rel.rivalTickers({ role: "rival", ticker: "SYN" }, "coverage"), ["SYN"]);
  assert.deepEqual(rel.rivalTickers({ role: "program", ticker: "SYN" }, "coverage"), []);
  assert.deepEqual(rel.rivalTickers({ role: "rival", ticker: "ZZZ" }, "coverage"), [], "outside the universe");
  const rows = [
    { source_key: "rival_x", entity_key: "rival_x", status: "private" },
    { source_key: "cust_y", entity_key: "hedge_co", status: "public", coverage_subject: 1 },
    { source_key: "widget_sec", entity_key: "widget_corp", status: "public" },
    { source_key: "city_council", entity_key: "city_council", status: "program" },
  ];
  for (const row of rows) assert.deepEqual(rel.rivalTickers(row, "aux"), rel.placeAux(row).competitors);
  assert.throws(() => rel.rivalTickers(rows[0]), /pipeline/);
});

test("placeAux on the bundled maps: every counterparty twin follows its role; every result is in the universe", () => {
  const rel = loadRelations();
  const universe = new Set(COVERED.tickers);
  for (const [k, cp] of Object.entries(COVERED.counterparty)) {
    const a = AUX.sources[k];
    const p = rel.placeAux({ source_key: k, entity_key: a.entity, status: a.status, coverage_subject: a.coverage_subject ? 1 : 0, affects: (a.affects || []).join(",") });
    if (cp.role === "rival") assert.deepEqual(p, { competitors: COVERED.tickers.filter((t) => cp.affects.includes(t)), industry: false }, k);
    else assert.deepEqual(p, { competitors: [], industry: cp.role === "program" }, k);
  }
  for (const [k, a] of Object.entries(AUX.sources)) {
    const p = rel.placeAux({ source_key: k, entity_key: a.entity, status: a.status, coverage_subject: a.coverage_subject ? 1 : 0 });
    for (const t of p.competitors) assert.ok(universe.has(t), `${k} ${t}`);
    assert.ok(!(p.competitors.length && p.industry), `${k} is in both views`);
  }
});
