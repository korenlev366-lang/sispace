/**
 * Harness context optimizer — Ghost Token Hunter → Headroom → budget cap.
 */

import fs from "node:fs";
import path from "node:path";
import { huntGhostTokens, type GhostHunterConfig } from "./ghost-token-hunter.js";
import { compressWithHeadroom, type HeadroomBridgeConfig } from "./headroom-bridge.js";

export interface TokenOptimizerBudgets {
  reflectionTranscript: number;
  reflectionLessons: number;
  reflectionGoals: number;
  subagentPrompt: number;
}

export interface TokenOptimizerConfig {
  enabled: boolean;
  ghostHunter: GhostHunterConfig;
  headroom: HeadroomBridgeConfig;
  budgets: TokenOptimizerBudgets;
}

export interface OptimizeContextResult {
  text: string;
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  ghostsRemoved: number;
  headroomBackend: string;
  headroomTransform: string;
  truncated: boolean;
}

const DEFAULT_CONFIG: TokenOptimizerConfig = {
  enabled: true,
  ghostHunter: {
    enabled: true,
    sensitivity: 0.72,
    minSignalToKeep: 0.35,
  },
  headroom: {
    enabled: true,
    proxyUrl: process.env.HEADROOM_PROXY_URL ?? "http://localhost:8787",
    fallbackLite: true,
    timeoutMs: 8_000,
    model: "gpt-4o",
    targetKeepRatio: 0.55,
  },
  budgets: {
    reflectionTranscript: 12_000,
    reflectionLessons: 3_000,
    reflectionGoals: 6_000,
    subagentPrompt: 32_000,
  },
};

let cachedConfig: TokenOptimizerConfig | null = null;
let cachedConfigPath: string | null = null;
let cachedMtime = 0;

function parseYamlBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1";
}

function parseYamlNumber(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : 0;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Minimal YAML reader for harness token-optimizer.yaml (no extra deps). */
function parseTokenOptimizerYaml(raw: string): Partial<TokenOptimizerConfig> {
  const out: Record<string, unknown> = {};
  let section = "";
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^([a-z_]+):\s*$/);
    if (sectionMatch) {
      section = snakeToCamel(sectionMatch[1]!);
      if (!out[section]) out[section] = {};
      continue;
    }

    const kv = trimmed.match(/^([a-z_]+):\s*(.+)$/);
    if (!kv) continue;

    const key = snakeToCamel(kv[1]!);
    const value = kv[2]!.replace(/^["']|["']$/g, "");

    if (!section) {
      if (key === "enabled") out.enabled = parseYamlBool(value);
      continue;
    }

    const bucket = out[section] as Record<string, unknown>;
    if (value === "true" || value === "false") {
      bucket[key] = parseYamlBool(value);
    } else if (/^\d+(\.\d+)?$/.test(value)) {
      bucket[key] = parseYamlNumber(value);
    } else {
      bucket[key] = value;
    }
  }

  return out as Partial<TokenOptimizerConfig>;
}

export function loadTokenOptimizerConfig(configDir: string): TokenOptimizerConfig {
  const configPath = path.join(configDir, "token-optimizer.yaml");
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const stat = fs.statSync(configPath);
  if (cachedConfig && cachedConfigPath === configPath && stat.mtimeMs === cachedMtime) {
    return cachedConfig;
  }

  const parsed = parseTokenOptimizerYaml(fs.readFileSync(configPath, "utf8"));
  const merged: TokenOptimizerConfig = {
    enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
    ghostHunter: { ...DEFAULT_CONFIG.ghostHunter, ...(parsed.ghostHunter ?? {}) },
    headroom: { ...DEFAULT_CONFIG.headroom, ...(parsed.headroom ?? {}) },
    budgets: { ...DEFAULT_CONFIG.budgets, ...(parsed.budgets ?? {}) },
  };

  cachedConfig = merged;
  cachedConfigPath = configPath;
  cachedMtime = stat.mtimeMs;
  return merged;
}

function applyCharBudget(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n...(truncated by harness token budget)`,
    truncated: true,
  };
}

export type ContextBlockKind =
  | "reflection_transcript"
  | "reflection_lessons"
  | "reflection_goals"
  | "subagent_prompt"
  | "generic";

function budgetForKind(kind: ContextBlockKind, cfg: TokenOptimizerConfig): number {
  switch (kind) {
    case "reflection_transcript":
      return cfg.budgets.reflectionTranscript;
    case "reflection_lessons":
      return cfg.budgets.reflectionLessons;
    case "reflection_goals":
      return cfg.budgets.reflectionGoals;
    case "subagent_prompt":
      return cfg.budgets.subagentPrompt;
    default:
      return cfg.budgets.subagentPrompt;
  }
}

export async function optimizeContextBlock(
  text: string,
  kind: ContextBlockKind,
  configDir: string,
): Promise<OptimizeContextResult> {
  const cfg = loadTokenOptimizerConfig(configDir);
  const charsBefore = text.length;
  const tokensBefore = Math.ceil(charsBefore / 4);

  if (!cfg.enabled || !text.trim()) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      tokensBefore,
      tokensAfter: tokensBefore,
      ghostsRemoved: 0,
      headroomBackend: "disabled",
      headroomTransform: "none",
      truncated: false,
    };
  }

  const ghost = huntGhostTokens(text, cfg.ghostHunter);
  const headroom = await compressWithHeadroom(ghost.text, cfg.headroom);
  const budgeted = applyCharBudget(headroom.text, budgetForKind(kind, cfg));
  const tokensAfter = Math.ceil(budgeted.text.length / 4);

  return {
    text: budgeted.text,
    charsBefore,
    charsAfter: budgeted.text.length,
    tokensBefore,
    tokensAfter,
    ghostsRemoved: ghost.ghostsRemoved,
    headroomBackend: headroom.backend,
    headroomTransform: headroom.transform,
    truncated: budgeted.truncated,
  };
}

export function formatOptimizerStats(
  label: string,
  result: OptimizeContextResult,
): string {
  const saved = result.tokensBefore - result.tokensAfter;
  const pct =
    result.tokensBefore > 0
      ? Math.round((saved / result.tokensBefore) * 100)
      : 0;
  return [
    `${label}: ${result.tokensBefore}→${result.tokensAfter} tok (-${pct}%)`,
    `ghosts=${result.ghostsRemoved}`,
    `headroom=${result.headroomBackend}/${result.headroomTransform}`,
    result.truncated ? "budget_truncated" : "budget_ok",
  ].join(" ");
}
