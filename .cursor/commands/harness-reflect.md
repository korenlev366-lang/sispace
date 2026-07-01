# Harness Reflect

Human-triggered entrypoint for reflecting on a completed and verified harness task.

Use the `harness-reflection` skill. If verification evidence is missing, use `harness-verification` first and return here only after the task outcome is clear.

Expected output:
- Task outcome summary.
- Evidence used for reflection.
- At most one improvement proposal per observed lesson.
- `No proposal` when evidence does not justify a durable lesson.

Do not grade, accept, reject, or apply proposals from this command.
