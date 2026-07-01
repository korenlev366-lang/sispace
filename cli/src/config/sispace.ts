import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/root.js";

export interface SispaceNtfyConfig {
  server: string;
  topic: string;
}

export interface SispaceCompactionConfig {
  enabled: boolean;
  reserve_tokens: number;
  keep_recent_tokens: number;
  context_window: number;
  /** Fraction of model context window at which to auto-compact (0.0–1.0).
   *  For known models, the effective budget is modelContextWidow × compactRatio.
   *  Default 0.80 = 80%. */
  compact_ratio: number;
}

export interface SispaceConfig {
  ntfy: SispaceNtfyConfig;
  compaction: SispaceCompactionConfig;
}

const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

const DEFAULT_COMPACTION: SispaceCompactionConfig = {
  enabled: true,
  reserve_tokens: 16_384,
  keep_recent_tokens: 20_000,
  context_window: 200_000,
  compact_ratio: 0.80,
};

function parseNtfySection(lines: string[]): SispaceNtfyConfig {
  let inNtfy = false;
  let server = DEFAULT_NTFY_SERVER;
  let topic = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "ntfy:") {
      inNtfy = true;
      continue;
    }
    if (inNtfy && trimmed.endsWith(":") && !line.startsWith(" ") && trimmed !== "ntfy:") {
      break;
    }
    if (!inNtfy) {
      continue;
    }
    if (trimmed.startsWith("server:")) {
      const v = trimmed.slice("server:".length).trim().replace(/^["']|["']$/g, "");
      if (v) {
        server = v;
      }
    }
    if (trimmed.startsWith("topic:")) {
      const v = trimmed.slice("topic:".length).trim().replace(/^["']|["']$/g, "");
      topic = v;
    }
  }
  return { server, topic };
}

function parseCompactionSection(lines: string[]): SispaceCompactionConfig {
  let inCompaction = false;
  const cfg = { ...DEFAULT_COMPACTION };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "compaction:") {
      inCompaction = true;
      continue;
    }
    if (inCompaction && trimmed.endsWith(":") && !line.startsWith(" ") && trimmed !== "compaction:") {
      break;
    }
    if (!inCompaction) {
      continue;
    }
    if (trimmed.startsWith("enabled:")) {
      const v = trimmed.slice("enabled:".length).trim().toLowerCase();
      cfg.enabled = v !== "false" && v !== "0" && v !== "no";
    }
    if (trimmed.startsWith("reserve_tokens:")) {
      const n = Number.parseInt(trimmed.slice("reserve_tokens:".length).trim(), 10);
      if (Number.isFinite(n) && n > 0) {
        cfg.reserve_tokens = n;
      }
    }
    if (trimmed.startsWith("keep_recent_tokens:")) {
      const n = Number.parseInt(trimmed.slice("keep_recent_tokens:".length).trim(), 10);
      if (Number.isFinite(n) && n > 0) {
        cfg.keep_recent_tokens = n;
      }
    }
    if (trimmed.startsWith("context_window:")) {
      const n = Number.parseInt(trimmed.slice("context_window:".length).trim(), 10);
      if (Number.isFinite(n) && n > 0) {
        cfg.context_window = n;
      }
    }
    if (trimmed.startsWith("compact_ratio:")) {
      const n = Number.parseFloat(trimmed.slice("compact_ratio:".length).trim());
      if (Number.isFinite(n) && n > 0 && n <= 1) {
        cfg.compact_ratio = n;
      }
    }
  }
  return cfg;
}

/** Load `config/sispace.yaml` (minimal parser; no YAML dep). */
export function loadSispaceConfig(projectRoot: string): SispaceConfig {
  const path = join(projectRoot, "config", "sispace.yaml");
  if (!existsSync(path)) {
    return {
      ntfy: { server: DEFAULT_NTFY_SERVER, topic: "" },
      compaction: { ...DEFAULT_COMPACTION },
    };
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  return {
    ntfy: parseNtfySection(lines),
    compaction: parseCompactionSection(lines),
  };
}

export function loadSispaceConfigFromCwd(cwd: string): SispaceConfig {
  return loadSispaceConfig(findProjectRoot(cwd));
}
