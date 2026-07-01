# Harness Workflow

Human-triggered **task decomposition** and **parallel dispatch** at the parent agent level only.

## Skill

Read and follow `.cursor/skills/harness-workflow/SKILL.md` for the full workflow.

## When to use

- Large tasks with **truly independent** subtasks (no shared mutable state, no ordering dependency).
- When each subtask can run with **explicit context** in the prompt (subagents do not inherit parent context).

## When not to use

- Subtasks that depend on each other's output — run **sequentially** instead (skill will warn and fall back).
- Nested decomposition (subtask must not spawn subagents).

## Expected output

1. Decomposition table: subtask id, description, inputs, expected artifact, parallelizable yes/no.
2. Dispatch prompts (one per parallel subtask) with all required context inlined.
3. After all subtasks finish: synthesized result appended to `harness/reports/rollout-log.md` as a workflow entry:

```markdown
### ROLLOUT-YYYYMMDD-HHMMSS-WF-001

- Rollout action: workflow_synthesis
- Change summary: [parent task outcome]
- Subtasks: [ids and outcomes]
- Verification evidence:
```

Mirror the rollout entry to Obsidian `Harness/rollout-log/` per `.cursor/hooks/lib/obsidian-sync.md`.

## Task-type specialists

| Type | Sequence |
| --- | --- |
| feature | researcher → architect → coder → reviewer → tester |
| bug | researcher → debugger → coder → tester |
| docs | researcher → documenter |

Agent definitions: `.cursor/agents/*-agent.md`. Architect uses `composer-2.5`; other specialists use `composer-2`.

## Integration

- Use `harness-project-intake` if the project layout is unknown.
- Run `/harness-reflect` or rely on post-task chain after the workflow completes.
- Do not auto-apply harness rules or hooks from workflow output.
- **SDK sequential pipeline:** `runSpecialistPipeline({ taskType, parentGoal, ... })` from `harness/scripts/dist/lib/workflow-sdk.js`.
- **SDK parallel subtasks:** `runWorkflowSubtasksParallel()` — registry includes harness + specialists; each subtask uses `harness-workflow-agent` via `Promise.all()`.
