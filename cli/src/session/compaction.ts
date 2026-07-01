/**
 * Pi-style context compaction for CursorSI CLI sessions.
 * @see https://pi.dev/docs/latest/compaction
 */

import { OpenRouterAgent } from "../sdk/openrouter.js";
import { DEFAULT_MODEL, loadModelConfig } from "../config/models.js";
import { ensureSessionModel } from "../models/session-models.js";
import {
  modelIdToSelection,
  storedChoiceFromSession,
} from "../models/selection.js";
import { findProjectRoot } from "../project/root.js";
import { ensureCompactionTables } from "../db/compaction-schema.js";
import { openSharedDbWrite } from "../db/shared.js";
import { loadSispaceConfigFromCwd } from "../config/sispace.js";
import { loadObsidianYaml, taskNoteVaultPath } from "../obsidian/config.js";
import { vaultRead } from "../obsidian/read.js";
import { vaultWrite, appendSection } from "../obsidian/write.js";
import { getTaskRow, openTasksDb } from "./task-row.js";
import { closeSessionAgent } from "../runtime/send-turn.js";
import { compressWithHeadroom, loadHeadroomConfig } from "../sdk/headroom.js";
import { countTokens } from "../cost/token-counter.js";
import { getCompactBudget } from "../config/context-windows.js";
import type { CliSession } from "./types.js";

export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;

const INITIAL_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

<read-files>
path/to/file1.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>

Include <read-files> and <modified-files> tags listing paths mentioned in the conversation (empty tags if none).`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

<read-files>
</read-files>

<modified-files>
</modified-files>`;

export interface CompactionConfig {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  contextWindow: number;
  compactRatio: number;
}

export interface CompactionResult {
  ok: boolean;
  error?: string;
  messagesSummarized?: number;
  messagesKept?: number;
  summary?: string;
  sessionPatch?: Partial<CliSession>;
}

export interface SessionCompactionRow {
  id: number;
  session_id: string;
  summary: string;
  first_kept_entry_id: string;
  messages_summarized: number;
  messages_kept: number;
  created_at: string;
}

/**
 * Token estimate using tiktoken (cl100k_base BPE tokenizer).
 * Falls back to chars/3 if the WASM runtime is unavailable.
 * This is the standard tokenizer for GPT-4 and most OpenAI-compatible models
 * used through OpenRouter, giving accurate counts across languages and code.
 *
 * @see countTokens in cost/token-counter.ts for the implementation
 */
export function estimateTokens(text: string): number {
  return countTokens(text);
}

/** Fixed overhead for system messages prepended every turn (ENGLISH_SYSTEM_MESSAGE + formatting). */
const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 120;

export function entryIdForLineIndex(index: number): string {
  return `line_${index}`;
}

export function lineIndexFromEntryId(entryId: string): number {
  const m = /^line_(\d+)$/.exec(entryId);
  return m ? Number.parseInt(m[1], 10) : 0;
}

export function isMessageBoundaryLine(line: string): boolean {
  return line.startsWith("you> ") || line.startsWith("agent> ");
}

export function isToolOrSystemLine(line: string): boolean {
  if (line.startsWith("you> ") || line.startsWith("agent> ")) {
    return false;
  }
  if (line.startsWith("[tool]") || line.startsWith("[tool_result]")) {
    return true;
  }
  return line.startsWith("[") && !line.startsWith("[resumed ");
}

export function compactionConfigFromCwd(cwd: string): CompactionConfig {
  const cfg = loadSispaceConfigFromCwd(cwd).compaction;
  return {
    enabled: cfg.enabled,
    reserveTokens: cfg.reserve_tokens,
    keepRecentTokens: cfg.keep_recent_tokens,
    contextWindow: cfg.context_window,
    compactRatio: cfg.compact_ratio,
  };
}

/**
 * Get the effective context token count for a session.
 * Uses the real prompt_tokens from the last API response when available
 * (which accounts for full conversation history, system prompt, AGENTS.md,
 * Obsidian lessons, tools schema, and format overhead).
 * Falls back to local tiktoken-based estimation otherwise.
 */
export function getSessionContextTokenCount(session: CliSession): number {
  // Real API prompt_tokens from the last turn — the authoritative count
  if (session.contextTokens !== undefined && session.contextTokens > 0) {
    return session.contextTokens;
  }
  // Before the first API call, use the local tiktoken-based estimate
  return estimateSessionContextTokens(session);
}

/** Estimate total context tokens for a session (lines + injection blocks + system overhead).
 *
 * NOTE: session.lines stores user messages truncated to 200 chars (display preview),
 * while the actual messages sent to the model include the full text plus injection
 * blocks. This means the estimate may undercount before the first API call.
 * After the first turn, use `getSessionContextTokenCount()` which prefers the
 * authoritative API-reported prompt_tokens via session.contextTokens.
 */
export function estimateSessionContextTokens(session: CliSession): number {
  let total = SYSTEM_MESSAGE_OVERHEAD_TOKENS;
  for (const line of session.lines) {
    total += estimateTokens(line);
  }
  if (session.compactionSummaryBlock?.trim()) {
    total += estimateTokens(session.compactionSummaryBlock);
  }
  if (!session.contextInjected) {
    if (session.resumeContextBlock?.trim()) {
      total += estimateTokens(session.resumeContextBlock);
    }
    if (session.agentsContextBlock?.trim()) {
      total += estimateTokens(session.agentsContextBlock);
    }
    if (session.obsidianContextBlock?.trim()) {
      total += estimateTokens(session.obsidianContextBlock);
    }
    if (session.skillBundlePrompt?.trim()) {
      total += estimateTokens(session.skillBundlePrompt);
    }
  }
  return total;
}

export function shouldAutoCompact(
  session: CliSession,
  config: CompactionConfig,
): boolean {
  if (!config.enabled) {
    return false;
  }
  // Use real API-reported token count when available — it's authoritative
  const contextTokens = getSessionContextTokenCount(session);
  const budget = getCompactBudget(session.modelId, {
    contextWindow: config.contextWindow,
    compactRatio: config.compactRatio,
    reserveTokens: config.reserveTokens,
  });
  return contextTokens > budget;
}

export interface CutPointResult {
  cutIndex: number;
  firstKeptEntryId: string;
  keptTokens: number;
}

/**
 * Walk backwards from newest message; keep last keepRecentTokens at user/assistant boundaries.
 * Never cut at tool-result lines. Includes all intermediate lines (tool calls, results, logs)
 * between message boundaries in the kept token budget.
 */
export function findCompactionCutPoint(
  lines: string[],
  keepRecentTokens: number,
  previousFirstKeptIndex = 0,
): CutPointResult | null {
  const messageIndices: number[] = [];
  for (let i = previousFirstKeptIndex; i < lines.length; i++) {
    if (isMessageBoundaryLine(lines[i])) {
      messageIndices.push(i);
    }
  }
  if (messageIndices.length < 2) {
    return null;
  }

  let keptTokens = 0;
  let firstKeptMessagePos = messageIndices.length;

  // Walk backwards through message boundaries. For each message, add ALL intermediate
  // lines (tool calls, results, status) between that message and the next one.
  for (let m = messageIndices.length - 1; m >= 0; m--) {
    const msgIdx = messageIndices[m];
    const nextMsgIdx = m + 1 < messageIndices.length ? messageIndices[m + 1] : lines.length;

    // Sum tokens for this message boundary line + all lines through the next boundary
    let blockTokens = 0;
    for (let i = msgIdx; i < nextMsgIdx; i++) {
      blockTokens += estimateTokens(lines[i]);
    }

    if (keptTokens + blockTokens > keepRecentTokens) {
      firstKeptMessagePos = m + 1;
      break;
    }
    keptTokens += blockTokens;
    firstKeptMessagePos = m;
    if (m === 0) {
      return null;
    }
  }

  if (firstKeptMessagePos >= messageIndices.length) {
    return null;
  }

  let cutIndex = messageIndices[firstKeptMessagePos];
  while (cutIndex > previousFirstKeptIndex && isToolOrSystemLine(lines[cutIndex - 1])) {
    cutIndex--;
  }
  if (!isMessageBoundaryLine(lines[cutIndex])) {
    while (cutIndex < lines.length && !isMessageBoundaryLine(lines[cutIndex])) {
      cutIndex++;
    }
  }
  if (cutIndex <= previousFirstKeptIndex || cutIndex >= lines.length) {
    return null;
  }

  return {
    cutIndex,
    firstKeptEntryId: entryIdForLineIndex(cutIndex),
    keptTokens,
  };
}

function linesToTranscript(lines: string[], start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (line.startsWith("you> ")) {
      parts.push(`[user]\n${line.slice(5)}`);
    } else if (line.startsWith("agent> ")) {
      parts.push(`[assistant]\n${line.slice(7)}`);
    } else if (!isToolOrSystemLine(line)) {
      parts.push(`[log]\n${line}`);
    }
  }
  return parts.join("\n\n");
}

async function generateSummary(
  session: CliSession,
  credential: string,
  transcript: string,
  previousSummary: string | undefined,
  instructions: string | undefined,
): Promise<string> {
  const projectRoot = findProjectRoot(session.cwd);
  const { session: resolvedSession } = await ensureSessionModel(session, credential);
  const prompt = previousSummary?.trim()
    ? UPDATE_SUMMARIZATION_PROMPT
    : INITIAL_SUMMARIZATION_PROMPT;

  const parts: string[] = [transcript];
  if (previousSummary?.trim()) {
    parts.push("", "<previous-summary>", previousSummary.trim(), "</previous-summary>");
  }
  if (instructions?.trim()) {
    parts.push("", "## Additional compaction instructions", instructions.trim());
  }
  parts.push("", prompt);

  const cfg = loadModelConfig(projectRoot);
  const modelChoice = modelIdToSelection(
    storedChoiceFromSession(
      resolvedSession.modelId,
      resolvedSession.modelParams,
    ),
  );
  const modelId = modelChoice.id?.trim() || cfg.default || DEFAULT_MODEL;

  const agent = new OpenRouterAgent({
    apiKey: credential,
    model: modelId,
    name: `cursorsi-compact-${session.id}`,
    enableTools: false,
  });

  try {
    let full = "";
    const result = await agent.runTurn(parts.join("\n"), undefined, {
      onChunk: (_delta, accumulated) => {
        full = accumulated;
      },
    });
    const text = result.result?.trim() || full.trim();
    if (result.status === "error") {
      throw new Error(result.result?.trim() || "compaction summarizer failed");
    }
    if (!text) {
      throw new Error("compaction summarizer returned empty response");
    }
    return text;
  } finally {
    agent.close();
  }
}

export function saveCompactionRow(
  row: Omit<SessionCompactionRow, "id" | "created_at">,
): SessionCompactionRow | null {
  const db = openSharedDbWrite();
  if (!db) {
    return null;
  }
  ensureCompactionTables(db);
  const stmt = db.prepare(
    `INSERT INTO session_compactions
     (session_id, summary, first_kept_entry_id, messages_summarized, messages_kept)
     VALUES (?, ?, ?, ?, ?)`,
  );
  stmt.run(
    row.session_id,
    row.summary,
    row.first_kept_entry_id,
    row.messages_summarized,
    row.messages_kept,
  );
  const rowid = db.prepare("SELECT last_insert_rowid() AS id").get() as
    | { id: number }
    | undefined;
  const id = Number(rowid?.id ?? 0);
  return {
    id,
    session_id: row.session_id,
    summary: row.summary,
    first_kept_entry_id: row.first_kept_entry_id,
    messages_summarized: row.messages_summarized,
    messages_kept: row.messages_kept,
    created_at: new Date().toISOString(),
  };
}

export function loadLatestCompaction(
  sessionId: string,
): SessionCompactionRow | null {
  const db = openSharedDbWrite();
  if (!db) {
    return null;
  }
  ensureCompactionTables(db);
  const row = db
    .prepare(
      `SELECT id, session_id, summary, first_kept_entry_id,
              messages_summarized, messages_kept, created_at
       FROM session_compactions
       WHERE session_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sessionId) as SessionCompactionRow | undefined;
  return row ?? null;
}

/** Trim lines: keep boilerplate before first message, then from firstKeptEntryId. */
export function trimLinesAfterCompaction(
  lines: string[],
  firstKeptEntryId: string,
): string[] {
  const keptFrom = lineIndexFromEntryId(firstKeptEntryId);
  let firstMsg = lines.findIndex(isMessageBoundaryLine);
  if (firstMsg < 0) {
    firstMsg = 0;
  }
  const prefix = lines.slice(0, Math.min(firstMsg, keptFrom));
  return [...prefix, ...lines.slice(keptFrom)];
}

export async function writeCompactionToObsidian(
  session: CliSession,
  summary: string,
): Promise<void> {
  if (!session.taskId?.trim()) {
    return;
  }
  const db = openTasksDb();
  if (!db) {
    return;
  }
  const task = getTaskRow(db, session.taskId);
  if (!task) {
    return;
  }
  const projectRoot = findProjectRoot(session.cwd);
  const obsidianCfg = loadObsidianYaml(projectRoot);
  const notePath =
    task.obsidian_note_path?.trim() ||
    taskNoteVaultPath(obsidianCfg, task.id);

  let noteBody = "";
  try {
    noteBody = await vaultRead(notePath);
  } catch {
    noteBody = "";
  }
  const updated = appendSection(noteBody, "Compaction", summary.trim());
  await vaultWrite(notePath, updated);
}

export async function runSessionCompaction(
  session: CliSession,
  credential: string,
  options?: { force?: boolean; instructions?: string },
): Promise<CompactionResult> {
  const config = compactionConfigFromCwd(session.cwd);
  if (!config.enabled && !options?.force) {
    return { ok: false, error: "Compaction disabled in config/sispace.yaml" };
  }
  if (!credential.trim()) {
    return { ok: false, error: "No Cursor auth token in environment." };
  }

  const previousKept =
    session.firstKeptEntryId != null
      ? lineIndexFromEntryId(session.firstKeptEntryId)
      : 0;
  const cut = findCompactionCutPoint(
    session.lines,
    config.keepRecentTokens,
    previousKept,
  );
  if (!cut) {
    return {
      ok: false,
      error: "Not enough conversation history to compact (need 2+ user/assistant turns).",
    };
  }

  const messagesSummarized = session.lines
    .slice(previousKept, cut.cutIndex)
    .filter(isMessageBoundaryLine).length;
  const messagesKept = session.lines
    .slice(cut.cutIndex)
    .filter(isMessageBoundaryLine).length;

  if (messagesSummarized < 1) {
    return { ok: false, error: "No messages in range to summarize." };
  }

  const transcript = linesToTranscript(session.lines, previousKept, cut.cutIndex);

  // Optional headroom compression of the compaction transcript
  let compressedTranscript = transcript;
  try {
    const headroomCfg = loadHeadroomConfig();
    if (headroomCfg.enabled) {
      const hr = await compressWithHeadroom(transcript);
      if (hr.compressed) {
        compressedTranscript = hr.text;
        console.log(`[headroom] compaction transcript: ${hr.tokensBefore}→${hr.tokensAfter} tokens (${Math.round((hr.tokensSaved / hr.tokensBefore) * 100)}% saved)`);
      }
    }
  } catch {
    // compression failure is non-fatal — use original transcript
  }

  let summary: string;
  try {
    summary = await generateSummary(
      session,
      credential,
      compressedTranscript,
      session.compactionSummaryBlock?.includes("## Goal")
        ? session.compactionSummaryBlock
        : loadLatestCompaction(session.id)?.summary,
      options?.instructions,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Summary generation failed: ${msg}` };
  }

  saveCompactionRow({
    session_id: session.id,
    summary,
    first_kept_entry_id: cut.firstKeptEntryId,
    messages_summarized: messagesSummarized,
    messages_kept: messagesKept,
  });

  try {
    await writeCompactionToObsidian(session, summary);
  } catch {
    // Obsidian write is best-effort
  }

  const trimmedLines = trimLinesAfterCompaction(session.lines, cut.firstKeptEntryId);
  const summaryBlock = [
    "## Context compaction (prior conversation summarized)",
    "",
    summary.trim(),
  ].join("\n");

  closeSessionAgent(session.id);

  return {
    ok: true,
    messagesSummarized,
    messagesKept,
    summary,
    sessionPatch: {
      compactionSummaryBlock: summaryBlock,
      compacted: true,
      firstKeptEntryId: cut.firstKeptEntryId,
      lines: trimmedLines,
      contextInjected: false,
      cursorAgentId: undefined,
    },
  };
}

/** Apply stored compaction on session load (e.g. handoff resume). */
export function hydrateCompactionFromDb(session: CliSession): Partial<CliSession> | null {
  const row = loadLatestCompaction(session.id);
  if (!row) {
    return null;
  }
  const keptFrom = lineIndexFromEntryId(row.first_kept_entry_id);
  if (keptFrom <= 0 || keptFrom >= session.lines.length) {
    const summaryBlock = [
      "## Context compaction (prior conversation summarized)",
      "",
      row.summary.trim(),
    ].join("\n");
    return {
      compactionSummaryBlock: summaryBlock,
      compacted: true,
      firstKeptEntryId: row.first_kept_entry_id,
      contextInjected: false,
    };
  }
  const summaryBlock = [
    "## Context compaction (prior conversation summarized)",
    "",
    row.summary.trim(),
  ].join("\n");
  return {
    compactionSummaryBlock: summaryBlock,
    compacted: true,
    firstKeptEntryId: row.first_kept_entry_id,
    lines: trimLinesAfterCompaction(session.lines, row.first_kept_entry_id),
    contextInjected: false,
    cursorAgentId: undefined,
  };
}
