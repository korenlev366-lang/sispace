# cursorsi setup defaults to global Cursor hooks

- Bare `cursorsi setup` installs into `~/.cursor/` (hooks.json with `./hooks/…` paths, commands, agents, harness-* skills) and `~/.cursor-harness/` (reflection scripts + live `harness/memory` + `harness/reports`).
- Global memory is the default write target for hooks/post-task (`HARNESS_HOME` / `~/.cursor-harness`), then `SISPACE_HOME` / `~/sispace`, then the workspace.
- Applies to all Cursor workspaces on the machine; restart Cursor after install.
- Hook scripts resolve workspace via payload `cwd` / `workspace_roots` (`hooks/lib/workspace-root.sh`) so user hooks work when process cwd is `~/.cursor`.
- `cursorsi setup --project [DIR]` optionally scaffolds AGENTS.md + local harness in a repo.
- `--home-only` = credentials/settings only; `--sync-harness` refreshes `~/.cursor-harness`.
