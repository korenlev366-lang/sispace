/**
 * Static verification for CursorSI CLI Phase 0d.
 * Run: node tests/verify-cursorsi-phase0d.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const cfg = read("config/sispace.yaml");
assert(cfg.includes("ntfy:"), "sispace.yaml has ntfy section");
assert(cfg.includes("topic:"), "sispace.yaml has ntfy.topic");

const bin = read("cli/bin/cursorsi.mjs");
assert(bin.includes("bootstrapCredentials"), "bin bootstraps credentials");
assert(bin.includes("__cursorsiObsidianKey"), "bin sets obsidian global");
assert(bin.includes("--voice"), "bin documents --voice");
assert(bin.includes("--notify-topic"), "bin documents --notify-topic");

const init = read("cli/src/runtime/init.ts");
assert(init.includes("parseCliArgs"), "init parses CLI args");

const cliOpts = read("cli/src/runtime/cli-options.ts");
assert(cliOpts.includes("--voice"), "cli-options handles --voice");

const ntfy = read("cli/src/notify/ntfy.ts");
assert(ntfy.includes("pushSessionEndNotify"), "ntfy session end push");
assert(ntfy.includes("loadSispaceConfigFromCwd"), "ntfy reads sispace config");

const voice = read("cli/src/voice/stub.ts");
assert(voice.includes("not yet implemented"), "voice stub message");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("pushSessionEndNotify"), "orchestrator calls ntfy on end");
assert(orch.includes("voiceStubMessage"), "orchestrator shows voice stub");

const main = read("cli/src/main.tsx");
assert(main.includes("initCliRuntime"), "main initializes runtime");
assert(main.includes("voiceEnabled"), "main passes voice flag");

assert(existsSync(path.join(root, "cli/src/config/sispace.ts")), "sispace config loader");

if (failures.length) {
  console.error("verify-cursorsi-phase0d FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase0d: all checks passed");
