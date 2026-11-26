// Pure helpers shared by the router, ingest and tests (no Worker globals).
import { COVERED_NAMES } from "./rubric.generated.js";

export const BANDS = [
  { band: "lead", min: 90 },
  { band: "digest", min: 70 },
  { band: "borderline", min: 40 },
  { band: "reject", min: 0 },
];
// Analyst labels: absolute ranges (high/medium/low/noise) and directional ones
// (too_high/too_low: the score shown when labelled should have been lower/higher).
export const LABELS = ["high", "medium", "low", "noise", "too_high", "too_low"];
// Why a label was given (migration 0011): optional, valid with any label.
// missed_detail is "too low": the grader missed a figure.
export const LABEL_REASONS = ["not_material", "duplicate", "wrong_company", "stale", "marketing", "not_my_focus", "missed_detail"];
// body.reason -> { ok: true, reason (null when absent) } or { ok: false, error }.
export function labelReason(body) {
  const v = body?.reason;
  if (v === undefined || v === null || v === "") return { ok: true, reason: null };
  const reason = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!LABEL_REASONS.includes(reason)) return { ok: false, error: `reason must be one of ${LABEL_REASONS.join(", ")} (or left out)` };
  return { ok: true, reason };
}
// GET /v1/feed and /v1/aux/feed sort=to_label (Z10): graded, unlabeled cards first seen in the last
// TO_LABEL_DAYS days, the most teaching value first: confidence under 0.6,
// then scores 60-79 nearest the Digest line (70), then the rest by score.
// No pinning and no paging (next_before_id is null); limit is honored.
export const TO_LABEL_DAYS = 14;
export const TO_LABEL_ORDER = `CASE WHEN g.confidence < 0.6 THEN 0 WHEN g.score BETWEEN 60 AND 79 THEN 1 ELSE 2 END,
      CASE WHEN g.confidence < 0.6 THEN 0 WHEN g.score BETWEEN 60 AND 79 THEN abs(g.score - 70) ELSE 0 END, g.score DESC`;
// For You (Z13): the owner's latest label overrides placement. `score` is the
// For You score SQL (demotion applied), `label` the SQL of the card's latest
// label (the newest feedback row, as the feed's label field). High: always in
// For You whatever the score or state, ranked as max(score, 90), an ungraded
// card as 90, so a recent one pins with the Leads. Noise: never in For You.
// The feed's other hides (muted source, duplicate, covered name, universe) still apply.
export const PICK_SCORE = 90;
export function ownerRank(score, label) {
  const high = `(${label} IS 'high')`;
  return {
    high,
    noise: `(${label} IS 'noise')`,
    score: `(CASE WHEN ${high} THEN MAX(COALESCE(${score}, ${PICK_SCORE}), ${PICK_SCORE}) ELSE ${score} END)`,
  };
}
// owner_pick on a For You card: shown only because of the owner's High (no
// score, or a For You score under the Signal floor).
export function ownerPick(row, minScore, demotePoints) {
  if (minScore == null || row.label !== "high") return 0;
  return row.score == null || row.score - (row.demoted ? demotePoints : 0) < minScore ? 1 : 0;
}
// Rival twins (auxiliary.js auxFeed): one news-monitor row stored in both
// pipelines. `a` is the SQL alias (or table name) of the aux_items row.
// rivalDropped: its coverage copy was dropped by the key-account gate, so a
// 'covered' aux grade still shows. rivalOnCoverage: its coverage copy is shown
// (a rival row the gate keeps), so the aux copy is hidden. Shared with the
// headline pass (headlines.js), so a card gets a headline exactly when it shows.
export const rivalDroppedSql = (a) => `EXISTS (SELECT 1 FROM items c WHERE c.nm_rowid = ${a}.nm_rowid AND c.state = 'skipped'
      AND c.skip_reason = 'rival_no_key_account')`;
export const rivalOnCoverageSql = (a) => `EXISTS (SELECT 1 FROM items c WHERE c.nm_rowid = ${a}.nm_rowid AND c.state != 'skipped' AND c.role = 'rival')`;
// The aux band hides of the feed: duplicate always; covered unless its rival
// twin was gate-dropped; and every copy whose rival twin is on Coverage.
export const auxBandShownSql = (a, band) =>
  `(${band} IS NULL OR ${band} != 'duplicate') AND (${band} IS NULL OR ${band} != 'covered' OR ${rivalDroppedSql(a)}) AND NOT ${rivalOnCoverageSql(a)}`;
export const MAX_CLAIM = 60;
// Phase 0 gates: a row the arrival gate (or an admin rescue) admitted waits,
// held, until the daily grading budget releases it (budget.js). Held rows are
// pending but never claimable, and never counted as waiting. `a` is the SQL
// alias prefix ("i.") or "".
export const HELD_SQL = (a = "") => `(${a}admit IS NOT NULL AND ${a}released_at IS NULL)`;
export const LEASE_MINUTES = 45;
export const MAX_ATTEMPTS = 4;
export const STALE_DAYS = 14;

// Phase 0 gates (e): an item with no published date can never show as a fresh
// Lead. A score of 90 or more on an undated item is stored as UNDATED_CAP
// (89, Digest) with the flag undated_capped_from_<score>. It overrides the
// floors (buyout, lead_order, deal_transformational at 90 included): the
// event's date is unknown, so the card cannot be shown as new. The owner's
// High still pins it (ownerRank). Returns the score to store; pushes the flag
// onto flags.
export const UNDATED_CAP = 89;
export function capUndated(score, published, flags) {
  if (score == null || Number.isFinite(Date.parse(published || ""))) return score;
  if (score >= 90) {
    flags.push(`undated_capped_from_${score}`);
    return UNDATED_CAP;
  }
  return score;
}

export function bandFor(score) {
  for (const b of BANDS) if (score >= b.min) return b.band;
  return "reject";
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

// SQL subquery of the covered tickers, for "still in the universe" filters. A
// name dropped from coverage (SSTI and REKR on 2026-11-18) keeps its rows and
// grades in zenith-db but leaves the app feed and the phone page. The tickers
// come from covered.json at build time and are checked here, so they are
// inlined rather than bound (no parameter order to keep, no D1 parameter cost).
export function universeSql(tickers) {
  const ok = (tickers || []).filter((t) => typeof t === "string" && /^[A-Z][A-Z0-9.]{0,9}$/.test(t));
  return `(SELECT value FROM json_each('${JSON.stringify(ok)}'))`;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// Constant-time token comparison.
export function tokenMatches(presented, expected) {
  if (!presented || !expected) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Returns the role ("admin" | "grader" | "app") for a request, or null.
export function roleFor(request, env) {
  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (tokenMatches(presented, env.ADMIN_TOKEN)) return "admin";
  if (tokenMatches(presented, env.GRADER_TOKEN)) return "grader";
  if (tokenMatches(presented, env.APP_TOKEN)) return "app";
  return null;
}

// --- Audit log (phase 1, migration 0017) ----------------------------------------
// One audit_log row per human or token action that changes state. The table is
// append-only (D1 triggers). Grader and cron writes are not audited.
//   actor: "admin" | "app" (the token's role, as the expansion decisions' by
//   field), "access:<16 hex of SHA-256 of the lowercased email>" (/m through
//   Cloudflare Access; the raw email is never stored), "access:unknown" (an
//   Access token with no email), "unknown" (a handler called without who: a
//   wiring bug). via: "token" | "access" | "internal".
export const AUDIT_ACTIONS = ["label", "source_pref", "left_out_grade", "expansion_approve", "expansion_reject", "expansion_reopen",
  "expansion_compiled", "requeue", "rescue", "recall_load", "admin_run", "grade_override"];
export const AUDIT_MAX_LIST = 500;
export const AUDIT_MAX_BYTES = 8192;
const rayOf = (request) => {
  try { return request?.headers?.get?.("cf-ray") || null; } catch { return null; }
};

export function whoFor(role, request) {
  return { actor: role, via: "token", request_id: rayOf(request) };
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// auth: mobile.js authorizeMobile's { ok, via, email }. Never throws.
export async function whoForMobile(auth, request) {
  const request_id = rayOf(request);
  if (auth?.via !== "access") return { actor: "app", via: "token", request_id };
  const email = typeof auth.email === "string" ? auth.email.trim().toLowerCase() : "";
  if (!email) return { actor: "access:unknown", via: "access", request_id };
  try {
    return { actor: `access:${(await sha256hex(email)).slice(0, 16)}`, via: "access", request_id };
  } catch {
    return { actor: "access:unknown", via: "access", request_id };
  }
}

// Every array, at the top level or one level down, keeps its first
// AUDIT_MAX_LIST entries, with <name>_total next to it holding its full length.
function capLists(v, depth = 0) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x)) {
      out[k] = x.slice(0, AUDIT_MAX_LIST);
      out[`${k}_total`] = x.length;
    } else out[k] = depth === 0 ? capLists(x, 1) : x;
  }
  return out;
}

// The stored JSON of a before or after value: null stays null; over
// AUDIT_MAX_BYTES it becomes {"clipped":true,"bytes":n}.
export function auditJson(v) {
  if (v == null) return null;
  const s = JSON.stringify(capLists(v));
  const bytes = new TextEncoder().encode(s).length;
  return bytes > AUDIT_MAX_BYTES ? JSON.stringify({ clipped: true, bytes }) : s;
}

// Writes one audit_log row, after the action it records has succeeded, as its
// own statement. It never throws (an audit failure must never fail or repeat
// the action): an unknown action is logged and writes nothing; a zenith-db
// before migration 0017 is warned about once per isolate. Callers pass ids,
// labels, statuses and counts, never note, event or title text.
let auditTableMissing = false;
export async function audit(db, who, entry) {
  let action, kind, id;
  try {
    ({ action, target_kind: kind, target_id: id = null } = entry || {});
    if (!AUDIT_ACTIONS.includes(action)) {
      console.error("audit: unknown action", action);
      return false;
    }
    if (typeof kind !== "string" || !kind) throw new Error("audit: target_kind required");
    const w = who && typeof who.actor === "string" && who.actor ? who : { actor: "unknown", via: "internal", request_id: null };
    await db.prepare(
      "INSERT INTO audit_log (at, actor, via, action, target_kind, target_id, before_json, after_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(nowIso(), w.actor, String(w.via || "internal"), action, kind, id == null ? null : String(id),
      auditJson(entry.before), auditJson(entry.after), w.request_id == null ? null : String(w.request_id)).run();
    return true;
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e))) {
      if (!auditTableMissing) { auditTableMissing = true; console.warn("audit_log missing"); }
    } else {
      console.error("audit failed", action, kind, id);
    }
    return false;
  }
}

const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, n));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strArray = (v, n = 12, len = 80) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => clip(x, len)) : [];

// Parses an output-contract item_id: "123" (the item itself) or "123#UMAC"
// (a covered-to-covered grade of item 123 for another covered ticker).
export function parseItemRef(ref) {
  const m = /^\s*(\d+)\s*(?:#\s*([A-Za-z.]+))?\s*$/.exec(String(ref ?? ""));
  return m ? { id: Number(m[1]), alsoTicker: m[2] ? m[2].toUpperCase() : null } : null;
}

// Reasons under which the grade's ticker may differ from the item's ticker.
const MISMATCH_OK = ["reason:off_entity", "reason:out_of_scope", "reason:source_quality", "reason:stale"];
// core.md section 10: exactly one reason flag from this list.
export const REASONS = ["material", "primary_source", "new_information", "calendar_card", "below_materiality", "stale",
  "late_repost", "already_covered", "duplicate", "insufficient_evidence", "source_quality", "off_entity", "out_of_scope", "promotional"];

// --- Floors (core.md section 6) -----------------------------------------------
// parseFloors lives in floors.js (no imports), so scripts/build-rubric.mjs can
// use it to bundle a candidate rubric's floors; re-exported here unchanged.
export { parseFloors } from "./floors.js";

// Floors never rescue these (core.md section 6), and a late first sighting is
// capped at 79 instead (section 8), so no floor is enforced for them.
const NO_FLOOR_REASONS = ["stale", "off_entity", "duplicate", "already_covered", "late_repost"];
const NO_FLOOR_FLAGS = ["late_first_sighting", "archive_burst"];
// floor:investor_day needs the company's own words (core.md section 6).
export const INVESTOR_DAY_RE = /\b(?:investor|analyst)s?['’]?[\s-]+days?\b/i;
// core.md section 5: unread SEC grades cap at 55 unless a floor applies by identifier.
export const SEC_UNREAD_CAP = 55;
const SEC_UNREAD_CONFIDENCE = 0.4;

export function isSecItem(item) {
  if (String(item?.source_key || "").startsWith("edgar_")) return true;
  try { return /(^|\.)sec\.gov$/i.test(new URL(item?.url).hostname); } catch { return false; }
}

// Days between the event's published date and news-monitor's first sighting
// (never the grading time), or null when either date is missing.
export function sightingAgeDays(published, firstSeen) {
  const pub = Date.parse(published || "");
  const seen = Date.parse(firstSeen || "");
  if (!Number.isFinite(pub) || !Number.isFinite(seen)) return null;
  return Math.max(0, Math.round(((seen - pub) / 86_400_000) * 10) / 10);
}
// core.md section 8: late_first_sighting means the event was more than 21 days
// old when first seen.
export const LATE_SIGHTING_DAYS = 21;

// Validates one grade (core rubric v3 output contract) against the item it
// grades. Returns { ok: true, grade, relations, warnings } or { ok: false, error }:
// relations are the kept normalizeRelations entries (the bare-id grade only),
// warnings the text for each dropped one.
//   alsoTicker: set for "123#TICKER" covered-to-covered grades.
//   covered:    the covered ticker list.
//   floors:     parseFloors(core.md); enables floor enforcement.
//   industry:   (phase 2, optional 6th argument) the bundled industry_links,
//               {TICKER: {id: {core}}} (rubric.generated.js INDUSTRY, or a
//               replay's CANDIDATE_INDUSTRY). When given, every industry:<id>
//               flag must name an entry of the grade's ticker, and the score
//               is capped at 74 for a core entry, 69 otherwise (core.md 9A).
//               With {} every industry: flag is rejected. Left out (null):
//               not checked.
// item carries id and ticker, and (for the timing, floor and SEC checks) title,
// excerpt, source_key, url, published and first_seen when known.
export const INDUSTRY_CEILING = { core: 74, other: 69 };
export function normalizeGrade(raw, item, alsoTicker = null, covered = null, floors = null, { industry = null } = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "grade must be an object" };
  if (!item) return { ok: false, error: "unknown item_id" };
  // "<id>#<the item's own ticker>" is the item's primary grade.
  if (alsoTicker && alsoTicker === item.ticker) alsoTicker = null;
  const flags = strArray(raw.flags, 16);
  const reasons = flags.filter((f) => f.startsWith("reason:"));
  if (reasons.length !== 1) return { ok: false, error: `exactly one reason: flag is required (got ${reasons.length}); allowed: ${REASONS.join(", ")}` };
  if (!REASONS.includes(reasons[0].slice(7))) return { ok: false, error: `unknown ${reasons[0]}; allowed: ${REASONS.join(", ")}` };
  const rawBand = raw.band == null ? "" : String(raw.band).toLowerCase();
  const saysDuplicate = rawBand === "duplicate" || reasons[0] === "reason:duplicate";
  const isDuplicate = saysDuplicate && (raw.score === null || raw.score === undefined);
  if (saysDuplicate && !isDuplicate) return { ok: false, error: "a duplicate must have score null" };
  if (isDuplicate && !(raw.dup_of || flags.some((f) => f.startsWith("dup_of:")))) return { ok: false, error: "a duplicate needs dup_of:<item_id>" };
  if (raw.read_source != null && typeof raw.read_source !== "boolean") return { ok: false, error: "read_source must be true or false" };
  let score = null;
  if (!isDuplicate) {
    // Number(null) is 0 — a missing score must never become a silent 0 grade.
    if (raw.score === null || raw.score === undefined || raw.score === "") return { ok: false, error: "score must be an integer 0-100 (or null with band duplicate)" };
    score = Number(raw.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) return { ok: false, error: "score must be an integer 0-100 (or null with band duplicate)" };
  }
  let ticker = item.ticker;
  const given = raw.ticker == null ? "" : String(raw.ticker).toUpperCase();
  if (alsoTicker) {
    if (covered && !covered.includes(alsoTicker)) return { ok: false, error: `${alsoTicker} is not a covered ticker` };
    if (given && given !== alsoTicker) return { ok: false, error: `ticker ${given} does not match item_id suffix #${alsoTicker}` };
    ticker = alsoTicker;
  } else if (given && given !== item.ticker && !flags.some((f) => MISMATCH_OK.includes(f))) {
    return { ok: false, error: `ticker ${given} does not match item ticker ${item.ticker}; use item_id "${item.id}#${given}" for a covered-to-covered grade, or a reason:off_entity / reason:out_of_scope flag` };
  }
  const why = clip(raw.why, 400);
  if (!why) return { ok: false, error: "why is required" };
  // Phase 2: the industry ladder (core.md section 9A) is enforced against the
  // bundled industry_links of the grade's ticker.
  if (industry) {
    for (const f of flags) {
      if (!f.startsWith("industry:")) continue;
      const id = f.slice(9);
      const links = Object.hasOwn(industry, ticker) ? industry[ticker] : null;
      const link = links && Object.hasOwn(links, id) ? links[id] : null;
      if (!link) return { ok: false, error: `unknown industry link ${id} for ${ticker} (core.md section 9A): flag industry:<id> only with an id from ${ticker}'s industry_links` };
      const cap = link.core ? INDUSTRY_CEILING.core : INDUSTRY_CEILING.other;
      if (score != null && score > cap) return { ok: false, error: `industry ladder ceiling: industry:${id} for ${ticker} allows at most ${cap} (core.md section 9A); got ${score}` };
    }
  }
  const reason = reasons[0].slice(7);
  // Optional headline and tag; a bad one rejects this grade only.
  const head = normalizeHeadline(raw);
  if (!head.ok) return head;

  // Timeliness runs from news-monitor's first sighting, never the grading time
  // (core.md 4.5): a late_first_sighting flag needs the event to have been
  // more than 21 days old when news-monitor first saw it.
  const age = sightingAgeDays(item.published, item.first_seen);
  if (flags.includes("late_first_sighting") && age != null && age <= LATE_SIGHTING_DAYS && !flags.includes("event_predates_publication")) {
    return { ok: false, error: `late_first_sighting does not apply: item ${item.id} was first seen ${age} day(s) after its published date (published ${item.published}, first_seen ${item.first_seen}). Timeliness is measured from first sighting, not from grading time (core.md 4.5); regrade without the late penalty. Only if the event itself predates this record's publication by more than 21 days, keep the flag, add event_predates_publication and give the event date in why.` };
  }

  // floor:investor_day only when the company calls it an investor or analyst
  // day, in the title or in the captured text (an SEC filing's title never
  // names the event; its Item text or Ex-99.1 release does).
  if (flags.includes("floor:investor_day") && !INVESTOR_DAY_RE.test(String(item.title || "")) && !INVESTOR_DAY_RE.test(String(item.excerpt || ""))) {
    return { ok: false, error: `floor:investor_day applies only when the company calls the event an investor or analyst day, and neither the title nor the captured text of item ${item.id} names one. Grade a webcast, Q&A or presentation notice on its own terms (often reason:promotional) and drop the flag.` };
  }

  // Flagged floors are minimums (core.md section 6); unknown ids are ignored.
  let floor = null, fixedFloor = false, floorId = null;
  if (floors && !isDuplicate && !NO_FLOOR_REASONS.includes(reason) && !flags.some((f) => NO_FLOOR_FLAGS.includes(f))) {
    for (const f of flags) {
      if (!f.startsWith("floor:")) continue;
      const def = floors[f.slice(6)];
      if (!def) continue;
      const value = def.undisclosed != null && num(raw.magnitude_usd) == null ? def.undisclosed : def.floor;
      if (floor == null || value > floor) { floor = value; fixedFloor = def.fixed; floorId = f.slice(6); }
      else if (value === floor && !def.fixed) fixedFloor = false;
    }
    // A fixed floor is the score itself; company sheets that give it another
    // value ("calendar 72 fixed") are void without an owner:<date> mark.
    if (floor != null && fixedFloor && score !== floor) {
      return { ok: false, error: `score ${score} does not match floor:${floorId}, which is fixed at ${floor} (core.md section 6): score it ${floor} and keep the flag. A company sheet line that gives it another value (such as "fixed 72") is void, because lowering a floor needs an owner:<date> mark.` };
    }
    if (floor != null && score < floor) {
      return { ok: false, error: `score ${score} is below floor:${floorId} (${floor}, core.md section 6). Score at least the floor, or drop the flag if the floor does not apply.` };
    }
  }

  // Unread SEC filings: cap 55 unless a floor applies by identifier, then the
  // floor itself; flag no_figures and confidence <= 0.4 (core.md section 5).
  const unreadSec = !isDuplicate && !raw.read_source && isSecItem(item);
  if (unreadSec) {
    const cap = Math.max(SEC_UNREAD_CAP, floor ?? 0);
    if (score > cap) { flags.push(`sec_unread_capped_from_${score}`); score = cap; }
    if (!flags.includes("no_figures")) flags.push("no_figures");
  }
  // Phase 0 gates (e): an undated item is never a Lead (capUndated, above bandFor).
  if (!isDuplicate) score = capUndated(score, item.published, flags);

  const band = isDuplicate ? "duplicate" : bandFor(score);
  if (rawBand && rawBand !== band) flags.push(`band_corrected_from_${rawBand}`);
  const dupFlag = flags.find((f) => f.startsWith("dup_of:"));
  let confidence = num(raw.confidence);
  // core.md section 10: confidence <= 0.5 when the source was not read
  // (<= 0.4 for an unread SEC filing, section 5).
  const confCap = unreadSec ? SEC_UNREAD_CONFIDENCE : 0.5;
  if (!raw.read_source && confidence != null && confidence > confCap) { confidence = confCap; flags.push("confidence_capped"); }
  // Optional relations (A2): bad entries are dropped with a warning, never a
  // rejection. Only the item's own grade carries them, never a "#TICKER" grade.
  let rel = { relations: [], warnings: [] };
  if (alsoTicker) {
    if (Array.isArray(raw.relations) ? raw.relations.length : raw.relations != null) {
      rel.warnings.push(`relations dropped: only the item's own grade (bare item_id ${item.id}) carries relations, never a #${alsoTicker} grade`);
    }
  } else {
    rel = normalizeRelations(raw.relations, { itemId: item.id, subject: ticker });
  }
  return {
    ok: true,
    relations: rel.relations,
    warnings: rel.warnings,
    grade: {
      ticker,
      primary: !alsoTicker,
      dup_of: clip(raw.dup_of ?? (dupFlag ? dupFlag.slice(7) : null), 40),
      score,
      band,
      rung: clip(raw.rung, 60),
      event_type: clip(raw.event_type, 60),
      status_label: clip(raw.status, 40),
      magnitude_usd: num(raw.magnitude_usd),
      magnitude_pct: num(raw.magnitude_pct_of_base ?? raw.magnitude_pct),
      thesis_drivers: JSON.stringify(strArray(raw.thesis_drivers_hit ?? raw.thesis_drivers)),
      why,
      note_hook: clip(raw.note_hook, 240),
      confidence: confidence == null ? null : Math.max(0, Math.min(1, confidence)),
      reason: reasons[0].slice(7),
      read_source: raw.read_source ? 1 : 0,
      flags: JSON.stringify([...new Set(flags)]),
      headline: head.headline,
      headline_tag: head.tag,
    },
  };
}

// --- Headlines (core.md section 10, aux.md section 8) ---------------------------
// A plain-language headline and a tag saying what the item is, written by the
// grader with each grade (optional: old grader runs send neither) or in the
// headline-only pass. Stored on the item; the app shows "<headline> - <tag>".
export const HEADLINE_MIN = 8;
export const HEADLINE_MAX = 140;
// The tag: the SEC form exactly as filed, else one of HEADLINE_TAGS. An
// explicit list (never a catch-all): every form news-monitor can deliver (its
// material lists in src/sec-material.js, operating and fund issuers, plus the
// ownership and offering forms older titles carry), each also with "/A".
export const SEC_FORMS = [
  "8-K", "8-K12B", "10-Q", "10-K", "20-F", "40-F", "6-K", "10-12B",
  "S-1", "S-3", "S-3ASR", "S-3MEF", "S-4", "S-8", "F-1", "F-3", "F-3ASR", "F-4", "F-10",
  "424B1", "424B2", "424B3", "424B4", "424B5", "424B6", "424B7", "424B8", "SUPPL", "EFFECT",
  "DEF 14A", "PRE 14A", "DEFM14A", "PREM14A", "DEFA14A", "DFAN14A", "PREC14A", "DEFC14A",
  "SC TO-T", "SC TO-I", "SC TO-C", "SC 14D9", "SC14D9C", "425", "SC 13E3",
  "SCHEDULE 13D", "SC 13D", "SCHEDULE 13G", "SC 13G", "13F-HR",
  "Form 3", "Form 4", "Form 5",
  "NT 10-Q", "NT 10-K", "NT 20-F", "NT-NCSR", "25-NSE", "25", "15-12B", "15-12G",
  "497", "497AD", "N-2", "N-CSR", "N-CSRS",
  "1-A", "253G2", "1-U", "1-K", "C", "D",
];
// The names hold letters, digits, spaces and "-" only, so they need no escaping.
export const SEC_FORM_RE = new RegExp(`^(?:${SEC_FORMS.join("|")})(?:/A)?$`);
export const HEADLINE_TAGS = ["Press release", "Presentation", "Shareholder letter", "Event", "Contract notice", "Program notice", "News", "Blog",
  "Video", "Filing", "Report", "Interview"];
const LINE_BREAK_RE = /[\r\n\u0085\u2028\u2029]/;
// A URL: any scheme (https://, ftp://, s3+ssh://), a www. host, or a domain
// followed by a path (sec.gov/Archives/..., ir.redcat.red/news/1). The last
// domain label must start with two letters, so "$0.12/share" or "U.S./Canada" pass.
export const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.[a-z0-9-]+\.[a-z]|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2}[a-z0-9-]*\/\S/i;
// C0 and C1 controls and the bidi embeddings, overrides and isolates. Python's
// str.splitlines breaks on U+001C-U+001E, so they would split the app's one line.
export const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const present = (v) => v !== null && v !== undefined && v !== "";

// Validates a grade's (or a headline-pass entry's) headline and tag. Both are
// optional, but one needs the other. Returns { ok: true, headline, tag } (both
// null when absent) or { ok: false, error }. A headline that repeats the
// original title is allowed (the rubric discourages it).
export function normalizeHeadline(raw, { required = false } = {}) {
  const bad = (error) => ({ ok: false, error });
  const hasHeadline = present(raw?.headline), hasTag = present(raw?.tag);
  if (!hasHeadline && !hasTag) {
    return required ? bad("headline and tag are required") : { ok: true, headline: null, tag: null };
  }
  if (!hasHeadline) return bad("tag needs a headline: send both, or neither");
  if (!hasTag) return bad("headline needs a tag: the SEC form exactly as filed (8-K, 8-K/A, 10-Q, 424B5, SC 13G, Form 4 ...) or one of " + HEADLINE_TAGS.join(", "));
  if (typeof raw.headline !== "string") return bad("headline must be a string");
  if (LINE_BREAK_RE.test(raw.headline.trim())) return bad("headline must be one line: no line breaks");
  const headline = raw.headline.replace(/\s+/g, " ").trim();
  if (headline.length < HEADLINE_MIN || headline.length > HEADLINE_MAX) {
    return bad(`headline must be ${HEADLINE_MIN}-${HEADLINE_MAX} characters (got ${headline.length}); aim for at most ~110`);
  }
  if (CONTROL_RE.test(headline)) return bad("headline must not contain control characters or bidi overrides");
  if (URL_RE.test(headline)) return bad("headline must not contain a URL");
  if (typeof raw.tag !== "string") return bad("tag must be a string");
  const given = raw.tag.replace(/\s+/g, " ").trim();
  const vocab = HEADLINE_TAGS.find((t) => t.toLowerCase() === given.toLowerCase());
  const tag = SEC_FORM_RE.test(given) ? given : vocab;
  if (!tag) {
    return bad(`unknown tag "${given.slice(0, 40)}": use the SEC form exactly as filed (8-K, 8-K/A, 10-Q, 6-K, S-1, 424B5, SC 13D, Form 4 ...) or one of ${HEADLINE_TAGS.join(", ")}`);
  }
  return { ok: true, headline, tag };
}

// --- Candidate names and grader relations (plans/round5-expansion-approve-queue.md, A1-A2, C3) ---
// candidateName, dedupeKey and coveredTicker live here, beside URL_RE and
// CONTROL_RE, so the grade validators can use them without importing
// expansion.js (which pulls in ingest, excerpt and the JSON registries);
// expansion.js re-exports them for Parts B and C.

// C3's legal suffixes, plus the other legal forms B4 names (incorporated,
// company, limited, lp, llp) and pbc (Planet Labs PBC), so "Acme Company" and
// "Acme Co." share a key.
export const LEGAL_SUFFIXES = ["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "lp", "llp", "plc", "pbc",
  "ag", "as", "sa", "gmbh", "bv", "nv", "holdings"];
const SUFFIX_SET = new Set(LEGAL_SUFFIXES);
const NAME_CHARS_RE = /^[\p{L}\p{N} .&'\-,]+$/u;

// The cleaned display name, or null when the name may not be a candidate:
// NFC, curly apostrophes made straight, whitespace squashed, one trailing
// parenthetical (a ticker) stripped; then null when it is under 2 or over 80
// characters (checked before any clip), holds a URL or a control character,
// or any character other than Unicode letters, digits, space and . & ' - ,
export function candidateName(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.normalize("NFC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim()
    .replace(/\s*\([^()]*\)$/, "").trim();
  if (s.length < 2 || s.length > 80) return null;
  if (URL_RE.test(s) || CONTROL_RE.test(s)) return null;
  if (!NAME_CHARS_RE.test(s)) return null;
  return s;
}

// The normalized name (C3): NFKD, combining marks stripped, lowercase,
// parentheticals dropped, . and ' removed, every other character that is not
// a letter, digit or space made a space, trailing legal suffixes stripped
// repeatedly while more than one word is left, spaces collapsed. "" when
// nothing is left (the caller drops the name).
export function dedupeKey(name) {
  let s = String(name ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\([^()]*\)/g, " "); }
  s = s.replace(/[().'’]/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = s ? s.split(" ") : [];
  while (words.length > 1 && SUFFIX_SET.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

// Covered names (A2): the 24 tickers, each sheet's name: (or first terms
// entry) and key-accounts company_names, bundled as COVERED_NAMES (keyed by
// covered.json's tickers, in its order). Never MATCH.terms: product names
// such as Carbyne and Upgrade Energy must stay candidates.
const COVERED_KEYS = new Map();
for (const [t, names] of Object.entries(COVERED_NAMES || {})) {
  for (const n of [t, ...(names || [])]) {
    const k = dedupeKey(n);
    if (k && !COVERED_KEYS.has(k)) COVERED_KEYS.set(k, t);
  }
}
// The covered ticker whose covered name has the same dedupe key, or null.
export function coveredTicker(name) {
  return COVERED_KEYS.get(dedupeKey(name)) || null;
}

// A1: what the counterparty is to the grade's subject (its ticker or entity).
export const RELATION_TYPES = ["acquired", "acquirer", "customer", "partner", "supplier", "subsidiary", "award"];
export const MAX_RELATIONS = 4;
// A relation's optional about: what the counterparty is or does, one plain
// sentence from the item's own text, at most 160 characters.
export const ABOUT_MAX = 160;

// A relation's about -> { about, warning }. about is the squashed text, or
// null when absent or dropped; warning says why it was dropped. Dropped (never
// clipped) when it is not a string, is over ABOUT_MAX characters after the
// whitespace is squashed, or holds a URL or a control character. The relation
// itself is kept either way.
export function normalizeAbout(raw) {
  if (raw === undefined || raw === null) return { about: null, warning: null };
  if (typeof raw !== "string") return { about: null, warning: "about must be a string" };
  const about = raw.replace(/\s+/g, " ").trim();
  if (!about) return { about: null, warning: null };
  if (about.length > ABOUT_MAX) return { about: null, warning: `about must be at most ${ABOUT_MAX} characters (got ${about.length})` };
  if (CONTROL_RE.test(about)) return { about: null, warning: "about must not contain control characters or bidi overrides" };
  if (URL_RE.test(about)) return { about: null, warning: "about must not contain a URL" };
  return { about, warning: null };
}

// A2: a grade's optional relations -> { relations, warnings }. relations:
// [{ type, name, evidence }], at most 4; warnings: one string per dropped
// entry. An invalid entry is dropped with a warning and never rejects the
// grade (unlike headline and tag). An entry is dropped when it is the 5th or
// later, is not an object, has a type outside RELATION_TYPES, a name that
// fails candidateName or has an empty dedupe key, names the subject or a
// covered company, has evidence other than the graded item's own id, or
// repeats an earlier kept name (same dedupe key). An entry's optional about
// (normalizeAbout) is kept on the entry when valid; a bad about is dropped
// with a warning and the entry is still kept.
//   itemId:  the graded item's id (the only allowed evidence)
//   subject: the grade's ticker (coverage) or entity (aux)
export function normalizeRelations(raw, { itemId, subject } = {}) {
  const relations = [], warnings = [];
  if (raw === undefined || raw === null) return { relations, warnings };
  if (!Array.isArray(raw)) {
    warnings.push('relations must be an array of { "type", "name", "evidence" }: dropped');
    return { relations, warnings };
  }
  const subjectKey = dedupeKey(subject);
  const keys = new Set();
  raw.forEach((r, i) => {
    const label = r && typeof r === "object" && typeof r.name === "string" ? ` ${JSON.stringify(r.name.replace(/\s+/g, " ").trim().slice(0, 80))}` : "";
    const drop = (why) => warnings.push(`relation ${i + 1}${label} dropped: ${why}`);
    if (i >= MAX_RELATIONS) return drop(`relations holds at most ${MAX_RELATIONS} entries`);
    if (!r || typeof r !== "object" || Array.isArray(r)) return drop('each relation must be { "type", "name", "evidence" }');
    const type = typeof r.type === "string" ? r.type.trim().toLowerCase() : "";
    if (!RELATION_TYPES.includes(type)) return drop(`type must be one of ${RELATION_TYPES.join(", ")}`);
    const name = candidateName(r.name);
    if (!name) return drop("name must be the counterparty's own name, 2-80 characters of letters, digits, spaces and . & ' - , (no URL)");
    const key = dedupeKey(name);
    if (!key) return drop("name has no letters or digits");
    if (subjectKey && key === subjectKey) return drop("name is the grade's own subject");
    const t = coveredTicker(name);
    if (t) return drop(`name is a covered company (${t}); covered companies are never relations`);
    const ev = typeof r.evidence === "string" && /^\s*\d+\s*$/.test(r.evidence) ? Number(r.evidence) : r.evidence;
    if (ev !== itemId) return drop(`evidence must be the item you are grading (${itemId})`);
    if (keys.has(key)) return drop("repeats an earlier relation");
    keys.add(key);
    const ab = normalizeAbout(r.about);
    if (ab.warning) warnings.push(`relation ${i + 1}${label} about dropped (the relation is kept): ${ab.warning}`);
    relations.push(ab.about ? { type, name, evidence: itemId, about: ab.about } : { type, name, evidence: itemId });
  });
  return { relations, warnings };
}

// Splits a list into chunks (D1 allows at most 100 bound parameters).
export function chunk(list, size = 90) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Only http(s) URLs are fetched or linked.
export function isHttpUrl(u) {
  try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; }
}

// An item whose publication date is far older than when news-monitor first
// saw it is a seed/backfill of an old post: store it, but do not queue it.
export function skipReason(row) {
  if (!row.published) return null;
  const pub = Date.parse(row.published);
  const seen = Date.parse(row.first_seen);
  if (!Number.isFinite(pub) || !Number.isFinite(seen)) return null;
  return seen - pub > STALE_DAYS * 86_400_000 ? "stale_on_arrival" : null;
}

// Day-one archive rows (core.md section 8, archive bursts): a row with no
// published date, or one published more than STALE_DAYS before news-monitor
// first saw it. ARCHIVE_SEED_MIN or more of them from one source sharing one
// first_seen are a seed or backfill of old pages, parked as 'archive_seed'.
export const ARCHIVE_SEED_MIN = 5;
export function isArchiveCandidate(row) {
  if (!row.published) return true;
  const pub = Date.parse(row.published);
  const seen = Date.parse(row.first_seen);
  if (!Number.isFinite(pub)) return true;
  return Number.isFinite(seen) && seen - pub > STALE_DAYS * 86_400_000;
}
export const archiveGroupKey = (sourceKey, firstSeen) => `${sourceKey}\u0000${firstSeen}`;
// rows: this batch's rows; stored: Map(groupKey -> archive candidates already in
// zenith-db). Returns the set of group keys to park.
export function archiveSeedGroups(rows, stored = new Map()) {
  const counts = new Map();
  for (const r of rows) {
    if (!isArchiveCandidate(r)) continue;
    const k = archiveGroupKey(r.source_key, r.first_seen);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const park = new Set();
  for (const [k, n] of counts) if (n + (stored.get(k) || 0) >= ARCHIVE_SEED_MIN) park.add(k);
  return park;
}

// --- Phase 0 gates: the arrival gate --------------------------------------
// The rubric's freshness line: over 21 days at first sighting is stale
// (core.md 4.5 and section 8, auxiliary.md section 5).
export const LATE_WINDOW_DAYS = 21;
// Coverage only: core.md section 8 lets a material official record first seen
// late score (event - 15, cap 79). Archive bursts have no such exception
// (core.md section 8, archive bursts).
export const RECORD_LOOKBACK_DAYS = 120;
// What the arrival gate does with one news-monitor row. ctx:
//   pipeline  'coverage' | 'aux'
//   record    the row is an official record (records.js isOfficialRecord)
//   seed      the row is in its source's first poll (ingest.js isSeedRow)
//   burst     its (source, first_seen) group has ARCHIVE_SEED_MIN or more
//             archive candidates (archiveSeedGroups)
//   ownLane   its source is a covered company's own source (covered.json sources)
//   sec       it is an SEC item (isSecItem)
//   fpds      its source is an FPDS source (records.js isFpdsSource; phase 1)
//   decision  it is a Legistar decision row (ingest.js isDecisionRow; phase 1)
//   register  its source is a register source (records.js isRegisterSource;
//             phase 2)
//   capped    its source already has the day's fast_cap fast-path rows
//             (budget.js fastPathCounts; phase 1)
// -> { reason: a skip reason or null, admit: null | 'record_late' |
//      'seed_window' | 'seed_fresh' | 'vote' | 'register' | 'record_fresh' |
//      'source_cap' }.
// An admitted row is stored pending and held until the daily grading budget
// releases it (budget.js).
// A row that is neither skipped nor late (undated outside a burst, or dated
// at most STALE_DAYS before its first sighting) is decided in this order:
//   seed_fresh (integration ruling A1): a fresh row of a new source's first
//     poll, unless its source is a covered own-lane source or it is an SEC
//     item; those keep the fast path.
//   vote (phase 1): a Legistar decision row ('#vote-<event>' or '#<status>'),
//     so each council outcome is graded inside the budget.
//   register (phase 2): a fresh or undated row of a register source after
//     its first poll (aux-sources.json register: true), so a register change
//     is graded inside the budget, never on the fast path. Register sources
//     are records, so a late row follows record_late like any record.
//   record_fresh (phase 1): an undated row of an FPDS source after its first
//     poll; FPDS posts DoD actions ~90 days late and the adapter leaves later
//     rows undated, so they are budgeted like a seed.
//   source_cap (phase 1): a fresh row past its source's fast_cap fast-path
//     rows of one first-seen UTC day, unless its source is a covered own-lane
//     source or it is an SEC item.
//   otherwise the fast path (admit null).
// A vote, register or record_fresh row is decided before the cap, so it never
// counts toward it (fastPathCounts counts admit IS NULL rows only).
export function arrivalGate(row, ctx = {}) {
  const pub = Date.parse(row.published || ""), seen = Date.parse(row.first_seen || "");
  const age = Number.isFinite(pub) && Number.isFinite(seen) ? (seen - pub) / 86_400_000 : null;
  // The decision for a row that is neither skipped nor late.
  const plain = (undated) => {
    if (ctx.seed && !ctx.ownLane && !ctx.sec) return { reason: null, admit: "seed_fresh" };
    if (ctx.decision) return { reason: null, admit: "vote" };
    if (ctx.register) return { reason: null, admit: "register" };
    if (undated && ctx.fpds && !ctx.seed) return { reason: null, admit: "record_fresh" };
    if (ctx.capped && !ctx.ownLane && !ctx.sec) return { reason: null, admit: "source_cap" };
    return { reason: null, admit: null };
  };
  if (age == null) {                                              // undated: today's rule
    if (!ctx.burst) return plain(true);
    return { reason: ctx.seed ? "archive_seed" : "undated_burst", admit: null };
  }
  if (age <= STALE_DAYS) return plain(false);                     // the fast path (the admissions above aside)
  if ((ctx.seed || ctx.record) && age <= LATE_WINDOW_DAYS) return { reason: null, admit: ctx.record ? "record_late" : "seed_window" };
  if (ctx.pipeline === "coverage" && ctx.record && !ctx.burst && age <= RECORD_LOOKBACK_DAYS) return { reason: null, admit: "record_late" };
  return { reason: ctx.seed && ctx.burst ? "archive_seed" : "stale_on_arrival", admit: null };
}

// The event date to show next to a feed item: its published day, when that is
// more than a day before news-monitor first saw it (else null).
export function olderEventDate(published, firstSeen) {
  const pub = Date.parse(published || "");
  const seen = Date.parse(firstSeen || "");
  if (!Number.isFinite(pub) || !Number.isFinite(seen) || seen - pub <= 86_400_000) return null;
  return new Date(pub).toISOString().slice(0, 10);
}

// --- Counterparty sources ---------------------------------------------------
// One regex per phrase list: case-insensitive, and a phrase must not sit inside
// a longer word ("Axon" never matches "Axonics"; "$SERV" and "Inc." still work).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function phraseRegex(phrases) {
  const list = [...new Set((phrases || []).filter((p) => typeof p === "string" && p.trim().length >= 3).map((p) => p.trim()))];
  if (!list.length) return null;
  list.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

// Routes an item from a counterparty source (cp = { role, affects }).
//   match: { TICKER: { terms, accounts } } from the rubric build.
// Returns the ticker to grade it under and, for a rival item whose title names
// neither an affected company nor one of its key accounts, skip
// "rival_no_key_account" (core.md section 9 rule 4: a rival's news counts only
// when it wins at a sheet key account). Ticker order: an affected company the
// title names (rule 1), then one whose key account it names, then the first
// affected ticker. "Kodiak and Charger Logistics launch a lane" goes to KDK
// even though Charger is also an AUR account.
const routeCache = new WeakMap();
function regexesFor(match, t) {
  let byTicker = routeCache.get(match);
  if (!byTicker) routeCache.set(match, (byTicker = new Map()));
  if (!byTicker.has(t)) byTicker.set(t, { company: phraseRegex(match[t].terms), account: phraseRegex(match[t].accounts) });
  return byTicker.get(t);
}
export function routeCounterparty(title, cp, match) {
  const affects = (cp?.affects || []).filter((t) => match?.[t]);
  if (!affects.length) return null;
  const text = String(title || "");
  const company = affects.filter((t) => regexesFor(match, t).company?.test(text));
  const account = affects.filter((t) => regexesFor(match, t).account?.test(text));
  // Phase 0 nm-sources: leading tag. A title's leading "[T]" or "[T/U]" tag
  // (news-monitor's matcher prefix, e.g. "[SERV] … personal delivery device
  // rules") decides when no company or key account matches; a tag outside
  // affects is ignored, and the rival skip rule is unchanged.
  const tag = (text.match(/^\[([A-Z][A-Z0-9.]{0,7}(?:\/[A-Z][A-Z0-9.]{0,7})*)\]/) || [])[1];
  const tagged = tag ? tag.split("/").filter((t) => affects.includes(t)) : [];
  return {
    ticker: company[0] || account[0] || tagged[0] || affects[0],
    role: cp.role || "counterparty",
    affects: affects.join(","),
    skip: cp.role === "rival" && !company.length && !account.length ? "rival_no_key_account" : null,
  };
}
