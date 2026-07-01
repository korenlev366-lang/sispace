/**
 * Static verification for CursorSI CLI Phase 1c.
 * Run: node tests/verify-cursorsi-phase1c.mjs
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
assert(bin.includes('goal set'), "bin documents goal set");
assert(bin.includes("--verify"), "bin documents --verify");
assert(bin.includes("Phase 1c"), "bin help mentions Phase 1c");

const persist = read("cli/src/goal/persist.ts");
assert(
  persist.includes("goalsMdPath") || persist.includes("memory/goals"),
  "persist targets harness goals ledger",
);
assert(persist.includes("GOAL-"), "persist uses GOAL id schema");
assert(persist.includes("Verify command"), "persist stores verify command");

const loop = read("cli/src/goal/loop.ts");
assert(loop.includes("runVerifyAfterAgentTurn"), "verify loop after agent turn");
assert(loop.includes("hasGitWorktreeChanges"), "verify gated on git diff");
assert(loop.includes("skipped"), "verify can skip when no changes");

const verify = read("cli/src/goal/verify-runner.ts");
assert(verify.includes("spawnSync"), "verify runs shell command");
assert(
  verify.includes("Verify failed — feed the error output"),
  "clear verify failure message for agent",
);

const diff = read("cli/src/diff/capture.ts");
assert(diff.includes("git diff"), "diff uses git diff");
assert(diff.includes("--quiet"), "diff quiet check for verify gate");
assert(diff.includes("hasGitWorktreeChanges"), "worktree change detector");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("DiffViewer"), "orchestrator shows diff viewer");
assert(orch.includes("runVerifyAfterAgentTurn"), "orchestrator runs verify loop");
assert(orch.includes("captureGitDiff"), "orchestrator captures git diff");
assert(
  !orch.includes("Active goal loaded"),
  "orchestrator does not auto-load goals on session start",
);
assert(orch.includes("injectGoalNext"), "orchestrator opt-in goal inject");

const sendTurn = read("cli/src/runtime/send-turn.ts");
assert(sendTurn.includes("injectGoalContext"), "send-turn gates goal on injectGoalContext");

const stale = read("cli/src/goal/stale.ts");
assert(stale.includes("GOAL_MAX_AGE_MS"), "goal stale threshold");

const attach = read("cli/src/goal/session-attach.ts");
assert(attach.includes("attachGoalResume"), "goal resume attach");
assert(attach.includes("goalResumedExplicitly"), "explicit resume flag");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("/goal resume"), "slash supports goal resume");
assert(slash.includes("handleGoal"), "slash handles /goal");

const types = read("cli/src/session/types.ts");
assert(types.includes("activeGoal"), "session has activeGoal");
assert(types.includes("injectGoalContext"), "session has injectGoalContext flag");

assert(existsSync(path.join(root, "harness/memory/goals.md")), "goals.md exists");

if (failures.length) {
  console.error("verify-cursorsi-phase1c FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase1c: all checks passed");
