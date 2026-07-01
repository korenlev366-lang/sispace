/**
 * Static verification for SISpace V2 Phase 2 embedded xterm panes.
 * Run: node tests/verify-sispace-v2-phase2.mjs
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

const cargo = read("src-tauri/Cargo.toml");
assert(cargo.includes("portable-pty"), "Cargo.toml uses portable-pty");

const paneSvc = read("src-tauri/src/services/pane.rs");
assert(paneSvc.includes("portable_pty"), "pane service embedded PTY");
assert(paneSvc.includes("pane-output"), "pane emits pane-output");
assert(paneSvc.includes("run.sh"), "pane spawns via cli/run.sh");
assert(!paneSvc.includes("--pane-mode"), "embedded panes use full Ink TUI");
assert(paneSvc.includes("--event-socket"), "pane command includes event socket");
assert(paneSvc.includes("inject_prompt"), "orchestrator inject to PTY stdin");

const paneIpc = read("src-tauri/src/services/pane_ipc.rs");
assert(paneIpc.includes("send_inject"), "pane_ipc control socket (legacy)");

const paneCmd = read("src-tauri/src/commands/pane.rs");
assert(paneCmd.includes("pane_spawn"), "pane_spawn command");
assert(paneCmd.includes("pane_write"), "pane_write for xterm keystrokes");
assert(paneCmd.includes("pane_resize"), "pane_resize for FitAddon");

const xterm = read("src/workspace/XtermPane.tsx");
assert(xterm.includes("@xterm/xterm"), "XtermPane uses xterm");
assert(xterm.includes("FitAddon"), "XtermPane uses FitAddon");
assert(xterm.includes("WebLinksAddon"), "XtermPane uses WebLinksAddon");

const column = read("src/workspace/EmbeddedTerminalColumn.tsx");
assert(column.includes("EmbeddedTerminalColumn"), "vertical terminal column");

const sidebar = read("src/workspace/TerminalSessionSidebar.tsx");
assert(sidebar.includes("Spawn terminal"), "TerminalSessionSidebar spawn button");

const tuiBridge = read("cli/src/pane/tui-bridge.ts");
assert(tuiBridge.includes("session_start"), "full TUI emits pane IPC");

const installCli = read("scripts/install-cli.mjs");
assert(installCli.includes(".local/bin/cursorsi"), "install-cli symlinks globally");

const rootPkg = read("package.json");
assert(rootPkg.includes("install-cli"), "root package install-cli script");

const cliPkg = read("cli/package.json");
assert(cliPkg.includes('"bin"'), "cli package bin field for npm link");

const wsCmd = read("src-tauri/src/commands/workspace.rs");
assert(wsCmd.includes("workspace_apply_preset"), "workspace_apply_preset");

const app = read("src/workspace/WorkspaceApp.tsx");
assert(app.includes("TerminalSessionSidebar"), "WorkspaceApp session sidebar");
assert(app.includes("EmbeddedTerminalColumn"), "WorkspaceApp embedded xterm column");
assert(app.includes("paneSpawn"), "WorkspaceApp spawns sessions");
assert(!app.includes("WorkspaceGrid"), "WorkspaceApp no drag grid");

const pkg = read("package.json");
assert(pkg.includes("@xterm/xterm"), "package.json includes xterm");
assert(!pkg.includes("react-grid-layout"), "package.json no react-grid-layout");

const libRs = read("src-tauri/src/lib.rs");
assert(libRs.includes("commands::pane::"), "lib registers pane commands");

if (failures.length) {
  console.error("verify-sispace-v2-phase2 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-sispace-v2-phase2: all checks passed");
