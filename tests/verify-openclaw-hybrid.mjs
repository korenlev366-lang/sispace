/**
 * Static verification for OpenClaw hybrid (cursor-agent subprocess) wiring.
 * Run: node tests/verify-openclaw-hybrid.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  detectCursorAgent,
  obsidianMcpConfigured,
  resetCursorAgentDetectionCache,
} from "../sidecar/handlers/cursor-agent.mjs";
import {
  buildCursorAgentPrompt,
  shouldUseOpenClawHybrid,
} from "../sidecar/handlers/pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function verifyFiles() {
  assert(read("sidecar/handlers/cursor-agent.mjs").includes("detectCursorAgent"), "cursor-agent.mjs must export detectCursorAgent");
  assert(read("sidecar/handlers/cursor-agent.mjs").includes("--resume"), "cursor-agent.mjs must pass --resume for session reuse");
  assert(read("sidecar/handlers/pipeline.mjs").includes("runHybridSpecialistStep"), "pipeline.mjs must export runHybridSpecialistStep");
  assert(read("sidecar/handlers/pipeline.mjs").includes("step_backend"), "pipeline.mjs must emit step_backend events");
  assert(read("sidecar/handlers/pipeline.ts").includes("runHybridSpecialistStep"), "pipeline.ts barrel must re-export hybrid runner");

  const pipelineRun = read("lib/pipeline-run.mjs");
  assert(pipelineRun.includes("runHybridSpecialistStep"), "pipeline-run must use runHybridSpecialistStep");
  assert(pipelineRun.includes("openClawSessionId"), "pipeline-run must reuse OpenClaw session across steps");
  assert(pipelineRun.includes("backend: hybrid.backend"), "step_done must log backend per step");
  assert(pipelineRun.includes("model: subagent"), "hybrid steps must use subagent model not orchestrator");

  const nodeServer = read("lib/node-server.mjs");
  assert(nodeServer.includes("detectCursorAgent"), "node-server must detect cursor-agent on startup");
  assert(nodeServer.includes("OpenClaw hybrid"), "node-server must log OpenClaw hybrid status");
  assert(nodeServer.includes("./pipeline-run.mjs"), "active node-server must import lib/pipeline-run.mjs");
}

function verifyDetection() {
  resetCursorAgentDetectionCache();
  const detection = detectCursorAgent();
  assert(typeof detection.available === "boolean", "detectCursorAgent must return available boolean");
  if (detection.available) {
    assert(Boolean(detection.path), "detectCursorAgent must include path when available");
  }
}

function verifyHybridLogic() {
  const researcherPrompt = buildCursorAgentPrompt("researcher-agent", "Find files");
  assert(researcherPrompt.includes("researcher-agent"), "buildCursorAgentPrompt must include agent role");

  assert(
    shouldUseOpenClawHybrid("researcher-agent", {
      cursorAgentAvailable: true,
      obsidianConfigured: true,
    }),
    "should use OpenClaw when cursor-agent and Obsidian are configured",
  );
  assert(
    !shouldUseOpenClawHybrid("researcher-agent", {
      cursorAgentAvailable: false,
      obsidianConfigured: true,
    }),
    "must fall back to SDK when cursor-agent unavailable",
  );
  assert(
    !shouldUseOpenClawHybrid("researcher-agent", {
      cursorAgentAvailable: true,
      obsidianConfigured: false,
    }),
    "must fall back to SDK when OBSIDIAN_API_KEY unset",
  );
  assert(
    !shouldUseOpenClawHybrid("harness-orchestrator", {
      cursorAgentAvailable: true,
      obsidianConfigured: true,
    }),
    "non-specialist agents must not use OpenClaw hybrid",
  );
}

verifyFiles();
verifyDetection();
verifyHybridLogic();

if (failures.length > 0) {
  console.error("verify-openclaw-hybrid FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("verify-openclaw-hybrid: all checks passed");
if (detectCursorAgent().available) {
  console.log(`  cursor-agent path: ${detectCursorAgent().path}`);
}
console.log(`  obsidian configured (env): ${obsidianMcpConfigured()}`);
