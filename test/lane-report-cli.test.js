// Phase 5 P5C-C1: scripts/lane-report.mjs (tests Z-C13 guards, Z-C18 and the
// run end to end on node:sqlite stand-ins through an injected runner, so no
// test reaches wrangler or the network). Synthetic data only.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hookJsonImports, zenithDb } from "./helpers/worker-env.js";
import { T, FROM, TO, cov, aux, hit, bingFile, laneNewsDb, storeHit, storeZenith } from "./helpers/lane-fixtures.js";

hookJsonImports();
const R = await import("../scripts/lane-report.mjs");
const { LANE_SQL } = await import("../worker/src/lane-metrics.js");
const SCRIPT = fileURLToPath(new URL("../scripts/lane-report.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

test("Z-C18: `node scripts/lane-report.mjs --help` exits 0 under plain Node (the JSON hook loads story.js)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Usage: node scripts\/lane-report\.mjs --from <ISO> --to <ISO> --bing-keys <path>/);
  assert.equal(r.stderr, "");
});

test("Z-C13: the read-only check refuses a second statement, PRAGMA, ATTACH, REPLACE, comments and missing LIMIT; a quoted 'delete' is fine", () => {
  for (const sql of [
    "SELECT 1 LIMIT 1; DELETE FROM items",
    "select * from x limit 1; drop table x",
    "PRAGMA table_info(items)",
    "ATTACH DATABASE 'x' AS y",
    "SELECT replace(title, 'a', 'b') FROM items LIMIT 1",
    "SELECT * FROM items",
    "SELECT * FROM items LIMIT 1 -- x",
    "SELECT * FROM items /* x */ LIMIT 1",
    "SELECT 'unbalanced FROM items LIMIT 1",
    "WITH x AS (SELECT 1) SELECT * FROM x LIMIT 1",
    "INSERT INTO items SELECT * FROM items LIMIT 1",
  ]) assert.throws(() => R.guardSql(sql), /read-only check/, sql);
  assert.equal(R.guardSql("SELECT id FROM items WHERE title = 'delete' LIMIT 1;"), "SELECT id FROM items WHERE title = 'delete' LIMIT 1;");
  assert.ok(R.guardSql("EXPLAIN QUERY PLAN SELECT id FROM items LIMIT 1"));
  // Every LANE_SQL statement passes once filled.
  const keys = ["bing_acme"], stamp = "20300301001700";
  const ARGS = { Z1: [FROM, TO, "u1"], Z2: [FROM, TO, "u1"], N1: [], N2_SEEDS: [keys], N2_FIRST: [keys], N3: [], N4A: [stamp, stamp, "u1"], N4R: [FROM, TO], N5: [keys, FROM, TO] };
  assert.deepEqual(Object.keys(ARGS).sort(), Object.keys(LANE_SQL).sort());
  for (const [name, sql] of Object.entries(LANE_SQL)) assert.ok(R.bindSql(sql, ARGS[name]), name);
});

test("bindSql fills only ISO times, 14-digit stamps, universe ids and key arrays", () => {
  assert.equal(R.bindSql("SELECT 1 FROM t WHERE a >= ?1 AND u = ?2 AND s < ?3 LIMIT 1", [FROM, "u1", "20300301001700"]),
    `SELECT 1 FROM t WHERE a >= '${FROM}' AND u = 'u1' AND s < '20300301001700' LIMIT 1`);
  assert.equal(R.bindSql("SELECT 1 FROM t WHERE k IN (SELECT value FROM json_each(?1)) LIMIT 1", [["bing_acme", "widenet_x"]]),
    `SELECT 1 FROM t WHERE k IN (SELECT value FROM json_each('["bing_acme","widenet_x"]')) LIMIT 1`);
  for (const bad of ["x' OR 1=1 --", "U1", "2030-03-01", 5, ["Bad Key"], ["a'b"]]) {
    assert.throws(() => R.bindSql("SELECT 1 FROM t WHERE a = ?1 LIMIT 1", [bad]), /placeholder/, JSON.stringify(bad));
  }
  assert.throws(() => R.bindSql("SELECT 1 FROM t WHERE a = ?2 LIMIT 1", [FROM]), /no value/);
});

// --- main() on stand-ins -------------------------------------------------------
function fixture({ wideNet = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lane-report-"));
  const zen = zenithDb();
  const news = laneNewsDb({ wideNet });
  news.prepare("INSERT INTO source_diagnostics (key, polled_at, ok, request_host) VALUES ('bing_acme', ?, 1, 'www.bing.com')").run(T(0));
  news.prepare("INSERT INTO source_seeds (key, seeded_at) VALUES ('bing_acme', ?)").run(T(1));
  // news-monitor's first stored row of the key is earlier than its seed record: the seed table wins.
  news.prepare("INSERT INTO items (source_key, url, title, published, first_seen) VALUES ('bing_acme', 'https://example.com/n/0', 'x', ?, ?)").run(T(-1), T(0.5));
  const url = "https://example.com/wn/1";
  for (const r of [
    aux({ seen: 1.5, title: "Seed window row of the Bing key" }),
    aux({ seen: 50, pub: 20, score: 80, title: "Acme buys a Northland robot maker" }),
    cov({ key: "widenet_x", seen: 80, url, title: "[TST] Acme opens a new plant in Northland", score: 75 }),
  ]) storeZenith(zen, r);
  if (wideNet) storeHit(news, hit({ seen: 79.9, url }));
  const statements = [];
  const run = (target, sql) => {
    statements.push([target, sql]);
    return (target === "zenith" ? zen.db : news).prepare(sql).all();
  };
  const keys = join(dir, "bing-keys.json");
  writeFileSync(keys, JSON.stringify(bingFile()));
  return { dir, run, keys, statements, news, out: join(dir, "out.json") };
}
const capture = () => {
  const lines = { log: [], error: [] };
  return { lines, log: (s) => lines.log.push(s), error: (s) => lines.error.push(s) };
};

test("main: reads both databases through the checked runner, writes the report outside the repo, prints numbers only", async () => {
  const f = fixture();
  const io = capture();
  try {
    const code = await R.main(["--from", FROM, "--to", TO, "--bing-keys", f.keys, "--out", f.out, "--outlet-keys", "acme_ir"], { run: f.run, ...io, now: () => new Date(T(400)) });
    assert.equal(code, 0, io.lines.error.join("\n"));
    for (const [, sql] of f.statements) assert.equal(R.guardSql(sql), sql);
    assert.deepEqual([...new Set(f.statements.map(([t]) => t))].sort(), ["news", "zenith"]);
    const r = JSON.parse(readFileSync(f.out, "utf8"));
    assert.equal(r.lanes.bing.rows, 2);
    assert.equal(r.lanes.bing.post_seed, 1, "the seed table time, not the earlier first row, marks the seed window");
    assert.equal(r.bing_only_material.length, 1);
    assert.equal(r.new_material_unique.total, 1);
    assert.equal(r.L1.n, 1);
    assert.equal(r.L1.P1, "not_measurable");
    assert.equal(r.bing_polls_60m, 0);
    assert.equal(r.widenet_data, true);
    assert.equal(r.universe, "u1");
    assert.equal(r.L1.sample_pool, undefined);
    assert.deepEqual([r.beside.rest_lane_material, r.beside.non_gdelt_material, r.beside.outlet_keys], [0, 0, 1]);
    const printed = io.lines.log.join("\n");
    assert.match(printed, /^bing: rows 2, post-seed 1/m);
    assert.match(printed, /^new_material_unique: 1 /m);
    assert.match(printed, /^beside: rest-lane 70\+ rows 0; phase 5 non-GDELT 70\+ rows 0;/m);
    for (const word of ["Acme", "Northland", "bing_acme", "widenet_x", "example.com", "TST"]) assert.ok(!printed.includes(word), word);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("main: no wide-net tables yet reads as `wide net: no data`; a Bing-host key missing from the file stops (exit 3)", async () => {
  const f = fixture({ wideNet: false });
  try {
    let io = capture();
    assert.equal(await R.main(["--from", FROM, "--to", TO, "--bing-keys", f.keys, "--out", f.out], { run: f.run, ...io }), 0, io.lines.error.join("\n"));
    const none = JSON.parse(readFileSync(f.out, "utf8"));
    assert.equal(none.widenet_data, false);
    assert.deepEqual(none.verdict, { P1: "not_measurable", P2: "not_measurable", P3: "not_measurable", P4: "not_measurable" }, "no wide-net data is never a failure");
    assert.match(io.lines.log[0], /wide net: no data/);
    assert.ok(io.lines.log.some((l) => /phase 5 non-GDELT 70\+ rows not given/.test(l)));

    io = capture();
    assert.equal(await R.main(["--from", FROM, "--to", TO, "--bing-keys", f.keys, "--out", f.out, "--outlet-keys", "bing_acme"], { run: () => { throw new Error("no statement may run"); }, ...io }), 2);
    assert.match(io.lines.error[0], /^--outlet-keys: outlet key bing_acme is not a rest-lane key/);

    f.news.prepare("INSERT INTO source_diagnostics (key, polled_at, ok, request_host) VALUES ('bing_other', ?, 1, 'www.bing.com')").run(T(0));
    io = capture();
    const out2 = join(f.dir, "out2.json");
    assert.equal(await R.main(["--from", FROM, "--to", TO, "--bing-keys", f.keys, "--out", out2], { run: f.run, ...io }), 3);
    assert.match(io.lines.error.join("\n"), /^stopped: bing key file is missing 1 Bing-host key/);
    assert.equal(existsSync(out2), false);

    writeFileSync(f.keys, JSON.stringify(bingFile([{ key: "bing_acme" }, { key: "bing_other" }], ["wn_x"])));
    io = capture();
    assert.equal(await R.main(["--from", FROM, "--to", TO, "--bing-keys", f.keys, "--out", out2], { run: f.run, ...io }), 3);
    assert.match(io.lines.error.join("\n"), /without the widenet_ prefix/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Z-C13: --out, --bing-keys and --pattern-check inside the repository are refused before any statement runs", async () => {
  const f = fixture();
  const never = () => { throw new Error("no statement may run"); };
  try {
    for (const args of [
      ["--out", join(REPO, "worker", "report.json"), "--bing-keys", f.keys],
      ["--out", f.out, "--bing-keys", join(REPO, "bing-keys.json")],
      ["--out", f.out, "--bing-keys", f.keys, "--pattern-check", join(REPO, "test", "fixtures", "pattern-check.json")],
    ]) {
      const io = capture();
      assert.equal(await R.main(["--from", FROM, "--to", TO, ...args], { run: never, ...io }), 2, args.join(" "));
      assert.match(io.lines.error[0], /inside the repository/);
    }
    assert.equal(R.insideRepo(REPO), true);
    assert.equal(R.insideRepo(join(REPO, "..", "elsewhere", "x.json")), false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("main: usage errors exit 2 (missing --bing-keys, bad times, unknown flag, bad universe)", async () => {
  const never = () => { throw new Error("no statement may run"); };
  for (const args of [
    ["--from", FROM, "--to", TO],
    ["--from", "yesterday", "--to", TO, "--bing-keys", "x"],
    ["--from", TO, "--to", FROM, "--bing-keys", "x"],
    ["--from", FROM, "--to", TO, "--bing-keys", "x", "--universe", "U-1"],
    ["--from", FROM, "--to", TO, "--bing-keys", "x", "--pubtime-sample", "-1"],
    ["--from", FROM, "--to", TO, "--bing-keys", "x", "--outlet-keys", "Bad Key"],
    ["--from", FROM, "--to", TO, "--bing-keys", "x", "--outlet-keys", ","],
    ["--nope"],
  ]) {
    const io = capture();
    assert.equal(await R.main(args, { run: never, ...io }), 2, args.join(" "));
  }
});

test("L3 pubtimeSample: obeys robots.txt per host, waits between requests, reports the median offset", async () => {
  const calls = [], sleeps = [];
  const page = (iso) => `<html><head><meta property="article:published_time" content="${iso}"></head></html>`;
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers["user-agent"]]);
    const u = new URL(url);
    if (u.pathname === "/robots.txt") return u.host === "blocked.example.com" ? new Response("User-agent: *\nDisallow: /\n") : new Response("", { status: 404 });
    if (u.pathname === "/a") return new Response(page(T(9)));
    if (u.pathname === "/b") return new Response(page(T(7)));
    return new Response("<p>no time</p>");
  };
  const pool = [
    { url: "https://example.com/a", published: T(10) },
    { url: "https://example.com/b", published: T(10) },
    { url: "https://example.com/c", published: T(10) },
    { url: "https://blocked.example.com/x", published: T(10) },
  ];
  const r = await R.pubtimeSample(pool, 4, { fetchImpl, sleep: async (t) => { sleeps.push(t); }, random: () => 0.5 });
  assert.deepEqual(r, { requested: 4, read: 2, robots_refused: 1, failed: 1, offset_median_h: 2 });
  assert.equal(calls.filter(([u]) => u.endsWith("/robots.txt")).length, 2, "robots.txt once per host");
  assert.ok(!calls.some(([u]) => u.includes("blocked.example.com/x")), "a disallowed page is never requested");
  assert.ok(calls.every(([, ua]) => ua === "zenith-lag-check/1.0"));
  assert.equal(sleeps.length, calls.length - 1);
  assert.ok(sleeps.every((t) => t >= 3000));
});

test("L3 pubtimeSample: redirects are not followed blindly; robots.txt of each host a redirect names is read and obeyed first", async () => {
  const calls = [], sleeps = [];
  const page = (iso) => `<html><head><meta property="article:published_time" content="${iso}"></head></html>`;
  const moved = (to) => new Response(null, { status: 301, headers: { location: to } });
  const fetchImpl = async (url, init) => {
    calls.push([url, init.redirect]);
    const u = new URL(url);
    if (u.pathname === "/robots.txt") {
      if (u.host === "closed.example.com") return new Response("User-agent: *\nDisallow: /\n");
      if (u.host === "bounce.example.com") return moved("https://elsewhere.example.com/404");
      return new Response("", { status: 404 });
    }
    if (u.host === "start.example.com" && u.pathname === "/to-closed") return moved("https://closed.example.com/story");
    if (u.host === "start.example.com" && u.pathname === "/to-open") return moved("/moved");
    if (u.host === "start.example.com" && u.pathname === "/moved") return moved("https://open.example.com/story");
    if (u.host === "open.example.com") return new Response(page(T(9)));
    return new Response("<p>no time</p>");
  };
  const pool = [
    { url: "https://start.example.com/to-closed", published: T(10) },
    { url: "https://start.example.com/to-open", published: T(10) },
    { url: "https://bounce.example.com/story", published: T(10) },
  ];
  const r = await R.pubtimeSample(pool, 3, { fetchImpl, sleep: async (t) => { sleeps.push(t); }, random: () => 0.999 });
  assert.deepEqual(r, { requested: 3, read: 1, robots_refused: 2, failed: 0, offset_median_h: 1 });
  assert.ok(calls.every(([, mode]) => mode === "manual"), "no request follows redirects itself");
  assert.ok(calls.some(([u]) => u === "https://closed.example.com/robots.txt"));
  assert.ok(!calls.some(([u]) => u === "https://closed.example.com/story"), "a page behind a disallowing host is never requested");
  assert.ok(!calls.some(([u]) => u.startsWith("https://elsewhere.example.com")), "a redirecting robots.txt is a refusal, not followed");
  assert.equal(calls.filter(([u]) => u === "https://start.example.com/robots.txt").length, 1, "one robots.txt read per host across hops");
  assert.ok(calls.some(([u]) => u === "https://open.example.com/story"));
  assert.equal(sleeps.length, calls.length - 1);
  assert.ok(sleeps.every((t) => t >= 3000));
});
