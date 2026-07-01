# Harness Curate

Human-triggered entrypoint for periodic skill consolidation and archiving proposals.

Use `harness-project-intake` to inventory current skills, accepted lessons, rejected lessons, pending proposals, and `harness/memory/user-model.md`. Use `harness-planning` only if the user asks for a curation plan.

Expected output:
- Skills that appear stale, overlapping, oversized, or unused.
- Evidence for each curation suggestion.
- Recommended action: keep, consolidate, archive proposal, or needs review.
- Target layer for each recommendation.
- Rollback note for any proposed archive or consolidation.

Do not edit, delete, archive, or merge skill files from this command. Any curation change must become an inactive pending proposal, pass `harness-improvement-review`, and use `harness-apply` before files change.
