import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ObsidianYamlConfig {
  vaultRoot: string;
  vaultPrefix: string;
  tasksFolder: string;
  lessonPrefixes: string[];
}

function yamlScalar(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

/** Parse harness/config/obsidian.yaml (line-oriented, matches Rust loader). */
export function loadObsidianYaml(projectRoot: string): ObsidianYamlConfig {
  const path = join(projectRoot, "harness", "config", "obsidian.yaml");
  let vaultRoot = "";
  let vaultPrefix = "Harness";
  let tasksFolder = "SISpace/tasks";
  const lessonGlobs: string[] = [];
  let inFolders = false;
  let inLessonGlobs = false;

  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      if (trimmed === "folders:") {
        inFolders = true;
        inLessonGlobs = false;
        continue;
      }
      if (trimmed === "lesson_search_globs:") {
        inLessonGlobs = true;
        inFolders = false;
        continue;
      }
      if (inLessonGlobs && trimmed.startsWith("- ")) {
        lessonGlobs.push(yamlScalar(trimmed.slice(2)));
        continue;
      }
      if (inFolders && line.startsWith("  ") && !line.startsWith("   ")) {
        const kv = trimmed.split(":");
        if (kv[0] === "tasks" && kv[1]) {
          tasksFolder = yamlScalar(kv.slice(1).join(":"));
        }
        continue;
      }
      if (!line.startsWith(" ")) {
        inFolders = false;
        inLessonGlobs = false;
      }
      if (trimmed.startsWith("vault_root:")) {
        vaultRoot = yamlScalar(trimmed.slice("vault_root:".length));
      } else if (trimmed.startsWith("vault_prefix:")) {
        vaultPrefix = yamlScalar(trimmed.slice("vault_prefix:".length));
      }
    }
  } catch {
    /* defaults */
  }

  const base = vaultPrefix.replace(/\/$/, "");
  const lessonPrefixes =
    lessonGlobs.length > 0
      ? lessonGlobs.map((g) => g.replace(/\*\*$/, ""))
      : [
          `${base}/accepted-lessons/`,
          `${base}/rejected-lessons/`,
          `${base}/user-model/`,
          `${base}/reasoning-patterns/`,
          `${tasksFolder}/`,
        ];

  return {
    vaultRoot,
    vaultPrefix: base,
    tasksFolder,
    lessonPrefixes,
  };
}

export function taskNoteVaultPath(
  config: ObsidianYamlConfig,
  taskId: string,
): string {
  const folder = config.tasksFolder.replace(/\/$/, "");
  return `${folder}/${taskId}.md`;
}
