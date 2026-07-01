# Hook Scoring Notes

Phase 5 hooks do not score proposals.

For hook policy changes, review proposed patterns with these checks:

- True positive: would block a real destructive command or secret exposure.
- False positive risk: could block harmless search, docs, or verification.
- Cost: runs in constant time over stdin text.
- Reversibility: pattern can be removed without changing hook registration.
