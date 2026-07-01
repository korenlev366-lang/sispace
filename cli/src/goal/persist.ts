import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { goalsMdPath } from "./paths.js";
import { isGoalStale, isGoalStaleForSession } from "./stale.js";
import type { ActiveGoal, GoalSetInput, GoalStatus } from "./types.js";

export interface LoadActiveGoalOptions {
  /** CLI session start time — goals older than 24h before this are ignored unless allowStale. */
  sessionStartedAt?: string;
  /** Allow goals older than 24h (e.g. `/goal resume`). */
  allowStale?: boolean;
}

const DEFAULT_MAX = 10;
const MAX_CAP = 25;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayCompact(): string {
  return todayYmd().replace(/-/g, "");
}

function nextGoalId(existing: string): string {
  const re = /GOAL-(\d{8})-(\d{3})/g;
  let maxSeq = 0;
  let m: RegExpExecArray | null;
  const day = todayCompact();
  while ((m = re.exec(existing)) !== null) {
    if (m[1] === day) {
      maxSeq = Math.max(maxSeq, Number(m[2]));
    }
  }
  return `GOAL-${day}-${String(maxSeq + 1).padStart(3, "0")}`;
}

function shortTitle(description: string): string {
  const t = description.trim();
  if (t.length <= 60) {
    return t;
  }
  return `${t.slice(0, 57)}…`;
}

export function clampMaxIterations(n: number): number {
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX;
  }
  return Math.min(Math.floor(n), MAX_CAP);
}

export function renderGoalEntry(
  id: string,
  input: GoalSetInput,
  status: GoalStatus = "active",
): string {
  const title = shortTitle(input.description);
  const max = clampMaxIterations(input.maxIterations);
  return [
    `### ${id}: ${title}`,
    "",
    `- Goal: ${input.description.trim()}`,
    `- Set date: ${todayYmd()}`,
    `- Status: ${status}`,
    `- Verify command: ${input.verifyCommand.trim()}`,
    `- Max iterations: ${max}`,
    `- Current iteration: 0`,
    `- Last verify exit:`,
    `- Progress notes:`,
    `  - ${todayYmd()}: Goal set via cursorsi (verify loop enabled)`,
    "",
  ].join("\n");
}

export function persistNewGoal(cwd: string, input: GoalSetInput): ActiveGoal {
  const path = goalsMdPath(cwd);
  let body = "";
  if (existsSync(path)) {
    body = readFileSync(path, "utf8");
  } else {
    body = `# Persistent Goals

Long-running goals; verify-enabled goals use the cursorsi ralph-style loop.

## Active goals

(No active goals.)

## Complete / abandoned

(No completed or abandoned goals.)
`;
  }

  const id = nextGoalId(body);
  const entry = renderGoalEntry(id, input);

  body = body.replace(/\n?\(No active goals\.\)\n?/, "\n");
  const completeIdx = body.indexOf("## Complete");
  if (completeIdx >= 0) {
    body = `${body.slice(0, completeIdx).trimEnd()}\n\n${entry}\n${body.slice(completeIdx)}`;
  } else if (body.includes("## Active goals")) {
    body = `${body.trimEnd()}\n\n${entry}`;
  } else {
    body = `${body.trimEnd()}\n\n## Active goals\n\n${entry}`;
  }

  writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`, "utf8");

  const max = clampMaxIterations(input.maxIterations);
  return {
    id,
    title: shortTitle(input.description),
    description: input.description.trim(),
    verifyCommand: input.verifyCommand.trim(),
    maxIterations: max,
    currentIteration: 0,
    status: "active",
    setDate: todayYmd(),
  };
}

function parseField(block: string, key: string): string {
  const re = new RegExp(`^- ${key}:\\s*(.*)$`, "m");
  const m = block.match(re);
  return m?.[1]?.trim() ?? "";
}

function parseGoalBlock(block: string): ActiveGoal | null {
  const header = block.match(/^### (GOAL-\d{8}-\d{3}):\s*(.+)$/m);
  if (!header) {
    return null;
  }
  const status = (parseField(block, "Status") || "active") as GoalStatus;
  const verify = parseField(block, "Verify command");
  if (!verify) {
    return null;
  }
  return {
    id: header[1],
    title: header[2].trim(),
    description: parseField(block, "Goal"),
    verifyCommand: verify,
    maxIterations: Number(parseField(block, "Max iterations") || DEFAULT_MAX),
    currentIteration: Number(parseField(block, "Current iteration") || 0),
    status,
    setDate: parseField(block, "Set date"),
    lastVerifyExit: (() => {
      const v = parseField(block, "Last verify exit");
      return v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined;
    })(),
    lastFailureExcerpt: parseField(block, "Last failure excerpt") || undefined,
  };
}

function readFirstActiveGoalFromFile(cwd: string): ActiveGoal | null {
  const path = goalsMdPath(cwd);
  if (!existsSync(path)) {
    return null;
  }
  const body = readFileSync(path, "utf8");
  const activeIdx = body.indexOf("## Active goals");
  if (activeIdx < 0) {
    return null;
  }
  const section = body.slice(activeIdx);
  const end = section.search(/\n## /);
  const activeSection = end >= 0 ? section.slice(0, end) : section;
  const blocks = activeSection.split(/^### /m).slice(1);
  for (const raw of blocks) {
    const block = `### ${raw}`;
    const goal = parseGoalBlock(block);
    if (goal && goal.status === "active" && goal.verifyCommand) {
      return goal;
    }
  }
  return null;
}

export function loadActiveGoal(
  cwd: string,
  opts?: LoadActiveGoalOptions,
): ActiveGoal | null {
  const goal = readFirstActiveGoalFromFile(cwd);
  if (!goal) {
    return null;
  }
  if (opts?.allowStale) {
    return goal;
  }
  if (opts?.sessionStartedAt) {
    if (isGoalStaleForSession(goal, opts.sessionStartedAt)) {
      return null;
    }
    return goal;
  }
  if (isGoalStale(goal)) {
    return null;
  }
  return goal;
}

/** Load active goal from disk even when stale (for status display). */
export function loadActiveGoalIncludingStale(cwd: string): ActiveGoal | null {
  return readFirstActiveGoalFromFile(cwd);
}

export function updateGoalInFile(cwd: string, goal: ActiveGoal): void {
  const path = goalsMdPath(cwd);
  if (!existsSync(path)) {
    return;
  }
  let body = readFileSync(path, "utf8");
  const marker = `### ${goal.id}:`;
  const start = body.indexOf(marker);
  if (start < 0) {
    return;
  }
  const after = body.slice(start + marker.length);
  const next = after.search(/\n### /);
  const end = next >= 0 ? start + marker.length + next : body.length;
  const oldBlock = body.slice(start, end);
  const newBlock = [
    `### ${goal.id}: ${goal.title}`,
    "",
    `- Goal: ${goal.description}`,
    `- Set date: ${goal.setDate}`,
    `- Status: ${goal.status}`,
    `- Verify command: ${goal.verifyCommand}`,
    `- Max iterations: ${goal.maxIterations}`,
    `- Current iteration: ${goal.currentIteration}`,
    `- Last verify exit: ${goal.lastVerifyExit ?? ""}`,
    ...(goal.lastFailureExcerpt
      ? [`- Last failure excerpt: ${goal.lastFailureExcerpt.slice(0, 200)}`]
      : []),
    `- Progress notes:`,
    `  - ${todayYmd()}: iteration ${goal.currentIteration} verify exit ${goal.lastVerifyExit ?? "?"}`,
    "",
  ].join("\n");
  body = `${body.slice(0, start)}${newBlock}${body.slice(end)}`;
  writeFileSync(path, body, "utf8");
}
