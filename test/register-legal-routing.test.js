// Phase 4 Part D (Z2): the legal registers (early terminations, bid protests)
// are tag_affects keys, so a row is routed by its title's leading "[T]" tag
// (worker/src/ingest.js tagRoute, routeFor; the one mechanism P5-ZR carries,
// reused unchanged) and a party or agency named in the title can never move it
// to another ticker. Z2 plus the Z-W1..Z-W3 cases on register-shaped titles.
// The Worker modules load a synthetic catalog: keys, tickers, names, numbers,
// titles and URLs below are all made up (legal_test_*, TSA/TSB/TSC, example).
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";
import { insertNews } from "./helpers/aux-e2e.js";

// --- The synthetic catalog -----------------------------------------------------
const AFFECTS = ["TSA", "TSB", "TSC"];
// "Example Agency Lab" is a TSB key account and "Example Electric SE" a TSC key account.
const SYN_MATCH = {
  TSA: { terms: ["Tsaco"], accounts: [] },
  TSB: { terms: ["Tsbco"], accounts: ["Example Agency Lab"] },
  TSC: { terms: ["Tscco"], accounts: ["Example Electric SE"] },
};
const LEGAL = { role: "program", affects: AFFECTS, tag_affects: true };
const PLAIN = { role: "program", affects: AFFECTS };
const SYN_COVERED = {
  tickers: AFFECTS, sources: { tsa_news: "TSA" },
  counterparty: { legal_test_grants: LEGAL, legal_test_protests: LEGAL, legal_test_plain: PLAIN },
  records: [], channels: {}, media_accounts: {},
};
const reg = (name, flags = {}) => ({ entity: "legal_test", name, status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: AFFECTS, record: true, register: true, ...flags });
const SYN_AUX = {
  sources: {
    legal_test_grants: reg("Test early terminations", { tag_affects: true, body_record: true }),
    legal_test_protests: reg("Test bid protests", { tag_affects: true, body_record: true }),
    legal_test_plain: reg("Test plain register"),
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
const { routeFor, routeRow, coverageOwner, ingest, TAG_OUTSIDE } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { routeCounterparty } = await import("../worker/src/lib.js");

// Register-shaped titles: only the matched party is quoted; the agency or the
// other party is unquoted (news-monitor's lane rule for tag_affects keys).
const PROTEST = "[TSA] Test bid protest T-101.1 filed 03/02/2026: protester \"Tst Drones, Inc.\"; Example Agency Lab (decision due 06/10/2026)";
const GRANT = "[TSA] Test early termination granted 03/02/2026: \"Tst Robotics, Inc.\" acquired by Example Electric SE (transaction 1001)";

// --- Z2 -------------------------------------------------------------------------
test("Z2 the leading tag decides: an agency that is another ticker's key account, or an acquirer that is one, cannot move the row", () => {
  assert.deepEqual(routeFor({ title: PROTEST }, LEGAL, SYN_MATCH), { ticker: "TSA", role: "program", affects: "TSA", skip: null });
  assert.deepEqual(routeFor({ title: GRANT }, LEGAL, SYN_MATCH), { ticker: "TSA", role: "program", affects: "TSA", skip: null });
  assert.deepEqual(routeRow({ source_key: "legal_test_protests", title: PROTEST }), { ticker: "TSA", role: "program", affects: "TSA", skip: null });
  assert.deepEqual(routeRow({ source_key: "legal_test_grants", title: GRANT }), { ticker: "TSA", role: "program", affects: "TSA", skip: null });
});

test("Z2 without tag_affects the same titles route by the key account named (today's behaviour, the mis-route the flag fixes)", () => {
  assert.equal(routeFor({ title: PROTEST }, PLAIN, SYN_MATCH).ticker, "TSB");
  assert.equal(routeFor({ title: GRANT }, PLAIN, SYN_MATCH).ticker, "TSC");
  for (const title of [PROTEST, GRANT]) {
    assert.deepEqual(routeFor({ title }, PLAIN, SYN_MATCH), routeCounterparty(title, PLAIN, SYN_MATCH), "unchanged: routeCounterparty");
    assert.deepEqual(routeRow({ source_key: "legal_test_plain", title }), routeCounterparty(title, PLAIN, SYN_MATCH));
  }
});

// --- Z-W1 shape -------------------------------------------------------------------
test("Z-W1 on register titles: affects narrow to the tag; another ticker's company term cannot win; a two-ticker tag keeps both and the term picks among them", () => {
  const named = "[TSB] Test early termination granted 03/02/2026: \"Tsbco Test Labs, Inc.\" acquiring Tsaco Example Unit LLC (transaction 1002)";
  assert.deepEqual(routeFor({ title: named }, LEGAL, SYN_MATCH), { ticker: "TSB", role: "program", affects: "TSB", skip: null });
  assert.equal(routeFor({ title: named }, PLAIN, SYN_MATCH).ticker, "TSA", "without the flag the first term in affects order wins");
  const both = "[TSA/TSC] Test bid protest T-102.1 filed 03/03/2026: protester \"Tscco Test Systems, LLC\"; Example Agency Lab";
  assert.deepEqual(routeFor({ title: both }, LEGAL, SYN_MATCH), { ticker: "TSC", role: "program", affects: "TSA,TSC", skip: null });
  assert.deepEqual(coverageOwner({ source_key: "legal_test_protests", title: both }), { owns: true });
});

// --- Z-W2 shape -------------------------------------------------------------------
test("Z-W2 on register titles: the tag is stripped before matching, so it is never a term; a program row is never skipped for want of a key account", () => {
  const match = { ...SYN_MATCH, TSA: { terms: ["TSA", "Tsaco"], accounts: [] } };
  const t = "[TSA] Test bid protest T-103.1 filed 03/04/2026: protester \"Tst Field Services, Inc.\"; Example Agency Lab";
  assert.deepEqual(routeFor({ title: t }, LEGAL, match), { ticker: "TSA", role: "program", affects: "TSA", skip: null });
  const tagOnly = "[TSB] Test early termination granted 03/04/2026: \"Tst Holdings, Inc.\" acquired by Example Fund LP (transaction 1003)";
  assert.deepEqual(routeFor({ title: tagOnly }, LEGAL, match), { ticker: "TSB", role: "program", affects: "TSB", skip: null }, "the tag's own ticker, with no term or account named");
});

// --- Z-W3 shape -------------------------------------------------------------------
test("Z-W3 on register titles: a tag outside affects, no tag, or an empty tag is stored skipped tag_outside_affects; Coverage owns it; only the first leading group is read", () => {
  for (const title of [
    "[ZZZ] Test early termination granted 03/02/2026: \"Tsaco Robotics, Inc.\" acquired by Example Fund LP (transaction 1004)",
    "Test bid protest T-104.1 filed 03/02/2026: protester \"Tsaco Robotics, Inc.\"; Example Agency Lab",
    "[] Test bid protest T-105.1 filed 03/02/2026",
    "[ZZZ] [TSA] Test early termination granted 03/02/2026 (transaction 1005)",
  ]) {
    assert.deepEqual(routeFor({ title }, LEGAL, SYN_MATCH), { ticker: "TSA", role: "program", affects: "TSA,TSB,TSC", skip: TAG_OUTSIDE }, title);
    assert.deepEqual(coverageOwner({ source_key: "legal_test_grants", title }), { owns: true }, title);
  }
});

test("Z2/Z-W3 end to end: Coverage stores each row under its tag with the tagged affects (or skipped tag_outside_affects); Auxiliary stores none; no Discord rows", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const row = (source_key, title, n) => ({ source_key, title, first_seen: at, url: `https://www.example.gov/legal/${n}#${n}-T`, body: `${title}\nSource: test register.` });
  insertNews(news, [
    row("legal_test_protests", PROTEST, 1),
    row("legal_test_grants", GRANT, 2),
    row("legal_test_grants", "[ZZZ] Test early termination granted 03/02/2026: \"Tsaco Robotics, Inc.\" acquired by Example Fund LP (transaction 1004)", 3),
    row("legal_test_plain", PROTEST, 4),
  ]);
  const db = zenithDb();
  await ingest({ DB: db, NEWS: news });
  await ingestAux({ DB: db, NEWS: news });
  const cov = Object.fromEntries(db.rows("SELECT url, ticker, affects, skip_reason FROM items WHERE url LIKE 'https://www.example.gov/legal/%'")
    .map((r) => [r.url.split("/").pop().split("#")[0], [r.ticker, r.affects, r.skip_reason]]));
  assert.deepEqual(cov[1], ["TSA", "TSA", null]);
  assert.deepEqual(cov[2], ["TSA", "TSA", null]);
  assert.deepEqual(cov[3], ["TSA", "TSA,TSB,TSC", TAG_OUTSIDE]);
  assert.deepEqual(cov[4], ["TSB", "TSA,TSB,TSC", null], "the unflagged register keeps today's routing");
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items WHERE url LIKE 'https://www.example.gov/legal/%'")[0].n, 0);
  for (const t of ["incidents", "deliveries", "reports"]) assert.equal(db.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});
