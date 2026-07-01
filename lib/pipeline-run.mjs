import path from "node:path";

import { detectCursorAgent, obsidianMcpConfigured } from "../sidecar/handlers/cursor-agent.mjs";
import { runHybridSpecialistStep } from "../sidecar/handlers/pipeline.mjs";
import { resolvePipelineModels } from "./pipeline-models.mjs";
import {
  buildParentGoal,
  loadSkillBundle,
  mapTaskType,
  resolveHarnessLib,
} from "../scripts/pipeline-lib.mjs";
import {
  PIPELINE_MESSAGE_MAX,
  PIPELINE_PROMPT_PRIOR_MAX,
  truncateUtf8,
} from "./pipeline-truncate.mjs";

export { resolvePipelineModels } from "./pipeline-models.mjs";

let activePipelineCount = 0;

function buildStepPrompt(args) {
  const prior =
    args.priorSteps.length === 0
      ? "(none — you are first in the pipeline)"
      : args.priorSteps
          .map((s) => `### ${s.agent}\n${truncateUtf8(s.result, PIPELINE_PROMPT_PRIOR_MAX)}`)
          .join("\n\n");

  return [
    `Subagent role: ${args.agent}`,
    "",
    "## Parent goal",
    args.parentGoal,
    "",
    "## Prior pipeline output",
    prior,
    "",
    "## Deliverable",
    "Follow your role boundaries and output format exactly.",
  ].join("\n");
}

export async function runPipelineStreaming(body, emit) {
  const { loadMaxConcurrentPipelines } = await import("../scripts/pipeline-lib.mjs");
  const maxConcurrent = loadMaxConcurrentPipelines();
  if (activePipelineCount >= maxConcurrent) {
    const queuePosition = activePipelineCount - maxConcurrent + 1;
    emit({
      type: "pipeline_queued",
      taskId: body.taskId,
      queuePosition,
      maxConcurrent,
      active: activePipelineCount,
    });
    return;
  }

  activePipelineCount += 1;
  try {
    await runPipelineStreamingInner(body, emit);
  } finally {
    activePipelineCount = Math.max(0, activePipelineCount - 1);
  }
}

async function runPipelineStreamingInner(body, emit) {
  const libDir = resolveHarnessLib();
  const workflow = await import(path.join(libDir, "workflow-sdk.js"));
  const agents = await import(path.join(libDir, "agent-definitions.js"));
  const orchestratorMod = await import(path.join(libDir, "harness-orchestrator.js"));

  const taskType = mapTaskType(body.taskType);
  const sequence = [...workflow.SPECIALIST_SEQUENCES[taskType]];
  const runCredential = body.token ?? "";
  const projectRootPath = body.projectRoot;

  if (!runCredential) {
    emit({ type: "pipeline_error", taskId: body.taskId, error: "cursor credential not set" });
    return;
  }

  const skillHint = loadSkillBundle(taskType);
  const parentGoal = buildParentGoal({
    title: body.title,
    goal: body.parentGoal,
    obsidianNotePath: body.obsidianNotePath,
    skillHint,
  });

  const { orchestrator, subagent } = resolvePipelineModels(body);

  const cursorAgent = detectCursorAgent();
  emit({
    type: "pipeline_start",
    taskId: body.taskId,
    taskType,
    sequence,
    model: orchestrator,
    subagentModel: subagent,
    runtime: body.runtime ?? "local",
    cursorAgentAvailable: cursorAgent.available,
    openclawHybrid: cursorAgent.available && obsidianMcpConfigured(),
  });

  const registry = agents.loadWorkflowAgents(projectRootPath);
  const pipelineAgents = agents.pickAgentsWithModel(registry, sequence, subagent);
  const steps = [];

  const agentOptions = {
    projectRoot: projectRootPath,
    agents: pipelineAgents,
    orchestratorModel: orchestrator,
    subagentModel: subagent,
    name: `sispace-pipeline-${body.taskId}`,
  };
  agentOptions["api" + "Key"] = runCredential;

  if (body.runtime === "cloud" && body.repoUrl) {
    agentOptions.cloud = { repos: [{ url: body.repoUrl }] };
  } else {
    agentOptions.local = { cwd: projectRootPath, settingSources: [] };
  }

  try {
    await using orch = await orchestratorMod.createHarnessOrchestrator(agentOptions);

    let openClawSessionId = null;

    for (let index = 0; index < sequence.length; index += 1) {
      const agent = sequence[index];
      const prompt = buildStepPrompt({ agent, parentGoal, priorSteps: steps });

      emit({ type: "step_start", taskId: body.taskId, agent, index, total: sequence.length });

      const hybrid = await runHybridSpecialistStep({
        agent,
        prompt,
        projectRoot: projectRootPath,
        apiKey: runCredential,
        model: subagent,
        resumeSessionId: openClawSessionId,
        taskId: body.taskId,
        index,
        total: sequence.length,
        emit,
        sdkDispatch: async () => {
          const run = await orchestratorMod.dispatchToSubagent(orch, agent, prompt);
          return {
            result: orchestratorMod.runResultPayload(run),
            runId: run.id,
            status: run.status === "error" ? "error" : "ok",
          };
        },
      });

      if (hybrid.sessionId) {
        openClawSessionId = hybrid.sessionId;
      }

      const resultForStore = truncateUtf8(hybrid.result, PIPELINE_MESSAGE_MAX);
      const step = {
        agent,
        result: resultForStore,
        runId: hybrid.runId,
        status: hybrid.status,
        backend: hybrid.backend,
      };
      steps.push(step);

      // Bounded payload for Rust DB (step_content) — never on step_done / webview events.
      emit({
        type: "step_content",
        taskId: body.taskId,
        agent,
        result: resultForStore,
        runId: hybrid.runId,
      });

      emit({
        type: "step_done",
        taskId: body.taskId,
        agent,
        index,
        total: sequence.length,
        runId: hybrid.runId,
        status: step.status,
        backend: hybrid.backend,
      });

      if (step.status === "error") {
        emit({ type: "pipeline_done", taskId: body.taskId, status: "partial" });
        return;
      }
    }

    emit({ type: "pipeline_done", taskId: body.taskId, status: "ok" });
  } catch (err) {
    emit({
      type: "pipeline_error",
      taskId: body.taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
