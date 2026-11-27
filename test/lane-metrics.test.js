// Phase 5 P5C-C1: worker/src/lane-metrics.js, the side-by-side report's pure
// functions (tests Z-C1..Z-C10, Z-C13 module text, Z-C14..Z-C17). Synthetic
// keys, tickers, titles and times only (test/helpers/lane-fixtures.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports } from "./helpers/worker-env.js";
import { T, FROM, TO, cov, aux, shadowRow, hit, bingFile } from "./helpers/lane-fixtures.js";

hookJsonImports();
const L = await import("../worker/src/lane-metrics.js");

const BING = bingFile();
const run = (rows, hits = [], shadow = [], opts = {}) => L.report(rows, hits, shadow, { from: FROM, to: TO, bing: BING, pattern: null, ...opts });
const together = (clusters, a, b) => clusters.some((c) => c.some((n) => n.url === a) && c.some((n) => n.url === b));

test("Z-C1: median and pct: odd, even, empty, unsorted", () => {
  assert.equal(L.median([3, 1, 2]), 2);
  assert.equal(L.median([4, 1, 3, 2]), 2.5);
  assert.equal(L.median([]), null);
  assert.equal(L.median([null, 5]), 5);
  assert.equal(L.pct([10, 0], 0.9), 9);
  assert.equal(L.pct([1, 2, 3, 4, 5], 0.25), 2);
});

test("Z-C2: lagHours: a bare UTC midnight is undated; 4 minutes early is kept, 10 minutes early is not", () => {
  assert.equal(L.lagHours({ published: "2030-03-02T00:00:00.000Z", first_seen: T(40) }), null);
  assert.equal(L.lagHours({ published: "2030-03-02T00:00:00Z", first_seen: T(40) }), null, "midnight in any ISO spelling");
  const early = L.lagHours({ published: T(10), first_seen: T(10 - 4 / 60) });
  assert.ok(Math.abs(early + 4 / 60) < 1e-9, String(early));
  assert.equal(L.lagHours({ published: T(10), first_seen: T(10 - 10 / 60) }), null);
  assert.equal(L.lagHours({ published: T(7), nm_first_seen: T(10) }), 3);
  assert.equal(L.lagHours({ published: "not a date", first_seen: T(10) }), null);
  assert.equal(L.lagHours({ published: null, first_seen: T(10) }), null);
});

test("Z-C3: fresh below 168 h, stale at 168 h; stale_share over dated post-seed rows", () => {
  assert.equal(L.isFresh(167.9), true);
  assert.equal(L.isFresh(168), false);
  const r = run([aux({ seen: 200, pub: 200 - 167.9 }), aux({ seen: 210, pub: 210 - 168 }), aux({ seen: 220, pub: null })]);
  assert.deepEqual(
    { rows: r.lanes.bing.rows, dated: r.lanes.bing.dated, fresh: r.lanes.bing.fresh, stale_share: r.lanes.bing.stale_share },
    { rows: 3, dated: 2, fresh: 1, stale_share: 0.5 },
  );
  assert.equal(r.lanes.bing.lag_median_h, 167.9);
});

test("Z-C4: seed rule: within 60 minutes of the key's seed, or archive_seed on any copy outside the window", () => {
  const seeds = new Map([["bing_acme", T(10)]]);
  assert.equal(L.isSeed({ source_key: "bing_acme", first_seen: T(10.5) }, seeds), true);
  assert.equal(L.isSeed({ source_key: "bing_acme", first_seen: T(11.1) }, seeds), false);
  assert.equal(L.isSeed({ source_key: "bing_acme", first_seen: T(11.1), skip_reason: "archive_seed" }, seeds), true);
  assert.equal(L.isSeed({ source_key: "other", first_seen: T(10.5) }, seeds), false, "no seed known: only archive_seed marks a seed");
  // One news-monitor row in both pipelines: the Coverage copy is archive_seed, so the row is a seed row.
  const a = aux({ seen: 30 }), c = cov({ seen: 30, key: "bing_acme", nm_rowid: a.nm_rowid, skip_reason: "archive_seed" });
  const r = run([a, c, aux({ seen: 10.5 }), aux({ seen: 40 })], [], [], { seedByKey: seeds });
  assert.equal(r.lanes.bing.rows, 3, "Coverage and Auxiliary copies of one row count once");
  assert.equal(r.lanes.bing.post_seed, 1);
});

test("Z-C5: lanes: widenet_ prefix, the Bing key file, rest; a key in both throws; a drain key without the prefix stops", () => {
  const bing = L.parseBingKeys(BING);
  assert.equal(L.laneOf("widenet_x", { bing }), "widenet");
  assert.equal(L.laneOf("bing_acme", { bing }), "bing");
  assert.equal(L.laneOf("acme_ir", { bing }), "rest");
  assert.throws(() => L.laneOf("widenet_y", { bing: new Set(["widenet_y"]) }), /both a Bing key and a wide-net key/);
  assert.equal(L.WIDENET_PREFIX, "widenet_");
  assert.throws(() => L.checkBingKeys(bingFile(undefined, ["wn_x"]), []), /without the widenet_ prefix/);
  assert.throws(() => L.checkBingKeys(BING, ["bing_acme", "bing_other"]), /missing 1 Bing-host key/);
  assert.equal(L.checkBingKeys(BING, ["bing_acme"]).keys.size, 1);
});

test("parseBingKeys and parsePattern accept the export shapes; the token is the longest 4+ letter word of q", () => {
  const a = L.parseBingKeys([{ key: "bing_acme", q: "\"Acme Robotics\" deal", affects: "TST,UVW", shadow: 1 }]);
  assert.deepEqual(a.keys.get("bing_acme").affects, ["TST", "UVW"]);
  assert.equal(a.keys.get("bing_acme").token, "robotics");
  assert.equal(a.keys.get("bing_acme").shadow, true);
  assert.equal(L.parseBingKeys({ sources: [{ key: "bing_b" }] }).keys.has("bing_b"), true);
  assert.equal(L.parseBingKeys({ keys: { bing_c: { q: "x" } }, widenet: ["widenet_x"] }).widenet[0], "widenet_x");
  assert.throws(() => L.parseBingKeys([{ key: "Bad Key" }]), /bad key/);
  assert.equal(L.parsePattern(null), null);
  assert.equal(L.parsePattern({ keys: { bing_acme: { pattern_covered: true } } }).get("bing_acme").pattern_covered, true);
  assert.equal(L.parsePattern([{ key: "bing_acme", pattern_covered: "yes" }]).get("bing_acme").pattern_covered, false, "only true counts");
});

test("tickersOf: coverage ticker, aux affects, wide-net title tag, hit targets, entity fallback, Bing key affects", () => {
  const bingKeys = L.parseBingKeys([{ key: "bing_shadow", affects: ["TST"] }]).keys;
  assert.deepEqual([...L.tickersOf({ pipeline: "coverage", source_key: "acme_ir", ticker: "TST" })], ["TST"]);
  assert.deepEqual([...L.tickersOf({ pipeline: "aux", source_key: "bing_acme", affects: "TST,UVW" })], ["TST", "UVW"]);
  assert.deepEqual([...L.tickersOf({ pipeline: "coverage", source_key: "widenet_x", ticker: "TST", title: "[TST/UVW] Acme news" })], ["TST", "UVW"]);
  assert.deepEqual([...L.tickersOf({ kind: "hit", tickers: "[\"UVW\"]" })], ["UVW"]);
  assert.deepEqual([...L.tickersOf({ kind: "hit", entity_key: "acme" }, { entityTickers: new Map([["acme", ["TST"]]]) })], ["TST"]);
  assert.deepEqual([...L.tickersOf({ source_key: "bing_shadow", title: "x" }, { bingKeys })], ["TST"]);
});

test("Z-C6: linkStories joins on story_key, url_key, canonical URL, dup_of (TEXT or INTEGER) and the scoped soft rule", () => {
  const s1 = cov({ story_key: "t:abc", title: "One" }), s2 = cov({ story_key: "t:abc", title: "Two" });
  const u1 = aux({ url_key: "u:1", title: "Three" }), u2 = aux({ url_key: "u:1", title: "Four" });
  const c1 = cov({ url: "https://www.example.com/x/?utm_source=feed", title: "Five" }), c2 = aux({ url: "http://example.com/x", title: "Six" });
  const d1 = cov({ id: 12, title: "Seven" }), d2 = cov({ dup_of: "12", band: "duplicate", title: "Eight" });
  const e1 = aux({ id: 12, title: "Nine" }), e2 = aux({ dup_of: 12, band: "duplicate", title: "Ten" });
  const cl = L.clusterRows([s1, s2, u1, u2, c1, c2, d1, d2, e1, e2], [], [], { bing: BING });
  for (const [a, b] of [[s1, s2], [u1, u2], [c1, c2], [d1, d2], [e1, e2]]) assert.ok(together(cl, a.url, b.url), `${a.title} + ${b.title}`);
  assert.ok(!together(cl, d1.url, e1.url), "dup_of names a row of its own pipeline only");

  // Jaccard 0.5 with a shared ticker joins; no shared ticker, 8 days apart, or 0.4 does not.
  const j1 = aux({ seen: 10, affects: "TST", title: "Alpha bravo charlie" });
  const j2 = cov({ seen: 30, ticker: "TST", title: "Alpha bravo charlie delta echo foxtrot" });
  const n1 = aux({ seen: 10, affects: "UVW", title: "Golf hotel india" });
  const n2 = cov({ seen: 30, ticker: "TST", title: "Golf hotel india juliet kilo lima" });
  const w1 = aux({ seen: 10, affects: "TST", title: "Mike november oscar" });
  const w2 = cov({ seen: 10 + 8 * 24, ticker: "TST", title: "Mike november oscar papa quebec romeo" });
  const f1 = aux({ seen: 10, affects: "TST", title: "Sierra tango" });
  const f2 = cov({ seen: 30, ticker: "TST", title: "Sierra tango uniform victor whiskey" });
  const cl2 = L.clusterRows([j1, j2, n1, n2, w1, w2, f1, f2], [], [], { bing: BING });
  assert.ok(together(cl2, j1.url, j2.url), "0.5 with a shared ticker");
  assert.ok(!together(cl2, n1.url, n2.url), "no shared ticker");
  assert.ok(!together(cl2, w1.url, w2.url), "more than 7 days apart");
  assert.ok(!together(cl2, f1.url, f2.url), "0.4");

  // A reworded copy of one release stays split: the soft rule undercounts copies.
  const r1 = aux({ seen: 10, affects: "TST", title: "Acme wins expanded deal from Northland customer" });
  const r2 = cov({ seen: 12, ticker: "TST", title: "Northland customer grows its Acme contract" });
  assert.ok(!together(L.clusterRows([r1, r2], [], [], { bing: BING }), r1.url, r2.url));
});

test("Z-C7: new_material_unique: alone or 2 h ahead counts; 5 minutes ahead counts only as wide_net_first", () => {
  const wn = (seen, over = {}) => {
    const url = `https://example.com/wn/${seen}`;
    return [cov({ key: "widenet_x", seen, url, title: "[TST] Acme opens a new plant in Northland", score: 75, ...over }), hit({ seen: seen - 0.2, url })];
  };
  const one = (rows, hits) => run(rows, hits).new_material_unique;
  let [row, h] = wn(30);
  let r = run([row], [h]);
  assert.equal(r.new_material_unique.total, 1, "wide-net only, scored 75");
  assert.deepEqual(r.new_material_unique.by_day, { [T(30).slice(0, 10)]: 1 });
  assert.equal(r.new_material_unique.coverage, 1);

  [row, h] = wn(50);
  const own5 = cov({ seen: 50 + 5 / 60, title: "Acme opens a new plant in Northland" });
  r = run([row, own5], [h]);
  assert.equal(r.new_material_unique.total, 0, "5 minutes ahead of an own channel");
  assert.equal(r.wide_net_first.total, 1);

  [row, h] = wn(70);
  assert.equal(one([row, cov({ seen: 72.5, title: "Acme opens a new plant in Northland" })], [h]).total, 1, "2.5 h ahead");
  [row, h] = wn(90, { score: 65 });
  assert.equal(one([row], [h]).total, 0, "a 65 is not material");
  [row, h] = wn(110, { score: null, band: "duplicate" });
  assert.equal(one([row], [h]).total, 0, "duplicate never counts");
  [row, h] = wn(130, { score: 88, band: "covered" });
  assert.equal(one([row], [h]).total, 0, "covered never counts");
  [row, h] = wn(150, { score: 60, owner_score: 90 });
  assert.equal(one([row], [h]).total, 0, "an owner score is never read");

  const [a, ha] = wn(30, { rubric: "r1" });
  const [b, hb] = wn(200, { rubric: "r2", title: "[TST] Acme signs a supply pact with Westland" });
  const seg = one([a, b], [ha, hb]);
  assert.deepEqual(seg.by_rubric, { r1: 1, r2: 1 });
  assert.deepEqual(seg.segments.map((s) => s.rubric_version), ["r1", "r2"]);
  assert.equal(seg.P2, "fail", "2 in 14 days");
});

test("Z-C8: bing_only_material lists a lone late Bing story with in_rejects; a wide-net row or dup_collected hit removes it", () => {
  const url = "https://example.com/b/1";
  const b = aux({ seen: 130, pub: 30, url, score: 77, title: "Acme buys a Northland robot maker" });
  let r = run([b]);
  assert.equal(r.bing_only_material.length, 1);
  assert.deepEqual({ ...r.bing_only_material[0], first_seen: undefined },
    { key: "bing_acme", tickers: ["UVW"], title: b.title, score: 77, first_seen: undefined, in_rejects: "not_seen", cap_hit_day: false });

  r = run([b], [hit({ status: "rejected", reason: "no_context", url, seen: 131 })]);
  assert.equal(r.bing_only_material[0].in_rejects, "no_context");

  const later = cov({ key: "widenet_x", seen: 130 + 48, url: "https://example.com/wn/9", title: "[UVW] Acme buys a Northland robot maker" });
  assert.equal(run([b, later], [hit({ url: later.url, seen: 177.8, tickers: "UVW" })]).bing_only_material.length, 0, "accepted wide-net row 2 days later");
  assert.equal(run([b], [hit({ status: "rejected", reason: "dup_collected", dupOf: "bing_acme", url, seen: 131 })]).bing_only_material.length, 0, "dup_collected hit");

  const cap = hit({ status: "rejected", reason: "cap_open_daily", url: "https://example.com/h/cap", title: "Unrelated breaker line", seen: 131 });
  r = run([b], [cap]);
  assert.equal(r.bing_only_material[0].cap_hit_day, true);
  assert.deepEqual(r.cap_hit_days, [T(131).slice(0, 10)]);
});

test("Z-C9: head to head (L2): median of wide net minus Bing and the earlier share; dup_collected pairs apart and never negative", () => {
  const rows = [], hits = [];
  for (const [bSeen, wSeen, i, words] of [[10, 8, 1, "Acme opens Northland plant"], [20, 23, 2, "Westland regulator fines Beta"]]) {
    const url = `https://example.com/p/${i}`;
    rows.push(aux({ seen: bSeen, url, title: words }), cov({ key: "widenet_x", seen: wSeen, url, title: `[UVW] ${words}` }));
    hits.push(hit({ url, seen: wSeen - 0.1, tickers: "UVW", title: words }));
  }
  const durl = "https://example.com/p/3";
  rows.push(aux({ seen: 40, url: durl, title: "Gamma recalls Eastland scooters" }));
  hits.push(hit({ status: "rejected", reason: "dup_collected", url: durl, seen: 41, title: "Gamma recalls Eastland scooters" }));
  const h = run(rows, hits).head_to_head;
  assert.deepEqual(h.accepted, { n: 2, median_h: 0.5, earlier_share: 0.5 });
  assert.deepEqual(h.dup_collected, { n: 1, median_h: 1, earlier_share: 0 });
  assert.equal(h.P4, "flag");
});

test("Z-C9: head to head counts a pair only when both lanes' earliest observations are in the window, whichever lane sat outside", () => {
  const h2h = (bSeens, wSeen) => {
    const url = "https://example.com/p/edge", title = "Acme opens Northland plant";
    const rows = bSeens.map((s) => aux({ seen: s, url, title }));
    rows.push(cov({ key: "widenet_x", seen: wSeen, url, title: `[UVW] ${title}` }));
    return run(rows, [hit({ url, seen: wSeen - 0.1, tickers: "UVW", title })]).head_to_head.accepted.n;
  };
  const end = 14 * 24;
  assert.equal(h2h([20], 15), 1, "both inside");
  assert.equal(h2h([-10, 20], 15), 0, "Bing first seen in the lookback");
  assert.equal(h2h([20], -10), 0, "the wide net first seen in the lookback");
  assert.equal(h2h([end - 1], end + 3), 0, "the wide net after the window (Bing rows after it are never read)");
});

test("Z-C10: stagePlan keeps pattern gaps, Bing-only and unobserved 40+ keys, fills 18 hourly by rank, asks the owner past 18", () => {
  const keys = Array.from({ length: 30 }, (_, i) => ({
    key: `bing_k${String(i).padStart(2, "0")}`, cadence: "hourly", F: 0, U40: 0, U70: 0, lag_median_h: null, pattern_covered: true, bing_only_material: 0, shadow: false,
  }));
  for (let i = 0; i < 20; i++) Object.assign(keys[i + 10], { F: 20 - i }); // k10 ranks first by F
  keys[0].pattern_covered = false; // a pattern gap with F = 0
  keys[1].bing_only_material = 1; // ranks last, kept anyway
  keys[2].U40 = 1; keys[2].F = 1;
  Object.assign(keys[3], { cadence: "sixhourly", F: 2 });
  Object.assign(keys[4], { cadence: "sixhourly", F: 6, shadow: true, U40: null, U70: null });
  const p = L.stagePlan(keys);
  assert.equal(p.status, "ok");
  for (const k of ["bing_k00", "bing_k01", "bing_k02"]) assert.equal(p.verdict[k], "keep:must", k);
  assert.equal(p.verdict.bing_k03, "keep:six_hourly");
  assert.equal(p.verdict.bing_k04, "retire", "a shadow key with F > 0 and pattern covered retires");
  assert.equal(p.hourly, 18);
  assert.equal(p.verdict.bing_k10, "keep:fill");
  assert.equal(p.verdict.bing_k25, "retire", "below the fill line");
  assert.ok(p.per_hour < 20, String(p.per_hour));
  assert.equal(p.per_hour, 18.17);

  const missing = L.stagePlan(keys.map((k) => ({ ...k, pattern_covered: undefined })));
  assert.deepEqual(missing.retire, [], "no pattern check: nothing retires");
  assert.equal(missing.status, "ask_owner");
  const many = L.stagePlan(keys.map((k, i) => ({ ...k, pattern_covered: i >= 21 })));
  assert.equal(many.status, "ask_owner", "19 hourly keys (and 2 six-hourly) must stay");
});

test("Z-C13 (module): no write statement text, no import of delivery.js or discord.js, every LANE_SQL statement has a LIMIT", () => {
  const src = readFileSync(new URL("../worker/src/lane-metrics.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(src, /\bfetch\(|\bimport\(/);
  assert.deepEqual([...src.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]), ["./story.js"]);
  for (const [name, sql] of Object.entries(L.LANE_SQL)) {
    assert.match(sql, /^SELECT\b/, name);
    assert.match(sql, /\bLIMIT \d+$/, name);
  }
});

test("Z-C14: a dup_collected hit joins the Bing row it duplicates by URL; not Bing-only; not in the key's F", () => {
  const url = "https://www.example.com/d/1?utm_medium=rss";
  const b = aux({ seen: 30, pub: 25, url, score: 80, title: "Acme lands a Westland order" });
  const d = hit({ status: "rejected", reason: "dup_collected", dupOf: "bing_acme", url: "https://example.com/d/1", seen: 31, title: "Acme lands a Westland order" });
  assert.ok(together(L.clusterRows([b], [d], [], { bing: BING }), b.url, d.url));
  const r = run([b], [d]);
  assert.equal(r.bing_only_material.length, 0);
  assert.equal(r.per_bing_key.bing_acme.F, 0);
  assert.equal(r.per_bing_key.bing_acme.post_seed, 1);
});

test("an accepted hit with no target for this universe (null drain_key from Q-N4a's LEFT JOIN) is no wide-net observation", () => {
  const url = "https://example.com/u2/1";
  const b = aux({ seen: 30, pub: 25, url, score: 80, title: "Acme lands a Westland order" });
  const other = hit({ url, seen: 29, drain: null, tickers: null, class: null, title: "Acme lands a Westland order" });
  let r = run([b], [other]);
  assert.equal(r.bing_only_material.length, 1, "accepted for another universe only: still Bing-only here");
  assert.equal(r.per_bing_key.bing_acme.F, 1);
  assert.equal(r.head_to_head.accepted.n, 0);
  r = run([b], [hit({ url, seen: 29, title: "Acme lands a Westland order" })]);
  assert.equal(r.bing_only_material.length, 0, "the same hit with a target here is an observation");
  assert.equal(r.per_bing_key.bing_acme.F, 0);
});

test("Z-C15: cross-lane scope: a Bing aux row joins a tagged wide-net row; a scope-less Bing row needs 0.6 and its query token", () => {
  const b = aux({ seen: 10, affects: "UVW", title: "Acme wins a large Northland order" });
  const w = cov({ key: "widenet_x", seen: 12, ticker: "UVW", title: "[UVW] Acme wins large Northland order today" });
  assert.ok(together(L.clusterRows([b, w], [], [], { bing: BING }), b.url, w.url));

  const file = bingFile([{ key: "bing_scope", q: "robotics funding", token: "robotics" }]);
  const s = aux({ key: "bing_scope", affects: null, seen: 10, title: "Northland humanoid robotics maker raises funds" });
  const yes = aux({ key: "acme_news", affects: null, seen: 12, title: "Northland humanoid robotics maker raises new funds" });
  const noToken = aux({ key: "acme_news2", affects: null, seen: 12, title: "Northland humanoid machine maker raises new funds" });
  const low = aux({ key: "acme_news3", affects: null, seen: 12, title: "Robotics maker in Northland closes round" });
  const pairOf = (other) => together(L.clusterRows([s, other], [], [], { bing: file }), s.url, other.url);
  assert.ok(pairOf(yes), "0.6+ with the token");
  assert.ok(!pairOf(noToken), "0.6+ without the token");
  assert.ok(!pairOf(low), "token but under 0.6");
});

test("Z-C16: a rest row before the window makes a window Bing row non-unique and is not counted itself", () => {
  const restRow = cov({ seen: -72, ticker: "UVW", title: "Acme opens a new plant in Northland" });
  const b = aux({ seen: 10, affects: "UVW", score: 85, title: "Acme opens a new plant in Northland" });
  const r = run([restRow, b]);
  assert.equal(r.lanes.rest.rows, 0);
  assert.equal(r.bing_only_material.length, 0);
  assert.equal(r.per_bing_key.bing_acme.F, 0);
});

test("Z-C17: P1 guards: under 30 rows not measurable; most lags under 20 minutes suspect; date_exact 0 never in L1", () => {
  const make = (n, lagFor, exact = 1) => {
    const rows = [], hits = [];
    for (let i = 0; i < n; i++) {
      const seen = 10 + i * 5, url = `https://example.com/l1/${exact}/${i}`;
      rows.push(cov({ key: "widenet_x", seen, pub: seen - lagFor(i), url, title: `[TST] Item ${i} ${"z".repeat(3 + i)} story` }));
      hits.push(hit({ url, seen: seen - 0.1, exact }));
    }
    return [rows, hits];
  };
  let [rows, hits] = make(29, () => 1.5);
  assert.equal(run(rows, hits).L1.P1, "not_measurable");
  [rows, hits] = make(30, () => 1.5);
  let L1 = run(rows, hits).L1;
  assert.deepEqual([L1.n, L1.median_h, L1.P1, L1.date_exact_share], [30, 1.5, "pass", 1]);
  [rows, hits] = make(30, (i) => (i < 18 ? 0.1 : 3));
  assert.equal(run(rows, hits).L1.P1, "suspect");
  const [r0, h0] = make(10, () => 1, 0);
  [rows, hits] = make(30, () => 3);
  L1 = run([...rows, ...r0], [...hits, ...h0]).L1;
  assert.equal(L1.n, 30, "date_exact 0 rows stay out");
  assert.equal(L1.P1, "fail");
  assert.equal(L1.date_exact_share, 0.75);
  assert.equal(L1.L5_n, 30);
});

test("L3 helpers: pagePublished reads the meta tag, JSON-LD, then <time>; robotsAllows honours the agent group", () => {
  assert.equal(L.pagePublished('<meta content="2030-03-01T08:00:00Z" property="article:published_time">'), "2030-03-01T08:00:00.000Z");
  assert.equal(L.pagePublished('<script type="application/ld+json">{"datePublished": "2030-03-01T09:00:00+01:00"}</script>'), "2030-03-01T08:00:00.000Z");
  assert.equal(L.pagePublished('<p><time datetime="2030-03-01T10:00:00Z">x</time></p>'), "2030-03-01T10:00:00.000Z");
  assert.equal(L.pagePublished("<p>none</p>"), null);
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: zenith-lag-check\nDisallow: /news/*.amp$\n";
  assert.equal(L.robotsAllows(robots, "/news/a.amp"), false);
  assert.equal(L.robotsAllows(robots, "/private/x"), true, "our own group replaces *");
  assert.equal(L.robotsAllows(robots, "/private/x", "other-bot"), false);
  assert.equal(L.robotsAllows(robots, "/private/ok/1", "other-bot"), true);
  assert.equal(L.robotsAllows("", "/x"), true);
});

test("report: shadow rows count in the Bing lane with U40/U70 unknown; a shadow row with an unknown key is rest", () => {
  const file = bingFile([{ key: "bing_shadow", shadow: true, cadence: "sixhourly" }, { key: "bing_acme", cadence: "hourly" }]);
  const r = L.report([], [], [shadowRow({ seen: 20 }), shadowRow({ seen: 30, key: "acme_other", title: "Eastland port opens a new berth" })], { from: FROM, to: TO, bing: file, pattern: { keys: { bing_shadow: { pattern_covered: true }, bing_acme: { pattern_covered: true } } } });
  assert.equal(r.lanes.bing.rows, 1);
  assert.equal(r.lanes.rest.rows, 1);
  assert.deepEqual([r.per_bing_key.bing_shadow.F, r.per_bing_key.bing_shadow.U40, r.per_bing_key.bing_shadow.U70], [1, null, null]);
  assert.equal(r.per_bing_key.bing_shadow.verdict, "retire");
  assert.equal(r.per_bing_key.bing_acme.verdict, "keep:fill");
  assert.equal(r.widenet_data, false);
  assert.equal(r.verdict.P2, "not_measurable", "no wide-net data: P2 is not measurable, not a failure");
  assert.ok(r.per_name["key:bing_shadow"], "a Bing row without tickers is listed under its key");
});
