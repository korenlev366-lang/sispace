# Rollout Log

Append-only record of harness self-optimization rollouts. The harness writes an entry here for every accepted proposal evaluated for rollout — including when `auto_apply.enabled` is `false` (log-only / would-have-applied).

Do not delete entries; add rollback notes in place if a rollout is reversed.

## Entry template

```markdown
### ROLLOUT-YYYYMMDD-HHMMSS-001

- Timestamp:
- Proposal ID:
- Target layer:
- Mapped category:
- Grading decision:
- Config snapshot: auto_apply.enabled=false, categories.docs=false, categories.memory=false, categories.backtests=false
- Rollout action: applied | log_only | pending_human_review | no_proposal
- Change summary:
- Files touched:
- Rollback note:
- Verification evidence:
```

## Entries

No rollout entries recorded yet.
