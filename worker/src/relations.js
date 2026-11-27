// Phase 3: the one relationship module. Who is whose competitor, the peer sign
// map, the key-account lists, the industry links, and the one placement rule
// that says whether a graded row is a competitor row for a ticker, an industry
// row, or neither. The Competitors and Industry views, the Company page's rivals
// section and the brief's competitor and industry sections all read it, so they
// cannot disagree on a row.
//
// The only reader of relations.generated.js (written by
// scripts/build-relations.mjs from rubric/peers.json, rubric/key-accounts.json
// and registry/rivals.json). Phase 4 swaps loadRelations' body for the registry
// (one indexed read, then async); callers already `await` it, so none changes.
// Read-time only: nothing here changes a score, a band or what the grader sees.
import { RELATIONS_VERSION, RELATIONS } from "./relations.generated.js";
import COVERED from "./covered.json";
import AUX from "./aux-sources.json";
import { MATCH, INDUSTRY } from "./rubric.generated.js";
import { phraseRegex } from "./lib.js";
import { isRecordSource } from "./records.js";

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const DIRECTIONS = new Set(["-", "+", "±"]);
const normDirection = (d) => (typeof d === "string" ? d.trim().replace(/−/g, "-") : null);

// "A,B" or ["A","B"] -> the covered tickers, in that order, without repeats.
function tickerList(v, covered) {
  const list = Array.isArray(v) ? v : String(v ?? "").split(",");
  const out = [];
  for (const x of list) {
    const t = String(x ?? "").trim();
    if (covered.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

// The grade's reads_through (a JSON string, a parsed list, or the row's own
// `reads` list) -> [{ticker, direction}] for covered tickers. A malformed
// value gives [] and never throws.
function readsOf(row, covered) {
  let raw = row?.reads ?? row?.reads_through ?? null;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const ticker = typeof r === "string" ? r : r?.ticker;
    if (!covered.has(ticker) || out.some((x) => x.ticker === ticker)) continue;
    const direction = normDirection(typeof r === "string" ? null : r?.direction);
    out.push({ ticker, direction: DIRECTIONS.has(direction) ? direction : null });
  }
  return out;
}

function build(deps) {
  const rel = deps.relations ?? RELATIONS;
  const covered = deps.covered ?? COVERED;
  const aux = deps.aux ?? AUX;
  const match = deps.match ?? MATCH;
  const industry = deps.industry ?? INDUSTRY;
  const isRecord = deps.isRecordSource ?? isRecordSource;
  const tickers = [...(covered.tickers || [])];
  const universe = new Set(tickers);
  const sources = aux.sources || {};
  const counterparty = covered.counterparty || {};
  const peers = rel.peers || {};
  const auxEntities = new Set(Object.values(sources).map((s) => s?.entity).filter(Boolean));

  // A source key -> its entity (aux-sources.json), else the key itself.
  const entityOf = (key) => (own(sources, key) && sources[key]?.entity) || key;
  // Name and status of an entity: the peer note, else its aux entry.
  const describe = (entity, key) => {
    if (own(peers, entity)) return { name: peers[entity].name, status: peers[entity].status ?? null };
    const a = own(sources, entity) ? sources[entity] : own(sources, key) ? sources[key] : null;
    return { name: a?.name ?? entity, status: a?.status ?? null };
  };
  const peerSign = (entity, t) => (own(peers, entity) ? (peers[entity].reads || []).find((r) => r.ticker === t)?.direction : null) || null;

  const comp = new Map();
  for (const t of tickers) {
    const m = new Map();
    const add = (entity, key, via) => {
      if (!entity) return;
      let e = m.get(entity);
      if (!e) {
        e = { ...describe(entity, key), direction: peerSign(entity, t) || "-", via: [], watched: auxEntities.has(entity) };
        m.set(entity, e);
      }
      if (!e.via.includes(via)) e.via.push(via);
    };
    for (const [key, p] of Object.entries(peers)) if ((p.reads || []).some((r) => r.ticker === t)) add(key, key, "peers");
    for (const key of rel.rivals?.[t] || []) add(entityOf(key), key, "rivals");
    for (const [key, cp] of Object.entries(counterparty)) {
      if (cp?.role === "rival" && (cp.affects || []).includes(t)) add(entityOf(key), key, "counterparty");
    }
    comp.set(t, m);
  }

  const peerMapObj = {};
  for (const [t, m] of comp) for (const [entity, e] of m) (peerMapObj[entity] ??= {})[t] = e.direction;

  const rivalKeys = new Map(tickers.map((t) => [t, new Set([
    ...(rel.rivals?.[t] || []),
    ...Object.entries(counterparty).filter(([, cp]) => cp?.role === "rival" && (cp.affects || []).includes(t)).map(([k]) => k),
  ])]));

  const regexCache = new Map();
  const regexes = (t) => {
    if (!regexCache.has(t)) regexCache.set(t, { company: phraseRegex(match?.[t]?.terms), account: phraseRegex(match?.[t]?.accounts) });
    return regexCache.get(t);
  };
  const found = (re, text) => (re ? (re.exec(String(text ?? ""))?.[0] ?? null) : null);

  // "twin:<role>" (a covered.json counterparty key), "sec_feed" (edgar_* or an
  // aux sec entry: a company's own SEC feed), "register" (records.js
  // isRecordSource), or null.
  function sourceClass(key) {
    const k = String(key ?? "");
    if (!k) return null;
    if (own(counterparty, k)) return `twin:${counterparty[k]?.role || "counterparty"}`;
    if (k.startsWith("edgar_") || (own(sources, k) && sources[k]?.sec === true)) return "sec_feed";
    if (isRecord(k)) return "register";
    return null;
  }

  const tickersOfEntity = (entity) => Object.entries(peerMapObj[entity] || {}).map(([ticker, direction]) => ({ ticker, direction }));
  const inOrder = (set) => tickers.filter((t) => set.has(t));

  // The placement rule for an aux row; first match wins. `reads` = the grade's
  // reads_through tickers that are covered.
  function placeAux(row) {
    const key = row?.source_key;
    const cls = sourceClass(key);
    const entity = row?.entity_key || (key ? entityOf(key) : null);
    const reads = readsOf(row, universe).map((r) => r.ticker);
    const status = row?.status ?? (own(sources, key) ? sources[key]?.status : null);
    const competitorsBy = () => inOrder(new Set([...tickersOfEntity(entity).map((x) => x.ticker), ...reads]));
    // 1. A counterparty twin follows its role: rival -> its affects tickers;
    //    program -> Industry; customer, relationship, index_event -> neither
    //    (the Company page's key accounts own them).
    //    Phase 5: a tag_affects rival twin lists under the row's own stored
    //    affects (already narrowed to its tag at ingest), never the source's
    //    affects; a media twin (an outlet) skips this rule and goes on at 2.
    const role = cls?.startsWith("twin:") ? cls.slice(5) : null;
    if (role && role !== "media") {
      if (role === "rival") {
        const tagged = counterparty[key]?.tag_affects === true || (own(sources, key) && sources[key]?.tag_affects === true);
        return { competitors: inOrder(new Set(tickerList(tagged ? row?.affects : counterparty[key]?.affects, universe))), industry: false };
      }
      return { competitors: [], industry: role === "program" };
    }
    // 2. A program source or a register -> Industry.
    if (status === "program" || cls === "register") return { competitors: [], industry: true };
    // 3. A company's own SEC feed -> Competitors where the entity is a
    //    competitor or the grade reads through; else neither.
    if (cls === "sec_feed") return { competitors: competitorsBy(), industry: false };
    // 4. An entity that is a competitor of T, or a grade that reads through T.
    const c = competitorsBy();
    if (c.length) return { competitors: c, industry: false };
    // 5. Industry media -> Industry. A coverage-subject filter (a search about
    //    a covered company) is never industry news (6), except an outlet's own
    //    twin (source role media), which is industry news unless 3-4 made it a
    //    competitor row.
    if (status === "media" && (!row?.coverage_subject || role === "media")) return { competitors: [], industry: true };
    // 6. Everything else: neither.
    return { competitors: [], industry: false };
  }

  return {
    basis: rel.basis ?? "files",
    version: deps.version ?? RELATIONS_VERSION,
    tickers,
    // Map(entity_key -> {name, status, direction, via, watched}); a fresh copy.
    competitorsOf(t) {
      const m = comp.get(t);
      return new Map([...(m || [])].map(([k, e]) => [k, { ...e, via: [...e.via] }]));
    },
    // { entity_key: { T: "-" | "+" | "±" } }; a fresh copy.
    peerMap() {
      return Object.fromEntries(Object.entries(peerMapObj).map(([k, v]) => [k, { ...v }]));
    },
    tickersOfEntity,
    rivalSourceCount: (t) => rivalKeys.get(t)?.size ?? 0,
    keyAccountsOf: (t) => (rel.key_accounts?.[t] || []).map((e) => ({ name: e.name, kind: e.kind ?? null })),
    keyAccountIn: (t, text) => found(regexes(t).account, text),
    companyIn: (t, text) => found(regexes(t).company, text),
    industryLinksOf: (t) => Object.entries(industry?.[t] || {}).map(([id, v]) => ({ id, core: v?.core === true })),
    sourceClass,
    placeAux,
    // The one rivals rule. coverage: the grade ticker when role = 'rival';
    // aux: placeAux(row).competitors.
    rivalTickers(row, pipeline) {
      if (pipeline === "coverage") {
        const t = row?.grade_ticker ?? row?.ticker;
        return row?.role === "rival" && universe.has(t) ? [t] : [];
      }
      if (pipeline === "aux") return placeAux(row).competitors;
      throw new TypeError(`rivalTickers: pipeline must be "coverage" or "aux", not ${JSON.stringify(pipeline)}`);
    },
  };
}

let cached = null;
// Built once per isolate from the bundles; `deps` injects synthetic maps in
// tests ({ relations, version, covered, aux, match, industry, isRecordSource })
// and is never cached. Callers `await` it (phase 4 makes it async).
export function loadRelations(deps = {}) {
  if (deps && Object.keys(deps).length) return build(deps);
  return (cached ??= build({}));
}
