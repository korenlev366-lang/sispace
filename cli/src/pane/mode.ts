import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import type { CliOptions } from "../runtime/cli-options.js";
import type { SessionState } from "../session/types.js";
import {
  createInitialSessionState,
  getActiveSession,
} from "../session/store.js";
import { goalsMdPath } from "../goal/paths.js";
import {
  emitPaneEvent,
  ensureSocketParentDir,
  parseInjectLine,
  type PaneEvent,
} from "./events.js";
import { startControlListener } from "./control.js";

function paneIdFromSocket(socketPath: string): string | undefined {
  const name = basename(socketPath);
  if (name.endsWith(".sock")) {
    return name.slice(0, -".sock".length);
  }
  return undefined;
}

function baseEvent(
  type: string,
  session: { id: string; taskId?: string },
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

function readGoalStatusSummary(cwd: string): string | null {
  const path = goalsMdPath(cwd);
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("- ") && !t.startsWith("- [")) {
      return t.slice(2).trim().slice(0, 200);
    }
    if (t.startsWith("## ") && t.toLowerCase().includes("active")) {
      continue;
    }
  }
  return text.includes("No active goals") ? "no active goals" : null;
}

/** Phase 4: pane runtime — NDJSON IPC + inject_prompt on stdin JSON lines. */
export async function runPaneMode(
  opts: CliOptions,
  initialSessionState: SessionState | undefined,
  cwd: string,
): Promise<void> {
  const state = initialSessionState ?? createInitialSessionState(cwd);
  const session = getActiveSession(state);
  const paneId = opts.eventSocket
    ? paneIdFromSocket(opts.eventSocket)
    : undefined;
  const socketPath = opts.eventSocket;

  const emit = async (type: string, payload: Record<string, unknown>) => {
    if (!socketPath) {
      return;
    }
    ensureSocketParentDir(socketPath);
    try {
      await emitPaneEvent(
        socketPath,
        baseEvent(type, session, paneId, payload),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`cursorsi pane: event socket error: ${msg}\n`);
    }
  };

  await emit("session_start", {
    model: session.modelId,
    cwd: session.cwd,
    skillBundle: session.skillBundle,
    swarmRole: opts.swarmRole,
  });

  const goalSummary = readGoalStatusSummary(cwd);
  if (goalSummary) {
    await emit("goal_status", { summary: goalSummary, status: "active" });
  }

  let sessionTokens = 0;
  await emit("cost_update", {
    sessionTokens: 0,
    taskTokens: 0,
    projectTokens: 0,
  });

  const label = paneId ?? session.id;
  const roleLabel = opts.swarmRole ? ` role=${opts.swarmRole}` : "";
  process.stdout.write(
    `cursorsi pane [${label}] session=${session.id} model=${session.modelId}${roleLabel}\n`,
  );
  process.stdout.write(
    "Pane mode: inject via orchestrator JSON or type a line (Ctrl+D to exit).\n",
  );

  const costTimer = setInterval(() => {
    void emit("cost_update", {
      sessionTokens,
      taskTokens: sessionTokens,
      projectTokens: sessionTokens,
    });
  }, 30_000);

  const shutdown = async (reason: string) => {
    clearInterval(costTimer);
    await emit("session_end", { reason });
    process.exit(0);
  };

  const handleUserOrInject = async (text: string, injected: boolean) => {
    if (!text) {
      return;
    }
    if (injected) {
      process.stdout.write(`[orchestrator inject] ${text}\n`);
    }
    await emit("agent_turn", {
      role: injected ? "orchestrator" : "user",
      text,
      injected,
    });
    // Pane mode only passes through input — no output token tracking here.
    // Output token counting happens in the actual agent run (Orchestrator).
    await emit("step_start", { agent: "pane-agent", index: 1, total: 1 });
    await emit("step_done", {
      agent: "pane-agent",
      index: 1,
      total: 1,
      status: "ok",
      backend: "pane-stub",
    });
    await emit("agent_complete", {
      status: "ok",
      summary: `Processed ${text.length} chars (pane stub)`,
    });
    await emit("cost_update", {
      sessionTokens,
      taskTokens: sessionTokens,
      projectTokens: sessionTokens,
    });
  };

  if (socketPath) {
    startControlListener(socketPath, (text) => {
      void handleUserOrInject(text, true);
    });
  }

  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line) => {
    void (async () => {
      const injected = parseInjectLine(line);
      const text = injected ?? line.trim();
      await handleUserOrInject(text, Boolean(injected));
    })();
  });

  rl.on("close", () => {
    void shutdown("stdin_closed");
  });

  process.once("SIGINT", () => {
    void shutdown("sigint");
  });
  process.once("SIGTERM", () => {
    void shutdown("sigterm");
  });
}
