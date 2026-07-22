/**
 * SkillPicker — accept/reject auto-extracted skills (bottom slot UI).
 */

import { Box, Text } from "ink";
import type { PendingSkillDraft } from "../memory/pending-skills.js";

export type SkillPickerAction = "accept" | "reject" | "skip_all";

export interface SkillPickerProps {
  skills: PendingSkillDraft[];
  /** Index into the queue (current skill). */
  index: number;
  /** Highlight in Accept / Reject / Skip remaining */
  highlightIndex: number;
}

const ACTIONS: Array<{ id: SkillPickerAction; label: string }> = [
  { id: "accept", label: "Accept — write .cursorsi/skills/<slug>/SKILL.md" },
  { id: "reject", label: "Reject — discard this skill" },
  { id: "skip_all", label: "Skip remaining — decide later" },
];

function previewLines(content: string, max = 8): string[] {
  const body = content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  return body.slice(0, max);
}

export function SkillPicker({
  skills,
  index,
  highlightIndex,
}: SkillPickerProps) {
  const skill = skills[index];
  const remaining = Math.max(0, skills.length - index);

  if (!skill) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#3a3832"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="#d8a657">
          Auto-skill — nothing pending
        </Text>
        <Text dimColor>Esc close</Text>
      </Box>
    );
  }

  const preview = previewLines(skill.content);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        Auto-skill — ↑↓ · Enter · Esc skip remaining
        {skills.length > 0 ? " · agent keeps working" : ""}
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {index + 1}/{skills.length}
          {remaining > 1 ? ` · ${remaining} left` : ""}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text dimColor>skill </Text>
          <Text color="#e9e5dc" bold>
            {skill.slug}
          </Text>
        </Text>
        {preview.map((line, i) => (
          <Text key={`p-${i}`} dimColor>
            {line.length > 88 ? `${line.slice(0, 85)}…` : line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {ACTIONS.map((a, i) => {
          const selected = i === highlightIndex;
          return (
            <Text key={a.id}>
              <Text color={selected ? "#d8a657" : "#5b574d"}>
                {selected ? "› " : "  "}
              </Text>
              <Text
                color={selected ? "#d8a657" : "#928d80"}
                bold={selected}
              >
                {a.label}
              </Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function skillPickerActionAt(
  highlightIndex: number,
): SkillPickerAction {
  return ACTIONS[Math.max(0, Math.min(ACTIONS.length - 1, highlightIndex))]!
    .id;
}

export const SKILL_PICKER_ACTION_COUNT = ACTIONS.length;
