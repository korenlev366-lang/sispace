---
source: "cursor-harness"
tags: "harness"
proposal_id: "PENDING-20260603-GNUCLIENT-LAG-SKILL-REVISE-STAGGER"
date: "2026-06-03"
---

Revise .agents/skills/gnuclient-dev/SKILL.md Lag parity checklist before applying PENDING-20260603-GNUCLIENT-LAG-DRAIN-CHECKLIST: delete ≥300ms stagger-cap bullets (03-28-05 proved worse); add velocity-dummy benchmark invariants (gate on currentTarget != null only per raven-bS LagRange, no sendSwing on C02 intercept); add blatant anti-patterns (no C03-only queue, no 1/tick release cap, no queue cap/eviction, no cancel-on-KB abort, no KD abortLagNow on every S12); require LagrangeOutboundTrack session marker + session-only flushLag + forward PacketEvents LOWEST-last before any stagger experiment; cross-link Decision - Lagrange UnifiedLagTrack revert stagger.md.