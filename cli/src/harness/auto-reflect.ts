import { getCliOptions } from "../runtime/cli-options.js";
import type { CliSession } from "../session/types.js";
import { launchReflectChain } from "./invoke-chain.js";
import { triggerAutoExtractOnSessionEnd } from "../memory/auto-extract.js";

const reflectedSessionIds = new Set<string>();

/**
 * Fire-and-forget post-task chain on session end (Phase 1a).
 * Logs to harness/reports/post-task-chain.log via post-task-chain.js.
 * Also schedules Qwen-style .cursorsi/ memory + auto-skill extract.
 */
export function triggerAutoReflectOnSessionEnd(
  session: CliSession,
  opts?: { onNotice?: (line: string) => void },
): void {
  if (getCliOptions().noReflect) {
    return;
  }
  if (reflectedSessionIds.has(session.id)) {
    return;
  }
  reflectedSessionIds.add(session.id);
  launchReflectChain({ session, background: true });
  triggerAutoExtractOnSessionEnd(session, { onNotice: opts?.onNotice });
}
