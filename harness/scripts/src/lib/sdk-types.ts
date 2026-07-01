/** Local types replacing @cursor/sdk for OpenRouter-backed harness agents. */

export interface ModelParameterValue {
  id: string;
  value: string;
}

export interface ModelSelection {
  id: string;
  params?: ModelParameterValue[];
}

export interface AgentDefinition {
  description: string;
  prompt: string;
  model?: ModelSelection | "inherit";
}

export interface RunResult {
  id: string;
  status: "finished" | "error";
  result?: string;
}

export type StreamEvent = {
  type: "assistant";
  message: { content: Array<{ type: "text"; text: string }> };
};

export interface SDKAgent {
  readonly agentId: string;
  send(message: string): AgentRun;
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

export class CursorAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorAgentError";
  }
}
