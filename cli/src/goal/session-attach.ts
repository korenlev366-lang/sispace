import type { CliSession } from "../session/types.js";
import { loadActiveGoal, loadActiveGoalIncludingStale } from "./persist.js";
import { isGoalStaleForSession } from "./stale.js";
import type { ActiveGoal } from "./types.js";

export interface GoalAttachResult {
  goal: ActiveGoal | null;
  stale: boolean;
  message: string;
}

/** `/goal resume` — attach goal to session even if older than 24h. */
export function attachGoalResume(cwd: string, session: CliSession): GoalAttachResult {
  const goal = loadActiveGoal(cwd, { allowStale: true });
  if (!goal) {
    return {
      goal: null,
      stale: false,
      message: "No active verify goal in harness/memory/goals.md.",
    };
  }
  const stale = isGoalStaleForSession(goal, session.createdAt);
  return {
    goal,
    stale,
    message: stale
      ? `Resumed stale goal ${goal.id} (set ${goal.setDate}) — verify loop enabled`
      : `Resumed goal ${goal.id} — context injects on next agent turn`,
  };
}

/** `/goal` or `/goal status` — show status; inject on next turn only if non-stale. */
export function attachGoalForExplicitUse(
  cwd: string,
  session: CliSession,
): GoalAttachResult {
  const onDisk = loadActiveGoalIncludingStale(cwd);
  if (!onDisk) {
    return {
      goal: null,
      stale: false,
      message: "No active verify goal.",
    };
  }
  const stale = isGoalStaleForSession(onDisk, session.createdAt);
  if (stale) {
    return {
      goal: null,
      stale: true,
      message: `Goal ${onDisk.id} is stale for this session (set ${onDisk.setDate}). Use /goal resume to attach.`,
    };
  }
  return {
    goal: onDisk,
    stale: false,
    message: `Goal ${onDisk.id} armed — context injects on next agent turn`,
  };
}

export function sessionPatchForGoalInject(
  goal: ActiveGoal,
  opts: { resumed?: boolean } = {},
): Partial<CliSession> {
  return {
    activeGoal: goal,
    injectGoalContext: true,
    ...(opts.resumed ? { goalResumedExplicitly: true } : {}),
  };
}

/** Whether verify loop may run for this session's goal. */
export function sessionHasVerifiableGoal(session: CliSession): boolean {
  const goal = session.activeGoal;
  if (!goal || goal.status !== "active") {
    return false;
  }
  if (session.goalResumedExplicitly) {
    return true;
  }
  return !isGoalStaleForSession(goal, session.createdAt);
}
