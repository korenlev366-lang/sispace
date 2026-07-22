/**
 * OpenAI- and Anthropic-compatible endpoint agent.
 * Used for /auth compatible providers (custom base URL + key + model slugs).
 */

import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { ASK_USER_SYSTEM_INSTRUCTIONS } from "./ask-user-instructions.js";
import {
  anthropicToolsForObsidian,
  openaiToolsForObsidian,
  runNamedTool,
} from "./openai-tools.js";
import { probeObsidian, type ToolContext } from "../tools/executor.js";
import type {
  BackendAgent,
  RunResult,
  RunTurnCallbacks,
  SDKImage,
} from "./types.js";
import type { CompatibleApiStyle } from "../config/credentials.js";

type SendPayload = string | { text: string; images: SDKImage[] };

const MAX_TOOL_ROUNDS = 24;

function payloadText(payload: SendPayload): string {
  if (typeof payload === "string") return payload;
  const n = payload.images.length;
  return n > 0 ? `${payload.text}\n\n[${n} image(s) attached]` : payload.text;
}

function imageDataUrl(img: SDKImage): string {
  if ("data" in img) return `data:${img.mimeType};base64,${img.data}`;
  return img.url;
}

export class CompatibleAgent implements BackendAgent {
  readonly agentId: string;
  private closed = false;
  private readonly api: CompatibleApiStyle;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly cwd?: string;
  private readonly agentsMd?: string;
  private readonly enableTools: boolean;
  private messages: ChatCompletionMessageParam[] = [];
  private anthropicMessages: AnthropicMessage[] = [];
  private openai: OpenAI | null = null;
  private toolCtxPromise: Promise<ToolContext> | null = null;

  constructor(opts: {
    endpoint: string;
    apiKey: string;
    model: string;
    api?: CompatibleApiStyle;
    cwd?: string;
    agentsMd?: string;
    enableTools?: boolean;
    agentId?: string;
    obsidianApiKey?: string;
    obsidianApiUrl?: string;
    seedHistory?: string[];
  }) {
    this.agentId = opts.agentId ?? randomUUID();
    this.api = opts.api === "anthropic" ? "anthropic" : "openai";
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.agentsMd = opts.agentsMd;
    this.enableTools = opts.enableTools ?? Boolean(opts.cwd);
    if (opts.seedHistory?.length) {
      for (const line of opts.seedHistory) {
        if (line.startsWith("user> ")) {
          const content = line.slice(6);
          this.messages.push({ role: "user", content });
          this.anthropicMessages.push({ role: "user", content });
        } else if (line.startsWith("agent> ")) {
          const content = line.slice(7);
          this.messages.push({ role: "assistant", content });
          this.anthropicMessages.push({ role: "assistant", content });
        }
      }
    }
    if (opts.cwd) {
      this.toolCtxPromise = this.buildToolContext(
        opts.cwd,
        opts.obsidianApiKey,
        opts.obsidianApiUrl,
      );
    }
  }

  close(): void {
    this.closed = true;
  }

  private async buildToolContext(
    cwd: string,
    obsidianApiKey?: string,
    obsidianApiUrl?: string,
  ): Promise<ToolContext> {
    const key = obsidianApiKey?.trim() || process.env.OBSIDIAN_API_KEY?.trim() || "";
    const available = await probeObsidian(key, obsidianApiUrl);
    return {
      cwd,
      obsidianAvailable: available,
      obsidianApiKey: key || undefined,
      obsidianApiUrl,
      openRouterApiKey: this.apiKey,
    };
  }

  private systemPrompt(): string {
    const parts = [
      `You are a coding agent running on the user's local machine via cursorsi CLI. Working directory: ${this.cwd ?? "."}. Use tools to explore and edit files. Always respond in English.`,
      ASK_USER_SYSTEM_INSTRUCTIONS,
    ];
    if (this.agentsMd?.trim()) parts.push(this.agentsMd.trim());
    return parts.join("\n\n");
  }

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.endpoint,
        timeout: 600_000,
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/lev/sispace",
          "X-Title": "SISpace",
        },
      });
    }
    return this.openai;
  }

  async runTurn(
    payload: SendPayload,
    runId = randomUUID(),
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult> {
    if (this.closed) {
      return { id: runId, status: "error", result: "agent closed" };
    }
    if (callbacks?.signal?.aborted) {
      return { id: runId, status: "error", result: "Cancelled" };
    }

    try {
      if (this.api === "anthropic") {
        return await this.runAnthropicTurn(payload, runId, callbacks);
      }
      return await this.runOpenAiTurn(payload, runId, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: runId, status: "error", result: msg };
    }
  }

  private async runOpenAiTurn(
    payload: SendPayload,
    runId: string,
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult> {
    const toolCtx = this.toolCtxPromise ? await this.toolCtxPromise : null;
    const tools = this.enableTools
      ? openaiToolsForObsidian(toolCtx?.obsidianAvailable ?? false)
      : [];

    const userContent = this.buildOpenAiUserContent(payload);
    this.messages.push({ role: "user", content: userContent });

    let toolCallCount = 0;
    let accumulated = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (callbacks?.signal?.aborted || this.closed) {
        this.messages.pop();
        return { id: runId, status: "error", result: "Cancelled" };
      }

      const stream = await this.getOpenAI().chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.systemPrompt() },
          ...this.messages,
        ],
        ...(tools.length ? { tools } : {}),
        stream: true,
      });

      let content = "";
      const toolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
      }> = [];

      for await (const chunk of stream) {
        if (callbacks?.signal?.aborted || this.closed) break;
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          accumulated = content;
          callbacks?.onChunk?.(delta.content, accumulated);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: tc.id ?? `call_${idx}`,
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              };
            } else {
              if (tc.id) toolCalls[idx]!.id = tc.id;
              if (tc.function?.name) toolCalls[idx]!.name += tc.function.name;
              if (tc.function?.arguments) {
                toolCalls[idx]!.arguments += tc.function.arguments;
              }
            }
          }
        }
      }

      if (callbacks?.signal?.aborted || this.closed) {
        return { id: runId, status: "error", result: "Cancelled" };
      }

      if (toolCalls.length === 0) {
        this.messages.push({ role: "assistant", content: content || "" });
        return {
          id: runId,
          status: "finished",
          result: content.trim() || "(no text response)",
          toolCallCount,
        };
      }

      this.messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = toolCtx
          ? await runNamedTool(tc.name, args, toolCtx)
          : `Tool ${tc.name} unavailable (no cwd)`;
        toolCallCount += 1;
        const toolMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        };
        this.messages.push(toolMsg);
      }
    }

    return {
      id: runId,
      status: "error",
      result: `Exceeded ${MAX_TOOL_ROUNDS} tool rounds`,
      toolCallCount,
    };
  }

  private buildOpenAiUserContent(
    payload: SendPayload,
  ): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
    if (typeof payload === "string" || payload.images.length === 0) {
      return payloadText(payload);
    }
    const parts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: payload.text }];
    for (const img of payload.images) {
      parts.push({ type: "image_url", image_url: { url: imageDataUrl(img) } });
    }
    return parts;
  }

  private async runAnthropicTurn(
    payload: SendPayload,
    runId: string,
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult> {
    const toolCtx = this.toolCtxPromise ? await this.toolCtxPromise : null;
    const tools = this.enableTools
      ? anthropicToolsForObsidian(toolCtx?.obsidianAvailable ?? false)
      : [];

    this.anthropicMessages.push({
      role: "user",
      content: payloadText(payload),
    });

    let toolCallCount = 0;
    let accumulated = "";
    const url = `${this.endpoint}/messages`;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (callbacks?.signal?.aborted || this.closed) {
        this.anthropicMessages.pop();
        return { id: runId, status: "error", result: "Cancelled" };
      }

      const body = {
        model: this.model,
        max_tokens: 16_384,
        system: this.systemPrompt(),
        messages: this.anthropicMessages,
        ...(tools.length ? { tools } : {}),
        stream: true,
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          authorization: `Bearer ${this.apiKey}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: callbacks?.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          id: runId,
          status: "error",
          result: `Anthropic-compatible HTTP ${res.status}: ${errText.slice(0, 500)}`,
        };
      }

      const { text, toolUses, stopReason } = await consumeAnthropicSse(
        res,
        (delta) => {
          accumulated += delta;
          callbacks?.onChunk?.(delta, accumulated);
        },
      );

      if (callbacks?.signal?.aborted || this.closed) {
        return { id: runId, status: "error", result: "Cancelled" };
      }

      if (!toolUses.length || stopReason === "end_turn") {
        const content: AnthropicContent[] = [];
        if (text) content.push({ type: "text", text });
        for (const tu of toolUses) {
          content.push({
            type: "tool_use",
            id: tu.id,
            name: tu.name,
            input: tu.input,
          });
        }
        this.anthropicMessages.push({
          role: "assistant",
          content: content.length ? content : text || "",
        });
        if (!toolUses.length) {
          return {
            id: runId,
            status: "finished",
            result: text.trim() || "(no text response)",
            toolCallCount,
          };
        }
      } else {
        const content: AnthropicContent[] = [];
        if (text) content.push({ type: "text", text });
        for (const tu of toolUses) {
          content.push({
            type: "tool_use",
            id: tu.id,
            name: tu.name,
            input: tu.input,
          });
        }
        this.anthropicMessages.push({ role: "assistant", content });
      }

      if (!toolUses.length) {
        return {
          id: runId,
          status: "finished",
          result: text.trim() || "(no text response)",
          toolCallCount,
        };
      }

      const toolResults: AnthropicContent[] = [];
      for (const tu of toolUses) {
        const result = toolCtx
          ? await runNamedTool(tu.name, tu.input, toolCtx)
          : `Tool ${tu.name} unavailable (no cwd)`;
        toolCallCount += 1;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result,
        });
      }
      this.anthropicMessages.push({ role: "user", content: toolResults });
    }

    return {
      id: runId,
      status: "error",
      result: `Exceeded ${MAX_TOOL_ROUNDS} tool rounds`,
      toolCallCount,
    };
  }
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
};

async function consumeAnthropicSse(
  res: Response,
  onText: (delta: string) => void,
): Promise<{
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}> {
  let text = "";
  const toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    partialJson: string;
  }> = [];
  let stopReason = "end_turn";

  if (!res.body) {
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as {
        content?: AnthropicContent[];
        stop_reason?: string;
      };
      stopReason = parsed.stop_reason ?? stopReason;
      for (const block of parsed.content ?? []) {
        if (block.type === "text") {
          text += block.text;
          onText(block.text);
        } else if (block.type === "tool_use") {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input,
            partialJson: "",
          });
        }
      }
    } catch {
      text = raw;
    }
    return {
      text,
      toolUses: toolUses.map(({ id, name, input }) => ({ id, name, input })),
      stopReason,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = String(evt.type ?? "");
      if (type === "content_block_start") {
        const block = evt.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          toolUses.push({
            id: String(block.id ?? ""),
            name: String(block.name ?? ""),
            input: {},
            partialJson: "",
          });
        }
      } else if (type === "content_block_delta") {
        const delta = evt.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
          onText(delta.text);
        } else if (
          delta?.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          const last = toolUses[toolUses.length - 1];
          if (last) last.partialJson += delta.partial_json;
        }
      } else if (type === "message_delta") {
        const delta = evt.delta as Record<string, unknown> | undefined;
        if (typeof delta?.stop_reason === "string") {
          stopReason = delta.stop_reason;
        }
      }
    }
  }

  for (const tu of toolUses) {
    if (tu.partialJson) {
      try {
        tu.input = JSON.parse(tu.partialJson) as Record<string, unknown>;
      } catch {
        tu.input = {};
      }
    }
  }

  return {
    text,
    toolUses: toolUses.map(({ id, name, input }) => ({ id, name, input })),
    stopReason,
  };
}
