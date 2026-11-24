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
export const LEASE_MINUTES = 45;
export const MAX_ATTEMPTS = 4;
export const STALE_DAYS = 14;

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
// Reads the floor table from the bundled core.md, so the API enforces exactly
// the floors the grader reads: { id: { floor, fixed, undisclosed } }.
//   fixed:       "75 fixed" (the score is the floor, not a minimum)
//   undisclosed: the lower floor that applies while the value V is undisclosed
export function parseFloors(coreMd) {
  const text = String(coreMd || "").replace(/\r\n/g, "\n");
  const start = text.search(/^## 6\.[^\n]*floors/im);
  if (start === -1) return {};
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = end === -1 ? rest : rest.slice(0, end);
  const floors = {};
  for (const m of section.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|([^\n]*)\|\s*(\d{1,3})\s*(fixed)?\s*\|\s*$/gm)) {
    const undisclosed = /\((\d{1,3}) while V is undisclosed\)/i.exec(m[2]);
    floors[m[1]] = { floor: Number(m[3]), fixed: Boolean(m[4]), undisclosed: undisclosed ? Number(undisclosed[1]) : null };
  }
  return floors;
}

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
// item carries id and ticker, and (for the timing, floor and SEC checks) title,
// excerpt, source_key, url, published and first_seen when known.
export function normalizeGrade(raw, item, alsoTicker = null, covered = null, floors = null) {
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

// A2: a grade's optional relations -> { relations, warnings }. relations:
// [{ type, name, evidence }], at most 4; warnings: one string per dropped
// entry. An invalid entry is dropped with a warning and never rejects the
// grade (unlike headline and tag). An entry is dropped when it is the 5th or
// later, is not an object, has a type outside RELATION_TYPES, a name that
// fails candidateName or has an empty dedupe key, names the subject or a
// covered company, has evidence other than the graded item's own id, or
// repeats an earlier kept name (same dedupe key).
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
    relations.push({ type, name, evidence: itemId });
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
  return {
    ticker: company[0] || account[0] || affects[0],
    role: cp.role || "counterparty",
    affects: affects.join(","),
    skip: cp.role === "rival" && !company.length && !account.length ? "rival_no_key_account" : null,
  };
}
