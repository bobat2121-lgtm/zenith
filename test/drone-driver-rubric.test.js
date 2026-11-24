// Round 7 Phase 1a "Driver lines" (owner:2026-11-24) on the drone group
// (RCAT UMAC ONDS PUSA DPRO). The owner approved four US drivers: drone rules,
// presidential drone and airspace actions, Defense appropriations and CRs
// naming a drone program, and DoW drone industrial policy. These checks pin the
// sheet text the grader reads: the fixed 8-field shape of each driver block
// (plans/round7-driver-coverage.md 4.1), the approved bands, the owner mark,
// the grader step that reads other tickers' Driver lines, and the bundle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOwnerMarks } from "../scripts/owner-marks.mjs";

const TICKERS = ["RCAT", "UMAC", "ONDS", "PUSA", "DPRO"];
const HEADING = "## Driver lines (owner:2026-11-24)";
const FIELDS = ["id", "category", "what counts", "actors", "band", "overrides", "sources", "worked example"];
const DRIVERS = ["US drone rules", "Presidential drone and airspace actions", "Defense appropriations and continuing resolutions naming a drone program", "DoW drone industrial policy"];
const SOURCES = { "US drone rules": ["drv_fedreg_drone_rules"], "Presidential drone and airspace actions": ["drv_whitehouse_actions"], "Defense appropriations and continuing resolutions naming a drone program": ["drv_senate_approps_def", "drv_defense_cr_drones"], "DoW drone industrial policy": ["drv_drone_industrial_policy"] };

const read = (t) => readFileSync(new URL(`../rubric/companies/${t}.md`, import.meta.url), "utf8");
const frontMatterOf = (md) => (/^---\n([\s\S]*?)\n---/.exec(md) || /```ya?ml\n([\s\S]*?)\n```/.exec(md))[1];
const sectionOf = (md) => {
  const at = md.indexOf(`\n${HEADING}\n`);
  if (at < 0) return "";
  const rest = md.slice(at + HEADING.length + 2);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
};
const blocksOf = (section) => Object.fromEntries(section.split(/^### /m).slice(1).map((b) => [b.split("\n")[0].trim(), b]));
const thesisDrivers = (fm) => {
  const inline = /^thesis_drivers:\s*\[([^\]]*)\]/m.exec(fm);
  if (inline) return inline[1].split(",").map((x) => x.trim());
  const at = fm.indexOf("thesis_drivers:");
  return fm.slice(at).split("\n").slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => /^\s+-\s/.test(x))).map((l) => l.replace(/^\s+-\s+/, "").split(/\s+/)[0]);
};

for (const t of TICKERS) {
  const md = read(t);
  const fm = frontMatterOf(md);
  const section = sectionOf(md);
  const blocks = blocksOf(section);

  test(`${t}: the Driver lines section exists with the owner mark, the GRRR precedent and the shared rules`, () => {
    assert.ok(section.length > 0, `${t}.md has "${HEADING}"`);
    assert.match(section, /GRRR\.md "Policy read-through" \(owner:2026-11-24\), cited as the precedent/);
    assert.match(section, /core 1 out-of-scope rule for policy and budgets, the core 9 read-through boundary, the core 4\.5 deduction below 70, and, for the credible-report bands only, the core 4\.1 `reported` deduction and `prospective` cap/);
    assert.match(section, /\*\*Thesis lift \(core 4\.4\):\*\* the bands below already include it\.[^\n]*never above 89/);
    assert.match(section, /the first copy graded takes the credible-report band, even when it cites another outlet/);
    // The Drone Dominance and Gauntlet exclusion sits inside Driver lines, the only part #TICKER graders read.
    assert.match(/^- \*\*Not covered:\*\* .*$/m.exec(section)[0], /Drone Dominance and Gauntlet (results and orders to rivals|selections, phase lists, results and orders)[^\n]*get no `#[A-Z]+` grade from these lines/);
    assert.match(section, /never takes an item scored in a Digest band of these lines \(70-89\) below 70/);
    assert.match(section, /flag no `floor:` id/);
    assert.match(section, /\*\*Published text:\*\* facts only \(core 9\)\. Never write /);
    assert.match(section, /law-firm alerts and re-reports are `duplicate` of the first graded copy, or under 40/);
  });

  test(`${t}: four driver blocks, each with exactly the 8 fixed fields`, () => {
    assert.deepEqual(Object.keys(blocks), DRIVERS);
    for (const [name, block] of Object.entries(blocks)) {
      const fields = [...block.matchAll(/^- \*\*([a-z ]+):\*\*/gm)].map((m) => m[1]);
      assert.deepEqual(fields, FIELDS, `${t} ${name}: fields in order`);
      const lines = block.trim().split("\n").length;
      assert.ok(lines <= 15, `${t} ${name}: ${lines} lines, at most 15`);
    }
  });

  test(`${t}: every block id is in front-matter thesis_drivers (core 10), ids are unique, and the bands are the approved ones`, () => {
    const drivers = thesisDrivers(fm);
    const ids = [];
    for (const [name, block] of Object.entries(blocks)) {
      const id = /^- \*\*id:\*\* `([a-z0-9_]+)` \((existing thesis driver|thesis driver added with these lines)/m.exec(block);
      assert.ok(id, `${t} ${name}: id line`);
      assert.ok(drivers.includes(id[1]), `${t} ${name}: ${id[1]} is in thesis_drivers`);
      ids.push(id[1]);
      const band = /^- \*\*band:\*\* (.*)$/m.exec(block)[1];
      assert.match(band, /Digest (75|80)-(79|85|89)/, `${t} ${name}: final action band inside 75-89`);
      assert.match(band, /70-7[49]/, `${t} ${name}: intent or proposal band inside 70-79`);
      assert.match(band, /Credible report of [^:]*: 70\./, `${t} ${name}: credible report at 70`);
      for (const key of SOURCES[name]) assert.ok(block.includes(`\`${key}\``), `${t} ${name}: names ${key}`);
      assert.match(block, /^- \*\*overrides:\*\* core 1, core 9 and core 4\.5 below 70, as in the shared rules\. Core 4\.1 status effects are lifted for the credible-report band only\./m);
      assert.match(block, /^- \*\*worked example:\*\* .*(final|stale)/m);
    }
    assert.equal(new Set(ids).size, ids.length, `${t}: ids unique`);
  });

  test(`${t}: FCC router and camera-only rules are a recorded negative; credible reports of DoW talks score 70`, () => {
    assert.match(blocks["US drone rules"], /reach only routers, surveillance cameras or other gear, not drones[^.]*, are `out_of_scope` 0-15 \(recorded negative\)/);
    assert.match(blocks["US drone rules"], /91 FR 57798; in force 2026-10-13/);
    assert.match(blocks["US drone rules"], /^- \*\*band:\*\* final rule or order published \(in force or with a set effective date\):/m);
    assert.match(blocks["US drone rules"], /that changes who may make, sell, import/);
    assert.match(blocks["US drone rules"], /Airworthiness directives, maintenance and inspection rules[^.]*are `out_of_scope` 0-15 even when they name unmanned aircraft \(recorded negative\)/);
    assert.match(blocks["US drone rules"], /Inspection Programs for Single-Engine Turbine-Powered Airplanes and Unmanned Aircraft/);
    assert.match(blocks["US drone rules"], /does not apply to the location-based Covered List entries/);
    assert.match(blocks["US drone rules"], /21-232 title[^:]*\) alone never shows drone reach/);
    assert.doesNotMatch(blocks["US drone rules"], /no new equipment authorizations for drones and radios/);
    const dow = blocks["DoW drone industrial policy"];
    assert.match(dow, /Drone Dominance or Gauntlet results, rounds, selections, phase lists and orders \(including planned DDP order pools\)/);
    assert.match(dow, /These are peer wins, not this line/);
    assert.doesNotMatch(dow, /production-order pools|Drone Dominance office|budget pool not yet awarded/);
    assert.match(blocks["DoW drone industrial policy"], /Pentagon is in talks with GM and Ford[^.]*70, final 70/);
    assert.match(blocks["Defense appropriations and continuing resolutions naming a drone program"], /names no drone program does not count/);
  });

  test(`${t}: owner_marks has the Driver lines entry naming the overridden core rules`, () => {
    const { marks, errors } = parseOwnerMarks(fm);
    assert.deepEqual(errors, []);
    const entry = marks.find((m) => m.line === "Driver lines");
    assert.ok(entry, `${t}: owner_marks entry`);
    assert.equal(entry.mark, "owner:2026-11-24");
    for (const rule of ["core 1 out-of-scope", "core 9 read-through", "core 4.5 timeliness", "core 4.1 reported deduction and prospective cap"]) assert.ok(entry.overrides.includes(rule), `${t}: overrides names ${rule}`);
    assert.ok(md.includes(`\n${HEADING}\n`));
  });
}

test("tailoring: the drivers that do not reach a ticker say so", () => {
  assert.match(sectionOf(read("UMAC")), /BIS drone export rules \*\*do not apply to UMAC\*\*/);
  assert.match(sectionOf(read("DPRO")), /BIS drone export rules \*\*do not apply to DPRO\*\*/);
  for (const t of ["UMAC", "RCAT", "DPRO"]) assert.match(sectionOf(read(t)), new RegExp(`counter-UAS authority or airspace security \\*\\*does not apply to ${t}\\*\\*`));
  for (const t of ["PUSA", "ONDS"]) assert.match(blocksOf(sectionOf(read(t)))["Presidential drone and airspace actions"], /counter-UAS authority and airspace security/);
  assert.match(blocksOf(sectionOf(read("RCAT")))["DoW drone industrial policy"], /Neros signs a \$450M conditional loan commitment from the DoW Office of Strategic Capital/);
});

test("peer financings stay out of scope, with a pointer for DoW actions; UMAC's policy_tailwinds points at the line", () => {
  const rcat = read("RCAT");
  assert.match(rcat, /\*\*Out of scope \(0-15\):\*\* rival-only follow-on orders, peer financings/);
  assert.match(rcat, /A DoW action for a peer \(a DoW loan, equity stake or production partnership, such as an Office of Strategic Capital loan\) is not a peer financing: it is graded under "Driver lines" below/);
  for (const t of TICKERS) assert.doesNotMatch(read(t), /production deal/, `${t}: no "production deal" wording`);
  const pusa = read("PUSA");
  assert.match(pusa, /Peer wins, peer financings and sector budgets are `out_of_scope` \(0-15\) for PUSA\. A DoW action for a peer/);
  const umac = read("UMAC");
  assert.match(umac, /policy_tailwinds +# own items, plus read-through items under "Driver lines" \(owner:2026-11-24\)/);
  assert.match(umac, /Policy news that does not name UMAC counts only under "Driver lines" below \(owner:2026-11-24\)/);
  assert.doesNotMatch(umac, /This driver counts only on UMAC's own items/);
});

test("GRADER.md reads the Driver lines of each affects ticker for multi-ticker program items, as the one exception", () => {
  const grader = readFileSync(new URL("../grader/GRADER.md", import.meta.url), "utf8");
  assert.match(grader, /never whole sheets\. The one exception is the\s+"Driver lines" section in the Counterparty items step below\./);
  assert.match(grader, /\*\*Driver lines \(the one exception to "never whole sheets"\)\.\*\* For a COUNTERPARTY\s+item with `role=program` and more than one ticker in `affects`/);
  assert.match(grader, /\.zenith\/rubric\/<TICKER>\.md/);
  assert.match(grader, /nothing else of those sheets/);
  assert.match(grader, /Add a `"<item_id>#<TICKER>"` grade only for a ticker whose Driver lines\s+cover the item, at that ticker's band/);
  // The awk command prints the section up to the next "## " heading.
  const cmd = /`(awk '[^`]+')/.exec(grader)[1];
  assert.match(cmd, /\^## Driver lines/);
  assert.match(cmd, /p&&\/\^## \/\{exit\}/);
});

test("the built rubric bundles the five Driver lines sections", async () => {
  const { COMPANIES } = await import("../worker/src/rubric.generated.js");
  for (const t of TICKERS) {
    assert.ok(COMPANIES[t].includes(HEADING), `${t} bundled`);
    assert.ok(COMPANIES[t].includes("### DoW drone industrial policy"), `${t} blocks bundled`);
  }
});

test("UMAC: Part 108 status pieces are not context, and a new step is graded under Driver lines", () => {
  const umac = read("UMAC");
  assert.match(umac, /a credible report of a new step on it \(cleared by OIRA, a publication date set\), are graded under "Driver lines"/);
  assert.doesNotMatch(umac, /status pieces, explainers\) stays context/);
});

test("covered.json routes the four graded drone driver sources; the shadow source is left out", () => {
  const covered = JSON.parse(readFileSync(new URL("../worker/src/covered.json", import.meta.url), "utf8"));
  const aux = JSON.parse(readFileSync(new URL("../worker/src/aux-sources.json", import.meta.url), "utf8"));
  for (const key of ["drv_fedreg_drone_rules", "drv_whitehouse_actions", "drv_senate_approps_def", "drv_defense_cr_drones"]) {
    const cp = covered.counterparty[key];
    assert.ok(cp, `${key} in covered.json counterparty`);
    assert.equal(cp.role, "program");
    assert.deepEqual([...cp.affects].sort(), [...TICKERS].sort(), `${key} affects the five drone tickers`);
    assert.equal(aux.sources[key]?.coverage_subject, true, `${key} in aux-sources.json with coverage_subject`);
  }
  assert.equal(covered.counterparty.drv_drone_industrial_policy, undefined);
  assert.equal(aux.sources.drv_drone_industrial_policy, undefined);
});
