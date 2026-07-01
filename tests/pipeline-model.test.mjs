/**
 * Pipeline orchestrator vs subagent model resolution and wiring.
 * Run: node --experimental-strip-types --test tests/pipeline-model.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ORCHESTRATOR_MODEL,
  DEFAULT_SUBAGENT_MODEL,
  resolvePipelineModels as resolveFromLib,
} from "../lib/pipeline-models.mjs";
import { resolvePipelineModels as resolveFromScripts } from "../scripts/pipeline-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

describe("resolvePipelineModels (lib/pipeline-models.mjs — active runtime)", () => {
  it("defaults both tiers to composer-2.5", () => {
    assert.equal(resolveFromLib({}).orchestrator, DEFAULT_ORCHESTRATOR_MODEL);
    assert.equal(resolveFromLib({}).subagent, DEFAULT_SUBAGENT_MODEL);
    assert.equal(DEFAULT_ORCHESTRATOR_MODEL, "composer-2.5");
    assert.equal(DEFAULT_SUBAGENT_MODEL, "composer-2.5");
  });

  it("splits orchestrator and subagent when subagentModel is set", () => {
    const resolved = resolveFromLib({
      model: "composer-2.5",
      subagentModel: "composer-2",
    });
    assert.equal(resolved.orchestrator, "composer-2.5");
    assert.equal(resolved.subagent, "composer-2");
  });

  it("falls back subagent to orchestrator when subagentModel omitted", () => {
    const resolved = resolveFromLib({ model: "composer-2.5" });
    assert.equal(resolved.orchestrator, "composer-2.5");
    assert.equal(resolved.subagent, "composer-2.5");
  });

  it("normalizes legacy composer-2.5-fast to standard tier", () => {
    const resolved = resolveFromLib({ model: "composer-2.5-fast" });
    assert.equal(resolved.orchestrator, "composer-2.5");
    assert.equal(resolved.subagent, "composer-2.5");
  });
});

describe("resolvePipelineModels (scripts/pipeline-lib.mjs — shared helper)", () => {
  it("defaults both tiers to composer-2.5", () => {
    const { orchestratorModel, subagentModel } = resolveFromScripts({});
    assert.equal(orchestratorModel, "composer-2.5");
    assert.equal(subagentModel, "composer-2.5");
  });

  it("splits orchestrator and subagent when both provided", () => {
    const { orchestratorModel, subagentModel } = resolveFromScripts({
      model: "composer-2.5",
      subagentModel: "composer-2",
    });
    assert.equal(orchestratorModel, "composer-2.5");
    assert.equal(subagentModel, "composer-2");
  });
});

describe("lib/pipeline-run wiring (static — active sidecar path)", () => {
  const runSrc = read("lib/pipeline-run.mjs");

  it("uses resolvePipelineModels and pickAgentsWithModel", () => {
    assert.ok(runSrc.includes("resolvePipelineModels(body)"));
    assert.ok(runSrc.includes("pickAgentsWithModel(registry, sequence, subagent)"));
  });

  it("passes subagent model to hybrid steps and orchestrator separately", () => {
    assert.ok(runSrc.includes("orchestratorModel: orchestrator"));
    assert.ok(runSrc.includes("model: subagent"));
    assert.ok(runSrc.includes("subagentModel: subagent"));
  });

  it("emits pipeline_start with both model fields", () => {
    assert.ok(runSrc.includes('model: orchestrator'));
    assert.ok(runSrc.includes("subagentModel: subagent"));
  });

  it("emits step_content with truncated result for DB storage", () => {
    assert.ok(runSrc.includes('type: "step_content"'));
    assert.ok(runSrc.includes("result: resultForStore"));
    assert.ok(runSrc.includes("truncateUtf8"));
    assert.ok(runSrc.includes("resultForStore"));
  });

  it("step_done is metadata-only (no result on step_done)", () => {
    const stepDoneBlock = runSrc.match(
      /emit\(\{\s*type: "step_done"[\s\S]*?\}\);/,
    )?.[0];
    assert.ok(stepDoneBlock, "step_done emit block must exist");
    assert.ok(!stepDoneBlock.includes("result:"));
    assert.ok(!runSrc.includes("result: hybrid.result,\n        runId: hybrid.runId,\n        status: step.status"));
  });

  it("pipeline_done carries status only (no steps blob on pipeline_done)", () => {
    assert.ok(!runSrc.includes('status: "partial", steps'));
    assert.ok(!runSrc.includes('status: "ok", steps'));
    assert.match(
      runSrc,
      /emit\(\{ type: "pipeline_done", taskId: body\.taskId, status: "(?:ok|partial)" \}\)/,
    );
  });
});

describe("scripts/pipeline-lib wiring (static)", () => {
  const src = read("scripts/pipeline-lib.mjs");

  it("uses pickAgentsWithModel and subagentModel for hybrid steps", () => {
    assert.ok(src.includes("pickAgentsWithModel"));
    assert.ok(src.includes("model: subagentModel"));
  });
});

describe("pipeline_client HTTP body and queue (static)", () => {
  const clientSrc = read("sispace-core/src/services/pipeline_client.rs");

  it("includes subagentModel in sidecar JSON body", () => {
    assert.ok(clientSrc.includes('"subagentModel": request.subagent_model'));
  });

  it("dequeues queued starts with subagent_model into launch_pipeline", () => {
    assert.ok(clientSrc.includes("item.subagent_model"));
    assert.match(
      clientSrc,
      /launch_pipeline\([\s\S]*item\.subagent_model/,
      "drain must pass queued subagent_model to launch_pipeline",
    );
  });

  it("build_pipeline_request splits persisted orchestrator and subagent models", () => {
    assert.ok(
      clientSrc.includes("build_pipeline_request_splits_persisted_orchestrator_and_subagent_models"),
    );
  });
});

describe("runtime entry points (static)", () => {
  it("node_host spawns lib/node-server.mjs", () => {
    const hostSrc = read("sispace-core/src/services/node_host.rs");
    assert.ok(hostSrc.includes('join("lib").join("node-server.mjs")'));
  });

  it("package.json node-host script targets lib/node-server.mjs", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts["node-host"], "node lib/node-server.mjs");
  });

  it("lib/node-server runs pipelines via lib/pipeline-run.mjs", () => {
    const nodeSrc = read("lib/node-server.mjs");
    assert.ok(nodeSrc.includes('import { runPipelineStreaming } from "./pipeline-run.mjs"'));
  });
});

describe("pipeline queue wiring (static)", () => {
  const clientSrc = read("sispace-core/src/services/pipeline_client.rs");
  const stateSrc = read("sispace-core/src/state.rs");

  it("QueuedPipelineStart carries subagent_model through enqueue", () => {
    assert.ok(stateSrc.includes("pub subagent_model: Option<String>"));
    assert.ok(clientSrc.includes("item.subagent_model"));
  });
});

describe("schema migration subagent_model (static)", () => {
  it("includes subagent_model_id migration", () => {
    const modSrc = read("sispace-core/src/db/mod.rs");
    const migSrc = read("sispace-core/src/db/migrations/003_subagent_model.sql");
    assert.ok(Number.parseInt(modSrc.match(/SCHEMA_VERSION:\s*i32\s*=\s*(\d+)/)?.[1] ?? "0", 10) >= 3);
    assert.ok(migSrc.includes("subagent_model_id"));
    assert.ok(modSrc.includes("003_subagent_model.sql"));
  });
});

describe("pickAgentsWithModel (SDK fallback path)", () => {
  it("overrides each picked agent model id", async () => {
    const { loadWorkflowAgents, pickAgentsWithModel } = await import(
      "../harness/scripts/dist/lib/agent-definitions.js"
    );
    const registry = loadWorkflowAgents(repoRoot);
    const names = ["researcher-agent", "coder-agent"];
    const picked = pickAgentsWithModel(registry, names, "composer-2.5-fast");
    for (const name of names) {
      assert.equal(
        picked[name].model?.id,
        "composer-2.5",
        `${name} model must normalize legacy fast id to standard tier`,
      );
    }
  });
});
