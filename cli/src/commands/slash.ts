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
import { buildResumeSessionState } from "../session/resume.js";
import {
  listRecentChats,
  updateTaskTitle,
  buildChatHistoryContextBlock,
  type ChatListEntry,
} from "../session/chat-persist.js";
import { closeSessionAgent, tokenFromEnv } from "../sdk/session-agent.js";
import { generatePlan, type PlanDraft } from "../plan/generate.js";
import type { AuthView, AuthDialogData } from "../tui/AuthDialog.js";
import {
  extractSlashInvocation,
  isRegisteredSlashCommand,
  parseSlashCommandKey,
} from "./slash-catalog.js";
import type { CliSession, SessionState } from "../session/types.js";

export interface SlashResult {
  ok: boolean;
  message: string;
  sessionPatch?: Partial<CliSession>;
  /** Replace the entire TUI session state (used by /resume). */
  replaceSessionState?: SessionState;
  /** Open interactive model picker (Cursor SDK catalog). */
  openModelPicker?: "orchestrator" | "subagent";
  /** Open interactive saved-chat picker (↑↓ · Enter resumes). */
  openChatPicker?: ChatListEntry[];
  /** Open plan Build/Revise picker. */
  openPlanPicker?: PlanDraft;
  /** Open interactive auth dialog (Qwen Code-style). */
  openAuthDialog?: { view: AuthView; data: AuthDialogData };
  /** Open interactive backend picker (OpenRouter / Cursor / Compatible). */
  openBackendPicker?: true;
  /** Open auto-skill accept/reject picker. */
  openSkillPicker?: import("../memory/pending-skills.js").PendingSkillDraft[];
}

export interface SlashContext {
  session: CliSession;
  pushLine: (line: string) => void;
  setBusy: (busy: boolean, label?: string) => void;
}

const PLACEHOLDER_COMMANDS: Record<string, string> = {
  handoff: "Export session blob for terminal attach.",
  harness: "Harness status summary (Phase 1a).",
  help: "Slash: /auth /backend (pick) /chats (pick) /plan /memory /test-ask /resume /rename /search /reflect /grade /handoff /swarm /goal /compact /harness /doctor /feature /bug /docs /recall /model /subagents",
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

/**
 * Apply a backend selection (shared by /backend args and BackendPicker UI).
 * Exported for Orchestrator confirm path.
 */
export async function applyBackendSelection(
  ctx: SlashContext,
  sub: "openrouter" | "cursor" | "compatible",
  compatName?: string,
): Promise<SlashResult> {
  const currentSettings = loadUserSettings();
  let targetProvider = currentSettings.compatibleProvider;

  if (sub === "compatible") {
    const { listCompatibleProviderNames, resolveCompatibleProvider } =
      await import("../config/credentials.js");
    const name = (compatName ?? "").toLowerCase() || currentSettings.compatibleProvider || "";
    if (!name) {
      const names = listCompatibleProviderNames();
      return {
        ok: false,
        message: names.length
          ? `Usage: /backend compatible <name> — available: ${names.join(", ")}`
          : "No compatible providers — run /auth compatible first.",
      };
    }
    if (!resolveCompatibleProvider(name)) {
      return {
        ok: false,
        message: `Unknown compatible provider "${name}". Run /auth list.`,
      };
    }
    targetProvider = name;
  }

  const switchingAway =
    currentSettings.backend !== sub ||
    (sub === "compatible" &&
      currentSettings.compatibleProvider !== targetProvider);

  // Drop the in-process agent so the next turn constructs the new backend.
  if (switchingAway) {
    closeSessionAgent(ctx.session.id);
  }

  const historyBlock =
    switchingAway && ctx.session.taskId?.trim()
      ? buildChatHistoryContextBlock(ctx.session.taskId.trim())
      : null;

  // Carry prior turns into the next backend (esp. Cursor, which has no DB seed).
  const continuityPatch: Partial<CliSession> = switchingAway
    ? {
        contextInjected: false,
        ...(historyBlock
          ? { resumeContextBlock: historyBlock }
          : {}),
      }
    : {};

  // If switching to a different backend, reset model to that backend's default
  if (switchingAway) {
    if (sub === "cursor") {
      saveUserSettings({
        backend: sub,
        cursorModel: CURSOR_DEFAULT_MODEL_ID,
        cursorModelParams: undefined,
        compatibleProvider: undefined,
      });
      ctx.pushLine(`Backend set to: cursor — model reset to "${CURSOR_DEFAULT_MODEL_ID}" (use /model to pick)`);
      if (historyBlock) {
        ctx.pushLine("› Prior chat turns will be injected on the next message (backend switch).");
      }
      return {
        ok: true,
        message: `Backend saved as cursor. Model reset to ${CURSOR_DEFAULT_MODEL_ID} (Cursor default).`,
        sessionPatch: {
          modelId: CURSOR_DEFAULT_MODEL_ID,
          modelParams: undefined,
          ...continuityPatch,
        },
      };
    }
    if (sub === "compatible") {
      const { resolveCompatibleProvider } = await import(
        "../config/credentials.js"
      );
      const provider = resolveCompatibleProvider(targetProvider!);
      const modelId = provider?.models[0] || DEFAULT_MODEL;
      saveUserSettings({
        backend: "compatible",
        compatibleProvider: targetProvider,
        defaultModel: modelId,
        cursorModel: undefined,
        cursorModelParams: undefined,
      });
      ctx.pushLine(
        `Backend set to: compatible/${targetProvider} — model "${modelId}"`,
      );
      if (historyBlock) {
        ctx.pushLine("› Prior chat turns will be seeded on the next message.");
      }
      return {
        ok: true,
        message: `Backend saved as compatible/${targetProvider}.`,
        sessionPatch: {
          modelId,
          modelParams: undefined,
          ...continuityPatch,
        },
      };
    }

    saveUserSettings({
      backend: "openrouter",
      cursorModel: undefined,
      cursorModelParams: undefined,
      compatibleProvider: undefined,
    });
    ctx.pushLine(`Backend set to: openrouter — model reset to catalog default`);
    if (historyBlock) {
      ctx.pushLine("› Prior chat turns will be seeded into OpenRouter on the next message.");
    }
    return {
      ok: true,
      message: "Backend saved as openrouter. Model reset to config/sispace.yaml default.",
      sessionPatch: {
        modelId: DEFAULT_MODEL,
        modelParams: undefined,
        ...continuityPatch,
      },
    };
  }

  ctx.pushLine(
    `Backend set to: ${sub === "compatible" ? `compatible/${targetProvider}` : sub}`,
  );
  return {
    ok: true,
    message: `Backend saved as ${sub}. Takes effect on next session/agent construction.`,
  };
}

/** Set or show the LLM backend via user settings / interactive picker. */
async function handleBackend(
  ctx: SlashContext,
  rest: string,
): Promise<SlashResult> {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "").toLowerCase();
  const compatName = (parts[1] ?? "").toLowerCase();

  // Bare /backend → open picker UI (same bottom slot as /auth /model).
  if (!sub) {
    return {
      ok: true,
      message: "Opening backend picker…",
      openBackendPicker: true,
    };
  }

  if (sub !== "openrouter" && sub !== "cursor" && sub !== "compatible") {
    return {
      ok: false,
      message:
        "Usage: /backend | /backend openrouter | /backend cursor | /backend compatible <name>",
    };
  }

  return applyBackendSelection(ctx, sub, compatName || undefined);
}

/** Show /doctor — user settings + session diagnostics. */
async function handleDoctor(ctx: SlashContext): Promise<SlashResult> {
  const settings = loadUserSettings();
  const { credentialsPath, readCredentials, maskSecret } = await import(
    "../config/credentials.js"
  );
  const creds = readCredentials();
  const lines: string[] = [];
  lines.push("─ cursorsi doctor ─");
  lines.push(
    `  backend:        ${
      settings.backend === "compatible" && settings.compatibleProvider
        ? `compatible/${settings.compatibleProvider}`
        : settings.backend
    }`,
  );
  lines.push(`  defaultModel:   ${settings.defaultModel ?? "(from catalog default)"}`);
  lines.push(`  settings file:  ${userSettingsPath()}`);
  lines.push(`  credentials:    ${credentialsPath()}`);
  lines.push(
    `  openrouter key: ${creds.providers.openrouter ? maskSecret(creds.providers.openrouter.key) : "(unset)"}`,
  );
  lines.push(
    `  cursor key:     ${creds.providers.cursor ? maskSecret(creds.providers.cursor.key) : "(unset)"}`,
  );
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
  lines.push(
    `  auto-memory:    ${settings.memory?.enableAutoMemory !== false ? "on" : "off"}`,
  );
  lines.push(
    `  auto-skill:     ${settings.memory?.enableAutoSkill !== false ? "on" : "off"}`,
  );
  lines.push(`  settings file:  ${userSettingsPath()}`);
  for (const line of lines) {
    ctx.pushLine(line);
  }
  return { ok: true, message: "User settings shown above." };
}

/** /memory — status + toggles for Qwen-style auto memory/skill. */
async function handleMemory(
  ctx: SlashContext,
  restRaw: string,
): Promise<SlashResult> {
  const {
    resolveMemorySettings,
    AUTO_SKILL_TOOL_THRESHOLD,
    runAutoExtract,
  } = await import("../memory/auto-extract.js");
  const { projectMemoryDir, projectSkillsDir } = await import(
    "../memory/paths.js"
  );
  const rest = restRaw.trim();
  const settings = loadUserSettings();
  const flags = resolveMemorySettings(settings);

  if (!rest) {
    ctx.pushLine("─ Project memory ─");
    ctx.pushLine(`  auto-memory:  ${flags.enableAutoMemory ? "on" : "off"}`);
    ctx.pushLine(`  auto-skill:   ${flags.enableAutoSkill ? "on" : "off"}`);
    ctx.pushLine(`  tool calls:   ${ctx.session.toolCallCount ?? 0} (skill threshold ${AUTO_SKILL_TOOL_THRESHOLD})`);
    ctx.pushLine(`  memory dir:   ${projectMemoryDir(ctx.session.cwd)}`);
    ctx.pushLine(`  skills dir:   ${projectSkillsDir(ctx.session.cwd)}`);
    ctx.pushLine("  /memory auto-memory on|off");
    ctx.pushLine("  /memory auto-skill on|off");
    ctx.pushLine("  /memory extract   — run extract now");
    ctx.pushLine("  /memory review    — accept/reject pending auto-skills");
    try {
      const { loadPendingSkills } = await import("../memory/pending-skills.js");
      const pending = loadPendingSkills(ctx.session.cwd);
      if (pending.length > 0) {
        ctx.pushLine(`  pending skills: ${pending.map((s) => s.slug).join(", ")}`);
      }
    } catch {
      // ignore
    }
    return { ok: true, message: "Memory settings shown above." };
  }

  const [key, valueRaw] = rest.split(/\s+/);
  const value = (valueRaw ?? "").toLowerCase();

  if (key === "review") {
    const { loadPendingSkills } = await import("../memory/pending-skills.js");
    const pending = loadPendingSkills(ctx.session.cwd);
    if (pending.length === 0) {
      return { ok: true, message: "No pending auto-skills to review." };
    }
    return {
      ok: true,
      message: `Review ${pending.length} pending skill(s)`,
      openSkillPicker: pending,
    };
  }

  if (key === "extract") {
    ctx.setBusy(true, "Extracting memory");
    try {
      // Manual extract: allow skills even under the auto threshold.
      const result = await runAutoExtract(ctx.session, {
        wantMemory: flags.enableAutoMemory,
        wantSkill: flags.enableAutoSkill && !ctx.session.skillsDirTouched,
        toolCallCount: ctx.session.toolCallCount ?? 0,
      });
      if (!result.launched) {
        return {
          ok: false,
          message: `Extract skipped: ${result.skipped ?? "unknown"}`,
        };
      }
      for (const name of result.memoryCreated ?? []) {
        ctx.pushLine(`› memory created ${name}`);
      }
      for (const name of result.memoryUpdated ?? []) {
        ctx.pushLine(`› memory updated ${name}`);
      }
      if (result.pendingSkills?.length) {
        return {
          ok: true,
          message: `skill proposed ${result.pendingSkills.map((s) => s.slug).join(", ")}`,
          openSkillPicker: result.pendingSkills,
        };
      }
      const bits = [
        ...(result.memoryCreated?.length
          ? [`created ${result.memoryCreated.join(",")}`]
          : []),
        ...(result.memoryUpdated?.length
          ? [`updated ${result.memoryUpdated.join(",")}`]
          : []),
      ];
      return {
        ok: true,
        message: bits.length
          ? `Extracted: ${bits.join(" · ")}`
          : result.summary || "Extract finished (nothing durable).",
      };
    } finally {
      ctx.setBusy(false);
    }
  }

  if (
    (key === "auto-memory" || key === "auto-skill") &&
    (value === "on" || value === "off")
  ) {
    const enabled = value === "on";
    if (key === "auto-memory") {
      saveUserSettings({ memory: { enableAutoMemory: enabled } });
    } else {
      saveUserSettings({ memory: { enableAutoSkill: enabled } });
    }
    return { ok: true, message: `${key} → ${value}` };
  }

  return {
    ok: false,
    message:
      "Usage: /memory | /memory auto-memory on|off | /memory auto-skill on|off | /memory extract | /memory review",
  };
}

async function handleChats(_ctx: SlashContext): Promise<SlashResult> {
  const listed = listRecentChats(20);
  if (!listed.ok) {
    return { ok: false, message: listed.error ?? "Failed to list chats." };
  }
  const chats = listed.chats ?? [];
  if (chats.length === 0) {
    return {
      ok: true,
      message: "No saved chats yet — send a message to auto-save one.",
    };
  }
  return {
    ok: true,
    message: "",
    openChatPicker: chats,
  };
}

async function handleResumeChat(
  ctx: SlashContext,
  taskIdRaw: string,
): Promise<SlashResult> {
  const taskId = taskIdRaw.trim();
  if (!taskId) {
    return { ok: false, message: "Usage: /resume <task-id>" };
  }
  ctx.setBusy(true);
  try {
    const result = await buildResumeSessionState(taskId, ctx.session.cwd);
    if (!result.ok || !result.state) {
      return { ok: false, message: result.error ?? `Resume failed for ${taskId}` };
    }
    return {
      ok: true,
      message: `Resumed ${result.state.sessions[0]?.title ?? taskId}`,
      replaceSessionState: result.state,
    };
  } finally {
    ctx.setBusy(false);
  }
}

async function handleRename(
  ctx: SlashContext,
  titleRaw: string,
): Promise<SlashResult> {
  const title = titleRaw.trim();
  if (!title) {
    return { ok: false, message: "Usage: /rename <new title>" };
  }
  const taskId = ctx.session.taskId?.trim();
  if (!taskId) {
    return {
      ok: false,
      message: "No saved chat yet — send a message first, then /rename.",
    };
  }
  const updated = updateTaskTitle(taskId, title);
  if (!updated.ok) {
    return { ok: false, message: updated.error ?? "Rename failed." };
  }
  return {
    ok: true,
    message: `Renamed chat to "${title.replace(/\s+/g, " ").trim()}"`,
    sessionPatch: { title: title.replace(/\s+/g, " ").trim() },
  };
}

async function handleTestAsk(ctx: SlashContext): Promise<SlashResult> {
  const { askUser } = await import("../tools/ask-user.js");
  ctx.pushLine("› Opening QuestionPicker test…");
  const answer = await askUser({
    prompt: "Test ask — which color?",
    options: ["Red", "Blue", "Green"],
  });
  return { ok: true, message: `Answered: ${answer}` };
}

async function handlePlan(
  ctx: SlashContext,
  goalRaw: string,
): Promise<SlashResult> {
  const goal = goalRaw.trim();
  if (!goal) {
    return { ok: false, message: "Usage: /plan <what to build>" };
  }
  ctx.pushLine(`› Planning: ${goal}`);
  ctx.setBusy(true, "Planning");
  try {
    const result = await generatePlan(goal, ctx.session.cwd);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    return {
      ok: true,
      message: `Plan ready — ${result.plan.title}`,
      openPlanPicker: result.plan,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Plan failed: ${msg}` };
  } finally {
    ctx.setBusy(false);
  }
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

  if (key === "chats") {
    return handleChats(ctx);
  }

  if (key === "resume") {
    return handleResumeChat(ctx, rest);
  }

  if (key === "rename") {
    return handleRename(ctx, rest);
  }

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

  if (key === "auth") {
    const { handleAuth } = await import("./auth.js");
    return handleAuth(ctx, rest);
  }

  if (key === "backend") {
    return handleBackend(ctx, rest.trim());
  }

  if (key === "plan") {
    return handlePlan(ctx, rest);
  }

  if (key === "test-ask") {
    return handleTestAsk(ctx);
  }

  if (key === "memory") {
    return handleMemory(ctx, rest);
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
