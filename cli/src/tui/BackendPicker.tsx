/**
 * BackendPicker — pick LLM backend (OpenRouter / Cursor / Compatible).
 * Placed under the transcript / above the prompt (same slot as AuthDialog).
 */

import { Box, Text } from "ink";
import type { BackendName } from "../config/user-settings.js";

export type BackendPickerView = "main" | "compatible";

export interface BackendPickerProps {
  view: BackendPickerView;
  highlightIndex: number;
  currentBackend: BackendName;
  currentCompatibleProvider?: string;
  /** Saved compatible provider names (from credentials). */
  compatibleProviders: string[];
}

const MAIN_OPTIONS: Array<{
  id: BackendName;
  label: string;
  hint: string;
}> = [
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "OpenRouter API models",
  },
  {
    id: "cursor",
    label: "Cursor",
    hint: "Cursor Agent SDK models",
  },
  {
    id: "compatible",
    label: "Compatible",
    hint: "OpenAI / Anthropic-compatible endpoint",
  },
];

function currentLabel(
  backend: BackendName,
  compatibleProvider?: string,
): string {
  if (backend === "compatible" && compatibleProvider) {
    return `compatible/${compatibleProvider}`;
  }
  return backend;
}

function MainMenu({
  highlightIndex,
  currentBackend,
  currentCompatibleProvider,
}: {
  highlightIndex: number;
  currentBackend: BackendName;
  currentCompatibleProvider?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        Backend — ↑↓ select · Enter · Esc close
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Current: </Text>
        <Text color="#7a9e6a">
          {currentLabel(currentBackend, currentCompatibleProvider)}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {MAIN_OPTIONS.map((opt, i) => {
          const selected = i === highlightIndex;
          const isActive = currentBackend === opt.id;
          return (
            <Text key={opt.id}>
              <Text color={selected ? "#d8a657" : "#5b574d"}>
                {selected ? "› " : "  "}
              </Text>
              <Text color={selected ? "#d8a657" : "#928d80"} bold={selected}>
                {opt.label}
              </Text>
              {isActive ? <Text color="#7a9e6a"> · active</Text> : null}
              <Text dimColor> — {opt.hint}</Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

function CompatibleMenu({
  highlightIndex,
  providers,
  currentCompatibleProvider,
  currentBackend,
}: {
  highlightIndex: number;
  providers: string[];
  currentCompatibleProvider?: string;
  currentBackend: BackendName;
}) {
  if (providers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="#d8a657">
          Compatible providers
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="#928d80">No compatible providers saved.</Text>
          <Text dimColor>Run /auth to add one, then try /backend again.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        Compatible — ↑↓ select · Enter · Esc back
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {providers.map((name, i) => {
          const selected = i === highlightIndex;
          const isActive =
            currentBackend === "compatible" &&
            currentCompatibleProvider === name;
          return (
            <Text key={name}>
              <Text color={selected ? "#d8a657" : "#5b574d"}>
                {selected ? "› " : "  "}
              </Text>
              <Text color={selected ? "#d8a657" : "#928d80"} bold={selected}>
                {name}
              </Text>
              {isActive ? <Text color="#7a9e6a"> · active</Text> : null}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function BackendPicker({
  view,
  highlightIndex,
  currentBackend,
  currentCompatibleProvider,
  compatibleProviders,
}: BackendPickerProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      {view === "main" ? (
        <MainMenu
          highlightIndex={highlightIndex}
          currentBackend={currentBackend}
          currentCompatibleProvider={currentCompatibleProvider}
        />
      ) : (
        <CompatibleMenu
          highlightIndex={highlightIndex}
          providers={compatibleProviders}
          currentCompatibleProvider={currentCompatibleProvider}
          currentBackend={currentBackend}
        />
      )}
    </Box>
  );
}
