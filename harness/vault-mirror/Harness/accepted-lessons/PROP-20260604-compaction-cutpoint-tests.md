---
source: "cursor-harness"
tags: "harness"
proposal_id: "PROP-20260604-compaction-cutpoint-tests"
date: "2026-06-04"
---

Add runtime unit tests for exported compaction pure functions (findCompactionCutPoint, shouldAutoCompact, estimateSessionContextTokens, trimLinesAfterCompaction) in tests/cursorsi-compaction-unit.mjs — the session required a mid-implementation cut-point fix while verify:cursorsi-compaction only static-greps source, leaving boundary edge cases unguarded.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-224625-sdk]]
