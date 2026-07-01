/**
 * History compressor — summarizes old conversation turns using Flash
 * to keep context short while preserving technical relevance.
 *
 * Stage 3 of the compressor pipeline.
 */

import OpenAI from "openai";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompressOldTurnsResult {
  messages: string[];
  newLastCompressedTurn: number;
}

// ── Turn parsing helpers ───────────────────────────────────────────────────

interface TurnPair {
  /** Index in the messages array where the user> line starts. */
  userIndex: number;
  userMsg: string;
  agentMsg: string;
}

/**
 * Walk the flat messages array and extract consecutive user> / agent> pairs.
 * Already-compressed [turn summary] entries are skipped (they count as one turn
 * but don't need re-compression).  Tool-result lines are ignored for pairing.
 */
function parseTurnPairs(messages: string[]): {
  /** All uncompressed turn pairs found (user> + agent>). */
  pairs: TurnPair[];
  /** Number of already-compressed turns ([turn summary] entries). */
  alreadyCompressed: number;
  /** Total number of logical turns (compressed + uncompressed). */
  totalTurns: number;
} {
  const pairs: TurnPair[] = [];
  let alreadyCompressed = 0;

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.startsWith("[turn summary] ")) {
      alreadyCompressed++;
      i++;
    } else if (msg.startsWith("user> ")) {
      const userMsg = msg.slice(6);
      if (i + 1 < messages.length && messages[i + 1].startsWith("agent> ")) {
        const agentMsg = messages[i + 1].slice(7);
        pairs.push({ userIndex: i, userMsg, agentMsg });
        i += 2;
      } else {
        // Orphan user message — shouldn't happen; skip it
        i++;
      }
    } else if (msg.startsWith("[tool_result] ")) {
      // Tool results are appended by buildHistoryInput, not part of turn pairs
      i++;
    } else if (msg.startsWith("agent> ")) {
      // Orphan agent message — skip
      i++;
    } else {
      i++;
    }
  }

  const totalTurns = alreadyCompressed + pairs.length;
  return { pairs, alreadyCompressed, totalTurns };
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Compress old conversation turns to keep context size manageable.
 *
 * - Parses `messages` into turn pairs (user> + agent>).
 * - Keeps the **last 6 turns** completely untouched.
 * - For turns older than 6 but newer than the last compression point, calls
 *   DeepSeek Flash (via the OpenAI-compatible client) to produce a one-sentence
 *   summary and replaces the pair with a `[turn summary]` entry.
 * - Never re-compresses a turn that has already been summarized.
 * - Only triggers when `messages.length > 20` (10+ turns).
 *
 * @param messages            Flat message history (user> / agent> / [turn summary] lines).
 * @param client              OpenAI-compatible client pointed at OpenRouter.
 * @param lastCompressedTurn  Count of already-compressed turns (0 = none).
 * @param onStatus            Optional callback for cost/log lines.
 */
export async function compressOldTurns(
  messages: string[],
  client: OpenAI,
  lastCompressedTurn: number,
  onStatus?: (line: string) => void,
): Promise<CompressOldTurnsResult> {
  // Guard: don't bother compressing short sessions
  if (messages.length <= 20) {
    return { messages, newLastCompressedTurn: lastCompressedTurn };
  }

  const { pairs, totalTurns } = parseTurnPairs(messages);

  if (pairs.length === 0) {
    return { messages, newLastCompressedTurn: lastCompressedTurn };
  }

  const KEEP_TURNS = 6;

  // Determine which pairs need compression:
  // - They are older than the last KEEP_TURNS (i.e. not among the most recent 6)
  // - They haven't been compressed yet (their turn index > lastCompressedTurn)
  const pairsToCompress: TurnPair[] = [];
  const keptPairs: TurnPair[] = [];

  // Turn numbers for uncompressed pairs:
  // alreadyCompressed turns come first, then the pairs in order.
  for (let p = 0; p < pairs.length; p++) {
    const turnNumber = lastCompressedTurn + p + 1; // 1-based
    const turnsFromEnd = pairs.length - p; // how many pairs (including this one) until the end
    if (turnsFromEnd <= KEEP_TURNS) {
      keptPairs.push(pairs[p]);
    } else {
      pairsToCompress.push(pairs[p]);
    }
  }

  if (pairsToCompress.length === 0) {
    return { messages, newLastCompressedTurn: lastCompressedTurn };
  }

  // ── Summarize each old turn via Flash ─────────────────────────────────
  const compressed: Array<{ userIndex: number; summary: string }> = [];

  for (const pair of pairsToCompress) {
    try {
      const response = await client.chat.completions.create({
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 80,
        messages: [
          {
            role: "user",
            content:
              `Summarize this exchange in ONE sentence max 60 tokens, keeping only what's technically relevant for future code edits:\n\n` +
              `User: ${pair.userMsg}\n` +
              `Agent: ${pair.agentMsg.slice(0, 500)}`,
          },
        ],
      });

      const summary =
        response.choices?.[0]?.message?.content?.trim() ??
        "(summary unavailable)";
      compressed.push({ userIndex: pair.userIndex, summary });
    } catch (err) {
      // If a Flash call fails, leave the turn uncompressed (graceful degradation)
      console.warn("[compression] failed to summarize turn:", err);
    }
  }

  if (compressed.length === 0) {
    return { messages, newLastCompressedTurn: lastCompressedTurn };
  }

  // ── Rewrite messages array ────────────────────────────────────────────
  const replaceMap = new Map<number, string>();
  const deleteNext = new Set<number>();

  for (const c of compressed) {
    replaceMap.set(c.userIndex, `[turn summary] ${c.summary}`);
    deleteNext.add(c.userIndex + 1); // the agent> line that follows
  }

  const newMessages: string[] = [];
  let skip = false;
  for (let i = 0; i < messages.length; i++) {
    if (skip) {
      skip = false;
      continue;
    }
    if (deleteNext.has(i)) {
      // This is an agent> line being replaced — skip it (replacement already emitted)
      continue;
    }
    const replacement = replaceMap.get(i);
    if (replacement !== undefined) {
      newMessages.push(replacement);
      skip = true; // skip the next line (the agent> message)
    } else {
      newMessages.push(messages[i]);
    }
  }

  // ── Log cost ──────────────────────────────────────────────────────────
  if (onStatus && pairsToCompress.length > 0) {
    const firstTurn = lastCompressedTurn + 1;
    const lastTurn = lastCompressedTurn + pairsToCompress.length;
    const savedTokens = pairsToCompress.reduce(
      (sum, p) => sum + p.userMsg.length + p.agentMsg.length,
      0,
    );
    onStatus(
      `› [compression] summarized turns ${firstTurn}-${lastTurn} (saved ~${savedTokens} tokens)`,
    );
  }

  const newLastCompressedTurn = lastCompressedTurn + pairsToCompress.length;

  return { messages: newMessages, newLastCompressedTurn };
}
