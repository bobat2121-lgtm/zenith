// Phase 3 PR-PA2: the public install files under /s/ (S15) and the generated
// icon module (S16). No auth, no data, never a cookie; a fixed allow-list.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadWorkerModule, pfetch, sessionEnv, sessionCookie } from "./helpers/portal.js";
import { ICONS } from "../worker/src/portal-icons.generated.js";

const { worker } = await loadWorkerModule();

test("S15: the manifest and icons are public, typed, cached and cookie-free; anything else under /s/ is 404", async () => {
  const env = sessionEnv();
  const cookie = await sessionCookie(env);
  const m = await pfetch(worker, env, "/s/manifest.webmanifest");
  assert.equal(m.status, 200);
  assert.equal(m.headers.get("content-type"), "application/manifest+json");
  assert.equal(m.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(m.headers.get("x-content-type-options"), "nosniff");
  const man = JSON.parse(m.text);
  assert.equal(man.start_url, "/p/today?src=home");
  assert.equal(man.scope, "/p/");
  assert.equal(man.id, "/p/");
  assert.equal(man.display, "standalone");
  assert.equal(man.name, "Zenith");
  assert.deepEqual(man.icons.map((i) => i.sizes), ["192x192", "512x512", "512x512"]);
  assert.equal(man.icons[2].purpose, "maskable");
  const urls = [...man.icons.map((i) => i.src), "/s/icon-180.png"];
  for (const u of urls) {
    const name = /^\/s\/(icon-[a-z0-9-]+\.png)/.exec(u)[1];
    if (u.includes("?v=")) assert.equal(u, `/s/${name}?v=${ICONS[name].sha8}`);
    const r = await worker.fetch(new Request(`https://zenith.example.com${u}`), env);
    assert.equal(r.status, 200, u);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("cache-control"), "public, max-age=604800, immutable");
    assert.equal(r.headers.get("set-cookie"), null);
    const b = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${u}: PNG signature`);
    assert.equal(b.subarray(12, 16).toString("latin1"), "IHDR");
    const size = Number(/(\d+)\.png/.exec(name)[1]);
    assert.equal(b.readUInt32BE(16), size, `${u}: width`);
    assert.equal(b.readUInt32BE(20), size, `${u}: height`);
  }
  const head = await pfetch(worker, env, "/s/icon-192.png", { method: "HEAD" });
  assert.equal(head.status, 200);
  for (const p of ["/s/sw.js", "/s/x", "/s/portal-auth.js", "/s/covered.json", "/s/", "/s/manifest.webmanifest/", "/s/ICON-180.png"]) {
    const r = await pfetch(worker, env, p, { cookie });
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get("set-cookie"), null, p);
  }
  const post = await pfetch(worker, env, "/s/manifest.webmanifest", { method: "POST", cookie });
  assert.equal(post.status, 405);
  for (const p of ["/s/manifest.webmanifest", "/s/icon-512.png"]) {
    assert.equal((await pfetch(worker, env, p, { cookie })).headers.get("set-cookie"), null, `${p} with a cookie`);
  }
  // /s/../p/today normalises to /p/today and still needs the gate.
  const up = await pfetch(worker, env, "/s/../p/today");
  assert.equal(up.status, 303);
  assert.equal(up.headers.get("location"), "/p/login");
});

test("S16: the committed icon module matches a fresh build (gen-portal-icons --check)", () => {
  const script = fileURLToPath(new URL("../scripts/gen-portal-icons.mjs", import.meta.url));
  const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.match(out, /up to date/);
  for (const [name, icon] of Object.entries(ICONS)) {
    assert.match(icon.sha8, /^[0-9a-f]{8}$/, name);
    assert.ok(icon.b64.length > 100, name);
  }
});
