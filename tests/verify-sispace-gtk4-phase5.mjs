/**
 * Static verification for SISpace GTK4 Phase 5 harness tab.
 * Run: node tests/verify-sispace-gtk4-phase5.mjs
 *
 * Auto-block: exits with code 1 if cargo build -p sispace-gtk fails.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const harnessPanel = read("gtk-app/src/ui/harness/harness_panel.rs");
assert(harnessPanel.includes("Paned::new"), "harness tab uses GtkPaned");
assert(harnessPanel.includes("ListBox"), "harness tab uses GtkListBox");
assert(harnessPanel.includes("TextView"), "detail GtkTextView");
assert(harnessPanel.includes("ProgressBar"), "meta-readiness GtkProgressBar");
assert(harnessPanel.includes("Meta-readiness"), "Meta-readiness section");
assert(harnessPanel.includes("Proposals"), "Proposals section");
assert(harnessPanel.includes("build_snapshot"), "refresh uses hp_snapshot build_snapshot");
assert(harnessPanel.includes("spawn_reflect_chain"), "Reflect action");
assert(harnessPanel.includes("spawn_panel_script"), "grade/apply/curate via panel-actions");
assert(harnessPanel.includes("Accept") && harnessPanel.includes("Reject"), "per-proposal accept/reject");
assert(harnessPanel.includes("Apply all"), "bulk apply-all button");
assert(harnessPanel.includes("run_harness_doctor"), "Doctor action");
assert(
  harnessPanel.includes("Refresh") && harnessPanel.includes("Reflect"),
  "action toolbar buttons"
);

const hpSnap = read("sispace-core/src/services/hp_snapshot.rs");
assert(hpSnap.includes("HarnessPanelSnapshot"), "sispace-core hp_snapshot unchanged");
assert(hpSnap.includes("parse_section_entries"), "ledger parsing in core");

const mainRs = read("gtk-app/src/main.rs");
assert(mainRs.includes("build_harness_tab"), "main wires harness tab");
assert(!mainRs.includes("Harness management panel — Phase 5"), "harness placeholder removed");

const panelActions = path.join(root, "harness/scripts/dist/panel-actions.js");
assert(existsSync(panelActions), "panel-actions.js built for grade/apply/curate");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase5 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase5 OK");
