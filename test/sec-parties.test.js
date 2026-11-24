// Round 5, Part B of plans/round5-expansion-approve-queue.md: SEC party
// extraction from covered companies' own filings into expansion_candidates.
// Pages come from test/fixtures/sec-parties.json (hand-made, EDGAR-shaped);
// globalThis.fetch is stubbed and a URL outside the fixture fails the test,
// so sec.gov is never fetched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, newsDb, TOKENS } from "./helpers/worker-env.js";

hookJsonImports();
const S = await import("../worker/src/sec-parties.js");
const { upsertSightings } = await import("../worker/src/expansion.js");
const { refreshSecExcerpts } = await import("../worker/src/excerpt.js");
const { secParties, partyFrom, preambleParties, eightKParties, ex21Names, indexRows, pickDocuments, qualify, parseFilingTitle,
  CURSOR_META, SEED_META, PAUSE_META, TRIES_META } = S;

const FIX = JSON.parse(readFileSync(new URL("./fixtures/sec-parties.json", import.meta.url), "utf8")).pages;
const A = "https://www.sec.gov/Archives/edgar/data";
const CONTACT = "test-contact@example.com";
const UA = `zenith-core ${CONTACT}`;
const UMAC_URL = `${A}/1956955/000168316826008046/umac_8k.htm`;
const UMAC_INDEX = `${A}/1956955/000168316826008046/0001683168-26-008046-index.htm`;
const RCAT_URL = `${A}/1748790/000164117226051234/rcat-20260930.htm`;
const RCAT_DIR = `${A}/1748790/000164117226051234/`;

const newEnv = (over = {}) => ({ DB: zenithDb(), NEWS: newsDb(), ...TOKENS, CONTACT_EMAIL: CONTACT, ...over });
const meta = (env, key) => env.DB.rows("SELECT value FROM meta WHERE key = ?", key)[0]?.value ?? null;
const setMeta = (env, key, value) => env.DB.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
const rows = (env) => env.DB.rows("SELECT * FROM expansion_candidates ORDER BY id").map((r) => ({
  ...r, origins: JSON.parse(r.origins), tickers: JSON.parse(r.tickers), seen: JSON.parse(r.seen), evidence: JSON.parse(r.evidence),
  known: r.known == null ? null : JSON.parse(r.known),
}));

let nmRow = 0;
function addItem(env, over = {}) {
  const it = { source_key: "edgar_rcat", ticker: "RCAT", url: RCAT_URL, title: "Red Cat Holdings, Inc.: 10-Q filed 2026-11-12", role: null,
    nm_first_seen: "2026-11-24T10:00:00.000Z", state: "pending", ...over };
  const cols = ["nm_rowid", "source_key", "ticker", "url", "title", "nm_first_seen", "ingested_at", "state", "role"];
  const vals = [++nmRow, it.source_key, it.ticker, it.url, it.title, it.nm_first_seen, it.nm_first_seen, it.state, it.role];
  if (it.id != null) { cols.unshift("id"); vals.unshift(it.id); }
  const r = env.DB.db.prepare(`INSERT INTO items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
  return Number(r.lastInsertRowid);
}
// Starts the pass after the given item id, with no seed (the first-run cursor
// and seed have their own test).
const startAt = (env, id = 0) => setMeta(env, CURSOR_META, id);

// The sec.gov stub: fixture pages by URL, plus per-URL status overrides.
// Every request is recorded with its User-Agent.
async function withSec(pages, run, { status = {}, onFetch } = {}) {
  const real = globalThis.fetch;
  const calls = [], unknown = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, ua: init.headers?.["user-agent"] });
    if (onFetch) await onFetch(u, calls.length);
    const st = typeof status[u] === "function" ? status[u](calls) : status[u];
    if (st) return new Response("refused", { status: st, headers: { "content-type": "text/html" } });
    if (pages[u] == null) { unknown.push(u); return new Response("not in fixture", { status: 500, headers: { "content-type": "text/html" } }); }
    return new Response(pages[u], { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try {
    const out = await run(calls);
    assert.deepEqual(unknown, [], "every request is a fixture page");
    return out;
  } finally {
    globalThis.fetch = real;
  }
}

// --- Party rules (B4) ---------------------------------------------------------
test("party names: d/b/a and doing business as, the trims, people, references and covered names", () => {
  assert.deepEqual(partyFrom("DroneNX LLC d/b/a Upgrade Energy, a Florida limited liability company"),
    { name: "Upgrade Energy", aliases: ["DroneNX LLC"], party: "DroneNX LLC d/b/a Upgrade Energy" });
  assert.deepEqual(partyFrom("Foo Robotics LLC doing business as Bar Aerial"), { name: "Bar Aerial", aliases: ["Foo Robotics LLC"], party: "Foo Robotics LLC doing business as Bar Aerial" });
  assert.equal(partyFrom("Acme Robotics, Inc., a Delaware corporation").name, "Acme Robotics", "trimmed at the comma");
  assert.equal(partyFrom("Northwind Aerial Systems Corp a Delaware corporation").name, "Northwind Aerial Systems Corp", 'trimmed at " a Delaware corporation"');
  assert.equal(partyFrom("Hawkeye Sensors LLC (formerly Hawk Optics)").name, "Hawkeye Sensors LLC", 'trimmed at "("');
  assert.equal(partyFrom("Vantage Drone Works LLC to supply airframes to the Army").name, "Vantage Drone Works LLC", "a legal name ends at its suffix");
  assert.equal(partyFrom("Matthew Barnard"), null, "a person shows no entity");
  assert.equal(partyFrom("the U.S. Army"), null, "a government buyer shows no entity");
  assert.equal(partyFrom("the Company"), null, "a defined-term reference");
  for (const ref of ["its Subsidiary Company", "such Company", "Company", "Acme Merger Sub, Inc."]) assert.equal(partyFrom(ref), null, ref);
  assert.equal(partyFrom("Unusual Machines, Inc., a Nevada corporation"), null, "a covered name (the subject)");
  assert.equal(partyFrom("Red Cat Holdings, Inc."), null, "a covered name");
  assert.equal(partyFrom("Ondas Holdings Inc."), null, "a covered name (first terms entry)");
});

test("8-K sections: Item 2.01 gives acquired, Item 1.01 partner; a 1.01 credit agreement is skipped; the title's item list decides", () => {
  const supply = 'Item 1.01 Entry into a Material Definitive Agreement.\nOn May 1, 2026, Red Cat Holdings, Inc. (the "Company") entered into a Supply Agreement with Acme Robotics, Inc., a Delaware corporation ("Acme"), for flight controllers.\nItem 9.01 Financial Statements and Exhibits.';
  assert.deepEqual(eightKParties(supply, ["1.01", "9.01"]).parties.map((p) => [p.name, p.relation]), [["Acme Robotics", "partner"]]);
  assert.deepEqual(eightKParties(supply, ["2.01"]).parties, [], "only the items the title lists");
  assert.deepEqual(eightKParties(supply, null).parties.map((p) => p.name), ["Acme Robotics"], "no list: the headings decide");
  const credit = 'Item 1.01 Entry into a Material Definitive Agreement.\nOn May 1, 2026, the Company entered into a Credit Agreement with Big Lender Capital LLC, as administrative agent, and the lenders party thereto.\nItem 2.03 Creation of a Direct Financial Obligation.';
  assert.deepEqual(eightKParties(credit, null).parties, [], "financing rule on the first 600 characters");
  const noDeal = "Item 1.01 Entry into a Material Definitive Agreement.\nIn connection with the closing, the Company met with Acme Robotics, Inc. officials.";
  assert.deepEqual(eightKParties(noDeal, null).parties, [], "a list keyword needs a deal word before it");
});

test("Item 2.01 acquisition wording: the target, never the words before it", () => {
  const k8 = (body) => [...new Set(eightKParties(`Item 2.01 Completion of Acquisition or Disposition of Assets.\n${body}\nItem 9.01 Financial Statements and Exhibits.`, null)
    .parties.map((p) => `${p.name}|${p.relation}`))];
  assert.deepEqual(k8("On May 1, 2026, the Company acquired all of the issued and outstanding shares of capital stock of Acme Robotics, Inc., a Delaware corporation."),
    ["Acme Robotics|acquired"], '"all of the ... of" runs to the last "of"');
  assert.deepEqual(k8("On May 1, 2026, the Company acquired all outstanding equity interests of Acme Robotics, Inc., a Delaware corporation."),
    ["Acme Robotics|acquired"], '"all ... of" without "of the"');
  assert.deepEqual(k8("On May 1, 2026, Foo Merger Sub, Inc. completed its merger with and into Target Systems Corp., with Target Systems Corp. surviving."),
    ["Target Systems Corp.|acquired"], '"merger with and into"');
  assert.deepEqual(k8("On May 1, 2026, the Company completed the acquisition of substantially all of the assets of Foo Bar LLC."), ["Foo Bar LLC|acquired"]);
  assert.equal(partyFrom("capital stock of Acme Robotics, Inc."), null, "a prose party must start with a capital or a digit");
  assert.equal(partyFrom("into Target Systems Corp."), null);
  assert.equal(partyFrom("iRobot Corporation").name, "iRobot Corporation", "lower then upper still starts a name");
});

test("a comma-separated party list splits at each comma before a capital, but not before a legal suffix", () => {
  const k1 = (body) => eightKParties(`Item 1.01 Entry into a Material Definitive Agreement.\n${body}\nItem 9.01 Financial Statements and Exhibits.`, null)
    .parties.map((p) => p.name);
  assert.deepEqual(k1("On May 1, 2026, the Company entered into an Asset Purchase Agreement by and among the Company, Foo Holdings, LLC and John Doe."),
    ["Foo Holdings"], '"Foo Holdings, LLC" is one party; the Company and the person drop');
  assert.deepEqual(k1("On May 1, 2026, the Company entered into a Supply Agreement by and among the Company, Foo Corp. and Bar Inc."), ["Foo Corp.", "Bar Inc."]);
  assert.deepEqual(S.splitList("Foo Holdings, LLC, Acme, Inc., Beta Systems, L.P. and Bar S.A."), ["Foo Holdings, LLC", "Acme, Inc.", "Beta Systems, L.P.", "Bar S.A."]);
});

test("contract preambles: the first party sentence in the first 6,000 characters", () => {
  const text = 'Exhibit 2.1\nAGREEMENT AND PLAN OF MERGER\nThis Agreement and Plan of Merger is made by and among Ondas Holdings Inc., a Nevada corporation ("Parent"), Stemme Merger Sub GmbH, a German company ("Merger Sub"), and Stemme AG, a German stock corporation (the "Company").';
  assert.deepEqual(preambleParties(text).map((p) => p.name), ["Stemme AG"], "parent covered, merger sub a role");
  assert.deepEqual(preambleParties(`${"x ".repeat(3100)}by and between Late Party LLC and Other Party Inc.`), [], "past 6,000 characters");
});

test("EX-21 names: a legal suffix is needed, the jurisdiction column is cut, covered names drop", () => {
  const names = ex21Names("SUBSIDIARIES OF AXON ENTERPRISE, INC.\nName of Subsidiary Jurisdiction of Organization\nAxon Public Safety UK Limited United Kingdom\nCarbyne Ltd. Israel\nAxon Enterprise, Inc. Delaware\nSky-Hero SA Belgium");
  assert.deepEqual([...names.keys()], ["axon public safety uk", "carbyne"]);
  assert.equal(names.get("axon public safety uk").name, "Axon Public Safety UK Limited");
});

test("titles and B1: forms, item lists, sources and URLs", () => {
  assert.deepEqual(parseFilingTitle("Unusual Machines, Inc.: 8-K filed 2026-10-23"), { company: "Unusual Machines, Inc.", form: "8-K", items: null, filed: "2026-10-23" });
  assert.deepEqual(parseFilingTitle("Ondas Holdings Inc.: 8-K [Items 1.01, 9.01] filed 2026-11-23").items, ["1.01", "9.01"]);
  const base = { source_key: "unusual", role: null, url: UMAC_URL };
  assert.deepEqual(qualify({ ...base, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23" }), { ticker: "UMAC", cik: "1956955", form: "8-K", items: null, filed: "2026-10-23" });
  assert.ok(qualify({ ...base, title: "Unusual Machines, Inc.: 8-K/A [Items 2.01, 9.01] filed 2026-10-30" }));
  assert.ok(qualify({ ...base, title: "Unusual Machines, Inc.: 10-K/A filed 2026-10-30" }));
  for (const [why, it] of [
    ["8-K Items 2.02 only", { ...base, title: "Unusual Machines, Inc.: 8-K [Items 2.02, 9.01] filed 2026-11-12" }],
    ["6-K", { ...base, title: "Unusual Machines, Inc.: 6-K filed 2026-11-12" }],
    ["10-Q/A", { ...base, title: "Unusual Machines, Inc.: 10-Q/A filed 2026-11-12" }],
    ["strive_sec_northland", { ...base, source_key: "strive_sec_northland", title: "Strive, Inc.: 8-K filed 2026-11-12" }],
    ["counterparty item", { ...base, role: "relationship", title: "Unusual Machines, Inc.: 8-K filed 2026-11-12" }],
    ["not an edgar source", { ...base, source_key: "unusual_press", title: "Unusual Machines, Inc.: 8-K filed 2026-11-12" }],
    ["not a filing folder", { ...base, url: "https://www.sec.gov/cgi-bin/browse-edgar?CIK=1956955", title: "Unusual Machines, Inc.: 8-K filed 2026-11-12" }],
  ]) assert.equal(qualify(it), null, why);
});

test("exhibits by Type, never by file name; people and financing EX-10s are not chosen", () => {
  const rows = indexRows(FIX[`${RCAT_DIR}0001641172-26-051234-index.htm`], `${RCAT_DIR}0001641172-26-051234-index.htm`);
  assert.equal(rows.find((r) => r.url.endsWith("/ex21.htm")).type, "EX-10.1");
  assert.equal(rows.find((r) => r.url.endsWith("/ex2-1.htm")).type, "GRAPHIC");
  const docs = pickDocuments(rows, "10-Q");
  assert.deepEqual(docs.contracts.map((c) => [c.url.split("/").pop(), c.relation]), [["ex21.htm", "partner"], ["ex10-4.htm", "partner"]]);
  assert.equal(docs.ex21, null, "EX-21 on 10-K and 10-K/A only");
  assert.equal(docs.primary, null);
  const umac = pickDocuments(indexRows(FIX[UMAC_INDEX], UMAC_INDEX), "8-K");
  assert.equal(umac.primary, UMAC_URL);
  assert.deepEqual(umac.contracts, []);
});

// --- The pass ---------------------------------------------------------------------
test("Upgrade Energy: the UMAC 8-K (item 18, no item list) gives one acquired row with its legal name as party", async () => {
  const env = newEnv();
  addItem(env, { id: 18, source_key: "unusual", ticker: "UMAC", url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23", nm_first_seen: "2026-10-23T21:05:00.000Z", state: "graded" });
  addItem(env, { id: 40, source_key: "edgar_rcat", title: "Red Cat Holdings, Inc.: 8-K [Items 2.02, 9.01] filed 2026-11-12", url: `${A}/1748790/000164117226050001/rcat-8k.htm` });
  const res = await withSec(FIX, async (calls) => {
    const r = await secParties(env);
    assert.deepEqual(calls.map((c) => c.url), [UMAC_INDEX, UMAC_URL], "index, then the 8-K document chosen by its Type");
    assert.ok(calls.every((c) => c.ua === UA), "the SEC User-Agent on every request");
    return r;
  });
  assert.equal(res.stopped, null);
  assert.equal(res.filings, 1);
  assert.equal(res.requests, 2);
  assert.equal(res.candidates, 1);
  const all = rows(env);
  assert.equal(all.length, 1, "no DroneNX row, no Unusual Machines row");
  const r = all[0];
  assert.equal(r.name, "Upgrade Energy");
  assert.equal(r.relation, "acquired");
  assert.equal(r.subject, "UMAC");
  assert.deepEqual(r.tickers, ["UMAC"]);
  assert.deepEqual(r.known, ["sheet_term:UMAC"]);
  assert.equal(r.status, "pending");
  assert.deepEqual(r.origins, ["sec_filing"]);
  assert.deepEqual(r.seen, ["coverage:18"]);
  assert.deepEqual(r.evidence, [{ kind: "coverage", item_id: 18, url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23",
    at: "2026-10-23T21:05:00.000Z", origin: "sec_filing", party: "DroneNX LLC d/b/a Upgrade Energy" }]);
  // The first run started at MAX(id) = 40 plus the seed [18]; the seed is gone.
  assert.equal(meta(env, CURSOR_META), "40");
  assert.equal(meta(env, SEED_META), null);
  assert.equal(meta(env, "sec_refresh_until"), null, "the lease is released");

  // A Part A relation on the same item: one row, both origins, sightings 1.
  const a = await upsertSightings(env.DB, [{ name: "Upgrade Energy", origin: "grader_relation", relation: "acquired", subject: "UMAC", tickers: ["UMAC"],
    kind: "coverage", item_id: 18, url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23", at: "2026-10-23T21:05:00.000Z" }]);
  assert.equal(a.ok, true);
  const after = rows(env);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].origins, ["sec_filing", "grader_relation"]);
  assert.equal(after[0].seen.length, 1);
});

test("Part A first, then the seed read: still one row, sightings 1", async () => {
  const env = newEnv();
  addItem(env, { id: 18, source_key: "unusual", ticker: "UMAC", url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23" });
  await upsertSightings(env.DB, [{ name: "Upgrade Energy", origin: "grader_relation", relation: "acquired", subject: "UMAC", tickers: ["UMAC"], kind: "coverage", item_id: 18 }]);
  await withSec(FIX, () => secParties(env));
  const r = rows(env);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].origins.sort(), ["grader_relation", "sec_filing"]);
  assert.equal(r[0].seen.length, 1);
});

test("a 10-Q: contract exhibits by Type, two at most, people and financing exhibits never fetched", async () => {
  const env = newEnv();
  startAt(env);
  addItem(env);
  const res = await withSec(FIX, async (calls) => {
    const r = await secParties(env);
    assert.deepEqual(calls.map((c) => c.url.split("/").pop()), ["0001641172-26-051234-index.htm", "ex21.htm", "ex10-4.htm"],
      "ex2-1.htm (GRAPHIC), the employment and credit agreements and the third contract are not fetched");
    return r;
  });
  assert.equal(res.requests, 3);
  const got = rows(env).map((r) => [r.name, r.relation, r.subject, r.evidence[0].url.split("/").pop()]);
  assert.deepEqual(got, [
    ["Skyfish Components GmbH", "partner", "RCAT", "ex21.htm"],
    ["Northwind Aerial Systems Corp", "partner", "RCAT", "ex10-4.htm"],
    ["Hawkeye Sensors LLC", "partner", "RCAT", "ex10-4.htm"],
  ], "an EX-10.1 named ex21.htm is read as a contract");
});

const axonItem = (env, acc, filed, form = "10-K") => addItem(env, { source_key: "edgar_axon", ticker: "AXON", url: `${A}/1069183/${acc}/axon-${filed.replaceAll("-", "")}.htm`,
  title: `Axon Enterprise, Inc.: ${form} filed ${filed}` });
const subs = (env) => env.DB.rows("SELECT * FROM sec_subsidiaries");

test("EX-21: first sight is a baseline, the next 10-K adds its new name, an older 10-K/A changes nothing, 21 new names re-baseline", async () => {
  const env = newEnv();
  startAt(env);
  const pages = { ...FIX };
  axonItem(env, "000106918326000011", "2026-02-25");
  let r = await withSec(pages, () => secParties(env));
  assert.equal(r.baselines, 1);
  assert.equal(r.candidates, 0);
  assert.equal(rows(env).length, 0, "the first 10-K makes no row (Carbyne sits in the baseline)");
  const stored = JSON.parse(subs(env)[0].names);
  assert.ok(stored.includes("axon public safety uk") && stored.includes("carbyne"));
  assert.ok(!stored.some((k) => /united kingdom|israel|delaware/.test(k)), "the jurisdiction column is cut");
  assert.ok(!stored.includes("axon enterprise"), "the covered parent drops");
  assert.equal(subs(env)[0].cik, "1069183");
  assert.equal(subs(env)[0].filed, "2026-02-25");

  axonItem(env, "000106918327000009", "2027-02-24");
  r = await withSec(pages, () => secParties(env));
  assert.equal(r.candidates, 1);
  const [row] = rows(env);
  assert.equal(row.name, "Prepared Robotics LLC");
  assert.equal(row.relation, "subsidiary");
  assert.equal(row.subject, "AXON");
  assert.equal(row.evidence[0].url, `${A}/1069183/000106918327000009/axon-ex211.htm`);
  assert.equal(subs(env)[0].filed, "2027-02-24");

  axonItem(env, "000106918325000020", "2025-03-01", "10-K/A");
  r = await withSec(pages, () => secParties(env));
  assert.equal(r.candidates, 0);
  assert.equal(rows(env).length, 1, "an older filing makes nothing");
  assert.equal(subs(env)[0].filed, "2027-02-24", "and keeps the stored list");
  assert.ok(!JSON.parse(subs(env)[0].names).includes("old sub"));

  // 21 new names in one diff: a format change.
  const acc = "000106918328000007";
  const dir = `${A}/1069183/${acc}/`;
  pages[`${dir}0001069183-28-000007-index.htm`] = FIX[`${A}/1069183/000106918327000009/0001069183-27-000009-index.htm`].replaceAll("000106918327000009", acc);
  pages[`${dir}axon-ex211.htm`] = `<html><body><table>${Array.from({ length: 21 }, (_, i) => `<tr><td>Axon Region ${i + 1} Limited</td><td>Ireland</td></tr>`).join("")}</table></body></html>`;
  addItem(env, { source_key: "edgar_axon", ticker: "AXON", url: `${dir}axon-20280220.htm`, title: "Axon Enterprise, Inc.: 10-K filed 2028-02-20" });
  r = await withSec(pages, () => secParties(env));
  assert.equal(r.rebaselined, 1);
  assert.equal(r.candidates, 0);
  assert.equal(rows(env).length, 1, "no rows from a re-baseline");
  assert.ok(r.warnings.some((w) => /format change/.test(w)), "the pass result says so");
  assert.equal(JSON.parse(subs(env)[0].names).length, 21, "the new list is the baseline");
});

// --- Fetch path, stop rule and bounds (B7) --------------------------------------
test("without CONTACT_EMAIL no request is made and nothing moves", async () => {
  const env = newEnv({ CONTACT_EMAIL: undefined });
  addItem(env);
  const r = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 0); return r; });
  assert.match(r.skipped, /CONTACT_EMAIL/);
  assert.equal(meta(env, CURSOR_META), null);
});

for (const code of [403, 429]) {
  test(`a ${code} stops the pass after that request, pauses it for 60 minutes and keeps the cursor`, async () => {
    const env = newEnv();
    startAt(env);
    addItem(env);
    addItem(env, { url: `${A}/1748790/000164117226059999/rcat-10q2.htm` });
    const now = Date.parse("2026-11-24T12:00:00.000Z");
    const r = await withSec(FIX, async (calls) => {
      const r = await secParties(env, { now });
      assert.equal(calls.length, 2, "the index, then the refused exhibit; nothing after");
      return r;
    }, { status: { [`${RCAT_DIR}ex21.htm`]: code } });
    assert.equal(r.stopped, `http_${code}`);
    assert.equal(meta(env, PAUSE_META), "2026-11-24T13:00:00.000Z");
    assert.equal(meta(env, CURSOR_META), "0", "the filing is not done");
    assert.deepEqual(JSON.parse(meta(env, TRIES_META)), { item_id: 1, n: 1 });
    assert.equal(rows(env).length, 0, "a stopped filing writes no candidate");
    assert.equal(meta(env, "sec_refresh_until"), null, "the lease is released");
    // Paused: the next tick makes no request.
    const again = await withSec(FIX, async (calls) => { const x = await secParties(env, { now: now + 30 * 60_000 }); assert.equal(calls.length, 0); return x; });
    assert.equal(again.skipped, "paused");
  });
}

test("a 5xx or a timeout stops this tick only; three failed ticks skip the filing", async () => {
  const env = newEnv();
  startAt(env);
  addItem(env);
  const idx = `${RCAT_DIR}0001641172-26-051234-index.htm`;
  for (let tick = 1; tick <= 3; tick++) {
    const r = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 1); return r; }, { status: { [idx]: 503 } });
    assert.equal(r.stopped, "http_503");
    assert.equal(meta(env, PAUSE_META), null, "no pause for a 5xx");
    if (tick < 3) {
      assert.equal(meta(env, CURSOR_META), "0");
      assert.deepEqual(JSON.parse(meta(env, TRIES_META)), { item_id: 1, n: tick });
    } else {
      assert.deepEqual(r.skipped_filings, [1]);
      assert.equal(meta(env, CURSOR_META), "1", "skipped after the third failed tick");
      assert.equal(meta(env, TRIES_META), null);
    }
  }
});

test("a 404 skips that one document and the filing is done", async () => {
  const env = newEnv();
  startAt(env);
  addItem(env);
  const r = await withSec(FIX, () => secParties(env), { status: { [`${RCAT_DIR}ex21.htm`]: 404 } });
  assert.equal(r.stopped, null);
  assert.deepEqual(rows(env).map((x) => x.name), ["Northwind Aerial Systems Corp", "Hawkeye Sensors LLC"]);
  assert.equal(meta(env, CURSOR_META), "1");
});

// A simple qualifying 8-K (Items 1.01) with its own index and document.
function eightK(pages, n) {
  const acc = `0001894954260${String(n).padStart(5, "0")}`;
  const dir = `${A}/1894954/${acc}/`;
  const dashed = `${acc.slice(0, 10)}-${acc.slice(10, 12)}-${acc.slice(12)}`;
  pages[`${dir}${dashed}-index.htm`] = `<table><tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr><tr><td>1</td><td>8-K</td><td><a href="/Archives/edgar/data/1894954/${acc}/onds-8k.htm">onds-8k.htm</a></td><td>8-K</td><td>1</td></tr></table>`;
  pages[`${dir}onds-8k.htm`] = `<p>Item 1.01 Entry into a Material Definitive Agreement.</p><p>On November ${n}, 2026, Ondas Holdings Inc. entered into a Purchase Order Agreement with Party Number${n} Ltd., a Cyprus company, for drones.</p><p>Item 9.01 Financial Statements and Exhibits.</p>`;
  return `${dir}onds-8k.htm`;
}

test("bounds: of 5 qualifying items 2 are read per tick; items that do not qualify move the cursor with no request", async () => {
  const env = newEnv();
  startAt(env);
  const pages = { ...FIX };
  const T = (items) => `Ondas Holdings Inc.: 8-K [Items ${items}] filed 2026-11-20`;
  // Non-qualifying first: no request for any of them.
  addItem(env, { source_key: "edgar_onds", ticker: "ONDS", url: `${A}/1894954/000189495426099001/x.htm`, title: T("2.02, 9.01") });
  addItem(env, { source_key: "edgar_grrr", ticker: "GRRR", url: `${A}/1903145/000121390026099002/x.htm`, title: "Gorilla Technology Group Inc.: 6-K filed 2026-11-20" });
  addItem(env, { source_key: "strive_sec_northland", ticker: "ASST", url: `${A}/1920406/000192040626099003/x.htm`, title: "Strive, Inc.: 8-K [Items 1.01] filed 2026-11-20" });
  addItem(env, { source_key: "aglt_rel", ticker: "AGLT", role: "relationship", url: `${A}/1920406/000192040626099004/x.htm`, title: "Agility: 8-K [Items 1.01] filed 2026-11-20" });
  const ids = [];
  for (let n = 1; n <= 5; n++) ids.push(addItem(env, { source_key: "edgar_onds", ticker: "ONDS", url: eightK(pages, n), title: T("1.01, 9.01") }));
  const r1 = await withSec(pages, async (calls) => {
    const r = await secParties(env);
    assert.equal(calls.length, 4, "2 filings x (index + document)");
    return r;
  });
  assert.equal(r1.filings, 2);
  assert.equal(r1.scanned, 6, "4 non-qualifying + 2 read; the third qualifying item waits");
  assert.equal(meta(env, CURSOR_META), String(ids[1]));
  assert.deepEqual(rows(env).map((r) => r.name), ["Party Number1 Ltd.", "Party Number2 Ltd."]);
  await withSec(pages, () => secParties(env));
  assert.equal(meta(env, CURSOR_META), String(ids[3]));
  const r3 = await withSec(pages, () => secParties(env));
  assert.equal(r3.filings, 1);
  assert.equal(meta(env, CURSOR_META), String(ids[4]));
  assert.equal(rows(env).length, 5);
  assert.ok(rows(env).every((r) => r.relation === "partner" && r.subject === "ONDS"));
});

test("at most 50 items are scanned per tick", async () => {
  const env = newEnv();
  startAt(env);
  for (let i = 0; i < 60; i++) addItem(env, { source_key: "ondas", ticker: "ONDS", url: `https://ir.ondas.com/news/${i}`, title: `Release ${i}` });
  const r = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 0); return r; });
  assert.equal(r.scanned, 50);
  assert.equal(meta(env, CURSOR_META), "50");
});

test("the same filing listed by two sources is read once", async () => {
  const env = newEnv();
  startAt(env);
  addItem(env, { source_key: "unusual", ticker: "UMAC", url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23" });
  addItem(env, { source_key: "edgar_umac", ticker: "UMAC", url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23" });
  const r = await withSec(FIX, () => secParties(env));
  assert.equal(r.filings, 1);
  assert.equal(r.requests, 2);
  assert.equal(rows(env)[0].seen.length, 1);
  assert.equal(meta(env, CURSOR_META), "2");
});

// --- Cursor, tables, lease ------------------------------------------------------
test("cursor: the first run starts at MAX(id) plus the seed; an older item is never read", async () => {
  const env = newEnv();
  addItem(env, { id: 5, url: `${A}/1748790/000164117226040000/rcat-20260630.htm`, title: "Red Cat Holdings, Inc.: 10-Q filed 2026-08-12" });
  addItem(env, { id: 18, source_key: "unusual", ticker: "UMAC", url: UMAC_URL, title: "Unusual Machines, Inc.: 8-K filed 2026-10-23" });
  addItem(env, { id: 30, source_key: "ondas", ticker: "ONDS", url: "https://ir.ondas.com/news/30", title: "Release" });
  await withSec(FIX, async (calls) => {
    await secParties(env);
    assert.deepEqual(calls.map((c) => c.url), [UMAC_INDEX, UMAC_URL], "only the seed is read; item 5 is older than the cursor");
  });
  assert.equal(meta(env, CURSOR_META), "30");
  assert.equal(meta(env, SEED_META), null, "the seed is removed once read");
  await withSec(FIX, async (calls) => { await secParties(env); assert.equal(calls.length, 0, "the seed is read once"); });
  const later = addItem(env);
  await withSec(FIX, async (calls) => { await secParties(env); assert.equal(calls.length, 3); });
  assert.equal(meta(env, CURSOR_META), String(later));
});

test("a seed id that is not in zenith-db is dropped", async () => {
  const env = newEnv();
  addItem(env, { id: 3, source_key: "ondas", ticker: "ONDS", url: "https://ir.ondas.com/news/3", title: "Release" });
  const r = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 0); return r; });
  assert.equal(r.scanned, 1);
  assert.equal(meta(env, SEED_META), null);
  assert.equal(meta(env, CURSOR_META), "3");
});

test("no tables (before migration 0012): no run, no cursor", async () => {
  const env = newEnv();
  env.DB.exec("DROP TABLE expansion_candidates; DROP TABLE sec_subsidiaries;");
  addItem(env);
  const r = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 0); return r; });
  assert.equal(r.skipped, "no table");
  assert.equal(meta(env, CURSOR_META), null);
});

test("lease: a held lease means no request; the pass releases its lease; an admin refresh during the pass gets its usual error", async () => {
  const env = newEnv();
  startAt(env);
  const id = addItem(env);
  setMeta(env, "sec_refresh_until", new Date(Date.now() + 60_000).toISOString());
  const held = await withSec(FIX, async (calls) => { const r = await secParties(env); assert.equal(calls.length, 0); return r; });
  assert.equal(held.stopped, "sec lease held");
  assert.equal(meta(env, CURSOR_META), "0", "the filing waits");
  env.DB.db.prepare("DELETE FROM meta WHERE key = 'sec_refresh_until'").run();

  let refresh = null;
  await withSec(FIX, () => secParties(env), {
    onFetch: async (_u, n) => {
      if (n !== 1) return;
      assert.ok(meta(env, "sec_refresh_until"), "the pass holds the lease while it reads");
      refresh = await refreshSecExcerpts(env, {});
    },
  });
  assert.equal(refresh.error, "another SEC excerpt refresh is running; call again in a minute");
  assert.equal(meta(env, "sec_refresh_until"), null, "released in finally");
  assert.equal(meta(env, CURSOR_META), String(id));
});

test("upsert failure: a warning, and the cursor still moves", async () => {
  const env = newEnv();
  startAt(env);
  addItem(env);
  const real = env.DB.batch.bind(env.DB);
  env.DB.batch = async (stmts) => {
    if (stmts.some((s) => /INSERT INTO expansion_candidates/.test(s.sql))) throw new Error("D1_ERROR: database is locked");
    return real(stmts);
  };
  const r = await withSec(FIX, () => secParties(env));
  assert.equal(r.stopped, null);
  assert.equal(r.candidates, 0);
  assert.ok(r.warnings.some((w) => /expansion candidates not saved/.test(w)), JSON.stringify(r.warnings));
  assert.equal(meta(env, CURSOR_META), "1");
});

test("cron: the pass runs last and logs its result as sec parties", async () => {
  const { default: worker } = await import("../worker/src/index.js");
  const env = newEnv({ CONTACT_EMAIL: undefined });
  const order = [];
  const log = console.log;
  console.log = (label, body) => order.push([label, body]);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const waits = [];
    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    console.log = log;
    globalThis.fetch = real;
  }
  assert.equal(order.at(-1)[0], "sec parties");
  assert.match(JSON.parse(order.at(-1)[1]).skipped, /CONTACT_EMAIL/);
});
