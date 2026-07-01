# Harness Grade

Human-triggered entrypoint for grading a pending harness improvement proposal.

Use the `harness-improvement-review` skill. Read only the proposal, its cited evidence, current rules, accepted lessons, rejected lessons, and relevant plan constraints.

Expected output:
- Hard-gate result.
- Rubric score.
- Decision: accept, accept with human review, revise, or reject.
- Required rollback note for accepted proposals.

Do not create new proposals or apply accepted changes from this command.
