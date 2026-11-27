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
// sources that predate those fields, plus the rivals listed in
// registry/rivals.json. Channels: each source's own registrable domain
// (buildChannels).
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
//
// And worker/src/site-sources.json (scripts/site-sources.mjs): the site-structure
// watchers and egress probes with the covered ticker each one watches, for the
// Coverage page's Site changes and source-health strip.
//
// Phase 5 (behaviour keyed on the adapter and the flag; no key is named here):
// - tag_affects: a source whose config.tagAffects is true (its titles start
//   with the "[T]" tag of the tickers it is about, e.g. the wide-net drain
//   adapter discovery_drain) carries tag_affects: true on its counterparty
//   entry and on its auxiliary entry; zenith-core routes it by that tag
//   (worker/src/ingest.js tagRoute).
// - role "media": an outlet feed (outlet_feed, ctech_tag, outlet_sitemap) about
//   the covered companies. Its auxiliary entry has status media and is
//   coverage_subject; zenith-core keeps a row on Coverage only through the
//   media gate (ingest.js routeCp), which reads covered.json media_accounts:
//   per covered ticker, the terms of its program-kind key accounts
//   (rubric/key-accounts.json).
// Phase 4 Part D: a body-record register (BODY_RECORD_ADAPTERS) carries
//   body_record: true on its auxiliary entry; zenith-core keeps its item body
//   as the excerpt and never fetches the item URL (worker/src/ingest.js feedFields).
//   Usage: node scripts/sync-covered.mjs [--check] <path-to-news-monitor-repo>
//     --check   write nothing; exit 1 when a generated file on disk differs
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildSiteSources } from "./site-sources.mjs";
import { regDomain, hostOf } from "../worker/src/domain.js";

export const ROLES = ["relationship", "customer", "program", "rival", "index_event", "media"];
const upper = (t) => String(t ?? "").trim().toUpperCase();
const tickerList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(upper).filter(Boolean);

// Shadow sources (shadow: true; plans/round7-driver-coverage.md 4.7) run in
// news-monitor only, so their rows can be counted before anyone decides to
// grade them. They are never in covered.json, and aux-sources.json excludes them (an
// unknown key would otherwise be routed to the auxiliary pass by name).
export const shadowKeys = (sourceList) => new Set(sourceList.filter((s) => s?.shadow === true).map((s) => s.key));

// The host of a source's endpoint (or url), "" when it is not a URL.
const endpointHost = (s) => {
  try { return new URL(s?.endpoint || s?.url || "").hostname; } catch { return ""; }
};

// sources: news-monitor's SOURCES after priority.js ran. existing: { key: { role, affects } }.
// rivals: registry/rivals.json, { TICKER: [key or { key }, ...] }: sources
// news-monitor already polls, declared rivals of that ticker here in Zenith
// (news-monitor's own routing is unchanged). Applied after the other three
// declarations; a listed key that is not polled, is a covered company's own
// source, is a shadow source, is a Bing search or already holds another role
// is skipped with a warning and keeps its old entry.
// Returns { tickers, sources, counterparty, warnings }.
export function buildCovered(sourceList, { counterpartySources = [], existing = {}, rivals = {} } = {}) {
  const warnings = [];
  const shadow = shadowKeys(sourceList);
  for (const key of shadow) warnings.push(`${key}: shadow source (shadow: true), left out of covered.json and excluded in aux-sources.json`);
  sourceList = sourceList.filter((s) => !shadow.has(s.key));
  const sources = {};
  for (const s of sourceList) {
    const t = upper(s.coveredTicker);
    if (t && (s.lane === "covered" || s.covered === true || s.coveredTicker)) sources[s.key] = t;
  }
  const tickers = [...new Set(Object.values(sources))].sort();
  // Covered (own-lane) record sources, for zenith-core's records.js: the SEC
  // ones whose key does not start with edgar_ (unusual, strive_sec_northland).
  const records = sourceList.filter((s) => sources[s.key] && isRecordSource(s)).map((s) => s.key).sort();
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
  // Phase 5: config.tagAffects === true on the source definition.
  const tagAffects = new Set([...sourceList, ...counterpartySources].filter(isTagAffects).map((s) => s.key));
  for (const [key, v] of Object.entries(existing || {})) add(key, v?.role, v?.affects, "counterparty-existing");
  const byKey = new Map(sourceList.map((s) => [s.key, s]));
  for (const [ticker, list] of Object.entries(rivals || {})) {
    for (const entry of Array.isArray(list) ? list : []) {
      const key = typeof entry === "string" ? entry : entry?.key;
      if (!key) continue;
      const why = shadow.has(key) ? "is a shadow source"
        : !polled.has(key) ? "is not a polled source"
        : sources[key] ? "is a covered company's own source"
        : endpointHost(byKey.get(key)) === "www.bing.com" ? "is a Bing search"
        : decl.get(key)?.role && decl.get(key).role !== "rival" ? `already has role ${decl.get(key).role}`
        : null;
      if (why) { warnings.push(`${key}: registry/rivals.json lists it for ${upper(ticker)} but it ${why}; skipped`); continue; }
      add(key, "rival", [ticker], "rivals");
    }
  }
  const counterparty = {};
  for (const [key, d] of decl) {
    if (shadow.has(key)) continue;                    // warned once above
    if (sources[key]) continue;                       // a covered company's own source
    if (!polled.has(key)) { warnings.push(`${key}: declares role/affects but is not a polled source`); continue; }
    if (!ROLES.includes(d.role)) { warnings.push(`${key}: role ${d.role ?? "(none)"} is not one of ${ROLES.join(", ")}`); continue; }
    const affects = d.affects.filter((t) => tickers.includes(t));
    const dropped = d.affects.filter((t) => !tickers.includes(t));
    if (dropped.length) warnings.push(`${key}: affects ${dropped.join(", ")} not covered`);
    if (!affects.length) continue;
    counterparty[key] = { role: d.role, affects };
    if (tagAffects.has(key)) counterparty[key].tag_affects = true;
    if (isGroupRouted(byKey.get(key))) counterparty[key].group_routed = true;
  }
  return { tickers, sources, counterparty, records, warnings };
}

// Ops sources: news-monitor's own health probes, site-structure checks and the
// SEC trigger. Never news about a company.
export const OPS_ADAPTERS = ["probe", "site_structure", "edgar_latest"];
// SEC filing adapters: their auxiliary entries are marked sec, and zenith-core
// never mutes, demotes or suggests either for them (round 4 Z7), whatever the key.
export const SEC_ADAPTERS = ["edgar", "edgar_keyword"];
// Official records (Phase 0 gates): registers and government documents. They
// surface late by nature; on Coverage, zenith-core admits them past the 14-day
// stale gate when core.md section 8's late-record exception can apply
// (worker/src/records.js, lib.js arrivalGate), and Tuning never suggests
// muting or demoting them. A record source is an SEC filing adapter, a
// register adapter, or a strategic-lane source on a government host. Bing
// searches (www.bing.com) are never records.
// Register adapters (phase 2): news-monitor's register lane, each register
// read whole and matched locally on identifiers. Their auxiliary entries are
// marked register (worker/src/records.js isRegisterSource), so zenith-core
// holds their fresh rows inside the grading budget (lib.js arrivalGate
// 'register'). They are records and coverage-subject filters, and each
// register is one program entity, as the FPDS feeds are.
// Phase 4 (Part C): the FMCSA inspection and census registers, matched on
// carrier identifiers, share one program entity.
// Phase 4 (Part B): the OIRA review lists and the congressional committee
// reports, each its own program entity, both group-routed (below).
// Phase 4 (Part D): the FTC early-termination register, matched on exact legal
// names; its sources carry config.tagAffects (routed by tag, as above) and its
// bodies are the record itself (body_record, below). The GAO bid-protest docket
// walk, matched on the protester's exact legal name, likewise.
export const REGISTER_ADAPTERS = ["lda_registrations", "lda_reports", "txdmv_av_report", "fmcsa_inspections", "fmcsa_census", "oira_review", "govinfo_crpt", "ftc_hsr_et", "gao_docket_walk"];
export const REGISTERS = {
  lda_registrations: { entity: "lda", name: "LDA lobbying filings" },
  lda_reports: { entity: "lda", name: "LDA lobbying filings" },
  txdmv_av_report: { entity: "txdmv_av", name: "Texas DMV AV authorizations" },
  fmcsa_inspections: { entity: "fmcsa", name: "FMCSA inspection and census records" },
  fmcsa_census: { entity: "fmcsa", name: "FMCSA inspection and census records" },
  oira_review: { entity: "oira", name: "OIRA regulatory review" },
  govinfo_crpt: { entity: "govinfo_crpt", name: "Congressional committee reports" },
  ftc_hsr_et: { entity: "ftc_hsr", name: "FTC HSR early terminations" },
  gao_docket_walk: { entity: "gao_protests", name: "GAO bid protests" },
};
// Body-record registers (phase 4 Part D): each item body is the published
// record, every field as published, not a summary of a page. Their auxiliary
// entries carry body_record: true (worker/src/records.js isBodyRecordSource),
// so zenith-core keeps the body as the excerpt whatever its length and never
// fetches the item URL (worker/src/ingest.js feedFields).
export const BODY_RECORD_ADAPTERS = ["ftc_hsr_et", "gao_docket_walk"];
// Group-routed registers (phase 4 Part B): each card is about one topic group,
// a shared program entity named by its URL's trailing "g=<entity>" fragment,
// never about one ticker. Their counterparty and auxiliary entries carry
// group_routed: true, and aux-sources.json register_groups maps each group to
// the covered tickers it feeds: the affects of the news-monitor channel the
// group mirrors (news-monitor src/register-gov-watch.js GOV_GROUPS; only the
// entity, name and mirror key are read, never a term or a watched rule).
// zenith-core routes such a row among its group's tickers (worker/src/ingest.js
// routeFor, worker/src/records.js groupAffects).
export const GROUP_ROUTED_ADAPTERS = ["oira_review", "govinfo_crpt"];
export const isGroupRouted = (s) => GROUP_ROUTED_ADAPTERS.includes(s?.adapter);
// Phase 4 (Part C): legistar_fanout (one source over many council clients) is
// a record adapter and a filter, as legistar_matters is.
export const RECORD_ADAPTERS = ["fpds_atom", "legistar_matters", "legistar_fanout", "wargov_contract_paragraphs", "safetyact_awards", "regulations_gov", "federal_register", ...REGISTER_ADAPTERS];
export const OFFICIAL_HOST_RE = /(^|\.)(gov|mil)$|\.gov\.[a-z]{2}$|(^|\.)legistar\.com$|(^|\.)canada\.ca$|(^|\.)fmv\.se$/i;
const STRATEGIC_LANES = ["strategic_noncompany", "strategic_fast_noncompany"];
export function isRecordSource(s) {
  if (SEC_ADAPTERS.includes(s?.adapter) || RECORD_ADAPTERS.includes(s?.adapter)) return true;
  let host = "";
  try { host = new URL(s?.endpoint || s?.url || "").hostname; } catch {}
  return STRATEGIC_LANES.includes(s?.lane) && OFFICIAL_HOST_RE.test(host);
}
// Counterparty adapters that filter a third-party feed down to items about a
// covered company (keyword RSS, contract and docket searches, lists,
// registers matched on identifiers). Their
// items are graded on the Coverage page and are also coverage_subject
// auxiliary entries; any other adapter is the outside company's own channel
// and a plain auxiliary name.
// Phase 5: the wide-net drain (discovery_drain) and the outlet adapters
// (outlet_feed, ctech_tag, outlet_sitemap) filter a third-party stream too.
export const FILTER_ADAPTERS = [
  "rss_filtered", "rss_body_filter", "fpds_atom", "legistar_matters", "legistar_fanout", "wargov_contract_paragraphs",
  "js_list_diff", "js_announcements", "safetyact_awards", "regulations_gov", "federal_register", "csv_filter",
  ...REGISTER_ADAPTERS,
  "discovery_drain", "outlet_feed", "ctech_tag", "outlet_sitemap",
];
// A source routed by its title's leading tag (phase 5): config.tagAffects === true.
export const isTagAffects = (s) => s?.config?.tagAffects === true;
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

// aux-sources.json register_groups (phase 4 Part B): { <group entity>: { name,
// affects, from } }, entities sorted. groups: news-monitor's GOV_GROUPS (only
// entity, name or label, and mirror are read). affects: the mirror source's own
// affects, in its order, covered tickers only. A group whose mirror is not a
// polled source, or that feeds no covered ticker, is left out with a warning.
export function buildRegisterGroups(groups, sourceList, tickers, warnings = []) {
  const covered = new Set(tickers || []);
  const byKey = new Map((sourceList || []).map((s) => [s?.key, s]));
  const out = {};
  for (const g of Array.isArray(groups) ? groups : []) {
    const entity = String(g?.entity ?? "");
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(entity)) { warnings.push(`register group ${entity || "(none)"}: not a group entity key; skipped`); continue; }
    const mirror = byKey.get(g?.mirror);
    if (!mirror || mirror.shadow === true) { warnings.push(`register group ${entity}: mirror ${g?.mirror ?? "(none)"} is not a polled source; skipped`); continue; }
    const affects = [...new Set(tickerList(mirror.affects))].filter((t) => covered.has(t));
    if (!affects.length) { warnings.push(`register group ${entity}: mirror ${mirror.key} affects no covered ticker; skipped`); continue; }
    const name = String(g?.name || String(g?.label || "").replace(/^\[|\]$/g, "") || humanize(entity)).trim();
    out[entity] = { name, affects, from: mirror.key };
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// sources: news-monitor's SOURCES after priority.js ran. covered: buildCovered's
// result. peers: rubric/peers.json. groups: news-monitor's GOV_GROUPS (phase 4
// Part B). Returns { sources, exclude } for aux-sources.json, plus
// register_groups when there is at least one group.
export function buildAux(sourceList, covered, peers = [], { groups = [], warnings = [] } = {}) {
  const shadow = shadowKeys(sourceList);              // buildCovered already warned
  sourceList = sourceList.filter((s) => !shadow.has(s.key));
  const coveredKeys = new Set(Object.keys(covered?.sources || {}));
  const counterparty = covered?.counterparty || {};
  const tickers = new Set((covered?.tickers || []).map((t) => String(t).toLowerCase()));
  // A shadow key must be excluded, not just left out: auxRoute routes an
  // unknown key by name (its "not synced yet" fallback), which would store and
  // grade shadow rows in the auxiliary pass.
  const exclude = Object.fromEntries([...shadow].map((k) => [k, "shadow"]));
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
    if (subject.has(key) && Object.hasOwn(REGISTERS, aux.get(key).adapter)) return REGISTERS[aux.get(key).adapter].entity;
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
    const status = counterparty[key]?.role === "media" ? "media"
      : COMPANY_STATUS.includes(peer?.status) ? peer.status
      : COMPANY_STATUS.includes(s.companyStatus) ? s.companyStatus
      : LANE_STATUS[s.lane] || "program";
    sources[key] = { entity, name, status, lane: s.lane };
    if (subject.has(key)) Object.assign(sources[key], { coverage_subject: true, affects: subject.get(key) });
    if (SEC_ADAPTERS.includes(s.adapter)) sources[key].sec = true;
    if (isRecordSource(s)) sources[key].record = true;
    if (REGISTER_ADAPTERS.includes(s.adapter)) sources[key].register = true;
    // tag_affects (phase 5): a counterparty key's config.tagAffects, copied as on its counterparty entry.
    if (isTagAffects(s) && counterparty[key]) sources[key].tag_affects = true;
    // group_routed (phase 4 Part B): a group-routed register, as on its counterparty entry.
    if (isGroupRouted(s) && counterparty[key]) sources[key].group_routed = true;
    // body_record (phase 4 Part D): the item body is the record; never page-fetched.
    if (BODY_RECORD_ADAPTERS.includes(s.adapter)) sources[key].body_record = true;
  }
  const sortedExclude = Object.fromEntries(Object.keys(exclude).sort().map((k) => [k, exclude[k]]));
  const registerGroups = buildRegisterGroups(groups, sourceList, covered?.tickers, warnings);
  return Object.keys(registerGroups).length
    ? { sources, exclude: sortedExclude, register_groups: registerGroups }
    : { sources, exclude: sortedExclude };
}

// covered.json channels: each source's own channel, { key: registrable domain
// of its endpoint host }, so the Worker can tell a company's own page from a
// copy elsewhere. Left out: filter adapters (third-party feeds filtered for a
// company), ops sources, probe_* and site_* keys, Bing and Google searches,
// and sources with no endpoint URL. Keys sorted.
const SEARCH_DOMAINS = ["bing.com", "google.com"];
export function buildChannels(sourceList) {
  const out = {};
  for (const s of sourceList || []) {
    const key = s?.key;
    if (!key || /^(probe|site)_/.test(key)) continue;
    if (FILTER_ADAPTERS.includes(s.adapter) || OPS_ADAPTERS.includes(s.adapter)) continue;
    const domain = regDomain(hostOf(s.endpoint || s.url));
    if (!domain || SEARCH_DOMAINS.includes(domain)) continue;
    out[key] = domain;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// covered.json media_accounts (phase 5 media gate): { TICKER: [terms] } from
// rubric/key-accounts.json entries of kind "program", covered tickers only,
// each list sorted, tickers in key order. Terms under 3 characters are left
// out, as MATCH leaves them out. An empty map is valid.
export function buildMediaAccounts(keyAccounts, tickers) {
  const covered = new Set(tickers || []);
  const out = {};
  for (const t of Object.keys(keyAccounts || {}).filter((k) => covered.has(k)).sort()) {
    const list = Array.isArray(keyAccounts[t]) ? keyAccounts[t] : [];
    const terms = [...new Set(list.filter((e) => e?.kind === "program").flatMap((e) => (Array.isArray(e.terms) ? e.terms : []))
      .filter((x) => typeof x === "string" && x.trim().length >= 3).map((x) => x.trim()))].sort();
    if (terms.length) out[t] = terms;
  }
  return out;
}

// The FPDS program, a register, or a covered ticker's co-mention search; else null.
function programName(entity, named, tickers) {
  if (entity === FPDS.entity) return FPDS.name;
  const register = Object.values(REGISTERS).find((r) => r.entity === entity);
  if (register) return register.name;
  const m = COMENTION_KEY.exec(named.key || "");
  const company = m && tickers.has(m[1]) ? withoutTicker(shortName(named.name)) : "";
  return company ? `${company} partner mentions` : null;
}

async function main(repo, { check = false } = {}) {
  // --check: compare instead of writing (the drift test, test/widenet-routing.test.js Z-S3).
  const drift = [];
  const verb = check ? "checked" : "wrote";
  const emit = (target, text) => {
    if (!check) return writeFileSync(target, text);
    if (!existsSync(target) || readFileSync(target, "utf8") !== text) drift.push(target);
  };
  const { SOURCES } = await import(pathToFileURL(join(repo, "src", "sources.js")).href);
  // priority.js mutates SOURCES in place (lanes, covered tickers) and registers
  // every stream's source files when imported.
  await import(pathToFileURL(join(repo, "src", "priority.js")).href);
  const cpPath = join(repo, "src", "counterparty-sources.js");
  const { COUNTERPARTY_SOURCES = [], COUNTERPARTY_EXISTING = {} } = existsSync(cpPath)
    ? await import(pathToFileURL(cpPath).href).catch(() => ({})) : {};
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const rivalsPath = join(root, "registry", "rivals.json");
  const rivals = existsSync(rivalsPath) ? JSON.parse(readFileSync(rivalsPath, "utf8")) : {};
  const { tickers, sources, counterparty, records, warnings } = buildCovered(SOURCES, { counterpartySources: COUNTERPARTY_SOURCES, existing: COUNTERPARTY_EXISTING, rivals });
  for (const t of tickers) if (!existsSync(join(root, "rubric", "companies", `${t}.md`))) warnings.push(`${t}: covered but has no rubric/companies/${t}.md sheet`);
  const keyAccountsPath = join(root, "rubric", "key-accounts.json");
  const keyAccounts = existsSync(keyAccountsPath) ? JSON.parse(readFileSync(keyAccountsPath, "utf8")) : {};
  const out = {
    generated_from: "news-monitor src/priority.js (covered lane and coveredTicker sources) and role/affects on every source (plus src/counterparty-existing.js) and registry/rivals.json",
    tickers, sources, counterparty, records,
    channels: buildChannels(SOURCES),
    media_accounts: buildMediaAccounts(keyAccounts, tickers),
  };
  const target = join(root, "worker", "src", "covered.json");
  emit(target, JSON.stringify(out, null, 2) + "\n");
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log(`${verb} ${Object.keys(sources).length} sources for ${tickers.length} tickers and ${Object.keys(counterparty).length} counterparty sources -> ${target}`);

  const peersPath = join(root, "rubric", "peers.json");
  const peers = existsSync(peersPath) ? JSON.parse(readFileSync(peersPath, "utf8")) : [];
  // Phase 4 Part B: the topic groups of the group-routed registers (entity, name
  // and mirror key are read). A tree without the module has no group.
  const watchPath = join(repo, "src", "register-gov-watch.js");
  const { GOV_GROUPS = [] } = existsSync(watchPath) ? await import(pathToFileURL(watchPath).href) : {};
  const groupWarnings = [];
  const aux = buildAux(SOURCES, { tickers, sources, counterparty }, peers, { groups: GOV_GROUPS, warnings: groupWarnings });
  for (const w of groupWarnings) console.log(`warning: ${w}`);
  const auxOut = {
    generated_from: "news-monitor SOURCES after src/priority.js (every polled source outside covered.json sources), with entity names and statuses from rubric/peers.json",
    ...aux,
  };
  const auxTarget = join(root, "worker", "src", "aux-sources.json");
  emit(auxTarget, JSON.stringify(auxOut, null, 2) + "\n");
  const count = (values) => values.reduce((m, v) => ({ ...m, [v]: (m[v] || 0) + 1 }), {});
  const fmt = (m) => Object.entries(m).map(([k, n]) => `${k} ${n}`).join(", ");
  const entries = Object.values(aux.sources);
  const subject = entries.filter((e) => e.coverage_subject).length;
  console.log(`${verb} ${entries.length} auxiliary sources for ${new Set(entries.map((e) => e.entity)).size} entities (${fmt(count(entries.map((e) => e.status)))}; ${subject} coverage_subject) and ${Object.keys(aux.exclude).length} exclusions (${fmt(count(Object.values(aux.exclude)))}) -> ${auxTarget}`);
  if (aux.register_groups) console.log(`${verb} ${Object.keys(aux.register_groups).length} register groups -> ${auxTarget}`);

  // Site-structure watchers and egress probes -> covered tickers (Coverage page health strip and Site changes).
  const site = buildSiteSources(SOURCES, tickers);
  const siteTarget = join(root, "worker", "src", "site-sources.json");
  emit(siteTarget, JSON.stringify({
    generated_from: "news-monitor SOURCES after src/priority.js: site_structure watchers (src/site-structure-sources.js) and probes (src/probe-sources.js), config.ticker kept when covered",
    ...site,
  }, null, 2) + "\n");
  console.log(`${verb} ${Object.keys(site.sites).length} site watchers and ${Object.keys(site.probes).length} probes -> ${siteTarget}`);
  if (check) {
    for (const f of drift) console.error(`drift: ${f} differs from a fresh sync`);
    if (drift.length) process.exit(1);
    console.log("check: covered.json, aux-sources.json and site-sources.json match a fresh sync (nothing written)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith("--"));
  if (!repo) {
    console.error("usage: node scripts/sync-covered.mjs [--check] <news-monitor-repo>");
    process.exit(2);
  }
  await main(repo, { check: args.includes("--check") });
}
