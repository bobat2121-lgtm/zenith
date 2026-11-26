// owner_marks in a sheet's front matter (plans/round7-driver-coverage.md 4.1.2).
// One format only:
//   owner_marks: []
// or a YAML list of flow maps, one per owner-marked section:
//   owner_marks:
//     - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 1 ..."}
// `line` is the section heading without its "(owner:<date>)" suffix, so each
// entry must match a "## <line> (<mark>)" heading in the same sheet. The
// package has no YAML library, so this is a small parser for that shape only.
// The same list reader serves the phase 2 candidate's industry_links
// (parseFlowList, parseIndustryLinks), and ownerSectionsEqual checks that a
// candidate sheet (rubric/candidate/) leaves every owner-marked section alone.

const FIELDS = ["line", "mark", "overrides"];
const MARK = /^owner:(\d{4})-(\d{2})-(\d{2})$/;
const lf = (s) => String(s ?? "").replace(/\r\n/g, "\n");

// `key: "value"` pairs of one flow map; values are double- or single-quoted
// strings (double quotes allow \" and \\) or bare words up to the next comma.
// Every value is returned as a string.
export function parseFlowMap(text) {
  const body = text.trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  const out = {};
  const re = /\s*(\w+):\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}]*)\s*(,|$)/y;
  const inner = body.slice(1, -1);
  let pos = 0;
  while (pos < inner.length) {
    if (!inner.slice(pos).trim()) break;
    re.lastIndex = pos;
    const m = re.exec(inner);
    if (!m) return null;
    const raw = m[2].trim();
    // A value that opens with a quote must be exactly one quoted string.
    if (/^["']/.test(raw) && !/^(?:"(?:[^"\\]|\\.)*"|'[^']*')$/.test(raw)) return null;
    let v = raw;
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
    else if (v.startsWith("'")) v = v.slice(1, -1);
    out[m[1]] = v;
    pos = re.lastIndex;
  }
  return out;
}

// One YAML list of flow maps under `key` in a sheet's front matter: `key: []`
// or indented "- {a: ..., b: ...}" lines (blank and comment lines skipped; an
// unindented line ends the list). Every entry needs every field in `fields`
// and no other key. Returns null when the front matter has no `key`, else
// { entries: [the valid flow maps, in order], errors: [] }.
export function parseFlowList(frontMatter, key, fields) {
  const lines = lf(frontMatter).split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return null;
  const shape = `{${fields.join(", ")}}`;
  const rest = lines[at].slice(key.length + 1).replace(/\s+#.*$/, "").trim();
  const entries = [];
  const errors = [];
  if (rest === "[]") {
    if (/^\s+-\s/.test(lines[at + 1] || "")) errors.push(`${key}: [] is followed by list entries`);
    return { entries, errors };
  }
  if (rest !== "") return { entries, errors: [`${key} must be [] or a list of ${shape} (got "${rest}")`] };
  for (const l of lines.slice(at + 1)) {
    // Blank and comment lines inside the list are skipped; an unindented line
    // ends the list; any other indented line is an error, not a silent stop.
    if (!l.trim() || /^\s+#/.test(l)) continue;
    if (/^\S/.test(l)) break;
    if (!/^\s+-\s/.test(l)) { errors.push(`${key} line is not a "- ${shape}" list item: ${l.trim()}`); continue; }
    const entry = parseFlowMap(l.replace(/^\s+-\s+/, "").replace(/\s+#[^"']*$/, ""));
    if (!entry) { errors.push(`${key} entry is not a ${shape} flow map: ${l.trim()}`); continue; }
    const keys = Object.keys(entry);
    const missing = fields.filter((f) => !entry[f]);
    const extra = keys.filter((k) => !fields.includes(k));
    if (missing.length) errors.push(`${key} entry lacks ${missing.join(", ")}: ${l.trim()}`);
    if (extra.length) errors.push(`${key} entry has unknown keys ${extra.join(", ")}: ${l.trim()}`);
    if (!missing.length && !extra.length) entries.push(entry);
  }
  if (!entries.length && !errors.length) errors.push(`${key} is empty: write ${key}: []`);
  return { entries, errors };
}

// frontMatter: the sheet's front-matter text. Returns null when the sheet has
// no owner_marks key, else { marks: [{line, mark, overrides}], errors: [] }.
export function parseOwnerMarks(frontMatter) {
  const parsed = parseFlowList(frontMatter, "owner_marks", FIELDS);
  if (!parsed) return null;
  const marks = [];
  const errors = [...parsed.errors];
  const seen = new Set();
  for (const entry of parsed.entries) {
    const key = `${entry.line}\u0000${entry.mark}`;
    if (seen.has(key)) errors.push(`owner_marks has a duplicate entry for "${entry.line}" (${entry.mark})`);
    else { seen.add(key); marks.push({ line: entry.line, mark: entry.mark, overrides: entry.overrides }); }
  }
  return { marks, errors };
}

// industry_links (core.md section 9A, the phase 2 candidate): a list of
// {id, kind, area, actors, core} flow maps. kind is regulator, policy or
// budget; core is the literal true or false (bare or quoted), coerced to a
// boolean; ids are unique within a sheet. Returns null when the front matter
// has no industry_links key, else { links: [{id, kind, area, actors, core}], errors }.
export const INDUSTRY_FIELDS = ["id", "kind", "area", "actors", "core"];
export const INDUSTRY_KINDS = ["regulator", "policy", "budget"];
export function parseIndustryLinks(frontMatter) {
  const parsed = parseFlowList(frontMatter, "industry_links", INDUSTRY_FIELDS);
  if (!parsed) return null;
  const links = [];
  const errors = [...parsed.errors];
  const seen = new Set();
  for (const e of parsed.entries) {
    const bad = [];
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(e.id)) bad.push(`id "${e.id}" must be lower-case letters, digits and _`);
    if (!INDUSTRY_KINDS.includes(e.kind)) bad.push(`kind "${e.kind}" must be one of ${INDUSTRY_KINDS.join(", ")}`);
    if (e.core !== "true" && e.core !== "false") bad.push(`core "${e.core}" must be true or false`);
    if (seen.has(e.id)) bad.push(`duplicate id "${e.id}"`);
    if (bad.length) { errors.push(`industry_links entry ${e.id}: ${bad.join("; ")}`); continue; }
    seen.add(e.id);
    links.push({ id: e.id, kind: e.kind, area: e.area, actors: e.actors, core: e.core === "true" });
  }
  return { links, errors };
}

// The text of each "## <line> (owner:<date>)" section, keyed by its heading
// line: from the heading up to the next "## " heading.
function ownerSections(md) {
  const lines = lf(md).split("\n");
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!/^## .+ \(owner:[^)]*\)\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^## /.test(lines[j])) j++;
    out.set(lines[i].trim(), lines.slice(i, j).join("\n"));
  }
  return out;
}

// liveMd, candMd: a live sheet and its candidate copy (rubric/candidate/);
// frontMatterOf(md) gives a sheet's front-matter text. Every owner-marked
// section of the live sheet must be in the candidate under the same heading
// with byte-identical text up to the next "## " heading, and the owner_marks
// entries must be the same. Returns the problems found (empty when equal).
export function ownerSectionsEqual(liveMd, candMd, frontMatterOf) {
  const problems = [];
  const cand = ownerSections(candMd);
  for (const [heading, text] of ownerSections(liveMd)) {
    if (!cand.has(heading)) problems.push(`owner-marked section "${heading}" is missing from the candidate`);
    else if (cand.get(heading) !== text) problems.push(`owner-marked section "${heading}" differs in the candidate`);
  }
  const marks = (md) => JSON.stringify(parseOwnerMarks(frontMatterOf(md) || "")?.marks ?? null);
  if (marks(liveMd) !== marks(candMd)) problems.push("owner_marks entries differ in the candidate");
  return problems;
}

// A real calendar date in owner:YYYY-MM-DD form.
export function validMark(mark) {
  const m = MARK.exec(String(mark ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// md: the whole sheet; frontMatter: its front-matter text. Returns a list of
// problems (empty when the sheet is fine): bad entries, marks that are not
// owner:YYYY-MM-DD, entries with no "## <line> (<mark>)" heading, and
// "## ... (owner:<date>)" headings with no entry.
export function checkOwnerMarks(md, frontMatter) {
  const parsed = parseOwnerMarks(frontMatter);
  const headings = String(md ?? "").replace(/\r\n/g, "\n").split("\n").filter((l) => /^## /.test(l)).map((l) => l.trim());
  const problems = parsed ? [...parsed.errors] : [];
  const marks = parsed?.marks || [];
  for (const { line, mark } of marks) {
    if (!validMark(mark)) problems.push(`owner_marks "${line}": mark "${mark}" is not owner:YYYY-MM-DD`);
    else if (!headings.includes(`## ${line} (${mark})`)) problems.push(`owner_marks "${line}": no "## ${line} (${mark})" heading in the sheet`);
  }
  for (const h of headings) {
    const m = /^## (.+) \((owner:[^)]*)\)$/.exec(h);
    if (m && !marks.some((e) => e.line === m[1] && e.mark === m[2])) problems.push(`heading "${h}" carries an owner mark but owner_marks has no entry for it`);
  }
  return problems;
}
