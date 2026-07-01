---
source: "cursor-harness"
tags: "harness"
proposal_id: "PENDING-20260603-GNUCLIENT-LAG-DRAIN-CHECKLIST"
date: "2026-06-03"
---

Extend .agents/skills/gnuclient-dev/SKILL.md with a Lag module parity checklist: (1) onTickStart combat in try/finally that always drains when not lagging; (2) flushLag ends session only—no sync full FIFO drain; (3) at delay ≥300ms cap releaseExpired and post-flush drain per tick (stagger 1–2 C03) to avoid Grim Timer bursts; (4) attack path: session flush only, never pre-drain C03 before C02; (5) diff raven-bS tick hook + BiTrackLagNodeQueue before applying AC-safe hybrid patches.