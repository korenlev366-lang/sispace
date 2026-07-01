### ACCEPTED-20260605-GTK-TAB-STABILITY:: GTK4 sispace-gtk tab shell checklist

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20260605-GTK-TAB-STABILITY-1780670800736)
- Reason: Consolidated tab-shell stabilization checklist from session 88c27d55 — cross-links ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, and PATTERN-20260605-113214 without duplicating parallel GTK memory fragments.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 sispace-gtk tab shell checklist

- ✅ DO: Retain `Rc<TabController>` in `TabKeepalive` (`LazyTabSlot.keepalive`) for every lazy-loaded tab — widgets alone do not keep IPC bridges, background polls, or CDP state alive.
- ✅ DO: Lazy visible mount for SISpace/SISwarm/SICanvas — Stack placeholders on `selected_page_notify`; build/finish_layout only when the tab is selected (never eager-prebuild all heavy tabs while TabView is mapped).
- ✅ DO: Call `refresh_snapshot()` (or `ensure_snapshot_loaded()`) on first Harness panel map idle — pair every map-deferral fix with an initial data load so rollouts/proposals are not left empty.
- ✅ DO: Defer ListBox selection — start Harness sidebar with `SelectionMode::None`; defer initial `rebuild_right_pane` to post-map idle; guard with `in_rebuild`; enable `SelectionMode::Single` only after the deferred first rebuild.
- ✅ DO: Prefer `MainTabs` custom ToggleButton strip over `AdwTabBar` when GDB shows `gtk_icon_theme_lookup` recursion during first window map.
- ✅ DO: After any tab-shell edit in `gtk-app/`, run `sh harness/scripts/verify-sispace-gtk-app.sh` before declaring complete.
- ❌ AVOID: Storing only `tab.widget().clone()` without `TabKeepalive` (controller drop → tab crash on select). Eager VTE/CDP tab prebuild during startup map. `AdwTabBar` during initial present when icon-theme recursion appears. Synchronous `select_row` / pane rebuild during first ListBox map without deferral guards.
- 💡 WHY: Session 88c27d55 bisect isolated stack overflow, empty Harness rollouts, and SISpace/SICanvas lazy-select crashes to these six invariants. Cross-link: ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PENDING-20260605-GTK-REENTRANCY, PATTERN-20260605-113214.

- Verification evidence: `grep -q 'ACCEPTED-20260605-GTK-TAB-STABILITY' harness/memory/accepted-lessons.md`; `grep -q 'TabKeepalive' harness/memory/accepted-lessons.md`; `grep -q 'verify-sispace-gtk-app.sh' harness/memory/accepted-lessons.md`; `grep -q 'MainTabs' harness/memory/accepted-lessons.md`.
- Scope: **sispace-gtk project-local** — recall when editing GTK4 tab shell, lazy mount, harness sidebar, or MainTabs strip.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/harness_panel.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/verify-sispace-gtk-app.sh`
