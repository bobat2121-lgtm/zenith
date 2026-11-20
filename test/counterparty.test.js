import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phraseRegex, routeCounterparty } from "../worker/src/lib.js";
import { MATCH } from "../worker/src/rubric.generated.js";

const covered = JSON.parse(readFileSync(new URL("../worker/src/covered.json", import.meta.url), "utf8"));

test("phrases match whole words, case-insensitively", () => {
  const re = phraseRegex(["Axon", "$SERV", "Merlin Labs, Inc."]);
  assert.ok(re.test("AXON wins Phoenix body-camera deal"));
  assert.ok(!re.test("Axonics reports quarterly results"));
  assert.ok(re.test("Shares of $SERV jump"));
  assert.ok(re.test("merlin labs, inc. files S-1"));
  assert.equal(phraseRegex([]), null);
  assert.equal(phraseRegex(["ab"]), null, "phrases under 3 characters are ignored");
});

test("rival items need the covered company or a key account in the title", () => {
  const match = { AUR: { terms: ["Aurora Innovation"], accounts: ["Hirschbach", "Werner"] }, KDK: { terms: ["Kodiak AI"], accounts: ["IKEA"] } };
  const rival = { role: "rival", affects: ["AUR", "KDK"] };
  assert.deepEqual(routeCounterparty("Bot Auto raises Series B", rival, match),
    { ticker: "AUR", role: "rival", affects: "AUR,KDK", skip: "rival_no_key_account" });
  const ikea = routeCounterparty("Bot Auto signs IKEA for driverless lanes", rival, match);
  assert.equal(ikea.ticker, "KDK");
  assert.equal(ikea.skip, null);
  assert.equal(routeCounterparty("Werner picks Bot Auto", rival, match).ticker, "AUR");
});

test("customer, relationship and index items are always queued", () => {
  const match = { SYM: { terms: ["Symbotic"], accounts: ["Albertsons"] } };
  for (const role of ["customer", "relationship", "program", "index_event"]) {
    const r = routeCounterparty("Albertsons opens a new distribution center", { role, affects: ["SYM"] }, match);
    assert.equal(r.skip, null, role);
    assert.equal(r.ticker, "SYM");
  }
});

test("tickers outside coverage are dropped from affects", () => {
  const match = { EVLV: { terms: ["Evolv Technologies"], accounts: [] } };
  assert.equal(routeCounterparty("x", { role: "rival", affects: ["SSTI"] }, match), null);
  assert.equal(routeCounterparty("x", { role: "customer", affects: ["SSTI", "EVLV"] }, match).affects, "EVLV");
});

test("covered.json counterparty map only names covered tickers and polled roles", () => {
  const roles = new Set(["relationship", "customer", "program", "rival", "index_event"]);
  for (const [key, cp] of Object.entries(covered.counterparty || {})) {
    assert.ok(roles.has(cp.role), `${key} role ${cp.role}`);
    assert.ok(cp.affects.length, `${key} affects`);
    for (const t of cp.affects) assert.ok(covered.tickers.includes(t), `${key} affects uncovered ${t}`);
    assert.ok(!covered.sources[key], `${key} is also a covered source`);
  }
  assert.ok(!covered.tickers.includes("SSTI") && !covered.tickers.includes("REKR"), "SSTI and REKR left coverage on 2026-11-20");
});

test("every covered ticker has match terms, and key accounts come from its sheet", () => {
  for (const t of covered.tickers) {
    assert.ok(MATCH[t]?.terms.length, `${t} has sheet terms`);
    const sheet = readFileSync(new URL(`../rubric/companies/${t}.md`, import.meta.url), "utf8").toLowerCase();
    for (const a of MATCH[t].accounts) assert.ok(sheet.includes(a.toLowerCase()), `${t} key account "${a}" appears in its sheet`);
  }
});
