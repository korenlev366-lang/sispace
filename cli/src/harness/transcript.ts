import type { CliSession } from "../session/types.js";

/** Reconstruct harness transcript from TUI log lines (matches harness_client.rs). */
export function reconstructTranscript(session: CliSession): string {
  return session.lines
    .map((line) => {
      if (line.startsWith("you> ")) {
        return `[user] ${line.slice(5)}`;
      }
      if (line.startsWith("agent> ")) {
        return `[assistant] ${line.slice(7)}`;
      }
      return `[log] ${line}`;
    })
    .join("\n\n");
}

export function estimateOutputTokens(session: CliSession): number {
  const chars = session.lines.reduce((n, line) => n + line.length, 0);
  return Math.max(1000, Math.floor(chars / 3));
}

/** Skip reflection when the session only has the startup boilerplate. */
export function sessionHasReflectableContent(session: CliSession): boolean {
  return session.lines.some(
    (line) =>
      line.startsWith("you> ") ||
      line.startsWith("agent> ") ||
      (line.startsWith("[") && !line.includes("ready — type /help")),
  );
}
