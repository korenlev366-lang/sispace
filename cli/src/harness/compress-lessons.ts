/**
 * /harness-compress — Regenerate Flash oneliners for accepted lessons.
 * Reads all lesson files from harness/memory/accepted-lessons/,
 * calls OpenRouter Flash (deepseek/deepseek-v4-flash) via the existing
 * OpenAI client, and updates harness/memory/lesson-index.json.
 */

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { findProjectRoot } from "../project/root.js";
import { tokenFromEnv } from "../sdk/session-agent.js";

export interface LessonIndexEntry {
  id: string;
  title: string;
  oneliner: string;
  tags: string[];
  file: string;
}

export interface LessonIndex {
  version: number;
  generated: string;
  source: string;
  entries: LessonIndexEntry[];
}

export interface CompressProgress {
  current: number;
  total: number;
  lessonId: string;
  oneliner: string;
}

export interface CompressResult {
  ok: boolean;
  message: string;
  compressed: number;
  errors: string[];
}

const FLASH_MODEL = "deepseek/deepseek-v4-flash";
const MAX_TOKENS = 150;
const MAX_LESSON_CHARS = 2000;

/**
 * Resolve the harness memory paths relative to the project root.
 */
function resolveHarnessPaths(cwd: string) {
  const root = findProjectRoot(cwd);
  return {
    lessonsDir: path.join(root, "harness", "memory", "accepted-lessons"),
    indexPath: path.join(root, "harness", "memory", "lesson-index.json"),
  };
}

/**
 * Call OpenRouter Flash to compress a single lesson.
 * Returns { oneliner, tags } or null on failure.
 */
async function compressLesson(
  client: OpenAI,
  lessonContent: string,
): Promise<{ oneliner: string; tags: string[] } | null> {
  const prompt = `Compress this lesson into EXACTLY:
1. oneliner: max 60 tokens, one sentence, captures the precise rule/fix/pattern
2. tags: 3-6 lowercase keywords (module names, concepts, bug types)

Respond ONLY as JSON: {"oneliner": "...", "tags": ["...", "..."]}

LESSON:
${lessonContent.slice(0, MAX_LESSON_CHARS)}`;

  try {
    const response = await client.chat.completions.create({
      model: FLASH_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return null;
    }

    // Try to parse JSON from the response — strip markdown fences if present
    let json = content;
    const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      json = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(json) as { oneliner: string; tags: string[] };
    if (!parsed.oneliner || !Array.isArray(parsed.tags)) {
      return null;
    }

    return {
      oneliner: parsed.oneliner.trim(),
      tags: parsed.tags
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 8),
    };
  } catch {
    return null;
  }
}

/**
 * Compress ALL lessons in the index sequentially.
 * Calls onProgress after each lesson.
 */
export async function compressAllLessons(
  cwd: string,
  onProgress?: (p: CompressProgress) => void,
): Promise<CompressResult> {
  const apiKey = tokenFromEnv()?.trim();
  if (!apiKey) {
    return {
      ok: false,
      message: "No OpenRouter API key in environment (set OPENROUTER_API_KEY).",
      compressed: 0,
      errors: [],
    };
  }

  const { lessonsDir, indexPath } = resolveHarnessPaths(cwd);

  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      message: `lesson-index.json not found at ${indexPath}`,
      compressed: 0,
      errors: [],
    };
  }

  // Read the index
  let index: LessonIndex;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as LessonIndex;
  } catch {
    return {
      ok: false,
      message: "Failed to parse lesson-index.json",
      compressed: 0,
      errors: [],
    };
  }

  // Filter to ACCEPTED entries only (we only compress accepted lessons)
  const acceptedEntries = index.entries.filter((e) =>
    e.id.startsWith("ACCEPTED"),
  );

  if (acceptedEntries.length === 0) {
    return {
      ok: false,
      message: "No ACCEPTED entries found in lesson-index.json",
      compressed: 0,
      errors: [],
    };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/lev/sispace",
      "X-Title": "SISpace harness-compress",
    },
  });

  let compressed = 0;
  const errors: string[] = [];
  const total = acceptedEntries.length;

  for (let i = 0; i < acceptedEntries.length; i++) {
    const entry = acceptedEntries[i]!;
    const filePath = path.join(lessonsDir, entry.file);

    // Read the lesson file
    let lessonContent: string;
    try {
      lessonContent = fs.readFileSync(filePath, "utf8");
    } catch {
      errors.push(`${entry.id}: file not found (${entry.file})`);
      onProgress?.({
        current: i + 1,
        total,
        lessonId: entry.id,
        oneliner: "[file not found]",
      });
      continue;
    }

    // Call Flash to compress
    const result = await compressLesson(client, lessonContent);
    if (!result) {
      errors.push(`${entry.id}: Flash compression failed`);
      onProgress?.({
        current: i + 1,
        total,
        lessonId: entry.id,
        oneliner: entry.oneliner.slice(0, 60) + "…",
      });
      continue;
    }

    // Update the entry in the index
    entry.oneliner = result.oneliner;
    entry.tags = result.tags;
    compressed++;

    // Brief title from oneliner
    entry.title = result.oneliner.slice(0, 80);

    onProgress?.({
      current: i + 1,
      total,
      lessonId: entry.id,
      oneliner: result.oneliner.slice(0, 60),
    });
  }

  // Write back the updated index
  index.generated = new Date().toISOString();
  index.source = "harness/memory/accepted-lessons/";
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");

  const message =
    compressed === total
      ? `Done — ${compressed} lessons compressed, lesson-index.json updated`
      : `Done — ${compressed}/${total} lessons compressed, ${errors.length} errors. lesson-index.json updated`;

  return { ok: true, message, compressed, errors };
}

/**
 * Compress a single lesson by its file path (for auto-compress on accept).
 * Upserts the result into the index: finds existing entry by id and updates it,
 * or appends a new entry if it doesn't exist.
 *
 * Used by post-task-chain.ts after a new lesson is accepted.
 */
export async function compressSingleLesson(
  cwd: string,
  lessonId: string,
  lessonFilePath: string,
): Promise<{ ok: boolean; message: string }> {
  const apiKey = tokenFromEnv()?.trim();
  if (!apiKey) {
    return { ok: false, message: "No OpenRouter API key." };
  }

  const { indexPath } = resolveHarnessPaths(cwd);

  if (!fs.existsSync(indexPath)) {
    return { ok: false, message: "lesson-index.json not found" };
  }

  let index: LessonIndex;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as LessonIndex;
  } catch {
    return { ok: false, message: "Failed to parse lesson-index.json" };
  }

  let lessonContent: string;
  try {
    lessonContent = fs.readFileSync(lessonFilePath, "utf8");
  } catch {
    return { ok: false, message: `Lesson file not found: ${lessonFilePath}` };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/lev/sispace",
      "X-Title": "SISpace harness-compress",
    },
  });

  const result = await compressLesson(client, lessonContent);
  if (!result) {
    return { ok: false, message: `Flash compression failed for ${lessonId}` };
  }

  // Clean the id for matching (strip trailing colon)
  const cleanId = lessonId.replace(/:$/, "");

  // Find existing entry by matching id (with or without trailing colon)
  const existing = index.entries.find(
    (e) => e.id.replace(/:$/, "") === cleanId,
  );

  const fileName = path.basename(lessonFilePath);

  if (existing) {
    existing.oneliner = result.oneliner;
    existing.tags = result.tags;
    existing.title = result.oneliner.slice(0, 80);
    existing.file = fileName;
  } else {
    // Append new entry
    index.entries.push({
      id: lessonId.endsWith(":") ? lessonId : `${lessonId}:`,
      title: result.oneliner.slice(0, 80),
      oneliner: result.oneliner,
      tags: result.tags,
      file: fileName,
    });
  }

  index.generated = new Date().toISOString();
  index.source = "harness/memory/accepted-lessons/";
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");

  return {
    ok: true,
    message: `Lesson ${lessonId} compressed and indexed`,
  };
}
