import { findProjectRoot } from "../project/root.js";
import {
  DEFAULT_MODEL,
  loadModelConfig,
  modelCatalogFromConfig,
  modelIdsFromConfig,
} from "../config/models.js";
import type { ModelListItem } from "../sdk/types.js";
import { getCursorSdk } from "../sdk/cursor-agent-backend.js";
import { cursorTokenFromEnv } from "../sdk/session-agent.js";

/** Sync fallback when catalog fetch is unavailable. */
export const FALLBACK_MODEL_ID = DEFAULT_MODEL;

/** Default Cursor model id when the user hasn't picked one. */
export const CURSOR_DEFAULT_MODEL_ID = "auto";

/** Legacy SISpace ids mapped to OpenRouter defaults. */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  "composer-2.5-fast": DEFAULT_MODEL,
  "composer-2.5": DEFAULT_MODEL,
  "composer-2": DEFAULT_MODEL,
  default: DEFAULT_MODEL,
};

const PREFERRED_DEFAULT_ORDER = [
  DEFAULT_MODEL,
  "deepseek/deepseek-v4-pro",
  "anthropic/claude-sonnet-4.6",
  "nex-agi/nex-n2-pro:free",
];

let cachedIds: Set<string> | null = null;
let cachedList: ModelListItem[] | null = null;
let cacheRoot = "";

/** Per-process cache for Cursor SDK model list. */
let cachedCursorModels: ModelListItem[] | null = null;
let cachedCursorCursorKey = "";

function catalogForCwd(cwd: string): { ids: Set<string>; list: ModelListItem[] } {
  const root = findProjectRoot(cwd);
  if (cachedIds && cachedList && cacheRoot === root) {
    return { ids: cachedIds, list: cachedList };
  }
  cachedList = modelCatalogFromConfig(root);
  cachedIds = modelIdsFromConfig(root);
  cacheRoot = root;
  return { ids: cachedIds, list: cachedList };
}

/** Fetch model ids from config/sispace.yaml; cached per project root. */
export async function fetchAvailableModelIds(
  credential: string,
  cwd = process.cwd(),
): Promise<Set<string>> {
  void credential;
  return catalogForCwd(cwd).ids;
}

/** Fetch model catalog entries from config/sispace.yaml. */
export async function fetchModelCatalog(
  credential: string,
  cwd = process.cwd(),
): Promise<ModelListItem[]> {
  void credential;
  return catalogForCwd(cwd).list;
}

/** Clear cache (tests). */
export function resetModelCatalogCache(): void {
  cachedIds = null;
  cachedList = null;
  cacheRoot = "";
  cachedCursorModels = null;
  cachedCursorCursorKey = "";
}

/** Fetch Cursor SDK model list via Cursor.models.list(). Cached per-process. */
export async function fetchCursorModels(): Promise<ModelListItem[]> {
  const key = (cursorTokenFromEnv() ?? "").trim();
  if (!key) {
    throw new Error(
      "Cursor model list unavailable: CURSOR_API_KEY is not set in environment",
    );
  }

  // Per-process cache — keyed by api key prefix (different keys = different accounts)
  const keyPrefix = key.slice(0, 8);
  if (cachedCursorModels && cachedCursorCursorKey === keyPrefix) {
    return cachedCursorModels;
  }

  try {
    const sdk = await getCursorSdk();
    const raw: ModelListItem[] = await sdk.Cursor.models.list({ apiKey: key });
    if (!Array.isArray(raw)) {
      throw new Error(
        `Cursor models list returned non-array: ${typeof raw}`,
      );
    }
    cachedCursorModels = raw;
    cachedCursorCursorKey = keyPrefix;
    return raw;
  } catch (err) {
    cachedCursorModels = null;
    cachedCursorCursorKey = "";
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cursor model list unavailable: ${msg}`);
  }
}

/**
 * Map a requested model id to one present in the catalog (or offline legacy map).
 */
export function resolveModelIdAgainstCatalog(
  requested: string | null | undefined,
  available: ReadonlySet<string>,
): string {
  const raw = requested?.trim();
  if (raw && available.has(raw)) {
    return raw;
  }
  if (raw && LEGACY_TO_CANONICAL[raw] && available.has(LEGACY_TO_CANONICAL[raw])) {
    return LEGACY_TO_CANONICAL[raw];
  }
  for (const pref of PREFERRED_DEFAULT_ORDER) {
    if (available.has(pref)) {
      return pref;
    }
  }
  const first = available.values().next().value;
  return first ?? FALLBACK_MODEL_ID;
}

/** Offline resolve without API (legacy alias + fallback only). */
export function resolveModelIdOffline(
  requested: string | null | undefined,
  cwd = process.cwd(),
): string {
  const raw = requested?.trim();
  const cfg = loadModelConfig(findProjectRoot(cwd));
  if (!raw) {
    return cfg.default || FALLBACK_MODEL_ID;
  }
  if (LEGACY_TO_CANONICAL[raw]) {
    return LEGACY_TO_CANONICAL[raw];
  }
  return raw;
}

export async function resolveModelId(
  requested: string | null | undefined,
  credential: string,
  cwd = process.cwd(),
): Promise<string> {
  void credential;
  try {
    const available = await fetchAvailableModelIds("", cwd);
    if (available.size === 0) {
      return resolveModelIdOffline(requested, cwd);
    }
    return resolveModelIdAgainstCatalog(requested, available);
  } catch {
    return resolveModelIdOffline(requested, cwd);
  }
}
