/**
 * Secure credentials store for CursorSI API keys and compatible endpoints.
 *
 * Path: ~/.cursorsi/credentials.json (mode 0600).
 * Env vars still win when set; this file is the interactive /auth fallback.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CREDENTIALS_VERSION = 1 as const;
export const OPENROUTER_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

export type CompatibleApiStyle = "openai" | "anthropic";

export interface OpenRouterCredentials {
  key: string;
  /** Optional model slugs used in the model picker / defaults. */
  models?: string[];
  /** Defaults to OpenRouter public API. */
  endpoint?: string;
}

export interface CursorCredentials {
  key: string;
}

export interface CompatibleProviderCredentials {
  endpoint: string;
  key: string;
  models: string[];
  /** Chat API style. Defaults to openai (chat/completions). */
  api?: CompatibleApiStyle;
}

export interface CredentialsProviders {
  openrouter?: OpenRouterCredentials;
  cursor?: CursorCredentials;
  compatible?: Record<string, CompatibleProviderCredentials>;
}

export interface CredentialsFile {
  version: typeof CREDENTIALS_VERSION;
  providers: CredentialsProviders;
}

const EMPTY: CredentialsFile = {
  version: CREDENTIALS_VERSION,
  providers: {},
};

/** Resolve ~/.cursorsi/credentials.json (override with CURSORSI_CREDENTIALS_PATH). */
export function credentialsPath(): string {
  const override = process.env.CURSORSI_CREDENTIALS_PATH?.trim();
  if (override) return override;
  return join(homedir(), ".cursorsi", "credentials.json");
}

export function validateUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed);
}

/** Mask a secret for display: sk-****abcd */
export function maskSecret(key: string): string {
  const k = key.trim();
  if (!k) return "(empty)";
  if (k.length <= 8) return "****";
  const prefix = k.slice(0, Math.min(4, k.length - 4));
  const suffix = k.slice(-4);
  return `${prefix}****${suffix}`;
}

function normalizeModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);
}

function parseCompatibleEntry(
  raw: unknown,
): CompatibleProviderCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const endpoint = typeof o.endpoint === "string" ? o.endpoint.trim() : "";
  const key = typeof o.key === "string" ? o.key.trim() : "";
  const models = normalizeModels(o.models);
  if (!endpoint || !key) return null;
  const apiRaw = String(o.api ?? "openai").trim().toLowerCase();
  const api: CompatibleApiStyle =
    apiRaw === "anthropic" ? "anthropic" : "openai";
  return { endpoint, key, models, api };
}

/**
 * Load credentials from disk. Never throws — returns empty on missing/invalid.
 */
export function readCredentials(): CredentialsFile {
  const path = credentialsPath();
  if (!existsSync(path)) {
    return { ...EMPTY, providers: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== CREDENTIALS_VERSION
    ) {
      process.stderr.write(
        `cursorsi: credentials file ${path} has unrecognized version; ignoring.\n`,
      );
      return { ...EMPTY, providers: {} };
    }
    const providersRaw =
      parsed.providers && typeof parsed.providers === "object"
        ? (parsed.providers as Record<string, unknown>)
        : {};

    const providers: CredentialsProviders = {};

    if (providersRaw.openrouter && typeof providersRaw.openrouter === "object") {
      const or = providersRaw.openrouter as Record<string, unknown>;
      const key = typeof or.key === "string" ? or.key.trim() : "";
      if (key) {
        const models = normalizeModels(or.models);
        const endpoint =
          typeof or.endpoint === "string" && or.endpoint.trim()
            ? or.endpoint.trim()
            : undefined;
        providers.openrouter = {
          key,
          ...(models.length ? { models } : {}),
          ...(endpoint ? { endpoint } : {}),
        };
      }
    }

    if (providersRaw.cursor && typeof providersRaw.cursor === "object") {
      const c = providersRaw.cursor as Record<string, unknown>;
      const key = typeof c.key === "string" ? c.key.trim() : "";
      if (key) {
        providers.cursor = { key };
      }
    }

    if (
      providersRaw.compatible &&
      typeof providersRaw.compatible === "object"
    ) {
      const compat: Record<string, CompatibleProviderCredentials> = {};
      for (const [name, entry] of Object.entries(
        providersRaw.compatible as Record<string, unknown>,
      )) {
        const slug = name.trim().toLowerCase();
        if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) continue;
        const parsedEntry = parseCompatibleEntry(entry);
        if (parsedEntry) compat[slug] = parsedEntry;
      }
      if (Object.keys(compat).length > 0) {
        providers.compatible = compat;
      }
    }

    return { version: CREDENTIALS_VERSION, providers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `cursorsi: failed to parse credentials at ${path}: ${msg}\n`,
    );
    return { ...EMPTY, providers: {} };
  }
}

/**
 * Merge and write credentials. Creates ~/.cursorsi with mode 0700 and
 * credentials.json with mode 0600.
 */
export function writeCredentials(partial: {
  openrouter?: OpenRouterCredentials | null;
  cursor?: CursorCredentials | null;
  compatible?: Record<string, CompatibleProviderCredentials | null>;
}): CredentialsFile {
  const path = credentialsPath();
  const dir = dirname(path);
  const existing = readCredentials();
  const providers: CredentialsProviders = { ...existing.providers };

  if (partial.openrouter === null) {
    delete providers.openrouter;
  } else if (partial.openrouter) {
    const prev = existing.providers.openrouter;
    const models =
      partial.openrouter.models !== undefined
        ? [...partial.openrouter.models]
        : prev?.models
          ? [...prev.models]
          : undefined;
    const endpoint =
      partial.openrouter.endpoint?.trim() || prev?.endpoint || undefined;
    providers.openrouter = {
      key: partial.openrouter.key.trim(),
      ...(models && models.length ? { models } : {}),
      ...(endpoint ? { endpoint } : {}),
    };
  }

  if (partial.cursor === null) {
    delete providers.cursor;
  } else if (partial.cursor) {
    providers.cursor = { key: partial.cursor.key.trim() };
  }

  if (partial.compatible) {
    const map = { ...(providers.compatible ?? {}) };
    for (const [name, entry] of Object.entries(partial.compatible)) {
      const slug = name.trim().toLowerCase();
      if (!slug) continue;
      if (entry === null) {
        delete map[slug];
      } else {
        if (!validateUrl(entry.endpoint)) {
          throw new Error(
            `Invalid endpoint URL (must start with http:// or https://): ${entry.endpoint}`,
          );
        }
        map[slug] = {
          endpoint: entry.endpoint.trim().replace(/\/+$/, ""),
          key: entry.key.trim(),
          models: normalizeModels(entry.models),
          api: entry.api === "anthropic" ? "anthropic" : "openai",
        };
      }
    }
    if (Object.keys(map).length > 0) {
      providers.compatible = map;
    } else {
      delete providers.compatible;
    }
  }

  const file: CredentialsFile = {
    version: CREDENTIALS_VERSION,
    providers,
  };

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }

  return file;
}

/** Push stored keys into process.env + globals when env is empty. */
export function applyCredentialsToRuntime(
  creds: CredentialsFile = readCredentials(),
): void {
  const g = globalThis as {
    __cursorsiCk?: string;
    __cursorsiCursorKey?: string;
  };

  const orKey = creds.providers.openrouter?.key?.trim();
  if (orKey && !process.env.OPENROUTER_API_KEY?.trim() && !g.__cursorsiCk) {
    process.env.OPENROUTER_API_KEY = orKey;
    g.__cursorsiCk = orKey;
  } else if (orKey && !g.__cursorsiCk) {
    g.__cursorsiCk = process.env.OPENROUTER_API_KEY?.trim() || orKey;
  }

  const cursorKey = creds.providers.cursor?.key?.trim();
  if (
    cursorKey &&
    !process.env.CURSOR_API_KEY?.trim() &&
    !g.__cursorsiCursorKey
  ) {
    process.env.CURSOR_API_KEY = cursorKey;
    g.__cursorsiCursorKey = cursorKey;
  } else if (cursorKey && !g.__cursorsiCursorKey) {
    g.__cursorsiCursorKey =
      process.env.CURSOR_API_KEY?.trim() || cursorKey;
  }
}

export function resolveOpenRouterCredentials(): {
  key?: string;
  endpoint: string;
  models: string[];
} {
  const fromFile = readCredentials().providers.openrouter;
  const g = globalThis as { __cursorsiCk?: string };
  const key =
    g.__cursorsiCk?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    fromFile?.key?.trim() ||
    undefined;
  return {
    key,
    endpoint:
      fromFile?.endpoint?.trim() || OPENROUTER_DEFAULT_ENDPOINT,
    models: fromFile?.models ?? [],
  };
}

export function resolveCursorCredentials(): { key?: string } {
  const fromFile = readCredentials().providers.cursor;
  const g = globalThis as { __cursorsiCursorKey?: string };
  const key =
    g.__cursorsiCursorKey?.trim() ||
    process.env.CURSOR_API_KEY?.trim() ||
    fromFile?.key?.trim() ||
    undefined;
  return { key };
}

export function resolveCompatibleProvider(
  name: string,
): CompatibleProviderCredentials | undefined {
  const slug = name.trim().toLowerCase();
  if (!slug) return undefined;
  return readCredentials().providers.compatible?.[slug];
}

export function listCompatibleProviderNames(): string[] {
  return Object.keys(readCredentials().providers.compatible ?? {}).sort();
}
