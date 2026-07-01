---
source: "cursor-harness"
tags: "harness"
proposal_id: "PENDING-20260601-RALPH-VERIFY"
date: "2026-06-01"
---

Normalize Ralph verify storage: set ralph-goal.md verify_command to `sh harness/scripts/verify-gnu-packet-modules.sh` and add ralph-goal.sh validation that rejects verify strings with unbalanced quotes or length/complexity above a threshold, preferring existing harness/scripts/verify-*.sh paths.