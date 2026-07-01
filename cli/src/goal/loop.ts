import { hasGitWorktreeChanges } from "../diff/capture.js";
import { updateGoalInFile } from "./persist.js";
import type { ActiveGoal } from "./types.js";
import {
  formatVerifyFailureMessage,
  runVerifyCommand,
  type VerifyRunResult,
} from "./verify-runner.js";

export interface VerifyLoopOutcome {
  goal: ActiveGoal;
  passed: boolean;
  exhausted: boolean;
  verifyResult: VerifyRunResult;
  /** Verify was not run (no git diff after agent turn). */
  skipped?: boolean;
  skipReason?: "no_file_changes";
  agentFollowUp?: string;
}

const SKIPPED_NO_CHANGES: VerifyRunResult = {
  exitCode: -1,
  output: "",
};

export function runVerifyAfterAgentTurn(
  cwd: string,
  goal: ActiveGoal,
): VerifyLoopOutcome {
  if (!hasGitWorktreeChanges(cwd)) {
    return {
      goal,
      passed: false,
      exhausted: false,
      verifyResult: SKIPPED_NO_CHANGES,
      skipped: true,
      skipReason: "no_file_changes",
    };
  }

  const result = runVerifyCommand(cwd, goal.verifyCommand);
  const next: ActiveGoal = {
    ...goal,
    lastVerifyExit: result.exitCode,
    lastFailureExcerpt:
      result.exitCode !== 0 ? result.output.slice(0, 400) : undefined,
  };

  if (result.exitCode === 0) {
    next.status = "complete";
    next.currentIteration = goal.currentIteration + 1;
    updateGoalInFile(cwd, next);
    return { goal: next, passed: true, exhausted: false, verifyResult: result };
  }

  const iteration = goal.currentIteration + 1;
  next.currentIteration = iteration;
  updateGoalInFile(cwd, next);

  if (iteration >= goal.maxIterations) {
    next.status = "failed";
    updateGoalInFile(cwd, next);
    return {
      goal: next,
      passed: false,
      exhausted: true,
      verifyResult: result,
    };
  }

  const agentFollowUp = formatVerifyFailureMessage(
    iteration,
    goal.maxIterations,
    result,
  );

  return {
    goal: next,
    passed: false,
    exhausted: false,
    verifyResult: result,
    agentFollowUp,
  };
}
