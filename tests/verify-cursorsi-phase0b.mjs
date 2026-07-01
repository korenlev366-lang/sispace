/**
 * Static verification for CursorSI CLI Phase 0b.
 * Run: node tests/verify-cursorsi-phase0b.mjs
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

const sessionAgent = read("cli/src/sdk/session-agent.ts");
assert(sessionAgent.includes("tokenFromEnv"), "session-agent exports tokenFromEnv");
assert(sessionAgent.includes("sendSessionMessage"), "session-agent exports sendSessionMessage");
assert(!sessionAgent.includes("config/api-key"), "session-agent must not import api-key config");

const invokeChain = read("cli/src/harness/invoke-chain.ts");
assert(invokeChain.includes("invoke-chain"), "invoke-chain spawns shell script");
assert(invokeChain.includes("runHarnessReflect"), "invoke-chain exports runHarnessReflect");

const grade = read("cli/src/harness/grade.ts");
assert(grade.includes("tokenFromEnv"), "grade uses tokenFromEnv");
assert(grade.includes("importHarness"), "grade uses dynamic harness import");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("runSlashCommand"), "slash exports async runSlashCommand");
assert(slash.includes("SlashContext"), "slash defines SlashContext");
assert(slash.includes("runHarnessReflect"), "slash wires /reflect");
assert(slash.includes("runHarnessGrade"), "slash wires /grade");
assert(slash.includes("loadSkillBundle"), "slash wires skill bundles");

const types = read("cli/src/session/types.ts");
assert(types.includes("cursorAgentId"), "types include cursorAgentId");
assert(types.includes("skillBundle"), "types include skillBundle");
assert(types.includes("skillBundlePrompt"), "types include skillBundlePrompt");

const store = read("cli/src/session/store.ts");
assert(store.includes("patchSession"), "store has patchSession");
assert(store.includes("setSkillBundle"), "store has setSkillBundle");
assert(store.includes("replaceLastLine"), "store has replaceLastLine for streaming");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("sendSessionMessage"), "orchestrator wires SDK send");
assert(orch.includes("isBusy"), "orchestrator tracks busy state");
assert(orch.includes("replaceLastLine"), "orchestrator streams agent line");
assert(orch.includes("runSlashCommand"), "orchestrator async slash");

const bin = read("cli/bin/cursorsi.mjs");
assert(bin.includes("Phase 0b"), "bin help mentions Phase 0b");
assert(bin.includes("__cursorsiCk"), "bin bootstraps credential global");

const pkg = JSON.parse(read("cli/package.json"));
assert(pkg.dependencies?.["@openrouter/sdk"], "package depends on @openrouter/sdk");
assert(!pkg.dependencies?.["@cursor/sdk"], "package must not depend on @cursor/sdk (moved to sidecar)");

assert(existsSync(path.join(root, "cli/src/runtime/send-turn.ts")), "send-turn runtime exists");

if (failures.length) {
  console.error("verify-cursorsi-phase0b FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase0b: all checks passed");
