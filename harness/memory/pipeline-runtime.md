# SISpace pipeline runtime path (architecture note)

> **Source:** PROP-20250603-004 (memory layer). Use before any pipeline SSE, model-split, or OOM fix.

## Live runtime map

```text
package.json "node-host" → lib/node-server.mjs
  ↑ spawned by sispace-core/src/services/node_host.rs (spawn_host)
  → lib/pipeline-run.mjs (runPipelineStreaming)
```

**`scripts/pipeline-lib.mjs` is shared helpers only** — it is **not** the live sidecar entry. Edits there alone do **not** affect the running pipeline and have caused verified user regressions.

## Verify / apply checklist

1. **Trace spawn path first:** `grep` `package.json` `node-host`, `node_host.rs` `spawn_host`, and `lib/node-server.mjs` imports before editing pipeline Node code.
2. **Edit `lib/` for runtime behavior:** SSE caps, model resolution, truncation, step_done/step_content split, and hybrid dispatch must land in `lib/pipeline-run.mjs` (and related `lib/*.mjs`), not only `scripts/pipeline-lib.mjs`.
3. **Assert in tests:** Run `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — the `runtime entry points (static)` and `lib/pipeline-run wiring` suites must pass after any pipeline fix.
4. **Restart after Node changes:** Full SISpace quit (sidecar reload); Rust/UI changes need `npm run build` + `cargo build --release`.

## What tests guard

| Suite | Asserts |
|-------|---------|
| `runtime entry points (static)` | `node_host.rs` spawns `lib/node-server.mjs`; `package.json` `node-host` script; `lib/node-server.mjs` imports `lib/pipeline-run.mjs` |
| `lib/pipeline-run wiring (static)` | `resolvePipelineModels`, `pickAgentsWithModel`, slim `step_done` / `step_content` split in active runtime |
| `scripts/pipeline-lib wiring (static)` | Helper parity only — **not** proof the sidecar uses your edit |

## Related notes

- [model-routing.md](model-routing.md) — orchestrator vs subagent model propagation on the live `lib/` path
- [SISPACE_PLAN.md § Pipeline runtime path](../../SISPACE_PLAN.md) — operator docs (PROP-20250603-008)

## Rollback

Delete this file and remove the index line in `project-index.md`.
