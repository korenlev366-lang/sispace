/**
 * Static verification for SISpace GTK4 SICanvas tab (V2 Phase 6).
 * Run: node tests/verify-sispace-gtk4-sicanvas.mjs
 *
 * Auto-block: exits with code 1 if cargo build -p sispace-gtk fails.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// auto-block: fail fast if gtk-app does not compile
execSync("cargo build -p sispace-gtk 2>&1", { cwd: root, stdio: "pipe" });

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const canvasTab = read("gtk-app/src/ui/canvas/canvas_tab.rs");
assert(canvasTab.includes("SICanvas"), "canvas tab title");
assert(canvasTab.includes("ListBox"), "browser tab GtkListBox");
assert(canvasTab.includes("Pick element"), "pick element button");
assert(canvasTab.includes("TextView"), "element HTML GtkTextView");
assert(canvasTab.includes("EntryRow"), "AdwEntryRow prompt bar");
assert(canvasTab.includes("Send to active pane"), "send to active pane");
assert(canvasTab.includes("Send to new pane"), "send to new pane");
assert(canvasTab.includes("inject_prompt"), "PaneManager inject_prompt dispatch");
assert(canvasTab.includes("Refresh"), "refresh button fallback");
assert(canvasTab.includes("Copy"), "copy launch command button");
assert(canvasTab.includes("remote-debugging-port"), "setup panel launch hint");

const canvasCore = read("sispace-core/src/services/canvas.rs");
assert(canvasCore.includes("detect_remote_debugging_port"), "ps aux CDP detect");
assert(canvasCore.includes("/json"), "CDP /json tab list");
assert(canvasCore.includes("pick_element"), "CDP element picker");
assert(canvasCore.includes("webSocketDebuggerUrl"), "CDP WebSocket attach");
assert(canvasCore.includes("build_agent_prompt"), "agent prompt builder");

const mainRs = read("gtk-app/src/main.rs");
assert(mainRs.includes("build_canvas_tab"), "main wires SICanvas tab");
assert(mainRs.includes("SICanvas"), "SICanvas tab title in main");

const modRs = read("gtk-app/src/ui/mod.rs");
assert(modRs.includes("pub mod canvas"), "ui mod exports canvas");

const paneRs = read("sispace-core/src/services/pane.rs");
assert(paneRs.includes("resolve_active_pane_id"), "active pane resolution for canvas dispatch");

if (failures.length) {
  console.error("verify-sispace-gtk4-sicanvas FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-sicanvas OK");
