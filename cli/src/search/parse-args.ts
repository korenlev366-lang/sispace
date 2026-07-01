import type { TaskSearchMode } from "./types.js";

export function parseSearchSlashArgs(rest: string): TaskSearchMode | null {
  const trimmed = rest.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  const flags = new Map<string, string>();

  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (p === "--task" && parts[i + 1]) {
      flags.set("task", parts[i + 1]);
      i += 2;
      continue;
    }
    if (p === "--before" && parts[i + 1]) {
      flags.set("before", parts[i + 1]);
      i += 2;
      continue;
    }
    if (p === "--after" && parts[i + 1]) {
      flags.set("after", parts[i + 1]);
      i += 2;
      continue;
    }
    if (p === "--offset" && parts[i + 1]) {
      flags.set("offset", parts[i + 1]);
      i += 2;
      continue;
    }
    if (p === "--limit" && parts[i + 1]) {
      flags.set("limit", parts[i + 1]);
      i += 2;
      continue;
    }
    i += 1;
  }

  const taskId = flags.get("task");
  const limit = Number(flags.get("limit") || "0");

  if (taskId) {
    if (flags.has("before") || flags.has("after")) {
      return {
        mode: "scroll",
        task_id: taskId,
        before: flags.has("before")
          ? Number(flags.get("before"))
          : undefined,
        after: flags.has("after") ? Number(flags.get("after")) : undefined,
        limit: limit > 0 ? limit : 20,
      };
    }
    return {
      mode: "browse",
      task_id: taskId,
      limit: limit > 0 ? limit : 50,
      offset: Number(flags.get("offset") || "0"),
    };
  }

  const queryParts: string[] = [];
  i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (
      p.startsWith("--") &&
      (p === "--task" ||
        p === "--before" ||
        p === "--after" ||
        p === "--offset" ||
        p === "--limit")
    ) {
      i += 2;
      continue;
    }
    queryParts.push(p);
    i += 1;
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    return null;
  }

  return {
    mode: "discovery",
    query,
    limit: limit > 0 ? limit : 10,
  };
}
