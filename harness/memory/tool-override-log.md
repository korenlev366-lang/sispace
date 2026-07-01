# Tool Override Log

Record each time `pre-tool-use.sh` (or other harness hooks) was **manually bypassed** to unblock legitimate work (for example `chmod -x .cursor/hooks/pre-tool-use.sh`).

Used by meta-harness readiness milestone 4 and `doctor-meta-readiness.sh`.

## Entry template

```markdown
### OVERRIDE-YYYYMMDD-001: [Short title]

- Date: YYYY-MM-DD
- Hook: pre-tool-use.sh | before-submit-prompt.sh | other
- Action taken: chmod -x | hooks.json disabled | pattern narrowed | other
- Reason: false positive description
- Follow-up: pending-proposal | fixed in hook | waived
```

## Entries
