### ACCEPTED-20260605-GTK-REENTRANCY-001:: GTK4 Cell<bool> guard reset and IPC poll idempotency

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-REENTRANCY-001-1780670981855)
- Reason: GTK4 ListBox/TabView/VTE signal handlers that mutate widgets during selection or focus callbacks recurse through libgtk when `Rc<Cell<bool>>` guards are cleared synchronously before GTK finishes the current emission — defer every guard reset via `glib::idle_add_local_once`; `connect_clicked` handlers that touch `RefCell` state during `finish_layout` need `try_borrow`/`try_borrow_mut` skips; `GtkPaneEventBridge::start_loop` must be idempotent behind a `started` `Cell<bool>` to avoid duplicate IPC poll timeouts.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-REENTRANCY-001 from harness/memory/accepted-lessons.md and any Obsidian mirror; revert gtk-app guard patterns only if a simpler GTK API (e.g. AdwTabView blocking signals) supersedes them.
- Applied change:

## [2026-06-05] Task: GTK4 Cell<bool> guard reset and IPC poll idempotency (sispace-gtk)

- ✅ DO: Reset every `Rc<Cell<bool>>` reentrancy guard (`in_rebuild`, `sync_guard`, `syncing`, `in_sync`, `initializing`) via nested `glib::idle_add_local_once` — never `guard.set(false)` synchronously at the end of `row-selected`, `selected_page_notify`, `connect_toggled`, `char_size_changed`, or pane-rebuild callbacks that mutate ListBox/TabView/VTE widgets.
- ✅ DO: In `connect_clicked` handlers wired during `finish_layout` (presets/spawn/refresh buttons), prefer `try_borrow` / `try_borrow_mut` on shared `Rc<RefCell<…>>` state and skip the update when already borrowed — avoids RefCell panic/reentrancy during the same GTK emission.
- ✅ DO: Guard `GtkPaneEventBridge::start_loop` with a `started: Rc<Cell<bool>>` — early-return when `started.get()` is true before scheduling the `timeout_add_local` IPC poll loop; set `started` before registering the timeout so `attach`/`attach_siswarm` cannot spawn duplicate poll timers.
- ✅ DO: Apply async guard reset to VTE `char_size_changed` ↔ resize paths (`in_sync` guard + idle-deferred clear in `terminal_column.rs`) and Harness/session ListBox rebuild paths (`in_rebuild` + nested idle clear in `harness_panel.rs`, `session_sidebar.rs`, `canvas_tab.rs`).
- ❌ AVOID: Synchronous `guard.set(false)` at the end of any handler that clears/appends ListBox rows, swaps TabView pages, or resizes VTE panes — peer handlers fire again before GTK internal state settles and overflow the stack.
- ❌ AVOID: Calling `GtkPaneEventBridge::attach` from multiple tabs without `started` idempotency — duplicate `timeout_add_local` loops double-dispatch IPC events and can panic on `RefCell` borrow during layout init.
- ❌ AVOID: `borrow_mut()` inside `connect_clicked` during tab `finish_layout` when the same `RefCell` may already be borrowed from a parent signal handler — use `try_borrow_mut` and return early instead.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from synchronous guard reset in selection callbacks and RefCell borrow panics in `connect_clicked` during `finish_layout`; `gtk_events.rs` duplicate poll timeouts compounded IPC dispatch during tab attach. Cross-link: PENDING-20260605-GTK-REENTRANCY (async guard reset amendment), ACCEPTED-20260605-GTK-SYNC, ACCEPTED-20260605-GTK-SYNC-001, ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE.

- Verification evidence: `grep -q 'started' gtk-app/src/gtk_events.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/terminal_column.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/canvas/canvas_tab.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-REENTRANCY-001' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app project-local** — recall when editing ListBox/TabView/VTE signal handlers, tab `finish_layout` button wiring, or IPC event bridge lifecycle.
- Recall globs: `**/gtk-app/**`, `**/gtk_events.rs`, `**/harness_panel.rs`, `**/session_sidebar.rs`, `**/terminal_column.rs`, `**/canvas_tab.rs`, `**/sispace_tab.rs`, `**/main.rs`
