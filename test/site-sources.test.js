// scripts/site-sources.mjs: the site-structure watchers and egress probes that
// sync-covered.mjs writes into worker/src/site-sources.json, with the covered
// ticker each one watches and the probes' short labels.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSiteSources, probeLabel } from "../scripts/site-sources.mjs";

const SOURCES = [
  { key: "kodiak", lane: "covered", adapter: "rss", coveredTicker: "KDK", name: "Kodiak" },
  { key: "site_kodiak", lane: "strategic_noncompany", adapter: "site_structure", name: "Kodiak — site structure (kodiak.ai)",
    config: { kind: "sitewatch", domain: "kodiak.ai", ticker: "KDK", label: "KDK Kodiak (kodiak.ai)" } },
  { key: "site_maymobility", lane: "strategic_noncompany", adapter: "site_structure", name: "May Mobility — site structure (maymobility.com)",
    config: { kind: "sitewatch", domain: "maymobility.com", label: "May Mobility (maymobility.com)" } },
  { key: "site_gone", lane: "strategic_noncompany", adapter: "site_structure", name: "Dropped — site structure (gone.example)",
    config: { kind: "sitewatch", domain: "gone.example", ticker: "SSTI" } },
  { key: "probe_sym_ir_events_rss", adapter: "probe", config: { kind: "probe", ticker: "SYM" } },
  { key: "probe_sym_ir_events_page", adapter: "probe", config: { kind: "probe", ticker: "SYM" } },
  { key: "probe_gnw_bot_www", adapter: "probe", config: { kind: "probe", ticker: "BOT" } },
  { key: "probe_pi_sitemap", adapter: "probe", config: { kind: "probe" } },
  { key: "edgar_latest", lane: "strategic_trigger_noncompany", adapter: "edgar_latest" },
  { key: "anduril", lane: "private_adjacent", adapter: "rss" },
];

test("probe labels drop the probe/ir/rss tokens and the ticker's own token", () => {
  assert.equal(probeLabel("probe_sym_ir_events_rss", "SYM"), "SYM events");
  assert.equal(probeLabel("probe_sym_ir_events_page", "SYM"), "SYM events page");
  assert.equal(probeLabel("probe_kdk_ir_news_rss", "kdk"), "KDK news");
  assert.equal(probeLabel("probe_gnw_bot_www", "BOT"), "BOT gnw www");
  assert.equal(probeLabel("probe_pi_sitemap", null), "pi sitemap");
  assert.equal(probeLabel("probe_ir_rss", null), "probe_ir_rss");
});

test("site watchers and probes map to covered tickers only", () => {
  const { sites, probes } = buildSiteSources(SOURCES, ["KDK", "SYM", "BOT"]);
  assert.deepEqual(Object.keys(sites), ["site_gone", "site_kodiak", "site_maymobility"]);
  assert.deepEqual(sites.site_kodiak, { ticker: "KDK", domain: "kodiak.ai", label: "KDK Kodiak (kodiak.ai)" });
  assert.deepEqual(sites.site_maymobility, { ticker: null, domain: "maymobility.com", label: "May Mobility (maymobility.com)" });
  assert.equal(sites.site_gone.ticker, null, "a ticker that is no longer covered maps to none");
  assert.equal(sites.site_gone.label, "Dropped — site structure (gone.example)");
  assert.deepEqual(probes, {
    probe_gnw_bot_www: { ticker: "BOT", label: "BOT gnw www" },
    probe_pi_sitemap: { ticker: null, label: "pi sitemap" },
    probe_sym_ir_events_page: { ticker: "SYM", label: "SYM events page" },
    probe_sym_ir_events_rss: { ticker: "SYM", label: "SYM events" },
  });
  const uncovered = buildSiteSources(SOURCES, []);
  assert.equal(uncovered.probes.probe_sym_ir_events_rss.ticker, null);
  assert.equal(uncovered.probes.probe_sym_ir_events_rss.label, "SYM events", "the label still names the declared ticker");
});
