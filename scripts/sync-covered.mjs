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
const out = { generated_from: "news-monitor src/priority.js (lane=covered)", tickers, sources };
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", "src", "covered.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(sources).length} sources for ${tickers.length} tickers -> ${target}`);
