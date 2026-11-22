// Regenerates worker/src/covered.json from news-monitor's runtime source list,
// so zenith-core grades exactly the covered companies' sources news-monitor
// polls, and routes counterparty sources to the covered tickers they affect.
//   Usage: node scripts/sync-covered.mjs <path-to-news-monitor-repo>
//
// Covered sources: every source priority.js puts in the covered lane, and any
// source that declares coveredTicker (covered sources on a slower cadence,
// e.g. hourly deck and IR-event feeds, keep that field).
// Counterparty sources: every source that declares role and affects (any
// source file), plus the hand-maintained COUNTERPARTY_EXISTING routing for
// sources that predate those fields.
import { writeFileSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

export const ROLES = ["relationship", "customer", "program", "rival", "index_event"];
const upper = (t) => String(t ?? "").trim().toUpperCase();
const tickerList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(upper).filter(Boolean);

// sources: news-monitor's SOURCES after priority.js ran. existing: { key: { role, affects } }.
// Returns { tickers, sources, counterparty, warnings }.
export function buildCovered(sourceList, { counterpartySources = [], existing = {} } = {}) {
  const warnings = [];
  const sources = {};
  for (const s of sourceList) {
    const t = upper(s.coveredTicker);
    if (t && (s.lane === "covered" || s.covered === true || s.coveredTicker)) sources[s.key] = t;
  }
  const tickers = [...new Set(Object.values(sources))].sort();
  const polled = new Set(sourceList.map((s) => s.key));
  // Declared on the source itself first; COUNTERPARTY_SOURCES rows and the
  // existing-source routing fill in what a source does not declare.
  const decl = new Map();
  const add = (key, role, affects, from) => {
    if (!key || (role == null && affects == null)) return;
    const d = decl.get(key) || { role: null, affects: [], from: [] };
    d.role ||= role ? String(role) : null;
    d.affects = [...new Set([...d.affects, ...tickerList(affects)])];
    d.from.push(from);
    decl.set(key, d);
  };
  for (const s of sourceList) add(s.key, s.role, s.affects, "source");
  for (const s of counterpartySources) add(s.key, s.role, s.affects, "counterparty-sources");
  for (const [key, v] of Object.entries(existing || {})) add(key, v?.role, v?.affects, "counterparty-existing");
  const counterparty = {};
  for (const [key, d] of decl) {
    if (sources[key]) continue;                       // a covered company's own source
    if (!polled.has(key)) { warnings.push(`${key}: declares role/affects but is not a polled source`); continue; }
    if (!ROLES.includes(d.role)) { warnings.push(`${key}: role ${d.role ?? "(none)"} is not one of ${ROLES.join(", ")}`); continue; }
    const affects = d.affects.filter((t) => tickers.includes(t));
    const dropped = d.affects.filter((t) => !tickers.includes(t));
    if (dropped.length) warnings.push(`${key}: affects ${dropped.join(", ")} not covered`);
    if (!affects.length) continue;
    counterparty[key] = { role: d.role, affects };
  }
  return { tickers, sources, counterparty, warnings };
}

async function main(repo) {
  const { SOURCES } = await import(pathToFileURL(join(repo, "src", "sources.js")).href);
  // priority.js mutates SOURCES in place (lanes, covered tickers) and registers
  // every stream's source files when imported.
  await import(pathToFileURL(join(repo, "src", "priority.js")).href);
  const cpPath = join(repo, "src", "counterparty-sources.js");
  const { COUNTERPARTY_SOURCES = [], COUNTERPARTY_EXISTING = {} } = existsSync(cpPath)
    ? await import(pathToFileURL(cpPath).href).catch(() => ({})) : {};
  const { tickers, sources, counterparty, warnings } = buildCovered(SOURCES, { counterpartySources: COUNTERPARTY_SOURCES, existing: COUNTERPARTY_EXISTING });
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const t of tickers) if (!existsSync(join(root, "rubric", "companies", `${t}.md`))) warnings.push(`${t}: covered but has no rubric/companies/${t}.md sheet`);
  const out = {
    generated_from: "news-monitor src/priority.js (covered lane and coveredTicker sources) and role/affects on every source (plus src/counterparty-existing.js)",
    tickers, sources, counterparty,
  };
  const target = join(root, "worker", "src", "covered.json");
  writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log(`wrote ${Object.keys(sources).length} sources for ${tickers.length} tickers and ${Object.keys(counterparty).length} counterparty sources -> ${target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.argv[2];
  if (!repo) {
    console.error("usage: node scripts/sync-covered.mjs <news-monitor-repo>");
    process.exit(2);
  }
  await main(repo);
}
