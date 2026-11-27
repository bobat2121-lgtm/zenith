// Phase 4 Part F (P4-F2): the gentle-tuning math. Pure: no imports, no I/O,
// no clock (the caller passes `now`). Tuning changes placement only (For You
// order and floor, the brief's section floors); it never changes a stored
// score, band, flag, the grader's input or what is collected.
//
// Rules, in short:
// - One owner grade (or legacy label) gives a residual r = owner - Claude's
//   score. Grades in force are the latest per card, at most MAX_AGE_DAYS old,
//   on cards that had a grade when graded.
// - Each scope (source, coverage topic TICKER:event_type, aux entity) averages
//   its residuals with a prior of K0 zero-grades, decayed by half every H days,
//   each residual clipped to +-R, the result capped per scope kind.
// - Nothing moves until K agreeing grades (same sign, |r| >= MIN_R) are in
//   force, and the effect ramps to full over RAMP more, so one or two grades
//   never move other cards and only repeated agreeing grades accumulate.
// - A card's adjustment is source + topic/entity, capped at +-CARD_CAP; a Lead
//   stays a Lead, tuning never makes one, protected cards (official records,
//   government hosts, own channels, registers, floor-flagged items) never move
//   down, and grade-derived offsets never take a card scored at the line or
//   above below the line unless the owner confirmed that much ("conf").
// Nothing imports this module yet (P4-F3 wires it).

export const TUNE = Object.freeze({
  R: 20, // residual clip
  K0: 8, // prior weight (zero-grades) in the average
  K: 3, // agreeing grades in force before anything moves
  MIN_R: 5, // |r| below this does not count as agreeing
  RAMP: 3, // agreeing grades from first effect to full weight
  H: 30, // half-life in days
  MAX_AGE_DAYS: 120, // older grades are out of force
  CAP: Object.freeze({ source: 6, topic: 4, entity: 4 }),
  CARD_CAP: 8, // a card's total adjustment
  STEP: 2, // one "More" / "Less" action
  LINE: 70, // the necessary line (score-bands.js NECESSARY_LINE)
  LEAD: 90, // a Lead stays a Lead; tuning never makes one
  LEGACY_DIRECTIONAL: 10, // too_high / too_low as a residual
  AGREE_WITHIN: 10, // |owner - Claude| within this counts as agreement
  // Proven bounds on how far one grade can move a scope or a card
  // (test/tune-math.test.js enumerates every sequence of up to 6 grades).
  MAX_STEP: Object.freeze({ source: 2.7, topic: 2.1, entity: 2.1, card: 4.8 }),
});

// The legacy label ranges the grader reads (auxiliary.js LABEL_RANGE; the
// test asserts they stay equal). A range label's residual is the distance
// from the shown score to the range's nearest edge, 0 inside it.
export const LEGACY_RANGE = Object.freeze({ high: [80, 100], medium: [60, 89], low: [30, 69], noise: [0, 29] });

export const SCOPE_KINDS = Object.freeze(["source", "topic", "entity"]);
const DAY_MS = 86400000;

const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// One decimal, and never -0 (so deep-equal and JSON agree).
export const round1 = (x) => {
  const v = Math.round(x * 10) / 10;
  return v === 0 ? 0 : v;
};
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const isOwnerScore = (o) => Number.isInteger(o) && o >= 1 && o <= 100;
const ms = (t) => (typeof t === "number" ? t : Date.parse(t));

// Residual of one grade row: { owner_score, label, score } where score is the
// score of the grade the owner saw. null when the row cannot feed tuning.
export function residualOf(row) {
  const s = num(row?.score);
  if (s == null) return null;
  if (isOwnerScore(row?.owner_score)) return row.owner_score - s;
  const range = LEGACY_RANGE[row?.label];
  if (range) return s < range[0] ? range[0] - s : s > range[1] ? range[1] - s : 0;
  if (row?.label === "too_high") return -TUNE.LEGACY_DIRECTIONAL;
  if (row?.label === "too_low") return TUNE.LEGACY_DIRECTIONAL;
  return null;
}

export function ageDays(createdAt, now) {
  const a = ms(now) - ms(createdAt);
  return Number.isFinite(a) ? Math.max(0, a / DAY_MS) : null;
}

// The newer of two feedback rows: the higher id (rows are appended), else the
// later created_at.
const newer = (a, b) => {
  if (Number.isFinite(a.id) && Number.isFinite(b.id)) return b.id > a.id ? b : a;
  return ms(b.created_at) >= ms(a.created_at) ? b : a;
};
const cardKey = (r) => `${r.universe_id ?? ""}|${r.pipeline === "aux" ? "aux" : "coverage"}|${r.item_id}|${r.pipeline === "aux" ? "" : r.ticker ?? ""}`;

// Grades in force. rows: feedback rows of one universe, each
// { id, universe_id, pipeline: "coverage"|"aux", item_id, ticker, created_at,
//   grade_id, score, owner_score, label, source_key, event_type, entity_key }.
// The latest row per (universe, item, ticker) for coverage and per
// (universe, item) for aux counts (re-grading one card is one grade); it is in
// force when it is at most MAX_AGE_DAYS old, its card had a grade when graded
// (grade_id set) and it yields a residual. Returns those rows with r and age.
export function gradesInForce(rows, { now } = {}) {
  const latest = new Map();
  for (const row of rows || []) {
    const k = cardKey(row);
    latest.set(k, latest.has(k) ? newer(latest.get(k), row) : row);
  }
  const out = [];
  for (const row of latest.values()) {
    if (row.grade_id == null) continue;
    const age = ageDays(row.created_at, now);
    if (age == null || age > TUNE.MAX_AGE_DAYS) continue;
    const r = residualOf(row);
    if (r == null) continue;
    out.push({ ...row, pipeline: row.pipeline === "aux" ? "aux" : "coverage", r, age });
  }
  return out;
}

export const scopeId = (pipeline, kind, key) => `${pipeline}|${kind}|${key}`;

// The scopes a card (or a grade on it) feeds: its source, and its coverage
// topic (TICKER:event_type) or its aux entity.
export function scopesOf(card) {
  const pipeline = card?.pipeline === "aux" ? "aux" : "coverage";
  const out = [];
  if (card?.source_key) out.push({ pipeline, scope_kind: "source", scope_key: String(card.source_key) });
  if (pipeline === "coverage" && card?.ticker && card?.event_type) {
    out.push({ pipeline, scope_kind: "topic", scope_key: `${card.ticker}:${card.event_type}` });
  }
  if (pipeline === "aux" && card?.entity_key) out.push({ pipeline, scope_kind: "entity", scope_key: String(card.entity_key) });
  return out;
}

// One scope's offset. grades: [{ r, age }] in force on the scope; steps: the
// points of its live "step" actions (More +2 / Less -2); confirms: the points
// of its live "confirm" actions (each <= 0: how far grade-derived tuning may
// take cards at the line below it).
export function scopeOffset(grades, { kind = "source", steps = [], confirms = [] } = {}) {
  const cap = TUNE.CAP[kind] ?? TUNE.CAP.topic;
  let S = 0, W = 0;
  for (const g of grades) {
    const w = Math.pow(0.5, g.age / TUNE.H);
    S += w * clip(g.r, -TUNE.R, TUNE.R);
    W += w;
  }
  const raw = W > 0 ? clip(S / (W + TUNE.K0), -cap, cap) : 0;
  let agree = 0, nAgree = 0;
  if (raw !== 0) {
    const sign = Math.sign(raw);
    for (const g of grades) {
      if (Math.sign(g.r) === sign && Math.abs(g.r) >= TUNE.MIN_R) {
        agree += Math.pow(0.5, g.age / TUNE.H);
        nAgree++;
      }
    }
  }
  const ramp = clip((agree - (TUNE.K - 1)) / TUNE.RAMP, 0, 1);
  const fromGrades = round1(raw * ramp);
  const fromActions = round1(clip(steps.reduce((a, b) => a + (num(b) ?? 0), 0), -cap, cap));
  const points = round1(clip(fromGrades + fromActions, -cap, cap));
  const confirmed = confirms.reduce((m, c) => Math.max(m, Math.abs(num(c) ?? 0)), 0);
  const conf = round1(clip(Math.min(0, fromActions) + (fromGrades < 0 ? -Math.min(-fromGrades, confirmed) : 0), -cap, 0));
  return { points, conf, from_grades: fromGrades, from_actions: fromActions, n_grades: grades.length, n_agree: nAgree };
}

// Every scope's offset for one universe. inForce: gradesInForce(...) output.
// actions: tune_actions rows { kind, pipeline, scope_kind, scope_key, points,
// undone_at }; only live ones (undone_at null) count. An item graded under
// two tickers counts once for its source (its latest row) and once per topic.
// Returns a Map scopeId -> { pipeline, scope_kind, scope_key, ...scopeOffset }.
export function computeOffsets(inForce, actions = []) {
  const per = new Map();
  const slot = (s) => {
    const id = scopeId(s.pipeline, s.scope_kind, s.scope_key);
    if (!per.has(id)) per.set(id, { ...s, grades: [], steps: [], confirms: [] });
    return per.get(id);
  };
  const bySourceItem = new Map();
  for (const g of inForce) {
    for (const s of scopesOf(g)) {
      if (s.scope_kind === "source") {
        const k = `${g.universe_id ?? ""}|${g.pipeline}|${g.item_id}`;
        bySourceItem.set(k, bySourceItem.has(k) ? newer(bySourceItem.get(k), g) : g);
      } else slot(s).grades.push(g);
    }
  }
  for (const g of bySourceItem.values()) {
    const s = scopesOf(g).find((x) => x.scope_kind === "source");
    slot(s).grades.push(g);
  }
  for (const a of actions || []) {
    if (a?.undone_at != null || !SCOPE_KINDS.includes(a?.scope_kind) || a?.scope_key == null) continue;
    const s = { pipeline: a.pipeline === "aux" ? "aux" : "coverage", scope_kind: a.scope_kind, scope_key: String(a.scope_key) };
    if (a.kind === "step") slot(s).steps.push(a.points);
    else if (a.kind === "confirm") slot(s).confirms.push(a.points);
  }
  const out = new Map();
  for (const [id, s] of per) {
    const o = scopeOffset(s.grades, { kind: s.scope_kind, steps: s.steps, confirms: s.confirms });
    out.set(id, { pipeline: s.pipeline, scope_kind: s.scope_kind, scope_key: s.scope_key, ...o });
  }
  return out;
}

// A card's summed adjustment and confirmed part from its scopes' offsets.
export function cardOffsets(card, offsets) {
  let points = 0, conf = 0;
  for (const s of scopesOf(card)) {
    const o = offsets?.get(scopeId(s.pipeline, s.scope_kind, s.scope_key));
    if (o) { points += o.points; conf += o.conf; }
  }
  return { points: round1(points), conf: round1(conf) };
}

// Placement of one card. card: { score (Claude's), owner_score (in force on
// this card, or null), protected (isProtected), ...scope fields }. With an
// owner grade the owner's number is the placement. guard: false gives the
// placement without the line guard (for counting what the guard holds).
// Returns { p, tuned (p - score), held (the line guard raised p) }.
export function placement(card, offsets, { guard = true } = {}) {
  if (isOwnerScore(card?.owner_score)) return { p: card.owner_score, tuned: 0, held: false, owner: true };
  const s = num(card?.score);
  if (s == null) return { p: null, tuned: 0, held: false, owner: false };
  const { points, conf } = offsets instanceof Map ? cardOffsets(card, offsets) : { points: num(offsets?.points) ?? 0, conf: num(offsets?.conf) ?? 0 };
  const prot = card.protected === true;
  let a = clip(points, -TUNE.CARD_CAP, TUNE.CARD_CAP);
  const f = clip(conf, -TUNE.CARD_CAP, 0);
  if (prot) a = Math.max(a, 0);
  let p = s + a;
  // A Lead stays a Lead; tuning never makes one (grader scores are integers).
  p = s >= TUNE.LEAD ? Math.max(p, TUNE.LEAD) : Math.min(p, TUNE.LEAD - 1);
  const p0 = p;
  if (guard && s >= TUNE.LINE && !prot && p < TUNE.LINE) p = Math.max(p, Math.min(TUNE.LINE, s + f));
  const held = p > p0;
  p = round1(p);
  return { p, tuned: round1(p - s), held, owner: false };
}

// The host as the For You SQL reads it: lower-cased, between "://" and the
// next "/" or ":".
export function hostOf(url) {
  const u = String(url ?? "");
  const i = u.indexOf("://");
  if (i < 0) return "";
  const rest = u.slice(i + 3);
  const j = rest.search(/[/:]/);
  return (j < 0 ? rest : rest.slice(0, j)).toLowerCase();
}

// A "floor:" grader flag (flags as an array, or the stored JSON text).
export function hasFloorFlag(flags) {
  if (Array.isArray(flags)) return flags.some((f) => String(f).startsWith("floor:"));
  return typeof flags === "string" && flags.includes('"floor:');
}

// Protected cards are never tuned down. The record and channel tests live in
// records.js and the catalogs, which this pure module does not import; the
// caller passes them: { isOfficialRecord(row), isRegisterSource(key),
// isOwnChannel(key), officialHostRe, hasHardId(row) (Part A, once
// item_entities exists) }.
export function isProtected(row, deps = {}) {
  if (deps.isOfficialRecord?.(row)) return true;
  if (deps.isRegisterSource?.(row?.source_key)) return true;
  if (deps.isOwnChannel?.(row?.source_key)) return true;
  const host = hostOf(row?.url);
  if (host && deps.officialHostRe?.test(host)) return true;
  if (hasFloorFlag(row?.flags)) return true;
  if (deps.hasHardId?.(row)) return true;
  return false;
}

// What one set of offsets does to a window of cards, against another
// (before = no tuning by default). Counts at the line, and the cards whose
// placement changed. cards: placement inputs (protected already resolved).
export function compareOffsets(cards, after, before = new Map(), { line = TUNE.LINE, limit = 20 } = {}) {
  const res = { entered: 0, left: 0, held_at_line: 0, crossed_unconfirmed: 0, leads_affected: 0, protected_held: 0, max_move: 0, changed: [], held_by_scope: new Map() };
  for (const c of cards) {
    const a = placement(c, after), b = placement(c, before);
    if (a.p == null) continue;
    const move = Math.abs(a.p - b.p);
    if (move > res.max_move) res.max_move = round1(move);
    if (b.p < line && a.p >= line) res.entered++;
    if (b.p >= line && a.p < line) res.left++;
    if (a.held) {
      res.held_at_line++;
      for (const s of scopesOf(c)) {
        const o = after.get(scopeId(s.pipeline, s.scope_kind, s.scope_key));
        if (o && o.points < o.conf) {
          const id = scopeId(s.pipeline, s.scope_kind, s.scope_key);
          res.held_by_scope.set(id, (res.held_by_scope.get(id) || 0) + 1);
        }
      }
    }
    if (!a.owner && c.score >= TUNE.LEAD && a.p < TUNE.LEAD) res.leads_affected++;
    if (!a.owner && !c.protected && c.score >= line && a.p < line) {
      const { conf } = cardOffsets(c, after);
      if (a.p < Math.min(line, c.score + clip(conf, -TUNE.CARD_CAP, 0))) res.crossed_unconfirmed++;
    }
    if (!a.owner && c.protected && cardOffsets(c, after).points < 0) res.protected_held++;
    if (move > 0 && res.changed.length < limit) res.changed.push({ card: c, before: b.p, after: a.p });
  }
  return res;
}

// Delivery settings (scope_kind "delivery"): value = clip(default + the sum
// of its live steps, min, max); no decay, and order does not matter, so an
// undo of any earlier action gives the same value as never having taken it.
// push_floor only rises (a negative step on it is dropped). placement is the
// no-deploy switch (on by default; a -1 switch turns tuning's placement off,
// +1 back on).
export const DELIVERY = Object.freeze({
  brief_floor: Object.freeze({ default: 70, min: 60, max: 80, step: 2, raiseOnly: false }),
  push_floor: Object.freeze({ default: 90, min: 90, max: 95, step: 1, raiseOnly: true }),
  placement: Object.freeze({ default: 1, min: 0, max: 1, step: 1, raiseOnly: false }),
});
// default + sum of live steps per key, before the clip. The action route's cap
// check reads this (a step is accepted only when it changes the clipped value).
export function deliverySums(actions = []) {
  const out = {};
  for (const [k, d] of Object.entries(DELIVERY)) out[k] = d.default;
  for (const a of actions || []) {
    if (a?.undone_at != null || a?.scope_kind !== "delivery" || !Object.hasOwn(DELIVERY, a?.scope_key)) continue;
    const step = num(a.points) ?? 0;
    if (DELIVERY[a.scope_key].raiseOnly && step < 0) continue;
    out[a.scope_key] += step;
  }
  return out;
}
export function deliveryValues(actions = []) {
  const sums = deliverySums(actions);
  const v = (k) => clip(sums[k], DELIVERY[k].min, DELIVERY[k].max);
  return { brief_floor: v("brief_floor"), push_floor: v("push_floor"), placement_on: v("placement") === 1 };
}
