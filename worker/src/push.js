// Phase 3 Part E (PR-E4): the cron's push stage, web push for graded Leads.
// Shipped OFF. pushTick returns { status: "off" } with no database call and no
// network call unless PUSH_ENABLED is "1" and the VAPID key pair is set and
// matches (pushReady: env and WebCrypto only). Imported only by index.js.
//
// When on, each 5-minute tick:
//   1. reads meta.push_cursor; a missing cursor is set to now and nothing is sent,
//      so turning push on never sends Leads graded before it;
//   2. Q7: current Lead grades in (cursor, now], kept when the ticker is covered,
//      published is set, first seen within PUSH_FRESH_HOURS and within
//      PUSH_MAX_LAG_HOURS of published; muted sources are left out;
//   3. caps per UTC day (PUSH_DAILY_CAP, PUSH_TICKER_CAP): over a cap the event is
//      stored as 'capped' and never sent;
//   4. Q10: up to PUSH_PER_TICK due events, each re-checked against the item's
//      current grade (no longer a Lead -> 'stale'), sent to every live subscription
//      that has no final send yet; 404/410 revoke the subscription, 429/5xx/timeout
//      retry at +5 and +15 minutes (3 attempts), anything else is final;
//   5. Q15: up to 3 queued test notifications, each to its own person's devices.
// Nothing here grades, claims or releases a row. Logs carry counts and ids only:
// never an endpoint, a key, a JWT or an Authorization header.
import { pushOn, allowedEndpoint, PUSH_SUBS_PER_ACTOR } from "./push-routes.js";
import { sendPush, vapidKeysMatch, validSubject } from "./webpush.js";

export const PUSH_DAILY_CAP = 5;
export const PUSH_TICKER_CAP = 2;
export const PUSH_PER_TICK = 5;
export const PUSH_TESTS_PER_TICK = 3;
// The Lead freshness rule (the same values as delivery.js LEAD_FRESH_HOURS and
// LEAD_MAX_LAG_HOURS; a test keeps them equal without this module importing it).
export const PUSH_FRESH_HOURS = 72;
export const PUSH_MAX_LAG_HOURS = 72;
export const RETRY_MINUTES = [5, 15, 45];
export const MAX_ATTEMPTS = 3;
const BODY_CLIP = 140;
const PAYLOAD_MAX_BYTES = 512;
const Q7_LIMIT = 50;
const HOUR = 3_600_000;

// The literal texts of tuning.js MUTED_SQL and brief.js CURRENT_GRADE (a test
// keeps them equal; importing either would pull in the send paths).
export const MUTED_LITERAL = "(SELECT source_key FROM source_prefs WHERE action = 'mute')";
export const CURRENT_GRADE_LITERAL = `(g.id = i.grade_id OR (g.ticker != i.ticker AND g.id = (SELECT MAX(x.id) FROM grades x
    WHERE x.item_id = g.item_id AND x.ticker = g.ticker AND x.run_id IS p.run_id)))`;

export const Q7_SQL = `SELECT g.id AS grade_id, g.item_id, g.ticker, g.score, g.graded_at, i.title, i.headline, i.published, i.nm_first_seen,
       i.source_key, i.ticker AS item_ticker
  FROM grades g JOIN items i ON i.id = g.item_id LEFT JOIN grades p ON p.id = i.grade_id
 WHERE g.graded_at > ?1 AND g.graded_at <= ?2 AND g.band = 'lead' AND ${CURRENT_GRADE_LITERAL}
   AND i.source_key NOT IN ${MUTED_LITERAL}
 ORDER BY g.graded_at, g.id LIMIT ${Q7_LIMIT}`;
// The item's current grade for one ticker (idx_grades_item), with the text the payload uses.
export const CURRENT_SQL = `SELECT g.id AS grade_id, g.band, i.title, i.headline
  FROM items i LEFT JOIN grades p ON p.id = i.grade_id JOIN grades g ON g.item_id = i.id AND g.ticker = ?2
 WHERE i.id = ?1 AND ${CURRENT_GRADE_LITERAL}
 ORDER BY g.id DESC LIMIT 1`;
const Q9_SQL = `SELECT ticker, COUNT(*) AS n FROM push_events WHERE universe_id = 'u1' AND created_at >= ? AND status != 'capped'
  GROUP BY ticker LIMIT 500`;
const Q10_SQL = `SELECT id, item_id, ticker, grade_id, attempts FROM push_events WHERE status IN ('pending','partial') AND next_at <= ?
  ORDER BY next_at, id LIMIT ${PUSH_PER_TICK}`;
const Q8_ALL_SQL = "SELECT id, endpoint, p256dh, auth FROM push_subs WHERE universe_id = 'u1' AND revoked_at IS NULL ORDER BY id LIMIT 50";
const Q8_ACTOR_SQL = `SELECT id, endpoint, p256dh, auth FROM push_subs WHERE universe_id = 'u1' AND actor = ? AND revoked_at IS NULL
  ORDER BY id LIMIT ${PUSH_SUBS_PER_ACTOR}`;
const Q13_SQL = "SELECT sub_id, status, attempts FROM push_sends WHERE event_id = ? LIMIT 100";
const Q15_SQL = `SELECT id, actor FROM push_tests WHERE status = 'pending' ORDER BY id LIMIT ${PUSH_TESTS_PER_TICK}`;

const iso = (ms) => new Date(ms).toISOString();
const utcDayStart = (ms) => `${iso(ms).slice(0, 10)}T00:00:00.000Z`;
const ok2xx = (s) => s >= 200 && s < 300;
const gone = (s) => s === 404 || s === 410;
const transient = (s) => s === 0 || s === 429 || (s >= 500 && s < 600);

// The tick-side switch: pushOn, a matching private key and a subject. No database
// call, no network call.
export async function pushReady(env) {
  if (!pushOn(env)) return false;
  if (!validSubject(env.VAPID_SUBJECT)) return false;
  return vapidKeysMatch(env);
}

const clip = (s, n) => {
  const v = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v;
};

// The default Lead payload (E-O2 default): ticker, "new Lead" and the public
// headline or title. Never the score. At most 512 bytes of JSON.
export function leadPayload({ item_id, ticker, headline, title }) {
  let body = clip(headline || title || "", BODY_CLIP);
  const make = () => ({ v: 1, title: `${ticker} · new Lead`, body, url: `/p/c/${encodeURIComponent(ticker)}`, tag: `lead-${item_id}-${ticker}` });
  while (new TextEncoder().encode(JSON.stringify(make())).length > PAYLOAD_MAX_BYTES && body) body = clip(body, Math.floor(body.length * 0.8));
  return make();
}
export const TEST_PAYLOAD = Object.freeze({ v: 1, title: "Zenith test", body: "Lead alerts work on this device", url: "/p/brief" });

// A Lead is pushed only while it is fresh: first seen within PUSH_FRESH_HOURS of
// now and within PUSH_MAX_LAG_HOURS of its published date.
export function freshLead(row, now) {
  const seen = Date.parse(row?.nm_first_seen || "");
  const pub = Date.parse(row?.published || "");
  if (!Number.isFinite(seen) || !Number.isFinite(pub)) return false;
  return seen >= now - PUSH_FRESH_HOURS * HOUR && seen - pub <= PUSH_MAX_LAG_HOURS * HOUR;
}

// One send to one subscription, with its bookkeeping. -> the HTTP status (0 = none).
async function sendOne(env, sub, payload, { fetchImpl, now, topic, counts }) {
  // An endpoint that no longer passes the allow-list (edited in place) is never sent to.
  if (!allowedEndpoint(sub.endpoint)) {
    await env.DB.prepare("UPDATE push_subs SET last_status = 0, fail_count = fail_count + 1 WHERE id = ?").bind(sub.id).run();
    return -1;
  }
  const { status } = await sendPush(sub, payload, env, { fetchImpl, now, topic });
  const t = iso(now);
  if (ok2xx(status)) {
    await env.DB.prepare("UPDATE push_subs SET last_ok_at = ?, last_status = ?, fail_count = 0 WHERE id = ?").bind(t, status, sub.id).run();
  } else if (gone(status)) {
    await env.DB.prepare("UPDATE push_subs SET last_status = ?, revoked_at = ?, revoked_why = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(status, t, status === 404 ? "gone_404" : "gone_410", sub.id).run();
    counts.revoked++;
  } else {
    await env.DB.prepare("UPDATE push_subs SET last_status = ?, fail_count = fail_count + 1 WHERE id = ?").bind(status, sub.id).run();
  }
  return status;
}

// pushTick(env, covered, { now, fetchImpl }) -> { status, new, capped, sent, failed, revoked, tests }
// now is the cron's event.scheduledTime.
export async function pushTick(env, covered, { now, fetchImpl = globalThis.fetch } = {}) {
  if (!(await pushReady(env))) return { status: "off" };
  if (!Number.isFinite(now)) throw new Error("pushTick needs the cron's scheduledTime");
  const t = iso(now);
  const counts = { new: 0, capped: 0, sent: 0, failed: 0, revoked: 0, tests: 0 };
  const cursorRow = await env.DB.prepare("SELECT value FROM meta WHERE key = 'push_cursor'").first();
  if (!cursorRow) {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('push_cursor', ?) ON CONFLICT (key) DO NOTHING").bind(t).run();
    return { status: "started", ...counts };
  }
  const cursor = String(cursorRow.value);
  const tickers = new Set(covered?.tickers || []);

  // Steps 2-3: new Leads become events (pending, or capped over a daily cap).
  const leads = (await env.DB.prepare(Q7_SQL).bind(cursor, t).all()).results || [];
  if (leads.length) {
    const day = (await env.DB.prepare(Q9_SQL).bind(utcDayStart(now)).all()).results || [];
    const perTicker = new Map(day.map((r) => [r.ticker, Number(r.n) || 0]));
    let total = [...perTicker.values()].reduce((a, b) => a + b, 0);
    for (const row of leads) {
      if (!tickers.has(row.ticker) || !freshLead(row, now)) continue;
      const capped = total >= PUSH_DAILY_CAP || (perTicker.get(row.ticker) || 0) >= PUSH_TICKER_CAP;
      const r = await env.DB.prepare(`INSERT OR IGNORE INTO push_events (universe_id, item_id, ticker, grade_id, score, status, attempts, next_at, created_at)
        VALUES ('u1', ?, ?, ?, ?, ?, 0, ?, ?)`).bind(row.item_id, row.ticker, row.grade_id, row.score, capped ? "capped" : "pending", capped ? null : t, t).run();
      if (r.meta.changes !== 1) continue;
      if (capped) { counts.capped++; continue; }
      counts.new++;
      total++;
      perTicker.set(row.ticker, (perTicker.get(row.ticker) || 0) + 1);
    }
    const last = leads[leads.length - 1].graded_at;
    if (last && last !== cursor) await env.DB.prepare("UPDATE meta SET value = ? WHERE key = 'push_cursor'").bind(last).run();
  }

  // Step 4: due events.
  const due = (await env.DB.prepare(Q10_SQL).bind(t).all()).results || [];
  let subs = null;
  for (const ev of due) {
    const cur = await env.DB.prepare(CURRENT_SQL).bind(ev.item_id, ev.ticker).first();
    if (!cur || cur.band !== "lead") {
      await env.DB.prepare("UPDATE push_events SET status = 'stale', next_at = NULL WHERE id = ?").bind(ev.id).run();
      continue;
    }
    subs ??= (await env.DB.prepare(Q8_ALL_SQL).all()).results || [];
    const done = new Map(((await env.DB.prepare(Q13_SQL).bind(ev.id).all()).results || []).map((r) => [r.sub_id, r]));
    const payload = leadPayload({ item_id: ev.item_id, ticker: ev.ticker, headline: cur.headline, title: cur.title });
    let okN = 0, retry = 0;
    for (const sub of subs) {
      const prev = done.get(sub.id);
      if (prev && !transient(Number(prev.status))) { if (ok2xx(Number(prev.status))) okN++; continue; }
      const status = await sendOne(env, sub, payload, { fetchImpl, now, topic: `l${ev.item_id}`, counts });
      await env.DB.prepare(`INSERT INTO push_sends (event_id, sub_id, status, attempts, at) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT (event_id, sub_id) DO UPDATE SET status = excluded.status, attempts = push_sends.attempts + 1, at = excluded.at`)
        .bind(ev.id, sub.id, status, t).run();
      if (ok2xx(status)) okN++;
      else if (transient(status)) retry++;
    }
    const attempts = Number(ev.attempts || 0) + 1;
    if (retry && attempts < MAX_ATTEMPTS) {
      await env.DB.prepare("UPDATE push_events SET status = 'partial', attempts = ?, next_at = ? WHERE id = ?")
        .bind(attempts, iso(now + RETRY_MINUTES[attempts - 1] * 60_000), ev.id).run();
      continue;
    }
    const sent = okN > 0 && !retry;
    await env.DB.prepare("UPDATE push_events SET status = ?, attempts = ?, next_at = NULL, sent_at = ? WHERE id = ?")
      .bind(sent ? "sent" : "failed", attempts, sent ? t : null, ev.id).run();
    if (sent) counts.sent++;
    else counts.failed++;
  }

  // Step 5: queued test notifications, each to its own person's live subscriptions.
  const tests = (await env.DB.prepare(Q15_SQL).all()).results || [];
  for (const tq of tests) {
    const own = (await env.DB.prepare(Q8_ACTOR_SQL).bind(tq.actor).all()).results || [];
    let okN = 0;
    for (const sub of own) if (ok2xx(await sendOne(env, sub, TEST_PAYLOAD, { fetchImpl, now, topic: null, counts }))) okN++;
    await env.DB.prepare("UPDATE push_tests SET status = ?, sent_at = ? WHERE id = ?").bind(okN ? "sent" : "failed", okN ? t : null, tq.id).run();
    counts.tests++;
  }
  return { status: "ok", ...counts };
}
