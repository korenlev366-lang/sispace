import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenRouterAgent, openRouterPrompt } from "./openrouter.js";
import { formatOptimizerStats, optimizeContextBlock } from "./context-optimizer.js";
import { DEFAULT_MODEL_ID, modelIdToSelection } from "./model-selection.js";
import type { AgentDefinition, RunResult, SDKAgent } from "./sdk-types.js";

export function runResultPayload(run: RunResult): string {
  return run.result ?? "{}";
}

const AGENT_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedOrchestrator {
  agent: SDKAgent;
  lastUsedAt: number;
}

/** Orchestrators keyed by agentId. */
const orchestratorsByCursorId = new Map<string, CachedOrchestrator>();
/** Pipeline name → agentId for reuse within TTL. */
const orchestratorNameToId = new Map<string, string>();

function pruneExpiredOrchestrators(): void {
  const now = Date.now();
  for (const [cursorAgentId, entry] of orchestratorsByCursorId) {
    if (now - entry.lastUsedAt > AGENT_CACHE_TTL_MS) {
      entry.agent.close();
      orchestratorsByCursorId.delete(cursorAgentId);
      for (const [name, mapped] of orchestratorNameToId) {
        if (mapped === cursorAgentId) {
          orchestratorNameToId.delete(name);
        }
      }
    }
  }
}

function logSessionAgent(action: "reused" | "created", stepLabel: string): void {
  console.log(`[session] ${action} agent for ${stepLabel}`);
}

/** Specialists that read Obsidian task notes via MCP when OBSIDIAN_API_KEY is set. */
const OBSIDIAN_SPECIALISTS = new Set([
  "researcher-agent",
  "architect-agent",
  "coder-agent",
  "reviewer-agent",
  "tester-agent",
  "debugger-agent",
  "documenter-agent",
]);

const DEFAULT_OBSIDIAN_MCP_URL = "http://127.0.0.1:27123/mcp/";

let cachedDetection: { available: boolean; path: string | null } | null = null;

function detectCursorAgent(): { available: boolean; path: string | null } {
  if (cachedDetection) return cachedDetection;
  const which = spawnSync("which", ["cursor-agent"], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout?.trim()) {
    cachedDetection = { available: false, path: null };
    return cachedDetection;
  }
  cachedDetection = { available: true, path: which.stdout.trim() };
  return cachedDetection;
}

function obsidianMcpConfigured(): boolean {
  return Boolean((process.env.OBSIDIAN_API_KEY ?? "").trim());
}

function buildInlineObsidianMcpConfig(): Record<string, import("./sdk-types.js").McpServerConfig> | undefined {
  const key = process.env.OBSIDIAN_API_KEY?.trim();
  if (!key) return undefined;
  return {
    obsidian: {
      type: "http",
      url: DEFAULT_OBSIDIAN_MCP_URL,
      headers: { Authorization: `Bearer ${key}` },
    },
  };
}

function prepareInlineObsidianMcpEnv(): { env: Record<string, string>; cleanup: () => void } {
  const key = process.env.OBSIDIAN_API_KEY?.trim();
  if (!key) {
    return { env: {}, cleanup: () => {} };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "sispace-openclaw-"));
  const cursorDir = join(tmpDir, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(
    join(cursorDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        obsidian: {
          type: "http",
          url: DEFAULT_OBSIDIAN_MCP_URL,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    }),
  );

  return {
    env: { CURSOR_CONFIG_DIR: tmpDir },
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function shouldUseOpenClawHybrid(agent: string): boolean {
  return detectCursorAgent().available && obsidianMcpConfigured() && OBSIDIAN_SPECIALISTS.has(agent);
}

function buildCursorAgentPrompt(agent: string, taskPrompt: string): string {
  return [
    `You are swarm subagent "${agent}". Follow your role boundaries and output format exactly.`,
    "",
    taskPrompt,
  ].join("\n");
}

function logOpenClawBackend(backend: "cursor-agent" | "sdk", agent: string): void {
  console.log(`[openclaw] backend: ${backend} (${agent})`);
}

async function runCursorAgentStep(opts: {
  prompt: string;
  cwd: string;
  apiKey: string;
  resumeSessionId?: string;
  model?: string;
}): Promise<{
  result: string;
  sessionId: string | null;
  runId: string | null;
  status: "ok" | "error";
}> {
  const detection = detectCursorAgent();
  if (!detection.available || !detection.path) {
    throw new Error("cursor-agent is not available in PATH");
  }

  const args = ["--trust", "--print", "--output-format", "json", "-p", opts.prompt];
  if (opts.model) args.push("--model", opts.model);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  const { env: mcpEnv, cleanup } = prepareInlineObsidianMcpEnv();
  try {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
      ),
      OPENROUTER_API_KEY: opts.apiKey,
      ...mcpEnv,
    };
    if (process.env.OBSIDIAN_API_KEY) {
      env.OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY;
    }

    const result = spawnSync(detection.path, args, {
      cwd: opts.cwd,
      env,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: 3_600_000,
    });

    if (result.error) throw result.error;

    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();
    if (result.status !== 0) {
      throw new Error(`cursor-agent failed: ${stderr || stdout || `exit ${result.status}`}`);
    }

    let parsed: { is_error?: boolean; result?: unknown; session_id?: string; request_id?: string };
    try {
      parsed = JSON.parse(stdout) as typeof parsed;
    } catch {
      throw new Error(
        `cursor-agent returned non-JSON output: ${stdout.slice(0, 500) || "(empty)"}`,
      );
    }

    if (parsed.is_error) {
      throw new Error(
        typeof parsed.result === "string" ? parsed.result : "cursor-agent reported is_error",
      );
    }

    return {
      result:
        typeof parsed.result === "string"
          ? parsed.result
          : JSON.stringify(parsed.result ?? parsed),
      sessionId: parsed.session_id ?? opts.resumeSessionId ?? null,
      runId: parsed.request_id ?? parsed.session_id ?? null,
      status: "ok",
    };
  } finally {
    cleanup();
  }
}

export interface HarnessOrchestratorOptions {
  apiKey: string;
  projectRoot: string;
  agents: Record<string, AgentDefinition>;
  orchestratorModel?: string;
  subagentModel?: string;
  name?: string;
  /** harness/config directory for token optimizer settings */
  tokenOptimizerConfigDir?: string;
}

let openClawSessionId: string | null = null;
let dispatchCtx: (Pick<
  HarnessOrchestratorOptions,
  "projectRoot" | "apiKey" | "subagentModel" | "tokenOptimizerConfigDir"
> & { agents: Record<string, AgentDefinition> }) | null = null;

export function resetOpenClawSession(): void {
  openClawSessionId = null;
}

function resolveTokenOptimizerConfigDir(projectRoot: string, explicit?: string): string | undefined {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const local = join(projectRoot, "harness", "config");
  if (fs.existsSync(join(local, "token-optimizer.yaml"))) return local;
  return undefined;
}

export async function createHarnessOrchestrator(opts: HarnessOrchestratorOptions) {
  resetOpenClawSession();
  dispatchCtx = {
    projectRoot: opts.projectRoot,
    apiKey: opts.apiKey,
    subagentModel: opts.subagentModel ?? DEFAULT_MODEL_ID,
    tokenOptimizerConfigDir: resolveTokenOptimizerConfigDir(
      opts.projectRoot,
      opts.tokenOptimizerConfigDir,
    ),
    agents: opts.agents,
  };

  pruneExpiredOrchestrators();
  const cacheName = `${opts.projectRoot}:${opts.name ?? "harness-orchestrator"}`;
  const cachedId = orchestratorNameToId.get(cacheName);
  if (cachedId) {
    const cached = orchestratorsByCursorId.get(cachedId);
    if (cached && Date.now() - cached.lastUsedAt <= AGENT_CACHE_TTL_MS) {
      cached.lastUsedAt = Date.now();
      logSessionAgent("reused", opts.name ?? "harness-orchestrator");
      return cached.agent;
    }
  }

  void buildInlineObsidianMcpConfig();
  const agent = new OpenRouterAgent({
    apiKey: opts.apiKey,
    model: modelIdToSelection(opts.orchestratorModel ?? DEFAULT_MODEL_ID),
    systemPrompt:
      "You are a harness orchestrator. Delegate work to subagents and return their final output.",
    name: opts.name ?? "harness-orchestrator",
  });

  orchestratorsByCursorId.set(agent.agentId, { agent, lastUsedAt: Date.now() });
  orchestratorNameToId.set(cacheName, agent.agentId);
  logSessionAgent("created", opts.name ?? "harness-orchestrator");
  return agent;
}

async function optimizeSubagentPrompt(
  taskPrompt: string,
  configDir: string | undefined,
  label: string,
): Promise<string> {
  if (!configDir) return taskPrompt;
  const optimized = await optimizeContextBlock(taskPrompt, "subagent_prompt", configDir);
  if (optimized.tokensBefore > optimized.tokensAfter) {
    console.log(`[token-opt] ${formatOptimizerStats(label, optimized)}`);
  }
  return optimized.text;
}

async function runSubagentViaOpenRouter(
  subagentName: string,
  taskPrompt: string,
  model: string,
): Promise<RunResult> {
  const ctx = dispatchCtx;
  if (!ctx) {
    throw new Error("createHarnessOrchestrator must be called before dispatchToSubagent");
  }

  const def = ctx.agents[subagentName];
  if (!def) {
    throw new Error(`missing agent definition: ${subagentName}`);
  }

  const subModel =
    def.model && def.model !== "inherit"
      ? modelIdToSelection(def.model.id)
      : model;

  return openRouterPrompt(taskPrompt, {
    apiKey: ctx.apiKey,
    model: subModel,
    systemPrompt: def.prompt,
  });
}

export async function dispatchToSubagent(
  orchestrator: SDKAgent,
  subagentName: string,
  taskPrompt: string,
  stepLabel?: string,
): Promise<RunResult> {
  const ctx = dispatchCtx;
  if (!ctx) {
    throw new Error("createHarnessOrchestrator must be called before dispatchToSubagent");
  }

  void orchestrator;

  const label = stepLabel ?? subagentName;
  const optimizedPrompt = await optimizeSubagentPrompt(
    taskPrompt,
    ctx.tokenOptimizerConfigDir,
    label,
  );
  const useOpenClaw = shouldUseOpenClawHybrid(subagentName);
  const backend = useOpenClaw ? "cursor-agent" : "sdk";
  logOpenClawBackend(backend, subagentName);

  if (useOpenClaw) {
    const reusingSession = Boolean(openClawSessionId);
    logSessionAgent(reusingSession ? "reused" : "created", label);

    const run = await runCursorAgentStep({
      prompt: buildCursorAgentPrompt(subagentName, optimizedPrompt),
      cwd: ctx.projectRoot,
      apiKey: ctx.apiKey,
      resumeSessionId: openClawSessionId ?? undefined,
      model: modelIdToSelection(ctx.subagentModel),
    });

    if (run.sessionId) {
      openClawSessionId = run.sessionId;
    }

    return {
      id: run.runId ?? run.sessionId ?? `openclaw-${subagentName}`,
      status: run.status === "error" ? "error" : "finished",
      result: run.result,
    };
  }

  logSessionAgent("reused", label);
  return runSubagentViaOpenRouter(
    subagentName,
    optimizedPrompt,
    modelIdToSelection(ctx.subagentModel),
  );
}

export function resetOrchestratorCache(): void {
  for (const entry of orchestratorsByCursorId.values()) {
    entry.agent.close();
  }
  orchestratorsByCursorId.clear();
  orchestratorNameToId.clear();
}
