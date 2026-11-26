// Phase 3 Part E: the brief's two auxiliary sections, built for buildBrief's
// sections: "full" (the stored weekday brief and /v1/brief?sections=full).
//   * Competitors and peers: graded aux rows that relations.js places with a
//     covered ticker's competitors, plus the Coverage rows graded as role
//     'rival', grouped by ticker, with the relations direction sign.
//   * Industry: graded aux rows relations.js places in Industry (program
//     sources, registers, trade media), with their tickers, plus the register
//     readings from news-monitor-db's series_points.
// One placement rule: relations.js placeAux (the Competitors and Industry views
// and the Company page read the same rule), so the brief cannot disagree with
// them on a row. A row placed in neither is counted in `unassigned`.
//
// Reads stored grades only: no claim, no grade, no budget. news-monitor-db is
// read with one SELECT. Imports lib.js only (relations.js and aux-sources.json
// are loaded on first use, so the default brief never loads them): never tuning.js, which reaches delivery.js and from there
// brief.js (a cycle). The mute and rival-twin SQL below are the literal text of
// tuning.js MUTED_SQL and lib.js rivalOnCoverageSql('i'); a test holds them equal.
// Each part runs on its own: a failing part becomes { error } and is logged
// with console.warn, so the brief is still built and stored.
import { isHttpUrl } from "./lib.js";

// The floor of both sections (E-O5): rows at 70+ fill a section. When a
// section has none, `below` holds its top BELOW_N rows at 40-69 ("below the
// Digest line"); BELOW_N = 0 turns that fallback off.
export const FLOOR = 70;
export const BELOW_N = 3;
export const CAPS = { competitors: 25, industry: 25, registers: 12 };
// Above this many series_points rows read, move Q11 to PK-prefix reads (revisit).
export const REGISTER_ROWS_LIMIT = 2000;

// tuning.js MUTED_SQL and lib.js rivalOnCoverageSql("i"), inlined (see above).
export const AUX_MUTED_SQL = "(SELECT source_key FROM source_prefs WHERE action = 'mute')";
export const AUX_RIVAL_TWIN_SQL = "EXISTS (SELECT 1 FROM items c WHERE c.nm_rowid = i.nm_rowid AND c.state != 'skipped' AND c.role = 'rival')";

// Q5: the window's current aux grades at 40+ (the fallback costs no extra read).
// No index on graded_at: a scan of aux_grades, bounded by the aux grade count.
export const Q5_SQL = `SELECT i.id AS item_id, i.entity_key, i.entity_name, i.status, i.coverage_subject, i.affects, i.title, i.url, i.headline,
       i.source_key, g.id AS grade_id, g.score, g.band, g.why, g.reads_through, g.event_type, g.graded_at
  FROM aux_grades g JOIN aux_items i ON i.id = g.item_id
 WHERE g.graded_at >= ?1 AND g.graded_at < ?2 AND g.id = i.grade_id AND g.score >= 40 AND g.band IN ('lead','digest','borderline')
   AND i.source_key NOT IN ${AUX_MUTED_SQL}
   AND NOT ${AUX_RIVAL_TWIN_SQL}
 ORDER BY g.score DESC, g.id DESC LIMIT 120`;

// Q6: aux rows waiting for a grade, by entity (held = kept back by the daily budget).
export const Q6_SQL = `SELECT entity_key, COUNT(*) AS n, SUM(CASE WHEN admit IS NOT NULL AND released_at IS NULL THEN 1 ELSE 0 END) AS held
  FROM aux_items WHERE state IN ('pending','claimed') GROUP BY entity_key LIMIT 400`;

// Q11 (news-monitor-db, SELECT only): register readings for covered tickers and
// totals. series_points has no observed_at index, so this reads the table once
// a weekday; the window is applied here (observed_at is set once per period).
export const Q11_SQL = `SELECT series, subject, period, value, ticker, label, observed_at FROM series_points
 WHERE ticker IS NOT NULL OR subject = '_total' LIMIT ${REGISTER_ROWS_LIMIT}`;

const clipMsg = (e) => String(e?.message || e).replace(/\s+/g, " ").trim().slice(0, 160);

async function part(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn("brief section failed", name);
    return { error: clipMsg(e) };
  }
}

const SIGNS = new Set(["-", "+", "±"]);
// The grade's reads_through -> Map(ticker -> sign or null). Malformed -> empty.
function readsOf(raw) {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  const out = new Map();
  if (!Array.isArray(v)) return out;
  for (const r of v) {
    const t = typeof r === "string" ? r : r?.ticker;
    if (typeof t !== "string" || out.has(t)) continue;
    const d = typeof r === "string" ? null : String(r?.direction ?? "").trim().replace(/−/g, "-");
    out.set(t, SIGNS.has(d) ? d : null);
  }
  return out;
}

const splitTickers = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function auxEntry(r) {
  return {
    pipeline: "aux", item_id: r.item_id, grade_id: r.grade_id, entity_key: r.entity_key, entity_name: r.entity_name,
    status: r.status, source_key: r.source_key, title: r.title, headline: r.headline ?? null,
    url: isHttpUrl(r.url) ? r.url : null, score: r.score, band: r.band, event_type: r.event_type ?? null,
    why: r.why ?? null, graded_at: r.graded_at,
  };
}

function coverageEntry(r, direction) {
  return {
    pipeline: "coverage", item_id: r.item_id, grade_id: r.grade_id, ticker: r.ticker, role: r.role, source_key: r.source_key,
    title: r.title, headline: r.headline ?? null, url: isHttpUrl(r.url) ? r.url : null, score: r.score, band: r.band,
    event_type: r.event_type ?? null, why: r.why ?? null, graded_at: r.graded_at, direction,
  };
}

// Waiting totals split into competitor entities (a covered ticker's
// competitor in relations.js) and the rest.
function waitingSplit(rows, rel, inUniverse) {
  const w = { competitors: { n: 0, held: 0 }, industry: { n: 0, held: 0 } };
  for (const r of rows) {
    const side = rel.tickersOfEntity(r.entity_key).some((x) => inUniverse(x.ticker)) ? "competitors" : "industry";
    w[side].n += Number(r.n) || 0;
    w[side].held += Number(r.held) || 0;
  }
  return w;
}

const numberOr = (v) => (typeof v === "number" ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const fmtNum = (n) => String(Number(n.toFixed(6)));

// The (series, subject) pairs whose newest period was first observed in
// [from, to), with the change from that pair's previous period.
export function registerReadings(rows, { from, to, inUniverse, cap = CAPS.registers }) {
  const pairs = new Map();
  for (const r of rows) {
    if (r.subject !== "_total" && !(r.ticker && inUniverse(r.ticker))) continue;
    const k = `${r.series}\u0000${r.subject}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(r);
  }
  const out = [];
  for (const list of pairs.values()) {
    list.sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const last = list.at(-1);
    const seen = String(last.observed_at ?? "");
    if (!(seen >= from && seen < to)) continue;
    const prev = list.length > 1 ? list.at(-2) : null;
    const v = numberOr(last.value), p = prev ? numberOr(prev.value) : null;
    const delta = v != null && p != null ? Number((v - p).toFixed(6)) : null;
    const name = last.label || last.subject;
    const text = `${name} (${last.period}): ${v != null ? fmtNum(v) : String(last.value ?? "")}`
      + (delta != null ? ` (${delta >= 0 ? "+" : ""}${fmtNum(delta)} since ${prev.period})` : "");
    out.push({ series: last.series, subject: last.subject, ticker: last.ticker ?? null, label: last.label ?? null, period: last.period,
      value: last.value, prev_period: prev?.period ?? null, delta, observed_at: last.observed_at, text });
  }
  out.sort((a, b) => String(a.series).localeCompare(String(b.series)) || String(a.subject).localeCompare(String(b.subject)));
  return out.slice(0, cap);
}

// A source key's entity (aux-sources.json), else the key itself: relations.js's
// rule, so a Coverage rival row takes the sign relations.js keeps for its entity.
const entityOfKey = (aux) => (key) => (Object.hasOwn(aux?.sources || {}, key) && aux.sources[key]?.entity) || key;

// briefSections(env, covered, { from, to, graded, rel, aux }) -> { competitors, industry }
//   graded: buildBrief's own graded list (its role = 'rival' rows join Competitors).
//   rel: a relations.js object (tests inject one); else loadRelations().
//   aux: the aux-sources map `rel` was built from (default: the bundle).
export async function briefSections(env, covered, { from, to, graded = [], rel = null, aux = null } = {}) {
  if (!rel) {
    const { loadRelations } = await import("./relations.js");
    rel = await loadRelations();
  }
  if (!aux) aux = (await import("./aux-sources.json")).default;
  const tickers = covered?.tickers || rel.tickers || [];
  const universe = new Set(tickers);
  const inUniverse = (t) => universe.has(t);
  const order = (list) => tickers.filter((t) => list.includes(t));
  const peerMap = rel.peerMap();
  const entityOf = entityOfKey(aux);

  const q5 = await part("aux grades", async () => (await env.DB.prepare(Q5_SQL).bind(from, to).all()).results || []);
  const q6 = await part("aux waiting", async () => (await env.DB.prepare(Q6_SQL).all()).results || []);
  const regs = await part("registers", async () => {
    if (!env.NEWS) throw new Error("NEWS binding missing");
    const rows = (await env.NEWS.prepare(Q11_SQL).all()).results || [];
    return registerReadings(rows, { from, to, inUniverse });
  });
  const waiting = Array.isArray(q6) ? waitingSplit(q6, rel, inUniverse) : { competitors: q6, industry: q6 };
  const rivalSources = tickers.reduce((n, t) => n + (rel.rivalSourceCount(t) || 0), 0);

  // Placement of every Q5 row.
  const comp = [];   // { entry, tickers: [{ticker, direction}] }
  const ind = [];    // { entry, tickers: [T] }
  let unassigned = 0; // rows at 70+ placed in neither section (customer twins, coverage-subject filters, ...)
  if (Array.isArray(q5)) {
    for (const r of q5) {
      const p = rel.placeAux(r);
      const reads = readsOf(r.reads_through);
      const cTickers = order((p.competitors || []).filter(inUniverse));
      if (cTickers.length) {
        const tk = cTickers.map((t) => ({ ticker: t, direction: peerMap[r.entity_key]?.[t] || reads.get(t) || "±" }));
        comp.push({ entry: { ...auxEntry(r), tickers: tk }, tickers: tk });
      } else if (p.industry) {
        const set = [...(r.coverage_subject ? splitTickers(r.affects) : []), ...reads.keys()].filter(inUniverse);
        const it = order([...new Set(set)]);
        ind.push({ entry: { ...auxEntry(r), tag: r.status ?? null, tickers: it }, tickers: it });
      } else if (r.score >= FLOOR) {
        unassigned++;
      }
    }
  }
  // Coverage rows graded as rivals (buildBrief's graded list, all at 70+).
  for (const r of graded) {
    const ts = rel.rivalTickers(r, "coverage").filter(inUniverse);
    if (!ts.length) continue;
    const entity = entityOf(r.source_key);
    const tk = ts.map((t) => ({ ticker: t, direction: peerMap[entity]?.[t] || "-" }));
    comp.push({ entry: { ...coverageEntry(r, tk[0].direction), tickers: tk }, tickers: tk });
  }
  const byScore = (a, b) => (b.entry.score - a.entry.score) || ((b.entry.grade_id ?? 0) - (a.entry.grade_id ?? 0));
  comp.sort(byScore);
  ind.sort(byScore);

  let competitors;
  if (!Array.isArray(q5)) competitors = { error: q5.error };
  else {
    const above = comp.filter((x) => x.entry.score >= FLOOR);
    const groups = new Map();
    let listed = 0, entries = 0;
    for (const x of above) {
      entries += x.tickers.length;
      for (const { ticker, direction } of x.tickers) {
        if (listed >= CAPS.competitors) break;
        if (!groups.has(ticker)) groups.set(ticker, []);
        const { tickers: _t, ...entry } = x.entry;
        groups.get(ticker).push({ ...entry, ticker, direction });
        listed++;
      }
    }
    const byTicker = [...groups.entries()].map(([ticker, items]) => ({ ticker, items }))
      .sort((a, b) => b.items[0].score - a.items[0].score || a.ticker.localeCompare(b.ticker));
    competitors = {
      // count: rows at 70+; listed: entries shown (a row can list under two tickers); more: entries cut by the cap.
      by_ticker: byTicker, count: above.length, listed, more: entries - listed,
      below: above.length ? [] : comp.filter((x) => x.entry.score < FLOOR).slice(0, BELOW_N).map((x) => x.entry),
      unassigned, waiting: waiting.competitors, rival_sources: rivalSources,
    };
  }

  let industry;
  if (!Array.isArray(q5)) industry = { error: q5.error };
  else {
    const above = ind.filter((x) => x.entry.score >= FLOOR);
    industry = {
      items: above.slice(0, CAPS.industry).map((x) => x.entry), count: above.length,
      below: above.length ? [] : ind.filter((x) => x.entry.score < FLOOR).slice(0, BELOW_N).map((x) => x.entry),
      unassigned, waiting: waiting.industry, registers: regs,
    };
  }
  return { competitors, industry };
}
