// Phase 0 gates: official records (registers and government documents). The
// rule lives in scripts/sync-covered.mjs isRecordSource, applied to
// news-monitor's own source definitions: aux-sources.json marks record (and
// sec) entries, and covered.json lists the covered (own-lane) record keys
// under records. Used by the arrival gate (lib.js arrivalGate), the claim
// payload, Tuning suggestions and the admin rescue (budget.js).
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { isSecItem } from "./lib.js";
export { RECORD_LOOKBACK_DAYS } from "./lib.js";

// The government and register hosts of scripts/sync-covered.mjs
// OFFICIAL_HOST_RE, copied here because the Worker cannot import the script.
// This is the one Worker copy (the rarity class in rarity.js reads it);
// test/rarity.test.js asserts the two stay equal.
export const OFFICIAL_HOST_RE = /(^|\.)(gov|mil)$|\.gov\.[a-z]{2}$|(^|\.)legistar\.com$|(^|\.)canada\.ca$|(^|\.)fmv\.se$/i;

const RECORDS = new Set(COVERED.records || []);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Source level (tuning, rescue): a covered record source (edgar_*, unusual,
// strive_sec_northland), or an auxiliary entry marked record or sec.
export const isRecordSource = (key) => {
  const k = String(key || "");
  if (k.startsWith("edgar_") || RECORDS.has(k)) return true;
  const a = own(AUX.sources, k) ? AUX.sources[k] : null;
  return a?.record === true || a?.sec === true;
};

// Item level (gates, claim payload): the source is a record source, or the
// item itself is on sec.gov.
export const isOfficialRecord = (row) => isRecordSource(row?.source_key) || isSecItem(row);

// Phase 1: an FPDS source (aux-sources.json entity "fpds"). Its undated rows
// after the first poll are held 'record_fresh' (lib.js arrivalGate). `aux` is
// for tests; production passes only the key.
export const isFpdsSource = (key, aux = AUX) => {
  const k = String(key ?? "");
  return own(aux?.sources, k) && aux.sources[k]?.entity === "fpds";
};

// Phase 2: a register source (aux-sources.json register: true, set by
// scripts/sync-covered.mjs for register adapters). Its fresh rows after the
// first poll are held 'register' (lib.js arrivalGate). `aux` is for tests;
// production passes only the key.
export const isRegisterSource = (key, aux = AUX) => {
  const k = String(key ?? "");
  return own(aux?.sources, k) && aux.sources[k]?.register === true;
};

// Phase 4 (Part D): a body-record register source (aux-sources.json
// body_record: true, set by scripts/sync-covered.mjs BODY_RECORD_ADAPTERS).
// Its item body is the published record itself, so ingest keeps the body as
// the excerpt whatever its length and enrich never fetches the item URL
// (ingest.js feedFields). `aux` is for tests; production passes only the key.
export const isBodyRecordSource = (key, aux = AUX) => {
  const k = String(key ?? "");
  return own(aux?.sources, k) && aux.sources[k]?.body_record === true;
};

// Phase 4 (Part B): a group-routed register source (aux-sources.json
// group_routed: true, set by scripts/sync-covered.mjs for the OIRA review and
// committee-report adapters). Each of its cards is about one topic group, a
// shared program entity, not about a ticker. `aux` is for tests.
export const isGroupRouted = (key, aux = AUX) => {
  const k = String(key ?? "");
  return own(aux?.sources, k) && aux.sources[k]?.group_routed === true;
};

// The aux-sources.json register_groups entry ({ entity, name, affects, from })
// named by a card URL's trailing "g=<entity>" fragment (news-monitor puts it
// after "#", "&" or "-": "#baseline-g=<entity>", "#p3-g=<entity>"), else null:
// no fragment, or a group this catalog does not know. affects: the covered
// tickers the group feeds, in its mirror channel's order. `aux` is for tests.
const GROUP_FRAGMENT = /[#&-]g=([a-z][a-z0-9_]{2,63})$/;
export const groupAffects = (url, aux = AUX) => {
  const m = GROUP_FRAGMENT.exec(String(url ?? ""));
  if (!m || !own(aux?.register_groups, m[1])) return null;
  const g = aux.register_groups[m[1]];
  return { entity: m[1], name: g?.name ?? null, affects: Array.isArray(g?.affects) ? [...g.affects] : [], from: g?.from ?? null };
};
