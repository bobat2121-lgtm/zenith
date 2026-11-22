// Loads worker/src/index.js under Node for route and cron tests. Worker modules
// import covered.json without an import attribute (fine for wrangler, an error
// in Node), so every module is copied to a temp dir with its JSON imports
// rewritten to `with { type: "json" }` and imported from there.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../../worker/src/", import.meta.url);

export async function loadWorker() {
  const dir = mkdtempSync(join(tmpdir(), "zenith-worker-"));
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(new URL(f, SRC), "utf8")
      .replace(/from\s+"\.\/([^"]+\.json)"/g, (m, rel) => `from "${new URL(rel, SRC).href}" with { type: "json" }`);
    writeFileSync(join(dir, f), code);
  }
  return (await import(pathToFileURL(join(dir, "index.js")).href)).default;
}
