/**
 * Compress a single lesson via OpenRouter Flash (deepseek/deepseek-v4-flash).
 * Uses the native @openrouter/agent SDK client.
 *
 * Called by post-task-chain.ts after a lesson is accepted to keep
 * lesson-index.json current without requiring a full /harness-compress run.
 */

import fs from "node:fs";
import path from "node:path";
import { createOpenRouterClient } from "./openrouter.js";

const FLASH_MODEL = "deepseek/deepseek-v4-flash";
const MAX_TOKENS = 150;
const MAX_LESSON_CHARS = 2000;

interface FlashCompression {
  oneliner: string;
  tags: string[];
}

interface LessonIndexEntry {
  id: string;
  title: string;
  oneliner: string;
  tags: string[];
  file: string;
}

interface LessonIndex {
  version: number;
  generated: string;
  source: string;
  entries: LessonIndexEntry[];
}

/**
 * Call OpenRouter Flash to compress a single lesson.
 * Returns { oneliner, tags } or null on failure.
 */
async function compressLessonContent(
  apiKey: string,
  lessonContent: string,
): Promise<FlashCompression | null> {
  const prompt = `Compress this lesson into EXACTLY:
1. oneliner: max 60 tokens, one sentence, captures the precise rule/fix/pattern
2. tags: 3-6 lowercase keywords (module names, concepts, bug types)

Respond ONLY as JSON: {"oneliner": "...", "tags": ["...", "..."]}

LESSON:
${lessonContent.slice(0, MAX_LESSON_CHARS)}`;

  try {
    const client = createOpenRouterClient(apiKey);
    // Use callModel for a one-shot prompt
    const result = client.callModel({
      model: FLASH_MODEL,
      maxOutputTokens: MAX_TOKENS,
      input: prompt,
    });

    let text = (await result.getText()).trim();

    if (!text) return null;

    // Try to parse JSON — strip markdown fences if present
    let json = text;
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
 * Write the accepted lesson as an individual file in accepted-lessons/,
 * compress it via Flash, and upsert the result into lesson-index.json.
 *
 * @param memoryRoot  - path to SISpace root (contains harness/memory/)
 * @param apiKey      - OpenRouter API key
 * @param proposalId  - e.g. "PROP-20260604-005"
 * @param lessonBody  - the full lesson content (markdown)
 */
export async function compressAcceptedLesson(
  memoryRoot: string,
  apiKey: string,
  proposalId: string,
  lessonBody: string,
): Promise<{ ok: boolean; message: string }> {
  if (!apiKey?.trim()) {
    return { ok: false, message: "No OpenRouter API key" };
  }

  const lessonsDir = path.join(memoryRoot, "harness", "memory", "accepted-lessons");
  const indexPath = path.join(memoryRoot, "harness", "memory", "lesson-index.json");

  // Ensure directory exists
  fs.mkdirSync(lessonsDir, { recursive: true });

  // Build safe filename from proposal ID
  const safeName = proposalId.replace(/[^A-Za-z0-9._-]/g, "_");
  const fileName = `${safeName}.md`;
  const filePath = path.join(lessonsDir, fileName);

  // Write individual lesson file
  const fileContent = `### ${proposalId}\n\n${lessonBody.trim()}\n`;
  fs.writeFileSync(filePath, fileContent, "utf8");

  // Compress via Flash
  const compression = await compressLessonContent(apiKey, lessonBody);
  if (!compression) {
    // Still update the index with fallback values
    const oneliner = lessonBody.split("\n").find((l) => l.trim().length > 10)?.trim().slice(0, 160) ?? proposalId;
    const tags = ["harness", "accepted"];
    return upsertLessonIndex(indexPath, proposalId, oneliner, tags, fileName);
  }

  return upsertLessonIndex(
    indexPath,
    proposalId,
    compression.oneliner,
    compression.tags,
    fileName,
  );
}

function upsertLessonIndex(
  indexPath: string,
  proposalId: string,
  oneliner: string,
  tags: string[],
  fileName: string,
): { ok: boolean; message: string } {
  let index: LessonIndex;
  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as LessonIndex;
    } else {
      index = {
        version: 1,
        generated: new Date().toISOString(),
        source: "harness/memory/accepted-lessons/",
        entries: [],
      };
    }
  } catch {
    return { ok: false, message: "Failed to parse lesson-index.json" };
  }

  // Clean the id for matching (strip trailing colon)
  const cleanId = proposalId.replace(/:$/, "");

  const existing = index.entries.find(
    (e) => e.id.replace(/:$/, "") === cleanId,
  );

  if (existing) {
    existing.oneliner = oneliner;
    existing.tags = tags;
    existing.title = oneliner.slice(0, 80);
    existing.file = fileName;
  } else {
    index.entries.push({
      id: proposalId.endsWith(":") ? proposalId : `${proposalId}:`,
      title: oneliner.slice(0, 80),
      oneliner,
      tags,
      file: fileName,
    });
  }

  index.generated = new Date().toISOString();
  index.source = "harness/memory/accepted-lessons/";
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");

  return {
    ok: true,
    message: `Lesson ${proposalId} compressed and indexed`,
  };
}
