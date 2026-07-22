import type { CliSession, SessionState } from "../session/types.js";
import { loadUserSettings } from "../config/user-settings.js";
import {
  fetchAvailableModelIds,
  resolveModelId,
  resolveModelIdAgainstCatalog,
  resolveModelIdOffline,
} from "./catalog.js";

export interface ModelResolveReport {
  sessionId: string;
  from: string;
  to: string;
}

/** Resolve every session modelId against the backend-appropriate catalog. */
export async function validateSessionStateModels(
  state: SessionState,
  credential: string,
): Promise<{ state: SessionState; remapped: ModelResolveReport[] }> {
  const settings = loadUserSettings();
  // Cursor / compatible backends don't use the OpenRouter YAML catalog remap.
  if (settings.backend === "cursor" || settings.backend === "compatible") {
    return { state, remapped: [] };
  }

  const key = credential.trim();
  const remapped: ModelResolveReport[] = [];
  let available: Set<string> | null = null;

  if (key) {
    try {
      available = await fetchAvailableModelIds(key);
    } catch {
      available = null;
    }
  }

  const sessions = state.sessions.map((session) => {
    const resolved = available?.size
      ? resolveModelIdAgainstCatalog(session.modelId, available)
      : resolveModelIdOffline(session.modelId);
    if (resolved !== session.modelId) {
      remapped.push({
        sessionId: session.id,
        from: session.modelId,
        to: resolved,
      });
      return { ...session, modelId: resolved };
    }
    return session;
  });

  return {
    state: remapped.length > 0 ? { ...state, sessions } : state,
    remapped,
  };
}

export async function ensureSessionModel(
  session: CliSession,
  credential: string,
): Promise<{ session: CliSession; remapped: boolean }> {
  const settings = loadUserSettings();
  // Cursor / compatible backends skip OpenRouter YAML remapping.
  if (settings.backend === "cursor" || settings.backend === "compatible") {
    return { session, remapped: false };
  }

  const resolved = await resolveModelId(session.modelId, credential);
  if (resolved === session.modelId) {
    return { session, remapped: false };
  }
  return {
    session: { ...session, modelId: resolved },
    remapped: true,
  };
}

export function logModelRemaps(remapped: ModelResolveReport[]): void {
  for (const r of remapped) {
    process.stderr.write(
      `cursorsi: model "${r.from}" unavailable; using "${r.to}" (see config/sispace.yaml models)\n`,
    );
  }
}
