# SISpace model routing (architecture note)

> **Source:** PROP-20260603-004 (memory layer). Use when debugging “wrong or expensive model on pipeline/subagent steps.”

## Summary

Documenting SISpace model routing per PROP-20260603-004: tasks store one model_id; DEFAULT_MODEL_ID is composer-2.5-fast in TS, Rust, YAML, and harness-orchestrator; OpenClaw hybrid steps in sidecar/handlers/pipeline.mjs pass opts.model to every runCursorAgentStep and ignore .cursor/agents model frontmatter; no subagent_model_id or context-window variant exists yet—cost bugs should trace this map before implementing UI fixes.

Pipeline runs resolve an **orchestrator model** and a **subagent model** from the task row (and optional run overrides), then pass them through Rust → Node → hybrid OpenClaw or SDK dispatch. **`.cursor/agents/*.md` `model:` frontmatter does not apply on the OpenClaw hybrid path.**

**Cost default:** Store and spawn **`composer-2.5`** (standard tier). Do **not** use the legacy id `composer-2.5-fast` as the default spawn id — the Cursor API catalogs `composer-2.5` only; “fast” is a **variant param**, not a separate billable id string.

## Cursor SDK ModelSelection

Per `@cursor/sdk` (public beta): models are not bare strings — use `ModelSelection`:

| Mode | SDK shape |
|------|-----------|
| Standard (default) | `{ id: "composer-2.5" }` |
| Fast variant | `{ id: "composer-2.5", params: [{ id: "fast", value: "true" }] }` |
| Thinking | `{ id: "<model>", params: [{ id: "thinking", value: "true" }] }` or thinking-level suffixes on supported models |

Discover supported params with `Cursor.models.list({ apiKey })` — not every model exposes `fast` or `thinking`.

**SISpace mapping:**

- DB / UI / pipeline bodies store a **canonical string** (`composer-2.5`, `composer-2`, …).
- `normalize_model_id` in Rust maps legacy `composer-2.5-fast` → `composer-2.5` on persist.
- SDK spawn paths use `modelIdToSelection()` ([`harness/scripts/src/lib/model-selection.ts`](../scripts/src/lib/model-selection.ts)) so agents get `{ id: "composer-2.5" }`, not a rejected `composer-2.5-fast` id.
- OpenClaw hybrid passes the **string** to `cursor-agent --model` (also normalized to `composer-2.5`).

## Data model

| Field | Storage | Purpose |
|-------|---------|---------|
| `tasks.model_id` | SQLite | Orchestrator / pipeline header model |
| `tasks.subagent_model_id` | SQLite (migration `003_subagent_model`) | Per-step subagent model when set |
| Pane `model_id` / `subagent_model_id` | Workspace preset / spawn config | CLI `--model` flags for pane sessions |

When `subagent_model_id` is null, pipeline code falls back to the orchestrator model (see `build_pipeline_request` in [`sispace-core/src/services/pipeline_client.rs`](../../sispace-core/src/services/pipeline_client.rs)).

## Default constants (watch for drift)

| Layer | Symbol / key | Default |
|-------|----------------|---------|
| Rust tasks | `DEFAULT_MODEL_ID` / `DEFAULT_SUBAGENT_MODEL_ID` | `composer-2.5` ([`sispace-core/src/models/task.rs`](../../sispace-core/src/models/task.rs)) |
| Node pipeline | `DEFAULT_ORCHESTRATOR_MODEL` / `DEFAULT_SUBAGENT_MODEL` | `composer-2.5` ([`lib/pipeline-models.mjs`](../../lib/pipeline-models.mjs)) |
| Config | `models.default` / `default_subagent` | `composer-2.5` ([`config/sispace.yaml`](../../config/sispace.yaml)) |
| Harness SDK orchestrator | `createHarnessOrchestrator` | `modelIdToSelection(orchestratorModel ?? composer-2.5)` ([`harness/scripts/src/lib/harness-orchestrator.ts`](../scripts/src/lib/harness-orchestrator.ts)) |
| CLI catalog | `FALLBACK_MODEL_ID` | `composer-2.5`; legacy `composer-2.5-fast` → canonical ([`cli/src/models/catalog.ts`](../../cli/src/models/catalog.ts)) |

**Stale footgun:** `scripts/pipeline-lib.mjs` defaults must match `lib/pipeline-models.mjs` — only `lib/` is spawned at runtime (see [SISPACE_PLAN.md § Pipeline runtime path](../../SISPACE_PLAN.md)).

Task-type overrides (`feature`/`bug` → `composer-2.5` in `resolve_model`) still apply when `tasks.model_id` is null.

## Live pipeline path

```text
UI / task row (model_id, subagent_model_id)
  → pipeline_client.rs build_pipeline_request (orchestrator + subagent_model)
  → lib/node-server.mjs POST /pipeline/run
  → lib/pipeline-run.mjs resolvePipelineModels(body)
       → orchestrator: body.model ?? DEFAULT_ORCHESTRATOR_MODEL
       → subagent: body.subagentModel ?? body.model ?? DEFAULT_SUBAGENT_MODEL
  → per specialist step:
       hybrid: runHybridSpecialistStep({ model: subagent })  → sidecar/handlers/pipeline.mjs
                 runCursorAgentStep({ model: opts.model })   → cursor-agent.mjs --model
       SDK:    pickAgentsWithModel(registry, sequence, subagent)
                 createHarnessOrchestrator({ model: modelIdToSelection(orchestrator) })
```

## What hybrid ignores

- **`.cursor/agents/<role>.md` frontmatter `model:`** — loaded for the SDK registry but **not** passed into `runCursorAgentStep` on the OpenClaw branch ([`sidecar/handlers/pipeline.mjs`](../../sidecar/handlers/pipeline.mjs) uses `opts.model` only).
- **Per-agent catalog overrides in UI** — unless exposed as separate orchestrator vs subagent prefs and wired through `pipeline_client` + `resolvePipelineModels`.

## Cost-debug checklist

1. Read `tasks.model_id` and `tasks.subagent_model_id` for the task (expect `composer-2.5`, not `composer-2.5-fast`).
2. Grep pipeline SSE `pipeline_start` for `model` / `subagentModel` fields.
3. Confirm edit landed in **`lib/pipeline-run.mjs`** (not only `scripts/pipeline-lib.mjs`).
4. On hybrid steps, trace `opts.model` in `sidecar/handlers/pipeline.mjs` → `--model` in `cursor-agent.mjs`.
5. On SDK steps, confirm `pickAgentsWithModel` uses `modelIdToSelection` (no bare `composer-2.5-fast` id).
6. Compare against `.cursor/agents/*.md` only for SDK-only paths, not hybrid.

## CLI model pickers (`cursorsi` TUI)

| Slash command | Affects | Persists |
|---------------|---------|----------|
| `/model` | Orchestrator / session agent (`CliSession.modelId` + `modelParams`) | `tasks.model_id` when `--resume` linked |
| `/subagent-model` | Pipeline specialists only (not the orchestrator that picks agents) | `tasks.subagent_model_id` when linked |

Both commands open an interactive picker backed by `Cursor.models.list()` (variants + parameters: fast, thinking, effort, context window). SDK spawn uses `modelIdToSelection()` in [`cli/src/models/selection.ts`](../../cli/src/models/selection.ts).

## Gaps / follow-ups

- UI may still list “Composer 2.5 Fast” as a label — storage should normalize to `composer-2.5`; opt-in fast uses `params.fast` in CLI sessions; pipeline HTTP body still passes string ids only.
- Live **billing split** when orchestrator ≠ subagent requires `CURSOR_API_KEY` E2E (not covered by static tests).

## Rollback

Delete this file and remove the index line in `project-index.md`.
