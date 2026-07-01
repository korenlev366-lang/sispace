# Hook Policy Library

Shared policy notes for Phase 9 controlled enforcement.

- Phase 9 default: audit and fail-open for risky command families, skill staleness, and postTask nudges.
- Phase 9 fail-closed: destructive shell commands, secret-bearing file paths, secret-like prompts (`beforeSubmitPrompt`), secret-like content in shell commands (`preToolUse`).
- Backtests kept audit-only: package installs (`TOOL-REVISE-001`), skill staleness, broad scope prompts (`PROMPT-HUMAN-REVIEW-001`), `rm -rf` with `..` until fixtures pass (`TOOL-HUMAN-REVIEW-001`).
- Hook crashes or invalid output should not block broad workflows (`failClosed: false`).
- Do not add new deny patterns without a fixture, backtest reference, and documented reason.
