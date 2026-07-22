# cursorsi

Terminal-native Cursor / OpenRouter agent (Ink TUI), with:

- Interactive `/auth` and `/backend` pickers
- `ask_user` MCP → QuestionPicker under the prompt
- Optional project hooks + harness (`cursorsi setup`)

## Install

```bash
npm install -g cursorsi --legacy-peer-deps
cursorsi setup          # once per machine → ~/.cursor hooks/skills
cursorsi                # start TUI
```

Requires **Node ≥ 22.5**. Use `--legacy-peer-deps` if npm complains about zod peer ranges (OpenRouter uses zod 4; optional openai peers want zod 3).

## First-time setup

```bash
cursorsi setup                 # global: ~/.cursor + ~/.cursor-harness + ~/.cursorsi
cursorsi setup --project       # optional: AGENTS.md + local harness in this repo
cursorsi
```

Inside the TUI:

1. `/auth` — store OpenRouter / Cursor / compatible keys  
2. `/backend` — pick which backend to use  
3. `/model` — pick a model  

Flags:

```bash
cursorsi setup --force              # overwrite existing global files
cursorsi setup --sync-harness       # refresh ~/.cursor-harness scripts
cursorsi setup --home-only          # only ~/.cursorsi + settings
cursorsi setup --project            # also scaffold cwd
cursorsi setup --project /path/app  # scaffold a specific project
```

## What gets installed

| Path | Purpose | When |
|------|---------|------|
| `cursorsi` (global bin) | TUI + CLI | `npm install -g` |
| `cursorsi-ask-mcp` | ask_user MCP | `npm install -g` |
| `~/.cursor/hooks.json` + `hooks/` | Cursor user hooks (all workspaces) | `cursorsi setup` |
| `~/.cursor/skills/harness-*` | Global skills | `cursorsi setup` |
| `~/.cursor-harness/` | Scripts + **global** `harness/memory` + `harness/reports` | `cursorsi setup` |
| `~/.cursorsi/` | credentials (via `/auth`) | `cursorsi setup` |
| `~/.config/cursorsi/` | settings (backend, model) | `cursorsi setup` |
| `<project>/AGENTS.md`, `harness/`, … | Project scaffold | `cursorsi setup --project` |

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
