// Phase 0 gates (plans/phase0-build-spec.md, Appendix A section 8, change f):
// war.gov contract digests get their text from the Department's bulletin feed
// (worker/src/wargov.js), and the aux claim holds a digest without text for up
// to 180 minutes. Synthetic fixture: test/fixtures/wargov-bulletin.xml.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hookJsonImports, zenithDb, newsDb, TOKENS, request } from "./helpers/worker-env.js";

hookJsonImports();
const { default: worker } = await import("../worker/src/index.js");
const { wargovBulletins, wargovDigestExcerpt, wargovParagraphs, enrichAuxWargov, normalUrl, largestDollars, WARGOV_BULLETIN_URL,
  WARGOV_FEED_MINUTES, WARGOV_HOLD_MINUTES } = await import("../worker/src/wargov.js");

const XML = readFileSync(new URL("./fixtures/wargov-bulletin.xml", import.meta.url), "utf8");
const NAMES = { entities: ["Glimmer Aerospace"], covered: ["Testco Robotics"] };
const MIN = 60_000;
const iso = (msAgo = 0, base = Date.now()) => new Date(base - msAgo).toISOString();
const ARTICLE = "https://www.war.gov/News/Contracts/Contract/Article/4400001/";

test("wargovBulletins parses title, html and the View Online article URL", () => {
  const b = wargovBulletins(XML);
  assert.equal(b.length, 4);
  assert.equal(b[0].title, "Contracts for Nov. 20, 2026");
  assert.equal(b[0].articleUrl, "https://www.war.gov/News/Contracts/Contract/Article/4400001/?source=GovDelivery");
  assert.match(b[0].html, /<p><strong>ARMY<\/strong><\/p>/);
  assert.equal(b[1].title, "Contracts for Nov. 21, 2026");
  assert.equal(b[1].articleUrl, null, "a CDATA bulletin without the link");
  assert.match(b[1].html, /Quillon Systems/);
  assert.equal(normalUrl(b[0].articleUrl), normalUrl(ARTICLE));
  assert.equal(normalUrl("https://WWW.war.gov/News/Contracts/Contract/Article/4400001#x"), normalUrl(ARTICLE));
  assert.equal(largestDollars("a $9,500,000 award and $1.2 million option"), 9_500_000);
  assert.equal(largestDollars("a $1.2 billion ceiling"), 1.2e9);
});

test("wargovDigestExcerpt: agency headers kept; aux and peer entity paragraphs first, then by dollar value; covered-name paragraphs last or collapsed to one count line; within 2,500 chars, with the \"+N more\" tail", () => {
  const html = wargovBulletins(XML)[0].html;
  assert.equal(wargovParagraphs(html).length, 4, "the short line and the footnote are dropped");
  const lines = wargovDigestExcerpt(html, 2500, NAMES).split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^NAVY: Glimmer Aerospace/, "an outside company first");
  assert.match(lines[1], /^NAVY: Northfield Shipworks/, "then the largest award");
  assert.match(lines[2], /^ARMY: Brightwater Logistics/);
  assert.match(lines[3], /^ARMY: Testco Robotics/, "the covered company last");

  // A long announcement: within budget, covered names collapsed, and the tail.
  const para = (name, dollars) => `<p>${name} Holdings LLC, Testville, Ohio, was awarded a $${dollars.toLocaleString("en-US")} firm-fixed-price contract for spare parts and field services, with work expected to finish by 2028.</p>`;
  const big = ["<p><strong>DEFENSE LOGISTICS AGENCY</strong></p>", para("Testco Robotics", 7_000_000),
    ...Array.from({ length: 30 }, (_, k) => para(`Vendor${k}`, (k + 1) * 1_000_000))].join("\n");
  const ex = wargovDigestExcerpt(big, 2500, NAMES);
  assert.ok(ex.length <= 2500, `${ex.length} chars`);
  const out = ex.split("\n");
  assert.match(out[0], /^DEFENSE LOGISTICS AGENCY: Vendor29 /, "the largest award (30 million) first");
  assert.match(out.at(-2), /^\(1 award naming covered companies is graded on Coverage\)$/);
  assert.match(out.at(-1), /^\(\+\d+ more awards not shown\)$/);
  assert.ok(!ex.includes("Testco Robotics Holdings"));
  // Everything fits: no tail lines.
  assert.doesNotMatch(wargovDigestExcerpt(html, 2500, NAMES), /not shown|graded on Coverage/);
  assert.equal(wargovDigestExcerpt("<p>short</p>", 2500, NAMES), "");
});

function addWargov(env, over = {}) {
  const r = env.DB.db.prepare(`INSERT INTO aux_items (nm_rowid, source_key, entity_key, entity_name, status, url, title, published, nm_first_seen, ingested_at, state,
      excerpt_status, admit, released_at) VALUES (?, ?, ?, 'War.gov Contracts', 'program', ?, ?, NULL, ?, ?, 'pending', ?, ?, ?)`)
    .run(Math.floor(Math.random() * 1e9), over.source_key ?? "wargov_contracts", over.source_key ?? "wargov_contracts", over.url ?? ARTICLE,
      over.title ?? "Contracts for Nov. 20, 2026", over.first_seen ?? iso(10 * MIN), iso(), over.excerpt_status ?? null, over.admit ?? null, over.released_at ?? null);
  return Number(r.lastInsertRowid);
}
function stubFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init) => { calls.push(String(u)); return handler(String(u), init); };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const feedOk = () => new Response(XML, { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" } });
const row = (env, id) => ({ ...env.DB.rows("SELECT excerpt, excerpt_status FROM aux_items WHERE id = ?", id)[0] });

test("enrichAuxWargov: matches by article URL, else unique title; writes excerpt_status ok; fetches the feed at most once per 15 min; after 180 min unmatched writes not_in_feed; a 403 or 5xx leaves the row for the next try", async () => {
  const env = { DB: zenithDb(), NEWS: newsDb(), ...TOKENS };
  const now = Date.now();
  const byUrl = addWargov(env, { url: `${ARTICLE}?utm=x`, title: "Contracts for some other day" });
  const byTitle = addWargov(env, { url: "https://www.war.gov/News/Contracts/Contract/Article/4400002/", title: "Contracts for Nov. 21, 2026" });
  const dupTitle = addWargov(env, { url: "https://www.war.gov/News/Contracts/Contract/Article/4400003/", title: "Contracts for Nov. 19, 2026", first_seen: iso(30 * MIN, now) });
  const lateRow = addWargov(env, { url: "https://www.war.gov/News/Contracts/Contract/Article/4400004/", title: "Contracts for Nov. 18, 2026", first_seen: iso(200 * MIN, now) });

  // A refusal first: nothing changes, and the feed waits 15 minutes.
  let f = stubFetch(async () => new Response("denied", { status: 403 }));
  try {
    const r = await enrichAuxWargov(env, { now });
    assert.deepEqual([r.waiting, r.feed], [4, "http_403"]);
  } finally { f.restore(); }
  assert.deepEqual(row(env, lateRow), { excerpt: null, excerpt_status: null }, "a 403 never marks not_in_feed");
  f = stubFetch(feedOk);
  try {
    assert.ok((await enrichAuxWargov(env, { now: now + 5 * MIN })).next_at, "within 15 minutes: no fetch");
    assert.equal(f.calls.length, 0);
    const r = await enrichAuxWargov(env, { now: now + (WARGOV_FEED_MINUTES + 1) * MIN });
    assert.deepEqual([r.ok, r.not_in_feed], [2, 1]);
    assert.deepEqual(f.calls, [WARGOV_BULLETIN_URL], "only the bulletin feed is fetched (no Discord, no war.gov page)");
  } finally { f.restore(); }
  assert.equal(row(env, byUrl).excerpt_status, "ok");
  assert.match(row(env, byUrl).excerpt, /Northfield Shipworks/);
  assert.equal(row(env, byTitle).excerpt_status, "ok");
  assert.match(row(env, byTitle).excerpt, /^AIR FORCE: Quillon Systems/);
  assert.deepEqual(row(env, dupTitle), { excerpt: null, excerpt_status: null }, "a repeated title matches nothing; under 180 min it waits");
  assert.equal(row(env, lateRow).excerpt_status, "not_in_feed");
  // A 5xx later: the waiting row is left alone.
  f = stubFetch(async () => new Response("down", { status: 503 }));
  try { await enrichAuxWargov(env, { now: now + 40 * MIN }); } finally { f.restore(); }
  assert.deepEqual(row(env, dupTitle), { excerpt: null, excerpt_status: null });
  // Nothing waiting: no fetch at all.
  const empty = { DB: zenithDb(), ...TOKENS };
  f = stubFetch(feedOk);
  try { assert.deepEqual(await enrichAuxWargov(empty), { waiting: 0 }); assert.equal(f.calls.length, 0); } finally { f.restore(); }
});

test("aux claim: a wargov_contracts row without text is not claimed for 180 min, then is; other aux rows are not held; a held wargov row is not claimed either way", async () => {
  const env = { DB: zenithDb(), ...TOKENS };
  const fresh = addWargov(env, { first_seen: iso(30 * MIN) });
  const old = addWargov(env, { first_seen: iso((WARGOV_HOLD_MINUTES + 5) * MIN) });
  const withText = addWargov(env, { first_seen: iso(30 * MIN), excerpt_status: "ok" });
  const other = addWargov(env, { source_key: "nga", first_seen: iso(30 * MIN) });
  addWargov(env, { first_seen: iso((WARGOV_HOLD_MINUTES + 5) * MIN), admit: "record_late" });
  addWargov(env, { first_seen: iso((WARGOV_HOLD_MINUTES + 5) * MIN), admit: "record_late", excerpt_status: "ok" });
  const c = (await request(worker, env, "POST", "/v1/aux/claim", { role: "grader", body: { limit: 40 } })).body;
  assert.deepEqual(c.items.map((i) => i.item_id).sort((a, b) => a - b), [old, withText, other].sort((a, b) => a - b));
  assert.ok(!c.items.some((i) => i.item_id === fresh));
});

test("no NEWS write, no Discord fetch: the war.gov pass never touches news-monitor-db and fetches only the bulletin feed", async () => {
  const news = newsDb();
  const sql = [];
  const prepare = news.prepare.bind(news);
  news.prepare = (s) => { sql.push(s); return prepare(s); };
  const env = { DB: zenithDb(), NEWS: news, ...TOKENS, DISCORD_LEAD_WEBHOOK: "https://discord.example/webhook" };
  addWargov(env);
  const f = stubFetch(feedOk);
  try { await enrichAuxWargov(env); } finally { f.restore(); }
  assert.deepEqual(sql, []);
  assert.ok(f.calls.every((u) => u === WARGOV_BULLETIN_URL));
});
