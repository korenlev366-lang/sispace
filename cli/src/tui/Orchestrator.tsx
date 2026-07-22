import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSlashCompletion } from "../commands/slash-catalog.js";
import { applyBackendSelection, runSlashCommand } from "../commands/slash.js";
import { listCompatibleProviderNames } from "../config/credentials.js";
import { closeSessionAgent, sendSessionMessage, tokenFromEnv } from "../sdk/session-agent.js";
import {
  hydrateCompactionFromDb,
  runSessionCompaction,
  shouldAutoCompact,
  compactionConfigFromCwd,
} from "../session/compaction.js";
import { persistChatTurn, updateTaskTitle } from "../session/chat-persist.js";
import {
  addSession,
  appendLine,
  createInitialSessionState,
  getActiveSession,
  patchSession,
  removeSession,
  replaceLastLine,
  switchSession,
} from "../session/store.js";
import type { CliSession, SessionState } from "../session/types.js";
import { fetchModelCatalog, fetchCursorModels } from "../models/catalog.js";
import {
  applyOrchestratorModelChoice,
  applySubagentModelChoice,
  currentPickerChoice,
} from "../models/apply-choice.js";
import { SessionPicker } from "./SessionPicker.js";
import { ChatPicker } from "./ChatPicker.js";
import { BusySpinner } from "./BusySpinner.js";
import { PlanPicker, type PlanFocus } from "./PlanPicker.js";
import { QuestionPicker } from "./QuestionPicker.js";
import { AuthDialog, type AuthView, type AuthDialogData } from "./AuthDialog.js";
import {
  BackendPicker,
  type BackendPickerView,
} from "./BackendPicker.js";
import { processAuthConfirm, processAuthBack, buildListString } from "../commands/auth.js";
import type { ChatListEntry } from "../session/chat-persist.js";
import { buildResumeSessionState } from "../session/resume.js";
import {
  buildPromptFromPlan,
  revisePlan,
  type PlanDraft,
} from "../plan/generate.js";
import {
  answerAskUser,
  cancelAskUser,
  setAskUserHandler,
  setAskUserHeadless,
  type AgentQuestion,
} from "../tools/ask-user.js";
import {
  applyPickerParamRow,
  buildInitialPickerState,
  confirmPickerChoice,
  cycleCurrentModelEffort,
  cycleFocusedParamValue,
  ModelPicker,
  movePickerModelIndex,
  movePickerParamFocus,
  pickerArrowDelta,
  stashModelParams,
  toggleShowParams,
  type ModelPickerState,
  type ModelPickerTarget,
} from "./ModelPicker.js";
import {
  commitCursorParamValue,
  moveCursorParamFocus,
  openCursorParams,
} from "./CursorParamPicker.js";
import { WelcomeBanner } from "./WelcomeBanner.js";
import { SlashAutocomplete } from "./SlashAutocomplete.js";
import { PromptLine } from "./PromptLine.js";
import {
  extractKnownSlashInvocation,
  findActiveSlashSpan,
  isSlashCommandPrefix,
} from "../commands/slash-catalog.js";
import { pushSessionEndNotify } from "../notify/ntfy.js";
import { triggerAutoReflectOnSessionEnd } from "../harness/auto-reflect.js";
import { loadAgentsContextForSession } from "../session/agents-inject.js";
import { captureGitDiff, hasGitWorktreeChanges } from "../diff/capture.js";
import { runVerifyAfterAgentTurn } from "../goal/loop.js";
import { sessionHasVerifiableGoal } from "../goal/session-attach.js";
import { DiffViewer } from "./DiffViewer.js";
import {
  ingestPasteBlob,
  isCopyShortcut,
  isQuitShortcut,
  consumeShiftCtrlCRawChunk,
  isPasteShortcut,
  readClipboardForPrompt,
  sanitizePromptInput,
  writeClipboardText,
} from "./paste.js";
import { estimateOutputTokensFromText } from "../cost/tokens.js";
import { getCliOptions } from "../runtime/cli-options.js";
import { createTuiPaneBridge } from "../pane/tui-bridge.js";
import {
  loadCostTotals,
  projectKeyFromCwd,
  recordTurnOutputTokens,
} from "../cost/store.js";
import { loadUserSettings, saveUserSettings } from "../config/user-settings.js";

const MAX_VISIBLE_LINES = 200;
const STREAM_RENDER_DEBOUNCE_MS = 50;

export interface OrchestratorProps {
  initialSessionState?: SessionState;
  voiceEnabled?: boolean;
  voiceStubMessage?: string;
  notifyTopicOverride?: string;
}

export function Orchestrator({
  initialSessionState,
  voiceEnabled = false,
  voiceStubMessage,
  notifyTopicOverride,
}: OrchestratorProps) {
  const { exit } = useApp();
  const { internal_eventEmitter } = useStdin();
  const cwd = process.cwd();
  const [sessionState, setSessionState] = useState<SessionState>(
    () => initialSessionState ?? createInitialSessionState(cwd),
  );
  const [overlay, setOverlay] = useState<
    | "chat"
    | "sessions"
    | "model"
    | "chats"
    | "plan"
    | "question"
    | "auth"
    | "backend"
  >("chat");
  const [modelPicker, setModelPicker] = useState<ModelPickerState | null>(null);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [chatPickerList, setChatPickerList] = useState<ChatListEntry[]>([]);
  const [chatPickerIndex, setChatPickerIndex] = useState(0);
  /** Non-null while renaming the highlighted chat in /chats. */
  const [chatRenameDraft, setChatRenameDraft] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planFocus, setPlanFocus] = useState<PlanFocus>("build");
  const [planReviseDraft, setPlanReviseDraft] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [questionDraft, setQuestionDraft] = useState<AgentQuestion | null>(
    null,
  );
  const [questionHighlight, setQuestionHighlight] = useState(0);
  const [questionFreeText, setQuestionFreeText] = useState<string | null>(null);
  const [authView, setAuthView] = useState<AuthView>("main");
  const [authData, setAuthData] = useState<AuthDialogData>({});
  const [authHighlight, setAuthHighlight] = useState(0);
  const [authDraft, setAuthDraft] = useState("");
  const [authSavedProviders, setAuthSavedProviders] = useState<string>("");
  const [backendView, setBackendView] = useState<BackendPickerView>("main");
  const [backendHighlight, setBackendHighlight] = useState(0);
  const [backendCompatProviders, setBackendCompatProviders] = useState<
    string[]
  >([]);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"prompt" | "slash">("prompt");
  const [slashCandidateIndex, setSlashCandidateIndex] = useState(0);
  const [dismissWelcome, setDismissWelcome] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [showDiff, setShowDiff] = useState(true);
  /** Combined busy (agent turn and/or slash command). */
  const busyRef = useRef(false);
  /** True only while runAgentTurn is in flight. */
  const agentBusyRef = useRef(false);
  /** True while a slash/resume command holds the busy flag. */
  const commandBusyRef = useRef(false);
  /** AbortController for the in-flight agent turn (Ctrl+C cancel). */
  const turnAbortRef = useRef<AbortController | null>(null);
  /** Timestamp of last Ctrl+C for double-tap quit. */
  const lastCtrlCAtRef = useRef(0);
  const CTRL_C_QUIT_MS = 1000;
  /** Side spinner UI while the agent turn is running. */
  const [busyUi, setBusyUi] = useState<{
    startedAt: number;
    label: string;
    detail?: string;
  } | null>(null);
  const streamTextRef = useRef("");
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const toolCallCountRef = useRef(0);

  const active = getActiveSession(sessionState);
  const activeRef = useRef(active);
  activeRef.current = active;
  const paneBridge = useMemo(
    () => createTuiPaneBridge(getCliOptions(), active),
    [active.id, active.cwd, active.modelId],
  );
  const paneBridgeRef = useRef(paneBridge);
  paneBridgeRef.current = paneBridge;
  const visibleLines = useMemo(() => {
    const lines = active.lines;
    if (lines.length <= MAX_VISIBLE_LINES) {
      return lines;
    }
    return lines.slice(-MAX_VISIBLE_LINES);
  }, [active.lines]);

  const syncBusy = useCallback(() => {
    const busy = agentBusyRef.current || commandBusyRef.current;
    busyRef.current = busy;
    setIsBusy(busy);
  }, []);

  /** Busy flag for slash commands / chat resume — does not clear an in-flight agent turn. */
  const setBusy = useCallback(
    (busy: boolean, label = "Working") => {
      commandBusyRef.current = busy;
      if (busy && !agentBusyRef.current) {
        setBusyUi({ startedAt: Date.now(), label });
      } else if (!busy && !agentBusyRef.current) {
        setBusyUi(null);
      }
      syncBusy();
    },
    [syncBusy],
  );

  const setAgentBusy = useCallback(
    (busy: boolean) => {
      agentBusyRef.current = busy;
      if (busy) {
        setBusyUi({ startedAt: Date.now(), label: "Working" });
      } else {
        setBusyUi(null);
      }
      syncBusy();
    },
    [syncBusy],
  );

  // Ask xterm-compatible terminals to encode Shift+Ctrl+C distinctly from Ctrl+C.
  useEffect(() => {
    process.stdout.write("\x1b[>4;2m\x1b[>5;1m");
    return () => {
      process.stdout.write("\x1b[>4m\x1b[>5m");
    };
  }, []);

  const pushLine = useCallback((line: string) => {
    setSessionState((prev) => appendLine(prev, line));
  }, []);

  const closeModelPicker = useCallback(() => {
    setModelPicker(null);
    setModelPickerLoading(false);
    setOverlay("chat");
  }, []);

  const closeChatPicker = useCallback(() => {
    setChatPickerList([]);
    setChatPickerIndex(0);
    setChatRenameDraft(null);
    setOverlay("chat");
  }, []);

  const openChatPicker = useCallback(
    (chats: ChatListEntry[]) => {
      const activeTaskId = activeRef.current.taskId;
      const activeIdx = chats.findIndex((c) => c.id === activeTaskId);
      setChatPickerList(chats);
      setChatPickerIndex(activeIdx >= 0 ? activeIdx : 0);
      setChatRenameDraft(null);
      setOverlay("chats");
    },
    [],
  );

  const closePlanPicker = useCallback(() => {
    setPlanDraft(null);
    setPlanFocus("build");
    setPlanReviseDraft(null);
    setPlanLoading(false);
    setOverlay("chat");
  }, []);

  const openPlanPicker = useCallback((plan: PlanDraft) => {
    setPlanDraft(plan);
    setPlanFocus("build");
    setPlanReviseDraft(null);
    setPlanLoading(false);
    setOverlay("plan");
  }, []);

  const closeQuestionPicker = useCallback((answer?: string) => {
    if (answer !== undefined) {
      answerAskUser(answer);
    } else {
      cancelAskUser("skipped");
    }
    setQuestionDraft(null);
    setQuestionHighlight(0);
    setQuestionFreeText(null);
    setOverlay("chat");
    setBusyUi((prev) =>
      agentBusyRef.current
        ? { startedAt: prev?.startedAt ?? Date.now(), label: "Working" }
        : null,
    );
  }, []);

  const openQuestionPicker = useCallback((question: AgentQuestion) => {
    setQuestionDraft(question);
    const opts = question.options ?? [];
    setQuestionHighlight(0);
    setQuestionFreeText(opts.length === 0 ? "" : null);
    setOverlay("question");
    setBusyUi({
      startedAt: Date.now(),
      label: "Waiting for answer",
    });
    pushLine(`› Agent asks: ${question.prompt}`);
  }, [pushLine]);

  // Bridge ask_user tool → QuestionPicker (under prompt, like plan UI).
  useEffect(() => {
    const opts = getCliOptions();
    setAskUserHeadless(Boolean(opts.paneMode));
    setAskUserHandler((question) => {
      openQuestionPicker(question);
    });
    return () => {
      setAskUserHandler(null);
      cancelAskUser("session ended");
    };
  }, [openQuestionPicker]);

  const commitChatRename = useCallback(() => {
    const target = chatPickerList[chatPickerIndex];
    const draft = chatRenameDraft;
    if (!target || draft === null) {
      setChatRenameDraft(null);
      return;
    }
    const title = draft.replace(/\s+/g, " ").trim();
    if (!title) {
      pushLine("! Title must be non-empty.");
      setChatRenameDraft(null);
      return;
    }
    const updated = updateTaskTitle(target.id, title);
    if (!updated.ok) {
      pushLine(`! ${updated.error ?? "Rename failed."}`);
      setChatRenameDraft(null);
      return;
    }
    setChatPickerList((prev) =>
      prev.map((c) => (c.id === target.id ? { ...c, title } : c)),
    );
    if (activeRef.current.taskId === target.id) {
      setSessionState((prev) =>
        patchSession(prev, prev.activeId, { title }),
      );
    }
    setChatRenameDraft(null);
    pushLine(`› Renamed to "${title}"`);
  }, [chatPickerIndex, chatPickerList, chatRenameDraft, pushLine]);

  const resumeSelectedChat = useCallback(async () => {
    const target = chatPickerList[chatPickerIndex];
    if (!target) {
      closeChatPicker();
      return;
    }
    closeChatPicker();
    setBusy(true);
    try {
      const result = await buildResumeSessionState(target.id, cwd);
      if (!result.ok || !result.state) {
        pushLine(`! ${result.error ?? `Resume failed for ${target.id}`}`);
        return;
      }
      closeSessionAgent(activeRef.current.id);
      setSessionState(result.state);
      pushLine(`› Resumed ${result.state.sessions[0]?.title ?? target.title}`);
    } finally {
      setBusy(false);
    }
  }, [chatPickerIndex, chatPickerList, closeChatPicker, cwd, pushLine, setBusy]);

  const openModelPicker = useCallback(
    async (target: ModelPickerTarget) => {
      const settings = loadUserSettings();
      const backend = settings.backend;

      if (backend === "cursor") {
        // Cursor backend — load models from Cursor.models.list()
        setModelPickerLoading(true);
        setOverlay("model");
        pushLine(
          target === "orchestrator"
            ? "› Loading Cursor models…"
            : "› Loading Cursor subagent models…",
        );
        try {
          const catalog = await fetchCursorModels();
          if (catalog.length === 0) {
            pushLine("! No models returned from Cursor.models.list()");
            closeModelPicker();
            return;
          }
          const session = activeRef.current;
          const current = currentPickerChoice(session, target);
          setModelPicker(buildInitialPickerState(target, catalog, current));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pushLine(`! ${msg}`);
          closeModelPicker();
        } finally {
          setModelPickerLoading(false);
        }
        return;
      }

      // OpenRouter / compatible — catalog (+ /auth model slugs)
      const credential = tokenFromEnv() ?? "";
      if (backend === "openrouter" && !credential.trim()) {
        pushLine(
          "! Set OpenRouter API key via /auth openrouter (or OPENROUTER_API_KEY)",
        );
        return;
      }
      if (backend === "compatible" && !settings.compatibleProvider?.trim()) {
        pushLine("! No compatible provider — run /auth compatible or /backend compatible <name>");
        return;
      }
      setModelPickerLoading(true);
      setOverlay("model");
      pushLine(
        target === "orchestrator"
          ? "› Loading models…"
          : "› Loading subagent models…",
      );
      try {
        const catalog = await fetchModelCatalog(credential);
        if (catalog.length === 0) {
          pushLine(
            backend === "compatible"
              ? "! No models stored for this compatible provider (/auth compatible --models …)"
              : "! No models returned from config/sispace.yaml",
          );
          closeModelPicker();
          return;
        }
        const session = activeRef.current;
        const current = currentPickerChoice(session, target);
        setModelPicker(buildInitialPickerState(target, catalog, current));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushLine(`! Model catalog failed: ${msg}`);
        closeModelPicker();
      } finally {
        setModelPickerLoading(false);
      }
    },
    [closeModelPicker, pushLine],
  );

  const confirmModelPicker = useCallback(() => {
    if (!modelPicker) {
      return;
    }
    const session = activeRef.current;
    const choice = confirmPickerChoice(stashModelParams(modelPicker));
    const result =
      modelPicker.target === "orchestrator"
        ? applyOrchestratorModelChoice(session, choice)
        : applySubagentModelChoice(session, choice);
    setSessionState((prev) =>
      patchSession(prev, prev.activeId, result.sessionPatch),
    );
    pushLine(`› ${result.message}`);

    // Persist model choice for Cursor / OpenRouter / compatible backends
    const settings = loadUserSettings();
    if (modelPicker.target === "orchestrator") {
      if (settings.backend === "cursor") {
        saveUserSettings({
          cursorModel: choice.modelId,
          cursorModelParams: choice.params?.length ? choice.params : undefined,
        });
      } else {
        saveUserSettings({ defaultModel: choice.modelId });
      }
    }

    closeModelPicker();
  }, [closeModelPicker, modelPicker, pushLine]);

  const flushAgentStreamLine = useCallback(() => {
    const text = streamTextRef.current;
    setSessionState((prev) =>
      replaceLastLine(prev, `agent> ${text || "…"}`),
    );
  }, []);

  const scheduleAgentStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current) {
      clearTimeout(streamFlushTimerRef.current);
    }
    streamFlushTimerRef.current = setTimeout(() => {
      streamFlushTimerRef.current = null;
      flushAgentStreamLine();
    }, STREAM_RENDER_DEBOUNCE_MS);
  }, [flushAgentStreamLine]);

  const clearAgentStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current) {
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
  }, []);

  const applyPasteToInput = useCallback(
    (blob: string) => {
      const ingested = ingestPasteBlob(activeRef.current.id, blob);
      if (!ingested.text) {
        return;
      }
      setInput((prev) => {
        const next = prev + ingested.text;
        setInputMode(isSlashCommandPrefix(next) ? "slash" : "prompt");
        setSlashCandidateIndex(0);
        return next;
      });
      if (ingested.attachedImageNum !== undefined) {
        pushLine(`› Attached image #${ingested.attachedImageNum}`);
      }
    },
    [pushLine],
  );

  const endSession = useCallback(
    (session: CliSession) => {
      void paneBridgeRef.current.sessionEnd("user_exit");
      triggerAutoReflectOnSessionEnd(session, { onNotice: pushLine });
      void pushSessionEndNotify({
        cwd,
        sessionTitle: session.title,
        sessionId: session.id,
        notifyTopicOverride,
      }).then((result) => {
        if (!result.ok && result.error && result.error !== "ntfy topic not configured") {
          pushLine(`! ntfy: ${result.error}`);
        }
      });
    },
    [cwd, notifyTopicOverride, pushLine],
  );

  useEffect(() => {
    void paneBridgeRef.current.sessionStart();
    return () => {
      clearAgentStreamFlush();
      void paneBridgeRef.current.sessionEnd("unmount");
      triggerAutoReflectOnSessionEnd(activeRef.current, { onNotice: pushLine });
    };
  }, [clearAgentStreamFlush, pushLine]);

  useEffect(() => {
    const session = active;
    if (!session.agentsContextFetched) {
      const loaded = loadAgentsContextForSession(session.id, session.cwd);
      setSessionState((prev) =>
        patchSession(prev, session.id, {
          agentsContextFetched: true,
          ...(loaded?.block ? { agentsContextBlock: loaded.block } : {}),
        }),
      );
      if (loaded?.block) {
        pushLine(`› Loaded AGENTS.md (${loaded.lineCount} lines)`);
      }
    }
  }, [active.id, active.agentsContextFetched, pushLine]);

  useEffect(() => {
    const session = active;
    if (!session.compacted) {
      const hydration = hydrateCompactionFromDb(session);
      if (hydration) {
        setSessionState((prev) => patchSession(prev, session.id, hydration));
      }
    }
  }, [active.id]);

  useEffect(() => {
    const session = active;
    if (
      session.costSessionTokens !== undefined &&
      session.costProjectTokens !== undefined
    ) {
      return;
    }
    const totals = loadCostTotals(
      session.id,
      projectKeyFromCwd(session.cwd),
    );
    if (totals) {
      setSessionState((prev) =>
        patchSession(prev, session.id, {
          costSessionTokens: totals.sessionTotal,
          costProjectTokens: totals.projectTotal,
        }),
      );
    }
  }, [active.id]);

  const runAgentTurn = useCallback(
    async (initialMessage: string, baseSession: CliSession) => {
      const userMessage = sanitizePromptInput(initialMessage);
      if (!userMessage) {
        pushLine(
          "! Message empty or looks like a raw image paste — use Ctrl+V to attach @/path/to.png",
        );
        return;
      }
      setAgentBusy(true);
      const abort = new AbortController();
      turnAbortRef.current = abort;
      let workingSession = baseSession;
      try {
      const compactCfg = compactionConfigFromCwd(baseSession.cwd);
      if (shouldAutoCompact(workingSession, compactCfg)) {
        if (abort.signal.aborted) {
          pushLine("› Cancelled");
          return;
        }
        const compactResult = await runSessionCompaction(
          workingSession,
          tokenFromEnv() ?? "",
        );
        if (compactResult.ok && compactResult.sessionPatch) {
          workingSession = { ...workingSession, ...compactResult.sessionPatch };
          setSessionState((prev) =>
            patchSession(prev, prev.activeId, compactResult.sessionPatch!),
          );
          pushLine(
            `› Compacted — summarized ${compactResult.messagesSummarized ?? 0} messages, keeping last ${compactResult.messagesKept ?? 0}`,
          );
        }
      }

      let message: string | undefined = userMessage;
      let goal = baseSession.activeGoal;
      let agentId = workingSession.cursorAgentId;
      let injectGoalNext = Boolean(baseSession.injectGoalContext && goal);

      while (message) {
        if (abort.signal.aborted) {
          pushLine("› Cancelled");
          break;
        }
        const preview =
          message.length > 200 ? `${message.slice(0, 200)}…` : message;

        setSessionState((prev) => {
          let next = appendLine(prev, `you> ${preview}`);
          return appendLine(next, "agent> …");
        });

        const turnSession: CliSession = {
          ...workingSession,
          cursorAgentId: agentId,
          activeGoal: goal,
          injectGoalContext: injectGoalNext && Boolean(goal),
        };
        injectGoalNext = false;

        await paneBridgeRef.current.agentTurn(message, "user");
        await paneBridgeRef.current.stepStart(1, 1);

        streamTextRef.current = "";
        clearAgentStreamFlush();
        toolCallCountRef.current = 0;
        const toolStatusBuffer: string[] = [];

        const result = await sendSessionMessage({
          session: turnSession,
          message,
          signal: abort.signal,
          onTextDelta: (text) => {
            streamTextRef.current = text;
            scheduleAgentStreamFlush();
            setBusyUi((prev) =>
              prev && prev.label !== "Streaming" && toolCallCountRef.current === 0
                ? { ...prev, label: "Streaming" }
                : prev,
            );
          },
          onStatusLine: (line) => {
            // Buffer tool call status lines; show only a summary after the turn.
            if (line.startsWith("›")) {
              toolStatusBuffer.push(line);
              // Count tool-call start lines (not checkmark result lines)
              if (line.startsWith("› ") && !line.startsWith("› ✓")) {
                toolCallCountRef.current += 1;
                const n = toolCallCountRef.current;
                setBusyUi((prev) =>
                  prev
                    ? {
                        ...prev,
                        label: "Running tools",
                        detail: `${n} tool${n === 1 ? "" : "s"}`,
                      }
                    : prev,
                );
              }
            } else {
              // Pass through non-tool lines (e.g. warnings starting with "!")
              pushLine(line);
            }
          },
        });

        if (result.cancelled || abort.signal.aborted) {
          clearAgentStreamFlush();
          setSessionState((prev) =>
            replaceLastLine(prev, "agent> (cancelled)"),
          );
          pushLine("› Cancelled — send another message or Ctrl+C twice to quit");
          await paneBridgeRef.current.stepDone(1, 1, "error");
          break;
        }

        // Emit a single summary line for tool calls instead of per-call lines
        const toolCount = toolCallCountRef.current;
        if (toolCount > 0) {
          pushLine(`› [${toolCount} tool call${toolCount !== 1 ? "s" : ""} completed]`);
        }

        // Show per-turn Obsidian lesson count
        if (result.obsidianLessonCount !== undefined && result.obsidianLessonCount > 0) {
          pushLine(`› Obsidian: found ${result.obsidianLessonCount} relevant lessons`);
        }

        clearAgentStreamFlush();
        streamTextRef.current = result.text;
        flushAgentStreamLine();

        if (result.agentId) {
          agentId = result.agentId;
        }

        const hadChanges = hasGitWorktreeChanges(workingSession.cwd);

        const assistantPersistText = result.ok
          ? result.text || "(empty response)"
          : `! agent error: ${result.error ?? "unknown"}`;

        // Durable save: bind chat task on first turn, write messages + cursor_agent_id.
        const saved = persistChatTurn({
          session: workingSession,
          userMessage: message,
          assistantText: assistantPersistText,
          agentId,
        });
        if (saved.ok && saved.taskId) {
          workingSession = {
            ...workingSession,
            taskId: saved.taskId,
            ...(saved.title ? { title: saved.title } : {}),
            ...(agentId ? { cursorAgentId: agentId } : {}),
          };
          if (saved.created) {
            pushLine(`› chat saved as "${saved.title ?? saved.taskId}" (${saved.taskId})`);
          }
        } else if (!saved.ok && saved.error) {
          pushLine(`! chat save failed: ${saved.error}`);
        }

        // Prefer sessionPatch.toolCallCount from sendSessionMessage; else accumulate.
        const turnTools = result.toolCallCount ?? toolCount;
        const nextToolTotal =
          result.sessionPatch?.toolCallCount ??
          (workingSession.toolCallCount ?? 0) + (turnTools > 0 ? turnTools : 0);
        const turnSessionPatch: Partial<CliSession> = {
          ...(result.sessionPatch ?? {}),
          ...(nextToolTotal > 0 ? { toolCallCount: nextToolTotal } : {}),
        };

        setSessionState((prev) =>
          patchSession(prev, prev.activeId, {
            ...(agentId ? { cursorAgentId: agentId } : {}),
            ...(saved.ok && saved.taskId
              ? {
                  taskId: saved.taskId,
                  ...(saved.title ? { title: saved.title } : {}),
                }
              : {}),
            contextInjected: true,
            injectGoalContext: false,
            ...(goal ? { activeGoal: goal } : {}),
            // Update real context token count from the API response
            ...(result.promptTokens !== undefined ? { contextTokens: result.promptTokens } : {}),
            ...turnSessionPatch,
          }),
        );
        workingSession = { ...workingSession, ...turnSessionPatch };

        if (result.modelId) {
          workingSession = { ...workingSession, modelId: result.modelId };
          setSessionState((prev) =>
            patchSession(prev, prev.activeId, { modelId: result.modelId }),
          );
        }

        if (!result.ok) {
          await paneBridgeRef.current.stepDone(1, 1, "error");
          setSessionState((prev) =>
            replaceLastLine(
              prev,
              `! agent error: ${result.error ?? "unknown"}`,
            ),
          );
          break;
        }

        setSessionState((prev) =>
          replaceLastLine(
            prev,
            `agent> ${result.text || "(empty response)"}`,
          ),
        );

        // Use real completion_tokens from the API when available, fall back to char estimate
        const tokens = result.completionTokens ?? estimateOutputTokensFromText(result.text);
        await paneBridgeRef.current.stepDone(1, 1, "ok");
        await paneBridgeRef.current.agentComplete(result.text);
        await paneBridgeRef.current.costUpdate(
          (workingSession.costSessionTokens ?? 0) + tokens,
        );
        const totals = recordTurnOutputTokens(
          workingSession.id,
          projectKeyFromCwd(workingSession.cwd),
          tokens,
        );
        if (totals) {
          setSessionState((prev) =>
            patchSession(prev, prev.activeId, {
              costSessionTokens: totals.sessionTotal,
              costProjectTokens: totals.projectTotal,
            }),
          );
        }

        setDiffText(captureGitDiff(workingSession.cwd));

        if (!goal || !sessionHasVerifiableGoal({ ...baseSession, activeGoal: goal })) {
          break;
        }

        if (!hadChanges) {
          break;
        }

        const outcome = runVerifyAfterAgentTurn(workingSession.cwd, goal);
        goal = outcome.goal;
        setSessionState((prev) =>
          patchSession(prev, prev.activeId, { activeGoal: goal }),
        );

        if (outcome.skipped) {
          pushLine(
            "› No file changes in git — verify skipped (edit files, then send another message)",
          );
          break;
        }

        if (outcome.passed) {
          pushLine(`› Verify passed — goal ${goal.id} complete`);
          break;
        }
        if (outcome.exhausted) {
          pushLine(
            `! Verify loop stopped after ${goal.maxIterations} iterations (exit ${outcome.verifyResult.exitCode})`,
          );
          break;
        }

        pushLine(
          `› Verify failed (exit ${outcome.verifyResult.exitCode}), iteration ${goal.currentIteration}/${goal.maxIterations} — retrying`,
        );
        message = outcome.agentFollowUp;
        injectGoalNext = true;
      }
      } finally {
        cancelAskUser("turn ended");
        setQuestionDraft(null);
        setQuestionFreeText(null);
        setOverlay((o) => (o === "question" ? "chat" : o));
        if (turnAbortRef.current === abort) {
          turnAbortRef.current = null;
        }
        setAgentBusy(false);
      }
    },
    [
      setAgentBusy,
      pushLine,
      clearAgentStreamFlush,
      flushAgentStreamLine,
      scheduleAgentStreamFlush,
    ],
  );

  const buildSelectedPlan = useCallback(() => {
    if (!planDraft) {
      closePlanPicker();
      return;
    }
    const prompt = buildPromptFromPlan(planDraft);
    const session = activeRef.current;
    closePlanPicker();
    pushLine(`› Building plan — ${planDraft.title}`);
    void runAgentTurn(prompt, session);
  }, [closePlanPicker, planDraft, pushLine, runAgentTurn]);

  const submitPlanRevise = useCallback(async () => {
    if (!planDraft || planReviseDraft === null) {
      return;
    }
    const feedback = planReviseDraft.replace(/\s+/g, " ").trim();
    if (!feedback) {
      pushLine("! Revise feedback must be non-empty.");
      return;
    }
    setPlanLoading(true);
    setBusy(true, "Revising plan");
    try {
      const result = await revisePlan(planDraft, feedback, cwd);
      if (!result.ok) {
        pushLine(`! ${result.error}`);
        setPlanReviseDraft(null);
        return;
      }
      setPlanDraft(result.plan);
      setPlanReviseDraft(null);
      setPlanFocus("build");
      pushLine(`› Plan revised — ${result.plan.title}`);
    } finally {
      setPlanLoading(false);
      setBusy(false);
    }
  }, [cwd, planDraft, planReviseDraft, pushLine, setBusy]);

  const slashCompletion = useMemo(
    () => getSlashCompletion(input, slashCandidateIndex),
    [input, slashCandidateIndex],
  );

  const showSlashMenu =
    inputMode === "slash" &&
    isSlashCommandPrefix(input) &&
    slashCompletion !== null &&
    slashCompletion.candidates.length > 0;

  const showWelcome =
    !dismissWelcome &&
    overlay === "chat" &&
    active.lines.length <= 1 &&
    !active.lines.some((l) => l.startsWith("you>") || l.startsWith("agent>"));

  const applySlashCompletion = useCallback(
    (completion: NonNullable<ReturnType<typeof getSlashCompletion>>) => {
      setInput(completion.value);
      setInputMode("slash");
      setSlashCandidateIndex(completion.candidateIndex);
    },
    [],
  );

  const submitInput = useCallback(() => {
    let value = sanitizePromptInput(input);
    if (
      showSlashMenu &&
      slashCompletion &&
      slashCompletion.candidates.length > 0
    ) {
      value = slashCompletion.value;
    }
    if (!value) {
      setInput("");
      return;
    }

    const slashInvocation = extractKnownSlashInvocation(value);

    // Slash commands are allowed while the agent is running; plain prompts are not.
    if (slashInvocation) {
      if (commandBusyRef.current) {
        return;
      }
      const session = active;
      setInput("");
      setInputMode("prompt");
      setDismissWelcome(true);
      void (async () => {
        const result = await runSlashCommand(slashInvocation, {
          session,
          pushLine,
          setBusy,
        });

        if (!result) {
          if (agentBusyRef.current) {
            pushLine("! Agent is busy — wait before sending a prompt.");
            return;
          }
          void runAgentTurn(value, session);
          return;
        }

        if (result.openModelPicker) {
          if (result.ok && result.message) {
            pushLine(`› ${result.message}`);
          }
          await openModelPicker(result.openModelPicker);
          return;
        }
        if (result.openChatPicker) {
          openChatPicker(result.openChatPicker);
          return;
        }
        if (result.openPlanPicker) {
          pushLine(
            result.ok
              ? `› ${result.message || "Plan ready"} — pick Build or Revise`
              : `! ${result.message}`,
          );
          openPlanPicker(result.openPlanPicker);
          return;
        }
        if (result.openAuthDialog) {
          const listStr = buildListString();
          setAuthView(result.openAuthDialog.view);
          setAuthData(result.openAuthDialog.data);
          setAuthHighlight(0);
          setAuthDraft("");
          setAuthSavedProviders(listStr);
          setOverlay("auth");
          return;
        }
        if (result.openBackendPicker) {
          const settings = loadUserSettings();
          const names = listCompatibleProviderNames();
          const mainIndex =
            settings.backend === "openrouter"
              ? 0
              : settings.backend === "cursor"
                ? 1
                : 2;
          setBackendView("main");
          setBackendHighlight(mainIndex);
          setBackendCompatProviders(names);
          setOverlay("backend");
          return;
        }
        if (result.replaceSessionState) {
          closeSessionAgent(session.id);
          setSessionState(result.replaceSessionState);
          pushLine(result.ok ? `› ${result.message}` : `! ${result.message}`);
          return;
        }
        if (result.sessionPatch) {
          setSessionState((prev) =>
            patchSession(prev, prev.activeId, result.sessionPatch!),
          );
        }
        if (result.message) {
          pushLine(result.ok ? `› ${result.message}` : `! ${result.message}`);
        }
      })();
      return;
    }

    if (agentBusyRef.current || commandBusyRef.current || busyRef.current) {
      return;
    }

    const session = active;
    setInput("");
    setInputMode("prompt");
    setDismissWelcome(true);
    void (async () => {
      await runAgentTurn(value, session);
    })();
  }, [
    input,
    active,
    pushLine,
    setBusy,
    runAgentTurn,
    showSlashMenu,
    slashCompletion,
    openModelPicker,
    openChatPicker,
    openPlanPicker,
  ]);

  const applyClipboardPaste = useCallback(async () => {
    const pasted = await readClipboardForPrompt(activeRef.current.id);
    if (!pasted?.text) {
      return;
    }
    setInput((prev) => {
      const next = prev + pasted.text;
      setInputMode(isSlashCommandPrefix(next) ? "slash" : "prompt");
      setSlashCandidateIndex(0);
      return next;
    });
    if (pasted.attachedImageNum !== undefined) {
      pushLine(`› Attached image #${pasted.attachedImageNum}`);
    }
  }, [pushLine]);

  const copySessionToClipboard = useCallback(async () => {
    const session = activeRef.current;
    const parts = [...session.lines];
    if (showDiff && diffText.trim()) {
      parts.push("", "--- diff ---", diffText);
    }
    const text = parts.join("\n");
    const ok = await writeClipboardText(text);
    pushLine(ok ? "› Copied session text to clipboard" : "! Copy failed (install wl-copy or xclip)");
  }, [diffText, pushLine, showDiff]);

  useEffect(() => {
    const emitter = internal_eventEmitter;
    if (!emitter) {
      return;
    }
    const onRawInput = (chunk: string | Buffer) => {
      if (consumeShiftCtrlCRawChunk(chunk)) {
        void copySessionToClipboard();
      }
    };
    emitter.on("input", onRawInput);
    return () => {
      emitter.off("input", onRawInput);
    };
  }, [copySessionToClipboard, internal_eventEmitter]);

  useInput((char, key) => {
    if (isCopyShortcut(char, key)) {
      void copySessionToClipboard();
      return;
    }

    if (isQuitShortcut(char, key)) {
      const now = Date.now();
      const rapid =
        lastCtrlCAtRef.current > 0 && now - lastCtrlCAtRef.current < CTRL_C_QUIT_MS;
      lastCtrlCAtRef.current = now;

      if (rapid) {
        turnAbortRef.current?.abort();
        endSession(active);
        exit();
        return;
      }

      // First Ctrl+C: cancel in-flight agent turn if any; otherwise arm quit.
      if (agentBusyRef.current && turnAbortRef.current) {
        cancelAskUser("cancelled");
        if (overlay === "question") {
          setQuestionDraft(null);
          setQuestionFreeText(null);
          setOverlay("chat");
        }
        turnAbortRef.current.abort();
        pushLine("› Cancelling… (Ctrl+C again to quit)");
        return;
      }

      pushLine("› Press Ctrl+C again to quit");
      return;
    }

    // Input, slash commands, and overlays stay usable while the agent is running.
    // Plain prompt submit is gated inside submitInput via agentBusyRef.

    if (overlay === "model") {
      if (modelPickerLoading) {
        return;
      }
      if (!modelPicker) {
        closeModelPicker();
        return;
      }
      const pickerBackend = loadUserSettings().backend;
      const isCursorPicker = pickerBackend === "cursor";

      if (key.escape) {
        if (modelPicker.showParams) {
          setModelPicker((s) => (s ? { ...s, showParams: false } : s));
        } else {
          closeModelPicker();
        }
        return;
      }
      if (key.tab) {
        if (isCursorPicker) {
          if (!modelPicker.showParams) {
            setModelPicker((s) => (s ? openCursorParams(s) : s));
          }
        } else if (modelPicker.showParams) {
          setModelPicker((s) =>
            s ? { ...s, showParams: false } : s,
          );
        } else {
          setModelPicker((s) =>
            s ? cycleCurrentModelEffort(s) : s,
          );
        }
        return;
      }
      if (key.return) {
        confirmModelPicker();
        return;
      }
      if (char === " ") {
        if (isCursorPicker && modelPicker.showParams) {
          setModelPicker((s) => (s ? commitCursorParamValue(s) : s));
        } else if (!isCursorPicker) {
          setModelPicker((s) => (s ? applyPickerParamRow(s) : s));
        }
        return;
      }
      const arrow = pickerArrowDelta(char, key);
      if (arrow) {
        if (arrow.axis === "vertical") {
          if (modelPicker.showParams) {
            setModelPicker((s) =>
              s
                ? isCursorPicker
                  ? moveCursorParamFocus(s, arrow.delta)
                  : movePickerParamFocus(s, arrow.delta)
                : s,
            );
          } else {
            setModelPicker((s) =>
              s ? movePickerModelIndex(s, arrow.delta) : s,
            );
          }
        } else if (modelPicker.showParams && !isCursorPicker) {
          setModelPicker((s) =>
            s ? cycleFocusedParamValue(s, arrow.delta) : s,
          );
        } else if (!isCursorPicker && arrow.delta > 0) {
          setModelPicker((s) => (s ? toggleShowParams(s) : s));
        }
        return;
      }
      if (char && char.length > 1) {
        return;
      }
      return;
    }

    if (overlay === "question") {
      if (!questionDraft) {
        setOverlay("chat");
        return;
      }
      const options = questionDraft.options ?? [];
      const typing = questionFreeText !== null || options.length === 0;

      if (key.escape) {
        if (typing && options.length > 0 && questionFreeText !== null) {
          setQuestionFreeText(null);
          return;
        }
        closeQuestionPicker();
        pushLine("› Question skipped");
        return;
      }

      if (typing) {
        if (key.return) {
          const text = (questionFreeText ?? "").replace(/\s+/g, " ").trim();
          if (!text) {
            return;
          }
          pushLine(`› Answer: ${text}`);
          closeQuestionPicker(text);
          return;
        }
        if (key.backspace || key.delete) {
          setQuestionFreeText((v) => (v ?? "").slice(0, -1));
          return;
        }
        if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
          return;
        }
        if (char && char.length > 1) {
          setQuestionFreeText((v) => (v ?? "") + char);
          return;
        }
        if (char) {
          setQuestionFreeText((v) => (v ?? "") + char);
        }
        return;
      }

      if (key.upArrow) {
        setQuestionHighlight((i) =>
          options.length === 0 ? 0 : i <= 0 ? options.length - 1 : i - 1,
        );
        return;
      }
      if (key.downArrow) {
        setQuestionHighlight((i) =>
          options.length === 0 ? 0 : i >= options.length - 1 ? 0 : i + 1,
        );
        return;
      }
      if (key.return) {
        const choice = options[questionHighlight];
        if (choice) {
          pushLine(`› Answer: ${choice}`);
          closeQuestionPicker(choice);
        }
        return;
      }
      if (char === "t" || char === "T") {
        setQuestionFreeText("");
        return;
      }
      return;
    }

    if (overlay === "plan") {
      if (planLoading) {
        return;
      }
      if (planReviseDraft !== null) {
        if (key.escape) {
          setPlanReviseDraft(null);
          return;
        }
        if (key.return) {
          void submitPlanRevise();
          return;
        }
        if (key.backspace || key.delete) {
          setPlanReviseDraft((v) => (v ?? "").slice(0, -1));
          return;
        }
        if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
          return;
        }
        if (char && char.length > 1) {
          setPlanReviseDraft((v) => (v ?? "") + char);
          return;
        }
        if (char) {
          setPlanReviseDraft((v) => (v ?? "") + char);
        }
        return;
      }

      if (key.escape) {
        closePlanPicker();
        return;
      }
      if (key.leftArrow || key.upArrow) {
        setPlanFocus("build");
        return;
      }
      if (key.rightArrow || key.downArrow) {
        setPlanFocus("revise");
        return;
      }
      if (key.return) {
        if (planFocus === "build") {
          buildSelectedPlan();
        } else {
          setPlanReviseDraft("");
        }
        return;
      }
      if (char === "b" || char === "B") {
        if (planFocus === "build") {
          buildSelectedPlan();
        } else {
          setPlanFocus("build");
        }
        return;
      }
      if (char === "r" || char === "R") {
        if (planFocus === "revise") {
          setPlanReviseDraft("");
        } else {
          setPlanFocus("revise");
        }
        return;
      }
      return;
    }

    if (overlay === "chats") {
      if (chatRenameDraft !== null) {
        if (key.escape) {
          setChatRenameDraft(null);
          return;
        }
        if (key.return) {
          commitChatRename();
          return;
        }
        if (key.backspace || key.delete) {
          setChatRenameDraft((v) => (v ?? "").slice(0, -1));
          return;
        }
        if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
          return;
        }
        if (char && char.length > 1) {
          setChatRenameDraft((v) => (v ?? "") + char);
          return;
        }
        if (char) {
          setChatRenameDraft((v) => (v ?? "") + char);
        }
        return;
      }

      if (key.escape) {
        closeChatPicker();
        return;
      }
      if (key.upArrow) {
        setChatPickerIndex((i) =>
          chatPickerList.length === 0
            ? 0
            : i <= 0
              ? chatPickerList.length - 1
              : i - 1,
        );
        return;
      }
      if (key.downArrow) {
        setChatPickerIndex((i) =>
          chatPickerList.length === 0
            ? 0
            : i >= chatPickerList.length - 1
              ? 0
              : i + 1,
        );
        return;
      }
      if (key.return) {
        void resumeSelectedChat();
        return;
      }
      if (char === "r" || char === "R") {
        const target = chatPickerList[chatPickerIndex];
        if (target) {
          setChatRenameDraft(target.title);
        }
        return;
      }
      return;
    }

    if (overlay === "sessions") {
      if (key.escape) {
        setOverlay("chat");
        return;
      }
      if (key.upArrow) {
        setPickerIndex((i) =>
          i <= 0 ? sessionState.sessions.length - 1 : i - 1,
        );
        return;
      }
      if (key.downArrow) {
        setPickerIndex((i) =>
          i >= sessionState.sessions.length - 1 ? 0 : i + 1,
        );
        return;
      }
      if (key.return) {
        const target = sessionState.sessions[pickerIndex];
        if (target) {
          setSessionState((prev) =>
            appendLine(
              switchSession(prev, target.id),
              `— switched to ${target.title}`,
            ),
          );
        }
        setOverlay("chat");
        return;
      }
      if (char === "n") {
        setSessionState((prev) => {
          const next = addSession(prev, cwd);
          return appendLine(next, "— new session created");
        });
        setPickerIndex(sessionState.sessions.length);
        return;
      }
      if (char === "d") {
        const target = sessionState.sessions[pickerIndex];
        if (target && sessionState.sessions.length > 1) {
          endSession(target);
          setSessionState((prev) =>
            appendLine(
              removeSession(prev, target.id),
              `— removed ${target.title}`,
            ),
          );
          setPickerIndex((i) => Math.max(0, i - 1));
        }
        return;
      }
      return;
    }

    if (overlay === "auth") {
      if (key.escape) {
        // Back navigation or close
        if (authView === "main" || authView === "list" || authView === "done") {
          setOverlay("chat");
          setAuthView("main");
          setAuthData({});
          setAuthDraft("");
          setAuthHighlight(0);
        } else {
          const result = processAuthBack({ view: authView, data: authData, draft: authDraft });
          setAuthView(result.view);
          setAuthData(result.data);
          setAuthDraft("");
          setAuthHighlight(0);
        }
        return;
      }
      if (key.return) {
        // Confirm current view
        if (authView === "main") {
          // Select the highlighted option
          const options: Array<{ view: AuthView; data: AuthDialogData }> = [
            { view: "openrouter-key", data: { provider: "openrouter" } },
            { view: "cursor-key", data: { provider: "cursor" } },
            { view: "compatible-name", data: { provider: "compatible" } },
            { view: "list", data: {} },
          ];
          if (authHighlight < options.length) {
            const choice = options[authHighlight]!;
            setAuthView(choice.view);
            setAuthData(choice.data);
            setAuthDraft("");
            setAuthHighlight(0);
          }
          return;
        }
        if (authView === "compatible-api") {
          const apiChoice = authHighlight === 0 ? "openai" : "anthropic";
          setAuthData((prev) => ({ ...prev, api: apiChoice }));
          setAuthHighlight(0);
          const result = processAuthConfirm({
            view: "compatible-api",
            data: { ...authData, api: apiChoice },
          });
          setAuthView(result.view);
          setAuthData(result.data || authData);
          setAuthDraft("");
          setAuthHighlight(0);
          return;
        }
        const result = processAuthConfirm({ view: authView, data: authData, draft: authDraft });
        setAuthView(result.view);
        setAuthData(result.data);
        setAuthDraft("");
        setAuthHighlight(0);
        if (result.view === "done") {
          // After saving, update the saved providers list
          setAuthSavedProviders(buildListString());
        }
        return;
      }
      if (key.upArrow) {
        if (authView === "main") {
          setAuthHighlight((i) => (i <= 0 ? 3 : i - 1));
        } else if (authView === "openrouter-review" || authView === "cursor-review" || authView === "compatible-review") {
          setAuthHighlight((i) => (i <= 0 ? 1 : 0));
        } else if (authView === "compatible-api") {
          setAuthHighlight((i) => (i <= 0 ? 1 : 0));
        }
        return;
      }
      if (key.downArrow) {
        if (authView === "main") {
          setAuthHighlight((i) => (i >= 3 ? 0 : i + 1));
        } else if (authView === "openrouter-review" || authView === "cursor-review" || authView === "compatible-review") {
          setAuthHighlight((i) => (i >= 1 ? 0 : i + 1));
        } else if (authView === "compatible-api") {
          setAuthHighlight((i) => (i >= 1 ? 0 : i + 1));
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (authDraft.length > 0) {
          setAuthDraft((d) => d.slice(0, -1));
        }
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setAuthDraft((d) => d + char);
        return;
      }
      return;
    }

    if (overlay === "backend") {
      if (key.escape) {
        if (backendView === "compatible") {
          setBackendView("main");
          setBackendHighlight(2); // Compatible row
          return;
        }
        setOverlay("chat");
        setBackendView("main");
        setBackendHighlight(0);
        return;
      }
      if (key.upArrow) {
        if (backendView === "main") {
          setBackendHighlight((i) => (i <= 0 ? 2 : i - 1));
        } else if (backendCompatProviders.length > 0) {
          const n = backendCompatProviders.length;
          setBackendHighlight((i) => (i <= 0 ? n - 1 : i - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (backendView === "main") {
          setBackendHighlight((i) => (i >= 2 ? 0 : i + 1));
        } else if (backendCompatProviders.length > 0) {
          const n = backendCompatProviders.length;
          setBackendHighlight((i) => (i >= n - 1 ? 0 : i + 1));
        }
        return;
      }
      if (key.return) {
        if (backendView === "main") {
          const choice =
            backendHighlight === 0
              ? "openrouter"
              : backendHighlight === 1
                ? "cursor"
                : "compatible";
          if (choice === "compatible") {
            const names = listCompatibleProviderNames();
            setBackendCompatProviders(names);
            if (names.length === 0) {
              setBackendView("compatible");
              setBackendHighlight(0);
              return;
            }
            const settings = loadUserSettings();
            const idx = Math.max(
              0,
              names.indexOf(settings.compatibleProvider ?? ""),
            );
            setBackendView("compatible");
            setBackendHighlight(idx);
            return;
          }
          void (async () => {
            const result = await applyBackendSelection(
              { session: active, pushLine, setBusy },
              choice,
            );
            if (result.sessionPatch) {
              setSessionState((prev) =>
                patchSession(prev, prev.activeId, result.sessionPatch!),
              );
            }
            if (result.message) {
              pushLine(
                result.ok ? `› ${result.message}` : `! ${result.message}`,
              );
            }
            setOverlay("chat");
            setBackendView("main");
            setBackendHighlight(0);
          })();
          return;
        }
        // compatible view
        if (backendCompatProviders.length === 0) {
          return;
        }
        const name = backendCompatProviders[backendHighlight];
        if (!name) return;
        void (async () => {
          const result = await applyBackendSelection(
            { session: active, pushLine, setBusy },
            "compatible",
            name,
          );
          if (result.sessionPatch) {
            setSessionState((prev) =>
              patchSession(prev, prev.activeId, result.sessionPatch!),
            );
          }
          if (result.message) {
            pushLine(
              result.ok ? `› ${result.message}` : `! ${result.message}`,
            );
          }
          setOverlay("chat");
          setBackendView("main");
          setBackendHighlight(0);
        })();
        return;
      }
      return;
    }

    if (key.ctrl && char === "d") {
      setShowDiff((v) => !v);
      return;
    }

    if (isPasteShortcut(char, key)) {
      void applyClipboardPaste();
      return;
    }

    if (key.upArrow && showSlashMenu && slashCompletion) {
      const n = slashCompletion.candidates.length;
      setSlashCandidateIndex((i) => (i <= 0 ? n - 1 : i - 1));
      return;
    }

    if (key.downArrow && showSlashMenu && slashCompletion) {
      const n = slashCompletion.candidates.length;
      setSlashCandidateIndex((i) => (i >= n - 1 ? 0 : i + 1));
      return;
    }

    if (key.tab) {
      if (slashCompletion && slashCompletion.ghostSuffix) {
        applySlashCompletion(slashCompletion);
        return;
      }
      if (slashCompletion && slashCompletion.candidates.length > 1) {
        const next =
          (slashCompletion.candidateIndex + 1) %
          slashCompletion.candidates.length;
        setSlashCandidateIndex(next);
        return;
      }
      const idx = sessionState.sessions.findIndex(
        (s) => s.id === sessionState.activeId,
      );
      setPickerIndex(idx >= 0 ? idx : 0);
      setOverlay("sessions");
      return;
    }

    if (key.ctrl && char === "s") {
      const idx = sessionState.sessions.findIndex(
        (s) => s.id === sessionState.activeId,
      );
      setPickerIndex(idx >= 0 ? idx : 0);
      setOverlay("sessions");
      return;
    }

    if (key.rightArrow && slashCompletion?.ghostSuffix) {
      applySlashCompletion(slashCompletion);
      return;
    }

    if (key.return) {
      submitInput();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((v) => {
        const next = v.slice(0, -1);
        setInputMode(isSlashCommandPrefix(next) ? "slash" : "prompt");
        setSlashCandidateIndex(0);
        return next;
      });
      return;
    }

    if (key.escape) {
      setInput("");
      setInputMode("prompt");
      setSlashCandidateIndex(0);
      return;
    }

    // Bracketed / bulk paste from the terminal (multi-char without Ctrl).
    if (char && char.length > 1) {
      applyPasteToInput(char);
      return;
    }

    // Do not treat unhandled Ctrl+<letter> as literal input (e.g. Ctrl+V → "v").
    if (key.ctrl || key.meta) {
      return;
    }

    if (char) {
      const next = input + char;
      setInput(next);
      setInputMode(isSlashCommandPrefix(next) ? "slash" : "prompt");
      setSlashCandidateIndex(0);
    }
  });

  const busyHint = agentBusyRef.current
    ? " · agent busy (slash commands ok)"
    : isBusy
      ? " · busy"
      : "";
  const slashQuery = findActiveSlashSpan(input)?.query ?? "";

  return (
        <Box flexDirection="column" padding={1}>

      {showWelcome ? <WelcomeBanner session={active} /> : null}

      {overlay === "sessions" && (
        <SessionPicker
          sessions={sessionState.sessions}
          activeId={sessionState.activeId}
          highlightIndex={pickerIndex}
        />
      )}

      {overlay === "chats" && chatPickerList.length > 0 ? (
        <ChatPicker
          chats={chatPickerList}
          activeTaskId={active.taskId}
          highlightIndex={chatPickerIndex}
          renameDraft={chatRenameDraft}
        />
      ) : null}

      {/* Hide transcript while plan/question/model/auth/backend modals are open (keep UI under prompt). */}
      {(overlay === "plan" && planDraft) ||
      (overlay === "question" && questionDraft) ||
      overlay === "model" ||
      overlay === "auth" ||
      overlay === "backend" ? null : (
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingX={1}
        marginY={1}
        minHeight={8}
      >
        {voiceEnabled && voiceStubMessage ? (
          <Text color="#d8a657">{voiceStubMessage}</Text>
        ) : null}
        {!showWelcome ? (
          <Text dimColor>
            Welcome — type a message or /help · ↑↓ slash menu · Tab complete · Ctrl+C cancel · Ctrl+C×2 quit
            {busyHint}
          </Text>
        ) : null}
        {showDiff && diffText ? (
          <DiffViewer diffText={diffText} />
        ) : null}
        {visibleLines.map((line, i) => {
          const key = `${active.id}-${i}`;
          // ── user messages ──────────────────────────────────────────
          if (line.startsWith("you> ")) {
            const msg = line.slice(5);
            return (
              <Text key={key} wrap="wrap">
                <Text bold color="#d8a657">you</Text>
                <Text>  </Text>
                <Text color="#e9e5dc">{msg}</Text>
              </Text>
            );
          }
          // ── agent messages ─────────────────────────────────────────
          if (line.startsWith("agent> ")) {
            const msg = line.slice(7);
            return (
              <Text key={key} wrap="wrap">
                <Text dimColor color="#9b7c43">agent</Text>
                <Text>  </Text>
                <Text color="#e9e5dc">{msg}</Text>
              </Text>
            );
          }
          // ── tool / side-channel lines ──────────────────────────────
          if (line.startsWith("› ")) {
            const desc = line.slice(2);
            // Check for edit summaries: "✓" (checkmark) in muted green
            if (desc.startsWith("✓")) {
              const rest = desc.slice(1);
              return (
                <Text key={key} wrap="wrap">
                  <Text>  </Text>
                  <Text dimColor color="#5b574d">› </Text>
                  <Text color="#89b482">✓</Text>
                  <Text color="#928d80" dimColor>{rest}</Text>
                </Text>
              );
            }
            return (
              <Text key={key} wrap="wrap">
                <Text>  </Text>
                <Text dimColor color="#5b574d">› </Text>
                <Text color="#928d80" dimColor>{desc}</Text>
              </Text>
            );
          }
          // ── error / warning lines ──────────────────────────────────
          if (line.startsWith("! ")) {
            return (
              <Text key={key} wrap="wrap" color="#d8a657">{line}</Text>
            );
          }
          // ── plain lines (default foreground) ───────────────────────
          return (
            <Text key={key} wrap="wrap" color="#e9e5dc">{line}</Text>
          );
        })}
      </Box>
      )}

      {showSlashMenu && slashCompletion ? (
        <SlashAutocomplete
          candidates={slashCompletion.candidates}
          selectedIndex={slashCompletion.candidateIndex}
          query={slashQuery}
        />
      ) : null}

      {overlay === "plan" && planDraft ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <PlanPicker
            plan={planDraft}
            focus={planFocus}
            reviseDraft={planReviseDraft}
            loading={planLoading}
          />
        </Box>
      ) : null}

      {overlay === "question" && questionDraft ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <QuestionPicker
            question={questionDraft}
            highlightIndex={questionHighlight}
            freeTextDraft={questionFreeText}
          />
        </Box>
      ) : null}

      {overlay === "model" && modelPickerLoading ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end" marginBottom={1}>
          <Text color="cyan">Loading model catalog…</Text>
        </Box>
      ) : null}

      {overlay === "model" && modelPicker && !modelPickerLoading ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <ModelPicker
            state={modelPicker}
            current={currentPickerChoice(active, modelPicker.target)}
            backend={loadUserSettings().backend}
          />
        </Box>
      ) : null}

      {overlay === "auth" ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <AuthDialog
            view={authView}
            highlightIndex={authHighlight}
            draft={authDraft}
            data={authData}
            savedProviders={authSavedProviders}
          />
        </Box>
      ) : null}

      {overlay === "backend" ? (
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          <BackendPicker
            view={backendView}
            highlightIndex={backendHighlight}
            currentBackend={loadUserSettings().backend}
            currentCompatibleProvider={
              loadUserSettings().compatibleProvider
            }
            compatibleProviders={backendCompatProviders}
          />
        </Box>
      ) : null}

      {busyUi ? (
        <BusySpinner
          active
          startedAt={busyUi.startedAt}
          label={busyUi.label}
          detail={busyUi.detail}
        />
      ) : null}

      <PromptLine
        session={active}
        input={input}
        inputMode={inputMode}
        slashCompletion={slashCompletion}
        isBusy={isBusy}
      />
    </Box>
  );
}
