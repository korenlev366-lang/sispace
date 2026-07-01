# Harness Config

## obsidian.yaml

Obsidian vault root and vault-relative `Harness/` folder paths. Shell scripts must quote `vault_root` because it contains a space (`/home/lev/harness vault`).

Helper: `sh harness/scripts/obsidian-vault-path.sh` prints `OBSIDIAN_VAULT_ROOT`, `OBSIDIAN_HARNESS_DIR`.

## harness.yaml

Phase 10 self-optimization controls.

### auto_apply

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` (project default) | Master switch. When `false`, eligible rollouts are log-only. |
| `categories.docs` | `true` (project default) | Auto-apply documentation changes when master is on. |
| `categories.memory` | `true` (project default) | Auto-apply memory ledger updates when master is on. |
| `categories.backtests` | `true` (project default) | Auto-apply backtest case additions when master is on. |

### locked_categories

Rules, hooks, skills, commands, mcp, and user-model **never** auto-apply. The rollout gate enforces this even if the YAML is edited incorrectly.

### Opt-in example

```yaml
auto_apply:
  enabled: true
  categories:
    docs: true
    memory: false
    backtests: false
```

Even with `enabled: true`, locked layers still require `/harness-apply` and human review.

## thresholds.yaml

Grading score model and decision bands (documentation until an executable grader exists).

## environments.yaml

Machine-local environment notes (not committed secrets).
