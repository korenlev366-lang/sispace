import { Box, Text } from "ink";
import { homedir } from "node:os";
import { formatTokenCount } from "../cost/tokens.js";
import {
  compactionConfigFromCwd,
  getSessionContextTokenCount,
} from "../session/compaction.js";
import { getCompactBudget } from "../config/context-windows.js";
import type { CliSession } from "../session/types.js";
import type { SlashCompletion } from "../commands/slash-catalog.js";

const CTX_BAR_SLOTS = 10;

/** Shorten a model id to its distinguishing name.
 *  "deepseek/deepseek-v4-pro"  → "v4-pro"
 *  "openai/gpt-4o"             → "gpt-4o"
 *  "anthropic/claude-3-haiku"  → "claude-3-haiku"
 */
function shortModelName(modelId: string): string {
  const lastSegment = modelId.includes("/")
    ? modelId.split("/").pop()!
    : modelId;
  // Strip redundant provider prefix when the last segment repeats it.
  // e.g. "deepseek/deepseek-v4-pro" → lastSegment = "deepseek-v4-pro"
  //      strip "deepseek-" → "v4-pro"
  const provider = modelId.split("/")[0] + "-";
  if (lastSegment.startsWith(provider)) {
    return lastSegment.slice(provider.length);
  }
  return lastSegment;
}

/** Shorten cwd to ~ form: /home/lev/sispace → ~/sispace */
function shortCwd(cwd: string): string {
  const home = process.env.HOME || homedir();
  if (cwd.startsWith(home)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

export interface PromptLineProps {
  session: CliSession;
  input: string;
  inputMode: "prompt" | "slash";
  slashCompletion: SlashCompletion | null;
  isBusy: boolean;
}

export function PromptLine({
  session,
  input,
  inputMode,
  slashCompletion,
  isBusy,
}: PromptLineProps) {
  const promptPrefix =
    inputMode === "slash" && input.trimStart().startsWith("/") ? "/" : "$ ";

  // ── left zone data ─────────────────────────────────────────────────
  const cwd = shortCwd(session.cwd);
  const modelShort = shortModelName(session.modelId);

  // reasoning effort (e.g. "high", "medium", "low")
  const effortParam = session.modelParams?.find(
    (p) => p.id === "effort" || p.id === "reasoning_effort",
  );
  const effortLabel = effortParam ? `⚡${effortParam.value}` : null;

  // status word — animated spinner lives in BusySpinner above the prompt
  const statusColor = isBusy ? "#d8a657" : "#89b482";
  const statusWord = isBusy ? "busy" : "ready";

  // ── right zone data ────────────────────────────────────────────────
  const contextTokens = getSessionContextTokenCount(session);
  const cfg = compactionConfigFromCwd(session.cwd);
  const budget = getCompactBudget(session.modelId, {
    contextWindow: cfg.contextWindow,
    compactRatio: cfg.compactRatio,
    reserveTokens: cfg.reserveTokens,
  });
  const safeBudget = Math.max(1, budget);
  const ratio = Math.min(1, contextTokens / safeBudget);
  const filled = Math.round(ratio * CTX_BAR_SLOTS);
  const empty = CTX_BAR_SLOTS - filled;

  // mini bar: ▕ + filled ▎… + empty ·… + ▏
  // amber for filled, faint for empty
  const leftEdge = "▕";
  const rightEdge = "▏";
  const filledBlock = "▎";
  const emptyBlock = "·";

  return (
    <Box flexDirection="column">
      {/* ── hairline divider: separates chat history from input zone ─ */}
      <Text dimColor>{"─".repeat(120)}</Text>

      {/* ── status line (redesigned, moved here from StatusBar) ────── */}
      <Box flexDirection="row">
        {/* ── left zone ─────────────────────────────────────────── */}
        <Text>
          <Text color="#d8a657" bold>
            cursorsi
          </Text>
          <Text dimColor> · </Text>
          <Text dimColor>{cwd}</Text>
          <Text dimColor> · </Text>
          <Text color="#d8a657" dimColor>
            {modelShort}
          </Text>
          {effortLabel ? (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>{effortLabel}</Text>
            </>
          ) : null}
          <Text dimColor> · </Text>
          <Text color={statusColor}>
            ● {statusWord}
          </Text>
        </Text>

        {/* ── spacer: pushes right zone to the end ──────────────── */}
        <Box flexGrow={1} />

        {/* ── right zone ────────────────────────────────────────── */}
        <Text>
          <Text dimColor>ctx </Text>
          <Text dimColor>{leftEdge}</Text>
          <Text color="#d8a657">{filledBlock.repeat(filled)}</Text>
          <Text dimColor>
            {empty > 0 ? emptyBlock.repeat(empty) : ""}
            {rightEdge}
          </Text>
          <Text dimColor> {formatTokenCount(contextTokens)}</Text>
        </Text>
      </Box>

      {/* ── input line ──────────────────────────────────────────── */}
      <Box paddingX={1} marginTop={0}>
        <Text>
          <Text color="#d8a657" bold>
            {promptPrefix}
          </Text>
          <Text>{input}</Text>
          {slashCompletion?.ghostSuffix ? (
            <Text dimColor>{slashCompletion.ghostSuffix}</Text>
          ) : null}
          <Text dimColor>▌</Text>
        </Text>
      </Box>
    </Box>
  );
}
