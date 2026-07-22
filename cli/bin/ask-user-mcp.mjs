#!/usr/bin/env node
/**
 * Minimal stdio MCP server: ask_user → Unix socket → cursorsi QuestionPicker.
 * Env: CURSORSI_ASK_SOCK=/path/to.sock
 */
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const SOCK = process.env.CURSORSI_ASK_SOCK?.trim();
if (!SOCK) {
  console.error("ask-user-mcp: CURSORSI_ASK_SOCK is required");
  process.exit(1);
}

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function askViaSocket(prompt, options) {
  return new Promise((resolve, reject) => {
    const id = `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sock = createConnection(SOCK);
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("ask_user timed out (120s)"));
    }, 120_000);

    sock.setEncoding("utf8");
    sock.on("connect", () => {
      sock.write(
        `${JSON.stringify({
          id,
          prompt,
          ...(options?.length ? { options } : {}),
        })}\n`,
      );
    });
    sock.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl).trim();
      clearTimeout(timer);
      sock.end();
      try {
        const msg = JSON.parse(line);
        if (msg.error) reject(new Error(msg.error));
        else resolve(String(msg.answer ?? ""));
      } catch (err) {
        reject(err);
      }
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const TOOLS = [
  {
    name: "ask_user",
    description:
      "Ask the human a clarifying question in the SISpace/cursorsi QuestionPicker UI. REQUIRED whenever you need a choice or clarification before proceeding — do not ask multiple-choice questions only in chat prose. Prefer short options when possible.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Question to show the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional multiple-choice options (max 8)",
        },
      },
      required: ["prompt"],
    },
  },
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  const raw = line.trim();
  if (!raw) return;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // JSON-RPC notification (no id)
  if (msg.method && msg.id === undefined) {
    return;
  }

  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      write({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "cursorsi-ask", version: "0.1.0" },
        },
      });
      return;
    }
    if (method === "ping") {
      write({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name !== "ask_user") {
        write({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          },
        });
        return;
      }
      const prompt = String(args.prompt ?? "").trim();
      const options = Array.isArray(args.options)
        ? args.options.map(String).filter(Boolean).slice(0, 8)
        : [];
      if (!prompt) {
        write({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "prompt is required" }],
            isError: true,
          },
        });
        return;
      }
      const answer = await askViaSocket(prompt, options);
      write({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: answer }],
        },
      });
      return;
    }

    // Unhandled method
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
        isError: true,
      },
    });
  }
});
