import { Box, Text } from "ink";
import {
  SLASH_COMMANDS,
  slashCommandDescription,
} from "../commands/slash-catalog.js";
import { cliPackageVersion } from "../version.js";
import type { CliSession } from "../session/types.js";

const LOGO = [
  "   ██████╗██╗   ██╗██████╗ ███████╗ ██████╗ ██████╗ ███████╗██╗",
  "  ██╔════╝██║   ██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝██║",
  "  ██║     ██║   ██║██████╔╝███████╗██║   ██║██████╔╝███████╗██║",
  "  ██║     ██║   ██║██╔══██╗╚════██║██║   ██║██╔══██╗╚════██║██║",
  "  ╚██████╗╚██████╔╝██║  ██║███████║╚██████╔╝██║  ██║███████║██║",
  "   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝",
];

const COMMANDS_PER_COL = 8;

export interface WelcomeBannerProps {
  session: CliSession;
}

export function WelcomeBanner({ session }: WelcomeBannerProps) {
  const version = cliPackageVersion();
  const date = new Date().toISOString().slice(0, 10);
  const path =
    session.cwd.length > 42
      ? `…${session.cwd.slice(-41)}`
      : session.cwd;

  const leftCommands = SLASH_COMMANDS.slice(0, COMMANDS_PER_COL);
  const rightCommands = SLASH_COMMANDS.slice(COMMANDS_PER_COL);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Text color="#d8a657" bold>
        CursorSI v{version} ({date}) · terminal agent
      </Text>

      <Box marginTop={1}>
        <Box flexDirection="column" marginRight={2}>
          {LOGO.map((line) => (
            <Text key={line} color="#d8a657">
              {line}
            </Text>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="#d8a657">Model: </Text>
              <Text>{session.modelId}</Text>
            </Text>
            <Text>
              <Text color="#d8a657">Path: </Text>
              <Text dimColor>{path}</Text>
            </Text>
            <Text>
              <Text color="#d8a657">Session: </Text>
              <Text dimColor>{session.id}</Text>
            </Text>
          </Box>
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Text color="#d8a657" bold underline>
            Slash commands
          </Text>
          <Box marginTop={0}>
            <Box flexDirection="column" marginRight={2}>
              {leftCommands.map((cmd) => (
                <Text key={cmd}>
                  <Text color="white">/{cmd}</Text>
                  <Text dimColor> — </Text>
                  <Text color="#d8a657" dimColor>
                    {slashCommandDescription(cmd)}
                  </Text>
                </Text>
              ))}
            </Box>
            <Box flexDirection="column">
              {rightCommands.map((cmd) => (
                <Text key={cmd}>
                  <Text color="white">/{cmd}</Text>
                  <Text dimColor> — </Text>
                  <Text color="#d8a657" dimColor>
                    {slashCommandDescription(cmd)}
                  </Text>
                </Text>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {SLASH_COMMANDS.length} commands · Tab complete · /help for usage
        </Text>
      </Box>
    </Box>
  );
}
