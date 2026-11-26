// The coverage rubric's inputs and its content hash, in one place (phase 2,
// golden-set replay). scripts/build-rubric.mjs, grader/zenith.mjs (replay-claim)
// and the tests all import it, so the Worker bundle, the build and the
// routine's checkout compute one RUBRIC_VERSION. Pure Node: no Worker imports.
//
//   loadRubric(root)                    the live files under <root>/rubric
//   loadRubric(root, { overlay: true }) the live files with each file found in
//                                       <root>/rubric/candidate/ (core.md,
//                                       companies/<T>.md) put in their place,
//                                       and MATCH rebuilt from the merged sheets
//   versionOf(set)                      "r-" + 12 hex of the hash
//
// The hash reads text with "\r\n" normalized to "\n", which is byte-identical
// for the LF files in the repo and gives a Windows checkout the same version.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const CANDIDATE_DIR = "candidate";
const lf = (s) => String(s ?? "").replace(/\r\n/g, "\n");
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// The sheet's front-matter text: a leading --- block (optionally inside a
// ```yaml fence) or a ```yaml fence near the top (core.md section 12).
export function frontMatter(md) {
  const span = frontMatterSpan(md);
  return span ? lf(md).slice(span.start, span.end) : null;
}

// Where the front-matter text sits in the LF-normalized sheet: { start, end }.
export function frontMatterSpan(md) {
  const text = lf(md);
  const dashed = /^(?:```ya?ml\n)?---\n([\s\S]*?)\n---/.exec(text);
  const m = dashed || /```ya?ml\n([\s\S]*?)\n```/.exec(text.slice(0, 20000));
  if (!m) return null;
  const start = m.index + m[0].length - 4 - m[1].length;
  return { start, end: start + m[1].length };
}

// Title-match lists for counterparty ingest: each sheet's unconditional,
// case-insensitive `terms` (entries marked case: sensitive or carrying a
// requires rule are left out).
export function sheetTerms(md) {
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

// MATCH: per covered ticker with a sheet, its terms plus its key-account
// company_names, and its key-account terms.
export function buildMatch(companies, keyAccounts, tickers) {
  const MATCH = {};
  for (const t of tickers || []) {
    if (!companies[t]) continue;
    MATCH[t] = {
      terms: [...new Set([...sheetTerms(companies[t]), ...(keyAccounts.company_names?.[t] || [])].filter((x) => x.length >= 3))],
      accounts: [...new Set((keyAccounts[t] || []).flatMap((a) => a.terms).filter((x) => x.length >= 3))],
    };
  }
  return MATCH;
}

// The live rubric files under <root>/rubric, as build-rubric.mjs reads them.
function readLive(root) {
  const rubricDir = join(root, "rubric");
  const companiesDir = join(rubricDir, "companies");
  const companies = {};
  if (existsSync(companiesDir)) {
    for (const f of readdirSync(companiesDir).filter((f) => /^[A-Z]+\.md$/.test(f)).sort()) {
      companies[f.replace(/\.md$/, "")] = readFileSync(join(companiesDir, f), "utf8");
    }
  }
  const keyAccountsText = read(join(rubricDir, "key-accounts.json"));
  return {
    core: read(join(rubricDir, "core.md")),
    companies,
    peers: read(join(rubricDir, "peers.md")),
    keyAccountsText,
    keyAccounts: keyAccountsText ? JSON.parse(keyAccountsText) : {},
  };
}

// The overlay files in <root>/rubric/candidate/: { core, companies, other }.
// `other` lists every file there that is not BASE.json, core.md or
// companies/[A-Z]+.md (build-rubric.mjs --strict refuses them).
export function readOverlay(root) {
  const dir = join(root, "rubric", CANDIDATE_DIR);
  if (!existsSync(dir)) return null;
  const out = { core: null, companies: {}, other: [] };
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else if (p === "BASE.json") continue;
      else if (p === "core.md") out.core = readFileSync(join(dir, p), "utf8");
      else if (/^companies\/[A-Z]+\.md$/.test(p)) out.companies[p.slice(10, -3)] = readFileSync(join(dir, p), "utf8");
      else out.other.push(p);
    }
  };
  walk("");
  return out;
}

// One rubric set: { core, companies, peers, keyAccounts, keyAccountsText, tickers, MATCH }.
export function loadRubric(root, { overlay = false } = {}) {
  const live = readLive(root);
  const coveredPath = join(root, "worker", "src", "covered.json");
  const tickers = existsSync(coveredPath) ? JSON.parse(readFileSync(coveredPath, "utf8")).tickers || [] : [];
  const set = { ...live, tickers };
  if (overlay) {
    const o = readOverlay(root);
    if (o) {
      if (o.core != null) set.core = o.core;
      const merged = { ...live.companies, ...o.companies };
      set.companies = Object.fromEntries(Object.keys(merged).sort().map((t) => [t, merged[t]]));
    }
  }
  set.MATCH = buildMatch(set.companies, set.keyAccounts, tickers);
  return set;
}

// The hash of build-rubric.mjs (core, then each sheet, then peers, then MATCH),
// on LF-normalized text.
export function versionOf({ core, companies, peers, MATCH }) {
  if (!core) return "r-none";
  const hash = createHash("sha256").update(lf(core));
  for (const [t, md] of Object.entries(companies)) hash.update(`\n#${t}\n`).update(lf(md));
  hash.update("\n#PEERS\n").update(lf(peers));
  hash.update("\n#MATCH\n").update(JSON.stringify(MATCH));
  return "r-" + hash.digest("hex").slice(0, 12);
}

export const sha256 = (text) => createHash("sha256").update(lf(text)).digest("hex");
