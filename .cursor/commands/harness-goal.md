# Harness Goal (persistent tracker)

Simpler than Ralph: **no automated verify loop** — only durable goal tracking for reflection.

## Ledger

`harness/memory/goals.md` — schema per entry:

- `### GOAL-YYYYMMDD-NNN: [Short title]`
- Goal, Set date, Target date (optional), Status (`active` | `complete` | `abandoned`), Progress notes (dated bullets)

## Subcommands

Edit `goals.md` directly following the schema. Do not use a shell script unless batching.

| Subcommand | Action |
| --- | --- |
| **set** | Add new `### GOAL-*` under **Active goals** with `Status: active`, today's date, initial progress note |
| **status** | List all `active` goals with dates and latest progress note |
| **complete** | Move entry to **Complete / abandoned**, set `Status: complete`, add closing progress note |
| **abandon** | Move entry to **Complete / abandoned**, set `Status: abandoned`, note reason |
| **list** | Show active, complete, and abandoned summaries |

## Reflection integration

Every **full reflection** (post-task auto-chain Step 1 and `/harness-reflect`) must:

1. Read `harness/memory/goals.md` for entries with `Status: active`.
2. Include in `harness/reports/latest-reflection.md` and the reflection template:
   - **Active goals:** (list or "none")
   - **Goal advancement:** `yes` | `no` | `n/a` — did this session advance an active goal?
   - One sentence per active goal on what changed.

See `.cursor/hooks/lib/post-task-auto-chain.md` Step 1 and `.cursor/skills/harness-reflection/reflection-template.md`.

## Do not

- Confuse with `/harness-ralph` (verify loop in `ralph-goal.md`).
- Mark goals complete without user confirmation or clear evidence in the session.
