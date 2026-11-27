// Phase 4 Part F (P4-F2) T2/T3: the score zones read from the bundled rubric,
// and the owner-grade label mapping. Structure only (no meaning words), so a
// rubric PR that rewords a band never edits this test, and one that moves a
// band edge fails until lib.js BANDS follows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const SB = await import("../worker/src/score-bands.js");
const { BANDS } = await import("../worker/src/lib.js");
const { LABEL_RANGE, labelRange } = await import("../worker/src/auxiliary.js");

const tiles = (bands) => {
  const sorted = [...bands].sort((a, b) => b.lo - a.lo);
  assert.equal(sorted[0].hi, 100);
  assert.equal(sorted[sorted.length - 1].lo, 0);
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i - 1].lo, sorted[i].hi + 1, `${sorted[i].band} meets ${sorted[i - 1].band}`);
};

test("T2: coverage and aux bands tile 0-100, top first, each with a meaning", () => {
  for (const pipeline of ["coverage", "aux"]) {
    const { bands } = SB.SCORE_BANDS[pipeline];
    assert.ok(bands.length >= 2, pipeline);
    tiles(bands);
    assert.deepEqual(bands.map((b) => b.lo), [...bands.map((b) => b.lo)].sort((a, b) => b - a), "top first");
    for (const b of bands) {
      assert.equal(typeof b.meaning, "string");
      assert.ok(b.meaning.length > 0, `${pipeline} ${b.band} meaning`);
      assert.match(b.band, /^[a-z]+$/);
    }
  }
});

test("T2: band names and low edges equal lib.js BANDS (the code copy follows the rubric)", () => {
  const cov = SB.SCORE_BANDS.coverage.bands;
  assert.deepEqual(cov.map((b) => ({ band: b.band, min: b.lo })), BANDS.map((b) => ({ band: b.band, min: b.min })));
});

test("T2: aux cut points equal coverage's", () => {
  const cut = (p) => SB.SCORE_BANDS[p].bands.map((b) => [b.band, b.lo, b.hi]);
  assert.deepEqual(cut("aux"), cut("coverage"));
});

test("T2: sub-zones exist, sit inside one band and tile it", () => {
  for (const pipeline of ["coverage", "aux"]) {
    const { bands, subzones } = SB.SCORE_BANDS[pipeline];
    assert.ok(subzones.length >= 1, pipeline);
    for (const z of subzones) {
      const b = bands.find((x) => x.band === z.band);
      assert.ok(b && b.lo <= z.lo && z.hi <= b.hi, `${pipeline} ${z.lo}-${z.hi}`);
      assert.ok(z.meaning.length > 0);
    }
    for (const band of new Set(subzones.map((z) => z.band))) {
      const b = bands.find((x) => x.band === band);
      tilesBand(subzones.filter((z) => z.band === band), b);
    }
  }
});
function tilesBand(zones, band) {
  const s = [...zones].sort((a, b) => b.lo - a.lo);
  assert.equal(s[0].hi, band.hi);
  assert.equal(s[s.length - 1].lo, band.lo);
  for (let i = 1; i < s.length; i++) assert.equal(s[i - 1].lo, s[i].hi + 1);
}

test("T2: the lines are the Digest and Lead low edges", () => {
  const lo = (n) => BANDS.find((b) => b.band === n).min;
  assert.equal(SB.NECESSARY_LINE, lo("digest"));
  assert.equal(SB.LEAD_LINE, lo("lead"));
});

const SYN = (rows, sentence = "0-4 = broken. 5-19 = small.") => `# Synthetic rubric\n\n## 1. Scope\n\n| 0-1 | **Nope** | not this table | x |\n\n## 2. Score scale and bands\n\nInteger 0-100.\n\n| Score | Band | Meaning | Feed |\n|---|---|---|---|\n${rows.join("\n")}\n\n${sentence}\n\n## 3. Next\n\n| 0-100 | **Later** | not this one | x |\n`;

test("T2: parseBands reads a synthetic table and its sub-zones (3- and 4-column rows)", () => {
  const r = SB.parseBands(SYN(["| 50-100 | **High** | Keep | Top |", "| 20-49 | **Mid** | Maybe |", "| 0-19 | **Low** | Drop | Hidden |"]));
  assert.deepEqual(r.bands.map((b) => [b.lo, b.hi, b.band, b.label, b.meaning, b.feed]), [
    [50, 100, "high", "High", "Keep", "Top"],
    [20, 49, "mid", "Mid", "Maybe", null],
    [0, 19, "low", "Low", "Drop", "Hidden"],
  ]);
  assert.deepEqual(r.subzones, [
    { lo: 5, hi: 19, band: "low", meaning: "small" },
    { lo: 0, hi: 4, band: "low", meaning: "broken" },
  ]);
});

test("T2: parseBands throws on a gap, an overlap, a short top or bottom, no section, no rows", () => {
  assert.throws(() => SB.parseBands(SYN(["| 50-100 | **High** | Keep | Top |", "| 0-48 | **Low** | Drop | Hidden |"])), /gap or overlap/);
  assert.throws(() => SB.parseBands(SYN(["| 50-100 | **High** | Keep | Top |", "| 0-50 | **Low** | Drop | Hidden |"])), /gap or overlap/);
  assert.throws(() => SB.parseBands(SYN(["| 50-99 | **High** | Keep | Top |", "| 0-49 | **Low** | Drop | Hidden |"])), /top band/);
  assert.throws(() => SB.parseBands(SYN(["| 50-100 | **High** | Keep | Top |", "| 1-49 | **Low** | Drop | Hidden |"])), /bottom band/);
  assert.throws(() => SB.parseBands(SYN(["| 50-100 | **High** |  | Top |", "| 0-49 | **Low** | Drop | Hidden |"])), /meaning/);
  assert.throws(() => SB.parseBands(SYN(["| 50-100 | **High** | Keep | Top |", "| 0-49 | **Low** | Drop | Hidden |"], "40-60 = straddles.")), /crosses a band edge/);
  assert.throws(() => SB.parseBands("# no section two\n"), /no '## 2\.'/);
  assert.throws(() => SB.parseBands("## 2. Bands\n\nno table\n"), /no band rows/);
});

test("T3: labelFor maps 90/60/30/1 and every grade lies inside its label's range", () => {
  const cases = [[100, "high"], [90, "high"], [89, "medium"], [60, "medium"], [59, "low"], [30, "low"], [29, "noise"], [1, "noise"]];
  for (const [o, l] of cases) assert.equal(SB.labelFor(o), l, String(o));
  for (let o = 1; o <= 100; o++) {
    const [lo, hi] = labelRange(SB.labelFor(o));
    assert.ok(lo <= o && o <= hi, `${o} in ${SB.labelFor(o)}`);
  }
  for (const bad of [0, 101, 85.5, "85", "85x", null, undefined, NaN]) assert.equal(SB.labelFor(bad), null, String(bad));
  assert.deepEqual(SB.OWNER_LABEL_MAP.map(([, l]) => l), ["high", "medium", "low", "noise"]);
  for (const [, l] of SB.OWNER_LABEL_MAP) assert.ok(LABEL_RANGE[l], l);
  // only a Lead-band grade maps to the label that pins like a Lead
  assert.equal(SB.OWNER_LABEL_MAP[0][0], SB.LEAD_LINE);
});

test("zoneOf: band and sub-zone of a score, null off the scale", () => {
  for (const pipeline of ["coverage", "aux"]) {
    for (const b of SB.SCORE_BANDS[pipeline].bands) {
      assert.equal(SB.zoneOf(b.lo, pipeline).band, b.band);
      assert.equal(SB.zoneOf(b.hi, pipeline).band, b.band);
    }
    for (const z of SB.SCORE_BANDS[pipeline].subzones) assert.equal(SB.zoneOf(z.lo, pipeline).subzone, z.meaning);
    assert.equal(SB.zoneOf(SB.LEAD_LINE, pipeline).subzone, null);
  }
  for (const bad of [-1, 101, null, "x"]) assert.equal(SB.zoneOf(bad), null, String(bad));
});

test("sliderZones: top first, contiguous from 100 down to 1, the lowest band split by sub-zones", () => {
  for (const pipeline of ["coverage", "aux"]) {
    const z = SB.sliderZones(pipeline);
    assert.equal(z[0].hi, 100);
    assert.equal(z[z.length - 1].lo, 1);
    for (let i = 1; i < z.length; i++) assert.equal(z[i - 1].lo, z[i].hi + 1);
    for (const s of z) assert.ok(s.does.length > 0 && s.meaning.length > 0 && s.label.length > 0);
    const { bands, subzones } = SB.SCORE_BANDS[pipeline];
    assert.equal(z.length, bands.length + subzones.length - new Set(subzones.map((s) => s.band)).size);
    assert.equal(z.find((s) => s.lo === SB.LEAD_LINE).band, "lead");
    assert.equal(z.find((s) => s.lo === SB.NECESSARY_LINE).band, "digest");
  }
});

test("T11: score-bands.js imports only the rubric text, reads no env and fetches nothing", () => {
  const src = readFileSync(new URL("../worker/src/score-bands.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./rubric.generated.js"]);
  assert.match(src, /import \{ CORE, AUX_RUBRIC \} from "\.\/rubric\.generated\.js";/);
  assert.doesNotMatch(src, /\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|\benv\b|Date\.now\s*\(/);
});
