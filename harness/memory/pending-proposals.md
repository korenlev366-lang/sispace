# Pending Improvement Proposals

Pending proposals are inactive. They do not change rules, skills, commands, hooks, MCP, memory, or docs until a grading result accepts them and the user-approved apply path runs.

## Entry Requirements

Each pending proposal must include:
- Proposal ID:
- Source task:
- Evidence:
- Proposed change:
- Target layer:
- Expected benefit:
- Risk:
- Backtests needed:
- Date proposed:
- Status: pending

## Template

```markdown
### PENDING-YYYYMMDD-001: [Short Title]

- Proposal ID:
- Source task:
- Evidence:
- Proposed change:
- Target layer:
- Expected benefit:
- Risk:
- Backtests needed:
- Date proposed:
- Status: **applied** 2026-06-04 (harness panel apply-all)
- Notes:
```

## Entries
- Grading decision: accept with human review
### PENDING-CURATE-GNUCLIENT-SKILLS: GNUClient vs RainClient skill drift

- Proposal ID: PENDING-CURATE-GNUCLIENT-SKILLS
- Source task: harness-curate session 6637b8ce-82dd-4757-8bef-cb328c31b855
- Evidence: Active work in GNUClient/client; rainclient-dev/combat-parity pointed at RainClient native paths
- Proposed change: Add gnuclient-dev; dual-stack front matter in rainclient-dev; GNUClient section in combat-parity; jni cross-link
- Target layer: skills
- Expected benefit: Agents pick correct build path and references without Rain-only defaults
- Risk: Stale dual-stack table if third stack added
- Backtests needed: Agent smoke on GNUClient task uses gnuclient-dev (manual)
- Date proposed: 2026-06-03
- Status: **applied** 2026-06-03 (grade 81, accept with human review)
- Grading decision: accept with human review
- Rollback note: Remove gnuclient-dev; revert rainclient-dev, combat-parity, jni-hot-path-review SKILL.md from git

### PENDING-CURATE-MEMORY-DISTILL: Accepted-lessons template alignment (revised)

- Proposal ID: PENDING-CURATE-MEMORY-DISTILL
- Source task: harness-curate session 6637b8ce-82dd-4757-8bef-cb328c31b855; re-grade 2026-06-03
- Evidence: `accepted-lessons.md` Required Fields mismatch vs live ACCEPTED/PENDING entry fields (Scope, Verification evidence, etc.)
- Proposed change: Update only `## Required Fields` and `## Template` in `harness/memory/accepted-lessons.md`. No pattern deletion; no user-model edits.
- Target layer: memory
- Expected benefit: Consistent schema for reflection/grade agents; memory auto-apply eligible
- Risk: None for recall — no reasoning-patterns changes
- Backtests needed: template lists Scope and Verification evidence; grep field lines on entries
- Date proposed: 2026-06-03
- Status: **applied** 2026-06-03 (grade 86, accept with human review)
- Grading decision: accept with human review
- Rollback note: Revert accepted-lessons.md template section from git
- Verification evidence: `grep -q 'Applied change:' harness/memory/accepted-lessons.md`; `grep -q 'Verification evidence:' harness/memory/accepted-lessons.md`
- Supersedes bundled scope: see REJECTED-20260603-001

### PENDING-CURATE-PROJECT-RULES-SKILLS-TABLE: Rules skill table alignment

- Proposal ID: PENDING-CURATE-PROJECT-RULES-SKILLS-TABLE
- Source task: harness-curate session 6637b8ce
- Evidence: project-skills-and-references.mdc Rain-only; missing harness-workflow and GNUClient rows
- Proposed change: Update always-applied rule table and GNUClient/Rain convention sections
- Target layer: rules
- Expected benefit: Discoverability of primary stack and harness-workflow
- Risk: Always-applied rule token growth (bounded)
- Backtests needed: none
- Date proposed: 2026-06-03
- Status: **applied** 2026-06-03 (grade 87, accept with human review)
- Grading decision: accept with human review
- Rollback note: Revert project-skills-and-references.mdc from git

### PENDING-CURATE-SUPERPOWERS-TRIM: Archive git-only superpowers (revised)

- Proposal ID: PENDING-CURATE-SUPERPOWERS-TRIM
- Source task: harness-curate session 6637b8ce-82dd-4757-8bef-cb328c31b855; re-grade 2026-06-03
- Evidence: Workspace is not a git repo; `using-git-worktrees` and `finishing-a-development-branch` are never applicable; orchestration covered by `harness-workflow` and `60-agent-orchestration.mdc`
- Proposed change: (1) Move only `.agents/skills/using-git-worktrees/` and `.agents/skills/finishing-a-development-branch/` to `archive/skills/superpowers-git/`. (2) Add `.agents/skills/superpowers-scope.md` with explicit keep list and note not to invoke archived git skills here.
- Target layer: skills
- Expected benefit: Stops git-worktree guidance on a non-git tree
- Risk: Plugin cache may still list global superpowers paths (documented, not blocked)
- Backtests needed: `test ! -d .agents/skills/using-git-worktrees`; `test -f .agents/skills/superpowers-scope.md`
- Date proposed: 2026-06-03
- Status: **applied** 2026-06-03 (grade 83, accept with human review)
- Grading decision: accept with human review
- Rollback note: `mv archive/skills/superpowers-git/* .agents/skills/`; remove superpowers-scope.md
- Verification evidence: `test ! -d .agents/skills/using-git-worktrees`; `test -f .agents/skills/superpowers-scope.md`; `test -d archive/skills/superpowers-git/using-git-worktrees`
- Supersedes bundled scope: see REJECTED-20260603-002, REJECTED-20260603-003

### PENDING-CURATE-UI-UX-DEDUPE: Remove duplicate UI skill bundle

- Proposal ID: PENDING-CURATE-UI-UX-DEDUPE
- Source task: harness-curate session 6637b8ce
- Evidence: ui-ux-pro-max-skill ~16M vs ui-ux-pro-max ~652K; duplicate name
- Proposed change: Archive ui-ux-pro-max-skill to archive/skills/; keep slim ui-ux-pro-max
- Target layer: skills
- Expected benefit: Repo and discovery cost reduction
- Risk: Loss of full design bundle if still needed for web work
- Backtests needed: du -sh paths; agent no longer discovers archived path
- Date proposed: 2026-06-03
- Status: **applied** 2026-06-03 (grade 90, accept with human review)
- Grading decision: accept with human review
- Rollback note: `mv archive/skills/ui-ux-pro-max-skill .agents/skills/ui-ux-pro-max-skill`

### PENDING-LAGRANGE-AC-CHECKLIST: 

- Target layer: skills
- Summary: Extend `.agents/skills/combat-parity/SKILL.md` with a Raven-only lag-module anticheat checklist: (1) grep audit for per-tick multi-packet drain paths, (2) C03-only queue vs mixed outbound tradeoffs, (3) tick-capped release constants, (4) mandatory pre-C02 drain, (5) self-S12 velocity abort, (6) staggered post-combat flush—sourced from session 6637b8ce Grim Simulation x1–x7 and Vulcan Speed flag cycles after user mandated Raven-only lag references.
- Date: 2026-06-03
- Status: **applied** 2026-06-19 (verified present in skill file, closed manually)
- Grading decision: accept with human review
### PROP-20250603-004: Pending revision

- Target layer: memory
- Summary: Add a durable verify/memory rule: SISpace pipeline runtime is package.json `node-host` → lib/node-server.mjs → lib/pipeline-run.mjs (spawned by node_host.rs); any pipeline SSE, model-split, or OOM fix must edit lib/ and be asserted in tests/pipeline-model.test.mjs — changes to scripts/pipeline-lib.mjs alone do not affect the running sidecar and caused a verified user regression in this session.
- Date: 2026-06-03
- Status: **applied** 2026-06-04 (harness panel apply-all)
- Grading decision: accept with human review
### PROP-20250603-007: Pending revision

- Target layer: skill
- Summary: Extend researcher-agent (or feature-research skill) with a bundled-UI checklist: for multitask/concurrency requests grep backend active-pipeline state and frontend panel/selection state separately and document both in findings; for virtualizer overlap hypotheses always cite estimateSize, measureElement ref, positioning mode, and remeasure triggers in one finding block.
- Date: 2026-06-03
- Status: **applied** 2026-06-05 (manual — researcher-agent.md checklist)
- Verification evidence: `grep -q 'Bundled-UI research checklist' .cursor/agents/researcher-agent.md`
- Grading decision: accept with human review
### PROP-20250603-008: Pending revision

- Target layer: docs
- Summary: Add a SISpace pipeline operator section to README.md (or SISPACE_PLAN.md) documenting the live Node runtime map (node_host.rs spawns lib/node-server.mjs → lib/pipeline-run.mjs, not scripts/), the slim SSE contract (step_content for DB only; metadata-only step_done to webview), the requirement that cargo build --release include default custom-protocol to avoid localhost:1420, and a restart checklist (full quit, npm run build, cargo build --release) after pipeline or UI fixes.
- Date: 2026-06-03
- Status: **applied** 2026-06-04 (harness panel apply-all)
- Grading decision: accept with human review
### PROP-20260604-001: Pending revision

- Target layer: skill
- Summary: Add a gtk-app / Rust-GTK workflow rule: before importing gtk4-rs or libadwaita prelude traits, grep the installed crate's prelude.rs and auto/*.rs under ~/.cargo/registry; use inherent widget methods when no extension trait exists; never use gtk::prelude::* when adw::prelude::* is in scope—import only required traits (BoxExt, ButtonExt, WidgetExt, etc.); enable version features in gtk-app/Cargo.toml (e.g. libadwaita v1_5 for AdwDialog) before using version-gated APIs.
- Date: 2026-06-04
- Status: **applied** 2026-06-19 (verified present in skill file, closed manually)
- Grading decision: accept with human review
### PENDING-20260605-PIPE-RUNTIME: Pending revision

- Target layer: memory
- Summary: Add a scoped memory/accepted-lesson entry: Tauri pipeline sidecar runtime is lib/node-server.mjs → lib/pipeline-run.mjs (sispace-core node_host.rs), not scripts/pipeline-lib.mjs. Require tracing node_host spawn path before any pipeline SSE/emit fix; recall globs **/lib/pipeline-run.mjs, **/lib/node-server.mjs, **/pipeline_client.rs, **/node_host.rs.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review

### PROPOSAL-20260605-GTK-DEFER-PRESENT: Pending revision

- Target layer: memory
- Summary: Add accepted-lesson-style memory (scope: gtk-app/) documenting libadwaita launch invariant: never map TabView/TabBar.set_view during initial ApplicationWindow.present(); present a minimal shell first, init AppState on a background thread via mpsc (Send-only), then build TabView/tabs on GTK thread inside idle_add_local_once → timeout_add_local; clone Rc per glib closure.
- Date: 2026-06-05
- Status: inactive pending revision

### PROPOSAL-20260605-GTK-TABVIEW-STARTUP: Pending revision

- Target layer: memory
- Summary: Add a project-local accepted lesson for sispace-gtk GTK4 startup: (1) never build/attach heavy TabView children inside timeout callbacks or while peer tabs are mapped; use idle → off-tree build → timeout attach chain; (2) harness ListBox must start SelectionMode::None with in_rebuild guard; (3) background init uses mpsc + Arc<AppState> only — never thread::spawn with Rc/GTK weak refs; (4) graceful_shutdown kills pane_manager children only, not legacy terminals SQLite sweep.
- Date: 2026-06-05
- Status: inactive pending revision
- Grading decision: accept with human review
### PENDING-20260605-SISPACE-RUNTIME-PATH: Pending revision

- Target layer: memory
- Summary: Add accepted-lesson stub: Tauri node sidecar executes lib/pipeline-run.mjs (via lib/node-server.mjs), not scripts/pipeline-lib.mjs. Pipeline fixes and regression tests must target lib/; document restart requirement for child node-server reload.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-MAP-001: Pending revision

- Target layer: memory
- Summary: Add a project-local accepted-lesson for sispace-gtk: GTK4 stack overflows during startup/tab attach are usually main-loop reentrancy (sync set_content in timeout handlers, ListBox Single selection firing rebuild on first map, eager VTE char_size_changed loops). Fix pattern: idle-defer shell install and tab attach, SelectionMode::None until post-map idle with in_rebuild guard, lazy-load VTE tabs on selection, and always pair map-deferral fixes with initial refresh_snapshot() so data panels are not left empty.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PROP-20260605-GTK-TAB-STABILITY: Pending revision

- Target layer: memory
- Summary: Add an accepted-lessons or reasoning-pattern entry: GTK4 sispace-gtk tab shell checklist — TabKeepalive for Rc controllers, lazy visible mount for SISpace/SISwarm/SICanvas, refresh_snapshot after Harness map, defer ListBox selection, prefer MainTabs ToggleButton strip over AdwTabBar when icon-theme recursion appears, and always run sh harness/scripts/verify-sispace-gtk-app.sh after tab-shell edits.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-LAZY-TABS: Pending revision

- Target layer: memory
- Summary: Add scoped accepted-lesson for gtk-app: defer heavy tab finish_layout until tab select via lazy mount + timeout; never gate layout on is_visible(); bisect stack overflows with minimal present shell before re-enabling tabs; use harness/scripts/verify-sispace-gtk-app.sh (SISPACE_GTK_SMOKE=1) as Ralph/CI ground truth.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PROP-20260605-PIPELINE-RUNTIME-PATH: Pending revision

- Target layer: memory
- Summary: Add accepted-lesson: SISpace pipeline sidecar fixes must patch lib/pipeline-run.mjs (spawned by node_host.rs as lib/node-server.mjs), not only scripts/pipeline-lib.mjs; extend tests/pipeline-model.test.mjs to statically assert lib/pipeline-run.mjs slim SSE wiring (step_content, no result on step_done, no steps blob on pipeline_done).
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-SYNC: Pending revision

- Target layer: memory
- Summary: Accepted lesson: GTK4 bidirectional selection sync (TabView, ListBox, VTE focus) requires centralized Cell<bool> reentrancy guards with guard reset deferred via glib::idle_add_local_once — never per-widget notify loops or synchronous guard clear inside callbacks.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-SYNC-001: Pending revision

- Target layer: memory
- Summary: Add a project-local accepted lesson: when AdwTabView and ToggleButton stay in sync, never call set_active or set_selected_page synchronously inside selected-page notify or toggled handlers — use a shared Rc<Cell<bool>> syncing guard and defer every cross-widget update with glib::idle_add_local_once; pair with try_borrow_mut skips on shared Rc<RefCell> state and debounce lazy tab mounts that call set_visible_child_name. Complement with a recall note that pipeline sidecar runtime is lib/pipeline-run.mjs (via node_host.rs), not scripts/pipeline-lib.mjs alone.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-REENTRANCY-001: Pending revision

- Target layer: memory
- Summary: Add ACCEPTED lesson for sispace-gtk GTK4 reentrancy: never reset Cell<bool> guards synchronously at the end of signal handlers that mutate ListBox/TabView/VTE widgets — defer clear via glib::idle_add_local_once; use try_borrow in connect_clicked; guard GtkPaneEventBridge::start_loop with a started Cell to prevent duplicate IPC poll timeouts.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-OVERFLOW-ROOTCAUSE: Pending revision

- Target layer: memory
- Summary: Add recall guidance: before removing GTK idle/defer workarounds for 'small Rust thread stack', prove root cause—if stack_size 32–128MB still overflows with libgtk backtrace, keep deferred TabView/Stack mounting and async guard resets; use finish_layout stub binary-search plus SISPACE_GTK_SMOKE tab cycle as merge gate (not cargo build alone). Complements existing lib/ pipeline-runtime lesson.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
### PENDING-20260605-GTK-TAB-IDLE: Pending revision

- Target layer: memory
- Summary: Add accepted-lesson or reasoning-pattern entry for GTK4 tab stack-overflow diagnosis: stub finish_layout per tab to bisect; treat identical GDB libgtk frames + 128MB overflow as signal reentrancy; defer all container child clear/append and ListBox populate via staged glib::idle_add_local_once after attach; guard ListBox selection during rebuild (SelectionMode::None → deferred Single). Scope to gtk-app/** and SISPACE_GTK_SMOKE workflows.
- Date: 2026-06-05
- Status: **applied** 2026-06-05 (harness panel apply-all)
- Grading decision: accept with human review
- Rollback note: Delete ACCEPTED-20260605-GTK-TAB-IDLE from harness/memory/accepted-lessons.md and PATTERN-20260605-GTK-TAB-IDLE from reasoning-patterns.md if present.
