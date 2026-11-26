// --- Floors (core.md section 6) -----------------------------------------------
// No imports: lib.js re-exports parseFloors, and scripts/build-rubric.mjs uses
// it to bundle a candidate rubric's floors (CANDIDATE_FLOORS).
// Reads the floor table from the bundled core.md, so the API enforces exactly
// the floors the grader reads: { id: { floor, fixed, undisclosed } }.
//   fixed:       "75 fixed" (the score is the floor, not a minimum)
//   undisclosed: the lower floor that applies while the value V is undisclosed
export function parseFloors(coreMd) {
  const text = String(coreMd || "").replace(/\r\n/g, "\n");
  const start = text.search(/^## 6\.[^\n]*floors/im);
  if (start === -1) return {};
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = end === -1 ? rest : rest.slice(0, end);
  const floors = {};
  for (const m of section.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|([^\n]*)\|\s*(\d{1,3})\s*(fixed)?\s*\|\s*$/gm)) {
    const undisclosed = /\((\d{1,3}) while V is undisclosed\)/i.exec(m[2]);
    floors[m[1]] = { floor: Number(m[3]), fixed: Boolean(m[4]), undisclosed: undisclosed ? Number(undisclosed[1]) : null };
  }
  return floors;
}
