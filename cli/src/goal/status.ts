import { isGoalStale } from "./stale.js";
import type { ActiveGoal } from "./types.js";

export function formatGoalStatusInline(
  goal: ActiveGoal | undefined,
  opts?: { stale?: boolean },
): string {
  if (!goal) {
    return "No active verify goal. Use: cursorsi goal set \"…\" --verify \"sh verify.sh\"";
  }
  const stale = opts?.stale ?? isGoalStale(goal);
  const lines = [
    `Goal ${goal.id}: ${goal.title}`,
    `Status: ${goal.status}`,
    `Verify: ${goal.verifyCommand}`,
    `Iteration: ${goal.currentIteration}/${goal.maxIterations}`,
  ];
  if (stale) {
    lines.push(
      "Stale: set >24h ago — use /goal resume to attach to this session",
    );
  }
  if (
    goal.lastVerifyExit !== undefined &&
    !Number.isNaN(goal.lastVerifyExit)
  ) {
    lines.push(`Last verify exit: ${goal.lastVerifyExit}`);
  }
  if (goal.lastFailureExcerpt) {
    lines.push(`Last failure: ${goal.lastFailureExcerpt.slice(0, 120)}…`);
  }
  return lines.join("\n");
}
