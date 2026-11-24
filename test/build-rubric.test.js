// scripts/build-rubric.mjs bundles the auxiliary rubric as AUX_RUBRIC with its
// own content hash, AUX_RUBRIC_VERSION, and leaves RUBRIC_VERSION alone: the
// coverage rubric's version never moves because of the auxiliary one. Without
// the file both are null (GET /v1/rubric/aux answers 503).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
