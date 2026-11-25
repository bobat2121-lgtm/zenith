// Phase 2: exact-key story dedup, the pure half (worker/src/story.js): title
// normalisation, canonical URLs, hard keys, the register guard, ranks and the
// copy decision. Synthetic titles and URLs only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports } from "./helpers/worker-env.js";

hookJsonImports();
const S = await import("../worker/src/story.js");
const { normTitle, canonUrl, storyKeys, rankOf, decideCopy, hasFeedText, BOILERPLATE, REGISTER_KEY, secAccession, fpdsPiid, legistarMatter, storyDedupOn } = S;
const AUX = (await import("../worker/src/aux-sources.json")).default;

const cov = (over = {}) => ({ source_key: "volvo_autonomous", ticker: "AUR", url: "https://news.example.com/a/1", title: "Acme Robotics signs a fleet deal", ...over });
const aux = (over = {}) => ({ source_key: "aevex", entity_key: "aevex", url: "https://news.example.com/b/1", title: "Acme Robotics signs a fleet deal", ...over });
const key = async (row, p) => (await storyKeys(row, p)).story_key;
// A token-set fingerprint (sorted unique words over 2 characters), for contrast.
const tokenSet = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))].sort().join(" ");

test("B-T1 normTitle folds case, punctuation and curly quotes, and drops leading [TICKER] tags and one (note)", async () => {
  assert.equal(normTitle("Acme Robotics, Inc. Signs “Fleet” Deal"), "acme robotics inc. signs fleet deal");
  assert.equal(normTitle("[AUR] [KDK] (Partner note) ACME ROBOTICS INC. SIGNS FLEET DEAL"), "acme robotics inc. signs fleet deal");
  assert.equal(normTitle("Acme’s fleet deal"), "acme s fleet deal");
  assert.equal(normTitle("(one) (two) Acme fleet deal"), "two acme fleet deal", "only one leading (note) is dropped");
  assert.equal(await key(cov({ title: "Acme Robotics, Inc. signs fleet deal" }), "coverage"), await key(cov({ title: "[AUR] acme robotics, inc. signs fleet deal" }), "coverage"));
  assert.equal(await key(cov({ title: "Acme Robotics signs fleet deal" }), "coverage"), await key(cov({ title: "ACME ROBOTICS, SIGNS FLEET DEAL" }), "coverage"));
});

test("B-T2 normTitle keeps digits: \"Acme wins $5M order\" and \"Acme wins $9M order\" get different keys", async () => {
  const a = "Acme wins $5M order", b = "Acme wins $9M order";
  assert.notEqual(await key(cov({ title: a }), "coverage"), await key(cov({ title: b }), "coverage"));
  assert.equal(tokenSet(a), tokenSet(b), "a token-set fingerprint would collide");
  assert.equal(normTitle("Acme grows 12.5% to $1.2B"), "acme grows 12.5% to $1.2b");
});

test("B-T3 no publisher-suffix strip: two scan titles that differ after \" - \" get different keys", async () => {
  const a = await key(cov({ title: "Funding scan via News - Acme raises $10M" }), "coverage");
  const b = await key(cov({ title: "Funding scan via News - Beta raises $20M" }), "coverage");
  assert.ok(a && b);
  assert.notEqual(a, b);
});

test("B-T4 SEC rows never get a title key; one accession under two URLs gets one key; on coverage the key is ticker-prefixed", async () => {
  const acc = "000123456726000123";
  const u1 = `https://www.sec.gov/Archives/edgar/data/1234567/${acc}/form8k.htm`;
  const u2 = `https://www.sec.gov/Archives/edgar/data/1234567/${acc}/ex99.htm`;
  assert.equal(secAccession(u1), acc);
  const k1 = await key(cov({ source_key: "edgar_rcat", ticker: "RCAT", url: u1, title: "8-K Acme Robotics current report filed" }), "coverage");
  const k2 = await key(cov({ source_key: "edgar_rcat", ticker: "RCAT", url: u2, title: "Some other title entirely here" }), "coverage");
  assert.equal(k1, `sec:RCAT:${acc}`);
  assert.equal(k2, k1, "one accession, two URLs, one key");
  assert.equal(await key(cov({ source_key: "edgar_dpro", ticker: "DPRO", url: u1 }), "coverage"), `sec:DPRO:${acc}`, "another ticker, another key");
  assert.equal(await key(aux({ url: u1 }), "aux"), `sec:${acc}`, "aux hard keys are not prefixed");
  // An SEC row with no accession folder gets no key at all.
  assert.equal(await key(cov({ source_key: "edgar_rcat", ticker: "RCAT", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=x", title: "Acme Robotics signs a fleet deal" }), "coverage"), null);
});

test("B-T5 FPDS: the same PIID and modification under two fpds keys of one ticker match; P00002 and P00003 do not", async () => {
  const u = (mod) => `https://www.fpds.gov/ezsearch/search.do?q=ACME#9700-W58RGZ26C0001-${mod}`;
  assert.equal(fpdsPiid(u("P00002")), "W58RGZ26C0001-P00002");
  assert.equal(fpdsPiid("https://news.example.com/x#9700-W58RGZ26C0001-P00002"), null, "only on fpds.gov");
  const a = await key(cov({ source_key: "fpds_pdyn", ticker: "PDYN", url: u("P00002") }), "coverage");
  const b = await key(cov({ source_key: "fpds_pdyn_sarcos", ticker: "PDYN", url: u("P00002") }), "coverage");
  assert.equal(a, "piid:PDYN:W58RGZ26C0001-P00002");
  assert.equal(a, b);
  assert.notEqual(a, await key(cov({ source_key: "fpds_pdyn", ticker: "PDYN", url: u("P00003") }), "coverage"));
});

test("B-T6 Legistar: a matter's base row and its #vote- row do not match; the same base row from two client keys does", async () => {
  const base = "https://testcity.legistar.com/LegislationDetail.aspx?ID=4242&GUID=ABC";
  assert.equal(legistarMatter(base), "testcity:4242#");
  assert.equal(legistarMatter(`${base}#vote-77`), "testcity:4242#vote-77");
  const k = (url, source_key) => key(aux({ source_key, entity_key: source_key, url }), "aux");
  assert.notEqual(await k(base, "legistar_testcity"), await k(`${base}#vote-77`, "legistar_testcity"));
  assert.equal(await k(base, "legistar_testcity"), await k(base, "legistar_testcity_axon"));
});

test("B-T7 templated and short titles get no title key", async () => {
  const t = "Acme Robotics signs a fleet deal";
  for (const source_key of ["wargov_contracts", "fpds_acme", "legistar_testcity"]) {
    assert.equal(await key(aux({ source_key, entity_key: source_key, title: t }), "aux"), null, source_key);
  }
  assert.equal(await key(cov({ title: "Acme deal" }), "coverage"), null, "under 12 characters");
  assert.equal(await key(cov({ title: "Acmerobotics dealsigned" }), "coverage"), null, "under 3 words");
  assert.ok(await key(cov({ title: "Acme signs deal" }), "coverage"), "12+ characters, 3 words");
});

test("B-T8 BOILERPLATE: one title per listed phrase gets no title key", async () => {
  const titles = {
    "inside information": "Disclosure of inside information pursuant to Article 17 of the Regulation",
    "article 17": "Acme notice under Article 17 of the rules",
    "regulation \\(?eu\\)?": "Acme notice under Regulation (EU) number five",
    "voting rights": "Acme Total voting rights and capital",
    "transaction in own shares": "Acme Transaction in own shares this week",
    "pdmr": "Acme PDMR dealing notification today",
    "notice of (annual|extraordinary|general)": "Acme Notice of Extraordinary General Meeting",
    "press release": "Acme Robotics press release on fleet deal",
    "form 8 k": "Acme Robotics Form 8-K current report",
    "annual general meeting": "Acme results of the Annual General Meeting",
    "monthly update": "Acme Robotics Monthly update for November",
    "weekly update": "Acme Robotics Weekly update for the week",
  };
  // Every alternative in the exact regex has a title here.
  const src = BOILERPLATE.source;
  const alts = src.slice(src.indexOf("(") + 1, src.lastIndexOf(")")).split(/\|(?![^(]*\))/);
  assert.deepEqual(alts.sort(), Object.keys(titles).sort());
  for (const [phrase, title] of Object.entries(titles)) {
    assert.ok(BOILERPLATE.test(normTitle(title)), phrase);
    assert.equal(await key(cov({ title }), "coverage"), null, phrase);
  }
});

test("B-T9 canonUrl folds scheme, www, trailing slash and utm_*/fbclid/gclid/mc_*, and keeps the fragment; aux rows get a url_key, coverage rows never do", async () => {
  assert.equal(canonUrl("http://www.Example.com/news/acme/?utm_source=x&id=7&fbclid=1&gclid=2&mc_cid=3#part"), "example.com/news/acme?id=7#part");
  assert.equal(canonUrl("https://example.com/news/acme"), canonUrl("http://www.example.com/news/acme/?utm_medium=y"));
  assert.notEqual(canonUrl("https://example.com/a#vote-1"), canonUrl("https://example.com/a#vote-2"));
  assert.equal(canonUrl("not a url"), "not a url");
  const a = await storyKeys(aux({ url: "http://www.news.example.com/b/1/?utm_source=z" }), "aux");
  const b = await storyKeys(aux({ source_key: "managed_widgetco_news", entity_key: "widgetco", url: "https://news.example.com/b/1" }), "aux");
  assert.match(a.url_key, /^u:[0-9a-f]{16}$/);
  assert.equal(a.url_key, b.url_key);
  assert.equal((await storyKeys(cov(), "coverage")).url_key, null);
  assert.equal((await storyKeys(aux({ url: "mailto:x@example.com" }), "aux")).url_key, null, "no URL key for a link that is not http(s)");
});

test("B-T10 rankOf: own-lane release 3 > SEC 2 > other record 1 > media 0", () => {
  assert.equal(rankOf({ source_key: "redcat", url: "https://ir.example.com/n/1" }), 3);
  assert.equal(rankOf({ source_key: "edgar_rcat", url: "https://www.sec.gov/Archives/edgar/data/1/000123456726000123/a.htm" }), 2);
  assert.equal(rankOf({ source_key: "redcat", url: "https://www.sec.gov/Archives/edgar/data/1/000123456726000123/a.htm" }), 2, "an own-lane row on sec.gov is SEC");
  assert.equal(rankOf({ source_key: "diu", url: "https://www.example.gov/x" }), 1);
  assert.equal(rankOf({ source_key: "volvo_autonomous", url: "https://news.example.com/x" }), 0);
});

test("B-T11 register guard: lda_ and txdmv rows with a 3-word title get no title key even when the catalog marks them neither record nor register", async () => {
  for (const source_key of ["lda_acme", "txdmv_testreport"]) {
    assert.ok(REGISTER_KEY.test(source_key));
    assert.equal(Object.prototype.hasOwnProperty.call(AUX.sources, source_key), false, "not in the catalog: neither record nor register");
    const k = await storyKeys(aux({ source_key, entity_key: source_key, title: "Acme Robotics registration report" }), "aux");
    assert.deepEqual(k, { story_key: null, url_key: null }, source_key);
    assert.equal(await key(cov({ source_key, title: "Acme Robotics registration report" }), "coverage"), null);
  }
  // The same row under a plain key does get a title key.
  assert.ok(await key(aux({ source_key: "acme_watch", entity_key: "acme_watch", title: "Acme Robotics registration report" }), "aux"));
});

test("B-T12 decideCopy", () => {
  const DAY = 86_400_000;
  const t0 = Date.parse("2026-11-01T12:00:00.000Z");
  const at = (d) => new Date(t0 + d * DAY).toISOString();
  const row = (over = {}) => ({ nm_rowid: 50, first_seen: at(2), rank: 0, has_text: false, admit: null, ...over });
  const cand = (over = {}) => ({ id: 7, nm_rowid: 10, nm_first_seen: at(0), rank: 0, has_text: false, held: false, in_batch: false, ...over });
  // A claimable candidate: hold, the earliest one is the canonical.
  let d = decideCopy(row(), [cand({ id: 8, nm_first_seen: at(1) }), cand()]);
  assert.equal(d.action, "hold");
  assert.equal(d.canonical.id, 7);
  // Only a held candidate, same rank: swap.
  assert.equal(decideCopy(row(), [cand({ held: true })]).action, "swap");
  // Only a held candidate that outranks the copy: none.
  assert.equal(decideCopy(row(), [cand({ held: true, rank: 1 })]).action, "none");
  // The copy has feed text and the canonical none: none (the text guard).
  assert.equal(decideCopy(row({ has_text: true }), [cand()]).action, "none");
  assert.equal(decideCopy(row({ has_text: true }), [cand({ has_text: true })]).action, "hold");
  assert.equal(decideCopy(row(), [cand({ has_text: true })]).action, "hold");
  // Same nm_rowid (a catch-up rescan): ignored.
  assert.equal(decideCopy(row(), [cand({ nm_rowid: 50 })]).action, "none");
  // 15 days apart: none; 14 days: hold; a candidate first seen after the row: ignored.
  assert.equal(decideCopy(row({ first_seen: at(15) }), [cand()]).action, "none");
  assert.equal(decideCopy(row({ first_seen: at(14) }), [cand()]).action, "hold");
  assert.equal(decideCopy(row(), [cand({ nm_first_seen: at(3) })]).action, "none");
  // The copy outranks the candidate: none.
  assert.equal(decideCopy(row({ rank: 3 }), [cand()]).action, "none");
  assert.equal(decideCopy(row(), [cand({ rank: 2 })]).action, "hold", "a higher-ranked canonical holds a media copy");
  // A gate-admitted copy with only a held candidate: none.
  assert.equal(decideCopy(row({ admit: "seed_fresh" }), [cand({ held: true })]).action, "none");
  // A claimable candidate wins over an earlier held one.
  d = decideCopy(row(), [cand({ id: 3, held: true, nm_first_seen: at(-1) }), cand({ id: 9, nm_first_seen: at(1) })]);
  assert.deepEqual([d.action, d.canonical.id], ["hold", 9]);
  // hasFeedText: the release itself, or a summary fallback.
  assert.equal(hasFeedText({ status: "feed", excerpt: "x" }), true);
  assert.equal(hasFeedText({ fallback: "x" }), true);
  assert.equal(hasFeedText({ status: null, excerpt: null, fallback: null }), false);
  // The switch.
  assert.equal(storyDedupOn({}), true);
  assert.equal(storyDedupOn({ STORY_DEDUP: "OFF " }), false);
  assert.equal(storyDedupOn({ STORY_DEDUP: "on" }), true);
});

test("B-T13 every key in the generated aux-sources.json that matches REGISTER_KEY has record: true", (t) => {
  const keys = Object.keys(AUX.sources).filter((k) => REGISTER_KEY.test(k));
  if (!keys.length) t.diagnostic("no register keys in aux-sources.json yet: nothing to check");
  for (const k of keys) assert.equal(AUX.sources[k].record, true, k);
});
