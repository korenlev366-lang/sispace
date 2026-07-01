import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { detectCursorAgent } from "../sidecar/handlers/cursor-agent.mjs";
import { runHybridSpecialistStep } from "../sidecar/handlers/pipeline.mjs";
import { modelIdToSelection } from "../lib/model-selection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_MAX_CONCURRENT_PIPELINES = 5;
let activePipelineCount = 0;

export function loadMaxConcurrentPipelines() {
  const cfgPath = path.join(projectRoot, "config", "sispace.yaml");
  if (!fs.existsSync(cfgPath)) return DEFAULT_MAX_CONCURRENT_PIPELINES;
  const raw = fs.readFileSync(cfgPath, "utf8");
  let inPipeline = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "pipeline:") {
      inPipeline = true;
      continue;
    }
    if (inPipeline && trimmed.endsWith(":") && trimmed !== "pipeline:" && !line.startsWith(" ")) {
      break;
    }
    if (!inPipeline) continue;
    if (trimmed.startsWith("max_concurrent_pipelines:")) {
      const val = parseInt(trimmed.split(":")[1].trim(), 10);
      if (!Number.isNaN(val) && val >= 1) return val;
    }
  }
  return DEFAULT_MAX_CONCURRENT_PIPELINES;
}

export function mapTaskType(taskType) {
  if (taskType === "feature" || taskType === "bug" || taskType === "docs") return taskType;
  return "feature";
}

export function estimateOutputTokens(messages) {
  const chars = (messages ?? []).reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.max(1000, Math.floor(chars / 4));
}

export function resolveHarnessLib() {
  return path.join(projectRoot, "harness", "scripts", "dist", "lib");
}

export function loadSkillBundle(taskType) {
  const bundlePath = path.join(projectRoot, "config", "skill-bundles", `${taskType}.yaml`);
  if (!fs.existsSync(bundlePath)) return "";
  const raw = fs.readFileSync(bundlePath, "utf8");
  const lines = raw.split("\n");
  let inPrompt = false;
  const promptLines = [];
  for (const line of lines) {
    if (line.trim() === "prompt: |") {
      inPrompt = true;
      continue;
    }
    if (inPrompt) {
      if (/^\S/.test(line) && line.trim()) break;
      promptLines.push(line.replace(/^  /, ""));
    }
  }
  return promptLines.join("\n").trim();
}

const DEFAULT_ORCHESTRATOR_MODEL = "composer-2.5";
const DEFAULT_SUBAGENT_MODEL = "composer-2.5";

function normalizePipelineModelId(modelId) {
  return modelIdToSelection(modelId).id;
}

/** Resolve orchestrator vs subagent model ids from the sidecar request body. */
export function resolvePipelineModels(body) {
  const orchestratorModel = normalizePipelineModelId(
    body.model?.trim() || DEFAULT_ORCHESTRATOR_MODEL,
  );
  const subagentModel = normalizePipelineModelId(
    body.subagentModel?.trim() || body.subagent_model?.trim() || orchestratorModel,
  );
  return { orchestratorModel, subagentModel };
}
export function buildParentGoal({ title, goal, obsidianNotePath, skillHint }) {
  const goalText = (goal ?? title ?? "").trim();
  const parts = [
    goalText,
    "",
    "## Task context",
    "Read task knowledge from the Obsidian note on demand via MCP.",
    obsidianNotePath ? `Obsidian task note: ${obsidianNotePath}` : "(no obsidian note path)",
  ];
  if (skillHint) {
    parts.push("", "## Skill bundle", skillHint);
  }
  return parts.join("\n");
}

function buildStepPrompt(args) {
  const prior =
    args.priorSteps.length === 0
      ? "(none — you are first in the pipeline)"
      : args.priorSteps.map((s) => `### ${s.agent}\n${s.result}`).join("\n\n");

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
  const token = body.token ?? "";
  const projectRootPath = body.projectRoot;

  if (!token) {
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

  const { orchestratorModel, subagentModel } = resolvePipelineModels(body);
  const cursorAgent = detectCursorAgent();
  emit({
    type: "pipeline_start",
    taskId: body.taskId,
    taskType,
    sequence,
    model: orchestratorModel,
    subagentModel,
    runtime: body.runtime ?? "local",
  });
  const registry = agents.loadWorkflowAgents(projectRootPath);
  const pipelineAgents = agents.pickAgentsWithModel(registry, sequence, subagentModel);
  const steps = [];

  const agentOptions = {
    projectRoot: projectRootPath,
    agents: pipelineAgents,
    orchestratorModel,
    subagentModel,
    name: `sispace-pipeline-${body.taskId}`,
  };
  agentOptions["api" + "Key"] = token;

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
        apiKey: token,
        model: subagentModel,
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

      const step = {
        agent,
        result: hybrid.result,
        runId: hybrid.runId,
        status: hybrid.status,
        backend: hybrid.backend,
      };
      steps.push(step);

      emit({
        type: "step_content",
        taskId: body.taskId,
        agent,
        result: hybrid.result,
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

export function reconstructTranscript(messages) {
  return (messages ?? [])
    .map((m) => `[${m.created_at ?? ""}] ${(m.role ?? "system").toUpperCase()}: ${m.content ?? ""}`)
    .join("\n\n");
}

export async function runHarnessReflect(body, emit) {
  const mod = await import("./reflect-chain.mjs");
  return mod.runReflectChain(body, emit);
}
