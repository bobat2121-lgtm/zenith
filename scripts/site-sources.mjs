// Builds worker/src/site-sources.json (written by scripts/sync-covered.mjs):
// news-monitor's ops instruments that the Coverage page reports on, mapped to
// the covered ticker each one watches, so zenith-core never parses news-monitor
// source files at runtime.
//   sites : site-structure watchers (adapter site_structure, keys site_*): the
//           domain and label from their config (src/site-structure-sources.js)
//   probes: Worker-egress probes (adapter probe, keys probe_*) with a short
//           label for the health strip ("SYM events", "KDK news")
// A watcher's config.ticker is kept only when it is a covered ticker (the
// May Mobility watcher has none: it watches a watchlist peer).

const upper = (t) => String(t ?? "").trim().toUpperCase();

// Key tokens that name the channel rather than what it carries ("page" stays:
// probe_sym_ir_events_page and probe_sym_ir_events_rss must read differently).
const PROBE_NOISE = new Set(["probe", "ir", "rss"]);

// "probe_sym_ir_events_rss" (SYM) -> "SYM events"; "probe_gnw_bot_www" (BOT) ->
// "BOT gnw www"; "probe_pi_sitemap" (no ticker) -> "pi sitemap".
export function probeLabel(key, ticker) {
  const t = upper(ticker);
  const rest = String(key ?? "").split("_").filter((w) => w && !PROBE_NOISE.has(w) && w !== t.toLowerCase());
  return [t, rest.join(" ")].filter(Boolean).join(" ") || String(key ?? "");
}

export function buildSiteSources(sourceList, coveredTickers = []) {
  const covered = new Set(coveredTickers.map(upper));
  const tickerOf = (s) => (covered.has(upper(s.config?.ticker)) ? upper(s.config.ticker) : null);
  const sites = {};
  const probes = {};
  for (const s of [...sourceList].sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
    if (!s?.key) continue;
    if (s.adapter === "site_structure" || s.config?.kind === "sitewatch") {
      sites[s.key] = { ticker: tickerOf(s), domain: s.config?.domain || null, label: s.config?.label || s.name || s.key };
    } else if (s.adapter === "probe" || s.config?.kind === "probe") {
      const ticker = tickerOf(s);
      probes[s.key] = { ticker, label: probeLabel(s.key, ticker || s.config?.ticker) };
    }
  }
  return { sites, probes };
}
