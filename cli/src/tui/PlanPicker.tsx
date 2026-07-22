import { Box, Text } from "ink";
import type { PlanDraft } from "../plan/generate.js";

export type PlanFocus = "build" | "revise";

export interface PlanPickerProps {
  plan: PlanDraft;
  focus: PlanFocus;
  /** Non-null while typing revise feedback. */
  reviseDraft?: string | null;
  /** True while regenerating after revise. */
  loading?: boolean;
}

const BODY_MAX_LINES = 18;

function wrapBody(body: string): string[] {
  const lines = body.split("\n");
  if (lines.length <= BODY_MAX_LINES) return lines;
  const kept = lines.slice(0, BODY_MAX_LINES - 1);
  const hidden = lines.length - (BODY_MAX_LINES - 1);
  return [...kept, `… (${hidden} more lines)`];
}

function ActionButton({
  label,
  shortcut,
  selected,
}: {
  label: string;
  shortcut: string;
  selected: boolean;
}) {
  return (
    <Text>
      <Text color={selected ? "#d8a657" : "#5b574d"}>
        {selected ? "› [" : "  ["}
      </Text>
      <Text color={selected ? "#d8a657" : "#928d80"} bold={selected}>
        {label}
      </Text>
      <Text color={selected ? "#d8a657" : "#5b574d"}>]</Text>
      <Text dimColor> {shortcut}</Text>
    </Text>
  );
}

export function PlanPicker({
  plan,
  focus,
  reviseDraft = null,
  loading = false,
}: PlanPickerProps) {
  const revising = reviseDraft !== null;
  const bodyLines = wrapBody(plan.body);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        {loading
          ? "Plan — revising…"
          : revising
            ? "Revise — type feedback · Enter submit · Esc back"
            : "Plan — ←→ focus · Enter confirm · Esc close"}
      </Text>

      <Text>
        <Text color="#d8a657" bold>
          {plan.title}
        </Text>
      </Text>
      <Text dimColor>goal: {plan.goal}</Text>

      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {bodyLines.map((line, i) => (
          <Text key={`plan-line-${i}`} color="#e9e5dc">
            {line.length === 0 ? " " : line}
          </Text>
        ))}
      </Box>

      {revising ? (
        <Box>
          <Text color="#d8a657" bold>
            revise{" "}
          </Text>
          <Text>{reviseDraft}</Text>
          <Text color="#d8a657">█</Text>
        </Box>
      ) : (
        <Box flexDirection="row">
          <ActionButton
            label="Build"
            shortcut="b / Enter"
            selected={focus === "build"}
          />
          <Text>   </Text>
          <ActionButton
            label="Revise"
            shortcut="r / Enter"
            selected={focus === "revise"}
          />
        </Box>
      )}

      {loading ? (
        <Text dimColor>Generating revised plan…</Text>
      ) : null}
    </Box>
  );
}
