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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BackendAgent, RunResult, RunTurnCallbacks, SDKImage } from "./types.js";
import {
  forceCancelStaleCursorActiveRun,
  isAlreadyHasActiveRunError,
} from "./cursor-stale-run.js";

// ─── Import @cursor/sdk via runtime dynamic import (bypasses TS resolution) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cursorSdkModule: any = null;

/** Runtime dynamic import override (tests / probes). */
let cursorSdkImportPath: string | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve @cursor/sdk ESM entry for npm installs and monorepo checkouts.
 * Prefer package dependency; fall back to sidecar/ for local sispace layout.
 * Patches target dist/esm/index.js (must stay a sibling of vendor chunks).
 */
function resolveCursorSdkEntryAbs(): string {
  try {
    // exports block package.json — resolve main then walk up to the package root
    const resolved = requireFromHere.resolve("@cursor/sdk");
    let dir = dirname(resolved);
    for (;;) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const name = (
            requireFromHere(pkgPath) as { name?: string }
          ).name;
          if (name === "@cursor/sdk") {
            const esm = join(dir, "dist", "esm", "index.js");
            if (existsSync(esm)) return esm;
          }
        } catch {
          // continue walking
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // not installed next to this module
  }

  // Monorepo fallback: walk up for sidecar/node_modules/@cursor/sdk
  let dir = __dirname;
  for (;;) {
    const sidecar = join(
      dir,
      "sidecar",
      "node_modules",
      "@cursor",
      "sdk",
      "dist",
      "esm",
      "index.js",
    );
    if (existsSync(sidecar)) return sidecar;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    "Cursor SDK (@cursor/sdk) not found. Reinstall cursorsi or run: npm install @cursor/sdk",
  );
}

export async function getCursorSdk(): Promise<any> {
  if (cursorSdkModule) return cursorSdkModule;

  const {
    ensurePatchedCursorSdkPath,
    installCursorAskQuestionHook,
  } = await import("./cursor-ask-question-bridge.js");

  // Wire AskQuestion → QuestionPicker before the SDK loads.
  installCursorAskQuestionHook();

  // Use Function constructor to bypass TypeScript module resolution
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;

  let importPath = cursorSdkImportPath;
  if (!importPath) {
    const sdkAbs = resolveCursorSdkEntryAbs();
    // Load a patched copy that delegates askQuestionInteractionQuery to our hook.
    const patchedAbs = ensurePatchedCursorSdkPath(sdkAbs);
    importPath = pathToFileURL(patchedAbs).href;
  }

  cursorSdkModule = await dynamicImport(importPath);
  return cursorSdkModule;
}

/** Override the sidecar path for test probes; call before first getCursorSdk(). */
export function setCursorSdkImportPath(path: string): void {
  cursorSdkImportPath = path;
}

// ─── Types for the Cursor SDK shapes we depend on ──────────────────────────

interface CursorSendOptions {
  onDelta?: (args: {
    update: { type: string; text?: string; callId?: string };
  }) => void | Promise<void>;
}

interface CursorAgentHandle {
  readonly agentId: string;
  send(
    message: string | { text: string; images?: SDKImage[] },
    options?: CursorSendOptions,
  ): Promise<CursorRun>;
  close(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

interface CursorRun {
  wait(): Promise<CursorRunResult>;
  cancel?: () => Promise<void>;
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
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
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
   * Async factory — mirrors @cursor/sdk's Agent.create / Agent.resume.
   *
   * When `agentId` is set, resumes that agent (falls back to create on failure).
   * Always stores the SDK's real `handle.agentId` for later resume/cache keys.
   */
  static async create(opts: {
    model: { id: string; params?: Array<{ id: string; value: string }> };
    apiKey: string;
    cwd: string;
    name?: string;
    agentId?: string;
  }): Promise<CursorAgent> {
    const sdk = await getCursorSdk();
    const { buildCursorAskUserMcpServers } = await import("./cursor-ask-mcp.js");
    const createOpts = {
      model: {
        id: opts.model.id,
        ...(opts.model.params?.length ? { params: opts.model.params } : {}),
      },
      apiKey: opts.apiKey,
      local: { cwd: opts.cwd },
      // Native AskQuestion is not offered in local SDK runs — MCP ask_user instead.
      mcpServers: buildCursorAskUserMcpServers(),
      ...(opts.name ? { name: opts.name } : {}),
    } as CursorAgentCreateOptions;

    let handle: CursorAgentHandle;
    if (opts.agentId?.trim()) {
      try {
        // Resume persisted Cursor conversation — Agent.create always starts fresh.
        handle = await sdk.Agent.resume(opts.agentId.trim(), createOpts);
      } catch {
        // Resume miss — fall back to a fresh agent without spamming the TUI.
        handle = await sdk.Agent.create(createOpts);
      }
    } else {
      handle = await sdk.Agent.create(createOpts);
    }

    // Prefer the SDK's real agentId so later resume/cache keys match Cursor storage.
    const agentId = handle.agentId?.trim() || opts.agentId?.trim() || randomUUID();
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

    // Cursor SDK accepts string or { text, images } — do not drop attachments.
    const message =
      typeof payload === "string"
        ? payload
        : payload.images.length > 0
          ? { text: payload.text, images: payload.images }
          : payload.text;

    const signal = callbacks?.signal;
    if (signal?.aborted) {
      return {
        id: randomUUID(),
        status: "error",
        result: "Cancelled",
      };
    }

    try {
      let accumulated = "";
      let toolCallCount = 0;

      const sendOpts = {
        onDelta: ({ update }: { update: { type: string; text?: string } }) => {
          if (update.type === "text-delta" && update.text != null) {
            accumulated += update.text;
            callbacks?.onChunk?.(update.text, accumulated);
          }
          // Count completed tool calls when the SDK surfaces them.
          if (
            update.type === "tool-call-completed" ||
            update.type === "tool_call_completed"
          ) {
            toolCallCount += 1;
          }
        },
      };

      // Stale RUNNING/QUEUED rows (cancel raced with handle.close) block follow-ups.
      let run: CursorRun;
      try {
        run = await this.handle.send(message, sendOpts);
      } catch (err) {
        if (!isAlreadyHasActiveRunError(err)) throw err;
        const cleared = forceCancelStaleCursorActiveRun(this.agentId);
        callbacks?.onStatus?.(
          cleared
            ? "› Cleared stale Cursor run — retrying send"
            : "› Stale Cursor run detected but could not clear — retrying send",
        );
        run = await this.handle.send(message, sendOpts);
      }

      const waitPromise = run.wait();
      const result: CursorRunResult = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value: CursorRunResult) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        };
        const onAbort = () => {
          // Await SDK cancel so index.db marks CANCELLED before we drop the handle.
          void Promise.resolve()
            .then(() => run.cancel?.())
            .catch(() => {
              // Fallback: clear the local store row if cancel never wrote terminal status.
              forceCancelStaleCursorActiveRun(this.agentId);
            })
            .finally(() => {
              finish({
                id: randomUUID(),
                status: "cancelled",
                result: accumulated || "Cancelled",
              });
            });
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        waitPromise.then(
          (r) => {
            finish(r);
          },
          (err) => {
            signal?.removeEventListener("abort", onAbort);
            if (!settled) {
              settled = true;
              reject(err);
            }
          },
        );
      });

      if (result.status === "cancelled" || signal?.aborted) {
        return {
          id: result.id,
          status: "error",
          result: "Cancelled",
          promptTokens: undefined,
          completionTokens: undefined,
        };
      }

      const finished = result.status === "finished";
      return {
        id: result.id,
        status: finished ? "finished" : "error",
        result: result.result ?? accumulated,
        promptTokens: undefined,
        completionTokens: undefined,
        toolCallCount,
      };
    } catch (err) {
      if (signal?.aborted) {
        forceCancelStaleCursorActiveRun(this.agentId);
        return {
          id: randomUUID(),
          status: "error",
          result: "Cancelled",
        };
      }
      if (isAlreadyHasActiveRunError(err)) {
        forceCancelStaleCursorActiveRun(this.agentId);
      }
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