// Phase 2, industry ladder (core.md section 9A). PR-C4 bundles it as a
// candidate overlay (rubric/candidate/): the live RUBRIC_VERSION and INDUSTRY
// stay as they were, and the candidate's industry_links reach normalizeGrade
// only through a candidate replay. PR-C5 runs build-rubric.mjs
// --promote-candidate, which writes the overlay over the live files and removes
// rubric/candidate/. Every case here holds in both states, so PR-C5 needs no
// edit to this file: the state is read from whether rubric/candidate/ exists.
// The normalizeGrade cases use a synthetic INDUSTRY map; the bundle cases read
// the repo's own rubric files, which are public.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hookJsonImports } from "./helpers/worker-env.js";
import { loadRubric, versionOf, frontMatter } from "../scripts/rubric-hash.mjs";
import { parseIndustryLinks, ownerSectionsEqual, INDUSTRY_KINDS } from "../scripts/owner-marks.mjs";
import { parseFloors } from "../worker/src/floors.js";

hookJsonImports();
const { normalizeGrade } = await import("../worker/src/lib.js");
const gen = await import("../worker/src/rubric.generated.js");

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(REPO, "scripts", "build-rubric.mjs");
const CAND = join(REPO, "rubric", "candidate");
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");
const LADDER_SHEETS = ["AUR", "KDK", "PL", "SATL", "SYM"];
const LADDER_INDUSTRY = {
  AUR: { av_truck_rules: { core: true } },
  KDK: { av_truck_rules: { core: true } },
  PL: { space_licensing: { core: true } },
  SATL: { space_licensing: { core: true } },
  SYM: { robotics_trade: { core: false } },
};
// Before promotion (PR-C4) the ladder lives in rubric/candidate/; after it (PR-C5) it is live.
const PROMOTED = !existsSync(CAND);
const LADDER_DIR = PROMOTED ? ["rubric"] : ["rubric", "candidate"];
const ladderIndustry = PROMOTED ? gen.INDUSTRY : gen.CANDIDATE_INDUSTRY;

// --- T12: normalizeGrade against a synthetic INDUSTRY map -----------------------------------------
const SYN_INDUSTRY = { SYN: { trade_x: { core: false }, rules_y: { core: true } } };
const synItem = { id: 7, ticker: "SYN", title: "A synthetic agency action", published: "2026-01-01T00:00:00Z", first_seen: "2026-01-01T01:00:00Z" };
const grade = (score, flag, itemId = "7") => ({ item_id: itemId, score, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material", flag] });

test("T12: an undeclared industry id is rejected; the ceiling is 69 without core and 74 with core", () => {
  const check = (score, flag) => normalizeGrade(grade(score, flag), synItem, null, ["SYN"], null, { industry: SYN_INDUSTRY });
  assert.match(check(50, "industry:nope").error, /unknown industry link nope for SYN \(core\.md section 9A\)/);
  assert.match(check(70, "industry:trade_x").error, /industry ladder ceiling/);
  assert.equal(check(69, "industry:trade_x").ok, true);
  assert.match(check(75, "industry:rules_y").error, /industry ladder ceiling/);
  assert.equal(check(74, "industry:rules_y").ok, true);
});

// --- The bundle: candidate bundled (PR-C4) or promoted (PR-C5) --------------------------------
test("RUBRIC_VERSION is the hash of the live files; INDUSTRY is {} before promotion and the ladder after it", () => {
  assert.equal(gen.RUBRIC_VERSION, versionOf(loadRubric(REPO)));
  assert.deepEqual(gen.INDUSTRY, PROMOTED ? LADDER_INDUSTRY : {});
  for (const t of LADDER_SHEETS) {
    assert.equal(/^industry_links:/m.test(frontMatter(read("rubric", "companies", `${t}.md`)) || ""), PROMOTED,
      `live ${t}.md declares industry_links only after promotion`);
  }
  assert.equal(read("rubric", "core.md").includes("## 9A."), PROMOTED, "live core.md has section 9A only after promotion");
});

test("the candidate is bundled with scope full, the five industry_links and unchanged floors, or nothing is after promotion", () => {
  if (PROMOTED) {
    assert.deepEqual([gen.CANDIDATE_VERSION, gen.CANDIDATE_FLOORS, gen.CANDIDATE_INDUSTRY, gen.CANDIDATE_SCOPE], [null, null, null, null]);
    return;
  }
  assert.equal(gen.CANDIDATE_VERSION, versionOf(loadRubric(REPO, { overlay: true })));
  assert.notEqual(gen.CANDIDATE_VERSION, gen.RUBRIC_VERSION);
  assert.deepEqual(gen.CANDIDATE_SCOPE, { scope: "full", tickers: [] }, "core.md changed, so the replay is full");
  assert.deepEqual(gen.CANDIDATE_INDUSTRY, LADDER_INDUSTRY);
  assert.deepEqual(gen.CANDIDATE_FLOORS, parseFloors(read("rubric", "core.md")), "the 9A edits leave every floor as it is");
});

test("each ladder sheet declares one filled-in industry_links entry; before promotion it is its live sheet plus that block", () => {
  const dropBlock = (md) => {
    const lines = md.split("\n");
    const at = lines.findIndex((l) => l.startsWith("industry_links:"));
    let j = at + 1;
    while (j < lines.length && /^\s/.test(lines[j])) j++;
    return lines.slice(0, at).concat(lines.slice(j)).join("\n");
  };
  if (!PROMOTED) assert.deepEqual(loadRubricOverlayNames().sort(), LADDER_SHEETS);
  for (const t of LADDER_SHEETS) {
    const sheet = read(...LADDER_DIR, "companies", `${t}.md`);
    if (!PROMOTED) {
      const live = read("rubric", "companies", `${t}.md`);
      assert.equal(dropBlock(sheet), live, `${t}: no change outside industry_links`);
      assert.deepEqual(ownerSectionsEqual(live, sheet, frontMatter), [], `${t}: owner sections`);
    }
    const parsed = parseIndustryLinks(frontMatter(sheet));
    assert.deepEqual(parsed.errors, [], `${t}: industry_links parse`);
    assert.equal(parsed.links.length, 1, `${t}: one entry`);
    const [link] = parsed.links;
    assert.ok(INDUSTRY_KINDS.includes(link.kind));
    assert.deepEqual({ [link.id]: { core: link.core === true } }, LADDER_INDUSTRY[t], `${t}: id and core`);
    assert.ok(link.area.length > 40 && link.actors.length > 2, `${t}: area and actors are filled in`);
  }
  if (!PROMOTED) assert.deepEqual(JSON.parse(read("rubric", "candidate", "BASE.json")).declared, {}, "no sheet body change is declared");
});
function loadRubricOverlayNames() {
  const dir = join(CAND, "companies");
  return existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.md$/, "")) : [];
}

test("the ladder core.md: section 9A sits between sections 9 and 10, and its ceilings match the API", () => {
  const core = read(...LADDER_DIR, "core.md");
  const heads = core.split("\n").filter((l) => /^## \d/.test(l)).map((l) => l.split(" ")[1]);
  const at = heads.indexOf("9A.");
  assert.ok(at > 0 && heads[at - 1] === "9." && heads[at + 1] === "10.", `heading order ${heads.join(" ")}`);
  assert.match(core, /^Version 3\.5, \d{4}-\d{2}-\d{2} \(adds the industry ladder, section 9A\)\. Read on every run\./m);
  assert.match(core, /^\| `industry` \| Government action in a sheet's declared industry area \(section 9A\) \| 40-74 \|$/m);
  assert.match(core, /`floor:<id>`, `industry:<id>`, `resolves:<id>`/);
  assert.match(core, /never above 39\. The only exceptions are a sheet line marked `owner:<date>` and the industry ladder \(section 9A\)/);
  assert.match(core, /- \*\*Ceiling:\*\* 74, or 69 for an entry without `core: true`\./);
  // The text's ceilings are the ones normalizeGrade enforces (74 core, 69 otherwise).
  const pl = { ...synItem, ticker: "PL" }, sym = { ...synItem, ticker: "SYM" };
  const ind = { industry: ladderIndustry };
  assert.equal(normalizeGrade(grade(74, "industry:space_licensing"), pl, null, ["PL"], null, ind).ok, true);
  assert.match(normalizeGrade(grade(75, "industry:space_licensing"), pl, null, ["PL"], null, ind).error, /industry ladder ceiling/);
  assert.equal(normalizeGrade(grade(69, "industry:robotics_trade"), sym, null, ["SYM"], null, ind).ok, true);
  assert.match(normalizeGrade(grade(70, "industry:robotics_trade"), sym, null, ["SYM"], null, ind).error, /industry ladder ceiling/);
  assert.match(normalizeGrade(grade(50, "industry:robotics_trade"), pl, null, ["PL"], null, ind).error, /unknown industry link robotics_trade for PL/);
  if (!PROMOTED) {
    assert.match(normalizeGrade(grade(50, "industry:space_licensing"), pl, null, ["PL"], null, { industry: gen.INDUSTRY }).error,
      /unknown industry link/, "the live INDUSTRY {} still rejects the flag");
  }
});

test("build-rubric --strict is clean on the repo's rubric and reproduces the committed rubric.generated.js", () => {
  const root = mkdtempSync(join(tmpdir(), "zenith-ladder-"));
  try {
    cpSync(join(REPO, "rubric"), join(root, "rubric"), { recursive: true });
    mkdirSync(join(root, "worker", "src"), { recursive: true });
    cpSync(join(REPO, "worker", "src", "covered.json"), join(root, "worker", "src", "covered.json"));
    const r = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, "--strict"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /WARNING|ERROR/);
    assert.equal(readFileSync(join(root, "worker", "src", "rubric.generated.js"), "utf8"), read("worker", "src", "rubric.generated.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
