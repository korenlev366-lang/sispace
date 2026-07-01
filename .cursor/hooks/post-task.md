# postTask Adapter Contract

Script: `.cursor/hooks/post-task-adapter.sh`

Mapped events:
- `stop`
- `sessionEnd`

Mode: fail-open (`failClosed: false` in `hooks.json`). Invokes the SDK post-task chain in the background; does not inject model-space instructions.

Purpose:
- Drive the automatic self-learning loop after substantive sessions via `@cursor/sdk`.
- Keep the `postTask` name as a harness abstraction until Cursor documents a native event with that name.

## Threshold behavior

| `output_tokens` in hook input | Output |
| --- | --- |
| ≥ 1000 | Spawn `post-task-chain.js` (returns `{}` to hook) |
| < 1000 | Lightweight nudge only |

## SDK chain (code-space)

The adapter invokes `harness/scripts/dist/post-task-chain.js` with session context. The script:

1. Runs `Agent.prompt()` for reflection + grading (JSON)
2. Writes `latest-reflection.md`, `latest-grade.md`, `rollout-log.md`
3. Evaluates rollout gate per proposal
4. Mirrors to Obsidian via HTTP PUT
5. Runs Ralph SDK loop when active

Chain spec: `.cursor/hooks/lib/post-task-auto-chain.md`

Build: `cd ~/.cursor-harness && npm run build`

## Does not

- Inject `HARNESS_POSTTASK_AUTO_CHAIN`.
- Require `/harness-sync` (Obsidian sync is in the chain script).
- Auto-apply locked layers from the hook process.

Reason for adapter:
- Task completion is the right boundary to close the self-learning loop without model-space injection.
