/**
 * Agent → user clarification bridge.
 * `ask_user` tool awaits a deferred promise; the TUI opens QuestionPicker
 * under the prompt (same placement as PlanPicker) and resolves the answer.
 */

export interface AgentQuestion {
  id: string;
  /** Question text shown to the user. */
  prompt: string;
  /** Optional multiple-choice options. */
  options?: string[];
}

type PendingAsk = {
  question: AgentQuestion;
  resolve: (answer: string) => void;
};

let pending: PendingAsk | null = null;
let onAskHandler: ((question: AgentQuestion) => void) | null = null;
/** When true (pane/headless / no UI), auto-answer without blocking. */
let headlessMode = false;

function newQuestionId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function setAskUserHandler(
  handler: ((question: AgentQuestion) => void) | null,
): void {
  onAskHandler = handler;
}

export function setAskUserHeadless(enabled: boolean): void {
  headlessMode = enabled;
}

export function getPendingAsk(): AgentQuestion | null {
  return pending?.question ?? null;
}

/**
 * Called from the ask_user tool execute path.
 * Pauses the agent turn until answerAskUser / cancelAskUser.
 */
export function askUser(input: {
  prompt: string;
  options?: string[];
}): Promise<string> {
  const prompt = input.prompt.replace(/\s+/g, " ").trim();
  if (!prompt) {
    return Promise.resolve("(empty question — skipped)");
  }

  const options = (input.options ?? [])
    .map((o) => String(o).trim())
    .filter(Boolean)
    .slice(0, 8);

  const question: AgentQuestion = {
    id: newQuestionId(),
    prompt,
    ...(options.length > 0 ? { options } : {}),
  };

  // Headless / no UI: non-blocking fallback (first option or skip marker).
  if (headlessMode || !onAskHandler) {
    if (options.length > 0) {
      return Promise.resolve(options[0]!);
    }
    return Promise.resolve("(no UI — question skipped)");
  }

  return new Promise<string>((resolve) => {
    if (pending) {
      // Supersede — prior ask gets a cancel marker so the tool loop can continue.
      const old = pending;
      pending = null;
      old.resolve("(superseded by a newer question)");
    }
    pending = { question, resolve };
    try {
      onAskHandler!(question);
    } catch {
      pending = null;
      resolve("(failed to open question UI)");
    }
  });
}

/** Resolve the pending question with the user's answer. */
export function answerAskUser(answer: string): boolean {
  if (!pending) return false;
  const text = answer.replace(/\s+/g, " ").trim();
  if (!text) return false;
  const p = pending;
  pending = null;
  p.resolve(text);
  return true;
}

/** Cancel / dismiss the pending question (still resolves so the turn can finish). */
export function cancelAskUser(reason = "cancelled by user"): boolean {
  if (!pending) return false;
  const p = pending;
  pending = null;
  p.resolve(`(${reason})`);
  return true;
}
