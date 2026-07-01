import { basename } from "node:path";
import type { CliOptions } from "../runtime/cli-options.js";
import type { CliSession } from "../session/types.js";
import { emitPaneEvent, ensureSocketParentDir, type PaneEvent } from "./events.js";

function paneIdFromSocket(socketPath: string): string | undefined {
  const name = basename(socketPath);
  if (name.endsWith(".sock")) {
    return name.slice(0, -".sock".length);
  }
  return undefined;
}

function baseEvent(
  type: string,
  session: CliSession,
  paneId: string | undefined,
  payload: Record<string, unknown>,
): PaneEvent {
  return {
    type,
    sessionId: session.id,
    taskId: session.taskId,
    paneId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/** NDJSON pane IPC for full Ink TUI when embedded in SISpace xterm (not --pane-mode). */
export function createTuiPaneBridge(opts: CliOptions, session: CliSession) {
  const socketPath = opts.eventSocket;
  const paneId = socketPath ? paneIdFromSocket(socketPath) : undefined;

  if (!socketPath) {
    return {
      emit: async () => {},
      sessionStart: async () => {},
      agentTurn: async () => {},
      stepStart: async () => {},
      stepDone: async () => {},
      agentComplete: async () => {},
      costUpdate: async () => {},
      sessionEnd: async () => {},
    };
  }

  const emit = async (type: string, payload: Record<string, unknown>) => {
    ensureSocketParentDir(socketPath);
    try {
      await emitPaneEvent(
        socketPath,
        baseEvent(type, session, paneId, payload),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`cursorsi ipc: ${msg}\n`);
    }
  };

  return {
    emit,
    sessionStart: () =>
      emit("session_start", {
        model: session.modelId,
        cwd: session.cwd,
        skillBundle: session.skillBundle,
        swarmRole: opts.swarmRole,
      }),
    agentTurn: (text: string, role: string) =>
      emit("agent_turn", { role, text: text.slice(0, 500) }),
    stepStart: (index: number, total: number) =>
      emit("step_start", { agent: "cursorsi", index, total }),
    stepDone: (index: number, total: number, status: string) =>
      emit("step_done", { agent: "cursorsi", index, total, status }),
    agentComplete: (summary: string) =>
      emit("agent_complete", { status: "ok", summary: summary.slice(0, 300) }),
    costUpdate: (sessionTokens: number) =>
      emit("cost_update", {
        sessionTokens,
        taskTokens: sessionTokens,
        projectTokens: sessionTokens,
      }),
    sessionEnd: (reason: string) => emit("session_end", { reason }),
  };
}
