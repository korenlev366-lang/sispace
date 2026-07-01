import { openRouterPrompt } from "./openrouter.js";
import { modelIdToSelection } from "./model-selection.js";
import type { ModelTiers, PipelineTier } from "./tier-config.js";

const CLASSIFIER_PROMPT = (goal: string) =>
  [
    "Classify this software task into exactly one pipeline tier.",
    "",
    "Tiers:",
    "- one-shot: trivial fix, single obvious change, no research or architecture needed",
    "- two-step: needs brief research or context gathering, then implementation",
    "- full: complex feature, architecture decisions, multi-file changes, review and testing",
    "",
    "Reply with ONLY one word: one-shot, two-step, or full",
    "",
    "Task goal:",
    goal,
  ].join("\n");

export function parsePipelineTier(raw: string): PipelineTier {
  const normalized = raw.trim().toLowerCase();
  if (/one[\s-]?shot/.test(normalized)) return "one-shot";
  if (/two[\s-]?step/.test(normalized)) return "two-step";
  if (/\bfull\b/.test(normalized)) return "full";
  return "full";
}

export async function classifyPipelineTier(opts: {
  apiKey: string;
  projectRoot: string;
  parentGoal: string;
  tiers: ModelTiers;
}): Promise<PipelineTier> {
  void opts.projectRoot;
  const run = await openRouterPrompt(CLASSIFIER_PROMPT(opts.parentGoal), {
    apiKey: opts.apiKey,
    model: modelIdToSelection(opts.tiers.cheap),
    systemPrompt: "You classify software tasks into pipeline tiers.",
  });

  if (run.status === "error") {
    return "full";
  }

  return parsePipelineTier(run.result ?? "full");
}
