/**
 * Token counter using tiktoken (JS/WASM BPE tokenizer).
 * Counts tokens for any text using cl100k_base by default,
 * or a model-specific encoding via encoding_for_model.
 *
 * Falls back to the old chars/3 heuristic if tiktoken fails to load.
 */

import { get_encoding, encoding_for_model, type Tiktoken } from "tiktoken";

const FALLBACK_CHARS_PER_TOKEN = 3;

let defaultEncoder: Tiktoken | null = null;
let fallbackActive = false;

/**
 * Get or create a singleton cl100k_base encoder.
 * Returns null if tiktoken fails, triggering the fallback.
 */
function getDefaultEncoder(): Tiktoken | null {
  if (fallbackActive) return null;
  if (defaultEncoder) return defaultEncoder;
  try {
    defaultEncoder = get_encoding("cl100k_base");
    return defaultEncoder;
  } catch {
    fallbackActive = true;
    return null;
  }
}

/**
 * Count tokens in text using the default cl100k_base encoding.
 * Falls back to text.length / 3 if tiktoken is unavailable.
 */
export function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const enc = getDefaultEncoder();
  if (!enc) {
    return Math.max(1, Math.floor(trimmed.length / FALLBACK_CHARS_PER_TOKEN));
  }

  try {
    const tokens = enc.encode(trimmed);
    return tokens.length;
  } catch {
    return Math.max(1, Math.floor(trimmed.length / FALLBACK_CHARS_PER_TOKEN));
  }
}

/**
 * Count tokens using a model-specific encoder.
 * Falls back to countTokens() if the model isn't recognized.
 */
export function countTokensForModel(text: string, model: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  if (fallbackActive) {
    return countTokens(text);
  }

  let modelEnc: Tiktoken | null = null;
  try {
    // Use type assertion — encoding_for_model throws for unknown models,
    // and the catch block falls back to the default estimator
    modelEnc = (encoding_for_model as (model: string) => Tiktoken)(model);
    const tokens = modelEnc.encode(trimmed);
    return tokens.length;
  } catch {
    // Model not in tiktoken registry — fall back to default
    return countTokens(text);
  } finally {
    modelEnc?.free();
  }
}

/**
 * Estimate output tokens from generated text.
 * Output tokens (especially code) are denser than input tokens.
 * Uses tiktoken when available, falls back to chars/3.
 */
export function countOutputTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const enc = getDefaultEncoder();
  if (!enc) {
    return Math.max(1, Math.floor(trimmed.length / FALLBACK_CHARS_PER_TOKEN));
  }

  try {
    const tokens = enc.encode(trimmed);
    return Math.max(1, tokens.length);
  } catch {
    return Math.max(1, Math.floor(trimmed.length / FALLBACK_CHARS_PER_TOKEN));
  }
}

/**
 * Free the singleton encoder. Used in tests.
 */
export function resetTokenCounter(): void {
  if (defaultEncoder) {
    defaultEncoder.free();
    defaultEncoder = null;
  }
  fallbackActive = false;
}