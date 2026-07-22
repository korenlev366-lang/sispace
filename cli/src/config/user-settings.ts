/**
 * Persistent per-user settings for cursorsi.
 *
 * Reads/writes ~/.config/cursors/settings.json (with $XDG_CONFIG_HOME fallback).
 * Hand-rolled JSON, no external dependencies — matches the style of cli/src/config/*.
 *
 * This is the SINGLE source of truth for the user's chosen backend and default model.
 * It does NOT interact with config/sispace.yaml (which is a static model catalog).
 *
 * Interface is intentionally minimal (version 1) — extend by adding fields, never by changing
 * the existing contract.
 *
 * @see CURSORSI_CLI_PLAN.md § User settings
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ─── Types ───────────────────────────────────────────────────────────────

export const USER_SETTINGS_VERSION = 1 as const;

export type BackendName = "openrouter" | "cursor" | "compatible";

/** Qwen-style project memory / auto-skill toggles (defaults on). */
export interface MemoryUserSettings {
  /** Declarative project memory under .cursorsi/memory/ (default true). */
  enableAutoMemory?: boolean;
  /** Procedural auto-skills under .cursorsi/skills/ (default true). */
  enableAutoSkill?: boolean;
}

export interface UserSettings {
  /** Settings schema version. Always 1 for now. */
  version: typeof USER_SETTINGS_VERSION;
  /** Chosen orchestrator backend. Defaults to "openrouter". */
  backend: BackendName;
  /**
   * Optional override of the default model from the catalog.
   * If absent, the catalog's `default` key from config/sispace.yaml is used.
   */
  defaultModel?: string;
  /**
   * Per-backend model id — used when backend is "cursor".
   * Holds the Cursor SDK model id (e.g. "glm-5.2", "claude-opus-4-8").
   * If absent, defaults to "auto" (the Cursor SDK default model).
   */
  cursorModel?: string;
  /**
   * Serialized model params for the cursor model selection.
   * Only meaningful when backend is "cursor". Format: Array<{id, value}>
   * (e.g. [{ id: "reasoning", value: "max" }]).
   */
  cursorModelParams?: Array<{ id: string; value: string }>;
  /**
   * Active compatible provider name (from ~/.cursorsi/credentials.json).
   * Only meaningful when backend is "compatible".
   */
  compatibleProvider?: string;
  /** Auto memory / auto-skill (project .cursorsi/). */
  memory?: MemoryUserSettings;
}

const DEFAULT_SETTINGS: UserSettings = {
  version: USER_SETTINGS_VERSION,
  backend: "openrouter",
  memory: {
    enableAutoMemory: true,
    enableAutoSkill: true,
  },
};

// ─── Path resolution ─────────────────────────────────────────────────────

const CONFIG_DIR_NAME = "cursorsi";
const SETTINGS_FILE_NAME = "settings.json";

/**
 * Resolve the settings file path using $XDG_CONFIG_HOME or ~/.config as fallback.
 */
export function userSettingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && existsSync(xdg) ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME, SETTINGS_FILE_NAME);
}

// ─── Read ────────────────────────────────────────────────────────────────

/**
 * Load user settings from disk.
 *
 * Never throws. If the file is missing, malformed, or the version doesn't match,
 * returns default settings and logs a warning to stderr.
 */
export function loadUserSettings(): UserSettings {
  const path = userSettingsPath();

  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== USER_SETTINGS_VERSION
    ) {
      process.stderr.write(
        `cursorsi: user settings file ${path} has unrecognized version (expected ${USER_SETTINGS_VERSION}); ` +
          `falling back to defaults.\n`,
      );
      return { ...DEFAULT_SETTINGS };
    }

    const backendRaw = String(parsed.backend ?? "").trim().toLowerCase();
    const backend: BackendName =
      backendRaw === "cursor"
        ? "cursor"
        : backendRaw === "compatible"
          ? "compatible"
          : "openrouter";

    const defaultModelRaw = parsed.defaultModel;
    const defaultModel =
      typeof defaultModelRaw === "string" && defaultModelRaw.trim()
        ? defaultModelRaw.trim()
        : undefined;

    const cursorModelRaw = parsed.cursorModel;
    const cursorModel =
      typeof cursorModelRaw === "string" && cursorModelRaw.trim()
        ? cursorModelRaw.trim()
        : undefined;

    const compatibleProviderRaw = parsed.compatibleProvider;
    const compatibleProvider =
      typeof compatibleProviderRaw === "string" && compatibleProviderRaw.trim()
        ? compatibleProviderRaw.trim().toLowerCase()
        : undefined;

    let cursorModelParams: Array<{ id: string; value: string }> | undefined;
    if (Array.isArray(parsed.cursorModelParams)) {
      const filtered = parsed.cursorModelParams.filter(
        (p: unknown) =>
          p && typeof p === "object" &&
          typeof (p as Record<string, unknown>).id === "string" &&
          typeof (p as Record<string, unknown>).value === "string",
      ) as Array<{ id: string; value: string }>;
      if (filtered.length > 0) {
        cursorModelParams = filtered;
      }
    }

    let memory: MemoryUserSettings | undefined;
    if (parsed.memory && typeof parsed.memory === "object") {
      const m = parsed.memory as Record<string, unknown>;
      memory = {
        enableAutoMemory:
          typeof m.enableAutoMemory === "boolean"
            ? m.enableAutoMemory
            : true,
        enableAutoSkill:
          typeof m.enableAutoSkill === "boolean" ? m.enableAutoSkill : true,
      };
    }

    return {
      version: USER_SETTINGS_VERSION,
      backend,
      ...(defaultModel ? { defaultModel } : {}),
      ...(cursorModel ? { cursorModel } : {}),
      ...(compatibleProvider ? { compatibleProvider } : {}),
      ...(cursorModelParams ? { cursorModelParams } : {}),
      memory: memory ?? { enableAutoMemory: true, enableAutoSkill: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `cursorsi: failed to parse user settings at ${path}: ${msg}; falling back to defaults.\n`,
    );
    return { ...DEFAULT_SETTINGS };
  }
}

// ─── Write ───────────────────────────────────────────────────────────────

/**
 * Save (partial) user settings to disk.
 *
 * Merges the provided partial update into the existing file (if any) and writes
 * it back. Creates the parent directory if it doesn't exist.
 *
 * This is the ONLY function that should write to the user settings file.
 */
export function saveUserSettings(partial: Partial<UserSettings>): void {
  const path = userSettingsPath();
  const dir = dirname(path);

  // Read existing to merge
  let existing: UserSettings;
  try {
    existing = { ...loadUserSettings() };
  } catch {
    existing = { ...DEFAULT_SETTINGS };
  }

  // Merge: partial fields win over existing (deep-merge memory toggles).
  const merged: UserSettings = {
    ...existing,
    ...partial,
    version: USER_SETTINGS_VERSION, // always enforce current version
    memory: {
      enableAutoMemory: true,
      enableAutoSkill: true,
      ...existing.memory,
      ...partial.memory,
    },
  };

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `cursorsi: failed to write user settings to ${path}: ${msg}\n`,
    );
  }
}