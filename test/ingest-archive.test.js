// Ingest parks day-one archive rows (a seed or backfill of undated or old
// pages) as skipped 'archive_seed' instead of queueing them as fresh news.
import test from "node:test";
import assert from "node:assert/strict";
import { hookJsonImports, zenithDb, newsDb } from "./helpers/worker-env.js";

hookJsonImports();
const { ingest } = await import("../worker/src/ingest.js");

test("ingest parks day-one archive rows as archive_seed, across batch boundaries", async () => {
  const news = newsDb();
  const db = zenithDb();
  const seen = new Date().toISOString();
  const ins = news.db.prepare("INSERT INTO items (source_key, url, title, published, category, first_seen, notified) VALUES (?, ?, ?, ?, NULL, ?, 1)");
  // 398 rows from a source zenith does not follow, then a 7-row sitemap seed
  // (5 undated, 1 old, 1 dated today) straddling the 400-row batch edge.
  for (let i = 0; i < 398; i++) ins.run("not_followed", `https://x.example/${i}`, "x", seen, seen);
  const seed = [null, null, null, "2024-05-01T00:00:00Z", null, null, seen];
  seed.forEach((pub, i) => ins.run("planet", `https://www.planet.com/pulse/p${i}`, `Planet page ${i}`, pub, seen));
  // Two undated rows from another poll are not an archive.
  ins.run("planet", "https://www.planet.com/pulse/a", "Planet A", null, new Date(Date.now() + 1000).toISOString());
  ins.run("planet", "https://www.planet.com/pulse/b", "Planet B", null, new Date(Date.now() + 1000).toISOString());
  // Seed the cursor at the start (the backfill window would also start there).
  db.db.prepare("INSERT INTO meta (key, value) VALUES ('nm_cursor', '0')").run();
  const r = await ingest({ DB: db, NEWS: news });
  assert.equal(r.inserted, 9);
  const states = db.rows("SELECT url, state, skip_reason FROM items ORDER BY nm_rowid");
  const byUrl = Object.fromEntries(states.map((s) => [s.url.split("/").pop(), `${s.state}:${s.skip_reason}`]));
  for (const k of ["p0", "p1", "p2", "p3", "p4", "p5"]) assert.equal(byUrl[k], "skipped:archive_seed", k);
  assert.equal(byUrl.p6, "pending:null", "a dated row from today stays queued");
  assert.equal(byUrl.a, "pending:null");
  assert.equal(byUrl.b, "pending:null");
  assert.ok(r.archive_parked_after_insert >= 1, "rows queued in the first batch were parked once the group reached five");
});
