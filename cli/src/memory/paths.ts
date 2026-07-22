/**
 * Project-local Qwen-style memory/skills roots under .cursorsi/
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/root.js";

export const CURSORSI_DIR = ".cursorsi";
export const MEMORY_DIRNAME = "memory";
export const SKILLS_DIRNAME = "skills";
export const AUTO_SKILL_SOURCE = "auto-skill";

export function projectCursorsiRoot(cwd: string): string {
  return join(findProjectRoot(cwd), CURSORSI_DIR);
}

export function projectMemoryDir(cwd: string): string {
  return join(projectCursorsiRoot(cwd), MEMORY_DIRNAME);
}

export function projectSkillsDir(cwd: string): string {
  return join(projectCursorsiRoot(cwd), SKILLS_DIRNAME);
}

export function ensureProjectMemoryDirs(cwd: string): {
  memoryDir: string;
  skillsDir: string;
} {
  const memoryDir = projectMemoryDir(cwd);
  const skillsDir = projectSkillsDir(cwd);
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  return { memoryDir, skillsDir };
}

export function pathUnderSkillsDir(cwd: string, filePath: string): boolean {
  const root = projectSkillsDir(cwd);
  const normalized = filePath.replace(/\\/g, "/");
  const rootNorm = root.replace(/\\/g, "/");
  return normalized === rootNorm || normalized.startsWith(`${rootNorm}/`);
}

export function skillsDirExists(cwd: string): boolean {
  return existsSync(projectSkillsDir(cwd));
}
