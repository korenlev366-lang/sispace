### ACCEPTED-20260605-GTK-LAZY-TABS:: GTK4 lazy tab finish_layout and smoke gate

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-LAZY-TABS-1780670833501)
- Reason: Heavy tab `finish_layout` during startup map causes GTK signal reentrancy stack overflows — defer until tab select via Stack placeholders + idle→timeout lazy mount; never gate layout on `is_visible()`; bisect with minimal `present()` shell before re-enabling tabs.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 lazy tab finish_layout and smoke gate (gtk-app)

- ✅ DO: Lazy-mount SISpace/SISwarm/SICanvas — Stack placeholders on `selected_page_notify`; chain `glib::idle_add_local_once` → `timeout_add_local_once` before `mount_lazy_tab_inner`; call `finish_layout` only when the tab is selected (per-slot `built`/`building` guards).
- ✅ DO: Bisect stack overflows with a minimal `present()`-only shell (no heavy tabs) before re-enabling lazy tab mounts — stub `finish_layout` per tab to isolate the offending pane.
- ✅ DO: Run `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle) as Ralph/CI ground truth after any `gtk-app/` tab-shell edit.
- ❌ AVOID: Gating `finish_layout` or lazy mount on `is_visible()` — selected-page notify fires before visibility settles and leaves tabs stuck on "Loading…". Eager-prebuilding all heavy tabs while TabView/window is mapped. Declaring tab-shell work complete from `cargo build -p sispace-gtk` alone without smoke.
- 💡 WHY: GDB bisect shows identical libgtk-4 frames from signal recursion during eager tab attach, not shallow Rust thread stack depth. Cross-link: ACCEPTED-20260605-GTK-MAP-001, ACCEPTED-20260605-GTK-TAB-STABILITY, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PENDING-20260605-GTK-REENTRANCY.

- Verification evidence: `grep -q 'install_lazy_tabs' gtk-app/src/main.rs`; `grep -q 'timeout_add_local_once' gtk-app/src/main.rs`; `! grep -rq 'is_visible' gtk-app/src`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-LAZY-TABS' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when editing lazy tab mount, `finish_layout`, stack-overflow bisect, or smoke verify workflows.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`
