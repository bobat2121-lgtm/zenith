// Phase 5 P5-ZR: the media role (outlet feeds about the covered companies).
// sync-covered.mjs keeps role "media", marks the outlet adapters as filters and
// writes covered.json media_accounts; ingest.js's media gate (routeCp) keeps an
// outlet row on Coverage only when it is tagged [T] or names T's own name or a
// program-kind key account of T. Synthetic only (ticker AAA, keys outlet_x*):
// the Worker modules load a synthetic covered.json, aux-sources.json and MATCH
// through a loader hook; the bundled catalog is read only for an invariant.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";
import { insertNews } from "./helpers/aux-e2e.js";
import { buildCovered, buildAux, buildChannels, buildMediaAccounts, ROLES, FILTER_ADAPTERS } from "../scripts/sync-covered.mjs";

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "worker", "src");

const SYN_MATCH = {
  AAA: { terms: ["Acme Robotics", "Gadget"], accounts: ["Big Customer", "Program X"] },
  BBB: { terms: ["Bravo Works"], accounts: [] },
};
const SYN_NAMES = { AAA: ["Acme Robotics, Inc."], BBB: ["Bravo Works Holdings"] };
const SYN_PROGRAMS = { AAA: ["Program X"] };
const SYN_COVERED = {
  tickers: ["AAA", "BBB"], sources: { aaa_news: "AAA" },
  counterparty: { outlet_x: { role: "media", affects: ["AAA"] } },
  records: [], channels: {}, media_accounts: SYN_PROGRAMS,
};
const SYN_AUX = {
  sources: { outlet_x: { entity: "outlet_x", name: "Outlet X", status: "media", lane: "strategic_noncompany", coverage_subject: true, affects: ["AAA"] } },
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
        const text = readFileSync(fileURLToPath(url), "utf8")
          .replace(/^export const MATCH = .*$/m, `export const MATCH = ${JSON.stringify(SYN_MATCH)};`)
          .replace(/^export const COVERED_NAMES = .*$/m, `export const COVERED_NAMES = ${JSON.stringify(SYN_NAMES)};`);
        return { format: "module", source: text, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});
const { mediaMatch, routeCp, routeFor, routeRow, coverageOwner, ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { routeCounterparty } = await import("../worker/src/lib.js");
const { rarityClass } = await import("../worker/src/rarity.js");
const { textClass } = await import("../worker/src/text-class.js");

const OUTLET_ADAPTERS = ["outlet_feed", "ctech_tag", "outlet_sitemap"];
const LIST = [
  { key: "own_aaa", lane: "covered", covered: true, coveredTicker: "AAA", adapter: "rss", endpoint: "https://aaa.example.com/feed" },
  { key: "own_bbb", lane: "covered", covered: true, coveredTicker: "BBB" },
  ...OUTLET_ADAPTERS.map((adapter, i) => ({ key: `outlet_x${i}`, lane: "strategic_noncompany", adapter, endpoint: `https://outlet${i}.example.com/feed`,
    name: `Outlet ${i}`, noncompanyCadence: "hourly", role: "media", affects: ["AAA", "ZZZ"] })),
  { key: "company_feed", lane: "public_adjacent", adapter: "rss", endpoint: "https://news.example.org/rss", name: "Company Feed" },
];

// --- Z-M1 ---------------------------------------------------------------------
test("Z-M1 buildCovered keeps role media with covered affects; an uncovered ticker is dropped with the existing warning", () => {
  assert.ok(ROLES.includes("media"));
  const covered = buildCovered(LIST);
  for (let i = 0; i < OUTLET_ADAPTERS.length; i++) assert.deepEqual(covered.counterparty[`outlet_x${i}`], { role: "media", affects: ["AAA"] });
  assert.ok(covered.warnings.includes("outlet_x0: affects ZZZ not covered"));
});

// --- Z-M2 ---------------------------------------------------------------------
test("Z-M2 buildAux: an outlet adapter key with role media is coverage_subject with its affects and status media", () => {
  const covered = buildCovered(LIST);
  // A peers status never overrides media.
  const { sources } = buildAux(LIST, covered, [{ key: "outlet_x0", name: "Outlet Zero", status: "private" }]);
  for (let i = 0; i < OUTLET_ADAPTERS.length; i++) {
    assert.ok(FILTER_ADAPTERS.includes(OUTLET_ADAPTERS[i]), OUTLET_ADAPTERS[i]);
    const a = sources[`outlet_x${i}`];
    assert.equal(a.status, "media", `outlet_x${i}`);
    assert.equal(a.coverage_subject, true);
    assert.deepEqual(a.affects, ["AAA"]);
    assert.equal(a.tag_affects, undefined, "a media key carries no tag_affects");
  }
  assert.equal(sources.company_feed.status, "public");
});

// --- Z-M3 ---------------------------------------------------------------------
test("Z-M3 buildChannels omits the three outlet adapters and keeps a plain rss key", () => {
  const channels = buildChannels(LIST);
  for (let i = 0; i < OUTLET_ADAPTERS.length; i++) assert.ok(!(`outlet_x${i}` in channels), `outlet_x${i}`);
  assert.equal(channels.company_feed, "example.org");
  assert.equal(channels.own_aaa, "example.com");
});

// --- Z-M4 ---------------------------------------------------------------------
test("Z-M4 with injected maps, a media row's rarityClass is original and its textClass press", () => {
  const covered = { ...buildCovered(LIST), channels: buildChannels(LIST) };
  const aux = buildAux(LIST, covered, []);
  for (let i = 0; i < OUTLET_ADAPTERS.length; i++) {
    const row = { source_key: `outlet_x${i}`, url: `https://outlet${i}.example.com/2026/11/a-story` };
    assert.equal(rarityClass(row, { covered, aux }), "original", row.source_key);
    assert.equal(textClass(row, { covered }), "press", row.source_key);
  }
});

// --- Z-M5 ---------------------------------------------------------------------
test("Z-M5 routeCp: the media gate on injected maps", () => {
  const media = mediaMatch(SYN_MATCH, SYN_NAMES, SYN_PROGRAMS);
  assert.deepEqual(media.AAA, { terms: ["Acme Robotics"], accounts: ["Program X"] }, "suffix stripped; program accounts only");
  assert.deepEqual(media.BBB, { terms: ["Bravo Works"], accounts: [] }, "Holdings stripped");
  const cp = { role: "media", affects: ["AAA"] };
  const r = (title) => routeCp(title, cp, SYN_MATCH, media);
  // (a) the company's own name
  assert.deepEqual(r("Acme Robotics opens a plant"), { ticker: "AAA", role: "media", affects: "AAA", skip: null });
  // (b) a program-kind key account
  assert.equal(r("Program X picks a vendor").skip, null);
  // (c) only a customer account: off Coverage, role media
  assert.deepEqual(r("Big Customer expands its fleet"), { ticker: "AAA", role: "media", affects: "AAA", skip: "rival_no_key_account" });
  // (d) only a generic product term
  assert.equal(r("the new gadget is here").skip, "rival_no_key_account");
  // (e) tagged with no name
  assert.deepEqual(r("[AAA] a story with no name"), { ticker: "AAA", role: "media", affects: "AAA", skip: null });
  // (f) a tag outside affects, no name
  assert.equal(r("[ZZZ] a story with no name").skip, "rival_no_key_account");
  // (g) every other role: byte-identical to routeCounterparty
  for (const role of ["rival", "customer", "relationship", "program", "index_event"]) {
    for (const title of ["Acme Robotics opens a plant", "Big Customer expands", "the new gadget", "[AAA] x", "[ZZZ] x", ""]) {
      const other = { role, affects: ["AAA", "BBB"] };
      assert.deepEqual(routeCp(title, other, SYN_MATCH, media), routeCounterparty(title, other, SYN_MATCH), `${role}: ${title}`);
      assert.deepEqual(routeFor({ title }, other, SYN_MATCH, media), routeCounterparty(title, other, SYN_MATCH), `routeFor ${role}: ${title}`);
    }
  }
  assert.equal(routeCp("x", { role: "media", affects: ["ZZZ"] }, SYN_MATCH, media), null, "no routable ticker");
});

test("Z-M5 the default media map is built from the loaded MATCH, COVERED_NAMES and covered.json media_accounts", () => {
  assert.deepEqual(mediaMatch(), mediaMatch(SYN_MATCH, SYN_NAMES, SYN_PROGRAMS));
  assert.equal(routeRow({ source_key: "outlet_x", title: "Program X picks a vendor" }).skip, null);
  assert.deepEqual(coverageOwner({ source_key: "outlet_x", title: "Big Customer expands" }), { owns: false, dropped: "rival_no_key_account", affects: ["AAA"] });
  assert.deepEqual(coverageOwner({ source_key: "outlet_x", title: "[AAA] a story" }), { owns: true });
});

// --- Z-M6 ---------------------------------------------------------------------
test("Z-M6 end to end: a kept media row is on Coverage with role media only; a gated row is a skipped stub plus a coverage_subject aux row", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const at = new Date(Date.now() - 3_600_000).toISOString();
  insertNews(news, [
    { source_key: "outlet_x", title: "Acme Robotics opens a plant", first_seen: at, url: "https://example.com/m/1" },
    { source_key: "outlet_x", title: "Big Customer expands its fleet", first_seen: at, url: "https://example.com/m/2" },
  ]);
  const db = zenithDb();
  await ingest({ DB: db, NEWS: news });
  await ingestAux({ DB: db, NEWS: news });
  const cov = Object.fromEntries(db.rows("SELECT url, ticker, role, skip_reason, state FROM items WHERE url LIKE 'https://example.com/m/%'").map((r) => [r.url, { ...r }]));
  assert.deepEqual([cov["https://example.com/m/1"].ticker, cov["https://example.com/m/1"].role, cov["https://example.com/m/1"].skip_reason], ["AAA", "media", null]);
  assert.deepEqual([cov["https://example.com/m/2"].role, cov["https://example.com/m/2"].skip_reason, cov["https://example.com/m/2"].state], ["media", "rival_no_key_account", "skipped"]);
  const aux = db.rows("SELECT url, coverage_subject, affects, state FROM aux_items WHERE url LIKE 'https://example.com/m/%'").map((r) => ({ ...r }));
  assert.deepEqual(aux, [{ url: "https://example.com/m/2", coverage_subject: 1, affects: "AAA", state: "pending" }]);
  for (const t of ["incidents", "deliveries", "reports"]) assert.equal(db.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});

// --- Z-M7 ---------------------------------------------------------------------
test("Z-M7 routeFor: tag narrowing for a tag_affects cp, the media gate for a media cp; a media key never has tag_affects in the bundled catalog", () => {
  const media = mediaMatch(SYN_MATCH, SYN_NAMES, SYN_PROGRAMS);
  const title = "[AAA] Bravo Works and a gadget";
  const tagged = routeFor({ title }, { role: "relationship", affects: ["AAA", "BBB"], tag_affects: true }, SYN_MATCH, media);
  assert.deepEqual(tagged, { ticker: "AAA", role: "relationship", affects: "AAA", skip: null }, "narrowed to the tag: BBB's name cannot win");
  const gated = routeFor({ title }, { role: "media", affects: ["AAA", "BBB"] }, SYN_MATCH, media);
  assert.deepEqual(gated, { ticker: "BBB", role: "media", affects: "AAA,BBB", skip: null }, "the media gate: the name wins, the tag admits");
  assert.equal(routeFor({ title: "a gadget" }, { role: "media", affects: ["AAA"] }, SYN_MATCH, media).skip, "rival_no_key_account");
  const bundled = JSON.parse(readFileSync(join(SRC, "covered.json"), "utf8"));
  for (const [key, entry] of Object.entries(bundled.counterparty || {})) {
    if (entry.role === "media") assert.notEqual(entry.tag_affects, true, key);
  }
});

// --- Z-S0 ---------------------------------------------------------------------
test("Z-S0 media_accounts: only program-kind terms of covered tickers, each list sorted; an empty map is valid", () => {
  const keyAccounts = {
    _about: "text",
    company_names: { AAA: ["Acme"] },
    BBB: [{ name: "Zeta Program", kind: "program", terms: ["Zeta Program", "ZP"] }, { name: "Big Buyer", kind: "customer", terms: ["Big Buyer"] }],
    AAA: [
      { name: "Program Y", kind: "program", terms: ["Program Y", "Alpha Initiative"] },
      { name: "Big Customer", kind: "customer", terms: ["Big Customer"] },
      { name: "Program Y again", kind: "program", terms: ["Program Y"] },
      { name: "Partner Co", kind: "partner", terms: ["Partner Co"] },
    ],
    CCC: [{ name: "Uncovered Program", kind: "program", terms: ["Uncovered Program"] }],
  };
  assert.deepEqual(buildMediaAccounts(keyAccounts, ["AAA", "BBB"]), { AAA: ["Alpha Initiative", "Program Y"], BBB: ["Zeta Program"] });
  assert.deepEqual(Object.keys(buildMediaAccounts(keyAccounts, ["BBB", "AAA"])), ["AAA", "BBB"], "tickers in key order");
  assert.deepEqual(buildMediaAccounts({}, ["AAA"]), {});
  assert.deepEqual(buildMediaAccounts(null, []), {});
});

test("Z-S0 the bundled covered.json media_accounts is current with rubric/key-accounts.json", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundled = JSON.parse(readFileSync(join(SRC, "covered.json"), "utf8"));
  const keyAccounts = JSON.parse(readFileSync(join(root, "rubric", "key-accounts.json"), "utf8"));
  assert.deepEqual(bundled.media_accounts, buildMediaAccounts(keyAccounts, bundled.tickers),
    "rubric/key-accounts.json changed: run node scripts/sync-covered.mjs <news-monitor tree>");
});
