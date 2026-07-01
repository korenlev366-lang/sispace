import { parseCliArgs, setCliOptions } from "./cli-options.js";
import { getHandoffAttachId } from "../handoff/cli.js";
import {
  handoffToSessionState,
  loadHandoffBlob,
} from "../handoff/io.js";
import { buildResumeSessionState } from "../session/resume.js";
import type { SessionState } from "../session/types.js";

/** Parse CLI flags; resume/handoff attach loads session state. */
export async function initCliRuntime(
  argv: string[],
  cwd: string,
): Promise<SessionState | undefined> {
  const opts = parseCliArgs(argv);
  setCliOptions(opts);

  const attachId = opts.handoffAttachId ?? getHandoffAttachId();
  if (attachId) {
    const loaded = loadHandoffBlob(attachId, cwd);
    if (!loaded.ok || !loaded.blob) {
      console.error(`cursorsi handoff attach failed: ${loaded.error}`);
      process.exit(1);
    }
    return handoffToSessionState(loaded.blob);
  }

  if (!opts.resumeTaskId) {
    return undefined;
  }
  const result = await buildResumeSessionState(opts.resumeTaskId, cwd);
  if (!result.ok || !result.state) {
    console.error(`cursorsi resume failed: ${result.error ?? "unknown"}`);
    process.exit(1);
  }
  return result.state;
}
