// scripts/owner-marks.mjs: owner_marks is [] or a YAML list of
// {line, mark, overrides} flow maps (plans/round7-driver-coverage.md 4.1.2).
// Each entry must match a "## <line> (<mark>)" heading in its sheet, and
// scripts/build-rubric.mjs --strict fails when one does not.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOwnerMarks, checkOwnerMarks, validMark } from "../scripts/owner-marks.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/build-rubric.mjs", import.meta.url));
const COMPANIES = fileURLToPath(new URL("../rubric/companies/", import.meta.url));
const frontMatterOf = (md) => (/^---\n([\s\S]*?)\n---/.exec(md) || /```ya?ml\n([\s\S]*?)\n```/.exec(md))[1];

test("parse: [] (with a comment), a list of flow maps, and quoted commas", () => {
  assert.deepEqual(parseOwnerMarks("a: 1\nowner_marks: []   # none yet\nb: 2"), { marks: [], errors: [] });
  assert.equal(parseOwnerMarks("a: 1\nb: 2"), null, "no owner_marks key");
  const fm = 'x: 1\nowner_marks:\n  - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 1, core 9 and core 4.5"}\n  - {line: \'Other\', mark: "owner:2026-01-02", overrides: "a \\"quoted\\" rule"}\nnext: 2';
  assert.deepEqual(parseOwnerMarks(fm).marks, [
    { line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 1, core 9 and core 4.5" },
    { line: "Other", mark: "owner:2026-01-02", overrides: 'a "quoted" rule' },
  ]);
});

test("parse: old shapes and bad entries are errors", () => {
  assert.match(parseOwnerMarks("owner_marks: none   # old shape").errors[0], /must be \[\] or a list/);
  assert.match(parseOwnerMarks('owner_marks:\n  - {line: "A", mark: "owner:2026-11-24"}').errors[0], /lacks overrides/);
  assert.match(parseOwnerMarks('owner_marks:\n  - {line: "A", mark: "owner:2026-11-24", overrides: "x", by: "me"}').errors[0], /unknown keys by/);
  assert.match(parseOwnerMarks("owner_marks:\n  - Policy read-through").errors[0], /not a \{line, mark, overrides\} flow map/);
  assert.match(parseOwnerMarks("owner_marks:\nnext: 1").errors[0], /owner_marks is empty/);
  assert.match(parseOwnerMarks('owner_marks: []\n  - {line: "A", mark: "owner:2026-11-24", overrides: "x"}').errors[0], /followed by list entries/);
});

test("validMark: owner:YYYY-MM-DD with a real date only", () => {
  assert.ok(validMark("owner:2026-11-24"));
  for (const bad of ["owner:2026-13-01", "owner:2026-02-30", "owner:26-11-24", "owner 2026-11-24", "needs_owner", ""]) assert.ok(!validMark(bad), bad);
});

test("check: an entry needs its '## <line> (<mark>)' heading, and a marked heading needs its entry", () => {
  const fm = 'owner_marks:\n  - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "x"}';
  const md = (body) => `---\n${fm}\n---\n# T\n${body}`;
  assert.deepEqual(checkOwnerMarks(md("## Driver lines (owner:2026-11-24)\ntext\n"), fm), []);
  assert.match(checkOwnerMarks(md("## Driver lines (owner:2026-11-23)\n"), fm).join("\n"), /no "## Driver lines \(owner:2026-11-24\)" heading/);
  assert.match(checkOwnerMarks(md("## Driver lines\n"), fm)[0], /no "## Driver lines \(owner:2026-11-24\)" heading/);
  assert.match(checkOwnerMarks(md("### Driver lines (owner:2026-11-24)\n"), fm)[0], /no "## Driver/, "a ### heading is not the section");
  const badMark = 'owner_marks:\n  - {line: "Driver lines", mark: "owner:2026-11-31", overrides: "x"}';
  assert.match(checkOwnerMarks(`# T\n## Driver lines (owner:2026-11-31)\n`, badMark)[0], /is not owner:YYYY-MM-DD/);
  const orphan = checkOwnerMarks("# T\n## Policy read-through (owner:2026-11-24)\n", "owner_marks: []");
  assert.match(orphan[0], /carries an owner mark but owner_marks has no entry/);
  assert.match(checkOwnerMarks("# T\n", "owner_marks: none")[0], /must be \[\] or a list/);
});

test("GRRR's existing entry parses and matches its Policy read-through heading", () => {
  const md = readFileSync(join(COMPANIES, "GRRR.md"), "utf8");
  const { marks, errors } = parseOwnerMarks(frontMatterOf(md));
  assert.deepEqual(errors, []);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].line, "Policy read-through");
  assert.equal(marks[0].mark, "owner:2026-11-24");
  assert.match(marks[0].overrides, /core 1 out-of-scope rule for policy, the core 9 read-through boundary, the NVIDIA entity trap/);
  assert.deepEqual(checkOwnerMarks(md, frontMatterOf(md)), []);
});

test("every sheet's owner_marks is in the one format and matches its headings", () => {
  const withMarks = [];
  for (const f of readdirSync(COMPANIES).filter((f) => /^[A-Z]+\.md$/.test(f))) {
    const md = readFileSync(join(COMPANIES, f), "utf8");
    const fm = frontMatterOf(md);
    assert.deepEqual(checkOwnerMarks(md, fm), [], f);
    const parsed = parseOwnerMarks(fm);
    if (parsed) withMarks.push(f.replace(".md", ""));
    if (parsed?.marks.length) assert.doesNotMatch(fm, /no line in this sheet carries an owner:<date> mark/, `${f}: stale comment`);
  }
  for (const t of ["DPRO", "GRRR", "MBAI", "MRLN", "ONDS", "RCAT", "UMAC", "PUSA"]) assert.ok(withMarks.includes(t), `${t} has owner_marks`);
});

function tempRoot(sheet) {
  const root = mkdtempSync(join(tmpdir(), "zenith-marks-"));
  mkdirSync(join(root, "rubric", "companies"), { recursive: true });
  mkdirSync(join(root, "worker", "src"), { recursive: true });
  writeFileSync(join(root, "rubric", "core.md"), "# Core rubric\n");
  writeFileSync(join(root, "rubric", "companies", "SYM.md"), sheet);
  writeFileSync(join(root, "worker", "src", "covered.json"), JSON.stringify({ tickers: ["SYM"], sources: {}, counterparty: {} }));
  return root;
}
const SHEET = (marks, body) => `---\nbase_usd: 100000000\ntiny_usd: 100000\nthesis_drivers: [a]\nopen_items: []\nterms: [Symbotic]\n${marks}\n---\n# SYM\n${body}`;

test("build-rubric warns on a bad owner mark, and --strict fails on it", () => {
  const good = tempRoot(SHEET('owner_marks:\n  - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 9"}', "## Driver lines (owner:2026-11-24)\n"));
  const bad = tempRoot(SHEET('owner_marks:\n  - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 9"}', "## Driver lines (owner:2026-11-20)\n"));
  try {
    const ok = spawnSync(process.execPath, [SCRIPT, `--root=${good}`, "--strict"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout);
    assert.doesNotMatch(ok.stdout, /WARNING owner_marks/);
    const log = execFileSync(process.execPath, [SCRIPT, `--root=${bad}`], { encoding: "utf8" });
    assert.match(log, /WARNING owner_marks SYM: owner_marks "Driver lines": no "## Driver lines \(owner:2026-11-24\)" heading/);
    const strict = spawnSync(process.execPath, [SCRIPT, `--root=${bad}`, "--strict"], { encoding: "utf8" });
    assert.equal(strict.status, 1);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});
