---
name: harness-reflection
description: Reflect on completed harness tasks and draft evidence-based improvement proposals. Use after verified task completion.
disable-model-invocation: true
---

# Harness Reflection

## Scope

Use this skill only to summarize a completed task and draft evidence-based improvement proposals. Do not grade, accept, apply, or reject proposals.

## Workflow

1. Check reflection depth:
   - Full reflection is required when the session reported at least 1000 output tokens, had a failure, had a user correction, or the user explicitly requested reflection.
   - For shorter successful sessions, produce only a lightweight nudge and avoid durable memory proposals.
2. Read `harness/memory/goals.md` for `Status: active` entries. Record whether this session advanced any goal (`yes` | `no` | `n/a`) in the reflection output.
3. Capture the task goal, outcome, files changed, tools used, tool-call count, and verification evidence.
4. Record the reasoning trace: why the task failed, why direction changed, why the fix worked, and what uncertainty remained.
5. Record user corrections, failed attempts, repeated friction, successful patterns, and evidence-backed user preferences.
6. Decide whether the evidence supports a durable lesson or a `harness/memory/user-model.md` update.
7. If supported, draft one proposal targeting exactly one layer: rule, skill, command, hook, MCP, memory, backtest, docs, or user model.
8. If not supported, record `No proposal` with the reason.
9. Output using `reflection-template.md`.

## Handoff

Send any proposal to `harness-improvement-review`. Do not apply it directly.

When the SDK post-task chain runs (from `post-task-adapter.sh` after **1000+ output tokens**), run this skill as **Step 1** of `.cursor/hooks/lib/post-task-auto-chain.md` without waiting for `/harness-reflect`.

After reflection, write the reasoning trace to Obsidian `Harness/reasoning-patterns/` via MCP (see `.cursor/hooks/lib/obsidian-sync.md`) in addition to any repo draft.
