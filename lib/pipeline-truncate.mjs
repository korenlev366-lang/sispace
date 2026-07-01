/** Max chars sent on SSE / stored in SQLite per assistant step (keeps Rust + webview alive). */
export const PIPELINE_MESSAGE_MAX = 20_000;

/** Max chars of each prior step included in the next specialist prompt. */
export const PIPELINE_PROMPT_PRIOR_MAX = 8_000;

/**
 * Truncate at a UTF-8 code point boundary.
 * @param {string} text
 * @param {number} max
 */
export function truncateUtf8(text, max) {
  if (!text || text.length <= max) return text ?? "";
  let end = max;
  while (end > 0 && (text.charCodeAt(end) & 0xfc00) === 0xdc00) {
    end -= 1;
  }
  const omitted = text.length - end;
  return `${text.slice(0, end)}\n\n…(truncated, ${omitted} more chars)…`;
}
