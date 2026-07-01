import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelListItem, ModelParameterDefinition } from "../sdk/types.js";

export interface ModelConfig {
  default: string;
  reasoning: string;
  cheap: string;
}

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const DEFAULT_MODELS: ModelConfig = {
  default: DEFAULT_MODEL,
  reasoning: "deepseek/deepseek-v4-pro",
  cheap: DEFAULT_MODEL,
};

function yamlScalar(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

/** Load models.default / reasoning / cheap from config/sispace.yaml. */
export function loadModelConfig(projectRoot: string): ModelConfig {
  const path = join(projectRoot, "config", "sispace.yaml");
  if (!existsSync(path)) {
    return { ...DEFAULT_MODELS };
  }

  const models = { ...DEFAULT_MODELS };
  let inModels = false;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "models:") {
      inModels = true;
      continue;
    }
    if (inModels && trimmed.endsWith(":") && !line.startsWith("  ") && trimmed !== "models:") {
      break;
    }
    if (!inModels) continue;

    if (trimmed.startsWith("default:")) {
      models.default = yamlScalar(trimmed.slice("default:".length)) || models.default;
    } else if (trimmed.startsWith("reasoning:")) {
      models.reasoning = yamlScalar(trimmed.slice("reasoning:".length)) || models.reasoning;
    } else if (trimmed.startsWith("cheap:")) {
      models.cheap = yamlScalar(trimmed.slice("cheap:".length)) || models.cheap;
    }
  }

  return models;
}

/**
 * Extra model IDs to include in the catalog beyond default/reasoning/cheap.
 * These are static model IDs that should always appear in the model picker.
 */
const EXTRA_MODEL_IDS: string[] = ["nex-agi/nex-n2-pro:free"];

/**
 * Known model-specific parameter definitions.
 * These surface in the ModelPicker UI so users can tune e.g. reasoning_effort.
 */
const KNOWN_MODEL_PARAMS: Record<string, ModelParameterDefinition[]> = {
  // DeepSeek v4 Flash — supports reasoning_effort for optional chain-of-thought
  "deepseek/deepseek-v4-flash": [
    {
      id: "reasoning_effort",
      displayName: "Reasoning effort",
      values: [
        { value: "high", displayName: "High" },
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "xhigh", displayName: "Extra high" },
        { value: "max", displayName: "Max" },
      ],
    },
  ],
  // DeepSeek v4 Pro — full reasoning model with effort levels
  "deepseek/deepseek-v4-pro": [
    {
      id: "reasoning_effort",
      displayName: "Reasoning effort",
      values: [
        { value: "high", displayName: "High" },
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "xhigh", displayName: "Extra high" },
        { value: "minimal", displayName: "Minimal" },
        { value: "max", displayName: "Max" },
      ],
    },
  ],
  // NEX N2 Pro — reasoning model with effort levels and thinking toggle
  "nex-agi/nex-n2-pro:free": [
    {
      id: "reasoning_effort",
      displayName: "Reasoning effort",
      values: [
        { value: "high", displayName: "High" },
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "xhigh", displayName: "Extra high" },
        { value: "max", displayName: "Max" },
      ],
    },
    {
      id: "thinking",
      displayName: "Thinking",
      values: [
        { value: "false", displayName: "Off" },
        { value: "true", displayName: "On" },
      ],
    },
  ],
};

/** Static OpenRouter catalog entries derived from config. */
export function modelCatalogFromConfig(projectRoot: string): ModelListItem[] {
  const cfg = loadModelConfig(projectRoot);
  const ids = [...new Set([cfg.default, cfg.reasoning, cfg.cheap, ...EXTRA_MODEL_IDS])];
  return ids.map((id) => ({
    id,
    displayName: id.split("/").pop() ?? id,
    description: "OpenRouter model (config/sispace.yaml)",
    parameters: KNOWN_MODEL_PARAMS[id],
  }));
}

export function modelIdsFromConfig(projectRoot: string): Set<string> {
  return new Set(modelCatalogFromConfig(projectRoot).map((m) => m.id));
}
