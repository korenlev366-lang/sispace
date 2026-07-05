# Memory Ledger Overview

Memory files are **local-only** markdown ledgers for harness learning. They are seeded from `harness/scaffold/` on first setup and are **not committed to GitHub**.

## First-time setup

```sh
sh harness/scripts/harness-bootstrap.sh
# or: npm run harness:bootstrap
```

That copies empty starter ledgers from `harness/scaffold/memory/` into this directory. The post-task chain appends here as you work.

## Override canonical store

Set `SISPACE_HOME` to point memory/reports elsewhere (default: this repo’s `harness/memory/` and `harness/reports/` after bootstrap).

## Files

- `project-index.md` — index and persistence rules
- `pending-proposals.md` — proposed changes waiting for grading
- `accepted-lessons.md` — accepted lessons with rollback notes
- `rejected-lessons.md` — rejected lessons and reconsideration conditions
- `user-model.md` — evidence-backed user preference model
- `reasoning-patterns.md` — reusable reasoning patterns from completed sessions
- `tool-override-log.md` — manual hook bypasses
- `goals.md` — persistent goals without automated verification
- `ralph-goal.md` — Ralph verify loop state

**Graph and vault mirrors:** [docs/harness-knowledge-graph.md](../../docs/harness-knowledge-graph.md)
