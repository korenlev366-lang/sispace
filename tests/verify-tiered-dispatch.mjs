/**
 * Static verification for tiered dispatch + session reuse wiring.
 * Run: npm run verify:tiered-dispatch
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  loadModelTiers,
  resolveTierSequence,
} from "../harness/scripts/dist/lib/tier-config.js";
import { parsePipelineTier } from "../harness/scripts/dist/lib/tier-classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function verifyWorkflowSdk() {
  const src = read("harness/scripts/src/lib/workflow-sdk.ts");
  assert(src.includes("classifyPipelineTier"), "workflow-sdk must classify tier before pipeline");
  assert(src.includes("[tier] classified as:"), "workflow-sdk must log tier classification");
  assert(src.includes("resolveTierSequence"), "workflow-sdk must trim sequence by tier");
  assert(src.includes("loadModelTiers"), "workflow-sdk must load models.tiers from config");
  assert(src.includes("stepLabel"), "workflow-sdk must pass step labels to dispatch");
}

function verifySessionAgent() {
  const src = read("cli/src/sdk/session-agent.ts");
  assert(src.includes("agentsByCursorId"), "session-agent must cache agents by cursorAgentId");
  assert(src.includes("AGENT_CACHE_TTL_MS"), "session-agent must define cache TTL");
  assert(src.includes("10 * 60 * 1000"), "session-agent TTL must be 10 minutes");
  assert(src.includes("[session]"), "session-agent must log session reuse");
  assert(src.includes("--resume"), "session-agent cursor-agent path must support --resume");
}

function verifyHarnessOrchestrator() {
  const src = read("harness/scripts/src/lib/harness-orchestrator.ts");
  assert(src.includes("orchestratorsByCursorId"), "harness-orchestrator must cache orchestrators");
  assert(src.includes("[session]"), "harness-orchestrator must log session reuse");
  assert(src.includes("openClawSessionId"), "harness-orchestrator must reuse OpenClaw sessions");
}

function verifyTierConfig() {
  const yaml = read("config/sispace.yaml");
  assert(yaml.includes("models:"), "sispace.yaml must define models section");
  assert(yaml.includes("cheap:"), "sispace.yaml must define models.cheap");
  assert(yaml.includes("default:"), "sispace.yaml must define models.default");
  assert(yaml.includes("reasoning:"), "sispace.yaml must define models.reasoning");

  const tiers = loadModelTiers(repoRoot);
  assert(typeof tiers.cheap === "string" && tiers.cheap.length > 0, "loadModelTiers must return cheap");
  assert(typeof tiers.standard === "string", "loadModelTiers must return standard");
  assert(typeof tiers.reasoning === "string", "loadModelTiers must return reasoning");
}

function verifyTierLogic() {
  const featureFull = [
    "researcher-agent",
    "architect-agent",
    "coder-agent",
    "reviewer-agent",
    "tester-agent",
  ];

  assert(
    JSON.stringify(resolveTierSequence("feature", "one-shot", featureFull)) ===
      JSON.stringify(["coder-agent"]),
    "one-shot feature trims to coder only",
  );
  assert(
    JSON.stringify(resolveTierSequence("feature", "two-step", featureFull)) ===
      JSON.stringify(["researcher-agent", "coder-agent"]),
    "two-step feature trims to researcher + coder",
  );
  assert(
    resolveTierSequence("feature", "full", featureFull).length === 5,
    "full feature keeps all specialists",
  );

  assert(parsePipelineTier("one-shot") === "one-shot", "parsePipelineTier one-shot");
  assert(parsePipelineTier("two step please") === "two-step", "parsePipelineTier two-step");
  assert(parsePipelineTier("unknown") === "full", "parsePipelineTier fallback full");
}

function verifyPackageScript() {
  const pkg = read("package.json");
  assert(pkg.includes("verify:tiered-dispatch"), "package.json must register verify:tiered-dispatch");
}

verifyWorkflowSdk();
verifySessionAgent();
verifyHarnessOrchestrator();
verifyTierConfig();
verifyTierLogic();
verifyPackageScript();

if (failures.length > 0) {
  console.error("verify-tiered-dispatch FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("verify-tiered-dispatch: all checks passed");
