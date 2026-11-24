// Round 5, Parts C and D (Worker side) of plans/round5-expansion-approve-queue.md:
// the expansion_candidates upsert (seen key, origins merge, newest-5 evidence,
// status never changed), dedupe keys, own-source and term notes, the status
// lifecycle, the three /v1/expansion routes, the aux entity rule (C2) on the
// aux grade submit and the one-time backfill (D4). All over an in-memory
// zenith-db with the real migrations and the Worker's fetch().
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const X = await import("../worker/src/expansion.js");
const { candidateName, dedupeKey, coveredTicker, upsertSightings, auxEntitySighting, expansionBackfill, REJECT_REASONS, BACKFILL_META } = X;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const newEnv = () => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS });
const rows = (env) => env.DB.rows("SELECT * FROM expansion_candidates ORDER BY id").map((r) => ({
  ...r, origins: JSON.parse(r.origins), tickers: JSON.parse(r.tickers), seen: JSON.parse(r.seen), evidence: JSON.parse(r.evidence),
  known: r.known == null ? null : JSON.parse(r.known), decisions: JSON.parse(r.decisions),
}));
const byName = (env, name) => rows(env).find((r) => r.name === name);
const meta = (env, key) => env.DB.rows("SELECT value FROM meta WHERE key = ?", key)[0]?.value ?? null;

let seq = 0;
function addAux(env, over = {}) {
  const it = { source_key: "ia_media_robotics_funding", entity_key: "media_robotics_funding", entity_name: "Industry media", status: "media",
    url: `https://news.example.com/a/${++seq}`, title: `Aux item ${seq}`, nm_first_seen: iso(HOUR), state: "pending", coverage_subject: 0, ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, category, nm_first_seen,
      ingested_at, state, attempts, coverage_subject) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?)`)
    .run(seq, it.source_key, it.entity_key, it.entity_name, it.status, it.url, it.title, it.nm_first_seen, iso(), it.state, it.coverage_subject);
  return Number(r.lastInsertRowid);
}
function addAuxGrade(env, itemId, over = {}) {
  const g = { entity: "Genesis AI", score: 90, band: "lead", event_type: "financing", reads_through: "[]", graded_at: iso(), ...over };
  const r = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, event_type, why, reads_through, flags, confidence, read_source, graded_at)
    VALUES (?, ?, ?, ?, ?, ?, 'why', ?, '["reason:material"]', 0.8, 1, ?)`).run(itemId, `run-${++seq}`, g.entity, g.score, g.band, g.event_type, g.reads_through, g.graded_at);
  env.DB.db.prepare("UPDATE aux_items SET state='graded', grade_id=? WHERE id=?").run(Number(r.lastInsertRowid), itemId);
  return Number(r.lastInsertRowid);
}
const AT = iso(DAY);
// A Part A relation sighting and a Part B party sighting, as those parts build them.
const relation = (over = {}) => ({ name: "Stemme", origin: "grader_relation", relation: "acquired", subject: "ONDS", tickers: ["ONDS"], kind: "coverage",
  item_id: 206, url: "https://ir.ondas.com/news/206", title: "Ondas to acquire Stemme", at: AT, ...over });
const upgradeA = relation({ name: "Upgrade Energy", subject: "UMAC", tickers: ["UMAC"], item_id: 18, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23",
  url: "https://www.sec.gov/Archives/edgar/data/1956955/000168316826008046/umac_8k.htm" });
const upgradeB = { ...upgradeA, origin: "sec_filing", party: "DroneNX LLC d/b/a Upgrade Energy", aliases: ["DroneNX LLC"] };

const app = (env, method, path, body) => request(worker, env, method, path, { role: "app", body });
async function seedRow(env, sighting = relation()) {
  const r = await upsertSightings(env.DB, [sighting]);
  assert.equal(r.ok, true, JSON.stringify(r));
  return byName(env, candidateName(sighting.name)).id;
}

// --- Names and keys ------------------------------------------------------------
test("candidateName: squash, one trailing parenthetical, 2-80 characters before any clip, no URL, control or other characters", () => {
  assert.equal(candidateName("  Agile   Robots  "), "Agile Robots");
  assert.equal(candidateName("Carbyne (CRBN)"), "Carbyne");
  assert.equal(candidateName("O’Neil & Sons, Inc."), "O'Neil & Sons, Inc.");
  assert.equal(candidateName("Société Générale"), "Société Générale");
  assert.equal(candidateName("株式会社ロボット"), "株式会社ロボット");
  for (const bad of ["A", "x".repeat(81), "www.example.com", "https://example.com/x", "sec.gov/Archives/x", "Ghost-X / Lattice", "Foo | Bar",
    "Foo (Bar) Baz", "Tab\u0007Co", "Name‮", 42, null, undefined, ""]) {
    assert.equal(candidateName(bad), null, JSON.stringify(bad));
  }
  assert.equal(candidateName("x".repeat(80)), "x".repeat(80), "80 is allowed");
});

test("dedupeKey: accents, parentheticals, punctuation, repeated legal suffixes, non-Latin letters and the empty key", () => {
  assert.equal(dedupeKey("Société Générale S.A."), "societe generale");
  assert.equal(dedupeKey("AGILOX Services GmbH"), "agilox services");
  assert.equal(dedupeKey("Acme Holdings, Inc."), "acme");
  assert.equal(dedupeKey("Acme Holdings Corp. Ltd."), "acme");
  assert.equal(dedupeKey("Acme Co."), dedupeKey("Acme Company"));
  assert.equal(dedupeKey("DroneNX, L.L.C."), "dronenx");
  assert.equal(dedupeKey("AEVEX (NYSE: AVEX)"), "aevex");
  assert.equal(dedupeKey("fort_robotics"), "fort robotics");
  assert.equal(dedupeKey("Genesis AI"), "genesis ai", "AI is kept");
  assert.notEqual(dedupeKey("Genesis AI"), dedupeKey("Genesis"));
  assert.equal(dedupeKey("Роботех"), "роботех", "an all-Cyrillic name keeps its letters");
  assert.equal(dedupeKey("株式会社ロボット"), dedupeKey("株式会社ロボット"));
  assert.ok(dedupeKey("株式会社ロボット").length > 0, "an all-Japanese name keeps a key");
  assert.equal(dedupeKey("Holdings Inc"), "holdings", "the last word is never stripped");
  assert.equal(dedupeKey("- -"), "");
  assert.equal(dedupeKey("(Buyer)"), "");
});

test("coveredTicker: tickers, sheet name:, first terms entry and company_names; never product terms", () => {
  assert.equal(coveredTicker("Unusual Machines, Inc."), "UMAC");
  assert.equal(coveredTicker("UMAC"), "UMAC");
  assert.equal(coveredTicker("Ondas Holdings Inc."), "ONDS", "first terms entry Ondas, holdings stripped");
  assert.equal(coveredTicker("Red Cat"), "RCAT", "key-accounts company_names");
  assert.equal(coveredTicker("Axon Enterprise"), "AXON");
  for (const product of ["Carbyne", "Upgrade Energy", "DroneNX", "Stemme"]) assert.equal(coveredTicker(product), null, product);
});

// --- Upsert ----------------------------------------------------------------------
test("upsert: a new name is pending with its evidence; a regrade of the same item adds no sighting; a new item does", async () => {
  const env = newEnv();
  const r = await upsertSightings(env.DB, [relation()]);
  assert.deepEqual([r.ok, r.upserted, r.warnings], [true, 1, []]);
  let row = byName(env, "Stemme");
  assert.deepEqual([row.status, row.known, row.relation, row.subject, row.tickers, row.origins, row.seen, row.dedupe_key],
    ["pending", null, "acquired", "ONDS", ["ONDS"], ["grader_relation"], ["coverage:206"], "stemme"]);
  assert.deepEqual(row.evidence, [{ kind: "coverage", item_id: 206, url: "https://ir.ondas.com/news/206", title: "Ondas to acquire Stemme", at: relation().at, origin: "grader_relation" }]);
  // A regrade (a new run) and a requeue of the same item.
  await upsertSightings(env.DB, [relation({ title: "Ondas to acquire Stemme (regraded)" })]);
  await upsertSightings(env.DB, [relation({ name: "STEMME", relation: "partner", title: "Ondas to acquire Stemme (requeued)" })]);
  row = byName(env, "Stemme");
  assert.deepEqual([row.seen, row.evidence.length, row.relation, rows(env).length], [["coverage:206"], 1, "acquired", 1], "one row, one sighting, the first relation");
  assert.equal(row.evidence[0].title, "Ondas to acquire Stemme (requeued)", "the same item's entry is replaced by its latest sighting");
  // Later items: sightings grow, the newest item first, at most 5 kept.
  for (let id = 300; id < 306; id++) await upsertSightings(env.DB, [relation({ item_id: id, tickers: ["ONDS", "RCAT"] })]);
  row = byName(env, "Stemme");
  assert.equal(row.seen.length, 7, "seen is never capped");
  assert.deepEqual(row.evidence.map((e) => e.item_id), [305, 304, 303, 302, 301]);
  assert.deepEqual(row.tickers, ["ONDS", "RCAT"]);
});

test("upsert: grader_relation and sec_filing on the same coverage item are one row, both origins, sightings 1 (Upgrade Energy)", async () => {
  const env = newEnv();
  await upsertSightings(env.DB, [upgradeA]);
  await upsertSightings(env.DB, [upgradeB]);
  const all = rows(env);
  assert.equal(all.length, 1, "no DroneNX row");
  const row = all[0];
  assert.deepEqual([row.name, row.status, row.origins, row.seen, row.known, row.tickers, row.subject],
    ["Upgrade Energy", "pending", ["grader_relation", "sec_filing"], ["coverage:18"], ["sheet_term:UMAC"], ["UMAC"], "UMAC"]);
  assert.deepEqual(row.evidence.map((e) => [e.origin, e.party ?? null]), [["sec_filing", "DroneNX LLC d/b/a Upgrade Energy"], ["grader_relation", null]]);
  // The SEC pass in the other order, and twice: still one sighting.
  const env2 = newEnv();
  await upsertSightings(env2.DB, [upgradeB, upgradeB, upgradeA]);
  assert.deepEqual(rows(env2).map((r) => [r.origins, r.seen.length]), [[["sec_filing", "grader_relation"], 1]]);
});

test("upsert: bad sightings are skipped with a warning and never throw; good ones in the same call are kept", async () => {
  const env = newEnv();
  const r = await upsertSightings(env.DB, [relation({ name: "https://x.example/a" }), relation({ name: "- -" }), relation({ origin: "bing" }),
    relation({ relation: "investor" }), relation({ kind: "news" }), relation({ item_id: "x" }), null, relation({ name: "ARAN Defense", item_id: 245 })]);
  assert.equal(r.ok, true);
  assert.equal(r.upserted, 1);
  assert.equal(r.warnings.length, 7);
  assert.match(r.warnings[1].warning, /empty dedupe key/);
  assert.deepEqual(rows(env).map((x) => x.name), ["ARAN Defense"]);
  assert.deepEqual(await upsertSightings(env.DB, "nope"), { ok: true, upserted: 0, warnings: [] });
  // A zenith-db before migration 0012: a warning, never an exception.
  env.DB.exec("DROP TABLE expansion_candidates");
  const gone = await upsertSightings(env.DB, [relation()]);
  assert.equal(gone.ok, false);
  assert.match(gone.warnings[0].warning, /not available yet: migration 0012/);
});

test("own source sets known: a covered name, an aux-sources.json source, a runtime ia_ entity in aux_items; terms only add a note", async () => {
  const env = newEnv();
  // Runtime sources news-monitor creates (not in aux-sources.json), as aux ingest stores them.
  addAux(env, { source_key: "ia_rockwell", entity_key: "rockwell", entity_name: "Rockwell", status: "unknown" });
  addAux(env, { source_key: "managed_zeroeyes_news", entity_key: "zeroeyes", entity_name: "ZeroEyes (private)", status: "private" });
  addAux(env, { source_key: "ia_media_humanoids", entity_key: "media_humanoids", entity_name: "Industry media", status: "media" });
  addAux(env, { source_key: "aglt_rel", entity_key: "aglt_rel", entity_name: "Widget Partners", status: "public", coverage_subject: 1 });
  const s = (name, item_id, over = {}) => relation({ name, item_id, ...over });
  await upsertSightings(env.DB, [s("Unusual Machines, Inc.", 1), s("Anduril Industries", 2), s("Anduril", 3), s("Rockwell Automation", 4), s("ZeroEyes", 5),
    s("Industry media", 6), s("UNMAS", 7), s("Carbyne", 8), s("Stemme", 9), s("Widget Partners", 10), s("Rockwellian Labs", 11)]);
  const got = Object.fromEntries(rows(env).map((r) => [r.name, [r.status, r.known]]));
  assert.deepEqual(got, {
    "Unusual Machines, Inc.": ["known", ["covered:UMAC", "key_account:PUSA", "sheet_term:UMAC"]],
    "Anduril Industries": ["pending", null],
    Anduril: ["known", ["aux_source:anduril", "key_account:SPAI"]],
    "Rockwell Automation": ["known", ["aux_item:ia_rockwell"]],
    ZeroEyes: ["known", ["aux_item:managed_zeroeyes_news", "aux_source:zeroeyes"]],
    "Industry media": ["pending", null],
    UNMAS: ["pending", ["key_account:SPAI"]],
    Carbyne: ["pending", ["sheet_term:AXON"]],
    Stemme: ["pending", null],
    "Widget Partners": ["pending", null],
    "Rockwellian Labs": ["pending", null],
  });
});

test("a rejected row stays rejected on a new sighting; a known row stays known", async () => {
  const env = newEnv();
  const id = await seedRow(env);
  assert.equal((await app(env, "POST", "/v1/expansion/decide", { id, action: "reject", reason: "too_small" })).status, 200);
  await upsertSightings(env.DB, [relation({ item_id: 900 }), relation({ item_id: 901, origin: "sec_filing" })]);
  const row = byName(env, "Stemme");
  assert.deepEqual([row.status, row.seen.length, row.origins], ["rejected", 3, ["grader_relation", "sec_filing"]]);
});

// --- Routes ---------------------------------------------------------------------
test("role matrix: app and admin may use all three routes; the grader gets 403 and no token 401", async () => {
  const env = newEnv();
  const id = await seedRow(env);
  const calls = [["GET", "/v1/expansion/candidates"], ["POST", "/v1/expansion/decide", { id, action: "approve" }],
    ["POST", "/v1/expansion/compiled", { items: [{ id, tickers: ["ONDS"] }], ref: "166" }]];
  for (const [m, p, body] of calls) {
    assert.equal((await request(worker, env, m, p, { role: "grader", body })).status, 403, `grader ${m} ${p}`);
    const r = await worker.fetch(new Request(`https://zenith.test${p}`, { method: m }), env);
    assert.equal(r.status, 401, `no token ${m} ${p}`);
  }
  for (const [m, p, body] of calls) assert.equal((await app(env, m, p, body)).status, 200, `app ${m} ${p}`);
  const env2 = newEnv();
  const id2 = await seedRow(env2);
  for (const [m, p, body] of [calls[0], [calls[1][0], calls[1][1], { id: id2, action: "approve" }], [calls[2][0], calls[2][1], { items: [{ id: id2, tickers: ["ONDS"] }], ref: "166" }]]) {
    assert.equal((await request(worker, env2, m, p, { role: "admin", body })).status, 200, `admin ${m} ${p}`);
  }
  assert.equal(rows(env2)[0].decisions[0].by, "admin");
});

test("GET candidates: newest seen first, counts, sightings, similar hint, actions, decidable and blocked", async () => {
  const env = newEnv();
  await upsertSightings(env.DB, [relation({ name: "Genesis AI", item_id: 222, kind: "aux", origin: "aux_entity", relation: null, subject: null, tickers: [], at: iso(3 * HOUR) })], { now: iso(3 * HOUR) });
  await upsertSightings(env.DB, [relation({ name: "Genesis", item_id: 1870, kind: "aux", origin: "aux_entity", relation: null, subject: null, tickers: [] })], { now: iso(2 * HOUR) });
  await upsertSightings(env.DB, [relation({ name: "Anduril" })], { now: iso(HOUR) });
  const r = await app(env, "GET", "/v1/expansion/candidates");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.counts, { pending: 2, approved: 0, rejected: 0, compiled: 0, known: 1 });
  assert.deepEqual(r.body.reject_reasons, REJECT_REASONS);
  assert.deepEqual(r.body.candidates.map((c) => c.name), ["Genesis", "Genesis AI"], "pending only, newest seen first");
  const [genesis, genesisAi] = r.body.candidates;
  assert.deepEqual(genesis.similar.map((s) => s.id), [genesisAi.id]);
  assert.deepEqual(genesisAi.similar.map((s) => s.id), [genesis.id]);
  for (const c of r.body.candidates) {
    for (const k of ["id", "name", "status", "relation", "subject", "origins", "tickers", "sightings", "evidence", "known", "similar", "decision", "decisions",
      "approved_tickers", "actions", "decidable", "blocked", "last_seen_at"]) assert.ok(k in c, `candidate has ${k}`);
    assert.deepEqual([c.sightings, c.actions, c.decidable, c.blocked, c.origins], [1, ["approve", "reject"], true, null, ["aux_entity"]]);
  }
  const known = (await app(env, "GET", "/v1/expansion/candidates?status=known")).body.candidates;
  assert.deepEqual(known.map((c) => [c.name, c.actions, c.decidable]), [["Anduril", ["reopen"], false]]);
  assert.match(known[0].blocked, /own source \(aux_source:anduril\).*Not the same company/);
  assert.equal((await app(env, "GET", "/v1/expansion/candidates?limit=1")).body.candidates.length, 1);
  assert.equal((await app(env, "GET", "/v1/expansion/candidates?status=bogus")).status, 400);
});

test("GET candidates: decided statuses take days (default 30); pending and known have no age filter", async () => {
  const env = newEnv();
  const old = await seedRow(env, relation({ name: "Old Co", item_id: 1 }));
  const fresh = await seedRow(env, relation({ name: "Fresh Co", item_id: 2 }));
  await seedRow(env, relation({ name: "Ancient Pending", item_id: 3 }));
  env.DB.db.prepare("UPDATE expansion_candidates SET last_seen_at = ? WHERE name = 'Ancient Pending'").run(iso(400 * DAY));
  for (const id of [old, fresh]) assert.equal((await app(env, "POST", "/v1/expansion/decide", { id, action: "reject", reason: "not_relevant" })).status, 200);
  env.DB.db.prepare("UPDATE expansion_candidates SET decisions = json_set(decisions, '$[0].at', ?) WHERE id = ?").run(iso(40 * DAY), old);
  const names = async (q) => (await app(env, "GET", `/v1/expansion/candidates?${q}`)).body.candidates.map((c) => c.name);
  assert.deepEqual(await names("status=rejected"), ["Fresh Co"]);
  assert.deepEqual(await names("status=rejected&days=60"), ["Fresh Co", "Old Co"]);
  assert.deepEqual(await names("status=pending"), ["Ancient Pending"]);
});

test("decide: the 400s and 404s, with plain error text", async () => {
  const env = newEnv();
  const id = await seedRow(env);
  const cases = [
    [{ action: "approve" }, 400, /id must be/],
    [{ id: "x", action: "approve" }, 400, /id must be/],
    [{ id, action: "promote" }, 400, /action must be one of approve, reject, reopen/],
    [{ id, action: "reject" }, 400, /reject needs a reason/],
    [{ id, action: "reject", reason: "boring" }, 400, /reject needs a reason: one of not_relevant/],
    [{ id, action: "approve", reason: "too_small" }, 400, /reason is only for reject/],
    [{ id, action: "approve", tickers: ["ONDS", "TSLA"] }, 400, /ticker TSLA is not a covered ticker/],
    [{ id, action: "approve", tickers: "ONDS" }, 400, /tickers must be an array/],
    [{ id, action: "approve", note: 5 }, 400, /note must be a string/],
    [{ id, action: "reopen" }, 400, /only a known candidate can be reopened/],
    [{ id: 9999, action: "approve" }, 404, /unknown candidate 9999/],
  ];
  for (const [body, status, re] of cases) {
    const r = await app(env, "POST", "/v1/expansion/decide", body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.match(r.body.error, re, JSON.stringify(body));
  }
  assert.deepEqual(rows(env)[0].decisions, [], "no refusal is audited");
  assert.equal(rows(env)[0].status, "pending");
});

test("decide: the lifecycle, with an audit entry appended on every decision", async () => {
  const env = newEnv();
  const id = await seedRow(env, relation({ tickers: ["ONDS"] }));
  const decide = (body, role = "app") => request(worker, env, "POST", "/v1/expansion/decide", { role, body: { id, ...body } });
  let r = await decide({ action: "approve" });
  assert.deepEqual([r.status, r.body.status, r.body.was, r.body.decision.tickers], [200, "approved", "pending", ["ONDS"]], "tickers prefilled from the row");
  assert.match((await decide({ action: "approve" })).body.error, /already approved/);
  r = await decide({ action: "reject", reason: "duplicate", note: "same as Stemme GmbH" }, "admin");
  assert.equal(r.body.status, "rejected");
  assert.match((await decide({ action: "reject", reason: "duplicate" })).body.error, /already rejected/);
  r = await decide({ action: "approve", tickers: ["rcat", "ONDS", "RCAT"] });
  assert.deepEqual([r.body.status, r.body.decision.tickers], ["approved", ["ONDS", "RCAT"]]);
  const row = rows(env)[0];
  assert.deepEqual(row.decisions.map((d) => [d.by, d.action, d.reason, d.note, d.tickers]), [
    ["app", "approve", null, null, ["ONDS"]],
    ["admin", "reject", "duplicate", "same as Stemme GmbH", null],
    ["app", "approve", null, null, ["ONDS", "RCAT"]],
  ]);
  assert.ok(row.decisions.every((d) => typeof d.at === "string"));
  const listed = (await app(env, "GET", "/v1/expansion/candidates?status=approved")).body.candidates[0];
  assert.deepEqual([listed.approved_tickers, listed.decision.action, listed.actions], [["ONDS", "RCAT"], "approve", ["reject"]]);
});

test("decide: a known row refuses approve and reject; reopen moves it to pending; a compiled row refuses everything", async () => {
  const env = newEnv();
  const id = await seedRow(env, relation({ name: "Anduril" }));
  assert.equal(rows(env)[0].status, "known");
  for (const body of [{ action: "approve" }, { action: "reject", reason: "already_tracked" }]) {
    const r = await app(env, "POST", "/v1/expansion/decide", { id, ...body });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /already has its own source: reopen it first/);
  }
  const r = await app(env, "POST", "/v1/expansion/decide", { id, action: "reopen", note: "the partner, not the source" });
  assert.deepEqual([r.status, r.body.status], [200, "pending"]);
  assert.equal((await app(env, "POST", "/v1/expansion/decide", { id, action: "approve", tickers: ["SPAI"] })).status, 200);
  assert.equal((await app(env, "POST", "/v1/expansion/compiled", { items: [{ id, tickers: ["SPAI"] }], ref: "166" })).status, 200);
  for (const body of [{ action: "approve" }, { action: "reject", reason: "too_small" }, { action: "reopen" }]) {
    const x = await app(env, "POST", "/v1/expansion/decide", { id, ...body });
    assert.equal(x.status, 400);
    assert.match(x.body.error, /compiled into the build list: it takes no more decisions/);
  }
  const listed = (await app(env, "GET", "/v1/expansion/candidates?status=compiled")).body.candidates[0];
  assert.deepEqual([listed.decidable, listed.actions, listed.compiled_ref, listed.approved_tickers], [false, [], "166", ["SPAI"]]);
  assert.match(listed.blocked, /compiled into the build list as 166/);
  assert.deepEqual(rows(env)[0].decisions.map((d) => d.action), ["reopen", "approve", "compiled"]);
});

test("compiled: marks only rows still approved with the tickers read; returns the mismatches and changes nothing for them", async () => {
  const env = newEnv();
  const a = await seedRow(env, relation({ name: "Alpha Robotics", item_id: 1 }));
  const b = await seedRow(env, relation({ name: "Beta Robotics", item_id: 2 }));
  const c = await seedRow(env, relation({ name: "Gamma Robotics", item_id: 3 }));
  for (const id of [a, b, c]) await app(env, "POST", "/v1/expansion/decide", { id, action: "approve", tickers: ["ONDS"] });
  // After the compile read them: b is rejected, c is re-approved with other tickers.
  await app(env, "POST", "/v1/expansion/decide", { id: b, action: "reject", reason: "wrong_name" });
  await app(env, "POST", "/v1/expansion/decide", { id: c, action: "reject", reason: "wrong_name" });
  await app(env, "POST", "/v1/expansion/decide", { id: c, action: "approve", tickers: ["ONDS", "RCAT"] });
  const r = await app(env, "POST", "/v1/expansion/compiled", { items: [{ id: a, tickers: ["onds"] }, { id: b, tickers: ["ONDS"] }, { id: c, tickers: ["ONDS"] },
    { id: 777, tickers: [] }], ref: "166" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ok, r.body.compiled], [false, [a]]);
  assert.deepEqual(r.body.mismatches.map((m) => m.id), [b, c, 777]);
  assert.match(r.body.mismatches[0].error, /is rejected, not approved/);
  assert.match(r.body.mismatches[1].error, /approved for \[ONDS, RCAT\], not \[ONDS\]/);
  const got = Object.fromEntries(rows(env).map((x) => [x.name, [x.status, x.compiled_ref]]));
  assert.deepEqual(got, { "Alpha Robotics": ["compiled", "166"], "Beta Robotics": ["rejected", null], "Gamma Robotics": ["approved", null] });
  // A per-item ref wins over the body's.
  const r2 = await app(env, "POST", "/v1/expansion/compiled", { items: [{ id: c, tickers: ["RCAT", "ONDS"], ref: "167" }] });
  assert.deepEqual([r2.body.ok, r2.body.compiled], [true, [c]]);
  assert.equal(byName(env, "Gamma Robotics").compiled_ref, "167");
  // Malformed bodies.
  for (const [body, re] of [[{}, /items must be/], [{ items: [] }, /items must be/], [{ items: [{ id: a }], ref: "1" }, /needs tickers/],
    [{ items: [{ id: a, tickers: [] }] }, /needs a ref/], [{ items: [{ id: a, tickers: [] }, { id: a, tickers: [] }], ref: "1" }, /listed twice/],
    [{ items: [{ id: "x", tickers: [] }], ref: "1" }, /needs id/]]) {
    const x = await app(env, "POST", "/v1/expansion/compiled", body);
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.match(x.body.error, re);
  }
});

test("routes before migration 0012: 404 not available yet (the app shows that), never a 500", async () => {
  const env = newEnv();
  env.DB.exec("DROP TABLE expansion_candidates");
  for (const [m, p, body] of [["GET", "/v1/expansion/candidates"], ["POST", "/v1/expansion/decide", { id: 1, action: "approve" }],
    ["POST", "/v1/expansion/compiled", { items: [{ id: 1, tickers: [] }], ref: "1" }]]) {
    const r = await app(env, m, p, body);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.match(r.body.error, /not available yet: migration 0012/);
  }
});

// --- Aux entity rule (C2) ---------------------------------------------------------
test("auxEntitySighting: score 70+ (inclusive), financing or acquisition, a real entity; tickers from reads_through only", () => {
  const item = { id: 222, url: "https://news.example.com/g", title: "Genesis AI raises $105M", nm_first_seen: iso(DAY) };
  const s = auxEntitySighting({ entity: "Genesis AI", score: 94, event_type: " Financing ", reads_through: '[{"ticker":"SERV","direction":"-"},{"ticker":"ZZZ","direction":"+"}]' }, item);
  assert.deepEqual(s, { name: "Genesis AI", origin: "aux_entity", relation: null, subject: null, tickers: ["SERV"], kind: "aux", item_id: 222,
    url: item.url, title: item.title, at: item.nm_first_seen });
  assert.ok(auxEntitySighting({ entity: "Xilect", score: 70, event_type: "financing", reads_through: [] }, item), "70 is in");
  assert.ok(auxEntitySighting({ entity: "AGILOX", score: 88, event_type: "acquisition" }, item));
  for (const g of [{ entity: "Xilect", score: 69, event_type: "financing" }, { entity: "Xilect", score: null, event_type: "financing" },
    { entity: "Xilect", score: 90, event_type: "order" }, { entity: "Xilect", score: 90, event_type: null }, { entity: "Industry media", score: 90, event_type: "financing" },
    { entity: "Unknown", score: 90, event_type: "financing" }, { entity: "Various", score: 90, event_type: "financing" },
    { entity: "Other company", score: 90, event_type: "acquisition" }, { entity: "Ghost-X / Lattice", score: 90, event_type: "financing" }]) {
    assert.equal(auxEntitySighting(g, item), null, JSON.stringify(g));
  }
});

test("POST /v1/aux/grades: a financing grade at 70+ becomes a candidate after the grades commit; a failed upsert is a warning and the grades stay", async () => {
  const env = newEnv();
  const a = addAux(env, { title: "Humyn Labs raises $12M seed" });
  const b = addAux(env, { title: "Robotics funding roundup" });
  const grade = (item_id, over = {}) => ({ item_id, entity: "Humyn Labs", score: 72, band: "digest", event_type: "financing", why: "A seed round.",
    reads_through: [], confidence: 0.7, read_source: true, dup_of: null, covered_ticker: null, flags: ["reason:material"], ...over });
  const post = (run_id, grades) => request(worker, env, "POST", "/v1/aux/grades", { body: { run_id, model: "m", grades } });
  let r = await post("run-1", [grade(a), grade(b, { entity: "Industry media", score: 80 })]);
  assert.deepEqual([r.status, r.body.accepted, r.body.warnings], [200, 2, []]);
  assert.deepEqual(rows(env).map((x) => [x.name, x.origins, x.seen, x.status]), [["Humyn Labs", ["aux_entity"], [`aux:${a}`], "pending"]]);
  // A regrade in a new run adds no sighting.
  r = await post("run-2", [grade(a, { score: 75 })]);
  assert.equal(r.body.accepted, 1);
  assert.deepEqual(rows(env)[0].seen, [`aux:${a}`]);
  // Before migration 0012: the grade is still stored, and the response warns.
  env.DB.exec("DROP TABLE expansion_candidates");
  r = await post("run-3", [grade(a, { score: 76 })]);
  assert.deepEqual([r.status, r.body.accepted], [200, 1]);
  assert.match(r.body.warnings[0].warning, /not available yet/);
  assert.equal(env.DB.rows("SELECT COUNT(*) AS n FROM aux_grades WHERE item_id = ?", a)[0].n, 3);
});

test("AGILOX: a relation on aux 1859 and the aux entity rule on aux 224 are one row with sightings 2", async () => {
  const env = newEnv();
  await upsertSightings(env.DB, [relation({ name: "AGILOX", relation: "acquired", subject: "Rockwell Automation", tickers: [], kind: "aux", item_id: 1859 })]);
  await upsertSightings(env.DB, [auxEntitySighting({ entity: "AGILOX", score: 88, event_type: "acquisition" }, { id: 224, url: "https://n.example/224", title: "Rockwell to buy AGILOX", nm_first_seen: iso() })]);
  const row = byName(env, "AGILOX");
  assert.deepEqual([row.seen, row.origins, row.relation, row.subject, rows(env).length], [["aux:1859", "aux:224"], ["grader_relation", "aux_entity"], "acquired", "Rockwell Automation", 1]);
});

// --- Backfill (D4) ----------------------------------------------------------------
test("backfill: runs once over each aux item's current grade of the last 30 days; waits for migration 0012", async () => {
  const env = newEnv();
  const g = (title, over) => addAuxGrade(env, addAux(env, { title }), over);
  g("Genesis AI raises $105M", { entity: "Genesis AI", score: 94 });
  g("Genesis raises", { entity: "Genesis", score: 75 });
  g("Agile Robots raises", { entity: "Agile Robots", score: 92 });
  g("Agile Robots again", { entity: "Agile Robots", score: 88 });
  g("Xilect seed", { entity: "Xilect", score: 70 });
  g("Humyn Labs seed", { entity: "Humyn Labs", score: 72 });
  g("Funding roundup", { entity: "Industry media", score: 80 });
  g("Small round", { entity: "Tiny Bots", score: 69 });
  g("Product launch", { entity: "Product Co", score: 95, event_type: "product" });
  g("Old round", { entity: "Old Money AI", score: 95, graded_at: iso(31 * DAY) });
  g("AGILOX deal", { entity: "AGILOX", score: 88, event_type: "Acquisition" });
  // Only the current grade counts: an earlier 90 replaced by a 40.
  const regraded = addAux(env, { title: "Regraded" });
  addAuxGrade(env, regraded, { entity: "Was Big", score: 90 });
  addAuxGrade(env, regraded, { entity: "Was Big", score: 40, band: "borderline" });

  // Before 0012: nothing, and the meta key stays unset so a later tick runs it.
  const pre = newEnv();
  pre.DB.exec("DROP TABLE expansion_candidates");
  assert.deepEqual(await expansionBackfill(pre), { skipped: "no table" });
  assert.equal(meta(pre, BACKFILL_META), null);

  // The cron runs it once.
  const logs = [];
  const { log } = console;
  console.log = (label, body) => logs.push([label, body]);
  try {
    for (let k = 0; k < 2; k++) {
      const waits = [];
      await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    }
  } finally {
    console.log = log;
  }
  const runs = logs.filter(([l]) => l === "expansion backfill").map(([, b]) => JSON.parse(b));
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].scanned, runs[0].candidates, runs[0].upserted], [8, 7, 7]);
  assert.equal(runs[1].skipped, "done");
  assert.ok(meta(env, BACKFILL_META));
  const got = Object.fromEntries(rows(env).map((r) => [r.name, [r.status, r.seen.length, r.origins]]));
  assert.deepEqual(got, {
    "Genesis AI": ["pending", 1, ["aux_entity"]],
    Genesis: ["pending", 1, ["aux_entity"]],
    "Agile Robots": ["pending", 2, ["aux_entity"]],
    Xilect: ["pending", 1, ["aux_entity"]],
    "Humyn Labs": ["pending", 1, ["aux_entity"]],
    AGILOX: ["pending", 1, ["aux_entity"]],
  });
  const list = (await app(env, "GET", "/v1/expansion/candidates")).body.candidates;
  const genesisAi = list.find((c) => c.name === "Genesis AI");
  assert.deepEqual(list.find((c) => c.name === "Genesis").similar.map((s) => s.id), [genesisAi.id]);
  // Already done: a direct call does nothing either.
  assert.equal((await expansionBackfill(env)).skipped, "done");
});
