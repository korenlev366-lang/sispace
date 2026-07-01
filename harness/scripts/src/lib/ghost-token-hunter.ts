/**
 * Ghost Token Hunter — local context integrity pass for harness prompts.
 *
 * Detects low-contribution "ghost" fragments (duplicate echoes, boilerplate,
 * stale truncation debris) and removes them while preserving high-signal content.
 *
 * The upstream gerrict/ghost-token-hunter repo ships malware-only HTML; this is
 * a practical harness implementation of the concept described in its README.
 */

export interface GhostHunterConfig {
  enabled: boolean;
  /** 0–1; higher = more aggressive ghost removal */
  sensitivity: number;
  /** Minimum signal score required to keep a block flagged as ghost */
  minSignalToKeep: number;
}

export interface GhostHuntResult {
  text: string;
  charsBefore: number;
  charsAfter: number;
  ghostsRemoved: number;
  blocksKept: number;
  blocksTotal: number;
}

const DEFAULT_CONFIG: GhostHunterConfig = {
  enabled: true,
  sensitivity: 0.72,
  minSignalToKeep: 0.35,
};

const BOILERPLATE_PATTERNS: RegExp[] = [
  /^<\/?think>/i,
  /^<\/?system-reminder>/i,
  /^<\/?assistant/i,
  /^\[tool_call\]/i,
  /^\[tool_result\]/i,
  /^```\s*$/,
  /^\.\.\.\(truncated\)$/i,
  /^\(not provided/i,
  /^\(none\)$/i,
  /^Session ID:/i,
  /^Output tokens:/i,
];

const ERROR_MARKERS = /\b(?:error|fatal|exception|failed|panic|traceback)\b/i;

const SIGNAL_PATTERNS: RegExp[] = [
  /\b(?:error|fatal|exception|failed|panic|traceback)\b/i,
  /\b(?:proposal|rollback|verification|decision|blocked)\b/i,
  /\bPROP-\d{8}-\d+\b/,
  /\bROLLOUT-\d{8}-\d+\b/,
  /\/[\w.-]+\.(?:ts|tsx|js|mjs|py|rs|go|java|md|yaml|json)\b/,
  /\b\d{3,}\b/,
  /```[\s\S]*?```/,
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_/.\-]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function boilerplateScore(block: string): number {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 1;
  let hits = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (BOILERPLATE_PATTERNS.some((p) => p.test(trimmed))) hits += 1;
  }
  return hits / lines.length;
}

function signalScore(block: string): number {
  let score = 0;
  for (const pattern of SIGNAL_PATTERNS) {
    if (pattern.test(block)) score += 0.2;
  }
  const tokens = tokenSet(block);
  const density = tokens.size / Math.max(1, estimateTokens(block));
  score += Math.min(0.4, density * 2);
  if (block.includes("## ") || block.includes("### ")) score += 0.15;
  if (/^(?:Session ID|Output tokens):/im.test(block) && !ERROR_MARKERS.test(block)) {
    score = Math.min(score, 0.25);
  }
  return Math.min(1, score);
}

function splitBlocks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const headerSplit = trimmed.split(/\n(?=#{1,3} )/);
  if (headerSplit.length > 1) return headerSplit.map((b) => b.trim()).filter(Boolean);

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  return trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function huntGhostTokens(
  text: string,
  config: Partial<GhostHunterConfig> = {},
): GhostHuntResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const charsBefore = text.length;

  if (!cfg.enabled || !text.trim()) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      ghostsRemoved: 0,
      blocksKept: 0,
      blocksTotal: 0,
    };
  }

  const blocks = splitBlocks(text);
  if (blocks.length <= 1) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      ghostsRemoved: 0,
      blocksKept: blocks.length,
      blocksTotal: blocks.length,
    };
  }

  const tokenSets = blocks.map((b) => tokenSet(b));
  const kept: string[] = [];
  const keptHashes = new Set<string>();
  let ghostsRemoved = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const normalized = block.trim().replace(/\s+/g, " ").toLowerCase();
    const signal = signalScore(block);
    const boilerplate = boilerplateScore(block);

    let maxDup = 0;
    for (let j = 0; j < blocks.length; j += 1) {
      if (i === j) continue;
      maxDup = Math.max(maxDup, jaccard(tokenSets[i]!, tokenSets[j]!));
    }

    const isExactDuplicate = keptHashes.has(normalized);
    const ghostScore =
      maxDup * 0.45 + boilerplate * 0.35 + (1 - signal) * 0.2;
    const isGhost =
      isExactDuplicate ||
      (ghostScore >= cfg.sensitivity && signal < cfg.minSignalToKeep);

    if (isGhost) {
      ghostsRemoved += 1;
      continue;
    }
    kept.push(block);
    keptHashes.add(normalized);
  }

  const output = kept.join("\n\n");
  return {
    text: output || text,
    charsBefore,
    charsAfter: output.length,
    ghostsRemoved,
    blocksKept: kept.length,
    blocksTotal: blocks.length,
  };
}
