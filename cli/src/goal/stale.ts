import type { ActiveGoal } from "./types.js";

/** Goals older than this are not auto-attached to new CLI sessions. */
export const GOAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function parseGoalSetTimestamp(goal: ActiveGoal): number {
  if (!goal.setDate) {
    return 0;
  }
  return Date.parse(`${goal.setDate}T00:00:00.000Z`);
}

/** True when the goal was set more than 24h before `referenceMs`. */
export function isGoalStale(
  goal: ActiveGoal,
  referenceMs: number = Date.now(),
): boolean {
  const goalTime = parseGoalSetTimestamp(goal);
  if (!Number.isFinite(goalTime) || !Number.isFinite(referenceMs)) {
    return true;
  }
  return referenceMs - goalTime > GOAL_MAX_AGE_MS;
}

export function isGoalStaleForSession(
  goal: ActiveGoal,
  sessionStartedAtIso: string,
): boolean {
  const sessionStart = Date.parse(sessionStartedAtIso);
  return isGoalStale(goal, sessionStart);
}
