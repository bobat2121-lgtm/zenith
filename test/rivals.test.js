// registry/rivals.json: sources news-monitor already polls, declared rivals of
// a covered ticker in Zenith (scripts/sync-covered.mjs buildCovered's rivals
// option). The committed list is checked against the generated covered.json
// and its basis in the public rubric; then a rival row runs end to end through
// both ingests on a synthetic covered map.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const RIVALS = json("../registry/rivals.json");
const COVERED = json("../worker/src/covered.json");
const AUX = json("../worker/src/aux-sources.json");
const PEERS = json("../rubric/peers.json");
const keysOf = (list) => list.map((e) => (typeof e === "string" ? e : e.key));

test("every listed key is a rival of its ticker in the generated covered.json; six names have two or more, SPAI is listed empty", () => {
  for (const [ticker, list] of Object.entries(RIVALS)) {
    assert.ok(COVERED.tickers.includes(ticker), `${ticker} is covered`);
    for (const key of keysOf(list)) {
      const cp = COVERED.counterparty[key];
      assert.ok(cp, `${key} is in covered.json counterparty`);
      assert.equal(cp.role, "rival", key);
      assert.ok(cp.affects.includes(ticker), `${key} affects ${ticker}`);
    }
  }
  for (const t of ["ONDS", "PUSA", "SERV", "ASST", "MSTR", "GRRR"]) assert.ok(keysOf(RIVALS[t] || []).length >= 2, t);
  assert.deepEqual(RIVALS.SPAI, [], "no source names a SPAI rival yet");
  const listed = new Set(Object.values(RIVALS).flatMap(keysOf));
  // teledyne is a Bing search; motorola's titles are not usable yet.
  for (const key of ["teledyne", "motorola"]) assert.ok(!listed.has(key), key);
  // anduril stays out until the test suite's plain-auxiliary fixture is
  // re-keyed (decision O10): many tests expect it to be a plain auxiliary name.
  assert.ok(!listed.has("anduril"));
  assert.equal(COVERED.counterparty.anduril, undefined);
});

test("basis: each listed key has a '-' or '±' read-through to its ticker in peers.json; GRRR's are named in its sheet's competitor section", () => {
  const peerOf = new Map(PEERS.map((p) => [p.key, p]));
  const sheet = readFileSync(new URL("../rubric/companies/GRRR.md", import.meta.url), "utf8");
  const competitors = (sheet.split(/^## /m).find((s) => /^Competitors/.test(s)) || "");
  assert.ok(competitors, "GRRR.md has a competitor section");
  for (const [ticker, list] of Object.entries(RIVALS)) {
    for (const key of keysOf(list)) {
      // A source's peers entry is its auxiliary entity's (an SEC feed shares its company's).
      const entity = AUX.sources[key]?.entity || key;
      if (ticker === "GRRR") {
        const name = String(AUX.sources[key]?.name || "").split(/[ (]/)[0];
        assert.ok(name && competitors.includes(name), `${key}: ${name} in GRRR.md competitors`);
        continue;
      }
      const reads = peerOf.get(entity)?.reads_through || [];
      assert.ok(reads.some((r) => r.ticker === ticker && (r.direction === "-" || r.direction === "±")), `${key} (${entity}) reads through to ${ticker}`);
    }
  }
});

// End to end on a synthetic covered map: the real covered.json plus a rival
// source rivx for ONDS. Registered after hookJsonImports, so this hook runs first.
const COVERED_URL = new URL("../worker/src/covered.json", import.meta.url).href;
hookJsonImports();
registerHooks({
  load(url, context, nextLoad) {
    if (url === COVERED_URL && !context.importAttributes?.type) {
      const covered = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
      covered.counterparty = { ...covered.counterparty, rivx: { role: "rival", affects: ["ONDS"] } };
      return { format: "module", source: `export default ${JSON.stringify(covered)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { ingest } = await import("../worker/src/ingest.js");
const { ingestAux, AUX_CS_DONE } = await import("../worker/src/auxiliary.js");
const { MATCH } = await import("../worker/src/rubric.generated.js");

test("a rival row naming no ONDS term is a skipped Coverage stub and a coverage-subject aux row; one naming an ONDS key account is graded on Coverage only; neither is admitted", async () => {
  const account = (MATCH.ONDS.accounts || []).find((a) => typeof a === "string" && a.trim().length >= 3);
  assert.ok(account, "ONDS has a key account term");
  const news = newsDb();
  const db = zenithDb();
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  let n = 0;
  const ins = (title, first_seen) => news.db.prepare(
    "INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES ('rivx', ?, ?, ?, NULL, ?, 1)",
  ).run(`https://rivx.example/news/${++n}`, title, first_seen, first_seen);
  // The source's first poll, already behind both cursors: the rows below are not seed rows.
  ins("Rivx Labs launches its website", iso(5 * 86_400_000));
  const passed = String(news.db.prepare("SELECT MAX(rowid) AS m FROM items").get().m);
  for (const [key, value] of [["nm_cursor", passed], ["aux_nm_cursor", passed], ["aux_cs_cursor", AUX_CS_DONE], ["aux_rv_cursor", AUX_CS_DONE]]) {
    db.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }
  ins("Rivx Labs opens a test range in a quiet valley", iso(60_000));
  ins(`Rivx Labs signs a supply deal with ${account}`, iso(30_000));

  await ingest({ DB: db, NEWS: news });
  await ingestAux({ DB: db, NEWS: news });
  const items = db.rows("SELECT title, ticker, state, skip_reason, role, affects, admit FROM items ORDER BY id").map((r) => ({ ...r }));
  const aux = db.rows("SELECT title, state, coverage_subject, affects, admit FROM aux_items ORDER BY id").map((r) => ({ ...r }));
  assert.deepEqual(items, [
    { title: "Rivx Labs opens a test range in a quiet valley", ticker: "ONDS", state: "skipped", skip_reason: "rival_no_key_account", role: "rival", affects: "ONDS", admit: null },
    { title: `Rivx Labs signs a supply deal with ${account}`, ticker: "ONDS", state: "pending", skip_reason: null, role: "rival", affects: "ONDS", admit: null },
  ]);
  assert.deepEqual(aux, [
    { title: "Rivx Labs opens a test range in a quiet valley", state: "pending", coverage_subject: 1, affects: "ONDS", admit: null },
  ], "only the dropped row is stored on Auxiliary");
});
