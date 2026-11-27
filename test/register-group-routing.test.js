// Phase 4 Part B (Z-B2, Z-B3): group routing for the group-routed registers
// (worker/src/records.js groupAffects, isGroupRouted; worker/src/ingest.js
// groupRoute, routeFor) and their story keys (worker/src/story.js). The Worker
// modules load a synthetic catalog: keys, group entities, tickers, names,
// titles and URLs below are all synthetic (prog_test_*, TST/TSU/TSV, example).
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";
import { insertNews } from "./helpers/aux-e2e.js";

// --- The synthetic catalog -----------------------------------------------------
const AFFECTS = ["TST", "TSU", "TSV"];
const SYN_MATCH = { TST: { terms: ["Testco"], accounts: [] }, TSU: { terms: ["Tsuco"], accounts: [] }, TSV: { terms: ["Tsvco"], accounts: [] } };
const GROUPS = {
  prog_test_alpha: { name: "Test alpha policy", affects: ["TST", "TSU"], from: "mirror_alpha" },
  prog_test_second: { name: "Test second policy", affects: ["TSV"], from: "mirror_second" },
  prog_test_gamma: { name: "Test gamma policy", affects: ["ZZZ"], from: "mirror_gamma" },
};
const SYN_COVERED = {
  tickers: AFFECTS, sources: { tst_news: "TST" },
  counterparty: {
    reviews_test: { role: "program", affects: AFFECTS, group_routed: true },
    plain_test: { role: "program", affects: AFFECTS },
  },
  records: [], channels: {}, media_accounts: {},
};
const reg = (entity, name) => ({ entity, name, status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: AFFECTS, record: true, register: true });
const SYN_AUX = {
  sources: {
    reviews_test: { ...reg("oira", "OIRA regulatory review"), group_routed: true },
    plain_test: { entity: "plain_test", name: "Plain test", status: "program", lane: "strategic_noncompany", coverage_subject: true, affects: AFFECTS },
    other_register: reg("other_register", "Other register"),
  },
  exclude: {},
  register_groups: GROUPS,
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
const { groupRoute, routeFor, routeRow, coverageOwner, ingest } = await import("../worker/src/ingest.js");
const { ingestAux } = await import("../worker/src/auxiliary.js");
const { groupAffects, isGroupRouted, isRegisterSource } = await import("../worker/src/records.js");
const { routeCounterparty } = await import("../worker/src/lib.js");
const { storyKeys, REGISTER_KEY } = await import("../worker/src/story.js");

const BASE = "https://reviews.example.gov/rule?id=TEST-0001";
const GROUPED = { role: "program", affects: AFFECTS, group_routed: true };

// --- groupAffects / isGroupRouted ----------------------------------------------
test("groupAffects reads the trailing g=<entity> fragment after #, & or -; an unknown group, a mid-URL or malformed fragment is null; isGroupRouted reads the aux flag", () => {
  assert.deepEqual(groupAffects(`${BASE}#review-2026-01-02-concluded-g=prog_test_alpha`), { entity: "prog_test_alpha", name: "Test alpha policy", affects: ["TST", "TSU"], from: "mirror_alpha" });
  assert.equal(groupAffects(`${BASE}#baseline-g=prog_test_second`).entity, "prog_test_second");
  assert.equal(groupAffects("https://reports.example.gov/feed.xml#p3-g=prog_test_alpha").entity, "prog_test_alpha");
  assert.equal(groupAffects(`${BASE}#x&g=prog_test_second`).entity, "prog_test_second");
  for (const url of [BASE, `${BASE}#baseline-g=prog_test_unknown`, `${BASE}#g=prog_test_alpha-more`, `${BASE}#xg=prog_test_alpha`,
    `${BASE}#x-g=Prog_Test_Alpha`, `${BASE}#x-g=ab`, null, undefined, ""]) assert.equal(groupAffects(url), null, String(url));
  assert.equal(groupAffects(`${BASE}#x-g=prog_test_alpha`, { sources: {} }), null, "a catalog without register_groups knows no group");
  const g = groupAffects(`${BASE}#x-g=prog_test_alpha`);
  g.affects.push("XXX");
  assert.deepEqual(groupAffects(`${BASE}#x-g=prog_test_alpha`).affects, ["TST", "TSU"], "a copy: callers cannot change the catalog");
  assert.equal(isGroupRouted("reviews_test"), true);
  for (const k of ["plain_test", "other_register", "unknown_key", null]) assert.equal(isGroupRouted(k), false, String(k));
  assert.equal(isGroupRouted("x", { sources: { x: { group_routed: true } } }), true, "aux is injectable");
});

// --- Z-B2 ------------------------------------------------------------------------
test("Z-B2 group routing: a known group narrows affects to the group's tickers (ticker = the group's first, or a ticker whose company the title names); an unknown group keeps all of them; a source without the flag is unchanged", () => {
  const title = "[Alpha policy] Review concluded: a test rule";
  const a = routeFor({ title, url: `${BASE}#x-g=prog_test_alpha` }, GROUPED, SYN_MATCH);
  assert.deepEqual(a, { ticker: "TST", role: "program", affects: "TST,TSU", skip: null });
  const named = routeFor({ title: `${title} on Tsuco`, url: `${BASE}#x-g=prog_test_alpha` }, GROUPED, SYN_MATCH);
  assert.deepEqual(named, { ticker: "TSU", role: "program", affects: "TST,TSU", skip: null }, "the title names TSU's company term");
  const outside = routeFor({ title: `${title} on Tsvco`, url: `${BASE}#x-g=prog_test_alpha` }, GROUPED, SYN_MATCH);
  assert.deepEqual(outside, { ticker: "TST", role: "program", affects: "TST,TSU", skip: null }, "a ticker outside the group cannot take the row");
  assert.deepEqual(routeFor({ title, url: `${BASE}#baseline-g=prog_test_second` }, GROUPED, SYN_MATCH),
    { ticker: "TSV", role: "program", affects: "TSV", skip: null });
  // Unknown or missing group, or a group none of whose tickers the source affects: today's routing, all three.
  const union = routeCounterparty(title, GROUPED, SYN_MATCH);
  assert.deepEqual(union, { ticker: "TST", role: "program", affects: "TST,TSU,TSV", skip: null });
  for (const url of [`${BASE}#x-g=prog_test_unknown`, BASE, `${BASE}#x-g=prog_test_gamma`]) {
    assert.deepEqual(routeFor({ title, url }, GROUPED, SYN_MATCH), union, url);
    assert.equal(groupRoute({ title, url }, GROUPED, SYN_MATCH), null, url);
  }
  // Only the source's own affects are routable: a group wider than the source is cut to it.
  assert.deepEqual(routeFor({ title, url: `${BASE}#x-g=prog_test_alpha` }, { ...GROUPED, affects: ["TSU", "TSV"] }, SYN_MATCH),
    { ticker: "TSU", role: "program", affects: "TSU", skip: null });
  // No flag: the fragment is ignored, routing byte-identical to routeCounterparty.
  const plain = { role: "program", affects: AFFECTS };
  for (const t of [title, `${title} on Tsuco`]) {
    assert.deepEqual(routeFor({ title: t, url: `${BASE}#x-g=prog_test_alpha` }, plain, SYN_MATCH), routeCounterparty(t, plain, SYN_MATCH), t);
  }
  // routeRow and coverageOwner use the bundled (here synthetic) catalog.
  assert.deepEqual(routeRow({ source_key: "reviews_test", title, url: `${BASE}#x-g=prog_test_alpha` }), a);
  assert.deepEqual(routeRow({ source_key: "plain_test", title, url: `${BASE}#x-g=prog_test_alpha` }), union);
  assert.deepEqual(coverageOwner({ source_key: "reviews_test", title, url: `${BASE}#x-g=prog_test_second` }), { owns: true });
});

test("routeFor order: group routing first, then tag narrowing, then the media gate (a key carries at most one flag; this cp carries two only to show the order)", () => {
  const both = { role: "program", affects: AFFECTS, group_routed: true, tag_affects: true };
  const title = "[TSV] Tsuco news";
  assert.deepEqual(routeFor({ title, url: `${BASE}#x-g=prog_test_alpha` }, both, SYN_MATCH),
    { ticker: "TSU", role: "program", affects: "TST,TSU", skip: null }, "a known group wins over the tag");
  assert.deepEqual(routeFor({ title, url: BASE }, both, SYN_MATCH),
    { ticker: "TSV", role: "program", affects: "TSV", skip: null }, "no known group: the tag narrows");
  const media = { role: "media", affects: AFFECTS, group_routed: true };
  assert.equal(routeFor({ title: "a gadget", url: `${BASE}#x-g=prog_test_alpha` }, media, SYN_MATCH).skip, null, "a known group is routed before the media gate");
  assert.equal(routeFor({ title: "a gadget", url: BASE }, media, SYN_MATCH, { TST: { terms: [], accounts: [] } }).role, "media", "no group: the media gate");
});

test("Z-B2 end to end: group-routed register cards are stored on Coverage under their group's tickers, unknown groups under all of them and counted; nothing on Auxiliary; no Discord rows", async () => {
  const news = newsDb();
  news.exec("ALTER TABLE items ADD COLUMN body TEXT");
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const row = (title, frag) => ({ source_key: "reviews_test", title, first_seen: at, url: `${BASE}${frag}`, seed: true });
  insertNews(news, [
    row("[Alpha policy] Review concluded: test rule one", "#r1-concluded-g=prog_test_alpha"),
    row("[Alpha policy] Review concluded: test rule two for Tsuco", "#r2-concluded-g=prog_test_alpha"),
    row("[Second policy] Review baseline as of 01/02/2026", "#baseline-g=prog_test_second"),
    row("[Unknown policy] Review concluded: test rule three", "#r3-concluded-g=prog_test_unknown"),
    { source_key: "plain_test", title: "Plain test news", first_seen: at, url: "https://feed.example.com/plain/1#x-g=prog_test_alpha", seed: true },
  ]);
  const db = zenithDb();
  const res = await ingest({ DB: db, NEWS: news });
  assert.equal(res.group_unknown, 1, "only the group-routed row with an unknown group is counted");
  await ingestAux({ DB: db, NEWS: news });
  const cov = Object.fromEntries(db.rows("SELECT url, ticker, role, affects, state, skip_reason FROM items")
    .map((r) => [r.url.split("#")[1] || r.url, [r.ticker, r.role, r.affects, r.state, r.skip_reason]]));
  assert.deepEqual(cov["r1-concluded-g=prog_test_alpha"], ["TST", "program", "TST,TSU", "pending", null]);
  assert.deepEqual(cov["r2-concluded-g=prog_test_alpha"], ["TSU", "program", "TST,TSU", "pending", null]);
  assert.deepEqual(cov["baseline-g=prog_test_second"], ["TSV", "program", "TSV", "pending", null]);
  assert.deepEqual(cov["r3-concluded-g=prog_test_unknown"], ["TST", "program", "TST,TSU,TSV", "pending", null], "unknown group: the source's union");
  assert.deepEqual(cov["x-g=prog_test_alpha"], ["TST", "program", "TST,TSU,TSV", "pending", null], "no flag: the fragment means nothing");
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM aux_items WHERE source_key = 'reviews_test'")[0].n, 0, "Coverage owns every card");
  for (const t of ["incidents", "deliveries", "reports"]) assert.equal(db.rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});

// --- Z-B3 ------------------------------------------------------------------------
test("Z-B3 no story copies: two aux rows of one register URL differing only in fragment both get url_key null, for any catalog register (not only REGISTER_KEY prefixes); a non-register key keeps its url_key", async () => {
  for (const key of ["reviews_test", "other_register"]) {
    assert.equal(REGISTER_KEY.test(key), false, `${key} is not a REGISTER_KEY prefix`);
    assert.equal(isRegisterSource(key), true, key);
    const a = await storyKeys({ source_key: key, entity_key: "oira", title: "[Alpha policy] first card", url: `${BASE}#p1-g=prog_test_alpha` }, "aux");
    const b = await storyKeys({ source_key: key, entity_key: "oira", title: "[Alpha policy] second card", url: `${BASE}#p2-g=prog_test_alpha` }, "aux");
    assert.equal(a.url_key, null, key);
    assert.equal(b.url_key, null, key);
  }
  const plain = await storyKeys({ source_key: "plain_test", entity_key: "plain_test", title: "Plain test news", url: `${BASE}#p1-g=prog_test_alpha` }, "aux");
  assert.match(plain.url_key, /^u:[0-9a-f]{16}$/, "a non-register source is unchanged");
  const txdmv = await storyKeys({ source_key: "txdmv_test", entity_key: "txdmv_av", title: "t", url: BASE }, "aux");
  assert.equal(txdmv.url_key, null, "REGISTER_KEY still applies by key");
  const cov = await storyKeys({ source_key: "reviews_test", ticker: "TST", title: "[Alpha policy] card", url: `${BASE}#p1-g=prog_test_alpha` }, "coverage");
  assert.equal(cov.url_key, null, "coverage rows never get a url_key");
});
