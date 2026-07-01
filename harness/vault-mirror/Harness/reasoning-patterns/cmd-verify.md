---
source: "cursor-harness"
tags: "harness"
proposal_id: "cmd-verify"
date: "2026-06-03"
---

No transcript or user deliverables — inferred from harness context only. verify-harness-commands.sh drives the long-session path with a fixed synthetic payload. Foreground assertions (parseable JSON, no HARNESS_POSTTASK_AUTO_CHAIN) are the CI pass condition; background SDK orchestration runs detached and logs rollouts. gate=no_proposal with proposal=null is the designed success outcome for this infrastructure self-test, not a regression. Durable verify approach already captured in PATTERN-20260601-224913 and subsequent cmd-verify patterns.