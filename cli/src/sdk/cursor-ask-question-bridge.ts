/**
 * Bridge Cursor SDK AskQuestion → SISpace QuestionPicker.
 *
 * Fact check (2026-07):
 * - Cursor IDE / CLI ACP expose AskQuestion (`cursor/ask_question` over ACP).
 * - `@cursor/sdk` local runs auto-reject AskQuestion:
 *   "Interactive questions are not supported in local SDK runs"
 * - AskQuestion tool calls are also filtered out of onDelta updates.
 * - There is no public AgentOptions interactionListener hook.
 *
 * We load a patched copy of the SDK bundle that delegates
 * askQuestionInteractionQuery to this bridge, which pauses on askUser().
 */

import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { askUser } from "../tools/ask-user.js";

const REJECT_REASON = "Interactive questions are not supported in local SDK runs";
const PATCH_MARKER = "__cursorsiAskQuestion";
/** Marker injected before shell-state fd writes so EPIPE cannot crash the process. */
const SHELL_EPIPE_MARKER = "__cursorsiShellEpipeGuard";

const ORIGINAL_CASE =
  'case"askQuestionInteractionQuery":return Responses.askQuestion(e.id,new ask_question_tool_pb.tz({result:{case:"rejected",value:new ask_question_tool_pb.ox({reason:"Interactive questions are not supported in local SDK runs"})}}));';

const PATCHED_CASE =
  'case"askQuestionInteractionQuery":return(typeof globalThis.__cursorsiAskQuestion==="function"?globalThis.__cursorsiAskQuestion(e,Responses,ask_question_tool_pb):Responses.askQuestion(e.id,new ask_question_tool_pb.tz({result:{case:"rejected",value:new ask_question_tool_pb.ox({reason:"Interactive questions are not supported in local SDK runs"})}})));';

/**
 * BashState / ZshState / similar write persisted shell state to stdio[3]
 * without an 'error' listener. If the child exits first, Node emits
 * uncaught `write EPIPE` and crash handlers kill the whole TUI.
 */
const SHELL_STATE_WRITE_RE =
  /(\w+)\?\.write\(this\.state\),\1\?\.end\(\)/g;

function applyShellStateEpipeGuard(source: string): string {
  if (source.includes(SHELL_EPIPE_MARKER)) {
    return source;
  }
  SHELL_STATE_WRITE_RE.lastIndex = 0;
  return source.replace(
    SHELL_STATE_WRITE_RE,
    `$1?.on("error",()=>{/*${SHELL_EPIPE_MARKER}*/}),$1?.write(this.state),$1?.end()`,
  );
}

type CursorOption = { id?: string; label?: string };
type CursorQuestion = {
  id?: string;
  prompt?: string;
  options?: CursorOption[];
  allowMultiple?: boolean;
};
type CursorAskArgs = {
  title?: string;
  questions?: CursorQuestion[];
};

type InteractionQuery = {
  id: string;
  query: {
    case?: string;
    value?: { args?: CursorAskArgs; toolCallId?: string };
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResponsesApi = { askQuestion: (id: string, result: unknown) => any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AskQuestionPb = {
  tz: { new (init?: unknown): unknown; fromJson?: (json: unknown) => unknown };
  ox: { new (init?: unknown): unknown };
};

function isSkipMarker(answer: string): boolean {
  return (
    answer.startsWith("(") &&
    answer.endsWith(")") &&
    (answer.includes("cancel") ||
      answer.includes("skip") ||
      answer.includes("no UI") ||
      answer.includes("superseded") ||
      answer.includes("failed"))
  );
}

function buildSuccessResult(pb: AskQuestionPb, answers: Array<{
  questionId: string;
  selectedOptionIds: string[];
  freeformText: string;
}>): unknown {
  const json = {
    success: {
      answers: answers.map((a) => ({
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        freeformText: a.freeformText,
      })),
    },
  };
  if (typeof pb.tz.fromJson === "function") {
    return pb.tz.fromJson(json);
  }
  return new pb.tz({
    result: {
      case: "success",
      value: { answers },
    },
  });
}

/**
 * Called from the patched SDK when AskQuestion fires.
 * Must stay compatible with the minified call site:
 *   globalThis.__cursorsiAskQuestion(e, Responses, ask_question_tool_pb)
 */
export async function handleCursorAskQuestionInteraction(
  interaction: InteractionQuery,
  Responses: ResponsesApi,
  pb: AskQuestionPb,
): Promise<unknown> {
  const args = interaction.query?.value?.args;
  const questions = Array.isArray(args?.questions) ? args!.questions! : [];
  const title = (args?.title ?? "").trim();

  if (questions.length === 0) {
    const prompt = title || "Cursor asked a question with no prompt.";
    const answer = await askUser({ prompt });
    if (isSkipMarker(answer)) {
      return Responses.askQuestion(
        interaction.id,
        new pb.tz({
          result: {
            case: "rejected",
            value: new pb.ox({ reason: answer.replace(/^\(|\)$/g, "") }),
          },
        }),
      );
    }
    return Responses.askQuestion(
      interaction.id,
      buildSuccessResult(pb, [
        {
          questionId: "q0",
          selectedOptionIds: [],
          freeformText: answer,
        },
      ]),
    );
  }

  const answers: Array<{
    questionId: string;
    selectedOptionIds: string[];
    freeformText: string;
  }> = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const qid = (q.id ?? `q${i}`).trim() || `q${i}`;
    const promptBase = (q.prompt ?? "").replace(/\s+/g, " ").trim() || "Choose an option:";
    const prompt =
      title && questions.length > 1
        ? `${title} (${i + 1}/${questions.length}): ${promptBase}`
        : title && questions.length === 1
          ? title === promptBase
            ? promptBase
            : `${title} — ${promptBase}`
          : promptBase;

    const options = (q.options ?? [])
      .map((o) => String(o.label ?? o.id ?? "").trim())
      .filter(Boolean)
      .slice(0, 8);

    const answer = await askUser({
      prompt,
      ...(options.length > 0 ? { options } : {}),
    });

    if (isSkipMarker(answer)) {
      return Responses.askQuestion(
        interaction.id,
        new pb.tz({
          result: {
            case: "rejected",
            value: new pb.ox({ reason: answer.replace(/^\(|\)$/g, "") }),
          },
        }),
      );
    }

    const matched = (q.options ?? []).find(
      (o) => o.label === answer || o.id === answer,
    );
    if (matched?.id) {
      answers.push({
        questionId: qid,
        selectedOptionIds: [matched.id],
        freeformText: "",
      });
    } else {
      answers.push({
        questionId: qid,
        selectedOptionIds: [],
        freeformText: answer,
      });
    }
  }

  return Responses.askQuestion(interaction.id, buildSuccessResult(pb, answers));
}

export function installCursorAskQuestionHook(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[PATCH_MARKER] = handleCursorAskQuestionInteraction;
}

/**
 * Produce a patched SDK entry path (does not mutate the vendor file).
 *
 * Must stay a *sibling* of the vendor `index.js`. The SDK webpack runtime
 * resolves lazy chunks as `./${id}.index.js` relative to the entry module, so
 * writing into a subdirectory (e.g. `.cursorsi-patched/index.js`) breaks
 * imports like `642.index.js` and surfaces as "Cursor model list unavailable".
 */
export function ensurePatchedCursorSdkPath(sdkEntryPath: string): string {
  if (!existsSync(sdkEntryPath)) {
    throw new Error(`Cursor SDK not found at ${sdkEntryPath}`);
  }

  const sdkDir = dirname(sdkEntryPath);
  const stem = basename(sdkEntryPath, ".js");
  const outPath = join(sdkDir, `${stem}.cursorsi-patched.js`);
  // Legacy layout (subdir) broke relative chunk resolution — remove if present.
  const legacyDir = join(sdkDir, ".cursorsi-patched");
  if (existsSync(legacyDir)) {
    try {
      rmSync(legacyDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; patched sibling path is what matters.
    }
  }

  const srcStat = statSync(sdkEntryPath);

  if (existsSync(outPath)) {
    const outStat = statSync(outPath);
    const outSrc = readFileSync(outPath, "utf8");
    if (
      outStat.mtimeMs >= srcStat.mtimeMs &&
      outSrc.includes(PATCH_MARKER) &&
      outSrc.includes(REJECT_REASON) &&
      outSrc.includes(SHELL_EPIPE_MARKER)
    ) {
      return outPath;
    }
  }

  const source = readFileSync(sdkEntryPath, "utf8");
  const canAskPatch =
    source.includes(ORIGINAL_CASE) || source.includes(PATCH_MARKER);
  const canShellPatch =
    SHELL_STATE_WRITE_RE.test(source) || source.includes(SHELL_EPIPE_MARKER);
  // Reset lastIndex after .test() on a global regex.
  SHELL_STATE_WRITE_RE.lastIndex = 0;

  if (!canAskPatch && !canShellPatch) {
    // SDK shape changed — fall back to unpatched.
    return sdkEntryPath;
  }

  let patched = source;
  if (canAskPatch && !patched.includes(PATCHED_CASE)) {
    patched = patched.replace(ORIGINAL_CASE, PATCHED_CASE);
  }
  patched = applyShellStateEpipeGuard(patched);

  if (!patched.includes(PATCH_MARKER) && !patched.includes(SHELL_EPIPE_MARKER)) {
    return sdkEntryPath;
  }

  writeFileSync(outPath, patched, "utf8");
  return outPath;
}
