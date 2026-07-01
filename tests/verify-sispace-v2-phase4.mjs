/**
 * Static verification for SISpace V2 Phase 4 meta-orchestrator.
 * Run: node tests/verify-sispace-v2-phase4.mjs
 */
import { readFileSync } from "node:fs";
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

const ipc = read("src-tauri/src/services/pane_ipc.rs");
assert(ipc.includes("UnixListener"), "pane_ipc uses UnixListener");
assert(ipc.includes("pane:session-start"), "pane_ipc emits pane:session-start");
assert(ipc.includes("pane:agent-turn"), "pane_ipc emits pane:agent-turn");
assert(ipc.includes("pane:goal-status"), "pane_ipc emits pane:goal-status");
assert(ipc.includes("MAX_LINE_BYTES"), "pane_ipc enforces 8KB line cap");

const pane = read("src-tauri/src/services/pane.rs");
assert(pane.includes("with_ipc_hub"), "PaneManager with_ipc_hub");
assert(pane.includes("inject_prompt"), "PaneManager inject_prompt");

const paneCmd = read("src-tauri/src/commands/pane.rs");
assert(paneCmd.includes("pane_inject"), "pane_inject command");

const libRs = read("src-tauri/src/lib.rs");
assert(libRs.includes("pane_inject"), "lib registers pane_inject");
assert(libRs.includes("PaneIpcHub"), "lib creates PaneIpcHub");

const cliMode = read("cli/src/pane/mode.ts");
assert(cliMode.includes("agent_turn"), "pane mode emits agent_turn");
assert(cliMode.includes("goal_status"), "pane mode emits goal_status");
assert(cliMode.includes("cost_update"), "pane mode emits cost_update");
assert(cliMode.includes("session_end"), "pane mode emits session_end");
assert(cliMode.includes("inject_prompt"), "pane mode handles inject_prompt");

const orch = read("src/workspace/MetaOrchestratorPanel.tsx");
assert(orch.includes("subscribePaneIpcEvents"), "MetaOrchestrator subscribes IPC");
assert(orch.includes("paneInject"), "MetaOrchestrator uses paneInject");
assert(orch.includes("Broadcast"), "MetaOrchestrator broadcast");

const wsApp = read("src/workspace/WorkspaceApp.tsx");
assert(wsApp.includes("MetaOrchestratorPanel"), "WorkspaceApp embeds orchestrator");

const wsLib = read("src/lib/workspace.ts");
assert(wsLib.includes("pane_inject"), "workspace lib pane_inject");

const pkg = read("package.json");
assert(pkg.includes("verify:sispace-v2-phase4"), "package.json phase4 verify script");

if (failures.length) {
  console.error("verify-sispace-v2-phase4 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-sispace-v2-phase4: all checks passed");
