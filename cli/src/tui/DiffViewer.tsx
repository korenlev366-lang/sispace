import { Box, Text } from "ink";

const MAX_DIFF_LINES = 40;

interface DiffViewerProps {
  diffText: string;
  collapsed?: boolean;
}

export function DiffViewer({ diffText, collapsed = false }: DiffViewerProps) {
  if (collapsed || !diffText.trim()) {
    return null;
  }

  const lines = diffText.split("\n");
  const visible =
    lines.length > MAX_DIFF_LINES
      ? [...lines.slice(0, MAX_DIFF_LINES), `… (${lines.length - MAX_DIFF_LINES} more lines)`]
      : lines;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      {/* ── dim top hairline ────────────────────────────────────── */}
      <Text dimColor>{"─".repeat(80)}</Text>
      <Text color="magenta" bold>
        git diff (after last agent turn)
      </Text>
      {visible.map((line, i) => {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          return (
            <Text key={`diff-${i}`} color="green" wrap="truncate">
              {line}
            </Text>
          );
        }
        if (line.startsWith("-") && !line.startsWith("---")) {
          return (
            <Text key={`diff-${i}`} color="red" wrap="truncate">
              {line}
            </Text>
          );
        }
        if (line.startsWith("@@")) {
          return (
            <Text key={`diff-${i}`} color="cyan" wrap="truncate">
              {line}
            </Text>
          );
        }
        return (
          <Text key={`diff-${i}`} dimColor wrap="truncate">
            {line}
          </Text>
        );
      })}
      {/* ── dim bottom hairline ─────────────────────────────────── */}
      <Text dimColor>{"─".repeat(80)}</Text>
    </Box>
  );
}
