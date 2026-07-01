/** @typedef {{ id: string, params?: Array<{ id: string, value: string }> }} ModelSelection */

export const DEFAULT_MODEL_ID = "deepseek/deepseek-v4-flash";
export const COMPOSER_25_ID = "composer-2.5";
export const LEGACY_COMPOSER_25_FAST_ID = "composer-2.5-fast";

const LEGACY_TO_OPENROUTER = {
  "composer-2.5": DEFAULT_MODEL_ID,
  "composer-2.5-fast": DEFAULT_MODEL_ID,
  "composer-2": DEFAULT_MODEL_ID,
  default: DEFAULT_MODEL_ID,
};

/**
 * Map stored model id to OpenRouter model slug (wrapped as { id } for pipeline callers).
 * @param {string | null | undefined} modelId
 * @returns {ModelSelection}
 */
export function modelIdToSelection(modelId) {
  const raw = modelId?.trim();
  if (!raw) {
    return { id: DEFAULT_MODEL_ID };
  }
  const mapped = LEGACY_TO_OPENROUTER[raw] ?? raw;
  return { id: mapped };
}
