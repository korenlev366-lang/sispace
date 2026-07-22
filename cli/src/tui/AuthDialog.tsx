/**
 * AuthDialog — interactive TUI for managing API keys and compatible endpoints.
 *
 * Qwen Code-style step-by-step UI with keyboard navigation.
 * Steps:
 *   1. Choose provider type: OpenRouter | Cursor | Compatible
 *   2. Enter API key (and optional model slugs / endpoint)
 *   3. Review & confirm
 */

import { Box, Text } from "ink";
import type { CompatibleApiStyle } from "../config/credentials.js";

// ─── Types ───────────────────────────────────────────────────────────────

export type AuthView =
  | "main"
  | "list"
  | "openrouter-key"
  | "openrouter-models"
  | "openrouter-review"
  | "cursor-key"
  | "cursor-review"
  | "compatible-name"
  | "compatible-endpoint"
  | "compatible-key"
  | "compatible-models"
  | "compatible-api"
  | "compatible-review"
  | "done";

export type MainOption = "openrouter" | "cursor" | "compatible" | "list";

export interface AuthDialogData {
  provider?: MainOption;
  name?: string; // compatible provider slug
  key?: string;
  endpoint?: string;
  models?: string[];
  api?: CompatibleApiStyle;
  error?: string;
  message?: string;
}

export interface AuthDialogProps {
  view: AuthView;
  /** Index into menu options (for radio-select views) */
  highlightIndex: number;
  /** Free-text draft being typed (for input fields) */
  draft?: string;
  /** Accumulated auth data so far */
  data: AuthDialogData;
  /** Saved provider names for the "list" view */
  savedProviders?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const MAIN_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  cursor: "Cursor",
  compatible: "Compatible Provider (OpenAI / Anthropic API)",
};

const MAIN_OPTIONS_LIST: MainOption[] = ["openrouter", "cursor", "compatible"];

const COMPATIBLE_API_OPTIONS: CompatibleApiStyle[] = ["openai", "anthropic"];

function mask(k: string | undefined): string {
  if (!k) return "(not set)";
  if (k.length <= 8) return "****";
  return k.slice(0, 4) + "****" + k.slice(-4);
}

// ─── View builders ───────────────────────────────────────────────────────

function MainMenu({
  highlightIndex,
}: {
  highlightIndex: number;
}) {
  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        Choose a provider to configure
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {MAIN_OPTIONS_LIST.map((opt, i) => {
          const selected = i === highlightIndex;
          return (
            <Text key={opt}>
              <Text color={selected ? "#d8a657" : "#5b574d"}>
                {selected ? "› " : "  "}
              </Text>
              <Text color={selected ? "#d8a657" : "#928d80"} bold={selected}>
                {MAIN_LABELS[opt]}
              </Text>
            </Text>
          );
        })}
        <Text>
          <Text color={3 === highlightIndex ? "#d8a657" : "#5b574d"}>
            {3 === highlightIndex ? "› " : "  "}
          </Text>
          <Text color={3 === highlightIndex ? "#d8a657" : "#928d80"} bold={3 === highlightIndex}>
            View saved providers
          </Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ select · Enter confirm · Esc close</Text>
      </Box>
    </Box>
  );
}

function InputField({
  label,
  draft = "",
  hint,
}: {
  label: string;
  draft?: string;
  hint?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        {label}
      </Text>
      {hint ? (
        <Text dimColor>{hint}</Text>
      ) : null}
      <Box marginTop={1}>
        <Text color="#d8a657" bold>
          ›{" "}
        </Text>
        <Text>{draft}</Text>
        <Text color="#d8a657">▌</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Type · Enter confirm · Esc back</Text>
      </Box>
    </Box>
  );
}

function ReviewCard({
  data,
  onConfirm,
}: {
  data: AuthDialogData;
  onConfirm: boolean;
}) {
  const items: Array<{ label: string; value: string }> = [];

  if (data.provider === "openrouter") {
    items.push({ label: "Provider", value: "OpenRouter" });
    items.push({ label: "API Key", value: mask(data.key) });
    items.push({
      label: "Models",
      value: data.models?.length ? data.models.join(", ") : "(none)",
    });
  } else if (data.provider === "cursor") {
    items.push({ label: "Provider", value: "Cursor" });
    items.push({ label: "API Key", value: mask(data.key) });
  } else if (data.provider === "compatible") {
    items.push({ label: "Name", value: data.name ?? "" });
    items.push({ label: "Endpoint", value: data.endpoint ?? "" });
    items.push({ label: "API Key", value: mask(data.key) });
    items.push({
      label: "Models",
      value: data.models?.length ? data.models.join(", ") : "(none)",
    });
    items.push({ label: "API Style", value: data.api ?? "openai" });
  }

  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        Review — confirm or go back
      </Text>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {items.map((it) => (
          <Text key={it.label}>
            <Text color="#928d80">{it.label}: </Text>
            <Text color="#e9e5dc">{it.value}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="row">
        <Text>
          <Text color={onConfirm ? "#d8a657" : "#5b574d"}>
            {onConfirm ? "› [" : "  ["}
          </Text>
          <Text
            color={onConfirm ? "#d8a657" : "#928d80"}
            bold={onConfirm}
          >
            Save
          </Text>
          <Text color={onConfirm ? "#d8a657" : "#5b574d"}>]</Text>
          <Text dimColor>  Enter</Text>
        </Text>
        <Box marginLeft={4}>
          <Text>
            <Text color={!onConfirm ? "#d8a657" : "#5b574d"}>
              {!onConfirm ? "› [" : "  ["}
            </Text>
            <Text
              color={!onConfirm ? "#d8a657" : "#928d80"}
              bold={!onConfirm}
            >
              Back
            </Text>
            <Text color={!onConfirm ? "#d8a657" : "#5b574d"}>]</Text>
            <Text dimColor>  Esc</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function ListView({ savedProviders }: { savedProviders?: string }) {
  return (
    <Box flexDirection="column">
      <Text bold color="#d8a657">
        Saved providers — Esc to close
      </Text>
      <Box marginTop={1}>
        {savedProviders ? (
          <Text color="#e9e5dc">{savedProviders}</Text>
        ) : (
          <Text dimColor>No providers configured yet.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc to go back</Text>
      </Box>
    </Box>
  );
}

function DoneView({ message }: { message?: string }) {
  return (
    <Box flexDirection="column">
      <Text bold color="#a6da95">
        ✓ {message ?? "Credentials saved"}
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Press Esc to close</Text>
      </Box>
    </Box>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

export function AuthDialog({
  view,
  highlightIndex,
  draft = "",
  data,
  savedProviders,
}: AuthDialogProps) {
  const inner = (() => {
    switch (view) {
      case "main":
        return <MainMenu highlightIndex={highlightIndex} />;

      case "openrouter-key":
        return (
          <InputField
            label="OpenRouter API Key"
            draft={draft}
            hint="Paste your OpenRouter API key (sk-or-...)"
          />
        );

      case "openrouter-models":
        return (
          <InputField
            label="OpenRouter Model Slugs"
            draft={draft}
            hint="Comma-separated, e.g. openai/gpt-4o,anthropic/claude-3.5-sonnet (optional)"
          />
        );

      case "openrouter-review":
        return <ReviewCard data={data} onConfirm={highlightIndex === 0} />;

      case "cursor-key":
        return (
          <InputField
            label="Cursor API Key"
            draft={draft}
            hint="Paste your Cursor API key"
          />
        );

      case "cursor-review":
        return <ReviewCard data={data} onConfirm={highlightIndex === 0} />;

      case "compatible-name":
        return (
          <InputField
            label="Provider Name"
            draft={draft}
            hint="slug, e.g. my-proxy, local-llama (letters, digits, ._-)"
          />
        );

      case "compatible-endpoint":
        return (
          <InputField
            label="Endpoint URL"
            draft={draft}
            hint="https://your-api.com/v1"
          />
        );

      case "compatible-key":
        return (
          <InputField
            label="API Key"
            draft={draft}
            hint="Your API key for this provider"
          />
        );

      case "compatible-models":
        return (
          <InputField
            label="Model Slugs"
            draft={draft}
            hint="Comma-separated, e.g. gpt-4o,claude-3-opus"
          />
        );

      case "compatible-api":
        return (
          <Box flexDirection="column">
            <Text bold color="#d8a657">
              API Style
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {COMPATIBLE_API_OPTIONS.map((opt, i) => {
                const selected = i === highlightIndex;
                return (
                  <Text key={opt}>
                    <Text color={selected ? "#d8a657" : "#5b574d"}>
                      {selected ? "› " : "  "}
                    </Text>
                    <Text
                      color={selected ? "#d8a657" : "#928d80"}
                      bold={selected}
                    >
                      {opt === "openai" ? "OpenAI-compatible (chat/completions)" : "Anthropic-compatible (/messages)"}
                    </Text>
                  </Text>
                );
              })}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ select · Enter confirm · Esc back</Text>
            </Box>
          </Box>
        );

      case "compatible-review":
        return <ReviewCard data={data} onConfirm={highlightIndex === 0} />;

      case "list":
        return <ListView savedProviders={savedProviders} />;

      case "done":
        return <DoneView message={data.message} />;

      default:
        return <Text dimColor>Loading…</Text>;
    }
  })();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        {view === "main"
          ? "Auth — Manage Providers"
          : view === "list"
            ? "Auth — Saved Providers"
            : view === "done"
              ? "Auth — Done"
              : `Auth — ${view.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`}
      </Text>

      <Box marginTop={1} marginBottom={1}>
        {inner}
      </Box>

      {data.error ? (
        <Box marginTop={1}>
          <Text color="#ed8796">! {data.error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
