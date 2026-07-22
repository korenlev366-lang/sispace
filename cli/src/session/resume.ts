import { findProjectRoot } from "../project/root.js";
import type { TaskMessage } from "../search/types.js";
import type { CliSession, SessionState } from "./types.js";
import {
  getTaskRow,
  loadTaskMessages,
  openTasksDb,
} from "./task-row.js";
import {
  loadSkillBundle,
  type SkillBundleName,
} from "../skills/bundles.js";

/** How many prior turns to show locally after resume (display only). */
const DISPLAY_MESSAGES_MAX = 40;

function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function messageToLine(msg: TaskMessage): string {
  if (msg.role === "user") {
    return `you> ${msg.content}`;
  }
  if (msg.role === "assistant") {
    return `agent> ${msg.content}`;
  }
  return `[${msg.role}] ${msg.content}`;
}

function skillFromTaskType(
  projectRoot: string,
  taskType: string,
): { bundle?: SkillBundleName; prompt?: string } {
  if (taskType !== "feature" && taskType !== "bug" && taskType !== "docs") {
    return {};
  }
  const prompt = loadSkillBundle(projectRoot, taskType);
  if (!prompt) {
    return {};
  }
  return { bundle: taskType, prompt };
}

function displayLines(messages: TaskMessage[]): string[] {
  if (messages.length === 0) {
    return [];
  }
  if (messages.length <= DISPLAY_MESSAGES_MAX) {
    return messages.map(messageToLine);
  }
  const skipped = messages.length - DISPLAY_MESSAGES_MAX;
  const tail = messages.slice(-DISPLAY_MESSAGES_MAX);
  return [`… ${skipped} earlier messages`, ...tail.map(messageToLine)];
}

export interface ResumeResult {
  ok: boolean;
  state?: SessionState;
  error?: string;
}

/**
 * Rebuild an in-process session from a saved task.
 *
 * Continuity for the model comes from OpenRouter seedHistory / Cursor Agent.resume
 * (or a one-shot history block when Cursor cannot resume). Do not stuff task notes,
 * AGENTS.md, or skill prompts into the next user message.
 */
export async function buildResumeSessionState(
  taskId: string,
  fallbackCwd: string,
): Promise<ResumeResult> {
  const db = openTasksDb();
  if (!db) {
    return {
      ok: false,
      error: "Shared tasks database not found. Run SISpace once or set DB path via launcher.",
    };
  }

  const task = getTaskRow(db, taskId);
  if (!task) {
    return { ok: false, error: `Task not found: ${taskId}` };
  }

  const cwd = task.project_root?.trim() || fallbackCwd;
  const projectRoot = findProjectRoot(cwd);
  const messages = loadTaskMessages(db, task.id);
  const hasHistory = messages.length > 0;

  // Skill prompts are for fresh feature/bug/docs work — not re-sent on resume.
  const skill = hasHistory
    ? {}
    : skillFromTaskType(projectRoot, task.task_type);

  const sessionId = newSessionId();
  const session: CliSession = {
    id: sessionId,
    title: task.title || task.id,
    modelId: task.model_id?.trim() || "deepseek/deepseek-v4-flash",
    subagentModelId: task.subagent_model_id?.trim() || undefined,
    cwd,
    createdAt: new Date().toISOString(),
    taskId: task.id,
    cursorAgentId: task.cursor_agent_id?.trim() || undefined,
    skillBundle: skill.bundle,
    skillBundlePrompt: skill.prompt,
    // Skip AGENTS.md / lesson re-inject when history already exists.
    agentsContextFetched: hasHistory,
    obsidianContextFetched: hasHistory,
    lines: displayLines(messages),
  };

  return {
    ok: true,
    state: { sessions: [session], activeId: sessionId },
  };
}
