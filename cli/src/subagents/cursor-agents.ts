/**
 * Cursor SDK helpers for pipeline subagents + Task-tool model inheritance.
 */

/** Custom agents with model inherit / explicit parent model (avoid composer-2.5-fast). */
export function buildCursorPipelineAgents(parentModelId: string): Record<
  string,
  {
    description: string;
    prompt: string;
    model: "inherit" | { id: string };
  }
> {
  const model =
    parentModelId.trim() && parentModelId.trim() !== "auto"
      ? ({ id: parentModelId.trim() } as const)
      : ("inherit" as const);

  return {
    generalPurpose: {
      description:
        "General-purpose coding subagent for multi-step implementation work.",
      prompt:
        "You are a focused coding subagent. Complete the assigned task thoroughly using tools. Prefer small, correct edits.",
      model,
    },
    explore: {
      description: "Read-only exploration of the codebase.",
      prompt:
        "You explore and summarize code. Prefer read/search tools; avoid unnecessary edits.",
      model,
    },
    shell: {
      description: "Run terminal commands and report results.",
      prompt:
        "You run shell commands carefully and summarize stdout/stderr for the parent agent.",
      model,
    },
  };
}

/** Hint injected once so Cursor Task tool does not default to composer-2.5-fast. */
export function cursorSubagentModelHint(parentModelId: string): string {
  const id = parentModelId.trim() || "inherit parent";
  return [
    "## Subagent model policy",
    `When spawning a Task/subagent, set model to \`${id}\` (same as this session).`,
    "Do not use composer-2.5-fast unless that is explicitly the session model.",
    "Prefer custom agents generalPurpose / explore / shell which inherit this model.",
  ].join("\n");
}
