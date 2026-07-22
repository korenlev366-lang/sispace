# cursorsi npm package

- Package lives in `cli/` (`name: cursorsi`); publish with `cd cli && npx npm@10 publish --access public`.
- `npm install -g cursorsi --legacy-peer-deps` then `cursorsi setup` scaffolds hooks/harness/config + generic `AGENTS.md` + `~/.cursorsi`.
- `prepublishOnly` / `prepack` run `sync:templates` + `tsc` so tarball includes `bin/`, `dist/`, `templates/`.
- `sync:templates` genericizes for public users: strips `/home/lev` paths, personal vault defaults, gtk-app skill, migration scripts; writes generic `AGENTS.md` + empty `obsidian.yaml`.
- Personal monorepo `AGENTS.md` / vault paths stay in the sispace checkout only — not shipped.
- `@cursor/sdk` is a real dependency (no sidecar path required for published installs).
- Ask-user MCP ships as `bin/ask-user-mcp.mjs` (`cursorsi-ask-mcp` bin); Cursor SDK turns inject it automatically.
