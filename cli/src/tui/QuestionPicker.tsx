import { Box, Text } from "ink";
import type { AgentQuestion } from "../tools/ask-user.js";

export interface QuestionPickerProps {
  question: AgentQuestion;
  /** Index into options, or -1 when typing free text. */
  highlightIndex: number;
  /** Non-null while entering a free-text answer. */
  freeTextDraft?: string | null;
}

/**
 * Clarification UI placed under the transcript / above the prompt
 * (same layout slot as PlanPicker so it does not get lost at the top).
 */
export function QuestionPicker({
  question,
  highlightIndex,
  freeTextDraft = null,
}: QuestionPickerProps) {
  const options = question.options ?? [];
  const typing = freeTextDraft !== null;
  const hasOptions = options.length > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        {typing
          ? "Answer — type · Enter submit · Esc back"
          : hasOptions
            ? "Question — ↑↓ select · Enter · t type · Esc skip"
            : "Question — type answer · Enter · Esc skip"}
      </Text>

      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text color="#e9e5dc" bold>
          {question.prompt}
        </Text>
      </Box>

      {typing || !hasOptions ? (
        <Box>
          <Text color="#d8a657" bold>
            answer{" "}
          </Text>
          <Text>{freeTextDraft ?? ""}</Text>
          <Text color="#d8a657">█</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {options.map((opt, i) => {
            const selected = i === highlightIndex;
            return (
              <Text key={`opt-${i}`}>
                <Text color={selected ? "#d8a657" : "#5b574d"}>
                  {selected ? "› " : "  "}
                </Text>
                <Text color={selected ? "#d8a657" : "#928d80"} bold={selected}>
                  {opt}
                </Text>
              </Text>
            );
          })}
          <Text dimColor>  t — type a custom answer</Text>
        </Box>
      )}
    </Box>
  );
}
