// Phase 0 gates (plans/phase0-build-spec.md, Appendix A section 7, change e):
// an undated item is never shown as a fresh Lead. A grade of 90+ on an undated
// item is stored 89 (Digest) with undated_capped_from_<score>, in both
// pipelines, over the floors; legacy undated Lead grades show as Digest and
// never pin, unless the owner marked the card High. Also the undated_burst
// label's place in Left out. Synthetic rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { normalizeGrade, parseFloors, capUndated, UNDATED_CAP } = await import("../worker/src/lib.js");
const { CORE } = await import("../worker/src/rubric.generated.js");

const FLOORS = parseFloors(CORE);
const HOUR = 3_600_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const grade = (over = {}) => ({ score: 92, band: "lead", why: "A large order.", read_source: true, confidence: 0.8, flags: ["reason:material"], ...over });
const flagsOf = (r) => JSON.parse(r.grade.flags);
const newEnv = () => ({ DB: zenithDb(), ...TOKENS });

test("capUndated: 90+ on an undated item is 89 with the flag; dated items and lower scores are unchanged", () => {
  const f = [];
  assert.equal(capUndated(95, null, f), UNDATED_CAP);
  assert.deepEqual(f, ["undated_capped_from_95"]);
  assert.equal(capUndated(95, "not a date", []), 89);
  assert.equal(capUndated(89, null, []), 89);
  assert.equal(capUndated(null, null, []), null);
  assert.equal(capUndated(95, "2026-11-20T00:00:00Z", []), 95);
});

test("undated item: 92 is stored 89 digest with undated_capped_from_92; floor:lead_order does not lift it; a dated item at 92 stays lead", () => {
  const undated = { id: 208, ticker: "AGLT", source_key: "testco_listing", title: "Testco product page", url: "https://testco.example.com/p", published: null, first_seen: iso(HOUR) };
  const r = normalizeGrade(grade(), undated, null, null, FLOORS);
  assert.equal(r.ok, true);
  assert.deepEqual([r.grade.score, r.grade.band], [89, "digest"]);
  assert.ok(flagsOf(r).includes("undated_capped_from_92"));
  const floor = normalizeGrade(grade({ score: 90, flags: ["reason:material", "floor:lead_order"], magnitude_usd: 5e7 }), undated, null, null, FLOORS);
  assert.equal(floor.ok, true);
  assert.deepEqual([floor.grade.score, floor.grade.band], [89, "digest"], "the cap overrides the floor");
  const dated = normalizeGrade(grade(), { ...undated, published: iso(2 * HOUR) }, null, null, FLOORS);
  assert.deepEqual([dated.grade.score, dated.grade.band], [92, "lead"]);
  assert.ok(!flagsOf(dated).some((x) => x.startsWith("undated_capped")));
});

function addAux(env, over = {}) {
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state,
      claim_id) VALUES (?, 'anduril', 'anduril', 'Anduril (private)', 'private', ?, ?, ?, ?, ?, ?, ?)`)
    .run(over.nm ?? Math.floor(Math.random() * 1e9), `https://news.example.com/u/${Math.random()}`, over.title ?? "Testco aux item", over.published ?? null,
      over.first_seen ?? iso(HOUR), iso(), over.state ?? "pending", over.claim_id ?? null);
  return Number(r.lastInsertRowid);
}

test("undated aux item graded 93 lead is accepted, stored 89 digest with the flag", async () => {
  const env = newEnv();
  const undated = addAux(env);
  const dated = addAux(env, { published: iso(2 * HOUR) });
  const c = (await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 10, run_id: "run-u" } })).body;
  assert.equal(c.items.length, 2);
  const g = (item_id) => ({ item_id, entity: "Anduril", score: 93, band: "lead", event_type: "financing", why: "A large raise.", reads_through: [],
    confidence: 0.8, read_source: true, dup_of: null, covered_ticker: null, flags: ["reason:material"] });
  const s = (await request(worker, env, "POST", "/v1/aux/grades", { role: "grader", body: { claim_id: c.claim_id, run_id: c.run_id, grades: [g(undated), g(dated)] } })).body;
  assert.equal(s.accepted, 2, JSON.stringify(s.rejected));
  const got = Object.fromEntries(env.DB.rows("SELECT item_id, score, band, flags FROM aux_grades").map((x) => [x.item_id, x]));
  assert.deepEqual([got[undated].score, got[undated].band], [89, "digest"]);
  assert.ok(JSON.parse(got[undated].flags).includes("undated_capped_from_93"));
  assert.deepEqual([got[dated].score, got[dated].band], [93, "lead"]);
});

test("feeds: an undated legacy lead grade is not pinned and shows band digest (stored_band lead); owner High still pins it", async () => {
  const env = newEnv();
  const add = (published) => {
    const r = env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, published, nm_first_seen, ingested_at, state)
      VALUES (?, 'aglt_press', 'AGLT', ?, 'Testco listing', ?, ?, ?, 'pending')`).run(Math.floor(Math.random() * 1e9), `https://x.example/${Math.random()}`, published, iso(HOUR), iso());
    const id = Number(r.lastInsertRowid);
    const g = env.DB.db.prepare(`INSERT INTO grades (item_id, ticker, run_id, rubric_version, model, score, band, why, flags, read_source, graded_at)
      VALUES (?, 'AGLT', 'r', 'v', 'm', 92, 'lead', 'w', '["reason:material"]', 1, ?)`).run(id, iso());
    env.DB.db.prepare("UPDATE items SET state='graded', grade_id=? WHERE id=?").run(Number(g.lastInsertRowid), id);
    return id;
  };
  const undated = add(null);
  const dated = add(iso(2 * HOUR));
  const feed = async (q = "") => (await request(worker, env, "GET", `/v1/feed${q}`, { role: "app" })).body.items;
  const by = Object.fromEntries((await feed()).map((i) => [i.item_id, i]));
  assert.deepEqual([by[undated].band, by[undated].stored_band, by[undated].pinned], ["digest", "lead", 0]);
  assert.deepEqual([by[dated].band, by[dated].stored_band, by[dated].pinned], ["lead", "lead", 1]);
  assert.ok((await feed("?min_score=70")).some((i) => i.item_id === undated), "a digest still shows at the Signal floor");
  env.DB.db.prepare("INSERT INTO feedback (item_id, label, ticker, created_at) VALUES (?, 'high', 'AGLT', ?)").run(undated, iso());
  assert.equal((await feed()).find((i) => i.item_id === undated).pinned, 1, "the owner's High pins it");

  // Auxiliary: the same rules.
  const aUndated = addAux(env, { state: "graded" });
  const aDated = addAux(env, { state: "graded", published: iso(2 * HOUR) });
  for (const id of [aUndated, aDated]) {
    const g = env.DB.db.prepare(`INSERT INTO aux_grades (item_id, run_id, entity, score, band, why, reads_through, flags, read_source, graded_at)
      VALUES (?, ?, 'Anduril', 93, 'lead', 'w', '[]', '["reason:material"]', 1, ?)`).run(id, `r${id}`, iso());
    env.DB.db.prepare("UPDATE aux_items SET grade_id = ? WHERE id = ?").run(Number(g.lastInsertRowid), id);
  }
  const aux = Object.fromEntries((await request(worker, env, "GET", "/v1/aux/feed", { role: "app" })).body.items.map((i) => [i.item_id, i]));
  assert.deepEqual([aux[aUndated].band, aux[aUndated].stored_band, aux[aUndated].pinned], ["digest", "lead", 0]);
  assert.deepEqual([aux[aDated].band, aux[aDated].pinned], ["lead", 1]);
  env.DB.db.prepare("INSERT INTO aux_feedback (item_id, label, created_at) VALUES (?, 'high', ?)").run(aUndated, iso());
  const aux2 = (await request(worker, env, "GET", "/v1/aux/feed", { role: "app" })).body.items.find((i) => i.item_id === aUndated);
  assert.equal(aux2.pinned, 1);
});

test("left out: undated_burst is hidden by default like archive_seed and listed with reason=undated_burst", async () => {
  const env = newEnv();
  const add = (reason) => env.DB.db.prepare(`INSERT INTO items (nm_rowid, source_key, ticker, url, title, nm_first_seen, ingested_at, state, skip_reason)
    VALUES (?, 'redcat', 'RCAT', ?, 'Testco page', ?, ?, 'skipped', ?)`).run(Math.floor(Math.random() * 1e9), `https://x.example/${Math.random()}`, iso(HOUR), iso(), reason);
  add("archive_seed");
  add("undated_burst");
  add("stale_on_arrival");
  const def = (await request(worker, env, "GET", "/v1/left-out?kind=coverage", { role: "app" })).body;
  assert.deepEqual(def.items.map((i) => i.skip_reason), ["stale_on_arrival"]);
  assert.deepEqual(def.counts, { archive_seed: 1, stale_on_arrival: 1, undated_burst: 1 });
  const ub = (await request(worker, env, "GET", "/v1/left-out?kind=coverage&reason=undated_burst", { role: "app" })).body;
  assert.deepEqual(ub.items.map((i) => i.skip_reason), ["undated_burst"]);
});
