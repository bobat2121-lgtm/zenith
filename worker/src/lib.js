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

// Validates one grade object from the routine against the item it claims to
// grade. Returns { ok: true, grade } or { ok: false, error }.
export function normalizeGrade(raw, item) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "grade must be an object" };
  if (!item) return { ok: false, error: "unknown item_id" };
  const score = Number(raw.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) return { ok: false, error: "score must be an integer 0-100" };
  const flags = strArray(raw.flags);
  const ticker = String(raw.ticker || "").toUpperCase();
  if (ticker && ticker !== item.ticker && !flags.includes("off_entity")) {
    return { ok: false, error: `ticker ${ticker} does not match item ticker ${item.ticker} (flag off_entity if the item is about another company)` };
  }
  const why = clip(raw.why, 400);
  if (!why) return { ok: false, error: "why is required" };
  const band = bandFor(score);
  if (raw.band && String(raw.band).toLowerCase() !== band) flags.push(`band_corrected_from_${String(raw.band).toLowerCase()}`);
  const confidence = num(raw.confidence);
  return {
    ok: true,
    grade: {
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
