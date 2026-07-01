# Obsidian sync (searchable index)

Repo markdown files are the **source of truth**. Obsidian vault notes under `Harness/` are a searchable mirror updated automatically by the post-task SDK chain.

- **Vault root:** `/home/lev/harness vault` (from `harness/config/obsidian.yaml`)
- **Harness directory:** `/home/lev/harness vault/Harness/`

## Vault layout

| Folder | Repo source |
| --- | --- |
| `Harness/accepted-lessons/` | Entries from `accepted-lessons.md` |
| `Harness/rejected-lessons/` | Entries from `rejected-lessons.md` |
| `Harness/user-model/` | Entries from `user-model.md` |
| `Harness/reasoning-patterns/` | Reasoning trace from reflection |
| `Harness/rollout-log/` | Entries from `rollout-log.md` |
| `SISpace/tasks/` | Kanban task notes (`t_*.md`) from SISpace task create |

Config: `harness/config/obsidian.yaml`

Synced harness notes append a `## Related` section with path-qualified wikilinks (e.g. rollout → accepted/rejected lesson, reasoning → rollout).

**Graph rules:** Which entities may link to which (and what to avoid) — [docs/harness-knowledge-graph.md](../../../docs/harness-knowledge-graph.md).

## When to sync

**Automatic:** `post-task-chain.ts` mirrors rollout, reasoning, and accepted/rejected lesson entries via HTTP PUT after each long session.

**Manual:** Edit repo ledgers directly; re-run the post-task chain dry-run or copy notes if you need a one-off mirror.

After changing link logic in `post-task-chain.ts` or `obsidian.ts`: rebuild `harness/scripts/dist/`, run one post-task chain with `OBSIDIAN_API_KEY` set, then `node tests/verify-obsidian-vault-graph.mjs`. Pre-existing vault notes are not auto-backfilled.

## Session-start recall (beforeSubmitPrompt)

`obsidian-lesson-context.sh` queries `POST .../search/simple/?query=...&contextLength=...` and injects top 3 `Harness/` and `SISpace/tasks/` matches as `additional_context` when available.

Never store API tokens in committed files.
