import { getCliOptions } from "../runtime/cli-options.js";
import type { CliSession } from "../session/types.js";
import { launchReflectChain } from "./invoke-chain.js";
import {
  triggerAutoExtractOnSessionEnd,
  type AutoExtractResult,
} from "../memory/auto-extract.js";
import type { PendingSkillDraft } from "../memory/pending-skills.js";

const reflectedSessionIds = new Set<string>();

/**
 * Fire-and-forget post-task chain on session end (Phase 1a).
 * Logs to harness/reports/post-task-chain.log via post-task-chain.js.
 * Also schedules Qwen-style .cursorsi/ memory + auto-skill extract.
 */
export function triggerAutoReflectOnSessionEnd(
  session: CliSession,
  opts?: {
    onNotice?: (line: string) => void;
    onPendingSkills?: (skills: PendingSkillDraft[]) => void;
    onExtractDone?: (result: AutoExtractResult) => void;
  },
): void {
  if (getCliOptions().noReflect) {
    opts?.onExtractDone?.({ launched: false, skipped: "no_reflect" });
    return;
  }
  if (reflectedSessionIds.has(session.id)) {
    opts?.onExtractDone?.({ launched: false, skipped: "already_reflected" });
    return;
  }
  reflectedSessionIds.add(session.id);
  launchReflectChain({ session, background: true });
  triggerAutoExtractOnSessionEnd(session, {
    onNotice: opts?.onNotice,
    onPendingSkills: opts?.onPendingSkills,
    onDone: opts?.onExtractDone,
  });
}
