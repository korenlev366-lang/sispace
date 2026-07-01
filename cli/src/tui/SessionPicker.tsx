import { Box, Text } from "ink";
import type { CliSession } from "../session/types.js";

interface SessionPickerProps {
  sessions: CliSession[];
  activeId: string;
  highlightIndex: number;
}

export function SessionPicker({
  sessions,
  activeId,
  highlightIndex,
}: SessionPickerProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        Sessions — ↑↓ move · Enter switch · n new · d delete · Esc close
      </Text>
      {sessions.map((s, i) => {
        const selected = s.id === activeId;
        const highlighted = i === highlightIndex;
        const prefix = highlighted ? "› " : "  ";
        const marker = selected ? "●" : "○";
        return (
          <Text key={s.id}>
            {prefix}
            <Text color={highlighted ? "#d8a657" : "#928d80"} bold={highlighted}>
              {marker} {s.title}
            </Text>
            <Text dimColor> ({s.id.slice(0, 12)}…)</Text>
          </Text>
        );
      })}
    </Box>
  );
}
