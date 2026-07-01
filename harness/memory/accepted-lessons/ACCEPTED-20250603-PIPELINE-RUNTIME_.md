### ACCEPTED-20250603-PIPELINE-RUNTIME:: Live Node sidecar path (PROP-20250603-004)

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20250603-004-1780607448654)
- Reason: Verified user regression from editing scripts/pipeline-lib.mjs while runtime uses lib/pipeline-run.mjs; durable verify/memory rule prevents repeat.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete harness/memory/pipeline-runtime.md and remove index line in project-index.md.
- Applied change:

Added harness/memory/pipeline-runtime.md architecture note: live path is package.json `node-host` → lib/node-server.mjs → lib/pipeline-run.mjs (spawned by node_host.rs); pipeline SSE/model-split/OOM fixes must edit lib/ and pass tests/pipeline-model.test.mjs; scripts/pipeline-lib.mjs alone does not affect the running sidecar.
- Verification evidence: `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed; `grep -q 'node-host' harness/memory/pipeline-runtime.md`; project-index.md links pipeline-runtime.md.
- Scope: **SISpace project-local** — recall when editing pipeline, sidecar, or SSE behavior.
- Recall globs: `**/lib/pipeline-*.mjs`, `**/lib/node-server.mjs`, `**/scripts/pipeline-lib.mjs`, `**/node_host.rs`, `**/pipeline-model.test.mjs`
