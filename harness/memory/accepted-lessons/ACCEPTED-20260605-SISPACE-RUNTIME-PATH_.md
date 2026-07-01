### ACCEPTED-20260605-SISPACE-RUNTIME-PATH:: Tauri node sidecar runtime path and restart

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-SISPACE-RUNTIME-PATH-1780670729168)
- Reason: Tauri spawns a long-lived Node child via node_host.rs; pipeline fixes must target lib/ and require full quit to reload the sidecar — editing scripts/pipeline-lib.mjs alone caused verified fix-then-regress.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: Tauri node sidecar runtime path and restart

- ✅ DO: Patch `lib/pipeline-run.mjs` (imported by `lib/node-server.mjs`, spawned by `sispace-core/src/services/node_host.rs` `spawn_host`) for any pipeline SSE/emit/OOM fix; run `node --experimental-strip-types --test tests/pipeline-model.test.mjs` against `lib/` wiring before declaring complete.
- ❌ AVOID: Editing only `scripts/pipeline-lib.mjs` — shared helpers, not the live sidecar entry; edits there do not affect the running child process.
- 💡 WHY: The Node child is spawned once at app start and keeps running until full SISpace quit; hot file edits on disk do not reload the in-memory sidecar — always full quit (not just window close) after Node pipeline changes. Cross-link: [pipeline-runtime.md](pipeline-runtime.md), ACCEPTED-20260605-PIPE-RUNTIME.

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'ACCEPTED-20260605-SISPACE-RUNTIME-PATH' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed.
- Scope: **SISpace project-local** — recall when editing pipeline sidecar, SSE, or regression tests.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/pipeline_client.rs`, `**/node_host.rs`, `**/tests/pipeline-model.test.mjs`
