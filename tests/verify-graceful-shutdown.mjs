/**
 * Static verification for graceful shutdown wiring (SIGTERM/SIGINT, child cleanup).
 * Run: node tests/verify-graceful-shutdown.mjs
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

function verifyMainSignalHandlers() {
  const main = read("src-tauri/src/main.rs");
  assert(
    main.includes("ctrlc::set_handler"),
    "main.rs must install SIGINT handler via ctrlc",
  );
  assert(
    main.includes("SIGTERM") || main.includes("sigterm"),
    "main.rs must install SIGTERM handler on unix",
  );
  assert(
    main.includes("graceful_shutdown_from_signal"),
    "signal handlers must delegate to graceful_shutdown_from_signal",
  );
}

function verifyLibShutdownWiring() {
  const lib = read("src-tauri/src/lib.rs");
  const shutdown = read("src-tauri/src/services/shutdown.rs");

  assert(
    lib.includes("APP_HANDLE"),
    "lib.rs must store APP_HANDLE for signal-driven shutdown",
  );
  assert(
    /WindowEvent::CloseRequested/.test(lib) &&
      lib.includes("graceful_shutdown"),
    "lib.rs must call graceful_shutdown on window close (on_window_event)",
  );
  assert(
    shutdown.includes("node_host.shutdown"),
    "graceful_shutdown must stop node sidecar",
  );
  assert(
    shutdown.includes("terminals::list_running_pids"),
    "graceful_shutdown must enumerate running terminal PIDs",
  );
  assert(
    shutdown.includes('args(["-TERM"'),
    "graceful_shutdown must send SIGTERM to child PIDs before SIGKILL",
  );
  assert(
    shutdown.includes('args(["-KILL"'),
    "graceful_shutdown must escalate to SIGKILL when child survives TERM",
  );
  assert(
    shutdown.includes("active_pipelines") && shutdown.includes("guard.clear()"),
    "graceful_shutdown must clear active_pipelines",
  );
  assert(
    shutdown.includes("pipeline_queue") && shutdown.includes("guard.clear()"),
    "graceful_shutdown must clear pipeline_queue",
  );
  assert(
    shutdown.includes("SHUTDOWN_DONE"),
    "graceful_shutdown must be idempotent",
  );
}

function verifyNodeHostProcessGroup() {
  const nodeHost = read("src-tauri/src/services/node_host.rs");

  assert(
    nodeHost.includes("process_group(0)"),
    "node sidecar spawn must use its own process group",
  );
  assert(
    nodeHost.includes("kill_process_group"),
    "node_host shutdown must kill the sidecar process group",
  );
  assert(
    /kill_process_group\(pid\)/.test(nodeHost),
    "node_host.kill_child must kill process group on unix",
  );
}

verifyMainSignalHandlers();
verifyLibShutdownWiring();
verifyNodeHostProcessGroup();

if (failures.length > 0) {
  console.error("verify-graceful-shutdown FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("verify-graceful-shutdown: all checks passed");
