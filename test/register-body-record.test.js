// Phase 4 Part D (Z1): body-record registers (aux-sources.json body_record,
// worker/src/records.js isBodyRecordSource). A body-record register's item body
// is the published record, so ingest keeps it as the excerpt (excerpt_status
// 'feed') whatever its length, and enrich never fetches the item URL. The
// Worker modules load a synthetic catalog; keys, tickers, hosts, names and
// bodies below are all made up (legal_test_*, TSA/TSB, example).
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";
import { insertNews } from "./helpers/aux-e2e.js";

// --- The synthetic catalog -----------------------------------------------------
const AFFECTS = ["TSA", "TSB"];
const SYN_MATCH = { TSA: { terms: ["Tsaco"], accounts: [] }, TSB: { terms: ["Tsbco"], accounts: [] } };
const SYN_COVERED = {
  tickers: AFFECTS, sources: { tsa_news: "TSA" },
  counterparty: {
    legal_test_grants: { role: "program", affects: AFFECTS, tag_affects: true },
    reg_test_plain: { role: "program", affects: AFFECTS },
  },
  records: [], channels: {}, media_accounts: {},
};
const reg = (entity, name) => ({ entity, name, status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: AFFECTS, record: true, register: true });
const SYN_AUX = {
  sources: {
    legal_test_grants: { ...reg("legal_test", "Test early terminations"), tag_affects: true, body_record: true },
    reg_test_plain: reg("reg_test", "Test plain register"),
  },
  exclude: {},
};
const swap = { "covered.json": SYN_COVERED, "aux-sources.json": SYN_AUX };
// Registered after the JSON hook, so it runs first (the last registered hook runs first).
hookJsonImports();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.includes("/worker/src/")) {
      const file = url.slice(url.lastIndexOf("/") + 1);
      if (Object.hasOwn(swap, file)) return { format: "module", source: `export default ${JSON.stringify(swap[file])};`, shortCircuit: true };
      if (file === "rubric.generated.js") {
        const text = readFileSync(fileURLToPath(url), "utf8").replace(/^export const MATCH = .*$/m, `export const MATCH = ${JSON.stringify(SYN_MATCH)};`);
        return { format: "module", source: text, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});
const { feedFields, ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { isBodyRecordSource, isRegisterSource } = await import("../worker/src/records.js");
const { feedText } = await import("../worker/src/excerpt.js");
const { enrich } = await import("../worker/src/excerpt.js");
const { AUX_TEXT_PICK_SQL } = await import("../worker/src/aux-text.js");

// A record body of about `n` characters, every field on its own line, as a register prints it.
function recordBody(n) {
  const lines = [
    "Test early termination granted 03/02/2026 (posted 2026-03-04T15:00:00Z).",
    "Acquiring party: Example Holdings LP. Acquired party: \"Tsaco Test Robotics, Inc.\"; acquired entities: Tsaco Test Robotics, Inc.",
    "Matched party: Tsaco Test Robotics, Inc. (via name), entity Tsaco.",
    "Early termination is granted only when the parties ask for it; most filings never appear here.",
  ];
  for (let k = 1; lines.join("\n").length < n - 60; k++) lines.push(`Record field ${k}: test value ${k}.`);
  lines.push("Source: test early termination notices API.");
  return lines.join("\n").slice(0, n);
}
const NOW = "2026-03-04T16:00:00.000Z";

test("Z1 isBodyRecordSource reads the aux flag; the flag is only ever opt-in", () => {
  assert.equal(isBodyRecordSource("legal_test_grants"), true);
  assert.equal(isBodyRecordSource("reg_test_plain"), false, "a register without the flag");
  assert.equal(isRegisterSource("reg_test_plain"), true);
  for (const k of ["tsa_news", "unknown_key", "", null, undefined, "__proto__", "constructor"]) assert.equal(isBodyRecordSource(k), false, String(k));
  assert.equal(isBodyRecordSource("x", { sources: { x: { body_record: "yes" } } }), false, "only true counts");
  assert.equal(isBodyRecordSource("x", { sources: { x: { body_record: true } } }), true, "the aux argument is for tests");
});

test("Z1 feedFields: a 400-character record body on the flagged source is the feed excerpt; on a register without the flag enrich would fetch the page", () => {
  const body = recordBody(400);
  assert.equal(body.length, 400);
  assert.equal(feedText(body, "[TSA] t").full, false, "under the 1,500-character feed rule");
  const flagged = feedFields({ source_key: "legal_test_grants", body, title: "[TSA] Test early termination granted 03/02/2026" }, { role: "program" }, NOW);
  assert.equal(flagged.status, "feed");
  assert.ok(flagged.excerpt && flagged.excerpt.length >= 200 && body.includes(flagged.excerpt.slice(0, 60)), "excerpt set from the body");
  assert.equal(flagged.at, NOW);
  assert.equal(flagged.source, null);
  const plain = feedFields({ source_key: "reg_test_plain", body, title: "[TSA] Test register card" }, { role: "program" }, NOW);
  assert.equal(plain.status, null, "not flagged: the page is fetched as before");
  assert.ok(plain.fallback, "the body is only the fallback");
});

test("Z1 feedFields: a 120-character body on the flagged source is still 'feed', excerpt = the body; a missing or blank body is final 'skipped_policy' (never fetched)", () => {
  const body = recordBody(120).trim();
  const f = feedFields({ source_key: "legal_test_grants", body: `  ${body}\n`, title: "[TSA] short" }, { role: "program" }, NOW);
  assert.deepEqual([f.status, f.excerpt, f.at], ["feed", body, NOW]);
  for (const b of ["", "   \n ", null, undefined, 42]) {
    const g = feedFields({ source_key: "legal_test_grants", body: b, title: "[TSA] x" }, { role: "program" }, NOW);
    assert.deepEqual([g.status, g.excerpt, g.at, g.source, g.fallback], ["skipped_policy", null, NOW, null, null], JSON.stringify(b));
    assert.equal(feedFields({ source_key: "reg_test_plain", body: b, title: "[TSA] x" }, { role: "program" }, NOW).status, null, `unflagged ${JSON.stringify(b)}`);
    assert.equal(feedFields({ body: b, title: "x" }, { role: null }, NOW).status, null, `no key ${JSON.stringify(b)}`);
  }
  const noBody = feedFields({ source_key: "legal_test_grants", title: "[TSA] x" }, { role: "program" }, NOW);
  assert.equal(noBody.status, "skipped_policy", "a row read without the body column");
  // The aux argument wins over the bundled catalog (tests only).
  assert.equal(feedFields({ source_key: "reg_test_plain", body, title: "x" }, { role: null }, NOW, { aux: { sources: { reg_test_plain: { body_record: true } } } }).status, "feed");
  // A full body follows the unchanged feed rule, flag or not.
  const long = recordBody(1800);
  for (const k of ["legal_test_grants", "reg_test_plain"]) assert.equal(feedFields({ source_key: k, body: long, title: "[TSA] x" }, { role: "program" }, NOW).status, "feed", k);
});

test("Z1 end to end: flagged rows are stored excerpt_status 'feed' on Coverage, and neither enrich nor the aux text pass picks them; the unflagged register row is fetched", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const at = new Date(Date.now() - 3_600_000).toISOString();
  insertNews(news, [
    { source_key: "legal_test_grants", title: "[TSA] Test early termination granted: \"Tsaco Test Robotics, Inc.\" acquired by Example Holdings LP", first_seen: at, url: "https://www.example.gov/notices#1-TSA", body: recordBody(400) },
    { source_key: "legal_test_grants", title: "[TSB] Test early termination granted: \"Tsbco Test Labs, Inc.\" acquiring Example Target LLC", first_seen: at, url: "https://www.example.gov/notices#2-TSB", body: recordBody(150) },
    { source_key: "reg_test_plain", title: "[TSA] Test register card", first_seen: at, url: "https://register.example.org/card/3", body: recordBody(400) },
  ]);
  const db = zenithDb();
  await ingest({ DB: db, NEWS: news });
  await ingestAux({ DB: db, NEWS: news });
  const rows = Object.fromEntries(db.rows("SELECT url, ticker, excerpt_status, excerpt FROM items WHERE url NOT LIKE '%earlier-poll'").map((r) => [r.url, { ...r }]));
  assert.deepEqual([rows["https://www.example.gov/notices#1-TSA"].ticker, rows["https://www.example.gov/notices#1-TSA"].excerpt_status], ["TSA", "feed"]);
  assert.deepEqual([rows["https://www.example.gov/notices#2-TSB"].ticker, rows["https://www.example.gov/notices#2-TSB"].excerpt_status], ["TSB", "feed"]);
  assert.equal(rows["https://www.example.gov/notices#2-TSB"].excerpt, recordBody(150).trim(), "a short record is kept whole");
  assert.equal(rows["https://register.example.org/card/3"].excerpt_status, null);
  // The enrich selection is excerpt_status IS NULL: run it with a stubbed fetch.
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("", { status: 404 }); };
  try { await enrich({ DB: db }); } finally { globalThis.fetch = real; }
  assert.ok(!calls.some((u) => u.includes("www.example.gov")), `no request for a body-record row: ${calls.join(", ")}`);
  assert.ok(calls.some((u) => u.startsWith("https://register.example.org/card/3")), "the unflagged register row is fetched as before");
  // The auxiliary text pass picks no flagged row either (aux rows, if any, carry status 'feed').
  const auxPicked = db.rows(AUX_TEXT_PICK_SQL.replaceAll("?1", `'${new Date().toISOString()}'`)).filter((r) => r.source_key === "legal_test_grants");
  assert.equal(auxPicked.length, 0);
  for (const t of ["incidents", "deliveries", "reports"]) assert.equal(db.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});

test("Z1 end to end, no body: read without NEWS's body column, a flagged row is stored final 'skipped_policy' and enrich makes no request for it; the unflagged row is fetched", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT"); // insertNews writes a body column; it is dropped below
  const at = new Date(Date.now() - 3_600_000).toISOString();
  insertNews(news, [
    { source_key: "legal_test_grants", title: "[TSA] Test early termination granted: \"Tsaco Test Robotics, Inc.\" acquired by Example Holdings LP", first_seen: at, url: "https://www.example.gov/notices#4-TSA" },
    { source_key: "reg_test_plain", title: "[TSA] Test register card", first_seen: at, url: "https://register.example.org/card/5" },
  ]);
  news.exec("ALTER TABLE items DROP COLUMN body"); // newsRows now reads without it (ingest.js newsHasBody)
  const db = zenithDb();
  await ingest({ DB: db, NEWS: news });
  await ingestAux({ DB: db, NEWS: news });
  const rows = Object.fromEntries(db.rows("SELECT url, ticker, excerpt_status, excerpt, excerpt_at FROM items").map((r) => [r.url, { ...r }]));
  const flagged = rows["https://www.example.gov/notices#4-TSA"];
  assert.deepEqual([flagged.ticker, flagged.excerpt_status, flagged.excerpt], ["TSA", "skipped_policy", null]);
  assert.ok(flagged.excerpt_at, "final: excerpt_at is set, so an admin reset without retry_failed leaves it");
  assert.equal(rows["https://register.example.org/card/5"].excerpt_status, null);
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("", { status: 404 }); };
  try { await enrich({ DB: db }); } finally { globalThis.fetch = real; }
  assert.ok(!calls.some((u) => u.includes("www.example.gov")), `no request for a body-record row: ${calls.join(", ")}`);
  assert.ok(calls.some((u) => u.startsWith("https://register.example.org/card/5")), "the unflagged register row is fetched as before");
  const auxPicked = db.rows(AUX_TEXT_PICK_SQL.replaceAll("?1", `'${new Date().toISOString()}'`)).filter((r) => r.source_key === "legal_test_grants");
  assert.equal(auxPicked.length, 0);
  for (const t of ["incidents", "deliveries", "reports"]) assert.equal(db.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});
