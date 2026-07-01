import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface LessonFile {
  filename: string;
  content: string;
}

// ── Harness root discovery ────────────────────────────────────────────────

/**
 * Find the harness root by walking up from startCwd looking for
 * harness/memory/ directory, or using git rev-parse --show-toplevel.
 */
export function findHarnessRoot(startCwd: string): string | null {
  // First try walking up for harness/memory/
  let dir = startCwd;
  for (;;) {
    if (existsSync(join(dir, "harness", "memory"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: git rev-parse --show-toplevel, then check for harness/memory/
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startCwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout?.trim()) {
      const gitRoot = result.stdout.trim();
      if (existsSync(join(gitRoot, "harness", "memory"))) {
        return gitRoot;
      }
    }
  } catch {
    // git not available
  }

  return null;
}

/** Resolve a path relative to the harness root. */
function memoryPath(harnessRoot: string, filename: string): string {
  return join(harnessRoot, "harness", "memory", filename);
}

// ── File readers ──────────────────────────────────────────────────────────

/** Read a single memory file, returns null if missing/unreadable. */
function readMemoryFile(harnessRoot: string, filename: string): string | null {
  const path = memoryPath(harnessRoot, filename);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read user-model.md in full from harness memory.
 * Returns null if the file is missing.
 */
export function readUserModelFull(harnessRoot: string): string | null {
  return readMemoryFile(harnessRoot, "user-model.md");
}

/**
 * Read reasoning-patterns.md in full from harness memory.
 * Returns null if the file is missing.
 */
export function readReasoningPatternsFull(harnessRoot: string): string | null {
  return readMemoryFile(harnessRoot, "reasoning-patterns.md");
}

// ── Keyword extraction ────────────────────────────────────────────────────

/**
 * Extract meaningful keywords from a user message for matching.
 * Returns unique lowercase words longer than 2 characters, excluding common noise words.
 */
export function extractKeywords(text: string): string[] {
  const STOP_WORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "been", "some", "what",
    "which", "their", "them", "then", "than", "that", "this", "with", "will",
    "would", "could", "should", "about", "into", "over", "after", "also",
    "its", "just", "like", "make", "more", "much", "other", "such", "than",
    "very", "way", "well", "how", "why", "get", "use", "put", "tell",
  ]);
  const words = text.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g);
  if (!words) return [];
  const filtered = words
    .map((w) => w.toLowerCase())
    .filter((w) => !STOP_WORDS.has(w) && w.length > 2);
  return [...new Set(filtered)];
}

// ── Section extraction ────────────────────────────────────────────────────

/**
 * Split a markdown document into sections by `### ` headings.
 * Returns an array of { heading, body } objects.
 */
function splitSections(content: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  // Split on lines that start with "### " (markdown H3 headings)
  const lines = content.split("\n");
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n") });
      }
      currentHeading = line;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  }

  return sections;
}

/**
 * Extract sections from a memory file that match any of the given keywords.
 * Matching is case-insensitive and checks both heading and body.
 *
 * @param content - Full file content
 * @param keywords - Keywords to match against
 * @param maxSections - Maximum number of sections to return (0 = unlimited)
 * @returns Array of { heading, body } objects
 */
export function extractMatchingSections(
  content: string,
  keywords: string[],
  maxSections = 0,
): Array<{ heading: string; body: string }> {
  if (keywords.length === 0) {
    return [];
  }

  // Strip preamble before first `### ` heading (document title, template, etc.)
  const firstHeadingIdx = content.indexOf("\n### ");
  const bodyStart = firstHeadingIdx >= 0 ? content.slice(firstHeadingIdx + 1) : content;

  const sections = splitSections(bodyStart);
  const kwLower = keywords.map((k) => k.toLowerCase());

  const matched: Array<{ heading: string; body: string; score: number }> = [];

  for (const section of sections) {
    const combined = (section.heading + "\n" + section.body).toLowerCase();
    let score = 0;
    for (const kw of kwLower) {
      if (combined.includes(kw)) {
        score++;
      }
    }
    if (score > 0) {
      matched.push({ ...section, score });
    }
  }

  // Sort by score descending (best match first)
  matched.sort((a, b) => b.score - a.score);

  if (maxSections > 0 && matched.length > maxSections) {
    matched.length = maxSections;
  }

  return matched.map(({ heading, body }) => ({ heading, body }));
}

// ── High-level fetchers ───────────────────────────────────────────────────

/**
 * Fetch lesson sections from accepted-lessons.md filtered by keywords.
 *
 * @param filterText - User message text to extract keywords from (or undefined for all)
 * @param maxSections - Maximum number of matching sections to return
 * @param harnessRoot - Pre-resolved harness root, or null to auto-detect
 */
export function fetchLessonSections(
  filterText?: string,
  maxSections = 8,
  harnessRoot?: string | null,
): Array<{ heading: string; body: string }> {
  const root = harnessRoot ?? findHarnessRoot(process.cwd());
  if (!root) return [];

  const content = readMemoryFile(root, "accepted-lessons.md");
  if (!content) return [];

  const keywords = filterText ? extractKeywords(filterText) : [];
  if (keywords.length === 0) {
    // No filter — return first N sections (skip preamble)
    const firstHeadingIdx = content.indexOf("\n### ");
    const bodyStart = firstHeadingIdx >= 0 ? content.slice(firstHeadingIdx + 1) : content;
    const sections = splitSections(bodyStart);
    return sections.slice(0, maxSections).map(({ heading, body }) => ({ heading, body }));
  }

  return extractMatchingSections(content, keywords, maxSections);
}

/**
 * Fetch sections from reasoning-patterns.md filtered by keywords.
 */
export function fetchReasoningPatternSections(
  filterText?: string,
  maxSections = 4,
  harnessRoot?: string | null,
): Array<{ heading: string; body: string }> {
  const root = harnessRoot ?? findHarnessRoot(process.cwd());
  if (!root) return [];

  const content = readMemoryFile(root, "reasoning-patterns.md");
  if (!content) return [];

  const keywords = filterText ? extractKeywords(filterText) : [];
  if (keywords.length === 0) return [];

  return extractMatchingSections(content, keywords, maxSections);
}

// ── Legacy API compatibility ──────────────────────────────────────────────

/**
 * (Replaces old Obsidian REST API call) Fetch lesson content from
 * harness/memory/ files using direct filesystem reads.
 *
 * Returns LessonFile[] mimicking the old shape for backward compatibility
 * with formatLessonFilesAsContext.
 */
export async function fetchRecentLessonFiles(
  filterText?: string,
  maxLessons = 8,
  _maxGnuClient = 4, // kept for compatibility; no longer separates GNUClient
): Promise<LessonFile[]> {
  const root = findHarnessRoot(process.cwd());
  if (!root) return [];

  const lessons: LessonFile[] = [];

  // 1. user-model.md — always included first
  const userModel = readUserModelFull(root);
  if (userModel) {
    lessons.push({
      filename: "harness/memory/user-model.md",
      content: userModel,
    });
  }

  // 2. accepted-lessons.md — matching sections
  const content = readMemoryFile(root, "accepted-lessons.md");
  if (content) {
    const keywords = filterText ? extractKeywords(filterText) : [];
    let sections: Array<{ heading: string; body: string }>;

    if (keywords.length > 0) {
      sections = extractMatchingSections(content, keywords, maxLessons);
    } else {
      // No filter — return first N sections
      const firstHeadingIdx = content.indexOf("\n### ");
      const bodyStart = firstHeadingIdx >= 0 ? content.slice(firstHeadingIdx + 1) : content;
      sections = splitSections(bodyStart).slice(0, maxLessons);
    }

    for (const section of sections) {
      lessons.push({
        filename: `harness/memory/accepted-lessons.md — ${section.heading.replace(/^###\s*/, "")}`,
        content: `${section.heading}\n${section.body}`,
      });
    }
  }

  // 3. reasoning-patterns.md — matching sections
  const rpContent = readMemoryFile(root, "reasoning-patterns.md");
  if (rpContent && filterText) {
    const keywords = extractKeywords(filterText);
    const rpSections = extractMatchingSections(rpContent, keywords, _maxGnuClient);
    for (const section of rpSections) {
      lessons.push({
        filename: `harness/memory/reasoning-patterns.md — ${section.heading.replace(/^###\s*/, "")}`,
        content: `${section.heading}\n${section.body}`,
      });
    }
  }

  return lessons;
}

/**
 * Format lesson files into a single concatenated context block string.
 * Strips YAML frontmatter and concatenates content with headings.
 */
export function formatLessonFilesAsContext(lessons: LessonFile[]): string {
  if (lessons.length === 0) {
    return (
      "## Relevant harness lessons\n\n" +
      "(no lesson notes matched)\n"
    );
  }

  const lines: string[] = [
    "## Relevant harness lessons",
    "",
    `Found ${lessons.length} relevant lesson(s) from harness memory:`,
    "",
  ];
  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    lines.push(`### ${i + 1}. ${lesson.filename}`);
    lines.push("");
    // Strip YAML frontmatter if present
    const content = lesson.content.replace(/^---[\s\S]*?---\n*/, "").trim();
    lines.push(content);
    lines.push("");
  }

  return lines.join("\n");
}