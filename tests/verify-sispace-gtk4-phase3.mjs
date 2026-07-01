/**
 * Static verification for SISpace GTK4 Phase 3 VTE pane manager.
 * Run: node tests/verify-sispace-gtk4-phase3.mjs
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

const cargo = read("gtk-app/Cargo.toml");
assert(cargo.includes("vte4"), "gtk-app depends on vte4");

const terminalCol = read("gtk-app/src/ui/sispace/terminal_column.rs");
assert(terminalCol.includes("VtePaneWidget"), "defines VtePaneWidget");
assert(
  terminalCol.includes("Pty::foreign_sync") || terminalCol.includes("foreign_sync"),
  "attaches foreign PTY via vte4 foreign_sync"
);
assert(terminalCol.includes("set_pty"), "Terminal::set_pty wired");
assert(terminalCol.includes("spawn_for_vte"), "spawn uses PaneManager::spawn_for_vte");

const vtePaste = read("gtk-app/src/ui/sispace/vte_paste.rs");
assert(vtePaste.includes("is_copy_key"), "VTE intercepts Shift+Ctrl+C for copy");
assert(vtePaste.includes("feed_copy_shortcut"), "VTE feeds copy key sequence to PTY");
assert(vtePaste.includes("[27;6;99~"), "copy sequence matches cursorsi isShiftCtrlCRaw");
assert(
  vtePaste.includes("copy_clipboard_format"),
  "VTE copies via Gdk clipboard for Wayland",
);
assert(terminalCol.includes("master_pty_fd"), "dup master fd from PaneManager");
assert(terminalCol.includes("spawn_and_focus"), "focus newly spawned terminal");

const sispaceTab = read("gtk-app/src/ui/sispace/sispace_tab.rs");
assert(sispaceTab.includes("Paned::new"), "SISpace tab uses GtkPaned");
assert(sispaceTab.includes("Orientation::Horizontal"), "horizontal paned layout");
assert(sispaceTab.includes("set_start_child"), "left sidebar placeholder");
assert(sispaceTab.includes("ScrolledWindow") || terminalCol.includes("ScrolledWindow"), "terminal column in scrolled window");
assert(sispaceTab.includes("Spawn terminal"), "spawn terminal button label");

const paneRs = read("sispace-core/src/services/pane.rs");
assert(paneRs.includes("spawn_for_vte"), "core exposes spawn_for_vte");
assert(paneRs.includes("master_pty_fd"), "core exposes master_pty_fd");
assert(paneRs.includes("bridge_output"), "bridge_output flag for VTE vs Tauri");
assert(paneRs.includes("run.sh"), "spawn uses cli/run.sh");

const mainRs = read("gtk-app/src/main.rs");
assert(mainRs.includes("build_sispace_tab"), "main wires real SISpace tab");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase3 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase3 OK");
