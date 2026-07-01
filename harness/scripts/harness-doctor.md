# Harness Doctor Script

Read-only audit invoked by `/harness-doctor` and agents following `.cursor/commands/harness-doctor.md`.

## Run

```sh
sh harness/scripts/harness-doctor.sh
sh harness/scripts/harness-doctor.sh /path/to/project
```

From the harness template repo or any project with `harness/` installed. Exit code is always `0` (reporting only).

## MCP audit (global + project)

The script checks **both** MCP config locations:

| Location | Path |
| --- | --- |
| Global | `~/.cursor/mcp.json` |
| Project-local | `<PROJECT_ROOT>/.cursor/mcp.json` |

For each file that exists, it reports whether an `"obsidian"` server entry is present and whether credentials use `OBSIDIAN_API_KEY` env interpolation vs a literal bearer token (warn only; never prints secret values).

**Obsidian MCP status**

- **HEALTHY** — Obsidian server entry found in **either** global or project-local config (or both).
- **UNHEALTHY** — Neither file contains an Obsidian server entry.

An empty project-local `mcpServers: {}` is normal when Obsidian lives in `~/.cursor/mcp.json` only. Do not treat empty project MCP as unhealthy if global has Obsidian.

## Other sections

- **Hooks** — `hooks.json` and `pre-tool-use.sh` presence/executable bit on the project root.
- **Meta-harness readiness** — delegates to `doctor-meta-readiness.sh` (four milestones; see `docs/meta-harness-readiness.md`).

## Agent instructions

When running `/harness-doctor`:

1. Run `sh harness/scripts/harness-doctor.sh` from the project root (or pass the path).
2. Include the full script output in the report.
3. For MCP, state **HEALTHY** or **UNHEALTHY** using the global-or-project rule above — not project-local alone.
4. Do not edit files, enable hooks, or change MCP config from this command.

## Related

- Command: `.cursor/commands/harness-doctor.md`
- Obsidian setup: `docs/obsidian-setup.md`
- Meta milestones: `docs/meta-harness-readiness.md`
