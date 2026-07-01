/**
 * Dynamic reasoning_effort selection based on task type.
 * Classifies a user message by keyword patterns and returns
 * the appropriate reasoning effort level for DeepSeek Pro.
 */

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

/** Matched keyword group name, used for logging. */
export type EffortMatchKind =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "default";

const CLASSIFIERS: Array<{
  level: ReasoningEffort;
  keywords: string[];
}> = [
  {
    level: "xhigh",
    keywords: [
      "design",
      "architect",
      "plan",
      "redesign",
      "rethink",
      "figure out how",
      "trace through",
      "debug why",
    ],
  },
  {
    level: "high",
    keywords: [
      "implement",
      "refactor",
      "build",
      "create",
      "migrate",
      "integrate",
      "wire up",
      "port",
    ],
  },
  {
    level: "medium",
    keywords: [
      "fix",
      "change",
      "update",
      "rename",
      "add a",
      "remove",
      "edit",
      "adjust",
      "tweak",
    ],
  },
  {
    level: "low",
    keywords: [
      "read",
      "show",
      "what is",
      "explain",
      "find",
      "search",
      "list",
      "look at",
      "check",
      "where is",
      "summarize",
    ],
  },
];

/**
 * Effort override flags — if the user message contains one of these,
 * the corresponding effort is forced and the flag text is stripped.
 * Format: !effort:LEVEL (e.g. "!effort:high")
 */
const EFFORT_FLAG_RE = /!effort:(low|medium|high|xhigh)\b/i;

/**
 * Result of effort selection, including whether it was manually overridden.
 */
export interface EffortSelection {
  effort: ReasoningEffort;
  kind: EffortMatchKind;
  manual: boolean;
}

/**
 * Select the reasoning effort for a given user message.
 *
 * Checks for a manual override flag first (`!effort:LEVEL`), then falls
 * back to keyword classification, with most complex (xhigh) winning
 * when multiple patterns match.  Returns "medium" when nothing matches.
 */
export function selectReasoningEffort(userMessage: string): EffortSelection {
  const lower = userMessage.toLowerCase();

  // ── Manual override via !effort: flags ─────────────────────────────
  const flagMatch = lower.match(EFFORT_FLAG_RE);
  if (flagMatch) {
    const effort = flagMatch[1] as ReasoningEffort;
    return { effort, kind: effort, manual: true };
  }

  // ── Keyword classification (xhigh → high → medium → low) ─────────
  for (const classifier of CLASSIFIERS) {
    for (const kw of classifier.keywords) {
      if (lower.includes(kw)) {
        return { effort: classifier.level, kind: classifier.level, manual: false };
      }
    }
  }

  // ── Default ───────────────────────────────────────────────────────
  return { effort: "medium", kind: "default", manual: false };
}

/**
 * Strip any !effort:LEVEL flag from the user message.
 * Returns the cleaned message.
 */
export function stripEffortFlag(userMessage: string): string {
  return userMessage.replace(EFFORT_FLAG_RE, "").replace(/\s{2,}/g, " ").trim();
}
