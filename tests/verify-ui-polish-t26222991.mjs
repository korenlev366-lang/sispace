/**
 * Static + light runtime verification for UI polish (task t_26222991).
 * Run: node tests/verify-ui-polish-t26222991.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function verifyStatic() {
  const srcDir = path.join(repoRoot, "src");
  const agentChat = read("src/components/agent/AgentChat.tsx");
  const taskPanel = read("src/components/agent/TaskPanel.tsx");
  const appTsx = read("src/App.tsx");
  const appCss = read("src/App.css");
  const pipelineClient = read("src-tauri/src/services/pipeline_client.rs");
  const pipelineRun = read("lib/pipeline-run.mjs");
  const kanban = read("src/components/kanban/KanbanBoard.tsx");

  assert(!agentChat.includes("useVirtualizer"), "AgentChat must not use @tanstack/react-virtual");
  assert(agentChat.includes('scrollMode?: "smooth" | "instant"'), "AgentChat scrollMode prop");
  assert(
    agentChat.includes("container.scrollTop = container.scrollHeight"),
    "AgentChat instant scroll uses container.scrollTop",
  );
  assert(agentChat.includes("dedupeDisplayMessages"), "AgentChat display dedupe");
  assert(
    taskPanel.includes('scrollMode={running ? "instant" : "smooth"}'),
    "TaskPanel passes instant scroll while pipeline running",
  );
  assert(appTsx.includes("header-multitask-toggle"), "Header multitask toggle");
  assert(
    appTsx.includes("pipeline is running") && appTsx.includes("reflection is in progress"),
    "Friendly delete error mapping",
  );
  assert(
    pipelineClient.includes("assistant_message_exists") &&
      pipelineClient.includes('"step_done"'),
    "step_done uses assistant_message_exists guard",
  );
  const stepDoneEmit = pipelineRun.slice(
    pipelineRun.indexOf('type: "step_done"'),
    pipelineRun.indexOf('type: "step_done"') + 400,
  );
  assert(pipelineRun.includes('type: "step_content"'), "pipeline-run emits step_content");
  assert(
    stepDoneEmit.includes('type: "step_done"') && !stepDoneEmit.includes("result:"),
    "pipeline-run step_done emit must not include result (slim UI event)",
  );
  assert(appCss.includes("@keyframes message-in"), "message-in animation");
  assert(appCss.includes("@keyframes panel-in"), "panel-in animation");
  assert(appCss.includes(".kanban-column.drag-over"), "kanban drag-over style");
  assert(
    appCss.includes("prefers-reduced-motion: reduce") &&
      appCss.includes("animation: none"),
    "reduced-motion disables animations",
  );
  assert(
    appCss.includes(".task-card.selected .task-delete-btn"),
    "delete visible on selected kanban cards",
  );
  assert(
    appCss.includes(".chat-message") && appCss.includes("isolation: isolate"),
    "chat message layout isolation",
  );
  assert(kanban.includes("drag-over"), "KanbanBoard drag-over state");
}

async function verifyMotionRuntime() {
  const css = read("src/App.css");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${css}</style></head><body>
        <article class="chat-message role-assistant"><pre class="chat-content">hi</pre></article>
      </body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    const animationName = await page.locator(".chat-message").evaluate((el) => {
      return getComputedStyle(el).animationName;
    });
    assert(
      animationName && animationName !== "none",
      `[runtime] .chat-message should have message-in animation, got "${animationName}"`,
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  verifyStatic();
  await verifyMotionRuntime();

  if (failures.length > 0) {
    console.error("FAIL");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }
  console.log("PASS — verify-ui-polish-t26222991 (static + chat motion runtime)");
}

main().catch((err) => {
  console.error("FAIL — unexpected error:", err);
  process.exit(1);
});
