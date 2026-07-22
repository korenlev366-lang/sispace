import { Box, Text } from "ink";
import type { ChatListEntry } from "../session/chat-persist.js";

interface ChatPickerProps {
  chats: ChatListEntry[];
  activeTaskId?: string;
  highlightIndex: number;
  /** Non-null while editing the highlighted chat title. */
  renameDraft?: string | null;
}

export function ChatPicker({
  chats,
  activeTaskId,
  highlightIndex,
  renameDraft = null,
}: ChatPickerProps) {
  const renaming = renameDraft !== null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        {renaming
          ? "Rename — type · Enter save · Esc cancel"
          : "Chats — ↑↓ · Enter · r rename · Esc"}
      </Text>
      {chats.map((c, i) => {
        const highlighted = i === highlightIndex;
        const isActive = activeTaskId === c.id;
        const prefix = highlighted ? "› " : "  ";
        if (highlighted && renaming) {
          return (
            <Text key={c.id}>
              {prefix}
              <Text color="#d8a657" bold>
                {renameDraft}
              </Text>
              <Text color="#d8a657">█</Text>
            </Text>
          );
        }
        return (
          <Text key={c.id}>
            {prefix}
            <Text color={highlighted ? "#d8a657" : "#928d80"} bold={highlighted}>
              {c.title}
            </Text>
            {isActive ? <Text dimColor> ·</Text> : null}
            {isActive ? <Text color="#7a9e6a"> active</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
