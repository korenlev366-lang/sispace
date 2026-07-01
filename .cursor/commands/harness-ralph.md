# Harness Ralph (Ralph Loop)

Human-triggered **verify-driven iteration loop**. Integrates with `harness/memory/ralph-goal.md`, `post-task-adapter.sh` (after the 1000+ output-token post-task chain), `accepted-lessons.md`, and Obsidian mirror in the post-task chain.

## Hard requirements

- Every goal **must** include `--verify` with a **runnable shell command** (validated at `set` time).
- Placeholder verifies (`true`, `exit 0`, `:`, empty) are **rejected**.
- `--max` defaults to **10**, hard cap **25**.
- Vague goals without a concrete description are rejected at `set` time.

## Subcommands (run via script)

From project root:

```sh
sh harness/scripts/ralph-goal.sh set --goal "DESCRIPTION" --verify "SHELL COMMAND" [--max N]
sh harness/scripts/ralph-goal.sh status
sh harness/scripts/ralph-goal.sh pause
sh harness/scripts/ralph-goal.sh resume
sh harness/scripts/ralph-goal.sh cancel
```

### set

- Writes `harness/memory/ralph-goal.md` with `status: active`, `current_iteration: 0`.
- Runs the verify command once to ensure it is runnable (non-127 exit).
- Example: `--verify "sh harness/scripts/verify-phase9.sh"`

### status

Print current goal, verify command, iterations, and status.

### pause / resume

Pause or resume an active loop without clearing state.

### cancel

Reset to `idle` and clear goal fields.

## Post-task hook behavior

When a session has **1000+ output tokens** and `ralph-goal.md` has `status: active`, `post-task-adapter.sh` runs `ralph-goal.sh post-task` **after** starting the SDK post-task chain:

| Verify exit | Action |
| --- | --- |
| 0 | `status: complete`, append `ACCEPTED-RALPH-*` to `accepted-lessons.md`, inject `HARNESS_RALPH_COMPLETE` |
| non-zero, under max | Increment iteration, log to iteration log, inject `HARNESS_RALPH_CONTINUE` with failure output |
| non-zero, at max | `status: failed`, inject `HARNESS_RALPH_FAILED` |

Agent must mirror new accepted-lesson entries to Obsidian per `.cursor/hooks/lib/obsidian-sync.md` when processing `HARNESS_RALPH_COMPLETE`.

## Do not

- Set a goal without `--verify`.
- Exceed 25 max iterations.
- Auto-apply rules or hooks from Ralph outcomes without grading (accepted Ralph lessons are memory-only).
