import type { ModelParameterValue } from "../sdk/types.js";
import type { ActiveGoal } from "../goal/types.js";

export interface CliSession {
  id: string;
  title: string;
  modelId: string;
  /** Cursor SDK model params (fast, thinking, effort, context window, …). */
  modelParams?: ModelParameterValue[];
  /** Pipeline subagent model when linked to a task (not the orchestrator picker). */
  subagentModelId?: string;
  subagentModelParams?: ModelParameterValue[];
  cwd: string;
  createdAt: string;
  /** Cursor SDK agent id for resume after first turn. */
  cursorAgentId?: string;
  /** Active skill bundle name (feature | bug | docs). */
  skillBundle?: string;
  /** Prompt text injected from config/skill-bundles/*.yaml. */
  skillBundlePrompt?: string;
  /** Linked SISpace task when resumed via --resume. */
  taskId?: string;
  /** Injected once on first agent turn after resume. */
  resumeContextBlock?: string;
  /** Obsidian lesson context (top 3), fetched on demand. */
  obsidianContextBlock?: string;
  /** True after lesson FTS fetch attempted for this session. */
  obsidianContextFetched?: boolean;
  /** AGENTS.md from git repo root, injected once on first agent turn. */
  agentsContextBlock?: string;
  /** True after AGENTS.md load was attempted for this session. */
  agentsContextFetched?: boolean;
  /** True after resume/lesson blocks were sent to the agent. */
  contextInjected?: boolean;
  /** Active verify goal (ralph loop) — only after /goal resume or non-stale /goal. */
  activeGoal?: ActiveGoal;
  /** Inject goal block on the next agent message only (not every turn). */
  injectGoalContext?: boolean;
  /** User ran /goal resume — stale goals may run verify. */
  goalResumedExplicitly?: boolean;
  /** Per-session log lines shown in the orchestrator. */
  lines: string[];
  /** Running output-token tally for this CLI session. */
  costSessionTokens?: number;
  /** Running output-token tally for project cwd. */
  costProjectTokens?: number;
  /** Real context token count from the last API response (prompt_tokens). */
  contextTokens?: number;
  /** Pi-style compaction summary injected on next agent turn. */
  compactionSummaryBlock?: string;
  /** True after at least one compaction for this session. */
  compacted?: boolean;
  /** Line entry id (line_N) from which transcript is kept after compact. */
  firstKeptEntryId?: string;
  /** Pipeline subagent decomposition toggle (default false). */
  subagentsEnabled?: boolean;
  /** Cumulative tool calls this CLI session (for auto-skill threshold). */
  toolCallCount?: number;
  /** True if this session wrote under .cursorsi/skills/ (skip auto-skill). */
  skillsDirTouched?: boolean;
  /** True after Cursor ask_user hint was injected once. */
  askUserHintInjected?: boolean;
  /** True after .cursorsi project memory/skill index was injected. */
  projectMemoryInjected?: boolean;
}

export interface SessionState {
  sessions: CliSession[];
  activeId: string;
}
