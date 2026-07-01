import { createRequire } from "node:module";
import { openSharedDbRead } from "../db/shared.js";
import { listMessages } from "../search/messages.js";
import type { TaskMessage } from "../search/types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  task_type: string;
  project_root: string;
  obsidian_note_path: string | null;
  model_id: string | null;
  subagent_model_id: string | null;
  cursor_agent_id: string | null;
  swarm_root_id: string | null;
}

export function openTasksDb(): InstanceType<typeof DatabaseSync> | null {
  return openSharedDbRead();
}

export function getTaskRow(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
): TaskRow | null {
  const row = db
    .prepare(
      `SELECT id, title, status, task_type, project_root, obsidian_note_path,
              model_id, subagent_model_id, cursor_agent_id, swarm_root_id
       FROM tasks WHERE id = ?`,
    )
    .get(taskId) as TaskRow | undefined;
  return row ?? null;
}

export function loadTaskMessages(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
): TaskMessage[] {
  return listMessages(db, taskId);
}
