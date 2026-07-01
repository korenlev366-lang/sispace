import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SkillBundleName = "feature" | "bug" | "docs";

const BUNDLE_FILES: Record<SkillBundleName, string> = {
  feature: "feature.yaml",
  bug: "bug.yaml",
  docs: "docs.yaml",
};

/** Load `prompt: |` block from config/skill-bundles/<name>.yaml (matches pipeline-lib). */
export function loadSkillBundle(
  projectRoot: string,
  taskType: SkillBundleName,
): string {
  const bundlePath = join(
    projectRoot,
    "config",
    "skill-bundles",
    BUNDLE_FILES[taskType],
  );
  if (!existsSync(bundlePath)) {
    return "";
  }
  const raw = readFileSync(bundlePath, "utf8");
  const lines = raw.split("\n");
  let inPrompt = false;
  const promptLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === "prompt: |") {
      inPrompt = true;
      continue;
    }
    if (inPrompt) {
      if (/^\S/.test(line) && line.trim()) {
        break;
      }
      promptLines.push(line.replace(/^  /, ""));
    }
  }
  return promptLines.join("\n").trim();
}

export function skillBundleLabel(name: SkillBundleName): string {
  return name;
}
