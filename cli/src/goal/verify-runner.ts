import { spawnSync } from "node:child_process";
import { findProjectRoot } from "../project/root.js";

const OUTPUT_MAX = 1500;

export interface VerifyRunResult {
  exitCode: number;
  output: string;
}

export function runVerifyCommand(cwd: string, command: string): VerifyRunResult {
  const root = findProjectRoot(cwd);
  const result = spawnSync("sh", ["-lc", command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(
    0,
    OUTPUT_MAX,
  );
  return { exitCode: result.status ?? 1, output };
}

export function formatVerifyFailureMessage(
  iteration: number,
  max: number,
  result: VerifyRunResult,
): string {
  const tail = result.output.trim() || "(no verify output)";
  return [
    "Verify failed — feed the error output below into your next fix.",
    "",
    `Iteration ${iteration}/${max} (exit ${result.exitCode}).`,
    "",
    "```",
    tail.slice(-1200),
    "```",
  ].join("\n");
}
