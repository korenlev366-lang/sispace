# SISpace GTK4 Migration Plan

> **Status:** GTK4 migration complete (Phases 1–7).  
> **Last updated:** 2026-06-03

---

## Architecture

| Layer | Crate / path | Role |
|-------|----------------|------|
| Core | `sispace-core/` (`sispace_core`) | DB, models, services, pane PTY, business logic |
| GTK shell | `gtk-app/` (`sispace-gtk`) | libadwaita tabs, VTE panes, harness/SISwarm, presets dialog |
| CLI | `cli/` | Spawned by pane manager (`cli/run.sh` → cursorsi) |

UI adapters implement `sispace_core::services::pane_ipc::PaneEventDispatcher`.

---

## Phase 1 — Core lift ✅

**Goal:** Extract portable Rust core; strip `tauri::*` from services.

### Done

- Workspace member `sispace-core` with `db/`, `models/`, `services/`, `state.rs`
- `PaneEventDispatcher` + `PaneIpcContext` in `pane_ipc.rs`
- `portable-pty` pane spawn/kill/inject unchanged; emits via dispatcher
- Services use `Arc<dyn PaneEventDispatcher>` / `Arc<AppState>` for background threads
- `src-tauri` depends on `sispace-core`; `tauri_events.rs` bridges `app.emit` + notification plugin
- Verify: `cargo build`, `cargo test --lib` (49 core + 9 tauri tests)

### Layout note

Core lives in `sispace-core/src/` (not repo-root `src/`) to avoid collision with the React app.

---

## Phase 2 — GTK shell ✅

- Crate [`gtk-app/`](gtk-app/) (`sispace-gtk` binary)
- `AdwApplication`, `AdwApplicationWindow`, `AdwStyleManager` dark (`ForceDark`)
- `AdwTabView` + `AdwTabBar`: Harness, SISpace, SISwarm placeholders
- `graceful_shutdown` on window close and application shutdown (panes + IPC hub)
- **Verify:** `cargo build -p sispace-gtk`, `node tests/verify-sispace-gtk4-phase2.mjs`

## Phase 3 — VTE panes ✅

**Goal:** Native VTE terminals bound to `PaneManager` master PTY fds (no `pane-output` bridge).

### Done

- `sispace-core`: `spawn_for_vte` (`bridge_output: false`), `master_pty_fd` (`libc::dup` of portable-pty master)
- `gtk-app/src/ui/sispace/terminal_column.rs`: `VtePaneWidget::attach` via `vte4::Pty::foreign_sync` + `Terminal::set_pty`; `TerminalColumn` vertical stack in `GtkScrolledWindow`
- `gtk-app/src/ui/sispace/sispace_tab.rs`: horizontal `GtkPaned` (sidebar placeholder + terminal column); **Spawn terminal** → `spawn_and_focus` (`cli/run.sh` → cursorsi)
- **Verify:** `cargo build -p sispace-gtk`, `npm run verify:sispace-gtk4-phase3`

## Phase 4 — Sidebar + meta + IPC UI ✅

**Goal:** Live session sidebar + meta-orchestrator from Unix-socket IPC on the GLib main thread.

### Done

- `gtk-app/src/gtk_events.rs`: `GtkPaneEventDispatcher` + `GtkPaneEventBridge` (mpsc → `timeout_add_local`); `gio::Notification` on `notification:pane-ready` / `agent_complete`
- `session_sidebar.rs`: `GtkListBox` rows (title, idle/working/complete, task, token cost); updates on `session_start`, `agent_turn`, `agent_complete`, `cost_update`, `session_end`, `pane:session-update`
- `meta_panel.rs`: read-only `GtkTextView` feed, `AdwEntryRow` inject, `GtkDropDown` target pane, broadcast inject via `PaneManager::inject_prompt`
- `sispace_tab.rs`: left column = sidebar + meta below; wired `GtkPaneEventBridge` (replaces `NoopPaneEventDispatcher`)
- **Verify:** `cargo build -p sispace-gtk`, `npm run verify:sispace-gtk4-phase4`

## Phase 5 — Harness tab ✅

**Goal:** Full GTK4 harness management panel (port of React `HarnessPanel`).

### Done

- `gtk-app/src/ui/harness/harness_panel.rs`: `GtkPaned` — section `GtkListBox` (Meta-readiness, Proposals, Accepted, Rejected, Patterns, Rollout, User Model, Reports) + detail `GtkTextView` (plain markdown text)
- Meta-readiness: `GtkProgressBar` per milestone from `hp_snapshot` / `parse_meta_readiness`
- Toolbar: Refresh (`build_snapshot`), Reflect (`spawn_reflect_chain`), Grade/Apply/Curate (`spawn_panel_script`), Doctor (`run_harness_doctor`)
- Background work via mpsc → `timeout_add_local` (no UI thread blocking)
- Reuses `sispace-core` `hp_snapshot.rs` parsing unchanged
- **Verify:** `cargo build -p sispace-gtk`, `npm run verify:sispace-gtk4-phase5`

## Phase 6 — SISwarm tab ✅

**Goal:** Full SISwarm workspace tab — VTE swarm panes, cairo graph, Obsidian blackboard; gate FSM unchanged in `sispace-core`.

### Done

- `sispace-core`: `launch_siswarm_for_vte` (`spawn_for_vte` for coordinator/workers/verifier/synthesizer); `launch_siswarm` unchanged for Tauri
- `gtk-app/src/ui/siswarm/`: horizontal `GtkPaned` — left `DrawingArea` visualizer (role nodes, green/grey gates, dashed gate edges, click → focus pane) + read-only `GtkTextView` blackboard; right `TerminalColumn` for swarm PTYs
- Toolbar: Launch / Refresh / Refresh blackboard / Clear; background `get_state` / launch / blackboard via mpsc → `timeout_add_local`
- `GtkPaneEventBridge::attach_siswarm` polls `siswarm:gate-unlocked`, `swarm:worker-complete`, etc., refreshes graph state
- Gate unlock / inject blocking: `apply_gate_unlocks` + `PaneManager::gate_locked` in core (no GTK duplication)
- **Verify:** `cargo build -p sispace-gtk`, `npm run verify:sispace-gtk4-phase6`

## Phase 7 — Remove web stack ✅

**Goal:** Retire Tauri/React; ship GTK4 binary packaging and workspace presets dialog.

### Done

- Removed `src/`, `src-tauri/`, `vite.config.ts`, `index.html`, root `tsconfig.json`; stripped React/Tauri from root `package.json`
- Workspace members: `sispace-core`, `gtk-app` only
- `gtk-app/src/ui/presets_dialog.rs`: `AdwDialog` + `GtkListBox` — list/apply/save/delete via `sispace-core` `workspace` service + SQLite `workspace_presets`
- `scripts/package-gtk.sh`: `cargo build --release -p sispace-gtk` → `dist/sispace-gtk-<version>`
- `packaging/PKGBUILD`: gtk4, libadwaita, vte4; in-tree `cargo build --release -p sispace-gtk` (no AppImage/npm web build)
- **Verify:** `cargo build -p sispace-gtk`, `npm run verify:sispace-gtk4-phase7`
