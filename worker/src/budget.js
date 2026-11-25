// Phase 0 gates: the daily grading budget. Rows the arrival gate admits past
// the fast path (lib.js arrivalGate: record_late, seed_window, seed_fresh) and
// rows an admin rescue turns back into work (admit 'rescue') are stored
// pending but held (admit set, released_at NULL): the claims never return
// them. releaseHeld, on every 5-minute cron, releases at most TOTAL a UTC day
// across both pipelines, at most PER_SOURCE per source, and only into a
// pipeline whose claimable queue is under GUARD, so a dark grader never piles
// released rows up. Rows over the day's budget stay held (pending, never
// skipped) for the next UTC day.
//
// Overrides only through Worker secrets (they survive `wrangler deploy`;
// wrangler.toml has no [vars]): GATE_BUDGET_TOTAL, GATE_BUDGET_PER_SOURCE,
// GATE_QUEUE_GUARD.
import COVERED from "./covered.json";
import { HELD_SQL, universeSql, nowIso, chunk } from "./lib.js";

export const GATE_BUDGET_TOTAL = 20;
export const GATE_BUDGET_PER_SOURCE = 5;
export const GATE_QUEUE_GUARD = 60;
const IN_UNIVERSE = universeSql(COVERED.tickers);

// A whole non-negative number from a secret, else the default.
const setting = (v, dflt) => {
  if (v === undefined || v === null || String(v).trim() === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
};
export function budgetSettings(env = {}) {
  return {
    total: setting(env.GATE_BUDGET_TOTAL, GATE_BUDGET_TOTAL),
    per_source: setting(env.GATE_BUDGET_PER_SOURCE, GATE_BUDGET_PER_SOURCE),
    guard: setting(env.GATE_QUEUE_GUARD, GATE_QUEUE_GUARD),
  };
}

// 00:00 UTC of the day `now` (ms) falls in, as an ISO string.
export const utcDayStart = (now = Date.now()) => `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;

// The pipelines, coverage first (the cron serves coverage first). Coverage
// releases only rows of today's universe, as its feed shows.
const TABLES = [
  { kind: "coverage", table: "items", scope: `AND ticker IN ${IN_UNIVERSE}` },
  { kind: "aux", table: "aux_items", scope: "" },
];

// Rows released since 00:00 UTC, per source, across both tables. Rescue rows
// count: this same function releases them.
export async function releasedToday(db, now = Date.now()) {
  const day = utcDayStart(now);
  const rows = (await db.prepare(
    `SELECT source_key, COUNT(*) AS n FROM (SELECT source_key FROM items WHERE released_at >= ?1
       UNION ALL SELECT source_key FROM aux_items WHERE released_at >= ?1) GROUP BY source_key`,
  ).bind(day).all()).results || [];
  return new Map(rows.map((r) => [r.source_key, r.n]));
}

// Held rows per pipeline (pending, admitted, not yet released).
export async function heldCounts(db) {
  const out = {};
  for (const t of TABLES) {
    out[t.kind] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE state = 'pending' AND ${HELD_SQL()} ${t.scope}`).first())?.n || 0;
  }
  return out;
}

export async function releaseHeld(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const cfg = budgetSettings(env);
  const used = await releasedToday(db, now);
  const usedTotal = [...used.values()].reduce((a, b) => a + b, 0);
  let left = cfg.total - usedTotal;
  const released = { coverage: 0, aux: 0 };
  const at = nowIso(now);
  for (const t of TABLES) {
    if (left <= 0) break;
    const queued = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE state IN ('pending','claimed') AND NOT ${HELD_SQL()}`).first())?.n || 0;
    let room = cfg.guard - queued;
    if (room <= 0) continue;
    // At most PER_SOURCE candidates per source in SQL, so one big seed never
    // hides every other source. A new source's fresh first-poll rows
    // (seed_fresh) come first: they are time-sensitive; then oldest first.
    const cands = (await db.prepare(
      `SELECT id, source_key, admit, nm_first_seen, rn FROM (
         SELECT id, source_key, admit, nm_first_seen,
                ROW_NUMBER() OVER (PARTITION BY source_key ORDER BY (admit = 'seed_fresh') DESC, nm_first_seen, id) AS rn
           FROM ${t.table} WHERE state = 'pending' AND ${HELD_SQL()} ${t.scope})
        WHERE rn <= ?1 ORDER BY (admit = 'seed_fresh') DESC, nm_first_seen, id LIMIT 500`,
    ).bind(cfg.per_source).all()).results || [];
    const pick = [];
    for (const c of cands) {
      if (left <= 0 || room <= 0) break;
      const u = used.get(c.source_key) || 0;
      if (u >= cfg.per_source) continue;
      pick.push(c.id);
      used.set(c.source_key, u + 1);
      left--;
      room--;
    }
    for (const part of chunk(pick)) {
      const r = await db.prepare(
        `UPDATE ${t.table} SET released_at = ? WHERE id IN (${part.map(() => "?").join(",")}) AND state = 'pending' AND released_at IS NULL`,
      ).bind(at, ...part).run();
      released[t.kind] += r.meta?.changes || 0;
    }
  }
  const usedToday = usedTotal + released.coverage + released.aux;
  return { released, held: await heldCounts(db), used_today: usedToday, left: Math.max(0, cfg.total - usedToday), budget: cfg, at };
}
