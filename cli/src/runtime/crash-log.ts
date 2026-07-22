/**
 * Synchronous crash persistence for the Ink TUI.
 *
 * Appends full error + stack + metadata to ~/.config/cursorsi/crash.log
 * (or $XDG_CONFIG_HOME/cursorsi/crash.log) before the process tears down.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inspect } from "node:util";

const CONFIG_DIR_NAME = "cursorsi";
const CRASH_LOG_FILE = "crash.log";

let installed = false;
let logging = false;

export function crashLogPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && existsSync(xdg) ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME, CRASH_LOG_FILE);
}

function ensureCrashLogDir(): string {
  const path = crashLogPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return path;
}

function errorFromUnknown(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(
    typeof reason === "string" ? reason : inspect(reason, { depth: 5 }),
  );
}

/**
 * Stream/TTY errors that should not tear down the whole TUI.
 *
 * Common sources:
 * - Cursor SDK shell state fd write after the child exited (write EPIPE)
 * - Ink setRawMode during teardown when the TTY is already gone (EIO)
 * - Peer socket reset mid-write (ECONNRESET)
 */
export function isBenignProcessError(reason: unknown): boolean {
  const err = reason as { code?: unknown; message?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : "";
  const message =
    typeof err?.message === "string"
      ? err.message
      : reason instanceof Error
        ? reason.message
        : String(reason ?? "");

  if (
    code === "EPIPE" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_DESTROYED" ||
    code === "ERR_STREAM_WRITE_AFTER_END"
  ) {
    return true;
  }

  if (/^write EPIPE$/i.test(message) || /\bEPIPE\b/.test(message)) {
    return true;
  }
  if (/setRawMode\s+EIO/i.test(message)) {
    return true;
  }
  return false;
}

export interface CrashReportContext {
  [key: string]: unknown;
}

/** Append a crash record synchronously. Returns the log file path. */
export function appendCrashReport(
  source: string,
  reason: unknown,
  context?: CrashReportContext,
): string {
  if (logging) {
    return crashLogPath();
  }
  logging = true;
  try {
    const path = ensureCrashLogDir();
    const err = errorFromUnknown(reason);
    const contextLines = context
      ? Object.entries(context).map(
          ([key, value]) => `${key}: ${inspect(value, { depth: 3 })}`,
        )
      : [];

    const record = [
      "",
      "=".repeat(72),
      `cursorsi crash  ${new Date().toISOString()}`,
      `source: ${source}`,
      `pid: ${process.pid}`,
      `cwd: ${process.cwd()}`,
      `node: ${process.version}`,
      `argv: ${process.argv.join(" ")}`,
      ...contextLines,
      "-".repeat(72),
      `message: ${err.message}`,
      ...(err.stack ? [`stack:\n${err.stack}`] : []),
      "=".repeat(72),
      "",
    ].join("\n");

    appendFileSync(path, record, "utf8");
    return path;
  } finally {
    logging = false;
  }
}

/** Log to crash.log and emit a one-line stderr notice with the path. */
export function logFatalError(
  source: string,
  reason: unknown,
  context?: CrashReportContext,
): string {
  const path = appendCrashReport(source, reason, context);
  try {
    process.stderr.write(
      `cursorsi: fatal error (${source}) — log written to ${path}\n`,
    );
  } catch {
    // stderr may already be closed during Ink teardown
  }
  return path;
}

/** Install process-level handlers once (idempotent). */
export function installCrashHandlers(): void {
  if (installed) {
    return;
  }
  installed = true;

  process.on("uncaughtException", (err, origin) => {
    if (isBenignProcessError(err)) {
      appendCrashReport(`benign:uncaughtException:${origin}`, err);
      return;
    }
    logFatalError(`uncaughtException:${origin}`, err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    if (isBenignProcessError(reason)) {
      appendCrashReport("benign:unhandledRejection", reason, {
        promise: inspect(promise),
      });
      return;
    }
    logFatalError("unhandledRejection", reason, {
      promise: inspect(promise),
    });
    process.exit(1);
  });
}
