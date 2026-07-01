import { findProjectRoot } from "../project/root.js";
import {
  loadObsidianYaml,
  taskNoteVaultPath,
} from "../obsidian/config.js";
import { vaultRead } from "../obsidian/read.js";
import type { TaskMessage } from "../search/types.js";
import type { CliSession, SessionState } from "./types.js";
import {
  getTaskRow,
  loadTaskMessages,
  openTasksDb,
  type TaskRow,
} from "./task-row.js";
import {
  loadSkillBundle,
  type SkillBundleName,
} from "../skills/bundles.js";

const NOTE_EXCERPT_MAX = 4000;

function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) {
    return md;
  }
  const end = md.indexOf("\n---", 3);
  if (end < 0) {
    return md;
  }
  return md.slice(end + 4).trimStart();
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

function buildResumeContextBlock(
  task: TaskRow,
  notePath: string,
  noteBody: string,
  messageCount: number,
): string {
  const excerpt = stripFrontmatter(noteBody).slice(0, NOTE_EXCERPT_MAX);
  return [
    "## Resumed SISpace task",
    "",
    `- Task id: ${task.id}`,
    `- Title: ${task.title}`,
    `- Status: ${task.status}`,
    `- Project: ${task.project_root}`,
    `- Obsidian note: ${notePath}`,
    `- Prior messages loaded: ${messageCount}`,
    "",
    "### Task note excerpt",
    "",
    excerpt || "(empty note body)",
  ].join("\n");
}

export interface ResumeResult {
  ok: boolean;
  state?: SessionState;
  error?: string;
}

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
  const obsidianCfg = loadObsidianYaml(projectRoot);
  const notePath =
    task.obsidian_note_path?.trim() ||
    taskNoteVaultPath(obsidianCfg, task.id);

  let noteBody = "";
  try {
    noteBody = await vaultRead(notePath);
  } catch {
    noteBody = "";
  }

  const messages = loadTaskMessages(db, task.id);
  const lines: string[] = [
    `[resumed ${task.id}] ${task.title} (${task.status})`,
    `obsidian: ${notePath}`,
    "— prior messages —",
  ];
  for (const msg of messages) {
    lines.push(messageToLine(msg));
  }
  lines.push(
    `[${task.id}] ready — resumed context; type a message or /help.`,
  );

  const skill = skillFromTaskType(projectRoot, task.task_type);
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
    resumeContextBlock: buildResumeContextBlock(
      task,
      notePath,
      noteBody,
      messages.length,
    ),
    obsidianContextFetched: false,
    lines,
  };

  return {
    ok: true,
    state: { sessions: [session], activeId: sessionId },
  };
}
