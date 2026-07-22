/**
 * MCP server config that exposes ask_user to Cursor SDK agents.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAskUserIpc } from "../tools/ask-user-ipc.js";
import type { McpServerConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveAskUserMcpScript(): string {
  // dist/sdk → ../../bin/ask-user-mcp.mjs ; also works from src via dist layout
  const candidates = [
    join(__dirname, "../../bin/ask-user-mcp.mjs"),
    join(__dirname, "../../../cli/bin/ask-user-mcp.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

/** Start IPC + return mcpServers entry for Agent.create. */
export function buildCursorAskUserMcpServers(): Record<string, McpServerConfig> {
  const sock = ensureAskUserIpc();
  const script = resolveAskUserMcpScript();
  return {
    cursorsi_ask: {
      command: process.execPath,
      args: [script],
      env: {
        CURSORSI_ASK_SOCK: sock,
      },
    },
  };
}
