import type { StreamEvent } from "./types.js";

/** Collect assistant text deltas from a run stream for TUI display. */
export function textFromStreamEvent(event: StreamEvent): string {
  if (event.type === "assistant") {
    let out = "";
    for (const block of event.message.content) {
      if (block.type === "text") {
        out += block.text;
      }
    }
    return out;
  }
  return "";
}
