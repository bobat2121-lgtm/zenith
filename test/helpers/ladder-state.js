// Phase 2, industry ladder (core.md section 9A): which state the repo's rubric is in.
// PR-C4 bundles the ladder as the candidate overlay (rubric/candidate/); PR-C5 runs
// build-rubric.mjs --promote-candidate, which makes it live. Later rubric changes may
// cut a new overlay after that (spec section 6, D3), so whether rubric/candidate/
// exists says nothing about the ladder. The state is read from the live rubric itself:
// the ladder is live when the live core.md has its section 9A heading.
//   live           the ladder is live (live core.md has a "## 9A." heading line)
//   overlay        rubric/candidate/ exists (any overlay, the ladder's or a later one)
//   ladderOverlay  the ladder is not live and the overlay is the ladder overlay (its
//                  core.md has the 9A heading): only then do assertions about the
//                  overlay's own content (CANDIDATE_INDUSTRY, its sheet set) apply
//   ladderDir      where the ladder text is: ["rubric"] once live, else the overlay
// The drafted industry_links entries are the owner's decision C-O2 (spec section 5.4),
// approved as drafted; their text is already public in the rubric overlay.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));
export const LADDER_SHEETS = ["AUR", "KDK", "PL", "SATL", "SYM"];

const SPACE = {
  id: "space_licensing", kind: "regulator",
  area: "US licensing, spectrum and market-access rules for Earth-observation satellites and their ground stations (FCC Space Bureau earth-station and Earth-exploration downlink rules; NOAA commercial remote-sensing licences) and US export controls on spacecraft and remote-sensing items (BIS EAR, State ITAR Category XV)",
  actors: "FCC, NOAA, BIS, State", core: true,
};
const ROBOTICS = {
  id: "robotics_trade", kind: "policy",
  area: "US trade actions on imported industrial robots, warehouse automation systems and their components (Section 232 findings and proclamations, tariffs, quotas)",
  actors: "President, Commerce/BIS, USTR", core: false,
};
const AV_TRUCK = {
  id: "av_truck_rules", kind: "regulator",
  area: "FMCSA and NHTSA rules, standards, exemptions of general application and guidance for driverless (ADS-equipped) trucks: warning devices, inspections, hours and operations, FMVSS for ADS-equipped vehicles, the AV framework",
  actors: "FMCSA, NHTSA, DOT", core: true,
};
// Spec section 5.4, "Draft industry_links entries": {T: {id, kind, area, actors, core}}.
export const LADDER_LINKS = { AUR: AV_TRUCK, KDK: AV_TRUCK, PL: SPACE, SATL: SPACE, SYM: ROBOTICS };
// The same entries as INDUSTRY / CANDIDATE_INDUSTRY bundle them: {T: {id: {core}}}.
export const LADDER_INDUSTRY = Object.fromEntries(Object.entries(LADDER_LINKS).map(([t, l]) => [t, { [l.id]: { core: l.core } }]));

const has9A = (path) => existsSync(path) && /^## 9A\./m.test(readFileSync(path, "utf8"));

export function ladderState(root = REPO) {
  const live = has9A(join(root, "rubric", "core.md"));
  const overlay = existsSync(join(root, "rubric", "candidate"));
  const ladderOverlay = !live && overlay && has9A(join(root, "rubric", "candidate", "core.md"));
  return { live, overlay, ladderOverlay, ladderDir: live ? ["rubric"] : ["rubric", "candidate"] };
}
