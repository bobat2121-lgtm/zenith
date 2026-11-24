// GRRR "Policy read-through" (owner:2026-11-24). The owner asked that US
// policy on AI chip exports and overseas AI data centres be Digest news for
// GRRR (the 2026-11-19 BIS remote-access rule, the 2026-11-20 Trump remarks).
// These checks pin the sheet text the grader reads: the owner mark names
// every core rule it overrides, the NVIDIA trap does not reject policy items,
// the core 4.5 deduction cannot push a Digest policy item under 70, the bands
// below 70 cover China-only and non-Gorilla-market actions, and the two
// program sources reach the grader as GRRR program items.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("../rubric/companies/GRRR.md", import.meta.url), "utf8");
const frontMatter = /^---\n([\s\S]*?)\n---/.exec(sheet)[1];
const section = /\n## Policy read-through \(owner:2026-11-24\)\n([\s\S]*?)\n## /.exec(sheet)?.[1] ?? "";
const covered = JSON.parse(readFileSync(new URL("../worker/src/covered.json", import.meta.url), "utf8"));
const aux = JSON.parse(readFileSync(new URL("../worker/src/aux-sources.json", import.meta.url), "utf8"));

test("the policy section exists and its owner mark lists every core rule it overrides", () => {
  assert.ok(section.length > 0, "GRRR.md has the Policy read-through section");
  const mark = frontMatter.split("\n").find((l) => l.includes('line: "Policy read-through"'));
  assert.ok(mark, "owner_marks has the Policy read-through line");
  assert.match(mark, /mark: "owner:2026-11-24"/);
  for (const rule of ["core 1", "core 9", "NVIDIA entity trap", "core 4.5"]) assert.ok(mark.includes(rule), `owner mark names ${rule}`);
  for (const rule of ["core 1 out-of-scope", "core 9 read-through", "NVIDIA entity trap", "core 4.5 timeliness"]) {
    assert.ok(section.includes(rule), `section says it overrides ${rule}`);
  }
});

test("the NVIDIA trap does not reject US export-control or data-centre policy items", () => {
  const trap = frontMatter.split("\n").find((l) => l.includes('term: "Supermicro|NVIDIA|DGX Cloud"'));
  assert.ok(trap, "the trap is still there for ordinary NVIDIA items");
  assert.match(trap, /reject unless Gorilla is named/);
  assert.match(trap, /policy items are graded under Policy read-through \(owner:2026-11-24\), not rejected by this trap/);
});

test("the core 4.5 deduction never takes a Digest policy item below 70, and the worked examples are final scores", () => {
  assert.match(section, /\*\*Timeliness \(core 4\.5\):\*\*/);
  assert.match(section, /never takes an item scored in a Digest band above \(70-89\) below 70/);
  assert.match(section, /flag no `floor:` id/, "the sheet floor is not a core floor flag the API would check");
  assert.match(section, /worked-example scores below are final scores, after 4\.5/);
  const bis = /Addressing Remote Access to Advanced Semiconductors[\s\S]*?final (\d+)-(\d+)/.exec(section);
  assert.ok(bis, "the BIS example gives its final score");
  assert.ok(Number(bis[1]) >= 70, `BIS rule final ${bis[1]}-${bis[2]} stays Digest`);
  const trump = /remarks by President Trump[\s\S]*?so final (\d+)\./.exec(section);
  assert.ok(trump, "the Trump example gives its final score");
  assert.ok(Number(trump[1]) >= 70, `Trump remarks final ${trump[1]} stays Digest`);
});

test("chip-export actions outside Gorilla's markets have bands below 70, and the ladder points to them", () => {
  assert.match(section, /\*\*A rule, licence decision, deal or statement limited to end users in China\*\*[^\n]*55-69/);
  assert.match(section, /names no Gorilla market country and does not touch overseas data centres or its GPU supply:\*\* Borderline 40-54/);
  assert.match(section, /UAE/);
  assert.match(section, /IC-designer status extension/);
  assert.match(section, /Entity List additions or removals naming specific firms/);
  assert.match(section, /\*\*"Its GPU supply"\*\* means only this/);
  const ladder = sheet.split("\n").find((l) => l.startsWith("- US government action on AI chip exports"));
  assert.ok(ladder, "Digest ladder line");
  assert.doesNotMatch(ladder, /: 70-89 under/, "no blanket 70-89 pointer");
  assert.match(ladder, /Narrower chip-export actions score 40-69/);
  assert.match(ladder, /40-89, owner:2026-11-24/);
  assert.ok(sheet.split("\n").some((l) => l.startsWith("- US chip-export actions limited to China")), "Borderline ladder line");
});

test("the two policy program sources reach the grader as GRRR program items", () => {
  for (const key of ["fedreg_bis_ai_compute", "grrr_policy"]) {
    assert.ok(section.includes(`\`${key}\``), `${key} named in the section`);
    const entry = covered.counterparty[key] ?? covered.sources[key];
    assert.ok(entry, `${key} is in covered.json`);
    assert.equal(entry.role, "program");
    assert.deepEqual(entry.affects, ["GRRR"]);
    assert.equal(aux.sources[key]?.coverage_subject, true, `${key} is a coverage subject on the aux side`);
  }
});

test("the built rubric bundles the policy section for the grader", async () => {
  const { COMPANIES } = await import("../worker/src/rubric.generated.js");
  const grrr = typeof COMPANIES === "string" ? COMPANIES : COMPANIES.GRRR;
  assert.ok(grrr.includes("## Policy read-through (owner:2026-11-24)"));
  assert.ok(grrr.includes("never takes an item scored in a Digest band above (70-89) below 70"));
});
