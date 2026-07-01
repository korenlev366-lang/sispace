---
source: "cursor-harness"
tags: "harness"
proposal_id: "PROP-20260603-LAGRANGE-TICK-DRAIN-SKILL"
date: "2026-06-03"
---

Extend .agents/skills/gnuclient-dev/SKILL.md with a packet-queue policy subsection reflecting final session semantics: Lagrange combat on onTickStart (before C03), flushLag session-only (Raven forceTimeOut), releaseExpiredPackets drains all FIFO-expired per tick, no pre-attack C03 burst; blatant Raven all-outbound queue (not AC-safe hybrid); InboundLagCoordinator inbound ownership; cross-link gnu client/Decision - Lagrange tick and drain parity.md. Supersedes stale hold-only wording in PENDING-20260603-GNUCLIENT-QUEUE-POLICY at apply time.