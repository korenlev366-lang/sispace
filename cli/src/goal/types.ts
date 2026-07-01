export type GoalStatus = "active" | "complete" | "failed" | "abandoned";

export interface ActiveGoal {
  id: string;
  title: string;
  description: string;
  verifyCommand: string;
  maxIterations: number;
  currentIteration: number;
  status: GoalStatus;
  setDate: string;
  lastVerifyExit?: number;
  lastFailureExcerpt?: string;
}

export interface GoalSetInput {
  description: string;
  verifyCommand: string;
  maxIterations: number;
}
