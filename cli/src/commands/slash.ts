/**
 * Slash command router — Phase 0c (FTS /search + 0b reflect, grade, bundles).
 * @see CURSORSI_CLI_PLAN.md § Slash commands
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { runHarnessReflect } from "../harness/invoke-chain.js";
import { runHarnessGrade } from "../harness/grade.js";
import { compressAllLessons } from "../harness/compress-lessons.js";
import { findProjectRoot } from "../project/root.js";
import {
  loadSkillBundle,
  skillBundleLabel,
  type SkillBundleName,
} from "../skills/bundles.js";
import { loadObsidianYaml } from "../obsidian/config.js";
import { loadUserSettings, saveUserSettings, userSettingsPath } from "../config/user-settings.js";
import { DEFAULT_MODEL } from "../config/models.js";
import { CURSOR_DEFAULT_MODEL_ID } from "../models/catalog.js";
import { fetchLessonContextForQuery } from "../obsidian/recall.js";
import { parseSearchSlashArgs } from "../search/parse-args.js";
import { formatSearchResult, runTaskSearch } from "../search/run-search.js";
import {
  attachGoalForExplicitUse,
  attachGoalResume,
  sessionPatchForGoalInject,
} from "../goal/session-attach.js";
import { formatGoalStatusInline } from "../goal/status.js";
import { loadActiveGoalIncludingStale } from "../goal/persist.js";
import { isGoalStaleForSession } from "../goal/stale.js";
import { exportHandoff } from "../handoff/io.js";
import { getSwarmGraph } from "../sispace/swarm.js";
import { runSessionCompaction } from "../session/compaction.js";
import { tokenFromEnv } from "../sdk/session-agent.js";
import {
  extractSlashInvocation,
  isRegisteredSlashCommand,
  parseSlashCommandKey,
} from "./slash-catalog.js";
import type { CliSession } from "../session/types.js";

export interface SlashResult {
  ok: boolean;
  message: string;
  sessionPatch?: Partial<CliSession>;
  /** Open interactive model picker (Cursor SDK catalog). */
  openModelPicker?: "orchestrator" | "subagent";
}

export interface SlashContext {
  session: CliSession;
  pushLine: (line: string) => void;
  setBusy: (busy: boolean) => void;
}

const PLACEHOLDER_COMMANDS: Record<string, string> = {
  handoff: "Export session blob for terminal attach.",
  harness: "Harness status summary (Phase 1a).",
  help: "Slash: /search /reflect /grade /handoff /swarm /goal /compact /harness /harness-compress /doctor /feature /bug /docs /recall /model /subagent-model /subagents",
};

async function handleSearch(
  ctx: SlashContext,
  rest: string,
): Promise<SlashResult> {
  const mode = parseSearchSlashArgs(rest);
  if (!mode) {
    return {
      ok: false,
      message:
        'Usage: /search <query> | /search --task <id> --before <id> | /search --task <id> --offset 0 --limit 50',
    };
  }

  ctx.setBusy(true);
  try {
    const result = runTaskSearch(mode);
    if (!result) {
      return {
        ok: false,
        message:
          "Shared tasks database not found. Run SISpace once or set SISPACE_DB_PATH.",
      };
    }
    const lines = formatSearchResult(result);
    for (const line of lines) {
      ctx.pushLine(line);
    }
    const summary =
      "hits" in result
        ? `${result.hits.length} task(s) in ${result.elapsed_ms}ms`
        : "messages" in result && "total" in result
          ? `${result.messages.length} message(s)`
          : `${result.messages.length} message(s)`;
    return { ok: true, message: `Search complete — ${summary}` };
  } finally {
    ctx.setBusy(false);
  }
}

async function handleRecall(
  ctx: SlashContext,
  query: string,
): Promise<SlashResult> {
  if (!query) {
    return { ok: false, message: "/recall requires a query string." };
  }
  ctx.setBusy(true);
  try {
    const projectRoot = findProjectRoot(ctx.session.cwd);
    const config = loadObsidianYaml(projectRoot);
    const block = await fetchLessonContextForQuery(query, config);
    return {
      ok: true,
      message: `Recalled Obsidian lessons for: "${query}" (injected on next agent turn).`,
      sessionPatch: {
        obsidianContextBlock: block,
        contextInjected: false,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Recall failed: ${msg}` };
  } finally {
    ctx.setBusy(false);
  }
}

async function handleCompact(
  ctx: SlashContext,
  rest: string,
): Promise<SlashResult> {
  const credential = tokenFromEnv() ?? "";
  ctx.setBusy(true);
  ctx.pushLine("› Compacting session context…");
  try {
    const result = await runSessionCompaction(ctx.session, credential, {
      force: true,
      instructions: rest.trim() || undefined,
    });
    if (!result.ok) {
      return { ok: false, message: result.error ?? "Compaction failed" };
    }
    const n = result.messagesSummarized ?? 0;
    const m = result.messagesKept ?? 0;
    return {
      ok: true,
      message: `Compacted — summarized ${n} messages, keeping last ${m}`,
      sessionPatch: result.sessionPatch,
    };
  } finally {
    ctx.setBusy(false);
  }
}

async function handleReflect(ctx: SlashContext): Promise<SlashResult> {
  ctx.setBusy(true);
  ctx.pushLine("› Running reflection (invoke-chain)…");
  try {
    const result = await runHarnessReflect(ctx.session);
    return result;
  } finally {
    ctx.setBusy(false);
  }
}

async function handleGrade(ctx: SlashContext): Promise<SlashResult> {
  ctx.setBusy(true);
  ctx.pushLine("› Grading latest reflection…");
  try {
    return await runHarnessGrade(ctx.session);
  } finally {
    ctx.setBusy(false);
  }
}

function handleHandoff(ctx: SlashContext, rest: string): SlashResult {
  const sub = rest.trim().toLowerCase();
  if (sub !== "export") {
    return { ok: false, message: "Usage: /handoff export" };
  }
  const result = exportHandoff(ctx.session, ctx.session.cwd);
  if (!result.ok) {
    return { ok: false, message: result.error ?? "handoff export failed" };
  }
  return {
    ok: true,
    message: `Handoff exported: ${result.path}`,
  };
}

function handleSwarm(ctx: SlashContext, rest: string): SlashResult {
  const sub = rest.trim().toLowerCase();
  if (sub && sub !== "status") {
    return { ok: false, message: "Usage: /swarm | /swarm status" };
  }

  const taskId = ctx.session.taskId;
  if (!taskId) {
    return {
      ok: false,
      message: "No linked task. Resume with --resume <task-id> first.",
    };
  }

  const graph = getSwarmGraph(taskId);
  if (!graph) {
    return {
      ok: false,
      message: `No swarm graph for task ${taskId}. Run: cursorsi swarm ${taskId}`,
    };
  }

  ctx.pushLine(
    `swarm ${graph.root_id}: ${graph.root_title} (${graph.root_status})`,
  );
  ctx.pushLine(`  workers: ${graph.workers.length} complete=${graph.workers_complete}`);
  for (const w of graph.workers) {
    ctx.pushLine(`    ${w.task_id} ${w.status} — ${w.title}`);
  }
  if (graph.verifier) {
    ctx.pushLine(
      `  verifier: ${graph.verifier.task_id} ${graph.verifier.status} passed=${graph.verifier_passed}`,
    );
  }
  if (graph.synthesizer) {
    ctx.pushLine(
      `  synthesizer: ${graph.synthesizer.task_id} ${graph.synthesizer.status}`,
    );
  }

  return { ok: true, message: "Swarm status shown above." };
}

function handleGoal(ctx: SlashContext, rest: string): SlashResult {
  const sub = rest.toLowerCase().trim();

  if (sub === "resume") {
    const result = attachGoalResume(ctx.session.cwd, ctx.session);
    const onDisk = loadActiveGoalIncludingStale(ctx.session.cwd);
    const text = formatGoalStatusInline(onDisk ?? undefined, {
      stale: onDisk
        ? isGoalStaleForSession(onDisk, ctx.session.createdAt)
        : false,
    });
    for (const line of text.split("\n")) {
      ctx.pushLine(line);
    }
    return {
      ok: !!result.goal,
      message: result.message,
      ...(result.goal
        ? { sessionPatch: sessionPatchForGoalInject(result.goal, { resumed: true }) }
        : {}),
    };
  }

  if (sub === "list" || sub === "status" || !sub) {
    const onDisk = loadActiveGoalIncludingStale(ctx.session.cwd);
    const stale = onDisk
      ? isGoalStaleForSession(onDisk, ctx.session.createdAt)
      : false;
    const text = formatGoalStatusInline(onDisk ?? undefined, { stale });
    for (const line of text.split("\n")) {
      ctx.pushLine(line);
    }
    const attach = attachGoalForExplicitUse(ctx.session.cwd, ctx.session);
    return {
      ok: true,
      message: attach.message,
      ...(attach.goal
        ? { sessionPatch: sessionPatchForGoalInject(attach.goal) }
        : {}),
    };
  }

  return {
    ok: false,
    message:
      'Usage: /goal | /goal status | /goal resume — set via: cursorsi goal set "…" --verify "cmd"',
  };
}

function handleSkillBundle(
  ctx: SlashContext,
  bundle: SkillBundleName,
): SlashResult {
  const projectRoot = findProjectRoot(ctx.session.cwd);
  const prompt = loadSkillBundle(projectRoot, bundle);
  if (!prompt) {
    return {
      ok: false,
      message: `Skill bundle "${bundle}" not found under config/skill-bundles/.`,
    };
  }
  return {
    ok: true,
    message: `Loaded /${skillBundleLabel(bundle)} bundle — injected on next agent turn.`,
    sessionPatch: {
      skillBundle: bundle,
      skillBundlePrompt: prompt,
    },
  };
}

async function handleHarnessCompress(
  ctx: SlashContext,
  rest: string,
): Promise<SlashResult> {
  const query = rest.trim().toLowerCase();
  if (query === "help" || query === "--help") {
    return {
      ok: true,
      message:
        "/harness-compress — Re-compress lesson index: regenerate Flash oneliners for all accepted lessons. Usage: /harness-compress [single <lesson-id>]",
    };
  }

  ctx.setBusy(true);
  try {
    const result = await compressAllLessons(
      ctx.session.cwd,
      (progress) => {
        ctx.pushLine(
          `› Compressing lesson ${progress.current}/${progress.total}: ${progress.lessonId} — ${progress.oneliner.slice(0, 60)}`,
        );
      },
    );

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    return { ok: true, message: result.message };
  } finally {
    ctx.setBusy(false);
  }
}

function handleSubagents(ctx: SlashContext, rest: string): SlashResult {
  const sub = rest.trim().toLowerCase();
  const enabled = ctx.session.subagentsEnabled ?? false;

  if (sub === "on") {
    return {
      ok: true,
      message: "subagents: on",
      sessionPatch: { subagentsEnabled: true },
    };
  }

  if (sub === "off") {
    return {
      ok: true,
      message: "subagents: off",
      sessionPatch: { subagentsEnabled: false },
    };
  }

  if (sub) {
    return { ok: false, message: "Usage: /subagents | /subagents on | /subagents off" };
  }

  return {
    ok: true,
    message: enabled ? "subagents: on" : "subagents: off",
  };
}

function runPanelAction(
  projectRoot: string,
  action: string,
  proposalId?: string,
): { ok: boolean; stdout: string; stderr: string } {
  const scriptPath = join(projectRoot, "harness/scripts/dist/panel-actions.js");
  const args = [
    scriptPath,
    action,
    "--project-root",
    projectRoot,
  ];
  if (proposalId) {
    args.push("--proposal-id", proposalId);
  }
  try {
    const stdout = execSync(`node ${args.map(a => `"${a}"`).join(" ")}`, {
      encoding: "utf-8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? e.message ?? "").toString().trim(),
    };
  }
}

function handleApply(ctx: SlashContext): SlashResult {
  const projectRoot = findProjectRoot(ctx.session.cwd);
  ctx.setBusy(true);
  ctx.pushLine("› Running /apply — executing panel apply workflow…");
  try {
    const result = runPanelAction(projectRoot, "apply");
    if (!result.ok) {
      return { ok: false, message: `/apply failed: ${result.stderr || result.stdout}` };
    }
    return { ok: true, message: result.stdout || "Apply complete." };
  } finally {
    ctx.setBusy(false);
  }
}

function handleCurate(ctx: SlashContext): SlashResult {
  const projectRoot = findProjectRoot(ctx.session.cwd);
  ctx.setBusy(true);
  ctx.pushLine("› Running /curate — executing panel curate workflow…");
  try {
    const result = runPanelAction(projectRoot, "curate");
    if (!result.ok) {
      return { ok: false, message: `/curate failed: ${result.stderr || result.stdout}` };
    }
    return { ok: true, message: result.stdout || "Curate complete." };
  } finally {
    ctx.setBusy(false);
  }
}

function handleReject(ctx: SlashContext, rest: string): SlashResult {
  const proposalId = rest.trim();
  if (!proposalId) {
    return { ok: false, message: "/reject requires a proposal ID. Usage: /reject <PROP-... or PENDING-...>" };
  }
  const projectRoot = findProjectRoot(ctx.session.cwd);
  ctx.setBusy(true);
  ctx.pushLine(`› Running /reject ${proposalId} — executing panel reject…`);
  try {
    const result = runPanelAction(projectRoot, "reject", proposalId);
    if (!result.ok) {
      return { ok: false, message: `/reject failed: ${result.stderr || result.stdout}` };
    }
    return { ok: true, message: result.stdout || `Rejected ${proposalId}.` };
  } finally {
    ctx.setBusy(false);
  }
}

/** Set or show the LLM backend via user settings. */
async function handleBackend(
  ctx: SlashContext,
  rest: string,
): Promise<SlashResult> {
  const sub = rest.trim().toLowerCase();

  if (!sub) {
    const settings = loadUserSettings();
    ctx.pushLine(`Current backend: ${settings.backend}`);
    return { ok: true, message: `Backend is ${settings.backend}. Use /backend openrouter or /backend cursor to change.` };
  }

  if (sub !== "openrouter" && sub !== "cursor") {
    return { ok: false, message: "Usage: /backend | /backend openrouter | /backend cursor" };
  }

  const currentSettings = loadUserSettings();
  const switchingAway = currentSettings.backend !== sub;

  saveUserSettings({ backend: sub });

  // If switching to a different backend, reset model to that backend's default
  if (switchingAway) {
    if (sub === "cursor") {
      // Reset to Cursor default
      saveUserSettings({
        backend: sub,
        cursorModel: CURSOR_DEFAULT_MODEL_ID,
        cursorModelParams: undefined,
      });
      ctx.pushLine(`Backend set to: cursor — model reset to "${CURSOR_DEFAULT_MODEL_ID}" (use /model to pick)`);
      return {
        ok: true,
        message: `Backend saved as cursor. Model reset to ${CURSOR_DEFAULT_MODEL_ID} (Cursor default).`,
        sessionPatch: {
          modelId: CURSOR_DEFAULT_MODEL_ID,
          modelParams: undefined,
        },
      };
    } else {
      // Reset to OpenRouter default — clear cursor-specific fields
      saveUserSettings({
        backend: sub,
        cursorModel: undefined,
        cursorModelParams: undefined,
      });
      ctx.pushLine(`Backend set to: openrouter — model reset to catalog default`);
      return {
        ok: true,
        message: "Backend saved as openrouter. Model reset to config/sispace.yaml default.",
        sessionPatch: {
          modelId: DEFAULT_MODEL,
          modelParams: undefined,
        },
      };
    }
  }

  ctx.pushLine(`Backend set to: ${sub}`);
  return { ok: true, message: `Backend saved as ${sub}. Takes effect on next session/agent construction.` };
}

/** Show /doctor — user settings + session diagnostics. */
async function handleDoctor(ctx: SlashContext): Promise<SlashResult> {
  const settings = loadUserSettings();
  const lines: string[] = [];
  lines.push("─ cursorsi doctor ─");
  lines.push(`  backend:        ${settings.backend}`);
  lines.push(`  defaultModel:   ${settings.defaultModel ?? "(from catalog default)"}`);
  lines.push(`  settings file:  ${userSettingsPath()}`);
  lines.push(`  session id:    ${ctx.session.id}`);
  lines.push(`  model id:      ${ctx.session.modelId ?? "(unset)"}`);
  lines.push(`  createdAt:     ${ctx.session.createdAt}`);
  lines.push(`  subagents:     ${ctx.session.subagentsEnabled ?? false}`);
  for (const line of lines) {
    ctx.pushLine(line);
  }
  return { ok: true, message: "Doctor diagnostics printed above." };
}

/** Show /settings — print current user settings. */
async function handleSettings(ctx: SlashContext): Promise<SlashResult> {
  const settings = loadUserSettings();
  const lines: string[] = [];
  lines.push("─ User Settings ─");
  lines.push(`  backend:        ${settings.backend}`);
  lines.push(`  defaultModel:   ${settings.defaultModel ?? "(from catalog default)"}`);
  lines.push(`  settings file:  ${userSettingsPath()}`);
  for (const line of lines) {
    ctx.pushLine(line);
  }
  return { ok: true, message: "User settings shown above." };
}

export async function runSlashCommand(
  input: string,
  ctx: SlashContext,
): Promise<SlashResult | null> {
  const trimmed = extractSlashInvocation(input);
  if (!trimmed) {
    return null;
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return { ok: false, message: "Empty slash command. Try /help" };
  }

  const key = parseSlashCommandKey(trimmed);
  if (!key || !isRegisteredSlashCommand(key)) {
    return null;
  }

  const [, ...restParts] = body.split(/\s+/);
  const rest = restParts.join(" ");

  if (key === "recall") {
    return handleRecall(ctx, rest.trim());
  }

  if (key === "search") {
    return handleSearch(ctx, rest);
  }

  if (key === "compact") {
    return handleCompact(ctx, rest.trim());
  }

  if (key === "reflect") {
    return handleReflect(ctx);
  }

  if (key === "grade") {
    return handleGrade(ctx);
  }

  if (key === "feature" || key === "bug" || key === "docs") {
    return handleSkillBundle(ctx, key);
  }

  if (key === "goal") {
    return handleGoal(ctx, rest.trim());
  }

  if (key === "handoff") {
    return handleHandoff(ctx, rest.trim());
  }

  if (key === "swarm") {
    return handleSwarm(ctx, rest.trim());
  }

  if (key === "subagents") {
    return handleSubagents(ctx, rest.trim());
  }

  if (key === "backend") {
    return handleBackend(ctx, rest.trim());
  }

  if (key === "model") {
    return {
      ok: true,
      message: "Opening model picker…",
      openModelPicker: "orchestrator",
    };
  }

  if (key === "subagent-model") {
    return {
      ok: true,
      message: "Opening subagent model picker…",
      openModelPicker: "subagent",
    };
  }

  if (key === "harness-compress") {
    return handleHarnessCompress(ctx, rest.trim());
  }

  if (key === "apply") {
    return handleApply(ctx);
  }

  if (key === "curate") {
    return handleCurate(ctx);
  }

  if (key === "reject") {
    return handleReject(ctx, rest.trim());
  }

  if (key === "doctor") {
    return handleDoctor(ctx);
  }

  if (key === "settings") {
    return handleSettings(ctx);
  }

  const placeholder = PLACEHOLDER_COMMANDS[key];
  if (placeholder) {
    return { ok: true, message: `[/${key}] ${placeholder}` };
  }

  return null;
}
