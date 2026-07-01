import type { DatabaseSync } from "node:sqlite";
import type { TaskMessage } from "./types.js";

const SELECT_MSG = `SELECT id, task_id, run_id, role, content, created_at
  FROM task_messages`;

function mapRow(row: {
  id: number;
  task_id: string;
  run_id: string | null;
  role: string;
  content: string;
  created_at: string;
}): TaskMessage {
  return {
    id: row.id,
    task_id: row.task_id,
    run_id: row.run_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  };
}

export function listMessages(
  db: DatabaseSync,
  taskId: string,
): TaskMessage[] {
  const rows = db
    .prepare(`${SELECT_MSG} WHERE task_id = ? ORDER BY id ASC`)
    .all(taskId) as unknown as TaskMessage[];
  return rows.map(mapRow);
}

export function messagesAround(
  db: DatabaseSync,
  taskId: string,
  centerId: number,
  window: number,
): TaskMessage[] {
  const lo = Math.max(0, centerId - window);
  const hi = centerId + window;
  const rows = db
    .prepare(
      `${SELECT_MSG} WHERE task_id = ? AND id BETWEEN ? AND ? ORDER BY id ASC`,
    )
    .all(taskId, lo, hi) as unknown as TaskMessage[];
  return rows.map(mapRow);
}
