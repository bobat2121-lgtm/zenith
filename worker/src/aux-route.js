// Auxiliary names: routes a news-monitor source key to the outside company or
// program its items are about, for the auxiliary pipeline (aux_items). Covered
// sources and ops sources route to null and are never stored as auxiliary.
// Counterparty filters built to watch a covered company (co-mention searches,
// FPDS feeds, Drone Dominance) route with coverage_subject: true and the
// covered tickers they affect, so the grader can tell an item about an outside
// company from one about the covered company.
//
// The static registry is worker/src/aux-sources.json, generated with covered.json by
// scripts/sync-covered.mjs. Keys news-monitor creates at runtime (managed
// universe sources, ia_* collectors, sources dropped from the registry) are
// routed by name below.
import AUX from "./aux-sources.json";
import COVERED from "./covered.json";

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// "fort_robotics" -> "Fort Robotics".
export function humanize(key) {
  return String(key ?? "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// aux: aux-sources.json, covered: covered.json. Returns auxRoute(sourceKey) ->
// { entity_key, entity_name, status } (plus coverage_subject: true and affects:
// [covered tickers] for a coverage-subject source) or null.
export function makeAuxRoute(aux, covered) {
  const sources = aux?.sources || {};
  const exclude = aux?.exclude || {};
  const coveredSources = covered?.sources || {};
  // subject: whether the key is the source itself, so its coverage_subject
  // hint applies. A runtime key that only shares its name (managed_uber_news,
  // ia_uber) is that company's own channel, not a filter built for a covered one.
  const entry = (key, subject = false) => {
    const e = sources[key];
    const route = { entity_key: e.entity, entity_name: e.name, status: e.status };
    if (subject && e.coverage_subject) Object.assign(route, { coverage_subject: true, affects: [...(e.affects || [])] });
    return route;
  };
  // An entity's own source if it has one (verkada), else its first source
  // (maymobility -> maymobility_ir), so a runtime key named after a known
  // entity keeps that entity's name and status.
  const byEntity = new Map();
  for (const key of Object.keys(sources).sort()) {
    const entity = sources[key].entity;
    if (!byEntity.has(entity) || key === entity) byEntity.set(entity, key);
  }
  const named = (x, key) => {
    // A covered company's own channel under a runtime name (ia_<covered key>).
    if (has(coveredSources, x)) return null;
    // Nothing left after the prefix (edgar_, ia_): keep the whole key as the name.
    if (!x) x = key;
    if (has(sources, x)) return entry(x);
    if (byEntity.has(x)) return entry(byEntity.get(x));
    return { entity_key: x, entity_name: humanize(x), status: "unknown" };
  };

  return function auxRoute(sourceKey) {
    const key = String(sourceKey ?? "").trim();
    if (!key) return null;
    if (has(sources, key)) return entry(key, true);
    if (has(exclude, key) || has(coveredSources, key)) return null;
    // Runtime fallback for keys outside the static registry.
    if (/^(probe|site)_/.test(key) || key === "edgar_latest") return null;
    let m = /^managed_(.+)$/.exec(key);
    if (m) {
      const rest = m[1];
      const x = rest.length > 5 && rest.endsWith("_news") ? rest.slice(0, -5) : rest;
      const candidates = [...new Set([x, x.replace(/-/g, "_"), rest, rest.replace(/-/g, "_")])];
      // A managed copy of a covered company's channel (managed_draganfly_news).
      if (candidates.some((c) => has(coveredSources, c))) return null;
      const known = candidates.find((c) => has(sources, c));
      if (known) return entry(known);
      if (/^[0-9a-f]{32}$/.test(x)) return { entity_key: key, entity_name: "Other company", status: "unknown" };
      return named(x, key);
    }
    m = /^ia_media_(.+)$/.exec(key);
    if (m) return { entity_key: "media_" + m[1], entity_name: "Industry media", status: "media" };
    m = /^ia_(.+)$/.exec(key);
    if (m) return named(m[1], key);
    // Anything else: a source news-monitor no longer lists (edgar_ssti,
    // soundthinking: names dropped from coverage) or a new one not synced yet.
    return named(key.replace(/^edgar_/, ""), key);
  };
}

export const auxRoute = makeAuxRoute(AUX, COVERED);
