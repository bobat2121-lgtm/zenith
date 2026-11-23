// End-to-end harness for auxiliary names (test/aux-e2e.test.js, and a local
// server to point the Streamlit app at): the Worker's fetch() behind a real
// node:http server, a news-monitor-db seeded with one row of every routing
// class, the real grader CLI run as a child process, and the grades the
// grader would write for a claim. Exports only: nothing runs on import.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLI = join(root, "grader", "zenith.mjs");

// Serves worker.fetch(request, env) on 127.0.0.1 (a free port). Resolves to
// { url, close }.
export async function serveWorker(worker, env) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const hasBody = !["GET", "HEAD"].includes(req.method) && chunks.length;
      const r = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `harness: ${e?.message || e}` }));
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
}

// Runs `node grader/zenith.mjs ...args` in cwd (so .zenith/ lands there) without
// blocking the in-process server. Fails if the token ever reaches the output.
export function runGrader(args, { api, token, cwd }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ZENITH_/i.test(k)));
  Object.assign(env, { ZENITH_API: api, ZENITH_GRADER_TOKEN: token, ZENITH_MODEL: "e2e-model" });
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (stdout.includes(token) || stderr.includes(token)) reject(new Error(`zenith.mjs ${args.join(" ")} printed the token`));
      else resolve({ code, stdout, stderr });
    });
  });
}

const HOUR = 3_600_000;
const iso = (now, msAgo) => new Date(now - msAgo).toISOString();

// A release body long enough to be the release itself (feed excerpt).
export const ANDURIL_RELEASE = [
  "Anduril raises $2.5 billion Series G",
  "COSTA MESA, CA / November 23, 2026 / Anduril Industries today announced a $2.5 billion Series G led by a growth fund, valuing the company at $30.5 billion.",
  ...Array.from({ length: 30 }, (_, k) => `The company will expand Arsenal-1 production and its autonomous systems programs, phase ${k}.`),
  "The round brings total funding to $6.2 billion.",
].join("\n");

// One news-monitor row per routing class. `tag` names the row for the tests
// (it is not a news-monitor column). Rows are inserted in this order.
export function newsRows(now = Date.now()) {
  const burst = iso(now, 5 * HOUR);
  return [
    // Covered company: coverage only.
    { tag: "covered", source_key: "redcat", title: "Red Cat wins Army follow-on order for Black Widow systems", first_seen: iso(now, 6 * HOUR) },
    // Counterparty filter built for a covered company (FPDS notices naming Planet Labs): graded on
    // Coverage and also auxiliary as a coverage subject; this one is mainly about the covered company.
    { tag: "co_mention", source_key: "fpds_pl", title: "Contract notice: Planet Labs PBC imagery subscription", first_seen: iso(now, 5.5 * HOUR) },
    // Ops: a site-structure watcher.
    { tag: "ops", source_key: "site_kodiak", title: "kodiak.ai sitemap changed", first_seen: iso(now, 5.2 * HOUR) },
    // Archive seed burst: six undated pages from one poll.
    ...Array.from({ length: 6 }, (_, k) => ({ tag: "archive", source_key: "zoox", url: `https://zoox.com/journal/${k}`, title: `Zoox journal page ${k}`,
      published: null, first_seen: burst })),
    // Runtime managed_* key for a covered company: a coverage duplicate, never auxiliary.
    { tag: "managed_covered", source_key: "managed_draganfly_news", title: "Draganfly news mention", first_seen: iso(now, 4.5 * HOUR) },
    // Peer newsroom.
    { tag: "anduril_noise", source_key: "anduril", title: "Anduril hosts Arsenal-1 hiring event in Ohio", first_seen: iso(now, 4 * HOUR) },
    // Counterparty company channel: also an auxiliary name.
    { tag: "skydio", source_key: "skydio", title: "Skydio X10 now deployed with two more state police agencies", first_seen: iso(now, 3.5 * HOUR) },
    // Runtime managed_* key for a name outside the static registry.
    { tag: "managed", source_key: "managed_fort_robotics_news", title: "FORT Robotics closes $40M Series C for machine safety controllers",
      first_seen: iso(now, 3 * HOUR) },
    // Program source whose item is mainly about a covered company.
    { tag: "program", source_key: "nga", title: "NGA extends commercial imagery agreement with Planet Labs", first_seen: iso(now, 2.5 * HOUR) },
    { tag: "anduril_lead", source_key: "anduril", url: "https://www.anduril.com/article/series-g", title: "Anduril raises $2.5 billion Series G",
      first_seen: iso(now, 2 * HOUR), body: ANDURIL_RELEASE },
    // Industry media: a trade-press copy of the Anduril raise.
    { tag: "media", source_key: "ia_media_dronelife", title: "Anduril lands $2.5B Series G at a $30.5B valuation", first_seen: iso(now, 1.5 * HOUR) },
  ];
}

// Inserts rows into a newsDb() (test/helpers/worker-env.js) that has a body column.
let seq = 0;
export function insertNews(news, rows) {
  const stmt = news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified, body) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)");
  for (const r of rows) {
    stmt.run(r.source_key, r.url ?? `https://news.example.com/${r.source_key}/${++seq}`, r.title,
      r.published === undefined ? r.first_seen : r.published, r.first_seen, r.body ?? null);
  }
}

// The grades the grader would write for a claim, keyed by source_key (and title
// for the two Anduril items). invalid: the same grades with one contract error
// each on four of them (the API rejects those and accepts the rest).
export function gradesFor(claim, coveredTicker, { invalid = false } = {}) {
  const by = (pred) => claim.items.find(pred);
  const lead = by((i) => i.source_key === "anduril" && /Series G/.test(i.title));
  const noise = by((i) => i.source_key === "anduril" && /hiring/.test(i.title));
  const fort = by((i) => i.source_key === "managed_fort_robotics_news");
  const media = by((i) => i.source_key === "ia_media_dronelife");
  const nga = by((i) => i.source_key === "nga");
  const skydio = by((i) => i.source_key === "skydio");
  const fpds = by((i) => i.source_key === "fpds_pl");
  const base = { reads_through: [], confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null };
  const grades = [
    { ...base, item_id: lead.item_id, entity: "Anduril", score: 92, band: invalid ? "digest" : "lead", event_type: "financing",
      why: "Anduril raised a $2.5B Series G at a $30.5B valuation.", reads_through: [{ ticker: coveredTicker, direction: "-" }], flags: ["reason:material"] },
    { ...base, item_id: noise.item_id, entity: "Anduril", score: 20, band: "reject", event_type: "hiring", why: "Hiring event for Arsenal-1.", flags: ["reason:noise"] },
    { ...base, item_id: fort.item_id, entity: "FORT Robotics", score: 75, band: "digest", event_type: "financing",
      why: "FORT Robotics closed a $40M Series C.", flags: ["reason:material"], reads_through: invalid ? [{ ticker: "TSLA", direction: "+" }] : [] },
    { ...base, item_id: media.item_id, entity: "Anduril", score: null, band: "duplicate", event_type: "duplicate",
      why: "Trade-press copy of the Anduril Series G release.", flags: ["reason:duplicate"], dup_of: invalid ? media.item_id : lead.item_id },
    { ...base, item_id: nga.item_id, entity: "Planet Labs", score: null, band: "covered", event_type: "covered",
      why: "NGA imagery agreement with Planet Labs.", flags: ["reason:covered_name"], covered_ticker: invalid ? "XYZ" : "PL" },
    { ...base, item_id: skydio.item_id, entity: "Skydio", score: 55, band: "borderline", event_type: "deployment",
      why: "Two more state police agencies deployed Skydio X10.", flags: ["reason:minor"] },
    { ...base, item_id: fpds.item_id, entity: "Planet Labs", score: null, band: "covered", event_type: "covered",
      why: "FPDS notice for a Planet Labs imagery subscription: the covered company's own award.", flags: ["reason:covered_name"], covered_ticker: "PL" },
  ];
  return { grades, ids: { lead: lead.item_id, noise: noise.item_id, fort: fort.item_id, media: media.item_id, nga: nga.item_id, skydio: skydio.item_id,
    fpds: fpds.item_id } };
}
