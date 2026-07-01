# Post-Task Auto Chain (SDK)

Triggered when `post-task-adapter.sh` reports **output_tokens ≥ 1000**. The hook runs `harness/scripts/post-task-chain.ts` (compiled to `dist/post-task-chain.js`) via Node — **no model-space injection**.

## Runtime flow

0. Reflection agent reads `harness/memory/goals.md` for active goals and records **Goal advancement** in `latest-reflection.md` (see `.cursor/skills/harness-reflection/reflection-template.md`).
1. `post-task-adapter.sh` parses hook payload (`session_id`, `output_tokens`, optional `transcript_path`).
2. Adapter invokes the SDK chain script from `~/.cursor-harness` (or project copy):
   - `Agent.create({ agents })` orchestrator: reflection-agent → grading-agent → rollout-agent (structured JSON per step)
   - Writes `harness/reports/latest-reflection.md`, `latest-grade.md`, `rollout-log.md`
   - Runs `rollout-gate.sh` logic for eligible proposals
   - Mirrors new entries to Obsidian via HTTP PUT (Local REST API)
3. Ralph loop (`ralph-agent-loop.js`) runs when `harness/memory/ralph-goal.md` status is `active`.
4. Hook returns `{}` for long sessions (background chain already ran).

### Step 4b — Obsidian mirror

After writing repo ledgers (`rollout-log.md`, `accepted-lessons.md`, `rejected-lessons.md`, reasoning patterns), the chain mirrors new entries to the vault via HTTP PUT (Local REST API). Paths include `Harness/accepted-lessons/`, `Harness/rejected-lessons/`, `Harness/reasoning-patterns/`, and `Harness/rollout-log/` under the vault root from `harness/config/obsidian.yaml`. See `.cursor/hooks/lib/obsidian-sync.md`.

## Credentials (env, read by adapter shell)

- Cursor agent: `CURSOR_API_KEY`
- Obsidian REST: `OBSIDIAN_API_KEY`, optional `OBSIDIAN_API_URL` (default `http://127.0.0.1:27123`)

## Build

```sh
cd ~/.cursor-harness && npm install && npm run build
```

Projects receive compiled `harness/scripts/dist/` via `harness-install.sh`.

## Do not

- Re-introduce `HARNESS_POSTTASK_AUTO_CHAIN` injection.
- Require `/harness-sync` for Obsidian mirroring (sync is automatic in the chain script).
- Auto-apply locked layers (rules, hooks, skills, commands, mcp, user-model).
