// news-monitor-db tables that GET /v1/news-ops reads (Zenith show, phase 0), with
// news-monitor's own columns (src/ops.js ops_alerts, src/adapters-probe.js
// source_diagnostics, the managed lane's universe_managed_config and
// universe_managed_health), and seed helpers. Synthetic rows only.
export const OPS_ALERTS_SQL = `CREATE TABLE ops_alerts (source_key TEXT NOT NULL, rule TEXT NOT NULL, opened_at TEXT NOT NULL, last_seen_at TEXT,
  resolved_at TEXT, notified_at TEXT, detail TEXT, acknowledged_at TEXT, snoozed_until TEXT, recovering_since TEXT, verified_at TEXT,
  baseline_raw INTEGER, incident_of TEXT, outage_from TEXT, good_polls INTEGER, last_poll_at TEXT, requeued_at TEXT, requeue_detail TEXT,
  closed_reason TEXT, PRIMARY KEY (source_key, rule))`;
export const DIAG_SQL = `CREATE TABLE source_diagnostics (key TEXT PRIMARY KEY, polled_at TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, raw_count INTEGER,
  kept_count INTEGER, excluded_reasons TEXT, requests INTEGER, request_url TEXT, final_url TEXT, request_host TEXT, final_host TEXT, status INTEGER,
  content_type TEXT, not_modified INTEGER, html_feed INTEGER, redirected_host INTEGER, last_full_at TEXT, all_excluded_since TEXT, detail TEXT,
  probe_verdict TEXT, probe_bytes INTEGER, probe_detail TEXT)`;
export const MANAGED_CONFIG_SQL = `CREATE TABLE universe_managed_config (id INTEGER PRIMARY KEY, revision_seq INTEGER NOT NULL, revision_id TEXT,
  sources_json TEXT NOT NULL, updated_at TEXT NOT NULL)`;
export const MANAGED_HEALTH_SQL = `CREATE TABLE universe_managed_health (key TEXT PRIMARY KEY, config_hash TEXT, last_attempt TEXT, last_ok TEXT,
  last_error TEXT, fail_count INTEGER NOT NULL DEFAULT 0, next_poll_at TEXT, last_article TEXT, item_count INTEGER, etag TEXT, last_modified TEXT,
  seeded INTEGER, last_check_json TEXT)`;

export function addOpsTables(news, { alerts = true, diag = true, managed = true } = {}) {
  if (alerts) news.exec(OPS_ALERTS_SQL);
  if (diag) news.exec(DIAG_SQL);
  if (managed) { news.exec(MANAGED_CONFIG_SQL); news.exec(MANAGED_HEALTH_SQL); }
  return news;
}

export function addAlert(news, over = {}) {
  const a = { source_key: "test_source", rule: "outage", opened_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    resolved_at: null, detail: {}, acknowledged_at: null, snoozed_until: null, ...over };
  news.db.prepare(`INSERT INTO ops_alerts (source_key, rule, opened_at, last_seen_at, resolved_at, detail, acknowledged_at, snoozed_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(a.source_key, a.rule, a.opened_at, a.last_seen_at, a.resolved_at,
    typeof a.detail === "string" || a.detail === null ? a.detail : JSON.stringify(a.detail), a.acknowledged_at, a.snoozed_until);
}

export function addDiag(news, key, requestHost) {
  news.db.prepare("INSERT INTO source_diagnostics (key, polled_at, ok, request_host) VALUES (?, ?, 1, ?)").run(key, new Date().toISOString(), requestHost);
}

export function addManagedConfig(news, revision, sources) {
  news.db.prepare("INSERT INTO universe_managed_config (id, revision_seq, revision_id, sources_json, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(revision, revision, `rev-${revision}`, JSON.stringify(sources), `2026-10-0${Math.min(9, revision)}T00:00:00Z`);
}

export function addHealth(news, key, failCount, over = {}) {
  const h = { last_attempt: new Date().toISOString(), last_ok: "2026-11-01T00:00:00Z", last_error: failCount ? "HTTP 404" : null, ...over };
  news.db.prepare("INSERT INTO universe_managed_health (key, last_attempt, last_ok, last_error, fail_count) VALUES (?, ?, ?, ?, ?)")
    .run(key, h.last_attempt, h.last_ok, h.last_error, failCount);
}
