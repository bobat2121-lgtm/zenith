// Phase 2: the shadow page reader for auxiliary items. Once per cron tick,
// right after the held-row release, it reads the page of a few waiting aux
// rows from a record or issuer source (text-class.js) with the coverage reader
// (excerpt.js fetchExcerpt) and stores the text in aux_items.page_* (migration
// 0020), never in excerpt. The grader sees it only with AUX_TEXT_SHOW=1
// (auxiliary.js auxClaim); by default nothing it reads changes.
//
//   pick      one SELECT on aux_items_state: pending rows, or claimed with an
//             expired lease, no feed text, no page read yet, not held, not a
//             war.gov digest (wargov.js gives those their text), due
//   press     rows of class press are marked page_status 'skipped_class'
//             with no fetch, unless AUX_TEXT_PRESS=1
//   bounds    at most AUX_TEXT_PER_TICK (4) fetches a tick, at most one
//             sec.gov row (none while the SEC lease is held), at most one row
//             per registrable domain, never a host on NO_FETCH_HOSTS
//             ('skipped_policy'); no PDF is read. So at most 2 x 4 + 2 page
//             requests a call (a Federal Register row takes 2, a sec.gov row 4)
//   retries   the coverage reader's rules: 429, 5xx and errors up to
//             MAX_TRIES, a 403 or block page once more, 20/120/720 minutes
//             apart; a sec.gov row without CONTACT_EMAIL waits 720 minutes
//             without spending a try
//   write     a row claimed (live lease) or graded while it was read keeps no
//             page text, so the record of what the grader saw stays exact
//
// AUX_TEXT_PER_TICK=0 stops the pass (and lifts the claim hold).
import { nowIso, HELD_SQL } from "./lib.js";
import { fetchExcerpt, secLeaseHeld, RETRYABLE, REFUSED, MAX_TRIES, FORBIDDEN_TRIES, RETRY_MINUTES, NO_CONTACT_WAIT_MINUTES } from "./excerpt.js";
import { textClass, auxTextPerTick, auxTextPress, TEXT_BUDGET, NO_FETCH_HOSTS, noFetch } from "./text-class.js";
import { regDomain, hostOf } from "./domain.js";

export const AUX_TEXT_HOLD_MINUTES = 45;
const PICK_LIMIT = 20;
const CONCURRENCY = 4;
const SEC_PER_TICK = 1;

export const AUX_TEXT_PICK_SQL = `SELECT id, url, title, source_key, page_tries FROM aux_items
  WHERE state IN ('pending','claimed') AND (state = 'pending' OR claimed_until < ?1)
    AND excerpt_status IS NULL AND page_status IS NULL AND source_key != 'wargov_contracts'
    AND NOT ${HELD_SQL()} AND (page_next_at IS NULL OR page_next_at <= ?1)
  ORDER BY nm_first_seen DESC LIMIT ${PICK_LIMIT}`;

const isSec = (url) => /(^|\.)sec\.gov$/.test(hostOf(url));

// The final write: only while the row has no page status and is neither
// leased nor graded.
const finalStatement = (db) => db.prepare(
  `UPDATE aux_items SET page_excerpt = ?1, page_status = ?2, page_tries = ?3, page_at = ?4, page_cap = ?5
    WHERE id = ?6 AND page_status IS NULL AND (state = 'pending' OR (state = 'claimed' AND claimed_until < ?4))`,
);

// The update for one read (excerpt.js resultStatement's rules, on page_*).
// kind: "deferred" (no request, waits), "retry" (another try is scheduled) or
// "final" (page_status written).
function resultStatement(db, { row, status, excerpt, cap }, now, nowMs) {
  if (status === "skipped_sec_needs_contact") {
    return { kind: "deferred", stmt: db.prepare("UPDATE aux_items SET page_next_at = ? WHERE id = ? AND page_status IS NULL")
      .bind(nowIso(nowMs + NO_CONTACT_WAIT_MINUTES * 60_000), row.id) };
  }
  // No request was made for a no-fetch host: no try is spent.
  const tries = (row.page_tries || 0) + (status === "skipped_policy" ? 0 : 1);
  if ((RETRYABLE(status) && tries < MAX_TRIES) || (REFUSED(status) && tries < FORBIDDEN_TRIES)) {
    const wait = RETRY_MINUTES[Math.min(tries - 1, RETRY_MINUTES.length - 1)];
    return { kind: "retry", stmt: db.prepare("UPDATE aux_items SET page_tries = ?, page_next_at = ? WHERE id = ? AND page_status IS NULL")
      .bind(tries, nowIso(nowMs + wait * 60_000), row.id) };
  }
  return { kind: "final", stmt: finalStatement(db).bind(excerpt || null, status, tries, now, excerpt ? cap ?? null : null, row.id) };
}

// opts.now (ms) for tests; opts.noFetchHosts replaces NO_FETCH_HOSTS.
export async function enrichAuxText(env, { now = Date.now(), noFetchHosts = NO_FETCH_HOSTS } = {}) {
  const perTick = auxTextPerTick(env);
  if (perTick === 0) return { off: true };
  const db = env.DB;
  const at = nowIso(now);
  const rows = (await db.prepare(AUX_TEXT_PICK_SQL).bind(at).all()).results || [];
  const out = { tried: 0, ok: 0, retry: 0, blocked: 0, policy: 0, skipped_class: 0, sec_deferred: 0 };
  if (!rows.length) return out;
  const press = auxTextPress(env);
  const secBusy = rows.some((r) => isSec(r.url)) ? await secLeaseHeld(env, at) : false;
  const policy = (url) => noFetch(url, noFetchHosts);
  const stmts = [], take = [], domains = new Set();
  let fetching = 0, sec = 0;
  for (const row of rows) {
    const cls = textClass(row);
    if (cls === "press" && !press) {
      stmts.push(finalStatement(db).bind(null, "skipped_class", row.page_tries || 0, at, null, row.id));
      out.skipped_class++;
      continue;
    }
    // A no-fetch host is final without a request (fetchExcerpt answers it before any fetch).
    if (policy(row.url)) { take.push({ row, cls }); continue; }
    // Rows over a bound wait for a later tick.
    if (fetching >= perTick) continue;
    const domain = regDomain(hostOf(row.url));
    if (domain && domains.has(domain)) continue;
    if (isSec(row.url)) {
      if (secBusy || sec >= SEC_PER_TICK) { out.sec_deferred++; continue; }
      sec++;
    }
    if (domain) domains.add(domain);
    fetching++;
    take.push({ row, cls });
  }
  const results = [];
  for (let i = 0; i < take.length; i += CONCURRENCY) {
    results.push(...await Promise.all(take.slice(i, i + CONCURRENCY).map(({ row, cls }) =>
      fetchExcerpt(env, { ...row, role: "aux", excerpt_tries: row.page_tries || 0 }, { pdfBudget: { left: 0 }, budget: TEXT_BUDGET[cls], noFetch: policy })
        .then((r) => ({ row, ...r })))));
  }
  // tried: rows a request was made for; retry: of those, rows given another
  // try; ok and blocked: final results. A no-fetch host counts in policy, a
  // sec.gov row waiting for CONTACT_EMAIL in sec_deferred.
  for (const r of results) {
    const { kind, stmt } = resultStatement(db, r, at, now);
    stmts.push(stmt);
    if (r.status === "skipped_policy") { out.policy++; continue; }
    if (kind === "deferred") { out.sec_deferred++; continue; }
    out.tried++;
    if (kind === "retry") out.retry++;
    else if (r.status === "ok") out.ok++;
    else if (r.status === "blocked") out.blocked++;
  }
  if (stmts.length) await db.batch(stmts);
  return out;
}
