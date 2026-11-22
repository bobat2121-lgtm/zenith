import test from "node:test";
import assert from "node:assert/strict";
import { D1, addItem, addGrade, fakeFetch } from "./helpers/d1.js";
import { mobile, verifyAccessJwt, teamOrigin, clearJwksCache, esc } from "../worker/src/mobile.js";

const TEAM = "zenith-team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const APP = "app-token-for-tests";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function keyPair(kid) {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "RS256", use: "sig" };
  return { kp, jwk };
}
async function sign(kp, kid, claims, alg = "RS256") {
  const h = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
const now = Date.now();
const goodClaims = () => ({ aud: [AUD], iss: `https://${TEAM}`, email: "analyst@example.com", exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000) - 10, sub: "u1" });

let keys;
async function certsFetch() {
  keys ??= { a: await keyPair("kid-a"), other: await keyPair("kid-other") };
  return fakeFetch((c) => (c.url === `https://${TEAM}/cdn-cgi/access/certs` ? { json: { keys: [keys.a.jwk] } } : { status: 404 }));
}
const env0 = (db) => ({ DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, APP_TOKEN: APP });

test("Access JWT: valid passes; wrong audience, issuer, expiry, key, algorithm or signature fail", async () => {
  clearJwksCache();
  const f = await certsFetch();
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const ok = await verifyAccessJwt(await sign(keys.a.kp, "kid-a", goodClaims()), env, { now, fetchImpl: f });
  assert.equal(ok.email, "analyst@example.com");
  const bad = async (claims, opts = {}) => verifyAccessJwt(await sign(opts.kp || keys.a.kp, opts.kid || "kid-a", claims, opts.alg), env, { now, fetchImpl: f });
  assert.equal(await bad({ ...goodClaims(), aud: ["other-app"] }), null, "audience");
  assert.ok(await bad({ ...goodClaims(), aud: AUD }), "a string aud claim works too");
  assert.equal(await bad({ ...goodClaims(), iss: "https://evil.cloudflareaccess.com" }), null, "issuer");
  assert.equal(await bad({ ...goodClaims(), exp: Math.floor(now / 1000) - 120 }), null, "expired");
  assert.equal(await bad({ ...goodClaims(), nbf: Math.floor(now / 1000) + 600 }), null, "not yet valid");
  assert.equal(await bad(goodClaims(), { kp: keys.other.kp, kid: "kid-a" }), null, "signed by another key");
  assert.equal(await bad(goodClaims(), { kp: keys.other.kp, kid: "kid-other" }), null, "unknown kid");
  assert.equal(await bad(goodClaims(), { alg: "HS256" }), null, "only RS256");
  const t = await sign(keys.a.kp, "kid-a", goodClaims());
  const [h, , s] = t.split(".");
  assert.equal(await verifyAccessJwt(`${h}.${b64url(JSON.stringify({ ...goodClaims(), email: "x@evil" }))}.${s}`, env, { now, fetchImpl: f }), null, "tampered payload");
  assert.equal(await verifyAccessJwt(t, { ACCESS_TEAM_DOMAIN: TEAM }, { now, fetchImpl: f }), null, "inert without ACCESS_AUD");
  assert.equal(teamOrigin("https://zenith-team.cloudflareaccess.com/"), `https://${TEAM}`);
  assert.equal(teamOrigin("http://x.example"), null);
  assert.ok(f.calls.length <= 3, `JWKS fetched ${f.calls.length} times (cached)`);
});

async function pageSetup() {
  const db = new D1();
  const lead = await addItem(db, { ticker: "SYM", title: `<script>alert("x")</script> Symbotic "Q4"`, url: "https://ir.example/sym" });
  await addGrade(db, lead, { score: 93, why: "Revenue <b>$630M</b>", note_hook: "Guide raise" });
  const dig = await addItem(db, { ticker: "PL", title: "Planet order", url: "javascript:alert(1)" });
  await addGrade(db, dig, { score: 74 });
  await addItem(db, { ticker: "GRRR", title: "Gorilla 6-K waiting" });
  const rej = await addItem(db, { ticker: "AUR", title: "Aurora at a conference" });
  await addGrade(db, rej, { score: 20 });
  const skipped = await addItem(db, { ticker: "AUR", title: "Skipped item", state: "skipped" });
  return { db, lead, dig, rej, skipped };
}
const req = (path, init = {}) => new Request(`https://zenith.example.com${path}`, init);

test("GET /m is 403 without credentials and before anything is configured", async () => {
  const { db } = await pageSetup();
  for (const env of [{ DB: db }, env0(db)]) {
    const r = await mobile(req("/m"), env, new URL(req("/m").url), {});
    assert.equal(r.status, 403);
    assert.equal(await r.text(), "forbidden\n");
  }
  const wrong = await mobile(req("/m", { headers: { authorization: "Bearer nope" } }), env0(db), new URL("https://zenith.example.com/m"), {});
  assert.equal(wrong.status, 403);
  const jwtNoConfig = await mobile(req("/m", { headers: { "cf-access-jwt-assertion": "a.b.c" } }), { DB: db }, new URL("https://zenith.example.com/m"), {});
  assert.equal(jwtNoConfig.status, 403);
});

test("GET /m renders bands with escaped text, a strict nonce CSP and no inline handlers", async () => {
  const { db, lead } = await pageSetup();
  const r = await mobile(req("/m", { headers: { authorization: `Bearer ${APP}` } }), env0(db), new URL("https://zenith.example.com/m"), { tickers: ["SYM", "PL"] });
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy");
  const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(csp), csp);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const html = await r.text();
  assert.ok(!html.includes('<script>alert("x")'), "title escaped");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Symbotic &quot;Q4&quot;"));
  assert.ok(html.includes("Revenue &lt;b&gt;$630M&lt;/b&gt;"));
  assert.ok(!html.includes("javascript:"), "non-http links are not linked");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers");
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.ok(html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
  assert.ok(!/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html), "no external scripts or styles");
  for (const h of ["Lead (1)", "Digest (1)", "Borderline (0)", "Waiting for a grade (1)", "Reject (1)"]) assert.ok(html.includes(h), h);
  assert.ok(!html.includes("Skipped item"));
  assert.ok(html.includes(`id="i${lead}"`));
  for (const l of ["high", "medium", "low", "noise", "too_high", "too_low"]) assert.ok(html.includes(`name="label" value="${l}"`), l);
  assert.ok(/<form class="lbl" method="post" action="\/m\/feedback"[^>]*>\s*<button type="submit" class="nodefault" disabled/.test(html), "Enter cannot submit a label");
  assert.ok(!/href="[^"]*label=/.test(html), "no labelling links (GET)");
});

test("POST /m/feedback forwards the /v1/feedback body; forms redirect back; GET is refused", async () => {
  const { db, lead } = await pageSetup();
  const seen = [];
  const deps = { feedback: async (body) => { seen.push(body); return new Response(JSON.stringify({ ok: true, feedback_id: 1 }), { status: 200 }); } };
  const url = new URL("https://zenith.example.com/m/feedback");
  const auth = { authorization: `Bearer ${APP}` };
  const r = await mobile(req("/m/feedback", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ item_id: lead, label: "too_high", note: " why ", ticker: "sym" }) }), env0(db), url, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(seen[0], { item_id: lead, label: "too_high", note: "why", ticker: "SYM" });

  const form = new URLSearchParams({ item_id: String(lead), label: "medium", note: "", ticker: "SYM" });
  const r2 = await mobile(req("/m/feedback", { method: "POST", headers: { ...auth, "content-type": "application/x-www-form-urlencoded" }, body: form }), env0(db), url, deps);
  assert.equal(r2.status, 303);
  assert.equal(r2.headers.get("location"), `/m#i${lead}`);
  assert.deepEqual(seen[1], { item_id: lead, label: "medium", ticker: "SYM" });

  const r3 = await mobile(req("/m/feedback", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ item_id: lead, label: "delete" }) }), env0(db), url, deps);
  assert.equal(r3.status, 400);
  assert.equal(seen.length, 2);

  const get = await mobile(req(`/m/feedback?item_id=${lead}&label=high`, { headers: auth }), env0(db), new URL(`https://zenith.example.com/m/feedback?item_id=${lead}&label=high`), deps);
  assert.equal(get.status, 405);
  assert.equal(seen.length, 2, "a GET never labels");

  const failing = { feedback: async () => new Response(JSON.stringify({ error: "label must be one of high, medium, low, noise" }), { status: 400 }) };
  const r4 = await mobile(req("/m/feedback", { method: "POST", headers: { ...auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ item_id: "1", label: "too_low" }) }), env0(db), url, failing);
  assert.equal(r4.status, 400);
  assert.match(await r4.text(), /Not saved: label must be one of high, medium, low, noise/);
});

test("an Access session can view and label from the same origin only", async () => {
  clearJwksCache();
  const { db, lead } = await pageSetup();
  const f = await certsFetch();
  const jwt = await sign(keys.a.kp, "kid-a", goodClaims());
  const seen = [];
  const deps = { fetchImpl: f, feedback: async (b) => { seen.push(b); return new Response("{}", { status: 200 }); } };
  const page = await mobile(req("/m", { headers: { "cf-access-jwt-assertion": jwt } }), env0(db), new URL("https://zenith.example.com/m"), deps);
  assert.equal(page.status, 200);
  const body = JSON.stringify({ item_id: lead, label: "high" });
  const url = new URL("https://zenith.example.com/m/feedback");
  const cross = await mobile(req("/m/feedback", { method: "POST", headers: { "cf-access-jwt-assertion": jwt, origin: "https://evil.example", "content-type": "application/json" }, body }), env0(db), url, deps);
  assert.equal(cross.status, 403);
  const none = await mobile(req("/m/feedback", { method: "POST", headers: { "cf-access-jwt-assertion": jwt, "content-type": "application/json" }, body }), env0(db), url, deps);
  assert.equal(none.status, 403, "no Origin and no Sec-Fetch-Site");
  const same = await mobile(req("/m/feedback", { method: "POST", headers: { "cf-access-jwt-assertion": jwt, origin: "https://zenith.example.com", "content-type": "application/json" }, body }), env0(db), url, deps);
  assert.equal(same.status, 200);
  assert.equal(seen.length, 1);
});

test("filters: days, ticker and unlabelled", async () => {
  const { db, lead } = await pageSetup();
  await db.prepare("INSERT INTO feedback (item_id, label, created_at) VALUES (?, 'high', ?)").bind(lead, new Date().toISOString()).run();
  const get = async (q) => (await mobile(req(`/m${q}`, { headers: { authorization: `Bearer ${APP}` } }), env0(db), new URL(`https://zenith.example.com/m${q}`), {})).text();
  const un = await get("?unlabeled=1");
  assert.ok(!un.includes(`id="i${lead}"`));
  const pl = await get("?ticker=PL");
  assert.ok(pl.includes("Planet order") && !pl.includes("Gorilla"));
  assert.ok((await get("")).includes("Labelled high"));
  assert.equal(esc(`a"<'&`), "a&quot;&lt;&#39;&amp;");
});
