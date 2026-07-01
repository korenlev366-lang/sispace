/**
 * OpenRouter agent loop using @openrouter/agent callModel.
 * Replaces the manual OpenAI streaming loop with automatic
 * multi-turn conversation, tool execution batching, and
 * state management from @openrouter/agent.
 */

import { OpenRouter } from "@openrouter/agent";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { ModelListItem } from "./types.js";
import {
  ALL_TOOLS,
  NON_OBSIDIAN_TOOLS,
  SharedContextSchema,
  type SharedToolContext,
} from "../tools/definitions.js";
import {
  executeTool,
  probeObsidian,
  summarizeToolArgs,
  summarizeToolResult,
} from "../tools/executor.js";
import {
  findHarnessRoot,
  extractKeywords,
} from "../obsidian/search.js";
import {
  selectReasoningEffort,
  stripEffortFlag,
} from "./reasoning-effort.js";
import { summarizeToolResult as summarizeForHistory } from "../compression/tool-compressor.js";
import { compressOldTurns } from "../compression/history-compressor.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentRun,
  BackendAgent,
  ModelParameterValue,
  RunResult,
  RunTurnCallbacks,
  SDKAgent,
  SDKImage,
  StreamEvent,
} from "./types.js";

export function createOpenRouterClient(apiKey?: string): OpenRouter {
  const key = apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  return new OpenRouter({
    apiKey: key,
    httpReferer: "https://github.com/lev/sispace",
    appTitle: "SISpace",
    timeoutMs: 600_000,
  });
}

type SendPayload = string | { text: string; images: SDKImage[] };

/** Helper to build input items from a SendPayload */
function buildInputItems(payload: SendPayload): string {
  if (typeof payload === "string") {
    return payload;
  }
  const parts: string[] = [payload.text];
  for (const img of payload.images) {
    if ("data" in img) {
      parts.push(`[Image: data:${img.mimeType};base64,${img.data.slice(0, 40)}…]`);
    }
  }
  return parts.join("\n\n");
}

const PER_TURN_MAX_LESSON_COUNT = 3;
const MAX_ONELINER_PREVIEW_LENGTH = 200;

/** Lightweight lesson index entry (from harness/memory/lesson-index.json). */
interface LessonIndexEntry {
  id: string;
  title: string;
  oneliner: string;
  tags: string[];
  file: string;
}

interface LessonIndex {
  version: number;
  entries: LessonIndexEntry[];
}

/** Cache the lesson index for the process lifetime (re-read on file change via mtime). */
let cachedLessonIndex: LessonIndex | null = null;
let cachedLessonIndexMtime = 0;

function loadLessonIndex(harnessRoot: string): LessonIndex | null {
  const indexPath = join(harnessRoot, "harness", "memory", "lesson-index.json");
  try {
    const stat = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
    if (!stat) return null;
    // Simple mtime check — re-read if file changed
    const mtime = statSync(indexPath).mtimeMs;
    if (cachedLessonIndex && cachedLessonIndexMtime === mtime) {
      return cachedLessonIndex;
    }
    cachedLessonIndex = JSON.parse(stat) as LessonIndex;
    cachedLessonIndexMtime = mtime;
    return cachedLessonIndex;
  } catch {
    return null;
  }
}

/**
 * Score a lesson entry against keywords.
 * Returns sum of matches in tags (weight 3), oneliner (weight 2), title (weight 1).
 */
function scoreLessonEntry(entry: LessonIndexEntry, keywords: string[]): number {
  let score = 0;
  const lowerTags = entry.tags.join(" ").toLowerCase();
  const lowerOneliner = entry.oneliner.toLowerCase();
  const lowerTitle = entry.title.toLowerCase();
  for (const kw of keywords) {
    if (lowerTags.includes(kw)) score += 3;
    if (lowerOneliner.includes(kw)) score += 2;
    if (lowerTitle.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Fallback: search individual lesson files in harness/memory/accepted-lessons/
 * by matching keywords against filenames.
 */
function searchLessonFilesByFilename(
  harnessRoot: string,
  keywords: string[],
  maxResults: number,
): Array<{ file: string; content: string }> {
  const dir = join(harnessRoot, "harness", "memory", "accepted-lessons");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const scored = files.map((file) => {
    const lowerFile = file.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lowerFile.includes(kw)) score++;
    }
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter((s) => s.score > 0).slice(0, maxResults);

  return matched.map((s) => {
    const content = readFileSync(join(dir, s.file), "utf8");
    return { file: s.file, content };
  });
}

/** Per‑turn ephemeral lesson fetch — runs fresh every turn, never cached across messages. */
async function fetchLessonsForTurn(userInput: string): Promise<{
  block: string;
  count: number;
} | null> {
  const harnessRoot = findHarnessRoot(process.cwd());
  if (!harnessRoot) return null;

  const keywords = extractKeywords(userInput);
  if (keywords.length === 0) return null;

  try {
    const lessons: Array<{ id: string; oneliner: string; file: string }> = [];

    // 1. Try lesson-index.json first (primary path)
    const index = loadLessonIndex(harnessRoot);
    if (index) {
      const scored = index.entries
        .map((entry) => ({ entry, score: scoreLessonEntry(entry, keywords) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      for (const s of scored.slice(0, PER_TURN_MAX_LESSON_COUNT)) {
        lessons.push({
          id: s.entry.id,
          oneliner: s.entry.oneliner.slice(0, MAX_ONELINER_PREVIEW_LENGTH),
          file: s.entry.file,
        });
      }
    }

    // 2. Fallback: filename search in accepted-lessons/ directory
    if (lessons.length === 0) {
      const fileResults = searchLessonFilesByFilename(
        harnessRoot,
        keywords,
        PER_TURN_MAX_LESSON_COUNT,
      );
      for (const fr of fileResults) {
        // Extract first meaningful line as oneliner
        const firstLine = fr.content
          .split("\n")
          .find((l) => l.trim().length > 10 && !l.startsWith("#"))
          ?.trim()
          .slice(0, MAX_ONELINER_PREVIEW_LENGTH) ?? "";
        lessons.push({
          id: fr.file.replace(/\.md$/, ""),
          oneliner: firstLine,
          file: fr.file,
        });
      }
    }

    // 3. Still nothing? Try the old accepted-lessons.md section search
    if (lessons.length === 0) {
      // Dynamic import to avoid top-level dependency on the old section searcher
      const { fetchLessonSections } = await import("../obsidian/search.js");
      const sections = fetchLessonSections(userInput, PER_TURN_MAX_LESSON_COUNT, harnessRoot);
      for (const section of sections) {
        const id = section.heading.replace(/^###\s*/, "").slice(0, 80);
        lessons.push({
          id,
          oneliner: section.body.split("\n").find((l) => l.trim().length > 10)?.trim().slice(0, MAX_ONELINER_PREVIEW_LENGTH) ?? id,
          file: "accepted-lessons.md",
        });
      }
    }

    if (lessons.length === 0) {
      return {
        block: "## Relevant harness lessons\n\n(no matching lessons found in harness memory)\n",
        count: 0,
      };
    }

    // Build a compact injection block (injected at END of system prompt)
    const lines: string[] = ["## Relevant harness lessons"];
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      lines.push(`${i + 1}. **${lesson.id}** — ${lesson.oneliner}`);
    }
    lines.push("");

    return { block: lines.join("\n"), count: lessons.length };
  } catch {
    return null; // harness memory unreachable — skip silently
  }
}

/** Surface OpenRouter / OpenAI API error text for the TUI. */
export function formatOpenRouterError(err: unknown): string {
  console.error(err);
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const msg = (nested as { message?: string }).message;
      if (typeof msg === "string" && msg.trim()) {
        return msg.trim();
      }
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Returns true if the error is transient and worth retrying. */
function isRetryableNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Response failed") ||
    msg.includes("Network Error") ||
    msg.includes("network") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed")
  );
}

class OpenRouterRun implements AgentRun {
  constructor(private resultPromise: Promise<RunResult>) {}

  async *stream(): AsyncGenerator<StreamEvent> {
    const result = await this.resultPromise;
    if (result.status === "error") {
      return;
    }
    if (result.result) {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: result.result }] },
      };
    }
  }

  wait(): Promise<RunResult> {
    return this.resultPromise;
  }
}

export class OpenRouterAgent implements SDKAgent, BackendAgent {
  readonly agentId: string;
  private client: OpenRouter;
  private model: string;
  private modelParams?: ModelParameterValue[];
  private systemPrompt?: string;
  private agentsMd?: string;
  private cwd?: string;
  private enableTools: boolean;
  private closed = false;
  private sharedCtxPromise: Promise<SharedToolContext> | null = null;
  private obsidianWarned = false;
  /** Accumulated conversation history (user + assistant turns as text strings). */
  private messages: string[] = [];
  /** Turn counter — increments each runTurn call. */
  private turnCount = 0;
  /**
   * Tool result history: each entry records the turn it was produced,
   * the tool name, and the compressed result. Used for >6-turn summarization.
   */
  private toolResultHistory: Array<{
    turn: number;
    toolName: string;
    result: string;
  }> = [];
  /** Count of turns that have already been compressed into [turn summary] entries. */
  private lastCompressedTurn = 0;
  /** Lazy-created OpenAI client for compression calls (points at OpenRouter). */
  private openaiClient: OpenAI | null = null;

  constructor(opts: {
    apiKey: string;
    model: string;
    modelParams?: ModelParameterValue[];
    systemPrompt?: string;
    agentsMd?: string;
    cwd?: string;
    enableTools?: boolean;
    name?: string;
    agentId?: string;
    obsidianApiKey?: string;
    obsidianApiUrl?: string;
  }) {
    this.agentId = opts.agentId ?? randomUUID();
    this.client = createOpenRouterClient(opts.apiKey);
    this.model = opts.model;
    this.modelParams = opts.modelParams;
    this.systemPrompt = opts.systemPrompt;
    this.agentsMd = opts.agentsMd;
    this.cwd = opts.cwd;
    this.enableTools = opts.enableTools ?? Boolean(opts.cwd);
    if (opts.cwd) {
      this.sharedCtxPromise = this.buildSharedContext(
        opts.cwd,
        opts.obsidianApiKey,
        opts.obsidianApiUrl,
      );
    }
  }

  /**
   * Convert stored model params ({ id, value }[]) to the ResponsesRequest format.
   * Known mappings:
   *   reasoning_effort → reasoning.effort
   *   thinking → reasoning.enabled
   */
  private buildModelConfig(): Record<string, unknown> {
    if (!this.modelParams?.length) {
      return {};
    }
    const config: Record<string, unknown> = {};
    const reasoningEffort = this.modelParams.find(
      (p) => p.id === "reasoning_effort" && p.value,
    );
    if (reasoningEffort) {
      config.reasoning = { effort: reasoningEffort.value };
    }
    const thinking = this.modelParams.find(
      (p) => p.id === "thinking" && p.value,
    );
    if (thinking) {
      const enabled = thinking.value === "true";
      if (config.reasoning) {
        (config.reasoning as Record<string, unknown>).enabled = enabled;
      } else {
        config.reasoning = { enabled };
      }
    }
    return config;
  }

  close(): void {
    this.closed = true;
  }

  /** Lazily create an OpenAI client pointed at OpenRouter for compression calls. */
  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      // Extract the API key from the existing OpenRouter client's options
      const apiKey =
        process.env.OPENROUTER_API_KEY?.trim() || "";
      this.openaiClient = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
        timeout: 600_000,
      });
    }
    return this.openaiClient;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  send(payload: SendPayload): AgentRun {
    if (this.closed) {
      throw new Error("agent closed");
    }
    const runId = randomUUID();
    return new OpenRouterRun(this.runTurn(payload, runId));
  }

  private async buildSharedContext(
    cwd: string,
    obsidianApiKey?: string,
    obsidianApiUrl?: string,
  ): Promise<SharedToolContext> {
    const key =
      obsidianApiKey?.trim() ||
      process.env.OBSIDIAN_API_KEY?.trim() ||
      "";
    const available = await probeObsidian(key, obsidianApiUrl);
    return {
      cwd,
      obsidianAvailable: available,
      obsidianApiKey: key || undefined,
      obsidianApiUrl,
      openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined,
    };
  }

  /** Build the instructions (system prompt equivalent) for the model. */
  private buildInstructions(): string {
    const parts: string[] = [];
    if (this.agentsMd?.trim()) {
      parts.push(this.agentsMd.trim());
    }
    if (this.systemPrompt?.trim()) {
      parts.push(this.systemPrompt.trim());
    }
    return parts.join("\n\n");
  }

  /** Resolve tools array based on obsidian availability. */
  private resolveTools(available: boolean | null) {
    if (!this.enableTools) {
      return [];
    }
    if (available === false && !this.obsidianWarned) {
      this.obsidianWarned = true;
      console.warn("[cursorsi] Obsidian unavailable — obsidian_* tools disabled");
    }
    return available !== false ? [...ALL_TOOLS] : [...NON_OBSIDIAN_TOOLS];
  }

  /**
   * Build the conversation history input string, summarizing old tool results.
   * Tool results older than 6 turns are replaced with 1-line summaries.
   */
  private buildHistoryInput(): string {
    const TURN_AGE_THRESHOLD = 6;
    const parts: string[] = [...this.messages];

    // Append tool result messages, summarizing old ones
    for (const entry of this.toolResultHistory) {
      const age = this.turnCount - entry.turn;
      if (age > TURN_AGE_THRESHOLD) {
        // Replace with 1-line summary
        parts.push(`[tool_result] ${summarizeForHistory(entry.toolName, entry.result)}`);
      } else {
        // Include full result (already compressed by tool-compressor)
        parts.push(`[tool_result] ${entry.toolName}: ${entry.result}`);
      }
    }

    return parts.join("\n\n");
  }

  /**
   * Agent loop via callModel — handles multi-turn conversations,
   * tool execution batching, and state management automatically.
   */
  async runTurn(
    payload: SendPayload,
    runId = randomUUID(),
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult> {
    if (this.closed) {
      throw new Error("agent closed");
    }

    this.turnCount++;

    // ── Dynamic reasoning_effort for DeepSeek Pro ──────────────────────
    let userText = typeof payload === "string" ? payload : payload.text;
    let dynamicEffort: string | null = null;
    if (this.model === "deepseek/deepseek-v4-pro") {
      // Check for manual override flag
      const cleaned = stripEffortFlag(userText);
      if (cleaned !== userText) {
        // Flag was stripped — use the detected override
        const selection = selectReasoningEffort(userText);
        dynamicEffort = selection.effort;
        callbacks?.onStatus?.(
          `  reasoning_effort: ${selection.effort} (manual override)`,
        );
        // Reconstruct payload with stripped text
        if (typeof payload === "string") {
          payload = cleaned;
        } else {
          payload = { ...payload, text: cleaned };
        }
        userText = cleaned;
      } else {
        // No flag — classify by keywords
        const selection = selectReasoningEffort(userText);
        dynamicEffort = selection.effort;
        const label =
          selection.kind === "default"
            ? `${selection.effort} (default)`
            : `${selection.effort} (${selection.kind})`;
        callbacks?.onStatus?.(`  reasoning_effort: ${label}`);
      }
    }

    // ── Pipeline subagent planning ────────────────────────────────────
    if (callbacks?.subagentsEnabled) {
      try {
        const [{ shouldDecompose }, { planSubtasks }] = await Promise.all([
          import("../subagents/gate.js"),
          import("../subagents/planner.js"),
        ]);
        if (shouldDecompose(userText)) {
          const subtasks = await planSubtasks(
            userText,
            this.getOpenAIClient(),
          );
          if (subtasks.length > 0) {
            const lines = [`› [plan] ${subtasks.length} subtasks:`];
            for (let i = 0; i < subtasks.length; i++) {
              const t = subtasks[i];
              let line = `${i}. ${t.description} (${t.type}, ${t.effort})`;
              if (t.depends_on.length > 0) {
                line += ` depends_on=[${t.depends_on.join(", ")}]`;
              }
              lines.push(line);
            }
            for (const ln of lines) {
              callbacks?.onStatus?.(ln);
            }
          }
        }
      } catch (err) {
        console.warn("[cursorsi] subagent planning failed:", err);
        // Planning failure is non-fatal — continue with normal execution
      }
    }

    const userInput = buildInputItems(payload);
    this.messages.push(`user> ${userInput}`);

    // ── Compress old turns (Stage 3) ───────────────────────────────────
    if (this.messages.length > 20) {
      try {
        const result = await compressOldTurns(
          this.messages,
          this.getOpenAIClient(),
          this.lastCompressedTurn,
          callbacks?.onStatus,
        );
        this.messages = result.messages;
        this.lastCompressedTurn = result.newLastCompressedTurn;
      } catch (err) {
        // Compression failure is non-fatal — continue with uncompressed history
        console.warn("[cursorsi] history compression failed:", err);
      }
    }

    // Extract keywords for tool compression & lesson matching
    const turnKeywords = extractKeywords(userInput);

    const sharedCtx = this.sharedCtxPromise ? await this.sharedCtxPromise : null;
    const tools = this.resolveTools(sharedCtx?.obsidianAvailable ?? null);

    // ── Per-turn ephemeral lesson injection ─────────────────────────────
    let obsidianLessonCount = 0;
    let lessonContextBlock: string | null = null;
    try {
      const result = await fetchLessonsForTurn(userInput);
      if (result) {
        obsidianLessonCount = result.count;
        lessonContextBlock = result.block;
      }
    } catch {
      // harness memory unreachable — skip silently
    }

    // ── Build system prompt ─────────────────────────────────────────────
    const customInstructions = this.buildInstructions();
    const instructionsLines = [
      `You are a coding agent running directly on the user's local machine via cursorsi CLI. You have full access to the local file system and can execute bash commands. The working directory is ${sharedCtx?.cwd ?? "the user's project"}. Use your tools actively to explore files, make changes, and complete tasks. Always respond in English.`,
    ];
    if (customInstructions.trim()) {
      instructionsLines.push(customInstructions.trim());
    }
    if (lessonContextBlock) {
      instructionsLines.push(lessonContextBlock);
    }

    // Build shared context with keywords for tool compression
    const turnSharedCtx: SharedToolContext = {
      ...(sharedCtx ?? { cwd: ".", obsidianAvailable: false }),
      keywords: turnKeywords.length > 0 ? turnKeywords : undefined,
    };

    try {
      let accumulatedText = "";
      let accumulatedReasoning = "";

      const modelConfig = this.buildModelConfig();

      // If dynamic reasoning effort was set for DeepSeek Pro, override the config
      const finalConfig: Record<string, unknown> = { ...modelConfig };
      if (dynamicEffort) {
        finalConfig.reasoning = { effort: dynamicEffort };
      }

      // Retry wrapper for transient OpenRouter provider drops
      const MAX_RETRIES = 2;
      let result!: Awaited<ReturnType<typeof this.client.callModel>>;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await this.client.callModel({
            model: this.model,
            input: this.buildHistoryInput(),
            instructions: instructionsLines.join("\n\n"),
            ...finalConfig,
            provider: {
              order: ["DeepSeek"],
              allow_fallbacks: true,
            },
            tools: tools.length > 0 ? (tools as typeof tools) : undefined,
            context: {
              shared: turnSharedCtx,
            } as never,
            sharedContextSchema: SharedContextSchema,
          } as never, { timeoutMs: 600_000 });
          break;
        } catch (err) {
          // [debug] print exact error to diagnose retryable-matching failures
          callbacks?.onStatus?.(`[debug] caught error: ${err instanceof Error ? err.message : String(err)}`);
          if (attempt < MAX_RETRIES && isRetryableNetworkError(err)) {
            callbacks?.onStatus?.(`[retry ${attempt + 1}/${MAX_RETRIES}] OpenRouter call failed, retrying in 2s…`);
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            continue;
          }
          throw err;
        }
      }

      // Consume text, reasoning, and tool items streams concurrently
      const toolResultsThisTurn: Array<{ toolName: string; result: string }> = [];

      const textStreamPromise = (async () => {
        for await (const delta of result.getTextStream()) {
          accumulatedText += delta;
          callbacks?.onChunk?.(delta, accumulatedText);
        }
      })();

      const reasoningStreamPromise = (async () => {
        for await (const delta of result.getReasoningStream()) {
          accumulatedReasoning += delta;
        }
      })();

      // Capture tool results from items stream for history tracking
      const itemsStreamPromise = (async () => {
        try {
          for await (const item of result.getItemsStream()) {
            // function_call_output items contain tool results
            if (
              item &&
              typeof item === "object" &&
              "type" in item &&
              item.type === "function_call_output" &&
              "call_id" in item
            ) {
              const output = item as { call_id?: string; output?: unknown };
              // Extract tool name from call_id (format: "toolName_callId")
              const callId = output.call_id ?? "";
              const toolName = callId.split("_")[0] ?? "unknown";
              const resultStr =
                typeof output.output === "string"
                  ? output.output
                  : JSON.stringify(output.output ?? "");
              if (resultStr && resultStr !== "undefined") {
                toolResultsThisTurn.push({ toolName, result: resultStr });
              }
            }
          }
        } catch {
          // items stream consumption failure is non-fatal
        }
      })();

      await Promise.all([textStreamPromise, reasoningStreamPromise, itemsStreamPromise]);

      // Wait for full execution (handles all auto tool rounds)
      const finalText = await result.getText();
      const response = await result.getResponse();
      const usage = response.usage;

      if (finalText) {
        this.messages.push(`agent> ${finalText}`);
      }

      // Store tool results in history for future summarization
      for (const tr of toolResultsThisTurn) {
        this.toolResultHistory.push({
          turn: this.turnCount,
          toolName: tr.toolName,
          result: tr.result,
        });
      }

      // Include reasoning summary in the result if present
      let resultText = finalText || accumulatedText.trim() || "(no text response)";
      if (accumulatedReasoning.trim()) {
        resultText = `[reasoning]\n${accumulatedReasoning.trim()}\n[/reasoning]\n\n${resultText}`;
      }

      return {
        id: runId,
        status: "finished",
        result: resultText,
        promptTokens: usage?.inputTokens ?? undefined,
        completionTokens: usage?.outputTokens ?? undefined,
        obsidianLessonCount,
      };
    } catch (err) {
      this.messages.pop();
      const msg = formatOpenRouterError(err);
      return { id: runId, status: "error", result: msg };
    }
  }
}

/** One-shot prompt without conversation history or tools. */
export async function openRouterPrompt(
  prompt: string,
  opts: { apiKey: string; model: string; systemPrompt?: string },
): Promise<RunResult> {
  const agent = new OpenRouterAgent({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    enableTools: false,
  });
  try {
    return await agent.runTurn(prompt);
  } finally {
    agent.close();
  }
}