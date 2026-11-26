// Portal (phase 3): placeholder views until each part builds its own, and the
// company index (the covered tickers from deps.tickers; it reads no rows).
// The view contract: async (vctx) -> { title, active, body, status? }, where
// vctx = { env, url, request, auth, who, tickers, muted, now, nonce }. A view
// builds its body with portal-html.js `html`, sets no headers, and fails closed
// (403, no query) unless vctx.auth?.ok === true.
import { html, tickerHref } from "./portal-html.js";

const TITLES = {
  today: "Today", companies: "Companies", company: "Company", competitors: "Competitors",
  industry: "Industry", rare: "Rare finds", search: "Search", brief: "Brief",
};

export const denied = (active = "") => ({ title: "Not signed in", active, body: html`<p>Not signed in.</p>`, status: 403 });

export function stub(name) {
  const active = name === "company" ? "companies" : name;
  return async (vctx) => {
    if (vctx?.auth?.ok !== true) return denied(active);
    return { title: TITLES[name] || "Zenith", active, body: html`<p class="empty">Not built yet.</p>` };
  };
}

export async function companiesIndex(vctx) {
  if (vctx?.auth?.ok !== true) return denied("companies");
  const names = (vctx.tickers || []).map((t) => [t, tickerHref(t)]).filter(([, h]) => h);
  return {
    title: "Companies",
    active: "companies",
    body: html`<ul class="names">${names.map(([t, h]) => html`<li><a href="${h}">${t}</a></li>`)}</ul>`,
  };
}
