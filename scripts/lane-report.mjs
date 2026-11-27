#!/usr/bin/env node
// The 14-day side-by-side report: lag and uniqueness per lane (Bing, the wide
// net, everything else), read-only, on the integrator's machine. Never runs in
// the Worker. Every statement goes through `npx wrangler d1 execute <db>
// --remote --json --command "<sql>"` from worker/, after a read-only check.
//
//   node scripts/lane-report.mjs --from <ISO> --to <ISO> --bing-keys <path>
//     [--pattern-check <path>] [--universe u1] [--pubtime-sample 0] [--out <path>]
//     [--outlet-keys <key,key,...>]
//
// The key file, the pattern check and the output name sources and titles, so
// all three must live outside this repository (it is public); the script
// refuses paths inside it. It prints a numbers-only summary.
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hookJsonImports } from "./json-import-hook.mjs";

hookJsonImports();
const M = await import("../worker/src/lane-metrics.js");

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = join(REPO, "worker");
const DAY = 86_400_000;

export const USAGE = `Usage: node scripts/lane-report.mjs --from <ISO> --to <ISO> --bing-keys <path>
       [--pattern-check <path>] [--universe u1] [--pubtime-sample 0] [--out <path>]
       [--outlet-keys <key,key,...>]

  --from, --to       the window [from, to) in UTC (rows from from - 7 days are read for linking)
  --bing-keys        bing-keys.json from news-monitor's scripts/bing-export.mjs (outside this repo)
  --pattern-check    pattern-check.json from scripts/bing-pattern-check.mjs (missing: no key counts as covered)
  --universe         universe id (default u1)
  --pubtime-sample   N: read the stated publication time of N random L1 pages (default 0, no request)
  --out              output JSON (default ../plans/phase5-sidebyside/<to date>.json; outside this repo)
  --outlet-keys      the phase 5 outlet source keys (rest lane), comma-separated; their 70+ rows are
                     printed beside the verdict as phase 5 non-GDELT material (omitted: "not given")

Read-only: every statement is a SELECT or EXPLAIN with a LIMIT.`;

// --- The read-only check --------------------------------------------------------
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
export function stripLiterals(sql) {
  return String(sql).replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}
// Throws unless the statement (quoted literals stripped) starts with SELECT or
// EXPLAIN, has a LIMIT, has no `;` except one trailing, no comment and none of
// the write or schema words. Returns the statement.
export function guardSql(sql) {
  const s = stripLiterals(sql).trim();
  const bare = s.replace(/''/g, "").replace(/""/g, "");
  if (/['"]/.test(bare)) throw new Error("read-only check: unbalanced quote");
  if (!/^(SELECT|EXPLAIN)\b/i.test(s)) throw new Error("read-only check: not a SELECT or EXPLAIN");
  if (!/\bLIMIT\b/i.test(s)) throw new Error("read-only check: no LIMIT");
  if (s.replace(/;\s*$/, "").includes(";")) throw new Error("read-only check: more than one statement");
  if (/--|\/\*/.test(s)) throw new Error("read-only check: comment");
  const w = WRITE_WORDS.exec(s);
  if (w) throw new Error(`read-only check: ${w[1].toUpperCase()}`);
  return String(sql);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
const STAMP = /^\d{14}$/;
const UNIVERSE = /^[a-z0-9_]{1,32}$/;
const KEY = /^[a-z0-9_]+$/;
function literal(v) {
  if (Array.isArray(v)) {
    for (const k of v) if (typeof k !== "string" || !KEY.test(k)) throw new Error(`placeholder: bad key ${JSON.stringify(k)}`);
    return `'${JSON.stringify(v)}'`;
  }
  const s = String(v);
  if (typeof v === "string" && (ISO.test(s) || STAMP.test(s) || UNIVERSE.test(s))) return `'${s}'`;
  throw new Error(`placeholder: refused value ${JSON.stringify(v)}`);
}
// Fills ?n with checked literals, then runs the read-only check.
export function bindSql(sql, params = []) {
  const out = String(sql).replace(/\?(\d+)/g, (_, n) => {
    const i = Number(n) - 1;
    if (!(i in params)) throw new Error(`placeholder ?${n} has no value`);
    return literal(params[i]);
  });
  return guardSql(out);
}

// --- Paths --------------------------------------------------------------------
const real = (p) => {
  let cur = resolve(p);
  const tail = [];
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    tail.unshift(cur.slice(up.length).replace(/^[\\/]/, ""));
    cur = up;
  }
  return join(existsSync(cur) ? realpathSync(cur) : cur, ...tail);
};
export function insideRepo(p, repo = REPO) {
  const norm = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
  const rel = relative(norm(real(repo)), norm(real(p)));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// --- Running statements ---------------------------------------------------------
function dbNames() {
  const toml = readFileSync(join(WORKER, "wrangler.toml"), "utf8");
  const out = {};
  for (const m of toml.matchAll(/binding\s*=\s*"(DB|NEWS)"[^\[]*?database_name\s*=\s*"([^"]+)"/g)) out[m[1] === "DB" ? "zenith" : "news"] = m[2];
  if (!out.zenith || !out.news) throw new Error("worker/wrangler.toml: DB or NEWS database name not found");
  return out;
}
// One statement through wrangler, remote, JSON out. Without a shell on every
// platform (Windows runs npm's own npx entry with this node), so the statement
// reaches wrangler as one argument.
export function runWrangler(target, sql) {
  const db = dbNames()[target];
  const args = ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", guardSql(sql)];
  const [cmd, pre] = process.platform === "win32"
    ? [process.execPath, [join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]]
    : ["npx", []];
  const r = spawnSync(cmd, [...pre, ...args], { cwd: WORKER, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* not JSON */ }
  if (r.status !== 0 || !Array.isArray(parsed)) {
    const text = parsed?.error?.text || parsed?.error?.message || r.stderr || r.stdout || `exit ${r.status}`;
    throw new Error(String(text).trim().slice(0, 2000));
  }
  return parsed[0]?.results ?? [];
}

const chunks = (xs, n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const noTable = (e) => /no such table/i.test(String(e?.message ?? e));

// --- L3: the opt-in publication-time sample -------------------------------------
const UA = "zenith-lag-check/1.0";
const CAP_BYTES = 400 * 1024;
async function politeGet(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(5000) });
  let text = "";
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      text += dec.decode(value, { stream: true });
      if (n >= CAP_BYTES) { await reader.cancel().catch(() => {}); break; }
    }
  } else {
    text = (await res.text()).slice(0, CAP_BYTES);
  }
  return { status: res.status, text };
}
// For N random pool rows: robots.txt read once per host and obeyed, at least
// 3 s between any two requests, 5 s timeout, 400 KB cap. Returns the median of
// stored published minus the page's stated time, in hours.
export async function pubtimeSample(pool, n, { fetchImpl = fetch, sleep = (t) => new Promise((r) => setTimeout(r, t)), random = Math.random, gapMs = 3000 } = {}) {
  const picks = pool.slice();
  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
  const robots = new Map();
  let requests = 0;
  const get = async (url) => { if (requests++) await sleep(gapMs); return politeGet(url, fetchImpl); };
  const out = { requested: Math.min(n, picks.length), read: 0, robots_refused: 0, failed: 0, offsets_h: [] };
  for (const row of picks.slice(0, n)) {
    let u;
    try { u = new URL(row.url); } catch { out.failed++; continue; }
    if (!robots.has(u.host)) {
      let allowAll = null, txt = "";
      try {
        const r = await get(`${u.protocol}//${u.host}/robots.txt`);
        if (r.status === 404 || r.status === 410) allowAll = true;
        else if (r.status >= 200 && r.status < 300) txt = r.text;
        else allowAll = false;
      } catch { allowAll = false; }
      robots.set(u.host, { allowAll, txt });
    }
    const rb = robots.get(u.host);
    const ok = rb.allowAll ?? M.robotsAllows(rb.txt, u.pathname + u.search, UA);
    if (!ok) { out.robots_refused++; continue; }
    try {
      const r = await get(row.url);
      const page = r.status >= 200 && r.status < 300 ? M.pagePublished(r.text) : null;
      const stored = Date.parse(row.published);
      if (!page || !Number.isFinite(stored)) { out.failed++; continue; }
      out.read++;
      out.offsets_h.push((stored - Date.parse(page)) / 3_600_000);
    } catch { out.failed++; }
  }
  const med = M.median(out.offsets_h);
  return { requested: out.requested, read: out.read, robots_refused: out.robots_refused, failed: out.failed, offset_median_h: med == null ? null : Math.round(med * 100) / 100 };
}

// --- The run ------------------------------------------------------------------
const isoArg = (v, name) => {
  const t = Date.parse(String(v ?? ""));
  if (!v || !Number.isFinite(t)) throw new UsageError(`--${name} must be an ISO time`);
  return new Date(t).toISOString();
};
class UsageError extends Error {}
class StopError extends Error {}

export function summaryLines(r) {
  const L = (lane) => {
    const s = r.lanes[lane];
    return `${lane}: rows ${s.rows}, post-seed ${s.post_seed}, dated ${s.dated}, fresh ${s.fresh}, stale share ${s.stale_share}, median ${s.lag_median_h} h (p25 ${s.lag_p25_h}, p90 ${s.lag_p90_h}), under 2 h ${s.under_2h}`;
  };
  const sp = r.stage_plan;
  return [
    `window: ${r.window.from} .. ${r.window.to} (${r.window.days} days)${r.widenet_data ? "" : "; wide net: no data"}`,
    L("bing"), L("widenet"), L("rest"),
    `L1: n ${r.L1.n}, median ${r.L1.median_h} h, date_exact share ${r.L1.date_exact_share}, L5 ${r.L1.L5_median_h} h, ingested ${r.L1.L1_ingested_median_h} h, P1 ${r.L1.P1}`,
    `new_material_unique: ${r.new_material_unique.total} (${r.new_material_unique.per_day_mean} a day; coverage ${r.new_material_unique.coverage}, aux ${r.new_material_unique.aux}), wide_net_first ${r.wide_net_first.total}, P2 ${r.new_material_unique.P2}`,
    `beside: rest-lane 70+ rows ${r.beside.rest_lane_material}; phase 5 non-GDELT 70+ rows ${r.beside.non_gdelt_material ?? "not given (--outlet-keys)"}; wide-net aux 70+ rows ${r.beside.widenet_aux_material}`,
    `L2: accepted n ${r.head_to_head.accepted.n}, median ${r.head_to_head.accepted.median_h} h; dup_collected n ${r.head_to_head.dup_collected.n}; P4 ${r.head_to_head.P4}`,
    `bing_only_material: ${r.bing_only_material.length}; pattern gaps: ${Object.values(r.per_bing_key).filter((k) => !k.pattern_covered).length}; cap days: ${r.cap_hit_days.length}`,
    `stage plan: ${sp.status}, keep ${sp.keep.length} (hourly ${sp.hourly}, ${sp.per_hour}/h), retire ${sp.retire.length}`,
    ...(r.bing_polls_60m != null ? [`bing polls, last 60 min: ${r.bing_polls_60m}`] : []),
    ...(r.L3 ? [`L3: read ${r.L3.read} of ${r.L3.requested}, offset ${r.L3.offset_median_h} h, L1 + offset ${r.L3.l1_plus_offset_h} h`] : []),
  ];
}

// main(argv, deps) -> exit code. deps.run(target, sql) runs one checked
// statement ("zenith" or "news") and returns its rows.
export async function main(argv, { run = runWrangler, log = console.log, error = console.error, fetchImpl = fetch, sleep, now = () => new Date() } = {}) {
  let o;
  try {
    ({ values: o } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        from: { type: "string" }, to: { type: "string" }, "bing-keys": { type: "string" }, "pattern-check": { type: "string" },
        universe: { type: "string", default: "u1" }, "pubtime-sample": { type: "string", default: "0" }, out: { type: "string" }, "outlet-keys": { type: "string" }, help: { type: "boolean" },
      },
    }));
    if (o.help) { log(USAGE); return 0; }
    const from = isoArg(o.from, "from"), to = isoArg(o.to, "to");
    if (!(from < to)) throw new UsageError("--from must be before --to");
    if (!UNIVERSE.test(o.universe)) throw new UsageError("--universe must match [a-z0-9_]{1,32}");
    const sample = Number(o["pubtime-sample"]);
    if (!Number.isInteger(sample) || sample < 0 || sample > 200) throw new UsageError("--pubtime-sample must be a whole number 0-200");
    if (!o["bing-keys"]) throw new UsageError("--bing-keys is required");
    const outletKeys = o["outlet-keys"] == null ? null : o["outlet-keys"].split(",").map((k) => k.trim()).filter(Boolean);
    if (outletKeys && (!outletKeys.length || !outletKeys.every((k) => KEY.test(k)))) throw new UsageError("--outlet-keys must be a comma list of source keys ([a-z0-9_]+)");
    const out = o.out ? resolve(o.out) : join(REPO, "..", "plans", "phase5-sidebyside", `${to.slice(0, 10)}.json`);
    for (const [name, p] of [["--bing-keys", o["bing-keys"]], ["--pattern-check", o["pattern-check"]], ["--out", out]]) {
      if (p && insideRepo(p)) throw new UsageError(`${name} is inside the repository; keep report inputs and output outside it`);
    }
    if (!o.out && !existsSync(join(REPO, "..", "plans"))) throw new UsageError("no ../plans folder next to the repository: pass --out");

    const bing = M.parseBingKeys(JSON.parse(readFileSync(o["bing-keys"], "utf8")));
    try { M.outletSet(outletKeys, bing); } catch (e) { throw new UsageError(`--outlet-keys: ${e.message}`); }
    const pattern = o["pattern-check"] ? M.parsePattern(JSON.parse(readFileSync(o["pattern-check"], "utf8"))) : null;
    const q = (target, sql, params) => run(target, bindSql(sql, params));

    // Cross-checks first: a Bing-host key missing from the file, or a drain key
    // without the prefix, stops the report.
    const hostKeys = q("news", M.LANE_SQL.N1, []).map((r) => r.key);
    try { M.checkBingKeys(bing, hostKeys); } catch (e) { throw new StopError(e.message); }

    const lookback = new Date(Date.parse(from) - 7 * DAY).toISOString();
    const ahead = new Date(Date.parse(to) + 7 * DAY).toISOString();
    const rows = [
      ...q("zenith", M.LANE_SQL.Z1, [lookback, to, o.universe]).map((r) => ({ ...r, pipeline: "coverage" })),
      ...q("zenith", M.LANE_SQL.Z2, [lookback, to, o.universe]).map((r) => ({ ...r, pipeline: "aux" })),
    ];
    const bingKeys = [...bing.keys.keys()];
    const shadowKeys = [...bing.keys.values()].filter((k) => k.shadow).map((k) => k.key);
    const shadow = [];
    for (const ks of chunks(shadowKeys)) shadow.push(...q("news", M.LANE_SQL.N5, [ks, lookback, to]));

    const wideKeys = [...new Set([...bing.widenet, ...rows.map((r) => r.source_key).filter((k) => String(k).startsWith(M.WIDENET_PREFIX))])];
    const seedKeys = [...new Set([...bingKeys, ...wideKeys])].filter((k) => KEY.test(k));
    const seedByKey = new Map();
    for (const ks of chunks(seedKeys)) for (const r of q("news", M.LANE_SQL.N2_SEEDS, [ks])) seedByKey.set(r.key, r.seeded_at);
    const missing = seedKeys.filter((k) => !seedByKey.has(k));
    for (const ks of chunks(missing)) for (const r of q("news", M.LANE_SQL.N2_FIRST, [ks])) if (r.first_row) seedByKey.set(r.source_key, r.first_row);

    const polls = q("news", M.LANE_SQL.N3, [])[0]?.polls_60m ?? null;

    let hits = [];
    try {
      hits = [
        ...q("news", M.LANE_SQL.N4A, [M.toStamp(lookback), M.toStamp(ahead), o.universe]),
        ...q("news", M.LANE_SQL.N4R, [lookback, ahead]),
      ];
    } catch (e) {
      if (!noTable(e)) throw e;
      hits = [];
    }

    const r = M.report(rows, hits, shadow, { from, to, bing, seedByKey, pattern, samplePool: sample > 0, outletKeys });
    r.bing_polls_60m = polls;
    r.generated_at = now().toISOString();
    r.universe = o.universe;
    if (sample > 0) {
      const l3 = await pubtimeSample(r.L1.sample_pool || [], sample, { fetchImpl, ...(sleep ? { sleep } : {}) });
      l3.l1_plus_offset_h = r.L1.median_h == null || l3.offset_median_h == null ? null : Math.round((r.L1.median_h + l3.offset_median_h) * 100) / 100;
      r.L3 = l3;
    }
    delete r.L1.sample_pool;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
    for (const line of summaryLines(r)) log(line);
    return 0;
  } catch (e) {
    if (e instanceof UsageError || e?.code?.startsWith?.("ERR_PARSE_ARGS")) { error(`${e.message}\n\n${USAGE}`); return 2; }
    if (e instanceof StopError) { error(`stopped: ${e.message}`); return 3; }
    error(`lane-report: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
