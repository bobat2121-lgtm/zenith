// Regenerates worker/src/covered.json from news-monitor's runtime lane policy,
// so zenith-core grades exactly the sources news-monitor polls in the covered
// (8-minute) lane.  Usage: node scripts/sync-covered.mjs <path-to-news-monitor-repo>
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: node scripts/sync-covered.mjs <news-monitor-repo>");
  process.exit(2);
}
const { SOURCES } = await import(pathToFileURL(join(repo, "src", "sources.js")).href);
// priority.js mutates SOURCES in place (lanes, covered tickers) when imported.
await import(pathToFileURL(join(repo, "src", "priority.js")).href);

const sources = {};
for (const s of SOURCES) {
  if (s.lane === "covered" && s.coveredTicker) sources[s.key] = s.coveredTicker;
}
const tickers = [...new Set(Object.values(sources))].sort();

// Counterparty sources (customers, partners, programs, rivals, index providers):
// role and the covered tickers each one affects, from src/counterparty-sources.js.
const counterparty = {};
const cpPath = join(repo, "src", "counterparty-sources.js");
const { COUNTERPARTY_SOURCES = [], COUNTERPARTY_EXISTING = {} } = await import(pathToFileURL(cpPath).href).catch(() => ({}));
const polled = new Set(SOURCES.map((s) => s.key));
for (const s of [...COUNTERPARTY_SOURCES, ...Object.entries(COUNTERPARTY_EXISTING).map(([key, v]) => ({ key, ...v }))]) {
  const affects = (s.affects || []).filter((t) => tickers.includes(t));
  if (!affects.length || !polled.has(s.key) || sources[s.key]) continue;
  counterparty[s.key] = { role: s.role, affects };
}
const out = {
  generated_from: "news-monitor src/priority.js (lane=covered) and src/counterparty-sources.js",
  tickers, sources, counterparty,
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", "src", "covered.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(sources).length} sources for ${tickers.length} tickers and ${Object.keys(counterparty).length} counterparty sources -> ${target}`);
