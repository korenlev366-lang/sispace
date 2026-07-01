### PROP-20260604-compaction-cutpoint-tests:: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-compaction-cutpoint-tests.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-compaction-cutpoint-tests.md`.
- Applied change:

Add runtime unit tests for exported compaction pure functions (findCompactionCutPoint, shouldAutoCompact, estimateSessionContextTokens, trimLinesAfterCompaction) in tests/cursorsi-compaction-unit.mjs — the session required a mid-implementation cut-point fix while verify:cursorsi-compaction only static-greps source, leaving boundary edge cases unguarded.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-224625-sdk]]
