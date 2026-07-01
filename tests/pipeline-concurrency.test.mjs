/**
 * Unit tests for pipeline concurrency config and queue semantics.
 * Run: node --test tests/pipeline-concurrency.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadMaxConcurrentPipelines } from "../scripts/pipeline-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

describe("loadMaxConcurrentPipelines", () => {
  it("reads max_concurrent_pipelines from config/sispace.yaml", () => {
    const yaml = readFileSync(path.join(repoRoot, "config", "sispace.yaml"), "utf8");
    assert.match(yaml, /max_concurrent_pipelines:\s*5/);
    assert.equal(loadMaxConcurrentPipelines(), 5);
  });
});

describe("Rust pipeline queue wiring (static)", () => {
  it("agent_start returns queued result shape in TaskPanel types", () => {
    const taskPanel = readFileSync(
      path.join(repoRoot, "src", "components", "agent", "TaskPanel.tsx"),
      "utf8",
    );
    assert.match(taskPanel, /result\.queued/);
    assert.match(taskPanel, /Queued \(#\$\{queuePosition\}\)/);
  });

  it("KanbanBoard renders queue badge when not running", () => {
    const kanban = readFileSync(
      path.join(repoRoot, "src", "components", "kanban", "KanbanBoard.tsx"),
      "utf8",
    );
    assert.match(kanban, /task-pipeline-queued/);
    assert.match(
      kanban,
      /!runningPipelineIds\?\.has\(task\.id\) && queuedPipelinePositions\?\.has\(task\.id\)/,
    );
  });
});

describe("concurrency limit source of truth", () => {
  it("documents Rust-side enforcement in agent_start", () => {
    const agents = readFileSync(
      path.join(repoRoot, "src-tauri", "src", "commands", "agents.rs"),
      "utf8",
    );
    assert.match(agents, /max_concurrent_pipelines/);
    assert.match(agents, /enqueue_pipeline/);
  });

  it("documents Node-side enforcement in pipeline-lib (dual limit — see verify-reviewer-blockers)", () => {
    const pipelineLib = readFileSync(
      path.join(repoRoot, "scripts", "pipeline-lib.mjs"),
      "utf8",
    );
    assert.match(pipelineLib, /activePipelineCount >= maxConcurrent/);
    assert.match(pipelineLib, /type: "pipeline_queued"/);
  });
});
