import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { OpenRouterAgent } from "./openrouter.js";
import { CursorAgent } from "./cursor-agent-backend.js";
import type { BackendAgent, McpServerConfig } from "./types.js";
import { loadUserSettings } from "../config/user-settings.js";
import { DEFAULT_MODEL, loadModelConfig } from "../config/models.js";
import { CURSOR_DEFAULT_MODEL_ID } from "../models/catalog.js";
import { ensureSessionModel } from "../models/session-models.js";
import { modelIdToSelection, storedChoiceFromSession } from "../models/selection.js";
import { findProjectRoot } from "../project/root.js";
import { loadAgentsMdRaw } from "../session/agents-inject.js";
import type { CliSession } from "../session/types.js";
import {
  PLACEHOLDER_DETECT_RE,
  resolveImagePlaceholders,
  sanitizePromptInput,
} from "../tui/paste.js";
import { compressWithHeadroom, loadHeadroomConfig } from "./headroom.js";

export interface SendAgentOptions {
  session: CliSession;
  message: string;
  credential: string;
  onTextDelta: (chunk: string) => void;
  onStatusLine?: (line: string) => void;
}

export interface SendAgentResult {
  ok: boolean;
  text: string;
  error?: string;
  agentId?: string;
  modelId?: string;
  /** Real prompt_tokens from the API response (context size before this turn). */
  promptTokens?: number;
  /** Real completion_tokens from the API response (output tokens for this turn). */
  completionTokens?: number;
  /** Number of Obsidian lessons injected this turn (0 = none/unreachable). */
  obsidianLessonCount?: number;
}

type GlobalCk = { __cursorsiCk?: string; __cursorsiObsidianKey?: string; __cursorsiCursorKey?: string };

const AGENT_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedSdkAgent {
  agent: BackendAgent;
  lastUsedAt: number;
}

/** Active agents keyed by agentId. */
const agentsByCursorId = new Map<string, CachedSdkAgent>();
/** CLI session id → agentId for lookup before first agentId is known. */
const sessionToCursorId = new Map<string, string>();

export function tokenFromEnv(): string | undefined {
  return (
    (globalThis as GlobalCk).__cursorsiCk ??
    process.env.OPENROUTER_API_KEY?.trim()
  );
}

export function cursorTokenFromEnv(): string | undefined {
  return (
    (globalThis as GlobalCk).__cursorsiCursorKey ??
    process.env.CURSOR_API_KEY?.trim()
  );
}

export function obsidianTokenFromEnv(): string | undefined {
  return (globalThis as GlobalCk).__cursorsiObsidianKey ?? process.env.OBSIDIAN_API_KEY?.trim();
}

function resolveModelId(session: CliSession, credential: string): string {
  const settings = loadUserSettings();
  const backend = settings.backend;

  // For Cursor backend, use the session modelId directly (set by picker or store init)
  if (backend === "cursor") {
    const id = session.modelId?.trim();
    if (id) return id;
    return settings.cursorModel || CURSOR_DEFAULT_MODEL_ID;
  }

  // For OpenRouter, resolve via config/sispace.yaml catalog
  const projectRoot = findProjectRoot(session.cwd);
  const cfg = loadModelConfig(projectRoot);
  const choice = storedChoiceFromSession(session.modelId, session.modelParams);
  const selected = modelIdToSelection(choice);
  if (selected.id?.trim()) {
    return selected.id.trim();
  }
  void credential;
  return cfg.default || DEFAULT_MODEL;
}

function pruneExpiredAgents(): void {
  const now = Date.now();
  for (const [cursorAgentId, entry] of agentsByCursorId) {
    if (now - entry.lastUsedAt > AGENT_CACHE_TTL_MS) {
      entry.agent.close();
      agentsByCursorId.delete(cursorAgentId);
      for (const [sessionId, mapped] of sessionToCursorId) {
        if (mapped === cursorAgentId) {
          sessionToCursorId.delete(sessionId);
        }
      }
    }
  }
}

function logSessionAgent(action: "reused" | "created", stepLabel: string): void {
  console.log(`[session] ${action} agent for ${stepLabel}`);
}

function composeUserMessage(session: CliSession, userText: string): string {
  const parts: string[] = [];
  if (session.skillBundlePrompt?.trim()) {
    parts.push("## Active skill bundle", "", session.skillBundlePrompt.trim(), "");
  }
  if (!session.contextInjected) {
    if (session.compactionSummaryBlock?.trim()) {
      parts.push(session.compactionSummaryBlock.trim(), "");
    }
    if (session.resumeContextBlock?.trim()) {
      parts.push(session.resumeContextBlock.trim(), "");
    }
    if (session.agentsContextBlock?.trim()) {
      parts.push(session.agentsContextBlock.trim(), "");
    }
    // Obsidian context is injected as system instructions via runTurn(), not as user message.
    if (
      session.injectGoalContext &&
      session.activeGoal?.status === "active" &&
      session.activeGoal.description
    ) {
      parts.push(
        "## Active goal (verification loop)",
        "",
        session.activeGoal.description,
        "",
        `Verify command: ${session.activeGoal.verifyCommand}`,
        `Iterations: ${session.activeGoal.currentIteration}/${session.activeGoal.maxIterations}`,
        "",
      );
    }
  }
  const cleanUser = sanitizePromptInput(userText);
  parts.push(cleanUser || userText.trim());
  return parts.join("\n");
}

export async function getOrCreateSessionAgent(
  session: CliSession,
  credential: string,
  stepLabel = `session ${session.id}`,
): Promise<{ agent: BackendAgent; session: CliSession }> {
  pruneExpiredAgents();

  const { session: resolvedSession } = await ensureSessionModel(session, credential);
  const modelId = resolveModelId(resolvedSession, credential);

  const resumeId =
    resolvedSession.cursorAgentId?.trim() ||
    sessionToCursorId.get(resolvedSession.id)?.trim() ||
    "";

  if (resumeId) {
    const cached = agentsByCursorId.get(resumeId);
    if (cached && Date.now() - cached.lastUsedAt <= AGENT_CACHE_TTL_MS) {
      cached.lastUsedAt = Date.now();
      sessionToCursorId.set(resolvedSession.id, resumeId);
      logSessionAgent("reused", stepLabel);
      return { agent: cached.agent, session: resolvedSession };
    }
  }

  const settings = loadUserSettings();
  const backend = settings.backend;

  let agent: BackendAgent;
  if (backend === "cursor") {
    const cursorKey = cursorTokenFromEnv();
    if (!cursorKey?.trim()) {
      throw new Error("CURSOR_API_KEY is not set in environment — cannot construct Cursor backend agent");
    }
    agent = await CursorAgent.create({
      model: {
        id: modelId || "auto",
        params: resolvedSession.modelParams?.length
          ? resolvedSession.modelParams
          : undefined,
      },
      apiKey: cursorKey,
      cwd: resolvedSession.cwd,
      name: `cursorsi-${resolvedSession.id}`,
      ...(resumeId ? { agentId: resumeId } : {}),
    });
    console.log(`[session] created Cursor SDK agent (model=${modelId || "auto"})`);
  } else {
    agent = new OpenRouterAgent({
      apiKey: credential,
      model: modelId,
      modelParams: resolvedSession.modelParams,
      cwd: resolvedSession.cwd,
      agentsMd: loadAgentsMdRaw(resolvedSession.cwd) ?? undefined,
      obsidianApiKey: obsidianTokenFromEnv(),
      name: `cursorsi-${resolvedSession.id}`,
      ...(resumeId ? { agentId: resumeId } : {}),
    });
  }

  const cursorAgentId = agent.agentId;
  agentsByCursorId.set(cursorAgentId, { agent, lastUsedAt: Date.now() });
  sessionToCursorId.set(resolvedSession.id, cursorAgentId);
  logSessionAgent(resumeId ? "reused" : "created", stepLabel);

  return { agent, session: resolvedSession };
}

export function getSessionAgentId(sessionId: string): string | undefined {
  const cursorId = sessionToCursorId.get(sessionId);
  if (cursorId && agentsByCursorId.has(cursorId)) {
    return cursorId;
  }
  return undefined;
}

export function closeSessionAgent(sessionId: string): void {
  const cursorId = sessionToCursorId.get(sessionId);
  if (!cursorId) return;
  const cached = agentsByCursorId.get(cursorId);
  if (cached) {
    cached.agent.close();
    agentsByCursorId.delete(cursorId);
  }
  sessionToCursorId.delete(sessionId);
}

export async function sendSessionMessage(
  opts: Omit<SendAgentOptions, "credential">,
): Promise<SendAgentResult> {
  const credential = tokenFromEnv() ?? "";
  const { session, message, onTextDelta, onStatusLine } = opts;
  if (!credential.trim() && !cursorTokenFromEnv()?.trim()) {
    return { ok: false, text: "", error: "No API key (OPENROUTER_API_KEY or CURSOR_API_KEY) in environment." };
  }

  try {
    const { agent, session: resolvedSession } = await getOrCreateSessionAgent(
      session,
      credential,
      `turn ${session.id}`,
    );
    const composed = composeUserMessage(resolvedSession, message);

    // Optional headroom compression of the composed prompt
    const headroomCfg = loadHeadroomConfig();
    let compressedPrompt = composed;
    if (headroomCfg.enabled) {
      try {
        const hr = await compressWithHeadroom(composed);
        if (hr.compressed) {
          compressedPrompt = hr.text;
          const savedPct = Math.round((hr.tokensSaved / hr.tokensBefore) * 100);
          onStatusLine?.(
            `[headroom] compressed ${hr.tokensBefore}→${hr.tokensAfter} tokens (${savedPct}% saved, ${hr.transforms.join(", ") || "transforms"})`,
          );
        }
      } catch {
        // compression failure is non-fatal — use original prompt
      }
    }

    const resolved = resolveImagePlaceholders(resolvedSession.id, compressedPrompt);
    if (PLACEHOLDER_DETECT_RE.test(compressedPrompt) && resolved.images.length === 0) {
      return {
        ok: false,
        text: "",
        error:
          "Image attachment missing — paste the image again with Ctrl+V before sending.",
      };
    }
    const payload =
      resolved.images.length > 0
        ? { text: resolved.text, images: resolved.images }
        : resolved.text;

    // The agent is a BackendAgent — call runTurn directly
    // (no instanceof needed — both OpenRouterAgent and CursorAgent implement it)

    let full = "";
    const result = await agent.runTurn(payload, undefined, {
      onChunk: (_delta, accumulated) => {
        full = accumulated;
        onTextDelta(full);
      },
      onStatus: onStatusLine,
      subagentsEnabled: session.subagentsEnabled,
    });

    const text = result.result?.trim() || full.trim();
    const imageHint = resolved.images.length > 0 ? " (image attachment)" : "";
    return {
      ok: result.status !== "error",
      text: text || "(empty response)",
      agentId: agent.agentId,
      modelId:
        resolvedSession.modelId !== session.modelId
          ? resolvedSession.modelId
          : undefined,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      obsidianLessonCount: result.obsidianLessonCount,
      error:
        result.status === "error"
          ? `${result.result?.trim() || "LLM request failed"}${imageHint}`
          : undefined,
    };
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", error: msg };
  }
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

export interface CursorAgentDetection {
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface CursorAgentStepResult {
  result: string;
  sessionId: string | null;
  runId: string | null;
  status: "ok" | "error";
}

let cachedDetection: CursorAgentDetection | null = null;

export function resetCursorAgentDetectionCache(): void {
  cachedDetection = null;
}

export function detectCursorAgent(): CursorAgentDetection {
  if (cachedDetection) return cachedDetection;

  const which = spawnSync("which", ["cursor-agent"], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout?.trim()) {
    cachedDetection = { available: false, path: null, version: null };
    return cachedDetection;
  }

  const binPath = which.stdout.trim();
  const versionRun = spawnSync(binPath, ["--version"], { encoding: "utf8" });
  const version =
    versionRun.status === 0
      ? (versionRun.stdout ?? versionRun.stderr ?? "").trim()
      : null;

  cachedDetection = { available: true, path: binPath, version };
  return cachedDetection;
}

export function obsidianMcpConfigured(): boolean {
  return Boolean(obsidianTokenFromEnv());
}

const DEFAULT_OBSIDIAN_MCP_URL = "http://127.0.0.1:27123/mcp/";

export function buildInlineObsidianMcpConfig(
  apiUrl = DEFAULT_OBSIDIAN_MCP_URL,
): Record<string, McpServerConfig> | undefined {
  const key = obsidianTokenFromEnv();
  if (!key) return undefined;
  return {
    obsidian: {
      type: "http",
      url: apiUrl,
      headers: { Authorization: `Bearer ${key}` },
    },
  };
}

export function prepareInlineObsidianMcpEnv(
  apiUrl = DEFAULT_OBSIDIAN_MCP_URL,
): { env: Record<string, string>; cleanup: () => void } {
  const key = obsidianTokenFromEnv();
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
          url: apiUrl,
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

export function shouldUseOpenClawHybrid(
  agent: string,
  ctx: { cursorAgentAvailable?: boolean; obsidianConfigured?: boolean } = {},
): boolean {
  const cursorOk = ctx.cursorAgentAvailable ?? detectCursorAgent().available;
  const obsidianOk = ctx.obsidianConfigured ?? obsidianMcpConfigured();
  return cursorOk && obsidianOk && OBSIDIAN_SPECIALISTS.has(agent);
}

export function buildCursorAgentPrompt(agent: string, taskPrompt: string): string {
  return [
    `You are swarm subagent "${agent}". Follow your role boundaries and output format exactly.`,
    "",
    taskPrompt,
  ].join("\n");
}

export function logOpenClawBackend(backend: "cursor-agent" | "sdk", agent?: string): void {
  const suffix = agent ? ` (${agent})` : "";
  console.log(`[openclaw] backend: ${backend}${suffix}`);
}

export async function runCursorAgentStep(opts: {
  prompt: string;
  cwd: string;
  apiKey: string;
  resumeSessionId?: string;
  model?: string;
  timeoutMs?: number;
  stepLabel?: string;
}): Promise<CursorAgentStepResult> {
  const detection = detectCursorAgent();
  if (!detection.available || !detection.path) {
    throw new Error("cursor-agent is not available in PATH");
  }

  const reusing = Boolean(opts.resumeSessionId);
  logSessionAgent(reusing ? "reused" : "created", opts.stepLabel ?? "cursor-agent step");

  const args = [
    "--trust",
    "--print",
    "--output-format",
    "json",
    "-p",
    opts.prompt,
  ];

  if (opts.model) {
    args.push("--model", opts.model);
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  const { env: mcpEnv, cleanup } = prepareInlineObsidianMcpEnv();
  try {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
      ),
      OPENROUTER_API_KEY: opts.apiKey,
      ...mcpEnv,
    };
    const obsidianKey = obsidianTokenFromEnv();
    if (obsidianKey) {
      env.OBSIDIAN_API_KEY = obsidianKey;
    }

    const result = spawnSync(detection.path, args, {
      cwd: opts.cwd,
      env,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 3_600_000,
    });

    if (result.error) {
      throw result.error;
    }

    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();

    if (result.status !== 0) {
      const detail = stderr || stdout || `exit ${result.status}`;
      throw new Error(`cursor-agent failed: ${detail}`);
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

/** Reset agent cache (tests). */
export function resetSessionAgentCache(): void {
  for (const entry of agentsByCursorId.values()) {
    entry.agent.close();
  }
  agentsByCursorId.clear();
  sessionToCursorId.clear();
}

export const SESSION_AGENT_CACHE_TTL_MS = AGENT_CACHE_TTL_MS;
