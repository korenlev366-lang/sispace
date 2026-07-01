import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sessionAgentsCache = new Map<string, string | null>();

/** Git repo root from cwd (git rev-parse --show-toplevel). */
export function findGitRepoRoot(startCwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startCwd,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout?.trim()) {
    return null;
  }
  return result.stdout.trim();
}

function agentsPath(repoRoot: string): string {
  return join(repoRoot, "AGENTS.md");
}

/** Wrap AGENTS.md body for one-shot injection on the first agent turn. */
export function formatAgentsContextBlock(content: string): string {
  return `<system-context>\n${content.trim()}\n</system-context>`;
}

/**
 * Load AGENTS.md from the git repo root (once per CLI session id).
 * Returns null when the file is missing or unreadable.
 */
export function loadAgentsContextForSession(
  sessionId: string,
  cwd: string,
): { block: string; lineCount: number } | null {
  if (sessionAgentsCache.has(sessionId)) {
    const cached = sessionAgentsCache.get(sessionId);
    if (!cached) {
      return null;
    }
    const lines = cached.split("\n").length;
    return { block: cached, lineCount: lines };
  }

  const repoRoot = findGitRepoRoot(cwd);
  if (!repoRoot) {
    sessionAgentsCache.set(sessionId, null);
    return null;
  }

  const path = agentsPath(repoRoot);
  if (!existsSync(path)) {
    sessionAgentsCache.set(sessionId, null);
    return null;
  }

  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) {
      sessionAgentsCache.set(sessionId, null);
      return null;
    }
    const block = formatAgentsContextBlock(raw);
    sessionAgentsCache.set(sessionId, block);
    return { block, lineCount: raw.split("\n").length };
  } catch {
    sessionAgentsCache.set(sessionId, null);
    return null;
  }
}

/** Raw AGENTS.md body from git repo root (no XML wrapper). */
export function loadAgentsMdRaw(cwd: string): string | null {
  const repoRoot = findGitRepoRoot(cwd);
  if (!repoRoot) {
    return null;
  }

  const path = agentsPath(repoRoot);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Reset per-session cache (tests). */
export function resetAgentsContextCache(): void {
  sessionAgentsCache.clear();
}
