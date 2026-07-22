/**
 * Which LLM backends support pipeline subagents.
 */

import type { BackendName } from "../config/user-settings.js";

/** All interactive backends support planning + executing pipeline subagents. */
export function supportsSubagents(backend: BackendName): boolean {
  return (
    backend === "openrouter" ||
    backend === "compatible" ||
    backend === "cursor"
  );
}

export function subagentsUnsupportedMessage(backend: string): string {
  return `subagents not supported for backend "${backend}"`;
}
