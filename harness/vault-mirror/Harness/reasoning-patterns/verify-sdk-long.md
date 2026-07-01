---
source: "cursor-harness"
tags: "harness"
proposal_id: "verify-sdk-long"
date: "2026-06-02"
---

Session is an infrastructure wiring self-test, not a user deliverable. With output_tokens=1500 above THRESHOLD=1000, post-task-adapter.sh launches the detached SDK chain. Foreground hook output must stay minimal (empty {}), avoiding model-space HARNESS_POSTTASK_AUTO_CHAIN injection. Background reflection correctly returns proposal=null and gate=no_proposal because there is no transcript, no user task, and no harness gap to fix. Dedicated session_id verify-sdk-long gives verify-post-task-auto-chain.sh a traceable rollout marker distinct from cmd-verify in verify-harness-commands.sh.