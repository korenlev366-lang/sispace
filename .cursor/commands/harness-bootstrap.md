# Harness Bootstrap

Human-triggered entrypoint for starting harness setup or checking whether the harness is ready for the next phase.

Use the `harness-project-intake` skill first to inspect the current harness state and environment. If the user asks for a build plan after intake, hand off to `harness-planning`.

Expected output:
- Current harness phase and readiness.
- Missing files or stale stubs.
- Environment notes that affect future work.
- Recommended next command or skill.

Do not create files, enable hooks, configure MCP, or apply improvements from this command alone.
