# Harness Apply

Human-triggered entrypoint for applying harness improvements that the automatic post-task chain did not apply.

## Automatic loop (long sessions)

After substantive sessions (`output_tokens` ≥ 1000), `post-task-adapter.sh` runs the SDK post-task chain in the background. Docs, memory, and backtests auto-apply when enabled in `harness/config/harness.yaml`. Locked layers (rules, hooks, skills, commands, mcp, user-model) are logged as **pending** in `harness/reports/rollout-log.md` — use this command to apply them.

## Proposal workflow (panel / CLI)

1. **Grade** — run the grading subagent on `latest-reflection.md` (writes `latest-grade.md` and may add pending proposals).
2. **Accept** — record a single proposal in `accepted-lessons.md` and mark it accepted in `pending-proposals.md` (`panel-actions.js accept --proposal-id <id>`).
3. **Reject** — record a single proposal in `rejected-lessons.md` and mark it rejected in `pending-proposals.md` (`panel-actions.js reject --proposal-id <id>`).
4. **Apply all** — for every pending proposal that is not rejected or already applied (including locked-layer proposals previously marked applied without file edits): auto-accept, run **harness-workflow-agent** to implement the change, append rollout-log entries, and mark each proposal applied only when status is `complete` or `partial` (`panel-actions.js apply`).

In the SISpace harness tab: select a proposal in **Proposals**, then **Accept** or **Reject**; use **Apply all** to accept and roll out every remaining pending proposal in one pass.

Requires `CURSOR_API_KEY` in the environment for grade, apply-all, and curate.

## Manual apply path (agent command)

Before changing anything on a single proposal, confirm there is an accepted grading result (or explicit Accept), a target layer, and a rollback note.

1. Run `harness-rollout` if no rollout-log entry exists for this proposal.
2. For pending locked-layer entries, use `harness-implementation-loop` for the smallest scoped change, then `harness-verification` for evidence.
3. Update the rollout-log entry with applied files and verification.

Expected output:
- Rollout log updated.
- Files or layers changed.
- Verification evidence.
- Rollback path.

Do not apply rejected or contradicted proposals. **Apply all** skips rejected/applied entries and auto-accepts the rest before rollout.
