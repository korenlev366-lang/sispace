import { createServer, type Server } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { parseInjectLine } from "./events.js";

export function ctrlSocketPath(eventSocket: string): string {
  if (eventSocket.endsWith(".sock")) {
    return `${eventSocket.slice(0, -5)}.ctrl.sock`;
  }
  return `${eventSocket}.ctrl.sock`;
}

/** Listen for orchestrator inject lines from SISpace (replaces PTY stdin JSON). */
export function startControlListener(
  eventSocket: string,
  onInject: (text: string) => void,
): Server | null {
  if (!eventSocket) {
    return null;
  }
  const path = ctrlSocketPath(eventSocket);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
  const server = createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const text = parseInjectLine(line);
        if (text) {
          onInject(text);
        }
      }
    });
  });
  server.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cursorsi pane: control socket error: ${msg}\n`);
  });
  server.listen(path, () => {
    process.stderr.write(`cursorsi pane: control socket ${path}\n`);
  });
  return server;
}
