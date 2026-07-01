/**
 * Static verification for SISpace GTK4 Phase 6 SISwarm tab.
 * Run: node tests/verify-sispace-gtk4-phase6.mjs
 *
 * Auto-block: exits with code 1 if cargo build -p sispace-gtk fails.
 */
import { execSync } from "node:child_process";
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

// auto-block: fail fast if gtk-app does not compile
execSync("cargo build -p sispace-gtk 2>&1", { cwd: root, stdio: "pipe" });

const siswarmTab = read("gtk-app/src/ui/siswarm/siswarm_tab.rs");
assert(siswarmTab.includes("launch_siswarm_for_vte"), "launch uses launch_siswarm_for_vte");
assert(siswarmTab.includes("DrawingArea") || read("gtk-app/src/ui/siswarm/visualizer.rs").includes("DrawingArea"), "cairo DrawingArea visualizer");
assert(siswarmTab.includes("TextView"), "blackboard GtkTextView");
assert(siswarmTab.includes("TerminalColumn"), "VTE terminal column");
assert(siswarmTab.includes("read_blackboard_public"), "Obsidian blackboard read");
assert(siswarmTab.includes("attach_siswarm_panes"), "attach spawned panes to VTE");
assert(siswarmTab.includes("on_ipc_dispatch"), "IPC refresh on swarm events");

const visualizer = read("gtk-app/src/ui/siswarm/visualizer.rs");
assert(visualizer.includes("set_draw_func"), "cairo draw callback");
assert(visualizer.includes("gate_locked"), "gate status on nodes");
assert(visualizer.includes("draw_gate_pills"), "gate progress pills");
assert(visualizer.includes("GestureClick"), "click-to-select pane");

const coreSwarm = read("sispace-core/src/services/swarm_workspace.rs");
assert(coreSwarm.includes("launch_siswarm_for_vte"), "core launch_siswarm_for_vte API");
assert(coreSwarm.includes("spawn_for_vte"), "VTE spawn path when for_vte");
assert(coreSwarm.includes("apply_gate_unlocks"), "gate unlock logic in core");
assert(coreSwarm.includes("extract_blackboard_section"), "Obsidian ## Blackboard section");

const gtkEvents = read("gtk-app/src/gtk_events.rs");
assert(gtkEvents.includes("attach_siswarm"), "IPC bridge attach_siswarm");

const mainRs = read("gtk-app/src/main.rs");
assert(mainRs.includes("build_siswarm_tab"), "main wires SISwarm tab");
assert(!mainRs.includes("Swarm visualizer and blackboard — Phase 6"), "SISwarm placeholder removed");

const modRs = read("gtk-app/src/ui/mod.rs");
assert(modRs.includes("pub mod siswarm"), "ui mod exports siswarm");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase6 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase6 OK");
