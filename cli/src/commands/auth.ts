/**
 * /auth slash command — Qwen Code-style interactive AuthDialog.
 *
 * Opens a step-by-step TUI for configuring OpenRouter, Cursor, or
 * compatible providers. The Orchestrator manages the dialog flow.
 */

import {
  applyCredentialsToRuntime,
  credentialsPath,
  listCompatibleProviderNames,
  maskSecret,
  readCredentials,
  resolveCompatibleProvider,
  validateUrl,
  writeCredentials,
  type CompatibleApiStyle,
} from "../config/credentials.js";
import { loadUserSettings, saveUserSettings } from "../config/user-settings.js";
import type { SlashContext, SlashResult } from "./slash.js";
import type { AuthView, AuthDialogData } from "../tui/AuthDialog.js";

export function buildListString(): string {
  const creds = readCredentials();
  const settings = loadUserSettings();
  const lines: string[] = [];

  const or = creds.providers.openrouter;
  if (or) {
    lines.push(`  openrouter: ${maskSecret(or.key)}`);
    lines.push(`    endpoint: ${or.endpoint ?? "https://openrouter.ai/api/v1"}`);
    lines.push(
      `    models:   ${or.models?.length ? or.models.join(", ") : "(none)"}`,
    );
  } else {
    lines.push("  openrouter: (not set)");
  }

  const cursor = creds.providers.cursor;
  if (cursor) {
    lines.push(`  cursor:     ${maskSecret(cursor.key)}`);
  } else {
    lines.push("  cursor:     (not set)");
  }

  const names = listCompatibleProviderNames();
  if (names.length === 0) {
    lines.push("  compatible: (none)");
  } else {
    for (const name of names) {
      const p = resolveCompatibleProvider(name)!;
      const active =
        settings.backend === "compatible" &&
        settings.compatibleProvider === name
          ? " [active]"
          : "";
      lines.push(`  compatible/${name}${active}: ${maskSecret(p.key)}`);
      lines.push(`    endpoint: ${p.endpoint}`);
      lines.push(`    api:      ${p.api ?? "openai"}`);
      lines.push(
        `    models:   ${p.models.length ? p.models.join(", ") : "(none)"}`,
      );
    }
  }

  return lines.join("\n");
}

/** /auth — open interactive AuthDialog. */
export async function handleAuth(
  _ctx: SlashContext,
  restRaw: string,
): Promise<SlashResult> {
  const rest = restRaw.trim().toLowerCase();

  // /auth list still works inline for quick reference
  if (rest === "list" || rest === "status" || rest === "show") {
    _ctx.pushLine("─ Auth providers ─");
    _ctx.pushLine(`  file: ${credentialsPath()}`);
    _ctx.pushLine(buildListString());
    return { ok: true, message: "Auth providers listed above." };
  }

  // Open the interactive AuthDialog
  return {
    ok: true,
    message: "Opening auth dialog…",
    openAuthDialog: {
      view: "main",
      data: {},
    },
  };
}

// ─── Dialog action handlers (called from Orchestrator) ───────────────────

export interface AuthAction {
  /** The current view before the action */
  view: AuthView;
  /** Accumulated auth data */
  data: AuthDialogData;
  /** Free-text draft being entered */
  draft?: string;
}

export interface AuthActionResult {
  view: AuthView;
  data: AuthDialogData;
  message?: string;
  error?: string;
}

/**
 * Process a "confirm" action on the current auth dialog view.
 * This is the state machine that drives the AuthDialog.
 */
export function processAuthConfirm(action: AuthAction): AuthActionResult {
  const { view, data } = action;
  const draft = (action.draft ?? "").trim();
  let result: AuthActionResult;

  switch (view) {
    case "main":
      // No confirm on main menu — handled by selecting an option
      return { view, data };

    case "openrouter-key":
      if (!draft) {
        return { view, data, error: "API key is required" };
      }
      return {
        view: "openrouter-models",
        data: { ...data, key: draft },
      };

    case "openrouter-models":
      return {
        view: "openrouter-review",
        data: {
          ...data,
          models: draft ? draft.split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
      };

    case "openrouter-review":
      // data.confirm was true → save
      result = saveAndReturn(data, "openrouter");
      return result;

    case "cursor-key":
      if (!draft) {
        return { view, data, error: "API key is required" };
      }
      return {
        view: "cursor-review",
        data: { ...data, key: draft },
      };

    case "cursor-review":
      result = saveAndReturn(data, "cursor");
      return result;

    case "compatible-name":
      if (!draft || !/^[a-z0-9][a-z0-9._-]*$/.test(draft)) {
        return {
          view,
          data,
          error: "Valid name required (letters/digits/._-)",
        };
      }
      return {
        view: "compatible-endpoint",
        data: { ...data, name: draft.toLowerCase() },
      };

    case "compatible-endpoint":
      if (!validateUrl(draft)) {
        return {
          view,
          data,
          error: "Valid URL required (http:// or https://)",
        };
      }
      return {
        view: "compatible-key",
        data: { ...data, endpoint: draft },
      };

    case "compatible-key":
      if (!draft) {
        return { view, data, error: "API key is required" };
      }
      return {
        view: "compatible-models",
        data: { ...data, key: draft },
      };

    case "compatible-models":
      if (!draft) {
        return { view, data, error: "At least one model is required" };
      }
      return {
        view: "compatible-api",
        data: {
          ...data,
          models: draft.split(",").map((s) => s.trim()).filter(Boolean),
        },
      };

    case "compatible-api":
      // highlight index determines choice
      return {
        view: "compatible-review",
        data: { ...data },
      };

    case "compatible-review":
      result = saveAndReturn(data, "compatible");
      return result;

    default:
      return { view, data };
  }
}

function saveAndReturn(
  data: AuthDialogData,
  provider: "openrouter" | "cursor" | "compatible",
): AuthActionResult {
  try {
    if (provider === "openrouter") {
      writeCredentials({
        openrouter: {
          key: data.key ?? "",
          ...(data.models?.length ? { models: data.models } : { models: [] }),
        },
      });
      applyCredentialsToRuntime();
      if (data.models?.[0]) {
        saveUserSettings({ defaultModel: data.models[0] });
      }
      return {
        view: "done",
        data,
        message: `OpenRouter key saved (${maskSecret(data.key ?? "")})`,
      };
    }

    if (provider === "cursor") {
      writeCredentials({ cursor: { key: data.key ?? "" } });
      applyCredentialsToRuntime();
      return {
        view: "done",
        data,
        message: `Cursor key saved (${maskSecret(data.key ?? "")})`,
      };
    }

    if (provider === "compatible") {
      const api = (data.api ?? "openai") as CompatibleApiStyle;
      writeCredentials({
        compatible: {
          [data.name ?? "custom"]: {
            endpoint: data.endpoint ?? "",
            key: data.key ?? "",
            models: data.models ?? [],
            api,
          },
        },
      });
      applyCredentialsToRuntime();
      saveUserSettings({
        backend: "compatible",
        compatibleProvider: data.name,
        defaultModel: data.models?.[0],
      });
      return {
        view: "done",
        data,
        message: `Compatible provider "${data.name}" saved. Backend → compatible.`,
      };
    }

    return { view: "done", data, message: "Saved." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { view: "done", data, error: msg };
  }
}

/**
 * Process a "back" action — go to previous view.
 */
export function processAuthBack(action: AuthAction): AuthActionResult {
  const { view } = action;
  const data = { ...action.data };

  switch (view) {
    case "main":
    case "list":
    case "done":
      return { view: "main", data: {} };

    case "openrouter-key":
      return { view: "main", data: {} };

    case "openrouter-models":
      return { view: "openrouter-key", data };

    case "openrouter-review":
      return { view: "openrouter-models", data };

    case "cursor-key":
      return { view: "main", data: {} };

    case "cursor-review":
      return { view: "cursor-key", data };

    case "compatible-name":
      return { view: "main", data: {} };

    case "compatible-endpoint":
      return { view: "compatible-name", data };

    case "compatible-key":
      return { view: "compatible-endpoint", data };

    case "compatible-models":
      return { view: "compatible-key", data };

    case "compatible-api":
      return { view: "compatible-models", data };

    case "compatible-review":
      return { view: "compatible-api", data };

    default:
      return { view: "main", data: {} };
  }
}
