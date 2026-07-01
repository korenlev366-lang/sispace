import type {
  TaskSearchBrowseResult,
  TaskSearchDiscoveryResult,
  TaskSearchScrollResult,
} from "./types.js";

const MAX_LINE = 120;

function trunc(s: string, max = MAX_LINE): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function msgLine(role: string, content: string): string {
  return `    [${role}] ${trunc(content, 96)}`;
}

export function formatDiscoveryLines(result: TaskSearchDiscoveryResult): string[] {
  const lines: string[] = [
    `search "${result.query}" — ${result.hits.length} task(s) (${result.elapsed_ms}ms)`,
  ];
  if (result.hits.length === 0) {
    lines.push("  (no matches — open SISpace or run tasks to populate shared DB)");
    return lines;
  }
  for (const hit of result.hits) {
    lines.push(
      `  ${hit.task_id} · ${trunc(hit.title, 40)} · ${hit.status} · ${hit.task_type}`,
    );
    if (hit.snippet) {
      lines.push(`    ${trunc(hit.snippet, MAX_LINE)}`);
    }
    for (const m of hit.bookend_start.slice(0, 2)) {
      lines.push(msgLine(m.role, m.content));
    }
    if (hit.match_window.length > 0) {
      lines.push("    — match window —");
      for (const m of hit.match_window) {
        lines.push(msgLine(m.role, m.content));
      }
    }
  }
  return lines;
}

export function formatScrollLines(result: TaskSearchScrollResult): string[] {
  const lines: string[] = [
    `scroll ${result.task_id} — ${result.messages.length} message(s)`,
    `  has_before=${result.has_before} has_after=${result.has_after}`,
  ];
  for (const m of result.messages) {
    lines.push(`  #${m.id} ${msgLine(m.role, m.content).trimStart()}`);
  }
  return lines;
}

export function formatBrowseLines(result: TaskSearchBrowseResult): string[] {
  const lines: string[] = [
    `browse ${result.task_id} — ${result.messages.length}/${result.total} (offset ${result.offset})`,
  ];
  for (const m of result.messages) {
    lines.push(`  #${m.id} ${msgLine(m.role, m.content).trimStart()}`);
  }
  return lines;
}
