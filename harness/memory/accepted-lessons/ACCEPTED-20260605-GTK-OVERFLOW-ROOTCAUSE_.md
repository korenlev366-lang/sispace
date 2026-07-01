### ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE:: GTK stack-overflow root-cause proof before removing deferrals

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-OVERFLOW-ROOTCAUSE-1780671023379)
- Reason: GDB bisect on session 88c27d55 showed identical libgtk-4 frames and stack overflow even with `stack_size` raised to 32–128MB — the failure is GTK signal reentrancy, not shallow Rust thread stack depth. Before removing idle/defer workarounds, prove root cause; if overflow persists with libgtk backtrace at high stack_size, retain deferred TabView/Stack mounting and async guard resets. Merge gate is `finish_layout` stub binary-search plus `SISPACE_GTK_SMOKE` tab cycle, not `cargo build` alone.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE from harness/memory/accepted-lessons.md and any Obsidian mirror.
- Applied change:

## [2026-06-05] Task: GTK stack-overflow root-cause proof before removing deferrals (gtk-app)

- ✅ DO: Before removing any GTK idle/defer workaround attributed to "small Rust thread stack", prove root cause — reproduce with GDB backtrace and try `stack_size` at 32MB–128MB (`gtk-app/src/main.rs` `GTK_STACK_BYTES`); if overflow still shows identical libgtk frames, treat it as signal reentrancy, not stack depth.
- ✅ DO: When libgtk backtrace persists at high `stack_size`, keep deferred TabView/Stack mounting (`idle_add_local_once` → `timeout_add_local_once` lazy mount) and async `Rc<Cell<bool>>` guard resets — do not revert to synchronous `finish_layout`, `set_visible_child_name`, or `guard.set(false)` in selection callbacks.
- ✅ DO: Bisect offending tab/pane by stubbing `finish_layout` per tab (minimal `present()` shell first) before re-enabling heavy layout paths.
- ✅ DO: Gate tab-shell merges on `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle printing `SISPACE_GTK_SMOKE_OK`) — not `cargo build -p sispace-gtk` alone.
- ❌ AVOID: Removing idle/defer workarounds because `cargo build` passes or because raising `stack_size` "should be enough" — GDB libgtk recursion survives 32–128MB stacks.
- ❌ AVOID: Declaring GTK tab-shell work complete without smoke tab cycle (Harness → SISpace → SISwarm → SICanvas) — static verify and compile gates miss runtime stack overflow on tab select.
- ❌ AVOID: Conflating GTK overflow diagnosis with pipeline spawn-path mistakes — trace `lib/pipeline-run.mjs` via `node_host.rs` for pipeline fixes; GTK deferrals are a separate reentrancy class. Cross-link: [pipeline-runtime.md](pipeline-runtime.md).
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from signal recursion during tab attach and guard reset, not insufficient Rust thread stack; the same session reproduced pipeline fix-then-regress from editing `scripts/` while the sidecar runs `lib/`. Cross-link: ACCEPTED-20260605-GTK-LAZY-TABS, ACCEPTED-20260605-GTK-REENTRANCY-001, ACCEPTED-20260605-GTK-SYNC, ACCEPTED-20260605-PIPELINE-RUNTIME-PATH, [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'GTK_STACK_BYTES' gtk-app/src/main.rs`; `grep -q 'stack_size' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'finish_layout' gtk-app/src/ui/siswarm/siswarm_tab.rs`; `grep -q 'finish_layout' gtk-app/src/ui/canvas/canvas_tab.rs`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when diagnosing stack overflow, removing GTK deferrals, or gating tab-shell merges.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`
