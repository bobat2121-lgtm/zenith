// GET /v1/site-changes and GET /v1/source-health over a fake news-monitor-db
// that carries news-monitor's own table definitions (src/site-structure.js,
// src/scale-schema.js, source_diagnostics with the probe columns): row shapes,
// ticker mapping from site-sources.json, notable sections, the 14-day window and
// limit, roles, missing tables, and that both routes only read news-monitor-db.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, FakeD1, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { siteChangeRow, isNotableSection, probeError } = await import("../worker/src/source-signals.js");
const { default: SITE_SOURCES } = await import("../worker/src/site-sources.json");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

// news-monitor's definitions, as created in news-monitor-db.
const SITE_SQL = [
  `CREATE TABLE site_structure_snapshots (source_key TEXT PRIMARY KEY, domain TEXT NOT NULL, taken_at TEXT NOT NULL, baseline_at TEXT NOT NULL,
    baseline_complete INTEGER NOT NULL DEFAULT 0, index_url TEXT, index_host TEXT, docs INTEGER NOT NULL DEFAULT 0, sections INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL)`,
  `CREATE TABLE site_structure_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, domain TEXT NOT NULL, change_id TEXT NOT NULL,
    kind TEXT NOT NULL, detected_at TEXT NOT NULL, flushed_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, message TEXT, detail TEXT)`,
];
const EDGAR_SQL = `CREATE TABLE edgar_latest_matches (accession TEXT NOT NULL, source_key TEXT NOT NULL, cik TEXT, form TEXT, accepted_at TEXT,
  requested_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, resolved_at TEXT, outcome TEXT, latency_ms INTEGER, PRIMARY KEY (accession, source_key))`;
const DIAG_SQL = `CREATE TABLE source_diagnostics (key TEXT PRIMARY KEY, polled_at TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, raw_count INTEGER,
  kept_count INTEGER, excluded_reasons TEXT, requests INTEGER, request_url TEXT, final_url TEXT, request_host TEXT, final_host TEXT, status INTEGER,
  content_type TEXT, not_modified INTEGER, html_feed INTEGER, redirected_host INTEGER, last_full_at TEXT, all_excluded_since TEXT, detail TEXT,
  probe_verdict TEXT, probe_bytes INTEGER, probe_detail TEXT)`;

function newsMonitorDb({ site = true, edgar = true, diag = true } = {}) {
  const d1 = new FakeD1();
  d1.exec("CREATE TABLE items (source_key TEXT, url TEXT, title TEXT, published TEXT, category TEXT, first_seen TEXT, notified INTEGER)");
  if (site) for (const sql of SITE_SQL) d1.exec(sql);
  if (edgar) d1.exec(EDGAR_SQL);
  if (diag) d1.exec(DIAG_SQL);
  return d1;
}
const newEnv = (news = newsMonitorDb()) => ({ DB: zenithDb(), NEWS: news, ...TOKENS });

function addChange(news, over = {}) {
  const c = { source_key: "site_kodiak", domain: "kodiak.ai", kind: "section_new", detected_at: iso(HOUR), message: "new section /news/ (4 URLs) — unwatched",
    detail: { kind: "section_new", section: "/news/", n: 4 }, ...over };
  const r = news.db.prepare(`INSERT INTO site_structure_changes (source_key, domain, change_id, kind, detected_at, flushed_at, notified, message, detail)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(c.source_key, c.domain, `${c.kind}:${c.detail?.section || c.detail?.id || "x"}`, c.kind, c.detected_at, c.detected_at,
    c.message, typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail));
  return Number(r.lastInsertRowid);
}
function addMatch(news, accession, source_key, requestedAgo) {
  news.db.prepare(`INSERT INTO edgar_latest_matches (accession, source_key, cik, form, accepted_at, requested_at, attempts, resolved_at, outcome)
    VALUES (?, ?, '0001', '8-K', ?, ?, 1, ?, 'stored')`).run(accession, source_key, iso(requestedAgo + 60_000), iso(requestedAgo), iso(requestedAgo - 60_000));
}
function addProbe(news, key, verdict, { status = 200, detail = {}, polledAgo = HOUR, error = null } = {}) {
  news.db.prepare(`INSERT INTO source_diagnostics (key, polled_at, ok, error, status, probe_verdict, probe_detail) VALUES (?, ?, 1, ?, ?, ?, ?)`)
    .run(key, iso(polledAgo), error, status, verdict, JSON.stringify(detail));
}
// Every statement the routes send to news-monitor-db.
function spy(news) {
  const sql = [];
  const prepare = news.prepare.bind(news);
  news.prepare = (s) => { sql.push(s); return prepare(s); };
  return sql;
}

test("site-sources.json maps every site watcher and probe to a covered ticker (or none)", async () => {
  const { default: COVERED } = await import("../worker/src/covered.json");
  assert.equal(SITE_SOURCES.sites.site_kodiak.ticker, "KDK");
  assert.equal(SITE_SOURCES.sites.site_redcat_ir.ticker, "RCAT");
  assert.equal(SITE_SOURCES.sites.site_maymobility.ticker, null, "a watchlist peer, not covered");
  assert.equal(SITE_SOURCES.probes.probe_sym_ir_events_rss.label, "SYM events");
  assert.equal(SITE_SOURCES.probes.probe_kdk_ir_news_rss.label, "KDK news");
  for (const v of [...Object.values(SITE_SOURCES.sites), ...Object.values(SITE_SOURCES.probes)]) {
    assert.ok(v.ticker === null || COVERED.tickers.includes(v.ticker), `${v.ticker} is covered`);
  }
  for (const k of Object.keys(SITE_SOURCES.sites)) assert.match(k, /^site_/);
  for (const k of Object.keys(SITE_SOURCES.probes)) assert.match(k, /^probe_/);
});

test("notable sections: investor relations, events, presentations, investor day, press, news", () => {
  for (const s of ["/investor-day/", "/investors/", "/en/news/", "/press-releases/", "/events/", "/presentations/", "/ir/", "/newsroom/", "/media/", "/webcasts/"]) {
    assert.equal(isNotableSection(s), true, s);
  }
  for (const s of ["/", "/en/", "/en-us/", "/products/", "/careers/", "/blog/", "/{n}/", "/irvine-office/", "/fair/", "", null]) {
    assert.equal(isNotableSection(s), false, String(s));
  }
});

test("a change row: ticker from the site source, section from detail, notable only for added sections", () => {
  const sites = { site_x: { ticker: "SYM" } };
  const base = { id: 1, source_key: "site_x", detected_at: "2026-11-23T10:00:00.000Z" };
  const added = siteChangeRow({ ...base, kind: "section_new", message: "new section /investor-day/ (3 URLs)", detail: '{"kind":"section_new","section":"/investor-day/","n":3}' }, sites);
  assert.deepEqual(added, { id: 1, ticker: "SYM", source_key: "site_x", kind: "section_new", section: "/investor-day/",
    detail: "new section /investor-day/ (3 URLs)", detected_at: base.detected_at, notable: true });
  const gone = siteChangeRow({ ...base, kind: "section_gone", message: "section /news/ gone", detail: '{"section":"/news/"}' }, sites);
  assert.equal(gone.notable, false, "a section that went away is not a lead");
  assert.equal(gone.section, "/news/");
  const child = siteChangeRow({ ...base, kind: "child_new", message: "new child sitemap", detail: JSON.stringify({
    kind: "child_new", url: "https://x/s.xml", newSections: [{ section: "/careers/" }, { section: "/events/" }] }) }, sites);
  assert.equal(child.section, "/events/");
  assert.equal(child.notable, true);
  const plain = siteChangeRow({ ...base, kind: "child_new", message: null, detail: JSON.stringify({ newSections: [{ section: "/shop/" }] }) }, sites);
  assert.deepEqual([plain.section, plain.notable, plain.detail], ["/shop/", false, "child_new"]);
  const moved = siteChangeRow({ ...base, source_key: "site_unknown", kind: "index_moved", message: "sitemap index moved", detail: "not json" }, sites);
  assert.deepEqual([moved.ticker, moved.section, moved.notable], [null, null, false]);
});

test("GET /v1/site-changes: last 14 days, newest first, mapped to covered tickers", async () => {
  const env = newEnv();
  const sql = spy(env.NEWS);
  const old = addChange(env.NEWS, { detected_at: iso(15 * DAY) });
  const kdk = addChange(env.NEWS, { detected_at: iso(2 * HOUR) });
  const rcat = addChange(env.NEWS, { source_key: "site_redcat_ir", domain: "ir.redcatholdings.com", detected_at: iso(HOUR), kind: "section_new",
    message: "new section /tender-offer/ (5 URLs) — unwatched", detail: { kind: "section_new", section: "/tender-offer/", n: 5 } });
  const may = addChange(env.NEWS, { source_key: "site_maymobility", domain: "maymobility.com", kind: "index_moved", detected_at: iso(3 * HOUR),
    message: "sitemap index moved: <a> -> <b>", detail: { kind: "index_moved", from: "a", to: "b" } });
  const r = await request(worker, env, "GET", "/v1/site-changes", { role: "app" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.id), [rcat, kdk, may]);
  assert.ok(!r.body.items.some((i) => i.id === old));
  const [a, b, c] = r.body.items;
  assert.deepEqual(Object.keys(a).sort(), ["detail", "detected_at", "id", "kind", "notable", "section", "source_key", "ticker"]);
  assert.deepEqual([a.ticker, a.section, a.notable], ["RCAT", "/tender-offer/", false]);
  assert.deepEqual([b.ticker, b.section, b.notable, b.detail], ["KDK", "/news/", true, "new section /news/ (4 URLs) — unwatched"]);
  assert.deepEqual([c.ticker, c.kind, c.notable], [null, "index_moved", false]);
  assert.ok(sql.length > 0 && sql.every((s) => /^\s*SELECT\b/i.test(s)), "news-monitor-db is read with SELECT only");

  const wide = await request(worker, env, "GET", "/v1/site-changes?days=30&limit=2", { role: "admin" });
  assert.deepEqual(wide.body.items.map((i) => i.id), [rcat, kdk]);
  const all30 = await request(worker, env, "GET", "/v1/site-changes?days=30", { role: "admin" });
  assert.equal(all30.body.items.length, 4);
  const junk = await request(worker, env, "GET", "/v1/site-changes?days=abc&limit=-3", { role: "app" });
  assert.equal(junk.body.items.length, 3, "bad parameters fall back to 14 days, 50 rows");
});

test("GET /v1/site-changes: an empty or missing table returns no items", async () => {
  assert.deepEqual((await request(worker, newEnv(), "GET", "/v1/site-changes", { role: "app" })).body, { items: [] });
  const env = newEnv(newsMonitorDb({ site: false }));
  const r = await request(worker, env, "GET", "/v1/site-changes", { role: "app" });
  assert.deepEqual([r.status, r.body], [200, { items: [] }]);
  const none = await request(worker, { DB: zenithDb(), ...TOKENS }, "GET", "/v1/site-changes", { role: "app" });
  assert.equal(none.status, 503);
});

test("probe errors read as a short reason", () => {
  assert.equal(probeError({ probe_verdict: "challenge", status: 403, probe_detail: '{"vendor":"cloudflare"}' }), "cloudflare challenge, HTTP 403");
  assert.equal(probeError({ probe_verdict: "blocked", status: 403, probe_detail: "{}" }), "blocked, HTTP 403");
  assert.equal(probeError({ probe_verdict: "not_found", status: 404 }), "not found, HTTP 404");
  assert.equal(probeError({ probe_verdict: "error_status", status: 520 }), "HTTP 520");
  assert.equal(probeError({ probe_verdict: "empty", status: 200 }), "empty response");
  assert.equal(probeError({ probe_verdict: "error", status: null, probe_detail: '{"error":"timeout"}' }), "timeout");
  assert.equal(probeError({ probe_verdict: null, status: null, error: null }), "no probe result");
  assert.equal(probeError({ probe_verdict: "other", status: 200 }), "other, HTTP 200");
});

test("GET /v1/source-health: EDGAR fast path counts and failing probes", async () => {
  const env = newEnv();
  const sql = spy(env.NEWS);
  addMatch(env.NEWS, "0001-26-1", "edgar_asst", 2 * HOUR);
  addMatch(env.NEWS, "0001-26-1", "strive_sec_northland", 2 * HOUR);   // one filing, two woken sources
  addMatch(env.NEWS, "0001-26-2", "edgar_onds", 5 * HOUR);
  addMatch(env.NEWS, "0001-26-3", "edgar_mrln", 3 * DAY);
  addMatch(env.NEWS, "0001-26-4", "edgar_dpro", 9 * DAY);
  addProbe(env.NEWS, "probe_sym_ir_events_rss", "challenge", { status: 403, detail: { vendor: "akamai" }, polledAgo: 3 * HOUR });
  addProbe(env.NEWS, "probe_kdk_ir_news_rss", "error", { status: null, detail: { error: "timeout" }, polledAgo: 2 * HOUR });
  addProbe(env.NEWS, "probe_satl_ir_news_rss", "feed", { detail: { items: 10 }, polledAgo: HOUR });
  addProbe(env.NEWS, "probe_kdk_ir_events", "page");
  addProbe(env.NEWS, "probe_new_unsynced", "blocked", { status: 429 });
  env.NEWS.db.prepare("INSERT INTO source_diagnostics (key, polled_at, ok) VALUES ('kodiak', ?, 1)").run(iso(0));   // not a probe
  const r = await request(worker, env, "GET", "/v1/source-health", { role: "app" });
  assert.equal(r.status, 200);
  const { edgar_fast_path: e, ir_probes: p, as_of } = r.body;
  assert.ok(Math.abs(Date.parse(as_of) - Date.now()) < 60_000);
  assert.ok(Math.abs(Date.parse(e.last_match_at) - (Date.now() - 2 * HOUR)) < 60_000);
  assert.deepEqual([e.matches_24h, e.matches_7d], [2, 3]);
  assert.equal(p.ok, 2);
  assert.ok(Math.abs(Date.parse(p.checked_at) - (Date.now() - HOUR)) < 60_000, "the newest probe check");
  assert.deepEqual(p.failing.map((f) => [f.key, f.ticker, f.label, f.error]), [
    ["probe_kdk_ir_news_rss", "KDK", "KDK news", "timeout"],
    ["probe_sym_ir_events_rss", "SYM", "SYM events", "akamai challenge, HTTP 403"],
    ["probe_new_unsynced", null, "new unsynced", "blocked, HTTP 429"],
  ]);
  assert.ok(Math.abs(Date.parse(p.failing[1].since) - (Date.now() - 3 * HOUR)) < 60_000);
  assert.ok(sql.length > 0 && sql.every((s) => /^\s*SELECT\b/i.test(s)), "news-monitor-db is read with SELECT only");
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM items")[0].n, 0);
});

test("GET /v1/source-health: empty tables, and a null block for each missing table", async () => {
  const empty = await request(worker, newEnv(), "GET", "/v1/source-health", { role: "admin" });
  assert.deepEqual(empty.body.edgar_fast_path, { last_match_at: null, matches_24h: 0, matches_7d: 0 });
  assert.deepEqual(empty.body.ir_probes, { checked_at: null, failing: [], ok: 0 });
  const noEdgar = await request(worker, newEnv(newsMonitorDb({ edgar: false })), "GET", "/v1/source-health", { role: "app" });
  assert.equal(noEdgar.status, 200);
  assert.equal(noEdgar.body.edgar_fast_path, null);
  assert.deepEqual(noEdgar.body.ir_probes, { checked_at: null, failing: [], ok: 0 });
  const neither = await request(worker, newEnv(newsMonitorDb({ edgar: false, diag: false })), "GET", "/v1/source-health", { role: "app" });
  assert.deepEqual([neither.body.edgar_fast_path, neither.body.ir_probes], [null, null]);
  const none = await request(worker, { DB: zenithDb(), ...TOKENS }, "GET", "/v1/source-health", { role: "app" });
  assert.equal(none.status, 503);
});

test("roles: app and admin may read both routes, the grader may not", async () => {
  const env = newEnv();
  for (const path of ["/v1/site-changes", "/v1/source-health"]) {
    assert.equal((await request(worker, env, "GET", path, { role: "app" })).status, 200, path);
    assert.equal((await request(worker, env, "GET", path, { role: "admin" })).status, 200, path);
    assert.equal((await request(worker, env, "GET", path, { role: "grader" })).status, 403, path);
    const anon = await worker.fetch(new Request(`https://zenith.test${path}`), env);
    assert.equal(anon.status, 401, path);
    assert.equal((await request(worker, env, "POST", path, { role: "admin", body: {} })).status, 404, path);
  }
});
