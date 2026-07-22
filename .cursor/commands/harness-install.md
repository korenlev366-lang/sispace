# Harness Install

Install cursorsi hooks, agents, commands, and harness scripts.

## Recommended (global — default)

```sh
cursorsi setup                 # ~/.cursor hooks/skills + ~/.cursor-harness
cursorsi setup --force         # overwrite
cursorsi setup --sync-harness  # refresh harness scripts
```

User hooks apply to **all** Cursor workspaces on this machine.

## Optional per-project scaffold

```sh
cursorsi setup --project              # cwd: AGENTS.md + local harness
cursorsi setup --project /path/to/app
```

## Manual (from a template tree)

```sh
sh path/to/harness/scripts/harness-install.sh
sh path/to/harness/scripts/harness-install.sh --force
```

### MCP

- Keep Obsidian MCP in `~/.cursor/mcp.json` (global)
- Do not commit API tokens

## After install

Restart Cursor so global hooks reload.
