# Harness Install

Install cursorsi / harness hooks, agents, commands, and scripts into a project.

## Recommended

From the project root:

```sh
cursorsi setup
cursorsi setup --force           # overwrite existing copies
cursorsi setup --sync-global     # also refresh ~/.cursor-harness
```

## Manual (from a template tree)

```sh
sh path/to/harness/scripts/harness-install.sh
sh path/to/harness/scripts/harness-install.sh --force
sh path/to/harness/scripts/harness-install.sh --sync-global
```

### Installed into the target project

| Source | Destination |
| --- | --- |
| `.cursor/hooks.json` + `.cursor/hooks/` | Same |
| `.cursor/commands/` | `harness-*` slash commands |
| `.cursor/agents/` | Reflection, grading, workflow, checker agents |
| `.cursor/skills/harness-*` | Skills |
| `harness/config/` | Runtime policy |
| `harness/scripts/` | Shell tools + compiled `dist/` |
| `harness/scaffold/` | Empty ledgers/reports (skip if present) |

`node_modules/` is never copied; the installer runs `npm install` + `npm run build` when `dist/` is missing.

### Canonical memory (optional)

When `SISPACE_HOME` is set (or `~/sispace/harness/memory` exists):

- Ledgers and reports can live in that canonical store
- Project hooks still run locally

```sh
export SISPACE_HOME=/path/to/canonical-harness-home
```

### MCP

- Keep Obsidian MCP in `~/.cursor/mcp.json` (global)
- Do not commit API tokens

## After install

Restart Cursor (or start a new agent session) so hook changes load.
