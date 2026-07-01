/**
 * Cursor SDK backend agent — wraps @cursor/sdk factory pattern.
 *
 * Uses Agent.create({ model: { id }, apiKey, local: { cwd } }) (async factory, NOT new).
 * Implements BackendAgent so the session loop can call runTurn() identically.
 *
 * This is a MINIMAL turn: no subagent planning, no lesson injection, no reasoning_effort.
 * Just the model call. Token counts are undefined (Cursor SDK does not return them).
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BackendAgent, RunResult, RunTurnCallbacks, SDKImage } from "./types.js";

// ─── Import @cursor/sdk via runtime dynamic import (bypasses TS resolution) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cursorSdkModule: any = null;

/** Runtime dynamic import — TypeScript can't statically resolve the sidecar path. */
let cursorSdkImportPath: string | null = null;

/**
 * Walk up from a directory until we find the repo root marker, then resolve the
 * sidecar SDK path from there.  This is depth-robust — it works regardless of
 * whether this module runs from cli/, cli/dist/sdk/, or anywhere else inside
 * the repo checkout.
 */
function resolveRepoRoot(moduleDir: string): string {
  let dir = moduleDir;
  for (;;) {
    const marker = join(dir, "harness", "scripts", "dist", "post-task-chain.js");
    if (existsSync(marker)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume cli/ lives at repo root and moduleDir is cli/dist/sdk/
  // (three levels deep).  We'll climb three dirs to reach the repo root.
  let d = moduleDir;
  for (let i = 0; i < 3; i++) d = dirname(d);
  return d;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolveRepoRoot(__dirname);
const CURSOR_SDK_ABS = join(REPO_ROOT, "sidecar", "node_modules", "@cursor", "sdk", "dist", "esm", "index.js");
const CURSOR_SDK_URL = pathToFileURL(CURSOR_SDK_ABS).href;

export async function getCursorSdk(): Promise<any> {
  if (cursorSdkModule) return cursorSdkModule;
  // Use Function constructor to bypass TypeScript module resolution
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  const importPath =
    cursorSdkImportPath ??
    CURSOR_SDK_URL;
  cursorSdkModule = await dynamicImport(importPath);
  return cursorSdkModule;
}

/** Override the sidecar path for test probes; call before first getCursorSdk(). */
export function setCursorSdkImportPath(path: string): void {
  cursorSdkImportPath = path;
}

// ─── Types for the Cursor SDK shapes we depend on ──────────────────────────

interface CursorSendOptions {
  onDelta?: (args: { update: { type: string; text?: string } }) => void | Promise<void>;
}

interface CursorAgentHandle {
  send(text: string, options?: CursorSendOptions): Promise<CursorRun>;
  close(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

interface CursorRun {
  wait(): Promise<CursorRunResult>;
}

interface CursorRunResult {
  id: string;
  status: "finished" | "error" | "cancelled";
  result?: string;
  model?: string;
  durationMs?: number;
}

interface CursorAgentCreateOptions {
  model: { id: string; params?: Array<{ id: string; value: string }> };
  apiKey: string;
  local?: { cwd: string };
  name?: string;
}

// ─── The class ─────────────────────────────────────────────────────────────

export class CursorAgent implements BackendAgent {
  readonly agentId: string;
  private handle: CursorAgentHandle;
  private closed = false;

  private constructor(agentId: string, handle: CursorAgentHandle) {
    this.agentId = agentId;
    this.handle = handle;
  }

  /**
   * Async factory — mirrors @cursor/sdk's Agent.create.
   *
   * Usage: const agent = await CursorAgent.create({ model: { id: "glm-5.2", params: [{ id: "reasoning", value: "max" }] }, apiKey, cwd });
   */
  static async create(opts: {
    model: { id: string; params?: Array<{ id: string; value: string }> };
    apiKey: string;
    cwd: string;
    name?: string;
    agentId?: string;
  }): Promise<CursorAgent> {
    const sdk = await getCursorSdk();
    const handle: CursorAgentHandle = await sdk.Agent.create({
      model: { id: opts.model.id, ...(opts.model.params?.length ? { params: opts.model.params } : {}) },
      apiKey: opts.apiKey,
      local: { cwd: opts.cwd },
      ...(opts.name ? { name: opts.name } : {}),
    } as CursorAgentCreateOptions);

    const agentId = opts.agentId ?? randomUUID();
    return new CursorAgent(agentId, handle);
  }

  close(): void {
    this.closed = true;
    try {
      this.handle.close();
    } catch {
      // ignore double-close errors
    }
  }

  async runTurn(
    payload: string | { text: string; images: SDKImage[] },
    _runId?: string,
    callbacks?: RunTurnCallbacks,
  ): Promise<RunResult> {
    if (this.closed) {
      throw new Error("agent closed");
    }

    const text =
      typeof payload === "string" ? payload : payload.text;

    try {
      let accumulated = "";
      const run = await this.handle.send(text, {
        onDelta: ({ update }) => {
          if (update.type === "text-delta" && update.text != null) {
            accumulated += update.text;
            callbacks?.onChunk?.(update.text, accumulated);
          }
        },
      });

      const result: CursorRunResult = await run.wait();
      const finished = result.status === "finished";

      return {
        id: result.id,
        status: finished ? "finished" : "error",
        result: result.result ?? accumulated,
        promptTokens: undefined,
        completionTokens: undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks?.onStatus?.(`Cursor SDK error: ${msg}`);
      return {
        id: randomUUID(),
        status: "error",
        result: msg,
      };
    }
  }
}