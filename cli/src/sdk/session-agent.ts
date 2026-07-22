import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { OpenRouterAgent } from "./openrouter.js";
import { CursorAgent } from "./cursor-agent-backend.js";
import { CompatibleAgent } from "./compatible-agent.js";
import type { BackendAgent, McpServerConfig } from "./types.js";
import { loadUserSettings, type BackendName } from "../config/user-settings.js";
import {
  applyCredentialsToRuntime,
  resolveCompatibleProvider,
  resolveCursorCredentials,
  resolveOpenRouterCredentials,
} from "../config/credentials.js";
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
import { loadTaskMessages, openTasksDb } from "../session/task-row.js";
import {
  getTaskChatMeta,
  updateTaskLastBackend,
  buildChatHistoryContextBlock,
} from "../session/chat-persist.js";
import type { TaskMessage } from "../search/types.js";
import { cleanupAllBackgroundSessions } from "../tools/executor.js";
import type { RunResult } from "./types.js";
import { ASK_USER_CURSOR_INSTRUCTIONS } from "./ask-user-instructions.js";
import { buildProjectMemoryInjectBlock } from "../memory/project-memory.js";

export interface SendAgentOptions {
  session: CliSession;
  message: string;
  credential: string;
  onTextDelta: (chunk: string) => void;
  onStatusLine?: (line: string) => void;
  /** Abort in-flight turn (Ctrl+C cancel). */
  signal?: AbortSignal;
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
  /** Tool calls completed this turn. */
  toolCallCount?: number;
  /** Session fields to merge after compose/inject (ask hint, project memory). */
  sessionPatch?: Partial<CliSession>;
  /** True when the turn was aborted via signal (Ctrl+C). */
  cancelled?: boolean;
}

type GlobalCk = { __cursorsiCk?: string; __cursorsiObsidianKey?: string; __cursorsiCursorKey?: string };

const AGENT_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedSdkAgent {
  agent: BackendAgent;
  /** Backend that constructed this agent — refuse reuse across /backend switches. */
  backend: BackendName;
  lastUsedAt: number;
}

/** Active agents keyed by agentId. */
const agentsByCursorId = new Map<string, CachedSdkAgent>();
/** CLI session id → agentId for lookup before first agentId is known. */
const sessionToCursorId = new Map<string, string>();

export function tokenFromEnv(): string | undefined {
  applyCredentialsToRuntime();
  return (
    (globalThis as GlobalCk).__cursorsiCk ??
    process.env.OPENROUTER_API_KEY?.trim() ??
    resolveOpenRouterCredentials().key
  );
}

export function cursorTokenFromEnv(): string | undefined {
  applyCredentialsToRuntime();
  return (
    (globalThis as GlobalCk).__cursorsiCursorKey ??
    process.env.CURSOR_API_KEY?.trim() ??
    resolveCursorCredentials().key
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

  if (backend === "compatible") {
    const id = session.modelId?.trim();
    if (id) return id;
    const providerName = settings.compatibleProvider?.trim() || "";
    const provider = providerName
      ? resolveCompatibleProvider(providerName)
      : undefined;
    if (provider?.models?.[0]) return provider.models[0];
    return settings.defaultModel || DEFAULT_MODEL;
  }

  // For OpenRouter, resolve via config/sispace.yaml catalog (+ /auth models)
  const projectRoot = findProjectRoot(session.cwd);
  const cfg = loadModelConfig(projectRoot);
  const choice = storedChoiceFromSession(session.modelId, session.modelParams);
  const selected = modelIdToSelection(choice);
  if (selected.id?.trim()) {
    return selected.id.trim();
  }
  void credential;
  const authModels = resolveOpenRouterCredentials().models;
  if (settings.defaultModel?.trim()) return settings.defaultModel.trim();
  if (authModels[0]) return authModels[0];
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

function logSessionAgent(_action: "reused" | "created", _stepLabel: string): void {
  // Intentionally silent — session create/reuse must not pollute the Ink TUI.
}

function composeUserMessage(
  session: CliSession,
  userText: string,
  opts?: { backend?: BackendName },
): { text: string; sessionPatch?: Partial<CliSession> } {
  const parts: string[] = [];
  const sessionPatch: Partial<CliSession> = {};

  // Cursor SDK has no custom system prompt — inject ask_user hint once only.
  if (opts?.backend === "cursor" && !session.askUserHintInjected) {
    parts.push(ASK_USER_CURSOR_INSTRUCTIONS, "");
    sessionPatch.askUserHintInjected = true;
  }

  if (!session.projectMemoryInjected) {
    const mem = buildProjectMemoryInjectBlock(session.cwd);
    if (mem) {
      parts.push(mem, "");
    }
    sessionPatch.projectMemoryInjected = true;
  }

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
    // /recall and resume inject lessons here; OpenRouter also fetches per-turn via runTurn().
    if (session.obsidianContextBlock?.trim()) {
      parts.push(session.obsidianContextBlock.trim(), "");
    }
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
  return {
    text: parts.join("\n"),
    ...(Object.keys(sessionPatch).length > 0 ? { sessionPatch } : {}),
  };
}

/** Map durable task_messages into OpenRouter history lines. */
function seedHistoryFromTaskMessages(taskId: string): string[] {
  const db = openTasksDb();
  if (!db) return [];
  const messages = loadTaskMessages(db, taskId);
  const out: string[] = [];
  for (const msg of messages) {
    const line = taskMessageToHistoryLine(msg);
    if (line) out.push(line);
  }
  return out;
}

function taskMessageToHistoryLine(msg: TaskMessage): string | null {
  if (msg.role === "user") return `user> ${msg.content}`;
  if (msg.role === "assistant") return `agent> ${msg.content}`;
  return null;
}

export async function getOrCreateSessionAgent(
  session: CliSession,
  credential: string,
  stepLabel = `session ${session.id}`,
): Promise<{ agent: BackendAgent; session: CliSession }> {
  pruneExpiredAgents();

  const { session: resolvedSession } = await ensureSessionModel(session, credential);
  const modelId = resolveModelId(resolvedSession, credential);
  const settings = loadUserSettings();
  const backend = settings.backend;

  const resumeId =
    resolvedSession.cursorAgentId?.trim() ||
    sessionToCursorId.get(resolvedSession.id)?.trim() ||
    "";

  if (resumeId) {
    const cached = agentsByCursorId.get(resumeId);
    if (
      cached &&
      cached.backend === backend &&
      Date.now() - cached.lastUsedAt <= AGENT_CACHE_TTL_MS
    ) {
      cached.lastUsedAt = Date.now();
      sessionToCursorId.set(resolvedSession.id, resumeId);
      logSessionAgent("reused", stepLabel);
      return { agent: cached.agent, session: resolvedSession };
    }
    // Stale cache from the other backend — drop it so we rebuild.
    if (cached && cached.backend !== backend) {
      try {
        cached.agent.close();
      } catch {
        // ignore
      }
      agentsByCursorId.delete(resumeId);
    }
  }

  const taskId = resolvedSession.taskId?.trim() || "";
  const chatMeta = taskId ? getTaskChatMeta(taskId) : null;
  const seedHistory = taskId ? seedHistoryFromTaskMessages(taskId) : [];
  // Only Agent.resume when this chat's last durable backend was Cursor.
  const canResumeCursor =
    backend === "cursor" &&
    Boolean(resumeId) &&
    chatMeta?.lastBackend === "cursor";

  let agent: BackendAgent;
  if (backend === "cursor") {
    const cursorKey = cursorTokenFromEnv();
    if (!cursorKey?.trim()) {
      throw new Error(
        "CURSOR_API_KEY is not set — run /auth cursor or export CURSOR_API_KEY",
      );
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
      ...(canResumeCursor ? { agentId: resumeId } : {}),
    });
  } else if (backend === "compatible") {
    const providerName = settings.compatibleProvider?.trim() || "";
    const provider = providerName
      ? resolveCompatibleProvider(providerName)
      : undefined;
    if (!provider) {
      throw new Error(
        providerName
          ? `Compatible provider "${providerName}" not found — run /auth compatible or /auth list`
          : "No compatible provider selected — run /backend compatible <name>",
      );
    }
    agent = new CompatibleAgent({
      endpoint: provider.endpoint,
      apiKey: provider.key,
      model: modelId,
      api: provider.api,
      cwd: resolvedSession.cwd,
      agentsMd: loadAgentsMdRaw(resolvedSession.cwd) ?? undefined,
      obsidianApiKey: obsidianTokenFromEnv(),
      ...(seedHistory.length > 0 ? { seedHistory } : {}),
    });
  } else {
    const or = resolveOpenRouterCredentials();
    agent = new OpenRouterAgent({
      apiKey: credential || or.key || "",
      model: modelId,
      modelParams: resolvedSession.modelParams,
      cwd: resolvedSession.cwd,
      agentsMd: loadAgentsMdRaw(resolvedSession.cwd) ?? undefined,
      obsidianApiKey: obsidianTokenFromEnv(),
      name: `cursorsi-${resolvedSession.id}`,
      ...(seedHistory.length > 0 ? { seedHistory } : {}),
    });
  }

  if (taskId) {
    updateTaskLastBackend(taskId, backend);
  }

  // Cursor has no DB seed path — inject prior turns once when not Agent.resume-ing.
  let sessionOut = resolvedSession;
  if (
    backend === "cursor" &&
    !canResumeCursor &&
    taskId &&
    seedHistory.length > 0 &&
    !resolvedSession.contextInjected
  ) {
    const block =
      resolvedSession.resumeContextBlock?.trim() ||
      buildChatHistoryContextBlock(taskId);
    if (block) {
      sessionOut = {
        ...resolvedSession,
        resumeContextBlock: block,
        contextInjected: false,
      };
    }
  }

  const cursorAgentId = agent.agentId;
  agentsByCursorId.set(cursorAgentId, { agent, backend, lastUsedAt: Date.now() });
  sessionToCursorId.set(resolvedSession.id, cursorAgentId);
  logSessionAgent(
    backend === "cursor" && chatMeta?.lastBackend === "cursor" && resumeId
      ? "reused"
      : "created",
    stepLabel,
  );

  return { agent, session: sessionOut };
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

  // Validate the correct key for the configured backend before calling agent constructors.
  const settings = loadUserSettings();
  const backend = settings.backend;
  if (backend === "cursor") {
    if (!cursorTokenFromEnv()?.trim()) {
      return {
        ok: false,
        text: "",
        error:
          "CURSOR_API_KEY is not set — run /auth cursor or export CURSOR_API_KEY.",
      };
    }
  } else if (backend === "compatible") {
    const name = settings.compatibleProvider?.trim() || "";
    if (!name || !resolveCompatibleProvider(name)) {
      return {
        ok: false,
        text: "",
        error: name
          ? `Compatible provider "${name}" missing credentials — run /auth compatible.`
          : "No compatible provider selected — /backend compatible <name>.",
      };
    }
  } else if (!credential.trim()) {
    return {
      ok: false,
      text: "",
      error:
        "OPENROUTER_API_KEY is not set — run /auth openrouter or export OPENROUTER_API_KEY.",
    };
  }

  const signal = opts.signal;
  if (signal?.aborted) {
    return { ok: false, text: "", error: "Cancelled", cancelled: true };
  }

  try {
    const { agent, session: resolvedSession } = await getOrCreateSessionAgent(
      session,
      credential,
      `turn ${session.id}`,
    );
    if (signal?.aborted) {
      closeSessionAgent(resolvedSession.id);
      return { ok: false, text: "", error: "Cancelled", cancelled: true };
    }

    const backend = loadUserSettings().backend;
    const composed = composeUserMessage(resolvedSession, message, { backend });
    const composePatch = composed.sessionPatch;

    // Optional headroom compression of the composed prompt
    const headroomCfg = loadHeadroomConfig();
    let compressedPrompt = composed.text;
    if (headroomCfg.enabled) {
      try {
        const hr = await compressWithHeadroom(composed.text);
        if (hr.compressed) {
          compressedPrompt = hr.text;
          const savedPct =
            hr.tokensBefore > 0
              ? Math.round((hr.tokensSaved / hr.tokensBefore) * 100)
              : 0;
          onStatusLine?.(
            `[headroom] compressed ${hr.tokensBefore}→${hr.tokensAfter} tokens (${savedPct}% saved, ${hr.transforms.join(", ") || "transforms"})`,
          );
        }
      } catch {
        // compression failure is non-fatal — use original prompt
      }
    }

    if (signal?.aborted) {
      closeSessionAgent(resolvedSession.id);
      return { ok: false, text: "", error: "Cancelled", cancelled: true };
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

    let full = "";
    const { setToolStatusEmitter } = await import("../lib/tool-activity.js");
    setToolStatusEmitter((line) => {
      if (signal?.aborted) return;
      onStatusLine?.(line);
    });
    try {
      const turnPromise = agent.runTurn(payload, undefined, {
        onChunk: (_delta, accumulated) => {
          if (signal?.aborted) return;
          full = accumulated;
          onTextDelta(full);
        },
        onStatus: (line) => {
          if (signal?.aborted) return;
          onStatusLine?.(line);
        },
      subagentsEnabled: session.subagentsEnabled,
      subagentModel:
        session.subagentModelId?.trim() ||
        session.modelId?.trim() ||
        undefined,
      signal,
      });

      // On Ctrl+C: do NOT close the agent handle here. Closing races SDK
      // run.cancel() and leaves active_run_id stuck RUNNING in Cursor's
      // local index.db → next send fails with "already has active run".
      // Let runTurn await cancel; only tear down shell helpers on abort.
      const result: RunResult = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value: RunResult) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbortSideEffects);
          resolve(value);
        };
        const onAbortSideEffects = () => {
          cleanupAllBackgroundSessions();
        };
        if (signal?.aborted) {
          onAbortSideEffects();
          finish({
            id: `cancel_${Date.now().toString(36)}`,
            status: "error",
            result: "Cancelled",
          });
          return;
        }
        signal?.addEventListener("abort", onAbortSideEffects, { once: true });
        turnPromise.then(
          (r) => {
            finish(r);
          },
          (err) => {
            if (signal?.aborted) {
              finish({
                id: `cancel_${Date.now().toString(36)}`,
                status: "error",
                result: "Cancelled",
              });
              return;
            }
            signal?.removeEventListener("abort", onAbortSideEffects);
            reject(err);
          },
        );
      });

      if (signal?.aborted || result.result === "Cancelled") {
        // Keep agent cached — cancel should have cleared active_run_id.
        return {
          ok: false,
          text: full.trim(),
          error: "Cancelled",
          cancelled: true,
          agentId: agent.agentId,
        };
      }

      const text = result.result?.trim() || full.trim();
      const imageHint = resolved.images.length > 0 ? " (image attachment)" : "";
      const turnTools = result.toolCallCount ?? 0;
      const sessionPatch: Partial<CliSession> = {
        ...(composePatch ?? {}),
        ...(turnTools > 0
          ? { toolCallCount: (resolvedSession.toolCallCount ?? 0) + turnTools }
          : {}),
      };
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
        toolCallCount: turnTools,
        ...(Object.keys(sessionPatch).length > 0 ? { sessionPatch } : {}),
        error:
          result.status === "error"
            ? `${result.result?.trim() || "LLM request failed"}${imageHint}`
            : undefined,
      };
    } finally {
      setToolStatusEmitter(null);
    }
  } catch (err) {
    if (signal?.aborted) {
      closeSessionAgent(session.id);
      cleanupAllBackgroundSessions();
      return { ok: false, text: "", error: "Cancelled", cancelled: true };
    }
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
