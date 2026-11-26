// Phase 2: the text class of an item, which decides how much of its page text
// the reader keeps. A pure function of the row's source key and URL:
//
//   record  an official record: a record source (records.js isOfficialRecord)
//           or a government or register host (records.js OFFICIAL_HOST_RE)
//   wire    a newswire copy of an issuer's own release (WIRE_SERVICES)
//   issuer  the company's own channel: the source's own registrable domain
//           (covered.json channels), or a runtime company key (managed_*, or
//           ia_* but not ia_media_*, aux-route.js)
//   press   anything else: search results, filtered third-party feeds,
//           industry media, aggregators
//
// It answers a different question from rarity.js rarityClass (is a graded row
// a rare find?), so SEC filings are record here and issuer there.
//
// The switches (Worker secrets; unset means the default):
//   TEXT_BUDGETS       legacy (default): every visible excerpt keeps 2,500
//                      characters; class: the class budgets below
//   AUX_TEXT_PER_TICK  rows the shadow aux reader (aux-text.js) fetches a tick,
//                      default 4; 0 turns it off and lifts the claim hold
//   AUX_TEXT_SHOW      0 (default): page text is stored, never shown; 1 shows
//                      it in aux claims, with a 45-minute claim hold
//   AUX_TEXT_PRESS     0 (default): press rows are never read; 1 reads them
import COVERED from "./covered.json";
import { OFFICIAL_HOST_RE, isOfficialRecord } from "./records.js";
import { regDomain, hostOf } from "./domain.js";

export const TEXT_CLASSES = ["record", "wire", "issuer", "press"];

// The newswire services. Each is also in rarity.js WIRE_HOSTS (a test keeps it so).
export const WIRE_SERVICES = [
  "prnewswire.com", "globenewswire.com", "businesswire.com", "accessnewswire.com",
  "accesswire.com", "newmediawire.com", "newsfilecorp.com", "einpresswire.com",
];

// Characters kept per class once TEXT_BUDGETS=class. A page whose article the
// reader could not find (no anchor) keeps UNANCHORED_CHARS whatever its class.
export const TEXT_BUDGET = Object.freeze({ record: 8000, issuer: 6000, wire: 6000, press: 2500 });
export const UNANCHORED_CHARS = 2500;
export const LEGACY_BUDGET = Object.freeze({ record: 2500, issuer: 2500, wire: 2500, press: 2500 });

// Hosts the shadow aux reader never fetches. reuters.com: its robots.txt
// disallows every path for every agent.
export const NO_FETCH_HOSTS = ["reuters.com"];

// A whole non-negative number from a secret, else the default (budget.js reads
// its own settings the same way).
export function textSetting(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

export const AUX_TEXT_PER_TICK = 4;
export const auxTextPerTick = (env = {}) => textSetting(env?.AUX_TEXT_PER_TICK, AUX_TEXT_PER_TICK);
// Page text is shown in aux claims only with AUX_TEXT_SHOW=1 while the reader runs.
export const auxTextShown = (env = {}) => textSetting(env?.AUX_TEXT_SHOW, 0) > 0 && auxTextPerTick(env) > 0;
export const auxTextPress = (env = {}) => textSetting(env?.AUX_TEXT_PRESS, 0) > 0;

// The budgets for excerpts the grader can see.
export const classBudgets = (env = {}) => String(env?.TEXT_BUDGETS ?? "").trim().toLowerCase() === "class";
export const visibleBudgets = (env = {}) => (classBudgets(env) ? TEXT_BUDGET : LEGACY_BUDGET);

const onList = (host, hosts) => Boolean(host) && hosts.some((h) => host === h || host.endsWith("." + h));
export const noFetch = (url, hosts = NO_FETCH_HOSTS) => onList(hostOf(url), hosts);

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// row: an items or aux_items row ({ source_key, url }). covered: covered.json
// (injected in tests). The first rule that matches wins.
export function textClass(row, { covered = COVERED } = {}) {
  const key = String(row?.source_key ?? "").trim();
  const host = hostOf(row?.url);
  if (isOfficialRecord(row) || (host && OFFICIAL_HOST_RE.test(host))) return "record";
  const domain = regDomain(host);
  if (domain && WIRE_SERVICES.includes(domain)) return "wire";
  const channels = covered?.channels;
  if (domain && own(channels, key) && channels[key] === domain) return "issuer";
  if (/^managed_./.test(key) || (/^ia_./.test(key) && !/^ia_media_/.test(key))) return "issuer";
  return "press";
}
