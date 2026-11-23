// Builds worker/src/site-sources.json (written by scripts/sync-covered.mjs):
// news-monitor's ops instruments that the Coverage page reports on, mapped to
// the covered ticker each one watches, so zenith-core never parses news-monitor
// source files at runtime.
//   sites : site-structure watchers (adapter site_structure, keys site_*): the
//           domain and label from their config (src/site-structure-sources.js)
//   probes: Worker-egress probes (adapter probe, keys probe_*) with a short
//           label for the health strip ("SYM events", "KDK news") and the
//           answer the probe is built to get (expect: "feed", "sitemap", or
//           null for a page probe, where any usable answer is OK)
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

// What a probe's endpoint should answer: a sitemap for a sitemap URL or a
// *_sitemap key, a feed for an RSS endpoint (/rss/, RssFeed, .rss, a non-sitemap
// .xml) or a *_rss / *_feed key, else null. news-monitor's own feed validation
// (src/ir-platforms.js) calls an HTML answer from a feed endpoint "page, not a feed".
export function probeExpect(key, endpoint) {
  const k = String(key ?? "");
  let path = "";
  try { path = endpoint ? new URL(endpoint).pathname : ""; } catch { path = String(endpoint ?? ""); }
  if (/_sitemap$/.test(k) || /sitemap[^/]*\.xml$/i.test(path)) return "sitemap";
  if (/_(rss|feed)$/.test(k) || /(^|\/)(rss|rssfeed)(\/|$)|\.(rss|xml)$/i.test(path)) return "feed";
  return null;
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
      probes[s.key] = { ticker, label: probeLabel(s.key, ticker || s.config?.ticker), expect: probeExpect(s.key, s.endpoint) };
    }
  }
  return { sites, probes };
}
