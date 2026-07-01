/**
 * Static verification for SISpace GTK4 Phase 2 shell.
 * Run: node tests/verify-sispace-gtk4-phase2.mjs
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

const workspace = read("Cargo.toml");
assert(workspace.includes("gtk-app"), "workspace includes gtk-app member");

const cargo = read("gtk-app/Cargo.toml");
assert(cargo.includes("libadwaita"), "gtk-app depends on libadwaita");
assert(cargo.includes("gtk4"), "gtk-app depends on gtk4");
assert(cargo.includes("sispace-core"), "gtk-app depends on sispace-core");
assert(cargo.includes("sispace-gtk"), "gtk-app binary name sispace-gtk");

const mainRs = read("gtk-app/src/main.rs");
assert(mainRs.includes("Application::builder"), "uses AdwApplication");
assert(mainRs.includes("ApplicationWindow::builder"), "uses AdwApplicationWindow");
assert(mainRs.includes("StyleManager"), "uses AdwStyleManager");
assert(mainRs.includes("ColorScheme::ForceDark"), "forces dark theme");
assert(mainRs.includes("TabView::new"), "uses AdwTabView");
assert(mainRs.includes("ToggleButton::with_label"), "uses ToggleButton tab strip (avoids TabBar icon recursion)");
assert(!mainRs.includes("TabBar::new"), "does not use AdwTabBar (gtk_icon_theme_lookup recursion)");
assert(mainRs.includes("Harness"), "Harness placeholder tab");
assert(mainRs.includes("SISpace"), "SISpace placeholder tab");
assert(mainRs.includes("SISwarm"), "SISwarm placeholder tab");
assert(
  mainRs.includes("graceful_shutdown"),
  "window close calls graceful_shutdown (panes + IPC hub)"
);
assert(mainRs.includes("connect_close_request"), "wired on window close");

const appState = read("gtk-app/src/app_state.rs");
assert(appState.includes("PaneIpcHub"), "AppState wires PaneIpcHub");
assert(appState.includes("PaneManager"), "AppState wires PaneManager");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase2 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase2 OK");
