/**
 * Shared guidance so models actually use ask_user / QuestionPicker
 * instead of asking only in prose.
 */

/** OpenRouter / tool-calling backends (native ask_user tool). */
export const ASK_USER_SYSTEM_INSTRUCTIONS = [
  "## Asking the user",
  "When the request is ambiguous or you need a critical choice before acting, call the `ask_user` tool.",
  "Prefer short multiple-choice `options` when possible. The turn pauses and a QuestionPicker appears under the prompt.",
  "Do not ask multiple-choice clarifying questions only in chat prose when `ask_user` is available.",
  "Do not use `ask_user` for facts you can discover with read/search/shell tools.",
].join("\n");

/**
 * Cursor SDK local runs: native AskQuestion is not offered.
 * Clarifications go through MCP server `cursorsi_ask` tool `ask_user`.
 */
export const ASK_USER_CURSOR_INSTRUCTIONS = [
  "## Asking the user (cursorsi)",
  "When you need a clarifying choice from the human, call the MCP tool `ask_user` on server `cursorsi_ask` (via CallMcpTool / MCP).",
  "Prefer short multiple-choice options. This opens the SISpace QuestionPicker under the prompt and pauses until they answer.",
  "Do not ask multiple-choice clarifying questions only in chat prose when that MCP tool is available.",
  "Do not use it for facts you can discover with read/search/shell tools.",
].join("\n");
