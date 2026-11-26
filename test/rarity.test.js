// Phase 2, the read-time rarity class (worker/src/rarity.js) and GET /v1/rare.
// Synthetic fixtures only: the class tests inject their own maps, and the route
// tests pick their source keys from the bundled maps at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";
import { OFFICIAL_HOST_RE as SCRIPT_OFFICIAL_HOST_RE } from "../scripts/sync-covered.mjs";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { rarityClass, RARITY, WIRE_HOSTS, isWireHost, hostOf } = await import("../worker/src/rarity.js");
const { OFFICIAL_HOST_RE } = await import("../worker/src/records.js");
const { default: COVERED } = await import("../worker/src/covered.json");
const { default: AUX } = await import("../worker/src/aux-sources.json");

// --- Synthetic maps in the real shapes of covered.json and aux-sources.json ---------------------
const covered = {
  tickers: ["SYN", "ACM"],
  sources: { synco: "SYN", synco_sec: "SYN", acme_ir: "ACM" },
  counterparty: { syn_rel: { role: "customer", affects: ["SYN"] } },
  records: ["synco_sec"],
};
const aux = {
  sources: {
    syn_rel: { entity: "syn_rel", name: "Synco partner mentions", status: "public", coverage_subject: true, affects: ["SYN"] },
    syn_filter: { entity: "syn_filter", name: "Synco trade filter", status: "media", coverage_subject: true, affects: ["SYN"] },
    widget_corp: { entity: "widget_corp", name: "Widget Corp", status: "private" },
    widget_sec: { entity: "widget_corp", name: "Widget Corp filings", status: "public", sec: true },
    city_council: { entity: "city_council", name: "City council matters", status: "program", record: true, coverage_subject: true, affects: ["SYN"] },
    acme: { entity: "acme", name: "Acme", status: "private" },
  },
  exclude: {},
};
const cls = (source_key, url = "https://news.example.com/a") => rarityClass({ source_key, url }, { covered, aux });

// --- T13 ------------------------------------------------------------------------------------------
test("T13: rarityClass with injected maps and the real key shapes", () => {
  assert.deepEqual(RARITY, ["register", "original", "issuer", "wire"]);
  assert.equal(cls("synco"), "issuer", "own-lane key");
  assert.equal(cls("edgar_x"), "issuer", "edgar_* key");
  assert.equal(cls("synco_sec"), "issuer", "a covered record key is a filing, not a register");
  assert.equal(cls("widget_sec"), "issuer", "aux sec key");
  assert.equal(cls("syn_rel", "https://www.sec.gov/Archives/x.htm"), "issuer", "a sec.gov URL is a filing whatever the key");
  assert.equal(cls("city_council"), "register", "aux record key");
  assert.equal(cls("syn_filter", "https://town.legistar.com/Matter.aspx?ID=1"), "register", "a legistar host from a non-own key");
  assert.equal(cls("syn_filter", "https://www.agency.gov/news/1"), "register", "a government host from a non-own key");
  assert.equal(cls("synco", "https://town.legistar.com/x"), "issuer", "an own-lane key stays issuer on a register host");
  assert.equal(cls("syn_filter", "https://www.msn.com/en-us/news/x"), "wire", "msn.com from a coverage-subject key");
  assert.equal(cls("syn_filter", "https://www.aol.com/x"), "wire", "www.aol.com");
  assert.equal(cls("syn_rel", "https://finance.yahoo.com/news/x"), "wire", "a counterparty key on a portal");
  assert.equal(cls("syn_filter", "https://www.tradepress.example/story"), "original", "a trade-press host from a coverage-subject key");
  assert.equal(cls("widget_corp", "https://news.widgetcorp.example/x"), "issuer", "an aux company channel (no coverage_subject)");
  assert.equal(cls("managed_acme_news"), "issuer", "managed_* is the company's own channel");
  assert.equal(cls("ia_acme"), "issuer", "ia_<x> is the company's own channel");
  assert.equal(cls("ia_media_robots", "https://www.tradepress.example/x"), "original", "ia_media_* on a trade host");
  assert.equal(cls("ia_media_robots", "https://www.msn.com/x"), "wire", "ia_media_* on msn.com");
  assert.equal(cls("droppedname"), null, "an unknown key (a name dropped from coverage)");
  assert.equal(cls(""), null);
  assert.equal(rarityClass(null, { covered, aux }), null);
  assert.equal(cls("syn_filter", "not a url"), "original", "an unparsable URL falls through to the key rules");
});

test("T13: wire hosts match the host or a parent domain only; WIRE_HOSTS holds the newswire services", () => {
  assert.equal(isWireHost("msn.com"), true);
  assert.equal(isWireHost("www.msn.com"), true);
  assert.equal(isWireHost("notmsn.com"), false);
  assert.equal(isWireHost("msn.com.example"), false);
  assert.equal(isWireHost(""), false);
  assert.equal(hostOf("https://WWW.AOL.COM./x"), "www.aol.com");
  assert.equal(new Set(WIRE_HOSTS).size, WIRE_HOSTS.length, "no duplicates");
  for (const h of WIRE_HOSTS) assert.match(h, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, h);
  // The newswire services (text-class.js WIRE_SERVICES, spec I5) must be a subset.
  const services = ["prnewswire.com", "globenewswire.com", "businesswire.com", "accessnewswire.com",
    "accesswire.com", "newmediawire.com", "newsfilecorp.com", "einpresswire.com"];
  for (const s of services) assert.ok(WIRE_HOSTS.includes(s), s);
});

test("I5: text-class.js WIRE_SERVICES is a subset of WIRE_HOSTS, once text-class.js exists", async (t) => {
  const file = new URL("../worker/src/text-class.js", import.meta.url);
  if (!existsSync(file)) { t.skip("text-class.js is not built yet"); return; }
  const { WIRE_SERVICES } = await import(file.href);
  assert.ok(Array.isArray(WIRE_SERVICES) && WIRE_SERVICES.length > 0);
  for (const s of WIRE_SERVICES) assert.ok(WIRE_HOSTS.includes(s), s);
});

test("the bundled maps: every covered own-lane key is issuer and every aux key gets a class", () => {
  for (const key of Object.keys(COVERED.sources)) assert.equal(rarityClass({ source_key: key, url: "https://x.example/" }), "issuer", key);
  for (const key of Object.keys(AUX.sources)) assert.ok(RARITY.includes(rarityClass({ source_key: key, url: "https://x.example/" })), key);
  for (const [key, a] of Object.entries(AUX.sources)) {
    if (a.record === true && a.sec !== true) assert.equal(rarityClass({ source_key: key, url: "https://x.example/" }), "register", key);
  }
});

// --- T19 ------------------------------------------------------------------------------------------
test("T19: records.js OFFICIAL_HOST_RE equals scripts/sync-covered.mjs OFFICIAL_HOST_RE", () => {
  assert.equal(OFFICIAL_HOST_RE.source, SCRIPT_OFFICIAL_HOST_RE.source);
  assert.equal(OFFICIAL_HOST_RE.flags, SCRIPT_OFFICIAL_HOST_RE.flags);
  for (const h of ["www.agency.gov", "army.mil", "town.legistar.com", "www.canada.ca", "www.fmv.se", "data.gov.uk"]) assert.equal(OFFICIAL_HOST_RE.test(h), true, h);
  for (const h of ["govtech.example", "legistar.com.example", "example.com"]) assert.equal(OFFICIAL_HOST_RE.test(h), false, h);
});

// --- T18 (rarity.js half) ----------------------------------------------------------------------------
test("T18: rarity.js reaches neither delivery.js nor discord.js, and makes no fetch", () => {
  const SRC = new URL("../worker/src/", import.meta.url);
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(new URL(f, SRC), "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"\.\/([^"]+\.js)"/gm)) walk(m[1]);
  };
  walk("rarity.js");
  assert.ok(seen.size > 1);
  assert.ok(!seen.has("delivery.js") && !seen.has("discord.js"), `rarity.js reaches ${[...seen].join(", ")}`);
  assert.doesNotMatch(readFileSync(new URL("rarity.js", SRC), "utf8"), /\bfetch\(/);
  assert.ok(readdirSync(SRC).includes("rarity.js"));
});

// --- Route fixtures (keys picked from the bundled maps, never written here) ------------------------
const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const auxEntries = Object.entries(AUX.sources);
const inUniverse = (a) => (a.affects || []).some((t) => COVERED.tickers.includes(t));
// Coverage-subject filters (not record, not sec), with a covered ticker they affect.
const filters = auxEntries.filter(([, a]) => a.coverage_subject && !a.record && !a.sec && inUniverse(a)).map(([k, a]) => [k, a.affects.find((t) => COVERED.tickers.includes(t))]);
const [[FILTER, FILTER_T], [MUTED_KEY, MUTED_T]] = filters;
const [OWN_KEY, OWN_T] = Object.entries(COVERED.sources).find(([k]) => !k.startsWith("edgar_") && !(COVERED.records || []).includes(k));
const AUX_RECORD = auxEntries.find(([, a]) => a.record === true && !a.sec)?.[0];
const AUX_CHANNEL = auxEntries.find(([, a]) => !a.coverage_subject && !a.record && !a.sec)?.[0];

let rowid = 0;
function addItem(env, over = {}) {
  const it = { source_key: FILTER, ticker: FILTER_T, url: `https://www.tradepress.example/s/${++rowid}`, title: "A synthetic story",
    published: iso(DAY), nm_first_seen: iso(DAY), state: "pending", role: null, ...over };
  const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, category, nm_first_seen, nm_notified, ingested_at, state, role)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)`).run(it.nm_rowid ?? rowid, it.source_key, it.ticker, it.url, it.title, it.published, it.nm_first_seen, iso(), it.state, it.role);
  return Number(r.lastInsertRowid);
}
function addGrade(env, itemId, { score, graded_at = iso(DAY), primary = true } = {}) {
  const item = env.DB.db.prepare("SELECT ticker FROM items WHERE id = ?").get(itemId);
  const band = score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject";
  const r = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
    VALUES (?, ?, ?, 'r-test', 'm', ?, ?, 'why', '["reason:material"]', 1, ?)`).run(itemId, item.ticker, `run-${itemId}-${graded_at}`, score, band, graded_at);
  const id = Number(r.lastInsertRowid);
  if (primary) env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(id, itemId);
  return id;
}
function addAux(env, { source_key, url, score, nm_first_seen = iso(DAY), state = "graded", band, nm_rowid } = {}) {
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, nm_first_seen, ingested_at, state)
    VALUES (?, ?, 'synthetic', 'Synthetic', 'private', ?, 'A synthetic aux story', ?, ?, ?)`).run(nm_rowid ?? 100000 + ++rowid, source_key, url, nm_first_seen, iso(), state);
  const id = Number(r.lastInsertRowid);
  if (score !== undefined) {
    const b = band ?? (score == null ? "duplicate" : score >= 90 ? "lead" : score >= 70 ? "digest" : score >= 40 ? "borderline" : "reject");
    const g = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, flags, graded_at) VALUES (?, 'run-x', 'Synthetic', ?, ?, '["reason:material"]', ?)`)
      .run(id, score, b, iso());
    env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), id);
  }
  return id;
}
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });

// --- T14 ------------------------------------------------------------------------------------------
test("T14: a register item and a wire item graded the same store the same score and band; the claim carries no rarity", async () => {
  const env = newEnv();
  const reg = addItem(env, { url: "https://town.legistar.com/Matter.aspx?ID=7" });
  const wire = addItem(env, { url: "https://www.msn.com/en-us/news/x-7" });
  assert.equal(rarityClass({ source_key: FILTER, url: "https://town.legistar.com/Matter.aspx?ID=7" }), "register");
  assert.equal(rarityClass({ source_key: FILTER, url: "https://www.msn.com/en-us/news/x-7" }), "wire");
  const claim = (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 10, run_id: "run-t14" } })).body;
  assert.deepEqual(claim.items.map((i) => i.item_id).sort(), [reg, wire].sort());
  const keys = new Set();
  const scan = (v) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); scan(x); } };
  scan(claim);
  assert.ok(!keys.has("rarity") && !keys.has("rare"), "the claim payload has no rarity");
  const g = (item_id) => ({ item_id, score: 72, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material"] });
  const res = (await request(worker, env, "POST", "/v1/grades", { role: "grader", body: { claim_id: claim.claim_id, run_id: "run-t14", grades: [g(reg), g(wire)] } })).body;
  assert.equal(res.accepted, 2, JSON.stringify(res.rejected));
  const rows = env.DB.db.prepare("SELECT item_id, score, band FROM grades WHERE item_id IN (?, ?) ORDER BY item_id").all(reg, wire);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].score, rows[1].score);
  assert.equal(rows[0].band, rows[1].band);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["band", "item_id", "score"]);
  const cols = env.DB.db.prepare("SELECT name FROM pragma_table_info('grades') UNION ALL SELECT name FROM pragma_table_info('items')").all().map((r) => r.name);
  assert.ok(!cols.some((c) => /rarity/i.test(c)), "no stored rarity column");
});

// --- T16 ------------------------------------------------------------------------------------------
test("T16: /v1/rare keeps register and original rows at the floor, latest grade only, in the window, not muted, in the universe", async () => {
  assert.ok(FILTER && MUTED_KEY && OWN_KEY && AUX_RECORD && AUX_CHANNEL, "the bundled maps have every key shape the test needs");
  const env = newEnv();
  const register = addItem(env, { url: "https://town.legistar.com/Matter.aspx?ID=1" });
  addGrade(env, register, { score: 70 });
  const original = addItem(env);
  addGrade(env, original, { score: 65 });
  const atFloor = addItem(env);
  addGrade(env, atFloor, { score: 60 });
  const below = addItem(env, { url: "https://town.legistar.com/Matter.aspx?ID=2" });
  addGrade(env, below, { score: 59 });
  const issuer = addItem(env, { source_key: OWN_KEY, ticker: OWN_T });
  addGrade(env, issuer, { score: 95 });
  const wire = addItem(env, { url: "https://www.msn.com/en-us/news/x" });
  addGrade(env, wire, { score: 85 });
  const old = addItem(env, { url: "https://town.legistar.com/Matter.aspx?ID=3" });
  addGrade(env, old, { score: 80, graded_at: iso(20 * DAY) });
  const regraded = addItem(env, { url: "https://town.legistar.com/Matter.aspx?ID=4" });
  addGrade(env, regraded, { score: 88 });
  addGrade(env, regraded, { score: 30, graded_at: iso(DAY / 2) });
  const outside = addItem(env, { ticker: "ZZZQ", url: "https://town.legistar.com/Matter.aspx?ID=5" });
  addGrade(env, outside, { score: 90 });
  const muted = addItem(env, { source_key: MUTED_KEY, ticker: MUTED_T, url: "https://town.legistar.com/Matter.aspx?ID=6" });
  addGrade(env, muted, { score: 90 });
  env.DB.db.prepare("INSERT INTO source_prefs (source_key, action, updated_at) VALUES (?, 'mute', ?)").run(MUTED_KEY, iso());

  const auxRegister = addAux(env, { source_key: AUX_RECORD, url: "https://records.example/1", score: 75 });
  const auxOriginal = addAux(env, { source_key: FILTER, url: "https://www.tradepress.example/a1", score: 62 });
  addAux(env, { source_key: AUX_CHANNEL, url: "https://news.example/a2", score: 91 });              // issuer
  addAux(env, { source_key: FILTER, url: "https://www.globenewswire.com/a3", score: 90 });         // wire
  addAux(env, { source_key: AUX_RECORD, url: "https://records.example/4", score: 58 });            // below the floor
  addAux(env, { source_key: AUX_RECORD, url: "https://records.example/5", score: 80, nm_first_seen: iso(20 * DAY) }); // first seen before the window
  addAux(env, { source_key: AUX_RECORD, url: "https://records.example/6", state: "pending" });     // not graded
  addAux(env, { source_key: MUTED_KEY, url: "https://www.tradepress.example/a7", score: 80 });     // muted
  addAux(env, { source_key: "droppedname", url: "https://www.tradepress.example/a8", score: 80 }); // no class
  // A rival twin whose coverage copy is shown: the aux copy is hidden, as on the aux feed.
  const twinRow = 990001;
  addItem(env, { nm_rowid: twinRow, role: "rival" });
  addAux(env, { source_key: FILTER, url: "https://www.tradepress.example/a9", score: 80, nm_rowid: twinRow });

  const r = await request(worker, env, "GET", "/v1/rare?days=14", { role: "app" });
  assert.equal(r.status, 200);
  assert.equal(r.body.floor, 60);
  assert.equal(r.body.days, 14);
  assert.deepEqual(r.body.coverage.map((x) => [x.item_id, x.rarity, x.score]), [[register, "register", 70], [original, "original", 65], [atFloor, "original", 60]]);
  assert.deepEqual(r.body.aux.map((x) => [x.item_id, x.rarity, x.score]), [[auxRegister, "register", 75], [auxOriginal, "original", 62]]);
  for (const x of [...r.body.coverage, ...r.body.aux]) assert.ok(["register", "original"].includes(x.rarity) && x.score >= 60);

  // The window and the floor are bounded: days 1-30, floor 40-100.
  const wide = (await request(worker, env, "GET", "/v1/rare?days=99&floor=10", { role: "admin" })).body;
  assert.equal(wide.days, 30);
  assert.equal(wide.floor, 40);
  assert.ok(wide.coverage.some((x) => x.item_id === old), "a 20-day-old grade is in a 30-day window");
  assert.ok(wide.coverage.some((x) => x.item_id === below), "59 clears a floor of 40");
  assert.ok(!wide.coverage.some((x) => x.item_id === regraded), "the latest grade (30) is under every floor");
  assert.ok(!wide.coverage.some((x) => x.item_id === outside || x.item_id === muted || x.item_id === issuer || x.item_id === wire));
  const high = (await request(worker, env, "GET", "/v1/rare?floor=72&days=junk", { role: "app" })).body;
  assert.equal(high.days, 14);
  assert.deepEqual(high.coverage, []);
  assert.deepEqual(high.aux.map((x) => x.item_id), [auxRegister]);

  // Roles: the app and admin only.
  assert.equal((await request(worker, env, "GET", "/v1/rare", { role: "grader" })).status, 403);
  assert.equal((await request(worker, env, "POST", "/v1/rare", { role: "app" })).status, 404);
});

test("T16: /v1/rare keeps at most 50 rows a pipeline, in score order", async () => {
  const env = newEnv();
  for (let i = 0; i < 55; i++) addGrade(env, addItem(env, { url: `https://town.legistar.com/Matter.aspx?ID=${100 + i}` }), { score: 60 + (i % 40) });
  const body = (await request(worker, env, "GET", "/v1/rare", { role: "app" })).body;
  assert.equal(body.coverage.length, 50);
  const scores = body.coverage.map((x) => x.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});
