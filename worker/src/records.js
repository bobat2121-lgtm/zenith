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
