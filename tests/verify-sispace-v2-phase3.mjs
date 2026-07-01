/**
 * Static verification for SISpace V2 Phase 3 harness panel.
 * Run: node tests/verify-sispace-v2-phase3.mjs
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

const hpSnap = read("src-tauri/src/services/hp_snapshot.rs");
assert(hpSnap.includes("HarnessPanelSnapshot"), "hp_snapshot defines HarnessPanelSnapshot");
assert(hpSnap.includes("run_meta_readiness"), "hp_snapshot uses meta-readiness script");
assert(hpSnap.includes("spawn_reflect_chain"), "hp_snapshot reflect chain");
assert(hpSnap.includes("panel-actions.js"), "hp_snapshot panel-actions.js");

const hpCmd = read("src-tauri/src/commands/hp_panel.rs");
assert(hpCmd.includes("harness_panel_snapshot"), "harness_panel_snapshot command");
assert(hpCmd.includes("harness_panel_grade"), "harness_panel_grade command");
assert(hpCmd.includes("harness_panel_apply"), "harness_panel_apply command");
assert(hpCmd.includes("harness_panel_curate"), "harness_panel_curate command");

const libRs = read("src-tauri/src/lib.rs");
assert(libRs.includes("harness_panel_snapshot"), "lib registers harness_panel_snapshot");
assert(libRs.includes("harness_panel_reflect"), "lib registers harness_panel_reflect");

const panelTs = read("src/workspace/HarnessPanel.tsx");
assert(panelTs.includes("harnessPanelReflect"), "HarnessPanel wires reflect");
assert(panelTs.includes("harnessPanelGrade"), "HarnessPanel wires grade");
assert(panelTs.includes("useVirtualizer"), "HarnessPanel virtualizes rollout log");
assert(panelTs.includes("Meta-readiness"), "HarnessPanel shows meta-readiness");

const wsApp = read("src/workspace/WorkspaceApp.tsx");
assert(wsApp.includes("HarnessPanel"), "WorkspaceApp uses HarnessPanel not stub");
assert(wsApp.includes('"harness"'), "WorkspaceApp defaults harness tab");
assert(!wsApp.includes("HarnessPanelStub"), "WorkspaceApp removed stub import");

const lib = read("src/lib/harness-panel.ts");
assert(lib.includes("harness_panel_snapshot"), "harness-panel.ts invoke snapshot");

const panelActions = path.join(
  root,
  "harness/scripts/dist/panel-actions.js",
);
assert(existsSync(panelActions), "panel-actions.js built");

const pkg = read("package.json");
assert(pkg.includes("verify:sispace-v2-phase3"), "package.json verify script for phase3");

if (failures.length) {
  console.error("verify-sispace-v2-phase3 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-sispace-v2-phase3: all checks passed");
