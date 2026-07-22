import { FALLBACK_MODEL_ID, CURSOR_DEFAULT_MODEL_ID } from "../models/catalog.js";
import { loadUserSettings } from "../config/user-settings.js";
import type { CliSession, SessionState } from "./types.js";
import type { SkillBundleName } from "../skills/bundles.js";

function defaultModelId(): string {
  const settings = loadUserSettings();
  if (settings.backend === "cursor") {
    return settings.cursorModel || CURSOR_DEFAULT_MODEL_ID;
  }
  if (settings.backend === "compatible") {
    return settings.defaultModel || FALLBACK_MODEL_ID;
  }
  return settings.defaultModel || FALLBACK_MODEL_ID;
}

function newId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(index: number, cwd: string): CliSession {
  const id = newId();
  const modelId = defaultModelId();
  const settings = loadUserSettings();
  const modelParams =
    settings.backend === "cursor" && settings.cursorModelParams?.length
      ? settings.cursorModelParams
      : undefined;
  return {
    id,
    title: `Session ${index}`,
    modelId,
    ...(modelParams ? { modelParams } : {}),
    cwd,
    createdAt: new Date().toISOString(),
    lines: [
      `[${id}] ready — type a message or /help for slash commands (Phase 0b).`,
    ],
  };
}

export function createInitialSessionState(cwd: string): SessionState {
  const first = createSession(1, cwd);
  return { sessions: [first], activeId: first.id };
}

export function getActiveSession(state: SessionState): CliSession {
  const found = state.sessions.find((s) => s.id === state.activeId);
  if (!found) {
    throw new Error("active session missing");
  }
  return found;
}

export function addSession(state: SessionState, cwd: string): SessionState {
  const next = createSession(state.sessions.length + 1, cwd);
  return {
    sessions: [...state.sessions, next],
    activeId: next.id,
  };
}

export function switchSession(state: SessionState, id: string): SessionState {
  if (!state.sessions.some((s) => s.id === id)) {
    return state;
  }
  return { ...state, activeId: id };
}

export function removeSession(state: SessionState, id: string): SessionState {
  if (state.sessions.length <= 1) {
    return state;
  }
  const sessions = state.sessions.filter((s) => s.id !== id);
  const activeId = state.activeId === id ? sessions[0].id : state.activeId;
  return { sessions, activeId };
}

export function patchSession(
  state: SessionState,
  sessionId: string,
  patch: Partial<CliSession>,
): SessionState {
  const sessions = state.sessions.map((s) =>
    s.id === sessionId ? { ...s, ...patch, id: s.id } : s,
  );
  return { ...state, sessions };
}

export function setSkillBundle(
  state: SessionState,
  sessionId: string,
  bundle: SkillBundleName,
  prompt: string,
): SessionState {
  return patchSession(state, sessionId, {
    skillBundle: bundle,
    skillBundlePrompt: prompt,
  });
}

export function appendLine(state: SessionState, line: string): SessionState {
  const sessions = state.sessions.map((s) =>
    s.id === state.activeId ? { ...s, lines: [...s.lines, line] } : s,
  );
  return { ...state, sessions };
}

/** Replace the last line of the active session (streaming agent output). */
export function replaceLastLine(
  state: SessionState,
  line: string,
): SessionState {
  const sessions = state.sessions.map((s) => {
    if (s.id !== state.activeId) {
      return s;
    }
    const lines = [...s.lines];
    if (lines.length > 0) {
      lines[lines.length - 1] = line;
    } else {
      lines.push(line);
    }
    return { ...s, lines };
  });
  return { ...state, sessions };
}
