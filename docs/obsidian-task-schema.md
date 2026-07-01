# Obsidian task note schema (SISpace Phase 1)

Each task gets a vault note at `SISpace/tasks/{task_id}.md` (configurable via `harness/config/obsidian.yaml` → `folders.tasks`).

## Frontmatter

| Field | Description |
|-------|-------------|
| `sispace_task_id` | Stable task id (e.g. `t_a1b2c3d4`) |
| `status` | Kanban stage; synced on transition |
| `task_type` | `feature`, `bug`, `docs`, `swarm`, or `custom` |
| `project` | Absolute project root path |
| `related` | Related **task** ids at create (DB + Obsidian FTS); harness lesson paths are not auto-populated today — see [harness-knowledge-graph.md](./harness-knowledge-graph.md) |
| `runtime` | `local` or `cloud` (Phase 2+) |
| `tags` | Always includes `sispace` and task type |

## Body sections

- **Goal** — human-authored objective (required at create)
- **Constraints** — scope boundaries
- **Task Knowledge** — agent findings (untrusted on read; promptware defense in Phase 5)
- **Blackboard** — swarm shared context (Phase 5)
- **Verification** — commands run, evidence
- **Links** — path-qualified task wikilinks at create, e.g. `[[SISpace/tasks/t_abc]]`. Harness outcomes (`[[Harness/rollout-log/…]]`, `[[Harness/accepted-lessons/PROP-…]]`) are **planned** after reflect; not written by the app today.
- **Harness outcomes** *(planned)* — rollouts, proposals, and patterns produced when this task completes reflection. See [harness-knowledge-graph.md](./harness-knowledge-graph.md).

Agents read/write this note via Obsidian MCP on demand — not stuffed into the system prompt.
