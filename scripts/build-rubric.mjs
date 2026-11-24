// Bundles rubric/core.md and rubric/companies/<TICKER>.md into the Worker so
// the grader routine can fetch them over the API (GET /v1/rubric[/TICKER]).
// The rubric version is a content hash, so every grade records exactly which
// rubric text produced it.
//
// The auxiliary-names rubric (GET /v1/rubric/aux) is bundled as AUX_RUBRIC
// with its own hash, AUX_RUBRIC_VERSION; it is not part of RUBRIC_VERSION, so
// editing it never changes the coverage rubric's version. Without the file
// both are null and the route answers 503.
//   --root=<dir>  build from <dir>/rubric into <dir>/worker/src (tests)
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOwnerMarks } from "./owner-marks.mjs";

const rootArg = process.argv.find((a) => a.startsWith("--root="));
const root = rootArg ? resolve(rootArg.slice(7)) : join(dirname(fileURLToPath(import.meta.url)), "..");
const rubricDir = join(root, "rubric");
const corePath = join(rubricDir, "core.md");
const companiesDir = join(rubricDir, "companies");
const covered = JSON.parse(readFileSync(join(root, "worker", "src", "covered.json"), "utf8"));

const core = existsSync(corePath) ? readFileSync(corePath, "utf8") : "";
const peersPath = join(rubricDir, "peers.md");
const peers = existsSync(peersPath) ? readFileSync(peersPath, "utf8") : "";
const companies = {};
if (existsSync(companiesDir)) {
  for (const f of readdirSync(companiesDir).filter((f) => /^[A-Z]+\.md$/.test(f)).sort()) {
    companies[f.replace(/\.md$/, "")] = readFileSync(join(companiesDir, f), "utf8");
  }
}
const missing = covered.tickers.filter((t) => !companies[t]);
// core.md section 12: required sheet front matter. Sheets put it in a leading
// --- block or a ```yaml fence near the top; materiality may be a USD base
// (operating names) or a holdings/NAV base (treasury and fund names).
const REQUIRED = [
  ["base", /^(base_usd|base):/m],
  ["materiality lines", /^\s*(\w*tiny\w*|lines_usd):/m],   // e.g. tiny_usd, or unit-based lines (AUR trucks)
  ["thesis_drivers", /^thesis_drivers:/m],
  ["open_items", /^open_items:/m],
];
function frontMatter(md) {
  const text = md.replace(/\r\n/g, "\n");
  const dashed = /^(?:```ya?ml\n)?---\n([\s\S]*?)\n---/.exec(text);
  if (dashed) return dashed[1];
  const fenced = /```ya?ml\n([\s\S]*?)\n```/.exec(text.slice(0, 20000));
  return fenced ? fenced[1] : null;
}
const incomplete = [];
for (const [t, md] of Object.entries(companies)) {
  const fm = frontMatter(md);
  const lacking = fm ? REQUIRED.filter(([, re]) => !re.test(fm)).map(([name]) => name) : ["front matter"];
  if (lacking.length) incomplete.push(`${t} (${lacking.join(", ")})`);
}
if (incomplete.length) console.log(`WARNING sheets missing front matter fields: ${incomplete.join("; ")}`);
// owner_marks (core 12.1; scripts/owner-marks.mjs): every entry names a
// "## <line> (owner:YYYY-MM-DD)" heading in its sheet, and every such heading
// has an entry. A failure blocks --strict, like the checks above.
const badMarks = [];
for (const [t, md] of Object.entries(companies)) {
  for (const p of checkOwnerMarks(md, frontMatter(md) || "")) badMarks.push(`${t}: ${p}`);
}
for (const b of badMarks) console.log(`WARNING owner_marks ${b}`);
const extra = Object.keys(companies).filter((t) => !covered.tickers.includes(t));

// Title-match lists for counterparty ingest: each sheet's unconditional,
// case-insensitive `terms` (entries marked case: sensitive or carrying a
// requires rule are left out) plus its key accounts from rubric/key-accounts.json.
function sheetTerms(md) {
  const fm = frontMatter(md) || "";
  const m = /^terms:[ \t]*(.*)$/m.exec(fm);
  if (!m) return [];
  const unq = (x) => x.trim().replace(/^["']|["']$/g, "").trim();
  if (m[1].trim().startsWith("[")) {
    const body = m[1].trim().replace(/^\[|\]$/g, "");
    return (body.match(/\s*(?:"[^"]*"|'[^']*'|[^,]+)/g) || []).map(unq).filter(Boolean);
  }
  const out = [];
  for (const line of fm.slice(m.index + m[0].length).split("\n").slice(1)) {
    if (!/^\s+-\s/.test(line)) break;
    const item = line.replace(/^\s+-\s+/, "");
    if (item.startsWith("{")) {
      if (/case:\s*sensitive|requires/.test(item)) continue;
      const t = /term:\s*("[^"]*"|'[^']*'|[^,}]+)/.exec(item);
      if (t) out.push(unq(t[1]));
    } else out.push(unq(item));
  }
  return out;
}
const keyAccountsPath = join(rubricDir, "key-accounts.json");
const keyAccounts = existsSync(keyAccountsPath) ? JSON.parse(readFileSync(keyAccountsPath, "utf8")) : {};
const MATCH = {};
for (const t of covered.tickers) {
  if (!companies[t]) continue;
  MATCH[t] = {
    terms: [...new Set([...sheetTerms(companies[t]), ...(keyAccounts.company_names?.[t] || [])].filter((x) => x.length >= 3))],
    accounts: [...new Set((keyAccounts[t] || []).flatMap((a) => a.terms).filter((x) => x.length >= 3))],
  };
}
// The covered names (plans/round5-expansion-approve-queue.md, A2 and C3): per
// ticker, the sheet's front-matter `name:` (or, on a sheet without one, its
// first `terms` entry) plus its `company_names` in rubric/key-accounts.json.
// Never the rest of MATCH.terms: product and unit names there (Carbyne,
// Upgrade Energy) must stay expansion candidates. Not part of RUBRIC_VERSION:
// it changes no grade.
const unquote = (x) => x.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
const COVERED_NAMES = {};
for (const t of covered.tickers) {
  if (!companies[t]) continue;
  const nameLine = /^name:[ \t]*(.+)$/m.exec(frontMatter(companies[t]) || "");
  const primary = nameLine ? unquote(nameLine[1]) : sheetTerms(companies[t])[0];
  COVERED_NAMES[t] = [...new Set([primary, ...(keyAccounts.company_names?.[t] || [])].filter((x) => typeof x === "string" && x.trim()))];
}
const noTerms = Object.entries(MATCH).filter(([, v]) => !v.terms.length).map(([t]) => t);
if (noTerms.length) console.log(`WARNING sheets with no parseable terms: ${noTerms.join(", ")}`);

const hash = createHash("sha256").update(core);
for (const [t, md] of Object.entries(companies)) hash.update(`\n#${t}\n`).update(md);
hash.update("\n#PEERS\n").update(peers);
hash.update("\n#MATCH\n").update(JSON.stringify(MATCH));
const version = core ? "r-" + hash.digest("hex").slice(0, 12) : "r-none";

// The auxiliary rubric: rubric/aux.md in the spec, but Git for Windows cannot
// add a file named aux.<ext> (AUX is a reserved device name), so the first of
// these names that is a regular file is used.
const AUX_FILES = ["aux-rubric.md", "auxiliary.md", "aux.md"];
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const auxFound = AUX_FILES.filter((f) => isFile(join(rubricDir, f)));
const auxFile = auxFound[0] || null;
const aux = auxFile ? readFileSync(join(rubricDir, auxFile), "utf8") : null;
const auxVersion = aux ? "a-" + createHash("sha256").update(aux).digest("hex").slice(0, 12) : null;

const out = `// GENERATED by scripts/build-rubric.mjs — do not edit by hand.
export const RUBRIC_VERSION = ${JSON.stringify(version)};
export const CORE = ${JSON.stringify(core)};
export const COMPANIES = ${JSON.stringify(companies)};
export const PEERS = ${JSON.stringify(peers)};
export const MATCH = ${JSON.stringify(MATCH)};
export const COVERED_NAMES = ${JSON.stringify(COVERED_NAMES)};
export const AUX_RUBRIC_VERSION = ${JSON.stringify(auxVersion)};
export const AUX_RUBRIC = ${JSON.stringify(aux)};
`;
writeFileSync(join(root, "worker", "src", "rubric.generated.js"), out);
console.log(`rubric ${version}: core ${core.length} chars, ${Object.keys(companies).length} company sheets, peers ${peers.length} chars`);
console.log(aux ? `aux rubric ${auxVersion}: rubric/${auxFile} ${aux.length} chars` : `aux rubric: none (no rubric/${AUX_FILES.join(" or rubric/")}); GET /v1/rubric/aux answers 503`);
if (auxFound.length > 1) console.log(`WARNING several auxiliary rubrics (${auxFound.join(", ")}); using rubric/${auxFile}`);
if (missing.length) console.log(`WARNING missing sheets: ${missing.join(", ")}`);
if (extra.length) console.log(`WARNING sheets for non-covered tickers: ${extra.join(", ")}`);
if (process.argv.includes("--strict") && (!core || missing.length || incomplete.length || badMarks.length)) process.exit(1);
