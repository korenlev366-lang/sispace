/**
 * Static verification for SISpace V2 Phase 7 (notifications, cost UI, polish, packaging).
 * Run: node tests/verify-sispace-v2-phase7.mjs
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

const notifyHub = read("src-tauri/src/services/notify_hub.rs");
assert(notifyHub.includes("notify_agent_complete"), "notify_hub agent complete");
assert(notifyHub.includes("notify_gate_unlock"), "notify_hub gate unlock");
assert(notifyHub.includes("push_ntfy"), "notify_hub ntfy POST");
assert(notifyHub.includes("tauri_plugin_notification"), "notify_hub desktop notification");

const paneIpc = read("src-tauri/src/services/pane_ipc.rs");
assert(paneIpc.includes("notify_agent_complete"), "pane_ipc triggers notify on agent_complete");

const pane = read("src-tauri/src/services/pane.rs");
assert(pane.includes("portable_pty"), "pane embedded PTY spawn");

const costRs = read("src-tauri/src/db/cost.rs");
assert(costRs.includes("cli_session_costs"), "cost db session table");
assert(costRs.includes("cli_project_costs"), "cost db project table");
assert(costRs.includes("daily_burn_tokens"), "cost daily burn");

const libRs = read("src-tauri/src/lib.rs");
assert(libRs.includes("tauri_plugin_notification"), "lib notification plugin");
assert(libRs.includes("cost_get_summary"), "lib cost_get_summary");
assert(libRs.includes("notification_focus_pending"), "lib notification_focus_pending");

const configYaml = read("config/sispace.yaml");
assert(configYaml.includes("ntfy:"), "config ntfy");
assert(configYaml.includes("cost:"), "config cost block");

const pkg = read("package.json");
assert(pkg.includes("@tauri-apps/plugin-notification"), "package notification plugin dep");
assert(pkg.includes("verify:sispace-v2-phase7"), "package phase7 verify script");
assert(pkg.includes("cursorsi:build"), "package builds cli before tauri");

const harness = read("src/workspace/HarnessPanel.tsx");
assert(harness.includes("HarnessCostSection"), "HarnessPanel cost section");
assert(harness.includes("HarnessEmptyIllustration"), "HarnessPanel empty illustration");

const wsApp = read("src/workspace/WorkspaceApp.tsx");
assert(wsApp.includes("initWorkspaceNotifications"), "WorkspaceApp notifications");
assert(wsApp.includes("PanelErrorBoundary"), "WorkspaceApp error boundaries");
assert(wsApp.includes("TerminalSessionSidebar"), "WorkspaceApp session sidebar");
assert(wsApp.includes('key === "1"'), "WorkspaceApp Ctrl+1 harness");
assert(wsApp.includes('key === "2"'), "WorkspaceApp Ctrl+2 sispace");
assert(wsApp.includes('key === "3"'), "WorkspaceApp Ctrl+3 siswarm");
assert(wsApp.includes('key === "p"'), "WorkspaceApp Ctrl+P preset");

const app = read("src/App.tsx");
assert(app.includes("LoadingScreen"), "App loading screen");

const pkgbuild = read("packaging/PKGBUILD");
assert(pkgbuild.includes("cursorsi-cli-"), "PKGBUILD unpacks cursorsi-cli tarball");
assert(pkgbuild.includes("/usr/bin/cursorsi"), "PKGBUILD installs cursorsi wrapper");

const packageDist = read("scripts/package-dist.mjs");
assert(packageDist.includes("cursorsi-cli-"), "package-dist bundles cursorsi-cli");
assert(packageDist.includes("cursorsi.mjs"), "package-dist cursorsi launcher");

const capabilities = read("src-tauri/capabilities/default.json");
assert(capabilities.includes("notification:default"), "capabilities notification permission");

if (failures.length) {
  console.error("verify-sispace-v2-phase7 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-sispace-v2-phase7: all checks passed");
