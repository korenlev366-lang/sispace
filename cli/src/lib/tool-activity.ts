/**
 * Cursor CLI-style live tool activity lines for the TUI.
 */

export type ToolStatusEmitter = (line: string) => void;

let toolStatusEmitter: ToolStatusEmitter | null = null;

export function setToolStatusEmitter(emitter: ToolStatusEmitter | null): void {
  toolStatusEmitter = emitter;
}

export function emitToolStatus(line: string): void {
  const trimmed = line.trimEnd();
  if (!trimmed) return;
  toolStatusEmitter?.(trimmed);
}

function trunc(s: string, max = 72): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

/** Local cursorsi tool names → activity line (start). */
export function formatLocalToolStart(
  name: string,
  args: Record<string, unknown>,
): string {
  const path = String(args.path ?? "");
  const command = String(args.command ?? "");
  switch (name) {
    case "write_file":
    case "edit_file":
      return `› Edited ${trunc(path || "(file)")}`;
    case "execute_bash":
      return `› Ran ${trunc(command || "(command)", 80)}`;
    case "read_file":
      return `› Read ${trunc(path || "(file)")}`;
    case "list_directory":
      return `› Listed ${trunc(path || ".")}`;
    case "view_file_outline":
      return `› Outlined ${trunc(path || "(file)")}`;
    case "search_files": {
      const pattern = String(args.pattern ?? "*");
      const dir = args.directory ? ` in ${String(args.directory)}` : "";
      return `› Searched ${trunc(pattern + dir)}`;
    }
    case "web_search":
      return `› Searched web ${trunc(String(args.query ?? ""))}`;
    case "web_fetch":
      return `› Fetched ${trunc(String(args.url ?? ""))}`;
    case "read_image":
      return `› Image ${trunc(String(args.path_or_url ?? ""))}`;
    case "bg_spawn_process":
      return `› Spawned ${trunc(`${args.id ?? "bg"}: ${command}`, 80)}`;
    case "bg_read_buffer":
      return `› Bg read ${String(args.id ?? "default")}`;
    case "ask_user":
      return `› Asked user`;
    case "obsidian_read":
      return `› Obsidian read ${trunc(path)}`;
    case "obsidian_search":
      return `› Obsidian search ${trunc(String(args.query ?? ""))}`;
    case "obsidian_write":
    case "obsidian_append":
      return `› Obsidian wrote ${trunc(path)}`;
    default:
      return `› ${name}${path || command ? ` ${trunc(path || command)}` : ""}`;
  }
}

/** Completion line for edits/shell (✓). Returns null to skip noisy tools. */
export function formatLocalToolDone(
  name: string,
  args: Record<string, unknown>,
  result: string,
): string | null {
  const path = String(args.path ?? "");
  const command = String(args.command ?? "");
  const failed =
    /^Error:/i.test(result) ||
    /failed/i.test(result.slice(0, 80)) ||
    /exit code/i.test(result.slice(0, 120));

  if (name === "write_file" || name === "edit_file") {
    // Start line already said "Edited"; only echo failures.
    if (failed) return `› ✓ Failed editing ${trunc(path || "(file)")}`;
    return null;
  }
  if (name === "execute_bash") {
    const cmd = trunc(command || "(command)", 80);
    if (failed) return `› ✓ Ran ${cmd} (failed)`;
    const out = result.replace(/\s+/g, " ").trim();
    if (out && out !== "(no output)" && out.length <= 60 && !out.includes("\n")) {
      return `› ✓ ${cmd} → ${out}`;
    }
    return `› ✓ ${cmd}`;
  }
  if (failed) {
    return `› ✓ ${name} failed`;
  }
  return null;
}

type CursorToolCallLike = {
  type?: string;
  args?: Record<string, unknown>;
  result?: { status?: string; value?: Record<string, unknown>; error?: unknown };
};

/** Format Cursor SDK tool-call-started / completed updates. */
export function formatCursorToolActivity(
  phase: "started" | "completed",
  toolCall: CursorToolCallLike | null | undefined,
): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const type = String(toolCall.type ?? "");
  const args = (toolCall.args ?? {}) as Record<string, unknown>;
  const path = String(args.path ?? args.targetDirectory ?? "");
  const command = String(args.command ?? "");
  const query = String(args.pattern ?? args.query ?? args.globPattern ?? "");

  const verb = (() => {
    switch (type) {
      case "shell":
        return phase === "started" ? "Ran" : "✓ Ran";
      case "edit":
      case "write":
        return phase === "started" ? "Edited" : "✓ Edited";
      case "delete":
        return phase === "started" ? "Deleted" : "✓ Deleted";
      case "read":
        return phase === "started" ? "Read" : "✓ Read";
      case "grep":
      case "semSearch":
        return phase === "started" ? "Searched" : "✓ Searched";
      case "glob":
        return phase === "started" ? "Globbed" : "✓ Globbed";
      case "ls":
        return phase === "started" ? "Listed" : "✓ Listed";
      case "readLints":
        return phase === "started" ? "Lints" : "✓ Lints";
      case "mcp":
        return phase === "started" ? "MCP" : "✓ MCP";
      case "updateTodos":
        return phase === "started" ? "Todos" : "✓ Todos";
      case "task":
        return phase === "started" ? "Subagent" : "✓ Subagent";
      case "createPlan":
        return phase === "started" ? "Plan" : "✓ Plan";
      default:
        return phase === "started" ? type || "Tool" : `✓ ${type || "Tool"}`;
    }
  })();

  let detail = "";
  if (type === "shell") detail = trunc(command || "(command)", 80);
  else if (type === "task") {
    detail = trunc(
      String(args.description ?? args.prompt ?? path ?? query),
      56,
    );
  } else if (path) detail = trunc(path);
  else if (query) detail = trunc(query);
  else if (type === "mcp") {
    detail = trunc(
      `${String(args.providerId ?? args.server ?? "")} ${String(args.toolName ?? args.name ?? "")}`.trim(),
    );
  }

  // On completed, skip success duplicates (started already shown).
  if (phase === "completed") {
    const status = toolCall.result?.status;
    if (type === "shell") {
      const value = toolCall.result?.value;
      const exit =
        value && typeof value.exitCode === "number" ? value.exitCode : undefined;
      if (status === "error" || (exit !== undefined && exit !== 0)) {
        return `› ✓ Ran ${detail || "(command)"} (exit ${exit ?? "?"})`;
      }
      // Tiny stdout echo when available
      const stdout =
        value && typeof value.stdout === "string"
          ? value.stdout.replace(/\s+/g, " ").trim()
          : "";
      if (stdout && stdout.length <= 60) {
        return `› ✓ ${detail || "(command)"} → ${stdout}`;
      }
      return null;
    }
    if (type === "edit" || type === "write") {
      if (status === "error") {
        return `› ✓ Failed editing ${detail || "(file)"}`;
      }
      const value = toolCall.result?.value;
      const added =
        value && typeof value.linesAdded === "number" ? value.linesAdded : undefined;
      const removed =
        value && typeof value.linesRemoved === "number"
          ? value.linesRemoved
          : undefined;
      if (added !== undefined || removed !== undefined) {
        return `› ✓ Edited ${detail || "(file)"} (+${added ?? 0}/-${removed ?? 0})`;
      }
      return null;
    }
    if (status === "error") {
      return `› ✓ ${type || "tool"} failed${detail ? ` ${detail}` : ""}`;
    }
    return null;
  }

  return `› ${verb}${detail ? ` ${detail}` : ""}`;
}
