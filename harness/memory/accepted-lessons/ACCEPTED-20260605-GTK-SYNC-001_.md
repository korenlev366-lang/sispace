### ACCEPTED-20260605-GTK-SYNC-001:: AdwTabView↔ToggleButton sync and pipeline runtime recall

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-SYNC-001-1780670947546)
- Reason: AdwTabView and ToggleButton bidirectional sync must never call `set_active` or `set_selected_page` synchronously inside `selected_page_notify` or `connect_toggled` handlers — shared `Rc<Cell<bool>>` guard plus `glib::idle_add_local_once` deferral prevents libgtk signal recursion; lazy Stack mounts that call `set_visible_child_name` need per-slot `building`/`built` guards and idle/timeout debounce; shared `Rc<RefCell>` state in the same emission path should use `try_borrow_mut` skips. Pipeline sidecar runtime is `lib/pipeline-run.mjs` (via `node_host.rs`), not `scripts/pipeline-lib.mjs` alone.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-SYNC-001 from harness/memory/accepted-lessons.md and any Obsidian mirror; remove gtk-app sync/debounce bullets if a future TabView API supersedes manual guard deferral.
- Applied change:

## [2026-06-05] Task: AdwTabView↔ToggleButton sync guards and pipeline runtime recall

- ✅ DO: Keep AdwTabView and ToggleButton strip in sync behind one shared `Rc<Cell<bool>>` guard (`MainTabs::syncing`) — early-return when the guard is set; defer every `set_active` and `set_selected_page` via `glib::idle_add_local_once`; reset the guard in a nested `idle_add_local_once` after GTK finishes the current emission.
- ✅ DO: On shared `Rc<RefCell<…>>` state touched from signal handlers (strip buttons, lazy tab slots, keepalives), prefer `try_borrow_mut` and skip the update when already borrowed — avoids panic/reentrancy during the same notify emission.
- ✅ DO: Debounce lazy tab mounts that call `set_visible_child_name` — use per-slot `building`/`built` guards plus idle/timeout chains (`idle_add_local_once` → `timeout_add_local_once`) so Stack placeholder→content swaps never run synchronously inside `selected_page_notify`.
- ❌ AVOID: Synchronous `set_active` or `set_selected_page` inside `connect_selected_page_notify` or `connect_toggled` callbacks — peer handlers recurse through libgtk and overflow the stack.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` for pipeline SSE/emit fixes — Tauri spawns `lib/node-server.mjs` → `lib/pipeline-run.mjs` via `sispace-core/src/services/node_host.rs`; `scripts/` helpers are not the live sidecar entry.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from bidirectional TabView↔strip notify recursion and synchronous Stack `set_visible_child_name` during lazy mount; pipeline fix-then-regress traced to editing `scripts/` while the sidecar runs `lib/`. Cross-link: ACCEPTED-20260605-GTK-SYNC, PENDING-20260605-GTK-SYNC-SCOPE, PENDING-20260605-GTK-REENTRANCY, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, ACCEPTED-20260605-PIPE-RUNTIME, [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'syncing' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'set_visible_child_name' gtk-app/src/main.rs`; `grep -q 'building' gtk-app/src/main.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'ACCEPTED-20260605-GTK-SYNC-001' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app + SISpace project-local** — recall when editing TabView strip sync, lazy Stack tab mounts, or pipeline sidecar/SSE wiring.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/node_host.rs`, `**/scripts/pipeline-lib.mjs`
