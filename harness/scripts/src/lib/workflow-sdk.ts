import { CursorAgentError } from "./sdk-types.js";
import {
  agentsForPipelineSequence,
  loadWorkflowAgents,
  pickAgents,
  SPECIALIST_CHECKER_MAP,
  type CheckerAgentName,
  type SpecialistAgentName,
} from "./agent-definitions.js";
import { createHarnessOrchestrator, dispatchToSubagent, runResultPayload } from "./harness-orchestrator.js";
import { classifyPipelineTier } from "./tier-classifier.js";
import {
  loadModelTiers,
  modelForTier,
  resolveTierSequence,
  type PipelineTier,
} from "./tier-config.js";

export type { PipelineTier } from "./tier-config.js";
export { parsePipelineTier } from "./tier-classifier.js";
export { loadModelTiers, resolveTierSequence } from "./tier-config.js";

export interface WorkflowSubtaskSpec {
  id: string;
  prompt: string;
}

export interface WorkflowSubtaskResult {
  id: string;
  result: string;
  runId: string;
  status: "ok" | "error";
  error?: string;
}

export interface WorkflowParallelOptions {
  apiKey: string;
  projectRoot: string;
}

export type WorkflowTaskType = "feature" | "bug" | "docs";

/** Ordered specialist pipeline per task type (parent runs sequentially). */
export const SPECIALIST_SEQUENCES: Record<WorkflowTaskType, readonly string[]> = {
  feature: ["researcher-agent", "architect-agent", "coder-agent", "reviewer-agent", "tester-agent"],
  bug: ["researcher-agent", "debugger-agent", "coder-agent", "tester-agent"],
  docs: ["researcher-agent", "documenter-agent"],
} as const;

export function resolveSpecialistSequence(taskType: WorkflowTaskType): string[] {
  return [...SPECIALIST_SEQUENCES[taskType]];
}

export interface SpecialistPipelineOptions extends WorkflowParallelOptions {
  taskType: WorkflowTaskType;
  parentGoal: string;
  paths?: string[];
  constraints?: string;
  outOfScope?: string;
  /** Skip classifier when set (tests or explicit override). */
  tier?: PipelineTier;
}

export type CheckerVerdict = "approve" | "corrections_required" | "skipped";

export interface CheckerStepMeta {
  agent: string;
  verdict: CheckerVerdict;
  result: string;
  runId: string;
  status: "ok" | "error";
  error?: string;
}

export interface SpecialistStepResult {
  agent: string;
  result: string;
  runId: string;
  status: "ok" | "error";
  error?: string;
  checker?: CheckerStepMeta;
  corrected?: boolean;
}

export interface SpecialistPipelineResult {
  taskType: WorkflowTaskType;
  sequence: string[];
  tier: PipelineTier;
  steps: SpecialistStepResult[];
  status: "ok" | "partial" | "error";
}

function buildSpecialistStepPrompt(args: {
  agent: string;
  parentGoal: string;
  paths?: string[];
  constraints?: string;
  outOfScope?: string;
  priorSteps: SpecialistStepResult[];
}): string {
  const prior =
    args.priorSteps.length === 0
      ? "(none — you are first in the pipeline)"
      : args.priorSteps
          .map((s) => `### ${s.agent}\n${s.result}`)
          .join("\n\n");

  return [
    `Subagent role: ${args.agent}`,
    "",
    "## Parent goal",
    args.parentGoal,
    "",
    "## Relevant paths",
    args.paths?.length ? args.paths.join("\n") : "(parent did not specify — discover via research)",
    "",
    "## Constraints",
    args.constraints ?? "(none)",
    "",
    "## Out of scope",
    args.outOfScope ?? "(see your role boundaries)",
    "",
    "## Prior pipeline output",
    prior,
    "",
    "## Deliverable",
    "Follow your role boundaries and output format exactly.",
  ].join("\n");
}

function buildCheckerPrompt(args: {
  checker: CheckerAgentName;
  specialist: string;
  parentGoal: string;
  paths?: string[];
  constraints?: string;
  specialistOutput: string;
  priorSteps: SpecialistStepResult[];
}): string {
  const prior =
    args.priorSteps.length === 0
      ? "(none)"
      : args.priorSteps.map((s) => `### ${s.agent}\n${s.result}`).join("\n\n");

  return [
    `Subagent role: ${args.checker}`,
    "",
    "You are Layer 3. Validate the specialist output below. Do not spawn subagents.",
    "",
    "## Parent goal",
    args.parentGoal,
    "",
    "## Relevant paths",
    args.paths?.length ? args.paths.join("\n") : "(none)",
    "",
    "## Constraints",
    args.constraints ?? "(none)",
    "",
    "## Specialist reviewed",
    args.specialist,
    "",
    "## Prior pipeline output",
    prior,
    "",
    "## Specialist output to check",
    args.specialistOutput,
    "",
    "## Deliverable",
    "Return your verdict using the exact output format in your role definition.",
  ].join("\n");
}

function buildCorrectionPrompt(args: {
  agent: string;
  parentGoal: string;
  paths?: string[];
  constraints?: string;
  outOfScope?: string;
  priorSteps: SpecialistStepResult[];
  previousOutput: string;
  checkerResult: string;
}): string {
  return [
    buildSpecialistStepPrompt({
      agent: args.agent,
      parentGoal: args.parentGoal,
      paths: args.paths,
      constraints: args.constraints,
      outOfScope: args.outOfScope,
      priorSteps: args.priorSteps,
    }),
    "",
    "## Checker correction pass (one revision only)",
    "Your previous output required corrections. Revise your deliverable to address every item under **Required corrections**.",
    "Do not spawn subagents.",
    "",
    "### Your previous output",
    args.previousOutput,
    "",
    "### Checker feedback",
    args.checkerResult,
  ].join("\n");
}

export function parseCheckerVerdict(checkerOutput: string): CheckerVerdict {
  const match = checkerOutput.match(/^##\s*Verdict\s*\r?\n\s*(approve|corrections_required)\b/im);
  if (!match) return "corrections_required";
  return match[1].toLowerCase() as CheckerVerdict;
}

function checkerForSpecialist(specialist: string): CheckerAgentName | undefined {
  return SPECIALIST_CHECKER_MAP[specialist as SpecialistAgentName];
}

async function runSpecialistWithChecker(args: {
  orchestrator: Awaited<ReturnType<typeof createHarnessOrchestrator>>;
  agent: string;
  parentGoal: string;
  paths?: string[];
  constraints?: string;
  outOfScope?: string;
  priorSteps: SpecialistStepResult[];
  stepLabel: string;
}): Promise<SpecialistStepResult> {
  const prompt = buildSpecialistStepPrompt({
    agent: args.agent,
    parentGoal: args.parentGoal,
    paths: args.paths,
    constraints: args.constraints,
    outOfScope: args.outOfScope,
    priorSteps: args.priorSteps,
  });

  const run = await dispatchToSubagent(args.orchestrator, args.agent, prompt, args.stepLabel);
  if (run.status === "error") {
    return {
      agent: args.agent,
      result: runResultPayload(run),
      runId: run.id,
      status: "error",
      error: `specialist run error: ${run.id}`,
    };
  }

  let result = runResultPayload(run);
  let runId = run.id;
  let status: "ok" | "error" = "ok";
  let checkerMeta: CheckerStepMeta | undefined;
  let corrected = false;

  const checkerName = checkerForSpecialist(args.agent);
  if (checkerName) {
    const checkerPrompt = buildCheckerPrompt({
      checker: checkerName,
      specialist: args.agent,
      parentGoal: args.parentGoal,
      paths: args.paths,
      constraints: args.constraints,
      specialistOutput: result,
      priorSteps: args.priorSteps,
    });

    const checkerRun = await dispatchToSubagent(
      args.orchestrator,
      checkerName,
      checkerPrompt,
      `${args.stepLabel} (checker)`,
    );
    const checkerResult = runResultPayload(checkerRun);
    const verdict =
      checkerRun.status === "error" ? "corrections_required" : parseCheckerVerdict(checkerResult);

    checkerMeta = {
      agent: checkerName,
      verdict,
      result: checkerResult,
      runId: checkerRun.id,
      status: checkerRun.status === "error" ? "error" : "ok",
      ...(checkerRun.status === "error" ? { error: `checker run error: ${checkerRun.id}` } : {}),
    };

    if (verdict === "corrections_required") {
      const correctionPrompt = buildCorrectionPrompt({
        agent: args.agent,
        parentGoal: args.parentGoal,
        paths: args.paths,
        constraints: args.constraints,
        outOfScope: args.outOfScope,
        priorSteps: args.priorSteps,
        previousOutput: result,
        checkerResult,
      });

      const correctionRun = await dispatchToSubagent(
        args.orchestrator,
        args.agent,
        correctionPrompt,
        `${args.stepLabel} (correction)`,
      );
      corrected = true;
      result = runResultPayload(correctionRun);
      runId = correctionRun.id;
      status = correctionRun.status === "error" ? "error" : "ok";
      if (correctionRun.status === "error") {
        return {
          agent: args.agent,
          result,
          runId,
          status: "error",
          error: `specialist correction run error: ${correctionRun.id}`,
          checker: checkerMeta,
          corrected,
        };
      }
    }
  }

  return {
    agent: args.agent,
    result,
    runId,
    status,
    checker: checkerMeta,
    corrected,
  };
}

/**
 * Run the task-type specialist sequence sequentially (one orchestrator, chained context).
 * Each paired Layer-3 checker runs after its specialist; one correction pass if corrections_required.
 */
export async function runSpecialistPipeline(
  opts: SpecialistPipelineOptions,
): Promise<SpecialistPipelineResult> {
  const fullSequence = resolveSpecialistSequence(opts.taskType);
  const steps: SpecialistStepResult[] = [];

  if (!opts.apiKey) {
    return {
      taskType: opts.taskType,
      sequence: fullSequence,
      tier: "full",
      steps: fullSequence.map((agent) => ({
        agent,
        result: "",
        runId: "",
        status: "error",
        error: "Cursor credential not provided",
      })),
      status: "error",
    };
  }

  const tiers = loadModelTiers(opts.projectRoot);
  const tier =
    opts.tier ??
    (await classifyPipelineTier({
      apiKey: opts.apiKey,
      projectRoot: opts.projectRoot,
      parentGoal: opts.parentGoal,
      tiers,
    }));
  console.log(`[tier] classified as: ${tier}`);

  const sequence = resolveTierSequence(opts.taskType, tier, fullSequence);
  const subagentModel = modelForTier(tier, tiers);

  const registry = loadWorkflowAgents(opts.projectRoot);
  const pipelineAgents = pickAgents(registry, agentsForPipelineSequence(sequence));

  try {
    await using orchestrator = await createHarnessOrchestrator({
      apiKey: opts.apiKey,
      projectRoot: opts.projectRoot,
      agents: pipelineAgents,
      orchestratorModel: subagentModel,
      subagentModel,
      name: `harness-specialist-${opts.taskType}-${tier}`,
    });

    for (let index = 0; index < sequence.length; index += 1) {
      const agent = sequence[index];
      const stepLabel = `step ${index + 1}/${sequence.length} (${agent})`;
      const step = await runSpecialistWithChecker({
        orchestrator,
        agent,
        parentGoal: opts.parentGoal,
        paths: opts.paths,
        constraints: opts.constraints,
        outOfScope: opts.outOfScope,
        priorSteps: steps,
        stepLabel,
      });

      steps.push(step);

      if (step.status === "error") {
        return { taskType: opts.taskType, sequence, tier, steps, status: "partial" };
      }
    }

    return { taskType: opts.taskType, sequence, tier, steps, status: "ok" };
  } catch (err) {
    const message = err instanceof CursorAgentError ? err.message : String(err);
    if (steps.length === 0) {
      steps.push({
        agent: sequence[0] ?? "unknown",
        result: "",
        runId: "",
        status: "error",
        error: message,
      });
    }
    return { taskType: opts.taskType, sequence, tier, steps, status: "error" };
  }
}

/**
 * Dispatch independent workflow subtasks in parallel (one orchestrator per subtask).
 * Registry includes harness + specialist agents; each subtask uses harness-workflow-agent.
 */
export async function runWorkflowSubtasksParallel(
  opts: WorkflowParallelOptions,
  subtasks: WorkflowSubtaskSpec[],
): Promise<WorkflowSubtaskResult[]> {
  if (!opts.apiKey) {
    return subtasks.map((st) => ({
      id: st.id,
      result: "",
      runId: "",
      status: "error",
      error: "Cursor credential not provided",
    }));
  }

  const registry = loadWorkflowAgents(opts.projectRoot);
  const workflowAgents = pickAgents(registry, ["harness-workflow-agent"]);

  return Promise.all(
    subtasks.map(async (st) => {
      try {
        await using orchestrator = await createHarnessOrchestrator({
          apiKey: opts.apiKey,
          projectRoot: opts.projectRoot,
          agents: workflowAgents,
          name: `harness-workflow-${st.id}`,
        });

        const run = await dispatchToSubagent(orchestrator, "harness-workflow-agent", st.prompt);
        if (run.status === "error") {
          return {
            id: st.id,
            result: runResultPayload(run),
            runId: run.id,
            status: "error" as const,
            error: `workflow subagent run error: ${run.id}`,
          };
        }

        return {
          id: st.id,
          result: runResultPayload(run),
          runId: run.id,
          status: "ok" as const,
        };
      } catch (err) {
        const message = err instanceof CursorAgentError ? err.message : String(err);
        return {
          id: st.id,
          result: "",
          runId: "",
          status: "error" as const,
          error: message,
        };
      }
    }),
  );
}

export const WORKFLOW_AGENT_NAME = "harness-workflow-agent";
