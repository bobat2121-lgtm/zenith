// Phase 2: the text class (worker/src/text-class.js), which sets how much page
// text the reader keeps, and the Part A switches. Synthetic keys and .example
// hosts only; the channels map is injected.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports } from "./helpers/worker-env.js";
import { OFFICIAL_HOST_RE as SCRIPT_OFFICIAL_HOST_RE } from "../scripts/sync-covered.mjs";

hookJsonImports();
const TC = await import("../worker/src/text-class.js");
const { textClass, WIRE_SERVICES, TEXT_BUDGET, LEGACY_BUDGET, UNANCHORED_CHARS, NO_FETCH_HOSTS, visibleBudgets, noFetch, textSetting,
  auxTextPerTick, auxTextShown, auxTextPress, TEXT_CLASSES } = TC;
const { WIRE_HOSTS, isWireHost } = await import("../worker/src/rarity.js");
const { OFFICIAL_HOST_RE } = await import("../worker/src/records.js");

const covered = { tickers: [], sources: {}, counterparty: {}, records: [], channels: { acme_news: "acme.example" } };
const cls = (source_key, url) => textClass({ source_key, url }, { covered });

test("A12: record for an edgar_* key, any www.sec.gov URL, a .gov, a war.gov and a .gov.uk URL", () => {
  assert.deepEqual(TEXT_CLASSES, ["record", "wire", "issuer", "press"]);
  assert.equal(cls("edgar_synco", "https://news.example/a"), "record", "edgar_* key");
  assert.equal(cls("acme_news", "https://www.sec.gov/Archives/edgar/data/1/000000000000000001/x.htm"), "record", "a sec.gov URL from any key");
  assert.equal(cls("acme_news", "https://www.agency.gov/news/1"), "record", ".gov host");
  assert.equal(cls("some_search", "https://www.war.gov/News/Contracts/1/"), "record", "war.gov host");
  assert.equal(cls("some_search", "https://www.ministry.gov.uk/news/1"), "record", ".gov.uk host");
  assert.equal(cls("some_search", "https://town.legistar.com/Matter.aspx?ID=1"), "record", "a register host");
});

test("A13: issuer on the source's own channel; the same source elsewhere is press; runtime company keys are issuer, industry media press", () => {
  assert.equal(cls("acme_news", "https://ir.acme.example/news/1"), "issuer", "a subdomain of the channel");
  assert.equal(cls("acme_news", "https://acme.example/news/1"), "issuer", "the channel itself");
  assert.equal(cls("acme_news", "https://portal.example/acme-story"), "press", "an aggregator copy under a company-named source");
  assert.equal(cls("managed_acme_news", "https://portal.example/x"), "issuer", "managed_* is the company's own channel");
  assert.equal(cls("ia_acme", "https://portal.example/x"), "issuer", "ia_<x> is the company's own channel");
  assert.equal(cls("ia_media_robots", "https://tradepress.example/x"), "press", "ia_media_* is industry media");
  assert.equal(cls("some_search", "https://tradepress.example/x"), "press", "a key with no channel");
  assert.equal(cls("", "not a url"), "press");
  assert.equal(textClass(null, { covered }), "press");
  assert.equal(textClass({ source_key: "acme_news", url: "https://ir.acme.example/x" }, { covered: {} }), "press", "no channels map: no issuer by host");
});

test("A14: a newswire URL is wire; WIRE_SERVICES is a subset of rarity.js WIRE_HOSTS; OFFICIAL_HOST_RE is the records.js export (equal to the script's)", () => {
  assert.equal(cls("acme_news", "https://www.prnewswire.com/news-releases/x.html"), "wire");
  assert.equal(cls("some_search", "https://www.globenewswire.com/news-release/x"), "wire");
  assert.equal(WIRE_SERVICES.length, 8);
  for (const w of WIRE_SERVICES) {
    assert.ok(WIRE_HOSTS.includes(w), `${w} is in WIRE_HOSTS`);
    assert.ok(isWireHost(`www.${w}`));
  }
  assert.equal(OFFICIAL_HOST_RE.source, SCRIPT_OFFICIAL_HOST_RE.source);
  assert.equal(OFFICIAL_HOST_RE.flags, SCRIPT_OFFICIAL_HOST_RE.flags);
  // Imported, never copied: text-class.js defines no host regex of its own.
  const src = readFileSync(new URL("../worker/src/text-class.js", import.meta.url), "utf8");
  assert.match(src, /import \{[^}]*OFFICIAL_HOST_RE[^}]*\} from "\.\/records\.js"/);
  assert.doesNotMatch(src, /OFFICIAL_HOST_RE\s*=/);
});

test("budgets: legacy by default, class only with TEXT_BUDGETS=class; unanchored pages 2,500", () => {
  assert.deepEqual({ ...TEXT_BUDGET }, { record: 8000, issuer: 6000, wire: 6000, press: 2500 });
  assert.deepEqual({ ...LEGACY_BUDGET }, { record: 2500, issuer: 2500, wire: 2500, press: 2500 });
  assert.equal(UNANCHORED_CHARS, 2500);
  assert.equal(visibleBudgets({}), LEGACY_BUDGET);
  assert.equal(visibleBudgets(), LEGACY_BUDGET);
  assert.equal(visibleBudgets({ TEXT_BUDGETS: "legacy" }), LEGACY_BUDGET);
  assert.equal(visibleBudgets({ TEXT_BUDGETS: "yes" }), LEGACY_BUDGET);
  assert.equal(visibleBudgets({ TEXT_BUDGETS: "class" }), TEXT_BUDGET);
  assert.equal(visibleBudgets({ TEXT_BUDGETS: " Class " }), TEXT_BUDGET);
  assert.ok(Object.isFrozen(TEXT_BUDGET) && Object.isFrozen(LEGACY_BUDGET));
});

test("switches: AUX_TEXT_PER_TICK 4, AUX_TEXT_SHOW and AUX_TEXT_PRESS 0 by default; show needs the reader on", () => {
  assert.equal(textSetting(undefined, 4), 4);
  assert.equal(textSetting("", 4), 4);
  assert.equal(textSetting("7", 4), 7);
  assert.equal(textSetting("-1", 4), 4);
  assert.equal(textSetting("x", 4), 4);
  assert.equal(textSetting("2.9", 4), 2);
  assert.equal(auxTextPerTick({}), 4);
  assert.equal(auxTextPerTick({ AUX_TEXT_PER_TICK: "0" }), 0);
  assert.equal(auxTextShown({}), false);
  assert.equal(auxTextShown({ AUX_TEXT_SHOW: "1" }), true);
  assert.equal(auxTextShown({ AUX_TEXT_SHOW: "1", AUX_TEXT_PER_TICK: "0" }), false, "AUX_TEXT_PER_TICK=0 lifts the show path and its hold");
  assert.equal(auxTextPress({}), false);
  assert.equal(auxTextPress({ AUX_TEXT_PRESS: "1" }), true);
});

test("no-fetch list: reuters.com and its subdomains, for the aux reader", () => {
  assert.deepEqual(NO_FETCH_HOSTS, ["reuters.com"]);
  assert.equal(noFetch("https://www.reuters.com/business/x"), true);
  assert.equal(noFetch("https://reuters.com/x"), true);
  assert.equal(noFetch("https://notreuters.com/x"), false);
  assert.equal(noFetch("https://blocked.example/x", ["blocked.example"]), true);
  assert.equal(noFetch("not a url"), false);
});
