// Automatic source expansion: the capture and approve queue
// (plans/round5-expansion-approve-queue.md, Parts C and D, Worker side).
// Names Zenith already sees, but that have no source, become rows in
// expansion_candidates (migration 0012); the owner approves or rejects each
// one on the app's Tuning page, and the weekly compile (Part E) marks approved
// rows compiled once they are in plans/triage/build-list.json.
//   app, admin : GET  /v1/expansion/candidates?status=pending&limit=50[&days=30]
//                (days applies to rejected and compiled only)
//                POST /v1/expansion/decide   { id, action: approve | reject | reopen, reason?, note?, tickers? }
//                POST /v1/expansion/compiled { items: [{ id, tickers, ref? }], ref }
//   cron       : expansionBackfill, once (meta expansion_backfill_at, D4)
// Nothing here writes news-monitor-db, sends to Discord or adds a source.
//
// Shared helpers (Parts A, B and C2 call these):
//
//   candidateName(name) -> string | null
//     The cleaned display name, or null when the name may not be a candidate:
//     NFC, curly apostrophes made straight, whitespace squashed, one trailing
//     parenthetical (a ticker) stripped; then null when it is under 2 or over
//     80 characters (checked before any clip), holds a URL or a control
//     character, or any character other than Unicode letters, digits, space
//     and . & ' - ,
//
//   dedupeKey(name) -> string
//     The normalized name (C3): NFKD, combining marks stripped, lowercase,
//     parentheticals dropped, . and ' removed, every other character that is
//     not a letter, digit or space made a space, trailing legal suffixes
//     (LEGAL_SUFFIXES) stripped repeatedly while more than one word is left,
//     spaces collapsed. "" when nothing is left (the caller drops the name).
//
//   coveredTicker(name) -> ticker | null
//     The covered ticker whose covered name (the ticker, the sheet's name: or
//     first terms entry, key-accounts company_names; never MATCH.terms) has
//     the same dedupe key.
//
//   upsertSightings(db, sightings, { now? }) -> Promise<{ ok, upserted, warnings }>
//     sightings: [{ name, origin, relation, subject, tickers, kind, item_id, url, title, at, party?, aliases? }]
//       name      the candidate name (goes through candidateName and dedupeKey)
//       origin    grader_relation | sec_filing | aux_entity
//       relation  one of RELATION_TYPES, or null (aux_entity)
//       subject   the ticker or aux entity it relates to, or null
//       tickers   covered tickers it links to (others are dropped)
//       kind      coverage | aux; with item_id, the seen key "<kind>:<item_id>"
//       url, title, at   the evidence item (at: its first-seen time)
//       party     optional raw party text (Part B), clipped to 120
//       aliases   optional other names of the same party (Part B's legal
//                 name): the own-source and term tests run on them too
//     One SELECT (aux_items entities) and one batch of upserts. Each upsert
//     adds the seen key only when absent, merges origins, tickers and known
//     notes, puts the item first in evidence (newest 5), sets last_seen_at
//     and never changes status. A new row is 'known' when it has its own
//     source, else 'pending', with term notes in known. Never throws: a bad
//     sighting is skipped with a warning; a failed batch (including a
//     zenith-db before migration 0012) gives ok: false and a warning.
//     warnings: [{ item_id, warning }].
//
//   upsertAfterGrades(db, sightings, opts) -> Promise<warnings>
//     The second batch after a grade submit commits (A3): upsertSightings in
//     try/catch, returning only its warnings.
//
//   relationSightings(relations, { kind, subject, tickers, item }) -> sightings
//     A grade's kept relations (lib.js normalizeRelations, A2) as
//     grader_relation sightings of the graded item { id, url, title, at }.
//
//   candidateName, dedupeKey, coveredTicker, LEGAL_SUFFIXES, RELATION_TYPES
//     are defined in lib.js (the grade validators use them) and re-exported.
//
//   auxEntitySighting(grade, item) -> sighting | null
//     Part C2: an accepted aux grade's own entity, when score >= 70 and
//     event_type is financing or acquisition, the entity passes
//     candidateName and is not a placeholder. grade: { entity, score,
//     event_type, reads_through (JSON text or array) }; item: { id, url,
//     title, nm_first_seen }.
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { MATCH } from "./rubric.generated.js";
import { json, nowIso, chunk, isHttpUrl, candidateName, dedupeKey, coveredTicker, LEGAL_SUFFIXES, RELATION_TYPES } from "./lib.js";
import { getMeta, setMeta } from "./ingest.js";

// The name helpers and the relation types live in lib.js, beside the grade
// validators that use them (Part A); they are re-exported here for Parts B and C.
export { candidateName, dedupeKey, coveredTicker, LEGAL_SUFFIXES, RELATION_TYPES };
export const ORIGINS = ["grader_relation", "sec_filing", "aux_entity"];
export const STATUSES = ["pending", "approved", "rejected", "compiled", "known"];
export const DECISION_ACTIONS = ["approve", "reject", "reopen"];
// D2: why the owner rejected a candidate; mirrored in the app.
export const REJECT_REASONS = ["not_relevant", "wrong_name", "duplicate", "already_tracked", "too_small", "no_free_source"];
export const EVIDENCE_MAX = 5;
// C2 (owner-confirmed 2026-11-24): financing or acquisition, score 70 or more.
export const AUX_ENTITY_MIN_SCORE = 70;
export const AUX_ENTITY_EVENTS = ["financing", "acquisition"];
export const BACKFILL_DAYS = 30;
export const BACKFILL_META = "expansion_backfill_at";

const DAY = 86_400_000;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, n) || null);
const clampInt = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || dflt));
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const isMissingTable = (e) => /no such table/i.test(String(e?.message || e));
const NOT_YET = "expansion queue not available yet: migration 0012 is not applied";

// Own sources from the bundled registry: every aux-sources.json source's name
// and entity (all 148 counterparty keys are there too).
const AUX_KEYS = new Map();
for (const [key, e] of Object.entries(AUX.sources || {}).sort(([a], [b]) => a.localeCompare(b))) {
  for (const n of [e?.name, e?.entity]) {
    const k = dedupeKey(n);
    if (k && !AUX_KEYS.has(k)) AUX_KEYS.set(k, key);
  }
}
// Named only as a term (C3): stays pending with a note.
const TERM_NOTES = new Map();
const addTerm = (term, note) => {
  const k = dedupeKey(term);
  if (!k) return;
  if (!TERM_NOTES.has(k)) TERM_NOTES.set(k, new Set());
  TERM_NOTES.get(k).add(note);
};
for (const [t, m] of Object.entries(MATCH || {})) {
  for (const term of m.terms || []) addTerm(term, `sheet_term:${t}`);
  for (const term of m.accounts || []) addTerm(term, `key_account:${t}`);
}

const humanize = (key) => String(key ?? "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// Entities already in zenith-db's aux_items (C3): runtime managed_* and ia_*
// sources such as ia_rockwell, which aux-sources.json does not list. Media
// rows, coverage-subject filters and the "Other company" placeholder are not
// a company's own source. Only an exact key match is an own source (C3). A
// runtime source named only by its key ("Rockwell" from ia_rockwell) whose key
// is a word prefix of a longer name ("Rockwell Automation", but also "Siemens
// Energy" from ia_siemens) adds a note only, aux_item_prefix:<source>, and the
// row stays pending for the owner to decide.
async function runtimeEntities(db) {
  const rows = (await db.prepare(
    `SELECT entity_key, entity_name, MIN(source_key) AS source_key FROM aux_items
      WHERE status != 'media' AND COALESCE(coverage_subject, 0) = 0 AND entity_name NOT IN ('Other company', 'Industry media')
      GROUP BY entity_key, entity_name`,
  ).all()).results || [];
  const exact = new Map(), prefix = new Map();
  for (const r of rows) {
    for (const n of [r.entity_name, r.entity_key]) {
      const k = dedupeKey(n);
      if (k && !exact.has(k)) exact.set(k, r.source_key);
    }
    if (/^(managed|ia)_/.test(r.source_key) && r.entity_name === humanize(r.entity_key)) {
      const k = dedupeKey(r.entity_name);
      if (k && !prefix.has(k)) prefix.set(k, r.source_key);
    }
  }
  return { exact, prefix };
}

// The registry matches of a set of names: { own: [...], terms: [...] }.
// own sets status 'known' on a new row; terms are notes only (sheet_term,
// key_account, aux_item_prefix).
export function registryNotes(names, runtime = { exact: new Map(), prefix: new Map() }) {
  const own = new Set(), terms = new Set();
  for (const n of names) {
    const k = dedupeKey(n);
    if (!k) continue;
    const t = coveredTicker(k);
    if (t) own.add(`covered:${t}`);
    if (AUX_KEYS.has(k)) own.add(`aux_source:${AUX_KEYS.get(k)}`);
    if (runtime.exact.has(k)) own.add(`aux_item:${runtime.exact.get(k)}`);
    for (const [p, src] of runtime.prefix) if (k.startsWith(p + " ")) terms.add(`aux_item_prefix:${src}`);
    for (const note of TERM_NOTES.get(k) || []) terms.add(note);
  }
  return { own: [...own].sort(), terms: [...terms].sort() };
}

const coveredList = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === "string")
  .map((x) => x.trim().toUpperCase()).filter((x) => COVERED.tickers.includes(x)))].sort();

// --- Upsert (C1) --------------------------------------------------------------
// ?1 dedupe_key ?2 name ?3 origin ?4 relation ?5 subject ?6 tickers ?7 seen key
// ?8 evidence entry ?9 known ?10 status ?11 now ?12 kind ?13 item_id
const UPSERT_SQL = `INSERT INTO expansion_candidates (dedupe_key, name, origins, relation, subject, tickers, seen, evidence, known, status, created_at, last_seen_at)
  VALUES (?1, ?2, json_array(?3), ?4, ?5, json(?6), json_array(?7), json_array(json(?8)), ?9, ?10, ?11, ?11)
  ON CONFLICT(dedupe_key) DO UPDATE SET
    origins = CASE WHEN EXISTS (SELECT 1 FROM json_each(expansion_candidates.origins) WHERE value = ?3) THEN expansion_candidates.origins
                   ELSE json_insert(expansion_candidates.origins, '$[#]', ?3) END,
    relation = COALESCE(expansion_candidates.relation, ?4),
    subject = COALESCE(expansion_candidates.subject, ?5),
    tickers = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(expansion_candidates.tickers) UNION SELECT value FROM json_each(?6) ORDER BY 1)),
    seen = CASE WHEN EXISTS (SELECT 1 FROM json_each(expansion_candidates.seen) WHERE value = ?7) THEN expansion_candidates.seen
                ELSE json_insert(expansion_candidates.seen, '$[#]', ?7) END,
    evidence = (SELECT json_group_array(json(v)) FROM (
                 SELECT v FROM (SELECT ?8 AS v, -1 AS k
                                UNION ALL
                                SELECT value AS v, key AS k FROM json_each(expansion_candidates.evidence)
                                 WHERE NOT (json_extract(value, '$.kind') IS ?12 AND json_extract(value, '$.item_id') IS ?13 AND json_extract(value, '$.origin') IS ?3))
                  ORDER BY k LIMIT ${EVIDENCE_MAX})),
    known = CASE WHEN ?9 IS NULL THEN expansion_candidates.known
                 WHEN expansion_candidates.known IS NULL THEN ?9
                 ELSE (SELECT json_group_array(value) FROM (SELECT value FROM json_each(expansion_candidates.known) UNION SELECT value FROM json_each(?9) ORDER BY 1)) END,
    last_seen_at = ?11`;

// One sighting -> { row } (the bound values) or { warning }.
function prepareSighting(s, runtime, now) {
  if (!s || typeof s !== "object") return { warning: "sighting must be an object" };
  const name = candidateName(s.name);
  if (!name) return { warning: `name ${JSON.stringify(String(s.name ?? "")).slice(0, 100)} is not a candidate name` };
  const key = dedupeKey(name);
  if (!key) return { warning: `name ${JSON.stringify(name)} has an empty dedupe key` };
  if (!ORIGINS.includes(s.origin)) return { warning: `origin must be one of ${ORIGINS.join(", ")}` };
  const relation = s.relation == null || s.relation === "" ? null : String(s.relation);
  if (relation !== null && !RELATION_TYPES.includes(relation)) return { warning: `relation must be one of ${RELATION_TYPES.join(", ")} (or null)` };
  if (s.kind !== "coverage" && s.kind !== "aux") return { warning: "kind must be coverage or aux" };
  const itemId = Number(s.item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) return { warning: "item_id must be the evidence item id" };
  const aliases = (Array.isArray(s.aliases) ? s.aliases : []).map(candidateName).filter(Boolean);
  const notes = registryNotes([name, ...aliases], runtime);
  const all = [...new Set([...notes.own, ...notes.terms])].sort();
  const evidence = { kind: s.kind, item_id: itemId, url: isHttpUrl(s.url) ? String(s.url).slice(0, 500) : null, title: clip(s.title, 300),
    at: clip(s.at, 40), origin: s.origin };
  const party = clip(s.party, 120);
  if (party) evidence.party = party;
  return {
    key, name, own: notes.own,
    binds: [key, name, s.origin, relation, clip(s.subject, 80), JSON.stringify(coveredList(s.tickers)), `${s.kind}:${itemId}`,
      JSON.stringify(evidence), all.length ? JSON.stringify(all) : null, notes.own.length ? "known" : "pending", now, s.kind, itemId],
  };
}

export async function upsertSightings(db, sightings, { now = nowIso() } = {}) {
  const warnings = [];
  try {
    const list = Array.isArray(sightings) ? sightings : [];
    if (!list.length) return { ok: true, upserted: 0, warnings };
    const runtime = await runtimeEntities(db);
    const stmts = [];
    for (const s of list) {
      const p = prepareSighting(s, runtime, now);
      if (p.warning) { warnings.push({ item_id: s?.item_id ?? null, warning: `expansion candidate skipped: ${p.warning}` }); continue; }
      stmts.push(db.prepare(UPSERT_SQL).bind(...p.binds));
    }
    if (stmts.length) await db.batch(stmts);
    return { ok: true, upserted: stmts.length, warnings };
  } catch (e) {
    const why = isMissingTable(e) ? NOT_YET : `expansion candidates not saved: ${String(e?.message || e).slice(0, 200)}`;
    warnings.push({ item_id: null, warning: why });
    return { ok: false, upserted: 0, warnings };
  }
}

// The second batch after a grade submit commits (A3, C2): upserts the
// sightings and returns only warnings. Wrapped in try/catch, so a failure
// (including a zenith-db before migration 0012) is a warning and never
// touches the grades already stored.
export async function upsertAfterGrades(db, sightings, opts = {}) {
  if (!Array.isArray(sightings) || !sightings.length) return [];
  try {
    return (await upsertSightings(db, sightings, opts)).warnings;
  } catch (e) {
    return [{ item_id: null, warning: `expansion candidates not saved: ${String(e?.message || e).slice(0, 200)}` }];
  }
}

// A grade's kept relations as sightings (A3). subject: the grade's ticker or
// entity; tickers: the covered tickers it links to; item: the graded item
// { id, url, title, at }.
export function relationSightings(relations, { kind, subject, tickers, item }) {
  return (relations || []).map((r) => ({ name: r.name, origin: "grader_relation", relation: r.type, subject, tickers, kind,
    item_id: item.id, url: item.url, title: item.title, at: item.at ?? null }));
}

// --- Aux entity rule (C2) and the one-time backfill (D4) ----------------------
const PLACEHOLDERS = new Set(["industry media", "unknown", "various", "other company"].map(dedupeKey));
export function auxEntitySighting(grade, item) {
  if (!grade || !item) return null;
  const score = Number(grade.score);
  if (grade.score == null || !Number.isInteger(score) || score < AUX_ENTITY_MIN_SCORE) return null;
  if (!AUX_ENTITY_EVENTS.includes(String(grade.event_type ?? "").trim().toLowerCase())) return null;
  const name = candidateName(grade.entity);
  if (!name || PLACEHOLDERS.has(dedupeKey(name))) return null;
  const rt = typeof grade.reads_through === "string" ? parse(grade.reads_through, []) : grade.reads_through;
  const tickers = coveredList((Array.isArray(rt) ? rt : []).map((x) => x?.ticker));
  return { name, origin: "aux_entity", relation: null, subject: null, tickers, kind: "aux", item_id: item.id ?? item.item_id,
    url: item.url, title: item.title, at: item.nm_first_seen ?? item.first_seen ?? null };
}

// Runs C2 over each aux item's current grade graded in the last 30 days, once:
// meta expansion_backfill_at is set only after the upsert batch succeeds, so a
// zenith-db before migration 0012 tries again on a later tick.
export async function expansionBackfill(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const done = await getMeta(db, BACKFILL_META);
  if (done) return { skipped: "done", at: done };
  let rows;
  try {
    await db.prepare("SELECT 1 FROM expansion_candidates LIMIT 1").all();
    rows = (await db.prepare(
      `SELECT i.id, i.url, i.title, i.nm_first_seen, g.entity, g.score, g.event_type, g.reads_through
         FROM aux_items i JOIN aux_grades g ON g.id = i.grade_id
        WHERE g.graded_at >= ? AND g.score >= ? AND lower(trim(g.event_type)) IN (${AUX_ENTITY_EVENTS.map(() => "?").join(", ")})
        ORDER BY i.id`,
    ).bind(nowIso(now - BACKFILL_DAYS * DAY), AUX_ENTITY_MIN_SCORE, ...AUX_ENTITY_EVENTS).all()).results || [];
  } catch (e) {
    if (isMissingTable(e)) return { skipped: "no table" };
    throw e;
  }
  const sightings = rows.map((r) => auxEntitySighting(r, r)).filter(Boolean);
  const res = await upsertSightings(db, sightings, { now: nowIso(now) });
  if (!res.ok) return { scanned: rows.length, candidates: sightings.length, upserted: 0, warnings: res.warnings.map((w) => w.warning) };
  const at = nowIso(now);
  await setMeta(db, BACKFILL_META, at).run();
  return { scanned: rows.length, candidates: sightings.length, upserted: res.upserted, warnings: res.warnings.map((w) => w.warning), at };
}

// --- Routes (D1) --------------------------------------------------------------
// Statuses listed with a days filter on the last decision. approved is an open
// work queue like pending and known: the weekly compile reads it with no days
// (E3 step 1) and names may wait there for weeks once the Bing headroom is used
// up (E2), so it has no age filter and its list agrees with counts.approved.
const DECIDED = ["rejected", "compiled"];
const lastOf = (list) => (list.length ? list[list.length - 1] : null);

// What the owner may do with a row in this status (C4).
export function allowedActions(status) {
  return { pending: ["approve", "reject"], approved: ["reject"], rejected: ["approve"], known: ["reopen"], compiled: [] }[status] || [];
}
function blockedText(row, known) {
  if (row.status === "compiled") return `compiled into the build list${row.compiled_ref ? ` as ${row.compiled_ref}` : ""}${row.compiled_at ? ` on ${row.compiled_at.slice(0, 10)}` : ""}: it takes no more decisions`;
  if (row.status === "known") return `already has its own source (${(known || []).filter((n) => !/^(sheet_term|key_account|aux_item_prefix):/.test(n)).join(", ") || "registry"}): use Not the same company to reopen it first`;
  return null;
}

function shapeRow(r, similar) {
  const decisions = parse(r.decisions, []);
  const known = r.known == null ? null : parse(r.known, null);
  const last = lastOf(decisions);
  const actions = allowedActions(r.status);
  const blocked = blockedText(r, known);
  const seen = parse(r.seen, []);
  return {
    id: r.id, name: r.name, dedupe_key: r.dedupe_key, status: r.status, relation: r.relation, subject: r.subject,
    origins: parse(r.origins, []), tickers: parse(r.tickers, []), sightings: seen.length, seen, evidence: parse(r.evidence, []), known,
    similar: similar.get(r.id) || [], decisions, decision: last,
    approved_tickers: (r.status === "approved" || r.status === "compiled") && last ? (last.tickers ?? []) : null,
    compiled_at: r.compiled_at, compiled_ref: r.compiled_ref, created_at: r.created_at, last_seen_at: r.last_seen_at,
    actions, decidable: actions.includes("approve") || actions.includes("reject"), blocked,
  };
}

// Similar hint (C3): a key that is a word prefix of another key. Both rows
// name the other; nothing is merged.
function similarMap(all, ids) {
  const out = new Map();
  const want = new Set(ids);
  for (const a of all) {
    if (!want.has(a.id)) continue;
    const list = [];
    for (const b of all) {
      if (a.id === b.id) continue;
      if (b.dedupe_key.startsWith(a.dedupe_key + " ") || a.dedupe_key.startsWith(b.dedupe_key + " ")) list.push({ id: b.id, name: b.name, status: b.status });
    }
    if (list.length) out.set(a.id, list.slice(0, 5));
  }
  return out;
}

export async function expansionCandidates(env, url) {
  const q = url.searchParams;
  const status = (q.get("status") || "pending").trim().toLowerCase();
  if (!STATUSES.includes(status)) return json({ error: `status must be one of ${STATUSES.join(", ")}` }, 400);
  const limit = clampInt(q.get("limit"), 1, 200, 50);
  const days = DECIDED.includes(status) ? clampInt(q.get("days"), 1, 3650, 30) : null;
  const db = env.DB;
  let rows, counts, all;
  try {
    const since = days ? nowIso(Date.now() - days * DAY) : null;
    rows = (await db.prepare(
      `SELECT * FROM expansion_candidates WHERE status = ?
         ${since ? "AND COALESCE(json_extract(decisions, '$[#-1].at'), last_seen_at) >= ?" : ""}
       ORDER BY last_seen_at DESC, id DESC LIMIT ?`,
    ).bind(status, ...(since ? [since] : []), limit).all()).results || [];
    counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of (await db.prepare("SELECT status, COUNT(*) AS n FROM expansion_candidates GROUP BY status").all()).results || []) counts[r.status] = r.n;
    all = (await db.prepare("SELECT id, dedupe_key, name, status FROM expansion_candidates").all()).results || [];
  } catch (e) {
    if (isMissingTable(e)) return json({ error: NOT_YET }, 404);
    throw e;
  }
  const similar = similarMap(all, rows.map((r) => r.id));
  return json({ status, days, limit, counts, reject_reasons: REJECT_REASONS, candidates: rows.map((r) => shapeRow(r, similar)) });
}

// body.tickers -> { ok, tickers (null when absent) } or { ok: false, error }.
function bodyTickers(v) {
  if (v === undefined || v === null) return { ok: true, tickers: null };
  if (!Array.isArray(v) || v.length > COVERED.tickers.length) return { ok: false, error: "tickers must be an array of covered tickers" };
  const out = new Set();
  for (const x of v) {
    const t = typeof x === "string" ? x.trim().toUpperCase() : "";
    if (!COVERED.tickers.includes(t)) return { ok: false, error: `ticker ${t || JSON.stringify(x)} is not a covered ticker` };
    out.add(t);
  }
  return { ok: true, tickers: [...out].sort() };
}

// C4 as refusals: null when the action may run, else the error text.
export function decisionRefusal(row, action) {
  const id = row.id;
  if (row.status === "compiled") return `candidate ${id} is compiled into the build list: it takes no more decisions`;
  if (row.status === "known" && action !== "reopen") return `candidate ${id} already has its own source: reopen it first (Not the same company), then ${action}`;
  if (action === "reopen" && row.status !== "known") return `only a known candidate can be reopened; candidate ${id} is ${row.status}`;
  if (action === "approve" && row.status === "approved") return `candidate ${id} is already approved`;
  if (action === "reject" && row.status === "rejected") return `candidate ${id} is already rejected`;
  return null;
}

const NEXT = { approve: "approved", reject: "rejected", reopen: "pending" };

export async function expansionDecide(env, body, role) {
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "id must be the candidate id" }, 400);
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!DECISION_ACTIONS.includes(action)) return json({ error: `action must be one of ${DECISION_ACTIONS.join(", ")}` }, 400);
  const rawReason = body?.reason;
  const reason = rawReason === undefined || rawReason === null || rawReason === "" ? null : typeof rawReason === "string" ? rawReason.trim().toLowerCase() : "";
  if (action === "reject" && !REJECT_REASONS.includes(reason ?? "")) return json({ error: `reject needs a reason: one of ${REJECT_REASONS.join(", ")}` }, 400);
  if (action !== "reject" && reason !== null) return json({ error: "reason is only for reject" }, 400);
  const tk = bodyTickers(body?.tickers);
  if (!tk.ok) return json({ error: tk.error }, 400);
  if (body?.note != null && typeof body.note !== "string") return json({ error: "note must be a string" }, 400);
  const note = clip(body?.note, 500);
  const db = env.DB;
  let row;
  try {
    row = await db.prepare("SELECT id, status, tickers, decisions FROM expansion_candidates WHERE id = ?").bind(id).first();
  } catch (e) {
    if (isMissingTable(e)) return json({ error: NOT_YET }, 404);
    throw e;
  }
  if (!row) return json({ error: `unknown candidate ${id}` }, 404);
  const refusal = decisionRefusal(row, action);
  if (refusal) return json({ error: refusal }, 400);
  const tickers = action === "approve" ? (tk.tickers ?? coveredList(parse(row.tickers, []))) : tk.tickers;
  const decision = { at: nowIso(), by: role, action, reason, note, tickers };
  const status = NEXT[action];
  const r = await db.prepare(
    "UPDATE expansion_candidates SET status = ?, decisions = json_insert(decisions, '$[#]', json(?)) WHERE id = ? AND status = ?",
  ).bind(status, JSON.stringify(decision), id, row.status).run();
  if (!r.meta?.changes) return json({ error: `candidate ${id} changed while deciding: reload and try again` }, 400);
  return json({ ok: true, id, status, was: row.status, decision });
}

const sameList = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// Marks approved rows compiled (E3 step 10), only when each is still approved
// with the tickers the compile read; the others are returned as mismatches and
// left unchanged.
export async function expansionCompiled(env, body, role) {
  const items = body?.items;
  if (!Array.isArray(items) || !items.length || items.length > 200) return json({ error: "items must be an array of 1-200 { id, tickers }" }, 400);
  const bodyRef = clip(body?.ref, 80);
  const want = [];
  for (const it of items) {
    const id = Number(it?.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "each item needs id: the candidate id" }, 400);
    if (!Array.isArray(it?.tickers)) return json({ error: `item ${id} needs tickers: the approved tickers read (may be [])` }, 400);
    const ref = clip(it?.ref, 80) || bodyRef;
    if (!ref) return json({ error: `item ${id} needs a ref (the build-list entry id), in the item or the body` }, 400);
    if (want.some((w) => w.id === id)) return json({ error: `candidate ${id} is listed twice` }, 400);
    want.push({ id, tickers: it.tickers.map((x) => String(x).trim().toUpperCase()), ref });
  }
  const db = env.DB;
  const rows = new Map();
  try {
    for (const part of chunk(want.map((w) => w.id))) {
      const ph = part.map(() => "?").join(",");
      for (const r of (await db.prepare(`SELECT id, status, decisions FROM expansion_candidates WHERE id IN (${ph})`).bind(...part).all()).results || []) rows.set(r.id, r);
    }
  } catch (e) {
    if (isMissingTable(e)) return json({ error: NOT_YET }, 404);
    throw e;
  }
  const mismatches = [], todo = [];
  const now = nowIso();
  for (const w of want) {
    const r = rows.get(w.id);
    if (!r) { mismatches.push({ id: w.id, error: `unknown candidate ${w.id}` }); continue; }
    if (r.status !== "approved") { mismatches.push({ id: w.id, status: r.status, error: `candidate ${w.id} is ${r.status}, not approved` }); continue; }
    const decisions = parse(r.decisions, []);
    const approved = lastOf(decisions)?.tickers ?? [];
    if (!sameList(approved, w.tickers)) {
      mismatches.push({ id: w.id, status: r.status, approved_tickers: approved, tickers: w.tickers, error: `candidate ${w.id} is approved for [${approved.join(", ")}], not [${w.tickers.join(", ")}]` });
      continue;
    }
    const entry = { at: now, by: role, action: "compiled", reason: null, note: null, tickers: [...approved].sort(), ref: w.ref };
    todo.push({ w, n: decisions.length, stmt: db.prepare(
      `UPDATE expansion_candidates SET status = 'compiled', compiled_at = ?, compiled_ref = ?, decisions = json_insert(decisions, '$[#]', json(?))
        WHERE id = ? AND status = 'approved' AND json_array_length(decisions) = ?`,
    ).bind(now, w.ref, JSON.stringify(entry), w.id, decisions.length) });
  }
  const compiled = [];
  if (todo.length) {
    const res = await db.batch(todo.map((t) => t.stmt));
    todo.forEach((t, k) => {
      if (res[k]?.meta?.changes) compiled.push(t.w.id);
      else mismatches.push({ id: t.w.id, error: `candidate ${t.w.id} changed while compiling: read it again` });
    });
  }
  return json({ ok: mismatches.length === 0, compiled, mismatches });
}
