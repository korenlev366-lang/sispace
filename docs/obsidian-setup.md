# Obsidian setup (SISpace + harness)

This guide wires Obsidian into SISpace and the self-improving harness: vault mirroring after long sessions, lesson recall at session start, and MCP tools for agents.

Repo markdown under `harness/memory/` stays the **source of truth**. Obsidian notes are a searchable mirror — see [obsidian-sync.md](../.cursor/hooks/lib/obsidian-sync.md) and [harness-knowledge-graph.md](./harness-knowledge-graph.md).

---

## API keys — what is required?

| Variable | Required? | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | **Yes** | Default cursorsi backend (OpenRouter). Also used by harness subagents, lesson compression, and most automated agent work. Format: `sk-or-v1-…` |
| `CURSOR_API_KEY` | **No** | Only when you explicitly use the Cursor backend (`/backend cursor` in cursorsi) or Cursor SDK paths that bill against your Cursor account. Normal day-to-day use does **not** need this. |
| `OBSIDIAN_API_KEY` | Optional | Bearer token from the Obsidian Local REST API plugin. Required for Obsidian REST sync, MCP tools, and session-start lesson injection. Without it, the rest of SISpace still runs — Obsidian features are simply skipped. |

Optional override:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OBSIDIAN_API_URL` | `http://127.0.0.1:27123` | REST base URL if you use a non-default port or HTTPS |

**Never commit keys.** Keep them in your shell environment or a local file outside the repo (see below). See also the [Security](../README.md#security) section in the root README.

---

## 1. Install Obsidian and the Local REST API plugin

1. Install [Obsidian](https://obsidian.md/) and open it.
2. **Settings → Community plugins → Browse** → search **Local REST API** (by coddingtonbear).
3. Install and **Enable** the plugin.
4. In **Settings → Local REST API**:
   - Turn on **Enable HTTP server** (non-encrypted) so clients can reach `http://127.0.0.1:27123` without trusting a self-signed TLS cert. SISpace and the harness default to this HTTP endpoint.
   - Copy your **API key** from the same settings page. This becomes `OBSIDIAN_API_KEY`.

Obsidian must be running with the vault open while you use REST/MCP.

Quick smoke test (no auth):

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:27123/
# expect 200
```

With auth (replace the placeholder):

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer YOUR_OBSIDIAN_KEY" \
  http://127.0.0.1:27123/
# expect 200
```

---

## 2. Point the harness at your vault

Edit `harness/config/obsidian.yaml`:

```yaml
vault_root: "/path/to/your/vault"
vault_prefix: Harness
```

- `vault_root` — absolute path to the Obsidian vault root (quote paths with spaces).
- `vault_prefix` — subdirectory under the vault where harness mirror notes live (default `Harness/`).

SISpace task notes sync to `SISpace/tasks/` under the same vault root (see [obsidian-task-schema.md](./obsidian-task-schema.md)).

Shell helper to print resolved paths:

```sh
eval "$(sh harness/scripts/obsidian-vault-path.sh)"
echo "$OBSIDIAN_VAULT_ROOT"
echo "$OBSIDIAN_HARNESS_DIR"
```

Create the harness folder if it does not exist yet:

```sh
mkdir -p "$OBSIDIAN_HARNESS_DIR"
mkdir -p "$OBSIDIAN_VAULT_ROOT/SISpace/tasks"
```

---

## 3. Set environment variables

Use a **local secrets file outside the repo** — never commit it.

Suggested locations:

| Shell | File |
| --- | --- |
| bash | `~/.config/sispace/env.sh` (source from `~/.bashrc`) |
| fish | `~/.config/fish/conf.d/sispace-env.fish` |

### bash

Create `~/.config/sispace/env.sh`:

```bash
# SISpace / cursorsi / harness — local only, do not commit

# Required — get from https://openrouter.ai/keys
export OPENROUTER_API_KEY='sk-or-v1-REPLACE_ME'

# Optional — from Obsidian → Settings → Local REST API
export OBSIDIAN_API_KEY='REPLACE_ME'

# Optional — only if you use /backend cursor or Cursor SDK billing
# export CURSOR_API_KEY='REPLACE_ME'

# Optional — only if not using default port/host
# export OBSIDIAN_API_URL='http://127.0.0.1:27123'
```

Source it from `~/.bashrc`:

```bash
[ -f "$HOME/.config/sispace/env.sh" ] && . "$HOME/.config/sispace/env.sh"
```

One-off for a single terminal session:

```bash
export OPENROUTER_API_KEY='sk-or-v1-REPLACE_ME'
export OBSIDIAN_API_KEY='REPLACE_ME'
```

### fish

Create `~/.config/fish/conf.d/sispace-env.fish`:

```fish
# SISpace / cursorsi / harness — local only, do not commit

# Required
set -gx OPENROUTER_API_KEY 'sk-or-v1-REPLACE_ME'

# Optional — Obsidian Local REST API key
set -gx OBSIDIAN_API_KEY 'REPLACE_ME'

# Optional — Cursor backend only
# set -gx CURSOR_API_KEY 'REPLACE_ME'

# Optional
# set -gx OBSIDIAN_API_URL 'http://127.0.0.1:27123'
```

Fish loads `conf.d/*.fish` automatically on startup. For a one-off session:

```fish
set -x OPENROUTER_API_KEY 'sk-or-v1-REPLACE_ME'
set -x OBSIDIAN_API_KEY 'REPLACE_ME'
```

To persist a universal fish variable (survives reboot):

```fish
set -Ux OPENROUTER_API_KEY 'sk-or-v1-REPLACE_ME'
set -Ux OBSIDIAN_API_KEY 'REPLACE_ME'
```

### Arch / systemd user session (optional)

If you launch GUI apps from a desktop session and they need the same vars, you can also put exports in `~/.config/environment.d/*.conf` (systemd user environment). Reload or re-login after editing.

---

## 4. Wire Cursor MCP (for agent Obsidian tools)

Agents reach Obsidian through Cursor’s MCP config. Prefer **global** config so harness-install does not wipe it:

**`~/.cursor/mcp.json`**

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "http://127.0.0.1:27123/mcp/",
      "headers": {
        "Authorization": "Bearer ${env:OBSIDIAN_API_KEY}"
      }
    }
  }
}
```

Use `${env:OBSIDIAN_API_KEY}` — do **not** paste the raw bearer token into `mcp.json`.

**Project-local override:** If `.cursor/mcp.json` exists in this repo with an empty `"mcpServers": {}`, it **overrides** global config and MCP tools disappear. Either delete the project file (inherit global) or populate it with the same `obsidian` entry above.

After any MCP config change: **restart Cursor** (or reload MCP) before expecting tools in the agent.

cursorsi and the OpenClaw hybrid harness path can also inject a temporary inline MCP config when `OBSIDIAN_API_KEY` is set — no manual `mcp.json` edit required for those subprocesses.

---

## 5. Verify

From the repo root:

```sh
# Static integration checks (REST smoke runs only when OBSIDIAN_API_KEY is set)
sh harness/scripts/verify-obsidian-integration.sh

# MCP config audit (global + project)
sh harness/scripts/harness-doctor.sh
```

Run cursorsi (OpenRouter backend — no Cursor key needed):

```sh
npm run cursorsi:build
npm run cursorsi
```

Inside cursorsi, `/backend` should show `openrouter` by default. Obsidian-backed tools and lesson context activate when `OBSIDIAN_API_KEY` is set and Obsidian is running.

Optional vault graph check after a synced post-task chain:

```sh
node tests/verify-obsidian-vault-graph.mjs
```

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Authorization required` from REST/MCP | Missing or wrong `OBSIDIAN_API_KEY` | Copy key from Obsidian plugin settings; re-export env var |
| REST returns connection refused | Obsidian not running or HTTP server disabled | Open Obsidian; enable HTTP server in plugin settings |
| `harness-doctor` HEALTHY but MCP tools empty | Empty project `.cursor/mcp.json` overrides global | Populate obsidian entry or delete project file; restart Cursor |
| Lesson context never appears | `OBSIDIAN_API_KEY` unset | Export key; confirm vault paths in `obsidian.yaml` |
| OpenRouter errors on startup | `OPENROUTER_API_KEY` missing/invalid | Set `sk-or-v1-…` key — this one is **required** |
| Cursor model picker empty | `CURSOR_API_KEY` unset | Expected unless you use Cursor backend — not required for default OpenRouter use |

---

## Related docs

- [obsidian-task-schema.md](./obsidian-task-schema.md) — task note frontmatter and sections
- [harness-knowledge-graph.md](./harness-knowledge-graph.md) — how vault links connect entities
- [meta-harness-readiness.md](./meta-harness-readiness.md) — harness health milestones
- [obsidian-sync.md](../.cursor/hooks/lib/obsidian-sync.md) — mirror layout and sync triggers
