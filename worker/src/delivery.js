// Delivery on the 5-minute cron:
//   * Lead push: each newly accepted grade in the Lead band (and Digest >= 85
//     for a covered company's own item) goes to DISCORD_LEAD_WEBHOOK once. The
//     deliveries table stops double posts; a re-grade edits the same message.
//   * Heartbeat: one alert to DISCORD_OPS_WEBHOOK when the grader stops running
//     or covered items wait too long for a grade, and one recovery notice.
//   * Catch-up for scheduled reports whose cron was missed (brief.js).
// Every channel is a no-op while its webhook secret is unset.
import { nowIso } from "./lib.js";
import { etParts, etToUtc, fmtEt, fmtAge } from "./et.js";
import { discordSend, escapeMd, clip, link, figures, bandName } from "./discord.js";
import { catchUpReports, CURRENT_GRADE as CURRENT } from "./brief.js";

export const LEAD_MIN = 90;
export const OWN_DIGEST_PUSH_MIN = 85;
export const LEAD_FRESH_HOURS = 72;     // a first post needs an item first seen this recently
// ...and first seen within this long of its published date. news-monitor stores
// history it surfaces late (a widened filter's silentBefore items, a seed poll's
// older items) as already notified; this keeps the Lead channel from replaying it.
export const LEAD_MAX_LAG_HOURS = 72;
const EDIT_WINDOW_DAYS = 14;            // re-grades edit messages up to this old
const MAX_SENDS_PER_TICK = 8;
const CLAIM_MINUTES = 3;
const MAX_POST_ATTEMPTS = 4;            // failures in a row (429s not counted) before a row waits for a new grade
const HOUR = 3_600_000;

// CURRENT: the grade that is current for (item, ticker): the item's primary
// grade, or a cross-ticker grade from the same grading pass as the primary (the
// feed's rule, so a cross-ticker grade the next pass did not repeat counts as
// withdrawn). It needs `LEFT JOIN grades p ON p.id = i.grade_id`.
const pushable = (a) => `(${a}.band = 'lead' OR (${a}.band = 'digest' AND ${a}.score >= ${OWN_DIGEST_PUSH_MIN} AND i.role IS NULL AND ${a}.ticker = i.ticker))`;

const GRADE_COLS = `g.id AS grade_id, g.ticker, g.score, g.band, g.event_type, g.why, g.note_hook, g.magnitude_usd,
  g.magnitude_pct, g.read_source, g.confidence, g.graded_at`;
const ITEM_COLS = "i.id AS item_id, i.title, i.url, i.source_key, i.role, i.affects, i.ticker AS item_ticker, i.nm_first_seen";
const DELIVERY_COLS = `d.id AS delivery_id, d.grade_id AS shown_grade_id, d.score AS shown_score, d.band AS shown_band,
  d.message_id, d.status AS delivery_status, d.attempts`;

export function isPushable(g, item) {
  if (!g || g.score == null) return false;
  if (g.band === "lead") return true;
  return g.band === "digest" && g.score >= OWN_DIGEST_PUSH_MIN && !item.role && g.ticker === item.item_ticker;
}

// The Discord message for one pushed grade. mode: "new" | "regraded" | "withdrawn".
export function leadMessage(row, { mode = "new", publicUrl = "", now = Date.now() } = {}) {
  const head = `${row.ticker} · ${bandName(row.band)} ${row.score ?? "dup"}`;
  const via = row.role ? ` · ${row.role} source${row.item_ticker !== row.ticker ? `, filed under ${row.item_ticker}` : ""}`
    : row.item_ticker && row.item_ticker !== row.ticker ? ` · from a ${row.item_ticker} item` : "";
  const lines = [];
  if (mode === "withdrawn") {
    lines.push(`~~**${row.ticker} · ${bandName(row.shown_band)} ${row.shown_score}**~~ re-graded ${fmtEt(now)}: ${row.score == null ? (row.band === "duplicate" ? "duplicate" : "grade withdrawn") : `${bandName(row.band)} ${row.score}`}, no longer pushed`);
    lines.push(`~~${escapeMd(clip(row.title, 240))}~~`);
    if (row.why && row.score != null) lines.push(`**Why now:** ${escapeMd(clip(row.why, 400))}`);
  } else {
    lines.push(`**${head}**${row.event_type ? ` · ${escapeMd(row.event_type)}` : ""}${via}`);
    lines.push(escapeMd(clip(row.title, 240)));
    const fig = figures(row);
    lines.push(`**Why:** ${escapeMd(clip(row.why, 400))}${fig ? ` (${fig})` : ""}`);
    if (row.note_hook) lines.push(`**Note hook:** ${escapeMd(clip(row.note_hook, 240))}`);
    if (mode === "regraded" && row.shown_score != null && row.shown_score !== row.score) {
      lines.push(`Re-graded ${row.shown_score} → ${row.score} at ${fmtEt(now, { day: false })}`);
    }
  }
  const links = [link(row.url)];
  const label = labelLink(publicUrl, row.item_id);
  if (label) links.push(`label: ${label}`);
  lines.push(links.filter(Boolean).join(" · "));
  lines.push(`-# item ${row.item_id} · ${row.source_key}`);
  return lines.filter(Boolean).join("\n");
}

// Link to the item on the phone page (labels there are POST-only, so a link
// preview cannot label anything).
export function labelLink(publicUrl, itemId) {
  if (!publicUrl) return "";
  try {
    const u = new URL("/m", publicUrl);
    if (u.protocol !== "https:") return "";
    u.hash = `i${itemId}`;
    return `<${u.toString()}>`;
  } catch { return ""; }
}

async function claimNew(db, row, nowS, until) {
  const r = await db.prepare(
    `INSERT INTO deliveries (channel, item_id, ticker, grade_id, score, band, status, attempts, claimed_until, created_at, updated_at)
     VALUES ('lead', ?, ?, ?, ?, ?, 'posting', 0, ?, ?, ?) ON CONFLICT(channel, item_id, ticker) DO NOTHING`,
  ).bind(row.item_id, row.ticker, row.grade_id, row.score, row.band, until, nowS, nowS).run();
  if (!r.meta.changes) return null;
  return (await db.prepare("SELECT id FROM deliveries WHERE channel='lead' AND item_id=? AND ticker=?").bind(row.item_id, row.ticker).first())?.id;
}

async function claimExisting(db, row, nowS, until) {
  const r = await db.prepare(
    `UPDATE deliveries SET status='posting', claimed_until=?, updated_at=?
      WHERE id=? AND status=? AND grade_id IS ? AND (status != 'posting' OR claimed_until < ?)`,
  ).bind(until, nowS, row.delivery_id, row.delivery_status, row.shown_grade_id, nowS).run();
  return r.meta.changes === 1;
}

// attempts counts failures in a row: a success resets it, and a 429 (the
// webhook's rate limit, not this message's fault) does not add to it.
async function settle(db, id, res, { status, grade }) {
  const nowS = nowIso();
  if (res.ok) {
    await db.prepare(
      `UPDATE deliveries SET status=?, grade_id=?, score=?, band=?, message_id=COALESCE(?, message_id), attempts=0,
         last_error=NULL, claimed_until=NULL, updated_at=? WHERE id=?`,
    ).bind(status, grade.grade_id ?? null, grade.score ?? null, grade.band ?? null, res.id ?? null, nowS, id).run();
  } else {
    await db.prepare("UPDATE deliveries SET status='failed', attempts=attempts+?, last_error=?, claimed_until=NULL, updated_at=? WHERE id=?")
      .bind(res.status === 429 ? 0 : 1, String(res.error || "error").slice(0, 300), nowS, id).run();
  }
}

// Sends or edits; an edit of a message Discord no longer has posts a new one.
async function sendOrEdit(hook, content, messageId, fetchImpl) {
  if (messageId) {
    const res = await discordSend(hook, { content }, { messageId, fetchImpl });
    if (res.ok || res.status !== 404) return res;
  }
  return discordSend(hook, { content }, { fetchImpl });
}

export async function pushLeads(env, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const hook = env.DISCORD_LEAD_WEBHOOK;
  if (!hook) return { lead: "off" };
  const db = env.DB;
  const nowS = nowIso(now);
  const until = nowIso(now + CLAIM_MINUTES * 60_000);
  const editSince = nowIso(now - EDIT_WINDOW_DAYS * 24 * HOUR);
  const out = { posted: 0, edited: 0, withdrawn: 0, failed: 0, skipped: 0 };
  let budget = MAX_SENDS_PER_TICK;
  const publicUrl = env.ZENITH_PUBLIC_URL || "";

  // New pushes, re-grades still in the push band, and retries. A first post
  // needs fresh news: first seen within LEAD_FRESH_HOURS, and (when the item has
  // a published date) first seen within LEAD_MAX_LAG_HOURS of it. A failed row
  // retries until MAX_POST_ATTEMPTS failures in a row, then waits for a new grade.
  const due = (await db.prepare(
    `SELECT ${GRADE_COLS}, ${ITEM_COLS}, ${DELIVERY_COLS}
       FROM grades g JOIN items i ON i.id = g.item_id
       LEFT JOIN grades p ON p.id = i.grade_id
       LEFT JOIN deliveries d ON d.channel = 'lead' AND d.item_id = g.item_id AND d.ticker = g.ticker
      WHERE g.graded_at >= ?1 AND ${CURRENT} AND ${pushable("g")}
        AND ((d.id IS NULL AND i.nm_first_seen >= ?2
              AND (julianday(i.published) IS NULL OR (julianday(i.nm_first_seen) - julianday(i.published)) * 24 <= ?7))
          OR (d.id IS NOT NULL AND d.created_at >= ?3 AND (
                (d.status IN ('posted','retracted') AND d.grade_id IS NOT g.id)
             OR (d.status = 'failed' AND (d.attempts < ?4 OR d.updated_at < g.graded_at))
             OR (d.status = 'posting' AND d.claimed_until < ?5))))
      ORDER BY g.graded_at, g.id LIMIT ?6`,
  ).bind(nowIso(now - LEAD_FRESH_HOURS * HOUR), nowIso(now - LEAD_FRESH_HOURS * HOUR), editSince, MAX_POST_ATTEMPTS, nowS,
    MAX_SENDS_PER_TICK * 2, LEAD_MAX_LAG_HOURS).all()).results || [];

  for (const row of due) {
    if (budget <= 0) break;
    const id = row.delivery_id ? (await claimExisting(db, row, nowS, until) ? row.delivery_id : null) : await claimNew(db, row, nowS, until);
    if (!id) { out.skipped++; continue; }
    budget--;
    const mode = row.message_id ? "regraded" : "new";
    const res = await sendOrEdit(hook, leadMessage(row, { mode, publicUrl, now }), row.message_id, fetchImpl);
    await settle(db, id, res, { status: "posted", grade: row });
    if (res.ok) out[row.message_id ? "edited" : "posted"]++;
    else { out.failed++; if (res.status === 429) break; }
  }

  // Messages that show a pushed grade whose current grade left the push band (or
  // was withdrawn). That includes rows whose last edit failed and rows a crashed
  // tick left 'posting': their message still shows the old pushed grade.
  if (budget > 0) {
    const gone = (await db.prepare(
      `SELECT ${DELIVERY_COLS}, d.item_id, d.ticker, ${ITEM_COLS.replace("i.id AS item_id, ", "")},
              cur.id AS grade_id, cur.score, cur.band, cur.why
         FROM deliveries d JOIN items i ON i.id = d.item_id
         LEFT JOIN grades p ON p.id = i.grade_id
         LEFT JOIN grades cur ON cur.id = CASE WHEN d.ticker = i.ticker THEN i.grade_id ELSE
              (SELECT MAX(x.id) FROM grades x WHERE x.item_id = d.item_id AND x.ticker = d.ticker AND x.run_id IS p.run_id) END
        WHERE d.channel = 'lead' AND d.message_id IS NOT NULL AND d.created_at >= ?1 AND ${pushable("d")}
          AND (d.status = 'posted'
            OR (d.status = 'failed' AND (d.attempts < ?3 OR d.updated_at < cur.graded_at))
            OR (d.status = 'posting' AND d.claimed_until < ?4))
          AND (cur.id IS NULL OR (cur.id != d.grade_id AND NOT ${pushable("cur")}))
        LIMIT ?2`,
    ).bind(editSince, budget, MAX_POST_ATTEMPTS, nowS).all()).results || [];
    for (const row of gone) {
      if (!(await claimExisting(db, row, nowS, until))) { out.skipped++; continue; }
      const res = await discordSend(hook, { content: leadMessage(row, { mode: "withdrawn", publicUrl, now }) }, { messageId: row.message_id, fetchImpl });
      // A deleted message needs no edit; any other failure is 'failed' and retries.
      const done = res.ok || res.status === 404;
      await settle(db, row.delivery_id, done ? { ...res, ok: true, id: row.message_id } : res, { status: "retracted", grade: row });
      if (done) out.withdrawn++;
      else { out.failed++; if (res.status === 429) break; }
    }
  }
  return out;
}

// --- Heartbeat --------------------------------------------------------------
export const GRADER_STALE_MIN = 90;
export const QUEUE_STALE_MIN = 75;
const QUEUE_LOOKBACK_HOURS = 48; // requeued backfill items are not "waiting news"

// Each check returns { key, state: "fail" | "ok" | "hold", detail }.
export async function heartbeatChecks(db, now = Date.now()) {
  const checks = [];
  const et = etParts(now);
  const inWindow = et.weekday >= 1 && et.weekday <= 5 && et.hour >= 6 && et.hour < 20;
  const last = await db.prepare("SELECT MAX(last_seen_at) AS t FROM runs").first();
  const lastMs = last?.t ? Date.parse(last.t) : NaN;
  const recent = Number.isFinite(lastMs) && now - lastMs <= GRADER_STALE_MIN * 60_000;
  const windowStart = etToUtc(et.date, 6, 0);
  let state = recent ? "ok" : "hold";
  if (!recent && inWindow && now - windowStart > GRADER_STALE_MIN * 60_000) state = "fail";
  checks.push({
    key: "grader_stale", state,
    detail: Number.isFinite(lastMs)
      ? `Grader has not run since ${fmtEt(lastMs)} (${fmtAge(now - lastMs)} ago).`
      : "Grader has never run (runs table is empty).",
    recovery: Number.isFinite(lastMs) ? `Grader ran at ${fmtEt(lastMs)}.` : "",
  });

  const since = nowIso(now - QUEUE_LOOKBACK_HOURS * HOUR);
  const arrived = "MAX(i.nm_first_seen, i.ingested_at)";
  const oldest = await db.prepare(
    `SELECT i.id, i.ticker, i.title, ${arrived} AS arrived,
            (SELECT COUNT(*) FROM items j WHERE j.state IN ('pending','claimed') AND j.role IS NULL
               AND MAX(j.nm_first_seen, j.ingested_at) >= ?1 AND MAX(j.nm_first_seen, j.ingested_at) <= ?2) AS waiting
       FROM items i WHERE i.state IN ('pending','claimed') AND i.role IS NULL AND ${arrived} >= ?1
      ORDER BY arrived LIMIT 1`,
  ).bind(since, nowIso(now - QUEUE_STALE_MIN * 60_000)).first();
  const age = oldest ? now - Date.parse(oldest.arrived) : 0;
  checks.push({
    key: "queue_stale",
    state: oldest && age > QUEUE_STALE_MIN * 60_000 ? "fail" : "ok",
    detail: oldest ? `${oldest.waiting} covered item${oldest.waiting === 1 ? "" : "s"} waiting over ${QUEUE_STALE_MIN} min for a grade; oldest ${oldest.ticker} "${escapeMd(clip(oldest.title, 120))}" (${fmtAge(age)}).` : "",
    recovery: "Covered queue caught up: nothing has waited over 75 min.",
  });
  return checks;
}

export async function heartbeat(env, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const hook = env.DISCORD_OPS_WEBHOOK;
  if (!hook) return { heartbeat: "off" };
  const db = env.DB;
  const out = {};
  for (const c of await heartbeatChecks(db, now)) {
    const open = await db.prepare("SELECT * FROM incidents WHERE key = ? AND resolved_at IS NULL").bind(c.key).first();
    if (c.state === "fail") {
      let inc = open;
      if (!inc) {
        await db.prepare("INSERT OR IGNORE INTO incidents (key, opened_at, detail) VALUES (?, ?, ?)").bind(c.key, nowIso(now), c.detail).run();
        inc = await db.prepare("SELECT * FROM incidents WHERE key = ? AND resolved_at IS NULL").bind(c.key).first();
      }
      if (inc && !inc.alerted_at) {
        const res = await discordSend(hook, { content: `**ALERT · Zenith ${c.key.replace("_", " ")}**\n${c.detail}` }, { fetchImpl });
        if (res.ok) await db.prepare("UPDATE incidents SET alerted_at = ?, detail = ? WHERE id = ?").bind(nowIso(now), c.detail, inc.id).run();
        out[c.key] = res.ok ? "alerted" : "alert_failed";
      } else out[c.key] = "open";
    } else if (c.state === "ok" && open) {
      if (open.alerted_at) {
        const res = await discordSend(hook, {
          content: `**RECOVERED · Zenith ${c.key.replace("_", " ")}** after ${fmtAge(now - Date.parse(open.opened_at))}\n${c.recovery}`,
        }, { fetchImpl });
        if (!res.ok) { out[c.key] = "recovery_failed"; continue; }
      }
      await db.prepare("UPDATE incidents SET resolved_at = ?, recovery_detail = ? WHERE id = ?").bind(nowIso(now), c.recovery, open.id).run();
      out[c.key] = "recovered";
    } else out[c.key] = c.state;
  }
  return out;
}

// Everything delivery does on the 5-minute cron. Each part fails on its own.
export async function deliveryTick(env, covered, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const out = {};
  for (const [name, fn] of [
    ["lead", () => pushLeads(env, { now, fetchImpl })],
    ["heartbeat", () => heartbeat(env, { now, fetchImpl })],
    ["reports", () => catchUpReports(env, covered, { now, fetchImpl })],
  ]) {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e?.message || e).slice(0, 200) }; console.error(`delivery ${name} failed`, e?.stack || e); }
  }
  return out;
}
