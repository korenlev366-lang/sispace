/**
 * Static verification for chat save/resume wiring.
 * Run: node tests/verify-cursorsi-chat-persist.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

assert(existsSync(path.join(root, "cli/src/session/chat-persist.ts")), "chat-persist.ts exists");

const persist = read("cli/src/session/chat-persist.ts");
assert(persist.includes("ensureChatTask"), "ensureChatTask");
assert(persist.includes("persistChatTurn"), "persistChatTurn");
assert(persist.includes('kind":"chat"') || persist.includes("kind: \"chat\"") || persist.includes("'chat'"), "metadata kind=chat");
assert(persist.includes("listRecentChats"), "listRecentChats");
assert(persist.includes("updateTaskTitle"), "updateTaskTitle");
assert(persist.includes("updateTaskCursorAgentId"), "updateTaskCursorAgentId");
assert(persist.includes("titleFromFirstMessage"), "titleFromFirstMessage");

assert(persist.includes("getTaskChatMeta"), "getTaskChatMeta");
assert(persist.includes("updateTaskLastBackend"), "updateTaskLastBackend");
assert(persist.includes("buildChatHistoryContextBlock"), "buildChatHistoryContextBlock");

const shared = read("cli/src/db/shared.ts");
assert(shared.includes("defaultTasksDbPath"), "defaultTasksDbPath");
assert(shared.includes("SISPACE_DB_PATH") || shared.includes(".local/share/sispace"), "default DB path fallback");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("persistChatTurn"), "Orchestrator persists turns");
assert(orch.includes("replaceSessionState"), "Orchestrator handles /resume replace");
assert(orch.includes("closeSessionAgent"), "Orchestrator closes agent on resume");
assert(orch.includes("chatRenameDraft"), "Orchestrator supports /chats rename");
assert(orch.includes("updateTaskTitle"), "Orchestrator renames via updateTaskTitle");
assert(orch.includes("commitChatRename"), "Orchestrator commits chat rename");
assert(orch.includes("agentBusyRef"), "Orchestrator tracks agent busy separately");
assert(orch.includes("commandBusyRef"), "Orchestrator tracks command busy separately");
assert(
  orch.includes("Slash commands are allowed while the agent is running"),
  "Orchestrator allows slash while agent busy",
);
assert(orch.includes("turnAbortRef"), "Orchestrator can abort in-flight turns");
assert(orch.includes("lastCtrlCAtRef"), "Orchestrator double-tap Ctrl+C quit");
assert(orch.includes("Cancelling"), "Orchestrator Ctrl+C cancels agent turn");
assert(orch.includes("BusySpinner"), "Orchestrator shows busy spinner while agent runs");
assert(existsSync(path.join(root, "cli/src/tui/BusySpinner.tsx")), "BusySpinner component exists");
assert(orch.includes("PlanPicker"), "Orchestrator renders PlanPicker");
assert(orch.includes("openPlanPicker"), "Orchestrator opens plan picker");
assert(existsSync(path.join(root, "cli/src/tui/PlanPicker.tsx")), "PlanPicker component exists");
assert(existsSync(path.join(root, "cli/src/plan/generate.ts")), "plan generate helper exists");

const busySpinner = read("cli/src/tui/BusySpinner.tsx");
assert(busySpinner.includes("⠋"), "BusySpinner uses npm-style braille frames");

const chatPicker = read("cli/src/tui/ChatPicker.tsx");
assert(chatPicker.includes("renameDraft"), "ChatPicker shows rename draft");
assert(chatPicker.includes("r rename"), "ChatPicker documents r rename");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes('key === "chats"'), "slash /chats");
assert(slash.includes('key === "resume"'), "slash /resume");
assert(slash.includes('key === "rename"'), "slash /rename");
assert(slash.includes('key === "plan"'), "slash /plan");
assert(slash.includes("openPlanPicker"), "slash opens plan picker");
assert(slash.includes("buildResumeSessionState"), "resume uses buildResumeSessionState");
assert(slash.includes("replaceSessionState"), "SlashResult.replaceSessionState");
assert(slash.includes("closeSessionAgent"), "backend switch closes agent");
assert(slash.includes("buildChatHistoryContextBlock"), "backend switch injects history");

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes('"chats"'), "catalog chats");
assert(catalog.includes('"resume"'), "catalog resume");
assert(catalog.includes('"rename"'), "catalog rename");
assert(catalog.includes('"plan"'), "catalog plan");

const sessionAgent = read("cli/src/sdk/session-agent.ts");
assert(sessionAgent.includes("seedHistoryFromTaskMessages"), "OpenRouter seed from task_messages");
assert(sessionAgent.includes("seedHistory"), "seedHistory passed to OpenRouterAgent");
assert(sessionAgent.includes("cached.backend === backend"), "agent cache refuses cross-backend reuse");
assert(sessionAgent.includes("canResumeCursor"), "Cursor resume gated on last_backend");
assert(sessionAgent.includes("signal"), "sendSessionMessage accepts abort signal");
assert(sessionAgent.includes("cancelled"), "sendSessionMessage reports cancelled");

const openrouter = read("cli/src/sdk/openrouter.ts");
assert(openrouter.includes("seedHistory"), "OpenRouterAgent accepts seedHistory");

if (failures.length) {
  console.error("verify-cursorsi-chat-persist FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-chat-persist: all checks passed");
