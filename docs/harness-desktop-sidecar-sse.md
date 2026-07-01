# Desktop Sidecar SSE Bridge

Canonical reference for integrating the harness workflow SDK into a Tauri/desktop app via a Node sidecar and Server-Sent Events (SSE). SISpace implements this pattern end-to-end.

## Architecture

Three tiers:

1. **Node sidecar** — imports compiled harness dist, runs `runSpecialistPipeline()` (or equivalent), streams progress as SSE.
2. **Rust blocking consumer** — POSTs to the sidecar, reads `data:` lines from the response body, persists messages to SQLite.
3. **UI** — subscribes to framework events (Tauri `agent-pipeline`) and renders streamed agent steps in React.

Do not call the harness SDK directly from Rust; the sidecar owns orchestration and credential handling.

## Sidecar

- **Live sidecar entry:** Tauri/GTK spawns `lib/node-server.mjs` → `lib/pipeline-run.mjs` (see `sispace-core/src/services/node_host.rs`, `package.json` `node-host`). **`scripts/pipeline-lib.mjs` is shared helpers only** (harness lib resolution, skill bundles) — not the spawned host.
- **Harness lib resolution:** `resolveHarnessLib()` in `scripts/pipeline-lib.mjs` returns `harness/scripts/dist/lib` under the project root (or `HARNESS_HOME` when mirrored).
- **Endpoint:** `POST /pipeline/run` on the Node host (`lib/node-server.mjs`, default port 3847).
- **Response:** `Content-Type: text/event-stream`; each event is `data: <json>\n\n`.
- **Pipeline:** `runPipelineStreaming()` dynamically imports `workflow-sdk.js` and `agent-definitions.js` from the resolved lib dir.

## Rust consumer

In `sispace-core/src/services/pipeline_client.rs`:

- Set **`Accept: text/event-stream`** and **`Content-Type: application/json`** on the POST.
- Serialize the body with **`serde_json::to_string`** and pass it via **`.body(body_str)`**.
- **Do not** use `reqwest::RequestBuilder::json()` on streaming POSTs — it can break SSE consumption and content negotiation.

```rust
let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
let response = client
    .post(url)
    .header("Accept", "text/event-stream")
    .header("Content-Type", "application/json")
    .body(body_str)
    .send()
    .map_err(|e| e.to_string())?;
```

## Parsing and relay

- Read the response line-by-line; process lines starting with `data: `.
- Parse JSON payloads; persist agent messages to SQLite (`messages` table).
- Emit Tauri events (e.g. `agent-pipeline`) so React `TaskPanel` / `AgentChat` update live.

## Canonical references (SISpace)

| Component | Path |
| --- | --- |
| Sidecar host | `lib/node-server.mjs` |
| Pipeline streaming | `lib/pipeline-run.mjs` |
| Model resolution | `lib/pipeline-models.mjs` |
| Shared helpers | `scripts/pipeline-lib.mjs` |
| Rust SSE client | `sispace-core/src/services/pipeline_client.rs` |
| Harness dist (project) | `harness/scripts/dist/lib/workflow-sdk.js` |
| UI consumers | `gtk-app/` task/pipeline views |

## Verification

No live `CURSOR_API_KEY` is required to validate wiring:

```bash
cd /home/lev/sispace
cargo test --lib
npm run build
curl -s http://127.0.0.1:3847/ping   # pong (sidecar must be running)
```

Complements project-specific `SISPACE_PLAN.md` and accepted lesson PROP-20250603-003.
