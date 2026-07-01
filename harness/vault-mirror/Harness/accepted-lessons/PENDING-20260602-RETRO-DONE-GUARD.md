---
source: "cursor-harness"
tags: "harness"
proposal_id: "PENDING-20260602-RETRO-DONE-GUARD"
date: "2026-06-02"
---

In harness/scripts/retroactive-reflect.sh generation_completed(), when evaluating completion after a -retro start, require the next done rollout= in the log window to correspond to the same session (e.g. reasoning pattern appended session=${gen} or rollout-log entry with matching Session ID) instead of any interleaved done line from a concurrent chain — prevents false skip when post-task-chain.log multiplexes multiple background runs.