/**
 * Static verification for ask_user / QuestionPicker wiring.
 * Run: node tests/verify-cursorsi-ask-user.mjs
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

assert(existsSync(path.join(root, "cli/src/tools/ask-user.ts")), "ask-user.ts exists");
assert(existsSync(path.join(root, "cli/src/tui/QuestionPicker.tsx")), "QuestionPicker exists");

const ask = read("cli/src/tools/ask-user.ts");
assert(ask.includes("export function askUser"), "askUser export");
assert(ask.includes("answerAskUser"), "answerAskUser");
assert(ask.includes("setAskUserHeadless"), "headless mode");
assert(ask.includes("no UI"), "headless fallback text");

const defs = read("cli/src/tools/definitions.ts");
assert(defs.includes("askUserTool"), "askUserTool defined");
assert(defs.includes('name: "ask_user"'), "tool name ask_user");
assert(defs.includes("askUserTool,"), "ask_user registered in tool lists");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("QuestionPicker"), "Orchestrator renders QuestionPicker");
assert(orch.includes("openQuestionPicker"), "Orchestrator opens question picker");
assert(orch.includes('"question"'), "overlay includes question");
assert(orch.includes("setAskUserHandler"), "Orchestrator registers ask handler");
assert(
  orch.includes('overlay === "question"'),
  "question overlay key handling",
);

const picker = read("cli/src/tui/QuestionPicker.tsx");
assert(picker.includes("below the prompt") || picker.includes("PlanPicker"), "placement docs");

const bridge = read("cli/src/sdk/cursor-ask-question-bridge.ts");
assert(bridge.includes("handleCursorAskQuestionInteraction"), "Cursor AskQuestion bridge");
assert(bridge.includes("__cursorsiAskQuestion"), "SDK hook marker");
assert(bridge.includes("ensurePatchedCursorSdkPath"), "SDK patch helper");

const cursorBackend = read("cli/src/sdk/cursor-agent-backend.ts");
assert(
  cursorBackend.includes("installCursorAskQuestionHook"),
  "Cursor backend installs AskQuestion hook",
);
assert(
  cursorBackend.includes("ensurePatchedCursorSdkPath"),
  "Cursor backend loads patched SDK",
);
assert(
  cursorBackend.includes("buildCursorAskUserMcpServers"),
  "Cursor backend registers MCP ask_user",
);

assert(existsSync(path.join(root, "cli/bin/ask-user-mcp.mjs")), "ask-user MCP server");
assert(existsSync(path.join(root, "cli/src/tools/ask-user-ipc.ts")), "ask-user IPC");
assert(existsSync(path.join(root, "cli/src/sdk/cursor-ask-mcp.ts")), "cursor-ask-mcp");

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes('"test-ask"'), "/test-ask in catalog");
const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("handleTestAsk"), "/test-ask handler");

const askInstr = read("cli/src/sdk/ask-user-instructions.ts");
assert(askInstr.includes("ASK_USER_SYSTEM_INSTRUCTIONS"), "OpenRouter ask instructions");
assert(askInstr.includes("ASK_USER_CURSOR_INSTRUCTIONS"), "Cursor ask instructions");
assert(
  read("cli/src/sdk/openrouter.ts").includes("ASK_USER_SYSTEM_INSTRUCTIONS"),
  "OpenRouter injects ask_user system instructions",
);
assert(
  read("cli/src/sdk/session-agent.ts").includes("ASK_USER_CURSOR_INSTRUCTIONS"),
  "Cursor turns inject ask_user instructions",
);
assert(
  read("cli/src/sdk/session-agent.ts").includes("askUserHintInjected"),
  "Cursor ask_user hint injected once per session",
);

// Runtime: headless auto-answers
const { askUser, setAskUserHeadless, setAskUserHandler, answerAskUser } =
  await import(new URL("../cli/dist/tools/ask-user.js", import.meta.url).href);

setAskUserHandler(null);
setAskUserHeadless(true);
const headlessAns = await askUser({
  prompt: "Pick one?",
  options: ["alpha", "beta"],
});
assert(headlessAns === "alpha", "headless picks first option");

setAskUserHeadless(false);
let opened = null;
setAskUserHandler((q) => {
  opened = q;
  setTimeout(() => answerAskUser("custom"), 5);
});
const uiAns = await askUser({ prompt: "Name?", options: ["a", "b"] });
assert(opened?.prompt === "Name?", "handler received question");
assert(uiAns === "custom", "UI answer resolves askUser");

// Runtime: Cursor AskQuestion bridge → askUser → success result
const {
  handleCursorAskQuestionInteraction,
  ensurePatchedCursorSdkPath,
} = await import(
  new URL("../cli/dist/sdk/cursor-ask-question-bridge.js", import.meta.url).href
);

setAskUserHeadless(false);
setAskUserHandler((q) => {
  setTimeout(() => answerAskUser(q.options?.[1] ?? "x"), 5);
});

class FakeResult {
  constructor(init) {
    this.init = init;
  }
  static fromJson(json) {
    return { fromJson: json };
  }
}
class FakeRejected {
  constructor(init) {
    this.init = init;
  }
}
const fakeResponses = {
  askQuestion: (id, result) => ({ id, result }),
};
const fakePb = { tz: FakeResult, ox: FakeRejected };

const bridged = await handleCursorAskQuestionInteraction(
  {
    id: "iq_1",
    query: {
      case: "askQuestionInteractionQuery",
      value: {
        args: {
          title: "Need input",
          questions: [
            {
              id: "q1",
              prompt: "Which mode?",
              options: [
                { id: "agent", label: "Agent" },
                { id: "plan", label: "Plan" },
              ],
            },
          ],
        },
      },
    },
  },
  fakeResponses,
  fakePb,
);
assert(bridged?.id === "iq_1", "bridge returns interaction id");
assert(
  bridged?.result?.fromJson?.success?.answers?.[0]?.selectedOptionIds?.[0] ===
    "plan",
  "bridge maps selected label to option id",
);

const sdkAbs = path.join(
  root,
  "sidecar/node_modules/@cursor/sdk/dist/esm/index.js",
);
if (existsSync(sdkAbs)) {
  const patched = ensurePatchedCursorSdkPath(sdkAbs);
  assert(existsSync(patched), "patched SDK path exists");
  // Sibling of vendor index.js — webpack chunks resolve as ./${id}.index.js
  assert(
    path.dirname(patched) === path.dirname(sdkAbs),
    "patched SDK must be sibling of vendor index.js (not a subdirectory)",
  );
  assert(
    !patched.includes(`${path.sep}.cursorsi-patched${path.sep}`),
    "patched SDK must not live under .cursorsi-patched/",
  );
  const patchedSrc = readFileSync(patched, "utf8");
  assert(patchedSrc.includes("__cursorsiAskQuestion"), "patched SDK contains hook");
  assert(
    patchedSrc.includes("__cursorsiShellEpipeGuard"),
    "patched SDK guards shell-state fd writes against EPIPE",
  );
  assert(
    (patchedSrc.match(/__cursorsiShellEpipeGuard/g) || []).length >= 3,
    "EPIPE guard applied to all shell-state writers (bash/zsh/…)",
  );
}

// Benign stream errors (write EPIPE from SDK shell) must not exit the process.
const crashLogSrc = read("cli/src/runtime/crash-log.ts");
assert(crashLogSrc.includes("isBenignProcessError"), "exports isBenignProcessError");
assert(crashLogSrc.includes("benign:uncaughtException"), "logs benign uncaught without exit");
assert(crashLogSrc.includes('"EPIPE"'), "treats EPIPE as benign");
assert(crashLogSrc.includes("setRawMode"), "treats setRawMode EIO as benign");


if (failures.length) {
  console.error("verify-cursorsi-ask-user FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-ask-user: all checks passed");
