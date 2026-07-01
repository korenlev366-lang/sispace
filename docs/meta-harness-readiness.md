# Meta-Harness Readiness

This checklist tracks when the cursor-harness has enough **real-world evidence** to support an outer **meta-optimization loop** (optimizing the harness itself using harness-style grading, backtests, and rollouts).

Use `/harness-doctor` or `sh harness/scripts/doctor-meta-readiness.sh` to report current progress. Do not start meta-optimization until all four milestones are met or explicitly waived by the user.

## Milestones

| # | Milestone | Target | Primary signal |
| --- | --- | --- | --- |
| 1 | Full post-task sessions | **40+** sessions that triggered the 1000+ output-token threshold | `### ROLLOUT-` entries in `harness/reports/rollout-log.md` (proxy for completed SDK post-task chain) |
| 2 | Rejected-lesson corpus | **15+** distinct entries in `rejected-lessons.md` with clear rubric failure reasons | `### REJECTED-` entries; each must include Reason, Rejected proposal, and Reconsider only if |
| 3 | User model maturity | `user-model.md` reflects your idioms **without explicit prompting** | **3+** `### USER-PREF-` entries with `Confidence: medium` or `high` and concrete Preference + Evidence |
| 4 | Hook friction | `pre-tool-use.sh` requires manual override **less than once per two weeks** | **0** entries in `harness/memory/tool-override-log.md` in the rolling last **14 days** (e.g. `chmod -x` to bypass a false positive) |

## What each milestone means

### 1. Forty full post-task sessions

The post-task adapter runs the SDK post-task chain when a session reports **1000 or more output tokens** (`output_tokens` in the hook payload; see `post-task-adapter.sh`). Each completed chain should append a rollout log entry (including `no_proposal`).

**Proxy metric:** count lines matching `^### ROLLOUT-` in `harness/reports/rollout-log.md`.

**Not counted:** short-session nudges only, sessions without hooks installed, or chains skipped by the agent.

### 2. Fifteen rejected lessons with rubric reasons

Rejected lessons are negative training data. Each entry should document **why** the rubric or hard gates failed, not just “bad idea.”

**Metric:** count `^### REJECTED-` headings in `harness/memory/rejected-lessons.md`.

**Quality check (manual):** Reason field cites evidence, layer, or contradiction — not speculation.

### 3. User model reflects idioms

The living user model should capture stable preferences (commit style, verification expectations, shell/editor choices) learned from corrections — not copied from user rules on every session.

**Metric:** at least **3** user-model entries with medium or high confidence and non-empty Evidence.

**Subjective check:** user confirms preferences appear before they repeat the same correction.

### 4. Pre-tool-use override rate

A “manual override” is any time you disable or bypass `pre-tool-use.sh` to unblock legitimate work (for example `chmod -x .cursor/hooks/pre-tool-use.sh`).

**Metric:** log each override in `harness/memory/tool-override-log.md`. Rolling **14-day** count must stay below **1** (i.e. zero overrides in the window for a pass).

## Reporting

```sh
sh harness/scripts/doctor-meta-readiness.sh
```

From the harness repo root or any project with `harness/` memory ledgers installed.

Output sections:

- Per-milestone: current count, target, pass/fail, gap
- Overall: `READY` or `NOT READY` for meta-optimization

## When ready

When all four milestones pass:

1. Run `/harness-doctor` and archive the report.
2. Open a **meta-optimization** proposal (target layer: docs or memory first) in `pending-proposals.md`.
3. Grade with `/harness-grade` before changing rules, hooks, or skills.

Until then, keep using the inner loop (reflect → grade → rollout) on project work only.

## Related files

- Thresholds: `harness/config/meta-readiness.yaml`
- Override log: `harness/memory/tool-override-log.md`
- Doctor command: `.cursor/commands/harness-doctor.md`
- Doctor script: `harness/scripts/harness-doctor.sh` (see `harness/scripts/harness-doctor.md`)
