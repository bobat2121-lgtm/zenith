#!/usr/bin/env node
// Phase 3 Part E (PR-E4): makes a VAPID key pair for web push and stores it as
// Worker secrets. ONLY the owner runs this, in their own terminal, from
// zenith/worker, when they turn push on. Never an agent, never CI.
//
//   node ../scripts/vapid-keys.mjs --subject https://<worker host>/ [-c wrangler.portal.toml]
//
// It generates an ECDSA P-256 key pair with WebCrypto and pipes each value into
// `npx wrangler secret put <NAME>` on that command's stdin, so no value is ever
// an argument, a file or terminal output. It sets VAPID_PRIVATE_KEY,
// VAPID_PUBLIC_KEY and VAPID_SUBJECT on zenith-core (wrangler.toml); with
// -c <config> (the separate portal Worker) it also sets the same two public values
// there, never the private key. It prints only the public key and "done".
// It writes no file.
//
// Afterwards the owner sets PUSH_ENABLED by hand, value 1, on every Worker the
// script touched:
//   npx wrangler secret put PUSH_ENABLED                            (zenith-core)
//   npx wrangler secret put PUSH_ENABLED -c wrangler.portal.toml    (with -c only)
// Without PUSH_ENABLED on the portal Worker its pushOn stays false, so its /s/sw.js
// and push routes stay 404 (spec I13: the switch and the two public values go on
// both Workers, the private key on zenith-core only).
//
// Each secret put (3 here, 5 with -c, plus each PUSH_ENABLED put) creates and deploys
// a new Worker version, so each one is a Worker-affecting step (spec I9): its own
// deploy-log row with the version id from `npx wrangler deployments list` (and
// `-c <config>` for the portal Worker), and check R after the script finishes and
// after each PUSH_ENABLED put. wrangler prints one line per put naming the secret
// (never its value); the script stops at the first put that fails.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const opt = (names) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? args[i + 1] : undefined;
};
const subject = opt(["--subject"]);
const config = opt(["-c", "--config"]);
if (!subject || !/^https:\/\/[^\s/]+\/$/.test(subject)) {
  console.error("usage: node ../scripts/vapid-keys.mjs --subject https://<worker host>/ [-c wrangler.portal.toml]\n" +
    "then: npx wrangler secret put PUSH_ENABLED (value 1), and with -c also npx wrangler secret put PUSH_ENABLED -c <config>.\n" +
    "Each secret put is its own deploy-log row. Run check R when the script finishes.");
  process.exit(2);
}
if (config !== undefined && !/^[\w.-]+\.toml$/.test(config)) {
  console.error("-c takes a wrangler config file name, for example wrangler.portal.toml");
  process.exit(2);
}

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const kp = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await globalThis.crypto.subtle.exportKey("jwk", kp.privateKey);
const publicKey = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));

// Pipes one value into `wrangler secret put NAME` and resolves with its exit code.
function put(name, value, cfg) {
  return new Promise((resolve) => {
    const cmdArgs = ["wrangler", "secret", "put", name, ...(cfg ? ["-c", cfg] : [])];
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", cmdArgs, { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.end(value);
  });
}

const values = { VAPID_PRIVATE_KEY: jwk.d, VAPID_PUBLIC_KEY: publicKey, VAPID_SUBJECT: subject };
const steps = [["VAPID_PRIVATE_KEY", null], ["VAPID_PUBLIC_KEY", null], ["VAPID_SUBJECT", null],
  ...(config ? [["VAPID_PUBLIC_KEY", config], ["VAPID_SUBJECT", config]] : [])];
for (const [name, cfg] of steps) {
  const code = await put(name, values[name], cfg);
  if (code !== 0) {
    console.error(`wrangler secret put ${name}${cfg ? ` -c ${cfg}` : ""} did not finish: set it by hand. Nothing was printed or saved.`);
    process.exit(1);
  }
}
console.log(publicKey);
console.log("done");
