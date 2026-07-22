/**
 * Pipeline subagents: gate → plan → execute (topo waves) → context for main turn.
 */

import type OpenAI from "openai";
import { shouldDecompose } from "./gate.js";
import { planSubtasks, type Subtask } from "./planner.js";
import {
  formatSubagentBanner,
  formatSubagentDone,
  formatSubagentPlanned,
  formatSubagentWorking,
} from "./status.js";

export interface PipelineSubagentResult {
  ran: boolean;
  skipped?: string;
  subtasks: Subtask[];
  /** Markdown block to prepend to the main user turn. */
  contextBlock: string;
  doneCount: number;
  failedCount: number;
}

export interface PipelineSubagentOpts {
  userMessage: string;
  /** Model used for planning + (default) execution identity in status. */
  model: string;
  /** OpenAI-compatible client for the planner (OpenRouter / Compatible). */
  planClient?: OpenAI;
  /**
   * Optional planner override (e.g. Cursor one-shot). When set, planClient
   * is unused.
   */
  planWith?: (userMessage: string) => Promise<Subtask[]>;
  /** Run one subtask; return text result for the synthesizer context. */
  executeSubtask: (
    subtask: Subtask,
    index: number,
    priorResults: Array<{ index: number; description: string; result: string }>,
  ) => Promise<string>;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

function topologicalWaves(subtasks: Subtask[]): number[][] {
  const n = subtasks.length;
  const remaining = new Set(Array.from({ length: n }, (_, i) => i));
  const waves: number[][] = [];
  const completed = new Set<number>();

  while (remaining.size > 0) {
    const ready: number[] = [];
    for (const i of remaining) {
      const deps = subtasks[i]!.depends_on.filter((d) => d >= 0 && d < n);
      if (deps.every((d) => completed.has(d))) {
        ready.push(i);
      }
    }
    if (ready.length === 0) {
      // Cycle / bad deps — flush remaining in index order.
      waves.push([...remaining].sort((a, b) => a - b));
      break;
    }
    ready.sort((a, b) => a - b);
    waves.push(ready);
    for (const i of ready) {
      remaining.delete(i);
      completed.add(i);
    }
  }
  return waves;
}

/**
 * When subagents are enabled and the gate fires, plan + execute subtasks,
 * then return a context block for the main agent turn.
 */
export async function runPipelineSubagents(
  opts: PipelineSubagentOpts,
): Promise<PipelineSubagentResult> {
  const empty = (skipped: string): PipelineSubagentResult => ({
    ran: false,
    skipped,
    subtasks: [],
    contextBlock: "",
    doneCount: 0,
    failedCount: 0,
  });

  if (opts.signal?.aborted) return empty("cancelled");
  if (!shouldDecompose(opts.userMessage)) {
    return empty("gate_skip");
  }

  let subtasks: Subtask[] = [];
  try {
    if (opts.planWith) {
      subtasks = await opts.planWith(opts.userMessage);
    } else if (opts.planClient) {
      subtasks = await planSubtasks(
        opts.userMessage,
        opts.planClient,
        opts.model,
      );
    } else {
      return empty("no_planner");
    }
  } catch (err) {
    console.warn("[subagents] plan failed:", err);
    return empty("plan_error");
  }

  if (!subtasks.length) return empty("empty_plan");
  if (opts.signal?.aborted) return empty("cancelled");

  opts.onStatus?.(
    formatSubagentBanner("start", {
      total: subtasks.length,
      model: opts.model,
    }),
  );
  for (let i = 0; i < subtasks.length; i++) {
    opts.onStatus?.(formatSubagentPlanned(i, subtasks[i]!));
  }

  const priorResults: Array<{
    index: number;
    description: string;
    result: string;
  }> = [];
  let doneCount = 0;
  let failedCount = 0;

  const waves = topologicalWaves(subtasks);
  for (const wave of waves) {
    if (opts.signal?.aborted) break;

    await Promise.all(
      wave.map(async (index) => {
        if (opts.signal?.aborted) return;
        const subtask = subtasks[index]!;
        opts.onStatus?.(formatSubagentWorking(index, subtask));
        try {
          const result = await opts.executeSubtask(
            subtask,
            index,
            [...priorResults],
          );
          const text = (result ?? "").trim() || "(empty)";
          priorResults.push({
            index,
            description: subtask.description,
            result: text.slice(0, 12_000),
          });
          doneCount += 1;
          opts.onStatus?.(formatSubagentDone(index, subtask));
        } catch (err) {
          failedCount += 1;
          const msg = err instanceof Error ? err.message : String(err);
          priorResults.push({
            index,
            description: subtask.description,
            result: `Error: ${msg}`,
          });
          opts.onStatus?.(
            formatSubagentDone(index, subtask, { failed: true }),
          );
        }
      }),
    );
  }

  priorResults.sort((a, b) => a.index - b.index);

  const contextBlock = [
    "## Pipeline subagent results",
    "",
    `Model: ${opts.model}`,
    `Completed ${doneCount}/${subtasks.length}` +
      (failedCount ? ` (${failedCount} failed)` : ""),
    "",
    ...priorResults.flatMap((r) => [
      `### [${r.index}] ${r.description}`,
      "",
      r.result,
      "",
    ]),
    "Use the results above to finish the user's request. Do not redo completed work unless fixing a failure.",
    "",
  ].join("\n");

  opts.onStatus?.(
    formatSubagentBanner("end", {
      total: subtasks.length,
      done: doneCount,
      model: opts.model,
    }),
  );

  return {
    ran: true,
    subtasks,
    contextBlock,
    doneCount,
    failedCount,
  };
}

/** Prepend pipeline context to a user payload string. */
export function prependPipelineContext(
  userText: string,
  contextBlock: string,
): string {
  const block = contextBlock.trim();
  if (!block) return userText;
  return `${block}\n---\n\n## User request\n\n${userText}`;
}
