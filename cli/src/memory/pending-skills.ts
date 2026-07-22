/**
 * Pending auto-skills awaiting accept/reject in SkillPicker.
 * Survives quit so the next cursorsi launch can prompt.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { projectCursorsiRoot, ensureProjectMemoryDirs } from "./paths.js";

export interface PendingSkillDraft {
  slug: string;
  content: string;
  sessionId?: string;
  createdAt: string;
}

function pendingPath(cwd: string): string {
  return join(projectCursorsiRoot(cwd), "pending-skills.json");
}

export function loadPendingSkills(cwd: string): PendingSkillDraft[] {
  const path = pendingPath(cwd);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      skills?: PendingSkillDraft[];
    };
    return Array.isArray(raw.skills)
      ? raw.skills.filter(
          (s) =>
            s &&
            typeof s.slug === "string" &&
            typeof s.content === "string" &&
            s.slug.trim() &&
            s.content.trim(),
        )
      : [];
  } catch {
    return [];
  }
}

export function savePendingSkills(
  cwd: string,
  skills: PendingSkillDraft[],
): void {
  ensureProjectMemoryDirs(cwd);
  const path = pendingPath(cwd);
  if (skills.length === 0) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ skills }, null, 2)}\n`,
    "utf8",
  );
}

export function enqueuePendingSkills(
  cwd: string,
  incoming: PendingSkillDraft[],
): PendingSkillDraft[] {
  if (incoming.length === 0) return loadPendingSkills(cwd);
  const existing = loadPendingSkills(cwd);
  const bySlug = new Map(existing.map((s) => [s.slug, s]));
  for (const s of incoming) {
    bySlug.set(s.slug, s);
  }
  const merged = [...bySlug.values()];
  savePendingSkills(cwd, merged);
  return merged;
}

export function removePendingSkill(cwd: string, slug: string): PendingSkillDraft[] {
  const next = loadPendingSkills(cwd).filter((s) => s.slug !== slug);
  savePendingSkills(cwd, next);
  return next;
}

export function clearPendingSkills(cwd: string): void {
  savePendingSkills(cwd, []);
}
