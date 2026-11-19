// Pure helpers shared by the router, ingest and tests (no Worker globals).

export const BANDS = [
  { band: "lead", min: 90 },
  { band: "digest", min: 70 },
  { band: "borderline", min: 40 },
  { band: "reject", min: 0 },
];
export const LABELS = ["high", "medium", "low", "noise"];
export const MAX_CLAIM = 60;
export const LEASE_MINUTES = 45;
export const MAX_ATTEMPTS = 4;
export const STALE_DAYS = 14;

export function bandFor(score) {
  for (const b of BANDS) if (score >= b.min) return b.band;
  return "reject";
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

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

// Validates one grade (core rubric v3 output contract) against the item it
// grades. Returns { ok: true, grade } or { ok: false, error }.
//   alsoTicker: set for "123#TICKER" covered-to-covered grades.
//   covered:    the covered ticker list.
export function normalizeGrade(raw, item, alsoTicker = null, covered = null) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "grade must be an object" };
  if (!item) return { ok: false, error: "unknown item_id" };
  const flags = strArray(raw.flags, 16);
  const rawBand = raw.band == null ? "" : String(raw.band).toLowerCase();
  const isDuplicate = (raw.score === null || raw.score === undefined) && (rawBand === "duplicate" || flags.includes("reason:duplicate"));
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
  const band = isDuplicate ? "duplicate" : bandFor(score);
  if (rawBand && rawBand !== band) flags.push(`band_corrected_from_${rawBand}`);
  if (!flags.some((f) => f.startsWith("reason:"))) flags.push("contract:no_reason");
  const dupFlag = flags.find((f) => f.startsWith("dup_of:"));
  const confidence = num(raw.confidence);
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
      read_source: raw.read_source ? 1 : 0,
      flags: JSON.stringify([...new Set(flags)]),
    },
  };
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
