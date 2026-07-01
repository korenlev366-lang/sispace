# Reports

Generated harness outputs for review. Prefer not committing transient content unless it documents a decision.

| File | Purpose |
| --- | --- |
| `latest-reflection.md` | Most recent task reflection draft. |
| `latest-grade.md` | Most recent grading result draft. |
| `rollout-log.md` | Append-only Phase 10 rollout log (applied and would-have-applied). |

Every accepted proposal evaluated for rollout gets an entry in `rollout-log.md`, even when `auto_apply.enabled` is `false`.

**Entity graph (rollout ↔ proposal ↔ reflection ↔ tasks):** [docs/harness-knowledge-graph.md](../../docs/harness-knowledge-graph.md).
