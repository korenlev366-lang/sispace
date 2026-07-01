import OpenAI from "openai";
import type { ReasoningEffort } from "../sdk/reasoning-effort.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Subtask {
  description: string;
  type: "read" | "edit" | "logic" | "plan";
  effort: ReasoningEffort;
  depends_on: number[];
}

// ── Type→effort mapping ────────────────────────────────────────────────────

const TYPE_EFFORT_MAP: Record<Subtask["type"], ReasoningEffort> = {
  read: "low",
  edit: "medium",
  logic: "high",
  plan: "xhigh",
};

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a planning agent that decomposes complex user requests into 2–6 subtasks.

Return ONLY a JSON array. No markdown fences, no commentary, no explanation.

Each element must be an object with:
- "description": string — what to do (one clear sentence)
- "type": "read" | "edit" | "logic" | "plan"
- "depends_on": number[] — 0-based indices of subtasks that must finish first

Rules:
1. Keep the list to **2–6 subtasks**. Never more than 6.
2. Order subtasks logically: dependencies first, dependents later.
3. Use "depends_on" to express ordering. Empty array = no dependency.
4. Only include dependencies that are actually required.
5. Be specific about files and actions in descriptions.

Example response:
[
  {
    "description": "Read cli/src/sdk/reasoning-effort.ts to understand the existing API",
    "type": "read",
    "depends_on": []
  },
  {
    "description": "Design the gate function interface",
    "type": "plan",
    "depends_on": [0]
  },
  {
    "description": "Implement shouldDecompose() in cli/src/subagents/gate.ts",
    "type": "edit",
    "depends_on": [0, 1]
  },
  {
    "description": "Verify the logic handles edge cases correctly",
    "type": "logic",
    "depends_on": [2]
  }
]`;

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Decompose a user message into 2–6 subtasks using a single Flash call.
 *
 * Each subtask receives an `effort` field derived from its `type`:
 *   read  → low, edit  → medium, logic → high, plan  → xhigh
 *
 * @param userMessage  The raw user request.
 * @param client       An OpenAI-compatible client (pointed at OpenRouter).
 * @returns            Array of validated subtasks. Returns an empty array on
 *                     parse failure / API error — never throws.
 */
export async function planSubtasks(
  userMessage: string,
  client: OpenAI,
): Promise<Subtask[]> {
  try {
    const response = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 2048,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw =
      response.choices?.[0]?.message?.content?.trim() ?? "";

    if (!raw) {
      console.warn("[planner] empty response from Flash");
      return [];
    }

    // Strip optional markdown fences
    const json = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Some models return valid JSON inside a code block with extra text
      // Try extracting the first array-like structure
      const match = json.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        console.warn("[planner] failed to parse JSON from Flash response");
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      console.warn("[planner] response is not an array");
      return [];
    }

    // Map type→effort for each item, validate structure
    const subtasks: Subtask[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== "object") continue;

      const description =
        typeof item.description === "string" ? item.description.trim() : "";
      const type = item.type as Subtask["type"];

      if (!description) continue;
      if (!["read", "edit", "logic", "plan"].includes(type)) continue;

      // Validate depends_on is an array of numbers
      let dependsOn: number[] = [];
      if (Array.isArray(item.depends_on)) {
        dependsOn = item.depends_on.filter(
          (d: unknown): d is number => typeof d === "number" && Number.isInteger(d),
        );
      }

      subtasks.push({
        description,
        type,
        effort: TYPE_EFFORT_MAP[type] ?? "medium",
        depends_on: dependsOn,
      });
    }

    return subtasks;
  } catch (err) {
    console.warn("[planner] Flash call failed:", err);
    return [];
  }
}
