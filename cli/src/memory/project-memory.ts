/**
 * Load/inject project-local .cursorsi/memory + skill index for session start.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectMemoryDir, projectSkillsDir, AUTO_SKILL_SOURCE } from "./paths.js";

const MAX_MEMORY_CHARS = 6_000;
const MAX_FILE_CHARS = 1_200;
const MAX_SKILL_INDEX = 24;

export interface SkillIndexEntry {
  slug: string;
  description: string;
  auto: boolean;
  path: string;
}

function readCapped(path: string, max: number): string {
  try {
    const raw = readFileSync(path, "utf8");
    if (raw.length <= max) return raw.trim();
    return `${raw.slice(0, max).trim()}\n…(truncated)`;
  } catch {
    return "";
  }
}

/** Build a once-per-session injection block from .cursorsi/memory + skill names. */
export function buildProjectMemoryInjectBlock(cwd: string): string | null {
  const parts: string[] = [];
  const memDir = projectMemoryDir(cwd);
  if (existsSync(memDir)) {
    const files = readdirSync(memDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(0, 12);
    if (files.length > 0) {
      parts.push("## Project memory (.cursorsi/memory)", "");
      let used = 0;
      for (const f of files) {
        if (used >= MAX_MEMORY_CHARS) break;
        const body = readCapped(join(memDir, f), MAX_FILE_CHARS);
        if (!body) continue;
        const chunk = `### ${f}\n${body}\n`;
        parts.push(chunk);
        used += chunk.length;
      }
    }
  }

  const skills = listProjectSkills(cwd).slice(0, MAX_SKILL_INDEX);
  if (skills.length > 0) {
    parts.push("## Project skills (.cursorsi/skills)", "");
    for (const s of skills) {
      const tag = s.auto ? "auto" : "manual";
      parts.push(`- \`${s.slug}\` (${tag}): ${s.description || "(no description)"}`);
    }
    parts.push("");
  }

  const block = parts.join("\n").trim();
  return block || null;
}

export function listProjectSkills(cwd: string): SkillIndexEntry[] {
  const root = projectSkillsDir(cwd);
  if (!existsSync(root)) return [];
  const out: SkillIndexEntry[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  for (const slug of entries) {
    const skillPath = join(root, slug, "SKILL.md");
    try {
      if (!statSync(skillPath).isFile()) continue;
    } catch {
      continue;
    }
    const raw = readCapped(skillPath, 4_000);
    const auto = /(?:^|\n)source:\s*auto-skill(?:\n|$)/.test(raw);
    const descMatch =
      raw.match(/(?:^|\n)description:\s*["']?([^\n"']+)/) ||
      raw.match(/^#[^\n]*\n+([^\n]+)/m);
    out.push({
      slug,
      description: (descMatch?.[1] ?? "").trim().slice(0, 160),
      auto,
      path: skillPath,
    });
    void AUTO_SKILL_SOURCE;
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
