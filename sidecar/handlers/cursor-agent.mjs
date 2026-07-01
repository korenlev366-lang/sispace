import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_OBSIDIAN_MCP_URL = "http://127.0.0.1:27123/mcp/";

/**
 * Temp CURSOR_CONFIG_DIR with inline Obsidian MCP (bypasses empty project mcp.json).
 * @returns {{ env: Record<string, string>, cleanup: () => void }}
 */
function prepareInlineObsidianMcpEnv() {
  const key = (process.env.OBSIDIAN_API_KEY ?? "").trim();
  if (!key) {
    return { env: {}, cleanup: () => {} };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "sispace-openclaw-"));
  const cursorDir = join(tmpDir, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(
    join(cursorDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        obsidian: {
          type: "http",
          url: DEFAULT_OBSIDIAN_MCP_URL,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    }),
  );

  return {
    env: { CURSOR_CONFIG_DIR: tmpDir },
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/** @typedef {{ available: boolean, path: string | null, version: string | null }} CursorAgentDetection */

let cachedDetection = null;

/**
 * Detect whether cursor-agent is available on PATH (cached after first call).
 * @returns {CursorAgentDetection}
 */
export function detectCursorAgent() {
  if (cachedDetection) return cachedDetection;

  const which = spawnSync("which", ["cursor-agent"], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout?.trim()) {
    cachedDetection = { available: false, path: null, version: null };
    return cachedDetection;
  }

  const binPath = which.stdout.trim();
  const versionRun = spawnSync(binPath, ["--version"], { encoding: "utf8" });
  const version =
    versionRun.status === 0 ? (versionRun.stdout ?? versionRun.stderr ?? "").trim() : null;

  cachedDetection = { available: true, path: binPath, version };
  return cachedDetection;
}

/** Reset cache (for tests). */
export function resetCursorAgentDetectionCache() {
  cachedDetection = null;
}

/**
 * Run one specialist step via cursor-agent CLI (OpenClaw hybrid).
 * @param {{
 *   prompt: string,
 *   cwd: string,
 *   apiKey: string,
 *   resumeSessionId?: string,
 *   model?: string,
 *   timeoutMs?: number,
 * }} opts
 */
export async function runCursorAgentStep(opts) {
  const detection = detectCursorAgent();
  if (!detection.available || !detection.path) {
    throw new Error("cursor-agent is not available in PATH");
  }

  const args = [
    "--trust",
    "--print",
    "--output-format",
    "json",
    "-p",
    opts.prompt,
  ];

  if (opts.model) {
    args.push("--model", opts.model);
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  const { env: mcpEnv, cleanup } = prepareInlineObsidianMcpEnv();
  try {
    const env = {
      ...process.env,
      CURSOR_API_KEY: opts.apiKey,
      ...mcpEnv,
    };
    if (process.env.OBSIDIAN_API_KEY) {
      env.OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY;
    }

    const result = spawnSync(detection.path, args, {
      cwd: opts.cwd,
      env,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 3_600_000,
    });

    if (result.error) {
      throw result.error;
    }

    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();

    if (result.status !== 0) {
      const detail = stderr || stdout || `exit ${result.status}`;
      throw new Error(`cursor-agent failed: ${detail}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(
        `cursor-agent returned non-JSON output: ${stdout.slice(0, 500) || "(empty)"}`,
      );
    }

    if (parsed.is_error) {
      throw new Error(parsed.result ?? "cursor-agent reported is_error");
    }

    return {
      result: typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? parsed),
      sessionId: parsed.session_id ?? opts.resumeSessionId ?? null,
      runId: parsed.request_id ?? parsed.session_id ?? null,
      status: "ok",
    };
  } finally {
    cleanup();
  }
}

/**
 * True when Obsidian REST auth is configured for MCP inheritance in cursor-agent.
 */
export function obsidianMcpConfigured() {
  return Boolean((process.env.OBSIDIAN_API_KEY ?? "").trim());
}
