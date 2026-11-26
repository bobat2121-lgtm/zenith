// Phase 3 Part E (PR-E2): the brief's three calendar queries use an index
// instead of scanning items, and return the same rows as before. The old SQL is
// copied here as it was, run against the same synthetic seed with the same
// binds as the shipped text the functions actually prepare.
import test from "node:test";
import assert from "node:assert/strict";
import { gradedNotices, councilAgendas, runtimeEntries, LEGISTAR_RANGE } from "../worker/src/calendar.js";
import { MATCH } from "../worker/src/rubric.generated.js";
import { D1, addItem, addGrade } from "./helpers/d1.js";

const OLD_AGENDAS = "SELECT i.id AS item_id, i.ticker, i.title, i.url, i.source_key, i.nm_first_seen FROM items i WHERE substr(i.source_key, 1, 9) = 'legistar_' AND i.title LIKE '%, agenda 20%' AND i.nm_first_seen >= ? AND COALESCE(i.skip_reason,'') != 'muted_source' ORDER BY i.id DESC LIMIT 200";
const OLD_DECISIONS = `SELECT id, url, title, published, nm_first_seen FROM items
      WHERE substr(source_key, 1, 9) = 'legistar_' AND instr(url, '#') > 0 AND nm_first_seen >= ?
        AND COALESCE(skip_reason,'') != 'muted_source'
      ORDER BY id DESC LIMIT 400`;
const NOTICE_FLAGS = ["reason:calendar_card", "group:earnings_calendar", "floor:calendar", "floor:investor_day"];
const OLD_NOTICES = `SELECT i.id AS item_id, i.ticker, i.title, i.url, i.published, i.nm_first_seen, g.why, g.score, g.band, g.graded_at
       FROM items i JOIN grades g ON g.id = i.grade_id
      WHERE i.nm_first_seen >= ? AND g.score IS NOT NULL AND (${NOTICE_FLAGS.map(() => "g.flags LIKE ?").join(" OR ")})
      ORDER BY i.id DESC LIMIT 300`;

// A covered ticker and one of its own terms, picked from the bundled rubric at run time.
function tickerWithTerm() {
  for (const [t, m] of Object.entries(MATCH)) {
    const term = (m?.terms || []).find((x) => typeof x === "string" && /^[A-Z][A-Za-z]+( [A-Z][A-Za-z]+)?$/.test(x));
    if (term) return { ticker: t, term };
  }
  throw new Error("no ticker with a plain term in MATCH");
}

const SINCE = "2026-01-01T00:00:00.000Z";

async function seed() {
  const db = new D1();
  const { ticker, term } = tickerWithTerm();
  const at = (d) => `2026-02-${String(d).padStart(2, "0")}T12:00:00.000Z`;
  let d = 1;
  const add = (over) => addItem(db, { ticker, nm_first_seen: at(d), ingested_at: at(d++), ...over });
  const agenda = (key, n) => add({ source_key: key, url: `https://example.com/m/${key}/${n}`, title: `[${ticker}] ${term} contract — Approved, agenda 2026-03-0${n}` });
  // Keys that start with legistar_ (kept) and keys that only look like it (left out).
  for (const key of ["legistar_x", "legistar_", "legistar_zz", "legistarx", "legistar", "legistar^a", "legistar`a", "Legistar_x", "legistaz_x"]) {
    await agenda(key, 1);
    await agenda(key, 2);
    // A decision row of the same matter: the matter url plus a fragment.
    await add({ source_key: key, url: `https://example.com/m/${key}/1#vote-9`, title: `${term} contract — vote 2026-03-05 Council: approved`, published: "2026-03-05T15:00:00.000Z" });
  }
  await add({ source_key: "legistar_x", url: "https://example.com/m/old/1#closed", title: "old — Closed 2025-12-01", nm_first_seen: "2025-12-01T00:00:00.000Z" });
  await add({ source_key: "legistar_x", url: "https://example.com/m/muted/1", title: `[${ticker}] ${term} — x, agenda 2026-03-05`, skip_reason: "muted_source" });
  // Five ordinary keys, some sorting before and some after legistar.
  for (const key of ["edgar_x", "kappa", "legion", "lemma", "zulu"]) {
    const id = await add({ source_key: key, title: `${term} investor day, agenda 2026-03-09 on March 9, 2026` });
    await addGrade(db, id, { score: 72, flags: JSON.stringify(["reason:calendar_card"]) });
  }
  // Graded notices: some flagged, one unflagged, one before the window.
  for (const [i, flag] of ["floor:calendar", "group:earnings_calendar", "floor:investor_day", "reason:other"].entries()) {
    const id = await add({ source_key: "pr_wire", title: `${term} to report results on March ${10 + i}, 2026` });
    await addGrade(db, id, { score: 60 + i, flags: JSON.stringify([flag]) });
  }
  const early = await addItem(db, { ticker, source_key: "pr_wire", title: "Results on January 9, 2026", nm_first_seen: "2025-12-20T00:00:00.000Z" });
  await addGrade(db, early, { score: 80, flags: JSON.stringify(["floor:calendar"]) });
  return db;
}

// Records every statement a function prepares, with its binds.
function spy(db) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      const st = db.prepare(sql);
      return { bind: (...args) => { seen.push({ sql, args }); return st.bind(...args); } };
    },
  };
}

const ids = (rows) => rows.map((r) => r.item_id ?? r.id);

test("calendar plan: councilAgendas, councilDecisions and gradedNotices return the same rows as the old SQL", async () => {
  const db = await seed();
  const s = spy(db);
  const entries = await runtimeEntries(s, { sinceIso: SINCE });
  assert.ok(entries.some((e) => e.kind === "council_agenda"), "the seed has a council agenda");
  assert.ok(entries.some((e) => e.kind === "graded_notice"), "the seed has a graded notice");
  const agendaSql = s.seen.find((x) => /title LIKE '%, agenda 20%'/.test(x.sql));
  const decisionSql = s.seen.find((x) => /instr\(url, '#'\)/.test(x.sql));
  const noticeSql = s.seen.find((x) => /g\.flags LIKE/.test(x.sql));
  assert.ok(agendaSql && decisionSql && noticeSql, "all three queries ran");
  for (const [shipped, old] of [[agendaSql, OLD_AGENDAS], [decisionSql, OLD_DECISIONS], [noticeSql, OLD_NOTICES]]) {
    const now = (await db.prepare(shipped.sql).bind(...shipped.args).all()).results;
    const before = (await db.prepare(old).bind(...shipped.args).all()).results;
    assert.ok(before.length > 0, "the old SQL finds rows on the seed");
    assert.deepEqual(ids(now).sort((a, b) => a - b), ids(before).sort((a, b) => a - b));
  }
  // The agenda rows are exactly the legistar_ keys (not legistarx, legistar, legistar^a, legistar`a, Legistar_x).
  const keys = new Set((await db.prepare(agendaSql.sql).bind(...agendaSql.args).all()).results.map((r) => r.source_key));
  assert.deepEqual([...keys].sort(), ["legistar_", "legistar_x", "legistar_zz"]);
  // Same entries out of the functions as rows in, ordered by id for agendas.
  const agendas = await councilAgendas(db, { sinceIso: SINCE });
  assert.ok(agendas.every((e) => e.url.includes("/legistar_")), JSON.stringify(agendas.map((e) => e.url)));
  assert.ok(agendas.some((e) => e.closed), "a decision row closed its agenda");
  const notices = await gradedNotices(db, { sinceIso: SINCE });
  assert.equal(notices.length, ids((await db.prepare(OLD_NOTICES).bind(...noticeSql.args).all()).results).length);
});

test("calendar plan: the range form matches substr(source_key, 1, 9) = 'legistar_' for every key", async () => {
  const db = new D1();
  const keys = ["legistar_", "legistar_a", "legistar_~", "legistar", "legistarx", "legistar^", "legistar`", "legistar`x", "legistara", "legistas", "legistaq_", "LEGISTAR_A", "legistar__", ""];
  for (const k of keys) {
    const old = db.db.prepare("SELECT substr(?, 1, 9) = 'legistar_' AS v").get(k).v;
    const now = db.db.prepare(`SELECT (${LEGISTAR_RANGE().replaceAll("source_key", "?1")}) AS v`).get(k).v;
    assert.equal(now, old, k);
  }
  assert.ok(LEGISTAR_RANGE().endsWith("source_key < 'legistar\x60'"), "the upper bound is the character after '_' (0x60)");
  assert.match(LEGISTAR_RANGE("i."), /^i\.source_key >= 'legistar_' AND i\.source_key < 'legistar.'$/);
});

test("calendar plan: EXPLAIN QUERY PLAN of the three queries has no scan of items; legistar ones use idx_items_source, notices idx_items_seen", async () => {
  const db = await seed();
  const s = spy(db);
  await runtimeEntries(s, { sinceIso: SINCE });
  const plan = (q) => db.db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.args).map((r) => r.detail);
  const want = [
    [/title LIKE '%, agenda 20%'/, /idx_items_source \(source_key>\? AND source_key<\?\)/],
    [/instr\(url, '#'\)/, /idx_items_source \(source_key>\? AND source_key<\?\)/],
    [/g\.flags LIKE/, /idx_items_seen \(nm_first_seen>\?\)/],
  ];
  for (const [which, index] of want) {
    const q = s.seen.find((x) => which.test(x.sql));
    const lines = plan(q);
    assert.ok(!lines.some((l) => /^SCAN (i|items)\b/.test(l)), lines.join(" | "));
    assert.ok(lines.some((l) => /^SEARCH (i|items) USING INDEX/.test(l) && index.test(l)), lines.join(" | "));
  }
  // The notices plan needs no temp B-tree for its ORDER BY.
  const notices = plan(s.seen.find((x) => /g\.flags LIKE/.test(x.sql)));
  assert.ok(!notices.some((l) => /TEMP B-TREE FOR ORDER BY/.test(l)), notices.join(" | "));
  // The old forms scanned.
  assert.ok(db.db.prepare(`EXPLAIN QUERY PLAN ${OLD_AGENDAS}`).all(SINCE).some((r) => /^SCAN i\b/.test(r.detail)));
});
