import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { appendText, isoTimestamp, readText } from "./paths.js";
import type { HarnessPaths } from "./paths.js";

export interface RalphState {
  goal: string;
  verifyCommand: string;
  maxIterations: number;
  currentIteration: number;
  status: string;
  startedAt: string;
  completedAt: string;
  lastVerifyExit: string;
  lastFailureExcerpt: string;
}

export const DEFAULT_MAX = 10;
export const MAX_CAP = 25;
export const OUTPUT_MAX = 1500;

export function readField(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

export function setField(text: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  if (text.match(new RegExp(`^${key}:`, "m"))) {
    return text.replace(new RegExp(`^${key}:.*$`, "m"), line);
  }
  return `${text.trim()}\n${line}\n`;
}

export function loadState(filePath: string): RalphState {
  const text = readText(filePath);
  return {
    goal: readField(text, "goal"),
    verifyCommand: readField(text, "verify_command"),
    maxIterations: Number(readField(text, "max_iterations") || DEFAULT_MAX),
    currentIteration: Number(readField(text, "current_iteration") || 0),
    status: readField(text, "status") || "idle",
    startedAt: readField(text, "started_at"),
    completedAt: readField(text, "completed_at"),
    lastVerifyExit: readField(text, "last_verify_exit"),
    lastFailureExcerpt: readField(text, "last_failure_excerpt"),
  };
}

export function saveState(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

export function isPlaceholderVerify(cmd: string): boolean {
  const trimmed = cmd.trim();
  return ["", "true", "false", ":", "exit", "exit 0", "exit 1", "sh -c true", 'sh -c "true"', "sh -c exit 0"].includes(trimmed);
}

const VERIFY_SCRIPT_RE = /^sh\s+harness\/scripts\/verify-[a-z0-9-]+\.sh$/;
const MAX_INLINE_VERIFY_LEN = 200;

function quotesBalanced(command: string): boolean {
  const balance = (quote: "'" | '"'): boolean => {
    let open = false;
    for (let i = 0; i < command.length; i += 1) {
      if (command[i] === "\\") {
        i += 1;
        continue;
      }
      if (command[i] === quote) open = !open;
    }
    return !open;
  };
  return balance("'") && balance('"');
}

/** Reject inline shell that will not survive markdown storage (quoting lesson). */
export function validateVerifyCommandShape(verify: string): string | null {
  const trimmed = verify.trim();
  if (!trimmed) return "verify command empty";

  if (!quotesBalanced(trimmed)) {
    return "verify command has unbalanced quotes; use sh harness/scripts/verify-*.sh";
  }

  if (VERIFY_SCRIPT_RE.test(trimmed)) return null;

  if (trimmed.length > MAX_INLINE_VERIFY_LEN) {
    return "verify command too long; use sh harness/scripts/verify-*.sh";
  }

  const pipes = (trimmed.match(/\|/g) ?? []).length;
  if (pipes >= 2 || trimmed.includes("'") || /\bgrep\s+-v\s+'/.test(trimmed)) {
    return "complex inline verify rejected; use sh harness/scripts/verify-*.sh";
  }

  return null;
}

export function runVerify(root: string, command: string): { exitCode: number; output: string } {
  const result = spawnSync("sh", ["-lc", command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, OUTPUT_MAX);
  return { exitCode: result.status ?? 1, output };
}

export function appendIterationLog(filePath: string, iteration: number, exitCode: number, excerpt: string): void {
  appendText(
    filePath,
    `\n### Iteration ${iteration} — ${isoTimestamp()}\n- Exit code: ${exitCode}\n- Output (truncated):\n${excerpt}\n`,
  );
}

export function appendAcceptedLesson(paths: HarnessPaths, goal: string, verify: string, iterations: number): string {
  const accepted = readText(paths.acceptedLessons);
  const count = (accepted.match(/^### ACCEPTED-RALPH-/gm) ?? []).length + 1;
  const id = `ACCEPTED-RALPH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(count).padStart(3, "0")}`;
  appendText(
    paths.acceptedLessons,
    `\n### ${id}: Ralph loop completed\n\n- Source task: Ralph loop verify success\n- Reason: Verification command exited 0 after ${iterations} iteration(s)\n- Target layer: memory\n- Date: ${new Date().toISOString().slice(0, 10)}\n- Rollback note: Remove this entry and Obsidian mirror; reset ralph-goal.md to idle\n- Scope: project-local Ralph goal\n- Applied change:\n\nGoal: ${goal}\n\nVerify command: \`${verify}\`\n\n- Verification evidence: SDK Ralph loop verify exit 0\n`,
  );
  return id;
}

export function validateVerifyCommand(root: string, verify: string): number | null {
  try {
    execSync(verify, { cwd: root, stdio: "ignore" });
    return null;
  } catch (err) {
    const code = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 1;
    return code === 127 ? 127 : null;
  }
}
