import type { GoalSetInput } from "./types.js";
import { clampMaxIterations } from "./persist.js";

/** Parse: set "description" --verify "cmd" [--max N] */
export function parseGoalSetArgs(argv: string[]): GoalSetInput | null {
  if (argv[0]?.toLowerCase() !== "set") {
    return null;
  }

  let description = "";
  let verifyCommand = "";
  let maxIterations = 10;

  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--verify" && rest[i + 1]) {
      verifyCommand = parseQuoted(rest[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--max" && rest[i + 1]) {
      maxIterations = Number(rest[i + 1]);
      i += 1;
      continue;
    }
    if (!description) {
      description = parseQuoted(arg);
    }
  }

  if (!description.trim() || !verifyCommand.trim()) {
    return null;
  }

  return {
    description: description.trim(),
    verifyCommand: verifyCommand.trim(),
    maxIterations: clampMaxIterations(maxIterations),
  };
}

function parseQuoted(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}
