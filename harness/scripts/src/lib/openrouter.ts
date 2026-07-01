import { OpenRouter } from "@openrouter/agent";
import { randomUUID } from "node:crypto";
import type { AgentRun, RunResult, SDKAgent, StreamEvent } from "./sdk-types.js";

/**
 * Resolve the OpenRouter API key from arguments or environment.
 *
 * Priority:
 *  1. Explicit `apiKey` argument — but only if it looks like an OpenRouter key (sk-or-v1-…).
 *  2. `OPENROUTER_API_KEY` environment variable.
 *  3. Falls back to the argument / env value as-is (still validated below).
 */
function resolveOpenRouterKey(apiKey?: string): string {
  const candidate =
    apiKey?.trim() && apiKey.trim().startsWith("sk-or-v1-")
      ? apiKey.trim()
      : process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!candidate) {
    throw new Error(
      "OPENROUTER_API_KEY missing or invalid format — expected a key starting with \"sk-or-v1-\". " +
        "Set the OPENROUTER_API_KEY environment variable or pass a valid OpenRouter key.",
    );
  }
  return candidate;
}

/**
 * Create a native OpenRouter agent client.
 * Replaces the legacy Anthropic SDK wrapper pointed at the OpenRouter base URL.
 *
 * Throws if the resolved key is missing or not in OpenRouter format.
 */
export function createOpenRouterClient(apiKey?: string): OpenRouter {
  const key = resolveOpenRouterKey(apiKey);
  return new OpenRouter({
    apiKey: key,
    httpReferer: "https://github.com/lev/sispace",
    appTitle: "SISpace",
  });
}

class OpenRouterRun implements AgentRun {
  constructor(private resultPromise: Promise<RunResult>) {}

  async *stream(): AsyncGenerator<StreamEvent> {
    const res = await this.resultPromise;
    yield { type: "assistant", message: { content: [{ type: "text", text: res.result ?? "" }] } };
  }

  wait(): Promise<RunResult> {
    return this.resultPromise;
  }
}

/** Lightweight conversation message used internally for history tracking. */
interface SimpleMessage {
  role: "user" | "assistant";
  content: string;
}

export class OpenRouterAgent implements SDKAgent {
  readonly agentId: string;
  private client: OpenRouter;
  private model: string;
  private messages: SimpleMessage[] = [];
  private systemPrompt?: string;
  private closed = false;

  constructor(opts: {
    apiKey: string;
    model: string;
    systemPrompt?: string;
    name?: string;
    agentId?: string;
  }) {
    this.agentId = opts.agentId ?? randomUUID();
    this.client = createOpenRouterClient(opts.apiKey);
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt;
  }

  close(): void {
    this.closed = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  send(payload: string): AgentRun {
    if (this.closed) {
      throw new Error("agent closed");
    }
    const runId = randomUUID();
    return new OpenRouterRun(this.execute(payload, runId));
  }

  private async execute(prompt: string, runId: string): Promise<RunResult> {
    this.messages.push({ role: "user", content: prompt });

    // Build conversation history string matching the main session-loop pattern
    const conversationText = this.messages
      .map((m) => `${m.role}> ${m.content}`)
      .join("\n\n");

    try {
      const result = this.client.callModel({
        model: this.model,
        maxOutputTokens: 4096,
        ...(this.systemPrompt ? { instructions: this.systemPrompt } : {}),
        input: conversationText,
      });
      const text = (await result.getText()).trim();
      this.messages.push({ role: "assistant", content: text });
      return { id: runId, status: "finished", result: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: runId, status: "error", result: msg };
    }
  }
}

/** One-shot prompt without conversation history. */
export async function openRouterPrompt(
  prompt: string,
  opts: { apiKey: string; model: string; systemPrompt?: string },
): Promise<RunResult> {
  const agent = new OpenRouterAgent({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
  });
  try {
    return agent.send(prompt).wait();
  } finally {
    agent.close();
  }
}