/**
 * Tool definitions for @openrouter/agent.
 * Uses Zod schemas for input validation and agent-native tool format.
 */

import { z } from "zod/v4";
import { tool } from "@openrouter/agent";

const pathParam = z.object({ path: z.string() });
const viewOutlineParam = z.object({ path: z.string() });
const pathContentParam = z.object({ path: z.string(), content: z.string() });
const bashParam = z.object({ command: z.string() });
const listDirParam = z.object({ path: z.string().optional().default(".") });
const searchFilesParam = z.object({
  pattern: z.string(),
  directory: z.string().optional().default("."),
});
const editFileParam = z.object({
  path: z.string(),
  old_str: z.string(),
  new_str: z.string(),
});
const obsidianReadParam = z.object({ path: z.string() });
const obsidianSearchParam = z.object({ query: z.string() });
const obsidianWriteParam = z.object({ path: z.string(), content: z.string() });
const obsidianAppendParam = z.object({ path: z.string(), content: z.string() });

const webSearchParam = z.object({ query: z.string() });
const webFetchParam = z.object({ url: z.string() });
const readImageParam = z.object({ path_or_url: z.string() });

const mcpLookupParam = z.object({
  type: z.enum(["field", "method", "param", "class"]),
  name: z.string(),
});

const bgSpawnParam = z.object({
  id: z.string().describe("A unique identifier string to manage this background process session."),
  command: z.string().describe("The shell command string to execute in the background."),
});

const bgReadParam = z.object({
  id: z.string().describe("The unique identifier string of the background session to read from."),
});

/**
 * Shared context schema: data available to every tool's execute function.
 * Set on callModel's `sharedContextSchema`.
 */
export const SharedContextSchema = z.object({
  cwd: z.string(),
  obsidianAvailable: z.boolean().optional().default(false),
  obsidianApiKey: z.string().optional(),
  obsidianApiUrl: z.string().optional(),
  openRouterApiKey: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

export type SharedToolContext = z.infer<typeof SharedContextSchema>;

// ---- Tool definitions ----
// Use tool<SharedToolContext>() to properly type ctx.shared

export const readFileTool = tool<SharedToolContext>({
  name: "read_file",
  description: "Read a file",
  inputSchema: pathParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("read_file", { path: params.path }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const viewFileOutlineTool = tool<SharedToolContext>({
  name: "view_file_outline",
  description: "Generates a highly compressed structural outline of a source file showing classes, interfaces, structs, and function signatures with their exact line numbers. Use this to locate code blocks before reading or editing.",
  inputSchema: viewOutlineParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("view_file_outline", { path: params.path }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const writeFileTool = tool<SharedToolContext>({
  name: "write_file",
  description: "Write content to a file",
  inputSchema: pathContentParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("write_file", {
      path: params.path,
      content: params.content,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const executeBashTool = tool<SharedToolContext>({
  name: "execute_bash",
  description: "Run a bash command",
  inputSchema: bashParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("execute_bash", { command: params.command }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const listDirTool = tool<SharedToolContext>({
  name: "list_directory",
  description: "List directory contents",
  inputSchema: listDirParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("list_directory", { path: params.path }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const searchFilesTool = tool<SharedToolContext>({
  name: "search_files",
  description: "Search for files by pattern",
  inputSchema: searchFilesParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("search_files", {
      pattern: params.pattern,
      directory: params.directory,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const editFileTool = tool<SharedToolContext>({
  name: "edit_file",
  description: "Surgical string replace in a file",
  inputSchema: editFileParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("edit_file", {
      path: params.path,
      old_str: params.old_str,
      new_str: params.new_str,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const obsidianReadTool = tool<SharedToolContext>({
  name: "obsidian_read",
  description: "Read a specific note from the Obsidian vault by path",
  inputSchema: obsidianReadParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("obsidian_read", { path: params.path }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const obsidianWriteTool = tool<SharedToolContext>({
  name: "obsidian_write",
  description: "Write or update a note in the Obsidian vault",
  inputSchema: obsidianWriteParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("obsidian_write", {
      path: params.path,
      content: params.content,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const obsidianAppendTool = tool<SharedToolContext>({
  name: "obsidian_append",
  description: "Append content to an existing Obsidian note",
  inputSchema: obsidianAppendParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("obsidian_append", {
      path: params.path,
      content: params.content,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const obsidianSearchTool = tool<SharedToolContext>({
  name: "obsidian_search",
  description: "Search the Obsidian vault for notes matching a query. Returns top results ranked by relevance, with context excerpts. Uses the Obsidian REST API to search the vault.",
  inputSchema: obsidianSearchParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("obsidian_search", { query: params.query }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      keywords: ctx!.shared.keywords,
    });
  },
});

// ---- Web & vision tools ----

export const webSearchTool = tool<SharedToolContext>({
  name: "web_search",
  description: "Search the web and return top results. Queries DuckDuckGo instant answers and HTML search, returns formatted [1] Title\\nURL\\nSnippet.",
  inputSchema: webSearchParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("web_search", { query: params.query }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const webFetchTool = tool<SharedToolContext>({
  name: "web_fetch",
  description: "Fetch a webpage and return readable text. Uses curl with Mozilla user-agent, strips HTML tags, limits to 8000 chars. Useful for reading Javadocs, MCP mappings, GitHub files, antidetect research.",
  inputSchema: webFetchParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("web_fetch", { url: params.url }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const readImageTool = tool<SharedToolContext>({
  name: "read_image",
  description: "Read an image (local path, URL, or the special value screenshot://active) and describe it using a vision model. Passes the image to OpenRouter vision model (google/gemini-2.5-flash-image or anthropic/claude-sonnet-4.6) for detailed description of code, diagrams, or technical content. Use screenshot://active to capture the current screen as an image — it is a literal accepted argument that triggers an automated screenshot of the active window.",
  inputSchema: readImageParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("read_image", { path_or_url: params.path_or_url }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const mcpLookupTool = tool<SharedToolContext>({
  name: "mcp_lookup",
  description: "Look up MCP (Minecraft Coder Pack) mappings by searching the installed MCP CSV files. Searches the relevant CSV (fields, methods, params) for the given name and returns formatted results. If no direct match, falls back to cross-file search across all CSVs. Handles both SRG names and MCP names.",
  inputSchema: mcpLookupParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("mcp_lookup", {
      type: params.type,
      name: params.name,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const bgSpawnProcessTool = tool<SharedToolContext>({
  name: "bg_spawn_process",
  description: "Spawns a long-running or non-blocking background command (like a test watcher or server build daemon) attached to a persistent session ID. Use bg_read_buffer to read its ongoing stream output.",
  inputSchema: bgSpawnParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("bg_spawn_process", {
      id: params.id,
      command: params.command,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

export const bgReadBufferTool = tool<SharedToolContext>({
  name: "bg_read_buffer",
  description: "Reads and flushes the latest captured console stream buffer from an active background process matching the specified session ID.",
  inputSchema: bgReadParam,
  execute: async (params, ctx) => {
    const { executeTool } = await import("./executor.js");
    return executeTool("bg_read_buffer", {
      id: params.id,
    }, {
      cwd: ctx!.shared.cwd,
      obsidianAvailable: ctx!.shared.obsidianAvailable ?? false,
      obsidianApiKey: ctx!.shared.obsidianApiKey,
      obsidianApiUrl: ctx!.shared.obsidianApiUrl,
      openRouterApiKey: ctx!.shared.openRouterApiKey,
      keywords: ctx!.shared.keywords,
    });
  },
});

/** All tools available when Obsidian is configured. */
export const ALL_TOOLS = [
  readFileTool,
  viewFileOutlineTool,
  writeFileTool,
  executeBashTool,
  listDirTool,
  searchFilesTool,
  editFileTool,
  bgSpawnProcessTool,
  bgReadBufferTool,
  obsidianReadTool,
  obsidianWriteTool,
  obsidianAppendTool,
  obsidianSearchTool,
  webSearchTool,
  webFetchTool,
  readImageTool,
  mcpLookupTool,
] as const;

/** Tools excluding Obsidian tools (when vault is unreachable). */
export const NON_OBSIDIAN_TOOLS = [
  readFileTool,
  viewFileOutlineTool,
  writeFileTool,
  executeBashTool,
  listDirTool,
  searchFilesTool,
  editFileTool,
  bgSpawnProcessTool,
  bgReadBufferTool,
  webSearchTool,
  webFetchTool,
  readImageTool,
  mcpLookupTool,
] as const;

export function toolsForObsidian(available: boolean): typeof ALL_TOOLS | typeof NON_OBSIDIAN_TOOLS {
  return available ? ALL_TOOLS : NON_OBSIDIAN_TOOLS;
}