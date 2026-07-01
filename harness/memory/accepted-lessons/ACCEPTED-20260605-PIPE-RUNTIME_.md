### ACCEPTED-20260605-PIPE-RUNTIME:: Tauri pipeline sidecar spawn path

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-PIPE-RUNTIME-1780670685114)
- Reason: Verified fix-then-regress when editing scripts/pipeline-lib.mjs while Tauri sidecar runs lib/node-server.mjs → lib/pipeline-run.mjs via sispace-core node_host.rs; trace spawn path before any pipeline SSE/emit fix.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: Tauri pipeline sidecar runtime path

- ✅ DO: Before any pipeline SSE/emit/OOM fix, trace the live spawn path — `sispace-core/src/services/node_host.rs` `spawn_host` spawns `lib/node-server.mjs`, which imports `lib/pipeline-run.mjs` (`runPipelineStreaming`); also read `pipeline_client.rs` for Rust-side SSE delivery.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` — it is shared helpers, not the live sidecar entry; edits there do not affect the running pipeline and cause verified user regressions.
- 💡 WHY: Rust spawns the Node child directly from `node_host.rs`; SSE caps and emit behavior must land on the active `lib/` path before declaring a pipeline fix complete. Cross-link: [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'ACCEPTED-20260605-PIPE-RUNTIME' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed.
- Scope: **SISpace project-local** — recall when editing pipeline, sidecar, SSE, or emit behavior.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/pipeline_client.rs`, `**/node_host.rs`
