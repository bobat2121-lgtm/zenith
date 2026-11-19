#!/usr/bin/env node
// Zenith grader CLI — used by the hourly Claude routine (and by hand).
// Env: ZENITH_API (e.g. https://zenith-core.<sub>.workers.dev), ZENITH_GRADER_TOKEN.
//
//   node grader/zenith.mjs stats
//   node grader/zenith.mjs rubric [TICKER ...]     -> writes .zenith/rubric/{core.md,TICKER.md}
//   node grader/zenith.mjs labels [days=30]          -> analyst labels, disagreements first
//   node grader/zenith.mjs claim [limit=30]          -> writes .zenith/claim.json, prints the batch
//   node grader/zenith.mjs submit <grades.json>      -> posts grades for the current claim
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const API = (process.env.ZENITH_API || "").replace(/\/$/, "");
const TOKEN = process.env.ZENITH_GRADER_TOKEN || "";
const OUT = join(process.cwd(), ".zenith");
const MODEL = process.env.ZENITH_MODEL || "claude-routine";

function die(msg) { console.error(`zenith: ${msg}`); process.exit(1); }
if (!API || !TOKEN) die("set ZENITH_API and ZENITH_GRADER_TOKEN");

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) die(`${method} ${path} -> HTTP ${r.status}: ${text.slice(0, 300)}`);
  return data;
}

const BANDS = "Lead 90-100 | Digest 70-89 | Borderline 40-69 | Reject <40";
const [cmd, ...args] = process.argv.slice(2);
mkdirSync(join(OUT, "rubric"), { recursive: true });

if (cmd === "stats") {
  const s = await call("GET", "/v1/stats");
  console.log(JSON.stringify({ rubric_version: s.rubric_version, by_state: s.by_state, by_band: s.by_band, labels: s.labels,
    oldest_pending: s.oldest_pending_first_seen, last_run: s.last_run }, null, 1));
} else if (cmd === "rubric") {
  const core = await call("GET", "/v1/rubric");
  writeFileSync(join(OUT, "rubric", "core.md"), core.core);
  writeFileSync(join(OUT, "rubric", "VERSION"), core.rubric_version);
  const wanted = args.length ? args.map((t) => t.toUpperCase()) : core.tickers;
  for (const t of wanted) {
    const s = await call("GET", `/v1/rubric/${t}`);
    writeFileSync(join(OUT, "rubric", `${t}.md`), s.sheet);
  }
  console.log(`rubric ${core.rubric_version}: core.md + ${wanted.length} sheet(s) in .zenith/rubric/ (${BANDS})`);
} else if (cmd === "labels") {
  const days = Number(args[0]) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { labels } = await call("GET", `/v1/labels?since=${encodeURIComponent(since)}&limit=500`);
  const want = { high: 85, medium: 70, low: 45, noise: 15 };
  const rows = labels.map((l) => ({ ...l, gap: l.graded_score == null ? null : want[l.label] - l.graded_score }));
  rows.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
  writeFileSync(join(OUT, "labels.json"), JSON.stringify(rows, null, 1));
  console.log(`${rows.length} analyst label(s) in the last ${days} days (biggest disagreements first; full list in .zenith/labels.json)`);
  for (const l of rows.slice(0, 40)) {
    console.log(`- [${l.ticker}] analyst=${l.label.toUpperCase()} grader=${l.graded_score ?? "-"} (${l.graded_band ?? "-"}) :: ${l.title}${l.note ? `  || analyst note: ${l.note}` : ""}`);
  }
} else if (cmd === "claim") {
  const limit = Math.min(60, Number(args[0]) || 30);
  const version = existsSync(join(OUT, "rubric", "VERSION")) ? readFileSync(join(OUT, "rubric", "VERSION"), "utf8") : "";
  const c = await call("POST", "/v1/queue/claim", { limit, run_id: process.env.ZENITH_RUN_ID || undefined, model: MODEL, rubric_version: version });
  writeFileSync(join(OUT, "claim.json"), JSON.stringify(c, null, 1));
  if (!process.env.ZENITH_RUN_ID) console.log(`(tip: export ZENITH_RUN_ID=${c.run_id} so all batches in this run share it)`);
  console.log(`claim ${c.claim_id}: ${c.items.length} item(s), ${c.remaining} more waiting. Rubric ${c.rubric_version}. Full items in .zenith/claim.json`);
  for (const i of c.items) {
    console.log(`\n### item_id=${i.item_id} ticker=${i.ticker} source=${i.source_key} first_seen=${i.first_seen} published=${i.published ?? "-"}`);
    console.log(`TITLE: ${i.title}`);
    console.log(`URL: ${i.url}`);
    console.log(i.excerpt ? `EXCERPT (${i.excerpt_status}): ${i.excerpt.slice(0, 1800)}` : `EXCERPT: none (${i.excerpt_status ?? "not fetched"})`);
  }
} else if (cmd === "submit") {
  if (!args[0]) die("usage: submit <grades.json>");
  const grades = JSON.parse(readFileSync(args[0], "utf8"));
  const list = Array.isArray(grades) ? grades : grades.grades;
  const claim = existsSync(join(OUT, "claim.json")) ? JSON.parse(readFileSync(join(OUT, "claim.json"), "utf8")) : {};
  const version = existsSync(join(OUT, "rubric", "VERSION")) ? readFileSync(join(OUT, "rubric", "VERSION"), "utf8") : claim.rubric_version;
  const r = await call("POST", "/v1/grades", { claim_id: claim.claim_id, run_id: claim.run_id, rubric_version: version, model: MODEL, grades: list });
  console.log(`accepted ${r.accepted}, rejected ${r.rejected.length}`);
  for (const x of r.rejected) console.log(`  REJECTED item ${x.item_id}: ${x.error}`);
  if (r.rejected.length) process.exitCode = 2;
} else {
  console.log("usage: zenith.mjs stats | rubric [TICKER...] | labels [days] | claim [limit] | submit <grades.json>");
}
