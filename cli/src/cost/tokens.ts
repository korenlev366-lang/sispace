/**
 * Token proxy: estimate output tokens from generated text.
 * Uses tiktoken (cl100k_base) when available, falls back to chars/3.
 * Note: the API returns real completion_tokens after each agent turn;
 * this is only used as a fallback when the API doesn't report token usage.
 */
import { countOutputTokens } from "./token-counter.js";

export function estimateOutputTokensFromText(text: string): number {
  return countOutputTokens(text);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
