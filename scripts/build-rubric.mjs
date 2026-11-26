// Bundles rubric/core.md and rubric/companies/<TICKER>.md into the Worker so
// the grader routine can fetch them over the API (GET /v1/rubric[/TICKER]).
// The rubric version is a content hash, so every grade records exactly which
// rubric text produced it. The files are read and hashed by
// scripts/rubric-hash.mjs, which grader/zenith.mjs also uses (replay-claim),
// so the build and the routine's checkout compute one version.
//
// The auxiliary-names rubric (GET /v1/rubric/aux) is bundled as AUX_RUBRIC
// with its own hash, AUX_RUBRIC_VERSION; it is not part of RUBRIC_VERSION, so
// editing it never changes the coverage rubric's version. Without the file
// both are null and the route answers 503.
//
// Phase 2, golden-set replay: INDUSTRY is the live sheets' front-matter
// industry_links per ticker ({T: {id: {core}}}; {} while no sheet declares
// one). A candidate rubric is an overlay in rubric/candidate/ (core.md,
// companies/<T>.md, and BASE.json, written only by --rebase-candidate). With
// an overlay the build adds CANDIDATE_VERSION, CANDIDATE_FLOORS,
// CANDIDATE_INDUSTRY and CANDIDATE_SCOPE (the candidate text itself is not
// bundled: the routine builds it from its checkout); without one they are
// null and every live export is unchanged.
//   --root=<dir>          build from <dir>/rubric into <dir>/worker/src (tests)
//   --strict              exit 1 on any problem below
//   --rebase-candidate    re-apply each overlay sheet's industry_links block
//                         onto the current live sheet and rewrite BASE.json
//                         (--declare=T[,U]=body|front_matter declares an
//                         overlay sheet change outside industry_links;
//                         --core-reapplied: the overlay core.md was redone by
//                         hand on the current live core.md)
//   --promote-candidate   copy the overlay over the live files, delete
//                         rubric/candidate/, rebuild; exit 1 unless the new
//                         RUBRIC_VERSION equals the old CANDIDATE_VERSION
import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOwnerMarks, parseIndustryLinks, ownerSectionsEqual } from "./owner-marks.mjs";
import { loadRubric, readOverlay, versionOf, frontMatter, frontMatterSpan, sheetTerms, sha256, CANDIDATE_DIR } from "./rubric-hash.mjs";
import { parseFloors } from "../worker/src/floors.js";

const argv = process.argv.slice(2);
const rootArg = argv.find((a) => a.startsWith("--root="));
const root = rootArg ? resolve(rootArg.slice(7)) : join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = argv.includes("--strict");
const rubricDir = join(root, "rubric");
const candidateDir = join(rubricDir, CANDIDATE_DIR);
const basePath = join(candidateDir, "BASE.json");
const lf = (s) => String(s ?? "").replace(/\r\n/g, "\n");
const DECLARED = ["body", "front_matter"];

// --- industry_links helpers -----------------------------------------------------
// The industry_links block of a sheet's front matter as character offsets in
// the LF-normalized sheet: the key line and its indented list, without
// trailing blank lines. null when the sheet has none.
function industryRange(md) {
  const text = lf(md);
  const span = frontMatterSpan(text);
  if (!span) return null;
  const lines = text.slice(span.start, span.end).split("\n");
  const starts = [];
  let off = span.start;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const at = lines.findIndex((l) => l.startsWith("industry_links:"));
  if (at < 0) return null;
  let last = at;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    if (lines[i].trim()) last = i;
  }
  return { start: starts[at], end: starts[last] + lines[last].length, fmEnd: span.end };
}
const industryBlock = (md) => { const r = industryRange(md); return r ? lf(md).slice(r.start, r.end) : ""; };
// The sheet without its industry_links block (LF).
function stripIndustry(md) {
  const text = lf(md);
  const r = industryRange(text);
  if (!r) return text;
  return r.end < r.fmEnd ? text.slice(0, r.start) + text.slice(r.end + 1) : text.slice(0, r.start - 1) + text.slice(r.end);
}
// The sheet with `block` as its industry_links block, at the end of its front matter.
function withIndustry(md, block) {
  const text = stripIndustry(md);
  if (!block) return text;
  const span = frontMatterSpan(text);
  return text.slice(0, span.end) + "\n" + block + text.slice(span.end);
}
// INDUSTRY for a set of sheets: {T: {id: {core}}}, plus the parse problems.
function industryOf(companies) {
  const map = {}, problems = [];
  for (const [t, md] of Object.entries(companies)) {
    const parsed = parseIndustryLinks(frontMatter(md) || "");
    if (!parsed) continue;
    for (const e of parsed.errors) problems.push(`${t}: ${e}`);
    if (parsed.links.length) map[t] = Object.fromEntries(parsed.links.map((l) => [l.id, { core: l.core }]));
  }
  return { map, problems };
}

// --- BASE.json ---------------------------------------------------------------------
// The sha256 (LF-normalized) of every live input to the hash.
function liveShas(live) {
  const out = { "core.md": sha256(live.core), "peers.md": sha256(live.peers), "key-accounts.json": sha256(live.keyAccountsText) };
  for (const [t, md] of Object.entries(live.companies)) out[`companies/${t}.md`] = sha256(md);
  return out;
}
function readBase() {
  if (!existsSync(basePath)) return null;
  try { return JSON.parse(readFileSync(basePath, "utf8")); } catch { return { invalid: true }; }
}
function writeBase(live, declared) {
  const body = {
    note: "Generated by scripts/build-rubric.mjs --rebase-candidate; never edit by hand. live: sha256 of every live rubric input when the overlay was cut.",
    live: liveShas(live),
    declared: Object.fromEntries(Object.entries(declared).sort()),
  };
  writeFileSync(basePath, JSON.stringify(body, null, 2) + "\n");
}

// How an overlay sheet differs from its live sheet: none | industry | front_matter | body.
function sheetChange(liveMd, candMd) {
  const a = stripIndustry(liveMd), b = stripIndustry(candMd);
  if (a === b) return industryBlock(liveMd) === industryBlock(candMd) ? "none" : "industry";
  const sa = frontMatterSpan(a), sb = frontMatterSpan(b);
  if (sa && sb && a.slice(0, sa.start) === b.slice(0, sb.start) && a.slice(sa.end) === b.slice(sb.end)) return "front_matter";
  return "body";
}

// The overlay's checks, version and scope. Returns null without an overlay.
function candidate(live) {
  const o = readOverlay(root);
  if (!o) return null;
  const problems = [];
  for (const p of o.other) problems.push(`rubric/${CANDIDATE_DIR}/${p} is not core.md or companies/<TICKER>.md`);
  const base = readBase();
  if (!base) problems.push(`rubric/${CANDIDATE_DIR}/BASE.json is missing: run node scripts/build-rubric.mjs --rebase-candidate`);
  else if (base.invalid || !base.live) problems.push(`rubric/${CANDIDATE_DIR}/BASE.json is not valid: run --rebase-candidate`);
  else {
    const now = liveShas(live);
    for (const k of [...new Set([...Object.keys(base.live), ...Object.keys(now)])].sort()) {
      if (base.live[k] !== now[k]) problems.push(`live rubric/${k} changed after the overlay was cut (BASE.json): run --rebase-candidate in this PR`);
    }
  }
  const declared = base?.declared || {};
  for (const [t, v] of Object.entries(declared)) if (!DECLARED.includes(v)) problems.push(`BASE.json declared ${t}: "${v}" must be ${DECLARED.join(" or ")}`);
  const changed = { sheets: [], front: [] };
  for (const [t, md] of Object.entries(o.companies)) {
    const liveMd = live.companies[t];
    if (liveMd == null) { problems.push(`rubric/${CANDIDATE_DIR}/companies/${t}.md has no live sheet`); continue; }
    const kind = sheetChange(liveMd, md);
    if (kind === "body" && declared[t] !== "body") problems.push(`${t}: the overlay sheet differs from the live sheet outside industry_links; declare it with --rebase-candidate --declare=${t}=body`);
    if (kind === "front_matter" && !declared[t]) problems.push(`${t}: the overlay sheet's front matter differs outside industry_links; declare it with --rebase-candidate --declare=${t}=front_matter`);
    for (const p of ownerSectionsEqual(liveMd, md, frontMatter)) problems.push(`${t}: ${p}`);
    if (kind === "body" || kind === "industry" || declared[t] === "body") changed.sheets.push(t);
    else if (kind === "front_matter") changed.front.push(t);
  }
  const set = loadRubric(root, { overlay: true });
  const industry = industryOf(set.companies);
  problems.push(...industry.problems.map((p) => `candidate ${p}`));
  const coreChanged = o.core != null && lf(o.core) !== lf(live.core);
  const scope = coreChanged ? { scope: "full", tickers: [] }
    : changed.sheets.length ? { scope: "sheets", tickers: changed.sheets.sort() }
    : { scope: "guards", tickers: changed.front.sort() };
  return { version: versionOf(set), floors: parseFloors(set.core), industry: industry.map, scope, problems };
}

// --- the build ------------------------------------------------------------------------
function build() {
  const live = loadRubric(root);
  const { core, companies, peers, keyAccounts, tickers } = live;
  const missing = tickers.filter((t) => !companies[t]);
  // core.md section 12: required sheet front matter. Sheets put it in a leading
  // --- block or a ```yaml fence near the top; materiality may be a USD base
  // (operating names) or a holdings/NAV base (treasury and fund names).
  const REQUIRED = [
    ["base", /^(base_usd|base):/m],
    ["materiality lines", /^\s*(\w*tiny\w*|lines_usd):/m],   // e.g. tiny_usd, or unit-based lines (AUR trucks)
    ["thesis_drivers", /^thesis_drivers:/m],
    ["open_items", /^open_items:/m],
  ];
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
  const extra = Object.keys(companies).filter((t) => !tickers.includes(t));
  // industry_links (phase 2): malformed entries block --strict.
  const industry = industryOf(companies);
  for (const p of industry.problems) console.log(`WARNING industry_links ${p}`);

  // Title-match lists for counterparty ingest (rubric-hash.mjs buildMatch): each
  // sheet's unconditional, case-insensitive `terms` plus its key accounts from
  // rubric/key-accounts.json.
  const MATCH = live.MATCH;
  // The covered names (plans/round5-expansion-approve-queue.md, A2 and C3): per
  // ticker, the sheet's front-matter `name:` (or, on a sheet without one, its
  // first `terms` entry) plus its `company_names` in rubric/key-accounts.json.
  // Never the rest of MATCH.terms: product and unit names there (Carbyne,
  // Upgrade Energy) must stay expansion candidates. Not part of RUBRIC_VERSION:
  // it changes no grade.
  const unquote = (x) => x.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  const COVERED_NAMES = {};
  for (const t of tickers) {
    if (!companies[t]) continue;
    const nameLine = /^name:[ \t]*(.+)$/m.exec(frontMatter(companies[t]) || "");
    const primary = nameLine ? unquote(nameLine[1]) : sheetTerms(companies[t])[0];
    COVERED_NAMES[t] = [...new Set([primary, ...(keyAccounts.company_names?.[t] || [])].filter((x) => typeof x === "string" && x.trim()))];
  }
  const noTerms = Object.entries(MATCH).filter(([, v]) => !v.terms.length).map(([t]) => t);
  if (noTerms.length) console.log(`WARNING sheets with no parseable terms: ${noTerms.join(", ")}`);

  const version = versionOf(live);

  // The auxiliary rubric: rubric/aux.md in the spec, but Git for Windows cannot
  // add a file named aux.<ext> (AUX is a reserved device name), so the first of
  // these names that is a regular file is used.
  const AUX_FILES = ["aux-rubric.md", "auxiliary.md", "aux.md"];
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  const auxFound = AUX_FILES.filter((f) => isFile(join(rubricDir, f)));
  const auxFile = auxFound[0] || null;
  const aux = auxFile ? readFileSync(join(rubricDir, auxFile), "utf8") : null;
  const auxVersion = aux ? "a-" + createHash("sha256").update(aux).digest("hex").slice(0, 12) : null;

  const cand = candidate(live);
  for (const p of cand?.problems || []) console.log(`WARNING candidate ${p}`);

  const out = `// GENERATED by scripts/build-rubric.mjs — do not edit by hand.
export const RUBRIC_VERSION = ${JSON.stringify(version)};
export const CORE = ${JSON.stringify(core)};
export const COMPANIES = ${JSON.stringify(companies)};
export const PEERS = ${JSON.stringify(peers)};
export const MATCH = ${JSON.stringify(MATCH)};
export const COVERED_NAMES = ${JSON.stringify(COVERED_NAMES)};
export const AUX_RUBRIC_VERSION = ${JSON.stringify(auxVersion)};
export const AUX_RUBRIC = ${JSON.stringify(aux)};
export const INDUSTRY = ${JSON.stringify(industry.map)};
export const CANDIDATE_VERSION = ${JSON.stringify(cand ? cand.version : null)};
export const CANDIDATE_FLOORS = ${JSON.stringify(cand ? cand.floors : null)};
export const CANDIDATE_INDUSTRY = ${JSON.stringify(cand ? cand.industry : null)};
export const CANDIDATE_SCOPE = ${JSON.stringify(cand ? cand.scope : null)};
`;
  writeFileSync(join(root, "worker", "src", "rubric.generated.js"), out);
  console.log(`rubric ${version}: core ${core.length} chars, ${Object.keys(companies).length} company sheets, peers ${peers.length} chars`);
  console.log(aux ? `aux rubric ${auxVersion}: rubric/${auxFile} ${aux.length} chars` : `aux rubric: none (no rubric/${AUX_FILES.join(" or rubric/")}); GET /v1/rubric/aux answers 503`);
  if (cand) console.log(`candidate ${cand.version}: scope ${cand.scope.scope}${cand.scope.tickers.length ? ` (${cand.scope.tickers.join(", ")})` : ""}`);
  if (auxFound.length > 1) console.log(`WARNING several auxiliary rubrics (${auxFound.join(", ")}); using rubric/${auxFile}`);
  if (missing.length) console.log(`WARNING missing sheets: ${missing.join(", ")}`);
  if (extra.length) console.log(`WARNING sheets for non-covered tickers: ${extra.join(", ")}`);
  const failed = !core || missing.length || incomplete.length || badMarks.length || industry.problems.length || (cand?.problems.length || 0);
  return { version, candidateVersion: cand?.version ?? null, failed: Boolean(failed), live };
}

function fail(msg) { console.log(`ERROR ${msg}`); process.exit(1); }

// --rebase-candidate: the overlay re-cut on the current live rubric.
function rebase() {
  if (!existsSync(candidateDir)) fail(`no rubric/${CANDIDATE_DIR}/ to rebase`);
  const live = loadRubric(root);
  const o = readOverlay(root);
  const base = readBase();
  const declared = { ...(base?.declared || {}) };
  for (const a of argv.filter((x) => x.startsWith("--declare="))) {
    const [tickersText, kind] = a.slice(10).split("=");
    if (!DECLARED.includes(kind)) fail(`--declare=${tickersText}=${kind}: the kind must be ${DECLARED.join(" or ")}`);
    for (const t of tickersText.split(",").filter(Boolean)) declared[t.toUpperCase()] = kind;
  }
  const was = base?.live || null;
  const now = liveShas(live);
  if (o.core != null && was && was["core.md"] !== now["core.md"] && !argv.includes("--core-reapplied")) {
    fail(`the live core.md changed after the overlay was cut, and an overlay core.md is never merged automatically: re-apply the candidate's core edits by hand onto the current rubric/core.md in rubric/${CANDIDATE_DIR}/core.md, then rerun with --rebase-candidate --core-reapplied`);
  }
  for (const [t, md] of Object.entries(o.companies)) {
    const liveMd = live.companies[t];
    if (liveMd == null) fail(`rubric/${CANDIDATE_DIR}/companies/${t}.md has no live sheet`);
    if (!was || was[`companies/${t}.md`] === now[`companies/${t}.md`]) continue;
    if (declared[t]) fail(`${t}: the live sheet changed and the overlay declares a ${declared[t]} change; re-apply it by hand on the current live sheet, then rerun`);
    writeFileSync(join(candidateDir, "companies", `${t}.md`), withIndustry(liveMd, industryBlock(md)));
  }
  writeBase(live, declared);
  console.log(`rebased rubric/${CANDIDATE_DIR}/ on the live rubric (BASE.json rewritten)`);
}

// --promote-candidate (PR-C5 only): the overlay becomes the live rubric.
function promote() {
  if (!existsSync(candidateDir)) fail(`no rubric/${CANDIDATE_DIR}/ to promote`);
  const live = loadRubric(root);
  const base = readBase();
  if (!base?.live) fail(`rubric/${CANDIDATE_DIR}/BASE.json is missing or invalid`);
  const now = liveShas(live);
  for (const k of [...new Set([...Object.keys(base.live), ...Object.keys(now)])]) {
    if (base.live[k] !== now[k]) fail(`live rubric/${k} changed after the overlay was cut: run --rebase-candidate first`);
  }
  const o = readOverlay(root);
  if (o.other.length) fail(`rubric/${CANDIDATE_DIR}/ holds files that cannot be promoted: ${o.other.join(", ")}`);
  const expected = versionOf(loadRubric(root, { overlay: true }));
  if (o.core != null) writeFileSync(join(rubricDir, "core.md"), o.core);
  mkdirSync(join(rubricDir, "companies"), { recursive: true });
  for (const [t, md] of Object.entries(o.companies)) writeFileSync(join(rubricDir, "companies", `${t}.md`), md);
  rmSync(candidateDir, { recursive: true, force: true });
  return expected;
}

let expected = null;
if (argv.includes("--promote-candidate")) expected = promote();
else if (argv.includes("--rebase-candidate")) rebase();
const result = build();
if (expected != null && result.version !== expected) fail(`promoted RUBRIC_VERSION ${result.version} is not the candidate's ${expected}`);
if (expected != null) console.log(`promoted: RUBRIC_VERSION ${result.version} equals the old CANDIDATE_VERSION`);
if (strict && result.failed) process.exit(1);
