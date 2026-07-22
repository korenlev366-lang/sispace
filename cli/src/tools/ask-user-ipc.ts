/**
 * Unix-socket bridge so a Cursor MCP subprocess can pause on askUser()
 * in the parent cursorsi process (QuestionPicker).
 *
 * Cursor's native AskQuestion is not offered in @cursor/sdk local runs
 * (confirmed by Cursor + our probe). MCP ask_user is the working path.
 */

import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askUser } from "./ask-user.js";

type AskRequest = {
  id: string;
  prompt: string;
  options?: string[];
};

type AskResponse = {
  id: string;
  answer?: string;
  error?: string;
};

let server: Server | null = null;
let socketPath: string | null = null;

function send(socket: Socket, msg: AskResponse): void {
  socket.write(`${JSON.stringify(msg)}\n`);
}

async function handleLine(socket: Socket, line: string): Promise<void> {
  let req: AskRequest;
  try {
    req = JSON.parse(line) as AskRequest;
  } catch {
    send(socket, { id: "?", error: "invalid JSON" });
    return;
  }
  if (!req?.id || !req.prompt) {
    send(socket, { id: req?.id ?? "?", error: "id and prompt required" });
    return;
  }
  try {
    const answer = await askUser({
      prompt: String(req.prompt),
      ...(Array.isArray(req.options) ? { options: req.options.map(String) } : {}),
    });
    send(socket, { id: req.id, answer });
  } catch (err) {
    send(socket, {
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Start (or reuse) the IPC server; returns the socket path. */
export function ensureAskUserIpc(): string {
  if (server && socketPath) return socketPath;

  const path = join(tmpdir(), `cursorsi-ask-${process.pid}.sock`);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }

  socketPath = path;
  server = createServer((socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) void handleLine(socket, line);
      }
    });
  });

  server.listen(path);
  server.unref();

  const cleanup = () => {
    try {
      server?.close();
    } catch {
      // ignore
    }
    if (socketPath && existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
    server = null;
    socketPath = null;
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  return path;
}

export function getAskUserSocketPath(): string | null {
  return socketPath;
}
