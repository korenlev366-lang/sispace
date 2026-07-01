# SISpace

Self-improvement task orchestration desktop app (Tauri + React + harness).

## Phase 6 (current)

- **Agent chat** — dynamic row heights fix overlapping long outputs
- **Sidecar watchdog** — auto-restarts node sidecar on `/ping` failure (max 3 retries)
- **Stale agent recovery** — Resume or Abandon prompt after 30 min idle in `in_progress`
- **Reflection timeout** — 5 min cap; task moves to `reflected` with timeout note
- **Settings** — harness-doctor report + meta-harness readiness milestones
- **Packaging** — `npm run package` → artifacts in `dist/` + AUR `PKGBUILD`

## Develop

```bash
npm install
export CURSOR_API_KEY=...
npm run tauri dev
```

## Package

```bash
npm run package
# dist/sispace-0.1.0 (binary), .deb if bundled, PKGBUILD for AUR
```

## Plan

See [SISPACE_PLAN.md](./SISPACE_PLAN.md) — **Pipeline runtime path (invariant)**: Tauri spawns lib/node-server.mjs → lib/pipeline-run.mjs; scripts/pipeline-lib.mjs is shared helpers only and is not the live sidecar entry; any pipeline behavior change must touch lib/ and pass tests/pipeline-model.test.mjs assertions on lib/ wiring. **Pipeline operator guide**: live runtime map (`node_host.rs` → `lib/node-server.mjs` → `lib/pipeline-run.mjs`), slim SSE contract (`step_content` DB-only; metadata-only `step_done` to UI), release build + restart checklist.

V2 pane orchestration: [SISPACE_V2_PLAN.md](./SISPACE_V2_PLAN.md) (Unix-socket `--event-socket` NDJSON + `PaneIpcHub`).
