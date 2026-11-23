// Pure helpers shared by the router, ingest and tests (no Worker globals).

export const BANDS = [
  { band: "lead", min: 90 },
  { band: "digest", min: 70 },
  { band: "borderline", min: 40 },
  { band: "reject", min: 0 },
];
// Analyst labels: absolute ranges (high/medium/low/noise) and directional ones
// (too_high/too_low: the score shown when labelled should have been lower/higher).
export const LABELS = ["high", "medium", "low", "noise", "too_high", "too_low"];
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
// grades. Returns { ok: true, grade } or { ok: false, error }.
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
  return {
    ok: true,
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
    },
  };
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
