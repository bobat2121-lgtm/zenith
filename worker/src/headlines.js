// The headline-only pass (plans/headlines-round3.md): graded items that have no
// headline yet (graded before headlines shipped, or by an older grader) get a
// headline and tag without being regraded.
//   grader: POST /v1/headlines/claim, POST /v1/headlines
//
// Coverage items (items) come before auxiliary ones (aux_items), each newest
// first. A claim leases items for LEASE_MINUTES on its own columns
// (headline_claim_id, headline_claimed_until: migration 0010), so it never reads
// or writes state, claim_id, claimed_until, attempts, grade_id or any grade: a
// grading claim and a headline claim can hold the same item at once, and
// nothing here can change a score, band or state.
import { json, nowIso, chunk, normalizeHeadline, LEASE_MINUTES } from "./lib.js";

export const HEADLINE_MAX_CLAIM = 60;
const HEADLINE_DEFAULT_CLAIM = 40;
const HEADLINE_DEFAULT_DAYS = 30;
const HEADLINE_MAX_DAYS = 60;
export const EXCERPT_CHARS = 1200;

// kind -> table and the columns the claim prints for it.
const KINDS = {
  coverage: { table: "items", grades: "grades", name: "i.ticker" },
  aux: { table: "aux_items", grades: "aux_grades", name: "COALESCE(g.entity, i.entity_name) AS entity" },
};

const clampInt = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || dflt));
const WAITING = "state = 'graded' AND grade_id IS NOT NULL AND headline IS NULL AND nm_first_seen >= ?";
const FREE = "(headline_claimed_until IS NULL OR headline_claimed_until < ?)";

// Leases up to `limit` items of one kind; returns how many it took.
async function lease(env, { table }, claimId, until, since, now, limit) {
  if (limit <= 0) return 0;
  const r = await env.DB.prepare(
    `UPDATE ${table} SET headline_claim_id = ?, headline_claimed_until = ?
      WHERE id IN (SELECT id FROM ${table} WHERE ${WAITING} AND ${FREE} ORDER BY nm_first_seen DESC, id DESC LIMIT ?)
        AND headline IS NULL AND ${FREE}`,
  ).bind(claimId, until, since, now, limit, now).run();
  return r.meta?.changes || 0;
}

// POST /v1/headlines/claim { limit 1-60 (40), days 1-60 (30) }
export async function headlineClaim(env, body) {
  const limit = clampInt(body?.limit, 1, HEADLINE_MAX_CLAIM, HEADLINE_DEFAULT_CLAIM);
  const days = clampInt(body?.days, 1, HEADLINE_MAX_DAYS, HEADLINE_DEFAULT_DAYS);
  const now = nowIso();
  const until = nowIso(Date.now() + LEASE_MINUTES * 60_000);
  const since = nowIso(Date.now() - days * 86_400_000);
  const claimId = crypto.randomUUID();
  const took = await lease(env, KINDS.coverage, claimId, until, since, now, limit);
  await lease(env, KINDS.aux, claimId, until, since, now, limit - took);
  const items = [];
  let remaining = 0;
  for (const [kind, k] of Object.entries(KINDS)) {
    const rows = (await env.DB.prepare(
      `SELECT '${kind}' AS kind, i.id AS item_id, ${k.name}, i.title, i.url, i.published, i.nm_first_seen AS first_seen,
              substr(i.excerpt, 1, ${EXCERPT_CHARS}) AS excerpt, g.score, g.band, g.why
         FROM ${k.table} i LEFT JOIN ${k.grades} g ON g.id = i.grade_id
        WHERE i.headline_claim_id = ? AND i.headline IS NULL ORDER BY i.nm_first_seen DESC, i.id DESC`,
    ).bind(claimId).all()).results || [];
    items.push(...rows);
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${k.table} WHERE ${WAITING} AND ${FREE}`).bind(since, now).first();
    remaining += left?.n || 0;
  }
  return { claim_id: claimId, lease_minutes: LEASE_MINUTES, days, items, remaining };
}

const itemId = (v) => {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v) || null;
  return null;
};

// POST /v1/headlines { claim_id, headlines: [{ kind, item_id, headline, tag }] }
// -> { accepted, rejected: [{ kind, item_id, error }], results }. Each entry
// is checked like a grade's headline and tag; items must be in the claim (admin
// may omit claim_id). A resubmitted file is accepted again and writes the same
// values. Only headline, headline_tag, headline_at and the lease end change.
export async function submitHeadlines(env, body, role) {
  if (!body || !Array.isArray(body.headlines)) return json({ error: "body.headlines must be an array" }, 400);
  if (body.headlines.length > HEADLINE_MAX_CLAIM * 2) return json({ error: "too many headlines in one request" }, 400);
  const claimId = body.claim_id ? String(body.claim_id) : null;
  if (!claimId && role !== "admin") return json({ error: "claim_id is required" }, 400);
  const items = { coverage: new Map(), aux: new Map() };
  for (const [kind, k] of Object.entries(KINDS)) {
    const ids = [...new Set(body.headlines.filter((h) => h?.kind === kind).map((h) => itemId(h?.item_id)).filter((x) => x != null))];
    for (const part of chunk(ids)) {
      const ph = part.map(() => "?").join(",");
      for (const r of (await env.DB.prepare(`SELECT id, headline_claim_id FROM ${k.table} WHERE id IN (${ph})`).bind(...part).all()).results || []) {
        items[kind].set(r.id, r);
      }
    }
  }
  const now = nowIso();
  const rejected = [], results = [], stmts = [];
  const seen = new Set();
  for (const raw of body.headlines) {
    const kind = raw?.kind ?? null;
    const ref = raw?.item_id ?? null;
    const no = (error) => rejected.push({ kind, item_id: ref, error });
    if (!raw || typeof raw !== "object") { no("each entry must be an object { kind, item_id, headline, tag }"); continue; }
    if (!KINDS[kind]) { no('kind must be "coverage" or "aux" (as the claim printed it)'); continue; }
    const id = itemId(ref);
    if (id == null) { no("item_id must be the integer item_id the claim printed"); continue; }
    const head = normalizeHeadline(raw, { required: true });
    if (!head.ok) { no(head.error); continue; }
    const item = items[kind].get(id);
    if (!item) { no(`unknown ${kind} item ${id}`); continue; }
    if (claimId && item.headline_claim_id !== claimId) { no(`${kind} item ${id} is not in headline claim ${claimId}; write headlines only for items from your claim`); continue; }
    const key = `${kind}|${id}`;
    if (seen.has(key)) { no(`${kind} item ${id} is listed twice; send one headline per item`); continue; }
    seen.add(key);
    // A grade that writes a headline clears headline_claim_id (index.js,
    // auxiliary.js), so the guard keeps a grade that lands after the check
    // above. This pass's own write keeps the claim id, so a resubmit still works.
    const guard = claimId ? " AND headline_claim_id = ?" : "";
    stmts.push(env.DB.prepare(`UPDATE ${KINDS[kind].table} SET headline = ?, headline_tag = ?, headline_at = ?, headline_claimed_until = NULL WHERE id = ?${guard}`)
      .bind(head.headline, head.tag, now, id, ...(claimId ? [claimId] : [])));
    results.push({ kind, item_id: id, ref, headline: head.headline, tag: head.tag });
  }
  // All-or-nothing: a failure part-way through commits nothing, so a retry is safe.
  const out = stmts.length ? await env.DB.batch(stmts) : [];
  const written = [];
  results.forEach((r, i) => {
    const { ref, ...entry } = r;
    if (out[i]?.meta?.changes === 0) {
      rejected.push({ kind: r.kind, item_id: ref, error: `${r.kind} item ${r.item_id} left headline claim ${claimId} before this write (a grade wrote its headline); nothing was changed` });
    } else written.push(entry);
  });
  return json({ accepted: written.length, rejected, results: written });
}
