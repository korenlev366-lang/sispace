/** Canonical default OpenRouter model id. */
export const DEFAULT_MODEL_ID = "deepseek/deepseek-v4-flash";

/** Legacy stored id — pass through to OpenRouter as-is or map to default. */
export const LEGACY_COMPOSER_25_FAST_ID = "composer-2.5-fast";
export const COMPOSER_25_ID = "composer-2.5";

const LEGACY_TO_OPENROUTER: Record<string, string> = {
  "composer-2.5": DEFAULT_MODEL_ID,
  "composer-2.5-fast": DEFAULT_MODEL_ID,
  "composer-2": DEFAULT_MODEL_ID,
  default: DEFAULT_MODEL_ID,
};

/**
 * Map a stored model id string to an OpenRouter model slug.
 * Unknown ids pass through unchanged (--model flag passes through directly).
 */
export function modelIdToSelection(modelId: string | null | undefined): string {
  const raw = modelId?.trim();
  if (!raw) {
    return DEFAULT_MODEL_ID;
  }
  return LEGACY_TO_OPENROUTER[raw] ?? raw;
}
