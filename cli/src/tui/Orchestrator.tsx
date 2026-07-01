import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSlashCompletion } from "../commands/slash-catalog.js";
import { runSlashCommand } from "../commands/slash.js";
import { sendSessionMessage, tokenFromEnv } from "../sdk/session-agent.js";
import {
  hydrateCompactionFromDb,
  runSessionCompaction,
  shouldAutoCompact,
  compactionConfigFromCwd,
} from "../session/compaction.js";
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
  const [overlay, setOverlay] = useState<"chat" | "sessions" | "model">("chat");
  const [modelPicker, setModelPicker] = useState<ModelPickerState | null>(null);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<"prompt" | "slash">("prompt");
  const [slashCandidateIndex, setSlashCandidateIndex] = useState(0);
  const [dismissWelcome, setDismissWelcome] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [showDiff, setShowDiff] = useState(true);
  const busyRef = useRef(false);
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

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setIsBusy(busy);
  }, []);

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

      // OpenRouter backend — existing catalog flow
      const credential = tokenFromEnv() ?? "";
      if (!credential.trim()) {
        pushLine("! Set OpenRouter API key to list models (/model requires auth)");
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
          pushLine("! No models returned from config/sispace.yaml");
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

    // Persist the Cursor model choice to user settings if using Cursor backend
    const settings = loadUserSettings();
    if (settings.backend === "cursor" && modelPicker.target === "orchestrator") {
      saveUserSettings({
        cursorModel: choice.modelId,
        cursorModelParams: choice.params?.length ? choice.params : undefined,
      });
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
      triggerAutoReflectOnSessionEnd(session);
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
      triggerAutoReflectOnSessionEnd(activeRef.current);
    };
  }, [clearAgentStreamFlush]);

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
      setBusy(true);
      let workingSession = baseSession;
      const compactCfg = compactionConfigFromCwd(baseSession.cwd);
      if (shouldAutoCompact(workingSession, compactCfg)) {
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
          onTextDelta: (text) => {
            streamTextRef.current = text;
            scheduleAgentStreamFlush();
          },
          onStatusLine: (line) => {
            // Buffer tool call status lines; show only a summary after the turn.
            if (line.startsWith("›")) {
              toolStatusBuffer.push(line);
              // Count tool-call start lines (not checkmark result lines)
              if (line.startsWith("› ") && !line.startsWith("› ✓")) {
                toolCallCountRef.current += 1;
              }
            } else {
              // Pass through non-tool lines (e.g. warnings starting with "!")
              pushLine(line);
            }
          },
        });

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

        setSessionState((prev) =>
          patchSession(prev, prev.activeId, {
            ...(agentId ? { cursorAgentId: agentId } : {}),
            contextInjected: true,
            injectGoalContext: false,
            ...(goal ? { activeGoal: goal } : {}),
            // Update real context token count from the API response
            ...(result.promptTokens !== undefined ? { contextTokens: result.promptTokens } : {}),
          }),
        );

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

      setBusy(false);
    },
    [
      setBusy,
      pushLine,
      clearAgentStreamFlush,
      flushAgentStreamLine,
      scheduleAgentStreamFlush,
    ],
  );

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
    if (!value || isBusy || busyRef.current) {
      if (!value) setInput("");
      return;
    }

    const session = active;
    setInput("");
    setInputMode("prompt");
    setDismissWelcome(true);

    const slashInvocation = extractKnownSlashInvocation(value);
    if (slashInvocation) {
      void (async () => {
        const result = await runSlashCommand(slashInvocation, {
          session,
          pushLine,
          setBusy,
        });

        if (!result) {
          void runAgentTurn(value, session);
          return;
        }

        if (result.openModelPicker) {
          if (result.ok) {
            pushLine(`› ${result.message}`);
          }
          await openModelPicker(result.openModelPicker);
          return;
        }
        if (result.sessionPatch) {
          setSessionState((prev) =>
            patchSession(prev, prev.activeId, result.sessionPatch!),
          );
        }
        pushLine(result.ok ? `› ${result.message}` : `! ${result.message}`);
      })();
      return;
    }

    void (async () => {
      await runAgentTurn(value, session);
    })();
  }, [
    input,
    isBusy,
    active,
    pushLine,
    setBusy,
    runAgentTurn,
    showSlashMenu,
    slashCompletion,
    openModelPicker,
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

    if (isBusy || busyRef.current) {
      if (isQuitShortcut(char, key)) {
        endSession(active);
        exit();
      }
      return;
    }

    if (isQuitShortcut(char, key)) {
      endSession(active);
      exit();
      return;
    }

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

  const busyHint = isBusy ? " · agent busy" : "";
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

      {overlay === "model" && modelPicker && !modelPickerLoading ? (
        <ModelPicker
          state={modelPicker}
          current={currentPickerChoice(active, modelPicker.target)}
          backend={loadUserSettings().backend}
        />
      ) : null}

      {overlay === "model" && modelPickerLoading ? (
        <Box marginBottom={1}>
          <Text color="cyan">Loading model catalog…</Text>
        </Box>
      ) : null}

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
            Welcome — type a message or /help · ↑↓ slash menu · Tab complete · Ctrl+C quit
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

      {showSlashMenu && slashCompletion ? (
        <SlashAutocomplete
          candidates={slashCompletion.candidates}
          selectedIndex={slashCompletion.candidateIndex}
          query={slashQuery}
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
