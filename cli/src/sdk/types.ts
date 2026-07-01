/** Local types for OpenRouter-backed agents (using @openrouter/agent). */

export interface RunTurnCallbacks {
  onChunk?: (delta: string, fullText: string) => void;
  onStatus?: (line: string) => void;
  /** If true, gate + plan subtasks via Flash before the main turn. */
  subagentsEnabled?: boolean;
}

/**
 * Minimal contract the session loop calls for every turn.
 * Both OpenRouterAgent and CursorAgent implement this.
 */
export interface BackendAgent {
  runTurn(
    payload: string | { text: string; images: SDKImage[] },
    runId?: string,
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult>;
  readonly agentId: string;
  close(): void;
}

export interface ModelParameterValue {
  id: string;
  value: string;
}

export interface ModelSelection {
  id: string;
  params?: ModelParameterValue[];
}

export interface ModelParameterDefinition {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
}

export interface ModelVariant {
  params: ModelParameterValue[];
  displayName: string;
  description?: string;
  isDefault?: boolean;
}

export interface ModelListItem {
  id: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  parameters?: ModelParameterDefinition[];
  variants?: ModelVariant[];
}

export interface SDKImageDimension {
  width: number;
  height: number;
}

export type SDKImage =
  | { url: string; dimension?: SDKImageDimension }
  | { data: string; mimeType: string; dimension?: SDKImageDimension };

export type StreamEvent = {
  type: "assistant";
  message: { content: Array<{ type: "text"; text: string }> };
};

export interface RunResult {
  id: string;
  status: "finished" | "error";
  result?: string;
  /** Real prompt_tokens from API response usage (context size before this turn). */
  promptTokens?: number;
  /** Real completion_tokens from API response usage (output tokens for this turn). */
  completionTokens?: number;
  /** Number of Obsidian lessons injected into system prompt this turn (0 if none/unreachable). */
  obsidianLessonCount?: number;
}

export interface SDKAgent {
  readonly agentId: string;
  send(message: string | { text: string; images: SDKImage[] }): AgentRun;
  close(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface AgentRun {
  stream(): AsyncGenerator<StreamEvent>;
  wait(): Promise<RunResult>;
}

export type McpServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
} | {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};
