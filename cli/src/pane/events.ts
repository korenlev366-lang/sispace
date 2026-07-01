import { createConnection } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface PaneEvent {
  type: string;
  sessionId: string;
  taskId?: string;
  paneId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export function ensureSocketParentDir(socketPath: string): void {
  const parent = dirname(socketPath);
  if (!parent || parent === "." || parent === "/") {
    return;
  }
  try {
    mkdirSync(parent, { recursive: true });
  } catch {
    // Hub may create the directory.
  }
}

export async function emitPaneEvent(
  socketPath: string,
  event: PaneEvent,
): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    socket.on("connect", () => {
      socket.write(line, () => socket.end());
    });
    socket.on("close", () => resolve());
    socket.on("error", (err) => reject(err));
  });
}

export function parseInjectLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed) as { op?: string; text?: string };
    if (obj.op === "inject_prompt" && typeof obj.text === "string") {
      return obj.text;
    }
  } catch {
    return null;
  }
  return null;
}
