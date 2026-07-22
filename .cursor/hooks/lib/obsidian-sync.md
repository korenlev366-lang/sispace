# Obsidian sync (searchable index)

Repo markdown files are the **source of truth**. Obsidian vault notes under `Harness/` are an optional searchable mirror updated by the post-task chain.

- **Vault root:** your Obsidian vault path (`harness/config/obsidian.yaml` or `OBSIDIAN_VAULT_ROOT`)
- **Harness directory:** `{vault_root}/Harness/`

## Vault layout

| Folder | Repo source |
| --- | --- |
| `Harness/accepted-lessons/` | Entries from `accepted-lessons.md` |
| `Harness/rejected-lessons/` | Entries from `rejected-lessons.md` |
| `Harness/user-model/` | Entries from `user-model.md` |
| `Harness/reasoning-patterns/` | Reasoning trace from reflection |
| `Harness/rollout-log/` | Entries from `rollout-log.md` |

Config: `harness/config/obsidian.yaml`

Never store API tokens in committed files.
