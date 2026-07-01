/**
 * Static verification for CursorSI CLI Phase 1b.
 * Run: node tests/verify-cursorsi-phase1b.mjs
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

const cliOpts = read("cli/src/runtime/cli-options.ts");
assert(cliOpts.includes("--resume"), "cli-options parses --resume");
assert(cliOpts.includes("resumeTaskId"), "cli-options has resumeTaskId");
assert(cliOpts.includes("--db-path"), "cli-options parses --db-path");

const types = read("cli/src/session/types.ts");
assert(types.includes("taskId"), "session types include taskId");
assert(types.includes("obsidianContextBlock"), "session types include obsidian context");
assert(types.includes("resumeContextBlock"), "session types include resume context");

const recall = read("cli/src/obsidian/recall.ts");
assert(recall.includes("buildLessonSearchQuery"), "lesson query builder");
assert(recall.includes("formatLessonContext"), "lesson context formatter");
assert(recall.includes("vaultSearchSimple"), "recall uses vault search");

const search = read("cli/src/obsidian/search.ts");
assert(search.includes("/search/simple/"), "obsidian POST search/simple");

const resume = read("cli/src/session/resume.ts");
assert(resume.includes("buildResumeSessionState"), "resume builder");
assert(resume.includes("vaultRead"), "resume reads obsidian note");
assert(resume.includes("loadTaskMessages"), "resume loads sqlite messages");

const agentsInject = read("cli/src/session/agents-inject.ts");
assert(agentsInject.includes("findGitRepoRoot"), "agents-inject resolves git root");
assert(agentsInject.includes("formatAgentsContextBlock"), "agents-inject wraps system-context");
assert(agentsInject.includes("loadAgentsContextForSession"), "agents-inject caches per session");

const sessionAgent = read("cli/src/sdk/session-agent.ts");
assert(sessionAgent.includes("agentsContextBlock"), "session-agent injects AGENTS block");
assert(sessionAgent.includes("obsidianContextBlock"), "session-agent injects obsidian block");
assert(sessionAgent.includes("contextInjected"), "session-agent respects one-shot injection");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("handleRecall"), "slash wires /recall");
assert(slash.includes("fetchLessonContextForQuery"), "recall fetches lessons");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("loadAgentsContextForSession"), "orchestrator loads AGENTS.md");
assert(orch.includes("Loaded AGENTS.md"), "orchestrator logs AGENTS load");
assert(orch.includes("prefetchObsidianLessons"), "orchestrator prefetches lessons");
assert(orch.includes("initialSessionState"), "orchestrator accepts resume state");

assert(existsSync(path.join(root, "AGENTS.md")), "AGENTS.md at repo root");
assert(existsSync(path.join(root, ".cursor/rules/00-system.mdc")), "Cursor alwaysApply rule");

const init = read("cli/src/runtime/init.ts");
assert(init.includes("buildResumeSessionState"), "init handles --resume");

const bin = read("cli/bin/cursorsi.mjs");
assert(bin.includes("--resume"), "bin help documents --resume");
assert(bin.includes("Phase 1b"), "bin help mentions Phase 1b");

assert(existsSync(path.join(root, "cli/src/obsidian/config.ts")), "obsidian config loader");
assert(existsSync(path.join(root, "harness/config/obsidian.yaml")), "obsidian.yaml exists");

if (failures.length) {
  console.error("verify-cursorsi-phase1b FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase1b: all checks passed");
