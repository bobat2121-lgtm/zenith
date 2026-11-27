// Phase 4 Part F (P4-F2) T4-T6: the gentle-tuning math (worker/src/tune-math.js).
// Synthetic data only: syn_* source keys, tickers TST/TSTB, example hosts. The
// curves pinned here are the spec's constants (small per-grade effect, three
// agreeing grades before anything moves, a 30-day half-life, caps 6/4/8), not
// measurements.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const M = await import("../worker/src/tune-math.js");
const { NECESSARY_LINE, LEAD_LINE, SLIDER_NOTE } = await import("../worker/src/score-bands.js");
const { LABEL_RANGE } = await import("../worker/src/auxiliary.js");
const { isOfficialRecord, OFFICIAL_HOST_RE } = await import("../worker/src/records.js");
const { TUNE } = M;

const NOW = Date.parse("2030-01-31T00:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const ex = (n, r = -99, age = 0) => Array.from({ length: n }, () => ({ r, age }));
const src = (g) => M.scopeOffset(g, { kind: "source" }).points;
const top = (g) => M.scopeOffset(g, { kind: "topic" }).points;
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const card2 = (n, r) => M.round1(clip(src(ex(n, r)) + top(ex(n, r)), -TUNE.CARD_CAP, TUNE.CARD_CAP));

test("constants: the line and Lead edges come from the rubric; legacy ranges equal the grader's", () => {
  assert.equal(TUNE.LINE, NECESSARY_LINE);
  assert.equal(TUNE.LEAD, LEAD_LINE);
  assert.deepEqual(M.LEGACY_RANGE, LABEL_RANGE);
  assert.equal(M.round1(TUNE.MAX_STEP.source + TUNE.MAX_STEP.topic), TUNE.MAX_STEP.card);
  assert.ok(Object.isFrozen(TUNE) && Object.isFrozen(TUNE.CAP));
});

test("the slider's fixed sentence states the tuning constants it describes", () => {
  const ORDINAL = { 2: "two", 3: "third" };
  assert.ok(SLIDER_NOTE.startsWith(`Within ${TUNE.AGREE_WITHIN} points of Claude's grade counts as agreement.`));
  assert.ok(SLIDER_NOTE.includes(`Your first ${ORDINAL[TUNE.K - 1]} grades on a source or topic never change tuning`));
  assert.ok(SLIDER_NOTE.includes(`from the ${ORDINAL[TUNE.K]} agreeing grade`));
  assert.ok(SLIDER_NOTE.includes(`at most about ${Math.round(TUNE.MAX_STEP.card)} points`));
  assert.ok(SLIDER_NOTE.includes(`a card Claude scored ${TUNE.LINE}+ never leaves For You because of tuning until you confirm it.`));
  // a single grade never opens tuning, so "first two" holds
  assert.equal(M.scopeOffset(ex(TUNE.K - 1), { kind: "source" }).points, 0);
  assert.notEqual(M.scopeOffset(ex(TUNE.K), { kind: "source" }).points, 0);
});

test("T4: consistent extreme grades accumulate on a source, a topic and a card fed by both", () => {
  const n = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(n.map((k) => src(ex(k))), [0, 0, -1.8, -4, -6, -6, -6, -6]);
  assert.deepEqual(n.map((k) => card2(k, -99)), [0, 0, -3.1, -6.7, -8, -8, -8, -8]);
  assert.deepEqual(n.map((k) => src(ex(k, -10))), [0, 0, -0.9, -2.2, -3.8, -4.3, -4.7, -5]);
  // the same upward
  assert.deepEqual(n.map((k) => src(ex(k, 99))), [0, 0, 1.8, 4, 6, 6, 6, 6]);
  // mixed signs mostly cancel
  assert.equal(src([-20, 20, -20, 20, -20].map((r) => ({ r, age: 0 }))), -0.5);
  // residuals under MIN_R never count as agreeing, so they never open tuning
  assert.equal(src(ex(8, -4)), 0);
});

test("T4: decay with no new grades (5, 6 and 20 extreme grades)", () => {
  const at = (n, days) => Object.fromEntries(days.map((d) => [d, src(ex(n, -99, d))]));
  assert.deepEqual(at(5, [0, 15, 22, 30, 45]), { 0: -6, 15: -3.1, 22: -1.8, 30: -0.8, 45: 0 });
  assert.deepEqual(at(6, [0, 15, 22, 30, 45, 60]), { 0: -6, 15: -4.5, 22: -3.2, 30: -1.8, 45: -0.2, 60: 0 });
  assert.deepEqual(at(20, [0, 30, 60, 90, 120]), { 0: -6, 30: -6, 60: -6, 90: -0.8, 120: 0 });
});

// Every multiset of up to `max` residuals from `vals` (equal ages: order does
// not matter), so a sequence of up to max+1 grades is covered exhaustively.
function multisets(vals, max) {
  const out = [];
  const go = (from, acc) => {
    out.push(acc);
    if (acc.length === max) return;
    for (let i = from; i < vals.length; i++) go(i, [...acc, vals[i]]);
  };
  go(0, []);
  return out;
}

test("T4: one grade moves a source by at most 2.7 and a topic by at most 2.1 (every sequence of up to 6 grades)", () => {
  const RS = [-99, -60, -40, -20, -10, -5, 0, 5, 10, 20, 40, 60, 99];
  const worst = { source: 0, topic: 0 };
  for (const kind of ["source", "topic"]) {
    for (const prior of multisets(RS, 5)) {
      const g = prior.map((r) => ({ r, age: 0 }));
      const before = M.scopeOffset(g, { kind }).points;
      for (const r of RS) {
        const d = Math.abs(M.scopeOffset([...g, { r, age: 0 }], { kind }).points - before);
        if (d > worst[kind]) worst[kind] = M.round1(d);
      }
    }
  }
  assert.deepEqual(worst, { source: TUNE.MAX_STEP.source, topic: TUNE.MAX_STEP.topic });
  assert.equal(TUNE.MAX_STEP.entity, TUNE.MAX_STEP.topic);
});

test("T4: random histories with ages: one grade moves a card fed by source and topic by at most 4.8", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hist = () => Array.from({ length: Math.floor(rnd() * 12) }, () => ({ r: Math.round((rnd() * 2 - 1) * 99), age: rnd() < 0.5 ? 0 : Math.floor(rnd() * 119) }));
  let worst = 0;
  for (let t = 0; t < 30000; t++) {
    const a = hist(), b = hist(), g = { r: Math.round((rnd() * 2 - 1) * 99), age: 0 };
    const before = clip(src(a) + top(b), -8, 8), after = clip(src([...a, g]) + top([...b, g]), -8, 8);
    worst = Math.max(worst, Math.abs(after - before));
  }
  assert.ok(worst <= TUNE.MAX_STEP.card + 1e-9, String(worst));
});

const row = (o) => ({ universe_id: "u1", pipeline: "coverage", ticker: "TST", event_type: "contract", source_key: "syn_a", grade_id: 1, score: 70, created_at: daysAgo(0), ...o });

test("T4: grades in force: latest per card, 120-day cut, graded cards only", () => {
  // three re-grades of one card are one grade: no offset
  const regrade = [row({ id: 1, item_id: 7, owner_score: 20 }), row({ id: 2, item_id: 7, owner_score: 30 }), row({ id: 3, item_id: 7, owner_score: 25 })];
  const f = M.gradesInForce(regrade, { now: NOW });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 3);
  assert.equal(f[0].r, -45);
  assert.equal(M.computeOffsets(f).get(M.scopeId("coverage", "source", "syn_a")).points, 0);
  // newest by id even when given out of order; created_at breaks ties without ids
  assert.equal(M.gradesInForce([regrade[2], regrade[0], regrade[1]], { now: NOW })[0].id, 3);
  const noIds = [row({ item_id: 8, owner_score: 10, created_at: daysAgo(2) }), row({ item_id: 8, owner_score: 90, created_at: daysAgo(1) })];
  assert.equal(M.gradesInForce(noIds, { now: NOW })[0].owner_score, 90);
  // the latest row on an ungraded card feeds nothing, even over an older graded row
  assert.equal(M.gradesInForce([row({ id: 1, item_id: 9, owner_score: 1 }), row({ id: 2, item_id: 9, owner_score: 1, grade_id: null })], { now: NOW }).length, 0);
  // 120 days is in force, 121 is not
  assert.equal(M.gradesInForce([row({ id: 1, item_id: 1, owner_score: 1, created_at: daysAgo(120) })], { now: NOW }).length, 1);
  assert.equal(M.gradesInForce([row({ id: 1, item_id: 1, owner_score: 1, created_at: daysAgo(121) })], { now: NOW }).length, 0);
  // universes and pipelines are separate cards
  const sep = [row({ id: 1, item_id: 5, owner_score: 1 }), row({ id: 2, item_id: 5, owner_score: 1, universe_id: "u2" }), row({ id: 3, item_id: 5, owner_score: 1, pipeline: "aux" })];
  assert.equal(M.gradesInForce(sep, { now: NOW }).length, 3);
});

test("T4: an item graded under two tickers counts once for its source and once per topic", () => {
  const rows = [];
  for (let i = 1; i <= 3; i++) {
    rows.push(row({ id: i * 2 - 1, item_id: i, ticker: "TST", owner_score: 1 }));
    rows.push(row({ id: i * 2, item_id: i, ticker: "TSTB", owner_score: 1 }));
  }
  const inForce = M.gradesInForce(rows, { now: NOW });
  assert.equal(inForce.length, 6);
  const o = M.computeOffsets(inForce);
  const s = o.get(M.scopeId("coverage", "source", "syn_a"));
  assert.equal(s.n_grades, 3);
  assert.equal(s.points, src(ex(3)));
  assert.equal(o.get(M.scopeId("coverage", "topic", "TST:contract")).n_grades, 3);
  assert.equal(o.get(M.scopeId("coverage", "topic", "TSTB:contract")).n_grades, 3);
  // aux grades feed source and entity scopes
  const aux = M.gradesInForce([1, 2, 3, 4].map((i) => ({ id: i, universe_id: "u1", pipeline: "aux", item_id: i, source_key: "syn_x", entity_key: "syn_entity", grade_id: 1, score: 75, owner_score: 1, created_at: daysAgo(0) })), { now: NOW });
  const ao = M.computeOffsets(aux);
  assert.equal(ao.get(M.scopeId("aux", "source", "syn_x")).points, -4);
  assert.equal(ao.get(M.scopeId("aux", "entity", "syn_entity")).points, top(ex(4)));
  assert.equal(ao.size, 2);
});

test("T4: legacy labels count at their range-edge distance; directional labels as 10", () => {
  assert.equal(M.residualOf({ label: "medium", score: 55 }), 5);
  assert.equal(M.residualOf({ label: "medium", score: 75 }), 0);
  assert.equal(M.residualOf({ label: "low", score: 80 }), -11);
  assert.equal(M.residualOf({ label: "noise", score: 40 }), -11);
  assert.equal(M.residualOf({ label: "high", score: 60 }), 20);
  assert.equal(M.residualOf({ label: "too_high", score: 60 }), -10);
  assert.equal(M.residualOf({ label: "too_low", score: 60 }), 10);
  assert.equal(M.residualOf({ owner_score: 85, label: "medium", score: 60 }), 25);
  for (const bad of [{ label: "high", score: null }, { owner_score: 85 }, { label: "probe", score: 50 }, { owner_score: 0, score: 50 }]) {
    assert.equal(M.residualOf(bad), null);
  }
  // a single legacy label never opens tuning
  const one = M.gradesInForce([row({ id: 1, item_id: 1, label: "noise", score: 75 })], { now: NOW });
  assert.equal(M.computeOffsets(one).get(M.scopeId("coverage", "source", "syn_a")).points, 0);
});

test("T4: More / Less actions are +-2 each, capped per scope, undone ones ignored, no decay", () => {
  const act = (points, o = {}) => ({ kind: "step", pipeline: "coverage", scope_kind: "source", scope_key: "syn_a", points, undone_at: null, ...o });
  const id = M.scopeId("coverage", "source", "syn_a");
  assert.equal(M.computeOffsets([], [act(-2)]).get(id).points, -2);
  assert.equal(M.computeOffsets([], [act(-2), act(-2), act(-2), act(-2)]).get(id).points, -TUNE.CAP.source);
  assert.equal(M.computeOffsets([], [act(-2), act(-2, { undone_at: daysAgo(0) })]).get(id).points, -2);
  assert.equal(M.computeOffsets([], [act(2), act(2), act(2), act(2)]).get(id).points, TUNE.CAP.source);
  const topic = { kind: "step", pipeline: "coverage", scope_kind: "topic", scope_key: "TST:contract", points: -2, undone_at: null };
  assert.equal(M.computeOffsets([], [topic, topic, topic]).get(M.scopeId("coverage", "topic", "TST:contract")).points, -TUNE.CAP.topic);
  // a "Less" is confirmed: it may cross the line; a "More" never lowers conf
  const less = M.computeOffsets([], [act(-2)]).get(id);
  assert.deepEqual([less.points, less.conf], [-2, -2]);
  assert.equal(M.computeOffsets([], [act(2)]).get(id).conf, 0);
  // delivery and switch actions are not scope offsets
  assert.equal(M.computeOffsets([], [{ kind: "step", scope_kind: "delivery", scope_key: "brief_floor", points: 2 }]).size, 0);
});

test("T4: conf is the confirmed part of the grade-derived offset (a magnitude, never more than the offset)", () => {
  const g4 = ex(4);
  assert.deepEqual(pick(M.scopeOffset(g4)), { points: -4, conf: 0 });
  assert.deepEqual(pick(M.scopeOffset(g4, { confirms: [-4] })), { points: -4, conf: -4 });
  assert.deepEqual(pick(M.scopeOffset(ex(5), { confirms: [-4] })), { points: -6, conf: -4 });
  assert.deepEqual(pick(M.scopeOffset(ex(3), { confirms: [-4] })), { points: -1.8, conf: -1.8 });
  assert.deepEqual(pick(M.scopeOffset(ex(4, 99), { confirms: [-4] })), { points: 4, conf: 0 });
  assert.deepEqual(pick(M.scopeOffset(g4, { steps: [-2], confirms: [-1] })), { points: -6, conf: -3 });
});
const pick = (o) => ({ points: o.points, conf: o.conf });

const deps = {
  isOfficialRecord,
  officialHostRe: OFFICIAL_HOST_RE,
  isRegisterSource: (k) => k === "syn_register",
  isOwnChannel: (k) => k === "syn_own",
};

test("T5: protection: records, government hosts, registers, own channels and floor flags", () => {
  const yes = [
    { source_key: "edgar_syn" },
    { source_key: "syn_a", url: "https://www.sec.gov/Archives/example" },
    { source_key: "syn_a", url: "https://x.gov/a" },
    { source_key: "syn_a", url: "https://x.mil/a" },
    { source_key: "syn_a", url: "https://x.gov.uk/a" },
    { source_key: "syn_a", url: "https://a.legistar.com/View.ashx" },
    { source_key: "syn_a", url: "https://www.canada.ca/en" },
    { source_key: "syn_a", url: "https://fmv.se/x" },
    { source_key: "syn_a", url: "https://EXAMPLE.GOV:8443/a" },
    { source_key: "syn_register" },
    { source_key: "syn_own" },
    { source_key: "syn_a", flags: '["floor:primary_record"]' },
    { source_key: "syn_a", flags: ["floor:primary_record"] },
  ];
  const no = [
    { source_key: "syn_a", url: "https://gov.example.com/a" },
    { source_key: "syn_a", url: "https://example.com/x.gov" },
    { source_key: "syn_a", url: "https://example.com/a", flags: '["no_figures"]' },
    { source_key: "syn_a" },
  ];
  for (const r of yes) assert.equal(M.isProtected(r, deps), true, JSON.stringify(r));
  for (const r of no) assert.equal(M.isProtected(r, deps), false, JSON.stringify(r));
  assert.equal(M.isProtected({ source_key: "syn_a" }, { ...deps, hasHardId: () => true }), true);
  assert.equal(M.hostOf("https://Example.GOV:8443/a"), "example.gov");
  assert.equal(M.hostOf("no scheme"), "");
});

test("T5: placement: Lead floor, no new Leads, owner grade replaces, protected never down", () => {
  const p = (score, points, conf = 0, o = {}) => M.placement({ score, ...o }, { points, conf }).p;
  assert.equal(p(92, -8), 90);
  assert.equal(p(85, 8), 89);
  assert.equal(p(89, 2), 89);
  assert.equal(p(95, 3), 98);
  assert.equal(p(60, -8), 52);
  assert.equal(p(60, 12), 68); // card cap 8
  assert.equal(p(72, -8, 0, { protected: true }), 72);
  assert.equal(p(72, 4, 0, { protected: true }), 76);
  assert.equal(p(50, -8, -8, { protected: true }), 50);
  assert.deepEqual(M.placement({ score: 40, owner_score: 95 }, { points: -8, conf: -8 }), { p: 95, tuned: 0, held: false, owner: true });
  assert.equal(M.placement({ score: 95, owner_score: 20 }, { points: 0, conf: 0 }).p, 20);
  assert.deepEqual(M.placement({ score: null }, { points: -8, conf: 0 }), { p: null, tuned: 0, held: false, owner: false });
  // the line guard: grade-derived moves stop at 70; confirmed points may cross
  assert.deepEqual(M.placement({ score: 74 }, { points: -8, conf: 0 }), { p: 70, tuned: -4, held: true, owner: false });
  assert.deepEqual(M.placement({ score: 74 }, { points: -8, conf: -6 }), { p: 68, tuned: -6, held: true, owner: false });
  assert.deepEqual(M.placement({ score: 74 }, { points: -8, conf: -8 }), { p: 66, tuned: -8, held: false, owner: false });
  assert.equal(M.placement({ score: 74 }, { points: -8, conf: 0 }, { guard: false }).p, 66);
  assert.equal(p(69, -8), 61); // below the line already: no guard
  assert.equal(p(70, -2), 70);
});

// T6: a synthetic 14-day window, 40 cards over 5 sources, many at 70-77,
// topics shared across sources. Grades of 1 on syn_a's six lowest cards, each
// feeding source syn_a and topic TST:contract.
const C = (source_key, score, ticker, event_type, extra = {}) => ({ source_key, score, ticker, event_type, pipeline: "coverage", ...extra });
const WINDOW = [
  // syn_a: the six graded cards (lowest first), then four others
  C("syn_a", 30, "TST", "contract"), C("syn_a", 35, "TST", "contract"), C("syn_a", 40, "TST", "contract"),
  C("syn_a", 45, "TST", "contract"), C("syn_a", 50, "TST", "contract"), C("syn_a", 55, "TST", "contract"),
  C("syn_a", 70, "TST", "contract"), C("syn_a", 72, "TST", "product"), C("syn_a", 76, "TST", "contract"), C("syn_a", 88, "TSTB", "filing"),
  // syn_b: shares TST:contract; a Lead, a floor-flagged card and a gov-hosted card
  C("syn_b", 70, "TST", "contract"), C("syn_b", 71, "TST", "contract"), C("syn_b", 74, "TST", "contract"), C("syn_b", 77, "TSTB", "contract"),
  C("syn_b", 92, "TST", "contract"), C("syn_b", 60, "TST", "contract"), C("syn_b", 73, "TST", "contract", { flags: '["floor:primary_record"]' }),
  C("syn_b", 71, "TST", "contract", { url: "https://agency.example.gov/notice" }),
  // syn_c, syn_d, syn_e: other topics, some TST:contract
  C("syn_c", 70, "TSTB", "contract"), C("syn_c", 71, "TSTB", "contract"), C("syn_c", 72, "TST", "contract"), C("syn_c", 73, "TSTB", "filing"),
  C("syn_c", 75, "TST", "product"), C("syn_c", 77, "TSTB", "contract"), C("syn_c", 45, "TST", "contract"), C("syn_c", 65, "TSTB", "filing"),
  C("syn_d", 70, "TST", "product"), C("syn_d", 72, "TSTB", "contract"), C("syn_d", 74, "TST", "contract"), C("syn_d", 76, "TSTB", "filing"),
  C("syn_d", 90, "TSTB", "contract"), C("syn_d", 68, "TST", "contract"), C("syn_d", 50, "TSTB", "filing"),
  C("syn_e", 71, "TST", "product"), C("syn_e", 73, "TSTB", "contract"), C("syn_e", 75, "TSTB", "filing"), C("syn_e", 77, "TST", "product"),
  C("syn_e", 70, "TST", "contract", { source_key: "edgar_syn" }), C("syn_e", 40, "TSTB", "filing"), C("syn_e", 85, "TST", "product"),
].map((c, i) => ({ ...c, item_id: i + 1, url: c.url || `https://example.com/${i + 1}` }))
  .map((c) => ({ ...c, protected: M.isProtected(c, deps) }));
const GRADED = WINDOW.slice(0, 6);
const OTHERS = WINDOW.slice(6);
const gradeRows = (k) => GRADED.slice(0, k).map((c, i) => ({ id: i + 1, universe_id: "u1", pipeline: "coverage", item_id: c.item_id, ticker: c.ticker, created_at: daysAgo(0), grade_id: 100 + i, score: c.score, owner_score: 1, source_key: c.source_key, event_type: c.event_type }));
const offsetsAt = (k, actions = []) => M.computeOffsets(M.gradesInForce(gradeRows(k), { now: NOW }), actions);
const SRC_ID = M.scopeId("coverage", "source", "syn_a");
const TOPIC_ID = M.scopeId("coverage", "topic", "TST:contract");

test("T6 fixture: 40 cards over 5 sources, protection resolved", () => {
  assert.equal(WINDOW.length, 40);
  assert.equal(new Set(WINDOW.map((c) => c.source_key.replace(/^edgar_syn$/, "syn_e"))).size, 5);
  assert.equal(WINDOW.filter((c) => c.protected).length, 3);
});

test("T6: six owner grades (each 1) on one source: two grades move nothing; the line holds every unprotected 70+ card; each grade moves a card by at most 4.8", () => {
  // held_at_line by hand: an unprotected card scored 70+ whose source + topic
  // adjustment would take it under 70. Offsets per grade: source 0, 0, -1.8,
  // -4, -6, -6; topic TST:contract 0, 0, -1.3, -2.7, -4, -4 (cap 4; card cap 8).
  //   grade 3: syn_a 70 (-3.1); syn_b 70, 71 (-1.3)                       -> 3
  //   grade 4: syn_a 70, 72 (-4), 76 (-6.7); syn_b 70, 71, syn_c 72 (-2.7) -> 6
  //   grade 5: syn_a 70, 72 (-6), 76 (-8); syn_b 70, 71 (-4), syn_c 72 (-4) -> 6
  //   grade 6: as grade 5                                                 -> 6
  const handHeld = [0, 0, 3, 6, 6, 6];
  const expect = {
    src: [0, 0, -1.8, -4, -6, -6],
    topic: [0, 0, -1.3, -2.7, -4, -4],
  };
  const baseline = new Map();
  let prev = baseline;
  for (let k = 1; k <= 6; k++) {
    const off = offsetsAt(k);
    assert.equal(off.get(SRC_ID).points, expect.src[k - 1], `source at grade ${k}`);
    assert.equal(off.get(TOPIC_ID).points, expect.topic[k - 1], `topic at grade ${k}`);
    const vsBase = M.compareOffsets(OTHERS, off, baseline);
    if (k <= 2) assert.equal(vsBase.max_move, 0, `grade ${k} moved a card`);
    for (const c of OTHERS) {
      const { p } = M.placement(c, off);
      if (!c.protected && c.score >= TUNE.LINE) assert.ok(p >= TUNE.LINE, `grade ${k}: ${c.source_key} ${c.score} -> ${p}`);
      if (c.protected) assert.ok(p >= c.score, `grade ${k}: protected moved down`);
      if (c.score >= TUNE.LEAD) assert.ok(p >= TUNE.LEAD, `grade ${k}: a Lead left the Lead band`);
      if (c.score < TUNE.LEAD) assert.ok(p < TUNE.LEAD, `grade ${k}: tuning made a Lead`);
    }
    assert.equal(vsBase.held_at_line, handHeld[k - 1], `held at grade ${k}`);
    assert.equal(vsBase.left, 0);
    assert.equal(vsBase.crossed_unconfirmed, 0);
    assert.equal(vsBase.leads_affected, 0);
    const step = M.compareOffsets(OTHERS, off, prev);
    assert.ok(step.max_move <= TUNE.MAX_STEP.card, `grade ${k} step ${step.max_move}`);
    for (const c of OTHERS) {
      const d = Math.abs(M.placement(c, off, { guard: false }).p - M.placement(c, prev, { guard: false }).p);
      assert.ok(d <= TUNE.MAX_STEP.card + 1e-9, `grade ${k} unguarded step ${d}`);
    }
    prev = off;
  }
  // the protected cards saw a down move and held
  assert.equal(M.compareOffsets(OTHERS, offsetsAt(6)).protected_held, 3);
});

test("T6: Confirm lets the held cards drop to score + conf; a later strengthening is held again", () => {
  const at4 = offsetsAt(4);
  const held4 = OTHERS.filter((c) => M.placement(c, at4).held);
  assert.equal(held4.length, 6);
  const confirm = (id, points) => {
    const [pipeline, scope_kind, scope_key] = id.split("|");
    return { kind: "confirm", pipeline, scope_kind, scope_key, points, undone_at: null };
  };
  const actions = [confirm(SRC_ID, at4.get(SRC_ID).points), confirm(TOPIC_ID, at4.get(TOPIC_ID).points)];
  const c4 = offsetsAt(4, actions);
  assert.equal(M.compareOffsets(OTHERS, c4).held_at_line, 0);
  for (const c of held4) {
    const { conf } = M.cardOffsets(c, c4);
    const r = M.placement(c, c4);
    assert.equal(r.p, M.round1(c.score + conf));
    assert.ok(r.p < TUNE.LINE);
    assert.equal(r.held, false);
  }
  // grade 5 strengthens both scopes past the confirmed magnitude: held again
  const c5 = offsetsAt(5, actions);
  assert.deepEqual([c5.get(SRC_ID).points, c5.get(SRC_ID).conf], [-6, -4]);
  assert.deepEqual([c5.get(TOPIC_ID).points, c5.get(TOPIC_ID).conf], [-4, -2.7]);
  const r = M.compareOffsets(OTHERS, c5);
  assert.ok(r.held_at_line > 0);
  assert.equal(r.crossed_unconfirmed, 0);
  const a76 = OTHERS.find((c) => c.source_key === "syn_a" && c.score === 76);
  assert.deepEqual(M.placement(a76, c5), { p: 69.3, tuned: -6.7, held: true, owner: false });
  // an undone confirm no longer counts
  const undone = actions.map((a) => ({ ...a, undone_at: daysAgo(0) }));
  assert.equal(M.compareOffsets(OTHERS, offsetsAt(4, undone)).held_at_line, 6);
});

test("T6: a Less moves cards below 70 (it is a confirmed move); the same points from grades are held", () => {
  const less = { kind: "step", pipeline: "coverage", scope_kind: "source", scope_key: "syn_c", points: -2, undone_at: null };
  const off = M.computeOffsets([], [less]);
  const c70 = OTHERS.find((c) => c.source_key === "syn_c" && c.score === 70);
  assert.equal(M.placement(c70, off).p, 68);
  assert.equal(M.placement(c70, { points: -2, conf: 0 }).p, 70);
  const r = M.compareOffsets(OTHERS, off);
  assert.equal(r.left, 2); // syn_c 70 and 71
  assert.equal(r.crossed_unconfirmed, 0);
  assert.equal(r.changed.length, 8);
});

test("T6: boosts never make a Lead and never lift a card past 89", () => {
  const boost = M.computeOffsets(M.gradesInForce(GRADED.map((c, i) => ({ ...gradeRows(6)[i], owner_score: 95 })), { now: NOW }));
  assert.equal(boost.get(SRC_ID).points, 6);
  for (const c of OTHERS) {
    const { p } = M.placement(c, boost);
    if (c.score < TUNE.LEAD) assert.ok(p <= TUNE.LEAD - 1 && p >= c.score);
  }
});

test("delivery values: defaults, bounds, push floor only rises, the placement switch", () => {
  const d = (scope_key, points, o = {}) => ({ kind: scope_key === "placement" ? "switch" : "step", scope_kind: "delivery", scope_key, points, undone_at: null, ...o });
  assert.deepEqual(M.deliveryValues([]), { brief_floor: 70, push_floor: 90, placement_on: true });
  assert.equal(M.deliveryValues([d("brief_floor", 2), d("brief_floor", 2)]).brief_floor, 74);
  assert.equal(M.deliveryValues(Array.from({ length: 9 }, (_, i) => d("brief_floor", -2, { id: i }))).brief_floor, 60);
  assert.equal(M.deliveryValues(Array.from({ length: 9 }, (_, i) => d("brief_floor", 2, { id: i }))).brief_floor, 80);
  assert.equal(M.deliveryValues([d("push_floor", -1)]).push_floor, 90);
  assert.equal(M.deliveryValues(Array.from({ length: 8 }, (_, i) => d("push_floor", 1, { id: i }))).push_floor, 95);
  assert.equal(M.deliveryValues([d("placement", -1, { id: 1 })]).placement_on, false);
  assert.equal(M.deliveryValues([d("placement", 1, { id: 1 }), d("placement", -1, { id: 2 }), d("placement", 1, { id: 3 })]).placement_on, true);
  // value = clip(default + sum of live steps): 1 + 1 + 1 - 1 = 2, clipped to 1 (on)
  assert.equal(M.deliveryValues([d("placement", 1, { id: 1 }), d("placement", 1, { id: 2 }), d("placement", -1, { id: 3 })]).placement_on, true);
  assert.equal(M.deliveryValues([d("placement", -1, { id: 1, undone_at: daysAgo(0) })]).placement_on, true);
  assert.equal(M.deliveryValues([d("other_key", 5)]).brief_floor, 70);
});

test("delivery values: default + sum of live steps, clipped, whatever the order and whichever action is undone", () => {
  const d = (scope_key, points, id, undone = false) => ({ id, kind: scope_key === "placement" ? "switch" : "step", scope_kind: "delivery", scope_key, points, undone_at: undone ? daysAgo(0) : null });
  // off, on, off, then the first off is undone: live steps +1, -1 on the default 1 = 1 -> on
  const sw = [d("placement", -1, 1, true), d("placement", 1, 2), d("placement", -1, 3)];
  assert.equal(M.deliverySums(sw).placement, 1);
  assert.equal(M.deliveryValues(sw).placement_on, true);
  // brief floor: -2, then +2 six times, then -2, then the first -2 undone: 70 + 12 - 2 = 80
  const bf = [d("brief_floor", -2, 1, true), ...Array.from({ length: 6 }, (_, i) => d("brief_floor", 2, 2 + i)), d("brief_floor", -2, 8)];
  assert.equal(M.deliverySums(bf).brief_floor, 80);
  assert.equal(M.deliveryValues(bf).brief_floor, 80);
  // order never matters
  const mixed = [d("brief_floor", 2, 1), d("brief_floor", -2, 2), d("brief_floor", 2, 3), d("push_floor", 1, 4), d("push_floor", -1, 5)];
  assert.deepEqual(M.deliveryValues(mixed), M.deliveryValues([...mixed].reverse()));
  // push floor: a negative step is dropped before the sum
  assert.equal(M.deliverySums(mixed).push_floor, 91);
  assert.deepEqual(M.deliverySums([]), { brief_floor: 70, push_floor: 90, placement: 1 });
  // the unclipped sum can sit outside the bounds; the value never does
  const over = Array.from({ length: 9 }, (_, i) => d("brief_floor", 2, i));
  assert.equal(M.deliverySums(over).brief_floor, 88);
  assert.equal(M.deliveryValues(over).brief_floor, 80);
});

test("T11: tune-math.js is pure: no imports, no env, no fetch, no clock", () => {
  const s = readFileSync(new URL("../worker/src/tune-math.js", import.meta.url), "utf8");
  assert.doesNotMatch(s, /^\s*import\s/m);
  assert.doesNotMatch(s, /\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|\benv\b|Date\.now\s*\(|new Date\s*\(\s*\)/);
});
