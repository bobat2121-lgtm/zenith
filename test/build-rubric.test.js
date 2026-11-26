// scripts/build-rubric.mjs bundles the auxiliary rubric as AUX_RUBRIC with its
// own content hash, AUX_RUBRIC_VERSION, and leaves RUBRIC_VERSION alone: the
// coverage rubric's version never moves because of the auxiliary one. Without
// the file both are null (GET /v1/rubric/aux answers 503).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRubric, versionOf } from "../scripts/rubric-hash.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/build-rubric.mjs", import.meta.url));
const SHEET = "---\nbase_usd: 100000000\ntiny_usd: 100000\nthesis_drivers: [a]\nopen_items: []\nterms: [Symbotic]\n---\n# SYM\n";

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "zenith-rubric-"));
  mkdirSync(join(root, "rubric", "companies"), { recursive: true });
  mkdirSync(join(root, "worker", "src"), { recursive: true });
  writeFileSync(join(root, "rubric", "core.md"), "# Core rubric\n");
  writeFileSync(join(root, "rubric", "peers.md"), "# Peers\n");
  writeFileSync(join(root, "rubric", "companies", "SYM.md"), SHEET);
  writeFileSync(join(root, "worker", "src", "covered.json"), JSON.stringify({ tickers: ["SYM"], sources: {}, counterparty: {} }));
  return root;
}
// Runs the build and reads the generated constants (one JSON value per line).
function build(root) {
  const log = execFileSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: "utf8" });
  const out = { log };
  for (const m of readFileSync(join(root, "worker", "src", "rubric.generated.js"), "utf8").matchAll(/^export const (\w+) = (.*);$/gm)) out[m[1]] = JSON.parse(m[2]);
  return out;
}
const hash = (text) => "a-" + createHash("sha256").update(text).digest("hex").slice(0, 12);

test("the aux rubric has its own version; RUBRIC_VERSION never moves because of it", () => {
  const root = tempRoot();
  try {
    const none = build(root);
    assert.match(none.RUBRIC_VERSION, /^r-[0-9a-f]{12}$/);
    assert.deepEqual([none.AUX_RUBRIC, none.AUX_RUBRIC_VERSION], [null, null]);
    assert.match(none.log, /aux rubric: none/);
    assert.deepEqual(Object.keys(none.COMPANIES), ["SYM"]);

    const text = "# Auxiliary names rubric\n\nMateriality to the named company.\n";
    writeFileSync(join(root, "rubric", "aux-rubric.md"), text);
    const one = build(root);
    assert.deepEqual([one.AUX_RUBRIC, one.AUX_RUBRIC_VERSION, one.RUBRIC_VERSION], [text, hash(text), none.RUBRIC_VERSION]);
    assert.match(one.log, new RegExp(`aux rubric ${hash(text)}: rubric/aux-rubric.md`));

    writeFileSync(join(root, "rubric", "aux-rubric.md"), text + "One more line.\n");
    const two = build(root);
    assert.notEqual(two.AUX_RUBRIC_VERSION, one.AUX_RUBRIC_VERSION);
    assert.equal(two.RUBRIC_VERSION, none.RUBRIC_VERSION);

    // Editing the coverage rubric moves RUBRIC_VERSION only.
    writeFileSync(join(root, "rubric", "core.md"), "# Core rubric v2\n");
    const three = build(root);
    assert.notEqual(three.RUBRIC_VERSION, none.RUBRIC_VERSION);
    assert.equal(three.AUX_RUBRIC_VERSION, two.AUX_RUBRIC_VERSION);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the aux rubric may be named auxiliary.md (Git for Windows cannot add aux.md); aux-rubric.md wins when both exist", () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, "rubric", "auxiliary.md"), "# B\n");
    assert.deepEqual([build(root).AUX_RUBRIC, build(root).AUX_RUBRIC_VERSION], ["# B\n", hash("# B\n")]);
    writeFileSync(join(root, "rubric", "aux-rubric.md"), "# A\n");
    const both = build(root);
    assert.equal(both.AUX_RUBRIC, "# A\n");
    assert.match(both.log, /WARNING several auxiliary rubrics \(aux-rubric\.md, auxiliary\.md\); using rubric\/aux-rubric\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the committed rubric.generated.js carries the aux constants", async () => {
  const gen = await import("../worker/src/rubric.generated.js");
  assert.ok("AUX_RUBRIC" in gen && "AUX_RUBRIC_VERSION" in gen);
  if (gen.AUX_RUBRIC) assert.equal(gen.AUX_RUBRIC_VERSION, hash(gen.AUX_RUBRIC));
  else assert.equal(gen.AUX_RUBRIC_VERSION, null);
});

test("COVERED_NAMES: the sheet's name: or, without one, its first terms entry, plus key-accounts company_names, never other terms", () => {
  const root = tempRoot();
  try {
    const before = build(root);
    assert.deepEqual(before.COVERED_NAMES, { SYM: ["Symbotic"] }, "no name: line, so the first terms entry");
    writeFileSync(join(root, "rubric", "companies", "SYM.md"), SHEET.replace("---\nbase_usd", "---\nname: Symbotic Inc.\nbase_usd"));
    writeFileSync(join(root, "rubric", "key-accounts.json"), JSON.stringify({ company_names: { SYM: ["Symbotic", "GreenBox"] } }));
    const named = build(root);
    assert.deepEqual(named.COVERED_NAMES, { SYM: ["Symbotic Inc.", "Symbotic", "GreenBox"] });
    assert.ok(!named.COVERED_NAMES.SYM.includes("BreakPack"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Phase 2, golden-set replay: the candidate overlay (rubric/candidate/) ---------------------
// Synthetic rubric only. T1, T1b and T1c of the replay harness.
const CORE_FLOORS = "# Core rubric\n\n## 6. Event floors\n\n| Floor | When | Score |\n|---|---|---|\n| `calendar` | a dated notice | 75 fixed |\n\n## 7. Next\n";
const LINK = "industry_links:\n  - {id: rules_y, kind: regulator, area: \"synthetic rules\", actors: \"Agency\", core: true}";
const SHEET2 = (extra = "", body = "# SYM\n\n## Notes\nPlain text.\n") =>
  `---\nbase_usd: 100000000\ntiny_usd: 100000\nthesis_drivers: [a]\nopen_items: []\nterms: [Symbotic]\naliases: [SYM Co]${extra ? "\n" + extra : ""}\n---\n${body}`;
function overlayRoot() {
  const root = tempRoot();
  writeFileSync(join(root, "rubric", "core.md"), CORE_FLOORS);
  writeFileSync(join(root, "rubric", "companies", "SYM.md"), SHEET2());
  writeFileSync(join(root, "rubric", "key-accounts.json"), JSON.stringify({ SYM: [{ name: "Acme", terms: ["Acme Stores"] }] }));
  return root;
}
const cand = (root, ...p) => join(root, "rubric", "candidate", ...p);
function putOverlay(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(cand(root, rel)), { recursive: true });
    writeFileSync(cand(root, rel), text);
  }
}
const runScript = (root, ...flags) => spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...flags], { encoding: "utf8" });
function withRoot(fn) {
  const root = overlayRoot();
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("T1: no overlay gives null CANDIDATE_* and INDUSTRY {}; rubric-hash.mjs gives the generated version, CRLF included", () => withRoot((root) => {
  const none = build(root);
  assert.deepEqual([none.CANDIDATE_VERSION, none.CANDIDATE_FLOORS, none.CANDIDATE_INDUSTRY, none.CANDIDATE_SCOPE], [null, null, null, null]);
  assert.deepEqual(none.INDUSTRY, {});
  assert.equal(versionOf(loadRubric(root)), none.RUBRIC_VERSION);
  const crlf = mkdtempSync(join(tmpdir(), "zenith-crlf-"));
  try {
    cpSync(root, crlf, { recursive: true });
    for (const f of ["core.md", "peers.md", join("companies", "SYM.md")]) {
      const p = join(crlf, "rubric", f);
      writeFileSync(p, readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
    }
    assert.equal(versionOf(loadRubric(crlf)), none.RUBRIC_VERSION, "a CRLF checkout hashes the same");
  } finally {
    rmSync(crlf, { recursive: true, force: true });
  }
}));

test("T1: the committed rubric.generated.js matches rubric-hash.mjs on the repo's rubric, and bundles a candidate only with rubric/candidate/", async () => {
  const gen = await import("../worker/src/rubric.generated.js");
  const repo = fileURLToPath(new URL("..", import.meta.url));
  assert.equal(versionOf(loadRubric(repo)), gen.RUBRIC_VERSION);
  assert.deepEqual(gen.INDUSTRY, {});
  if (existsSync(join(repo, "rubric", "candidate"))) {
    assert.equal(gen.CANDIDATE_VERSION, versionOf(loadRubric(repo, { overlay: true })));
    assert.notEqual(gen.CANDIDATE_VERSION, gen.RUBRIC_VERSION);
  } else {
    assert.deepEqual([gen.CANDIDATE_VERSION, gen.CANDIDATE_FLOORS, gen.CANDIDATE_INDUSTRY, gen.CANDIDATE_SCOPE], [null, null, null, null]);
  }
});

test("T1: an overlay adds CANDIDATE_VERSION and floors, leaves RUBRIC_VERSION alone, and --promote-candidate makes it live", () => withRoot((root) => {
  const before = build(root);
  putOverlay(root, { "core.md": CORE_FLOORS.replace("## 7. Next", "## 7. Next\n\nA candidate line.") });
  assert.equal(runScript(root, "--rebase-candidate").status, 0);
  const base = JSON.parse(readFileSync(cand(root, "BASE.json"), "utf8"));
  assert.deepEqual(Object.keys(base.live).sort(), ["companies/SYM.md", "core.md", "key-accounts.json", "peers.md"]);
  const one = build(root);
  assert.equal(one.RUBRIC_VERSION, before.RUBRIC_VERSION, "the live version never moves for an overlay");
  assert.notEqual(one.CANDIDATE_VERSION, one.RUBRIC_VERSION);
  assert.equal(one.CANDIDATE_VERSION, versionOf(loadRubric(root, { overlay: true })));
  assert.deepEqual(one.CANDIDATE_FLOORS, { calendar: { floor: 75, fixed: true, undisclosed: null } });
  assert.deepEqual(one.CANDIDATE_SCOPE, { scope: "full", tickers: [] });
  assert.equal(one.CORE, CORE_FLOORS, "the candidate text is not bundled");
  assert.equal(runScript(root, "--strict").status, 0);
  const promoted = runScript(root, "--promote-candidate", "--strict");
  assert.equal(promoted.status, 0, promoted.stdout);
  assert.equal(existsSync(cand(root)), false, "rubric/candidate/ is deleted");
  const after = build(root);
  assert.equal(after.RUBRIC_VERSION, one.CANDIDATE_VERSION);
  assert.equal(after.CANDIDATE_VERSION, null);
}));

test("T1b: a live edit after BASE.json fails --strict until --rebase-candidate, which re-applies industry_links", () => withRoot((root) => {
  putOverlay(root, { "companies/SYM.md": SHEET2(LINK) });
  assert.equal(runScript(root, "--rebase-candidate").status, 0);
  const one = build(root);
  assert.equal(runScript(root, "--strict").status, 0);
  writeFileSync(join(root, "rubric", "companies", "SYM.md"), SHEET2("", "# SYM\n\n## Notes\nPlain text, edited live.\n"));
  const drift = runScript(root, "--strict");
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /live rubric\/companies\/SYM\.md changed after the overlay was cut/);
  assert.equal(runScript(root, "--rebase-candidate", "--strict").status, 0);
  const merged = readFileSync(cand(root, "companies", "SYM.md"), "utf8");
  assert.match(merged, /edited live/);
  assert.match(merged, /industry_links:\n  - \{id: rules_y/);
  assert.notEqual(build(root).CANDIDATE_VERSION, one.CANDIDATE_VERSION);
  // key-accounts.json is a hash input (MATCH): changing it fails until rebased.
  writeFileSync(join(root, "rubric", "key-accounts.json"), JSON.stringify({ SYM: [{ name: "Acme", terms: ["Acme Stores", "Acme Depot"] }] }));
  assert.match(runScript(root, "--strict").stdout, /key-accounts\.json changed after the overlay was cut/);
  assert.equal(runScript(root, "--rebase-candidate", "--strict").status, 0);
}));

test("T1b: an undeclared sheet-body change, a stray overlay file and an overlay core.md on a moved live core are refused", () => withRoot((root) => {
  putOverlay(root, { "companies/SYM.md": SHEET2("", "# SYM\n\n## Notes\nA candidate body line.\n") });
  assert.equal(runScript(root, "--rebase-candidate").status, 0);
  const undeclared = runScript(root, "--strict");
  assert.equal(undeclared.status, 1);
  assert.match(undeclared.stdout, /SYM: the overlay sheet differs from the live sheet outside industry_links/);
  assert.equal(runScript(root, "--rebase-candidate", "--declare=SYM=body", "--strict").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(cand(root, "BASE.json"), "utf8")).declared, { SYM: "body" });
  putOverlay(root, { "notes.txt": "x" });
  assert.match(runScript(root, "--strict").stdout, /notes\.txt is not core\.md or companies/);
  rmSync(cand(root, "notes.txt"));
  putOverlay(root, { "core.md": CORE_FLOORS + "\nCandidate.\n" });
  assert.equal(runScript(root, "--rebase-candidate", "--strict").status, 0);
  writeFileSync(join(root, "rubric", "core.md"), CORE_FLOORS + "\nLive edit.\n");
  const refused = runScript(root, "--rebase-candidate");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /an overlay core\.md is never merged automatically/);
  assert.equal(runScript(root, "--rebase-candidate", "--core-reapplied", "--strict").status, 0);
}));

test("T1c: CANDIDATE_SCOPE is full for core, sheets for a body or industry_links change, guards for other front matter", () => withRoot((root) => {
  const scopeOf = (files, ...flags) => {
    rmSync(cand(root), { recursive: true, force: true });
    putOverlay(root, files);
    const r = runScript(root, "--rebase-candidate", "--strict", ...flags);
    assert.equal(r.status, 0, r.stdout);
    return build(root).CANDIDATE_SCOPE;
  };
  assert.deepEqual(scopeOf({ "core.md": CORE_FLOORS + "\nMore.\n" }), { scope: "full", tickers: [] });
  assert.deepEqual(scopeOf({ "companies/SYM.md": SHEET2("", "# SYM\n\n## Notes\nChanged.\n") }, "--declare=SYM=body"), { scope: "sheets", tickers: ["SYM"] });
  assert.deepEqual(scopeOf({ "companies/SYM.md": SHEET2(LINK) }), { scope: "sheets", tickers: ["SYM"] });
  assert.deepEqual(build(root).CANDIDATE_INDUSTRY, { SYM: { rules_y: { core: true } } });
  assert.deepEqual(build(root).INDUSTRY, {}, "the live INDUSTRY is untouched by the overlay");
  assert.deepEqual(scopeOf({ "companies/SYM.md": SHEET2().replace("aliases: [SYM Co]", "aliases: [SYM Co, Sym Inc]") }, "--declare=SYM=front_matter"),
    { scope: "guards", tickers: ["SYM"] });
}));
