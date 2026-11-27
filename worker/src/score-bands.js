// Phase 4 Part F (P4-F2): the score zones, read from the bundled rubric as data.
// The grader's source of truth for bands is the table in section 2 of
// rubric/core.md and rubric/auxiliary.md; this module parses that table once
// per isolate instead of keeping another copy of the numbers. The 1-100 owner
// grade slider, GET /v1/scale and the owner-grade label mapping read it.
// Imports only the rubric text (it stays inside the portal import walk).
// Nothing imports this module yet (P4-F3 wires it).
import { CORE, AUX_RUBRIC } from "./rubric.generated.js";

const ROW_RE = /^\|\s*(\d{1,3})\s*-\s*(\d{1,3})\s*\|\s*\*\*([^*|]+)\*\*\s*\|([^|]*)\|(?:([^|]*)\|)?\s*$/;
const SUBZONE_RE = /(?:^|[\s.])(\d{1,3})-(\d{1,3}) = ([^.]+)\./g;

// parseBands(md): the "## 2." section's band table, top band first, and the
// sub-zone sentence under it ("0-9 = ... . 10-39 = ... ."). Throws unless the
// table tiles 0-100 with no gap or overlap, so a rubric edit that breaks the
// scale fails the build's tests instead of shipping a wrong slider.
export function parseBands(md) {
  const text = String(md ?? "");
  const start = text.search(/^## 2\.\s/m);
  if (start < 0) throw new Error("score bands: no '## 2.' section in the rubric");
  const rest = text.slice(start);
  const next = rest.slice(3).search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next + 3);
  const bands = [];
  const prose = [];
  for (const line of section.split(/\r?\n/)) {
    const m = ROW_RE.exec(line.trim());
    if (m) {
      const [, lo, hi, name, meaning, feed] = m;
      bands.push({
        lo: Number(lo),
        hi: Number(hi),
        band: name.trim().toLowerCase(),
        label: name.trim(),
        meaning: meaning.trim(),
        feed: feed == null ? null : feed.trim() || null,
      });
    } else if (!line.trim().startsWith("|")) prose.push(line);
  }
  if (!bands.length) throw new Error("score bands: no band rows in section 2");
  bands.sort((a, b) => b.lo - a.lo);
  if (bands[0].hi !== 100) throw new Error(`score bands: the top band ends at ${bands[0].hi}, not 100`);
  if (bands[bands.length - 1].lo !== 0) throw new Error(`score bands: the bottom band starts at ${bands[bands.length - 1].lo}, not 0`);
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (!(b.lo <= b.hi)) throw new Error(`score bands: ${b.band} runs ${b.lo}-${b.hi}`);
    if (!b.meaning) throw new Error(`score bands: ${b.band} has no meaning`);
    if (i > 0 && bands[i - 1].lo !== b.hi + 1) throw new Error(`score bands: gap or overlap between ${bands[i - 1].band} and ${b.band}`);
  }
  const subzones = [];
  for (const m of prose.join("\n").matchAll(SUBZONE_RE)) {
    const lo = Number(m[1]), hi = Number(m[2]);
    if (lo > hi || hi > 100) throw new Error(`score bands: sub-zone ${lo}-${hi} is not on the scale`);
    const parent = bands.find((b) => b.lo <= lo && hi <= b.hi);
    if (!parent) throw new Error(`score bands: sub-zone ${lo}-${hi} crosses a band edge`);
    subzones.push({ lo, hi, band: parent.band, meaning: m[3].trim() });
  }
  subzones.sort((a, b) => b.lo - a.lo);
  return { bands, subzones };
}

export const SCORE_BANDS = Object.freeze({ coverage: parseBands(CORE), aux: parseBands(AUX_RUBRIC) });

const bandsOf = (pipeline) => SCORE_BANDS[pipeline === "aux" ? "aux" : "coverage"];
const bandLo = (name) => {
  const b = SCORE_BANDS.coverage.bands.find((x) => x.band === name);
  if (!b) throw new Error(`score bands: no ${name} band in the rubric`);
  return b.lo;
};

// The line a card scored at or above is "necessary" output: the Digest band's
// low edge (the app's default Signal line). Tuning's line guard holds here.
export const NECESSARY_LINE = bandLo("digest");
// The Lead band's low edge: an owner grade at or above it pins like a Lead.
export const LEAD_LINE = bandLo("lead");

// An owner grade is an integer 1-100.
export const isOwnerScore = (o) => Number.isInteger(o) && o >= 1 && o <= 100;

// Owner grade -> the legacy label stored beside it (feedback.label keeps its
// CHECK). Each grade lies inside its label's range (auxiliary.js LABEL_RANGE),
// and only 90+ maps to high, so the legacy High pin matches the number.
export const OWNER_LABEL_MAP = Object.freeze([[90, "high"], [60, "medium"], [30, "low"], [1, "noise"]]);
export function labelFor(o) {
  if (!isOwnerScore(o)) return null;
  for (const [min, label] of OWNER_LABEL_MAP) if (o >= min) return label;
  return null;
}

// The band (and sub-zone, when the rubric names one) a score falls in.
export function zoneOf(score, pipeline = "coverage") {
  const s = score;
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 100) return null;
  const { bands, subzones } = bandsOf(pipeline);
  const band = bands.find((b) => b.lo <= s && s <= b.hi);
  if (!band) return null;
  const sub = subzones.find((z) => z.lo <= s && s <= z.hi);
  return { ...band, subzone: sub ? sub.meaning : null };
}

// What a grade in each zone does to the card (code text, not rubric text).
const DOES = {
  lead: "pins in For You and reads as a Lead",
  digest: "in For You at the default Signal line",
  borderline: "below the default line, on Latest and the Company page",
  reject: "hidden from For You",
};
const DOES_DATA_PROBLEM = "wrong or broken item";

// The fixed sentence under the slider (spec 5.2), one copy for /v1/scale, the
// portal and the app. Its numbers are tune-math.js TUNE's AGREE_WITHIN, K,
// MAX_STEP.card (rounded) and LINE; test/tune-math.test.js asserts they agree.
// This module does not import tune-math.js (it imports only the rubric text).
export const SLIDER_NOTE =
  "Within 10 points of Claude's grade counts as agreement. Your first two grades on a source or topic never change tuning; " +
  "from the third agreeing grade, each grade moves similar cards by at most about 5 points, " +
  `and a card Claude scored ${NECESSARY_LINE}+ never leaves For You because of tuning until you confirm it.`;

// The slider's segments, top first: each band from the rubric, with the
// lowest band split by its sub-zones, clipped to the slider's 1-100.
export function sliderZones(pipeline = "coverage") {
  const { bands, subzones } = bandsOf(pipeline);
  const out = [];
  for (const b of bands) {
    const subs = subzones.filter((z) => z.band === b.band);
    const covered = subs.reduce((n, z) => n + (z.hi - z.lo + 1), 0);
    const parts = subs.length && covered === b.hi - b.lo + 1 ? subs : [{ lo: b.lo, hi: b.hi, meaning: null }];
    parts.forEach((z, i) => {
      const lo = Math.max(1, z.lo);
      if (lo > z.hi) return;
      const lowest = b === bands[bands.length - 1] && i === parts.length - 1 && parts.length > 1;
      out.push({
        lo,
        hi: z.hi,
        band: b.band,
        label: b.label,
        meaning: z.meaning || b.meaning,
        does: lowest ? DOES_DATA_PROBLEM : DOES[b.band] || b.meaning,
      });
    });
  }
  return out;
}
