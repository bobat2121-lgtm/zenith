// The coverage claimable predicate, in one place (phase 2, golden-set replay).
// index.js claim() and replay.js (the live_coverage check before any replay
// claim) both use it, so a replay never runs while a live coverage row is
// claimable. The SQL is string-identical to the predicate the claim used inline:
// pending, or claimed with an expired lease; not a bill item still inside its
// autonomy-lines hold (bill-lines.js BILL_HOLD_SQL); not a held row (lib.js
// HELD_SQL: admitted by the arrival gate, not yet released by budget.js).
//   nowP:    the SQL parameter holding the current time ("?3")
//   cutoffP: the SQL parameter holding now minus HOLD_MINUTES ("?5")
import { HELD_SQL } from "./lib.js";
import { BILL_HOLD_SQL } from "./bill-lines.js";

export function coverageClaimableSql(nowP, cutoffP) {
  return `(state='pending' OR (state='claimed' AND claimed_until < ${nowP})) AND ${BILL_HOLD_SQL(cutoffP)} AND NOT ${HELD_SQL()}`;
}
