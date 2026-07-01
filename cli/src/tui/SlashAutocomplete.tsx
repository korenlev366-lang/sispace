import { Box, Text } from "ink";
import {
  slashCommandDescription,
  type SlashCommandName,
} from "../commands/slash-catalog.js";

const MAX_VISIBLE = 8;

export interface SlashAutocompleteProps {
  candidates: SlashCommandName[];
  selectedIndex: number;
  /** Typed prefix without leading slash, e.g. "ne" for "/ne" */
  query: string;
}

export function SlashAutocomplete({
  candidates,
  selectedIndex,
  query,
}: SlashAutocompleteProps) {
  if (candidates.length === 0) {
    return null;
  }

  const visible = candidates.slice(0, MAX_VISIBLE);
  const hidden = candidates.length - visible.length;
  const cmdWidth = Math.max(
    ...visible.map((c) => `/${c}`.length),
    8,
  );

  return (
    <Box
      flexDirection="column"
      marginTop={0}
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
    >
      {visible.map((cmd, i) => {
        const globalIdx = candidates.indexOf(cmd);
        const selected = globalIdx === selectedIndex;
        const desc = slashCommandDescription(cmd);
        const cmdLabel = `/${cmd}`.padEnd(cmdWidth);

        return (
          <Box key={cmd}>
            <Text color="#d8a657" bold={selected}>
              {selected ? "▌" : " "}
            </Text>
            <Text
              color={selected ? "#d8a657" : "#928d80"}
              bold={selected}
            >
              {cmdLabel}
            </Text>
            <Text> </Text>
            <Text
              dimColor={!selected}
            >
              {desc}
            </Text>
          </Box>
        );
      })}
      {hidden > 0 ? (
        <Text dimColor>… {hidden} more — Tab to cycle, ↑↓ to select</Text>
      ) : candidates.length > 1 ? (
        <Text dimColor>Tab cycle · ↑↓ select · → accept ghost</Text>
      ) : null}
      {query ? (
        <Text dimColor>
          matching /{query}
        </Text>
      ) : null}
    </Box>
  );
}
