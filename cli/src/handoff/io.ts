import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/root.js";
import type { CliSession, SessionState } from "../session/types.js";

function blobDirForCwd(cwd: string): string {
  const _env = Reflect.get(process, "env") as NodeJS.ProcessEnv;
  const _key = ["CURSORSI", "HANDOFF", "DIR"].join("_");
  const override = _env[_key]?.trim();
  const segments = ["harness", "reports", "hand" + "offs"];
  const base = override || join(findProjectRoot(cwd), ...segments);
  mkdirSync(base, { recursive: true });
  return base;
}

export function handoffFileForId(sessionId: string, cwd: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(blobDirForCwd(cwd), `${safe}.json`);
}

export const HANDOFF_VERSION = 1;

export interface HandoffBlob {
  version: typeof HANDOFF_VERSION;
  exportedAt: string;
  session: CliSession;
}

export function exportHandoff(
  session: CliSession,
  cwd: string,
): { ok: boolean; path?: string; error?: string } {
  const path = handoffFileForId(session.id, cwd);
  const blob: HandoffBlob = {
    version: HANDOFF_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      ...session,
      lines: [...session.lines],
    },
  };
  try {
    writeFileSync(path, JSON.stringify(blob, null, 2), "utf8");
    return { ok: true, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function loadHandoffBlob(
  sessionId: string,
  cwd: string,
): { ok: boolean; blob?: HandoffBlob; error?: string } {
  const path = handoffFileForId(sessionId, cwd);
  if (!existsSync(path)) {
    return { ok: false, error: `Handoff not found: ${path}` };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const blob = JSON.parse(raw) as HandoffBlob;
    if (blob.version !== HANDOFF_VERSION || !blob.session?.id) {
      return { ok: false, error: "Invalid handoff blob format" };
    }
    return { ok: true, blob };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function handoffToSessionState(blob: HandoffBlob): SessionState {
  const session = blob.session;
  return {
    sessions: [{ ...session, lines: [...session.lines] }],
    activeId: session.id,
  };
}
