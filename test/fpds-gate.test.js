// Phase 1 (plans/phase1-build-spec.md, Part C §6.3, built as PR-GATE commit 2):
// FPDS posts actions late and news-monitor's FPDS adapter leaves every row after
// a source's first poll undated, so those rows took the unbudgeted fast path.
// They are now held 'record_fresh' and released by the daily budget. End to
// end through the Coverage ingest. Synthetic titles only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { ingest } = await import("../worker/src/ingest.js");
const { releaseHeld } = await import("../worker/src/budget.js");

const A = "2026-11-22T22:00:00.000Z";
const B = "2026-11-25T08:00:00.000Z";
const newEnv = () => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  env.DB.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0'), ('aux_nm_cursor', '0'), ('aux_cs_cursor', 'done'), ('aux_rv_cursor', 'done')").run();
  return env;
};
let seq = 0;
const nm = (env, { source_key = "fpds_pl", title, published = null, first_seen }) => env.NEWS.db
  .prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)")
  .run(source_key, `https://www.fpds.gov/ezsearch/search.do?q=SYNTH${++seq}#9700-SYNTH${seq}-0`, title, published, first_seen);
const claim = async (env) => (await request(worker, env, "POST", "/v1/queue/claim", { role: "grader", body: { limit: 20 } })).body.items;

test("an FPDS source's undated row after its first poll is stored pending record_fresh, is not claimable until releaseHeld runs, and is claimable after", async () => {
  const env = newEnv();
  // The first poll: dated seed rows (signed a few days before).
  nm(env, { title: "[PL] FPDS: SYNTHETIC AGENCY purchase order SYNTH-1 to TESTCO — $250K obligated", published: "2026-11-20T00:00:00Z", first_seen: A });
  nm(env, { title: "[PL] FPDS: SYNTHETIC AGENCY delivery order SYNTH-2 to TESTCO — $400K obligated", published: "2026-11-19T00:00:00Z", first_seen: A });
  // A later poll: undated.
  nm(env, { title: "[PL] FPDS: SYNTHETIC AGENCY modification SYNTH-3 to TESTCO — $180K obligated", first_seen: B });
  const r = await ingest(env);
  assert.equal(r.held, 3);
  const later = env.DB.rows("SELECT id, state, skip_reason, admit, released_at FROM items WHERE nm_first_seen = ?", B).map((x) => ({ ...x }));
  assert.equal(later.length, 1);
  assert.deepEqual({ ...later[0], id: undefined }, { id: undefined, state: "pending", skip_reason: null, admit: "record_fresh", released_at: null });
  assert.deepEqual(env.DB.rows("SELECT admit FROM items WHERE nm_first_seen = ?", A).map((x) => x.admit), ["seed_fresh", "seed_fresh"]);
  assert.equal((await claim(env)).length, 0, "held: nothing is claimable");
  await releaseHeld(env);
  const got = await claim(env);
  const it = got.find((i) => i.item_id === later[0].id);
  assert.ok(it, "claimable once released");
  assert.equal(it.admit, "record_fresh");
});

test("an FPDS source whose first ever row is undated: that row is its seed, held seed_fresh", async () => {
  // A zero-item first poll in news-monitor stores nothing, so the first row Zenith sees is its MIN(first_seen).
  const env = newEnv();
  nm(env, { title: "[PL] FPDS: SYNTHETIC AGENCY purchase order SYNTH-9 to TESTCO — $120K obligated", first_seen: B });
  await ingest(env);
  assert.deepEqual(env.DB.rows("SELECT state, admit FROM items").map((x) => ({ ...x })), [{ state: "pending", admit: "seed_fresh" }]);
});

test("REGRESSION a non-FPDS record source's undated row after its first poll keeps the fast path", async () => {
  const env = newEnv();
  nm(env, { source_key: "fedreg_av_trucking", title: "Earlier Federal Register notice on automated trucks", published: "2026-11-20T00:00:00Z", first_seen: A });
  nm(env, { source_key: "fedreg_av_trucking", title: "Later Federal Register notice on automated trucks", first_seen: B });
  await ingest(env);
  const rows = env.DB.rows("SELECT nm_first_seen, admit FROM items WHERE source_key = 'fedreg_av_trucking' ORDER BY nm_rowid").map((x) => ({ ...x }));
  assert.deepEqual(rows.map((x) => x.admit), ["seed_fresh", null]);
});
