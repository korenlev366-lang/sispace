/**
 * Qwen-style background extract: project memory + auto-skills under .cursorsi/
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getCliOptions } from "../runtime/cli-options.js";
import type { CliSession } from "../session/types.js";
import {
  loadUserSettings,
  type UserSettings,
} from "../config/user-settings.js";
import { reconstructTranscript } from "../harness/transcript.js";
import { openRouterPrompt } from "../sdk/openrouter.js";
import { DEFAULT_MODEL, loadModelConfig } from "../config/models.js";
import { findProjectRoot } from "../project/root.js";
import { listProjectSkills } from "./project-memory.js";
import {
  AUTO_SKILL_SOURCE,
  ensureProjectMemoryDirs,
  projectMemoryDir,
} from "./paths.js";

type GlobalCk = {
  __cursorsiCk?: string;
  __cursorsiCursorKey?: string;
};

function openRouterKey(): string | undefined {
  return (
    (globalThis as GlobalCk).__cursorsiCk ??
    process.env.OPENROUTER_API_KEY?.trim()
  );
}

function cursorKey(): string | undefined {
  return (
    (globalThis as GlobalCk).__cursorsiCursorKey ??
    process.env.CURSOR_API_KEY?.trim()
  );
}

export const AUTO_SKILL_TOOL_THRESHOLD = 20;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_NEW_SKILLS = 2;
const MAX_SKILL_LINES = 80;
const EXTRACT_TIMEOUT_NOTE = "auto-extract";

export interface MemorySettingsResolved {
  enableAutoMemory: boolean;
  enableAutoSkill: boolean;
}

export function resolveMemorySettings(
  settings: UserSettings = loadUserSettings(),
): MemorySettingsResolved {
  const mem = settings.memory;
  return {
    enableAutoMemory: mem?.enableAutoMemory !== false,
    enableAutoSkill: mem?.enableAutoSkill !== false,
  };
}

type ExtractPayload = {
  memories?: Array<{ filename: string; content: string }>;
  skills?: Array<{ slug: string; content: string }>;
  summary?: string;
};

const EXTRACTED_SESSION_IDS = new Set<string>();

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "skill";
}

function safeMemoryFilename(raw: string): string | null {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
}

function ensureAutoSkillFrontmatter(content: string, slug: string): string {
  const body = content.trim();
  if (/^---\n[\s\S]*?\nsource:\s*auto-skill\b[\s\S]*?\n---/.test(body)) {
    return body.endsWith("\n") ? body : `${body}\n`;
  }
  // Strip existing frontmatter if present without auto-skill
  const stripped = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const title = slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  return [
    "---",
    `name: ${slug}`,
    `description: Auto-extracted skill for ${title}`,
    `source: ${AUTO_SKILL_SOURCE}`,
    "---",
    "",
    `# ${title}`,
    "",
    stripped || "Procedural notes extracted from a cursorsi session.",
    "",
  ].join("\n");
}

function canWriteAutoSkill(skillPath: string): boolean {
  if (!existsSync(skillPath)) return true;
  try {
    const existing = readFileSync(skillPath, "utf8");
    return /(?:^|\n)source:\s*auto-skill(?:\n|$)/.test(existing);
  } catch {
    return false;
  }
}

function capSkillLines(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= MAX_SKILL_LINES) return content;
  return `${lines.slice(0, MAX_SKILL_LINES).join("\n")}\n`;
}

function parseExtractJson(text: string): ExtractPayload | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ExtractPayload;
  } catch {
    return null;
  }
}

function buildExtractPrompt(opts: {
  transcript: string;
  wantMemory: boolean;
  wantSkill: boolean;
  toolCallCount: number;
  existingMemoryNames: string[];
  existingAutoSkillSlugs: string[];
}): { system: string; user: string } {
  const system = [
    "You extract durable project knowledge from a coding-agent transcript.",
    "Return ONLY a JSON object (no prose) with this shape:",
    '{',
    '  "summary": "one short line",',
    '  "memories": [{"filename":"prefs.md","content":"markdown..."}],',
    '  "skills": [{"slug":"kebab-case","content":"full SKILL.md markdown"}]',
    '}',
    "Rules:",
    "- memories = declarative facts (user prefs, project conventions, feedback). Max 3 files, short.",
    "- skills = procedural how-to for reusable workflows. Max 2. Only if a clear reusable pattern exists.",
    `- Skill content MUST include YAML frontmatter with source: ${AUTO_SKILL_SOURCE}.`,
    "- Prefer updating themes already listed rather than inventing noise.",
    "- If nothing durable, return empty arrays.",
    "- Never invent secrets, tokens, or personal data.",
  ].join("\n");

  const user = [
    `Tool calls this session: ${opts.toolCallCount}`,
    `Extract memory: ${opts.wantMemory}`,
    `Extract skills: ${opts.wantSkill}`,
    opts.existingMemoryNames.length
      ? `Existing memory files: ${opts.existingMemoryNames.join(", ")}`
      : "Existing memory files: (none)",
    opts.existingAutoSkillSlugs.length
      ? `Existing auto-skills: ${opts.existingAutoSkillSlugs.join(", ")}`
      : "Existing auto-skills: (none)",
    "",
    "## Transcript",
    opts.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
  ].join("\n");

  return { system, user };
}

async function runExtractModel(
  system: string,
  user: string,
  cwd: string,
): Promise<string | null> {
  const orKey = openRouterKey()?.trim();
  if (orKey) {
    const projectRoot = findProjectRoot(cwd);
    const cfg = loadModelConfig(projectRoot);
    const model = cfg.default?.trim() || DEFAULT_MODEL;
    const result = await openRouterPrompt(user, {
      apiKey: orKey,
      model,
      systemPrompt: system,
    });
    if (result.status === "finished" && result.result?.trim()) {
      return result.result.trim();
    }
  }

  // Cursor-only fallback: cheap one-shot via SDK text (no tools).
  const cKey = cursorKey()?.trim();
  if (!cKey) return null;
  try {
    const { CursorAgent } = await import("../sdk/cursor-agent-backend.js");
    const agent = await CursorAgent.create({
      model: { id: "composer-2" },
      apiKey: cKey,
      cwd,
      name: "cursorsi-auto-extract",
    });
    try {
      const result = await agent.runTurn(
        `${system}\n\n${user}\n\nReply with JSON only.`,
      );
      return result.result?.trim() || null;
    } finally {
      agent.close();
    }
  } catch {
    return null;
  }
}

export interface AutoExtractResult {
  launched: boolean;
  skipped?: string;
  memoryFiles?: string[];
  skillSlugs?: string[];
  summary?: string;
}

/**
 * Fire-and-forget extract after session end. Safe to call multiple times per session id.
 */
export function triggerAutoExtractOnSessionEnd(
  session: CliSession,
  opts?: { onNotice?: (line: string) => void },
): void {
  if (getCliOptions().noReflect) return;
  if (EXTRACTED_SESSION_IDS.has(session.id)) return;
  EXTRACTED_SESSION_IDS.add(session.id);

  const flags = resolveMemorySettings();
  if (!flags.enableAutoMemory && !flags.enableAutoSkill) return;

  const toolCallCount = session.toolCallCount ?? 0;
  const wantSkill =
    flags.enableAutoSkill &&
    !session.skillsDirTouched &&
    toolCallCount >= AUTO_SKILL_TOOL_THRESHOLD;
  const wantMemory = flags.enableAutoMemory;

  if (!wantMemory && !wantSkill) return;

  // Background — do not block quit.
  void runAutoExtract(session, { wantMemory, wantSkill, toolCallCount })
    .then((result) => {
      if (!result.launched) return;
      const bits: string[] = [];
      if (result.memoryFiles?.length) {
        bits.push(`memory:${result.memoryFiles.join(",")}`);
      }
      if (result.skillSlugs?.length) {
        bits.push(`skills:${result.skillSlugs.join(",")}`);
      }
      if (bits.length === 0 && result.summary) {
        bits.push(result.summary);
      }
      if (bits.length > 0) {
        opts?.onNotice?.(`› auto-extract: ${bits.join(" · ")}`);
      }
    })
    .catch(() => {
      // silent — background job
    });
}

export async function runAutoExtract(
  session: CliSession,
  opts: {
    wantMemory: boolean;
    wantSkill: boolean;
    toolCallCount: number;
  },
): Promise<AutoExtractResult> {
  void EXTRACT_TIMEOUT_NOTE;
  const transcript = reconstructTranscript(session).trim();
  if (transcript.length < 80) {
    return { launched: false, skipped: "transcript_too_short" };
  }

  const { memoryDir, skillsDir } = ensureProjectMemoryDirs(session.cwd);
  let existingMemoryNames: string[] = [];
  try {
    existingMemoryNames = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
  } catch {
    existingMemoryNames = [];
  }

  const existingAutoSkillSlugs = listProjectSkills(session.cwd)
    .filter((s) => s.auto)
    .map((s) => s.slug);

  const prompts = buildExtractPrompt({
    transcript,
    wantMemory: opts.wantMemory,
    wantSkill: opts.wantSkill,
    toolCallCount: opts.toolCallCount,
    existingMemoryNames,
    existingAutoSkillSlugs,
  });

  const raw = await runExtractModel(prompts.system, prompts.user, session.cwd);
  if (!raw) {
    return { launched: false, skipped: "no_model_result" };
  }

  const payload = parseExtractJson(raw);
  if (!payload) {
    return { launched: false, skipped: "bad_json" };
  }

  const memoryFiles: string[] = [];
  const skillSlugs: string[] = [];

  if (opts.wantMemory && Array.isArray(payload.memories)) {
    for (const item of payload.memories.slice(0, 3)) {
      const name = safeMemoryFilename(String(item?.filename ?? ""));
      const content = String(item?.content ?? "").trim();
      if (!name || !content) continue;
      const path = join(memoryDir, name);
      writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      memoryFiles.push(name);
    }
  }

  if (opts.wantSkill && Array.isArray(payload.skills)) {
    for (const item of payload.skills.slice(0, MAX_NEW_SKILLS)) {
      const slug = slugify(String(item?.slug ?? ""));
      if (!slug) continue;
      const dir = join(skillsDir, slug);
      const skillPath = join(dir, "SKILL.md");
      if (!canWriteAutoSkill(skillPath)) continue;
      const content = capSkillLines(
        ensureAutoSkillFrontmatter(String(item?.content ?? ""), slug),
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(skillPath, content, "utf8");
      skillSlugs.push(slug);
    }
  }

  // Touch marker for debugging
  try {
    writeFileSync(
      join(projectMemoryDir(session.cwd), ".last-extract.json"),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          sessionId: session.id,
          memoryFiles,
          skillSlugs,
          summary: payload.summary ?? null,
          toolCallCount: opts.toolCallCount,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // ignore
  }

  return {
    launched: true,
    memoryFiles,
    skillSlugs,
    summary: payload.summary,
  };
}
