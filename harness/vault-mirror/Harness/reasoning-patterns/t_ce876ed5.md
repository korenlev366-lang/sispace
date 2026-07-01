---
source: "cursor-harness"
tags: "harness"
proposal_id: "t_ce876ed5"
date: "2026-06-03"
---

Direction was fixed upfront by architect phased spec (A–D) with a 10-row verification table and explicit out-of-scope list (GNUClient, PROP-004, git commits). Coder executed mirror→build→copy for TS changes from $HARNESS_HOME, documented locked-layer edits in three ROLLOUT-20260603-PORT-* entries, and fell back to direct vault write when Obsidian MCP was unavailable. The approach worked because each phase had scripted pass criteria and specialist agents (reviewer/tester) independently re-ran the same commands rather than trusting coder self-report alone. Remaining uncertainty: Layer-3 checker dispatch was verified statically in dist/SDK source only—no live E2E pipeline run with CURSOR_API_KEY despite key being set. Reviewer nits (stale accepted-lessons placeholder, minecraft jar grep fixture in verify-harness-commands.sh line 142, PENDING vs ACCEPTED naming for RETRO-DONE-GUARD) were noted but not fixed in-session.