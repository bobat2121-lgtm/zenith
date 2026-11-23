// Auxiliary names: routes a news-monitor source key to the outside company or
// program its items are about, for the auxiliary pipeline (aux_items). Covered
// sources, counterparty filters that only watch a covered company, and ops
// sources route to null and are never stored as auxiliary.
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
// { entity_key, entity_name, status } or null.
export function makeAuxRoute(aux, covered) {
  const sources = aux?.sources || {};
  const exclude = aux?.exclude || {};
  const coveredSources = covered?.sources || {};
  const entry = (key) => {
    const e = sources[key];
    return { entity_key: e.entity, entity_name: e.name, status: e.status };
  };
  // An entity's own source if it has one (verkada), else its first source
  // (maymobility -> maymobility_ir), so a runtime key named after a known
  // entity keeps that entity's name and status.
  const byEntity = new Map();
  for (const key of Object.keys(sources).sort()) {
    const entity = sources[key].entity;
    if (!byEntity.has(entity) || key === entity) byEntity.set(entity, key);
  }
  const named = (x) => {
    if (has(sources, x)) return entry(x);
    if (byEntity.has(x)) return entry(byEntity.get(x));
    return { entity_key: x, entity_name: humanize(x), status: "unknown" };
  };

  return function auxRoute(sourceKey) {
    const key = String(sourceKey ?? "").trim();
    if (!key) return null;
    if (has(sources, key)) return entry(key);
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
      return named(x);
    }
    m = /^ia_media_(.+)$/.exec(key);
    if (m) return { entity_key: "media_" + m[1], entity_name: "Industry media", status: "media" };
    m = /^ia_(.+)$/.exec(key);
    if (m) return named(m[1]);
    // Anything else: a source news-monitor no longer lists (edgar_ssti,
    // soundthinking: names dropped from coverage) or a new one not synced yet.
    return named(key.replace(/^edgar_/, ""));
  };
}

export const auxRoute = makeAuxRoute(AUX, COVERED);
