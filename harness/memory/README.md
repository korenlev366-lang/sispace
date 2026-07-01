# Memory Ledger Overview

Memory files are local markdown ledgers for harness learning.

**Canonical location:** `/home/lev/sispace/harness/memory/` (and `harness/reports/`). The post-task chain writes here even when hooks run from another project directory (e.g. `linux minecraft thing`, `~/.cursor-harness`). Set `SISPACE_HOME` to override.

**Full cross-repo port:** Run `node harness/scripts/port-memory-to-sispace.mjs` to merge ledgers from `linux minecraft thing`, `.cursor-harness`, and Obsidian into SISpace — including GNUClient anticheat patterns, accepted lessons, user-model prefs, **all `### ROLLOUT-*` entries**, `post-task-chain.log`, `retroactive-reflect.log`, and a filesystem copy of Obsidian notes under [`harness/vault-mirror/`](../vault-mirror/) (`Harness/rollout-log/`, `Harness/reasoning-patterns/`, `Harness/accepted-lessons/`).

- `project-index.md`: index and persistence rules.
- `model-routing.md`: orchestrator vs subagent model propagation map (cost debugging).
- `pending-proposals.md`: inactive proposed changes waiting for grading.
- `accepted-lessons.md`: accepted lessons with rollback notes.
- `rejected-lessons.md`: rejected lessons and reconsideration conditions.
- `user-model.md`: evidence-backed user preference model.
- `reasoning-patterns.md`: reusable reasoning patterns from completed sessions.
- `tool-override-log.md`: manual hook bypasses (meta-readiness milestone 4).

Pending proposals and user-model updates do not become active guidance until they pass the grading and apply path.

**How ledgers connect to rollouts, vault mirrors, and task notes:** [docs/harness-knowledge-graph.md](../../docs/harness-knowledge-graph.md).
