// Renders rubric/peers.json (structured short notes for the companies in
// news-monitor's public- and private-adjacent lanes) into rubric/peers.md,
// which the grader reads when an item names another company.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notes = JSON.parse(readFileSync(join(root, "rubric", "peers.json"), "utf8"));
const GROUPS = [
  ["public", "Public companies"],
  ["public-pending", "Pending listings (SPAC / IPO not yet closed)"],
  ["subsidiary", "Subsidiaries of larger companies"],
  ["private", "Private companies"],
];
const DIR = { "+": "+", "-": "−", "±": "±" };

let md = `# Peer notes — other-lane companies

Short notes for the ${notes.length} companies news-monitor tracks outside the covered lane
(competitors, customers, partners, bellwethers). Use them when an item about a covered
company names one of these companies. A peer's own news counts for a covered company
only through an explicit link (see core.md, read-through boundary).

Direction: **+** partner / customer / validation · **−** competitor · **±** depends on the event.
`;
for (const [status, title] of GROUPS) {
  const group = notes.filter((n) => n.status === status).sort((a, b) => a.name.localeCompare(b.name));
  if (!group.length) continue;
  md += `\n## ${title} (${group.length})\n`;
  for (const n of group) {
    md += `\n### ${n.name}\n`;
    md += n.reads_through.length
      ? `- **Reads through to:** ${n.reads_through.map((r) => `${r.ticker} ${DIR[r.direction] || r.direction} (${r.why})`).join("; ")}\n`
      : `- **Reads through to:** none direct — context only\n`;
    md += `- **Matters:** ${n.matters}\n`;
    md += `- **Usually noise:** ${n.noise}\n`;
    if (n.status_note) md += `- **Status:** ${n.status_note}\n`;
  }
}
writeFileSync(join(root, "rubric", "peers.md"), md);
console.log(`peers.md: ${notes.length} companies, ${md.length} chars`);
