/**
 * Static verification for SISpace V2 Phase 5 SISwarm workspace.
 * Run: node tests/verify-sispace-v2-phase5.mjs
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

const swarmWs = read("src-tauri/src/services/swarm_workspace.rs");
assert(swarmWs.includes("launch_siswarm"), "swarm_workspace launch_siswarm");
assert(swarmWs.includes("apply_gate_unlocks"), "swarm_workspace gate unlocks");
assert(swarmWs.includes("coordinator"), "swarm_workspace coordinator role");
assert(swarmWs.includes("gate_locked"), "swarm_workspace gate_locked panes");

const pane = read("src-tauri/src/services/pane.rs");
assert(pane.includes("swarm_role"), "pane swarm_role");
assert(pane.includes("unlock_pane"), "pane unlock_pane");

const siswarmCmd = read("src-tauri/src/commands/siswarm.rs");
assert(siswarmCmd.includes("siswarm_launch"), "siswarm_launch command");

const libRs = read("src-tauri/src/lib.rs");
assert(libRs.includes("siswarm_launch"), "lib registers siswarm_launch");
assert(libRs.includes("siswarm_session"), "AppState siswarm_session");

const swarmClient = read("src-tauri/src/services/swarm_client.rs");
assert(swarmClient.includes("apply_gate_unlocks"), "swarm_client calls apply_gate_unlocks");

const cliOpts = read("cli/src/runtime/cli-options.ts");
assert(cliOpts.includes("swarmRole"), "cli swarmRole option");

const cliMode = read("cli/src/pane/mode.ts");
assert(cliMode.includes("swarmRole"), "pane mode session_start swarmRole");

const viz = read("src/workspace/SwarmVisualizerPanel.tsx");
assert(viz.includes("SwarmVisualizerPanel"), "SwarmVisualizerPanel component");
assert(viz.includes("blackboard"), "visualizer blackboard");

const wsApp = read("src/workspace/WorkspaceApp.tsx");
assert(wsApp.includes("siswarm"), "WorkspaceApp SISwarm tab");
assert(wsApp.includes("SwarmVisualizerPanel"), "WorkspaceApp embeds visualizer");
assert(wsApp.includes("launchSiswarm"), "WorkspaceApp launchSiswarm");

const obs = read("src-tauri/src/services/obsidian.rs");
assert(obs.includes("extract_blackboard_section"), "obsidian blackboard extract");

const pkg = read("package.json");
assert(pkg.includes("verify:sispace-v2-phase5"), "package.json phase5 verify");

if (failures.length) {
  console.error("verify-sispace-v2-phase5 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-sispace-v2-phase5: all checks passed");
