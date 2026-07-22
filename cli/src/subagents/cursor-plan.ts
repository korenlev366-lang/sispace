/**
 * Plan subtasks via a short Cursor one-shot (no tools), then parse JSON.
 */

import { parseSubtasksFromModelText, type Subtask } from "./planner.js";

const PLAN_PROMPT = `You decompose complex coding requests into 2–6 subtasks.
Return ONLY a JSON array. No markdown fences, no commentary.
Each element: {"description": string, "type": "read"|"edit"|"logic"|"plan", "depends_on": number[]}

User request:
`;

export async function planSubtasksFromText(opts: {
  userMessage: string;
  modelId: string;
  modelParams?: Array<{ id: string; value: string }>;
  apiKey: string;
  cwd: string;
  signal?: AbortSignal;
}): Promise<Subtask[]> {
  const { CursorAgent } = await import("../sdk/cursor-agent-backend.js");
  const agent = await CursorAgent.create({
    model: {
      id: opts.modelId || "auto",
      params: opts.modelParams,
    },
    apiKey: opts.apiKey,
    cwd: opts.cwd,
    name: "cursorsi-subagent-planner",
    enablePipelineAgents: false,
  });
  try {
    const result = await agent.runTurn(
      `${PLAN_PROMPT}${opts.userMessage}\n\nReply with JSON array only.`,
      undefined,
      { signal: opts.signal },
    );
    return parseSubtasksFromModelText(result.result?.trim() ?? "");
  } catch (err) {
    console.warn("[subagents] cursor plan failed:", err);
    return [];
  } finally {
    agent.close();
  }
}
