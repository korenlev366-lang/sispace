### ACCEPTED-20260605-GTK-SYNC:: GTK4 bidirectional selection sync guards

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-SYNC-1780670908765)
- Reason: GTK4 bidirectional selection sync (TabView, ListBox, VTE focus) requires centralized Rc<Cell<bool>> reentrancy guards with guard reset deferred via glib::idle_add_local_once — per-widget notify loops or synchronous guard clear inside callbacks recurse through libgtk signal handlers and cause stack overflow.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md and any Obsidian mirror; revert gtk-app guard patterns only if a simpler GTK API (e.g. AdwTabView blocking signals) supersedes them.
- Applied change:

## [2026-06-05] Task: GTK4 bidirectional selection sync (TabView, ListBox, VTE focus)

- ✅ DO: Centralize bidirectional TabView↔ToggleButton sync behind one shared `Rc<Cell<bool>>` guard (`MainTabs::syncing`) — set the guard before cross-widget updates; defer every `set_selected_page` / `set_active` via `glib::idle_add_local_once`; reset the guard in a nested `idle_add_local_once` after GTK finishes the current emission.
- ✅ DO: Apply the same centralized guard + idle-deferred reset to ListBox row-selected ↔ VTE focus paths (`SispaceUi::sync_guard` in `focus_pane`, `on_pane_spawned`, `on_pane_exited`; `session_sidebar.rs` `in_rebuild`; `terminal_column.rs` VTE resize guards).
- ✅ DO: Keep sync flags scoped to bidirectional UI sync only — never gate unrelated deferred tab loaders on `is_syncing()` (use per-slot `building`/`built` guards for lazy mount instead).
- ❌ AVOID: Per-widget notify loops where TabView, ToggleButton, and ListBox each install independent bidirectional handlers without a shared guard — causes recursive signal re-entry and libgtk stack overflow.
- ❌ AVOID: Synchronous `guard.set(false)` at the end of `selected_page_notify`, `connect_toggled`, or `row-selected` callbacks — peer handlers fire again before GTK internal state settles.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from bidirectional notify recursion during tab select and ListBox↔VTE focus sync. Cross-link: PENDING-20260605-GTK-REENTRANCY (async guard reset), PENDING-20260605-GTK-SYNC-SCOPE (sync-flag scope), PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PATTERN-20260605-113214, PATTERN-20260605-121542.

- Verification evidence: `grep -q 'sync_guard' gtk-app/src/ui/sispace/sispace_ui.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/sispace_ui.rs`; `grep -q 'syncing' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-SYNC' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app project-local** — recall when editing TabView strip sync, ListBox selection, VTE focus, or pane sidebar coordination.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_ui.rs`, `**/session_sidebar.rs`, `**/terminal_column.rs`, `**/canvas_tab.rs`
