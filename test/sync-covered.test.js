// scripts/sync-covered.mjs: covered keys from the covered lane and from
// coveredTicker declarations; counterparty routing from role/affects on any
// source, COUNTERPARTY_SOURCES and the existing-source routing.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCovered } from "../scripts/sync-covered.mjs";

const SOURCES = [
  { key: "redcat", lane: "covered", covered: true, coveredTicker: "RCAT" },
  { key: "edgar_rcat", lane: "covered", covered: true, coveredTicker: "RCAT" },
  // A covered deck feed on an hourly cadence, declared only by coveredTicker.
  { key: "ondas_presentations", lane: "public_adjacent", coveredTicker: "onds", coveredCadence: "hourly" },
  { key: "unusual", lane: "covered", covered: true, coveredTicker: "UMAC" },
  // Counterparty sources declared in any stream's file.
  { key: "walmart_news", lane: "public_adjacent", role: "customer", affects: ["SYM"] },
  { key: "drone_dominance", lane: "strategic_fast_noncompany", role: "program", affects: ["RCAT", "UMAC", "PUSA"] },
  { key: "doordash", lane: "public_adjacent" },
  { key: "joby", lane: "public_adjacent" },
  { key: "bad_role", lane: "secondary_noncompany", role: "friend", affects: ["RCAT"] },
  { key: "maymobility_news", lane: "private_adjacent", route: "watchlist" },
  { key: "symbotic", lane: "covered", covered: true, coveredTicker: "SYM" },
];

test("covered keys come from the covered lane and from coveredTicker", () => {
  const { tickers, sources } = buildCovered(SOURCES);
  assert.deepEqual(tickers, ["ONDS", "RCAT", "SYM", "UMAC"]);
  assert.equal(sources.ondas_presentations, "ONDS");
  assert.equal(sources.edgar_rcat, "RCAT");
  assert.equal(sources.maymobility_news, undefined, "watchlist peers are not graded");
});

test("role and affects are read from every source, the counterparty list and the existing routing", () => {
  const { counterparty, warnings } = buildCovered(SOURCES, {
    counterpartySources: [{ key: "doordash", role: "relationship", affects: ["SERV", "SYM"] }],
    existing: { joby: { role: "rival", affects: ["MRLN", "SRFM"] }, gone: { role: "rival", affects: ["RCAT"] }, redcat: { role: "rival", affects: ["UMAC"] } },
  });
  assert.deepEqual(counterparty.walmart_news, { role: "customer", affects: ["SYM"] });
  assert.deepEqual(counterparty.drone_dominance, { role: "program", affects: ["RCAT", "UMAC"] });
  assert.deepEqual(counterparty.doordash, { role: "relationship", affects: ["SYM"] });
  assert.equal(counterparty.joby, undefined, "affects nothing covered here");
  assert.equal(counterparty.bad_role, undefined);
  assert.equal(counterparty.gone, undefined, "not a polled source");
  assert.equal(counterparty.redcat, undefined, "a covered company's own source is never a counterparty");
  assert.ok(warnings.some((w) => w.startsWith("bad_role:")));
  assert.ok(warnings.some((w) => w.startsWith("gone:")));
  assert.ok(warnings.some((w) => w.includes("PUSA not covered")));
});
