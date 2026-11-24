// Bill autonomy lines (plans/round7-phase1a2-budget.md, B): for a Coverage item
// from an official bill source (drv_govinfo_defense_bills), the autonomy items
// in the bill, grouped, with their amounts (owner, 2026-11-24: "any autonomy
// items in a bill ... grouped together and ... tell me the amount").
//
// The item URL names a govinfo package (https://www.govinfo.gov/app/details/
// BILLS-119hr3838rh). A bill is read from its official XML
// (/content/pkg/<pkg>/xml/<pkg>.xml), a committee report (CRPT-...) from its
// HTML (/content/pkg/<pkg>/html/<pkg>.htm). Three kinds of lines:
//   - funding table rows (NDAA sections 4101-4701): the table's caption, its
//     column headers and its unit ("In Thousands of Dollars", turned into
//     dollars). A row is kept when its item names an autonomy term. Bracketed
//     rows ("[15,000]") are changes inside the line above them: inside a kept
//     line they are listed under it and never added again; inside another line
//     an autonomy change is a line of its own (change only).
//   - text provisions: a clause of the bill text with a dollar amount for an
//     autonomy term ("$1,534,000,000 for expansion of small unmanned surface
//     vessel production"), or a sourcing or ban provision with no amount. A
//     section header that names autonomy is the term for its clauses.
//   - committee report text: dotted-leader rows with amounts, and "$X for ..."
//     clauses.
// Totals per group and overall: request and bill amounts are summed
// separately, only over lines marked in_total. A text amount that is drawn
// from amounts counted elsewhere (the funding tables), or an account that names
// autonomy among other uses, is listed but not added.
//
// The result is stored as JSON in items.bill_lines (migration 0014) with a
// status: "ok", "retry" (tries, next_at) or "failed" (error). The grader sees
// blockText() in its claim; the app's Coverage card shows the groups.
import { nowIso, isHttpUrl } from "./lib.js";

export const BILL_SOURCES = ["drv_govinfo_defense_bills"];
export const BILL_SOURCES_SQL = `(${BILL_SOURCES.map((s) => `'${s}'`).join(", ")})`;
// Grading waits for the lines at most this long after ingest; after that the
// item is graded with whatever bill_lines holds (nothing, or a failure).
export const HOLD_MINUTES = 90;
const PER_TICK = 1;                  // one bill read and parsed per cron tick
const MAX_BYTES = 16_000_000;        // an NDAA's XML is about 4.5 MB
const TIMEOUT_MS = 25_000;
// Retryable as in excerpt.js: 429, 5xx and fetch errors; a 403 is tried twice;
// any other 4xx is final. The waits are shorter than excerpt.js's so every try
// ends inside HOLD_MINUTES.
const MAX_TRIES = 3;
const FORBIDDEN_TRIES = 2;
const RETRY_MINUTES = [10, 30];
const RETRYABLE = (e) => e === "http_429" || /^http_5\d\d$/.test(e) || String(e).startsWith("error");
// A graded item whose lines were still unread is read for up to LATE_DAYS after
// ingest, so the app's card gets them; the grade keeps what it saw.
const LATE_DAYS = 2;
const MAX_ROWS = 300;                // rows stored (the rest are counted in "more")
const MAX_CHANGES = 12;              // sub-rows listed under one line
const MAX_PROVISIONS = 40;
const BLOCK_ROWS = 60;               // rows in the grader's block
const ITEM_CHARS = 200;
const UA = "zenith-core/1.0 (research feed)";

export const GROUPS = [
  "Drones / small UAS",
  "Counter-UAS",
  "Large UAS (MQ-/RQ-)",
  "Collaborative combat aircraft / aircraft autonomy",
  "Uncrewed maritime",
  "Uncrewed ground / robotics",
  "Other autonomy",
  "Provisions (no amount)",
];
const [DRONES, COUNTER, LARGE, CCA, MARITIME, GROUND, OTHER, PROVISIONS] = GROUPS;

// ---- Autonomy terms (one list) --------------------------------------------------
const D = "[-‐‑–— ]";   // hyphen, en and em dashes, space
const TERM_RE = new RegExp([
  "\\bunmanned\\b", "\\buncrewed\\b", "\\bautonom(?:y|ous|ously)\\b", "\\bdrones?\\b",
  "\\bs?UA[SV]s?\\b", "\\bC-?s?UAS\\b", "\\bCUAS\\b", `\\bcounter${D}*(?:small${D}+)?(?:unmanned|uncrewed|drone)`,
  "\\bloitering\\b", "\\bUxS\\b", `\\bone${D}way${D}attack\\b`, `\\bcollaborative${D}+combat${D}+aircraft\\b`, "\\bCCAs?\\b",
  "\\breplicator\\b", "\\battritable\\b", `\\bdrone${D}+dominance\\b`, "\\bX?L?UUVs?\\b", "\\bM?L?USVs?\\b",
  "\\brobotics?\\b", "\\bRCVs?\\b", `\\boptionally${D}+manned\\b`, `\\b[MR]Q${D}?\\d`, `\\bunmanned${D}+carrier\\b`,
  `\\blaunched${D}+effects?\\b`,
].join("|"), "i");
// Senses that are not autonomy: "Tibet Autonomous Region", "autonomous agency",
// robotic surgery, and factory or manufacturing robotics ("Robotics Enhancements
// for Armaments Manufacturing", "industrial robotics").
const NOT_TERM_RE = new RegExp(
  "\\bautonomous\\s+(?:regions?|republics?|oblasts?|provinces?|prefectures?|communit(?:y|ies)|okrugs?|districts?|territor(?:y|ies)|areas?|zones?|agenc(?:y|ies)|bod(?:y|ies)|entit(?:y|ies)|institutions?|status)\\b" +
  "|\\brobotic(?:ally)?[- ]assisted\\b|\\brobotic\\s+surg\\w*|\\bsurgical\\s+robot\\w*|\\brobotic\\s+process\\s+automation\\b" +
  "|\\b(?:industrial|factory|manufacturing)\\s+(?:[a-z]+\\s+){0,2}robot\\w*" +
  "|\\brobot\\w*(?=[^.;\\[]{0,60}\\bmanufactur\\w*)", "gi");

const GROUP_RES = [
  [COUNTER, new RegExp(`\\bcounter${D}*(?:small${D}+)?(?:unmanned|uncrewed|UAS|sUAS|UAV|drones?)|\\bC-?s?UAS\\b|\\bCUAS\\b|\\bcounter${D}*UxS\\b|\\banti${D}?drones?\\b|\\bdrone${D}+(?:defen[cs]e|detection|mitigation|interceptors?)\\b` +
    `|\\b(?:detect|track|mitigat|defeat|intercept)\\w*\\b[^.;]{0,80}\\bthreats?\\s+(?:from|posed\\s+by)\\s+(?:unmanned|uncrewed|drones?|s?UAS)\\b`, "i")],
  [MARITIME, new RegExp(`\\b(?:unmanned|uncrewed|autonomous|robotic)${D}+(?:(?!aerial|aircraft|air\\b)[a-z&]+${D}+){0,3}?(?:surface|undersea|underwater|maritime|sea|vessels?|boats?|ships?|submarines?|naval)\\b|\\bX?L?UUVs?\\b|\\bM?L?USVs?\\b|\\bmaritime${D}+(?:robotic${D}+)?autonom`, "i")],
  [CCA, new RegExp(`\\bcollaborative${D}+combat${D}+aircraft\\b|\\bCCAs?\\b|\\bautonomous${D}+collaborative\\b|\\bcollaborative${D}+autonom|\\btactical${D}+autonomy\\b|\\bunmanned${D}+combat${D}+(?:air|aircraft)\\b|\\bloyal${D}+wingman\\b|\\battritable${D}+aircraft\\b|\\baircraft${D}+autonomy\\b|\\bautonomous${D}+(?:aircraft|flight)\\b`, "i")],
  [LARGE, new RegExp(`\\b[MR]Q${D}?\\d+|\\bgr[ae]y${D}+eagle\\b|\\bglobal${D}+hawk\\b|\\btriton\\b|\\breaper\\b|\\bunmanned${D}+carrier\\b|\\blong${D}+endurance${D}+unmanned\\b`, "i")],
  [GROUND, new RegExp(`\\brobotics?\\b|\\bRCVs?\\b|\\b(?:unmanned|uncrewed|autonomous)${D}+ground\\b|\\bUGVs?\\b|\\boptionally${D}+manned${D}+(?:fighting|combat|tank|ground)`, "i")],
  [DRONES, new RegExp(`\\bdrones?\\b|\\bs?UA[SV]s?\\b|\\b(?:unmanned|uncrewed)${D}+(?:aerial|aircraft|air)\\b|\\bloitering\\b|\\bone${D}way${D}attack\\b|\\blaunched${D}+effects?\\b|\\bFPV\\b`, "i")],
];

// Group 1-2 small UAS with RQ- designators (Raven, Wasp, Dragon Eye, T-Hawk, Puma, Skydio X2D).
const SMALL_RQ_RE = new RegExp(`\\bRQ${D}?(?:11|12|14|16|20|28)[A-Z]?\\b`, "i");

const cleanTerms = (text) => String(text || "").replace(NOT_TERM_RE, " ");
export const hasTerm = (text) => TERM_RE.test(cleanTerms(text));
// The group of a line, from its item text (then its account, for a change row).
export function groupOf(text) {
  const t = cleanTerms(text);
  // A small RQ- designator (RQ-11 Raven, RQ-20 Puma ...), or the words "small" or
  // sUAS, keep a line with the small drones.
  if (GROUP_RES[3][1].test(t) && (/\bsmall\b|\bsUAS\b/i.test(t) || SMALL_RQ_RE.test(t)) && !GROUP_RES[0][1].test(t)) return DRONES;
  for (const [name, re] of GROUP_RES) if (re.test(t)) return name;
  return OTHER;
}

// ---- Packages and documents -------------------------------------------------------
const PKG_RE = /\b(BILLS-\d{3}(?:hr|s|hjres|sjres|hconres|sconres|hres|sres)\d+[a-z]{1,4}|CRPT-\d{3}[hs]rpt\d+)\b/i;
export function packageOf(url) {
  if (!isHttpUrl(url)) return null;
  const m = String(url).match(PKG_RE);
  if (!m) return null;
  const [prefix, rest] = [m[1].slice(0, m[1].indexOf("-")).toUpperCase(), m[1].slice(m[1].indexOf("-") + 1).toLowerCase()];
  return `${prefix}-${rest}`;
}
export function documentUrl(pkg) {
  if (pkg.startsWith("BILLS-")) return `https://www.govinfo.gov/content/pkg/${pkg}/xml/${pkg}.xml`;
  return `https://www.govinfo.gov/content/pkg/${pkg}/html/${pkg}.htm`;
}

const BILL_TYPE = { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res." };
// Each version is a stage (the version code govinfo puts at the end of the package id).
export const STAGES = {
  ih: "introduced in House", is: "introduced in Senate", rh: "reported in House", rs: "reported in Senate",
  rfh: "referred in House", rfs: "referred in Senate", rdh: "received in House", rds: "received in Senate",
  pch: "placed on House calendar", pcs: "placed on Senate calendar", eh: "passed House", es: "passed Senate",
  eah: "House amendment, between the chambers", eas: "Senate amendment, between the chambers",
  cph: "considered and passed House", cps: "considered and passed Senate", ath: "agreed to in House", ats: "agreed to in Senate",
  enr: "enrolled, passed both chambers", pp: "public print",
};
export function billLabel(pkg) {
  const b = /^BILLS-(\d{3})([a-z]+?)(\d+)([a-z]+)$/.exec(pkg || "");
  if (b) return { bill: `${BILL_TYPE[b[2]] || b[2].toUpperCase()} ${b[3]}`, version: b[4].toUpperCase(), stage: STAGES[b[4]] || "bill version", congress: Number(b[1]) };
  const r = /^CRPT-(\d{3})([hs])rpt(\d+)$/.exec(pkg || "");
  if (r) return { bill: `${r[2] === "h" ? "H." : "S."} Rept. ${r[1]}-${r[3]}`, version: "report", stage: "committee report", congress: Number(r[1]) };
  return { bill: pkg || "?", version: "", stage: "", congress: null };
}

// ---- Text helpers -----------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
  }
  return ENT[e.toLowerCase()] ?? m;
});
const squash = (s) => s.replace(/\s+/g, " ").trim();
export const xmlText = (xml) => squash(decode(String(xml || "").replace(/<linebreak\b[^>]*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));
const clip = (s, n = ITEM_CHARS) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// "726,034" | "[15,000]" | "[–10,000]" | "$71,200,000" | "—" -> { value, bracket, dollar } or null.
export function parseAmount(raw) {
  const t = squash(String(raw || "")).replace(/\\\d+\\/g, "").trim();
  const m = /^(\[)?\s*([-‐‑–—−(])?\s*(\$)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*\)?\s*(\])?$/.exec(t);
  if (!m) return null;
  const value = Number(`${m[4].replace(/,/g, "")}${m[5] ? `.${m[5]}` : ""}`) * (m[2] ? -1 : 1);
  return Number.isFinite(value) ? { value, bracket: Boolean(m[1] || m[6]), dollar: Boolean(m[3]) } : null;
}
function unitOf(text) {
  if (/in\s+thousands\s+of\s+dollars/i.test(text)) return 1000;
  if (/in\s+millions\s+of\s+dollars/i.test(text)) return 1_000_000;
  if (/in\s+billions\s+of\s+dollars/i.test(text)) return 1_000_000_000;
  return null;
}
// $ amounts written out in text: "$1,534,000,000", "$5.5 billion", "$250,000".
const TEXT_AMOUNT_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s+(thousand|million|billion|trillion))?/gi;
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
function textAmounts(text) {
  const out = [];
  for (const m of text.matchAll(TEXT_AMOUNT_RE)) {
    const v = Number(m[1].replace(/,/g, "")) * (m[2] ? SCALE[m[2].toLowerCase()] : 1);
    if (Number.isFinite(v)) out.push({ value: Math.round(v), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---- Funding tables ------------------------------------------------------------------
const ROW_RE = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
const ENTRY_RE = /<entry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/entry>)/g;
const attr = (attrs, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(attrs) || [])[1] || null;
function entriesOf(rowXml) {
  const out = [];
  for (const e of rowXml.matchAll(ENTRY_RE)) {
    out.push({ col: attr(e[1], "colname") || attr(e[1], "namest"), raw: e[2] || "", text: xmlText(e[2] || ""), bold: /<bold\b/i.test(e[2] || "") });
  }
  return out;
}
function roleOfHeader(h) {
  const t = h.toLowerCase();
  if (/^line\b/.test(t)) return "line";
  if (/program\s+element/.test(t)) return "pe";
  if (/request/.test(t)) return "request";
  if (/\bchange\b|increase|decrease/.test(t)) return "change";
  if (/^account\b|^component\b/.test(t)) return "account";
  if (/\bitem\b|project|^program\b|title|activity/.test(t)) return "item";
  if (/installation|location|^state|country/.test(t)) return "location";
  if (/authoriz|agreement|recommend|conference|enacted|\bbill\b|appropriat|amount|allowance|senate|house|rate/.test(t)) return "bill";
  return null;
}
const ACCOUNT_RE = /,\s*(?:ARMY|NAVY|AIR FORCE|MARINE CORPS|SPACE FORCE|DEFENSE[- ]WIDE|NAVY AND MARINE CORPS|ARMY NATIONAL GUARD|AIR NATIONAL GUARD|ARMY RESERVE|NAVY RESERVE|MARINE CORPS RESERVE|AIR FORCE RESERVE)\s*$/i;
const TOTAL_RE = /^(?:grand\s+)?total\b/i;
const SUBTOTAL_RE = /^sub[- ]?total\b/i;

// One <table>: its rows that name an autonomy term, as lines.
export function tableLines(tableXml, context = "") {
  const rows = [...tableXml.matchAll(ROW_RE)].map((r) => entriesOf(r[1]));
  const thead = (tableXml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/) || [])[1] || "";
  const ttitle = xmlText((tableXml.match(/<ttitle\b[^>]*>([\s\S]*?)<\/ttitle>/) || [])[1] || "");
  const headRows = [...thead.matchAll(ROW_RE)].map((r) => entriesOf(r[1]));
  // A one-entry header row is the caption ("SEC. 4101. PROCUREMENT (In Thousands of Dollars)").
  let caption = ttitle;
  const roles = new Map();
  for (const hr of headRows) {
    if (hr.length === 1 && !roleOfHeader(hr[0].text)) { caption = squash(`${caption} ${hr[0].text}`); continue; }
    for (const e of hr) { const role = roleOfHeader(e.text); if (role && e.col && !roles.has(e.col)) roles.set(e.col, role); }
  }
  const has = (role) => [...roles.values()].includes(role);
  if (!has("bill") && !has("request")) return { caption, lines: [] };
  const unit = unitOf(`${caption} ${context}`);
  const section = squash(caption.replace(/\(\s*in\s+(?:thousands|millions|billions)\s+of\s+dollars\s*\)/i, "")) || clip(context, 80);
  const lines = [];
  let account = null, activity = null, parent = null, afterTotal = true;
  const body = headRows.length ? rows.slice(headRows.length) : rows;
  for (const entries of body) {
    const cell = {};
    for (const e of entries) {
      const role = roles.get(e.col);
      if (role && !(role in cell)) cell[role] = e.text;
    }
    const item = cell.item || "";
    const amounts = ["request", "bill", "change"].map((k) => [k, parseAmount(cell[k])]);
    const anyAmount = amounts.some(([, a]) => a);
    if (!item && !anyAmount) continue;
    if (TOTAL_RE.test(item) || SUBTOTAL_RE.test(item)) { if (TOTAL_RE.test(item)) afterTotal = true; parent = null; continue; }
    if (!anyAmount && !cell.line && item) {
      // A heading row: the account after a total (or at the start), else a budget activity.
      const bold = entries.some((e) => e.bold);
      if (bold || !cell.request) {
        if (afterTotal || ACCOUNT_RE.test(item)) { account = item; activity = null; afterTotal = false; }
        else activity = item;
        parent = null;
      }
      continue;
    }
    const scale = (a) => (a ? (unit ? a.value * unit : a.dollar ? a.value : a.value * (unit ?? 1)) : null);
    const bracket = amounts.find(([, a]) => a?.bracket);
    if (bracket && !cell.line && !amounts.some(([, a]) => a && !a.bracket)) {
      // A change inside the line above it.
      const change = scale(bracket[1]);
      if (parent?.kept) {
        if (parent.kept.changes.length < MAX_CHANGES) parent.kept.changes.push({ item: clip(item), change });
        else parent.kept.more_changes = (parent.kept.more_changes || 0) + 1;
      } else if (hasTerm(item)) {
        lines.push({ kind: "change", group: groupOf(item), item: clip(item), account: cell.account || account, activity, section,
          line: null, pe: null, inside: parent ? clip(`${parent.line ? `${parent.line} ` : ""}${parent.item}`, 120) : null,
          request: null, bill: null, change, in_total: true });
      }
      continue;
    }
    const request = scale(amounts[0][1]), bill = scale(amounts[1][1]);
    const change = amounts[2][1] ? scale(amounts[2][1]) : request != null && bill != null ? bill - request : null;
    const label = cell.location && item ? `${item} (${cell.location})` : item || cell.location || "";
    parent = { item: label, line: cell.line || null, kept: null };
    afterTotal = false;
    if (!hasTerm(item)) continue;
    const row = { kind: "line", group: groupOf(item), item: clip(label), account: cell.account || account, activity, section,
      line: cell.line || null, pe: cell.pe || null, request, bill, change, changes: [], in_total: true };
    parent.kept = row;
    lines.push(row);
  }
  return { caption, lines };
}

// ---- Bill text ------------------------------------------------------------------------
const BAN_RE = /\bprohibit\w*|\bmay not\b|\bshall not\b|\bnone of the (?:funds|amounts)\b|\bno (?:funds|amounts)\b|\bban(?:s|ned)?\b|\bcovered foreign\b|\bforeign (?:entit(?:y|ies)|countr(?:y|ies)) of concern\b|\bforeign adversar\w*|\bmanufactured (?:in|by)\b|\bPeople's Republic of China\b|\bsourcing\b|\blimitation on (?:the )?(?:procurement|acquisition|purchase|use|operation)\b|\bcomponents? (?:made|produced|manufactured)\b/i;
// Domestic production counts as a sourcing provision only with a requirement
// ("shall be domestically sourced"), not in working-group or report language
// ("recommendations for improving the domestic manufacturing capacity").
const DOMESTIC_RE = /\bdomestic(?:ally)? (?:sourc\w*|produc\w*|manufactur\w*)\b/i;
const REQUIRE_RE = /\bshall be\b|\bmust be\b|\bonly (?:from|if|by)\b|\brequirements?\b|\brequired\b/i;
// Rules of construction and exceptions are not bans.
const NOT_BAN_RE = /\bshall not (?:be construed|apply|affect|limit)\b/gi;
function isProvision(clause) {
  const c = clause.replace(NOT_BAN_RE, " ");
  return BAN_RE.test(c) || (DOMESTIC_RE.test(c) && REQUIRE_RE.test(c));
}
const FROM_TABLES_RE = /\bfunding tables?\b|\bauthorized to be appropriated\b|\bOf the (?:amounts|funds) (?:authorized|made available|appropriated)\b|\bas specified in\b/i;
const LIST_BEFORE_RE = /\bincluding\b|\bsuch as\b|,\s*(?:and|or)\s+[^,]*$/i;

// Clauses of one text unit: provisos, semicolon-separated paragraphs and sentences.
function clauses(text) {
  // A sentence ends at ". " before a capital, but not after an initial ("U.S. Customs").
  return text.split(/:\s*(?=Provided\b)|;\s+|(?<!\b[A-Z])\.\s+(?=[A-Z(])/).map((c) => c.trim()).filter((c) => c.length > 12);
}

// A clause's autonomy amount: { value, shared, item } or null; or { provision } for a ban with no amount.
// context: the section header, for a clause with no term of its own ("the
// Secretary of the Army may not retire, divest ..." under "Limitation on
// retirement of Gray Eagle unmanned aircraft systems").
export function clauseLine(clause, context = "") {
  const clean = cleanTerms(clause);
  const term = TERM_RE.exec(clean);
  const amounts = textAmounts(clause);
  if (!term) return !amounts.length && context && hasTerm(context) && isProvision(clause) ? { provision: true } : null;
  if (!amounts.length) return isProvision(clause) ? { provision: true } : null;
  // Purpose after the amount: the amount whose span (up to the next amount) holds a term.
  for (let i = 0; i < amounts.length; i++) {
    const seg = clean.slice(amounts[i].end, i + 1 < amounts.length ? amounts[i + 1].index : clean.length);
    if (TERM_RE.test(seg) && !/^\W*(?:shall|to) remain available\b[^,]*$/i.test(seg)) {
      return { value: amounts[i].value, shared: false, purpose: seg };
    }
  }
  // Purpose before the amount ("For necessary expenses ... unmanned aerial systems, $X").
  const first = amounts[0];
  if (term.index < first.index) {
    const before = clean.slice(0, first.index);
    const at = before.search(TERM_RE);
    const shared = LIST_BEFORE_RE.test(before.slice(0, at + 1)) || /,\s*(?:and|or)\s+\S*\s*$/i.test(before.slice(0, at)) || /\b(?:and|or)\b/i.test(before.slice(Math.max(0, at - 60), at));
    return { value: first.value, shared, purpose: before };
  }
  return null;
}

function purposeText(clause) {
  return clip(squash(clause.replace(/^\(\w{1,6}\)\s*/, "").replace(/[;,.]?\s*(?:and|or)?\s*$/i, "")));
}

const TEXT_TOKEN_RE = /<(section|title|division|subtitle|part|chapter|appropriations-major|appropriations-intermediate|appropriations-small|subsection|paragraph|subparagraph|clause|header|text)\b[^>]*?(\/)?>/g;

// "by striking $55,000,000 and inserting $75,000,000": an amendment to an amount in earlier law.
const AMENDS_RE = /\bby striking\s+\$[\d,.]+[^$]*?\binserting\s+\$/i;
// A clause with an amount and no term, in a section whose header names autonomy
// (an amended authorization cap): the inserted amount, or the only amount.
function headerAmount(clause) {
  const amts = textAmounts(clause);
  const ins = amts.find((a) => /\binserting\s*$/i.test(clause.slice(Math.max(0, a.index - 20), a.index)));
  return ins || (amts.length === 1 ? amts[0] : null);
}

// Text lines of a bill (tables removed): amounts for autonomy terms, and
// sourcing or ban provisions with no amount (one per section). A section
// header that names autonomy is the term for the clauses under it.
export function textLines(xml, { hasTables = false } = {}) {
  const lines = [];
  let open = null, section = null, sectionTerm = false, account = [], provisions = 0;
  const seenProvision = new Set();
  for (const m of xml.matchAll(TEXT_TOKEN_RE)) {
    const tag = m[1];
    if (tag !== "header" && tag !== "text") {
      open = tag;
      if (tag === "section") { section = null; sectionTerm = false; }
      if (tag === "division" || tag === "title") { account = []; section = null; sectionTerm = false; }
      continue;
    }
    if (m[2]) continue;
    const close = xml.indexOf(`</${tag}>`, m.index);
    if (close < 0) break;
    const text = xmlText(xml.slice(m.index + m[0].length, close));
    if (tag === "header") {
      if (open === "section") {
        const en = (xml.slice(Math.max(0, m.index - 200), m.index).match(/<enum>([^<]*)<\/enum>\s*$/) || [])[1];
        section = squash(`${en ? `SEC. ${en.replace(/\.$/, "")}.` : ""} ${text}`);
        sectionTerm = hasTerm(text);
      } else if (open?.startsWith("appropriations-")) {
        const level = { "appropriations-major": 0, "appropriations-intermediate": 1, "appropriations-small": 2 }[open];
        account = [...account.slice(0, level), text];
      } else if (open === "title" || open === "division") account = [];
      continue;
    }
    for (const c of clauses(text)) {
      let hit = clauseLine(c, sectionTerm ? section : "");
      if (!hit && sectionTerm) {
        const one = headerAmount(c);
        if (one) hit = { value: one.value, shared: false, purpose: section, fromHeader: true };
      }
      if (!hit) continue;
      const where = section || account.join(", ") || null;
      if (hit.provision) {
        const key = where || c.slice(0, 80);
        if (seenProvision.has(key) || provisions >= MAX_PROVISIONS) continue;
        seenProvision.add(key);
        provisions++;
        lines.push({ kind: "provision", group: PROVISIONS, item: purposeText(c), account: account.join(", ") || null, section, line: null,
          request: null, bill: null, change: null, in_total: false });
        continue;
      }
      const drawn = hasTables && (hit.fromHeader || FROM_TABLES_RE.test(text));
      const note = hit.shared ? "account names autonomy among other uses: not added"
        : hit.fromHeader && AMENDS_RE.test(c) ? "amends an amount in earlier law: not added"
          : drawn ? "drawn from amounts in the funding tables: not added" : null;
      lines.push({ kind: "text", group: groupOf(hit.purpose || c), item: purposeText(c), account: account.join(", ") || null, section,
        line: null, request: null, bill: hit.value, change: null, in_total: !note, ...(note ? { note } : {}) });
    }
  }
  return lines;
}

// ---- Committee report text (HTML, a <pre> block) ---------------------------------------
const LEADER_RE = /^(\s*)(.+?)\s*\.{4,}\s*(.+?)\s*$/;
const HEADING_RE = /^\s{6,}([A-Z0-9][A-Z0-9 ,&'().\/-]{3,})\s*$/;
export function reportLines(html) {
  const pre = (String(html).match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i) || [])[1] ?? String(html);
  const text = decode(pre.replace(/<[^>]+>/g, ""));
  const out = [];
  const seen = new Set();
  let heading = null, unit = null, unitAt = -1, para = [];
  const lines = text.split(/\r?\n/);
  const push = (row) => {
    const key = `${row.group}|${row.bill ?? row.request}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  const flush = () => {
    if (!para.length) return;
    const joined = squash(para.join(" "));
    para = [];
    for (const c of clauses(joined)) {
      const hit = clauseLine(c);
      if (!hit || hit.provision) continue;
      push({ kind: "report", group: groupOf(hit.purpose || c), item: purposeText(c), account: heading, section: null, line: null,
        request: null, bill: hit.value, change: null, in_total: !hit.shared, ...(hit.shared ? { note: "account names autonomy among other uses: not added" } : {}) });
    }
  };
  lines.forEach((raw, i) => {
    if (/\[\s*in\s+(?:thousands|millions)\s+of\s+dollars\s*\]/i.test(raw)) { unit = unitOf(raw); unitAt = i; }
    const h = HEADING_RE.exec(raw);
    if (h && !/\.{4,}/.test(raw)) { flush(); heading = squash(h[1]); return; }
    const l = LEADER_RE.exec(raw);
    if (l) {
      flush();
      const nums = l[3].split(/\s{2,}|\s(?=[-+$\d])/).map(parseAmount).filter(Boolean);
      // A contents page lists page numbers, not amounts.
      if (!nums.length || nums.every((n) => !n.dollar && Math.abs(n.value) < 1000)) return;
      const label = squash(l[2]);
      const subject = /^(?:committee recommendation|budget request|change from|fiscal year|total)/i.test(label) && heading ? `${heading}: ${label}` : label;
      if (!hasTerm(subject)) return;
      const scale = (a) => (a.dollar || unitAt < 0 || i - unitAt > 80 ? a.value : a.value * (unit || 1));
      const [a, b, c] = nums.map(scale);
      const row = nums.length >= 2 ? { request: a, bill: b, change: c ?? b - a } : /request/i.test(label) ? { request: a, bill: null, change: null } : { request: null, bill: a, change: null };
      push({ kind: "report", group: groupOf(subject), item: clip(subject), account: heading, section: null, line: null, ...row, in_total: true });
      return;
    }
    if (!raw.trim()) { flush(); return; }
    if (/^\s{4}\S/.test(raw)) flush();
    para.push(raw.trim());
  });
  flush();
  return out;
}

// ---- Whole documents --------------------------------------------------------------------
const TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/g;
function sectionBefore(xml, index) {
  const at = xml.lastIndexOf("<section", index);
  if (at < 0) return "";
  const m = /<enum>([^<]*)<\/enum>\s*<header>([\s\S]*?)<\/header>/.exec(xml.slice(at, Math.min(index, at + 4000)));
  return m ? squash(`SEC. ${m[1].replace(/\.$/, "")}. ${xmlText(m[2])}`) : "";
}

export function billXmlLines(xml) {
  const tables = [];
  for (const m of xml.matchAll(TABLE_RE)) tables.push(...tableLines(m[0], sectionBefore(xml, m.index)).lines);
  const body = xml.replace(TABLE_RE, " ").replace(/<toc\b[\s\S]*?<\/toc>/g, " ").replace(/<metadata\b[\s\S]*?<\/metadata>/, " ")
    .replace(/<form\b[\s\S]*?<\/form>/, " ");
  return [...tables, ...textLines(body, { hasTables: tables.length > 0 })];
}
const titleOf = (doc, pkg) => {
  const t = (doc.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || doc.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  return t ? clip(xmlText(t).replace(/^\d+\s+[A-Z.]+\s*\d+\s+[A-Z]+:\s*/, ""), 240) : pkg;
};

const sum = (rows, key) => rows.reduce((s, r) => s + (r.in_total && Number.isFinite(r[key]) ? r[key] : 0), 0);
// Totals over the lines marked in_total: request and bill separately. A change
// row (inside another line) adds its change to the bill total and nothing to
// the request; changes listed under a kept line are never added again.
export function totalsOf(rows) {
  const counted = rows.filter((r) => r.in_total);
  const request = sum(counted, "request");
  const bill = sum(counted, "bill") + counted.filter((r) => r.kind === "change").reduce((s, r) => s + (r.change || 0), 0);
  const change = counted.reduce((s, r) => s + (r.kind === "change" ? r.change || 0 : r.request != null && r.bill != null ? r.bill - r.request : 0), 0);
  return { lines: rows.length, request, bill, change, request_lines: counted.filter((r) => Number.isFinite(r.request)).length };
}

// Rows grouped in the GROUPS order, by account within a group, largest first.
export function groupLines(rows) {
  const groups = [];
  for (const name of GROUPS) {
    const list = rows.filter((r) => r.group === name);
    if (!list.length) continue;
    list.sort((a, b) => String(a.account || "").localeCompare(String(b.account || "")) || (b.bill ?? b.change ?? 0) - (a.bill ?? a.change ?? 0));
    groups.push({ name, ...totalsOf(list), rows: list });
  }
  return groups;
}

// The stored result for one document.
export function extract(doc, pkg, { url = documentUrl(pkg), bytes = doc.length, truncated = false } = {}) {
  const all = pkg.startsWith("CRPT-") ? reportLines(doc) : billXmlLines(doc);
  const totals = totalsOf(all);
  // Stored rows are capped; totals cover every line found.
  let kept = all;
  if (all.length > MAX_ROWS) {
    const rank = [...all].sort((a, b) => Math.abs(b.bill ?? b.change ?? 0) - Math.abs(a.bill ?? a.change ?? 0));
    const keep = new Set(rank.slice(0, MAX_ROWS));
    kept = all.filter((r) => keep.has(r));
  }
  const groups = groupLines(kept).map((g) => ({ ...g, ...totalsOf(all.filter((r) => r.group === g.name)) }));
  for (const g of groups) for (const r of g.rows) delete r.group;
  return { v: 1, status: "ok", package: pkg, ...billLabel(pkg), title: titleOf(doc, pkg), source_url: url, bytes, truncated,
    totals, groups, more: all.length - kept.length, at: nowIso() };
}

// ---- The grader's block ---------------------------------------------------------------------
export function usd(v) {
  if (!Number.isFinite(v)) return "-";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${a}`;
}
const signed = (v) => (v > 0 ? `+${usd(v)}` : usd(v));
function rowText(r) {
  const where = [r.account, r.line ? `line ${r.line}` : null, r.inside ? `inside ${r.inside}` : null].filter(Boolean).join(", ") || r.section || "";
  let amount;
  if (r.kind === "provision") amount = "no amount";
  else if (r.kind === "change") amount = `change ${signed(r.change)}`;
  else if (r.request != null) amount = `request ${usd(r.request)}, bill ${usd(r.bill)}${r.change ? ` (${signed(r.change)})` : ""}`;
  else amount = `bill ${usd(r.bill)}`;
  const subs = r.changes?.length ? `; changes: ${r.changes.slice(0, 3).map((c) => `${c.item} ${signed(c.change)}`).join("; ")}${r.changes.length > 3 ? `; +${r.changes.length - 3} more` : ""}` : "";
  return `- ${r.item}${where ? ` [${where}]` : ""}: ${amount}${r.note ? ` (${r.note})` : ""}${subs}`;
}
const requestText = (t) => (t.request_lines ? `request ${usd(t.request)}` : "no request figures in the text");
// The block the grader reads: the header, then each group's total and its
// largest lines. At most maxRows lines: every group gets up to PER_GROUP
// first, then the rest fill in group order; "+N more" says what is left out.
const PER_GROUP = 5;
// A version with no autonomy lines, or with lines but no amount counted, never
// prints "total $0": an appropriations act carries account totals and its
// program amounts are in the committee report. A committee report is read from
// its text only (its program tables are images), so it is a partial read.
export function blockText(bl, maxRows = BLOCK_ROWS) {
  if (!bl || bl.status !== "ok") return null;
  const t = bl.totals || { lines: 0, request: 0, bill: 0 };
  const report = String(bl.package || "").startsWith("CRPT-");
  const lead = `AUTONOMY LINES (from the official bill text): ${bl.bill} ${bl.version} (${bl.stage}): `;
  if (!t.lines) {
    return lead + (report ? "no autonomy lines in the report text (its program tables are not read; this is not a $0 total)"
      : "no autonomy lines in the text (program amounts may be in the committee report; this is not a $0 total)");
  }
  const counted = t.bill || t.change || t.request_lines;
  const head = lead + (counted ? `${t.lines} lines, total ${usd(t.bill)} (${requestText(t)})` : `${t.lines} lines, no amounts counted`) +
    (report ? " (report text only; its program tables are not read)" : "");
  const groups = (bl.groups || []).map((g) => ({ g, top: [...g.rows].sort((a, b) => Math.abs(b.bill ?? b.change ?? 0) - Math.abs(a.bill ?? a.change ?? 0)), take: 0 }));
  let left = maxRows;
  for (const x of groups) { x.take = Math.min(x.top.length, PER_GROUP, left); left -= x.take; }
  for (const x of groups) { const more = Math.min(x.top.length - x.take, left); x.take += more; left -= more; }
  const out = [head];
  let shown = 0;
  for (const { g, top, take } of groups) {
    const sums = g.name === PROVISIONS ? "no amounts" : `${usd(g.bill)} (${requestText(g)})`;
    out.push(`${g.name}: ${g.lines} lines, ${sums}`);
    for (const r of top.slice(0, take)) out.push(rowText(r));
    shown += take;
  }
  if (t.lines > shown) out.push(`+${t.lines - shown} more`);
  return out.join("\n");
}

// ---- Fetching and the cron pass ------------------------------------------------------------
async function readBounded(body, limit) {
  const chunks = [];
  let size = 0, truncated = false;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > limit) { chunks.push(value.subarray(0, limit - size)); size = limit; truncated = true; break; }
    chunks.push(value); size += value.length;
  }
  try { await reader.cancel(); } catch {}
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return { text: new TextDecoder("utf-8").decode(buf), size, truncated };
}

// One document: the stored result, or { status: "error", error } for this try.
export async function readBillLines(url) {
  const pkg = packageOf(url);
  if (!pkg) return { status: "failed", error: "no_package", final: true };
  const src = documentUrl(pkg);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), TIMEOUT_MS);
  try {
    const r = await fetch(src, { headers: { "user-agent": UA, accept: pkg.startsWith("BILLS-") ? "application/xml,text/xml" : "text/html" }, signal: ctl.signal });
    if (!r.ok) {
      try { await r.body?.cancel(); } catch {}
      const error = `http_${r.status}`;
      return { status: "error", error, final: !RETRYABLE(error) && r.status !== 403 };
    }
    const { text, size, truncated } = await readBounded(r.body, MAX_BYTES);
    if (pkg.startsWith("BILLS-") && !/<(?:bill|resolution|amendment-doc)\b/.test(text.slice(0, 5000))) return { status: "error", error: "not_bill_xml", final: true };
    return extract(text, pkg, { url: src, bytes: size, truncated });
  } catch (e) {
    return { status: "error", error: String(e).includes("timeout") ? "error_timeout" : "error", final: false };
  } finally {
    clearTimeout(timer);
  }
}

// Fits the D1 row: the smaller rows are dropped, half a group at a time, until
// the JSON is small. Kept rows stay in account order. Totals are kept.
const MAX_JSON = 400_000;
const rowSize = (x) => Math.abs(x.bill ?? x.change ?? 0);
export function storedJson(result) {
  let s = JSON.stringify(result);
  if (s.length <= MAX_JSON) return s;
  const r = structuredClone(result);
  while (s.length > MAX_JSON) {
    const g = r.groups.reduce((a, b) => (b.rows.length > (a?.rows.length || 0) ? b : a), null);
    if (!g || g.rows.length <= 1) break;
    const keep = new Set([...g.rows].sort((a, b) => rowSize(b) - rowSize(a)).slice(0, Math.ceil(g.rows.length / 2)));
    g.rows = g.rows.filter((x) => keep.has(x));
    r.more = r.groups.reduce((n, x) => n + x.lines, 0) - r.groups.reduce((n, x) => n + x.rows.length, 0);
    s = JSON.stringify(r);
  }
  return s;
}

// Status of a stored value: "ok", "failed", "retry" (with next_at), or null.
export function parseStored(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

// The cron pass: bill items waiting for their lines (never read, or a retry
// that is due), PER_TICK a tick, pending or claimed items first. A failed read
// is retried with backoff; after MAX_TRIES (or a final error) the failure is
// recorded and grading goes on. Graded items whose lines are still unread are
// read for up to LATE_DAYS after ingest, so the app's card gets them; the grade
// keeps what it saw.
export async function billLinesPass(env, { limit = PER_TICK } = {}) {
  const now = nowIso();
  const rows = (await env.DB.prepare(
    `SELECT id, url, bill_lines FROM items
      WHERE source_key IN ${BILL_SOURCES_SQL} AND (state IN ('pending','claimed') OR (state = 'graded' AND ingested_at > ?3))
        AND (bill_lines IS NULL OR (json_extract(bill_lines, '$.status') = 'retry' AND json_extract(bill_lines, '$.next_at') <= ?1))
      ORDER BY (state = 'graded'), id DESC LIMIT ?2`,
  ).bind(now, limit, nowIso(Date.now() - LATE_DAYS * 86_400_000)).all()).results || [];
  const done = [];
  for (const row of rows) {
    const prev = parseStored(row.bill_lines);
    const tries = (prev?.tries || 0) + 1;
    const t0 = Date.now();
    const res = await readBillLines(row.url);
    let stored;
    if (res.status === "ok") stored = { ...res, tries, ms: Date.now() - t0 };
    else if (!res.final && tries < (res.error === "http_403" ? FORBIDDEN_TRIES : MAX_TRIES)) {
      stored = { v: 1, status: "retry", error: res.error, tries, next_at: nowIso(Date.now() + RETRY_MINUTES[Math.min(tries - 1, RETRY_MINUTES.length - 1)] * 60_000), at: now };
    } else stored = { v: 1, status: "failed", error: res.error, tries, at: now };
    await env.DB.prepare("UPDATE items SET bill_lines = ? WHERE id = ?").bind(storedJson(stored), row.id).run();
    done.push({ id: row.id, status: stored.status, ...(stored.status === "ok" ? { lines: stored.totals.lines } : { error: stored.error }) });
  }
  return { tried: rows.length, items: done, at: now };
}

// The claim's hold: a bill item waits for its lines while they are still being
// read, at most HOLD_MINUTES after ingest. ?? = the ingest cutoff.
export const BILL_HOLD_SQL = (cutoffParam) =>
  `NOT (source_key IN ${BILL_SOURCES_SQL} AND (bill_lines IS NULL OR json_extract(bill_lines, '$.status') = 'retry') AND ingested_at > ${cutoffParam})`;
