// Phase 2, golden-set replay (synthetic fixtures only): the shared coverage
// claimable predicate (claimable.js), the industry ladder check in
// normalizeGrade, and the replay harness routes (replay.js).
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { coverageClaimableSql } = await import("../worker/src/claimable.js");
const { HELD_SQL, normalizeGrade } = await import("../worker/src/lib.js");
const { BILL_HOLD_SQL } = await import("../worker/src/bill-lines.js");

const newEnv = (extra = {}) => ({ DB: zenithDb(), ...TOKENS, ...extra });

// --- T3b: the claim SQL is unchanged ------------------------------------------------------------
test("T3b: the coverage claim built with coverageClaimableSql is string-equal to the inline text it replaced", async () => {
  const inline = `(state='pending' OR (state='claimed' AND claimed_until < ?3)) AND ${BILL_HOLD_SQL("?5")} AND NOT ${HELD_SQL()}`;
  assert.equal(coverageClaimableSql("?3", "?5"), inline);
  const before = `UPDATE items SET state='claimed', claim_id=?1, claimed_until=?2, attempts=attempts+1
      WHERE id IN (SELECT id FROM items WHERE (state='pending' OR (state='claimed' AND claimed_until < ?3)) AND ${BILL_HOLD_SQL("?5")} AND NOT ${HELD_SQL()}
                    ORDER BY (excerpt_status IS NULL), nm_first_seen DESC, id DESC LIMIT ?4)
        AND (state='pending' OR (state='claimed' AND claimed_until < ?3))`;
  const env = newEnv();
  const seen = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const r = await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 5, run_id: "run-sql" } });
  assert.equal(r.status, 200);
  assert.ok(seen.includes(before), "the claim UPDATE is byte-identical to the pre-phase-2 text");
});

// --- T12: the industry ladder in normalizeGrade --------------------------------------------------
test("T12: industry:<id> must be declared for the grade's ticker; the ceiling is 74 for a core entry and 69 otherwise", () => {
  const INDUSTRY = { SYN: { trade_x: { core: false }, rules_y: { core: true } } };
  const item = { id: 7, ticker: "SYN", title: "A synthetic agency action", published: "2026-01-01T00:00:00Z", first_seen: "2026-01-01T01:00:00Z" };
  const g = (score, flag) => ({ item_id: "7", score, why: "w", read_source: true, confidence: 0.7, flags: ["reason:material", flag] });
  const check = (score, flag, industry = INDUSTRY) => normalizeGrade(g(score, flag), item, null, ["SYN"], null, { industry });
  assert.match(check(50, "industry:nope").error, /unknown industry link nope for SYN \(core\.md section 9A\)/);
  assert.match(check(70, "industry:trade_x").error, /industry ladder ceiling/);
  assert.equal(check(69, "industry:trade_x").ok, true);
  assert.match(check(75, "industry:rules_y").error, /industry ladder ceiling/);
  assert.equal(check(74, "industry:rules_y").ok, true);
  assert.match(check(50, "industry:rules_y", {}).error, /unknown industry link/, "an empty map rejects every industry flag");
  assert.match(check(50, "industry:constructor").error, /unknown industry link/, "only own keys count");
  assert.equal(normalizeGrade(g(90, "industry:nope"), item, null, ["SYN"], null).ok, true, "five arguments: not checked (unchanged callers)");
});
