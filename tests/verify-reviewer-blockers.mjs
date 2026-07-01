/**
 * Static checks encoding reviewer-agent blockers for task t_bbcf3da2.
 * Expected to FAIL until coder addresses each blocker.
 * Run: node tests/verify-reviewer-blockers.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const blockers = [];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function expectFixed(id, description, stillBroken) {
  if (stillBroken) {
    blockers.push({ id, description });
  }
}

function extractFunctionBody(src, fnName) {
  const start = src.indexOf(`fn ${fnName}`);
  if (start < 0) return "";
  const brace = src.indexOf("{", start);
  if (brace < 0) return "";
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  return "";
}

const main = read("src-tauri/src/main.rs");
const lib = read("src-tauri/src/lib.rs");
const pipelineClient = read("src-tauri/src/services/pipeline_client.rs");
const pipelineLib = read("scripts/pipeline-lib.mjs");
const terminal = read("src-tauri/src/services/terminal.rs");

// Blocker 1: signal handler must not call async-signal-unsafe shutdown/exit directly.
const onSigtermBody = main.match(/fn on_sigterm[\s\S]*?\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
expectFixed(
  1,
  "Signal handler must defer cleanup (atomic flag / self-pipe), not call shutdown_and_exit/process::exit in-handler",
  onSigtermBody.includes("shutdown_and_exit") ||
    main.includes("shutdown_and_exit();") ||
    /set_handler\(\|\| shutdown_and_exit\(\)\)/.test(main),
);

// Blocker 2: dequeued pipeline must be re-enqueued when launch_pipeline fails.
const drainBody = extractFunctionBody(pipelineClient, "drain_pipeline_queue");
const popsBeforeLaunch =
  drainBody.includes("pop_front") &&
  drainBody.indexOf("pop_front") < drainBody.indexOf("launch_pipeline");
const reEnqueuesOnFailure =
  /launch_pipeline[\s\S]*Err\(err\)[\s\S]*(push_front|enqueue_pipeline|re.?queue)/.test(
    drainBody,
  );
expectFixed(
  2,
  "drain_pipeline_queue must re-enqueue dequeued item when launch_pipeline fails (currently dropped after pop_front)",
  popsBeforeLaunch && !reEnqueuesOnFailure,
);

// Blocker 3: single concurrency authority — Node-side limit should be removed or delegated to Rust.
const rustLimits = /max_concurrent_pipelines/.test(read("src-tauri/src/commands/agents.rs"));
const nodeLimits = /activePipelineCount >= maxConcurrent/.test(pipelineLib);
expectFixed(
  3,
  "Avoid dual Rust + Node pipeline concurrency limits (pick one authority)",
  rustLimits && nodeLimits,
);

// Blocker 4: SIGTERM before APP_HANDLE is set must still trigger cleanup fallback.
const signalShutdown = lib.match(
  /pub fn graceful_shutdown_from_signal\(\) \{([\s\S]*?)\n\}/,
)?.[1] ?? "";
expectFixed(
  4,
  "graceful_shutdown_from_signal must handle early SIGTERM before APP_HANDLE is set",
  signalShutdown.includes("APP_HANDLE.get()") &&
    !signalShutdown.includes("else") &&
    !signalShutdown.includes("pending_shutdown"),
);

// Blocker 5: prefer sigaction over signal(2) for SIGTERM.
expectFixed(
  5,
  "SIGTERM handler should use sigaction instead of libc::signal",
  main.includes("libc::signal(libc::SIGTERM") && !main.includes("sigaction"),
);

// Blocker 6: spawned terminals should use process groups for reliable kill on shutdown.
expectFixed(
  6,
  "terminal spawn should set process_group for graceful shutdown kill tree",
  !terminal.includes("process_group") && !terminal.includes("setsid"),
);

// Blocker 7: window close should exit app after graceful_shutdown (avoid blank hung window).
const closeRequestedIdx = lib.indexOf("CloseRequested");
const closeBlock =
  closeRequestedIdx >= 0 ? lib.slice(closeRequestedIdx, closeRequestedIdx + 400) : "";
const closesWithoutExit =
  closeBlock.includes("graceful_shutdown") &&
  !/app\.exit\s*\(/.test(lib) &&
  !/process::exit/.test(lib);
expectFixed(
  7,
  "Window close should exit process after graceful_shutdown to avoid blank screen",
  closesWithoutExit,
);

if (blockers.length > 0) {
  console.error("verify-reviewer-blockers: unresolved blockers remain:");
  for (const { id, description } of blockers) {
    console.error(`  [${id}] ${description}`);
  }
  process.exit(1);
}

console.log("verify-reviewer-blockers: all reviewer blockers resolved");
