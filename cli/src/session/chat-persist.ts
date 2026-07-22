/**
 * Durable chat save/resume helpers for the shared SISpace tasks.db.
 * Auto-creates lightweight chat tasks (metadata_json.kind = "chat") and
 * persists user/assistant turns + cursor_agent_id.
 */

import { createRequire } from "node:module";
import { openSharedDbRead, openSharedDbWrite } from "../db/shared.js";
import type { CliSession } from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const TITLE_MAX = 60;

export interface ChatListEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export interface ChatTaskMeta {
  kind?: string;
  lastBackend?: "openrouter" | "cursor" | "compatible";
}

export interface EnsureChatResult {
  ok: boolean;
  taskId?: string;
  title?: string;
  created?: boolean;
  error?: string;
}

function newTaskId(db: InstanceType<typeof DatabaseSync>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `t_${(Date.now() ^ attempt).toString(16).slice(-8).padStart(8, "0")}`;
    const exists = db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE id = ?")
      .get(id) as { c: number };
    if (!exists.c) {
      return id;
    }
  }
  throw new Error("failed to generate unique task id");
}

function mergeTaskMetadata(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
  patch: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT metadata_json FROM tasks WHERE id = ?")
    .get(taskId) as { metadata_json: string } | undefined;
  const meta = row?.metadata_json
    ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
    : {};
  Object.assign(meta, patch);
  db.prepare(
    "UPDATE tasks SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(meta), taskId);
}

/** Read chat metadata (kind / lastBackend) from a task row. */
export function getTaskChatMeta(taskId: string): ChatTaskMeta | null {
  const db = openSharedDbRead();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT metadata_json FROM tasks WHERE id = ?")
      .get(taskId) as { metadata_json: string } | undefined;
    if (!row?.metadata_json) return null;
    const raw = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const last =
      raw.last_backend === "cursor" ||
      raw.last_backend === "openrouter" ||
      raw.last_backend === "compatible"
        ? raw.last_backend
        : undefined;
    return {
      kind: typeof raw.kind === "string" ? raw.kind : undefined,
      lastBackend: last,
    };
  } catch {
    return null;
  }
}

/** Record which backend last owned this chat (for safe Agent.resume). */
export function updateTaskLastBackend(
  taskId: string,
  backend: "openrouter" | "cursor" | "compatible",
): void {
  const db = openSharedDbWrite();
  if (!db) return;
  try {
    mergeTaskMetadata(db, taskId, { kind: "chat", last_backend: backend });
  } catch {
    // non-fatal
  }
}

const HISTORY_CONTEXT_MAX = 24_000;

/** Prior turns as a one-shot context block (Cursor after OpenRouter, etc.). */
export function buildChatHistoryContextBlock(taskId: string): string | null {
  const db = openSharedDbRead();
  if (!db) return null;
  try {
    const messages = db
      .prepare(
        `SELECT role, content FROM task_messages
         WHERE task_id = ? ORDER BY id ASC`,
      )
      .all(taskId) as Array<{ role: string; content: string }>;
    if (messages.length === 0) return null;

    const lines: string[] = [
      "## Prior chat history (switched backend or fresh agent)",
      "",
      "Continue this conversation. Prior turns:",
      "",
    ];
    for (const msg of messages) {
      if (msg.role === "user") {
        lines.push(`user> ${msg.content}`, "");
      } else if (msg.role === "assistant") {
        lines.push(`agent> ${msg.content}`, "");
      }
    }
    const block = lines.join("\n");
    if (block.length <= HISTORY_CONTEXT_MAX) return block;
    return `${block.slice(0, HISTORY_CONTEXT_MAX)}\n\n…(truncated)`;
  } catch {
    return null;
  }
}
export function titleFromFirstMessage(message: string): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Chat ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  if (collapsed.length <= TITLE_MAX) return collapsed;
  return `${collapsed.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * Ensure the session is bound to a chat task row.
 * Creates a new lightweight task when `session.taskId` is missing.
 */
export function ensureChatTask(
  session: CliSession,
  firstUserMessage: string,
): EnsureChatResult {
  if (session.taskId?.trim()) {
    return {
      ok: true,
      taskId: session.taskId.trim(),
      title: session.title,
      created: false,
    };
  }

  const db = openSharedDbWrite();
  if (!db) {
    return {
      ok: false,
      error: "Shared tasks database not found. Set SISPACE_DB_PATH or pass --db-path.",
    };
  }

  try {
    const probe = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='tasks'",
      )
      .get() as { ok: number } | undefined;
    if (!probe) {
      return {
        ok: false,
        error:
          "tasks.db has no schema — run SISpace once to initialize the shared database.",
      };
    }
    const id = newTaskId(db);
    const title = titleFromFirstMessage(firstUserMessage);
    const metadata = JSON.stringify({ kind: "chat" });
    db.prepare(
      `INSERT INTO tasks (
         id, title, status, task_type, project_root, model_id, metadata_json
       ) VALUES (?, ?, 'in_progress', 'custom', ?, ?, ?)`,
    ).run(
      id,
      title,
      session.cwd,
      session.modelId?.trim() || null,
      metadata,
    );
    db.prepare(
      "INSERT INTO task_events (task_id, event_type, payload_json) VALUES (?, ?, ?)",
    ).run(id, "created", JSON.stringify({ kind: "chat" }));

    return { ok: true, taskId: id, title, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function insertTaskMessage(
  taskId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  runId?: string,
): { ok: boolean; error?: string } {
  const db = openSharedDbWrite();
  if (!db) {
    return { ok: false, error: "Shared tasks database not found." };
  }
  try {
    db.prepare(
      "INSERT INTO task_messages (task_id, role, content, run_id) VALUES (?, ?, ?, ?)",
    ).run(taskId, role, content, runId ?? null);
    db.prepare(
      "UPDATE tasks SET updated_at = datetime('now') WHERE id = ?",
    ).run(taskId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function updateTaskCursorAgentId(
  taskId: string,
  agentId: string,
): { ok: boolean; error?: string } {
  const db = openSharedDbWrite();
  if (!db) {
    return { ok: false, error: "Shared tasks database not found." };
  }
  try {
    db.prepare(
      "UPDATE tasks SET cursor_agent_id = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(agentId, taskId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function updateTaskTitle(
  taskId: string,
  title: string,
): { ok: boolean; error?: string } {
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return { ok: false, error: "Title must be non-empty." };
  }
  const db = openSharedDbWrite();
  if (!db) {
    return { ok: false, error: "Shared tasks database not found." };
  }
  try {
    const exists = db
      .prepare("SELECT 1 AS ok FROM tasks WHERE id = ?")
      .get(taskId) as { ok: number } | undefined;
    if (!exists) {
      return { ok: false, error: `Task ${taskId} not found.` };
    }
    db.prepare(
      "UPDATE tasks SET title = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(trimmed, taskId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Recent chats (metadata kind=chat), newest first. */
export function listRecentChats(limit = 20): {
  ok: boolean;
  chats?: ChatListEntry[];
  error?: string;
} {
  const db = openSharedDbRead();
  if (!db) {
    return {
      ok: false,
      error: "Shared tasks database not found. Set SISPACE_DB_PATH or pass --db-path.",
    };
  }
  try {
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.updated_at,
                (SELECT COUNT(*) FROM task_messages m WHERE m.task_id = t.id) AS message_count
         FROM tasks t
         WHERE json_extract(t.metadata_json, '$.kind') = 'chat'
         ORDER BY t.updated_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 100))) as Array<{
      id: string;
      title: string;
      updated_at: string;
      message_count: number;
    }>;
    return {
      ok: true,
      chats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updated_at: r.updated_at,
        message_count: Number(r.message_count) || 0,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Persist a completed turn (user + assistant) and optional Cursor agent id. */
export function persistChatTurn(opts: {
  session: CliSession;
  userMessage: string;
  assistantText: string;
  agentId?: string;
}): {
  ok: boolean;
  taskId?: string;
  title?: string;
  created?: boolean;
  error?: string;
} {
  const ensured = ensureChatTask(opts.session, opts.userMessage);
  if (!ensured.ok || !ensured.taskId) {
    return ensured;
  }

  const userIns = insertTaskMessage(ensured.taskId, "user", opts.userMessage);
  if (!userIns.ok) {
    return { ok: false, error: userIns.error, taskId: ensured.taskId };
  }

  const asstIns = insertTaskMessage(
    ensured.taskId,
    "assistant",
    opts.assistantText || "(empty response)",
  );
  if (!asstIns.ok) {
    return { ok: false, error: asstIns.error, taskId: ensured.taskId };
  }

  if (opts.agentId?.trim()) {
    updateTaskCursorAgentId(ensured.taskId, opts.agentId.trim());
  }

  return {
    ok: true,
    taskId: ensured.taskId,
    title: ensured.title,
    created: ensured.created,
  };
}
