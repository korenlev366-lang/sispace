import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ObsidianConfig {
  vaultRoot: string;
  vaultPrefix: string;
  folders: {
    acceptedLessons: string;
    rejectedLessons: string;
    userModel: string;
    reasoningPatterns: string;
    rolloutLog: string;
  };
}

export interface HarnessPaths {
  /** Workspace cwd for agents and harness config reads */
  root: string;
  /** Canonical store for memory ledgers and reports (always SISpace when installed) */
  memoryRoot: string;
  config: string;
  harnessYaml: string;
  obsidianYaml: string;
  rolloutLog: string;
  latestReflection: string;
  latestGrade: string;
  acceptedLessons: string;
  rejectedLessons: string;
  pendingProposals: string;
  userModel: string;
  goals: string;
  ralphGoal: string;
  reasoningPatterns: string;
  chainLog: string;
}

/** Canonical harness memory/reports root — defaults to SISpace regardless of hook cwd. */
export function resolveSispaceMemoryRoot(projectRoot?: string): string {
  const fromEnv = process.env.SISPACE_HOME?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (fs.existsSync(path.join(resolved, "harness", "memory"))) return resolved;
  }

  for (const candidate of [path.join(os.homedir(), "sispace"), "/home/lev/sispace"]) {
    if (fs.existsSync(path.join(candidate, "harness", "memory"))) {
      return path.resolve(candidate);
    }
  }

  let cur = path.resolve(projectRoot ?? process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(cur, "harness", "memory"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return path.resolve(projectRoot ?? process.cwd());
}

export function resolvePaths(projectRoot: string): HarnessPaths {
  const root = path.resolve(projectRoot);
  const memoryRoot = resolveSispaceMemoryRoot(root);
  const configRoot = fs.existsSync(path.join(root, "harness", "config"))
    ? root
    : memoryRoot;

  return {
    root,
    memoryRoot,
    config: path.join(configRoot, "harness/config"),
    harnessYaml: path.join(configRoot, "harness/config/harness.yaml"),
    obsidianYaml: path.join(configRoot, "harness/config/obsidian.yaml"),
    rolloutLog: path.join(memoryRoot, "harness/reports/rollout-log.md"),
    latestReflection: path.join(memoryRoot, "harness/reports/latest-reflection.md"),
    latestGrade: path.join(memoryRoot, "harness/reports/latest-grade.md"),
    acceptedLessons: path.join(memoryRoot, "harness/memory/accepted-lessons.md"),
    rejectedLessons: path.join(memoryRoot, "harness/memory/rejected-lessons.md"),
    pendingProposals: path.join(memoryRoot, "harness/memory/pending-proposals.md"),
    userModel: path.join(memoryRoot, "harness/memory/user-model.md"),
    goals: path.join(memoryRoot, "harness/memory/goals.md"),
    ralphGoal: path.join(memoryRoot, "harness/memory/ralph-goal.md"),
    reasoningPatterns: path.join(memoryRoot, "harness/memory/reasoning-patterns.md"),
    chainLog: path.join(memoryRoot, "harness/reports/post-task-chain.log"),
  };
}

export function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function appendText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, content, "utf8");
}

export function loadObsidianConfig(configPath: string): ObsidianConfig {
  const defaults: ObsidianConfig = {
    vaultRoot: "",
    vaultPrefix: "Harness",
    folders: {
      acceptedLessons: "Harness/accepted-lessons",
      rejectedLessons: "Harness/rejected-lessons",
      userModel: "Harness/user-model",
      reasoningPatterns: "Harness/reasoning-patterns",
      rolloutLog: "Harness/rollout-log",
    },
  };

  if (!fs.existsSync(configPath)) return defaults;

  const text = fs.readFileSync(configPath, "utf8");
  const pick = (key: string): string => {
    const match = text.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"));
    return match?.[1]?.trim() ?? "";
  };

  const folder = (key: string, fallback: string): string => {
    const block = text.match(/folders:\s*\n([\s\S]*?)(?:\n[^\s]|$)/);
    if (!block) return fallback;
    const line = block[1].match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`, "m"));
    return line?.[1]?.trim() || fallback;
  };

  return {
    vaultRoot: pick("vault_root"),
    vaultPrefix: pick("vault_prefix") || defaults.vaultPrefix,
    folders: {
      acceptedLessons: folder("accepted_lessons", defaults.folders.acceptedLessons),
      rejectedLessons: folder("rejected_lessons", defaults.folders.rejectedLessons),
      userModel: folder("user_model", defaults.folders.userModel),
      reasoningPatterns: folder("reasoning_patterns", defaults.folders.reasoningPatterns),
      rolloutLog: folder("rollout_log", defaults.folders.rolloutLog),
    },
  };
}

export function timestampId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function isoTimestamp(): string {
  return new Date().toISOString();
}

export function generationAlreadyLogged(chainLog: string, generationId: string): boolean {
  if (!generationId || generationId === "unknown" || !fs.existsSync(chainLog)) return false;
  return fs.readFileSync(chainLog, "utf8").includes(`generation=${generationId}`);
}
