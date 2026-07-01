---
name: harness-workflow
description: Decompose a task into independent parent-level subtasks, dispatch in parallel with explicit context, synthesize results into rollout-log. No nested subagent spawning.
disable-model-invocation: true
---

# Harness Workflow

## Scope

Decompose one user task into subtasks, dispatch them from the **parent agent only**, and synthesize outcomes. Do not grade or apply harness proposals from this skill.

## Hard rules

1. **Parent level only** — the parent agent dispatches subtasks (e.g. Task tool / parallel agents). A subtask agent must **not** spawn further subagents.
2. **Explicit context** — every dispatch prompt must include: goal, file paths, constraints, expected output format, and verification criteria. Subagents have no shared session context.
3. **Parallelism check** — if subtasks share mutable files, ordering dependencies, or the same git branch state, **warn** and fall back to **sequential** execution with an ordered plan.
4. **Log synthesis** — after completion, append one entry to `harness/reports/rollout-log.md` (see `.cursor/commands/harness-workflow.md`).
5. **Destructive scaffolders** — before running destructive greenfield scaffolders (e.g. `create-tauri-app --force`) in a repo with `.cursor/` and `harness/`, prefer manual integration into the existing tree; if `--force` is unavoidable, run `harness-install.sh --force` immediately after and verify hooks/agents restored before continuing.

## Task-type orchestration (specialist pipelines)

Classify the parent task, then run the matching **sequential** specialist chain. Definitions live in `.cursor/agents/*-agent.md`. SDK: `runSpecialistPipeline()` in `harness/scripts/src/lib/workflow-sdk.ts` with registry from `loadWorkflowAgents()`.

| Task type | When to use | Specialist sequence (in order) |
| --- | --- | --- |
| **feature** | New capability, refactor with design, multi-file implementation | `researcher-agent` → `architect-agent` → `coder-agent` → `reviewer-agent` → `tester-agent` |
| **bug** | Failure, regression, error logs, broken tests | `researcher-agent` → `debugger-agent` → `coder-agent` → `tester-agent` |
| **docs** | README, guides, comments only; no logic change | `researcher-agent` → `documenter-agent` |

**Layer 3 checkers** (after each paired specialist, before orchestrator sees output):

| Specialist | Checker |
| --- | --- |
| `researcher-agent` | `checker-researcher` |
| `architect-agent` | `checker-architect` |
| `coder-agent` | `checker-coder` |
| `reviewer-agent` | `checker-reviewer` |
| `tester-agent` | `checker-tester` |

If checker returns `corrections_required`, the specialist gets **one** revision pass; checkers do not spawn agents. `debugger-agent` / `documenter-agent` have no paired checker.

**Role boundaries (never cross):**

- **researcher** — read/search only; never writes code
- **architect** — plans/specs only; never implements (`composer-2.5`)
- **coder** — implements from spec only; never plans or reviews
- **reviewer** — findings and suggested fixes only; never implements
- **tester** — tests and verification only; never implements features
- **debugger** — root-cause and fix spec only; hands off to coder
- **documenter** — docs only; never touches application logic

For each step, pass the parent goal plus **all prior step outputs** inline. Print: `Workflow task type: <feature|bug|docs>` and the sequence before dispatching.

If the task does not fit these types, decompose manually (table below) and use `harness-workflow-agent` for independent subtasks or parallel `runWorkflowSubtasksParallel()`.

## Workflow

### 1. Intake

- Restate the parent task and success criteria.
- **Classify task type** (`feature` | `bug` | `docs`) or explain why manual decomposition is needed.
- List unknowns; read only files needed to decompose.

### 2. Decompose

**If using a specialist pipeline:** the sequence above replaces generic decomposition; skip parallel unless the parent splits unrelated work.

**Otherwise** produce a table:

| ID | Subtask | Parallelizable | Depends on |
| --- | --- | --- | --- |
| A | … | yes/no | — |

Rules:

- Prefer 2–5 subtasks; split further only if clearly independent.
- Mark `Parallelizable: no` when any dependency exists.

### 3. Dispatch decision

- **Specialist pipeline** → sequential dispatch in task-type order; print `Workflow falling back to sequential` is implicit (never parallelize pipeline steps).
- **All parallelizable** (manual subtasks) → dispatch all subtasks in one parallel batch from the parent.
- **Any not parallelizable** → print warning: `Workflow falling back to sequential` and run in dependency order without nested spawning.

### 4. Dispatch prompts

For each subtask or specialist step, write a standalone prompt block the parent will send. Each block must include:

- Subtask ID and title (or specialist role name)
- Parent goal (one paragraph)
- Relevant paths and commands
- Out of scope (what not to touch)
- Prior step outputs (for specialists after the first)
- Deliverable and how to verify

### 5. Synthesize

After subtasks return:

- Merge results; resolve conflicts explicitly.
- Note failures and partial work.
- Append rollout-log entry with `Rollout action: workflow_synthesis`.
- Optional: mirror to Obsidian per `.cursor/hooks/lib/obsidian-sync.md`.

## Do not

- Spawn subagents from within a subtask.
- Dispatch without verification criteria per subtask.
- Skip rollout-log when the workflow completed at least one subtask.
- Let specialists operate outside their role boundaries.
- Let checkers spawn agents or request more than one specialist correction pass.
