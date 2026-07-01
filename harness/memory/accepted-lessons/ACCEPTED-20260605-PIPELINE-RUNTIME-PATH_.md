### ACCEPTED-20260605-PIPELINE-RUNTIME-PATH:: Pipeline sidecar lib/ path and slim SSE contract

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20260605-PIPELINE-RUNTIME-PATH-1780670872524)
- Reason: Verified fix-then-regress when patching scripts/pipeline-lib.mjs while Tauri spawns lib/node-server.mjs → lib/pipeline-run.mjs; slim SSE (step_content for DB, metadata-only step_done, no steps on pipeline_done) must land on lib/ and be guarded by static tests.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md and Obsidian mirror; revert any added test assertions in tests/pipeline-model.test.mjs if they cause false failures.
- Applied change:

## [2026-06-05] Task: Pipeline sidecar lib/ path and slim SSE contract

- ✅ DO: Trace live spawn path before any pipeline fix — `sispace-core/src/services/node_host.rs` spawns `lib/node-server.mjs`, which imports `lib/pipeline-run.mjs` (`runPipelineStreaming`); patch `lib/pipeline-run.mjs` for SSE/emit/OOM behavior.
- ✅ DO: Keep slim SSE wiring on the active runtime — `step_content` carries truncated `result` for Rust DB storage; `step_done` is metadata-only (agent, index, status, backend — no `result`); `pipeline_done` carries status only (no `steps` blob).
- ✅ DO: Run `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — the `lib/pipeline-run wiring (static — active sidecar path)` suite must pass after any pipeline SSE fix.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` — shared helpers, not the live sidecar entry; edits there do not affect the running pipeline and cause verified user regressions.
- 💡 WHY: Session 88c27d55 reproduced OOM after an apparent scripts/-only fix; landing truncation and step_content/step_done split on `lib/pipeline-run.mjs` stopped webview OOM. Cross-link: [pipeline-runtime.md](pipeline-runtime.md), ACCEPTED-20260605-PIPE-RUNTIME, ACCEPTED-20250603-PIPELINE-RUNTIME.

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'type: "step_content"' lib/pipeline-run.mjs`; `grep -q 'ACCEPTED-20260605-PIPELINE-RUNTIME-PATH' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 21 passed.
- Scope: **SISpace project-local** — recall when editing pipeline sidecar, SSE emit wiring, or pipeline regression tests.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/scripts/pipeline-lib.mjs`, `**/node_host.rs`, `**/pipeline-model.test.mjs`
