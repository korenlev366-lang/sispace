# SISpace

Self-improvement task orchestration workspace — a native GTK4 desktop app (`sispace-gtk`) paired with **cursorsi**, an agentic TUI CLI, sharing a self-improving `harness/` system underneath.

> **v3.** SISpace was originally a Tauri + React app (v1). It has since migrated to a native GTK4 Rust frontend — no React webview. The root `package.json` still exists, but only as the test/verify runner and build orchestration layer for cursorsi and packaging; it no longer runs Tauri.

---

## What's in this repo

| Component | Path | What it is |
|---|---|---|
| **SISpace desktop app** | `gtk-app/`, `sispace-core/` | Native GTK4 (`gtk4-rs`, `libadwaita`, `vte4`) desktop app. Cargo package: **`sispace-gtk`**. `sispace-core` is the shared DB/services layer — SQLite, task/session models, pane/terminal management, SISwarm, Obsidian sync. |
| **cursorsi** | `cli/` | Ink/React agentic TUI CLI — an interactive coding agent, runnable standalone in a terminal or embedded as a pane inside SISpace. Dual backend: **OpenRouter** (default; automated/subagent work) or the **Cursor SDK** (foreground sessions, real Cursor models with per-model parameter selection). |
| **Sidecar** | `sidecar/` | Node service hosting the `@cursor/sdk` dependency and cursor-agent handlers used by the GTK app / cursorsi integration. |
| **Node host** | `lib/node-server.mjs` → `lib/pipeline-run.mjs` | The live sidecar entry point spawned by the GTK app (`node_host.rs`). `scripts/pipeline-lib.mjs` is shared helpers only, not the live entry — see `SISPACE_PLAN.md`. |
| **Harness** | `harness/` | Self-improvement system: reflection/grading loop, accepted/pending/rejected lesson ledger, rollout log, Obsidian-backed memory (`harness/vault-mirror/`), `.cursor/` agent + hook definitions. |
| **Tests** | `tests/` | Verification scripts and unit tests for cursorsi, the pipeline, and SISpace GTK4 phases. |

---

## Current state

**SISpace desktop app** (Phase 6 baseline)
- Agent chat — dynamic row heights fix overlapping long outputs
- Sidecar watchdog — auto-restarts node sidecar on `/ping` failure (max 3 retries)
- Stale agent recovery — Resume or Abandon prompt after 30 min idle in `in_progress`
- Reflection timeout — 5 min cap; task moves to `reflected` with timeout note
- Settings — harness-doctor report + meta-harness readiness milestones

**cursorsi**
- Backend toggle (`/backend openrouter` / `/backend cursor`) — verified end-to-end; automated/subagent work stays on OpenRouter to protect Cursor quota, foreground sessions can run on real Cursor models
- Cursor model picker — live catalog via `Cursor.models.list()`, fully backend-aware (no ID leakage between OpenRouter's dot-namespace and Cursor's hyphen-namespace)
- Per-model parameter editor — Tab to open, arrows to highlight, Space to commit, matching Cursor CLI's UX (context / effort / reasoning / thinking / fast)
- Crash logging — fatal errors (uncaught exceptions, unhandled rejections, Ink render failures) persist to `~/.config/cursorsi/crash.log` instead of silently killing the terminal panel
- Fixed: clipboard copy (Ctrl+Shift+C) EPIPE crash on large session buffers

**In progress / not yet built**
- Concurrent-agent file-locking (prevents two cursorsi agents editing the same file from racing)
- Tiered subagent model routing (flash → pro → GLM 5.2 ceiling)
- SI J.A.R.V.I.S voice orchestration layer — design only, no code yet

---

## Develop

**SISpace desktop app**
```bash
cargo build --release -p sispace-gtk
# binary: target/release/sispace-gtk
```

**cursorsi**
```bash
npm run cursorsi:build     # = npm run build --prefix cli
export OPENROUTER_API_KEY=...   # required for OpenRouter backend (default)
export CURSOR_API_KEY=...       # required for Cursor backend (/backend cursor)
npm run cursorsi            # = sh cli/run.sh
```

**Node sidecar** (spawned automatically by the GTK app; run manually for debugging)
```bash
npm run node-host           # = node lib/node-server.mjs
```

---

## Package

```bash
npm run package
# = npm run cursorsi:build && sh scripts/package-gtk.sh
```

Arch packaging lives in `packaging/PKGBUILD` — builds `sispace-gtk` via `cargo build --release` and bundles the built cursorsi CLI alongside it, installing both `sispace-gtk` and `cursorsi` to `/usr/bin`. See `packaging/PKGBUILD` for the exact build/package steps and `packaging/dev.lev.sispace.desktop.in` for the desktop entry.

---

## Architecture references

- [SISPACE_PLAN.md](./SISPACE_PLAN.md) — pipeline runtime path (invariant): `node_host.rs` → `lib/node-server.mjs` → `lib/pipeline-run.mjs`; any pipeline behavior change must touch `lib/` and pass `tests/pipeline-model.test.mjs`
- [SISPACE_V2_PLAN.md](./SISPACE_V2_PLAN.md) — pane orchestration (Unix-socket `--event-socket` NDJSON + `PaneIpcHub`)
- [SISPACE_GTK4_PLAN.md](./SISPACE_GTK4_PLAN.md) — GTK4 migration plan
- [CURSORSI_CLI_PLAN.md](./CURSORSI_CLI_PLAN.md) — cursorsi architecture
- [AGENTS.md](./AGENTS.md) — agent/harness conventions

---

## Security

This repo is **private**. Never commit API keys, `.env` files, or the launch script — `~/.local/bin/sispace-launch.sh` stays outside the repo and is gitignored. See `.gitignore` for the full exclusion list.
