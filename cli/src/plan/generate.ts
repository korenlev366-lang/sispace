/**
 * Interactive plan-mode helpers — draft / revise a markdown plan via a
 * one-shot OpenRouter call (no tools, no session pollution).
 */

import { openRouterPrompt } from "../sdk/openrouter.js";
import { DEFAULT_MODEL, loadModelConfig } from "../config/models.js";
import { findProjectRoot } from "../project/root.js";
import { tokenFromEnv } from "../sdk/session-agent.js";

export interface PlanDraft {
  /** Original user goal / request. */
  goal: string;
  /** Short title derived from the plan. */
  title: string;
  /** Full markdown plan body shown in the picker. */
  body: string;
}

const PLAN_SYSTEM = `\
You are a senior engineer writing an implementation plan for a coding agent.

Return ONLY markdown for the plan. No preamble, no code fences around the whole plan.

Format:
# <short title>

## Goal
<one sentence>

## Steps
1. ...
2. ...
3. ...

## Notes
- risks / files / constraints (brief)

Rules:
- 3–8 concrete steps
- Name files/paths when known
- Prefer actionable steps the agent can execute
- Keep it under ~400 words`;

function extractTitle(body: string, goal: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]?.trim()) {
    return heading[1].trim().slice(0, 80);
  }
  const collapsed = goal.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Plan";
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}

function cleanPlanBody(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return text.trim() || "(empty plan)";
}

async function runPlanPrompt(
  userPrompt: string,
  cwd: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = tokenFromEnv()?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY is not set — plan mode needs OpenRouter.",
    };
  }
  const root = findProjectRoot(cwd);
  const models = loadModelConfig(root);
  const model = models.cheap || models.default || DEFAULT_MODEL;
  try {
    const result = await openRouterPrompt(userPrompt, {
      apiKey,
      model,
      systemPrompt: PLAN_SYSTEM,
    });
    if (result.status === "error") {
      return {
        ok: false,
        error: result.result?.trim() || "Plan generation failed.",
      };
    }
    const text = cleanPlanBody(result.result ?? "");
    return { ok: true, text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Draft a fresh plan for a user goal. */
export async function generatePlan(
  goal: string,
  cwd: string,
): Promise<{ ok: true; plan: PlanDraft } | { ok: false; error: string }> {
  const trimmed = goal.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return { ok: false, error: "Usage: /plan <what to build>" };
  }
  const result = await runPlanPrompt(
    `Create an implementation plan for:\n\n${trimmed}`,
    cwd,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    plan: {
      goal: trimmed,
      title: extractTitle(result.text, trimmed),
      body: result.text,
    },
  };
}

/** Revise an existing plan using user feedback. */
export async function revisePlan(
  plan: PlanDraft,
  feedback: string,
  cwd: string,
): Promise<{ ok: true; plan: PlanDraft } | { ok: false; error: string }> {
  const note = feedback.replace(/\s+/g, " ").trim();
  if (!note) {
    return { ok: false, error: "Revise feedback must be non-empty." };
  }
  const result = await runPlanPrompt(
    [
      "Revise this implementation plan based on the user's feedback.",
      "Return ONLY the full revised plan in the same markdown format.",
      "",
      "## Original goal",
      plan.goal,
      "",
      "## Current plan",
      plan.body,
      "",
      "## User feedback",
      note,
    ].join("\n"),
    cwd,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    plan: {
      goal: plan.goal,
      title: extractTitle(result.text, plan.goal),
      body: result.text,
    },
  };
}

/** Prompt the coding agent to execute an approved plan. */
export function buildPromptFromPlan(plan: PlanDraft): string {
  return [
    "Implement this approved plan now. Follow the steps. Do not ask whether to proceed — just build.",
    "",
    `## Goal`,
    plan.goal,
    "",
    `## Plan: ${plan.title}`,
    "",
    plan.body,
  ].join("\n");
}
