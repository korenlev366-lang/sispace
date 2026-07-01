### ACCEPTED-20260605-GTK-TAB-IDLE:: GTK4 tab stack-overflow diagnosis and staged idle deferral

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-TAB-IDLE-1780671068984)
- Reason: GDB bisect on session 88c27d55 showed identical libgtk-4 frames and stack overflow even at 128MB `stack_size` — diagnosis is signal reentrancy during tab attach, not shallow Rust thread stack. Fix pattern: stub `finish_layout` per tab to bisect; defer container child clear/append and ListBox populate via staged `glib::idle_add_local_once` after attach (not inside realize/selection handlers); guard ListBox rebuild with `SelectionMode::None` and deferred `Single`. Gate merges on `SISPACE_GTK_SMOKE` tab cycle.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-TAB-IDLE from harness/memory/accepted-lessons.md and remove PATTERN-20260605-GTK-TAB-IDLE from reasoning-patterns.md if present.
- Applied change:

## [2026-06-05] Task: GTK4 tab stack-overflow diagnosis and staged idle deferral (gtk-app)

- ✅ DO: Bisect stack overflows by stubbing `finish_layout` (or `finish_mount`) per tab — restore tabs one at a time from a minimal `present()` shell to isolate the offending pane (SISpace SessionSidebar, SICanvas tab list, etc.).
- ✅ DO: Treat identical GDB libgtk-4 frames + overflow at 128MB `stack_size` as **signal reentrancy**, not insufficient Rust thread stack — do not remove idle/defer workarounds without this proof. Cross-link: ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE.
- ✅ DO: Defer all container child clear/append and ListBox populate via **staged** `glib::idle_add_local_once` **after** tab/widget attach — never synchronously inside `finish_layout`, `realize`, or TabView `selected-page` handlers. Mirror `session_sidebar.rs` (nested idle after row inserts) and `harness_panel.rs` (idle after map before `rebuild_right_pane`).
- ✅ DO: Guard ListBox selection during rebuild — start `SelectionMode::None`, set `in_rebuild` `Cell<bool>`, skip `row-selected` while rebuilding, restore `SelectionMode::Single` on a deferred idle (not synchronously at end of populate). Apply to Harness section/entry lists, SessionSidebar, and SICanvas tab list.
- ✅ DO: Run `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle printing `SISPACE_GTK_SMOKE_OK`) after any `gtk-app/` tab-shell or ListBox rebuild edit — not `cargo build` alone.
- ❌ AVOID: Synchronous `list.remove_all()` / `append()` / `select_row()` during first map or inside `finish_layout` idle callbacks that are still nested in a GTK emission.
- ❌ AVOID: Restoring `SelectionMode::Single` synchronously at the end of ListBox populate — re-triggers `row-selected` during the same rebuild emission.
- ❌ AVOID: Diagnosing tab overflow as "need bigger stack" when GDB shows thousands of identical libgtk frames — raising `GTK_STACK_BYTES` is adjunct only, not a substitute for staged idle deferral.
- 💡 WHY: Session 88c27d55 per-tab stub bisect isolated SISpace SessionSidebar ListBox populate and container mount as crash loci; 128MB stack still overflowed with identical libgtk backtrace, confirming reentrancy. Cross-link: ACCEPTED-20260605-GTK-LAZY-TABS, ACCEPTED-20260605-GTK-REENTRANCY-001, ACCEPTED-20260605-GTK-SYNC, PATTERN-20260605-GTK-TAB-IDLE, PATTERN-20260605-154318.

- Verification evidence: `grep -q 'GTK_STACK_BYTES' gtk-app/src/main.rs`; `grep -q 'SelectionMode::None' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'SelectionMode::None' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'in_rebuild' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'finish_layout' gtk-app/src/ui/siswarm/siswarm_tab.rs`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-TAB-IDLE' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when diagnosing tab stack overflow, bisecting `finish_layout`, deferring container/ListBox mutations, or gating with SISPACE_GTK_SMOKE workflows.
- Recall globs: `**/gtk-app/**`, `**/session_sidebar.rs`, `**/harness_panel.rs`, `**/canvas_tab.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`
