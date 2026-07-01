### ACCEPTED-CURATE-MEMORY-DISTILL:: Accepted-lessons template alignment

- Source task: /harness-apply PENDING-CURATE-MEMORY-DISTILL (harness-curate re-grade 2026-06-03)
- Reason: Required Fields block did not match live entry shape; template-only fix per grade 86
- Target layer: memory
- Date: 2026-06-03
- Rollback note: Revert `## Required Fields` and `## Template` in accepted-lessons.md from git
- Applied change: Updated Required Fields and Template; Applied change and Verification evidence required; Scope/Recall optional
- Verification evidence: `grep -q 'Applied change:' harness/memory/accepted-lessons.md`; `grep -q 'Verification evidence:' harness/memory/accepted-lessons.md`
