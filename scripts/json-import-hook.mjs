// A module loader hook so the Worker's plain `import X from "./covered.json"`
// (no import attribute; wrangler's bundler accepts it) also loads under plain
// Node. The same loader as test/helpers/worker-env.js hookJsonImports, for
// local scripts that import Worker modules (scripts/lane-report.mjs).
// Register it before the first dynamic import of a Worker module.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let hooked = false;
export function hookJsonImports() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && url.endsWith(".json") && !context.importAttributes?.type) {
        return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
