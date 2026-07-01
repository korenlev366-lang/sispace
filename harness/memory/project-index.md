# Project Memory Index

## Canonical memory store

All harness **memory ledgers** and **reports** (rollout-log, post-task-chain.log, latest-reflection/grade) are written to **`/home/lev/sispace`** regardless of which workspace triggers the post-task chain. Override with `SISPACE_HOME` if the repo moves.

- TypeScript: `resolveSispaceMemoryRoot()` in `harness/scripts/src/lib/paths.ts`
- Shell: `post-task-adapter.sh` and `retroactive-reflect.sh` set `MEMORY_ROOT` from `SISPACE_HOME`

## Harness installation

- Harness hooks installed: 2026-06-03
- Template source: /home/lev/.cursor-harness
- Installed: .cursor/hooks.json, .cursor/hooks/, .cursor/agents/, .cursor/skills/harness-workflow/
## Harness scaffold

- Harness scaffold installed: 2026-06-03
- Scaffold: harness/config/, harness/memory/ ledgers (incl. reasoning-patterns.md), harness/reports/, docs/meta-harness-readiness.md
## Architecture notes

- [`pipeline-runtime.md`](pipeline-runtime.md) — SISpace live Node sidecar path: `node-host` → `lib/` (PROP-20250603-004)
- [`model-routing.md`](model-routing.md) — SISpace orchestrator vs subagent model propagation (PROP-20260603-004)

## Project decisions (GNUClient / linux minecraft — ported)

Resolved during harness bootstrap (2026-05-31):

1. **Primary client:** **GNUClient** is the active implementation target. **RainClient** is legacy reference only (patterns, parity checks — not new feature work).
2. **Harness memory location:** Canonical store is **`/home/lev/sispace/harness/memory/`** (see § Canonical memory store). Obsidian mirror at `/home/lev/harness vault/Harness/`.
3. **Obsidian MCP:** Configured **globally** in `~/.cursor/mcp.json` only. Do **not** add Obsidian MCP to project `.cursor/mcp.json` (project file stays hooks-only / empty).

## Ledgers

- `pending-proposals.md` — inactive proposed changes
- `accepted-lessons.md` — accepted lessons with rollback notes
- `rejected-lessons.md` — rejected lessons and reconsideration conditions
- `user-model.md` — evidence-backed user preference model
- `reasoning-patterns.md` — reusable reasoning patterns from completed sessions
- `tool-override-log.md` — manual hook bypasses

## Reports

- `../reports/rollout-log.md` — append-only rollout log
- `../reports/latest-reflection.md` — most recent reflection
- `../reports/latest-grade.md` — most recent grading result

## Obsidian vault mirror (SISpace copy)

Per-session / per-rollout notes copied from `/home/lev/harness vault/` into [`../vault-mirror/`](../vault-mirror/):

- `../vault-mirror/Harness/rollout-log/` — one `.md` per `ROLLOUT-*` (all minecraft + SISpace sessions)
- `../vault-mirror/Harness/reasoning-patterns/` — per-session pattern mirrors
- `../vault-mirror/Harness/accepted-lessons/` — per-proposal stubs

Refresh: `node harness/scripts/port-memory-to-sispace.mjs`

## Config

| File | Purpose |
| --- | --- |
| `../config/harness.yaml` | Auto-apply policy |
| `../config/obsidian.yaml` | Obsidian vault paths |
| `../config/meta-readiness.yaml` | Meta-harness milestone thresholds |
