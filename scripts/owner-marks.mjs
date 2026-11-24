// owner_marks in a sheet's front matter (plans/round7-driver-coverage.md 4.1.2).
// One format only:
//   owner_marks: []
// or a YAML list of flow maps, one per owner-marked section:
//   owner_marks:
//     - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 1 ..."}
// `line` is the section heading without its "(owner:<date>)" suffix, so each
// entry must match a "## <line> (<mark>)" heading in the same sheet. The
// package has no YAML library, so this is a small parser for that shape only.

const FIELDS = ["line", "mark", "overrides"];
const MARK = /^owner:(\d{4})-(\d{2})-(\d{2})$/;

// `key: "value"` pairs of one flow map; values are double- or single-quoted
// strings (double quotes allow \" and \\) or bare words up to the next comma.
function parseFlowMap(text) {
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

// frontMatter: the sheet's front-matter text. Returns null when the sheet has
// no owner_marks key, else { marks: [{line, mark, overrides}], errors: [] }.
export function parseOwnerMarks(frontMatter) {
  const lines = String(frontMatter ?? "").replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^owner_marks:/.test(l));
  if (at < 0) return null;
  const rest = lines[at].slice("owner_marks:".length).replace(/\s+#.*$/, "").trim();
  const marks = [];
  const errors = [];
  if (rest === "[]") {
    if (/^\s+-\s/.test(lines[at + 1] || "")) errors.push("owner_marks: [] is followed by list entries");
    return { marks, errors };
  }
  if (rest !== "") return { marks, errors: [`owner_marks must be [] or a list of {line, mark, overrides} (got "${rest}")`] };
  const seen = new Set();
  for (const l of lines.slice(at + 1)) {
    // Blank and comment lines inside the list are skipped; an unindented line
    // ends the list; any other indented line is an error, not a silent stop.
    if (!l.trim() || /^\s+#/.test(l)) continue;
    if (/^\S/.test(l)) break;
    if (!/^\s+-\s/.test(l)) { errors.push(`owner_marks line is not a "- {line, mark, overrides}" list item: ${l.trim()}`); continue; }
    const entry = parseFlowMap(l.replace(/^\s+-\s+/, "").replace(/\s+#[^"']*$/, ""));
    if (!entry) { errors.push(`owner_marks entry is not a {line, mark, overrides} flow map: ${l.trim()}`); continue; }
    const keys = Object.keys(entry);
    const missing = FIELDS.filter((f) => !entry[f]);
    const extra = keys.filter((k) => !FIELDS.includes(k));
    if (missing.length) errors.push(`owner_marks entry lacks ${missing.join(", ")}: ${l.trim()}`);
    if (extra.length) errors.push(`owner_marks entry has unknown keys ${extra.join(", ")}: ${l.trim()}`);
    if (!missing.length && !extra.length) {
      const key = `${entry.line}\u0000${entry.mark}`;
      if (seen.has(key)) errors.push(`owner_marks has a duplicate entry for "${entry.line}" (${entry.mark})`);
      else { seen.add(key); marks.push({ line: entry.line, mark: entry.mark, overrides: entry.overrides }); }
    }
  }
  if (!marks.length && !errors.length) errors.push("owner_marks is empty: write owner_marks: []");
  return { marks, errors };
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
