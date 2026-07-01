import type { CliSession } from "../session/types.js";
import { closeSessionAgent } from "../sdk/session-agent.js";
import { updateTaskModelPref } from "./task-prefs.js";
import {
  formatModelChoiceLabel,
  storedChoiceFromSession,
  type StoredModelChoice,
} from "./selection.js";

export interface ApplyModelChoiceResult {
  sessionPatch: Partial<CliSession>;
  message: string;
}

export function applyOrchestratorModelChoice(
  session: CliSession,
  choice: StoredModelChoice,
): ApplyModelChoiceResult {
  const label = formatModelChoiceLabel(choice);
  const patch: Partial<CliSession> = {
    modelId: choice.modelId,
    modelParams: choice.params,
  };

  if (
    session.modelId !== choice.modelId ||
    JSON.stringify(session.modelParams ?? []) !== JSON.stringify(choice.params ?? [])
  ) {
    closeSessionAgent(session.id);
  }

  let message = `Orchestrator model set to ${label}`;
  if (session.taskId) {
    const db = updateTaskModelPref(session.taskId, "model_id", choice.modelId);
    if (db.ok) {
      message += ` (task ${session.taskId} updated)`;
    } else if (db.error) {
      message += ` — task DB: ${db.error}`;
    }
  }

  return { sessionPatch: patch, message };
}

export function applySubagentModelChoice(
  session: CliSession,
  choice: StoredModelChoice,
): ApplyModelChoiceResult {
  const label = formatModelChoiceLabel(choice);
  const patch: Partial<CliSession> = {
    subagentModelId: choice.modelId,
    subagentModelParams: choice.params,
  };

  let message = `Subagent model set to ${label} (pipeline specialists only)`;
  if (session.taskId) {
    const db = updateTaskModelPref(
      session.taskId,
      "subagent_model_id",
      choice.modelId,
    );
    if (db.ok) {
      message += ` (task ${session.taskId} updated)`;
    } else if (db.error) {
      message += ` — task DB: ${db.error}`;
    }
  } else {
    message += " — link a task with --resume to persist";
  }

  return { sessionPatch: patch, message };
}

export function currentPickerChoice(
  session: CliSession,
  target: "orchestrator" | "subagent",
): StoredModelChoice {
  if (target === "subagent") {
    return storedChoiceFromSession(
      session.subagentModelId ?? session.modelId,
      session.subagentModelParams,
    );
  }
  return storedChoiceFromSession(session.modelId, session.modelParams);
}
