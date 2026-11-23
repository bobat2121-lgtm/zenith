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
//
// Also writes worker/src/aux-sources.json: every other polled company or program
// source (auxiliary names, graded on their own page) with its entity, display
// name and status, and the ops sources left out of both. Counterparty filters
// built to watch a covered company (co-mention searches, FPDS feeds, Drone
// Dominance) are auxiliary too, marked coverage_subject with the covered
// tickers they affect: the grader names the outside company each item is about,
// and an item only about a covered company stays on the Coverage page. Not
// "aux.json": AUX is a reserved Windows device name and Git for Windows
// cannot add a file named aux.<anything>.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
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

// Ops sources: news-monitor's own health probes, site-structure checks and the
// SEC trigger. Never news about a company.
export const OPS_ADAPTERS = ["probe", "site_structure", "edgar_latest"];
// Counterparty adapters that filter a third-party feed down to items about a
// covered company (keyword RSS, contract and docket searches, lists). Their
// items are graded on the Coverage page and are also coverage_subject
// auxiliary entries; any other adapter is the outside company's own channel
// and a plain auxiliary name.
export const FILTER_ADAPTERS = [
  "rss_filtered", "rss_body_filter", "fpds_atom", "legistar_matters", "wargov_contract_paragraphs",
  "js_list_diff", "js_announcements", "safetyact_awards", "regulations_gov", "federal_register", "csv_filter",
];
const LANE_STATUS = { public_adjacent: "public", private_adjacent: "private" };
const COMPANY_STATUS = ["public", "private"];

// "fort_robotics" -> "Fort Robotics".
export function humanize(key) {
  return String(key ?? "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// The source name before its " — ", " – ", " - " or ": " qualifier
// ("May Mobility — news", "HEO (HEO Robotics): non-Earth imaging deals").
export function shortName(name) {
  return String(name ?? "").split(/ [—–-] |: /)[0].trim();
}

// Program and search names for coverage-subject sources whose own name is the
// covered company's: the FPDS award feeds share one program entity, and a
// covered ticker's co-mention search (aglt_rel) is "<company> partner mentions".
export const FPDS = { entity: "fpds", name: "FPDS contracts" };
const COMENTION_KEY = /^([a-z]+)_rel$/;
// "Agility Robotics (AGLT)" -> "Agility Robotics".
const withoutTicker = (name) => name.replace(/\s*\([A-Z.]{1,6}\)\s*$/, "").trim();

// sources: news-monitor's SOURCES after priority.js ran. covered: buildCovered's
// result. peers: rubric/peers.json. Returns { sources, exclude } for aux-sources.json.
export function buildAux(sourceList, covered, peers = []) {
  const coveredKeys = new Set(Object.keys(covered?.sources || {}));
  const counterparty = covered?.counterparty || {};
  const tickers = new Set((covered?.tickers || []).map((t) => String(t).toLowerCase()));
  const exclude = {};
  const aux = new Map();
  // Coverage-subject sources (counterparty filters built to watch a covered
  // company) -> the covered tickers they affect.
  const subject = new Map();
  for (const s of sourceList) {
    const key = s.key;
    if (!key || coveredKeys.has(key) || aux.has(key) || exclude[key]) continue;   // S1
    if (s.lane === "strategic_trigger_noncompany" || OPS_ADAPTERS.includes(s.adapter) || /^(probe|site)_/.test(key)) {
      exclude[key] = "ops";                                                        // S2
      continue;
    }
    if (counterparty[key]) {                                                       // S3
      const channel = !FILTER_ADAPTERS.includes(s.adapter);
      const namesCovered = key.split("_").some((t) => tickers.has(t));
      if (!channel || namesCovered) subject.set(key, [...counterparty[key].affects]);
    }
    aux.set(key, s);                                                               // S4
  }
  const peerByKey = new Map(peers.filter((p) => p?.key).map((p) => [p.key, p]));
  // A company or program source never takes its entity from a coverage-subject
  // source; a coverage-subject source may (dronedominance_lists -> dronedominance).
  const plainKeys = [...aux.keys()].filter((k) => !subject.has(k));
  const entityOf = (key) => {
    if (peerByKey.has(key)) return key;
    if (subject.has(key) && aux.get(key).adapter === "fpds_atom") return FPDS.entity;
    // The longest peers key or other auxiliary source key that prefixes this
    // one: maymobility_news -> maymobility, einride_sec -> einride. A prefix that
    // is itself a source resolves to its own entity.
    let best = null;
    for (const k of [...peerByKey.keys(), ...(subject.has(key) ? aux.keys() : plainKeys)]) {
      if (k !== key && key.startsWith(k + "_") && (!best || k.length > best.length)) best = k;
    }
    if (!best) return key;
    return peerByKey.has(best) ? best : entityOf(best);
  };
  const sources = {};
  for (const key of [...aux.keys()].sort()) {
    const s = aux.get(key);
    const entity = entityOf(key);
    const peer = peerByKey.get(entity);
    // The entity's own source names it when peers.json does not (verkada_updates
    // takes Verkada's name, not "Verkada Product Updates").
    const named = aux.get(entity) || s;
    const name = peer?.name || programName(entity, named, tickers) || shortName(named.name) || humanize(entity);
    const status = COMPANY_STATUS.includes(peer?.status) ? peer.status
      : COMPANY_STATUS.includes(s.companyStatus) ? s.companyStatus
      : LANE_STATUS[s.lane] || "program";
    sources[key] = { entity, name, status, lane: s.lane };
    if (subject.has(key)) Object.assign(sources[key], { coverage_subject: true, affects: subject.get(key) });
  }
  const sortedExclude = Object.fromEntries(Object.keys(exclude).sort().map((k) => [k, exclude[k]]));
  return { sources, exclude: sortedExclude };
}

// The FPDS program, or a covered ticker's co-mention search; else null.
function programName(entity, named, tickers) {
  if (entity === FPDS.entity) return FPDS.name;
  const m = COMENTION_KEY.exec(named.key || "");
  const company = m && tickers.has(m[1]) ? withoutTicker(shortName(named.name)) : "";
  return company ? `${company} partner mentions` : null;
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

  const peersPath = join(root, "rubric", "peers.json");
  const peers = existsSync(peersPath) ? JSON.parse(readFileSync(peersPath, "utf8")) : [];
  const aux = buildAux(SOURCES, { tickers, sources, counterparty }, peers);
  const auxOut = {
    generated_from: "news-monitor SOURCES after src/priority.js (every polled source outside covered.json sources), with entity names and statuses from rubric/peers.json",
    ...aux,
  };
  const auxTarget = join(root, "worker", "src", "aux-sources.json");
  writeFileSync(auxTarget, JSON.stringify(auxOut, null, 2) + "\n");
  const count = (values) => values.reduce((m, v) => ({ ...m, [v]: (m[v] || 0) + 1 }), {});
  const fmt = (m) => Object.entries(m).map(([k, n]) => `${k} ${n}`).join(", ");
  const entries = Object.values(aux.sources);
  const subject = entries.filter((e) => e.coverage_subject).length;
  console.log(`wrote ${entries.length} auxiliary sources for ${new Set(entries.map((e) => e.entity)).size} entities (${fmt(count(entries.map((e) => e.status)))}; ${subject} coverage_subject) and ${Object.keys(aux.exclude).length} exclusions (${fmt(count(Object.values(aux.exclude)))}) -> ${auxTarget}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.argv[2];
  if (!repo) {
    console.error("usage: node scripts/sync-covered.mjs <news-monitor-repo>");
    process.exit(2);
  }
  await main(repo);
}
