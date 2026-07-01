---
source: "cursor-harness"
tags: "harness"
proposal_id: "sess_mpzqmosj_8humo8"
date: "2026-06-04"
---

Traced cursorsi auto-reflect path: Orchestrator unmount → triggerAutoReflectOnSessionEnd → launchReflectChain → scripts/invoke-chain.sh → post-task-chain.js. Reconstructed session from persisted /tmp/cursorsi-reflect-* transcript rather than agent-transcripts (cursorsi in-memory sessions are not stored as Cursor agent-transcripts). Root cause: guard substring "ready — type /help" does not appear in actual startup copy "ready — type a message or /help", so lines starting with [sess_…] pass the third predicate. Compounding factor: estimateOutputTokens Math.max(1000, chars/4) reports 1000 tokens for ~150-char transcripts, forcing full reflection depth on empty sessions. No code changes, failures, or user corrections occurred in the reflected session itself.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-200016-sdk]]
