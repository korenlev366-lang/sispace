# Hooks

Phase 9 hooks use controlled enforcement.

Executable hook scripts:
- `before-submit-prompt.sh`: denies prompts with clear secret-like material; allows everything else.
- `pre-tool-use.sh`: denies destructive commands, secret-bearing paths, and secret-like shell command content; warns fail-open for risky command families and in-use skill staleness.
- `post-task-adapter.sh`: maps task completion to `stop`/`sessionEnd`; invokes SDK `post-task-chain.js` when `output_tokens` ≥ 1000 (see `lib/post-task-auto-chain.md`).

Runtime rules:
- Every executable hook script must start with `#!/bin/sh`.
- Scripts must use POSIX `sh` syntax only.
- Fish syntax is forbidden in hooks.
- Broad hook failures should fail open (`failClosed: false` in `hooks.json`). Denials are explicit script decisions for destructive commands, secret paths, secret-like prompt content, and secret-like shell command content.
- Recovery: `docs/playbooks/recovering-from-bad-rule.md`.
