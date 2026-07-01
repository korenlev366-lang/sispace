/**
 * Static verification for SISpace GTK4 Phase 4 sidebar + meta-orchestrator IPC.
 * Run: node tests/verify-sispace-gtk4-phase4.mjs
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

const gtkEvents = read("gtk-app/src/gtk_events.rs");
assert(gtkEvents.includes("GtkPaneEventDispatcher"), "GTK PaneEventDispatcher");
assert(gtkEvents.includes("PaneEventDispatcher"), "implements pane IPC dispatcher");
assert(
  gtkEvents.includes("timeout_add_local") || gtkEvents.includes("MainContext"),
  "marshals IPC to GLib main loop"
);
assert(gtkEvents.includes("send_notification"), "desktop notification on agent complete");
assert(gtkEvents.includes("notification:pane-ready"), "handles notification channel");

const sidebar = read("gtk-app/src/ui/sispace/session_sidebar.rs");
assert(sidebar.includes("ListBox"), "session sidebar uses GtkListBox");
assert(sidebar.includes("apply_ipc_payload"), "sidebar updates from IPC events");
assert(sidebar.includes("apply_session_update"), "sidebar handles pane:session-update");
assert(sidebar.includes("agent_status") || sidebar.includes("agentStatus"), "live agent status");
assert(sidebar.includes("session_tokens") || sidebar.includes("sessionTokens"), "token cost display");

const meta = read("gtk-app/src/ui/sispace/meta_panel.rs");
assert(meta.includes("TextView"), "meta feed GtkTextView");
assert(meta.includes("EntryRow"), "meta inject AdwEntryRow");
assert(meta.includes("DropDown"), "target pane GtkDropDown");
assert(meta.includes("inject_prompt"), "inject via PaneManager");
assert(meta.includes("append_feed"), "meta feed appends IPC events");
assert(meta.includes("Broadcast"), "broadcast inject");

const paneEvents = read("gtk-app/src/ui/sispace/pane_events.rs");
assert(paneEvents.includes("session_start"), "summarize session_start");
assert(paneEvents.includes("agent_turn"), "summarize agent_turn");
assert(paneEvents.includes("agent_complete"), "summarize agent_complete");
assert(paneEvents.includes("cost_update"), "summarize cost_update");
assert(paneEvents.includes("session_end"), "summarize session_end");

const sispaceTab = read("gtk-app/src/ui/sispace/sispace_tab.rs");
assert(sispaceTab.includes("GtkPaneEventBridge"), "tab wires GTK IPC bridge");
assert(!sispaceTab.includes("NoopPaneEventDispatcher"), "no longer uses no-op dispatcher");
assert(sispaceTab.includes("SessionSidebar"), "real session sidebar");
assert(sispaceTab.includes("MetaPanel"), "meta-orchestrator panel");

const notify = read("sispace-core/src/services/notify_hub.rs");
assert(notify.includes("notify_agent_complete"), "core notifies on agent_complete");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase4 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase4 OK");
