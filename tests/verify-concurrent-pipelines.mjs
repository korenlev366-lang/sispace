/**
 * Static verification for multiplexed pipeline lifecycle wiring (task t_1c26de98).
 * Run: node tests/verify-concurrent-pipelines.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function verifyReactWiring() {
  const app = read("src/App.tsx");
  const taskPanel = read("src/components/agent/TaskPanel.tsx");
  const kanban = read("src/components/kanban/KanbanBoard.tsx");

  assert(
    app.includes("runningPipelineIds"),
    "App.tsx must track runningPipelineIds globally",
  );
  assert(
    app.includes("pipelineProgressByTaskId"),
    "App.tsx must cache per-task pipeline progress",
  );
  assert(
    /listen<PipelineEvent>\("agent-pipeline"/.test(app),
    "App.tsx must listen for agent-pipeline events",
  );
  assert(
    /listen<\{ taskId: string \}>\("agent-pipeline-finished"/.test(app),
    "App.tsx must listen for agent-pipeline-finished events",
  );
  assert(
    app.includes("runningPipelineIds={runningPipelineIds}"),
    "App.tsx must pass runningPipelineIds to child components",
  );
  assert(
    app.includes("queuedPipelinePositions"),
    "App.tsx must track queuedPipelinePositions",
  );
  assert(
    app.includes("pipeline-queue-updated"),
    "App.tsx must listen for pipeline-queue-updated events",
  );

  assert(
    taskPanel.includes("runningPipelineIds: Set<string>"),
    "TaskPanel must accept runningPipelineIds prop",
  );
  assert(
    /runningPipelineIds\.has\(task\.id\)/.test(taskPanel),
    "TaskPanel running state must derive from runningPipelineIds",
  );
  assert(
    !taskPanel.includes("setRunning"),
    "TaskPanel must not use ephemeral local running state",
  );
  assert(
    taskPanel.includes("queuedPipelinePositions"),
    "TaskPanel must accept queuedPipelinePositions prop",
  );
  assert(
    taskPanel.includes("result.queued"),
    "TaskPanel must handle queued agent_start results",
  );

  assert(
    kanban.includes("runningPipelineIds"),
    "KanbanBoard must accept runningPipelineIds prop",
  );
  assert(
    /runningPipelineIds\?\.has\(task\.id\)/.test(kanban),
    "KanbanBoard must show pipeline indicator from runningPipelineIds",
  );
  assert(
    kanban.includes("task-pipeline-running"),
    "KanbanBoard must render pipeline-running indicator class",
  );
  assert(
    kanban.includes("task-pipeline-queued"),
    "KanbanBoard must render queue badge for queued pipelines",
  );
}

function verifyRustWiring() {
  const agents = read("src-tauri/src/commands/agents.rs");
  const state = read("src-tauri/src/state.rs");
  const pipelineClient = read("src-tauri/src/services/pipeline_client.rs");
  const status = read("src-tauri/src/commands/status.rs");
  const lib = read("src-tauri/src/lib.rs");
  const shutdown = read("src-tauri/src/services/shutdown.rs");
  const main = read("src-tauri/src/main.rs");
  const nodeHost = read("src-tauri/src/services/node_host.rs");

  assert(
    state.includes("active_pipelines: Mutex<HashSet<String>>"),
    "AppState must track active_pipelines",
  );
  assert(
    state.includes("pipeline_queue: Mutex<VecDeque"),
    "AppState must track pipeline_queue",
  );
  assert(
    state.includes("max_concurrent_pipelines: usize"),
    "AppState must store max_concurrent_pipelines",
  );
  assert(
    /pub fn register_active_pipeline/.test(state),
    "state.rs must expose register_active_pipeline helper",
  );
  assert(
    /pub fn enqueue_pipeline/.test(state),
    "state.rs must expose enqueue_pipeline helper",
  );
  assert(
    agents.includes("enqueue_pipeline"),
    "agent_start must enqueue when at capacity",
  );
  assert(
    agents.includes("max_concurrent_pipelines"),
    "agent_start must check max_concurrent_pipelines",
  );
  assert(
    pipelineClient.includes("unregister_active_pipeline"),
    "pipeline_client must unregister task on stream exit",
  );
  assert(
    pipelineClient.includes("drain_pipeline_queue"),
    "pipeline_client must drain queue after unregister",
  );
  assert(
    pipelineClient.includes("agent-pipeline-finished"),
    "pipeline_client must emit agent-pipeline-finished when stream ends",
  );
  assert(
    pipelineClient.includes("abort_active_pipelines"),
    "pipeline_client must abort stale pipelines on sidecar restart",
  );
  assert(
    status.includes("active_pipeline_task_ids"),
    "get_app_status must expose active_pipeline_task_ids for UI sync",
  );
  assert(
    lib.includes("active_pipelines"),
    "lib.rs must initialize active_pipelines in AppState",
  );
  assert(
    lib.includes("pipeline_queue"),
    "lib.rs must initialize pipeline_queue in AppState",
  );
  assert(
    lib.includes("max_concurrent_pipelines"),
    "lib.rs must initialize max_concurrent_pipelines in AppState",
  );
  assert(
    shutdown.includes("pipeline_queue"),
    "shutdown must clear pipeline_queue",
  );
  assert(
    main.includes("SIGTERM") || main.includes("sigterm"),
    "main.rs must handle SIGTERM for graceful shutdown",
  );
  assert(
    nodeHost.includes("process_group"),
    "node_host must spawn node sidecar in its own process group",
  );
}

verifyReactWiring();
verifyRustWiring();

if (failures.length > 0) {
  console.error("verify-concurrent-pipelines FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("verify-concurrent-pipelines: all checks passed");
