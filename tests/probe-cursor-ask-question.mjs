/**
 * Live probe: Cursor SDK → MCP ask_user → SISpace askUser bridge.
 *
 * Native AskQuestion is NOT offered in @cursor/sdk local runs (Cursor-confirmed).
 * We register MCP server `cursorsi_ask` / tool `ask_user` instead.
 *
 * Run: node tests/probe-cursor-ask-question.mjs
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "cli/dist");

if (!process.env.CURSOR_API_KEY?.trim()) {
  console.error("probe-cursor-ask-question: CURSOR_API_KEY is not set");
  process.exit(2);
}

const {
  setAskUserHandler,
  setAskUserHeadless,
  answerAskUser,
} = await import(pathToFileURL(path.join(dist, "tools/ask-user.js")).href);

const { ensureAskUserIpc, getAskUserSocketPath } = await import(
  pathToFileURL(path.join(dist, "tools/ask-user-ipc.js")).href
);
const { buildCursorAskUserMcpServers } = await import(
  pathToFileURL(path.join(dist, "sdk/cursor-ask-mcp.js")).href
);
const { getCursorSdk, setCursorSdkImportPath } = await import(
  pathToFileURL(path.join(dist, "sdk/cursor-agent-backend.js")).href
);
const { ensurePatchedCursorSdkPath, installCursorAskQuestionHook } =
  await import(
    pathToFileURL(path.join(dist, "sdk/cursor-ask-question-bridge.js")).href
  );

// ── 1) IPC unit check (no model) ──────────────────────────────────────────
ensureAskUserIpc();
const sock = getAskUserSocketPath();
if (!sock) {
  console.error("probe: IPC socket failed to start");
  process.exit(1);
}

setAskUserHeadless(false);
let ipcHits = 0;
setAskUserHandler((q) => {
  ipcHits += 1;
  console.log(`[probe] askUser via IPC: ${q.prompt}`);
  setTimeout(() => answerAskUser(q.options?.[0] ?? "ok"), 20);
});

await new Promise((resolve, reject) => {
  const c = createConnection(sock);
  let buf = "";
  c.setEncoding("utf8");
  c.on("connect", () => {
    c.write(
      `${JSON.stringify({
        id: "t1",
        prompt: "IPC probe color?",
        options: ["Red", "Blue"],
      })}\n`,
    );
  });
  c.on("data", (chunk) => {
    buf += chunk;
    if (!buf.includes("\n")) return;
    const msg = JSON.parse(buf.trim());
    c.end();
    if (msg.answer !== "Red") {
      reject(new Error(`IPC unexpected answer: ${msg.answer}`));
    } else {
      console.log("[probe] IPC → askUser OK");
      resolve();
    }
  });
  c.on("error", reject);
});

if (ipcHits < 1) {
  console.error("probe: IPC did not hit askUser handler");
  process.exit(1);
}

// ── 2) Live Cursor agent with MCP ask_user ────────────────────────────────
const sdkAbs = path.join(
  root,
  "sidecar/node_modules/@cursor/sdk/dist/esm/index.js",
);
setCursorSdkImportPath(
  pathToFileURL(ensurePatchedCursorSdkPath(sdkAbs)).href,
);
installCursorAskQuestionHook();

let mcpAskHits = 0;
setAskUserHandler((q) => {
  mcpAskHits += 1;
  console.log(`[probe] QuestionPicker path: ${q.prompt}`);
  if (q.options?.length) console.log(`  options: ${q.options.join(" | ")}`);
  const pick = q.options?.[1] ?? q.options?.[0] ?? "probe-ok";
  setTimeout(() => {
    console.log(`[probe] auto-answering: ${pick}`);
    answerAskUser(pick);
  }, 50);
});

const mcpServers = buildCursorAskUserMcpServers();
console.log("[probe] mcpServers:", JSON.stringify(mcpServers, null, 2));

console.log("[probe] loading Cursor SDK…");
const sdk = await getCursorSdk();
console.log("[probe] creating agent with cursorsi_ask MCP…");

const agent = await sdk.Agent.create({
  model: { id: "composer-2" },
  apiKey: process.env.CURSOR_API_KEY,
  local: { cwd: root },
  name: "cursorsi-ask-probe",
  mcpServers,
});

const prompt = [
  "You have an MCP server named cursorsi_ask with tool ask_user.",
  "You MUST call that tool (via CallMcpTool / MCP) exactly once before any other work.",
  'Call ask_user with prompt "Probe: which color?" and options ["Red","Blue"].',
  "After you receive the answer, reply with only: GOT:<answer>",
  "Do not skip the tool. Do not invent an answer.",
].join("\n");

console.log("[probe] sending turn…");
const run = await agent.send(prompt);
const result = await run.wait();

console.log("[probe] run status:", result.status);
console.log("[probe] result text:", (result.result ?? "").slice(0, 500));
console.log("[probe] askUser hits during agent turn:", mcpAskHits);

try {
  agent.close();
} catch {
  // ignore
}

if (mcpAskHits < 1) {
  console.error(
    "probe-cursor-ask-question FAILED: agent did not call MCP ask_user (or MCP not wired).",
  );
  process.exit(1);
}
console.log("probe-cursor-ask-question: OK — MCP ask_user hit QuestionPicker path");
