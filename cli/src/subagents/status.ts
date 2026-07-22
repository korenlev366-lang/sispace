/**
 * Compact Cursor-CLI-style subagent status lines for the TUI (~80 cols).
 */

import type { Subtask } from "./planner.js";

export type SubagentPhase = "planned" | "working" | "done" | "failed";

const WIDTH = 78;

function trunc(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 1))}…`;
}

function shortDesc(subtask: Subtask, max = 48): string {
  return trunc(subtask.description, max);
}

export function formatSubagentBanner(
  kind: "start" | "end",
  opts: { total: number; done?: number; model?: string },
): string {
  if (kind === "start") {
    const modelBit = opts.model ? ` · model ${trunc(opts.model, 28)}` : "";
    return trunc(
      `› ── subagents · ${opts.total} planned${modelBit} ──`,
      WIDTH,
    );
  }
  const done = opts.done ?? opts.total;
  return trunc(`› ── subagents · ${done}/${opts.total} done ──`, WIDTH);
}

export function formatSubagentPlanned(
  index: number,
  subtask: Subtask,
): string {
  return trunc(
    `› [${index} planned] ${shortDesc(subtask)} (${subtask.type})`,
    WIDTH,
  );
}

export function formatSubagentWorking(
  index: number,
  subtask: Subtask,
): string {
  return trunc(`› [${index} working] ${shortDesc(subtask)}`, WIDTH);
}

export function formatSubagentDone(
  index: number,
  subtask: Subtask,
  opts?: { failed?: boolean },
): string {
  const tag = opts?.failed ? "failed" : "done";
  return trunc(`› [${index} ${tag}] ${shortDesc(subtask)}`, WIDTH);
}

export function formatSubagentSummary(items: {
  planned: number;
  working: number;
  done: number;
  failed: number;
}): string {
  const parts: string[] = [];
  if (items.working > 0) parts.push(`${items.working} working`);
  if (items.done > 0) parts.push(`${items.done} done`);
  if (items.failed > 0) parts.push(`${items.failed} failed`);
  if (items.planned > 0) parts.push(`${items.planned} planned`);
  return trunc(
    `› [subagents: ${parts.join(", ") || "idle"}]`,
    WIDTH,
  );
}
