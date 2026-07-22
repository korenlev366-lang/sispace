# cursorsi

Terminal-native Cursor / OpenRouter agent (Ink TUI), with:

- Interactive `/auth` and `/backend` pickers
- `ask_user` MCP → QuestionPicker under the prompt
- Optional project hooks + harness (`cursorsi setup`)

## Install

```bash
npm install -g cursorsi --legacy-peer-deps
# or one-shot:
npx --yes cursorsi setup
```

Requires **Node ≥ 22.5**. Use `--legacy-peer-deps` if npm complains about zod peer ranges (OpenRouter uses zod 4; optional openai peers want zod 3).

## First-time setup

In the project you want to use:

```bash
cursorsi setup          # hooks, harness, config, ~/.cursorsi
cursorsi                # start TUI
```

Inside the TUI:

1. `/auth` — store OpenRouter / Cursor / compatible keys  
2. `/backend` — pick which backend to use  
3. `/model` — pick a model  

Flags:

```bash
cursorsi setup --force           # overwrite existing hook/config files
cursorsi setup --sync-global     # also refresh ~/.cursor-harness
cursorsi setup --home-only       # only create ~/.cursorsi + settings
cursorsi setup /path/to/project
```

## What gets installed

| Path | Purpose |
|------|---------|
| `cursorsi` (global bin) | TUI + CLI |
| `cursorsi-ask-mcp` | ask_user MCP (also injected automatically for Cursor SDK turns) |
| `~/.cursorsi/` | credentials (via `/auth`) |
| `~/.config/cursorsi/` | settings (backend, model) |
| `<project>/.cursor/` | Cursor IDE hooks / commands / agents / skills |
| `<project>/harness/` | reflection chain + config |
| `<project>/config/sispace.yaml` | models, ntfy, compaction defaults |
| `<project>/.cursorsi/` | project memory + auto-skills |

## Publish (maintainers)

From the sispace monorepo:

```bash
cd cli
npm run sync:templates   # copy hooks/harness/config into templates/
npm run build
npm pack                 # inspect tarball (~300KB)
# Create a classic or granular npm token with publish + bypass 2FA:
# https://www.npmjs.com/settings/~/tokens
npm publish --access public --otp=XXXXXX
# or: NPM_TOKEN=npm_... npm publish --access public
```

`prepublishOnly` / `prepack` run sync + build automatically.

Note: Arch/CachyOS `npm` 12 may lack the `sigstore` module — use npm 10+ via `npx npm@10 publish --access public` if system npm crashes on publish.

## Develop (monorepo)

```bash
cd cli && npm install && npm run build
npm run sync:templates   # optional; setup falls back to repo root
node bin/cursorsi.mjs
```
