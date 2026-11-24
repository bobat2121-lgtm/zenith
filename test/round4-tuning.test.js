// Round 4, Part Z (plans/round4-reliability-tuning.md): aux claim order (Z1),
// SEC tag forms (Z2), grader health (Z3), dropped tickers out of stats (Z4),
// label reason codes (Z5), calibration with aux (Z6), source preferences (Z7),
// source yield (Z8), left out (Z9), the to_label sort (Z10) and rival items in
// the auxiliary pipeline (Z11). All over an in-memory zenith-db with the real
// migrations and the Worker's fetch().
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { ingestAux, rivalGate, AUX_CS_DONE, AUX_OLD_HOURS } = await import("../worker/src/auxiliary.js");
const { ingest } = await import("../worker/src/ingest.js");
const { SEC_FORMS, SEC_FORM_RE, LABEL_REASONS, normalizeHeadline, bandFor } = await import("../worker/src/lib.js");
const { runGaps, graderStatus, prefRefusal, suggestFor, DEMOTE_POINTS } = await import("../worker/src/tuning.js");
const { buildCalibration } = await import("../worker/src/brief.js");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = (extra = {}) => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS, ...extra });
const one = (env, sql, ...args) => ({ ...env.DB.rows(sql, ...args)[0] });

let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: "redcat", ticker: "RCAT", url: `https://ir.example.com/n/${++rowid}`, title: `Red Cat news ${rowid}`, published: iso(2 * HOUR),
    nm_first_seen: iso(HOUR), state: "pending", skip_reason: null, claim_id: null, claimed_until: null, attempts: 0, role: null, affects: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state,
      skip_reason, claim_id, claimed_until, attempts, role, affects) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(it.nm_rowid ?? rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.skip_reason, it.claim_id, it.claimed_until,
      it.attempts, it.role, it.affects);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, over = {}) {
  const g = { ticker: env.DB.rows("SELECT ticker FROM items WHERE id = ?", itemId)[0].ticker, score: 80, confidence: 0.8, run_id: "run-c", graded_at: iso(), ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : bandFor(g.score));
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, confidence, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, 'why', '["reason:material"]', ?, 1, ?)`).run(itemId, g.ticker, g.run_id, g.score, band, g.confidence, g.graded_at);
  env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
  return Number(r.lastInsertRowid);
}
function addAux(env, over = {}) {
  const it = { source_key: "anduril", entity_key: "anduril", entity_name: "Anduril (private)", status: "private", url: `https://news.example.com/a/${++rowid}`,
    title: `Auxiliary item ${rowid}`, published: iso(2 * HOUR), nm_first_seen: iso(HOUR), state: "pending", skip_reason: null, attempts: 0, claim_id: null,
    claimed_until: null, coverage_subject: 0, affects: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, skip_reason, attempts, claim_id, claimed_until, coverage_subject, affects) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(it.nm_rowid ?? rowid, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.skip_reason,
      it.attempts, it.claim_id, it.claimed_until, it.coverage_subject, it.affects);
  return Number(r.lastInsertRowid);
}
function addAuxGrade(env, itemId, over = {}) {
  const g = { entity: "Anduril", score: 80, confidence: 0.8, graded_at: iso(), ...over };
  const band = g.band ?? (g.score == null ? "duplicate" : bandFor(g.score));
  const r = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, confidence, read_source, graded_at)
    VALUES (?, ?, ?, ?, ?, 'why', '[]', '["reason:material"]', ?, 1, ?)`).run(itemId, `run-${itemId}-${++rowid}`, g.entity, g.score, band, g.confidence, g.graded_at);
  env.DB.db.prepare("UPDATE aux_items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
  return Number(r.lastInsertRowid);
}
function addRun(env, id, startedMsAgo, lastMsAgo, over = {}) {
  env.DB.db.prepare("INSERT INTO runs (id, started_at, last_seen_at, claimed, graded, rejected) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, iso(startedMsAgo), iso(lastMsAgo), over.claimed ?? 5, over.graded ?? 4, over.rejected ?? 1);
}
let nmRow = 0;
function nmRowAdd(news, row) {
  const seen = row.first_seen ?? iso();
  news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
    .run(row.source_key, row.url ?? `https://news.example.com/${row.source_key}/${++nmRow}`, row.title ?? `Item ${nmRow}`,
      row.published === undefined ? seen : row.published, seen);
}
const atStart = (db, key) => db.db.prepare("INSERT INTO meta (key, value) VALUES (?, '0')").run(key);
const meta = (db, key) => db.rows("SELECT value FROM meta WHERE key = ?", key)[0]?.value ?? null;
const get = async (env, path, role = "app") => request(worker, env, "GET", path, { role });
const post = async (env, path, body, role = "app") => request(worker, env, "POST", path, { role, body });
const ids = (r) => r.body.items.map((i) => i.item_id);

// --- Z1 ------------------------------------------------------------------------
test("Z1 aux claim: items first seen over 72 h ago come first, oldest first; then newest first", async () => {
  const env = newEnv();
  const fresh1 = addAux(env, { nm_first_seen: iso(2 * HOUR) });
  const old1 = addAux(env, { nm_first_seen: iso(10 * DAY) });
  const fresh2 = addAux(env, { nm_first_seen: iso(HOUR) });
  const old2 = addAux(env, { nm_first_seen: iso(5 * DAY) });
  const edge = addAux(env, { nm_first_seen: iso((AUX_OLD_HOURS - 1) * HOUR) });
  const c = (await post(env, "/v1/aux/claim", { limit: 3 }, "grader")).body;
  assert.deepEqual(c.items.map((i) => i.item_id), [old1, old2, fresh2], "the old backlog drains first, then the newest");
  assert.equal(c.remaining, 2);
  const c2 = (await post(env, "/v1/aux/claim", { limit: 5 }, "grader")).body;
  assert.deepEqual(c2.items.map((i) => i.item_id), [fresh1, edge]);

  const freshOnly = newEnv();
  const a = addAux(freshOnly, { nm_first_seen: iso(3 * HOUR) });
  const b = addAux(freshOnly, { nm_first_seen: iso(HOUR) });
  const d = addAux(freshOnly, { nm_first_seen: iso(2 * HOUR) });
  assert.deepEqual((await post(freshOnly, "/v1/aux/claim", { limit: 2 }, "grader")).body.items.map((i) => i.item_id), [b, d], "fresh-only: newest first as before");
  assert.deepEqual((await post(freshOnly, "/v1/aux/claim", { limit: 2 }, "grader")).body.items.map((i) => i.item_id), [a]);
});

// --- Z2 ------------------------------------------------------------------------
test("Z2 SEC tag forms: every form news-monitor delivers and its /A pass; junk fails", () => {
  const required = ["497AD", "497", "N-2", "N-2/A", "N-CSR", "N-CSRS", "NT-NCSR", "425", "DEFM14A", "PREM14A", "DEFA14A", "F-4", "SC TO-T", "SC TO-I",
    "SC TO-C", "SC 14D9", "SCHEDULE 13D", "SCHEDULE 13D/A", "SC 13E3", "8-K12B", "10-12B", "40-F", "6-K", "1-A", "253G2",
    // The rest of news-monitor's material lists (src/sec-material.js) and the forms tags used before.
    "8-K", "8-K/A", "10-Q", "10-K", "20-F", "S-1", "S-3", "S-3ASR", "S-3MEF", "F-1", "F-3", "F-3ASR", "F-10", "S-4", "424B1", "424B5", "424B7", "SUPPL", "EFFECT",
    "DEF 14A", "PRE 14A", "SC14D9C", "DFAN14A", "PREC14A", "DEFC14A", "SC 13D", "SC 13D/A", "NT 10-K", "NT 10-Q", "NT 20-F", "25-NSE", "25", "15-12B", "15-12G",
    "SC 13G", "SC 13G/A", "13F-HR", "Form 3", "Form 4", "Form 5", "S-8", "1-U", "1-K", "C", "D"];
  for (const form of required) {
    assert.ok(SEC_FORM_RE.test(form), form);
    assert.ok(SEC_FORM_RE.test(form.endsWith("/A") ? form : `${form}/A`), `${form}/A`);
  }
  for (const form of SEC_FORMS) assert.ok(SEC_FORM_RE.test(form) && SEC_FORM_RE.test(`${form}/A`), form);
  for (const junk of ["N-CSR2", "8K", "8-K/A/A", "8-K ", "sc 13d", "N-CSRX", "497ADX", "10-Q/B", "Form 44", "E", "S-1/AA", "", "Press"]) {
    assert.ok(!SEC_FORM_RE.test(junk), JSON.stringify(junk));
  }
  // The five tags the 22:07 run lost are accepted as headline tags now.
  for (const tag of ["N-CSR", "497AD", "N-2/A"]) assert.deepEqual(normalizeHeadline({ headline: "Fund files its annual shareholder report", tag }).tag, tag);
  assert.equal(normalizeHeadline({ headline: "Fund files its annual shareholder report", tag: "N-CSR2" }).ok, false);
});

// --- Z3 ------------------------------------------------------------------------
test("Z3 runGaps and graderStatus", () => {
  const now = Date.now();
  const since = iso(7 * DAY);
  const runs = [
    { started_at: iso(10 * HOUR), last_seen_at: iso(9.9 * HOUR) },
    { started_at: iso(2 * HOUR), last_seen_at: iso(1.9 * HOUR) },
    { started_at: iso(9 * HOUR), last_seen_at: iso(8.9 * HOUR) },
    { started_at: iso(HOUR), last_seen_at: iso(0.9 * HOUR) },
  ];
  const gaps = runGaps(runs, since);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].hours, 6.9);
  assert.equal(gaps[0].from, runs[2].last_seen_at);
  assert.equal(gaps[0].to, runs[1].started_at);
  assert.equal(graderStatus(iso(30 * MIN), now), "ok");
  assert.equal(graderStatus(iso(89 * MIN), now), "ok");
  assert.equal(graderStatus(iso(2 * HOUR), now), "late");
  assert.equal(graderStatus(iso(4 * HOUR), now), "down");
  assert.equal(graderStatus(null, now), "down");
});

test("Z3 GET /v1/ops: last run, 24 h count, gaps over 2 h in 7 days, status, heartbeat checks and backlog", async () => {
  const env = newEnv();
  assert.equal((await get(env, "/v1/ops", "grader")).status, 403);
  const empty = (await get(env, "/v1/ops")).body;
  assert.equal(empty.grader.status, "down");
  assert.equal(empty.grader.last_run_at, null);
  assert.deepEqual(empty.grader.gaps_7d, []);
  assert.ok(empty.as_of);

  addRun(env, "r-old", 9 * DAY, 9 * DAY - MIN);            // before the window
  addRun(env, "r1", 6.5 * DAY, 6.5 * DAY - 2 * MIN);        // gap from r-old into the window
  addRun(env, "r2", 6.5 * DAY - HOUR, 6.5 * DAY - HOUR - MIN);
  addRun(env, "r3", 20 * HOUR, 20 * HOUR - MIN);            // ~5.5 day gap before it
  addRun(env, "r4", 15 * HOUR, 15 * HOUR - MIN);            // 5 h gap
  addRun(env, "r5", 14 * HOUR, 14 * HOUR - MIN);            // 1 h: not a gap
  addRun(env, "r6", 2.5 * HOUR, 2.4 * HOUR, { claimed: 9, graded: 8, rejected: 0 });
  addItem(env);
  addItem(env, { state: "claimed", claim_id: "c", claimed_until: iso(-HOUR) });
  addItem(env, { ticker: "SSTI", source_key: "ssti" });     // dropped ticker: not in the backlog
  addItem(env, { state: "skipped", skip_reason: "archive_seed" });
  addAux(env, { nm_first_seen: iso(14 * DAY) });
  addAux(env, { nm_first_seen: iso(3 * DAY) });
  addAuxGrade(env, addAux(env));
  addGrade(env, addItem(env));                              // graded, no headline: waiting
  const r = await get(env, "/v1/ops");
  assert.equal(r.status, 200);
  const g = r.body.grader;
  assert.equal(g.last_run_at, env.DB.rows("SELECT last_seen_at FROM runs WHERE id = 'r6'")[0].last_seen_at);
  assert.deepEqual({ id: g.last_run.id, claimed: g.last_run.claimed, graded: g.last_run.graded, rejected: g.last_run.rejected }, { id: "r6", claimed: 9, graded: 8, rejected: 0 });
  assert.equal(g.runs_24h, 4);
  assert.equal(g.status, "late");
  assert.deepEqual(g.gaps_7d.map((x) => Math.round(x.hours)), [60, 135, 5, 12]);
  assert.ok(g.gaps_7d.every((x) => x.hours > 2 && x.from < x.to));
  assert.deepEqual(g.checks.map((c) => c.key), ["grader_stale", "queue_stale"]);
  assert.deepEqual(g.backlog, { coverage_pending: 2, aux_pending: 2, headlines_waiting: 2, oldest_aux_pending_at: env.DB.rows("SELECT MIN(nm_first_seen) AS t FROM aux_items WHERE state='pending'")[0].t });

  addRun(env, "r7", 20 * MIN, 10 * MIN);
  assert.equal((await get(env, "/v1/ops", "admin")).body.grader.status, "ok");
});

// --- Z4 ------------------------------------------------------------------------
test("Z4 /v1/stats counts only today's universe", async () => {
  const env = newEnv();
  const a = addItem(env);
  addGrade(env, a, { score: 95 });
  addItem(env);
  const s = addItem(env, { ticker: "SSTI", source_key: "ssti" });
  addGrade(env, s, { score: 92 });
  addItem(env, { ticker: "REKR", source_key: "rekor", nm_first_seen: iso(30 * DAY) });
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'SSTI', ?)").run(s, iso());
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'RCAT', ?)").run(a, iso());
  const st = (await get(env, "/v1/stats")).body;
  assert.deepEqual(Object.fromEntries(st.by_state.map((x) => [x.state, x.n])), { graded: 1, pending: 1 });
  assert.deepEqual(st.by_band, [{ band: "lead", n: 1 }]);
  assert.equal(st.labels, 1);
  assert.equal(st.oldest_pending_first_seen, env.DB.rows("SELECT nm_first_seen AS t FROM items WHERE ticker='RCAT' AND state='pending'")[0].t);
});

// --- Z5 ------------------------------------------------------------------------
test("Z5 reason codes: optional with any label, stored, returned by labels and feeds; anything else is 400", async () => {
  const env = newEnv();
  const id = addItem(env);
  addGrade(env, id, { score: 75 });
  const aux = addAux(env);
  addAuxGrade(env, aux, { score: 75 });
  assert.deepEqual(LABEL_REASONS, ["not_material", "duplicate", "wrong_company", "stale", "marketing", "not_my_focus", "missed_detail"]);
  for (const [path, item] of [["/v1/feedback", id], ["/v1/aux/feedback", aux]]) {
    for (const bad of ["nope", 7, "NOT MATERIAL", "too_low"]) {
      const r = await post(env, path, { item_id: item, label: "low", reason: bad });
      assert.equal(r.status, 400, `${path} ${bad}`);
      assert.match(r.body.error, /reason must be one of not_material/);
    }
    assert.equal((await post(env, path, { item_id: item, label: "high" })).body.reason, null, "a reason is optional");
    for (const label of ["high", "noise", "too_high"]) assert.equal((await post(env, path, { item_id: item, label, reason: "stale" })).status, 200, label);
    assert.equal((await post(env, path, { item_id: item, label: "too_low", reason: "missed_detail" })).body.reason, "missed_detail");
  }
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM feedback WHERE reason IS NOT NULL")[0].n, 4);
  assert.equal(env.DB.rows("SELECT reason FROM aux_feedback ORDER BY id DESC LIMIT 1")[0].reason, "missed_detail");
  const labels = (await get(env, "/v1/labels", "grader")).body.labels;
  assert.equal(labels[0].reason, "missed_detail");
  const auxLabels = (await get(env, "/v1/aux/labels", "grader")).body.labels;
  assert.equal(auxLabels[0].reason, "missed_detail");
  const card = (await get(env, "/v1/feed")).body.items.find((i) => i.item_id === id);
  assert.deepEqual([card.label, card.my_label, card.my_reason], ["too_low", "too_low", "missed_detail"]);
  const auxCard = (await get(env, "/v1/aux/feed")).body.items.find((i) => i.item_id === aux);
  assert.deepEqual([auxCard.label, auxCard.my_label, auxCard.my_reason], ["too_low", "too_low", "missed_detail"]);
  // A later label without a reason clears the shown reason.
  await post(env, "/v1/feedback", { item_id: id, label: "medium" });
  assert.equal((await get(env, "/v1/feed")).body.items.find((i) => i.item_id === id).my_reason, null);
});

// --- Z6 ------------------------------------------------------------------------
test("Z6 calibration covers aux by entity, with reason counts; the route nests coverage", async () => {
  const env = newEnv();
  const now = Date.now();
  const cov = addItem(env);
  const g = addGrade(env, cov, { score: 75 });
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, grade_id, ticker, reason, created_at) VALUES (?, 'noise', ?, 'RCAT', 'marketing', ?)").run(cov, g, iso(DAY));
  const label = (item, grade, lab, reason, ago = DAY) =>
    env.DB.db.prepare("INSERT INTO aux_feedback (item_id, grade_id, label, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(item, grade, lab, reason, iso(ago));
  const a1 = addAux(env); const ga1 = addAuxGrade(env, a1, { score: 92, entity: "Anduril" });
  label(a1, ga1, "high", null);
  const a2 = addAux(env); const ga2 = addAuxGrade(env, a2, { score: 85, entity: "Anduril" });
  label(a2, ga2, "noise", "not_material");
  const a3 = addAux(env, { source_key: "shieldai", entity_key: "shieldai", entity_name: "Shield AI (private)" }); const ga3 = addAuxGrade(env, a3, { score: 40, entity: "Shield AI" });
  label(a3, ga3, "too_low", "missed_detail", 20 * DAY);
  label(a3, ga3, "too_low", "marketing", 15 * DAY);  // the later label wins
  const c = await buildCalibration(env.DB, { now });
  assert.equal(c.all_time.n, 1);
  assert.equal(c.all_time.by_ticker.RCAT.too_high, 1);
  assert.equal(c.aux.labelled_this_week, 2);
  assert.deepEqual([c.aux.all_time.n, c.aux.all_time.agree, c.aux.all_time.too_high, c.aux.all_time.too_low], [3, 1, 1, 1]);
  assert.deepEqual([c.aux.this_week.n, c.aux.this_week.by_entity.Anduril.n], [2, 2]);
  assert.equal(c.aux.all_time.by_entity["Shield AI"].too_low, 1);
  assert.equal(c.aux.misses[0].entity, "Anduril");
  assert.equal(c.aux.misses[0].reason, "not_material");
  assert.deepEqual(c.reasons, { marketing: 2, not_material: 1 });
  const r = (await get(env, "/v1/calibration")).body;
  assert.deepEqual(Object.keys(r).sort(), ["aux", "coverage", "generated_at", "reasons", "week_from"]);
  assert.equal(r.coverage.all_time.n, 1);
  assert.ok(Array.isArray(r.coverage.text) && r.coverage.text[0].startsWith("**Zenith calibration"));
  assert.equal(r.aux.all_time.n, 3);
  assert.deepEqual(r.reasons, { marketing: 2, not_material: 1 });
});

// --- Z7 ------------------------------------------------------------------------
test("Z7 source prefs: roles, known keys, never SEC or a covered company's own channel", async () => {
  const env = newEnv();
  assert.equal((await get(env, "/v1/source-prefs", "grader")).status, 403);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "anduril", action: "mute" }, "grader")).status, 403);
  for (const [body, re] of [
    [{ source_key: "edgar_rcat", action: "mute" }, /SEC source/],
    [{ source_key: "edgar_ssti", action: "demote" }, /SEC source/],
    [{ source_key: "redcat", action: "mute" }, /RCAT's own channel/],
    [{ source_key: "no_such_source", action: "mute" }, /unknown source/],
    [{ source_key: "probe_axon_newsroom", action: "mute" }, /unknown source/],
    [{ source_key: "managed_draganfly_news", action: "mute" }, /unknown source/],
    [{ source_key: "anduril", action: "hide" }, /action must be one of mute, demote, normal/],
    [{ action: "mute" }, /source_key/],
  ]) {
    const r = await post(env, "/v1/source-prefs", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  assert.equal(prefRefusal("redcat") != null, true);
  // SEC filing sources are refused whatever the key: aux entries marked sec (adapter edgar).
  for (const key of ["einride_sec", "maymobility_sec", "spaceeyes_sec", "paccar", "palantir"]) assert.match(prefRefusal(key) || "", /SEC source/, key);
  const sec = await post(env, "/v1/source-prefs", { source_key: "einride_sec", action: "mute" });
  assert.equal(sec.status, 400);
  assert.match(sec.body.error, /SEC filings are never muted/);
  for (const key of ["anduril", "tfvector", "skydio", "nga", "aglt_rel", "managed_fort_robotics_news", "ia_somecompany"]) assert.equal(prefRefusal(key), null, key);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "tfvector", action: "demote", note: "mostly hiring" })).status, 200);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "managed_fort_robotics_news", action: "mute" })).status, 200);
  const prefs = (await get(env, "/v1/source-prefs")).body.prefs;
  assert.deepEqual(prefs.map((p) => [p.source_key, p.action, p.note]), [["managed_fort_robotics_news", "mute", null], ["tfvector", "demote", "mostly hiring"]]);
  assert.equal((await post(env, "/v1/source-prefs", { source_key: "tfvector", action: "normal" })).status, 200);
  assert.deepEqual((await get(env, "/v1/source-prefs")).body.prefs.map((p) => p.source_key), ["managed_fort_robotics_news"]);
});

test("Z7 mute: parks pending and expired-claimed items in both pipelines, skips new ones at ingest, hides cards; normal lets items flow again", async () => {
  const env = newEnv();
  const pend = addItem(env, { source_key: "skydio", ticker: "AXON", role: "relationship", affects: "AXON" });
  const expired = addItem(env, { source_key: "skydio", ticker: "AXON", state: "claimed", claim_id: "c1", claimed_until: iso(MIN) });
  const live = addItem(env, { source_key: "skydio", ticker: "AXON", state: "claimed", claim_id: "c2", claimed_until: iso(-HOUR) });
  const graded = addItem(env, { source_key: "skydio", ticker: "AXON" });
  addGrade(env, graded, { score: 80 });
  const other = addItem(env);
  const auxPend = addAux(env, { source_key: "skydio", entity_key: "skydio", entity_name: "Skydio (private)" });
  const auxGraded = addAux(env, { source_key: "skydio", entity_key: "skydio", entity_name: "Skydio (private)" });
  addAuxGrade(env, auxGraded, { score: 80, entity: "Skydio" });
  const auxOther = addAux(env);
  addAuxGrade(env, auxOther, { score: 80 });
  assert.ok(ids(await get(env, "/v1/feed?order=newest")).includes(graded));

  const r = await post(env, "/v1/source-prefs", { source_key: "skydio", action: "mute" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.parked, { coverage: 2, aux: 1 });
  const st = (table, id) => one(env, `SELECT state, skip_reason, claim_id FROM ${table} WHERE id = ?`, id);
  assert.deepEqual(st("items", pend), { state: "skipped", skip_reason: "muted_source", claim_id: null });
  assert.deepEqual(st("items", expired), { state: "skipped", skip_reason: "muted_source", claim_id: null });
  assert.equal(st("items", live).state, "claimed", "a live lease is left to its grader");
  assert.equal(st("items", graded).state, "graded");
  assert.equal(st("items", other).state, "pending");
  assert.deepEqual(st("aux_items", auxPend), { state: "skipped", skip_reason: "muted_source", claim_id: null });
  // Graded cards from the source leave both feeds, in every order.
  for (const q of ["", "?order=newest", "?min_score=0"]) assert.ok(!ids(await get(env, `/v1/feed${q}`)).includes(graded), q);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed")), [auxOther]);
  // Nor does the headline pass spend on them.
  const hc = (await post(env, "/v1/headlines/claim", { limit: 40 }, "grader")).body;
  const claimed = hc.items.map((i) => `${i.kind}:${i.item_id}`);
  assert.ok(claimed.includes(`aux:${auxOther}`));
  assert.ok(!claimed.includes(`coverage:${graded}`) && !claimed.includes(`aux:${auxGraded}`), claimed.join(","));
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?order=newest")), [auxOther]);

  // New rows from the muted source are stored skipped, in both ingests.
  for (const key of ["nm_cursor", "aux_nm_cursor"]) atStart(env.DB, key);
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  nmRowAdd(env.NEWS, { source_key: "skydio", title: "Skydio wins an Axon-integrated police order" });
  nmRowAdd(env.NEWS, { source_key: "redcat", title: "Red Cat Q3 results" });
  await ingest(env);
  await ingestAux(env);
  assert.deepEqual(one(env, "SELECT state, skip_reason FROM items WHERE source_key='skydio' ORDER BY id DESC LIMIT 1"), { state: "skipped", skip_reason: "muted_source" });
  assert.deepEqual(one(env, "SELECT state, skip_reason FROM items WHERE source_key='redcat' ORDER BY id DESC LIMIT 1"), { state: "pending", skip_reason: null });
  assert.deepEqual(one(env, "SELECT state, skip_reason FROM aux_items WHERE source_key='skydio' ORDER BY id DESC LIMIT 1"), { state: "skipped", skip_reason: "muted_source" });
  // The grader never sees them.
  const claim = (await post(env, "/v1/queue/claim", { limit: 50 }, "grader")).body;
  assert.ok(claim.items.every((i) => i.source_key !== "skydio" || i.item_id === live));

  // Unmute: future items flow; the parked ones stay parked.
  await post(env, "/v1/source-prefs", { source_key: "skydio", action: "normal" });
  nmRowAdd(env.NEWS, { source_key: "skydio", title: "Skydio opens a second factory" });
  await ingest(env);
  assert.deepEqual(one(env, "SELECT state, skip_reason FROM items WHERE source_key='skydio' ORDER BY id DESC LIMIT 1"), { state: "pending", skip_reason: null });
  assert.equal(st("items", pend).skip_reason, "muted_source");
  assert.ok(ids(await get(env, "/v1/feed?order=newest")).includes(graded), "its graded cards are shown again");
});

test("Z7 demote: For You counts the source 15 lower for pins and the Signal floor; Latest, bands and stored scores are unchanged", async () => {
  const env = newEnv();
  const demotedLead = addItem(env, { source_key: "skydio", ticker: "AXON", nm_first_seen: iso(2 * HOUR) });
  addGrade(env, demotedLead, { score: 95 });
  const demoted70 = addItem(env, { source_key: "skydio", ticker: "AXON", nm_first_seen: iso(3 * HOUR) });
  addGrade(env, demoted70, { score: 78 });
  const plainLead = addItem(env, { nm_first_seen: iso(4 * HOUR) });
  addGrade(env, plainLead, { score: 91 });
  const plain75 = addItem(env, { nm_first_seen: iso(30 * MIN) });
  addGrade(env, plain75, { score: 75 });
  const auxDem = addAux(env, { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector" });
  addAuxGrade(env, auxDem, { score: 94, entity: "Vector" });
  const auxPlain = addAux(env);
  addAuxGrade(env, auxPlain, { score: 75 });
  assert.deepEqual(ids(await get(env, "/v1/feed?min_score=70")), [plainLead, demotedLead, plain75, demoted70], "before: both Leads pinned");
  for (const key of ["skydio", "tfvector"]) assert.equal((await post(env, "/v1/source-prefs", { source_key: key, action: "demote" })).status, 200);
  assert.equal(DEMOTE_POINTS, 15);
  const fy = (await get(env, "/v1/feed?min_score=70")).body.items;
  assert.deepEqual(fy.map((i) => i.item_id), [plainLead, plain75, demotedLead], "the demoted Lead loses its pin (80 for ordering) and the 78 drops below the floor");
  assert.deepEqual(fy.map((i) => [i.score, i.band, i.demoted]), [[91, "lead", 0], [75, "digest", 0], [95, "lead", 1]], "stored scores and bands are unchanged");
  const latest = ids(await get(env, "/v1/feed?order=newest"));
  assert.deepEqual(latest, [plain75, plainLead, demoted70, demotedLead].sort((a, b) => b - a), "Latest is unchanged");
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?min_score=70")), [auxPlain, auxDem], "aux For You: the demoted Lead is not pinned");
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?min_score=80")), [], "and counts as 79");
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?order=newest")), [auxPlain, auxDem]);
  assert.equal(one(env, "SELECT score FROM grades WHERE item_id = ?", demotedLead).score, 95);
});

// --- Z8 ------------------------------------------------------------------------
test("Z8 source yield: latest grade per item, sorted by graded, with suggestions", async () => {
  const env = newEnv();
  // tfvector: 10 graded, 9 rejects + 1 duplicate, none high -> mute.
  for (let k = 0; k < 10; k++) addGrade(env, addItem(env, { source_key: "tfvector", ticker: "DPRO" }), { score: k ? 20 : null });
  // skydio: 8 graded, 6 rejects and 2 at 75 -> demote.
  for (let k = 0; k < 8; k++) addGrade(env, addItem(env, { source_key: "skydio", ticker: "AXON" }), { score: k < 6 ? 30 : 75 });
  // redcat (own channel): all rejects, never suggested.
  for (let k = 0; k < 12; k++) addGrade(env, addItem(env), { score: 10 });
  // A regrade: only the latest grade counts.
  const re = addItem(env, { source_key: "nga", ticker: "PL" });
  addGrade(env, re, { score: 20 });
  addGrade(env, re, { score: 85, run_id: "run-2" });
  // Outside the window, and a dropped ticker.
  addGrade(env, addItem(env, { source_key: "nga", ticker: "PL", nm_first_seen: iso(40 * DAY) }), { score: 10 });
  addGrade(env, addItem(env, { source_key: "ssti", ticker: "SSTI" }), { score: 10 });
  for (let k = 0; k < 6; k++) {
    const a = addAux(env, { source_key: "heo", entity_key: "heo", entity_name: "HEO" });
    addAuxGrade(env, a, { score: k < 5 ? 20 : null, band: k === 5 ? "covered" : undefined, entity: "HEO" });
  }
  await post(env, "/v1/source-prefs", { source_key: "skydio", action: "demote" });
  const r = await get(env, "/v1/source-yield?days=30");
  assert.equal(r.status, 200);
  const cov = Object.fromEntries(r.body.coverage.map((x) => [x.source_key, x]));
  assert.deepEqual(r.body.coverage.map((x) => x.source_key), ["redcat", "tfvector", "skydio", "nga"]);
  assert.deepEqual({ ...cov.tfvector, last_high_at: undefined }, { source_key: "tfvector", graded: 10, high: 0, reject: 9, duplicate: 1, last_high_at: undefined, pref: null, suggest: "mute", mutable: true, lock: null });
  assert.deepEqual([cov.skydio.graded, cov.skydio.high, cov.skydio.reject, cov.skydio.pref, cov.skydio.suggest], [8, 2, 6, "demote", null], "already demoted: no suggestion");
  assert.deepEqual([cov.redcat.reject, cov.redcat.suggest], [12, null], "a covered company's own channel is never suggested");
  assert.deepEqual([cov.nga.graded, cov.nga.high, cov.nga.reject], [1, 1, 0]);
  assert.ok(cov.nga.last_high_at);
  assert.deepEqual(r.body.aux.map((x) => [x.source_key, x.graded, x.reject, x.duplicate, x.covered, x.suggest]), [["heo", 6, 5, 0, 1, "demote"]]);
  assert.equal(suggestFor({ source_key: "skydio", graded: 8, high: 2, reject: 6, duplicate: 0, pref: null }), "demote");
  assert.equal(suggestFor({ source_key: "skydio", graded: 5, high: 0, reject: 5, duplicate: 0, pref: null }), null, "too few grades");
  assert.equal(suggestFor({ source_key: "edgar_rcat", graded: 20, high: 0, reject: 20, duplicate: 0, pref: null }), null);
  assert.equal(suggestFor({ source_key: "skydio", graded: 10, high: 1, reject: 9, duplicate: 0, pref: null }), "demote", "a high grade rules out mute");
  assert.equal(suggestFor({ source_key: "tfvector", graded: 8, high: 0, reject: 7, duplicate: 0, pref: "mute" }), null, "a muted source is never suggested for demote");
  assert.equal(suggestFor({ source_key: "tfvector", graded: 12, high: 0, reject: 12, duplicate: 0, pref: "demote" }), "mute", "a demoted one may still be suggested for mute");
  for (const key of ["einride_sec", "paccar"]) assert.equal(suggestFor({ source_key: key, graded: 12, high: 0, reject: 12, duplicate: 0, pref: null }), null, key);
});

// --- Z9 ------------------------------------------------------------------------
test("Z9 left out: skipped items newest first with counts; archive_seed only by name; grade one back", async () => {
  const env = newEnv();
  const rival = addItem(env, { source_key: "tfvector", ticker: "DPRO", state: "skipped", skip_reason: "rival_no_key_account", nm_first_seen: iso(2 * HOUR) });
  const stale = addItem(env, { state: "skipped", skip_reason: "stale_on_arrival", nm_first_seen: iso(HOUR), attempts: 2 });
  const seed = addItem(env, { state: "skipped", skip_reason: "archive_seed", nm_first_seen: iso(3 * HOUR) });
  addItem(env, { state: "skipped", skip_reason: "stale_on_arrival", nm_first_seen: iso(20 * DAY) });
  addItem(env, { ticker: "SSTI", source_key: "ssti", state: "skipped", skip_reason: "stale_on_arrival" });
  const muted = addAux(env, { source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector", state: "skipped", skip_reason: "muted_source" });
  assert.equal((await get(env, "/v1/left-out", "grader")).status, 403);
  const r = (await get(env, "/v1/left-out?kind=coverage")).body;
  assert.deepEqual(r.items.map((i) => i.id), [stale, rival]);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["blocked", "first_seen", "gradeable", "id", "kind", "skip_reason", "source_key", "ticker", "title", "url"]);
  assert.deepEqual(r.counts, { archive_seed: 1, rival_no_key_account: 1, stale_on_arrival: 1 });
  assert.deepEqual((await get(env, "/v1/left-out?kind=coverage&reason=archive_seed")).body.items.map((i) => i.id), [seed]);
  assert.deepEqual((await get(env, "/v1/left-out?kind=coverage&reason=rival_no_key_account")).body.items.map((i) => i.id), [rival]);
  assert.equal((await get(env, "/v1/left-out?kind=coverage&days=30")).body.items.length, 3);
  assert.equal((await get(env, "/v1/left-out?kind=coverage&limit=1")).body.items.length, 1);
  const a = (await get(env, "/v1/left-out?kind=aux")).body;
  assert.deepEqual([a.items[0].id, a.items[0].entity, a.items[0].kind], [muted, "Vector", "aux"]);
  assert.equal((await get(env, "/v1/left-out?kind=nope")).status, 400);
  assert.equal((await get(env, "/v1/left-out?reason=DROP TABLE")).status, 400);

  const g = await post(env, "/v1/left-out/grade", { kind: "coverage", id: stale });
  assert.equal(g.status, 200);
  assert.deepEqual(one(env, "SELECT state, attempts, claim_id, claimed_until, skip_reason FROM items WHERE id = ?", stale),
    { state: "pending", attempts: 0, claim_id: null, claimed_until: null, skip_reason: null });
  const claim = (await post(env, "/v1/queue/claim", { limit: 10 }, "grader")).body;
  assert.deepEqual(claim.items.map((i) => i.item_id), [stale], "the next grader run grades it");
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: stale })).status, 400, "no longer skipped");
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: 99999 })).status, 404);
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "x", id: stale })).status, 400);
  // A muted_source item waits while the source is muted.
  await post(env, "/v1/source-prefs", { source_key: "tfvector", action: "mute" });
  const refused = await post(env, "/v1/left-out/grade", { kind: "aux", id: muted });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /still muted/);
  await post(env, "/v1/source-prefs", { source_key: "tfvector", action: "normal" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "aux", id: muted })).status, 200);
  assert.equal(one(env, "SELECT state FROM aux_items WHERE id = ?", muted).state, "pending");
});

test("Z9 grade it: never puts one item on both pages; kind must be coverage or aux", async () => {
  const env = newEnv();
  // A rival item the gate dropped on Coverage, whose aux copy (Z11) is pending.
  const rival = addItem(env, { source_key: "tfvector", ticker: "DPRO", state: "skipped", skip_reason: "rival_no_key_account" });
  const rivalNm = rowid;
  const rivalAux = addAux(env, { nm_rowid: rivalNm, source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector", coverage_subject: 1, affects: "DPRO" });
  const r = await post(env, "/v1/left-out/grade", { kind: "coverage", id: rival });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /on the aux page as aux item \d+ \(pending\): one item is never on both pages/);
  assert.equal(one(env, "SELECT state FROM items WHERE id = ?", rival).state, "skipped");
  assert.equal(one(env, "SELECT state FROM aux_items WHERE id = ?", rivalAux).state, "pending");
  // Graded on the aux page too: still refused.
  addAuxGrade(env, rivalAux, { score: 40, entity: "Vector" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: rival })).status, 400);
  // An aux copy graded 'covered' is hidden there, so the Coverage copy can be rescued.
  const cov = addItem(env, { source_key: "tfvector", ticker: "DPRO", state: "skipped", skip_reason: "rival_no_key_account" });
  addAuxGrade(env, addAux(env, { nm_rowid: rowid, source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector" }), { score: 60, band: "covered", entity: "Vector" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: cov })).status, 200);
  // An aux copy that is itself skipped does not block.
  const both = addItem(env, { source_key: "tfvector", ticker: "DPRO", state: "skipped", skip_reason: "stale_on_arrival" });
  addAux(env, { nm_rowid: rowid, source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector", state: "skipped", skip_reason: "stale_on_arrival" });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "coverage", id: both })).status, 200);

  // The other way: an aux row parked on_coverage while its Coverage copy is pending or graded.
  const kept = addItem(env, { source_key: "tfvector", ticker: "DPRO", title: "Vector wins a DPRO-integrated order" });
  const parked = addAux(env, { nm_rowid: rowid, source_key: "tfvector", entity_key: "tfvector", entity_name: "Vector", state: "skipped", skip_reason: "on_coverage", coverage_subject: 1 });
  const a = await post(env, "/v1/left-out/grade", { kind: "aux", id: parked });
  assert.equal(a.status, 400);
  assert.match(a.body.error, new RegExp(`on the coverage page as coverage item ${kept} \\(pending\\)`));
  addGrade(env, kept, { score: 75 });
  assert.equal((await post(env, "/v1/left-out/grade", { kind: "aux", id: parked })).status, 400);
  assert.equal(one(env, "SELECT state, skip_reason FROM aux_items WHERE id = ?", parked).skip_reason, "on_coverage");

  // Object.prototype names are not kinds.
  for (const kind of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal((await get(env, `/v1/left-out?kind=${kind}`)).status, 400, kind);
    assert.equal((await post(env, "/v1/left-out/grade", { kind, id: rival })).status, 400, kind);
  }
});

// --- Z10 -----------------------------------------------------------------------
test("Z10 sort=to_label: graded unlabeled cards of 14 days, low confidence, then 60-79 nearest 70, then score desc", async () => {
  const env = newEnv();
  const mk = (score, confidence, over = {}) => { const id = addItem(env, over); addGrade(env, id, { score, confidence }); return id; };
  const s95 = mk(95, 0.9);
  const s72 = mk(72, 0.9);
  const low = mk(88, 0.4);
  const s61 = mk(61, 0.8);
  const s69 = mk(69, 0.8);
  const s30 = mk(30, 0.9);
  const labelled = mk(70, 0.9);
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'RCAT', ?)").run(labelled, iso());
  mk(70, 0.9, { nm_first_seen: iso(20 * DAY) });
  const dup = addItem(env); addGrade(env, dup, { score: null });
  addItem(env); // ungraded
  const r = await get(env, "/v1/feed?sort=to_label");
  assert.deepEqual(ids(r), [low, s69, s72, s61, s95, s30]);
  assert.equal(r.body.next_before_id, null);
  assert.deepEqual(ids(await get(env, "/v1/feed?sort=to_label&limit=2")), [low, s69]);
  assert.ok(ids(await get(env, "/v1/feed")).includes(labelled), "existing sorts are unchanged");

  const amk = (score, confidence, over = {}) => { const id = addAux(env, over); addAuxGrade(env, id, { score, confidence }); return id; };
  const a90 = amk(90, 0.9);
  const a75 = amk(75, 0.9);
  const aLow = amk(50, 0.3);
  const aLab = amk(70, 0.9);
  env.DB.db.prepare("INSERT INTO aux_feedback (item_id, label, created_at) VALUES (?, 'high', ?)").run(aLab, iso());
  const aOld = amk(70, 0.9, { nm_first_seen: iso(15 * DAY) });
  const covered = addAux(env); addAuxGrade(env, covered, { score: null, band: "covered" });
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?sort=to_label")), [aLow, a75, a90]);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?sort=to_label&limit=1")), [aLow]);
  assert.deepEqual(ids(await get(env, "/v1/aux/feed?order=newest")).slice(0, 3), [aOld, aLab, aLow], "Latest is unchanged");
});

// --- Z11 -----------------------------------------------------------------------
test("Z11 rival items the key-account gate drops are auxiliary (coverage subject); ones it keeps are not", async () => {
  const env = newEnv();
  for (const key of ["nm_cursor", "aux_nm_cursor"]) atStart(env.DB, key);
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  assert.deepEqual(rivalGate({ source_key: "tfvector", title: "Vector raises $40M" }), { onCoverage: false, affects: ["DPRO", "RCAT"] });
  assert.equal(rivalGate({ source_key: "tfvector", title: "Vector teams with Red Cat Holdings on drones" }).onCoverage, true);
  assert.equal(rivalGate({ source_key: "skydio", title: "Skydio raises" }), null, "not a rival source");
  nmRowAdd(env.NEWS, { source_key: "tfvector", title: "Vector raises $40M Series B for drone interceptors" });
  nmRowAdd(env.NEWS, { source_key: "tfvector", title: "Vector teams with Red Cat Holdings on Black Widow payloads" });
  nmRowAdd(env.NEWS, { source_key: "anduril", title: "Anduril opens Arsenal-1" });
  await ingest(env);
  const a = await ingestAux(env);
  assert.equal(a.rival_catch_up, null);
  assert.deepEqual(env.DB.rows("SELECT title, ticker, state, skip_reason FROM items WHERE source_key = 'tfvector' ORDER BY id").map((r) => ({ ...r })), [
    { title: "Vector raises $40M Series B for drone interceptors", ticker: "DPRO", state: "skipped", skip_reason: "rival_no_key_account" },
    { title: "Vector teams with Red Cat Holdings on Black Widow payloads", ticker: "RCAT", state: "pending", skip_reason: null },
  ]);
  const aux = env.DB.rows("SELECT title, entity_key, entity_name, state, coverage_subject, affects FROM aux_items WHERE source_key = 'tfvector'").map((r) => ({ ...r }));
  assert.equal(aux.length, 1, "the item the gate keeps is on Coverage only");
  assert.deepEqual(aux[0], { title: "Vector raises $40M Series B for drone interceptors", entity_key: "tfvector", entity_name: "Vector (tfvector.com; Bluffdale, Utah)",
    state: "pending", coverage_subject: 1, affects: "DPRO,RCAT" });
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'anduril'")[0].n, 1);
  const claim = (await post(env, "/v1/aux/claim", { limit: 10 }, "grader")).body;
  const it = claim.items.find((i) => i.source_key === "tfvector");
  assert.deepEqual([it.coverage_subject, it.affects], [true, ["DPRO", "RCAT"]]);
  // Hidden from the Auxiliary page until graded, as every coverage-subject item.
  assert.ok(!(await get(env, "/v1/aux/feed?order=newest")).body.items.some((i) => i.source_key === "tfvector"));
});

test("Z11 one-time rival catch-up (aux_rv_cursor): stores dropped rows, marks stored ones, parks kept ones as on_coverage, then stops", async () => {
  const env = newEnv();
  const news = env.NEWS;
  // An existing zenith-db: the main aux cursor is past these rows, which were
  // stored before Z11 (every counterparty source was already auxiliary).
  nmRowAdd(news, { source_key: "pixxel", title: "Pixxel launches three Fireflies", first_seen: iso(3 * DAY) });          // rowid 1: stored, pending
  nmRowAdd(news, { source_key: "pixxel", title: "Pixxel signs with Satellogic on hyperspectral data", first_seen: iso(3 * DAY) }); // 2: gate keeps it
  nmRowAdd(news, { source_key: "pixxel", title: "Pixxel raises $60M", first_seen: iso(2 * DAY) });                        // 3: not stored yet
  nmRowAdd(news, { source_key: "pixxel", title: "Pixxel hires a CFO", first_seen: iso(2 * DAY) });                        // 4: stored, graded
  nmRowAdd(news, { source_key: "anduril", title: "Anduril news", first_seen: iso(2 * DAY) });                             // 5: not a rival
  const store = (nm, title, over = {}) => env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
    VALUES (?, ?, 'pixxel', 'Pixxel', 'private', ?, ?, ?, ?, ?)`).run(nm, over.source_key || "pixxel", `https://x.example/${nm}`, title, iso(2 * DAY), iso(), over.state || "pending");
  store(1, "Pixxel launches three Fireflies");
  store(2, "Pixxel signs with Satellogic on hyperspectral data");
  store(4, "Pixxel hires a CFO", { state: "graded" });
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('aux_nm_cursor', '5'), ('aux_cs_cursor', 'done')").run();
  const r = await ingestAux(env);
  assert.deepEqual([r.rival_catch_up.done, r.rival_catch_up.matched, r.rival_catch_up.parked_on_coverage], [true, 3, 1]);
  assert.equal(meta(env.DB, "aux_rv_cursor"), AUX_CS_DONE);
  const rows = Object.fromEntries(env.DB.rows("SELECT nm_rowid, state, skip_reason, coverage_subject, affects FROM aux_items").map((x) => [x.nm_rowid, { ...x }]));
  assert.deepEqual(rows[1], { nm_rowid: 1, state: "pending", skip_reason: null, coverage_subject: 1, affects: "SATL" });
  assert.deepEqual(rows[2], { nm_rowid: 2, state: "skipped", skip_reason: "on_coverage", coverage_subject: 0, affects: null });
  assert.deepEqual(rows[3], { nm_rowid: 3, state: "pending", skip_reason: null, coverage_subject: 1, affects: "SATL" });
  assert.deepEqual([rows[4].state, rows[4].coverage_subject], ["graded", 0], "a graded item is left as it was");
  assert.equal(rows[5], undefined, "only rival keys");
  assert.equal((await ingestAux(env)).rival_catch_up, null, "it runs once");

  // A fresh zenith-db never needs it.
  const fresh = newEnv();
  await ingestAux(fresh);
  assert.equal(meta(fresh.DB, "aux_rv_cursor"), AUX_CS_DONE);
});
