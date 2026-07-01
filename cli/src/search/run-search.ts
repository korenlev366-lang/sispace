import { discoverySearch, scrollMessages, browseMessages } from "./fts.js";
import {
  formatBrowseLines,
  formatDiscoveryLines,
  formatScrollLines,
} from "./format.js";
import { openSharedDb } from "./query.js";
import type {
  TaskSearchBrowseResult,
  TaskSearchDiscoveryResult,
  TaskSearchMode,
  TaskSearchScrollResult,
} from "./types.js";

export function runTaskSearch(
  mode: TaskSearchMode,
):
  | TaskSearchDiscoveryResult
  | TaskSearchScrollResult
  | TaskSearchBrowseResult
  | null {
  const conn = openSharedDb();
  if (!conn) {
    return null;
  }
  switch (mode.mode) {
    case "discovery":
      return discoverySearch(conn, mode.query, mode.limit);
    case "scroll":
      return scrollMessages(
        conn,
        mode.task_id,
        mode.before,
        mode.after,
        mode.limit,
      );
    case "browse":
      return browseMessages(conn, mode.task_id, mode.limit, mode.offset);
  }
}

export function formatSearchResult(
  result:
    | TaskSearchDiscoveryResult
    | TaskSearchScrollResult
    | TaskSearchBrowseResult,
): string[] {
  if ("hits" in result) {
    return formatDiscoveryLines(result);
  }
  if ("has_before" in result) {
    return formatScrollLines(result);
  }
  return formatBrowseLines(result);
}
