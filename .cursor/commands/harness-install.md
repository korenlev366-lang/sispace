# Harness Install

Human-triggered entrypoint to install the **current SISpace harness template** into a project (hooks, agents, commands, scripts, config, empty ledgers).

## What it does

From the **project root** you want wired (e.g. `linux minecraft thing`, or SISpace itself):

```sh
sh /home/lev/sispace/harness/scripts/harness-install.sh
```

Refresh everything (overwrite existing hook copies):

```sh
sh /home/lev/sispace/harness/scripts/harness-install.sh --force
```

Also update the global template used by `HARNESS_HOME` (~/.cursor-harness):

```sh
sh /home/lev/sispace/harness/scripts/harness-install.sh --sync-global
```

### Installed into the target project

| Source (SISpace template) | Destination |
| --- | --- |
| `.cursor/hooks.json` + `.cursor/hooks/` | Same (post-task adapter, pre-tool, lesson context, fixtures) |
| `.cursor/commands/` | All `harness-*` slash commands (grade, apply, curate, doctor, …) |
| `.cursor/agents/` | Reflection, grading, rollout, workflow, checker agents |
| `.cursor/skills/harness-workflow/`, `harness-reflection/` | Skills |
| `harness/config/` | Runtime policy (`harness.yaml`, `obsidian.yaml`, …) |
| `harness/scripts/` | Shell tools + compiled `dist/` (panel-actions accept/reject/apply-all, post-task-chain, doctor, retroactive-reflect) |
| `harness/scaffold/` | Empty ledgers/reports (skip if already present) |

`node_modules/` is never copied; the installer runs `npm install` + `npm run build` when `dist/` is missing.

### SISpace canonical memory

When `~/sispace/harness/memory` exists (or you pass `--sispace-home PATH`):

- **Ledgers and reports** scaffold under **SISpace**, not the target repo.
- **Hooks** in the target still run, but `post-task-adapter.sh` / `retroactive-reflect.sh` set `MEMORY_ROOT` from `SISPACE_HOME` so rollout-log, post-task-chain.log, and ledgers stay in one place.
- `harness/memory/project-index.md` in the **target** records the canonical store path.

Override:

```sh
export SISPACE_HOME=/path/to/sispace
```

TypeScript panel actions use `resolveSispaceMemoryRoot()` in `harness/scripts/src/lib/paths.ts` (same rule).

### MCP

- **Obsidian MCP** stays in **`~/.cursor/mcp.json`** (global). Do not rely on project `mcp.json` for Obsidian.
- Project `mcp.json` is copied only if missing (unless `--force`).

## Agent workflow

1. Confirm target directory (project root).
2. Run install from SISpace template path above; add `--force` only to overwrite local copies.
3. If hooks should match the live SISpace tree for all repos, add `--sync-global`.
4. Report COPY/SKIP summary and **remind user to restart Cursor**.
5. After `create-tauri-app --force` or similar scaffolders that wipe `.cursor/`, run **`harness-install.sh --force`** before continuing.

## Expected output

- `COPY` / `SKIP` lines per file
- Optional `BUILD npm install` / `npm run build` when dist was missing
- Summary counts + restart reminder
- If cross-repo: note that memory writes go to `SISPACE_HOME`
