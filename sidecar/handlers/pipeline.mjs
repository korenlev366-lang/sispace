import {
  detectCursorAgent,
  obsidianMcpConfigured,
  runCursorAgentStep,
} from "./cursor-agent.mjs";
import { modelIdToSelection } from "../../lib/model-selection.mjs";

/** Specialists that read Obsidian task notes via MCP when OBSIDIAN_API_KEY is set. */
const OBSIDIAN_SPECIALISTS = new Set([
  "researcher-agent",
  "architect-agent",
  "coder-agent",
  "reviewer-agent",
  "tester-agent",
  "debugger-agent",
  "documenter-agent",
]);

/**
 * Whether to use cursor-agent subprocess instead of SDK Agent.create for this step.
 * @param {string} agent
 * @param {{ cursorAgentAvailable?: boolean, obsidianConfigured?: boolean }} ctx
 */
export function shouldUseOpenClawHybrid(agent, ctx = {}) {
  const cursorOk = ctx.cursorAgentAvailable ?? detectCursorAgent().available;
  const obsidianOk = ctx.obsidianConfigured ?? obsidianMcpConfigured();
  return cursorOk && obsidianOk && OBSIDIAN_SPECIALISTS.has(agent);
}

/**
 * Build prompt for direct cursor-agent invocation (includes specialist role header).
 * @param {string} agent
 * @param {string} taskPrompt
 */
export function buildCursorAgentPrompt(agent, taskPrompt) {
  return [
    `You are swarm subagent "${agent}". Follow your role boundaries and output format exactly.`,
    "",
    taskPrompt,
  ].join("\n");
}

/**
 * Run one pipeline specialist step via OpenClaw hybrid or SDK fallback.
 * @param {{
 *   agent: string,
 *   prompt: string,
 *   projectRoot: string,
 *   apiKey: string,
 *   model?: string,
 *   resumeSessionId?: string | null,
 *   sdkDispatch: () => Promise<{ result: string, runId?: string, status: string }>,
 *   emit?: (event: object) => void,
 *   taskId?: string,
 *   index?: number,
 *   total?: number,
 * }} opts
 */
export async function runHybridSpecialistStep(opts) {
  const useOpenClaw = shouldUseOpenClawHybrid(opts.agent);
  const backend = useOpenClaw ? "cursor-agent" : "sdk";
  console.log(`[openclaw] backend: ${backend} (${opts.agent})`);

  opts.emit?.({
    type: "step_backend",
    taskId: opts.taskId,
    agent: opts.agent,
    index: opts.index,
    total: opts.total,
    backend,
    openclaw: useOpenClaw,
  });

  if (useOpenClaw) {
    const cursorPrompt = buildCursorAgentPrompt(opts.agent, opts.prompt);
    const run = await runCursorAgentStep({
      prompt: cursorPrompt,
      cwd: opts.projectRoot,
      apiKey: opts.apiKey,
      resumeSessionId: opts.resumeSessionId ?? undefined,
      model: modelIdToSelection(opts.model).id,
    });
    return {
      agent: opts.agent,
      result: run.result,
      runId: run.runId ?? run.sessionId ?? "",
      status: run.status === "error" ? "error" : "ok",
      backend,
      sessionId: run.sessionId,
    };
  }

  const run = await opts.sdkDispatch();
  return {
    agent: opts.agent,
    result: run.result,
    runId: run.runId ?? "",
    status: run.status === "error" ? "error" : "ok",
    backend,
    sessionId: null,
  };
}
