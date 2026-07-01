import { openSharedDbWrite } from "../db/shared.js";
import { LEGACY_COMPOSER_25_FAST_ID } from "./selection.js";

function normalizeModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "deepseek/deepseek-v4-flash";
  }
  return trimmed;
}

export interface TaskModelUpdateResult {
  ok: boolean;
  error?: string;
}

/** Persist orchestrator or subagent model id on a linked SISpace task. */
export function updateTaskModelPref(
  taskId: string,
  field: "model_id" | "subagent_model_id",
  modelId: string,
): TaskModelUpdateResult {
  const db = openSharedDbWrite();
  if (!db) {
    return { ok: false, error: "Shared tasks database not found." };
  }

  const normalized = normalizeModelId(modelId);
  const column = field === "model_id" ? "model_id" : "subagent_model_id";

  const exists = db
    .prepare("SELECT 1 FROM tasks WHERE id = ?")
    .get(taskId) as { 1: number } | undefined;
  if (!exists) {
    return { ok: false, error: `Task ${taskId} not found.` };
  }

  db.prepare(
    `UPDATE tasks SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(normalized, taskId);

  return { ok: true };
}
