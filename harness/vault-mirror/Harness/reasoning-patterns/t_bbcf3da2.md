---
source: "cursor-harness"
tags: "harness"
proposal_id: "t_bbcf3da2"
date: "2026-06-03"
---

Researcher corrected parent-goal path drift (pipeline lives in scripts/pipeline-lib.mjs and sidecar/handlers/pipeline.mjs, not sidecar/handlers/pipeline.ts) and initially rated concurrency/OpenClaw as missing because Obsidian task note was unavailable. Architect scoped to finish wiring with FIFO auto-dequeue and HashSet-as-counter rather than redesign. Coder found most spec already implemented and surgically closed shutdown gaps (SIGTERM, process_group spawn/kill). Reviewer source-order audit surfaced async-signal-unsafe shutdown inside handlers, dequeue drop-on-error, and dual Rust/Node queue semantics as blockers despite green static wiring tests. Tester split verification into passing wiring checks plus a dedicated failing blocker script so coder has a concrete re-review gate. Remaining uncertainty: whether blank-screen and queue UX hold under real SIGTERM and three concurrent pipelines; whether signal-deferral and Node limit removal resolve production races.

## Related

- [[Harness/rollout-log/ROLLOUT-20260603-150339-sdk]]
