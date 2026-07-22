/**
 * Convert CursorSI tool definitions into OpenAI / Anthropic function schemas
 * for compatible-endpoint agents.
 */

import { z } from "zod/v4";
import {
  ALL_TOOLS,
  NON_OBSIDIAN_TOOLS,
  type SharedToolContext,
} from "../tools/definitions.js";
import { executeTool, type ToolContext } from "../tools/executor.js";

type NamedTool = {
  name: string;
  description?: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
};

export interface OpenAiFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function asNamedTools(
  tools: readonly unknown[],
): NamedTool[] {
  return tools.filter(
    (t): t is NamedTool =>
      Boolean(
        t &&
          typeof t === "object" &&
          typeof (t as NamedTool).name === "string" &&
          (t as NamedTool).inputSchema,
      ),
  );
}

function schemaToJson(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  // Drop $schema — some providers reject unknown top-level keys.
  delete json.$schema;
  return json;
}

export function openaiToolsForObsidian(available: boolean): OpenAiFunctionTool[] {
  const tools = asNamedTools(available ? ALL_TOOLS : NON_OBSIDIAN_TOOLS);
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? t.name,
      parameters: schemaToJson(t.inputSchema),
    },
  }));
}

export function anthropicToolsForObsidian(available: boolean): AnthropicToolDef[] {
  const tools = asNamedTools(available ? ALL_TOOLS : NON_OBSIDIAN_TOOLS);
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? t.name,
    input_schema: schemaToJson(t.inputSchema),
  }));
}

export async function runNamedTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  return executeTool(name, args, ctx);
}

export type { SharedToolContext };
