### ACCEPTED-20260605-GTK-MAP-001:: GTK4 startup/tab-attach stack overflow reentrancy

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-MAP-001-1780670763500)
- Reason: GTK4 stack overflows during sispace-gtk startup/tab attach are main-loop reentrancy, not shallow thread stack depth — sync widget mutations during first map recurse through libgtk-4 signal handlers.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 startup/tab-attach stack overflow reentrancy (sispace-gtk)

- ✅ DO: Idle-defer shell install and AdwTabView tab attach (`glib::idle_add_local_once` / timeout chains, not synchronous `set_content` inside timeout handlers). Start sidebar ListBox with `SelectionMode::None`; defer initial `rebuild_right_pane` (or equivalent pane swap) to post-map idle; guard rebuilds with `in_rebuild` `Cell<bool>`; enable `SelectionMode::Single` only after the deferred first rebuild. Lazy-load VTE-heavy tabs on first TabView selection (not eager prebuild while peer tabs are mapped). Guard VTE `char_size_changed` ↔ resize loops. Always pair map-deferral fixes with an initial `refresh_snapshot()` (or `ensure_snapshot_loaded()`) so Harness rollouts/proposals panels are not left empty.
- ❌ AVOID: Synchronous `set_content` / pane rebuilds inside timeout or selection callbacks during first map; `ListBox` `SelectionMode::Single` before post-map idle rebuild; eager VTE tab prebuild on startup; map-deferral without an initial data refresh.
- 💡 WHY: GDB bisect shows thousands of identical libgtk-4 frames — signal reentrancy during TabView/Stack lazy mount, not Rust thread stack size. Cross-link: PROP-20260605-GTK-HARNESS-MAP (ListBox deferral + `in_rebuild`), PROPOSAL-20260606-GTK-LAZY-KEEPALIVE (lazy tab + `TabKeepalive`), PENDING-20260605-GTK-REENTRANCY (async guard reset), PROP-20260605-GTK-VERIFY (mpsc + idle startup marshaling).

- Verification evidence: `grep -q 'SelectionMode::None' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'in_rebuild' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'refresh_snapshot\|ensure_snapshot_loaded' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-MAP-001' harness/memory/accepted-lessons.md`.
- Scope: **sispace-gtk project-local** — recall when editing GTK4 startup, tab attach, harness sidebar, or VTE pane layout.
- Recall globs: `**/gtk-app/**`, `**/harness_panel.rs`, `**/main.rs`, `**/terminal_column.rs`, `**/session_sidebar.rs`
