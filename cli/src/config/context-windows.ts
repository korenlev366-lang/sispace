/**
 * Model-specific context window sizes for known OpenRouter models.
 *
 * When the session's model is found in this registry, the effective
 * compaction budget is: modelContextWindow × compactRatio − reserveTokens.
 * Unknown models fall back to the static context_window from sispace.yaml
 * (default 200k).
 *
 * Sources:
 *   DeepSeek:   https://api-docs.deepseek.com/quick_start/pricing
 *   OpenAI:     https://platform.openai.com/docs/models
 *   Anthropic:  https://docs.anthropic.com/en/docs/about-claude/models
 *   Google:     https://ai.google.dev/gemini-api/docs/models
 *   NEX:        https://nex-agi.com/docs/models
 *   Meta:       https://llama.meta.com/docs/model-cards-and-prompt-formats
 *   Mistral:    https://docs.mistral.ai/getting-started/models/
 *   Cohere:     https://docs.cohere.com/docs/models
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // ── DeepSeek ──────────────────────────────────────────────────────────
  "deepseek/deepseek-v4-flash": 1_000_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "deepseek/deepseek-chat": 64_000,
  "deepseek/deepseek-coder": 128_000,
  "deepseek/deepseek-r1": 1_000_000,

  // ── OpenAI ────────────────────────────────────────────────────────────
  "openai/gpt-4o": 128_000,
  "openai/gpt-4o-mini": 128_000,
  "openai/gpt-4o-2024-08-06": 128_000,
  "openai/gpt-4o-mini-2024-07-18": 128_000,
  "openai/o1": 200_000,
  "openai/o1-mini": 128_000,
  "openai/o3-mini": 200_000,
  "openai/gpt-4.1": 1_000_000,
  "openai/gpt-4.1-mini": 1_000_000,
  "openai/gpt-4.1-nano": 1_000_000,
  "openai/gpt-4": 8_192,
  "openai/gpt-4-turbo": 128_000,
  "openai/gpt-3.5-turbo": 16_385,

  // ── Anthropic ─────────────────────────────────────────────────────────
  "anthropic/claude-sonnet-4.6": 200_000,
  "anthropic/claude-sonnet-4": 200_000,
  "anthropic/claude-opus-4": 200_000,
  "anthropic/claude-haiku-4": 200_000,
  "anthropic/claude-3.5-sonnet": 200_000,
  "anthropic/claude-3-sonnet": 200_000,
  "anthropic/claude-3-haiku": 200_000,
  "anthropic/claude-3-opus": 200_000,
  "anthropic/claude-2": 100_000,
  "anthropic/claude-instant-1": 100_000,

  // ── Google / Gemini ──────────────────────────────────────────────────
  "google/gemini-2.0-flash-001": 1_000_000,
  "google/gemini-2.0-flash": 1_000_000,
  "google/gemini-2.5-pro": 1_000_000,
  "google/gemini-2.5-flash": 1_000_000,
  "google/gemini-2.0-pro": 1_000_000,
  "google/gemini-1.5-pro": 2_000_000,
  "google/gemini-1.5-flash": 1_000_000,

  // ── NEX ───────────────────────────────────────────────────────────────
  "nex-agi/nex-n2-pro": 262_144,
  "nex-agi/nex-n2-pro:free": 262_144,
  "nex-agi/nex-n1": 128_000,

  // ── Meta / Llama ──────────────────────────────────────────────────────
  "meta-llama/llama-4-scout": 256_000,
  "meta-llama/llama-4-maverick": 256_000,
  "meta-llama/llama-3.3-70b": 128_000,
  "meta-llama/llama-3.2-90b": 128_000,
  "meta-llama/llama-3.2-11b": 128_000,
  "meta-llama/llama-3.1-405b": 128_000,
  "meta-llama/llama-3.1-70b": 128_000,
  "meta-llama/llama-3.1-8b": 128_000,

  // ── Mistral ──────────────────────────────────────────────────────────
  "mistralai/mistral-large": 128_000,
  "mistralai/mistral-small": 32_000,
  "mistralai/mistral-7b": 8_000,
  "mistralai/codestral": 32_000,
  "mistralai/mixtral-8x22b": 64_000,

  // ── Cohere ────────────────────────────────────────────────────────────
  "cohere/command-r-plus": 128_000,
  "cohere/command-r": 128_000,
};

/**
 * Look up a model's native context window size.
 *
 * @param modelId — Full OpenRouter model id (e.g. "deepseek/deepseek-v4-flash")
 * @returns The context window size in tokens, or `undefined` if unknown.
 */
export function getModelContextWindow(modelId: string): number | undefined {
  const trimmed = modelId.trim();

  // Exact match first
  if (MODEL_CONTEXT_WINDOWS[trimmed]) {
    return MODEL_CONTEXT_WINDOWS[trimmed];
  }

  // Try partial match: match on the part after the first "/"
  // e.g. "deepseek/deepseek-v4-flash:free" → matches "deepseek/deepseek-v4-flash"
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx >= 0) {
    const withoutPrefix = trimmed.slice(slashIdx + 1);
    // Check if the base model (without :suffix) is in the map
    const baseModel = trimmed.includes(":") ? trimmed.slice(0, trimmed.indexOf(":")) : "";
    if (baseModel && MODEL_CONTEXT_WINDOWS[baseModel]) {
      return MODEL_CONTEXT_WINDOWS[baseModel];
    }
    // Try matching without version suffixes
    for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      if (key.startsWith(baseModel || trimmed) || baseModel.startsWith(key)) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Compute the effective compaction budget for a given model and config.
 *
 * For known models:  modelContextWindow × compactRatio − reserveTokens
 * For unknown models: config.contextWindow (static fallback) − reserveTokens
 *
 * The result is bounded to [1, modelContextWindow] and floored to integer.
 */
export function getCompactBudget(
  modelId: string,
  config: { contextWindow: number; compactRatio: number; reserveTokens: number },
): number {
  const modelWindow = getModelContextWindow(modelId);

  if (modelWindow !== undefined) {
    // Known model — use ratio of its actual context window
    const budget = Math.floor(modelWindow * config.compactRatio);
    return Math.max(1, Math.min(budget, modelWindow) - config.reserveTokens);
  }

  // Unknown model — fall back to static config context window
  return Math.max(1, config.contextWindow - config.reserveTokens);
}