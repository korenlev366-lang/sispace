# Ralph Goal Loop

Single active Ralph loop per project. Managed by `sh harness/scripts/ralph-goal.sh` and `/harness-ralph`.

## State (machine-readable)

goal: 
verify_command: 
max_iterations: 10
current_iteration: 0
status: idle
started_at: 
completed_at: 
last_verify_exit: 
last_failure_excerpt: 

## Rules

- `status`: `idle` | `active` | `paused` | `complete` | `failed`
- `verify_command` must be a runnable shell command (validated at `set` time).
- `max_iterations` default 10, hard cap 25.
- On verify success (exit 0): `complete`, append `ACCEPTED-RALPH-*` to `accepted-lessons.md`, mirror to Obsidian in post-task chain.
- On verify failure: increment `current_iteration`, append to iteration log; re-inject goal context via `post-task-adapter.sh` until max or success.

## Iteration log

(No iterations yet.)

No entries recorded yet.

No entries recorded yet.
