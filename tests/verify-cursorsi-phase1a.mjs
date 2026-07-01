/**
 * Static verification for CursorSI CLI Phase 1a.
 * Run: node tests/verify-cursorsi-phase1a.mjs
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

const bin = read("cli/bin/cursorsi.mjs");
assert(bin.includes("--no-reflect"), "bin documents --no-reflect");
assert(bin.includes("Phase 1a"), "bin help mentions Phase 1a");

const cliOpts = read("cli/src/runtime/cli-options.ts");
assert(cliOpts.includes("noReflect"), "cli-options has noReflect");
assert(cliOpts.includes("--no-reflect"), "cli-options parses --no-reflect");

const transcript = read("cli/src/harness/transcript.ts");
assert(transcript.includes("reconstructTranscript"), "transcript reconstruction");
assert(transcript.includes("sessionHasReflectableContent"), "reflectable content guard");

const invoke = read("cli/src/harness/invoke-chain.ts");
assert(invoke.includes("launchReflectChain"), "invoke-chain launches reflect");
assert(invoke.includes("child.unref"), "background spawn unrefs child");
assert(invoke.includes("scripts"), "invoke-chain uses scripts/invoke-chain.sh");
assert(invoke.includes("invoke-chain"), "invoke-chain references shell script");

const autoReflect = read("cli/src/harness/auto-reflect.ts");
assert(autoReflect.includes("triggerAutoReflectOnSessionEnd"), "auto-reflect export");
assert(autoReflect.includes("noReflect"), "auto-reflect respects --no-reflect");
assert(autoReflect.includes("background: true"), "auto-reflect is fire-and-forget");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("triggerAutoReflectOnSessionEnd"), "orchestrator triggers auto-reflect");
assert(orch.includes("endSession"), "orchestrator endSession helper");

assert(
  existsSync(path.join(root, "scripts/invoke-chain.sh")),
  "invoke-chain.sh exists at repo root",
);
assert(
  existsSync(path.join(root, "harness/scripts/dist/post-task-chain.js")),
  "post-task-chain.js dist exists",
);

if (failures.length) {
  console.error("verify-cursorsi-phase1a FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase1a: all checks passed");
