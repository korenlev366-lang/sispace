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

/**
 * Normalize tool defs from `@openrouter/agent`'s `tool()`.
 *
 * Current shape (0.7+):
 *   { type: "function", function: { name, description, inputSchema, execute } }
 * Legacy flat shape (still accepted):
 *   { name, description?, inputSchema }
 *
 * CompatibleAgent previously only recognized the flat shape, so after the
 * openrouter package nested fields under `function`, `openaiToolsForObsidian`
 * returned [] and local models (e.g. qwen3.6-27b) got no `tools` payload —
 * they then faked bash/read in markdown instead of emitting tool_calls.
 */
function asNamedTools(tools: readonly unknown[]): NamedTool[] {
  const out: NamedTool[] = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const rec = t as Record<string, unknown>;

    // New @openrouter/agent nested OpenAI-style wrapper
    if (rec.type === "function" && rec.function && typeof rec.function === "object") {
      const fn = rec.function as Record<string, unknown>;
      if (typeof fn.name === "string" && fn.inputSchema) {
        out.push({
          name: fn.name,
          description: typeof fn.description === "string" ? fn.description : undefined,
          inputSchema: fn.inputSchema as z.ZodObject<z.ZodRawShape>,
        });
        continue;
      }
    }

    // Legacy flat shape
    if (typeof rec.name === "string" && rec.inputSchema) {
      out.push({
        name: rec.name,
        description: typeof rec.description === "string" ? rec.description : undefined,
        inputSchema: rec.inputSchema as z.ZodObject<z.ZodRawShape>,
      });
    }
  }
  return out;
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
