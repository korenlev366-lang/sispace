import type { CliSession } from "../session/types.js";
import type { ObsidianYamlConfig } from "./config.js";
import {
  fetchRecentLessonFiles,
  formatLessonFilesAsContext,
  type LessonFile,
} from "./search.js";

/**
 * Build a keyword filter string for lesson search from a user message.
 * Extracts meaningful tokens from the message to filter lesson filenames.
 */
export function buildKeywordFilter(userMessage?: string): string {
  if (!userMessage?.trim()) {
    return "";
  }
  return userMessage.trim();
}

/**
 * Fetch lesson context using the direct file listing approach.
 *
 * If userMessage is provided, it is used to extract keywords for filename filtering.
 * Otherwise all recent lessons are returned.
 */
export async function fetchLessonContextForSession(
  session: CliSession,
  config: ObsidianYamlConfig,
  userMessage?: string,
): Promise<{ query: string; block: string } | null> {
  void config; // paths are now hardcoded in search.ts per the new approach
  try {
    const lessons: LessonFile[] = await fetchRecentLessonFiles(
      userMessage ?? undefined,
      8,
      4,
    );
    const block = formatLessonFilesAsContext(lessons);
    const query = userMessage ?? "all recent lessons";
    return { query, block };
  } catch {
    return null;
  }
}

/**
 * Fetch lesson context for a given query string (used by /recall slash command).
 */
export async function fetchLessonContextForQuery(
  query: string,
  config: ObsidianYamlConfig,
): Promise<string> {
  void config;
  const lessons = await fetchRecentLessonFiles(query, 8, 4);
  return formatLessonFilesAsContext(lessons);
}