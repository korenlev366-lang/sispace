/**
 * Slash command names for TUI autocomplete (prefix match + Tab cycle).
 * Keep in sync with handlers in slash.ts.
 */

export const SLASH_COMMANDS = [
  "apply",
  "backend",
  "bug",
  "compact",
  "curate",
  "doctor",
  "docs",
  "feature",
  "goal",
  "grade",
  "handoff",
  "harness",
  "harness-compress",
  "help",
  "model",
  "recall",
  "reflect",
  "reject",
  "search",
  "settings",
  "subagent-model",
  "subagents",
  "swarm",
] as const;

export type SlashCommandName = (typeof SLASH_COMMANDS)[number];

/** Short descriptions for TUI autocomplete dropdown (Hermes-style). */
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommandName, string> = {
  apply: "Harness apply with locked-layer guard",
  backend: "Show or change LLM backend (openrouter|cursor)",
  bug: "Load bug-fix skill bundle for next turn",
  compact: "Summarize session context (Pi-style compaction)",
  curate: "Skill curation proposals (read-only emit)",
  doctor: "Meta-readiness doctor check",
  docs: "Load documentation skill bundle",
  feature: "Load feature skill bundle for next turn",
  goal: "Show or resume verify goal loop",
  grade: "Grade latest harness reflection",
  handoff: "Export session blob for attach",
  harness: "Harness status summary",
  "harness-compress": "Re-compress lesson index — regenerate Flash oneliners for all accepted lessons",
  help: "List all slash commands",
  model: "Choose orchestrator model (Cursor catalog UI)",
  recall: "Obsidian FTS lesson recall (next turn)",
  reflect: "Run harness reflection (invoke-chain)",
  reject: "Reject a harness proposal by ID",
  search: "FTS task/session search (shared DB)",
  settings: "Show or change user settings (persistent ~/.config/cursorsi/settings.json)",
  "subagent-model": "Choose pipeline subagent model (excludes orchestrator)",
  subagents: "Toggle pipeline subagent decomposition (on/off)",
  swarm: "Show swarm graph for linked task",
};

export function slashCommandDescription(name: SlashCommandName): string {
  return SLASH_COMMAND_DESCRIPTIONS[name];
}

export interface ActiveSlashSpan {
  /** Index of the `/` starting the active token */
  start: number;
  /** Exclusive end of the token (usually `input.length` while typing) */
  end: number;
  /** Command name fragment after `/` (may be empty for bare `/`) */
  query: string;
}

/** Active `/command` token at the cursor (mid-prompt or line-start). */
export function findActiveSlashSpan(
  input: string,
  cursor = input.length,
): ActiveSlashSpan | null {
  const beforeCursor = input.slice(0, cursor);
  const slashIndex = beforeCursor.lastIndexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  if (slashIndex > 0 && !/\s/.test(input[slashIndex - 1]!)) {
    return null;
  }

  const segment = input.slice(slashIndex, cursor);
  if (!/^\/[^\s]*$/.test(segment)) {
    return null;
  }

  return {
    start: slashIndex,
    end: cursor,
    query: segment.slice(1),
  };
}

/** True while typing a slash command name (before the first argument space). */
export function isSlashCommandPrefix(
  input: string,
  cursor = input.length,
): boolean {
  return findActiveSlashSpan(input, cursor) !== null;
}

/** Pull `/cmd …` out of a prompt line (line-start or after whitespace). */
export function extractSlashInvocation(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  const matches = [
    ...trimmed.matchAll(/(?:^|\s)(\/[a-z][a-z0-9_-]*(?:\s+[^\s/][^\n]*)?)/gi),
  ];
  if (matches.length === 0) {
    return null;
  }

  return matches[matches.length - 1]![1]!.trim();
}

/** First token after `/` in a slash invocation (lowercased), or null. */
export function parseSlashCommandKey(invocation: string): string | null {
  const body = invocation.slice(1).trim();
  if (!body) {
    return null;
  }
  const [name] = body.split(/\s+/);
  return name ? name.toLowerCase() : null;
}

export function isRegisteredSlashCommand(key: string): boolean {
  return (SLASH_COMMANDS as readonly string[]).includes(key);
}

/**
 * Like extractSlashInvocation, but returns null unless the command name is registered.
 * Unrecognized `/…` lines are sent to the agent as plain text.
 */
export function extractKnownSlashInvocation(input: string): string | null {
  const invocation = extractSlashInvocation(input);
  if (!invocation) {
    return null;
  }
  const key = parseSlashCommandKey(invocation);
  if (!key || !isRegisteredSlashCommand(key)) {
    return null;
  }
  return invocation;
}

export interface SlashCompletion {
  /** Full input with the active token replaced, e.g. "ctx /goal" */
  value: string;
  /** Dim ghost suffix after current input */
  ghostSuffix: string;
  /** All commands matching the typed prefix */
  candidates: SlashCommandName[];
  /** Index into candidates for the active suggestion */
  candidateIndex: number;
}

export function getSlashCompletion(
  input: string,
  candidateIndex = 0,
  cursor = input.length,
): SlashCompletion | null {
  const span = findActiveSlashSpan(input, cursor);
  if (!span) {
    return null;
  }

  const query = span.query.toLowerCase();
  const matches = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(query));
  if (matches.length === 0) {
    return null;
  }

  const idx = ((candidateIndex % matches.length) + matches.length) % matches.length;
  const cmd = matches[idx]!;
  const completedSegment = `/${cmd}`;
  const currentSegment = input.slice(span.start, span.end);
  const value =
    input.slice(0, span.start) + completedSegment + input.slice(span.end);
  const ghostSuffix = completedSegment.startsWith(currentSegment)
    ? completedSegment.slice(currentSegment.length)
    : "";

  return {
    value,
    ghostSuffix: ghostSuffix.length > 0 ? ghostSuffix : "",
    candidates: matches,
    candidateIndex: idx,
  };
}
