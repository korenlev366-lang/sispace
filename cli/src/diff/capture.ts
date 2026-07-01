import { spawnSync } from "node:child_process";
import { findProjectRoot } from "../project/root.js";

const DIFF_MAX = 12_000;

/** True when the repo has staged or unstaged diffs (git diff --quiet exits 1). */
export function hasGitWorktreeChanges(cwd: string): boolean {
  const root = findProjectRoot(cwd);
  const unstaged = spawnSync("git", ["diff", "--quiet"], {
    cwd: root,
    encoding: "utf8",
  });
  if (unstaged.status === 2) {
    return false;
  }
  if (unstaged.status === 1) {
    return true;
  }
  const staged = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: root,
    encoding: "utf8",
  });
  if (staged.status === 2) {
    return false;
  }
  return staged.status === 1;
}

export function captureGitDiff(cwd: string): string {
  const root = findProjectRoot(cwd);
  const unstaged = spawnSync("git", ["diff", "--no-color"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const staged = spawnSync("git", ["diff", "--cached", "--no-color"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });

  const parts: string[] = [];
  const u = (unstaged.stdout ?? "").trim();
  const s = (staged.stdout ?? "").trim();
  if (s) {
    parts.push("--- staged ---", s);
  }
  if (u) {
    parts.push("--- unstaged ---", u);
  }
  if (parts.length === 0) {
    return "(no git diff — clean or not a git repo)";
  }
  const combined = parts.join("\n");
  if (combined.length <= DIFF_MAX) {
    return combined;
  }
  return `${combined.slice(0, DIFF_MAX)}\n… (diff truncated)`;
}
