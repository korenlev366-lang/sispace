import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PipelineTier = "one-shot" | "two-step" | "full";

export interface ModelTiers {
  cheap: string;
  standard: string;
  reasoning: string;
}

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const DEFAULT_TIERS: ModelTiers = {
  cheap: DEFAULT_MODEL,
  standard: DEFAULT_MODEL,
  reasoning: "deepseek/deepseek-v4-pro",
};

function yamlScalar(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

/** Load models from config/sispace.yaml (default / cheap / reasoning). */
export function loadModelTiers(projectRoot: string): ModelTiers {
  const path = join(projectRoot, "config", "sispace.yaml");
  if (!existsSync(path)) {
    return { ...DEFAULT_TIERS };
  }

  const tiers = { ...DEFAULT_TIERS };
  let inModels = false;
  let inTiers = false;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "models:") {
      inModels = true;
      inTiers = false;
      continue;
    }
    if (inModels && trimmed === "tiers:") {
      inTiers = true;
      continue;
    }
    if (inTiers && trimmed.endsWith(":") && !line.startsWith("    ") && trimmed !== "tiers:") {
      break;
    }
    if (inModels && !inTiers && trimmed.endsWith(":") && !line.startsWith("  ") && trimmed !== "models:") {
      inModels = false;
    }
    if (!inModels) continue;

    if (inTiers) {
      if (trimmed.startsWith("cheap:")) {
        tiers.cheap = yamlScalar(trimmed.slice("cheap:".length)) || tiers.cheap;
      } else if (trimmed.startsWith("standard:")) {
        tiers.standard = yamlScalar(trimmed.slice("standard:".length)) || tiers.standard;
      } else if (trimmed.startsWith("reasoning:")) {
        tiers.reasoning = yamlScalar(trimmed.slice("reasoning:".length)) || tiers.reasoning;
      }
      continue;
    }

    if (trimmed.startsWith("default:")) {
      tiers.standard = yamlScalar(trimmed.slice("default:".length)) || tiers.standard;
    } else if (trimmed.startsWith("cheap:")) {
      tiers.cheap = yamlScalar(trimmed.slice("cheap:".length)) || tiers.cheap;
    } else if (trimmed.startsWith("reasoning:")) {
      tiers.reasoning = yamlScalar(trimmed.slice("reasoning:".length)) || tiers.reasoning;
    }
  }

  return tiers;
}

export function modelForTier(tier: PipelineTier, tiers: ModelTiers): string {
  if (tier === "one-shot") return tiers.cheap;
  if (tier === "two-step") return tiers.standard;
  return tiers.reasoning;
}

/** Trim specialist sequence by classified tier (checker steps added separately). */
export function resolveTierSequence(
  taskType: "feature" | "bug" | "docs",
  tier: PipelineTier,
  fullSequence: readonly string[],
): string[] {
  if (tier === "full") {
    return [...fullSequence];
  }

  if (taskType === "feature") {
    if (tier === "one-shot") return ["coder-agent"];
    return ["researcher-agent", "coder-agent"];
  }

  if (taskType === "bug") {
    if (tier === "one-shot") return ["coder-agent"];
    return ["researcher-agent", "coder-agent"];
  }

  // docs
  if (tier === "one-shot") return ["documenter-agent"];
  return ["researcher-agent", "documenter-agent"];
}
