// Registrable domains, shared by scripts/sync-covered.mjs (the covered.json
// channels catalog) and the Worker. No imports, so both can load it.

// Second-level labels that sit under a two-letter country code (example.co.uk).
const COUNTRY_SECOND_LEVEL = new Set(["co", "com", "gov", "ac", "or", "ne", "org", "net"]);

// The registrable domain of a host: its last two labels, lower-cased, or its
// last three when the second-last label is one of COUNTRY_SECOND_LEVEL and the
// last is a two-letter country code. ir.example.com -> example.com;
// news.example.co.uk -> example.co.uk; www.gov.uk -> www.gov.uk (government
// hosts are classed before this is consulted, so that case does not matter).
export function regDomain(host) {
  const labels = String(host ?? "").trim().toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const [second, last] = labels.slice(-2);
  const n = /^[a-z]{2}$/.test(last) && COUNTRY_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-n).join(".");
}

// The lower-cased host of a URL, "" when it is not a URL.
export function hostOf(url) {
  try { return new URL(String(url ?? "")).hostname.toLowerCase(); } catch { return ""; }
}
