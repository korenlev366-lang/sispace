### PATTERN-20260604-STALE-RUN

- Source task: post-task SDK chain
- Reason: Proposal correctly identifies a real problem (stale active_run_id from interrupted cancel) and provides a clear, actionable pattern for recovery. It meets all rubric criteria: relevance (directly addresses the error), clarity (specific DB-level fix and retry logic), feasibility (manual DB clear plus auto-retry are practical), and impact (prevents recurrence). Minor improvement would be to include code/command examples, but the pattern is sufficient as a reasoning template.
- Target layer: memory
- Date: 2026-07-22
- Rollback note: Delete the PATTERN-20260604-STALE-RUN entry from reasoning-patterns.md and revert any associated memory changes if rejected.
- Applied change:

Add reasoning pattern for stale active_run_id error recovery: identify DB-level stale state, clear it, and implement retry logic.
